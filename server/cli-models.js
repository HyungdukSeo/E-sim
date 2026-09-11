import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execAsync = promisify(exec);

// Augment PATH for macOS/Linux GUI Electron environment to find claude, agy, codex, omniroute, etc.
// GUI apps on those platforms don't inherit the login shell's PATH, so common install
// locations are missing unless we add them explicitly. Windows GUI apps DO inherit the
// full user/system PATH (set via the registry, not a shell profile), and splitting/joining
// it on ':' would corrupt every entry (e.g. "C:\Users\..." splits after the drive letter) —
// so this augmentation is skipped entirely on win32.
const userHome = os.homedir();
const commonBinPaths = [];
if (process.platform !== 'win32') {
  // 1) Keep existing PATH first so active user environment takes precedence
  if (process.env.PATH) {
    commonBinPaths.push(...process.env.PATH.split(path.delimiter));
  }

  // 2) Add currently executing Node/Electron binary directory
  if (process.execPath) {
    commonBinPaths.push(path.dirname(process.execPath));
  }

  // 3) Common user CLI & Homebrew directories
  commonBinPaths.push(
    path.join(userHome, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin'
  );

  // 4) NVM Node versions (sorted descending so newest versions like v24.17.0 take precedence)
  const nvmBase = path.join(userHome, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmBase)) {
    try {
      const versions = fs.readdirSync(nvmBase)
        .filter(v => v.startsWith('v'))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
      for (const v of versions) {
        const vBin = path.join(nvmBase, v, 'bin');
        if (fs.existsSync(vBin)) {
          commonBinPaths.push(vBin);
        }
      }
    } catch {}
  }

  // 5) System fallbacks placed AFTER nvm & brew so legacy node (e.g. /usr/local/bin/node) never shadows modern node
  commonBinPaths.push(
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  );

  process.env.PATH = Array.from(new Set(commonBinPaths)).filter(Boolean).join(path.delimiter);
}

// Locate a CLI binary's full path. On macOS/Linux this first checks `which <cmd>`
// against the augmented PATH (which prioritizes active/modern versions), then checks
// fallback directories. On Windows, it uses `where`.
//
// This shells out to a child process — using the ASYNC exec (not execSync) is
// important: execSync blocks Node's single event loop thread entirely, so while it
// runs, the whole server (all other requests, the Electron UI it serves) is frozen.
// Checking 3-4 CLIs back-to-back (as getAIProvidersStatus does on every Settings/AI
// modal open) made the UI visibly stall. CLI install state essentially never changes
// while the app is running, so results are also cached for a few minutes to avoid
// even the async cost on repeat checks.
const commandPathCache = new Map();
const COMMAND_CACHE_TTL_MS = 5 * 60 * 1000;

export async function findCommandPath(cmd, { forceRefresh = false } = {}) {
  const cached = commandPathCache.get(cmd);
  if (!forceRefresh && cached && Date.now() - cached.at < COMMAND_CACHE_TTL_MS) {
    return cached.path;
  }
  const resolved = await _findCommandPathUncached(cmd);
  commandPathCache.set(cmd, { path: resolved, at: Date.now() });
  return resolved;
}

