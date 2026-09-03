import React from 'react';
import { ExternalLink, Bookmark, FileCode, Calendar, User, Tag, Layers } from 'lucide-react';
import { CRItem } from '../types/cr';
import { highlightText } from '../services/searchEngine';

interface CRCardGridProps {
  items: CRItem[];
  selectedCR: CRItem | null;
  onSelectCR: (cr: CRItem) => void;
  bookmarks: Set<string>;
  onToggleBookmark: (crid: string) => void;
  mantisUrl: string;
  searchQuery: string;
}

export const CRCardGrid: React.FC<CRCardGridProps> = ({
  items,
  selectedCR,
  onSelectCR,
  bookmarks,
  onToggleBookmark,
  mantisUrl,
  searchQuery
}) => {
  if (items.length === 0) {
    return (
      <div className="glass-panel p-12 rounded-2xl text-center text-main0">
        <p className="text-sm font-medium">검색 조건과 일치하는 CR이 없습니다.</p>
      </div>
    );
  }

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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
      {items.slice(0, 60).map(cr => {
        const isSelected = selectedCR?.crid === cr.crid;
        const isBookmarked = bookmarks.has(cr.crid);
        const mantisLink = `${mantisUrl.replace(/\/$/, '')}/view.php?id=${cr.id}`;
        const highlightedSummary = highlightText(cr.cleanSummary || cr.summary, searchQuery);

        return (
          <div
            key={cr.crid}
            onClick={() => onSelectCR(cr)}
            className={`glass-card p-4 rounded-2xl cursor-pointer flex flex-col justify-between space-y-3 ${
              isSelected ? 'ring-2 ring-mantis-500 bg-slate-850' : ''
            }`}
          >
            {/* Card Header */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm text-mantis-400">
                    #{cr.crid}
                  </span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                    {cr.project}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onToggleBookmark(cr.crid);
                    }}
                    className="p-1 rounded-lg text-main0 hover:text-amber-400 transition-colors"
                  >
                    <Bookmark className={`w-4 h-4 ${isBookmarked ? 'fill-amber-400 text-amber-400' : ''}`} />
                  </button>

                  <a
                    href={mantisLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="p-1 rounded-lg text-main0 hover:text-mantis-400 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>

              {/* Title & Highlighting */}
              <h3 className="text-sm font-semibold text-slate-100 leading-snug line-clamp-2 mb-2">
                {highlightedSummary.map((part, i) =>
                  part.isMatch ? (
                    <mark key={i} className="search-highlight">{part.text}</mark>
                  ) : (
                    <span key={i}>{part.text}</span>
                  )
                )}
              </h3>

              {/* Tags */}
              <div className="flex flex-wrap gap-1 text-[10px]">
                {cr.customer && (
                  <span className="px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/30 font-bold">
                    {cr.customer}
                  </span>
                )}
                {cr.vob && (
                  <span className="px-2 py-0.5 rounded-md bg-teal-500/15 text-teal-300 border border-teal-500/30 font-medium flex items-center gap-1">
                    <Layers className="w-2.5 h-2.5" />
                    {cr.vob}
                  </span>
                )}
                {cr.module && (
                  <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1">
                    <Tag className="w-2.5 h-2.5" />
                    {cr.module}
                  </span>
                )}
              </div>
            </div>

            {/* Card Footer: Metadata & Status */}
            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3 text-main0" />
                  {cr.reporter || '-'}
                </span>
                <span className="flex items-center gap-1 font-mono text-[11px]">
                  <Calendar className="w-3 h-3 text-main0" />
                  {cr.dateSubmitted || '-'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {cr.files && cr.files.length > 0 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[10px] font-medium">
                    <FileCode className="w-2.5 h-2.5" />
                    {cr.files.length}
                  </span>
                )}

                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${getStatusBadgeClass(cr.status)}`}>
                  {cr.status}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
