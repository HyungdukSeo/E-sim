import { spawn, execSync } from 'child_process';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
/**
 * 1. Claude — REST API 직접 호출 (Keychain / ~/.claude/.credentials.json)
 */
function readClaudeToken() {
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
      const raw = execSync('security find-generic-password -s "Claude Code-credentials" -w', {
        encoding: 'utf8',
        timeout: 5000
      }).trim();
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
  let token = readClaudeToken();

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
        execSync('claude -p "ping" < /dev/null', { timeout: 15000, stdio: 'ignore' });
        const refreshedToken = readClaudeToken();
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
    const raw = execSync('agy models', {
      encoding: 'utf8',
      timeout: 10000
    });

    const lines = raw.split(/\r?\n/);
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
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (models) => {
      if (!resolved) {
        resolved = true;
        resolve(models);
      }
    };

    const fallback = [
      { id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol' },
      { id: 'gpt-5.5', displayName: 'GPT-5.5' },
      { id: 'gpt-5.4', displayName: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', displayName: 'GPT-5.4-Mini' }
    ];

    try {
      const proc = spawn('codex', ['app-server'], {
        stdio: ['pipe', 'pipe', 'pipe']
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
export async function getOmniRouteModels(baseUrl = 'http://localhost:20128/v1', apiKey = 'sk-omniroute') {
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

    const resp = await axios.get(`${cleanUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey || 'sk-omniroute'}`
      },
      timeout: 4000
    });

    if (resp.data?.data && Array.isArray(resp.data.data)) {
      const fetched = resp.data.data.map(m => ({
        id: m.id,
        displayName: m.id
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
