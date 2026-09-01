import React, { useRef, useState, useEffect } from 'react';
import { 
  Search, 
  X, 
  Sparkles, 
  LayoutList, 
  LayoutGrid, 
  Columns, 
  FileCode, 
  Tag, 
  Zap,
  ArrowRight,
  RotateCcw
} from 'lucide-react';
import { FilterState, ViewMode } from '../types/cr';

interface SearchBarProps {
  filterState: FilterState;
  onFilterChange: (updater: (prev: FilterState) => FilterState) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  totalMatches: number;
  totalCount: number;
  searchDurationMs: number;
  onOpenAI: () => void;
}

const QUICK_SEARCH_PRESETS = [
  { label: 'KT 최근 이슈', query: 'site:KT' },
  { label: 'LGU+ 최근 이슈', query: 'site:LGU+' },
  { label: 'SKB 최근 이슈', query: 'site:SKB' },
  { label: '미해결 (opened)', query: 'status:opened' },
  { label: '소스 수정 포함', query: 'is:checkin' },
  { label: '타임아웃 관련', query: '타임아웃' },
  { label: '절체 관련', query: '절체' },
  { label: '메모리/누수', query: '메모리' },
];

export const SearchBar: React.FC<SearchBarProps> = ({
  filterState,
  onFilterChange,
  viewMode,
  setViewMode,
  totalMatches,
  totalCount,
  searchDurationMs,
  onOpenAI
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // 1. Independent Local Input State (0ms typing lag, never freezes)
  const [localQuery, setLocalQuery] = useState(filterState.searchQuery);

  // 2. Live Search Mode preference (stored in localStorage)
  const [isLiveSearch, setIsLiveSearch] = useState<boolean>(() => {
    const saved = localStorage.getItem('mantis_live_search');
    return saved !== null ? saved === 'true' : false; // Default: Enter-to-search mode for maximum responsiveness
  });

  // Sync external filter changes to local input
  useEffect(() => {
    setLocalQuery(filterState.searchQuery);
  }, [filterState.searchQuery]);

  // Execute Search explicitly
  const executeSearch = (targetQuery: string) => {
    onFilterChange(prev => ({
      ...prev,
      searchQuery: targetQuery
    }));
  };

  // Debounced Live Search (Only when isLiveSearch is ON)
  useEffect(() => {
    if (!isLiveSearch) return;
    const timer = setTimeout(() => {
      if (localQuery !== filterState.searchQuery) {
        executeSearch(localQuery);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [localQuery, isLiveSearch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeSearch(localQuery);
    }
  };

  const handleToggleLiveSearch = () => {
    const next = !isLiveSearch;
    setIsLiveSearch(next);
    localStorage.setItem('mantis_live_search', String(next));
    if (next) {
      executeSearch(localQuery);
    }
  };

  const handleClear = () => {
    setLocalQuery('');
    executeSearch('');
    inputRef.current?.focus();
  };

  const handleApplyPreset = (query: string) => {
    const next = filterState.searchQuery ? `${filterState.searchQuery} ${query}`.trim() : query;
    setLocalQuery(next);
    executeSearch(next);
  };

  const handleQuickCustomer = (customer: string) => {
    onFilterChange(prev => {
      const exists = prev.customers.includes(customer);
      return {
        ...prev,
        customers: exists
          ? prev.customers.filter(c => c !== customer)
          : [...prev.customers, customer]
      };
    });
  };

  const handleQuickStatus = (status: string) => {
    onFilterChange(prev => {
      const exists = prev.statuses.includes(status);
      return {
        ...prev,
        statuses: exists
          ? prev.statuses.filter(s => s !== status)
          : [...prev.statuses, status]
      };
    });
  };

  const hasPendingChanges = localQuery.trim() !== filterState.searchQuery.trim();

  return (
    <div className="w-full space-y-3">
      {/* Main Search Input & Action Control Bar */}
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1 flex items-center">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-mantis-400 flex items-center justify-center">
            <Search className="w-5 h-5" />
          </div>

          <input
            ref={inputRef}
            type="text"
            value={localQuery}
            onChange={e => setLocalQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="CR 제목, 번호(0016117), 담당자, 작성자, 수정파일명(IudhAsSts.c), 키워드 검색... (Enter 키로 검색)"
            className={`w-full pl-12 pr-28 py-3.5 bg-slate-900/95 hover:bg-slate-900 text-slate-100 text-sm md:text-base rounded-2xl border transition-all outline-none placeholder:text-slate-500 shadow-xl ${
              hasPendingChanges
                ? 'border-mantis-500/80 ring-2 ring-mantis-500/20'
                : 'border-slate-700/80 focus:border-mantis-500/80 focus:ring-4 focus:ring-mantis-500/15'
            }`}
          />

          <div className="absolute right-3 flex items-center gap-1.5">
            {localQuery && (
              <button
                onClick={handleClear}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                title="검색어 지우기"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={onOpenAI}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition-all"
              title="자연어로 질문하고 연관 CR 찾기"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">AI 질의</span>
            </button>
          </div>
        </div>

        {/* Explicit Search Action Button */}
        <button
          onClick={() => executeSearch(localQuery)}
          className={`flex items-center gap-1.5 px-4 py-3.5 rounded-2xl font-bold text-sm transition-all shadow-lg flex-shrink-0 ${
            hasPendingChanges
              ? 'bg-mantis-500 hover:bg-mantis-400 text-slate-950 shadow-mantis-500/25 scale-[1.02]'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
          }`}
          title="검색 실행 (단축키: Enter)"
        >
          <Search className="w-4 h-4" />
          <span>검색</span>
          {hasPendingChanges && (
            <span className="text-[10px] bg-slate-950/40 text-slate-950 font-mono px-1.5 py-0.2 rounded-full font-extrabold hidden md:inline">
              Enter
            </span>
          )}
        </button>

        {/* Live Search Mode Toggle Switch */}
        <button
          onClick={handleToggleLiveSearch}
          className={`flex items-center gap-1.5 px-3 py-3.5 rounded-2xl text-xs font-semibold border transition-all flex-shrink-0 ${
            isLiveSearch
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-sm'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
          title={isLiveSearch ? '실시간 자동 검색 켜짐 (타이핑 시 자동 검색)' : 'Enter 검색 모드 (입력 지연 없음)'}
        >
          <Zap className={`w-3.5 h-3.5 ${isLiveSearch ? 'fill-amber-400 text-amber-400' : ''}`} />
          <span className="hidden lg:inline">실시간 {isLiveSearch ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      {/* Query syntax hints & Quick preset tags */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        
        {/* Preset chips */}
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto py-0.5">
          <span className="text-slate-500 font-medium flex items-center gap-1 mr-1">
            <Tag className="w-3 h-3" /> 추천 검색:
          </span>

          {QUICK_SEARCH_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => handleApplyPreset(preset.query)}
              className="px-2.5 py-1 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-mantis-300 border border-slate-800 hover:border-mantis-500/40 text-[11px] font-medium transition-all"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* View Mode Switcher & Match info */}
        <div className="flex items-center gap-3 ml-auto">
          <div className="text-slate-400 text-xs">
            <span className="font-bold text-mantis-400">{totalMatches.toLocaleString()}</span> / {totalCount.toLocaleString()}건
            <span className="text-slate-600 ml-1.5 font-mono text-[10px]">({searchDurationMs}ms)</span>
          </div>

          <div className="flex items-center p-0.5 bg-slate-900 rounded-xl border border-slate-800">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-lg transition-all ${
                viewMode === 'table' ? 'bg-mantis-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="테이블 뷰"
            >
              <LayoutList className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition-all ${
                viewMode === 'grid' ? 'bg-mantis-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="카드 그리드 뷰"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`p-1.5 rounded-lg transition-all ${
                viewMode === 'split' ? 'bg-mantis-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="분할 상세 뷰"
            >
              <Columns className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

      </div>

      {/* Quick Customer & Status Filter Badges */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/80">
        <span className="text-slate-500 text-xs font-medium">고객사:</span>
        {['KT', 'LGU+', 'SKB', '공통'].map(c => {
          const isSelected = filterState.customers.includes(c);
          return (
            <button
              key={c}
              onClick={() => handleQuickCustomer(c)}
              className={`px-2.5 py-0.8 rounded-full text-xs font-semibold transition-all ${
                isSelected
                  ? 'bg-mantis-500 text-slate-950 shadow-sm shadow-mantis-500/20'
                  : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
              }`}
            >
              {c}
            </button>
          );
        })}

        <span className="text-slate-600 mx-1">|</span>

        <span className="text-slate-500 text-xs font-medium">상태:</span>
        {[
          { key: 'opened', label: '미해결 (opened)', color: 'border-rose-500/40 text-rose-300' },
          { key: 'resolved', label: '해결 (resolved)', color: 'border-emerald-500/40 text-emerald-300' },
          { key: 'submitted', label: '제출 (submitted)', color: 'border-amber-500/40 text-amber-300' },
          { key: 'validated', label: '검증 (validated)', color: 'border-blue-500/40 text-blue-300' }
        ].map(st => {
          const isSelected = filterState.statuses.includes(st.key);
          return (
            <button
              key={st.key}
              onClick={() => handleQuickStatus(st.key)}
              className={`px-2.5 py-0.8 rounded-full text-xs font-medium transition-all ${
                isSelected
                  ? 'bg-mantis-500 text-slate-950 font-bold'
                  : `bg-slate-900/80 hover:bg-slate-800 ${st.color} border border-slate-800`
              }`}
            >
              {st.label}
            </button>
          );
        })}

        <span className="text-slate-600 mx-1">|</span>

        {/* Has Check-in Log Toggle */}
        <button
          onClick={() => onFilterChange(prev => ({ ...prev, hasCheckinOnly: !prev.hasCheckinOnly }))}
          className={`flex items-center gap-1 px-2.5 py-0.8 rounded-full text-xs font-medium transition-all ${
            filterState.hasCheckinOnly
              ? 'bg-mantis-500 text-slate-950 font-bold'
              : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <FileCode className="w-3 h-3" />
          <span>체크인 로그 보유</span>
        </button>
      </div>

    </div>
  );
};
