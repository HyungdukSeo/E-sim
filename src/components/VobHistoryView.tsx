import React, { useEffect, useMemo, useState } from 'react';
import {
  GitBranch,
  Search,
  Loader2,
  FileCode2,
  Clock,
  User,
  Tag,
  AlertCircle,
  RefreshCw,
  Download,
  ChevronLeft,
  Layers
} from 'lucide-react';
import { fetchVobList, fetchVobHistory, collectVobUncachedCRs, VobListItem, VobHistoryEntry } from '../services/api';

// Renders a unified diff exactly like DiffViewerModal's own unified view, so a
// VOB history entry looks identical to what the user already sees per-CR.
const UnifiedDiffBlock: React.FC<{ diff: string }> = ({ diff }) => {
  if (!diff) {
    return <div className="p-4 text-center text-slate-500 font-mono text-xs">Diff 내용이 없습니다.</div>;
  }
  const lines = diff.split('\n');
  return (
    <div className="p-3 font-mono text-[11px] overflow-x-auto space-y-0.5 bg-slate-950 rounded-xl border border-slate-800">
      {lines.map((line, idx) => {
        let cls = 'text-slate-300';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'bg-emerald-950/40 text-emerald-300 px-2 py-0.5 rounded border-l-2 border-emerald-500';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'bg-rose-950/40 text-rose-300 px-2 py-0.5 rounded border-l-2 border-rose-500';
        else if (line.startsWith('@@')) cls = 'text-cyan-300 bg-cyan-950/40 px-2 py-1 rounded font-bold border-y border-cyan-800/40 my-1';
        return (
          <div key={idx} className={`whitespace-pre ${cls}`}>
            {line}
          </div>
        );
      })}
    </div>
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
}

export const VobHistoryView: React.FC<VobHistoryViewProps> = ({ onSelectCR }) => {
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
    const q = fileQuery.trim().toLowerCase();
    if (!q) return history.entries;
    return history.entries.filter(
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
                  return (
                    <div
                      key={`${entry.crid}-${entry.filePath}-${idx}`}
                      className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden"
                    >
                      <button
                        onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-800/40 transition-colors text-left cursor-pointer"
                      >
                        <FileCode2 className="w-3.5 h-3.5 text-mantis-400 shrink-0" />
                        <span className="text-xs font-mono text-slate-200 truncate flex-1">{entry.fileName}</span>
                        <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1 shrink-0">
                          <Clock className="w-3 h-3" />
                          {entry.dateSubmitted || entry.lastUpdated || '-'}
                        </span>
                        {onSelectCR && (
                          <span
                            onClick={e => {
                              e.stopPropagation();
                              onSelectCR(entry.crid);
                            }}
                            className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 hover:bg-slate-700 text-mantis-400 font-mono shrink-0 cursor-pointer"
                            title="이 CR 상세 보기"
                          >
                            #{entry.crid}
                          </span>
                        )}
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
                            <span className="font-mono text-slate-500 truncate max-w-full">{entry.filePath}</span>
                          </div>
                          {entry.status === 'error' ? (
                            <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/40 text-rose-300 text-[11px] flex items-center gap-1.5">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              소스 조회 실패: {entry.error || '알 수 없는 오류'}
                            </div>
                          ) : (
                            <UnifiedDiffBlock diff={entry.unifiedDiff} />
                          )}
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
