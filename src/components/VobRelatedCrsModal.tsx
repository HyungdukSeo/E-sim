import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, Search, GitBranch, CheckCircle2, Clock, AlertTriangle, 
  ExternalLink, User, Calendar, FileCode, Layers, ArrowUpDown
} from 'lucide-react';
import { VobRelatedCR } from '../services/api';

interface VobRelatedCrsModalProps {
  isOpen: boolean;
  onClose: () => void;
  vobName: string;
  relatedCrs: VobRelatedCR[];
  onSelectCR?: (crid: string) => void;
}

type FilterTab = 'all' | 'cached' | 'uncached';
type SortOrder = 'date_desc' | 'files_desc' | 'crid_desc';

export const VobRelatedCrsModal: React.FC<VobRelatedCrsModalProps> = ({
  isOpen,
  onClose,
  vobName,
  relatedCrs,
  onSelectCR
}) => {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<FilterTab>('all');
  const [sortBy, setSortBy] = useState<SortOrder>('date_desc');

  // ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Statistics
  const stats = useMemo(() => {
    const total = relatedCrs.length;
    const cached = relatedCrs.filter(c => c.isCached && !c.isPartial).length;
    const partial = relatedCrs.filter(c => c.isPartial).length;
    const uncached = relatedCrs.filter(c => !c.isCached).length;
    return { total, cached, partial, uncached, needsAttention: partial + uncached };
  }, [relatedCrs]);

  // Filter & Sort
  const filteredCrs = useMemo(() => {
    let result = [...relatedCrs];

    // Filter by tab
    if (tab === 'cached') {
      result = result.filter(c => c.isCached && !c.isPartial);
    } else if (tab === 'uncached') {
      result = result.filter(c => !c.isCached || c.isPartial);
    }

    // Filter by query
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(c => 
        c.crid.toLowerCase().includes(q) ||
        (c.id && String(c.id).includes(q)) ||
        c.summary.toLowerCase().includes(q) ||
        c.reporter.toLowerCase().includes(q) ||
        c.customer.toLowerCase().includes(q) ||
        c.module.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === 'files_desc') {
        return b.fileCount - a.fileCount;
      }
      if (sortBy === 'crid_desc') {
        return String(b.crid).localeCompare(String(a.crid));
      }
      // date_desc
      const ta = new Date(a.dateSubmitted || a.lastUpdated || 0).getTime() || 0;
      const tb = new Date(b.dateSubmitted || b.lastUpdated || 0).getTime() || 0;
      return tb - ta;
    });

    return result;
  }, [relatedCrs, tab, query, sortBy]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-mantis-500/10 border border-mantis-500/20 text-mantis-400 shrink-0">
              <GitBranch className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-100 font-mono truncate">
                  {vobName}
                </h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-mantis-500/15 border border-mantis-500/30 text-mantis-400 font-mono font-semibold">
                  관련 CR {stats.total.toLocaleString()}건
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                이 VOB 소스코드를 수정한 전체 CR 카드 목록 및 수집 상태
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0"
            title="닫기 (ESC)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar: Search, Filter Tabs & Sort */}
        <div className="px-5 py-3 border-b border-slate-800 bg-slate-900/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="CR 번호, 제목, 보고자, 모듈 검색..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-slate-950 border border-slate-700/80 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-mantis-500/60 focus:ring-1 focus:ring-mantis-500/30 transition-all font-sans"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filter Tabs & Sort Dropdown */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {/* Tabs */}
            <div className="flex items-center p-0.5 bg-slate-950 rounded-lg border border-slate-800 text-xs">
              <button
                onClick={() => setTab('all')}
                className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                  tab === 'all'
                    ? 'bg-slate-800 text-slate-100 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                전체 ({stats.total})
              </button>
              <button
                onClick={() => setTab('cached')}
                className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                  tab === 'cached'
                    ? 'bg-emerald-500/20 text-emerald-300 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                수집완료 ({stats.cached})
              </button>
              <button
                onClick={() => setTab('uncached')}
                className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                  tab === 'uncached'
                    ? 'bg-amber-500/20 text-amber-300 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                미수집·부분 ({stats.needsAttention})
              </button>
            </div>

            {/* Sort Select */}
            <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-xs text-slate-300">
              <ArrowUpDown className="w-3 h-3 text-slate-400 shrink-0" />
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as SortOrder)}
                className="bg-transparent border-none text-xs text-slate-300 focus:outline-none cursor-pointer pr-1"
              >
                <option value="date_desc" className="bg-slate-900 text-slate-200">최신 등록순</option>
                <option value="files_desc" className="bg-slate-900 text-slate-200">VOB 파일 많은순</option>
                <option value="crid_desc" className="bg-slate-900 text-slate-200">CR 번호순</option>
              </select>
            </div>
          </div>
        </div>

        {/* Card List Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {filteredCrs.length === 0 ? (
            <div className="py-16 text-center text-slate-500 flex flex-col items-center justify-center">
              <Layers className="w-10 h-10 stroke-[1.5] text-slate-600 mb-2" />
              <p className="text-sm">조건에 일치하는 관련 CR이 없습니다.</p>
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="mt-2 text-xs text-mantis-400 hover:underline"
                >
                  검색어 초기화
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {filteredCrs.map(cr => {
                const isCached = cr.isCached && !cr.isPartial;
                const isPartial = cr.isPartial;

                return (
                  <div
                    key={cr.crid}
                    onClick={() => {
                      if (onSelectCR) {
                        onSelectCR(cr.crid);
                        onClose();
                      }
                    }}
                    className="group relative p-3.5 rounded-xl bg-slate-950/70 hover:bg-slate-850/90 border border-slate-800 hover:border-mantis-500/50 shadow-sm transition-all duration-150 cursor-pointer flex flex-col justify-between gap-2.5"
                  >
                    {/* Top Row: CR ID, Badges & Status */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-xs font-bold text-mantis-400 group-hover:text-mantis-300 transition-colors">
                          #{cr.crid}
                        </span>
                        {cr.customer && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-medium">
                            {cr.customer}
                          </span>
                        )}
                        {cr.module && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-medium">
                            {cr.module}
                          </span>
                        )}
                      </div>

                      {/* Collection Status Badge */}
                      <div className="shrink-0">
                        {isCached && (
                          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            수집완료
                          </span>
                        )}
                        {isPartial && (
                          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-400 font-medium">
                            <Clock className="w-3 h-3 text-orange-400" />
                            일부수집
                          </span>
                        )}
                        {!cr.isCached && (
                          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 font-medium">
                            <AlertTriangle className="w-3 h-3 text-amber-400" />
                            미수집
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Summary */}
                    <div className="text-xs text-slate-200 group-hover:text-white line-clamp-2 leading-relaxed transition-colors font-medium">
                      {cr.summary || '(제목 없음)'}
                    </div>

                    {/* Bottom Metadata & Action */}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-850/80 text-[11px] text-slate-400">
                      <div className="flex items-center gap-3 flex-wrap">
                        {cr.reporter && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3 text-slate-500" />
                            {cr.reporter}
                          </span>
                        )}
                        {cr.dateSubmitted && (
                          <span className="flex items-center gap-1 font-mono text-[10px]">
                            <Calendar className="w-3 h-3 text-slate-500" />
                            {cr.dateSubmitted.slice(0, 10)}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-slate-400 font-mono text-[10px]" title="이 VOB에서 변경된 파일 개수">
                          <FileCode className="w-3 h-3 text-cyan-400" />
                          <span className="text-cyan-300 font-semibold">{cr.fileCount}개</span>
                          <span className="text-slate-500">/ 전{cr.totalFiles}개</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-1 text-[10px] text-mantis-400 group-hover:translate-x-0.5 transition-transform font-medium">
                        <span>상세 보기</span>
                        <ExternalLink className="w-3 h-3" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <div>
            표시 중: <span className="font-mono font-bold text-slate-200">{filteredCrs.length}</span> / {stats.total}건
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