async function _findCommandPathUncached(cmd) {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync(`where ${cmd}`, { encoding: 'utf8', timeout: 5000 });
      const first = stdout.trim().split(/\r?\n/)[0]?.trim();
      if (first && fs.existsSync(first)) return first;
    } catch {}
    return null;
  }

  try {
    const { stdout } = await execAsync(`which ${cmd}`, {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, PATH: process.env.PATH }
    });
    const firstLine = stdout.trim().split(/\r?\n/)[0]?.trim();
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {}

  for (const dir of commonBinPaths) {
    const full = path.join(dir, cmd);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

export async function hasCommand(cmd, opts) {
  return Boolean(await findCommandPath(cmd, opts));
}

export function isInvalidOmniRouteKey(key) {
  if (!key || typeof key !== 'string') return true;
  const trimmed = key.trim();
  return !trimmed || trimmed === 'CHANGEME' || trimmed === 'sk-omniroute';
}

export async function readOmniRouteToken() {
  try {
    const dbPath = path.join(os.homedir(), '.omniroute', 'storage.sqlite');
    // The sqlite3 CLI ships by default on macOS/most Linux distros but not on Windows,
    // so check for it first rather than letting exec throw — hasCommand() already
    // handles the win32 (`where`) vs. posix (`which`) distinction.
    if (fs.existsSync(dbPath) && await hasCommand('sqlite3')) {
      const { stdout } = await execAsync(
        `sqlite3 "${dbPath}" "SELECT key FROM api_keys WHERE is_active = 1 AND (revoked_at IS NULL OR revoked_at = '') ORDER BY created_at ASC LIMIT 1;"`,
        { encoding: 'utf8', timeout: 2000 }
      );
      const raw = stdout.trim();
      if (raw && raw.startsWith('sk-')) {
        return raw;
      }
    }
  } catch {}
  return null;
}

export async function checkOmniRouteStatus(baseUrl = 'http://localhost:20128/v1', apiKey = '') {
  let cleanUrl = (baseUrl || 'http://localhost:20128/v1').trim().replace(/\/$/, '');
  if (!cleanUrl.endsWith('/v1') && !cleanUrl.includes('/v1/')) {
    cleanUrl += '/v1';
  }

  const detectedKey = await readOmniRouteToken();
  const effectiveKey = !isInvalidOmniRouteKey(apiKey) ? apiKey.trim() : (detectedKey || 'sk-omniroute');

  // 1. Try authenticated /models check with effectiveKey
  try {
    const resp = await axios.get(`${cleanUrl}/models`, {
      headers: { Authorization: `Bearer ${effectiveKey}` },
      timeout: 2500
    });
    if (resp.status === 200) {
      return {
        alive: true,
        ready: true,
        authenticated: true,
        detectedKey,
        effectiveKey,
        reason: 'OmniRoute 게이트웨이 정상 연결됨',
        hint: ''
      };
    }
  } catch (err) {
    // If primary key failed with 401/403 and detectedKey is available and different, retry with detectedKey
    if (detectedKey && effectiveKey !== detectedKey && err.response && (err.response.status === 401 || err.response.status === 403)) {
      try {
        const retryResp = await axios.get(`${cleanUrl}/models`, {
          headers: { Authorization: `Bearer ${detectedKey}` },
          timeout: 2500
        });
        if (retryResp.status === 200) {
          return {
            alive: true,
            ready: true,
            authenticated: true,
            detectedKey,
            effectiveKey: detectedKey,
            reason: 'OmniRoute 게이트웨이 정상 연결됨 (로컬 키 자동 복구)',
            hint: ''
          };
        }
      } catch {}
    }

    if (err.response) {
      const isOmniHeader = Boolean(err.response.headers?.['x-omniroute-route-class']);
      const status = err.response.status;
      if (status === 401 || status === 403 || isOmniHeader) {
        return {
          alive: true,
          ready: false,
          authenticated: false,
          detectedKey,
          effectiveKey,
          reason: 'OmniRoute 구동 중 (API 키 인증 필요)',
          hint: detectedKey ? '감지된 로컬 키 적용 필요' : '설정에서 OmniRoute API 키 확인 필요'
        };
      }
    }
  }

  // 2. Try root host ping (e.g. http://localhost:20128/)
  try {
    const parsed = new URL(cleanUrl);
    const rootUrl = `${parsed.protocol}//${parsed.host}/`;
    const resp = await axios.get(rootUrl, {
      timeout: 1500,
      maxRedirects: 3,
      validateStatus: () => true
    });
    const hasOmniHeader = Boolean(resp.headers?.['x-omniroute-route-class']);
    const hasOmniBody = typeof resp.data === 'string' && (resp.data.includes('OmniRoute') || resp.data.includes('/dashboard'));
    if (hasOmniHeader || hasOmniBody) {
      return {
        alive: true,
        ready: false,
        authenticated: false,
        detectedKey,
        effectiveKey,
        reason: 'OmniRoute 구동 중 (API 키 인증 필요)',
        hint: '설정에서 OmniRoute API 키 확인 필요'
      };
    }
  } catch {
    // Process unreachable
  }

  return {
    alive: false,
    ready: false,
    authenticated: false,
    detectedKey: null,
    effectiveKey: null,
    reason: 'OmniRoute 서비스 미구동 (localhost:20128)',
    hint: '터미널에서 omniroute 실행 필요'
  };
}

export async function checkOmniRouteAlive(baseUrl = 'http://localhost:20128/v1', apiKey = '') {
  const status = await checkOmniRouteStatus(baseUrl, apiKey);
  return status.ready;
}

/**
 * 1. Claude — REST API 직접 호출 (Keychain / ~/.claude/.credentials.json)
 */
export async function readClaudeToken() {
  let token = null;

  // 1) ~/.claude/.credentials.json 확인
  const credFile = path.join(os.homedir(), '.claude', '.credentials.json');
  if (fs.existsSync(credFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(credFile, 'utf8'));
      token = data?.claudeAiOauth?.accessToken;
    } catch (e) {
      console.warn('[Claude Models] Failed to read credentials file:', e.message);
    }
  }

  // 2) macOS Keychain 조회 (security find-generic-password)
  if (!token && process.platform === 'darwin') {
    try {
      const { stdout } = await execAsync('security find-generic-password -s "Claude Code-credentials" -w', {
        encoding: 'utf8',
        timeout: 5000
      });
      const raw = stdout.trim();
      try {
        const parsed = JSON.parse(raw);
        token = parsed?.claudeAiOauth?.accessToken || raw;
      } catch {
        token = raw;
      }
    } catch (e) {
      console.warn('[Claude Models] Failed to read from Keychain:', e.message);
    }
  }

  return token;
}

