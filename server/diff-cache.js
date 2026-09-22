import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';
import { fetchFileDiffSSH } from './ssh.js';
import { sshPool } from './ssh-pool.js';
import { DATA_DIR, ROOT_DIR } from './sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A cache file below this size is parsed inline (JSON.parse cost is trivial
// enough that spinning up a worker round-trip would be pure overhead).
// Above it, parsing happens on the dedicated worker thread below so a
// large CR's multi-second JSON.parse never blocks the main event loop —
// see json-parse-worker.js for why this matters.
const WORKER_PARSE_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5MB

let jsonParseWorker = null;
let workerRequestId = 0;
const pendingWorkerRequests = new Map();

function getJsonParseWorker() {
  if (jsonParseWorker) return jsonParseWorker;
  jsonParseWorker = new Worker(path.join(__dirname, 'json-parse-worker.js'));
  jsonParseWorker.on('message', (msg) => {
    const pending = pendingWorkerRequests.get(msg.id);
    if (!pending) return;
    pendingWorkerRequests.delete(msg.id);
    if (msg.ok) pending.resolve(msg);
    else pending.reject(new Error(msg.error));
  });
  jsonParseWorker.on('error', (err) => {
    // Fail every in-flight request rather than hanging forever, then let the
    // next call spin up a fresh worker.
    for (const pending of pendingWorkerRequests.values()) pending.reject(err);
    pendingWorkerRequests.clear();
    jsonParseWorker = null;
  });
  jsonParseWorker.unref(); // Don't keep the process alive just for this worker
  return jsonParseWorker;
}

/**
 * Spin up the parse/stringify worker threads immediately at server startup
 * instead of lazily on the first large-cache read. Spawning a worker_thread
 * (loading its module, starting its own V8 isolate) is itself a real cost —
 * on Windows in this environment, on the order of several seconds — so
 * paying it once during startup means the first real request that happens
 * to hit a large CR isn't also stuck waiting for the worker to come up.
 */
export function prewarmDiffCacheWorkers() {
  try { getJsonParseWorker(); } catch (e) {}
  try { getJsonStringifyWorker(); } catch (e) {}
}

// Parse a JSON file off the main thread. Falls back to inline sync parsing
// if the worker itself fails to start (e.g. sandboxed/restricted environment)
// so a worker_threads issue never turns into a total cache-read failure.
function parseJsonFileOffThread(filePath) {
  return new Promise((resolve) => {
    let settled = false;
    const finishInline = () => {
      if (settled) return;
      settled = true;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        resolve({ ok: true, parsed: JSON.parse(content), sizeBytes: Buffer.byteLength(content, 'utf8') });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    };

    try {
      const worker = getJsonParseWorker();
      const id = ++workerRequestId;
      pendingWorkerRequests.set(id, {
        resolve: (msg) => { if (!settled) { settled = true; resolve(msg); } },
        reject: () => finishInline()
      });
      worker.postMessage({ id, filePath });
    } catch (err) {
      finishInline();
    }
  });
}

// Mirror of the parse worker, for JSON.stringify + write of large payloads —
// see json-stringify-worker.js.
let jsonStringifyWorker = null;
let stringifyRequestId = 0;
const pendingStringifyRequests = new Map();

function getJsonStringifyWorker() {
  if (jsonStringifyWorker) return jsonStringifyWorker;
  jsonStringifyWorker = new Worker(path.join(__dirname, 'json-stringify-worker.js'));
  jsonStringifyWorker.on('message', (msg) => {
    const pending = pendingStringifyRequests.get(msg.id);
    if (!pending) return;
    pendingStringifyRequests.delete(msg.id);
    if (msg.ok) pending.resolve(msg);
    else pending.reject(new Error(msg.error));
  });
  jsonStringifyWorker.on('error', (err) => {
    for (const pending of pendingStringifyRequests.values()) pending.reject(err);
    pendingStringifyRequests.clear();
    jsonStringifyWorker = null;
  });
  jsonStringifyWorker.unref();
  return jsonStringifyWorker;
}

function stringifyAndWriteOffThread(filePath, diffData) {
  return new Promise((resolve) => {
    let settled = false;
    const finishInline = () => {
      if (settled) return;
      settled = true;
      try {
        const jsonStr = JSON.stringify(diffData);
        fs.writeFileSync(filePath, jsonStr, 'utf8');
        resolve({ ok: true, sizeBytes: Buffer.byteLength(jsonStr, 'utf8') });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    };

    try {
      const worker = getJsonStringifyWorker();
      const id = ++stringifyRequestId;
      pendingStringifyRequests.set(id, {
        resolve: (msg) => { if (!settled) { settled = true; resolve(msg); } },
        reject: () => finishInline()
      });
      worker.postMessage({ id, filePath, diffData });
    } catch (err) {
      finishInline();
    }
  });
}

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

  // Only stat() here — with thousands of cache files this alone is already
  // a real synchronous cost, and reading the first couple KB of every one
  // of them (to also learn fileCount up front) turned a ~1s scan into a
  // 6+ second one on a real dataset, blocking the server's very first
  // request right after startup. fileCount starts undefined (meaning
  // "unknown, treat as incomplete" per the callers below) and gets filled
  // in lazily the moment each CR's cache is actually read through
  // getCRDiffCache/getCRDiffCacheAsync, which every real code path already
  // goes through before trusting a cache as complete.
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
          cachedAt: new Date(stat.mtimeMs).toISOString(),
          fileCount: undefined
        });
        totalCachedBytes += stat.size;
      } catch (e) {}
    }
  } catch (err) {
    console.warn('[DiffCache] Error initializing cache index:', err.message);
  }
}

export const BINARY_FILE_RE = /\.(so|a|o|exe|dll|dylib|bin|dat|class|jar|war|ear|tar|gz|tgz|zip|7z|rar|iso|img|rpm|deb|png|jpg|jpeg|gif|bmp|ico|pdf)(\.\d+)*$/i;

