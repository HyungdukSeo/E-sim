import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { syncMantisData, getLocalDatabase, importDatabase, fetchCRPageDetails, DB_FILE, META_FILE, DATA_DIR } from './sync.js';
import { processAiQuery, analyzeSingleCRDiff, compareMultipleCRDiffs } from './ai.js';
import { testSSHConnection, fetchFileDiffSSH } from './ssh.js';
import { getClaudeModels, getAntigravityModels, getCodexModels, getOmniRouteModels } from './cli-models.js';
import { getCRDiffCache, saveCRDiffCache, fetchAndCacheCRDiff, getDiffCacheStats, batchIndexDiffs, backgroundDiffIndexer } from './diff-cache.js';

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

// 1. Status endpoint
app.get('/api/status', (req, res) => {
  const { meta, crs } = getLocalDatabase();
  res.json({
    ok: true,
    meta,
    totalCount: crs.length,
    dbFilePath: DB_FILE
  });
});

// 1.5 Get Settings from local disk
app.get('/api/settings', (req, res) => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return res.json({ ok: true, settings: data });
    }
    if (fs.existsSync(CLI_SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(CLI_SETTINGS_FILE, 'utf8'));
      return res.json({ ok: true, settings: data });
    }
    res.json({ ok: true, settings: null });
  } catch (err) {
    console.error('[Get Settings Error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1.6 Save Settings to local disk
app.post('/api/settings', (req, res) => {
  try {
    const settings = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid settings object' });
    }

    // 1) Save to project data/settings.json
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');

    // 2) Also save to ~/.mantis_cr_hub/settings.json for CLI compatibility
    try {
      if (!fs.existsSync(CLI_SETTINGS_DIR)) {
        fs.mkdirSync(CLI_SETTINGS_DIR, { recursive: true });
      }
      fs.writeFileSync(CLI_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    } catch (cliErr) {
      console.warn('[CLI Settings Sync Warning]', cliErr.message);
    }

    console.log(`[Settings] Saved to local disk: ${SETTINGS_FILE}`);
    const activeServers = settings.sshServers || settings.ssh?.servers || (settings.ssh ? [settings.ssh] : []);
    if (activeServers.length > 0) {
      backgroundDiffIndexer.updateSSHConfig(activeServers);
    } else if (settings.ssh) {
      backgroundDiffIndexer.updateSSHConfig(settings.ssh);
    }
    if (settings.diffConcurrency) {
      backgroundDiffIndexer.setConcurrency(settings.diffConcurrency);
    }
    res.json({ ok: true, message: 'Settings saved to local disk successfully' });
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
    // Queue newly synced CRs for priority diff indexing
    if (result.crs && result.crs.length > 0) {
      backgroundDiffIndexer.queueUpdates(result.crs.slice(0, 100));
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
app.get('/api/database/export', (req, res) => {
  if (fs.existsSync(DB_FILE)) {
    const filename = `cr_database_${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(DB_FILE);
  } else {
    res.status(404).json({ ok: false, error: '데이터베이스 파일이 존재하지 않습니다.' });
  }
});

// 5. Import Database File
app.post('/api/database/import', (req, res) => {
  try {
    const { crs } = req.body;
    if (!crs || !Array.isArray(crs)) {
      return res.status(400).json({ ok: false, error: '유효한 CR 목록 데이터가 필요합니다.' });
    }
    const result = importDatabase(crs);
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

// 10. ClearCase SSH File Diff
app.post('/api/ssh/diff', async (req, res) => {
  try {
    const { sshConfig, sshServers, filePath, checkinLog } = req.body;
    if (!filePath) {
      return res.status(400).json({ ok: false, error: '파일 경로가 필요합니다.' });
    }
    const servers = sshServers || sshConfig?.servers || (sshConfig ? [sshConfig] : []);
    const result = await fetchFileDiffSSH(servers, filePath, checkinLog || '');
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
    const { cr, crid, sshConfig } = req.body;
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

    const servers = sshServers || sshConfig?.servers || (sshConfig ? [sshConfig] : []);
    const fetched = await fetchAndCacheCRDiff(targetCR, servers);
    res.json({ ok: true, cached: false, data: fetched });
  } catch (err) {
    console.error('[Diff Cache Fetch Error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/diff-cache/batch', async (req, res) => {
  try {
    const { crids = [], maxFilesPerCR = 5, sshConfig } = req.body;
    const { crs } = getLocalDatabase();
    const targetCRs = crids.length > 0 
      ? crs.filter(c => crids.includes(c.crid))
      : crs.slice(0, 50);

    const result = await batchIndexDiffs(targetCRs, sshConfig, { maxFilesPerCR });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 13. AI Deep Diff Analysis APIs
app.post('/api/ai/analyze-cr-diff', async (req, res) => {
  try {
    const { cr, crid, sshConfig, config = {} } = req.body;
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
    if (!diffPayload && sshConfig && sshConfig.host) {
      diffPayload = await fetchAndCacheCRDiff(targetCR, sshConfig);
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
    const { crids = [], crs: providedCRs = [], sshConfig, config = {} } = req.body;
    const { crs: allCachedCrs } = getLocalDatabase();

    const targetCRs = providedCRs.length > 0 
      ? providedCRs 
      : allCachedCrs.filter(c => crids.includes(c.crid));

    if (targetCRs.length < 2) {
      return res.status(400).json({ ok: false, error: '비교를 위해 최소 2개 이상의 CR이 필요합니다.' });
    }

    // Collect diffs for all selected CRs
    const diffMap = {};
    for (const cr of targetCRs) {
      let diffData = getCRDiffCache(cr.crid);
      if (!diffData && sshConfig && sshConfig.host) {
        try {
          diffData = await fetchAndCacheCRDiff(cr, sshConfig, 5);
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