export async function getClaudeModels() {
  let token = await readClaudeToken();

  const fetchModelsFromApi = async (authToken) => {
    const resp = await axios.get('https://api.anthropic.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'anthropic-version': '2023-06-01'
      },
      timeout: 10000
    });

    if (resp.data?.data && Array.isArray(resp.data.data)) {
      return resp.data.data.map(m => ({
        id: m.id,
        displayName: m.display_name || m.id
      }));
    }
    return null;
  };

  // 1) API 직접 호출
  if (token) {
    try {
      const apiModels = await fetchModelsFromApi(token);
      if (apiModels && apiModels.length > 0) {
        return apiModels;
      }
    } catch (e) {
      console.warn('[Claude Models] API request failed (trying token refresh):', e.message);
      
      // 토큰 만료 등의 경우 claude cli를 통해 토큰 갱신 시도
      try {
        // stdio:'ignore' would detach stdin/stdout/stderr, making the `< /dev/null`
        // POSIX redirection unnecessary — and that redirection syntax isn't valid when
        // exec shells out via cmd.exe on Windows. Async exec (not execSync) keeps this
        // 15s call from freezing the whole server/UI while it runs.
        await execAsync('claude -p "ping"', { timeout: 15000 });
        const refreshedToken = await readClaudeToken();
        if (refreshedToken && refreshedToken !== token) {
          const retriedModels = await fetchModelsFromApi(refreshedToken);
          if (retriedModels && retriedModels.length > 0) {
            return retriedModels;
          }
        }
      } catch (refreshErr) {
        console.warn('[Claude Models] Auto token refresh failed:', refreshErr.message);
      }
    }
  }

  // Fallback (최신 5 / 4.x / 3.x 전체 라인업)
  return [
    { id: 'claude-opus-5', displayName: 'Claude Opus 5' },
    { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5' },
    { id: 'claude-fable-5-1', displayName: 'Claude Fable 5.1' },
    { id: 'claude-fable-5', displayName: 'Claude Fable 5' },
    { id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8' },
    { id: 'claude-opus-4-7', displayName: 'Claude Opus 4.7' },
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' },
    { id: 'claude-opus-4-5-20251101', displayName: 'Claude Opus 4.5' },
    { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-4-5-20250929', displayName: 'Claude Sonnet 4.5' },
    { id: 'claude-3-7-sonnet-latest', displayName: 'Claude 3.7 Sonnet' },
    { id: 'claude-3-5-sonnet-latest', displayName: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-latest', displayName: 'Claude 3.5 Haiku' },
    { id: 'claude-3-opus-latest', displayName: 'Claude 3 Opus' }
  ];
}

/**
 * 2. Antigravity — CLI 서브커맨드 (`agy models`)
 */
export async function getAntigravityModels() {
  try {
    const { stdout } = await execAsync('agy models', {
      encoding: 'utf8',
      timeout: 10000
    });

    const lines = stdout.split(/\r?\n/);
    const models = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('Fetching')) continue;

      const parts = trimmed.split(/\t+/);
      if (parts.length >= 2) {
        models.push({
          id: parts[0].trim(),
          displayName: parts[1].trim()
        });
      } else if (parts.length === 1 && parts[0]) {
        models.push({
          id: parts[0].trim(),
          displayName: parts[0].trim()
        });
      }
    }

    if (models.length > 0) return models;
  } catch (e) {
    console.warn('[Antigravity Models] Failed to run agy models:', e.message);
  }

  // Fallback
  return [
    { id: 'gemini-3.8-flash-high', displayName: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.7-flash-high', displayName: 'Gemini 3.7 Flash (High)' },
    { id: 'gemini-3.1-pro-high', displayName: 'Gemini 3.1 Pro (High)' },
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (Thinking)' }
  ];
}

/**
 * 3. Codex — app-server JSON-RPC (`codex app-server`)
 */
export function getCodexModels() {
  return new Promise(async (resolve) => {
    let resolved = false;
    const finish = (models) => {
      if (!resolved) {
        resolved = true;
        resolve(models);
      }
    };

    const fallback = [
      { id: 'gpt-6-astra', displayName: 'GPT-6-Astra' },
      { id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol' },
      { id: 'gpt-5.6-terra', displayName: 'GPT-5.6-Terra' },
      { id: 'gpt-5.6-luna', displayName: 'GPT-5.6-Luna' },
      { id: 'gpt-5.5', displayName: 'GPT-5.5' },
      { id: 'gpt-5.4', displayName: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', displayName: 'GPT-5.4-Mini' }
    ];

    try {
      const codexBin = (await findCommandPath('codex')) || 'codex';
      const proc = spawn(codexBin, ['app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PATH: process.env.PATH }
      });

      const timer = setTimeout(() => {
        try { proc.kill(); } catch {}
        finish(fallback);
      }, 8000);

      let buffer = '';

      proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep partial

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line.trim());
            if (msg.id === 1) {
              // initialize 완료 -> model/list 요청
              proc.stdin.write(JSON.stringify({ id: 2, method: 'model/list', params: {} }) + '\n');
            } else if (msg.id === 2) {
              clearTimeout(timer);
              try { proc.kill(); } catch {}

              const data = msg.result?.data || [];
              const validModels = data
                .filter(m => !m.hidden)
                .map(m => ({
                  id: m.id,
                  displayName: m.displayName || m.id
                }));

              finish(validModels.length > 0 ? validModels : fallback);
            }
          } catch {}
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        console.warn('[Codex Models] Process error:', err.message);
        finish(fallback);
      });

      // 1) Initialize 전송
      proc.stdin.write(JSON.stringify({
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'esim', version: '1.0' } }
      }) + '\n');

    } catch (e) {
      console.warn('[Codex Models] Spawn error:', e.message);
      finish(fallback);
    }
  });
}

