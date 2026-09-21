import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { diffLines } from 'diff';
import {
  GitBranch,
  Search,
  Loader2,
  FileCode,
  FileCode2,
  FileText,
  Terminal,
  Settings,
  Database,
  Clock,
  User,
  Tag,
  AlertCircle,
  RefreshCw,
  Download,
  ChevronLeft,
  ChevronRight,
  Layers,
  History,
  GitCommit,
  Folder,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  WrapText,
  X
} from 'lucide-react';

function getFileIcon(fileName: string) {
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.c') || lower.endsWith('.cc') || lower.endsWith('.cpp')) {
    return <FileCode className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
  }
  if (lower.endsWith('.h') || lower.endsWith('.hh') || lower.endsWith('.hpp')) {
    return <FileCode className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
  }
  if (lower.endsWith('.sh') || lower.endsWith('.csh') || lower.endsWith('.bash')) {
    return <Terminal className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  }
  if (lower.endsWith('.sql') || lower.includes('.tbl') || lower.includes('.db')) {
    return <Database className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  }
  if (lower.startsWith('makefile') || lower === 'makeall' || lower.endsWith('.mk')) {
    return <Settings className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
  }
  return <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
}

function formatVobSubPath(filePath: string, vobName: string) {
  if (!filePath) return { dir: '', file: '' };
  const vobIdx = vobName ? filePath.indexOf(vobName) : -1;
  let sub = vobIdx !== -1 ? filePath.slice(vobIdx + vobName.length).replace(/^\/+/, '') : filePath;
  const lastSlash = sub.lastIndexOf('/');
  if (lastSlash === -1) {
    return { dir: '', file: sub };
  }
  return {
    dir: sub.slice(0, lastSlash + 1),
    file: sub.slice(lastSlash + 1)
  };
}
import {
  fetchVobList,
  fetchVobHistory,
  collectVobUncachedCRs,
  fetchFileVersionChain,
  fetchFileVersionsSSH,
  fetchAndCacheCRDiffAPI,
  VobListItem,
  VobHistoryEntry,
  FileVersionChainItem
} from '../services/api';
import { SSHConfig } from '../types/cr';

