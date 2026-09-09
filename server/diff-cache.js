import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchFileDiffSSH } from './ssh.js';
import { DATA_DIR } from './sync.js';

export const DIFF_CACHE_DIR = path.join(DATA_DIR, 'diff_cache');

// Ensure diff_cache directory exists in writable location
if (!fs.existsSync(DIFF_CACHE_DIR)) {
  try {
    fs.mkdirSync(DIFF_CACHE_DIR, { recursive: true });
  } catch (e) {
    console.warn('[DiffCache] Warning creating diff cache dir:', e.message);
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
 * Get cached diffs for a CR from local disk (0ms)
 */
export function getCRDiffCache(crid) {
  const filePath = getCacheFilePath(crid);
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      console.warn(`[DiffCache] Corrupted cache for CR #${crid}:`, e.message);
      return null;
    }
  }
  return null;
}

/**
 * Save diffs for a CR to local disk
 */
export function saveCRDiffCache(crid, diffData) {
  const filePath = getCacheFilePath(crid);
  try {
    fs.writeFileSync(filePath, JSON.stringify(diffData, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`[DiffCache] Failed to write cache for CR #${crid}:`, e.message);
    return false;
  }
}

/**
 * Fetch and cache diffs for a CR using SSH
 */
export async function fetchAndCacheCRDiff(cr, sshConfig, maxFiles = 10) {
  if (!cr || !cr.crid) return null;
  const crid = cr.crid;

  // 1. Check existing cache
  const cached = getCRDiffCache(crid);
  if (cached && cached.files && cached.files.length > 0) {
    return cached;
  }

  if (!sshConfig || !sshConfig.host) {
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
    try {
      const diffRes = await fetchFileDiffSSH(sshConfig, filePath, checkinLog);
      results.push({
        fileName,
        filePath,
        status: diffRes.ok ? 'success' : 'error',
        hasChanges: diffRes.hasChanges || false,
        error: diffRes.error || null,
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
 * Get global stats about local diff cache
 */
export function getDiffCacheStats() {
  if (!fs.existsSync(DIFF_CACHE_DIR)) {
    return { crCount: 0, totalFiles: 0, totalSizeBytes: 0 };
  }

  const entries = fs.readdirSync(DIFF_CACHE_DIR);
  const jsonFiles = entries.filter(f => f.endsWith('.json'));

  let totalSizeBytes = 0;
  let totalFiles = 0;

  for (const f of jsonFiles) {
    try {
      const fullPath = path.join(DIFF_CACHE_DIR, f);
      const stat = fs.statSync(fullPath);
      totalSizeBytes += stat.size;

      const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      if (content.files && Array.isArray(content.files)) {
        totalFiles += content.files.length;
      }
    } catch (e) {
      // skip
    }
  }

  return {
    crCount: jsonFiles.length,
    totalFiles,
    totalSizeBytes,
    totalSizeFormatted: `${(totalSizeBytes / (1024 * 1024)).toFixed(2)} MB`
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
    this.enabled = true; // User preference (default ON)
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
    const progressPercent = Math.min(100, (stats.crCount / totalTargetCount) * 100);
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
      cachedCRs: stats.crCount,
      totalFiles: stats.totalFiles,
      totalSizeBytes: stats.totalSizeBytes,
      totalSizeFormatted: stats.totalSizeFormatted,
      percentage: Number(progressPercent.toFixed(1)),
      lastProcessedAt: this.lastProcessedAt,
      lastError: this.lastError
    };
  }

  _pickNextCR(allCrs) {
    // 1. Check priority queue first
    while (this.priorityQueue.length > 0) {
      const priorityId = this.priorityQueue.shift();
      if (!this.activeCrids.has(priorityId)) {
        const cr = allCrs.find(c => c.crid === priorityId);
        if (cr) return cr;
      }
    }

    // 2. Find next un-cached CR with files not currently in activeCrids
    for (const cr of allCrs) {
      if (!cr.files || cr.files.length === 0) continue;
      if (this.activeCrids.has(cr.crid)) continue;
      const cached = getCRDiffCache(cr.crid);
      if (!cached || !cached.files || cached.files.length === 0) {
        return cr;
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

      if (!this.sshConfig || !this.sshConfig.host || this.sshConfig.enabled === false) {
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
      while (this.isRunning && this.enabled && this.activeWorkers < this.concurrency) {
        const targetCR = this._pickNextCR(allCrs);
        if (!targetCR) {
          break; // No eligible CRs to dispatch at this moment
        }
        // Launch worker in background (unawaited) so other workers can start concurrently
        this._processCRWorker(targetCR);
      }

      if (this.activeWorkers === 0) {
        const anyRemaining = allCrs.some(cr => {
          if (!cr.files || cr.files.length === 0) return false;
          const cached = getCRDiffCache(cr.crid);
          return (!cached || !cached.files || cached.files.length === 0);
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
