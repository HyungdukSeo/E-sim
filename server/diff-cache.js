import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchFileDiffSSH } from './ssh.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIFF_CACHE_DIR = path.resolve(__dirname, '../data/diff_cache');

// Ensure diff_cache directory exists
if (!fs.existsSync(DIFF_CACHE_DIR)) {
  fs.mkdirSync(DIFF_CACHE_DIR, { recursive: true });
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
