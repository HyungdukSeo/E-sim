import { Client } from 'ssh2';
import * as diff from 'diff';
import iconv from 'iconv-lite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';

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
const MAX_CACHE_ENTRIES = 300;

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
      stream.on('data', (data) => chunks.push(data));
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
 * Uses a raw net.Socket for TCP-level timeout (covers SYN hang on Windows)
 */
function createSSHClient(config) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let isSettled = false;

    const host = sanitizeHost(config.host);
    const port = parseInt(config.port, 10) || 22;
    const username = (config.username || 'dev').trim();
    const TCP_TIMEOUT = 5000;

    function settle(fn) {
      if (!isSettled) {
        isSettled = true;
        fn();
      }
    }

    // Try reading local user private key if password is empty
    let privateKey = config.privateKey;
    if (!privateKey && !config.password) {
      try {
        const defaultKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa');
        if (fs.existsSync(defaultKeyPath)) {
          privateKey = fs.readFileSync(defaultKeyPath, 'utf8');
        }
      } catch (e) {}
    }

    // ── Pre-create a raw TCP socket with explicit connect timeout ──
    const socket = new net.Socket();
    let tcpTimer = setTimeout(() => {
      socket.destroy();
      settle(() => reject(new Error(
        `SSH TCP 연결 시간 초과 (${TCP_TIMEOUT / 1000}초) - [${host}:${port}] 서버 IP 및 사내망/VPN 연결을 확인해주세요.`
      )));
    }, TCP_TIMEOUT);

    socket.once('error', (err) => {
      clearTimeout(tcpTimer);
      socket.destroy();
      let friendly = err.message;
      if (err.code === 'ECONNREFUSED') {
        friendly = `접속 거부 (ECONNREFUSED) - ${host}:${port}에 SSH 데몬이 구동 중이지 않거나 방화벽으로 차단되었습니다.`;
      } else if (['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(err.code)) {
        friendly = `접속 불가 (${err.code}) - ${host} 서버로 패킷이 도달할 수 없습니다. 사내 VPN 또는 서버 IP를 확인해주세요.`;
      }
      settle(() => reject(new Error(friendly)));
    });

    socket.connect(port, host, () => {
      clearTimeout(tcpTimer);
      tcpTimer = null;
    });

    conn
      .on('ready', () => settle(() => resolve(conn)))
      .on('error', (err) => {
        try { conn.destroy(); } catch (e) {}
        let friendly = err.message;
        if (err.level === 'client-authentication' || err.message.includes('All configured authentication methods failed')) {
          friendly = `인증 실패 - 계정(${username}) 또는 비밀번호가 올바르지 않습니다.`;
        } else if (err.message.includes('Handshake failed')) {
          friendly = `SSH 암호화 핸드셰이크 실패 - 서버의 키 교환/암호 알고리즘 불일치: ${err.message}`;
        }
        settle(() => reject(new Error(friendly)));
      })
      .on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
        const answers = prompts.map(() => config.password || '');
        finish(answers);
      })
      .connect({
        sock: socket,       // hand off our pre-connected socket
        username: username,
        password: config.password,
        privateKey: privateKey,
        tryKeyboard: true,
        readyTimeout: 6000, // SSH handshake timeout (after TCP is up)
        keepaliveInterval: 5000,
        keepaliveCountMax: 2,
        algorithms: {
          kex: [
            'curve25519-sha256',
            'curve25519-sha256@libssh.org',
            'ecdh-sha2-nistp256',
            'ecdh-sha2-nistp384',
            'ecdh-sha2-nistp521',
            'diffie-hellman-group-exchange-sha256',
            'diffie-hellman-group14-sha256',
            'diffie-hellman-group14-sha1',
            'diffie-hellman-group-exchange-sha1',
            'diffie-hellman-group1-sha1'
          ],
          cipher: [
            'aes128-ctr',
            'aes192-ctr',
            'aes256-ctr',
            'aes128-gcm',
            'aes256-gcm',
            'aes256-cbc',
            'aes192-cbc',
            'aes128-cbc',
            '3des-cbc'
          ],
          serverHostKey: [
            'ssh-ed25519',
            'ecdsa-sha2-nistp256',
            'ecdsa-sha2-nistp384',
            'ecdsa-sha2-nistp521',
            'rsa-sha2-512',
            'rsa-sha2-256',
            'ssh-rsa',
            'ssh-dss'
          ],
          hmac: [
            'hmac-sha2-256',
            'hmac-sha2-512',
            'hmac-sha1',
            'hmac-md5',
            'hmac-sha1-96'
          ]
        }
      });
  });
}

/**
 * Test SSH Connection (Lightweight, pure connection verification)
 */
