import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { syncMantisData, getLocalDatabase, importDatabase, fetchCRPageDetails, DB_FILE, META_FILE, DATA_DIR } from './sync.js';
import { processAiQuery } from './ai.js';
import { testSSHConnection, fetchFileDiffSSH } from './ssh.js';
import { getClaudeModels, getAntigravityModels, getCodexModels } from './cli-models.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
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
    const { sshConfig, filePath, checkinLog } = req.body;
    if (!filePath) {
      return res.status(400).json({ ok: false, error: '파일 경로가 필요합니다.' });
    }
    const result = await fetchFileDiffSSH(sshConfig || {}, filePath, checkinLog || '');
    res.json(result);
  } catch (err) {
    console.error('[SSH Diff Error]', err.message);
    res.status(400).json({ ok: false, error: err.message });
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
