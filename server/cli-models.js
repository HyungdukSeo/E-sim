import { spawn, execSync } from 'child_process';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * 1. Claude — REST API 직접 호출 (Keychain / ~/.claude/.credentials.json)
 */
export async function getClaudeModels() {
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

  // 3) API 호출
  if (token) {
    try {
      const resp = await axios.get('https://api.anthropic.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${token}`,
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
    } catch (e) {
      console.warn('[Claude Models] API request error:', e.message);
    }
  }

  // Fallback
  return [
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
