import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { syncMantisData, getLocalDatabase, reloadDatabase, importDatabase, fetchCRPageDetails, DB_FILE, META_FILE, DATA_DIR } from './sync.js';
import { processAiQuery, analyzeSingleCRDiff, compareMultipleCRDiffs } from './ai.js';
import { testSSHConnection, fetchFileDiffSSH } from './ssh.js';
import { getClaudeModels, getAntigravityModels, getCodexModels, getOmniRouteModels, getAIProvidersStatus } from './cli-models.js';
import { getCRDiffCache, saveCRDiffCache, fetchAndCacheCRDiff, getDiffCacheStats, initCacheIndex, batchIndexDiffs, backgroundDiffIndexer } from './diff-cache.js';
import { sshPool } from './ssh-pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
let DIST_DIR = path.join(ROOT_DIR, 'dist');
if (process.resourcesPath && !fs.existsSync(DIST_DIR)) {
  const unpackedDist = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist');
  const asarDist = path.join(process.resourcesPath, 'app.asar', 'dist');
  if (fs.existsSync(unpackedDist)) {
    DIST_DIR = unpackedDist;
  } else if (fs.existsSync(asarDist)) {
    DIST_DIR = asarDist;
  }
}
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CLI_SETTINGS_DIR = path.join(os.homedir(), '.mantis_cr_hub');
const CLI_SETTINGS_FILE = path.join(CLI_SETTINGS_DIR, 'settings.json');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '100mb' }));

// Prioritize UI requests: flag user activity on any user API call (excluding background worker-status polling)
app.use((req, res, next) => {
  if (!req.path.includes('/worker-status')) {
    sshPool.notifyUserActive();
  }
  next();
});

// 1. Status endpoint
app.get('/api/status', (req, res) => {
  const { meta, crs } = getLocalDatabase();
  res.json({
    ok: true,
    meta,
    totalCount: crs.length,
    dataDir: DATA_DIR,
    dbFilePath: DB_FILE
  });
});

// 1.1 Open persistent data directory in Finder / File Explorer
app.post('/api/open-data-dir', (req, res) => {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const cmd = process.platform === 'darwin' 
      ? `open "${DATA_DIR}"` 
      : (process.platform === 'win32' ? `explorer "${DATA_DIR}"` : `xdg-open "${DATA_DIR}"`);
    exec(cmd);
    res.json({ ok: true, dataDir: DATA_DIR });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Helper to discover and read settings from all known persistent disk locations
function loadDiskSettings() {
  const candidates = [
    SETTINGS_FILE,
    CLI_SETTINGS_FILE,
    path.join(ROOT_DIR, 'data', 'settings.json')
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          if (parsed.ai && (parsed.ai.omnirouteApiKey === 'CHANGEME' || parsed.ai.omnirouteApiKey === 'sk-omniroute')) {
            parsed.ai.omnirouteApiKey = '';
          }
          return { settings: parsed, source: file };
        }
      } catch (e) {}
    }
  }
  return null;
}

// Auto-seed persistent settings on server startup so server info is never lost
function ensurePersistentSettings() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(SETTINGS_FILE)) {
      const found = loadDiskSettings();
      if (found && found.source !== SETTINGS_FILE) {
        console.log(`[Settings] Restoring saved server settings: ${found.source} -> ${SETTINGS_FILE}`);
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(found.settings, null, 2), 'utf8');
      }
    }
  } catch (e) {
    console.warn('[Settings] ensurePersistentSettings error:', e.message);
  }
}

ensurePersistentSettings();

