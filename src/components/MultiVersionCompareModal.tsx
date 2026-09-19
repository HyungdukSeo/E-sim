import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertCircle, RefreshCw, GitCommit, FileCode2 } from 'lucide-react';
import { diffLines } from 'diff';
import { SSHConfig } from '../types/cr';
import { fetchFileVersionsSSH, FileVersionResult } from '../services/api';

interface MultiVersionCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  checkinLog?: string;
  versions: number[]; // e.g. [3, 4, 7, 8]
  sshConfig?: SSHConfig;
  sshServers?: SSHConfig[];
}

// Renders one version's content, line-diffed against the PREVIOUS column's
// content (or shown plain if it's the first/leftmost column, since there's
// nothing before it to compare against in this set).
const VersionColumn: React.FC<{
  version: number;
  content: string;
  prevContent: string | null;
}> = ({ version, content, prevContent }) => {
  const lines = useMemo(() => {
    if (prevContent === null) {
      // Leftmost column: no predecessor in this set, just show plain lines.
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
  }, [content, prevContent]);

  return (
    <div className="flex-1 min-w-[420px] max-w-[560px] shrink-0 flex flex-col border-r border-slate-800 last:border-r-0">
      <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center gap-2 sticky top-0 z-10">
        <GitCommit className="w-3.5 h-3.5 text-mantis-400 shrink-0" />
        <span className="text-xs font-bold font-mono text-slate-200">@@/main/{version}</span>
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-5 bg-slate-950">
        {lines.map((l, idx) => {
          let cls = 'text-slate-300';
          if (l.type === 'added') cls = 'bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500';
          else if (l.type === 'removed') cls = 'bg-rose-950/40 text-rose-300 border-l-2 border-rose-500 line-through decoration-rose-500/40';
          return (
            <div key={idx} className={`px-2.5 whitespace-pre ${cls}`}>
              {l.text || ' '}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const MultiVersionCompareModal: React.FC<MultiVersionCompareModalProps> = ({
  isOpen,
  onClose,
  filePath,
  checkinLog,
  versions,
  sshConfig,
  sshServers
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FileVersionResult[] | null>(null);

  const fileName = filePath.split('/').pop() || filePath;
  const sortedVersions = useMemo(() => Array.from(new Set(versions)).sort((a, b) => a - b), [versions]);

  useEffect(() => {
    if (!isOpen || sortedVersions.length === 0) return;
    setLoading(true);
    setError(null);
    setResults(null);
    fetchFileVersionsSSH(sshConfig, sshServers, filePath, checkinLog, sortedVersions)
      .then(res => {
        if (res.ok) {
          setResults(res.results);
        } else {
          setError('버전 정보를 불러오지 못했습니다.');
        }
      })
      .catch(err => setError(err.response?.data?.error || err.message || '버전 조회 실패'))
      .finally(() => setLoading(false));
  }, [isOpen, filePath, checkinLog, sortedVersions.join(',')]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-6 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full h-[90vh] max-w-[98vw] bg-slate-900 rounded-3xl border border-slate-700/90 shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-900/98 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-mantis-500/20 text-mantis-400 flex items-center justify-center flex-shrink-0">
              <FileCode2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-100 text-sm truncate font-mono">{fileName}</span>
                <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] font-mono text-mantis-400">
                  버전 {sortedVersions.join(' → ')} ({sortedVersions.length}개 한번에 비교)
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate font-mono">{filePath}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-slate-300 transition-colors flex items-center gap-1 font-bold text-xs shrink-0"
            title="닫기 (ESC)"
          >
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">닫기</span>
          </button>
        </div>

        {/* Body: horizontally scrollable version columns */}
        <div className="flex-1 overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 z-20 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-7 h-7 text-mantis-400 animate-spin" />
              <p className="text-xs font-semibold text-slate-300">
                ClearCase에서 {sortedVersions.length}개 버전을 병렬로 읽어오는 중...
              </p>
            </div>
          )}

          {error ? (
            <div className="p-6 max-w-xl mx-auto space-y-3 my-6">
              <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-3 shadow-lg">
                <div className="flex items-center gap-2 font-bold text-sm text-amber-300">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  버전 조회 실패
                </div>
                <p className="text-xs leading-relaxed text-slate-300 whitespace-pre-line font-mono">{error}</p>
                <button
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    fetchFileVersionsSSH(sshConfig, sshServers, filePath, checkinLog, sortedVersions)
                      .then(res => res.ok && setResults(res.results))
                      .catch(err => setError(err.response?.data?.error || err.message))
                      .finally(() => setLoading(false));
                  }}
                  className="px-4 py-2 rounded-xl bg-mantis-500 hover:bg-mantis-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  다시 시도
                </button>
              </div>
            </div>
          ) : results ? (
            <div className="h-full overflow-x-auto overflow-y-hidden flex">
              {results.map((r, idx) => (
                <VersionColumn
                  key={r.version}
                  version={r.version}
                  content={r.content}
                  prevContent={idx > 0 ? results[idx - 1].content : null}
                />
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer legend */}
        <div className="px-5 py-2.5 border-t border-slate-800 bg-slate-900/98 text-[11px] text-slate-400 flex items-center gap-4 flex-shrink-0">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/40 border border-emerald-400 inline-block" />
            추가됨 (직전 컬럼 대비)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/40 border border-rose-400 inline-block" />
            삭제됨 (직전 컬럼 대비)
          </span>
          <span className="text-slate-500">각 컬럼은 바로 왼쪽 버전과 비교됩니다 — 좌우로 스크롤하여 전체 변경 흐름을 확인하세요.</span>
        </div>
      </div>
    </div>,
    document.body
  );
};