// One version's content, line-diffed against the PREVIOUS column's content
const VersionColumn: React.FC<{
  version: number;
  crid: string | null;
  content: string;
  prevContent: string | null;
  error?: string;
  wrapLines?: boolean;
  isModal?: boolean;
}> = ({ version, crid, content, prevContent, error, wrapLines, isModal }) => {
  const lines = useMemo(() => {
    if (error) return [];
    if (prevContent === null) {
      return content.split('\n').map(text => ({ text, type: 'unchanged' as const }));
    }
    const changes = diffLines(prevContent, content);
    const out: Array<{ text: string; type: 'unchanged' | 'added' | 'removed' }> = [];
    for (const part of changes) {
      const partLines = part.value.replace(/\n$/, '').split('\n');
      for (const l of partLines) {
        out.push({ text: l, type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged' });
      }
    }
    return out;
  }, [content, prevContent, error]);

  return (
    <div
      className={`flex-1 ${
        isModal ? 'min-w-[460px] max-w-[680px]' : 'min-w-[360px] max-w-[520px]'
      } shrink-0 flex flex-col border-r border-slate-800 last:border-r-0`}
    >
      <div className="px-2.5 py-1.5 bg-slate-900/95 border-b border-slate-800 flex items-center gap-1.5 sticky top-0 z-10 select-none">
        {content.includes('[DIRECTORY:') ? (
          <Folder className="w-3 h-3 text-amber-400 shrink-0" />
        ) : (
          <GitCommit className="w-3 h-3 text-mantis-400 shrink-0" />
        )}
        <span className="text-[11px] font-bold font-mono text-slate-200">@@/main/{version}</span>
        {content.includes('[DIRECTORY:') && (
          <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/15 text-amber-300 font-mono">폴더</span>
        )}
        {crid ? (
          <span className="text-[9px] font-mono text-slate-300 bg-slate-800/90 px-1.5 py-0.5 rounded border border-slate-700/80 truncate ml-auto">
            CR #{crid}
          </span>
        ) : (
          <span className="text-[9px] text-slate-600 italic ml-auto">CR 정보 없음</span>
        )}
      </div>
      <div
        className={`flex-1 overflow-y-auto font-mono text-[10px] leading-5 bg-slate-950 ${
          isModal ? 'h-full' : 'max-h-80'
        } p-1`}
      >
        {error ? (
          <div className="p-2.5 text-rose-300 text-[10px] flex items-center gap-1.5">
            <AlertCircle className="w-3 h-3 shrink-0" />
            {error}
          </div>
        ) : (
          lines.map((l, idx) => {
            let cls = 'text-slate-300';
            if (l.type === 'added') cls = 'bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500';
            else if (l.type === 'removed')
              cls = 'bg-rose-950/40 text-rose-300 border-l-2 border-rose-500 line-through decoration-rose-500/40';
            return (
              <div
                key={idx}
                className={`px-2 ${wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'} ${cls}`}
              >
                {l.text || ' '}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// Shows the FULL version chain (0..latest) for one file
const FileVersionChainPanel: React.FC<{
  filePath: string;
  checkinLog?: string;
  sshConfig?: SSHConfig;
  onVersionLoaded?: () => void;
}> = ({ filePath, checkinLog, sshConfig, onVersionLoaded }) => {
  const [chain, setChain] = useState<FileVersionChainItem[] | null>(null);
  const [loadingChain, setLoadingChain] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [contents, setContents] = useState<Record<number, { content: string; error?: string }>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);

  const inlineScrollRef = useRef<HTMLDivElement>(null);
  const modalScrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = (ref: React.RefObject<HTMLDivElement | null>, direction: 'left' | 'right') => {
    if (!ref.current) return;
    const amount = direction === 'left' ? -420 : 420;
    ref.current.scrollBy({ left: amount, behavior: 'smooth' });
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingChain(true);
    fetchFileVersionChain(filePath)
      .then(res => {
        if (!cancelled && res.ok) setChain(res.chain);
      })
      .finally(() => {
        if (!cancelled) setLoadingChain(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  useEffect(() => {
    if (!chain || chain.length === 0) return;
    let cancelled = false;
    setLoadingContent(true);
    setContentError(null);
    const versions = chain.map(c => c.version);
    fetchFileVersionsSSH(sshConfig, undefined, filePath, checkinLog, versions)
      .then(res => {
        if (cancelled) return;
        if (res.ok) {
          const next: Record<number, { content: string }> = {};
          let hasAny = false;
          for (const r of res.results || []) {
            next[r.version] = { content: r.content };
            if (r.content) hasAny = true;
          }
          setContents(next);
          if (hasAny && onVersionLoaded) {
            onVersionLoaded();
          }
        } else {
          setContentError('버전 내용을 불러오지 못했습니다.');
        }
      })
      .catch(err => {
        if (!cancelled) setContentError(err.response?.data?.error || err.message || '버전 조회 실패');
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, filePath]);

  // Handle ESC to close modal
  useEffect(() => {
    if (!isModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isModalOpen]);

  if (loadingChain) {
    return (
      <div className="p-4 flex items-center gap-2 text-slate-500 text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        버전 이력 확인 중...
      </div>
    );
  }
  if (!chain || chain.length === 0) {
    return <div className="p-4 text-xs text-slate-500">이 파일의 버전 이력을 찾을 수 없습니다.</div>;
  }

  const fileName = filePath.split('/').pop() || filePath;

  return (
    <>
      <div className="space-y-1.5 bg-slate-950/40 rounded-xl border border-slate-800/80 overflow-hidden">
        {/* Header toolbar */}
        <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-300 px-3 pt-2.5 pb-1">
          <div className="flex items-center gap-1.5 truncate min-w-0">
            <History className="w-3.5 h-3.5 text-mantis-400 shrink-0" />
            <span className="truncate">전체 버전 이력 (0 ~ {chain.length - 1})</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Wrap toggle */}
            <button
              onClick={() => setWrapLines(prev => !prev)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-sans transition-colors cursor-pointer border ${
                wrapLines
                  ? 'bg-mantis-500/20 text-mantis-300 border-mantis-500/40'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800'
              }`}
              title="줄바꿈 토글 (ON: 긴 줄 가로 스크롤 방지)"
            >
              <WrapText className="w-3 h-3" />
              <span>{wrapLines ? '줄바꿈 켜짐' : '줄바꿈'}</span>
            </button>

            {/* Scroll navigation buttons */}
            <div className="flex items-center rounded-lg bg-slate-900 border border-slate-800 overflow-hidden">
              <button
                onClick={() => handleScroll(inlineScrollRef, 'left')}
                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                title="이전 버전으로 가로 스크롤"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <div className="w-[1px] h-3 bg-slate-800" />
              <button
                onClick={() => handleScroll(inlineScrollRef, 'right')}
                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                title="다음 버전으로 가로 스크롤"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Fullscreen Modal button */}
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-mantis-400 hover:text-mantis-300 border border-slate-700 text-[10px] font-sans transition-all cursor-pointer shadow-sm"
              title="설정창처럼 전체화면 팝업으로 크게 보기"
            >
              <Maximize2 className="w-3 h-3" />
              <span>크게 보기</span>
            </button>
          </div>
        </div>

        {loadingContent ? (
          <div className="p-6 flex flex-col items-center gap-2 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin text-mantis-400" />
            <span className="text-xs">ClearCase에서 {chain.length}개 버전을 병렬로 읽어오는 중...</span>
          </div>
        ) : contentError ? (
          <div className="p-3 mx-3 mb-3 rounded-lg bg-rose-950/30 border border-rose-800/40 text-rose-300 text-[11px] flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {contentError}
          </div>
        ) : (
          <div className="relative border-t border-slate-800/80">
            {/* Scrollable Container with prominent custom scrollbar */}
            <div
              ref={inlineScrollRef}
              className="overflow-x-auto overflow-y-hidden flex max-h-80 custom-horizontal-scrollbar pb-1"
            >
              {chain.map((item, idx) => {
                const c = contents[item.version];
                const prev = idx > 0 ? contents[chain[idx - 1].version]?.content ?? null : null;
                return (
                  <VersionColumn
                    key={item.version}
                    version={item.version}
                    crid={item.crid}
                    content={c?.content ?? ''}
                    prevContent={prev}
                    error={c ? undefined : '이 버전은 조회되지 않았습니다.'}
                    wrapLines={wrapLines}
                    isModal={false}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Full-Screen / Large Modal for Version Compare */}
      {isModalOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-200">
            <div className="w-[98vw] max-w-[1700px] h-[94vh] rounded-2xl bg-slate-950 border border-slate-700 shadow-2xl flex flex-col overflow-hidden">
              {/* Modal Header */}
              <div className="p-3.5 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 rounded-lg bg-mantis-500/15 border border-mantis-500/30 text-mantis-400 shrink-0">
                    <History className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold font-mono text-slate-100 truncate">{fileName}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-mono">
                        전체 버전 0 ~ {chain.length - 1} ({chain.length}개)
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 truncate" title={filePath}>
                      {filePath}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Wrap Lines Toggle */}
                  <button
                    onClick={() => setWrapLines(prev => !prev)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer border ${
                      wrapLines
                        ? 'bg-mantis-500/20 text-mantis-300 border-mantis-500/40'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                    }`}
                  >
                    <WrapText className="w-3.5 h-3.5" />
                    <span>{wrapLines ? '줄바꿈 해제' : '코드 줄바꿈'}</span>
                  </button>

                  {/* Horizontal navigation buttons */}
                  <div className="flex items-center rounded-lg bg-slate-800 border border-slate-700 overflow-hidden">
                    <button
                      onClick={() => handleScroll(modalScrollRef, 'left')}
                      className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer text-xs font-mono"
                      title="이전 버전 컬럼으로 스크롤"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>이전</span>
                    </button>
                    <div className="w-[1px] h-4 bg-slate-700" />
                    <button
                      onClick={() => handleScroll(modalScrollRef, 'right')}
                      className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer text-xs font-mono"
                      title="다음 버전 컬럼으로 스크롤"
                    >
                      <span>다음</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Close button */}
                  <button
                    onClick={() => setIsModalOpen(false)}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-100 transition-colors cursor-pointer ml-1"
                    title="닫기 (ESC)"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-hidden relative flex flex-col bg-slate-950">
                {loadingContent ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
                    <Loader2 className="w-8 h-8 animate-spin text-mantis-400" />
                    <span className="text-sm">버전 소스코드를 불러오는 중입니다...</span>
                  </div>
                ) : contentError ? (
                  <div className="p-6 m-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-sm flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span>{contentError}</span>
                  </div>
                ) : (
                  <div
                    ref={modalScrollRef}
                    className="flex-1 overflow-x-auto overflow-y-hidden flex custom-horizontal-scrollbar pb-2"
                  >
                    {chain.map((item, idx) => {
                      const c = contents[item.version];
                      const prev = idx > 0 ? contents[chain[idx - 1].version]?.content ?? null : null;
                      return (
                        <VersionColumn
                          key={item.version}
                          version={item.version}
                          crid={item.crid}
                          content={c?.content ?? ''}
                          prevContent={prev}
                          error={c ? undefined : '이 버전은 조회되지 않았습니다.'}
                          wrapLines={wrapLines}
                          isModal={true}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

const VobListPanel: React.FC<{
  vobs: VobListItem[];
  loading: boolean;
  onSelect: (vob: string) => void;
}> = ({ vobs, loading, onSelect }) => {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vobs;
    return vobs.filter(v => v.vob.toLowerCase().includes(q));
  }, [vobs, query]);

  return (
    <div className="glass-panel rounded-2xl border border-slate-800 flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
          <GitBranch className="w-4 h-4 text-mantis-400" />
          <span>VOB 목록</span>
          <span className="text-[11px] font-mono text-slate-500">({vobs.length.toLocaleString()}개)</span>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="VOB 이름 검색... (예: POTS_KT)"
            className="w-full pl-8 pr-3 py-2 bg-slate-950 text-slate-200 rounded-xl border border-slate-800 text-xs font-mono outline-none focus:border-mantis-500/50"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading ? (
          <div className="p-8 flex flex-col items-center gap-2 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-xs">VOB 목록 불러오는 중...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">일치하는 VOB가 없습니다.</div>
        ) : (
          filtered.map(v => (
            <button
              key={v.vob}
              onClick={() => onSelect(v.vob)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl hover:bg-slate-800/60 border border-transparent hover:border-slate-700 transition-all text-left cursor-pointer"
            >
              <span className="text-xs font-mono text-slate-200 truncate">{v.vob}</span>
              <span className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-mantis-500/15 text-mantis-400 border border-mantis-500/25 font-mono">
                  {v.crCount.toLocaleString()} CR
                </span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                  {v.fileCount.toLocaleString()} 파일
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

interface VobHistoryViewProps {
  onSelectCR?: (crid: string) => void;
  sshConfig?: SSHConfig;
}

export const VobHistoryView: React.FC<VobHistoryViewProps> = ({ onSelectCR, sshConfig }) => {
  const [vobs, setVobs] = useState<VobListItem[]>([]);
  const [loadingVobs, setLoadingVobs] = useState(true);
  const [selectedVob, setSelectedVob] = useState<string | null>(null);

  const [history, setHistory] = useState<{
    totalCrs: number;
    cachedCrs: number;
    uncachedCrids: string[];
    entries: VobHistoryEntry[];
  } | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [fileQuery, setFileQuery] = useState('');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [isCollecting, setIsCollecting] = useState(false);
  const [collectMessage, setCollectMessage] = useState<string | null>(null);
  const [retryingCrid, setRetryingCrid] = useState<string | null>(null);
  const [copiedFilePath, setCopiedFilePath] = useState<string | null>(null);
  const [resolvedFiles, setResolvedFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoadingVobs(true);
    fetchVobList()
      .then(res => {
        if (!cancelled && res.ok) setVobs(res.vobs);
      })
      .finally(() => {
        if (!cancelled) setLoadingVobs(false);
      });
    return () => { cancelled = true; };
  }, []);

  const loadHistory = (vob: string) => {
    setLoadingHistory(true);
    setExpandedIdx(null);
    setCollectMessage(null);
    fetchVobHistory(vob)
      .then(res => {
        if (res.ok) {
          setHistory({
            totalCrs: res.totalCrs,
            cachedCrs: res.cachedCrs,
            uncachedCrids: res.uncachedCrids,
            entries: res.entries
          });
        }
      })
      .finally(() => setLoadingHistory(false));
  };

  const handleSelectVob = (vob: string) => {
    setSelectedVob(vob);
    loadHistory(vob);
  };

  const handleCollectUncached = async () => {
    if (!selectedVob || !history || history.uncachedCrids.length === 0) return;
    setIsCollecting(true);
    setCollectMessage(null);
    try {
      const res = await collectVobUncachedCRs(selectedVob, history.uncachedCrids);
      if (res.ok) {
        setCollectMessage(
          `${res.queued}건을 백그라운드 수집 대기열 최우선순위로 등록했습니다. 설정 화면의 자동 수집을 켜두면 곧 반영됩니다.`
        );
      }
    } catch (err: any) {
      setCollectMessage(`요청 실패: ${err.message}`);
    } finally {
      setIsCollecting(false);
    }
  };

  const filteredEntries = useMemo(() => {
    if (!history) return [];
    // Completely exclude ClearCase directory elements and branch pseudo-elements from timeline list
    const isDir = (name: string, diff?: string) => {
      if (!name) return false;
      if (name.startsWith('crdb') || name.startsWith('cr_')) return true;
      if (diff && diff.includes('[DIRECTORY:')) return true;
      const clean = name.split('/').pop() || name;
      if (clean.includes('.') && !clean.startsWith('.')) return false;
      const lower = clean.toLowerCase();
      const known = new Set(['makefile', 'makeall', 'dockerfile', 'readme', 'license', 'cmakelists.txt']);
      if (known.has(lower) || lower.startsWith('makefile')) return false;
      return true;
    };

    const nonDirEntries = (history.entries || []).filter(
      e => !e.isDirectory && !isDir(e.fileName, e.unifiedDiff)
    );
    const q = fileQuery.trim().toLowerCase();
    if (!q) return nonDirEntries;
    return nonDirEntries.filter(
      e =>
        e.fileName.toLowerCase().includes(q) ||
        e.crid.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q)
    );
  }, [history, fileQuery]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 h-[calc(100vh-180px)]">
      {/* Left: VOB list (hidden on mobile once a VOB is selected) */}
      <div className={selectedVob ? 'hidden lg:block' : ''}>
        <VobListPanel vobs={vobs} loading={loadingVobs} onSelect={handleSelectVob} />
      </div>

      {/* Right: History timeline for the selected VOB */}
      <div className="glass-panel rounded-2xl border border-slate-800 flex flex-col overflow-hidden">
        {!selectedVob ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500 p-8">
            <Layers className="w-10 h-10 text-slate-700" />
            <p className="text-sm font-medium">왼쪽에서 VOB를 선택하면</p>
            <p className="text-xs">CR 번호와 무관하게 해당 VOB의 코드 변경 흐름을 시간순으로 확인할 수 있습니다.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-4 border-b border-slate-800 space-y-3 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedVob(null)}
                  className="lg:hidden p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <GitBranch className="w-4 h-4 text-mantis-400 shrink-0" />
                <h2 className="text-sm font-bold text-slate-100 font-mono truncate">{selectedVob}</h2>
                <button
                  onClick={() => loadHistory(selectedVob)}
                  disabled={loadingHistory}
                  className="ml-auto p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  title="새로고침"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin text-mantis-400' : ''}`} />
                </button>
              </div>

              {history && (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="px-2 py-0.5 rounded-md bg-mantis-500/15 border border-mantis-500/30 text-mantis-400 font-mono">
                    관련 CR {history.totalCrs.toLocaleString()}건
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono">
                    수집됨 {history.cachedCrs.toLocaleString()}건
                  </span>
                  {history.uncachedCrids.length > 0 && (
                    <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 font-mono">
                      아직 수집 안됨 {history.uncachedCrids.length.toLocaleString()}건
                    </span>
                  )}
                  {history.uncachedCrids.length > 0 && (
                    <button
                      onClick={handleCollectUncached}
                      disabled={isCollecting}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-medium transition-colors"
                    >
                      <Download className={`w-3 h-3 ${isCollecting ? 'animate-spin' : ''}`} />
                      미수집분 우선 수집 요청
                    </button>
                  )}
                </div>
              )}

              {collectMessage && (
                <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                  {collectMessage}
                </p>
              )}

              {history && history.entries.length > 0 && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={fileQuery}
                    onChange={e => setFileQuery(e.target.value)}
                    placeholder="파일명, CR 번호, 제목으로 필터..."
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-950 text-slate-200 rounded-xl border border-slate-800 text-xs font-mono outline-none focus:border-mantis-500/50"
                  />
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loadingHistory ? (
                <div className="p-8 flex flex-col items-center gap-2 text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-xs">변경 이력 불러오는 중...</span>
                </div>
              ) : filteredEntries.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs space-y-2">
                  <FileCode2 className="w-8 h-8 mx-auto text-slate-700" />
                  <p>
                    {history && history.entries.length === 0 && history.uncachedCrids.length > 0
                      ? '이 VOB의 파일들이 아직 로컬 Diff 데이터셋에 수집되지 않았습니다. 위의 "미수집분 우선 수집 요청" 버튼을 눌러주세요.'
                      : '표시할 변경 이력이 없습니다.'}
                  </p>
                </div>
              ) : (
                filteredEntries.map((entry, idx) => {
                  const isExpanded = expandedIdx === idx;
                  const { dir, file } = formatVobSubPath(entry.filePath, selectedVob || '');
                  const isResolved = resolvedFiles.has(entry.filePath);
                  const effectiveStatus = isResolved ? 'success' : entry.status;
                  const effectiveHasChanges = isResolved ? true : entry.hasChanges;
                  return (
                    <div
                      key={`${entry.crid}-${entry.filePath}-${idx}`}
                      className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden hover:border-slate-700/80 transition-all"
                    >
                      <button
                        onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-800/40 transition-colors text-left cursor-pointer group"
                      >
                        <div className="shrink-0 flex items-center">
                          {getFileIcon(entry.fileName)}
                        </div>

                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          {dir && (
                            <span className="text-slate-500 font-mono text-[11px] truncate hidden sm:inline" title={entry.filePath}>
                              {dir}
                            </span>
                          )}
                          <span className="text-xs font-mono font-semibold text-slate-200 group-hover:text-mantis-300 transition-colors truncate">
                            {file || entry.fileName}
                          </span>
                          {entry.summary && (
                            <span className="text-[11px] text-slate-400 truncate max-w-[240px] lg:max-w-[340px] hidden md:inline ml-2 pl-2 border-l border-slate-800 font-sans">
                              {entry.summary}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {effectiveStatus === 'error' ? (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 font-mono">
                              조회 실패
                            </span>
                          ) : effectiveHasChanges ? (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono">
                              변경됨
                            </span>
                          ) : null}

                          <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {entry.dateSubmitted || entry.lastUpdated || '-'}
                          </span>

                          {onSelectCR && (
                            <span
                              onClick={e => {
                                e.stopPropagation();
                                onSelectCR(entry.crid);
                              }}
                              className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 hover:bg-slate-700 text-mantis-400 font-mono shrink-0 cursor-pointer border border-slate-700/60"
                              title="이 CR 상세 보기"
                            >
                              #{entry.crid}
                            </span>
                          )}

                          <ChevronRight className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isExpanded ? 'rotate-90 text-mantis-400' : ''}`} />
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-2 border-t border-slate-800/80 pt-2">
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                            <span className="flex items-center gap-1">
                              <Tag className="w-3 h-3" /> {entry.summary || '(제목 없음)'}
                            </span>
                            {entry.reporter && (
                              <span className="flex items-center gap-1">
                                <User className="w-3 h-3" /> {entry.reporter}
                              </span>
                            )}
                            <div className="flex items-center gap-1.5 font-mono text-slate-500 text-[10px] bg-slate-950/70 px-2 py-1 rounded-md border border-slate-800 max-w-full">
                              <span className="truncate">{entry.filePath}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(entry.filePath);
                                  setCopiedFilePath(entry.filePath);
                                  setTimeout(() => setCopiedFilePath(null), 1500);
                                }}
                                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
                                title="파일 전체 경로 복사"
                              >
                                {copiedFilePath === entry.filePath ? (
                                  <Check className="w-3 h-3 text-mantis-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          </div>
                          {entry.status === 'error' && !isResolved && (
                            <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/40 text-rose-300 text-[11px] flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>소스 조회 실패: {entry.error || '알 수 없는 오류'}</span>
                              </div>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setRetryingCrid(entry.crid);
                                  try {
                                    await fetchAndCacheCRDiffAPI({ crid: entry.crid, id: entry.id } as any, sshConfig, undefined, true);
                                    if (selectedVob) loadHistory(selectedVob);
                                  } catch (err: any) {
                                    alert('재조회 실패: ' + (err.message || '서버 응답 없음'));
                                  } finally {
                                    setRetryingCrid(null);
                                  }
                                }}
                                disabled={retryingCrid === entry.crid}
                                className="px-2 py-1 rounded bg-rose-900/60 hover:bg-rose-800 text-rose-100 text-[10px] shrink-0 font-sans flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <RefreshCw className={`w-3 h-3 ${retryingCrid === entry.crid ? 'animate-spin' : ''}`} />
                                다시 시도
                              </button>
                            </div>
                          )}

                          <FileVersionChainPanel
                            filePath={entry.filePath}
                            checkinLog={entry.checkinLog}
                            sshConfig={sshConfig}
                            onVersionLoaded={() => {
                              setResolvedFiles(prev => new Set(prev).add(entry.filePath));
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