// 1.5 Get Settings from local disk
app.get('/api/settings', (req, res) => {
  try {
    const found = loadDiskSettings();
    if (found) {
      // Ensure DATA_DIR copy stays in sync
      if (!fs.existsSync(SETTINGS_FILE)) {
        try {
          fs.writeFileSync(SETTINGS_FILE, JSON.stringify(found.settings, null, 2), 'utf8');
        } catch (e) {}
      }
      return res.json({ ok: true, settings: found.settings });
    }
    res.json({ ok: true, settings: null });
  } catch (err) {
    console.error('[Get Settings Error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1.6 Save Settings to local disk (multi-location persistent backup)
app.post('/api/settings', (req, res) => {
  try {
    const newSettings = req.body;
    if (!newSettings || typeof newSettings !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid settings object' });
    }

    // Load existing settings on disk to avoid accidental credential or server erasure
    const existing = loadDiskSettings()?.settings || {};

    // Deep merge ssh and ai configurations
    const mergedSettings = {
      ...existing,
      ...newSettings,
      ssh: {
        ...(existing.ssh || {}),
        ...(newSettings.ssh || {})
      },
      ai: {
        ...(existing.ai || {}),
        ...(newSettings.ai || {})
      }
    };

    if (mergedSettings.ai && (mergedSettings.ai.omnirouteApiKey === 'CHANGEME' || mergedSettings.ai.omnirouteApiKey === 'sk-omniroute')) {
      mergedSettings.ai.omnirouteApiKey = '';
    }

    // If newSettings has valid sshServers, update them; otherwise preserve existing sshServers
    if (Array.isArray(newSettings.sshServers) && newSettings.sshServers.length > 0) {
      mergedSettings.sshServers = newSettings.sshServers;
    } else if (Array.isArray(existing.sshServers) && existing.sshServers.length > 0) {
      mergedSettings.sshServers = existing.sshServers;
    }

    // Never erase saved SSH passwords if incoming payload omits or sends empty password
    if (!newSettings.ssh?.password && existing.ssh?.password) {
      mergedSettings.ssh.password = existing.ssh.password;
    }
    if (mergedSettings.sshServers && Array.isArray(mergedSettings.sshServers)) {
      mergedSettings.sshServers = mergedSettings.sshServers.map(srv => {
        const prev = existing.sshServers?.find(e => e.id === srv.id || (e.host === srv.host && e.username === srv.username));
        if (!srv.password && prev?.password) {
          return { ...srv, password: prev.password };
        }
        return srv;
      });
    }

    // 1) Save to persistent user Application Support / AppData directory
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(mergedSettings, null, 2), 'utf8');

    // 2) Save to ~/.mantis_cr_hub/settings.json (User home directory permanent backup)
    try {
      if (!fs.existsSync(CLI_SETTINGS_DIR)) {
        fs.mkdirSync(CLI_SETTINGS_DIR, { recursive: true });
      }
      fs.writeFileSync(CLI_SETTINGS_FILE, JSON.stringify(mergedSettings, null, 2), 'utf8');
    } catch (cliErr) {
      console.warn('[CLI Settings Sync Warning]', cliErr.message);
    }

    // 3) Save to project data/settings.json if writable
    try {
      const projSettingsDir = path.join(ROOT_DIR, 'data');
      if (fs.existsSync(projSettingsDir)) {
        fs.writeFileSync(path.join(projSettingsDir, 'settings.json'), JSON.stringify(mergedSettings, null, 2), 'utf8');
      }
    } catch (projErr) {}

    console.log(`[Settings] Successfully persisted server settings to: ${SETTINGS_FILE}`);
    const activeServers = mergedSettings.sshServers || mergedSettings.ssh?.servers || (mergedSettings.ssh ? [mergedSettings.ssh] : []);
    if (activeServers.length > 0) {
      backgroundDiffIndexer.updateSSHConfig(activeServers);
    } else if (mergedSettings.ssh) {
      backgroundDiffIndexer.updateSSHConfig(mergedSettings.ssh);
    }
    if (mergedSettings.diffConcurrency) {
      backgroundDiffIndexer.setConcurrency(mergedSettings.diffConcurrency);
    }
    res.json({ ok: true, message: 'Settings saved and persisted successfully', settings: mergedSettings });
  } catch (err) {
    console.error('[Save Settings Error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 2. Get All CRs
app.get('/api/crs', (req, res) => {
  const { meta, crs } = getLocalDatabase();
  res.json({
    ok: true,
    meta,
    count: crs.length,
    crs
  });
});

// 3. Trigger Mantis Sync (Incremental Upsert)
app.post('/api/sync', async (req, res) => {
  try {
    const { mantisUrl = 'http://192.168.16.200' } = req.body || {};
    const result = await syncMantisData(mantisUrl);
    // Queue ONLY newly added or updated CRs for priority diff indexing
    const changed = result.changedCrs || [];
    if (changed.length > 0) {
      console.log(`[Sync] Queueing ${changed.length} newly added/updated CRs for background diff indexing`);
      backgroundDiffIndexer.queueUpdates(changed.slice(0, 100));
    }
    res.json({
      ok: true,
      message: 'Sync & Update completed successfully',
      meta: result.meta,
      count: result.crs.length
    });
  } catch (err) {
    console.error('[API Sync Error]', err.message);
    res.status(400).json({
      ok: false,
      error: err.message,
      details: 'Mantis 서버에 연결할 수 없습니다. 사내망(VPN 또는 회사 Wi-Fi) 연결 상태를 확인해주세요.'
    });
  }
});

// 4. Download / Export Portable Database File
// 4. Download / Export Database & Diff Cache Bundle (.zip) or Portable JSON
app.get('/api/database/export', (req, res) => {
  const format = req.query.format;
  // If explicitly requested single JSON format
  if (format === 'json') {
    if (fs.existsSync(DB_FILE)) {
      const filename = `cr_database_${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/json');
      return res.sendFile(DB_FILE);
    }
    return res.status(404).json({ ok: false, error: '데이터베이스 파일이 존재하지 않습니다.' });
  }

  // Default: Export Full DB & Diff Cache Bundle as single .zip package
  try {
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `mantis_db_diff_bundle_${timestamp}.zip`;
    const tmpZip = path.join(os.tmpdir(), `bundle_${Date.now()}.zip`);

    console.log(`[Export Bundle] Packaging DB & Diff Cache from ${DATA_DIR} into ${filename}...`);

    // Target files to package: cr_database.json, cr_meta.json, diff_cache/
    const cmd = process.platform === 'win32'
      ? `powershell -Command "Compress-Archive -Path '${path.join(DATA_DIR, 'cr_database.json')}','${path.join(DATA_DIR, 'cr_meta.json')}','${path.join(DATA_DIR, 'diff_cache')}' -DestinationPath '${tmpZip}' -CompressionLevel Fastest -Force"`
      : `cd "${DATA_DIR}" && zip -r -1 "${tmpZip}" cr_database.json cr_meta.json diff_cache/ > /dev/null`;

    exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (err) => {
      if (err || !fs.existsSync(tmpZip)) {
        console.error('[Export Bundle Error]', err);
        return res.status(500).json({ ok: false, error: `압축 생성 실패: ${err?.message || '알 수 없는 오류'}` });
      }

      const stat = fs.statSync(tmpZip);
      console.log(`[Export Bundle] Bundle created (${(stat.size / (1024 * 1024)).toFixed(2)} MB). Sending file...`);

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/zip');
      res.sendFile(tmpZip, (sendErr) => {
        try {
          if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
        } catch {}
      });
    });
  } catch (err) {
    console.error('[Export Bundle Error]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. Import Database File (JSON)
app.post('/api/database/import', (req, res) => {
  try {
    const { crs } = req.body;
    if (!crs || !Array.isArray(crs)) {
      return res.status(400).json({ ok: false, error: '유효한 CR 목록 데이터가 필요합니다.' });
    }
    const result = importDatabase(crs);
    initCacheIndex(true);
    res.json({
      ok: true,
      message: '데이터베이스 가져오기 및 병합이 완료되었습니다.',
      meta: result.meta,
      totalCount: result.totalCount
    });
  } catch (err) {
    console.error('[DB Import Error]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5.1 Import Full Bundle (.zip) or Raw Binary File Stream
app.post('/api/database/import-bundle', (req, res) => {
  const tmpUpload = path.join(os.tmpdir(), `upload_${Date.now()}.tmp`);
  const writeStream = fs.createWriteStream(tmpUpload);

  req.pipe(writeStream);

  writeStream.on('finish', () => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      // Check file magic number (zip starts with PK: 0x50, 0x4B)
      const headerBuf = Buffer.alloc(4);
      const fd = fs.openSync(tmpUpload, 'r');
      fs.readSync(fd, headerBuf, 0, 4, 0);
      fs.closeSync(fd);

      const isZip = headerBuf[0] === 0x50 && headerBuf[1] === 0x4B;

      if (isZip) {
        console.log(`[Import Bundle] Unzipping dataset bundle into ${DATA_DIR}...`);
        const unzipCmd = process.platform === 'win32'
          ? `powershell -Command "Expand-Archive -Path '${tmpUpload}' -DestinationPath '${DATA_DIR}' -Force"`
          : `unzip -o -q "${tmpUpload}" -d "${DATA_DIR}"`;

        exec(unzipCmd, { maxBuffer: 1024 * 1024 * 50 }, (unzipErr) => {
          try { if (fs.existsSync(tmpUpload)) fs.unlinkSync(tmpUpload); } catch {}

          if (unzipErr) {
            console.error('[Import Unzip Error]', unzipErr);
            return res.status(500).json({ ok: false, error: `압축 해제 실패: ${unzipErr.message}` });
          }

          // Reload DB and Cache Index
          const reloaded = reloadDatabase();
          initCacheIndex(true);
          backgroundDiffIndexer.allCrsProvider = () => getLocalDatabase().crs;

          const stats = getDiffCacheStats();
          console.log(`[Import Bundle] Success! Total CRs: ${reloaded.crs.length}, Cached diffs: ${stats.crCount}`);

          res.json({
            ok: true,
            isBundle: true,
            message: 'DB 및 Diff 캐시 번들이 성공적으로 복원되었습니다!',
            totalCount: reloaded.crs.length,
            cachedDiffs: stats.crCount,
            totalSize: stats.totalSizeFormatted
          });
        });
      } else {
        // Fallback: Parse as JSON
        const content = fs.readFileSync(tmpUpload, 'utf8');
        try { if (fs.existsSync(tmpUpload)) fs.unlinkSync(tmpUpload); } catch {}
        const parsed = JSON.parse(content);
        const crs = Array.isArray(parsed) ? parsed : parsed.crs;
        if (!Array.isArray(crs)) {
          return res.status(400).json({ ok: false, error: '유효한 JSON 또는 ZIP 번들 형식이 아닙니다.' });
        }
        const result = importDatabase(crs);
        initCacheIndex(true);
        res.json({
          ok: true,
          isBundle: false,
          message: '데이터베이스 가져오기 및 병합이 완료되었습니다.',
          meta: result.meta,
          totalCount: result.totalCount
        });
      }
    } catch (err) {
      try { if (fs.existsSync(tmpUpload)) fs.unlinkSync(tmpUpload); } catch {}
      console.error('[Import Error]', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  writeStream.on('error', (err) => {
    try { if (fs.existsSync(tmpUpload)) fs.unlinkSync(tmpUpload); } catch {}
    res.status(500).json({ ok: false, error: `업로드 스트림 오류: ${err.message}` });
  });
});

// 6. Get Single CR Detail
app.get('/api/cr/:id', async (req, res) => {
  const { crs } = getLocalDatabase();
  const idStr = String(req.params.id).padStart(7, '0');
  const numericId = parseInt(req.params.id, 10);

  const found = crs.find(c => c.crid === idStr || c.id === numericId);
  if (!found) {
    return res.status(404).json({ ok: false, error: 'CR not found' });
  }

  // If details not fetched yet, fetch on-demand from Mantis
  if (!found.detailsFetched) {
    try {
      const details = await fetchCRPageDetails(found.id);
      if (details) {
        found.details = details;
        found.detailsFetched = true;
      }
    } catch (e) {
      console.warn(`[Details Fetch Error for CR ${found.id}]`, e.message);
    }
  }

  // Find similar CRs
  const similar = crs.filter(c => {
    if (c.crid === found.crid) return false;
    let score = 0;
    if (found.module && c.module === found.module) score += 3;
    if (found.customer && c.customer === found.customer) score += 1;
    if (found.vob && c.vob === found.vob) score += 2;
    if (found.files && c.files && found.files.length > 0) {
      const common = found.files.filter(f => c.files.includes(f));
      score += common.length * 4;
    }
    return score >= 3;
  }).slice(0, 8);

  res.json({
    ok: true,
    cr: found,
    similar
  });
});

// 7. Aggregated Statistics
app.get('/api/stats', (req, res) => {
  const { crs } = getLocalDatabase();
  
  const byProject = {};
  const byStatus = {};
  const byCustomer = {};
  const byMonth = {};
  const fileCounts = {};
  const byReporter = {};

  crs.forEach(cr => {
    const p = cr.project || '기타';
    byProject[p] = (byProject[p] || 0) + 1;

    const s = cr.status || 'unknown';
    byStatus[s] = (byStatus[s] || 0) + 1;

    const c = cr.customer || '공통/미지정';
    byCustomer[c] = (byCustomer[c] || 0) + 1;

    if (cr.reporter) {
      byReporter[cr.reporter] = (byReporter[cr.reporter] || 0) + 1;
    }

    if (cr.dateSubmitted && cr.dateSubmitted.length >= 7) {
      const ym = cr.dateSubmitted.substring(0, 7);
      byMonth[ym] = (byMonth[ym] || 0) + 1;
    }

    (cr.files || []).forEach(file => {
      fileCounts[file] = (fileCounts[file] || 0) + 1;
    });
  });

  const topFiles = Object.entries(fileCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([file, count]) => ({ file, count }));

  const topReporters = Object.entries(byReporter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  res.json({
    ok: true,
    total: crs.length,
    byProject,
    byStatus,
    byCustomer,
    byMonth,
    topFiles,
    topReporters
  });
});

// 8. AI Natural Language Query
app.post('/api/ai/query', async (req, res) => {
  try {
    const { query, crs = [], config = {} } = req.body;
    const { crs: allCachedCrs } = getLocalDatabase();
    // Default to searching across all 7,734 records in database
    const contextCrs = (crs && crs.length >= 100) ? crs : allCachedCrs;

    const result = await processAiQuery({
      query: query || '',
      contextCrs,
      config
    });

    res.json({ ok: true, result });
  } catch (err) {
    console.error('[AI Query Error]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 8.4 AI Providers Availability & Health Checker
app.get('/api/ai/providers-status', async (req, res) => {
  try {
    const disk = loadDiskSettings()?.settings || {};
    const { forceRefresh, ...queryRest } = req.query || {};
    const aiConfig = { ...(disk.ai || {}), ...queryRest };
    const status = await getAIProvidersStatus(aiConfig, { forceRefresh: forceRefresh === 'true' });
    res.json({ ok: true, status });
  } catch (err) {
    console.error('[AI Providers Status Error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 8.5 AI Models Fetcher
app.get('/api/ai/models', async (req, res) => {
  const provider = req.query.provider;
  try {
    let models = [];

    if (provider === 'openai') {
      models = await getCodexModels();
    } else if (provider === 'gemini') {
      models = await getAntigravityModels();
    } else if (provider === 'claude') {
      models = await getClaudeModels();
    } else if (provider === 'omniroute') {
      models = await getOmniRouteModels(req.query.baseUrl, req.query.apiKey);
    }

    res.json({ ok: true, models });
  } catch (err) {
    console.error(`[AI Models Error - ${provider}]`, err.message);
    res.status(500).json({ ok: false, error: err.message, models: [] });
  }
});

// 9. ClearCase SSH Test Connection
app.post('/api/ssh/test', async (req, res) => {
  try {
    const { sshConfig } = req.body;
    const result = await testSSHConnection(sshConfig || {});
    res.json(result);
  } catch (err) {
    console.error('[SSH Test Error]', err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Helper to resolve all configured and requested SSH servers
function resolveAllSSHServers(reqServers, reqSsh) {
  const disk = loadDiskSettings()?.settings || {};
  const diskServers = disk.sshServers || disk.ssh?.servers || (disk.ssh ? [disk.ssh] : []);

  const rawList = [];
  if (Array.isArray(reqServers) && reqServers.length > 0) {
    rawList.push(...reqServers);
  } else if (reqSsh?.servers && Array.isArray(reqSsh.servers)) {
    rawList.push(...reqSsh.servers);
  } else if (reqSsh && reqSsh.host) {
    rawList.push(reqSsh);
  }
  rawList.push(...diskServers);

  const map = new Map();
  for (const s of rawList) {
    if (!s || !s.host || s.enabled === false) continue;
    const hostKey = `${s.host}:${s.port || 22}:${s.username || ''}`;
    if (!map.has(hostKey)) {
      map.set(hostKey, { ...s });
    } else {
      const existing = map.get(hostKey);
      if (!existing.password && s.password) {
        map.set(hostKey, { ...existing, ...s });
      }
    }
  }
  return Array.from(map.values());
}

// 10. ClearCase SSH File Diff
app.post('/api/ssh/diff', async (req, res) => {
  try {
    const { sshConfig, sshServers, filePath, checkinLog } = req.body;
    if (!filePath) {
      return res.status(400).json({ ok: false, error: '파일 경로가 필요합니다.' });
    }
    const servers = resolveAllSSHServers(sshServers, sshConfig);
    const result = await fetchFileDiffSSH(servers, filePath, checkinLog || '', { priority: 'vip' });
    res.json(result);
  } catch (err) {
    console.error('[SSH Diff Error]', err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 12. Local Diff Dataset & Cache APIs
app.get('/api/diff-cache/stats', (req, res) => {
  try {
    const stats = getDiffCacheStats();
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/diff-cache/worker-status', (req, res) => {
  try {
    const status = backgroundDiffIndexer.getStatus();
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/diff-cache/worker-control', (req, res) => {
  try {
    const { enabled, concurrency } = req.body;
    if (typeof concurrency === 'number') {
      backgroundDiffIndexer.setConcurrency(concurrency);
    }
    if (typeof enabled === 'boolean') {
      if (enabled) {
        backgroundDiffIndexer.resume();
      } else {
        backgroundDiffIndexer.pause();
      }
    }
    res.json({ ok: true, status: backgroundDiffIndexer.getStatus() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/diff-cache/:crid', (req, res) => {
  try {
    const { crid } = req.params;
    const cached = getCRDiffCache(crid);
    if (cached) {
      return res.json({ ok: true, cached: true, data: cached });
    }
    return res.json({ ok: true, cached: false, data: null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/diff-cache/fetch', async (req, res) => {
  try {
    const { cr, crid, sshConfig, sshServers } = req.body;
    const targetCrid = cr?.crid || crid;
    if (!targetCrid) {
      return res.status(400).json({ ok: false, error: 'CR 정보 또는 crid가 필요합니다.' });
    }

    // Check cache first
    const cached = getCRDiffCache(targetCrid);
    if (cached && cached.files && cached.files.length > 0) {
      return res.json({ ok: true, cached: true, data: cached });
    }

    let targetCR = cr;
    if (!targetCR || !targetCR.files) {
      const { crs } = getLocalDatabase();
      targetCR = crs.find(c => c.crid === targetCrid || String(c.id) === String(targetCrid));
    }

    if (!targetCR) {
      return res.status(404).json({ ok: false, error: `CR #${targetCrid}를 찾을 수 없습니다.` });
    }

    const servers = resolveAllSSHServers(sshServers, sshConfig);
    const fetched = await fetchAndCacheCRDiff(targetCR, servers);
    res.json({ ok: true, cached: false, data: fetched });
  } catch (err) {
    console.error('[Diff Cache Fetch Error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/diff-cache/batch', async (req, res) => {
  try {
    const { crids = [], maxFilesPerCR = 5, sshConfig, sshServers } = req.body;
    const { crs } = getLocalDatabase();
    const targetCRs = crids.length > 0 
      ? crs.filter(c => crids.includes(c.crid))
      : crs.slice(0, 50);

    const servers = resolveAllSSHServers(sshServers, sshConfig);
    const result = await batchIndexDiffs(targetCRs, servers, { maxFilesPerCR });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 13. AI Deep Diff Analysis APIs
app.post('/api/ai/analyze-cr-diff', async (req, res) => {
  try {
    const { cr, crid, sshConfig, sshServers, config = {} } = req.body;
    const targetCrid = cr?.crid || crid;
    
    let targetCR = cr;
    if (!targetCR) {
      const { crs } = getLocalDatabase();
      targetCR = crs.find(c => c.crid === targetCrid || String(c.id) === String(targetCrid));
    }
    if (!targetCR) {
      return res.status(404).json({ ok: false, error: `CR #${targetCrid}를 찾을 수 없습니다.` });
    }

    // Get diffs (from cache or SSH)
    let diffPayload = getCRDiffCache(targetCrid);
    if (!diffPayload) {
      const servers = resolveAllSSHServers(sshServers, sshConfig);
      if (servers.length > 0) {
        diffPayload = await fetchAndCacheCRDiff(targetCR, servers);
      }
    }

    const result = await analyzeSingleCRDiff({
      cr: targetCR,
      diffPayload,
      config
    });

    res.json({ ok: true, ...result, cached: !!getCRDiffCache(targetCrid) });
  } catch (err) {
    console.error('[AI Analyze CR Diff Error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/ai/compare-crs', async (req, res) => {
  try {
    const { crids = [], crs: providedCRs = [], sshConfig, sshServers, config = {} } = req.body;
    const { crs: allCachedCrs } = getLocalDatabase();

    const targetCRs = providedCRs.length > 0 
      ? providedCRs 
      : allCachedCrs.filter(c => crids.includes(c.crid));

    if (targetCRs.length < 2) {
      return res.status(400).json({ ok: false, error: '비교를 위해 최소 2개 이상의 CR이 필요합니다.' });
    }

    const servers = resolveAllSSHServers(sshServers, sshConfig);

    // Collect diffs for all selected CRs
    const diffMap = {};
    for (const cr of targetCRs) {
      let diffData = getCRDiffCache(cr.crid);
      if (!diffData && servers.length > 0) {
        try {
          diffData = await fetchAndCacheCRDiff(cr, servers, 5);
        } catch (e) {
          console.warn(`[Compare CRs] Failed to fetch diff for ${cr.crid}:`, e.message);
        }
      }
      diffMap[cr.crid] = diffData;
    }

    const result = await compareMultipleCRDiffs({
      crs: targetCRs,
      diffMap,
      config
    });

    res.json({ ok: true, ...result, diffMap });
  } catch (err) {
    console.error('[AI Compare CRs Error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Serve static frontend in production
console.log(`[Backend] Checking frontend distribution in: ${DIST_DIR}`);
if (fs.existsSync(DIST_DIR)) {
  console.log(`[Backend] Serving static frontend from: ${DIST_DIR}`);
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
} else {
  console.warn(`[Backend] Warning: Frontend dist directory not found at ${DIST_DIR}`);
}

let serverInstance = null;
let currentBoundPort = PORT;

export function getActivePort() {
  return currentBoundPort;
}

export function startServer(defaultPort = PORT) {
  if (serverInstance) return Promise.resolve({ server: serverInstance, port: currentBoundPort });

  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 10;

    function tryListen(p) {
      const server = app.listen(p, async () => {
        serverInstance = server;
        currentBoundPort = p;
        process.env.ACTIVE_PORT = String(p);
        console.log(`[Backend] Mantis CR API Server running on http://localhost:${p}`);
        console.log(`[Backend] Portable DB file location: ${DB_FILE}`);
        
        const { crs } = getLocalDatabase();
        if (crs.length === 0) {
          console.log('[Backend] DB is empty. Performing initial fetch from Mantis...');
          try {
            await syncMantisData('http://192.168.16.200');
          } catch (e) {
            console.warn('[Backend] Initial sync failed (will retry or manual sync):', e.message);
          }
        } else {
          console.log(`[Backend] Loaded ${crs.length} CRs from independent DB file.`);
        }

        // Initialize background diff indexer
        let initialSettings = null;
        if (fs.existsSync(SETTINGS_FILE)) {
          try {
            initialSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
          } catch(e) {}
        } else if (fs.existsSync(CLI_SETTINGS_FILE)) {
          try {
            initialSettings = JSON.parse(fs.readFileSync(CLI_SETTINGS_FILE, 'utf8'));
          } catch(e) {}
        }
        const initServers = initialSettings?.sshServers || initialSettings?.ssh?.servers || (initialSettings?.ssh ? [initialSettings.ssh] : []);
        backgroundDiffIndexer.init(
          () => getLocalDatabase().crs, 
          initServers.length > 0 ? initServers : initialSettings?.ssh,
          initialSettings?.diffConcurrency
        );

        resolve({ server, port: p });
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
          attempts++;
          const nextPort = p + 1;
          console.warn(`[Backend] Port ${p} is in use (EADDRINUSE). Retrying on port ${nextPort}...`);
          tryListen(nextPort);
        } else {
          console.error('[Backend Server Error]', err);
          serverInstance = null;
          reject(err);
        }
      });
    }

    tryListen(defaultPort);
  });
}

export function stopServer() {
  return new Promise((resolve) => {
    try { sshPool.destroyAll(); } catch (e) {}
    if (!serverInstance) return resolve();
    serverInstance.close(() => {
      console.log('[Backend] Server stopped successfully.');
      serverInstance = null;
      resolve();
    });
  });
}

// Auto-start only when run directly (e.g., `node server/index.js`)
// When imported by Electron via `import('../server/index.js')`, Electron calls startServer() manually.
// process.argv[1] points to the entry file; compare using file URL to be platform-safe (handles Windows backslashes too).
const _isDirectRun = (() => {
  try {
    const entryUrl = new URL('file://' + process.argv[1].replace(/\\/g, '/')).href;
    return import.meta.url === entryUrl;
  } catch {
    return false;
  }
})();

if (_isDirectRun) {
  startServer(PORT).catch((err) => {
    console.warn('[Backend] Direct-run auto-start note:', err.message);
  });
}
