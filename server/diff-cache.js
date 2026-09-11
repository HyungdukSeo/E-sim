import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchFileDiffSSH } from './ssh.js';
import { sshPool } from './ssh-pool.js';
import { DATA_DIR, ROOT_DIR } from './sync.js';

export const DIFF_CACHE_DIR = path.join(DATA_DIR, 'diff_cache');

// Ensure diff_cache directory exists in writable location
if (!fs.existsSync(DIFF_CACHE_DIR)) {
  try {
    fs.mkdirSync(DIFF_CACHE_DIR, { recursive: true });
  } catch (e) {
    console.warn('[DiffCache] Warning creating diff cache dir:', e.message);
  }
}

// In-Memory Fast Cache Index (crid -> { sizeBytes, cachedAt, fileCount, mtimeMs })
const cacheIndex = new Map();
let totalCachedFiles = 0;
let totalCachedBytes = 0;
let isIndexInitialized = false;

export function initCacheIndex(forceReset = false) {
  if (isIndexInitialized && !forceReset) return;
  isIndexInitialized = true;
  cacheIndex.clear();
  totalCachedFiles = 0;
  totalCachedBytes = 0;
  if (!fs.existsSync(DIFF_CACHE_DIR)) return;

  try {
    const files = fs.readdirSync(DIFF_CACHE_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const crid = f.slice(0, -5);
      const fullPath = path.join(DIFF_CACHE_DIR, f);
      try {
        const stat = fs.statSync(fullPath);
        cacheIndex.set(crid, {
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
          cachedAt: new Date(stat.mtimeMs).toISOString()
        });
        totalCachedBytes += stat.size;
      } catch (e) {}
    }
  } catch (err) {
    console.warn('[DiffCache] Error initializing cache index:', err.message);
  }
}

const BINARY_EXTS = new Set([
  '.exe', '.o', '.a', '.so', '.dll', '.tar', '.gz', '.zip', 
  '.class', '.jar', '.png', '.jpg', '.jpeg', '.gif', '.pdf', 
  '.bin', '.dat'
]);

function getCacheFilePath(crid) {
  const safeId = String(crid).trim().replace(/[^a-zA-Z0-9_\-]/g, '');
  return path.join(DIFF_CACHE_DIR, `${safeId}.json`);
}

/**
 * Check if a CR has cached diff in memory (0ms, 0 disk I/O)
 */
export function hasCRDiffCache(crid) {
  if (!isIndexInitialized) initCacheIndex();
  const safeId = String(crid).trim().replace(/[^a-zA-Z0-9_\-]/g, '');
  return cacheIndex.has(safeId);
}

/**
 * Get cached diffs for a CR from local disk
 */
export function getCRDiffCache(crid) {
  if (!isIndexInitialized) initCacheIndex();
  const safeId = String(crid).trim().replace(/[^a-zA-Z0-9_\-]/g, '');

  let filePath = path.join(DIFF_CACHE_DIR, `${safeId}.json`);
  if (!fs.existsSync(filePath) && ROOT_DIR) {
    const fallback = path.join(ROOT_DIR, 'data', 'diff_cache', `${safeId}.json`);
    if (fs.existsSync(fallback)) {
      filePath = fallback;
    }
  }
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      // Keep index updated
      if (parsed.cachedAt) {
        cacheIndex.set(safeId, {
          sizeBytes: Buffer.byteLength(content),
          fileCount: (parsed.files || []).length,
          cachedAt: parsed.cachedAt
        });
      }
      return parsed;
    } catch (e) {
      console.warn(`[DiffCache] Corrupted cache for CR #${crid}:`, e.message);
      return null;
    }
  }
  return null;
}

/**
 * Save diffs for a CR to local disk (Asynchronous write + In-Memory Index update)
 */
export function saveCRDiffCache(crid, diffData) {
  if (!isIndexInitialized) initCacheIndex();
  const safeId = String(crid).trim().replace(/[^a-zA-Z0-9_\-]/g, '');
  const filePath = path.join(DIFF_CACHE_DIR, `${safeId}.json`);

  try {
    const jsonStr = JSON.stringify(diffData);
    const sizeBytes = Buffer.byteLength(jsonStr, 'utf8');
    const fileCount = Array.isArray(diffData.files) ? diffData.files.length : 0;

    // Asynchronous non-blocking write to avoid freezing the Node event loop
    fs.writeFile(filePath, jsonStr, 'utf8', (err) => {
      if (err) console.error(`[DiffCache] Async write error for CR #${crid}:`, err.message);
    });

    // Immediate in-memory index update (0ms availability for all subsequent queries)
    const existing = cacheIndex.get(safeId);
    if (existing) {
      totalCachedBytes -= (existing.sizeBytes || 0);
      totalCachedFiles -= (existing.fileCount || 0);
    }
    cacheIndex.set(safeId, {
      sizeBytes,
      fileCount,
      cachedAt: diffData.cachedAt || new Date().toISOString()
    });
    totalCachedBytes += sizeBytes;
    totalCachedFiles += fileCount;
    return true;
  } catch (e) {
    console.error(`[DiffCache] Failed to write cache for CR #${crid}:`, e.message);
    return false;
  }
}

