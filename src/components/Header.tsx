import React from 'react';
import { 
  Database, 
  RefreshCw, 
  Search, 
  BarChart3, 
  Bot, 
  Bookmark, 
  Settings, 
  ExternalLink,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { SyncMeta, ActiveTab } from '../types/cr';

interface HeaderProps {
  meta: SyncMeta;
  totalCount: number;
  filteredCount: number;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  onSync: () => void;
  isSyncing: boolean;
  onOpenSettings: () => void;
  onOpenAI: () => void;
  bookmarkedCount: number;
  mantisUrl: string;
}

export const Header: React.FC<HeaderProps> = ({
  meta,
  totalCount,
  filteredCount,
  activeTab,
  setActiveTab,
  onSync,
  isSyncing,
  onOpenSettings,
  onOpenAI,
  bookmarkedCount,
  mantisUrl
}) => {
  // Format last sync time nicely
  const formattedSyncTime = meta.lastSyncTime
    ? new Date(meta.lastSyncTime).toLocaleTimeString('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    : '동기화 기록 없음';

  return (
    <header className="sticky top-0 z-30 glass-header px-4 lg:px-6 py-3 transition-all">
      <div className="max-w-[1700px] mx-auto flex items-center justify-between gap-4">
        
        {/* Left: Branding & Total count */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-mantis-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-mantis-500/20 text-slate-950 font-black text-xl tracking-wider">
            M
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Mantis CR Hub
                <span className="text-xs px-2 py-0.5 rounded-full bg-mantis-500/20 text-mantis-400 border border-mantis-500/30 font-medium">
                  Ultra Fast
                </span>
              </h1>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <Database className="w-3.5 h-3.5 text-mantis-400" />
                <span className="font-semibold text-slate-200">{totalCount.toLocaleString()}</span>건 캐시됨
              </span>
              <span className="text-slate-600">•</span>
              <span className="flex items-center gap-1 truncate max-w-[200px]" title={formattedSyncTime}>
                {meta.status === 'error' ? (
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>동기화: {formattedSyncTime}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Center: Navigation Tabs */}
        <nav className="hidden md:flex items-center p-1 bg-slate-900/80 rounded-xl border border-slate-800 shadow-inner">
          <button
            onClick={() => setActiveTab('search')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'search'
                ? 'bg-mantis-500 text-slate-950 shadow-md shadow-mantis-500/30'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            CR 검색 & 탐색
            {filteredCount !== totalCount && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                activeTab === 'search' ? 'bg-slate-950/20 text-slate-950 font-bold' : 'bg-slate-800 text-mantis-400'
              }`}>
                {filteredCount.toLocaleString()}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('analytics')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'analytics'
                ? 'bg-mantis-500 text-slate-950 shadow-md shadow-mantis-500/30'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            통계 대시보드
          </button>

          <button
            onClick={() => setActiveTab('bookmarks')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'bookmarks'
                ? 'bg-mantis-500 text-slate-950 shadow-md shadow-mantis-500/30'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            북마크
            {bookmarkedCount > 0 && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                activeTab === 'bookmarks' ? 'bg-slate-950/20 text-slate-950 font-bold' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}>
                {bookmarkedCount}
              </span>
            )}
          </button>
        </nav>

        {/* Right: Actions */}
        <div className="flex items-center gap-2.5">
          {/* AI Assistant Button */}
          <button
            onClick={onOpenAI}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500/20 to-purple-500/20 hover:from-indigo-500/30 hover:to-purple-500/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition-all shadow-sm shadow-indigo-500/10 hover:shadow-indigo-500/20 hover:scale-[1.02] active:scale-[0.98]"
            title="AI 검색 및 버그 분석 에이전트"
          >
            <Bot className="w-4 h-4 text-indigo-400 animate-pulse" />
            <span className="hidden sm:inline">AI 에이전트</span>
          </button>

          {/* Sync Button */}
          <button
            onClick={onSync}
            disabled={isSyncing}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              isSyncing
                ? 'bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700'
                : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/40 hover:scale-[1.02] active:scale-[0.98]'
            }`}
            title="Mantis 서버(192.168.16.200)에서 최신 CR 전체 동기화"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isSyncing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isSyncing ? '동기화 중...' : '전체 동기화'}</span>
          </button>

          {/* Mantis Original Web Link */}
          <a
            href={mantisUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 text-xs font-medium transition-all"
            title="Mantis 원본 웹사이트 열기"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 text-xs font-medium transition-all hover:rotate-45"
            title="설정 및 캐시 관리"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

      </div>
    </header>
  );
};