export function isBinaryFile(fileName, filePath = '') {
  const target = (fileName || filePath || '').toLowerCase().trim();
  if (!target) return false;
  const base = target.split('/').pop() || target;
  return BINARY_FILE_RE.test(base);
}

const BINARY_EXTS = new Set([
  '.exe', '.o', '.a', '.so', '.dll', '.tar', '.gz', '.zip', 
  '.class', '.jar', '.png', '.jpg', '.jpeg', '.gif', '.pdf', 
  '.bin', '.dat'
]);

const KNOWN_CODE_EXTS = new Set([
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 's', 'asm',
  'sh', 'bash', 'csh', 'ksh', 'tcsh', 'py', 'pl', 'pm', 'rb',
  'java', 'go', 'rs', 'js', 'ts', 'jsx', 'tsx', 'json', 'xml',
  'yaml', 'yml', 'sql', 'tbl', 'awk', 'sed', 'mk', 'mak',
  'cfg', 'conf', 'ini', 'properties', 'txt', 'md', 'csv', 'log',
  'diff', 'patch', 'pc', 'ec', 'sqc', 'def', 'idl'
]);

/**
 * Determine if an entry is a ClearCase directory element or branch activity rather than a source file
 */
export function isDirectoryElement(fileName, filePath = '', unifiedDiff = '') {
  if (!fileName) return false;
  // ClearCase branch activity names
  if (fileName.startsWith('crdb') || fileName.startsWith('cr_')) return true;
  // Explicit directory marker in unified diff
  if (unifiedDiff && unifiedDiff.includes('[DIRECTORY:')) return true;

  const cleanName = fileName.split('/').pop() || fileName;
  const lower = cleanName.toLowerCase();

  // Known build/doc files without extension
  const knownFiles = new Set(['makefile', 'makeall', 'dockerfile', 'readme', 'license', 'cmakelists.txt']);
  if (knownFiles.has(lower) || lower.startsWith('makefile')) return false;

  // Platform/arch directories (e.g. Linux_2.6.32_ICC, SunOS_5.10, etc.)
  if (/^(linux|sunos|aix|hp-ux|solaris)_/i.test(cleanName)) return true;

  // Recognized source/code/config file extension
  const dotIndex = cleanName.lastIndexOf('.');
  if (dotIndex > 0) {
    const ext = cleanName.slice(dotIndex + 1).toLowerCase();
    if (KNOWN_CODE_EXTS.has(ext)) return false;
  }

  // Without recognized extension and not a known build file -> Directory element in ClearCase
  return true;
}

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

      // Filter out directory elements and branch pseudo-elements from files list
      if (parsed && Array.isArray(parsed.files)) {
        parsed.files = filterOutDirectoryEntries(parsed.files);
      }

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

// Shared post-processing: drop directory elements / branch pseudo-entries and
// entries that are actually a parent directory of another entry in the same
// list. O(n) via parent Set lookup instead of O(n^2) Array#some scan, which
// matters once a single CR's cache reaches hundreds of files.
function filterOutDirectoryEntries(files) {
  if (!Array.isArray(files) || files.length === 0) return files || [];
  const pathSet = new Set(files.map(f => f.filePath || f.fileName || '').filter(Boolean));
  const dirPaths = new Set();
  for (const p of pathSet) {
    let parent = p;
    let slashIdx;
    while ((slashIdx = parent.lastIndexOf('/')) > 0) {
      parent = parent.slice(0, slashIdx);
      if (pathSet.has(parent)) dirPaths.add(parent);
    }
  }
  return files.filter(f => {
    if (f.isDirectory) return false;
    if (isDirectoryElement(f.fileName, f.filePath, f.unifiedDiff)) return false;
    const fp = f.filePath || f.fileName || '';
    if (fp && dirPaths.has(fp)) return false;
    return true;
  });
}

/**
 * Async twin of getCRDiffCache, for callers that run inside the background
 * indexer's loop and must not block the event loop. A CR's cache file can
 * legitimately reach several hundred MB (a release-style CR with 1000+
 * files, each carrying a full unified diff) — fs.readFileSync + JSON.parse
 * on a file that size stalls the whole process for multiple seconds, and
 * with several concurrent workers each doing that to their own large CR,
 * the server can become unresponsive to every other request for a stretch.
 * Reading async keeps the disk I/O off the event loop; files above
 * WORKER_PARSE_THRESHOLD_BYTES additionally have their JSON.parse done on a
 * separate worker thread so even that CPU cost doesn't stall anything else
 * the server is doing.
 */
