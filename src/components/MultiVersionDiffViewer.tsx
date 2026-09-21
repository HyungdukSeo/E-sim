import React, { useMemo, useRef } from 'react';
import { Download, GitCommit, Folder, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { diffLines } from 'diff';

interface MultiVersionDiffViewerProps {
  versions: Array<{ version: number; crid: string | null }>;
  fileName: string;
  getDecodedContent: (version: number) => string;
  wrapLines?: boolean;
  columnEncodings?: Record<number, string>;
  onColumnEncodingChange?: (version: number, enc: string) => void;
  onDownloadVersion?: (version: number) => void;
  scrollRef?: React.RefObject<HTMLDivElement>;
}

interface VersionDiffLine {
  lineNum: number | null;
  text: string;
  type: 'unchanged' | 'added' | 'removed';
}

export const MultiVersionDiffViewer: React.FC<MultiVersionDiffViewerProps> = ({
  versions,
  fileName,
  getDecodedContent,
  wrapLines = false,
  columnEncodings = {},
  onColumnEncodingChange,
  onDownloadVersion,
  scrollRef
}) => {
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const activeScrollRef = scrollRef || internalScrollRef;

  const handleNavScroll = (dir: 'left' | 'right') => {
    if (!activeScrollRef.current) return;
    const amount = dir === 'left' ? -420 : 420;
    activeScrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
  };
  const columnData = useMemo(() => {
    return versions.map((verItem, idx) => {
      const currentContent = getDecodedContent(verItem.version);
      const prevContent = idx > 0 ? getDecodedContent(versions[idx - 1].version) : null;

      const lines: VersionDiffLine[] = [];
      let lineNum = 1;

      if (prevContent === null) {
        // v0: Initial version, all unchanged
        const rawLines = currentContent.split('\n');
        for (const l of rawLines) {
          lines.push({ lineNum: lineNum++, text: l, type: 'unchanged' });
        }
      } else {
        // v1..vN: diff against previous version
        const changes = diffLines(prevContent, currentContent);
        for (const change of changes) {
          const parts = change.value.replace(/\n$/, '').split('\n');
          if (change.added) {
            for (const p of parts) {
              lines.push({ lineNum: lineNum++, text: p, type: 'added' });
            }
          } else if (change.removed) {
            for (const p of parts) {
              lines.push({ lineNum: null, text: p, type: 'removed' });
            }
          } else {
            for (const p of parts) {
              lines.push({ lineNum: lineNum++, text: p, type: 'unchanged' });
            }
          }
        }
      }

      return {
        version: verItem.version,
        crid: verItem.crid,
        lines,
        isDir: currentContent.includes('[DIRECTORY:')
      };
    });
  }, [versions, getDecodedContent]);

  if (!versions || versions.length === 0) {
    return <div className="p-4 text-xs text-slate-500">표시할 버전이 없습니다.</div>;
  }

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 border border-slate-800 rounded-xl overflow-hidden select-text">
      {/* Overview header info */}
      <div className="px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-slate-400">
            총 <span className="text-mantis-400 font-bold">{versions.length}</span>개 버전 전체 나열 (직전 버전 대비 변경 하이라이트)
          </span>
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded overflow-hidden">
            <button
              onClick={() => handleNavScroll('left')}
              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              title="이전 버전 컬럼으로 가로 스크롤"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="w-[1px] h-3 bg-slate-800" />
            <button
              onClick={() => handleNavScroll('right')}
              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              title="다음 버전 컬럼으로 가로 스크롤"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">
          ※ 각 컬럼별로 코드 및 스크롤이 독립 격리되어 옆 칸 침범 없이 쾌적하게 비교할 수 있습니다.
        </span>
      </div>

      {/* Horizontally scrollable container that fills full width */}
      <div
        ref={activeScrollRef}
        className="flex-1 w-full overflow-x-auto overflow-y-hidden custom-horizontal-scrollbar flex bg-slate-950"
      >
        <div className="flex w-full min-w-full h-full divide-x divide-slate-800/90">
          {columnData.map(col => {
            const v = col.version;
            const enc = columnEncodings[v] || 'euc-kr';

            return (
              <div
                key={v}
                className="flex-1 min-w-[360px] max-w-none flex flex-col h-full overflow-hidden bg-slate-950 min-w-0"
              >
                {/* Column Sticky Header */}
                <div className="px-2.5 py-1.5 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between gap-1.5 shrink-0 select-none shadow-sm min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {col.isDir ? (
                      <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    ) : (
                      <GitCommit className="w-3.5 h-3.5 text-mantis-400 shrink-0" />
                    )}
                    <span className="font-bold font-mono text-slate-200 text-[11px] truncate">
                      @@/main/{v}
                    </span>
                    {col.isDir && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/15 text-amber-300 font-mono">
                        폴더
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Encoding selector */}
                    {onColumnEncodingChange && (
                      <select
                        value={enc}
                        onChange={e => onColumnEncodingChange(v, e.target.value)}
                        className="text-[9px] font-mono bg-slate-950/80 text-slate-400 hover:text-slate-200 border border-slate-800 rounded px-1 py-0.2 outline-none cursor-pointer"
                        title={`@@/main/${v} 인코딩 변경`}
                      >
                        <option value="euc-kr">EUC-KR</option>
                        <option value="utf-8">UTF-8</option>
                        <option value="windows-949">CP949</option>
                        <option value="iso-8859-1">Latin-1</option>
                      </select>
                    )}

                    {/* Download single version */}
                    {onDownloadVersion && (
                      <button
                        onClick={() => onDownloadVersion(v)}
                        className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-mantis-300 transition-colors cursor-pointer"
                        title={`이 버전(${fileName}.v${v}) 다운로드`}
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    )}

                    {col.crid ? (
                      <span className="text-[9px] font-mono text-slate-300 bg-slate-800/90 px-1.5 py-0.5 rounded border border-slate-700/80 truncate">
                        CR #{col.crid}
                      </span>
                    ) : (
                      <span className="text-[9px] text-slate-600 italic">No CR</span>
                    )}
                  </div>
                </div>

                {/* Column Body with independent vertical scroll and horizontal protection */}
                <div className="flex-1 overflow-y-auto overflow-x-auto font-mono text-[11px] leading-[22px] bg-slate-950 p-1 custom-horizontal-scrollbar select-text min-w-0">
                  {col.lines.map((l, lineIdx) => {
                    let bg = '';
                    let textColor = 'text-slate-300';
                    let lineNumColor = 'text-slate-600';

                    if (l.type === 'added') {
                      bg = 'bg-emerald-950/35 hover:bg-emerald-950/50';
                      textColor = 'text-emerald-200';
                      lineNumColor = 'text-emerald-400 font-bold';
                    } else if (l.type === 'removed') {
                      bg = 'bg-rose-950/35 hover:bg-rose-950/50';
                      textColor = 'text-rose-200 line-through decoration-rose-500/50';
                      lineNumColor = 'text-rose-400 font-bold';
                    }

                    return (
                      <div
                        key={lineIdx}
                        className={`flex items-start min-h-[22px] ${bg} transition-colors border-b border-slate-900/30 min-w-0`}
                      >
                        {/* Gutter */}
                        <div className={`w-11 shrink-0 px-1 text-right select-none border-r border-slate-800/60 font-mono text-[10px] ${lineNumColor} bg-slate-950/40`}>
                          {l.type === 'added' ? (
                            <span className="flex items-center justify-between">
                              <span className="text-emerald-500 font-bold">+</span>
                              <span>{l.lineNum}</span>
                            </span>
                          ) : l.type === 'removed' ? (
                            <span className="flex items-center justify-between">
                              <span className="text-rose-500 font-bold">-</span>
                              <span> </span>
                            </span>
                          ) : (
                            l.lineNum || ''
                          )}
                        </div>

                        {/* Code Text with overflow protection so it never bleeds into adjacent columns */}
                        <div
                          className={`flex-1 px-2.5 min-w-0 ${textColor} ${
                            wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre overflow-x-auto'
                          }`}
                        >
                          {l.text || ' '}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
