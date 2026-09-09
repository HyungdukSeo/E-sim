export interface CheckinEntry {
  raw: string;
  filePath?: string;
  fileName?: string;
  view?: string;
  timestamp?: string;
  branch?: string;
  user?: string;
}

export interface CRDetails {
  problem?: string;
  cause?: string;
  fix?: string;
  codeChanges?: string;
  dbChanges?: string;
  blocks?: string;
  testProcedure?: string;
  priority?: string;
  issueReason?: string;
}

export interface CRItem {
  crid: string;
  id: number;
  project: string;
  reporter: string;
  assignee: string;
  productVersion: string;
  dateSubmitted: string;
  viewState: string;
  lastUpdated: string;
  summary: string;
  status: string;
  targetVersion: string;
  checkinLog: string;
  customer?: string;
  vob?: string;
  module?: string;
  authorInTitle?: string;
  cleanSummary?: string;
  files?: string[];
  filePaths?: string[];
  checkinEntries?: CheckinEntry[];
  details?: CRDetails;
  detailsFetched?: boolean;
  isBookmarked?: boolean;
}

export interface FilterState {
  searchQuery: string;
  projects: string[];
  statuses: string[];
  customers: string[];
  reporters: string[];
  assignees: string[];
  hasCheckinOnly: boolean;
  vob: string;
  fileKeyword: string;
  startDate: string;
  endDate: string;
  bookmarkedOnly: boolean;
}

export interface SyncMeta {
  lastSyncTime: string | null;
  totalCount: number;
  mantisUrl?: string;
  durationMs?: number;
  addedCount?: number;
  updatedCount?: number;
  unchangedCount?: number;
  dbFilePath?: string;
  status: 'idle' | 'syncing' | 'success' | 'error' | 'cached';
  error?: string;
}

export interface AISettings {
  provider: 'local' | 'custom' | 'openai' | 'gemini' | 'claude' | 'omniroute';
  apiKey: string;
  customUrl: string;
  model: string;
  omnirouteUrl?: string;
  omnirouteApiKey?: string;
  providerModels?: Record<string, string>;
}

export interface SSHConfig {
  id?: string;
  name?: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  enabled: boolean;
  servers?: SSHConfig[];
}

export interface DiffResult {
  ok: boolean;
  filePath: string;
  fileName: string;
  prevVersion: string;
  currVersion: string;
  prevVersionPath: string;
  currVersionPath: string;
  vimdiffCommand?: string;
  oldBase64?: string;
  newBase64?: string;
  oldContent: string;
  newContent: string;
  patch?: any;
  unifiedDiff?: string;
  hasChanges: boolean;
  error?: string;
  serverHost?: string;
  serverName?: string;
  searchedServersCount?: number;
  foundServerIndex?: number;
}

export interface AppSettings {
  mantisUrl: string;
  autoSyncIntervalMin: number;
  ai: AISettings;
  ssh: SSHConfig;
  sshServers?: SSHConfig[];
  theme: 'dark' | 'light';
  itemsPerPage: number;
  diffConcurrency?: number;
}

export interface StatsData {
  total: number;
  byProject: Record<string, number>;
  byStatus: Record<string, number>;
  byCustomer: Record<string, number>;
  byMonth: Record<string, number>;
  topFiles: Array<{ file: string; count: number }>;
  topReporters: Array<{ name: string; count: number }>;
}

export type ViewMode = 'table' | 'grid' | 'split';
export type ActiveTab = 'search' | 'analytics' | 'ai' | 'bookmarks';
