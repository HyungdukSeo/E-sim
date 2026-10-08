import path from 'path';

/**
 * "Lite" view of a CR diff cache: identical structure, but every file entry's
 * unifiedDiff is dropped. Most readers (VOB history, collection audits, the
 * background indexer's "is this CR already complete?" checks) only need
 * per-file metadata — loading a release-style CR's full cache (200MB+ on
 * disk, ~2x that as an in-memory string, several times more once parsed)
 * just to read filePath/status was what kept pushing the process into a
 * fatal V8 out-of-memory abort on 8GB machines.
 *
 * The only thing readers ever derive from unifiedDiff without displaying it
 * is the "[DIRECTORY:" marker (see isDirectoryElement), so that is preserved
 * as isDirectory: true.
 */
export function toLiteCache(parsed) {
  if (!parsed || !Array.isArray(parsed.files)) return parsed;
  const files = parsed.files.map((f) => {
    if (!f || typeof f !== 'object') return f;
    const { unifiedDiff, ...rest } = f;
    const out = { ...rest, unifiedDiff: '' };
    if (typeof unifiedDiff === 'string' && unifiedDiff.includes('[DIRECTORY:')) {
      out.isDirectory = true;
    }
    return out;
  });
  return { ...parsed, files, lite: true };
}

/**
 * Sidecar location for a cache file's lite view: <dir>/_meta/<crid>.json.
 * Kept in a subdirectory so directory scans of diff_cache (which treat every
 * top-level *.json as a CR cache) never mistake a sidecar for a CR.
 */
export function getLiteMetaPath(cacheFilePath) {
  return path.join(path.dirname(cacheFilePath), '_meta', path.basename(cacheFilePath));
}