/**
 * 4. OmniRoute — 로컬 AI Gateway (http://localhost:20128/v1/models)
 */
export async function getOmniRouteModels(baseUrl = 'http://localhost:20128/v1', apiKey = '') {
  const fallback = [
    { id: 'auto', displayName: 'auto (OmniRoute 스마트 자동 라우팅)' },
    { id: 'auto/coding', displayName: 'auto/coding (코딩 및 Diff 분석 특화)' },
    { id: 'auto/fast', displayName: 'auto/fast (초고속 응답 라우팅)' },
    { id: 'auto/cheap', displayName: 'auto/cheap (최저 비용 라우팅)' },
    { id: 'claude-3-5-sonnet-latest', displayName: 'claude-3-5-sonnet-latest' },
    { id: 'gpt-4o', displayName: 'gpt-4o' }
  ];

  try {
    let cleanUrl = (baseUrl || 'http://localhost:20128/v1').trim().replace(/\/$/, '');
    if (!cleanUrl.endsWith('/v1') && !cleanUrl.includes('/v1/')) {
      cleanUrl += '/v1';
    }

    const detectedKey = await readOmniRouteToken();
    let effectiveKey = !isInvalidOmniRouteKey(apiKey) ? apiKey.trim() : (detectedKey || 'sk-omniroute');

    let resp;
    try {
      resp = await axios.get(`${cleanUrl}/models`, {
        headers: {
          Authorization: `Bearer ${effectiveKey}`
        },
        timeout: 5000
      });
    } catch (reqErr) {
      if (detectedKey && effectiveKey !== detectedKey && reqErr.response && (reqErr.response.status === 401 || reqErr.response.status === 403)) {
        resp = await axios.get(`${cleanUrl}/models`, {
          headers: {
            Authorization: `Bearer ${detectedKey}`
          },
          timeout: 5000
        });
      } else {
        throw reqErr;
      }
    }

    if (resp.data?.data && Array.isArray(resp.data.data)) {
      const fetched = resp.data.data.map(m => ({
        id: m.id,
        displayName: m.name && m.name !== m.id ? `${m.id} (${m.name})` : m.id
      }));

      const existingIds = new Set(fetched.map(m => m.id));
      const merged = [...fetched];
      for (const fb of fallback) {
        if (!existingIds.has(fb.id)) {
          merged.unshift(fb);
        }
      }
      return merged;
    }
  } catch (err) {
    console.warn('[OmniRoute Models] Could not connect to local OmniRoute instance:', err.message);
  }

  return fallback;
}