export async function testSSHConnection(config) {
  if (!config.host || !config.username) {
    throw new Error('서버 IP와 계정(Username)을 입력해주세요.');
  }

  const HARD_TIMEOUT_MS = 10000;
  let hardTimer;
  const deadline = new Promise((_, reject) => {
    hardTimer = setTimeout(() =>
      reject(new Error(`SSH 연결 테스트 시간 초과 (${HARD_TIMEOUT_MS / 1000}초) - 서버(${sanitizeHost(config.host)})에 도달할 수 없습니다.`)),
      HARD_TIMEOUT_MS
    );
  });

  let conn;
  try {
    return await Promise.race([deadline, (async () => {
      conn = await createSSHClient(config);
      const { buffer } = await execSSHBuffer(conn, 'uname -a || hostname || echo ok', 4000);
      return { ok: true, message: `SSH 연결 성공 (${buffer.toString('utf-8').trim() || 'OK'})` };
    })()]);
  } catch (err) {
    throw new Error(err.message);
  } finally {
    clearTimeout(hardTimer);
    if (conn) {
      try { conn.end(); } catch (e) {}
      try { conn.destroy(); } catch (e) {}
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
  const directAttempts = [];
  for (const v of candidateViews) {
    if (v) {
      directAttempts.push({
        cmd: `/bin/sh -c '${envPrefix} cat "/view/${v}${filePath}" 2>/dev/null || cleartool cat "/view/${v}${filePath}" 2>/dev/null'`,
        view: v
      });
    }
  }
  directAttempts.push({
    cmd: `/bin/sh -c '${envPrefix} cat "${filePath}" 2>/dev/null || cleartool cat "${filePath}" 2>/dev/null'`,
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
      cmd: `/bin/sh -c '${envPrefix} cleartool setview -exec "cat \\"${filePath}\\"" "${v}" 2>/dev/null'`,
      view: v
    });
    fallbackAttempts.push({
      cmd: `csh -c "setenv DEVCSHRC ~/.cshrc.hyungduk; [ -f ~/.cshrc.hyungduk ] && source ~/.cshrc.hyungduk 2>/dev/null; cat \\"/view/${v}${filePath}\\" 2>/dev/null || cat \\"${filePath}\\" 2>/dev/null"`,
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
 * Fetch Line-by-Line Diff for ClearCase Element with Multi-Server Auto-Fallback
 * (VOB Affinity Learning + Fast Shell Pre-Flight Probe + Dynamic Fast Failover Across Servers)
 */
export async function fetchFileDiffSSH(configOrServers, filePath, checkinLog = '') {
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
      const result = await _fetchFileDiffFromSingleServer(server, filePath, checkinLog, isSingle);
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

async function _fetchFileDiffFromSingleServer(config, filePath, checkinLog = '', isSingleServer = false) {
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
    return await Promise.race([hardDeadline, _fetchFileDiffSSHImpl(config, filePath, checkinLog)]);
  } finally {
    clearTimeout(hardTimer);
  }
}

async function _fetchFileDiffSSHImpl(config, filePath, checkinLog = '') {

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

    const lines = checkinLog.split(/\r?\n/);
    for (const l of lines) {
      if (l.includes(filePath) || (baseFileName && l.includes(baseFileName))) {
        const pathMatch = l.match(/(\/vobs\/[a-zA-Z0-9_\-\.\/]+)/);
        if (pathMatch) {
          const extracted = pathMatch[1].replace(/(_|@@)\/.*$/, '');
          if (extracted.endsWith(baseFileName) || extracted.includes(baseFileName)) {
            exactVobPathFromLog = extracted;
          }
        }

        const vMatch = l.match(/(_|@@)(\/[a-zA-Z0-9_\-\.\/]+)\/(\d+)/);
        if (vMatch) {
          branchPath = vMatch[2];
          const verNum = parseInt(vMatch[3], 10);
          currentVersion = String(verNum);
          predVersion = String(Math.max(0, verNum - 1));
        }
        break;
      }
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

  // Ordered candidate views (Target view 1st)
  const candidateViews = [];
  if (detectedViewTag) candidateViews.push(detectedViewTag);
  candidateViews.push('hyungduk_view', 'hdseo_view', 'hdseo');
  if (config.username) {
    candidateViews.push(`${config.username}_view`);
    candidateViews.push(config.username);
  }
  const uniqueViews = Array.from(new Set(candidateViews)).filter(Boolean);

  let conn;
  let oldConn;
  try {
    const t0 = Date.now();
    conn = await createSSHClient(config);

    // Fast Pre-Flight Check (< 2s): Verify if file, directory or VOB is present on this server
    const vobTags = getVobTags(vobSubPath);
    const primaryVobTag = vobTags[0] || '/vobs';
    const parentDir = path.posix.dirname(vobSubPath);
    const probeViews = uniqueViews.join(' ');
    const probeCmd = `/bin/sh -c '
export PATH=/usr/atria/bin:/opt/rational/clearcase/bin:$PATH

# 1. Start views first so /view/<tag>/... is activated
for v in ${probeViews}; do
  cleartool startview "$v" 2>/dev/null || true
done

# 2. Check if VOB is registered on this server and auto-mount if needed
HAS_VOB=0
for tag in "${vobTags.join('" "')}"; do
  if cleartool lsvob "$tag" 2>/dev/null | grep -q "$tag"; then
    HAS_VOB=1
    cleartool mount "$tag" 2>/dev/null || true
    echo "LSVOB_FOUND:$tag"
    break
  fi
done

# 3. Check if file or parent dir exists in any candidate view
for v in ${probeViews}; do
  if [ -e "/view/$v${vobSubPath}" ] || [ -f "/view/$v${vobSubPath}" ]; then
    echo "FOUND_VIEW:$v"
    exit 0
  fi
  if [ -d "/view/$v${parentDir}" ]; then
    echo "FOUND_VIEW_DIR:$v"
    exit 0
  fi
done

# 4. Check direct /vobs path (if view is already set in shell)
if [ -e "${vobSubPath}" ] || [ -f "${vobSubPath}" ]; then
  echo "FOUND_DIRECT"
  exit 0
fi

# 5. If VOB was verified by cleartool lsvob, server DOES host this VOB!
if [ "$HAS_VOB" = "1" ]; then
  echo "VOB_VERIFIED"
  exit 0
fi

echo "NOT_FOUND_ON_SERVER"
exit 2
'`;

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

    // 2. Fetch current and previous versions in parallel.
    // Each fetchOneVersion() races many exec() channels at once (per-view x per-strategy),
    // so old/new MUST use separate SSH connections — sharing one connection made both
    // sides compete for the same channel slots and the server would silently starve
    // whichever side's channels opened second (observed: old/left side always empty).
    const needOld = predVersion !== '0';
    if (needOld) {
      oldConn = await createSSHClient(config);
    }
    const [newRes, oldRes] = await Promise.all([
      fetchOneVersion(conn, vobSubPath, currSuffix, effectiveViews),
      needOld
        ? fetchOneVersion(oldConn, vobSubPath, prevSuffix, effectiveViews)
        : Promise.resolve({ buffer: Buffer.alloc(0), view: effectiveViews[0] })
    ]);

    const newBuf = newRes.buffer;
    const oldBuf = oldRes.buffer;
    const foundView = newRes.view || effectiveViews[0] || 'hyungduk_view';

    // 3. Base64 encode raw bytes for frontend
    const oldBase64 = oldBuf.toString('base64');
    const newBase64 = newBuf.toString('base64');

    // 4. Smart decode text
    const oldText = predVersion === '0' ? '' : smartDecode(oldBuf);
    const newText = smartDecode(newBuf);

    const elapsed = Date.now() - t0;
    console.log(`[SSH Diff] Stream Result (${elapsed}ms): view=${foundView}, old=${oldBuf.length} bytes (${oldText.split('\n').length} lines), new=${newBuf.length} bytes (${newText.split('\n').length} lines)`);

    // 5. Check if file was completely unfound
    if (!oldText && !newText) {
      throw new Error(
        `SSH 서버(${config.host}) 연결은 성공했으나, ClearCase 소스 파일(${vobSubPath}${currSuffix})을 읽지 못했습니다.\n` +
        `시도한 View: [${uniqueViews.join(', ')}]\n` +
        `서버 터미널에서 cleartool startview ${foundView} 실행 여부 및 파일 경로를 확인해주세요.`
      );
    }

    // 6. Compute Structured Patch
    const fileName = vobSubPath.split('/').pop() || vobSubPath;
    const patch = diff.structuredPatch(
      fileName,
      fileName,
      oldText,
      newText,
      `Predecessor (v${predVersion})`,
      `Current (v${currentVersion})`
    );

    const unifiedDiffText = diff.createTwoFilesPatch(
      `a/${fileName}`,
      `b/${fileName}`,
      oldText,
      newText,
      `v${predVersion}`,
      `v${currentVersion}`
    );

    // Compute friendly CLI vimdiff command
    const cliOldPath = `/view/${foundView}${vobSubPath}${prevSuffix}`;
    const cliNewPath = `/view/${foundView}${vobSubPath}${currSuffix}`;
    const vimdiffCommand = `vimdiff ${cliOldPath} ${cliNewPath}`;

    const finalResult = {
      ok: true,
      filePath: vobSubPath,
      fileName,
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
      hasChanges: oldText !== newText
    };

    // Save to LRU In-Memory Cache (Immutable committed ClearCase versions)
    if (diffCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = diffCache.keys().next().value;
      diffCache.delete(firstKey);
    }
    diffCache.set(cacheKey, finalResult);

    return finalResult;
  } catch (err) {
    console.error('[SSH Diff Error]', err.message);
    throw new Error(err.message);
  } finally {
    // ALWAYS guaranteed clean disconnect - 0 garbage/zombie sessions
    if (conn) {
      try { conn.end(); } catch (e) {}
      try { conn.destroy(); } catch (e) {}
    }
    if (oldConn) {
      try { oldConn.end(); } catch (e) {}
      try { oldConn.destroy(); } catch (e) {}
    }
  }
}
