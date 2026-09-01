import React, { useState, useEffect } from 'react';
import { 
  X, 
  ExternalLink, 
  Bookmark, 
  Copy, 
  Check, 
  FileCode, 
  Calendar, 
  User, 
  Layers, 
  Tag, 
  Bot, 
  Code2, 
  Sparkles,
  GitBranch,
  Eye,
  Clock,
  Building2,
  FolderKanban,
  AlertTriangle,
  Search
} from 'lucide-react';
import { CRItem, SSHConfig } from '../types/cr';
import { SimilarCRs } from './SimilarCRs';
import { FileTreeView } from './FileTreeView';
import { CRCodeChangesView } from './CRCodeChangesView';
import { DiffViewerModal } from './DiffViewerModal';
import { fetchCRDetail } from '../services/api';

interface CRDetailModalProps {
  cr: CRItem | null;
  isOpen?: boolean;
  onClose: () => void;
  allCrs: CRItem[];
  onSelectCR: (cr: CRItem) => void;
  bookmarks: Set<string>;
  onToggleBookmark: (crid: string) => void;
  mantisUrl: string;
  onAskAI: (cr: CRItem) => void;
  isSplitView?: boolean;
  sshConfig?: SSHConfig;
  onOpenSettings?: () => void;
}

export const CRDetailModal: React.FC<CRDetailModalProps> = ({
  cr,
  isOpen = true,
  onClose,
  allCrs,
  onSelectCR,
  bookmarks,
  onToggleBookmark,
  mantisUrl,
  onAskAI,
  isSplitView = false,
  sshConfig,
  onOpenSettings
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'checkin' | 'raw'>('details');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [currentCR, setCurrentCR] = useState<CRItem | null>(cr);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [diffTargetFile, setDiffTargetFile] = useState<string | null>(null);

  useEffect(() => {
    setCurrentCR(cr);
    if (cr && !cr.detailsFetched) {
      setLoadingDetails(true);
      fetchCRDetail(cr.crid)
        .then(res => {
          if (res && res.cr) {
            setCurrentCR(res.cr);
          }
        })
        .catch(err => console.warn('Failed to fetch full CR details:', err))
        .finally(() => setLoadingDetails(false));
    }
  }, [cr]);

  if (!isOpen || !currentCR) return null;
  const crItem = currentCR;
  const isBookmarked = bookmarks.has(crItem.crid);

  const mantisLink = `${mantisUrl.replace(/\/$/, '')}/view.php?id=${crItem.id}`;

  const handleCopy = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 1500);
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

  const content = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/90 flex items-start justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg font-extrabold text-mantis-400">
              #{crItem.crid}
            </span>

            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${getStatusBadgeClass(crItem.status)}`}>
              {crItem.status}
            </span>

            <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700 text-xs font-semibold">
              {crItem.project}
            </span>

            {crItem.customer && (
              <span className="px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/30 text-xs font-bold">
                {crItem.customer}
              </span>
            )}
          </div>

          <h2 className="text-base sm:text-lg font-bold text-white leading-snug break-words">
            {crItem.cleanSummary || crItem.summary}
          </h2>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* AI Analysis Button */}
          <button
            onClick={() => onAskAI(crItem)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500/20 to-purple-500/20 hover:from-indigo-500/30 text-indigo-300 border border-indigo-500/40 text-xs font-semibold transition-all shadow-sm"
            title="AI로 이 CR 원인 및 변경점 분석"
          >
            <Bot className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">AI 분석</span>
          </button>

          {/* Bookmark */}
          <button
            onClick={() => onToggleBookmark(crItem.crid)}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-amber-400 transition-colors"
            title={isBookmarked ? '북마크 해제' : '북마크 추가'}
          >
            <Bookmark className={`w-4 h-4 ${isBookmarked ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>

          {/* Copy CRID */}
          <button
            onClick={() => handleCopy(crItem.crid, 'crid')}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            title="CRID 복사"
          >
            {copiedField === 'crid' ? <Check className="w-4 h-4 text-mantis-400" /> : <Copy className="w-4 h-4" />}
          </button>

          {/* Open in Mantis */}
          <a
            href={mantisLink}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-mantis-400 transition-colors"
            title="Mantis 원본 페이지 열기"
          >
            <ExternalLink className="w-4 h-4" />
          </a>

          {/* Close button (only in modal) */}
          {!isSplitView && (
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-5 border-b border-slate-800 bg-slate-900/60 flex items-center gap-4 text-xs font-semibold overflow-x-auto">
        <button
          onClick={() => setActiveTab('details')}
          className={`py-3 border-b-2 transition-all flex items-center gap-1.5 flex-shrink-0 ${
            activeTab === 'details'
              ? 'border-mantis-400 text-mantis-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Search className="w-3.5 h-3.5 text-mantis-400" />
          원인분석 & 소스 변경점
          {crItem.details?.codeChanges && crItem.details.codeChanges !== '.' && (
            <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
              코드포함
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('overview')}
          className={`py-3 border-b-2 transition-all flex items-center gap-1.5 flex-shrink-0 ${
            activeTab === 'overview'
              ? 'border-mantis-400 text-mantis-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          개요 및 메타데이터
        </button>

        <button
          onClick={() => setActiveTab('checkin')}
          className={`py-3 border-b-2 transition-all flex items-center gap-1.5 flex-shrink-0 ${
            activeTab === 'checkin'
              ? 'border-mantis-400 text-mantis-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileCode className="w-3.5 h-3.5" />
          수정 소스 파일
          {crItem.files && crItem.files.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-mantis-500/20 text-mantis-400 text-[10px]">
              {crItem.files.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('raw')}
          className={`py-3 border-b-2 transition-all flex items-center gap-1.5 flex-shrink-0 ${
            activeTab === 'raw'
              ? 'border-mantis-400 text-mantis-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          Raw Check-in Log
        </button>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {activeTab === 'details' && (
          <CRCodeChangesView 
            cr={crItem} 
            mantisUrl={mantisUrl} 
            onOpenDiff={path => setDiffTargetFile(path)}
          />
        )}

        {activeTab === 'overview' && (
          <div className="space-y-5">
            {/* Raw Full Summary box */}
            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold">
                <span>전체 원본 제목</span>
                <button
                  onClick={() => handleCopy(crItem.summary, 'summary')}
                  className="text-slate-500 hover:text-slate-200 flex items-center gap-1"
                >
                  {copiedField === 'summary' ? <Check className="w-3 h-3 text-mantis-400" /> : <Copy className="w-3 h-3" />}
                  복사
                </button>
              </div>
              <p className="text-xs text-slate-200 font-mono select-all break-all">
                {crItem.summary}
              </p>
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1">
                <span className="text-slate-500 text-[11px] flex items-center gap-1">
                  <User className="w-3 h-3" /> 보고자
                </span>
                <p className="font-semibold text-slate-200">{crItem.reporter || '-'}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1">
                <span className="text-slate-500 text-[11px] flex items-center gap-1">
                  <User className="w-3 h-3" /> 담당자
                </span>
                <p className="font-semibold text-slate-200">{crItem.assignee || '-'}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1">
                <span className="text-slate-500 text-[11px] flex items-center gap-1">
                  <Tag className="w-3 h-3" /> 대상 모듈
                </span>
                <p className="font-semibold text-slate-200">{crItem.module || '-'}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1">
                <span className="text-slate-500 text-[11px] flex items-center gap-1">
                  <Layers className="w-3 h-3" /> 적용 VOB
                </span>
                <p className="font-semibold text-teal-300 font-mono">{crItem.vob || '-'}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1">
                <span className="text-slate-500 text-[11px] flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> 보고 날짜
                </span>
                <p className="font-semibold text-slate-200 font-mono">{crItem.dateSubmitted || '-'}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1">
                <span className="text-slate-500 text-[11px] flex items-center gap-1">
                  <Clock className="w-3 h-3" /> 최종 갱신
                </span>
                <p className="font-semibold text-slate-200 font-mono">{crItem.lastUpdated || '-'}</p>
              </div>
            </div>

            {/* Similar CRs section */}
            <SimilarCRs currentCR={crItem} allCrs={allCrs} onSelectCR={onSelectCR} />
          </div>
        )}

        {activeTab === 'checkin' && (
          <FileTreeView 
            filePaths={crItem.filePaths || []} 
            onOpenDiff={path => setDiffTargetFile(path)}
          />
        )}

        {activeTab === 'raw' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>원본 Check-in Log 텍스트</span>
              {crItem.checkinLog && (
                <button
                  onClick={() => handleCopy(crItem.checkinLog, 'raw_checkin')}
                  className="text-mantis-400 hover:text-mantis-300 flex items-center gap-1 text-xs"
                >
                  {copiedField === 'raw_checkin' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  전체 복사
                </button>
              )}
            </div>

            {crItem.checkinLog ? (
              <pre className="p-4 rounded-xl bg-slate-950 text-emerald-400/90 font-mono text-[11px] leading-relaxed overflow-x-auto border border-slate-800 whitespace-pre-wrap select-all">
                {crItem.checkinLog}
              </pre>
            ) : (
              <div className="p-8 text-center text-slate-500 text-xs">
                Check-in 로그가 비어 있습니다.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Built-in Diff Viewer Modal */}
      <DiffViewerModal
        isOpen={Boolean(diffTargetFile)}
        onClose={() => setDiffTargetFile(null)}
        filePath={diffTargetFile || ''}
        checkinLog={crItem.checkinLog}
        sshConfig={sshConfig}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );

  if (isSplitView) {
    return (
      <div className="h-full glass-panel rounded-2xl border border-slate-800 overflow-hidden">
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150">
      <div 
        className="w-full max-w-3xl max-h-[90vh] glass-panel rounded-3xl border border-slate-700/80 shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {content}
      </div>
    </div>
  );
};