/**
 * 6. Execute AI via Local CLI (Claude Code or Antigravity/Agy)
 */
export function runCliAI(cmdType, { systemPrompt = '', userPrompt = '', model = '', timeoutMs = 180000, isRetry = false }) {
  return new Promise(async (resolve, reject) => {
    let cmdName = 'claude';
    if (cmdType === 'gemini' || cmdType === 'agy') cmdName = 'agy';
    else if (cmdType === 'openai' || cmdType === 'codex') cmdName = 'codex';
    else if (cmdType === 'claude') cmdName = 'claude';

    const resolvedPath = await findCommandPath(cmdName);
    if (!resolvedPath) {
      return reject(new Error(`${cmdName} CLI가 설치되지 않았거나 PATH에 없습니다.`));
    }
    const cmdBin = resolvedPath;

    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\n[사용자 요청 및 분석 대상 데이터]\n${userPrompt}`
      : userPrompt;

    // Remove any null bytes or invalid control characters that break child_process.spawn
    const sanitizedPrompt = (fullPrompt || '').replace(/\0/g, '');

    const args = [];
    let outputFile = null;

    if (cmdName === 'claude') {
      if (model) {
        const lower = model.toLowerCase();
        if (lower.includes('opus')) args.push('--model', 'opus');
        else if (lower.includes('haiku')) args.push('--model', 'haiku');
        else if (lower.includes('sonnet')) args.push('--model', 'sonnet');
      }
      args.push('-p', sanitizedPrompt);
    } else if (cmdName === 'agy') {
      if (model && (model.startsWith('gemini') || model.startsWith('claude') || model.startsWith('gpt'))) {
        args.push('--model', model);
      }
      args.push('-p', sanitizedPrompt);
    } else if (cmdName === 'codex') {
      outputFile = path.join(os.tmpdir(), `codex_diff_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.txt`);
      args.push('exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only');
      if (model && !model.includes('default') && !model.includes('auto')) {
        args.push('-m', model.toLowerCase().trim());
      }
      args.push('-o', outputFile, '-');
    }

    let stdout = '';
    let stderr = '';

    const proc = spawn(cmdBin, args, {
      stdio: [cmdName === 'codex' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: process.env.PATH,
        HOME: os.homedir(),
        USER: os.userInfo()?.username || process.env.USER || 'user'
      }
    });

    if (cmdName === 'codex' && proc.stdin) {
      try {
        proc.stdin.write(sanitizedPrompt);
        proc.stdin.end();
      } catch (err) {
        console.warn('[Codex Stdin Write Error]:', err.message);
      }
    }

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      if (outputFile && fs.existsSync(outputFile)) {
        try { fs.unlinkSync(outputFile); } catch {}
      }
      reject(new Error(`${cmdName} CLI 응답 타임아웃 (${Math.round(timeoutMs / 1000)}초 초과)`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (outputFile && fs.existsSync(outputFile)) {
        try { fs.unlinkSync(outputFile); } catch {}
      }
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      let finalContent = '';
      if (outputFile && fs.existsSync(outputFile)) {
        try {
          finalContent = fs.readFileSync(outputFile, 'utf8').trim();
          fs.unlinkSync(outputFile);
        } catch {}
      }
      if (!finalContent) {
        finalContent = stdout.trim();
      }

      if (code === 0 && finalContent) {
        resolve({
          content: finalContent,
          provider: `${cmdName.toUpperCase()} CLI (${model || 'default'})`
        });
      } else if (code === 0) {
        resolve({
          content: stdout.trim(),
          provider: `${cmdName.toUpperCase()} CLI (${model || 'default'})`
        });
      } else if (cmdName === 'codex' && model && !isRetry) {
        // 특정 모델 지정으로 실패한 경우 (예: 계정에서 미지원 모델), 기본 모델로 1회 자동 재시도
        console.warn(`[Codex Model Retry] Model '${model}' failed (code ${code}). Retrying with Codex default model...`);
        runCliAI('codex', { systemPrompt, userPrompt, model: null, timeoutMs, isRetry: true })
          .then(resolve)
          .catch(reject);
      } else {
        reject(new Error(`${cmdName} CLI 실패 (코드 ${code}): ${stderr.trim() || stdout.trim()}`));
      }
    });
  });
}

/**
 * 7. Comprehensive AI Providers Availability Checker
 */
export async function getAIProvidersStatus(aiSettings = {}, { forceRefresh = false } = {}) {
  // All of these shell out or hit the network — run them concurrently instead of
  // sequentially so the total wait is the slowest single check, not the sum of all.
  // forceRefresh bypasses the CLI-path cache — used by the Settings modal's manual
  // "실시간 감지" button so it actually re-checks instead of instantly returning a
  // cached result (which made the click look like it did nothing).
  const [omniStatus, claudeToken, hasClaudeCli, hasCodexCli, hasAgyCli] = await Promise.all([
    checkOmniRouteStatus(aiSettings.omnirouteUrl, aiSettings.omnirouteApiKey),
    readClaudeToken(),
    hasCommand('claude', { forceRefresh }),
    hasCommand('codex', { forceRefresh }),
    hasCommand('agy', { forceRefresh })
  ]);

  return {
    local: {
      key: 'local',
      label: '로컬 NLP (기본)',
      available: true,
      ready: true,
      badge: '기본',
      reason: '사내 보안 격리 로컬 NLP (상시 사용 가능)'
    },
    omniroute: {
      key: 'omniroute',
      label: 'OmniRoute',
      available: omniStatus.alive,
      ready: omniStatus.ready,
      badge: 'Gateway',
      detectedKey: omniStatus.detectedKey,
      reason: omniStatus.reason,
      hint: omniStatus.hint
    },
    custom: {
      key: 'custom',
      label: 'Custom LLM',
      available: Boolean(aiSettings.customUrl && aiSettings.customUrl.trim().length > 5),
      ready: Boolean(aiSettings.customUrl && aiSettings.customUrl.trim().length > 5),
      badge: 'API',
      reason: (aiSettings.customUrl && aiSettings.customUrl.trim().length > 5) ? '엔드포인트 URL 설정됨' : '엔드포인트 URL 미설정',
      hint: '설정에서 Custom LLM URL 입력 필요'
    },
    openai: {
      key: 'openai',
      label: 'Codex',
      available: Boolean(hasCodexCli || aiSettings.openaiApiKey),
      ready: Boolean(hasCodexCli || aiSettings.openaiApiKey),
      badge: 'CLI/API',
      reason: hasCodexCli ? 'Codex CLI 사용 가능' : (aiSettings.openaiApiKey ? 'OpenAI API 키 설정됨' : 'Codex CLI 미설치'),
      hint: hasCodexCli || aiSettings.openaiApiKey ? '' : 'Codex CLI 설치 또는 API 키 설정 필요'
    },
    gemini: {
      key: 'gemini',
      label: 'Antigravity',
      available: Boolean(hasAgyCli || aiSettings.geminiApiKey),
      ready: Boolean(hasAgyCli || aiSettings.geminiApiKey),
      badge: 'CLI/API',
      reason: hasAgyCli ? 'Antigravity(agy) CLI 사용 가능' : (aiSettings.geminiApiKey ? 'Gemini API 키 설정됨' : 'agy CLI 미설치'),
      hint: hasAgyCli || aiSettings.geminiApiKey ? '' : 'agy CLI 설치 또는 API 키 설정 필요'
    },
    claude: {
      key: 'claude',
      label: 'Claude',
      available: Boolean(hasClaudeCli || claudeToken || aiSettings.claudeApiKey),
      ready: Boolean(hasClaudeCli || claudeToken || aiSettings.claudeApiKey),
      badge: 'CLI/API',
      reason: hasClaudeCli ? 'Claude CLI 정상 사용 가능' : (claudeToken ? 'Claude 인증 토큰 감지됨' : (aiSettings.claudeApiKey ? 'Claude API 키 설정됨' : 'Claude 인증 필요')),
      hint: hasClaudeCli || claudeToken || aiSettings.claudeApiKey ? '' : 'claude login 또는 API 키 설정 필요'
    }
  };
}