/**
 * Fetch and cache diffs for a CR using SSH
 */
export async function fetchAndCacheCRDiff(cr, sshConfig, maxFiles = 10, forceRefresh = false) {
  if (!cr || !cr.crid) return null;
  const crid = cr.crid;

  // 1. Check existing cache
  const cached = getCRDiffCache(crid);
  if (cached && cached.files && cached.files.length > 0 && !forceRefresh) {
    let isStale = false;
    // Check if CR was modified in Mantis after cachedAt
    if (cr.lastUpdated && cached.cachedAt) {
      const crTime = new Date(cr.lastUpdated).getTime();
      const cacheTime = new Date(cached.cachedAt).getTime();
      if (!isNaN(crTime) && !isNaN(cacheTime) && crTime > cacheTime) {
        isStale = true;
      }
    }
    // Check if file count changed
    const crFileCount = (cr.files || []).length;
    const cachedFileCount = (cached.files || []).length;
    if (crFileCount > 0 && crFileCount !== cachedFileCount) {
      isStale = true;
    }

    if (!isStale) {
      return cached;
    }
    console.log(`[DiffCache] CR #${crid} is modified or has updated files. Auto-refreshing diff cache...`);
  }

  let servers = Array.isArray(sshConfig) 
    ? sshConfig 
    : (sshConfig?.servers || (sshConfig?.host ? [sshConfig] : []));

  // Also include backgroundDiffIndexer servers if available to guarantee multi-server coverage
  if (backgroundDiffIndexer?.sshConfig) {
    const bgServers = Array.isArray(backgroundDiffIndexer.sshConfig)
      ? backgroundDiffIndexer.sshConfig
      : (backgroundDiffIndexer.sshConfig?.servers || (backgroundDiffIndexer.sshConfig?.host ? [backgroundDiffIndexer.sshConfig] : []));
    servers = [...servers, ...bgServers];
  }

  // Deduplicate servers by host:port:username
  const serverMap = new Map();
  for (const s of servers) {
    if (!s || !s.host || s.enabled === false) continue;
    const key = `${s.host}:${s.port || 22}:${s.username || ''}`;
    if (!serverMap.has(key)) {
      serverMap.set(key, { ...s });
    } else {
      const ex = serverMap.get(key);
      if (!ex.password && s.password) serverMap.set(key, { ...ex, ...s });
    }
  }
  const validServers = Array.from(serverMap.values());

  if (validServers.length === 0) {
    throw new Error('SSH 설정이 구성되지 않아 ClearCase 서버에서 소스코드를 가져올 수 없습니다.');
  }

  const files = cr.files || [];
  const filePaths = cr.filePaths || [];
  const checkinLog = cr.checkinLog || '';

  const results = [];
  let processed = 0;

  for (let i = 0; i < files.length; i++) {
    if (processed >= maxFiles) break;

    const fileName = files[i];
    const filePath = filePaths[i] || fileName;

    const ext = fileName.includes('.') 
      ? fileName.substring(fileName.lastIndexOf('.')).toLowerCase() 
      : '';
    if (BINARY_EXTS.has(ext)) continue;

    processed++;
    if (sshPool.isUserActive()) {
      await new Promise(res => setTimeout(res, 1200)); // Momentarily yield to interactive user requests
    }
    // Yield to Node.js event loop before starting next diff
    await new Promise(res => setImmediate(res));

    try {
      const diffRes = await fetchFileDiffSSH(validServers, filePath, checkinLog, { priority: 'background' });
      results.push({
        fileName,
        filePath,
        status: diffRes.ok ? 'success' : 'error',
        hasChanges: diffRes.hasChanges || false,
        error: diffRes.error || null,
        serverHost: diffRes.serverHost || null,
        serverName: diffRes.serverName || null,
        oldVersion: diffRes.oldVersion || '',
        newVersion: diffRes.newVersion || '',
        unifiedDiff: diffRes.unifiedDiff || '',
        fetchedAt: new Date().toISOString()
      });
    } catch (err) {
      results.push({
        fileName,
        filePath,
        status: 'error',
        hasChanges: false,
        error: err.message,
        unifiedDiff: '',
        fetchedAt: new Date().toISOString()
      });
    }
  }

  const cachePayload = {
    crid,
    summary: cr.summary || '',
    cleanSummary: cr.cleanSummary || cr.summary || '',
    module: cr.module || '',
    customer: cr.customer || '',
    cachedAt: new Date().toISOString(),
    fileCount: results.length,
    files: results
  };

  saveCRDiffCache(crid, cachePayload);
  return cachePayload;
}

