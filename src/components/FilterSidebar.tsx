import React, { useState } from 'react';
import { 
  Filter, 
  RotateCcw, 
  ChevronDown, 
  ChevronRight, 
  FolderKanban, 
  Activity, 
  Users, 
  UserCheck, 
  Building2, 
  Calendar,
  Layers,
  FileSearch,
  Check,
  Search,
  X,
  ChevronsUpDown,
  Sparkles,
  SortAsc
} from 'lucide-react';
import { FilterState } from '../types/cr';

interface FilterSidebarProps {
  filterState: FilterState;
  onFilterChange: (updater: (prev: FilterState) => FilterState) => void;
  facets: {
    projects: Record<string, number>;
    statuses: Record<string, number>;
    customers: Record<string, number>;
    reporters: Record<string, number>;
    assignees: Record<string, number>;
    withCheckinCount: number;
  };
  totalCount: number;
  onResetFilters: () => void;
}

export const FilterSidebar: React.FC<FilterSidebarProps> = ({
  filterState,
  onFilterChange,
  facets,
  totalCount,
  onResetFilters
}) => {
  const [openSections, setOpenSections] = useState({
    projects: true,
    statuses: true,
    customers: true,
    reporters: false,
    assignees: false,
    vob: false,
    date: false
  });

  const [projectSearch, setProjectSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerViewMode, setCustomerViewMode] = useState<'grouped' | 'top'>('grouped');
  const [expandedCustomerGroups, setExpandedCustomerGroups] = useState<Record<string, boolean>>({});
  const [selectedCustomerInitial, setSelectedCustomerInitial] = useState<string | null>(null);
  const [reporterSearch, setReporterSearch] = useState('');
  const [assigneeSearch, setAssigneeSearch] = useState('');

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleArrayFilter = (field: 'projects' | 'statuses' | 'customers' | 'reporters' | 'assignees', value: string) => {
    onFilterChange(prev => {
      const list = prev[field];
      const exists = list.includes(value);
      return {
        ...prev,
        [field]: exists ? list.filter(item => item !== value) : [...list, value]
      };
    });
  };

  // Helper: extract initial char for grouping (English A-Z, Korean Chosung ㄱ-ㅎ, Number 0-9, or #)
  const getCustomerGroupKey = (name: string): string => {
    if (!name || !name.trim()) return '#';
    const first = name.trim()[0];

    if (/^[A-Za-z]/.test(first)) {
      return first.toUpperCase();
    }

    const code = first.charCodeAt(0) - 0xac00;
    if (code >= 0 && code <= 11171) {
      const CHOSUNG = [
        'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
        'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
      ];
      const choIdx = Math.floor(code / (21 * 28));
      const ch = CHOSUNG[choIdx] || '#';
      if (ch === 'ㄲ') return 'ㄱ';
      if (ch === 'ㄸ') return 'ㄷ';
      if (ch === 'ㅃ') return 'ㅂ';
      if (ch === 'ㅆ') return 'ㅅ';
      if (ch === 'ㅉ') return 'ㅈ';
      return ch;
    }

    if (/^[0-9]/.test(first)) {
      return '0-9';
    }

    return '#';
  };

  // Top project entries sorted by count
  const sortedProjects = Object.entries(facets.projects)
    .filter(([p]) => !projectSearch || p.toLowerCase().includes(projectSearch.toLowerCase()))
    .sort((a, b) => b[1] - a[1]);

  // Status entries
  const sortedStatuses = Object.entries(facets.statuses)
    .sort((a, b) => b[1] - a[1]);

  // Customer entries & grouping
  const allCustomerEntries = Object.entries(facets.customers);

  // Filtered by search
  const filteredCustomers = allCustomerEntries.filter(([cust]) =>
    !customerSearch || cust.toLowerCase().includes(customerSearch.toLowerCase())
  );

  // Top list (highest counts, top 20)
  const topCustomers = [...filteredCustomers]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  // Grouped by initial letter
  const customerGroupsMap: Record<string, [string, number][]> = {};
  filteredCustomers.forEach(([cust, count]) => {
    const key = getCustomerGroupKey(cust);
    if (!customerGroupsMap[key]) {
      customerGroupsMap[key] = [];
    }
    customerGroupsMap[key].push([cust, count]);
  });

  // Sort inside each group: by count descending, then by name
  Object.keys(customerGroupsMap).forEach(k => {
    customerGroupsMap[k].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  });

  // Group keys sorted: English A-Z -> Korean ㄱ-ㅎ -> 0-9 -> #
  const sortedGroupKeys = Object.keys(customerGroupsMap).sort((a, b) => {
    const isEngA = /^[A-Z]/.test(a);
    const isEngB = /^[A-Z]/.test(b);
    if (isEngA && !isEngB) return -1;
    if (!isEngA && isEngB) return 1;
    if (isEngA && isEngB) return a.localeCompare(b);

    const isKorA = /^[ㄱ-ㅎ]/.test(a);
    const isKorB = /^[ㄱ-ㅎ]/.test(b);
    if (isKorA && !isKorB) return -1;
    if (!isKorA && isKorB) return 1;
    if (isKorA && isKorB) return a.localeCompare(b, 'ko');

    if (a === '0-9') return -1;
    if (b === '0-9') return 1;

    return a.localeCompare(b);
  });

  // All available initials across entire dataset for quick jump chips
  const allAvailableInitials = Array.from(
    new Set(allCustomerEntries.map(([cust]) => getCustomerGroupKey(cust)))
  ).sort((a, b) => {
    const isEngA = /^[A-Z]/.test(a);
    const isEngB = /^[A-Z]/.test(b);
    if (isEngA && !isEngB) return -1;
    if (!isEngA && isEngB) return 1;
    if (isEngA && isEngB) return a.localeCompare(b);

    const isKorA = /^[ㄱ-ㅎ]/.test(a);
    const isKorB = /^[ㄱ-ㅎ]/.test(b);
    if (isKorA && !isKorB) return -1;
    if (!isKorA && isKorB) return 1;
    if (isKorA && isKorB) return a.localeCompare(b, 'ko');

    if (a === '0-9') return -1;
    if (b === '0-9') return 1;

    return a.localeCompare(b);
  });

  const toggleCustomerGroup = (key: string) => {
    setExpandedCustomerGroups(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const expandAllCustomerGroups = () => {
    const next: Record<string, boolean> = {};
    sortedGroupKeys.forEach(k => { next[k] = true; });
    setExpandedCustomerGroups(next);
  };

  const collapseAllCustomerGroups = () => {
    setExpandedCustomerGroups({});
  };

  // Reporters
  const sortedReporters = Object.entries(facets.reporters)
    .filter(([r]) => !reporterSearch || r.toLowerCase().includes(reporterSearch.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  // Assignees
  const sortedAssignees = Object.entries(facets.assignees)
    .filter(([a]) => !assigneeSearch || a.toLowerCase().includes(assigneeSearch.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const hasActiveFilters = 
    filterState.projects.length > 0 ||
    filterState.statuses.length > 0 ||
    filterState.customers.length > 0 ||
    filterState.reporters.length > 0 ||
    filterState.assignees.length > 0 ||
    filterState.hasCheckinOnly ||
    !!filterState.vob ||
    !!filterState.startDate ||
    !!filterState.endDate ||
    !!filterState.fileKeyword;

  return (
    <aside className="w-64 lg:w-72 flex-shrink-0 space-y-4">
      {/* Header */}
      <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
            <Filter className="w-4 h-4 text-mantis-400" />
            <span>다차원 상세 필터</span>
          </div>

          {hasActiveFilters && (
            <button
              onClick={onResetFilters}
              className="flex items-center gap-1 text-xs text-mantis-400 hover:text-mantis-300 font-medium hover:underline transition-all"
            >
              <RotateCcw className="w-3 h-3" />
              초기화
            </button>
          )}
        </div>

        {/* 1. Projects Filter Section */}
        <div className="pt-2 border-t border-slate-800/80">
          <button
            onClick={() => toggleSection('projects')}
            className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 py-1 hover:text-main"
          >
            <span className="flex items-center gap-1.5">
              <FolderKanban className="w-3.5 h-3.5 text-blue-400" />
              프로젝트 ({Object.keys(facets.projects).length})
            </span>
            {openSections.projects ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {openSections.projects && (
            <div className="mt-2 space-y-1">
              {Object.keys(facets.projects).length > 8 && (
                <input
                  type="text"
                  placeholder="프로젝트 검색..."
                  value={projectSearch}
                  onChange={e => setProjectSearch(e.target.value)}
                  className="w-full px-2.5 py-1 text-xs bg-slate-900/90 text-slate-200 rounded-lg border border-slate-800 focus:border-mantis-500/50 outline-none mb-1.5"
                />
              )}
              <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                {sortedProjects.map(([proj, count]) => {
                  const isChecked = filterState.projects.includes(proj);
                  return (
                    <label
                      key={proj}
                      onClick={() => toggleArrayFilter('projects', proj)}
                      className="flex items-center justify-between text-xs py-1 px-1.5 rounded-lg hover:bg-slate-800/60 cursor-pointer group transition-colors"
                    >
                      <div className="flex items-center gap-2 truncate max-w-[170px]">
                        <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                          isChecked ? 'bg-mantis-500 border-mantis-500 text-slate-950' : 'border-slate-700 bg-slate-900 group-hover:border-slate-600'
                        }`}>
                          {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </div>
                        <span className={`truncate ${isChecked ? 'text-mantis-300 font-semibold' : 'text-slate-300'}`}>{proj}</span>
                      </div>
                      <span className="text-[10px] text-main0 font-mono">{count.toLocaleString()}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 2. Statuses Filter Section */}
        <div className="pt-2 border-t border-slate-800/80">
          <button
            onClick={() => toggleSection('statuses')}
            className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 py-1 hover:text-main"
          >
            <span className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              상태 (Status)
            </span>
            {openSections.statuses ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {openSections.statuses && (
            <div className="mt-2 space-y-1">
              {sortedStatuses.map(([st, count]) => {
                const isChecked = filterState.statuses.includes(st);
                return (
                  <label
                    key={st}
                    onClick={() => toggleArrayFilter('statuses', st)}
                    className="flex items-center justify-between text-xs py-1 px-1.5 rounded-lg hover:bg-slate-800/60 cursor-pointer group transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                        isChecked ? 'bg-mantis-500 border-mantis-500 text-slate-950' : 'border-slate-700 bg-slate-900 group-hover:border-slate-600'
                      }`}>
                        {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </div>
                      <span className={`capitalize ${isChecked ? 'text-mantis-300 font-semibold' : 'text-slate-300'}`}>{st}</span>
                    </div>
                    <span className="text-[10px] text-main0 font-mono">{count.toLocaleString()}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* 3. Customer Sites Section */}
        <div className="pt-2 border-t border-slate-800/80">
          <button
            onClick={() => toggleSection('customers')}
            className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 py-1 hover:text-main group"
          >
            <span className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-amber-400" />
              <span>고객사 / 사이트</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800/90 text-slate-400 font-mono">
                {allCustomerEntries.length}
              </span>
            </span>
            {openSections.customers ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {openSections.customers && (
            <div className="mt-2 space-y-2">
              {/* 3.1 Search Input */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="고객사 / 사이트 검색..."
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-900/90 text-slate-200 rounded-lg border border-slate-800 focus:border-mantis-500/50 outline-none transition-all placeholder:text-slate-500"
                />
                {customerSearch && (
                  <button
                    onClick={() => setCustomerSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-0.5"
                    title="검색어 지우기"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* 3.2 Active Selected Customer Badges */}
              {filterState.customers.length > 0 && (
                <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800/90 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-medium">선택된 고객사 ({filterState.customers.length})</span>
                    <button
                      onClick={() => onFilterChange(prev => ({ ...prev, customers: [] }))}
                      className="text-[10px] text-red-400 hover:text-red-300 font-semibold"
                    >
                      전체 해제
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                    {filterState.customers.map(c => (
                      <span
                        key={c}
                        onClick={() => toggleArrayFilter('customers', c)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-mantis-500/10 text-mantis-300 border border-mantis-500/30 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30 cursor-pointer transition-all"
                        title="클릭하여 해제"
                      >
                        <span className="truncate max-w-[120px]">{c}</span>
                        <X className="w-2.5 h-2.5" />
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 3.3 View Mode & Collapse/Expand Controls */}
              <div className="flex items-center justify-between text-[11px] pt-0.5">
                <div className="flex items-center gap-1 bg-slate-900/90 p-0.5 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => { setCustomerViewMode('grouped'); setSelectedCustomerInitial(null); }}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      customerViewMode === 'grouped'
                        ? 'bg-slate-800 text-mantis-300 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    자모/그룹별
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCustomerViewMode('top'); setSelectedCustomerInitial(null); }}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      customerViewMode === 'top'
                        ? 'bg-slate-800 text-mantis-300 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    인기순 Top
                  </button>
                </div>

                {customerViewMode === 'grouped' && !customerSearch && (
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                    <button
                      onClick={expandAllCustomerGroups}
                      className="hover:text-mantis-400 transition-colors"
                      title="모든 그룹 펼치기"
                    >
                      모두 펼침
                    </button>
                    <span>/</span>
                    <button
                      onClick={collapseAllCustomerGroups}
                      className="hover:text-mantis-400 transition-colors"
                      title="모든 그룹 접기"
                    >
                      접기
                    </button>
                  </div>
                )}
              </div>

              {/* 3.4 Quick Initial Jump Chips (only in grouped mode) */}
              {customerViewMode === 'grouped' && !customerSearch && (
                <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar text-[10px]">
                  <button
                    type="button"
                    onClick={() => setSelectedCustomerInitial(null)}
                    className={`px-1.5 py-0.5 rounded shrink-0 transition-colors ${
                      selectedCustomerInitial === null
                        ? 'bg-mantis-500 text-slate-950 font-bold'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    전체
                  </button>
                  {allAvailableInitials.map(initial => {
                    const isSelected = selectedCustomerInitial === initial;
                    const hasItems = !!customerGroupsMap[initial];
                    if (!hasItems) return null;
                    return (
                      <button
                        key={initial}
                        type="button"
                        onClick={() => setSelectedCustomerInitial(isSelected ? null : initial)}
                        className={`px-1.5 py-0.5 rounded shrink-0 transition-colors ${
                          isSelected
                            ? 'bg-mantis-500 text-slate-950 font-bold'
                            : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                        }`}
                      >
                        {initial}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 3.5 Grouped List or Top List Container */}
              <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1 text-xs">
                {/* Mode A: Grouped by Initial Letter Accordion */}
                {customerViewMode === 'grouped' && (
                  <>
                    {sortedGroupKeys.length === 0 ? (
                      <div className="py-4 text-center text-slate-400 text-xs font-mono">
                        검색 결과가 없습니다.
                      </div>
                    ) : (
                      sortedGroupKeys
                        .filter(key => selectedCustomerInitial === null || selectedCustomerInitial === key)
                        .map(groupKey => {
                          const items = customerGroupsMap[groupKey] || [];
                          const isGroupOpen = customerSearch ? true : (selectedCustomerInitial === groupKey ? true : !!expandedCustomerGroups[groupKey]);
                          const selectedInGroupCount = items.filter(([c]) => filterState.customers.includes(c)).length;

                          return (
                            <div
                              key={groupKey}
                              className="rounded-xl border border-slate-800/80 bg-slate-950/40 overflow-hidden"
                            >
                              {/* Group Header (Click to toggle) */}
                              <button
                                type="button"
                                onClick={() => toggleCustomerGroup(groupKey)}
                                className="w-full flex items-center justify-between px-2 py-1.5 bg-slate-900/60 hover:bg-slate-900 text-slate-300 transition-colors"
                              >
                                <div className="flex items-center gap-1.5 font-bold text-xs font-mono">
                                  {isGroupOpen ? (
                                    <ChevronDown className="w-3 h-3 text-slate-400" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 text-slate-400" />
                                  )}
                                  <span className="text-amber-400">{groupKey}</span>
                                  <span className="text-[10px] text-slate-400 font-normal">
                                    ({items.length}개)
                                  </span>
                                  {selectedInGroupCount > 0 && (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-mantis-500/20 text-mantis-300 font-semibold border border-mantis-500/30">
                                      {selectedInGroupCount}선택
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {items.reduce((acc, cur) => acc + cur[1], 0).toLocaleString()}건
                                </span>
                              </button>

                              {/* Group Items (Shown when open) */}
                              {isGroupOpen && (
                                <div className="p-1 space-y-0.5 bg-slate-950/60">
                                  {items.map(([cust, count]) => {
                                    const isChecked = filterState.customers.includes(cust);
                                    return (
                                      <label
                                        key={cust}
                                        onClick={() => toggleArrayFilter('customers', cust)}
                                        className={`flex items-center justify-between py-1 px-1.5 rounded-lg hover:bg-slate-800/60 cursor-pointer group transition-colors ${
                                          isChecked ? 'bg-mantis-500/10' : ''
                                        }`}
                                      >
                                        <div className="flex items-center gap-2 truncate max-w-[170px]">
                                          <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                                            isChecked
                                              ? 'bg-mantis-500 border-mantis-500 text-slate-950'
                                              : 'border-slate-700 bg-slate-900 group-hover:border-slate-600'
                                          }`}>
                                            {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                          </div>
                                          <span className={`truncate text-xs ${isChecked ? 'text-mantis-300 font-semibold' : 'text-slate-300'}`}>
                                            {cust}
                                          </span>
                                        </div>
                                        <span className="text-[10px] text-main0 font-mono">
                                          {count.toLocaleString()}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })
                    )}
                  </>
                )}

                {/* Mode B: Top Count Flat List */}
                {customerViewMode === 'top' && (
                  <div className="space-y-0.5">
                    {topCustomers.length === 0 ? (
                      <div className="py-4 text-center text-slate-400 text-xs font-mono">
                        검색 결과가 없습니다.
                      </div>
                    ) : (
                      topCustomers.map(([cust, count]) => {
                        const isChecked = filterState.customers.includes(cust);
                        return (
                          <label
                            key={cust}
                            onClick={() => toggleArrayFilter('customers', cust)}
                            className={`flex items-center justify-between py-1 px-1.5 rounded-lg hover:bg-slate-800/60 cursor-pointer group transition-colors ${
                              isChecked ? 'bg-mantis-500/10' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate max-w-[170px]">
                              <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                                isChecked
                                  ? 'bg-mantis-500 border-mantis-500 text-slate-950'
                                  : 'border-slate-700 bg-slate-900 group-hover:border-slate-600'
                              }`}>
                                {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                              </div>
                              <span className={`truncate text-xs ${isChecked ? 'text-mantis-300 font-semibold' : 'text-slate-300'}`}>
                                {cust}
                              </span>
                            </div>
                            <span className="text-[10px] text-main0 font-mono">
                              {count.toLocaleString()}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 4. Top Reporters Section */}
        <div className="pt-2 border-t border-slate-800/80">
          <button
            onClick={() => toggleSection('reporters')}
            className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 py-1 hover:text-main"
          >
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-purple-400" />
              보고자 (Reporter)
            </span>
            {openSections.reporters ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {openSections.reporters && (
            <div className="mt-2 space-y-1">
              <input
                type="text"
                placeholder="보고자 검색..."
                value={reporterSearch}
                onChange={e => setReporterSearch(e.target.value)}
                className="w-full px-2.5 py-1 text-xs bg-slate-900/90 text-slate-200 rounded-lg border border-slate-800 focus:border-mantis-500/50 outline-none mb-1.5"
              />
              <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                {sortedReporters.map(([rep, count]) => {
                  const isChecked = filterState.reporters.includes(rep);
                  return (
                    <label
                      key={rep}
                      onClick={() => toggleArrayFilter('reporters', rep)}
                      className="flex items-center justify-between text-xs py-1 px-1.5 rounded-lg hover:bg-slate-800/60 cursor-pointer group transition-colors"
                    >
                      <div className="flex items-center gap-2 truncate max-w-[170px]">
                        <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                          isChecked ? 'bg-mantis-500 border-mantis-500 text-slate-950' : 'border-slate-700 bg-slate-900 group-hover:border-slate-600'
                        }`}>
                          {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </div>
                        <span className={`truncate ${isChecked ? 'text-mantis-300 font-semibold' : 'text-slate-300'}`}>{rep}</span>
                      </div>
                      <span className="text-[10px] text-main0 font-mono">{count.toLocaleString()}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 5. Top Assignees Section */}
        <div className="pt-2 border-t border-slate-800/80">
          <button
            onClick={() => toggleSection('assignees')}
            className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 py-1 hover:text-main"
          >
            <span className="flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-cyan-400" />
              담당자 (Assignee)
            </span>
            {openSections.assignees ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {openSections.assignees && (
            <div className="mt-2 space-y-1">
              <input
                type="text"
                placeholder="담당자 검색..."
                value={assigneeSearch}
                onChange={e => setAssigneeSearch(e.target.value)}
                className="w-full px-2.5 py-1 text-xs bg-slate-900/90 text-slate-200 rounded-lg border border-slate-800 focus:border-mantis-500/50 outline-none mb-1.5"
              />
              <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                {sortedAssignees.map(([asn, count]) => {
                  const isChecked = filterState.assignees.includes(asn);
                  return (
                    <label
                      key={asn}
                      onClick={() => toggleArrayFilter('assignees', asn)}
                      className="flex items-center justify-between text-xs py-1 px-1.5 rounded-lg hover:bg-slate-800/60 cursor-pointer group transition-colors"
                    >
                      <div className="flex items-center gap-2 truncate max-w-[170px]">
                        <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                          isChecked ? 'bg-mantis-500 border-mantis-500 text-slate-950' : 'border-slate-700 bg-slate-900 group-hover:border-slate-600'
                        }`}>
                          {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </div>
                        <span className={`truncate ${isChecked ? 'text-mantis-300 font-semibold' : 'text-slate-300'}`}>{asn}</span>
                      </div>
                      <span className="text-[10px] text-main0 font-mono">{count.toLocaleString()}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 6. VOB & Specific File Keyword */}
        <div className="pt-2 border-t border-slate-800/80">
          <button
            onClick={() => toggleSection('vob')}
            className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 py-1 hover:text-main"
          >
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-teal-400" />
              VOB 및 파일명 필터
            </span>
            {openSections.vob ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {openSections.vob && (
            <div className="mt-2 space-y-2">
              <div>
                <label className="text-[10px] text-slate-400 font-medium mb-1 block">적용 VOB</label>
                <input
                  type="text"
                  placeholder="예: POTS_KT_34A"
                  value={filterState.vob}
                  onChange={e => onFilterChange(p => ({ ...p, vob: e.target.value }))}
                  className="w-full px-2.5 py-1 text-xs bg-slate-900 text-slate-200 rounded-lg border border-slate-800 focus:border-mantis-500/50 outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 font-medium mb-1 block">수정 소스 파일명</label>
                <input
                  type="text"
                  placeholder="예: IudhAsSts.c, swdn.sh"
                  value={filterState.fileKeyword}
                  onChange={e => onFilterChange(p => ({ ...p, fileKeyword: e.target.value }))}
                  className="w-full px-2.5 py-1 text-xs bg-slate-900 text-slate-200 rounded-lg border border-slate-800 focus:border-mantis-500/50 outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* 7. Date Range */}
        <div className="pt-2 border-t border-slate-800/80">
          <button
            onClick={() => toggleSection('date')}
            className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 py-1 hover:text-main"
          >
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-rose-400" />
              보고 날짜 범위
            </span>
            {openSections.date ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {openSections.date && (
            <div className="mt-2 space-y-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">시작일</label>
                <input
                  type="date"
                  value={filterState.startDate}
                  onChange={e => onFilterChange(p => ({ ...p, startDate: e.target.value }))}
                  className="w-full px-2 py-1 text-xs bg-slate-900 text-slate-200 rounded-lg border border-slate-800 focus:border-mantis-500/50 outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">종료일</label>
                <input
                  type="date"
                  value={filterState.endDate}
                  onChange={e => onFilterChange(p => ({ ...p, endDate: e.target.value }))}
                  className="w-full px-2 py-1 text-xs bg-slate-900 text-slate-200 rounded-lg border border-slate-800 focus:border-mantis-500/50 outline-none"
                />
              </div>
            </div>
          )}
        </div>

      </div>
    </aside>
  );
};
