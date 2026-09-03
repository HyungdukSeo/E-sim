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
  Check
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

  // Top project entries sorted by count
  const sortedProjects = Object.entries(facets.projects)
    .filter(([p]) => !projectSearch || p.toLowerCase().includes(projectSearch.toLowerCase()))
    .sort((a, b) => b[1] - a[1]);

  // Status entries
  const sortedStatuses = Object.entries(facets.statuses)
    .sort((a, b) => b[1] - a[1]);

  // Customer entries
  const sortedCustomers = Object.entries(facets.customers)
    .sort((a, b) => b[1] - a[1]);

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
            className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 py-1 hover:text-main"
          >
            <span className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-amber-400" />
              고객사 / 사이트
            </span>
            {openSections.customers ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {openSections.customers && (
            <div className="mt-2 space-y-1">
              {sortedCustomers.map(([cust, count]) => {
                const isChecked = filterState.customers.includes(cust);
                return (
                  <label
                    key={cust}
                    onClick={() => toggleArrayFilter('customers', cust)}
                    className="flex items-center justify-between text-xs py-1 px-1.5 rounded-lg hover:bg-slate-800/60 cursor-pointer group transition-colors"
                  >
                    <div className="flex items-center gap-2 truncate max-w-[170px]">
                      <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                        isChecked ? 'bg-mantis-500 border-mantis-500 text-slate-950' : 'border-slate-700 bg-slate-900 group-hover:border-slate-600'
                      }`}>
                        {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </div>
                      <span className={`truncate ${isChecked ? 'text-mantis-300 font-semibold' : 'text-slate-300'}`}>{cust}</span>
                    </div>
                    <span className="text-[10px] text-main0 font-mono">{count.toLocaleString()}</span>
                  </label>
                );
              })}
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
