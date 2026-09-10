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
import { CRItem, SSHConfig, AppSettings } from '../types/cr';
import { SimilarCRs } from './SimilarCRs';
import { FileTreeView } from './FileTreeView';
import { CRCodeChangesView } from './CRCodeChangesView';
import { DiffViewerModal } from './DiffViewerModal';
import { fetchCRDetail, fetchCRDiffCache, analyzeCRDiffAPI, loadSettings } from '../services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2 } from 'lucide-react';

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
  sshServers?: SSHConfig[];
  aiSettings?: AppSettings['ai'];
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
  sshServers,
  aiSettings,
  onOpenSettings
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'checkin' | 'raw' | 'aiDiff'>('details');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [currentCR, setCurrentCR] = useState<CRItem | null>(cr);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [diffTargetFile, setDiffTargetFile] = useState<string | null>(null);

  // AI Diff Analysis state
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<string>('');
  const [analyzingDiff, setAnalyzingDiff] = useState(false);
  const [diffCacheStatus, setDiffCacheStatus] = useState<{ cached: boolean; fileCount?: number } | null>(null);

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

  // Check diff cache status for current CR
  useEffect(() => {
    if (currentCR?.crid) {
      fetchCRDiffCache(currentCR.crid)
        .then(res => {
          if (res && res.ok) {
            setDiffCacheStatus({ cached: res.cached, fileCount: res.data?.fileCount || res.data?.files?.length });
          }
        })
        .catch(() => {});
    }
  }, [currentCR?.crid]);

  const handleRunAIDiffAnalysis = async () => {
    if (!currentCR || analyzingDiff) return;
    setAnalyzingDiff(true);
    setActiveTab('aiDiff');
    try {
      const activeAiConfig = aiSettings || loadSettings().ai;
      const res = await analyzeCRDiffAPI(currentCR, activeAiConfig, sshConfig);
      if (res && res.ok) {
        setAiAnalysis(res.analysis);
        setAiProvider(res.provider);
        setDiffCacheStatus({ cached: true, fileCount: res.fileCount });
      } else {
        setAiAnalysis(`분석 중 오류가 발생했습니다: ${(res as any)?.error || '알 수 없는 오류'}`);
      }
    } catch (err: any) {
      setAiAnalysis(`분석 요청 실패: ${err.message}`);
    } finally {
      setAnalyzingDiff(false);
    }
  };

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

          <h2 className="text-base sm:text-lg font-bold text-main leading-snug break-words">
            {crItem.cleanSummary || crItem.summary}
          </h2>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* AI Code Diff Analysis Button */}
          <button
            onClick={handleRunAIDiffAnalysis}
            disabled={analyzingDiff}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-purple-600/30 to-indigo-600/30 hover:from-purple-600/40 hover:to-indigo-600/40 text-indigo-200 border border-indigo-500/50 text-xs font-bold transition-all shadow-sm group disabled:opacity-50"
            title="실제 파일 Diff를 AI 엔진으로 심층 분석"
          >
            {analyzingDiff ? (
              <Loader2 className="w-3.5 h-3.5 text-indigo-300 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-indigo-300 group-hover:scale-110 transition-transform" />
            )}
            <span className="hidden sm:inline">코드 Diff AI 분석</span>
          </button>

          {/* AI Analysis Button */}
          <button
            onClick={() => onAskAI(crItem)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500/20 to-purple-500/20 hover:from-indigo-500/30 text-indigo-300 border border-indigo-500/40 text-xs font-semibold transition-all shadow-sm"
            title="AI로 이 CR 원인 및 변경점 분석"
          >
            <Bot className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">AI 질의</span>
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
          onClick={() => setActiveTab('aiDiff')}
          className={`py-3 border-b-2 transition-all flex items-center gap-1.5 flex-shrink-0 ${
            activeTab === 'aiDiff'
              ? 'border-indigo-400 text-indigo-300 font-bold'
              : 'border-transparent text-slate-400 hover:text-indigo-300'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          AI 코드 Diff 종합 분석
          {diffCacheStatus?.cached ? (
            <span className="px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-bold flex items-center gap-0.5">
              캐시됨 ⚡
            </span>
          ) : (
            <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 text-[10px] font-semibold">
              온디맨드
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
          <GitBranch className="w-3.5 h-3.5" />
          수정 파일 트리
          {crItem.files && crItem.files.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 text-[10px]">
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
          <div className="space-y-4">
            {/* AI Diff Banner */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-950/50 to-purple-950/50 border border-indigo-500/30 flex flex-wrap items-center justify-between gap-3 shadow-md">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-main flex items-center gap-1.5">
                    실제 소스코드 변경점(Diff) AI 심층 분석 가능
                    {diffCacheStatus?.cached && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                        로컬 캐시됨 ⚡
                      </span>
                    )}
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    수정된 소스 파일들의 Unified Diff를 AI 엔진이 분석하여 버그 원인과 사이드이펙트 리포트를 제공합니다.
                  </p>
                </div>
              </div>
              <button
                onClick={handleRunAIDiffAnalysis}
                disabled={analyzingDiff}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
              >
                {analyzingDiff ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                AI 코드 Diff 분석 실행
              </button>
            </div>

            <CRCodeChangesView 
              cr={crItem} 
              mantisUrl={mantisUrl} 
              onOpenDiff={path => setDiffTargetFile(path)}
            />
          </div>
        )}

        {activeTab === 'aiDiff' && (
          <div className="space-y-4">
            {/* Top Status Banner */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-950/60 to-purple-950/60 border border-indigo-500/30 flex flex-wrap items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 shadow-inner">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-main flex items-center gap-2">
                    실제 소스코드 Diff AI 심층 분석
                    {diffCacheStatus?.cached && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                        로컬 캐시 완료 (0ms 즉시 로드) ⚡
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400">
                    체크인 로그뿐만 아니라 ClearCase 소스 파일의 실제 Unified Diff 코드를 엔진이 직접 읽고 분석합니다.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleRunAIDiffAnalysis}
                  disabled={analyzingDiff}
                  className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-indigo-500/20 transition-all disabled:opacity-50"
                >
                  {analyzingDiff ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {aiAnalysis ? '다시 분석하기' : 'AI 코드 Diff 분석 시작'}
                </button>
              </div>
            </div>

            {/* Loading View */}
            {analyzingDiff && (
              <div className="p-12 glass-panel rounded-2xl border border-indigo-500/30 flex flex-col items-center justify-center gap-3 text-center">
                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-main">소스 파일 Diff를 수집하고 AI 엔진에서 정밀 분석 중입니다...</p>
                  <p className="text-xs text-slate-400">수정된 코드 라인과 분기문을 파악하여 버그 원인과 사이드이펙트를 추출하고 있습니다.</p>
                </div>
              </div>
            )}

            {/* Analysis Result */}
            {!analyzingDiff && aiAnalysis && (
              <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-xs">
                  <span className="text-slate-400 flex items-center gap-1.5 font-semibold">
                    <Bot className="w-4 h-4 text-indigo-400" />
                    AI 엔진 분석 리포트 ({aiProvider})
                  </span>
                  <button
                    onClick={() => handleCopy(aiAnalysis, 'aiAnalysis')}
                    className="flex items-center gap-1 text-slate-400 hover:text-slate-200 text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors"
                  >
                    {copiedField === 'aiAnalysis' ? <Check className="w-3.5 h-3.5 text-mantis-400" /> : <Copy className="w-3.5 h-3.5" />}
                    리포트 복사
                  </button>
                </div>

                <div className="prose prose-invert prose-sm max-w-none text-slate-200 text-xs leading-relaxed space-y-3">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {aiAnalysis}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* Empty State Prompt */}
            {!analyzingDiff && !aiAnalysis && (
              <div className="p-10 border border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center gap-3 text-center">
                <Code2 className="w-10 h-10 text-slate-600" />
                <div className="space-y-1 max-w-md">
                  <h4 className="text-sm font-bold text-slate-300">아직 코드 Diff 분석 리포트가 생성되지 않았습니다</h4>
                  <p className="text-xs text-slate-400">
                    상단의 <strong>[AI 코드 Diff 분석 시작]</strong> 버튼을 누르면 이 CR에서 변경된 소스코드의 전/후 차이점(Diff)을 AI 엔진이 종합 분석해 드립니다.
                  </p>
                </div>
                <button
                  onClick={handleRunAIDiffAnalysis}
                  className="mt-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-indigo-500/20"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  AI 코드 Diff 분석 실행
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'overview' && (
          <div className="space-y-5">
            {/* Raw Full Summary box */}
            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold">
                <span>전체 원본 제목</span>
                <button
                  onClick={() => handleCopy(crItem.summary, 'summary')}
                  className="text-main0 hover:text-slate-200 flex items-center gap-1"
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
                <span className="text-main0 text-[11px] flex items-center gap-1">
                  <User className="w-3 h-3" /> 보고자
                </span>
                <p className="font-semibold text-slate-200">{crItem.reporter || '-'}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1">
                <span className="text-main0 text-[11px] flex items-center gap-1">
                  <User className="w-3 h-3" /> 담당자
                </span>
                <p className="font-semibold text-slate-200">{crItem.assignee || '-'}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1">
                <span className="text-main0 text-[11px] flex items-center gap-1">
                  <Tag className="w-3 h-3" /> 대상 모듈
                </span>
                <p className="font-semibold text-slate-200">{crItem.module || '-'}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1">
                <span className="text-main0 text-[11px] flex items-center gap-1">
                  <Layers className="w-3 h-3" /> 적용 VOB
                </span>
                <p className="font-semibold text-teal-300 font-mono">{crItem.vob || '-'}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1">
                <span className="text-main0 text-[11px] flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> 보고 날짜
                </span>
                <p className="font-semibold text-slate-200 font-mono">{crItem.dateSubmitted || '-'}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1">
                <span className="text-main0 text-[11px] flex items-center gap-1">
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
              <div className="p-8 text-center text-main0 text-xs">
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
        sshServers={sshServers}
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
