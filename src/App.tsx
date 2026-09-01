import React, { useState, useEffect, useMemo, useCallback, useDeferredValue } from 'react';
import { 
  CRItem, 
  FilterState, 
  SyncMeta, 
  AppSettings, 
  ViewMode, 
  ActiveTab 
} from './types/cr';
import { 
  fetchAllCRs, 
  triggerSync, 
  loadSettings, 
  saveSettings, 
  loadBookmarks, 
  saveBookmarks,
  DEFAULT_SETTINGS
} from './services/api';
import { filterAndSearchCRs } from './services/searchEngine';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { FilterSidebar } from './components/FilterSidebar';
import { CRListTable } from './components/CRListTable';
import { CRCardGrid } from './components/CRCardGrid';
import { CRDetailModal } from './components/CRDetailModal';
import { Dashboard } from './components/Dashboard';
import { AIAgentModal } from './components/AIAgentModal';
import { SettingsModal } from './components/SettingsModal';
import { Loader2, RefreshCw, AlertCircle, Bookmark } from 'lucide-react';

export function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => loadBookmarks());
  const [allCrs, setAllCrs] = useState<CRItem[]>([]);
  const [meta, setMeta] = useState<SyncMeta>({
    lastSyncTime: null,
    totalCount: 0,
    status: 'idle'
  });
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // View state
  const [activeTab, setActiveTab] = useState<ActiveTab>('search');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [selectedCR, setSelectedCR] = useState<CRItem | null>(null);

  // Modals
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAIOpen, setIsAIOpen] = useState(false);

  // Search & Filter state
  const initialFilterState: FilterState = {
    searchQuery: '',
    projects: [],
    statuses: [],
    customers: [],
    reporters: [],
    assignees: [],
    hasCheckinOnly: false,
    vob: '',
    fileKeyword: '',
    startDate: '',
    endDate: '',
    bookmarkedOnly: false
  };

  const [filterState, setFilterState] = useState<FilterState>(initialFilterState);

  // Load initial data with auto-sync fallback
  const loadData = useCallback(async (isInitial = false) => {
    setLoading(true);
    try {
      const data = await fetchAllCRs();
      const loadedCrs = data.crs || [];
      setAllCrs(loadedCrs);
      setMeta(data.meta || { status: 'idle', totalCount: loadedCrs.length, lastSyncTime: null });

      // If empty on initial load, auto-trigger Mantis sync
      if (isInitial && loadedCrs.length === 0) {
        console.log('[AutoSync] Empty database detected on start. Auto-syncing from Mantis...');
        handleSync();
      }
    } catch (err: any) {
      console.error('Failed to load CR data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  // Handle Sync
  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncToast({ message: 'Mantis 서버(192.168.16.200)에서 7,700여 개 전체 CR 데이터를 자동 수집 및 인덱싱 중입니다...', type: 'success' });

    try {
      const res = await triggerSync(settings.mantisUrl);
      if (res.meta) {
        setMeta(res.meta);
        await loadData(false);
        setSyncToast({
          message: `인덱싱 완료! 총 ${res.count.toLocaleString()}건 저장 완료`,
          type: 'success'
        });
      }
    } catch (err: any) {
      setSyncToast({
        message: `동기화 실패: ${err.message || 'Mantis 서버에 연결할 수 없습니다.'}`,
        type: 'error'
      });
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncToast(null), 4000);
    }
  };

  // Toggle Bookmark
  const handleToggleBookmark = (crid: string) => {
    setBookmarks(prev => {
      const next = new Set(prev);
      if (next.has(crid)) next.delete(crid);
      else next.add(crid);
      saveBookmarks(next);
      return next;
    });
  };

  // Reset Filters
  const handleResetFilters = () => {
    setFilterState(initialFilterState);
  };

  // Save Settings
  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const input = document.querySelector('input[type="text"]') as HTMLInputElement;
        input?.focus();
      } else if (e.key === 'Escape') {
        if (selectedCR) setSelectedCR(null);
        if (isSettingsOpen) setIsSettingsOpen(false);
        if (isAIOpen) setIsAIOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCR, isSettingsOpen, isAIOpen]);

  // Deferred filter state to prevent UI freezing during 7,700+ item search
  const deferredFilterState = useDeferredValue(filterState);

  // Execute in-memory search and dynamic facet computation
  const startTime = performance.now();
  const searchResult = useMemo(() => {
    const effectiveFilter = {
      ...deferredFilterState,
      bookmarkedOnly: activeTab === 'bookmarks' || deferredFilterState.bookmarkedOnly
    };
    return filterAndSearchCRs(allCrs, effectiveFilter, bookmarks);
  }, [allCrs, deferredFilterState, bookmarks, activeTab]);
  const searchDurationMs = Math.max(1, Math.round(performance.now() - startTime));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-mantis-500/30 selection:text-mantis-200">
      
      {/* Toast Notification */}
      {syncToast && (
        <div className="fixed top-16 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-200">
          <div className={`px-4 py-3 rounded-2xl shadow-2xl border flex items-center gap-2.5 text-xs font-semibold backdrop-blur-lg ${
            syncToast.type === 'success'
              ? 'bg-slate-900/90 text-mantis-300 border-mantis-500/40 shadow-mantis-500/10'
              : 'bg-slate-900/90 text-rose-300 border-rose-500/40 shadow-rose-500/10'
          }`}>
            {syncToast.type === 'success' ? (
              <RefreshCw className={`w-4 h-4 text-mantis-400 ${isSyncing ? 'animate-spin' : ''}`} />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400" />
            )}
            <span>{syncToast.message}</span>
          </div>
        </div>
      )}

      {/* 1. Header */}
      <Header
        meta={meta}
        totalCount={allCrs.length}
        filteredCount={searchResult.totalMatches}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onSync={handleSync}
        isSyncing={isSyncing}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenAI={() => setIsAIOpen(true)}
        bookmarkedCount={bookmarks.size}
        mantisUrl={settings.mantisUrl}
      />

      {/* 2. Main Content Area */}
      <main className="flex-1 max-w-[1700px] w-full mx-auto p-3 sm:p-5 lg:p-6 flex flex-col space-y-4">
        
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-32 space-y-4">
            <Loader2 className="w-10 h-10 text-mantis-400 animate-spin" />
            <p className="text-sm font-semibold text-slate-300">
              로컬 데이터베이스({meta.totalCount.toLocaleString()}건)를 메모리에 인덱싱하는 중...
            </p>
          </div>
        ) : (
          <>
            {/* SEARCH / BOOKMARKS TAB */}
            {(activeTab === 'search' || activeTab === 'bookmarks') && (
              <div className="space-y-4">
                
                {/* Search Bar */}
                <SearchBar
                  filterState={filterState}
                  onFilterChange={setFilterState}
                  viewMode={viewMode}
                  setViewMode={setViewMode}
                  totalMatches={searchResult.totalMatches}
                  totalCount={allCrs.length}
                  searchDurationMs={searchDurationMs}
                  onOpenAI={() => setIsAIOpen(true)}
                />

                {/* Content Layout: Sidebar + List / Split Pane */}
                <div className="flex gap-5 items-start">
                  
                  {/* Left Facet Filters Sidebar */}
                  <FilterSidebar
                    filterState={filterState}
                    onFilterChange={setFilterState}
                    facets={searchResult.facets}
                    totalCount={allCrs.length}
                    onResetFilters={handleResetFilters}
                  />

                  {/* Right Results Pane */}
                  <div className="flex-1 min-w-0">
                    {viewMode === 'split' ? (
                      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 h-[calc(100vh-250px)]">
                        <div className="xl:col-span-6 h-full overflow-y-auto pr-1">
                          <CRListTable
                            items={searchResult.items}
                            selectedCR={selectedCR}
                            onSelectCR={setSelectedCR}
                            bookmarks={bookmarks}
                            onToggleBookmark={handleToggleBookmark}
                            mantisUrl={settings.mantisUrl}
                            searchQuery={filterState.searchQuery}
                            itemsPerPage={settings.itemsPerPage}
                          />
                        </div>
                        <div className="xl:col-span-6 h-full">
                          {selectedCR ? (
                            <CRDetailModal
                              cr={selectedCR}
                              onClose={() => setSelectedCR(null)}
                              allCrs={allCrs}
                              onSelectCR={setSelectedCR}
                              bookmarks={bookmarks}
                              onToggleBookmark={handleToggleBookmark}
                              mantisUrl={settings.mantisUrl}
                              sshConfig={settings.ssh}
                              onOpenSettings={() => setIsSettingsOpen(true)}
                              onAskAI={cr => {
                                setSelectedCR(cr);
                                setIsAIOpen(true);
                              }}
                              isSplitView={true}
                            />
                          ) : (
                            <div className="h-full glass-panel rounded-2xl border border-slate-800 flex flex-col items-center justify-center text-slate-500 p-8 text-center space-y-2">
                              <p className="text-sm font-semibold text-slate-400">선택된 CR이 없습니다</p>
                              <p className="text-xs">왼쪽 목록에서 CR을 클릭하면 이곳에 상세 내역 및 Check-in 소스 파일이 표시됩니다.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : viewMode === 'grid' ? (
                      <CRCardGrid
                        items={searchResult.items}
                        selectedCR={selectedCR}
                        onSelectCR={setSelectedCR}
                        bookmarks={bookmarks}
                        onToggleBookmark={handleToggleBookmark}
                        mantisUrl={settings.mantisUrl}
                        searchQuery={filterState.searchQuery}
                      />
                    ) : (
                      <CRListTable
                        items={searchResult.items}
                        selectedCR={selectedCR}
                        onSelectCR={setSelectedCR}
                        bookmarks={bookmarks}
                        onToggleBookmark={handleToggleBookmark}
                        mantisUrl={settings.mantisUrl}
                        searchQuery={filterState.searchQuery}
                        itemsPerPage={settings.itemsPerPage}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ANALYTICS TAB */}
            {activeTab === 'analytics' && (
              <Dashboard
                allCrs={allCrs}
                onApplyFilter={setFilterState}
                onSwitchToSearch={() => setActiveTab('search')}
              />
            )}
          </>
        )}

      </main>

      {/* 3. Detail Modal (When not in split view) */}
      {viewMode !== 'split' && selectedCR && (
        <CRDetailModal
          cr={selectedCR}
          onClose={() => setSelectedCR(null)}
          allCrs={allCrs}
          onSelectCR={setSelectedCR}
          bookmarks={bookmarks}
          onToggleBookmark={handleToggleBookmark}
          mantisUrl={settings.mantisUrl}
          sshConfig={settings.ssh}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onAskAI={cr => {
            setSelectedCR(cr);
            setIsAIOpen(true);
          }}
          isSplitView={false}
        />
      )}

      {/* 4. AI Assistant Modal */}
      <AIAgentModal
        isOpen={isAIOpen}
        onClose={() => setIsAIOpen(false)}
        allCrs={allCrs}
        filteredCrs={searchResult.items}
        selectedCR={selectedCR}
        onSelectCR={cr => {
          setSelectedCR(cr);
        }}
        aiSettings={settings.ai}
        sshConfig={settings.ssh}
        onOpenSettings={() => {
          setIsAIOpen(false);
          setIsSettingsOpen(true);
        }}
        mantisUrl={settings.mantisUrl}
        bookmarks={bookmarks}
        onToggleBookmark={handleToggleBookmark}
      />

      {/* 5. Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
        meta={meta}
        onRefreshData={loadData}
      />

    </div>
  );
}

export default App;
