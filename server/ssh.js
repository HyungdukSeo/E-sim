import { Client } from 'ssh2';
import * as diff from 'diff';
import iconv from 'iconv-lite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { sshPool, createRawSSHClient } from './ssh-pool.js';

/**
 * Clean and sanitize host string
 */
function sanitizeHost(host) {
  if (!host) return '127.0.0.1';
  return host
    .replace(/^https?:\/\//i, '')
    .replace(/:.*$/, '')
    .trim();
}

/**
 * In-Memory Fast LRU Cache for Committed ClearCase Diffs (0ms response on repeat)
 */
const diffCache = new Map();
const MAX_CACHE_ENTRIES = 40; // Lean LRU cache (saves ~400MB RAM compared to 300 entries)

function getCacheKey(host, filePath, prevVer, currVer) {
  return `${host}:${filePath}:${prevVer}:${currVer}`;
}

/**
 * VOB-to-Server Affinity Cache (0ms Instant Routing for Known VOBs)
 * Remembers which server hosts which VOB to bypass probing non-existent servers
 */
const vobServerAffinity = new Map(); // vobKey -> host
const serverMissingVobCache = new Map(); // `${host}:${vobKey}` -> timestamp (TTL: 10 mins)
const MISSING_VOB_TTL_MS = 10 * 60 * 1000;

export function extractVobKey(filePath) {
  if (!filePath) return '';
  const clean = filePath.replace(/(_|@@)\/.*$/, '');
  const match2 = clean.match(/\/vobs\/([^\/]+\/[^\/]+)/);
  if (match2) return match2[1];
  const match1 = clean.match(/\/vobs\/([^\/]+)/);
  if (match1) return match1[1];
  return '';
}

export function getVobTags(filePath) {
  if (!filePath) return ['/vobs'];
  const clean = filePath.replace(/(_|@@)\/.*$/, '');
  const parts = clean.split('/').filter(Boolean);
  const vobIdx = parts.indexOf('vobs');
  if (vobIdx === -1) return ['/vobs'];

  const tags = [];
  // 2-level VOB tag: e.g. /vobs/REL/SSW_SKBC4_70A
  if (parts[vobIdx + 1] && parts[vobIdx + 2]) {
    tags.push(`/vobs/${parts[vobIdx + 1]}/${parts[vobIdx + 2]}`);
  }
  // 1-level VOB tag: e.g. /vobs/REL or /vobs/esm_kt
  if (parts[vobIdx + 1]) {
    tags.push(`/vobs/${parts[vobIdx + 1]}`);
  }
  return tags;
}

/**
 * Accurately finds the corresponding checkinLog line for a filePath.
 * Prevents false matches where a common base filename (e.g. Makefile, UEnc.c)
 * from another VOB earlier in the log was picked, and selects the latest version
 * if the file was checked in multiple times in the same CR.
 */
export function findCheckinLogEntry(checkinLog, filePath) {
  if (!checkinLog) return null;
  const lines = checkinLog.split(/\r?\n/);
  const baseFileName = filePath.split('/').pop() || filePath;
  const cleanReqPath = filePath.replace(/(_|@@)\/.*$/, '');
  const reqVobKey = extractVobKey(filePath);

  let bestMatch = null;
  let bestScore = -1; // 3: exact full path, 2: same VOB key + baseFileName, 1: baseFileName only (if relative)

  for (const l of lines) {
    if (!l.trim()) continue;
    let score = -1;
    if (l.includes(cleanReqPath)) {
      score = 3;
    } else if (reqVobKey && l.includes(reqVobKey) && l.includes(baseFileName)) {
      score = 2;
    } else if (!cleanReqPath.startsWith('/vobs/') && l.includes(baseFileName)) {
      score = 1;
    }

    if (score >= 2 || (score === 1 && bestScore < 1)) {
      const pathMatch = l.match(/(\/vobs\/[a-zA-Z0-9_\-\.\/]+)/);
      const vMatch = l.match(/(_|@@)(\/[a-zA-Z0-9_\-\.\/]+)\/(\d+)/);
      if (pathMatch && vMatch) {
        const extracted = pathMatch[1].replace(/(_|@@)\/.*$/, '');
        const branchPath = vMatch[2];
        const verNum = parseInt(vMatch[3], 10);
        if (score > bestScore || (score === bestScore && (!bestMatch || verNum >= bestMatch.verNum))) {
          bestScore = score;
          bestMatch = {
            exactVobPath: extracted,
            branchPath,
            verNum,
            line: l
          };
        }
      }
    }
  }
  return bestMatch;
}

function markVobServerAffinity(vobKey, host) {
  if (vobKey && host) {
    vobServerAffinity.set(vobKey, host);
    serverMissingVobCache.delete(`${host}:${vobKey}`);
  }
}

function markServerMissingVob(host, vobKey) {
  if (vobKey && host) {
    serverMissingVobCache.set(`${host}:${vobKey}`, Date.now());
  }
}

/**
 * Smart decode buffer with EUC-KR / UTF-8 fallback
 */
function smartDecode(buf) {
  if (!buf || buf.length === 0) return '';
  
  // Try EUC-KR (CP949) first for Korean telecom switch/Linux C files
  try {
    const eucKrText = iconv.decode(buf, 'euc-kr');
    if (!eucKrText.includes('\ufffd')) {
      return eucKrText;
    }
  } catch (e) {}

  // Fallback to UTF-8
  const utf8Text = buf.toString('utf-8');
  return utf8Text;
}

/**
 * Execute command over SSH and capture raw Binary Buffer
 */
export function execSSHBuffer(conn, command, timeoutMs = 6000, streamRef) {
  return new Promise((resolve, reject) => {
    let timer;
    let stream;
    let isSettled = false;

    function cleanup() {
      if (timer) clearTimeout(timer);
      if (stream) {
        stream.removeAllListeners();
        if (!stream.destroyed) {
          try { stream.close(); } catch (e) {}
        }
      }
    }

    function settle(fn) {
      if (!isSettled) {
        isSettled = true;
        cleanup();
        fn();
      }
    }

    timer = setTimeout(() => {
      settle(() => reject(new Error(`명령어 실행 시간 초과 (${timeoutMs / 1000}초)`)));
    }, timeoutMs);

    conn.exec(command, (err, s) => {
      if (err) return settle(() => reject(err));
      stream = s;
      if (streamRef) streamRef.stream = s;

      const chunks = [];
      let totalBytes = 0;
      const MAX_STREAM_BYTES = 25 * 1024 * 1024; // 25MB ceiling to protect against runaway buffer memory
      stream.on('data', (data) => {
        totalBytes += data.length;
        if (totalBytes > MAX_STREAM_BYTES) {
          try { stream.destroy(); } catch (e) {}
          settle(() => reject(new Error('명령어 출력 크기 초과 (최대 25MB) - 메모리 보호를 위해 중단됨')));
          return;
        }
        chunks.push(data);
      });
      stream.stderr.on('data', () => {}); // Ignore stderr
      stream.on('close', () => {
        const buffer = Buffer.concat(chunks);
        settle(() => resolve({ buffer }));
      });
      stream.on('error', (e) => settle(() => reject(e)));
    });
  });
}

/**
 * Connect to SSH server with guaranteed timeout & legacy algorithm support
 * Delegated to high-performance ssh-pool
 */
function createSSHClient(config) {
  return createRawSSHClient(config);
}

/**
 * Test SSH Connection (Lightweight, pure connection verification with VIP priority)
 */
export async function testSSHConnection(config, options = {}) {
  if (!config.host || !config.username) {
    throw new Error('서버 IP와 계정(Username)을 입력해주세요.');
  }

  const HARD_TIMEOUT_MS = 12000;
  let hardTimer;
  const deadline = new Promise((_, reject) => {
    hardTimer = setTimeout(() =>
      reject(new Error(`SSH 연결 테스트 시간 초과 (${HARD_TIMEOUT_MS / 1000}초) - 서버(${sanitizeHost(config.host)})에 도달할 수 없습니다.`)),
      HARD_TIMEOUT_MS
    );
  });

  let handle;
  try {
    return await Promise.race([deadline, (async () => {
      // testSSHConnection always gets VIP priority to jump ahead of background workers
      handle = await sshPool.acquire(config, { priority: 'vip', timeout: 10000 });
      const { buffer } = await execSSHBuffer(handle.conn, 'uname -a || hostname || echo ok', 4000);
      return { ok: true, message: `SSH 연결 성공 (${buffer.toString('utf-8').trim() || 'OK'})` };
    })()]);
  } catch (err) {
    throw new Error(err.message);
  } finally {
    clearTimeout(hardTimer);
    if (handle) {
      handle.release();
    }
  }
}

/**
 * Helper to fetch a single version of a file directly as raw Buffer
 * Phase 1: Fast direct path check (/view/v/... and /vobs/...)
 * Phase 2: Fallback cleartool setview -exec on primary view only
 */
async function fetchOneVersion(conn, vobSubPath, versionSuffix, candidateViews) {
  const filePath = `${vobSubPath}${versionSuffix}`;
  const envPrefix = 'export PATH=/usr/atria/bin:/opt/rational/clearcase/bin:/usr/local/bin:/usr/bin:/bin:$PATH;';

  // Phase 1: Fast direct /view paths and direct /vobs path (instant)
  // Supports both regular files (via cat / cleartool cat) and versioned ClearCase directories
  // (via ls -1 "$P/") so directory version changes can be inspected without error.
  const directAttempts = [];
  for (const v of candidateViews) {
    if (v) {
      directAttempts.push({
        cmd: `/bin/sh -c '${envPrefix} P="/view/${v}${filePath}"; if [ -d "$P" ] || [ -d "$P/" ]; then echo "[DIRECTORY: ${vobSubPath}]"; ls -1 "$P/" 2>/dev/null; else cat "$P" 2>/dev/null || cleartool cat "$P" 2>/dev/null; fi'`,
        view: v
      });
    }
  }
  directAttempts.push({
    cmd: `/bin/sh -c '${envPrefix} P="${filePath}"; if [ -d "$P" ] || [ -d "$P/" ]; then echo "[DIRECTORY: ${vobSubPath}]"; ls -1 "$P/" 2>/dev/null; else cat "$P" 2>/dev/null || cleartool cat "$P" 2>/dev/null; fi'`,
    view: candidateViews[0] || 'default'
  });

  const streamRefs1 = directAttempts.map(() => ({ stream: undefined }));
  try {
    const result = await Promise.any(
      directAttempts.map(({ cmd, view }, i) =>
        execSSHBuffer(conn, cmd, 3500, streamRefs1[i]).then((res) => {
          if (res.buffer && res.buffer.length > 0) {
            console.log(`[SSH Diff] Read ${res.buffer.length} bytes via view=${view} path=${filePath}`);
            return { buffer: res.buffer, view };
          }
          throw new Error('empty');
        })
      )
    );
    return result;
  } catch {
    // Phase 1 failed to find file, try fallback Phase 2
  } finally {
    for (const ref of streamRefs1) {
      if (ref.stream && !ref.stream.destroyed) {
        try { ref.stream.close(); } catch (e) {}
      }
    }
  }

  // Phase 2: cleartool setview -exec and csh environment on candidate views
  const fallbackViews = candidateViews.slice(0, 2);
  const fallbackAttempts = [];
  for (const v of fallbackViews) {
    fallbackAttempts.push({
      cmd: `/bin/sh -c '${envPrefix} cleartool setview -exec "if [ -d \\"${filePath}\\" ] || [ -d \\"${filePath}/\\" ]; then echo \\"[DIRECTORY: ${vobSubPath}]\\"; ls -1 \\"${filePath}/\\" 2>/dev/null; else cat \\"${filePath}\\" 2>/dev/null; fi" "${v}" 2>/dev/null'`,
      view: v
    });
    fallbackAttempts.push({
      cmd: `csh -c "setenv DEVCSHRC ~/.cshrc.hyungduk; [ -f ~/.cshrc.hyungduk ] && source ~/.cshrc.hyungduk 2>/dev/null; if ( -d \\"/view/${v}${filePath}\\" ) then; echo \\"[DIRECTORY: ${vobSubPath}]\\"; ls -1 \\"/view/${v}${filePath}/\\"; else; cat \\"/view/${v}${filePath}\\" 2>/dev/null || cat \\"${filePath}\\" 2>/dev/null; endif"`,
      view: v
    });
  }

  const streamRefs2 = fallbackAttempts.map(() => ({ stream: undefined }));
  try {
    const result = await Promise.any(
      fallbackAttempts.map(({ cmd, view }, i) =>
        execSSHBuffer(conn, cmd, 4000, streamRefs2[i]).then((res) => {
          if (res.buffer && res.buffer.length > 0) {
            console.log(`[SSH Diff] Read ${res.buffer.length} bytes via setview=${view} path=${filePath}`);
            return { buffer: res.buffer, view };
          }
          throw new Error('empty');
        })
      )
    );
    return result;
  } catch {
    return { buffer: Buffer.alloc(0), view: candidateViews[0] || 'default' };
  } finally {
    for (const ref of streamRefs2) {
      if (ref.stream && !ref.stream.destroyed) {
        try { ref.stream.close(); } catch (e) {}
      }
    }
  }
}

/**
 * Normalize a configOrServers argument (single config, {servers}, or array) into
 * a filtered, enabled server list. Shared by fetchFileDiffSSH and the new
 * multi-version helpers below so they all accept the same calling conventions.
 */
function normalizeServerList(configOrServers) {
  let servers = [];
  if (Array.isArray(configOrServers)) {
    servers = configOrServers;
  } else if (configOrServers && Array.isArray(configOrServers.servers)) {
    servers = configOrServers.servers;
  } else if (configOrServers && configOrServers.host) {
    servers = [configOrServers, ...(configOrServers.fallbackServers || [])];
  }
  return servers.filter(s => s && s.host && s.enabled !== false);
}

/**
 * Resolve a raw filePath (possibly /view/<tag>/vobs/... or already @@-suffixed)
 * down to its bare vobSubPath (e.g. /vobs/REL/SSW_KTC4_41A/.../UEnc.h) plus the
 * ClearCase branch path (e.g. /main), mirroring the normalization logic embedded
 * in _fetchFileDiffSSHImpl so the version-history/multi-version helpers agree
 * with the existing single-diff path on exactly what "the file" refers to.
 */
function resolveVobSubPath(filePath, checkinLog, config) {
  let branchPath = '/main';
  let detectedViewTag = '';
  let exactVobPathFromLog = '';
  const baseFileName = filePath.split('/').pop() || filePath;

  if (checkinLog) {
    const viewMatch = checkinLog.match(/\/view\/([a-zA-Z0-9_\-\.]+)\/vobs/);
    if (viewMatch) {
      detectedViewTag = viewMatch[1];
    } else {
      const fieldMatch = checkinLog.match(/,([a-zA-Z0-9_\-\.]+_view),/i);
      if (fieldMatch) detectedViewTag = fieldMatch[1];
    }

    const logEntry = findCheckinLogEntry(checkinLog, filePath);
    if (logEntry) {
      exactVobPathFromLog = logEntry.exactVobPath;
      branchPath = logEntry.branchPath;
    }
  }

  let cleanFilePath = exactVobPathFromLog || filePath.replace(/(_|@@)\/.*$/, '');
  let vobSubPath = cleanFilePath;
  if (vobSubPath.startsWith('/view/')) {
    const parts = vobSubPath.split('/');
    if (parts.length >= 4 && parts[3] === 'vobs') {
      if (!detectedViewTag) detectedViewTag = parts[2];
      vobSubPath = '/' + parts.slice(3).join('/');
    }
  } else if (!vobSubPath.startsWith('/vobs/')) {
    vobSubPath = '/vobs/' + vobSubPath.replace(/^\/+/, '');
  }

  // hyungduk_view 로만 시도하도록 단일화하여 불필요한 다중 View 순회 및 수집 지연 방지
  const targetView = (config && config.view) ? config.view : 'hyungduk_view';
  const candidateViews = [targetView];
  const uniqueViews = [targetView];

  return { vobSubPath, branchPath, uniqueViews };
}

/**
 * Same pre-flight view-detection probe used by _fetchFileDiffSSHImpl, factored
 * out so the version-history/multi-version helpers get identical view discovery
 * without duplicating the shell probe script itself.
 */
async function probeEffectiveViews(conn, vobSubPath, uniqueViews) {
  const vobTags = getVobTags(vobSubPath);
  const primaryVobTag = vobTags[0] || '/vobs';
  const parentDir = path.posix.dirname(vobSubPath);

  const startViewParts = uniqueViews.map(v => `cleartool startview "${v}" 2>/dev/null || true`).join('; ');
  const checkViewParts = uniqueViews.map(v => `if [ -e "/view/${v}${vobSubPath}" ] || [ -f "/view/${v}${vobSubPath}" ]; then echo "FOUND_VIEW:${v}"; exit 0; elif [ -d "/view/${v}${parentDir}" ] || [ -d "/view/${v}${primaryVobTag}" ]; then echo "FOUND_VIEW_DIR:${v}"; exit 0; fi`).join('; ');
  const lsvobParts = vobTags.map(tag => `if cleartool lsvob "${tag}" 2>/dev/null | grep -q "${tag}"; then cleartool mount "${tag}" 2>/dev/null || true; echo "LSVOB_FOUND:${tag}"; exit 0; fi`).join('; ');

  const probeCmd = `/bin/sh -c 'export PATH=/usr/atria/bin:/opt/rational/clearcase/bin:$PATH; ${startViewParts}; ${checkViewParts}; if [ -e "${vobSubPath}" ] || [ -f "${vobSubPath}" ]; then echo "FOUND_DIRECT"; exit 0; fi; ${lsvobParts}; echo "NOT_FOUND_ON_SERVER"; exit 2'`;

  let probeOutput = '';
  try {
    const { buffer } = await execSSHBuffer(conn, probeCmd, 2500);
    probeOutput = buffer.toString('utf8').trim();
  } catch (e) {}

  if (probeOutput.includes('NOT_FOUND_ON_SERVER')) {
    throw new Error(`VOB(${primaryVobTag}) 또는 파일이 서버에 존재하지 않습니다.`);
  }

  let effectiveViews = [...uniqueViews];
  const matchFoundView = probeOutput.match(/FOUND_VIEW(?:_DIR)?:([a-zA-Z0-9_\-\.]+)/);
  if (matchFoundView && matchFoundView[1]) {
    const preferred = matchFoundView[1];
    effectiveViews = [preferred, ...uniqueViews.filter(v => v !== preferred)];
  }
  return effectiveViews;
}

/**
 * List every /main/N version number ClearCase has recorded for one file, via
 * `cleartool lshistory -fmt "%Vn\n"`. Tries each candidate view (same
 * view-detection order as the diff path) until one returns a non-empty result.
 * Used by the "compare N versions side-by-side" feature to offer the user a
 * pickable version list instead of only ever showing N vs N-1.
 */
export async function fetchFileVersionHistorySSH(configOrServers, filePath, checkinLog = '', options = {}) {
  const servers = normalizeServerList(configOrServers);
  if (servers.length === 0) {
    throw new Error('설정된 유효한 ClearCase SSH 서버가 없습니다.');
  }

  const attemptedErrors = [];
  for (let i = 0; i < servers.length; i++) {
    const server = servers[i];
    const serverLabel = server.name ? `${server.name} (${server.host})` : server.host;
    let handle;
    try {
      const { vobSubPath, uniqueViews } = resolveVobSubPath(filePath, checkinLog, server);
      handle = await sshPool.acquire(server, { priority: options.priority || 'normal', timeout: 15000 });
      const conn = handle.conn;
      const effectiveViews = await probeEffectiveViews(conn, vobSubPath, uniqueViews);

      await execSSHBuffer(conn, `/bin/sh -c 'export PATH=/usr/atria/bin:/opt/rational/clearcase/bin:$PATH; cleartool startview "${effectiveViews[0]}" 2>/dev/null || true'`, 2500);

      const envPrefix = 'export PATH=/usr/atria/bin:/opt/rational/clearcase/bin:/usr/local/bin:/usr/bin:/bin:$PATH;';
      let versions = [];
      for (const v of effectiveViews.length ? effectiveViews : [null]) {
        const target = v ? `/view/${v}${vobSubPath}` : vobSubPath;
        const cmd = `/bin/sh -c '${envPrefix} cleartool lshistory -fmt "%Vn\\n" "${target}" 2>/dev/null'`;
        const { buffer } = await execSSHBuffer(conn, cmd, 6000);
        const out = buffer.toString('utf8').trim();
        if (!out) continue;
        // %Vn prints each version's branch-relative number, e.g. "/main/8" — keep only the trailing integer.
        versions = out.split(/\r?\n/)
          .map(line => {
            const m = line.trim().match(/(\d+)\s*$/);
            return m ? parseInt(m[1], 10) : null;
          })
          .filter(n => n !== null);
        if (versions.length > 0) break;
      }

      if (versions.length === 0) {
        throw new Error(`버전 이력을 찾을 수 없습니다(${vobSubPath}).`);
      }

      versions = Array.from(new Set(versions)).sort((a, b) => a - b);
      return {
        ok: true,
        filePath: vobSubPath,
        versions,
        latestVersion: versions[versions.length - 1],
        serverHost: server.host,
        serverName: server.name || server.host
      };
    } catch (err) {
      attemptedErrors.push(`${serverLabel}: ${err.message}`);
    } finally {
      if (handle) { try { handle.release(); } catch (e) {} }
    }
  }

  throw new Error(
    `등록된 ${servers.length}대 ClearCase 서버에서 파일(${filePath})의 버전 이력을 가져오지 못했습니다:\n` +
    attemptedErrors.map(e => `• ${e}`).join('\n')
  );
}

/**
 * Fetch raw content for an ARBITRARY set of version numbers of one file (not
 * just a consecutive N/N-1 pair), so the caller can render e.g. versions
 * 3,4,7,8 — or an entire 0..latest chain — side-by-side in one screen.
 * Reuses fetchOneVersion exactly as _fetchFileDiffSSHImpl does for its
 * two-version case, fetched in batches sized to the pool's per-host
 * connection limit so a file with many versions doesn't request more
 * connections at once than the pool can ever grant, which would otherwise
 * queue and time out before any connection is freed.
 */
export async function fetchFileVersionsSSH(configOrServers, filePath, checkinLog = '', versionNumbers = [], options = {}) {
  const servers = normalizeServerList(configOrServers);
  if (servers.length === 0) {
    throw new Error('설정된 유효한 ClearCase SSH 서버가 없습니다.');
  }
  const uniqueVersions = Array.from(new Set((versionNumbers || []).map(n => parseInt(n, 10)).filter(n => !isNaN(n)))).sort((a, b) => a - b);
  if (uniqueVersions.length === 0) {
    throw new Error('조회할 버전 번호가 없습니다.');
  }

  const attemptedErrors = [];
  for (let i = 0; i < servers.length; i++) {
    const server = servers[i];
    const serverLabel = server.name ? `${server.name} (${server.host})` : server.host;
    try {
      const { vobSubPath, branchPath, uniqueViews } = resolveVobSubPath(filePath, checkinLog, server);

      // Probe on its own connection, released immediately — holding it through
      // the version fetches below would burn one of the pool's few slots for
      // no reason and make the queueing math below worse.
      const probeHandle = await sshPool.acquire(server, { priority: options.priority || 'normal', timeout: 15000 });
      let effectiveViews;
      try {
        effectiveViews = await probeEffectiveViews(probeHandle.conn, vobSubPath, uniqueViews);
        await execSSHBuffer(probeHandle.conn, `/bin/sh -c 'export PATH=/usr/atria/bin:/opt/rational/clearcase/bin:$PATH; cleartool startview "${effectiveViews[0]}" 2>/dev/null || true'`, 2500);
      } finally {
        try { probeHandle.release(); } catch (e) {}
      }

      // Fetch versions in batches sized to the pool's actual per-host capacity
      // instead of requesting one connection per version up front — requesting
      // more than maxPerHost at once just queues the excess behind connections
      // that this same call is holding, and can time out well before any of
      // them are freed. Each connection is released as soon as ITS OWN fetch
      // finishes rather than held until the whole batch completes, so later
      // batches (and other concurrent requests) get it back sooner.
      const batchSize = Math.max(1, sshPool.maxPerHost || 3);
      const results = [];
      for (let start = 0; start < uniqueVersions.length; start += batchSize) {
        const batch = uniqueVersions.slice(start, start + batchSize);
        const batchResults = await Promise.all(
          batch.map(async versionNum => {
            const suffix = `@@${branchPath}/${versionNum}`;
            const handle = await sshPool.acquire(server, { priority: options.priority || 'normal', timeout: 15000 });
            try {
              const res = await fetchOneVersion(handle.conn, vobSubPath, suffix, effectiveViews);
              const decoded = smartDecode(res.buffer);
              return {
                version: versionNum,
                versionSuffix: suffix,
                content: decoded,
                base64: res.buffer.toString('base64'),
                byteLength: res.buffer.length,
                isDirectory: decoded.includes('[DIRECTORY:')
              };
            } finally {
              try { handle.release(); } catch (e) {}
            }
          })
        );
        results.push(...batchResults);
      }

      const anyContent = results.some(r => r.byteLength > 0);
      if (!anyContent) {
        throw new Error(`요청한 버전(${uniqueVersions.join(', ')})의 소스를 읽지 못했습니다(${vobSubPath}).`);
      }

      return {
        ok: true,
        filePath: vobSubPath,
        fileName: vobSubPath.split('/').pop() || vobSubPath,
        branchPath,
        results,
        serverHost: server.host,
        serverName: server.name || server.host
      };
    } catch (err) {
      attemptedErrors.push(`${serverLabel}: ${err.message}`);
    }
  }

  throw new Error(
    `등록된 ${servers.length}대 ClearCase 서버에서 파일(${filePath})의 버전(${uniqueVersions.join(', ')})을 가져오지 못했습니다:\n` +
    attemptedErrors.map(e => `• ${e}`).join('\n')
  );
}

/**
 * Fetch Line-by-Line Diff for ClearCase Element with Multi-Server Auto-Fallback
 * (VOB Affinity Learning + Fast Shell Pre-Flight Probe + Dynamic Fast Failover Across Servers)
 */
export async function fetchFileDiffSSH(configOrServers, filePath, checkinLog = '', options = {}) {
  let servers = [];
  if (Array.isArray(configOrServers)) {
    servers = configOrServers;
  } else if (configOrServers && Array.isArray(configOrServers.servers)) {
    servers = configOrServers.servers;
  } else if (configOrServers && configOrServers.host) {
    servers = [configOrServers, ...(configOrServers.fallbackServers || [])];
  }

  // Filter valid & enabled servers
  servers = servers.filter(s => s && s.host && s.enabled !== false);

  if (servers.length === 0) {
    throw new Error('설정된 유효한 ClearCase SSH 서버가 없습니다.');
  }

  // Extract VOB key and reorder servers so affinity server is probed first
  const vobKey = extractVobKey(filePath);
  if (vobKey && servers.length > 1) {
    const preferredHost = vobServerAffinity.get(vobKey);
    const now = Date.now();
    servers.sort((a, b) => {
      // 1. Preferred affinity host comes first
      if (preferredHost) {
        if (a.host === preferredHost) return -1;
        if (b.host === preferredHost) return 1;
      }
      // 2. Servers known NOT to have this VOB are pushed to the end
      const aMissing = serverMissingVobCache.has(`${a.host}:${vobKey}`) && (now - serverMissingVobCache.get(`${a.host}:${vobKey}`) < MISSING_VOB_TTL_MS);
      const bMissing = serverMissingVobCache.has(`${b.host}:${vobKey}`) && (now - serverMissingVobCache.get(`${b.host}:${vobKey}`) < MISSING_VOB_TTL_MS);
      if (aMissing && !bMissing) return 1;
      if (!aMissing && bMissing) return -1;
      return 0;
    });
  }

  const attemptedErrors = [];

  for (let i = 0; i < servers.length; i++) {
    const server = servers[i];
    const serverLabel = server.name ? `${server.name} (${server.host})` : server.host;

    try {
      console.log(`[ClearCase Multi-Server] (${i + 1}/${servers.length}) Searching file ${filePath} on ${serverLabel}...`);
      const isSingle = servers.length === 1;
      const result = await _fetchFileDiffFromSingleServer(server, filePath, checkinLog, isSingle, options);
      if (result && result.ok) {
        if (vobKey) {
          markVobServerAffinity(vobKey, server.host);
        }
        if (i > 0) {
          console.log(`[ClearCase Multi-Server] 🎉 Successfully found file ${filePath} on fallback server ${serverLabel}!`);
        }
        return {
          ...result,
          serverHost: server.host,
          serverName: server.name || server.host,
          searchedServersCount: servers.length,
          foundServerIndex: i
        };
      }
    } catch (err) {
      console.warn(`[ClearCase Multi-Server] Server ${serverLabel} attempt failed: ${err.message}`);
      attemptedErrors.push(`${serverLabel}: ${err.message}`);
      if (vobKey) {
        markServerMissingVob(server.host, vobKey);
      }
    }
  }

  // If no server was able to provide the file:
  throw new Error(
    `등록된 ${servers.length}대 ClearCase 서버에서 소스 파일(${filePath})을 찾지 못했습니다:\n` +
    attemptedErrors.map(e => `• ${e}`).join('\n')
  );
}

async function _fetchFileDiffFromSingleServer(config, filePath, checkinLog = '', isSingleServer = false, options = {}) {
  if (!config.host || !config.username) {
    throw new Error(`ClearCase SSH 서버 설정(IP/계정)이 필요합니다: ${config.host || 'IP미설정'}`);
  }

  // Dynamic deadline: single server gets 15s; multi-server probe gets 7s for fast fallback
  const HARD_TIMEOUT_MS = isSingleServer ? 15000 : 7000;
  let hardTimer;
  const hardDeadline = new Promise((_, reject) => {
    hardTimer = setTimeout(() => {
      reject(new Error(`파일 비교 시간 초과 (${HARD_TIMEOUT_MS / 1000}초) — SSH 서버(${config.host}) 응답 없음 또는 ClearCase view 접근 불가`));
    }, HARD_TIMEOUT_MS);
  });

  try {
    return await Promise.race([hardDeadline, _fetchFileDiffSSHImpl(config, filePath, checkinLog, options)]);
  } finally {
    clearTimeout(hardTimer);
  }
}

async function _fetchFileDiffSSHImpl(config, filePath, checkinLog = '', options = {}) {
  const priority = options.priority || 'normal';

  // 1. Calculate predecessor version and current version
  let currentVersion = '1';
  let predVersion = '0';
  let branchPath = '/main';
  let detectedViewTag = '';
  let exactVobPathFromLog = '';

  const baseFileName = filePath.split('/').pop() || filePath;

  // Parse checkinLog if available
  if (checkinLog) {
    const viewMatch = checkinLog.match(/\/view\/([a-zA-Z0-9_\-\.]+)\/vobs/);
    if (viewMatch) {
      detectedViewTag = viewMatch[1];
    } else {
      const fieldMatch = checkinLog.match(/,([a-zA-Z0-9_\-\.]+_view),/i);
      if (fieldMatch) detectedViewTag = fieldMatch[1];
    }

    const logEntry = findCheckinLogEntry(checkinLog, filePath);
    if (logEntry) {
      exactVobPathFromLog = logEntry.exactVobPath;
      branchPath = logEntry.branchPath;
      currentVersion = String(logEntry.verNum);
      predVersion = String(Math.max(0, logEntry.verNum - 1));
    }
  }

  // Normalize vobSubPath
  let cleanFilePath = exactVobPathFromLog || filePath.replace(/(_|@@)\/.*$/, '');
  let vobSubPath = cleanFilePath;
  if (vobSubPath.startsWith('/view/')) {
    const parts = vobSubPath.split('/');
    if (parts.length >= 4 && parts[3] === 'vobs') {
      if (!detectedViewTag) detectedViewTag = parts[2];
      vobSubPath = '/' + parts.slice(3).join('/');
    }
  } else if (!vobSubPath.startsWith('/vobs/')) {
    vobSubPath = '/vobs/' + vobSubPath.replace(/^\/+/, '');
  }

  const prevSuffix = `@@${branchPath}/${predVersion}`;
  const currSuffix = `@@${branchPath}/${currentVersion}`;

  // Check LRU In-Memory Cache (0ms Instant Return)
  const cacheKey = getCacheKey(config.host, vobSubPath, prevSuffix, currSuffix);
  if (diffCache.has(cacheKey)) {
    console.log(`[SSH Diff Cache HIT] ${cacheKey} (0ms)`);
    // Map iterates in insertion order, so re-insert on hit to mark this
    // entry as most-recently-used — otherwise eviction below is plain
    // FIFO and frequently-viewed diffs get evicted just as fast as one-offs.
    const hit = diffCache.get(cacheKey);
    diffCache.delete(cacheKey);
    diffCache.set(cacheKey, hit);
    return hit;
  }

  // Ordered candidate views: hyungduk_view 로만 시도하여 수집 시간 단축
  const targetView = (config && config.view) ? config.view : 'hyungduk_view';
  const candidateViews = [targetView];
  const uniqueViews = [targetView];

  let handle1;
  try {
    const t0 = Date.now();
    handle1 = await sshPool.acquire(config, { priority, timeout: 15000 });
    const conn = handle1.conn;

    // Fast Pre-Flight Check (< 2s): Verify if file, directory or VOB is present on this server
    // Note: Remote user login shell may be csh/tcsh, so commands must NOT contain raw unescaped newlines.
    const vobTags = getVobTags(vobSubPath);
    const primaryVobTag = vobTags[0] || '/vobs';
    const parentDir = path.posix.dirname(vobSubPath);

    const startViewParts = uniqueViews.map(v => `cleartool startview "${v}" 2>/dev/null || true`).join('; ');
    const checkViewParts = uniqueViews.map(v => `if [ -e "/view/${v}${vobSubPath}" ] || [ -f "/view/${v}${vobSubPath}" ]; then echo "FOUND_VIEW:${v}"; exit 0; elif [ -d "/view/${v}${parentDir}" ] || [ -d "/view/${v}${primaryVobTag}" ]; then echo "FOUND_VIEW_DIR:${v}"; exit 0; fi`).join('; ');
    const lsvobParts = vobTags.map(tag => `if cleartool lsvob "${tag}" 2>/dev/null | grep -q "${tag}"; then cleartool mount "${tag}" 2>/dev/null || true; echo "LSVOB_FOUND:${tag}"; exit 0; fi`).join('; ');

    const probeCmd = `/bin/sh -c 'export PATH=/usr/atria/bin:/opt/rational/clearcase/bin:$PATH; ${startViewParts}; ${checkViewParts}; if [ -e "${vobSubPath}" ] || [ -f "${vobSubPath}" ]; then echo "FOUND_DIRECT"; exit 0; fi; ${lsvobParts}; echo "NOT_FOUND_ON_SERVER"; exit 2'`;

    let probeOutput = '';
    try {
      const { buffer } = await execSSHBuffer(conn, probeCmd, 2500);
      probeOutput = buffer.toString('utf8').trim();
    } catch (e) {}

    if (probeOutput.includes('NOT_FOUND_ON_SERVER')) {
      throw new Error(`VOB(${primaryVobTag}) 또는 파일이 서버(${config.host})에 존재하지 않습니다.`);
    }

    // Prioritize discovered view if found
    let effectiveViews = [...uniqueViews];
    const matchFoundView = probeOutput.match(/FOUND_VIEW(?:_DIR)?:([a-zA-Z0-9_\-\.]+)/);
    if (matchFoundView && matchFoundView[1]) {
      const preferred = matchFoundView[1];
      effectiveViews = [preferred, ...uniqueViews.filter(v => v !== preferred)];
    }

    console.log(`[SSH Diff] Fetching ${vobSubPath} (${prevSuffix} <-> ${currSuffix}) for views:`, effectiveViews);

    // Ensure primary view is started in /bin/sh
    await execSSHBuffer(conn, `/bin/sh -c 'export PATH=/usr/atria/bin:/opt/rational/clearcase/bin:$PATH; cleartool startview "${effectiveViews[0]}" 2>/dev/null || true'`, 2500);

    // 2. Fetch current and previous versions in parallel over single multiplexed SSH connection.
    // SSH2 connections natively support multiplexed parallel exec channels over a single socket,
    // requiring strictly 1 pooled connection per worker and eliminating connection pool deadlock.
    const needOld = predVersion !== '0';
    const [newRes, oldRes] = await Promise.all([
      fetchOneVersion(conn, vobSubPath, currSuffix, effectiveViews),
      needOld
        ? fetchOneVersion(conn, vobSubPath, prevSuffix, effectiveViews)
        : Promise.resolve({ buffer: Buffer.alloc(0), view: effectiveViews[0] })
    ]);

    const newBuf = newRes.buffer;
    const oldBuf = oldRes.buffer;
    const foundView = newRes.view || effectiveViews[0] || 'hyungduk_view';

    // 3. Smart decode text
    const oldText = predVersion === '0' ? '' : smartDecode(oldBuf);
    const newText = smartDecode(newBuf);
    const isDirectory = oldText.includes('[DIRECTORY:') || newText.includes('[DIRECTORY:');

    // For background worker indexing, omit base64 encoding to prevent huge V8 memory pressure
    const isBackground = priority === 'background';
    const oldBase64 = isBackground ? '' : oldBuf.toString('base64');
    const newBase64 = isBackground ? '' : newBuf.toString('base64');

    const elapsed = Date.now() - t0;
    console.log(`[SSH Diff] Stream Result (${elapsed}ms): view=${foundView}, old=${oldBuf.length} bytes (${oldText.split('\n').length} lines), new=${newBuf.length} bytes (${newText.split('\n').length} lines)`);

    // 4. Check if file was completely unfound
    if (!oldText && !newText) {
      throw new Error(
        `SSH 서버(${config.host}) 연결은 성공했으나, ClearCase 소스 파일(${vobSubPath}${currSuffix})을 읽지 못했습니다.\n` +
        `시도한 View: [${uniqueViews.join(', ')}]\n` +
        `서버 터미널에서 cleartool startview ${foundView} 실행 여부 및 파일 경로를 확인해주세요.`
      );
    }

    // 5. Compute Structured Patch & Unified Diff
    const fileName = vobSubPath.split('/').pop() || vobSubPath;
    const hasChanges = oldText !== newText;
    let patch = null;
    let unifiedDiffText = '';

    if (hasChanges) {
      const MAX_DIFF_BYTES = 1.5 * 1024 * 1024; // Protect event loop from quadratic Myers diff on huge files
      if (oldText.length > MAX_DIFF_BYTES || newText.length > MAX_DIFF_BYTES) {
        unifiedDiffText = `--- ${fileName}${prevSuffix}\n+++ ${fileName}${currSuffix}\n@@ -1,1 +1,1 @@\n... [File exceeds 1.5MB: unified diff truncated to protect event loop responsiveness] ...`;
        if (!isBackground) {
          patch = {
            oldHeader: fileName + prevSuffix,
            newHeader: fileName + currSuffix,
            hunks: []
          };
        }
      } else {
        // Background indexing only needs unifiedDiffText, skip heavy structured patch
        if (!isBackground) {
          patch = diff.structuredPatch(
            fileName,
            fileName,
            oldText,
            newText,
            prevSuffix,
            currSuffix,
            { context: 3 }
          );
        }
        unifiedDiffText = diff.createTwoFilesPatch(
          fileName,
          fileName,
          oldText,
          newText,
          prevSuffix,
          currSuffix,
          { context: 3 }
        );
      }
    }

    // Compute friendly CLI vimdiff command
    const cliOldPath = `${vobSubPath}${prevSuffix}`;
    const cliNewPath = `${vobSubPath}${currSuffix}`;
    const vimdiffCommand = `vimdiff ${cliOldPath} ${cliNewPath}`;

    const finalResult = {
      ok: true,
      filePath: vobSubPath,
      fileName,
      isDirectory,
      prevVersion: prevSuffix,
      currVersion: currSuffix,
      prevVersionPath: cliOldPath,
      currVersionPath: cliNewPath,
      vimdiffCommand,
      oldBase64,
      newBase64,
      oldContent: oldText,
      newContent: newText,
      patch,
      unifiedDiff: unifiedDiffText,
      hasChanges
    };

    // Save to LRU In-Memory Cache for interactive user UI only
    // Background indexing workers save directly to disk JSON; caching in RAM causes severe memory starvation
    if (!isBackground) {
      if (diffCache.size >= MAX_CACHE_ENTRIES) {
        const firstKey = diffCache.keys().next().value;
        diffCache.delete(firstKey);
      }
      diffCache.set(cacheKey, finalResult);
    }

    return finalResult;
  } catch (err) {
    console.error('[SSH Diff Error]', err.message);
    throw new Error(err.message);
  } finally {
    // Release connection back to warm pool (0 socket destruction)
    if (handle1) {
      try { handle1.release(); } catch (e) {}
    }
  }
}
