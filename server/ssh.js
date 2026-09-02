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
function execSSHBuffer(conn, command, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let timer = setTimeout(() => {
      reject(new Error(`명령어 실행 시간 초과 (${timeoutMs / 1000}초)`));
    }, timeoutMs);

    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        return reject(err);
      }

      const chunks = [];
      let stderr = '';

      stream
        .on('close', (code) => {
          clearTimeout(timer);
          const buf = Buffer.concat(chunks);
          resolve({ code, buffer: buf, stderr });
        })
        .on('data', (data) => {
          chunks.push(typeof data === 'string' ? Buffer.from(data, 'binary') : data);
        })
        .stderr.on('data', (data) => {
          stderr += data.toString('utf-8');
        });
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
    const TCP_TIMEOUT = 8000;

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
    // ssh2's readyTimeout only covers the SSH handshake phase.
    // On Windows, a TCP SYN to an unreachable host can hang 20-30s
    // without this socket-level guard.
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
      // TCP connected — clear TCP timer, let ssh2 take over
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
        readyTimeout: 8000, // SSH handshake timeout (after TCP is up)
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
 * Hard 12s outer deadline covers any edge-case where ssh2 internals hang
 */
export async function testSSHConnection(config) {
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
 * All candidate views are tried in PARALLEL - first success wins
 */
async function fetchOneVersion(conn, vobSubPath, versionSuffix, candidateViews) {
  const filePath = `${vobSubPath}${versionSuffix}`;
  const envPrefix = 'export PATH=/usr/atria/bin:/opt/rational/clearcase/bin:/usr/local/bin:/usr/bin:/bin:$PATH;';

  // Build all candidate commands (view paths + setview + direct)
  const attempts = [];

  // 1. /view/<tag>/... paths for each candidate view (fastest)
  for (const v of candidateViews) {
    if (v) {
      const cmd = `/bin/sh -c '${envPrefix} cat "/view/${v}${filePath}" 2>/dev/null || cleartool cat "/view/${v}${filePath}" 2>/dev/null || /usr/atria/bin/cleartool cat "/view/${v}${filePath}" 2>/dev/null'`;
      attempts.push({ cmd, view: v });
    }
  }

  // 2. cleartool setview -exec for each candidate view
  for (const v of candidateViews) {
    if (v) {
      const cmd = `/bin/sh -c '${envPrefix} cleartool setview -exec "cat \\"${filePath}\\"" "${v}" 2>/dev/null || /usr/atria/bin/cleartool setview -exec "cat \\"${filePath}\\"" "${v}" 2>/dev/null'`;
      attempts.push({ cmd, view: v });
    }
  }

  // 3. Direct /vobs path (no view)
  attempts.push({
    cmd: `/bin/sh -c '${envPrefix} cat "${filePath}" 2>/dev/null || cleartool cat "${filePath}" 2>/dev/null || /usr/atria/bin/cleartool cat "${filePath}" 2>/dev/null'`,
    view: candidateViews[0] || 'default'
  });

  // Run ALL attempts in PARALLEL — first non-empty buffer wins
  try {
    const result = await Promise.any(
      attempts.map(({ cmd, view }) =>
        execSSHBuffer(conn, cmd, 6000).then((res) => {
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
    // All attempts returned empty or timed out
    return { buffer: Buffer.alloc(0), view: candidateViews[0] || 'default' };
  }
}


/**
 * Fetch Line-by-Line Diff for ClearCase Element (Parallel Dual-Fetch + LRU Cache)
 */
export async function fetchFileDiffSSH(config, filePath, checkinLog = '') {
  if (!config.host || !config.username) {
    throw new Error('ClearCase SSH 서버 설정(IP/계정)이 필요합니다.');
  }

  // Hard 25s overall deadline — server never hangs indefinitely
  const HARD_TIMEOUT_MS = 25000;
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
    return diffCache.get(cacheKey);
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

    console.log(`[SSH Diff] Fetching ${vobSubPath} (${prevSuffix} <-> ${currSuffix}) for views:`, uniqueViews);

    // 1. Ensure target view is started in /bin/sh (parallel start)
    await execSSHBuffer(conn, `/bin/sh -c 'export PATH=/usr/atria/bin:/opt/rational/clearcase/bin:$PATH; cleartool startview "${uniqueViews[0]}" 2>/dev/null || true'`, 3000);

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
      fetchOneVersion(conn, vobSubPath, currSuffix, uniqueViews),
      needOld
        ? fetchOneVersion(oldConn, vobSubPath, prevSuffix, uniqueViews)
        : Promise.resolve({ buffer: Buffer.alloc(0), view: uniqueViews[0] })
    ]);

    const newBuf = newRes.buffer;
    const oldBuf = oldRes.buffer;
    const foundView = newRes.view || uniqueViews[0] || 'hyungduk_view';

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
