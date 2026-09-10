import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Client } from 'ssh2';

const MAX_CONNECTIONS_PER_HOST = 3; // Max parallel active SSH connections per remote host (safe for OpenSSH MaxStartups)
const IDLE_TIMEOUT_MS = 60 * 1000;  // 60s idle timeout before closing unused SSH sockets
const TCP_TIMEOUT = 5000;

function sanitizeHost(host) {
  if (!host) return '';
  return host.replace(/^(?:https?:\/\/)?(?:ssh:\/\/)?/, '').split('/')[0].split(':')[0].trim();
}

export function getHostKey(config) {
  const host = sanitizeHost(config.host);
  const port = parseInt(config.port, 10) || 22;
  const username = (config.username || 'dev').trim();
  return `${host}:${port}:${username}`;
}

/**
 * Low-level SSH client creation with robust algorithms compatible with OpenSSH 5.3 ~ 9.x
 */
export function createRawSSHClient(config) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let isSettled = false;

    const host = sanitizeHost(config.host);
    const port = parseInt(config.port, 10) || 22;
    const username = (config.username || 'dev').trim();

    function settle(fn) {
      if (!isSettled) {
        isSettled = true;
        fn();
      }
    }

    let privateKey = config.privateKey;
    if (!privateKey && !config.password) {
      try {
        const defaultKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa');
        if (fs.existsSync(defaultKeyPath)) {
          privateKey = fs.readFileSync(defaultKeyPath, 'utf8');
        }
      } catch (e) {}
    }

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
        sock: socket,
        username: username,
        password: config.password,
        privateKey: privateKey,
        tryKeyboard: true,
        readyTimeout: 15000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        algorithms: {
          kex: [
            'curve25519-sha256',
            'curve25519-sha256@libssh.org',
            'ecdh-sha2-nistp256',
            'ecdh-sha2-nistp384',
            'ecdh-sha2-nistp521',
            'diffie-hellman-group14-sha256',
            'diffie-hellman-group14-sha1',
            'diffie-hellman-group1-sha1',
            'diffie-hellman-group-exchange-sha256',
            'diffie-hellman-group-exchange-sha1'
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
 * Intelligent SSH Connection Pool
 * - Caps simultaneous connections per remote host (max 3)
 * - Reuses existing warm sessions across file diffs (0ms handshake)
 * - VIP Priority queue: User UI diffs & connection tests jump to front
 * - Graceful idle reaper & auto-reconnection on socket errors
 */
class SSHConnectionPool {
  constructor() {
    this.pools = new Map(); // hostKey -> Array of { id, conn, inUse, lastUsed, config }
    this.queues = new Map(); // hostKey -> Array of { resolve, reject, priority, timer, config }
    this.connectingCounts = new Map(); // hostKey -> number of in-flight connection handshakes
    this.maxPerHost = MAX_CONNECTIONS_PER_HOST;
    this.vipActiveUntil = 0; // Timestamp when VIP priority burst is active
    this.lastUserActivity = 0; // Timestamp when user last interacted with UI

    // Periodic idle reaper (closes connections unused for > 60s)
    this.reaperInterval = setInterval(() => this._reapIdle(), 15000);
    if (this.reaperInterval.unref) this.reaperInterval.unref();
  }

  notifyUserActive() {
    this.lastUserActivity = Date.now();
  }

  isUserActive() {
    return (Date.now() - this.lastUserActivity < 1500) || (Date.now() < this.vipActiveUntil);
  }

  isVIPActive() {
    return Date.now() < this.vipActiveUntil;
  }

  /**
   * Acquire a connection from the pool.
   * @param {Object} config - Server config
   * @param {Object} [options]
   * @param {'vip'|'normal'|'background'} [options.priority='normal']
   * @param {number} [options.timeout=18000]
   * @returns {Promise<{ conn: Client, release: Function, destroy: Function }>}
   */
  async acquire(config, options = {}) {
    const hostKey = getHostKey(config);
    const priority = options.priority || 'normal';
    const timeout = options.timeout || 18000;

    if (priority === 'vip') {
      this.vipActiveUntil = Date.now() + 3500;
      this.notifyUserActive();
    }

    if (!this.pools.has(hostKey)) {
      this.pools.set(hostKey, []);
    }
    if (!this.queues.has(hostKey)) {
      this.queues.set(hostKey, []);
    }
    if (!this.connectingCounts.has(hostKey)) {
      this.connectingCounts.set(hostKey, 0);
    }

    const hostPool = this.pools.get(hostKey);

    // 1. Try finding an idle, healthy connection
    const idleHandle = hostPool.find(h => !h.inUse && h.conn && !h.conn._sock?.destroyed);
    if (idleHandle) {
      idleHandle.inUse = true;
      idleHandle.lastUsed = Date.now();
      return this._makeHandle(idleHandle, hostKey);
    }

    // 2. Check if (connected + in-flight connecting) < maxPerHost
    const inFlight = this.connectingCounts.get(hostKey) || 0;
    if (hostPool.length + inFlight < this.maxPerHost) {
      this.connectingCounts.set(hostKey, inFlight + 1);
      try {
        const conn = await createRawSSHClient(config);
        const handleObj = {
          id: `${hostKey}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          conn,
          inUse: true,
          lastUsed: Date.now(),
          config
        };

        // Clean removal if connection closes or errors
        conn.once('close', () => this._removeHandle(hostKey, handleObj));
        conn.once('error', () => this._removeHandle(hostKey, handleObj));

        hostPool.push(handleObj);
        return this._makeHandle(handleObj, hostKey);
      } finally {
        const cur = this.connectingCounts.get(hostKey) || 1;
        this.connectingCounts.set(hostKey, Math.max(0, cur - 1));
        this._drainQueue(hostKey, config);
      }
    }

    // 3. Queue request if capacity reached
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(hostKey);
      const timer = setTimeout(() => {
        // Remove from queue on timeout
        const idx = queue.findIndex(q => q.timer === timer);
        if (idx !== -1) queue.splice(idx, 1);
        reject(new Error(`SSH 풀 세션 대기 시간 초과 (${timeout / 1000}초) - 서버(${config.host}) 동시 작업 포화`));
      }, timeout);

      const waiter = {
        resolve: (handleObj) => {
          clearTimeout(timer);
          resolve(this._makeHandle(handleObj, hostKey));
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        priority,
        timer,
        config
      };

      if (priority === 'vip') {
        // VIP users jump ahead of background workers
        queue.unshift(waiter);
      } else {
        queue.push(waiter);
      }
    });
  }

  _makeHandle(handleObj, hostKey) {
    let released = false;
    return {
      conn: handleObj.conn,
      release: () => {
        if (released) return;
        released = true;
        this._release(hostKey, handleObj);
      },
      destroy: () => {
        if (released) return;
        released = true;
        this._destroyHandle(hostKey, handleObj);
      }
    };
  }

  _release(hostKey, handleObj) {
    handleObj.inUse = false;
    handleObj.lastUsed = Date.now();
    this._drainQueue(hostKey, handleObj.config);
  }

  _drainQueue(hostKey, fallbackConfig) {
    const queue = this.queues.get(hostKey);
    if (!queue || queue.length === 0) return;

    const hostPool = this.pools.get(hostKey) || [];

    // 1. Check if there's an idle connection ready
    const idleHandle = hostPool.find(h => !h.inUse && h.conn && !h.conn._sock?.destroyed);
    if (idleHandle) {
      const vipIdx = queue.findIndex(q => q.priority === 'vip');
      const next = vipIdx !== -1 ? queue.splice(vipIdx, 1)[0] : queue.shift();
      if (next) {
        idleHandle.inUse = true;
        idleHandle.lastUsed = Date.now();
        next.resolve(idleHandle);
        return;
      }
    }

    // 2. If under limit and queue has waiters, spawn a new connection for the next waiter
    const inFlight = this.connectingCounts.get(hostKey) || 0;
    if (hostPool.length + inFlight < this.maxPerHost && queue.length > 0) {
      const vipIdx = queue.findIndex(q => q.priority === 'vip');
      const next = vipIdx !== -1 ? queue.splice(vipIdx, 1)[0] : queue.shift();
      if (!next) return;

      const targetConfig = next.config || fallbackConfig;
      if (!targetConfig) return;

      this.connectingCounts.set(hostKey, inFlight + 1);
      createRawSSHClient(targetConfig)
        .then(conn => {
          const handleObj = {
            id: `${hostKey}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            conn,
            inUse: true,
            lastUsed: Date.now(),
            config: targetConfig
          };
          conn.once('close', () => this._removeHandle(hostKey, handleObj));
          conn.once('error', () => this._removeHandle(hostKey, handleObj));
          hostPool.push(handleObj);
          next.resolve(handleObj);
        })
        .catch(err => {
          next.reject(err);
        })
        .finally(() => {
          const cur = this.connectingCounts.get(hostKey) || 1;
          this.connectingCounts.set(hostKey, Math.max(0, cur - 1));
          this._drainQueue(hostKey, targetConfig);
        });
    }
  }

  _destroyHandle(hostKey, handleObj) {
    try { handleObj.conn?.end(); } catch (e) {}
    try { handleObj.conn?.destroy(); } catch (e) {}
    this._removeHandle(hostKey, handleObj);
  }

  _removeHandle(hostKey, handleObj) {
    const hostPool = this.pools.get(hostKey);
    if (hostPool) {
      const idx = hostPool.indexOf(handleObj);
      if (idx !== -1) {
        hostPool.splice(idx, 1);
      }
    }
    this._drainQueue(hostKey, handleObj.config);
  }

  _reapIdle() {
    const now = Date.now();
    for (const [hostKey, hostPool] of this.pools.entries()) {
      for (let i = hostPool.length - 1; i >= 0; i--) {
        const h = hostPool[i];
        if (!h.inUse && (now - h.lastUsed > IDLE_TIMEOUT_MS)) {
          // Gracefully close idle socket
          try { h.conn.end(); } catch (e) {}
          hostPool.splice(i, 1);
        }
      }
    }
  }

  destroyAll() {
    if (this.reaperInterval) clearInterval(this.reaperInterval);
    for (const [_, hostPool] of this.pools.entries()) {
      for (const h of hostPool) {
        try { h.conn.end(); } catch (e) {}
        try { h.conn.destroy(); } catch (e) {}
      }
    }
    this.pools.clear();
    this.queues.clear();
    this.connectingCounts.clear();
  }
}

export const sshPool = new SSHConnectionPool();