export async function getCRDiffCacheAsync(crid) {
  if (!isIndexInitialized) initCacheIndex();
  const safeId = String(crid).trim().replace(/[^a-zA-Z0-9_\-]/g, '');

  let filePath = path.join(DIFF_CACHE_DIR, `${safeId}.json`);
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    if (ROOT_DIR) {
      const fallback = path.join(ROOT_DIR, 'data', 'diff_cache', `${safeId}.json`);
      try {
        stat = await fs.promises.stat(fallback);
        filePath = fallback;
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  try {
    let parsed, sizeBytes;
    if (stat.size >= WORKER_PARSE_THRESHOLD_BYTES) {
      const result = await parseJsonFileOffThread(filePath);
      if (!result.ok) throw new Error(result.error);
      parsed = result.parsed;
      sizeBytes = result.sizeBytes;
    } else {
      const content = await fs.promises.readFile(filePath, 'utf8');
      parsed = JSON.parse(content);
      sizeBytes = Buffer.byteLength(content, 'utf8');
    }

    if (parsed && Array.isArray(parsed.files)) {
      parsed.files = filterOutDirectoryEntries(parsed.files);
    }
    if (parsed.cachedAt) {
      cacheIndex.set(safeId, {
        sizeBytes,
        fileCount: (parsed.files || []).length,
        isComplete: parsed.isComplete === true,
        cachedAt: parsed.cachedAt,
        mtimeMs: stat.mtimeMs
      });
    }
    return parsed;
  } catch (e) {
    console.warn(`[DiffCache] Corrupted cache for CR #${crid}:`, e.message);
    return null;
  }
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
      isComplete: diffData.isComplete === true,
      cachedAt: diffData.cachedAt || new Date().toISOString(),
      mtimeMs: Date.now()
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
 * Async twin of saveCRDiffCache for the background indexer's own save path.
 * A large CR's payload (hundreds of files, each with a full unified diff)
 * makes JSON.stringify itself a multi-second synchronous CPU cost — moving
 * it to the same worker thread used for parsing keeps that off the main
 * event loop too, matching getCRDiffCacheAsync's read-side handling.
 */
export async function saveCRDiffCacheAsync(crid, diffData) {
  if (!isIndexInitialized) initCacheIndex();
  const safeId = String(crid).trim().replace(/[^a-zA-Z0-9_\-]/g, '');
  const filePath = path.join(DIFF_CACHE_DIR, `${safeId}.json`);
  const fileCount = Array.isArray(diffData.files) ? diffData.files.length : 0;

  try {
    // Rough size estimate to decide worker vs. inline without stringifying
    // twice — good enough since this only gates which code path runs.
    const estimatedSize = fileCount * 50000; // ~50KB/file average is a safe over-estimate for routing purposes
    let sizeBytes;
    if (estimatedSize >= WORKER_PARSE_THRESHOLD_BYTES) {
      const result = await stringifyAndWriteOffThread(filePath, diffData);
      if (!result.ok) throw new Error(result.error);
      sizeBytes = result.sizeBytes;
    } else {
      const jsonStr = JSON.stringify(diffData);
      sizeBytes = Buffer.byteLength(jsonStr, 'utf8');
      await fs.promises.writeFile(filePath, jsonStr, 'utf8');
    }

    const existing = cacheIndex.get(safeId);
    if (existing) {
      totalCachedBytes -= (existing.sizeBytes || 0);
      totalCachedFiles -= (existing.fileCount || 0);
    }
    cacheIndex.set(safeId, {
      sizeBytes,
      fileCount,
      isComplete: diffData.isComplete === true,
      cachedAt: diffData.cachedAt || new Date().toISOString(),
      mtimeMs: Date.now()
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
 * Fetch and cache diffs for a CR using SSH. maxFiles defaults to unlimited —
 * a CR's filePaths can legitimately run into the hundreds or low thousands
 * (e.g. a single large release/deployment check-in touching every Makefile
 * across several VOBs), and capping collection at a small fixed number left
 * those CRs permanently showing only a handful of files while the cache
 * entry itself was marked complete, silently hiding the rest from VOB
 * history and anything else that reads the cache. Files are still fetched
 * one at a time with a yield between each, so an unlimited count doesn't
 * flood the SSH pool — it just takes longer for very large CRs.
 */
export async function fetchAndCacheCRDiff(cr, sshConfig, maxFiles = Infinity, forceRefresh = false, targetVob = null, onFileProgress = null) {
  if (!cr || !cr.crid) return null;
  const crid = cr.crid;

  // 1. Check existing cache
  const cached = await getCRDiffCacheAsync(crid);
  // Files already successfully cached, keyed by filePath — reused below so a
  // partial cache (e.g. one saved back when collection was capped at 5-10
  // files per CR) only fetches what's actually MISSING over SSH instead of
  // re-fetching everything from scratch. forceRefresh bypasses this and
  // always re-fetches every file (used when the user explicitly retries a
  // failed file).
  const alreadyCachedByPath = new Map();
  if (cached && Array.isArray(cached.files)) {
    for (const f of cached.files) {
      if (f.status === 'success' && f.filePath) alreadyCachedByPath.set(f.filePath, f);
    }
  }

  if (cached && cached.files && cached.files.length > 0 && !forceRefresh) {
    // Check if CR was modified in Mantis after cachedAt — if so, every file
    // needs a fresh look since we can't tell which ones actually changed.
    let modifiedInMantis = false;
    if (cr.lastUpdated && cached.cachedAt) {
      const crTime = new Date(cr.lastUpdated).getTime();
      const cacheTime = new Date(cached.cachedAt).getTime();
      if (!isNaN(crTime) && !isNaN(cacheTime) && crTime > cacheTime) {
        modifiedInMantis = true;
      }
    }
    if (modifiedInMantis) {
      alreadyCachedByPath.clear();
    } else {
      const crFileCount = (cr.files || []).length;
      const cachedFileCount = cached.files.length;
      const hasErrors = cached.files.some(f => f.status === 'error');
      if (!hasErrors && (cached.isComplete || crFileCount === 0 || crFileCount === cachedFileCount)) {
        // Fully cached, nothing missing, nothing failed — done.
        return cached;
      }
      console.log(`[DiffCache] CR #${crid} has ${cachedFileCount}/${crFileCount} files cached (errors: ${hasErrors}, isComplete: ${Boolean(cached.isComplete)}). Fetching only what's missing/failed...`);
    }
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

  // Detect directory elements from filePaths using O(N) parent lookup
  const rawPathSet = new Set(filePaths);
  const dirPaths = new Set();
  for (const p of filePaths) {
    let parent = p;
    let slashIdx;
    while ((slashIdx = parent.lastIndexOf('/')) > 0) {
      parent = parent.slice(0, slashIdx);
      if (rawPathSet.has(parent)) dirPaths.add(parent);
    }
  }

  // Files already successfully cached are reused as-is (not re-fetched); only
  // missing/failed ones go through SSH below. Carry them over first so the
  // final payload has all of them regardless of how many are newly fetched.
  const results = Array.from(alreadyCachedByPath.values());
  let processed = 0;
  let newlyFetchedCount = 0;
  let lastIncrementalSaveAt = Date.now();

  // If a targetVob was specified (e.g. from VOB History collect), prioritize
  // files belonging to that VOB so the user sees results immediately instead
  // of waiting for hundreds of unrelated files in other VOBs first.
  const fileIndices = files.map((_, idx) => idx);
  if (targetVob) {
    fileIndices.sort((a, b) => {
      const vobA = extractVobFromPath(filePaths[a] || files[a]) === targetVob ? 0 : 1;
      const vobB = extractVobFromPath(filePaths[b] || files[b]) === targetVob ? 0 : 1;
      return vobA - vobB;
    });
  }

  // Calculate eligible files count for accurate progress (N / M)
  const eligibleIndices = fileIndices.filter(idx => {
    const fn = files[idx];
    const fp = filePaths[idx] || fn;
    if (isDirectoryElement(fn, fp) || dirPaths.has(fp)) return false;
    if (isBinaryFile(fn, fp)) return false;
    return true;
  });
  const totalEligibleCount = eligibleIndices.length || files.length;

  for (const i of fileIndices) {
    if (processed >= maxFiles) break;

    const fileName = files[i];
    const filePath = filePaths[i] || fileName;

    // Already have a successful diff for this exact file — skip the SSH round-trip.
    if (alreadyCachedByPath.has(filePath)) continue;

    // Skip directory elements & branch pseudo-elements
    if (isDirectoryElement(fileName, filePath) || dirPaths.has(filePath)) continue;

    // Skip binary files (e.g. .so, .so.1.1, .a, .exe, .dll, etc.)
    if (isBinaryFile(fileName, filePath)) continue;

    processed++;
    if (typeof onFileProgress === 'function') {
      try {
        onFileProgress({
          crid,
          fileName,
          filePath,
          fileIndex: processed,
          totalFiles: totalEligibleCount
        });
      } catch (_) {}
    }
    if (sshPool.isUserActive()) {
      await new Promise(res => setTimeout(res, 1200)); // Momentarily yield to interactive user requests
    }
    // Yield to Node.js event loop before starting next diff
    await new Promise(res => setImmediate(res));

    try {
      const diffRes = await fetchFileDiffSSH(validServers, filePath, checkinLog, { priority: 'background' });
      // Skip if diff result indicates a directory element
      if (diffRes.isDirectory || (diffRes.unifiedDiff && diffRes.unifiedDiff.includes('[DIRECTORY:'))) {
        continue;
      }
      let uDiff = diffRes.unifiedDiff || '';
      if (uDiff.length > 2 * 1024 * 1024) {
        uDiff = uDiff.slice(0, 2 * 1024 * 1024) + '\n\n... [Diff truncated: file exceeds 2MB limit to preserve system memory] ...';
      }
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
        unifiedDiff: uDiff,
        fetchedAt: new Date().toISOString()
      });
      newlyFetchedCount++;
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
      newlyFetchedCount++;
    }

    // Incremental disk save so VOB history reflects progress before the whole
    // CR finishes — throttled by elapsed time rather than a fixed file count.
    // A fixed "every N files" checkpoint re-serializes the ENTIRE results
    // array each time, and that array only grows — for a 1000+ file CR every
    // N=5 files becomes 200+ saves, with the later ones each re-writing
    // several hundred MB (measured: ~3.4s per save once the array reaches
    // ~830 entries on real data), pushing total collection time for one
    // large CR into the range of minutes even though nothing here blocks
    // the server itself (saveCRDiffCacheAsync already offloads big payloads
    // to a worker thread). A time-based interval keeps the "show progress
    // soon" benefit while keeping the number of saves proportional to how
    // long collection takes, not how many files exist.
    // Incremental disk save only for large CRs (>= 30 files) to eliminate disk thrashing.
    // Small/medium CRs save exactly once when finished, saving hundreds of gigabytes of disk I/O.
    const INCREMENTAL_SAVE_INTERVAL_MS = 60000;
    if (totalEligibleCount >= 30 && newlyFetchedCount > 0 && Date.now() - lastIncrementalSaveAt >= INCREMENTAL_SAVE_INTERVAL_MS) {
      lastIncrementalSaveAt = Date.now();
      try {
        await saveCRDiffCacheAsync(crid, {
          crid,
          summary: cr.summary || '',
          cleanSummary: cr.cleanSummary || cr.summary || '',
          module: cr.module || '',
          customer: cr.customer || '',
          cachedAt: new Date().toISOString(),
          fileCount: results.length,
          files: results
        });
      } catch (e) {}
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
    isComplete: true,
    files: results
  };

  if (typeof onFileProgress === 'function') {
    try {
      onFileProgress({
        crid,
        fileName: '',
        filePath: '',
        fileIndex: processed,
        totalFiles: totalEligibleCount,
        completed: true
      });
    } catch (_) {}
  }

  await saveCRDiffCacheAsync(crid, cachePayload);
  return cachePayload;
}

// Matches the VOB directory name segment right after /vobs/<category>/, e.g.
// "/vobs/REL/POTS_KT_34A/SSW/src/..." -> "POTS_KT_34A". This is the ground-truth
// VOB per file — far more reliable than CRItem.vob, which is free-text parsed out
// of the Mantis title tag and can be stale, missing, or (for ~19 CRs) a
// comma-joined list of multiple values. A single CR's filePaths frequently span
// more than one real VOB (~62% of CRs with filePaths in the production dataset),
// so VOB membership must be computed per FILE, not per CR.
const VOB_PATH_RE = /\/vobs\/[^/]+\/([^/]+)\//;

export function extractVobFromPath(filePath) {
  if (!filePath) return null;
  const m = VOB_PATH_RE.exec(filePath);
  return m ? m[1] : null;
}

/**
 * For one file path, scan every CR's checkinLog to find which CR produced which
 * ClearCase version number. Unlike server/ssh.js's single-diff version parser
 * (which only needs ONE version per CR and stops at the first matching line),
 * this collects EVERY matching line per CR, because a checkinLog can record the
 * same file checked in multiple times within one CR (e.g. "...main/6,...
 * crdb00016126,..." then later "...main/7,...crdb00016126,..." after a second
 * fix pass on the same ticket) — all of those version bumps belong to that CR.
 *
 * Returns a Map<versionNumber, { crid, checkinLine }> for quick lookup when
 * rendering a version-history timeline.
 */
export function mapFileVersionsToCRs(filePath, allCrs) {
  const versionToCr = new Map();

  for (const cr of allCrs || []) {
    if (!cr.checkinLog) continue;
    const lines = cr.checkinLog.split(/\r?\n/);
    for (const l of lines) {
      // Require the full VOB-qualified path, not just the bare filename — many
      // same-named files (e.g. CsbUtil.c) exist under different VOBs/directories,
      // and a basename-only match cross-pollutes their version histories.
      if (!l.includes(filePath)) continue;
      const vMatch = l.match(/(_|@@)(\/[a-zA-Z0-9_\-\.\/]+)\/(\d+)/);
      if (!vMatch) continue;
      const verNum = parseInt(vMatch[3], 10);
      // If multiple CRs somehow claim the same version number (shouldn't happen
      // in practice — ClearCase versions are immutable/unique), keep the first
      // one found rather than silently overwriting with a later, likely-wrong match.
      if (!versionToCr.has(verNum)) {
        versionToCr.set(verNum, { crid: cr.crid, checkinLine: l.trim() });
      }
    }
  }

  return versionToCr;
}

/**
 * List all distinct VOBs (derived from real file paths, not the free-text CR.vob
 * title tag) with CR/file counts, sorted by CR count descending. 0ms — reduces
 * over the already-in-memory CR list, same cost class as /api/stats's byProject.
 */
export function getVobList(allCrs) {
  const vobMap = new Map(); // vobName -> { crids: Set, files: Set }

  for (const cr of allCrs || []) {
    if (!cr.filePaths || cr.filePaths.length === 0) continue;
    const vobsInThisCR = new Set();
    for (const fp of cr.filePaths) {
      if (isDirectoryElement(fp)) continue; // Skip directory elements
      const vob = extractVobFromPath(fp);
      if (!vob) continue;
      vobsInThisCR.add(vob);
      if (!vobMap.has(vob)) vobMap.set(vob, { crids: new Set(), files: new Set() });
      vobMap.get(vob).files.add(fp);
    }
    for (const vob of vobsInThisCR) {
      vobMap.get(vob).crids.add(cr.crid);
    }
  }

  const list = Array.from(vobMap.entries()).map(([vob, data]) => ({
    vob,
    crCount: data.crids.size,
    fileCount: data.files.size
  }));
  list.sort((a, b) => b.crCount - a.crCount);
  return list;
}

/**
 * Change history for one VOB: every cached file-diff, across every CR, whose
 * filePath falls under that VOB — sorted newest-first by the CR's report date so
 * the user sees "how has this VOB evolved" as a timeline, not grouped by CR.
 *
 * Cache-only by design: scanning hundreds of CRs' files over SSH on every request
 * would be far too slow for an interactive view. CRs touching this VOB that have
 * no cached diff yet are reported separately (uncachedCrids) so the caller can
 * show "N건 아직 수집되지 않음" and optionally queue them via
 * backgroundDiffIndexer.queuePriority() rather than block the response on them.
 */
export async function getVobHistory(vobName, allCrs) {
  if (!isIndexInitialized) initCacheIndex();

  const matchingCrs = (allCrs || []).filter(cr =>
    (cr.filePaths || []).some(fp => extractVobFromPath(fp) === vobName)
  );

  const entries = [];
  const uncachedCrids = [];
  const partiallyCachedCrids = [];

  const toRead = [];
  for (const cr of matchingCrs) {
    if (!hasCRDiffCache(cr.crid)) {
      uncachedCrids.push(cr.crid);
    } else {
      toRead.push(cr);
    }
  }

  // Read every matching CR's cache concurrently rather than one at a time —
  // a VOB can easily match 200-300+ CRs, and awaiting getCRDiffCacheAsync
  // sequentially means every small, fast CR still waits behind whatever
  // large one happens to sit earlier in the list. Batched so a VOB with an
  // extreme number of matches doesn't open hundreds of file handles at once.
  const READ_BATCH_SIZE = 25;
  const readResults = [];
  for (let i = 0; i < toRead.length; i += READ_BATCH_SIZE) {
    const batch = toRead.slice(i, i + READ_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(cr => getCRDiffCacheAsync(cr.crid)));
    readResults.push(...batchResults);
  }

  for (let i = 0; i < toRead.length; i++) {
    const cr = toRead[i];
    const cached = readResults[i];
    if (!cached || !Array.isArray(cached.files)) continue;

    // Cache exists but has fewer files than the CR actually has (e.g. saved
    // back when per-CR collection was capped) — what's cached is still shown
    // below, but flagged separately so the caller can offer "재수집" instead
    // of implying the CR is fully collected.
    const isPartial = (cr.files || []).length > cached.files.length;
    if (isPartial) {
      partiallyCachedCrids.push(cr.crid);
    }

    const cachedByPath = new Map(cached.files.map(f => [f.filePath, f]));
    const cachedFilePathSet = new Set(cached.files.map(f => f.filePath).filter(Boolean));
    const cachedDirPaths = new Set();
    for (const cf of cached.files) {
      let parent = cf.filePath;
      let slashIdx;
      while ((slashIdx = parent?.lastIndexOf('/')) > 0) {
        parent = parent.slice(0, slashIdx);
        if (cachedFilePathSet.has(parent)) cachedDirPaths.add(parent);
      }
    }

    for (const f of cached.files) {
      if (extractVobFromPath(f.filePath) !== vobName) continue; // this CR's other files may be in a different VOB
      // Skip directory elements and branch pseudo-elements completely
      if (f.isDirectory || isDirectoryElement(f.fileName, f.filePath, f.unifiedDiff)) continue;
      if (cachedDirPaths.has(f.filePath)) continue;

      entries.push({
        crid: cr.crid,
        id: cr.id,
        summary: cr.cleanSummary || cr.summary || '',
        customer: cr.customer || '',
        module: cr.module || '',
        dateSubmitted: cr.dateSubmitted || '',
        lastUpdated: cr.lastUpdated || '',
        reporter: cr.reporter || '',
        fileName: f.fileName,
        filePath: f.filePath,
        isDirectory: false,
        status: f.status,
        hasChanges: f.hasChanges,
        error: f.error || null,
        oldVersion: f.oldVersion,
        newVersion: f.newVersion,
        unifiedDiff: f.unifiedDiff,
        fetchedAt: f.fetchedAt,
        checkinLog: cr.checkinLog || ''
      });
    }

    // A partially-cached CR can have files that were never even attempted —
    // e.g. collection was interrupted mid-CR (app force-quit, connection
    // drop) between one file's SSH fetch and the next, so the file has
    // neither a success entry NOR an error entry in the cache. Those
    // silently vanished from the VOB history view entirely (not listed,
    // not shown as a failure) since the loop above only ever iterates what
    // IS in cached.files. Surface them explicitly as "수집 중단" so the gap
    // is visible instead of looking like the file was never part of the CR.
    if (isPartial) {
      const filePaths = cr.filePaths || [];
      const rawPathSet = new Set(filePaths);
      const dirPaths = new Set();
      for (const p of filePaths) {
        let parent = p;
        let slashIdx;
        while ((slashIdx = parent.lastIndexOf('/')) > 0) {
          parent = parent.slice(0, slashIdx);
          if (rawPathSet.has(parent)) dirPaths.add(parent);
        }
      }
      for (let i = 0; i < filePaths.length; i++) {
        const fp = filePaths[i];
        if (extractVobFromPath(fp) !== vobName) continue;
        if (cachedByPath.has(fp)) continue; // already has a success/error entry above
        const fn = (cr.files && cr.files[i]) || fp.split('/').pop() || '';
        if (isDirectoryElement(fn, fp) || dirPaths.has(fp)) continue; // never meant to be fetched
        if (isBinaryFile(fn, fp)) continue; // never meant to be fetched

        entries.push({
          crid: cr.crid,
          id: cr.id,
          summary: cr.cleanSummary || cr.summary || '',
          customer: cr.customer || '',
          module: cr.module || '',
          dateSubmitted: cr.dateSubmitted || '',
          lastUpdated: cr.lastUpdated || '',
          reporter: cr.reporter || '',
          fileName: fn,
          filePath: fp,
          isDirectory: false,
          status: 'not_collected',
          hasChanges: false,
          error: '아직 수집되지 않음 (수집이 중단되었을 수 있습니다)',
          oldVersion: '',
          newVersion: '',
          unifiedDiff: '',
          fetchedAt: null,
          checkinLog: cr.checkinLog || ''
        });
      }
    }
  }

  // Newest first — prefer the CR's actual report date over cache fetch time, so
  // the timeline reflects when the change actually happened in Mantis/ClearCase.
  entries.sort((a, b) => {
    const ta = new Date(a.dateSubmitted || a.lastUpdated || 0).getTime() || 0;
    const tb = new Date(b.dateSubmitted || b.lastUpdated || 0).getTime() || 0;
    return tb - ta;
  });

  return {
    vob: vobName,
    totalCrs: matchingCrs.length,
    cachedCrs: matchingCrs.length - uncachedCrids.length,
    uncachedCrids,
    partiallyCachedCrids,
    entries
  };
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
  const { maxCRs = 50, maxFilesPerCR = Infinity, onProgress } = options;
  const targets = crs.slice(0, maxCRs);

  let successCount = 0;
  let skippedCount = 0;
  let failCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const cr = targets[i];
    const cached = await getCRDiffCacheAsync(cr.crid);
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

// A CR at or above this many files can have a cache file reaching several
// hundred MB (each entry carries a full unified diff). Reading/parsing one
// of those still costs real event-loop time even with async I/O, so only
// one such CR is ever processed concurrently — letting several workers pile
// onto several large CRs at once was what made the whole server go
// unresponsive for stretches while multiple 500MB+ JSON.parse calls
// competed for the single JS thread.
const LARGE_CR_FILE_THRESHOLD = 200;

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
    this.activeLargeCrids = new Set(); // Subset of activeCrids whose file count exceeds LARGE_CR_FILE_THRESHOLD
    this.activeTasks = new Map(); // crid -> { crid, currentFile, filePath, fileIndex, totalFiles, updatedAt }
    this.priorityQueue = []; // CR IDs to process immediately (e.g. newly synced CRs)
    this.priorityVobs = new Map(); // crid -> targetVob
    this.sshConfig = null;
    this.lastError = null;
    this.lastProcessedAt = null;
    this.processedCount = 0;
    this.completedCrids = new Set(); // CR IDs successfully indexed during current session
    this.failedAttempts = new Map(); // crid -> { count, lastFailedAt }
    this.allCrsProvider = null;
    this._wakeResolve = null;
  }

  _sleep(ms) {
    return new Promise(res => {
      const timer = setTimeout(() => {
        this._wakeResolve = null;
        res();
      }, ms);
      this._wakeResolve = () => {
        clearTimeout(timer);
        this._wakeResolve = null;
        res();
      };
    });
  }

  wake() {
    if (typeof this._wakeResolve === 'function') {
      this._wakeResolve();
    }
  }

  setConcurrency(val) {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 1 && num <= 10) {
      this.concurrency = num;
      console.log(`[BackgroundDiffIndexer] Concurrency set to ${this.concurrency} parallel workers`);
      if (sshPool && typeof sshPool.setMaxPerHost === 'function') {
        sshPool.setMaxPerHost(Math.max(3, num));
      }
    }
  }

  init(allCrsProvider, sshConfig, initialConcurrency) {
    this.allCrsProvider = allCrsProvider;
    this.sshConfig = sshConfig;
    if (initialConcurrency) {
      this.setConcurrency(initialConcurrency);
    } else if (sshPool && typeof sshPool.setMaxPerHost === 'function') {
      sshPool.setMaxPerHost(Math.max(3, this.concurrency));
    }
    if (this.enabled) {
      this.start();
    }
  }

  updateSSHConfig(sshConfig) {
    this.sshConfig = sshConfig;
    this.wake();
  }

  queuePriority(crid, targetVob = null) {
    this.completedCrids.delete(crid);
    this.failedAttempts.delete(crid);
    if (targetVob) {
      this.priorityVobs.set(crid, targetVob);
    }
    if (!this.priorityQueue.includes(crid)) {
      this.priorityQueue.unshift(crid);
    }
    // Explicit priority items should run immediately even if auto-sweep is disabled
    if (!this.isRunning) {
      this.isRunning = true;
      this._runLoop();
    } else {
      this.wake();
    }
  }

  queueUpdates(crList) {
    if (!Array.isArray(crList)) return;
    for (const cr of crList) {
      const crid = cr?.crid || cr;
      if (crid) {
        this.completedCrids.delete(crid);
        this.failedAttempts.delete(crid);
        if (!this.priorityQueue.includes(crid)) {
          this.priorityQueue.push(crid);
        }
      }
    }
    this.wake();
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
    this.wake();
  }

  resume() {
    this.enabled = true;
    if (!this.isRunning) {
      this.start();
    } else {
      this.wake();
    }
  }

  getStatus() {
    const stats = getDiffCacheStats();
    const allCrs = typeof this.allCrsProvider === 'function' ? this.allCrsProvider() : [];
    const crsWithFiles = allCrs.filter(c => c.files && c.files.length > 0);
    const totalTargetCount = crsWithFiles.length || allCrs.length || 1;

    // Accurately count FULLY cached CRs that belong to current target CRs with
    // files — a CR whose cache exists but has fewer files than it actually
    // has (e.g. saved back when collection was capped) must not count as
    // done, or the progress bar shows 100% while VOB history and everything
    // else reading the cache is still missing most of that CR's files.
    //
    // meta.fileCount is undefined until a CR's cache is actually read once
    // through getCRDiffCache/getCRDiffCacheAsync (initCacheIndex only
    // stat()s files at boot to stay fast — see its comment). Right after
    // startup essentially every cached CR is in that "not yet read" state,
    // so treating undefined as "incomplete" made the progress bar show
    // 0/N right after a fresh install even though most CRs were already
    // fully cached. Since the cache file EXISTING is still real signal
    // (the CR was collected at some point), count it as done by default
    // and only flag it incomplete once fileCount has actually been read
    // and found to fall short — under-collected CRs still surface
    // correctly as soon as anything reads them (VOB history, CR detail,
    // etc.), just not instantly at cold boot.
    let cachedTargetCRs = 0;
    for (const cr of crsWithFiles) {
      if (this.completedCrids.has(cr.crid)) {
        cachedTargetCRs++;
        continue;
      }
      const safeId = String(cr.crid).trim().replace(/[^a-zA-Z0-9_\-]/g, '');
      const meta = cacheIndex.get(safeId);
      if (!meta) continue;
      if (meta.isComplete) {
        cachedTargetCRs++;
        continue;
      }
      if (typeof meta.fileCount === 'number' && meta.fileCount <= 10 && cr.files.length > 15) continue;
      cachedTargetCRs++;
    }

    const progressPercent = Math.min(100, (cachedTargetCRs / totalTargetCount) * 100);
    const activeList = Array.from(this.activeCrids);

    return {
      enabled: this.enabled,
      status: this.status,
      concurrency: this.concurrency,
      activeWorkers: this.activeWorkers,
      activeCrids: activeList,
      activeTasks: Array.from(this.activeTasks.values()),
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
    const largeSlotTaken = this.activeLargeCrids.size > 0;
    const now = Date.now();
    for (const cr of allCrs) {
      if (!cr.files || cr.files.length === 0) continue;
      if (this.activeCrids.has(cr.crid)) continue;
      if (this.completedCrids.has(cr.crid)) continue;

      // Exponential backoff check for failed CRs (prevents CPU-burning infinite retry loops)
      const failure = this.failedAttempts.get(cr.crid);
      if (failure) {
        const backoffMs = Math.min(1800000, 30000 * Math.pow(4, failure.count - 1));
        if (now - failure.lastFailedAt < backoffMs) {
          continue; // In backoff cooldown, skip for now
        }
      }

      // Don't start a second large CR while one is already being processed —
      // see LARGE_CR_FILE_THRESHOLD above.
      if (largeSlotTaken && cr.files.length >= LARGE_CR_FILE_THRESHOLD) continue;
      const safeId = String(cr.crid).trim().replace(/[^a-zA-Z0-9_\-]/g, '');
      const meta = cacheIndex.get(safeId);

      // If not cached at all in memory, pick immediately! (0ms, 0 disk I/O)
      if (!meta) {
        return cr;
      }

      // If marked as fully complete and not updated in Mantis since cachedAt, skip
      if (meta.isComplete && (!cr.lastUpdated || !meta.mtimeMs || new Date(cr.lastUpdated).getTime() <= meta.mtimeMs)) {
        continue;
      }

      // Check if stale using pre-cached millisecond timestamp (0 Date object allocations per tick)
      if (cr.lastUpdated && meta.mtimeMs) {
        if (!cr._lastUpdatedMs) {
          const t = new Date(cr.lastUpdated).getTime();
          cr._lastUpdatedMs = isNaN(t) ? 0 : t;
        }
        if (cr._lastUpdatedMs > meta.mtimeMs) {
          return cr;
        }
      }

      // Re-pick only CRs whose cache was saved back when per-CR file collection was capped
      // (<= 10 files while the CR actually has > 15 files). Normal CRs whose file count difference
      // is merely skipped directory elements or binary files are never endlessly re-picked.
      if (!meta.isComplete && typeof meta.fileCount === 'number' && meta.fileCount <= 10 && cr.files.length > 15) {
        return cr;
      }
    }
    return null;
  }

  async _processCRWorker(targetCR) {
    const crid = targetCR.crid;
    const targetVob = this.priorityVobs.get(crid) || null;
    this.priorityVobs.delete(crid);
    const isLarge = (targetCR.files || []).length >= LARGE_CR_FILE_THRESHOLD;
    this.activeWorkers++;
    this.activeCrids.add(crid);
    if (isLarge) this.activeLargeCrids.add(crid);
    this.status = 'running';

    const initialTotal = (targetCR.files || []).length || 1;
    this.activeTasks.set(crid, {
      crid,
      currentFile: targetCR.files?.[0] || '준비 중...',
      filePath: targetCR.filePaths?.[0] || targetCR.files?.[0] || '',
      fileIndex: 0,
      totalFiles: initialTotal,
      updatedAt: Date.now()
    });

    try {
      // Yield to event loop
      await new Promise(res => setTimeout(res, 100));
      await fetchAndCacheCRDiff(targetCR, this.sshConfig, Infinity, false, targetVob, (prog) => {
        if (prog.completed) {
          this.activeTasks.delete(crid);
        } else {
          this.activeTasks.set(crid, {
            crid,
            currentFile: prog.fileName,
            filePath: prog.filePath,
            fileIndex: prog.fileIndex,
            totalFiles: prog.totalFiles,
            updatedAt: Date.now()
          });
        }
      });
      this.processedCount++;
      this.lastProcessedAt = new Date().toISOString();
      this.lastError = null;
      this.completedCrids.add(crid);
      this.failedAttempts.delete(crid);
    } catch (err) {
      this.lastError = `CR #${crid}: ${err.message}`;
      console.warn(`[BackgroundDiffIndexer] Error caching #${crid}:`, err.message);
      const prevCount = this.failedAttempts.get(crid)?.count || 0;
      this.failedAttempts.set(crid, { count: prevCount + 1, lastFailedAt: Date.now() });
    } finally {
      this.activeTasks.delete(crid);
      this.activeCrids.delete(crid);
      if (isLarge) this.activeLargeCrids.delete(crid);
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      // Reclaim memory if heap exceeds 700MB to avoid Mac memory pressure & swap thrashing
      if (typeof global.gc === 'function') {
        const mem = process.memoryUsage();
        if (mem.heapUsed > 700 * 1024 * 1024) {
          try { global.gc(); } catch (_) {}
        }
      }
      // Essential breathing cooldown (800ms) between CRs so Electron UI and OS stay fluid
      await new Promise(res => setTimeout(res, 800));
    }
  }

  async _runLoop() {
    while (this.isRunning) {
      // Periodic GC check to keep heap lean
      if (typeof global.gc === 'function') {
        const mem = process.memoryUsage();
        if (mem.heapUsed > 700 * 1024 * 1024) {
          try { global.gc(); } catch (_) {}
        }
      }
      // If auto-sweep is disabled AND there are no priority items left, pause and sleep
      if (!this.enabled && this.priorityQueue.length === 0) {
        this.status = 'paused';
        await this._sleep(1000);
        continue;
      }

      // Yield if user is actively interacting with UI (clicking, viewing diffs)
      if (sshPool.isUserActive()) {
        await this._sleep(1000);
        continue;
      }

      const servers = Array.isArray(this.sshConfig) 
        ? this.sshConfig 
        : (this.sshConfig?.servers || (this.sshConfig?.host ? [this.sshConfig] : []));
      const hasValidServer = servers.some(s => s && s.host && s.enabled !== false);
      if (!hasValidServer) {
        this.status = 'waiting_ssh';
        await this._sleep(2500);
        continue;
      }

      const allCrs = typeof this.allCrsProvider === 'function' ? this.allCrsProvider() : [];
      if (!allCrs || allCrs.length === 0) {
        this.status = 'idle';
        await this._sleep(3000);
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
        // Throttle dispatch bursts (500ms) so the Node event loop and Electron UI stay ultra responsive
        await new Promise(res => setTimeout(res, 500));
      }

      if (this.activeWorkers === 0) {
        const anyRemaining = allCrs.some(cr => {
          if (!cr.files || cr.files.length === 0) return false;
          if (this.completedCrids.has(cr.crid)) return false;
          const failure = this.failedAttempts.get(cr.crid);
          if (failure && failure.count >= 3) return false;
          const safeId = String(cr.crid).trim().replace(/[^a-zA-Z0-9_\-]/g, '');
          const meta = cacheIndex.get(safeId);
          if (!meta) return true;
          if (meta.isComplete) return false;
          if (typeof meta.fileCount === 'number' && meta.fileCount <= 10 && cr.files.length > 15) return true;
          return false;
        });

        if (!anyRemaining && this.priorityQueue.length === 0) {
          this.status = 'completed';
          // All CRs 100% cached: sleep 30 seconds (wakes immediately on priorityQueue/queueUpdates/resume)
          await this._sleep(30000);
          continue;
        } else {
          this.status = 'idle';
          // Idle with no eligible targets: sleep 3 seconds
          await this._sleep(3000);
          continue;
        }
      } else {
        this.status = 'running';
        await this._sleep(1000);
      }
    }
  }
}

export const backgroundDiffIndexer = new BackgroundDiffIndexer();