/**
 * Get global stats about local diff cache (0ms in-memory query, 0 sync disk I/O)
 */
export function getDiffCacheStats() {
  if (!isIndexInitialized) initCacheIndex();
  return {
    crCount: cacheIndex.size,
    totalFiles: totalCachedFiles || (cacheIndex.size * 3),
    totalSizeBytes: totalCachedBytes,
    totalSizeFormatted: `${(totalCachedBytes / (1024 * 1024)).toFixed(2)} MB`
  };
}

/**
 * Batch prefetch diffs for a list of CRs
 */
export async function batchIndexDiffs(crs, sshConfig, options = {}) {
  const { maxCRs = 50, maxFilesPerCR = 5, onProgress } = options;
  const targets = crs.slice(0, maxCRs);

  let successCount = 0;
  let skippedCount = 0;
  let failCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const cr = targets[i];
    const cached = getCRDiffCache(cr.crid);
    if (cached && cached.files && cached.files.length > 0) {
      skippedCount++;
      if (onProgress) onProgress({ current: i + 1, total: targets.length, crid: cr.crid, status: 'cached' });
      continue;
    }

    try {
      await fetchAndCacheCRDiff(cr, sshConfig, maxFilesPerCR);
      successCount++;
      if (onProgress) onProgress({ current: i + 1, total: targets.length, crid: cr.crid, status: 'success' });
    } catch (err) {
      failCount++;
      if (onProgress) onProgress({ current: i + 1, total: targets.length, crid: cr.crid, status: 'fail', error: err.message });
    }
  }

  return {
    total: targets.length,
    successCount,
    skippedCount,
    failCount
  };
}

/**
 * Background Automatic Diff Indexer Service
 * High-performance concurrent worker pool (up to 10 workers) for parallel diff collection
 */
class BackgroundDiffIndexer {
  constructor() {
    this.enabled = false; // User preference (default OFF — user opts in via Settings)
    this.isRunning = false;
    this.status = 'idle'; // 'idle' | 'running' | 'completed' | 'paused' | 'waiting_ssh'
    this.concurrency = 3; // 1 ~ 10 parallel workers (default 3)
    this.activeWorkers = 0;
    this.activeCrids = new Set(); // Currently processing CR IDs
    this.priorityQueue = []; // CR IDs to process immediately (e.g. newly synced CRs)
    this.sshConfig = null;
    this.lastError = null;
    this.lastProcessedAt = null;
    this.processedCount = 0;
    this.allCrsProvider = null;
  }

