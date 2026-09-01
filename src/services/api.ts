import axios from 'axios';
import { CRItem, SyncMeta, StatsData, AppSettings, SSHConfig, DiffResult } from '../types/cr';

const API_BASE = '/api';

export const DEFAULT_SETTINGS: AppSettings = {
  mantisUrl: 'http://192.168.16.200',
  autoSyncIntervalMin: 60,
  ai: {
    provider: 'local',
    apiKey: '',
    ollamaUrl: 'http://localhost:11434',
    model: ''
  },
  ssh: {
    host: '192.168.16.200',
    port: 22,
    username: 'dev',
    password: '',
    enabled: true
  },
  theme: 'dark',
  itemsPerPage: 50
};

// Local storage keys
const STORAGE_KEY_SETTINGS = 'mantis_cr_settings_v1';
const STORAGE_KEY_BOOKMARKS = 'mantis_cr_bookmarks_v1';
const STORAGE_KEY_LOCAL_CRS = 'mantis_cr_offline_cache_v1';
const STORAGE_KEY_LOCAL_META = 'mantis_cr_offline_meta_v1';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    console.warn('Failed to load settings from storage', e);
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save settings', e);
  }
}

export function loadBookmarks(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BOOKMARKS);
    if (raw) return new Set(JSON.parse(raw));
  } catch (e) {
    console.warn('Failed to load bookmarks', e);
  }
  return new Set();
}

export function saveBookmarks(bookmarks: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY_BOOKMARKS, JSON.stringify(Array.from(bookmarks)));
  } catch (e) {
    console.warn('Failed to save bookmarks', e);
  }
}

export async function fetchStatus(): Promise<{ meta: SyncMeta; totalCount: number }> {
  const resp = await axios.get(`${API_BASE}/status`);
  return resp.data;
}

export async function fetchAllCRs(): Promise<{ meta: SyncMeta; crs: CRItem[] }> {
  try {
    const resp = await axios.get(`${API_BASE}/crs`, { timeout: 90000 });
    if (resp.data.ok && resp.data.crs) {
      // Save offline snapshot to local storage or IndexedDB if feasible
      try {
        // Only save small meta to localStorage
        localStorage.setItem(STORAGE_KEY_LOCAL_META, JSON.stringify(resp.data.meta));
      } catch (e) {
        // Ignore quota exceeded
      }
      return resp.data;
    }
  } catch (err) {
    console.warn('[API] Server request failed, checking offline storage:', err);
    // If backend is unreachable, return empty or fallback
  }
  return { meta: { status: 'error', totalCount: 0, lastSyncTime: null, error: '서버 연결 실패' }, crs: [] };
}

export async function triggerSync(mantisUrl: string): Promise<{ meta: SyncMeta; count: number }> {
  const resp = await axios.post(`${API_BASE}/sync`, { mantisUrl }, { timeout: 90000 });
  return resp.data;
}

export async function fetchCRDetail(crid: string): Promise<{ cr: CRItem; similar: CRItem[] }> {
  const resp = await axios.get(`${API_BASE}/cr/${crid}`);
  return resp.data;
}

export async function fetchStats(): Promise<StatsData> {
  const resp = await axios.get(`${API_BASE}/stats`);
  return resp.data;
}

export async function queryAI(query: string, contextCrs: CRItem[], aiConfig: AppSettings['ai']): Promise<{ answer: string; matchedCrs?: any[]; provider?: string }> {
  const resp = await axios.post(`${API_BASE}/ai/query`, {
    query,
    crs: contextCrs.slice(0, 20),
    config: aiConfig
  }, { timeout: 60000 });
  return resp.data.result;
}

export async function testSSH(sshConfig: SSHConfig): Promise<{ ok: boolean; message: string }> {
  const resp = await axios.post(`${API_BASE}/ssh/test`, { sshConfig }, { timeout: 12000 });
  return resp.data;
}

export async function fetchFileDiff(sshConfig: SSHConfig, filePath: string, checkinLog?: string): Promise<DiffResult> {
  const resp = await axios.post(`${API_BASE}/ssh/diff`, {
    sshConfig,
    filePath,
    checkinLog
  }, { timeout: 25000 });
  return resp.data;
}

