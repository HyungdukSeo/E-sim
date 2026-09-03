import React, { useState } from 'react';
import { 
  ExternalLink, 
  Bookmark, 
  Copy, 
  Check, 
  FileCode, 
  ChevronLeft, 
  ChevronRight, 
  ChevronsLeft, 
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Sparkles
} from 'lucide-react';
import { CRItem } from '../types/cr';
import { highlightText } from '../services/searchEngine';

interface CRListTableProps {
  items: CRItem[];
  selectedCR: CRItem | null;
  onSelectCR: (cr: CRItem) => void;
  bookmarks: Set<string>;
  onToggleBookmark: (crid: string) => void;
  mantisUrl: string;
  searchQuery: string;
  itemsPerPage: number;
}

type SortField = 'id' | 'dateSubmitted' | 'lastUpdated' | 'project' | 'status' | 'reporter' | 'customer';
type SortOrder = 'asc' | 'desc';

export const CRListTable: React.FC<CRListTableProps> = ({
  items,
  selectedCR,
  onSelectCR,
  bookmarks,
  onToggleBookmark,
  mantisUrl,
  searchQuery,
  itemsPerPage: defaultItemsPerPage = 50
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultItemsPerPage);
  const [sortField, setSortField] = useState<SortField>('id');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Sorting
  const sortedItems = [...items].sort((a, b) => {
    let aVal = a[sortField] || '';
    let bVal = b[sortField] || '';

    if (sortField === 'id') {
      return sortOrder === 'asc' ? a.id - b.id : b.id - a.id;
    }

    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();

    if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const pageItems = sortedItems.slice(startIndex, startIndex + pageSize);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const handleCopyId = (e: React.MouseEvent, crid: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(crid);
    setCopiedId(crid);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const getStatusBadgeClass = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('open')) return 'badge-status-opened';
    if (s.includes('resolv')) return 'badge-status-resolved';
    if (s.includes('submit')) return 'badge-status-submitted';
    if (s.includes('validat')) return 'badge-status-validated';
    if (s.includes('live')) return 'badge-status-live';
    if (s.includes('assign')) return 'badge-status-assigned';
    return 'badge-status-postponed';
  };

  const getCustomerBadge = (customer?: string) => {
    if (!customer) return null;
    const c = customer.toUpperCase();
    let color = 'bg-slate-800 text-slate-300 border-slate-700';
    if (c.includes('KT')) color = 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    else if (c.includes('LGU')) color = 'bg-pink-500/15 text-pink-300 border-pink-500/30';
    else if (c.includes('SKB') || c.includes('SKT')) color = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    else if (c.includes('공통')) color = 'bg-blue-500/15 text-blue-300 border-blue-500/30';
    
    return (
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${color}`}>
        {customer}
      </span>
    );
  };

  return (
    <div className="space-y-3">
      {/* Table Container */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            {/* Table Header */}
            <thead>
              <tr className="bg-slate-900/90 text-slate-400 font-semibold border-b border-slate-800 tracking-wide select-none">
                <th className="py-3 px-3 w-10 text-center">★</th>
                
                <th 
                  onClick={() => handleSort('id')}
                  className="py-3 px-3.5 w-24 cursor-pointer hover:text-main transition-colors"
                >
                  <div className="flex items-center gap-1">
                    CRID
                    {sortField === 'id' ? (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-mantis-400" /> : <ArrowDown className="w-3 h-3 text-mantis-400" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                  </div>
                </th>

                <th 
                  onClick={() => handleSort('customer')}
                  className="py-3 px-3 w-20 cursor-pointer hover:text-main transition-colors"
                >
                  고객사
                </th>

                <th 
                  onClick={() => handleSort('project')}
                  className="py-3 px-3 w-28 cursor-pointer hover:text-main transition-colors"
                >
                  <div className="flex items-center gap-1">
                    프로젝트
                    {sortField === 'project' && (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-mantis-400" /> : <ArrowDown className="w-3 h-3 text-mantis-400" />)}
                  </div>
                </th>

                <th 
                  onClick={() => handleSort('status')}
                  className="py-3 px-3 w-24 cursor-pointer hover:text-main transition-colors"
                >
                  <div className="flex items-center gap-1">
                    상태
                    {sortField === 'status' && (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-mantis-400" /> : <ArrowDown className="w-3 h-3 text-mantis-400" />)}
                  </div>
                </th>

                <th className="py-3 px-4 min-w-[340px]">
                  제목 및 요약 (Summary)
                </th>

                <th 
                  onClick={() => handleSort('reporter')}
                  className="py-3 px-3 w-24 cursor-pointer hover:text-main transition-colors"
                >
                  보고자
                </th>

                <th 
                  onClick={() => handleSort('dateSubmitted')}
                  className="py-3 px-3 w-24 cursor-pointer hover:text-main transition-colors"
                >
                  <div className="flex items-center gap-1">
                    보고일
                    {sortField === 'dateSubmitted' && (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-mantis-400" /> : <ArrowDown className="w-3 h-3 text-mantis-400" />)}
                  </div>
                </th>

                <th className="py-3 px-3 w-16 text-center">원문</th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-slate-800/60">
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-main0">
                    <p className="text-sm font-medium">검색 조건과 일치하는 CR이 없습니다.</p>
                    <p className="text-xs mt-1 text-slate-600">검색어를 줄이거나 필터 설정을 변경해 보세요.</p>
                  </td>
                </tr>
              ) : (
                pageItems.map((cr) => {
                  const isSelected = selectedCR?.crid === cr.crid;
                  const isBookmarked = bookmarks.has(cr.crid);
                  const mantisLink = `${mantisUrl.replace(/\/$/, '')}/view.php?id=${cr.id}`;

                  const highlightedSummary = highlightText(cr.cleanSummary || cr.summary, searchQuery);

                  return (
                    <tr
                      key={cr.crid}
                      onClick={() => onSelectCR(cr)}
                      className={`cursor-pointer transition-all duration-150 group ${
                        isSelected
                          ? 'bg-mantis-500/15 text-slate-100 hover:bg-mantis-500/20'
                          : 'hover:bg-slate-800/50 text-slate-300'
                      }`}
                    >
                      {/* Bookmark toggle */}
                      <td className="py-2.5 px-3 text-center" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => onToggleBookmark(cr.crid)}
                          className="text-slate-600 hover:text-amber-400 transition-colors p-0.5"
                          title={isBookmarked ? '북마크 해제' : '북마크 추가'}
                        >
                          <Bookmark className={`w-3.5 h-3.5 ${isBookmarked ? 'fill-amber-400 text-amber-400' : ''}`} />
                        </button>
                      </td>

                      {/* CRID with quick copy */}
                      <td className="py-2.5 px-3.5 font-mono font-bold text-slate-200">
                        <div className="flex items-center gap-1.5">
                          <span className="text-mantis-400 group-hover:text-mantis-300 transition-colors">
                            {cr.crid}
                          </span>
                          <button
                            onClick={e => handleCopyId(e, cr.crid)}
                            className="opacity-0 group-hover:opacity-100 text-main0 hover:text-slate-200 transition-all p-0.5"
                            title="CRID 복사"
                          >
                            {copiedId === cr.crid ? <Check className="w-3 h-3 text-mantis-400" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      </td>

                      {/* Customer */}
                      <td className="py-2.5 px-3">
                        {getCustomerBadge(cr.customer)}
                      </td>

                      {/* Project */}
                      <td className="py-2.5 px-3 font-medium text-slate-300 truncate max-w-[120px]" title={cr.project}>
                        {cr.project}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider ${getStatusBadgeClass(cr.status)}`}>
                          {cr.status}
                        </span>
                      </td>

                      {/* Summary & Module & Modified Files */}
                      <td className="py-2.5 px-4">
                        <div className="space-y-1">
                          <div className="font-medium leading-snug line-clamp-2 text-slate-200 group-hover:text-main">
                            {highlightedSummary.map((part, i) =>
                              part.isMatch ? (
                                <mark key={i} className="search-highlight">{part.text}</mark>
                              ) : (
                                <span key={i}>{part.text}</span>
                              )
                            )}
                          </div>

                          {/* Extra info tags: Module, VOB, Modified Files badge */}
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                            {cr.module && (
                              <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                🏷️ {cr.module}
                              </span>
                            )}
                            {cr.vob && (
                              <span className="px-1.5 py-0.2 rounded bg-slate-800/80 text-teal-300 border border-slate-700">
                                📦 {cr.vob}
                              </span>
                            )}
                            {cr.files && cr.files.length > 0 && (
                              <span className="flex items-center gap-1 px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-medium">
                                <FileCode className="w-2.5 h-2.5" />
                                {cr.files.length}개 파일 수정
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Reporter */}
                      <td className="py-2.5 px-3 text-slate-300">
                        {cr.reporter || '-'}
                      </td>

                      {/* Date Submitted */}
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                        {cr.dateSubmitted || '-'}
                      </td>

                      {/* Original Mantis Link */}
                      <td className="py-2.5 px-3 text-center" onClick={e => e.stopPropagation()}>
                        <a
                          href={mantisLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 rounded-lg hover:bg-slate-800 text-main0 hover:text-mantis-400 transition-colors inline-block"
                          title="Mantis 원본 페이지 열기"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="py-3 px-4 bg-slate-900/80 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span>페이지 당</span>
            <select
              value={pageSize}
              onChange={e => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-2 py-1 outline-none focus:border-mantis-500"
            >
              <option value={25}>25건</option>
              <option value={50}>50건</option>
              <option value={100}>100건</option>
              <option value={200}>200건</option>
            </select>
            <span>
              총 <span className="font-semibold text-slate-200">{sortedItems.length.toLocaleString()}</span>건 중 {startIndex + 1} - {Math.min(startIndex + pageSize, sortedItems.length)}건 표시
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
              title="첫 페이지"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
              title="이전 페이지"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span className="px-2 font-medium text-slate-200">
              {currentPage} / {totalPages}
            </span>

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
              title="다음 페이지"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
              title="마지막 페이지"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