  setConcurrency(val) {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 1 && num <= 10) {
      this.concurrency = num;
      console.log(`[BackgroundDiffIndexer] Concurrency set to ${this.concurrency} parallel workers`);
    }
  }

  init(allCrsProvider, sshConfig, initialConcurrency) {
    this.allCrsProvider = allCrsProvider;
    this.sshConfig = sshConfig;
    if (initialConcurrency) {
      this.setConcurrency(initialConcurrency);
    }
    if (this.enabled) {
      this.start();
    }
  }

  updateSSHConfig(sshConfig) {
    this.sshConfig = sshConfig;
  }

  queuePriority(crid) {
    if (!this.priorityQueue.includes(crid)) {
      this.priorityQueue.unshift(crid);
    }
  }

  queueUpdates(crList) {
    if (!Array.isArray(crList)) return;
    for (const cr of crList) {
      const crid = cr?.crid || cr;
      if (crid && !this.priorityQueue.includes(crid)) {
        this.priorityQueue.push(crid);
      }
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.enabled = true;
    this._runLoop();
  }

  pause() {
    this.enabled = false;
    this.status = 'paused';
  }

  resume() {
    this.enabled = true;
    if (!this.isRunning) {
      this.start();
    }
  }

  getStatus() {
    const stats = getDiffCacheStats();
    const allCrs = typeof this.allCrsProvider === 'function' ? this.allCrsProvider() : [];
    const crsWithFiles = allCrs.filter(c => c.files && c.files.length > 0);
    const totalTargetCount = crsWithFiles.length || allCrs.length || 1;

    // Accurately count cached CRs that belong to current target CRs with files
    let cachedTargetCRs = 0;
    for (const cr of crsWithFiles) {
      if (hasCRDiffCache(cr.crid)) {
        cachedTargetCRs++;
      }
    }

    const progressPercent = Math.min(100, (cachedTargetCRs / totalTargetCount) * 100);
    const activeList = Array.from(this.activeCrids);

    return {
      enabled: this.enabled,
      status: this.status,
      concurrency: this.concurrency,
      activeWorkers: this.activeWorkers,
      activeCrids: activeList,
      currentCrid: activeList.length > 0 ? activeList.join(', ') : null,
      totalCRs: allCrs.length,
      targetCRsWithFiles: crsWithFiles.length,
      cachedCRs: cachedTargetCRs,
      totalFiles: stats.totalFiles,
      totalSizeBytes: stats.totalSizeBytes,
      totalSizeFormatted: stats.totalSizeFormatted,
      percentage: Number(progressPercent.toFixed(1)),
      lastProcessedAt: this.lastProcessedAt,
      lastError: this.lastError
    };
  }

  _pickNextCR(allCrs) {
    if (!isIndexInitialized) initCacheIndex();

    // 1. Check priority queue first
    while (this.priorityQueue.length > 0) {
      const priorityId = this.priorityQueue.shift();
      if (!this.activeCrids.has(priorityId)) {
        const cr = allCrs.find(c => c.crid === priorityId);
        if (cr) return cr;
      }
    }

    // 2. Find next un-cached or modified/stale CR with files not currently in activeCrids
    for (const cr of allCrs) {
      if (!cr.files || cr.files.length === 0) continue;
      if (this.activeCrids.has(cr.crid)) continue;
      const safeId = String(cr.crid).trim().replace(/[^a-zA-Z0-9_\-]/g, '');
      const meta = cacheIndex.get(safeId);

      // If not cached in memory, pick immediately! (0ms, 0 disk I/O)
      if (!meta) {
        return cr;
      }

      // Check if stale (Mantis lastUpdated > cachedAt)
      if (cr.lastUpdated && meta.cachedAt) {
        const crTime = new Date(cr.lastUpdated).getTime();
        const cacheTime = new Date(meta.cachedAt).getTime();
        if (!isNaN(crTime) && !isNaN(cacheTime) && crTime > cacheTime) {
          return cr;
        }
      }
    }
    return null;
  }

  async _processCRWorker(targetCR) {
    const crid = targetCR.crid;
    this.activeWorkers++;
    this.activeCrids.add(crid);
    this.status = 'running';

    try {
      // Yield to event loop
      await new Promise(res => setImmediate(res));
      await fetchAndCacheCRDiff(targetCR, this.sshConfig, 8);
      this.processedCount++;
      this.lastProcessedAt = new Date().toISOString();
      this.lastError = null;
    } catch (err) {
      this.lastError = `CR #${crid}: ${err.message}`;
      console.warn(`[BackgroundDiffIndexer] Error caching #${crid}:`, err.message);
    } finally {
      this.activeCrids.delete(crid);
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      await new Promise(res => setImmediate(res));
    }
  }

  async _runLoop() {
    const sleep = (ms) => new Promise(res => setTimeout(res, ms));

    while (this.isRunning) {
      if (!this.enabled) {
        this.status = 'paused';
        await sleep(1000);
        continue;
      }

      // Yield if user is actively interacting with UI (clicking, viewing diffs)
      if (sshPool.isUserActive()) {
        await sleep(1000);
        continue;
      }

      const servers = Array.isArray(this.sshConfig) 
        ? this.sshConfig 
        : (this.sshConfig?.servers || (this.sshConfig?.host ? [this.sshConfig] : []));
      const hasValidServer = servers.some(s => s && s.host && s.enabled !== false);
      if (!hasValidServer) {
        this.status = 'waiting_ssh';
        await sleep(2500);
        continue;
      }

      const allCrs = typeof this.allCrsProvider === 'function' ? this.allCrsProvider() : [];
      if (!allCrs || allCrs.length === 0) {
        this.status = 'idle';
        await sleep(3000);
        continue;
      }

      // Dispatch parallel workers up to concurrency limit
      while (this.isRunning && this.enabled && this.activeWorkers < this.concurrency && !sshPool.isUserActive()) {
        const targetCR = this._pickNextCR(allCrs);
        if (!targetCR) {
          break; // No eligible CRs to dispatch at this moment
        }
        // Launch worker in background (unawaited) so other workers can start concurrently
        this._processCRWorker(targetCR);
        // Micro-yield between dispatches so the event loop remains ultra responsive
        await new Promise(res => setImmediate(res));
      }

      if (this.activeWorkers === 0) {
        const anyRemaining = allCrs.some(cr => {
          if (!cr.files || cr.files.length === 0) return false;
          const safeId = String(cr.crid).trim().replace(/[^a-zA-Z0-9_\-]/g, '');
          return !cacheIndex.has(safeId);
        });

        if (!anyRemaining && this.priorityQueue.length === 0) {
          this.status = 'completed';
        } else {
          this.status = 'idle';
        }
      } else {
        this.status = 'running';
      }

      await sleep(600);
    }
  }
}

export const backgroundDiffIndexer = new BackgroundDiffIndexer();
