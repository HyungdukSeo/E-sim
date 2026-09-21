import React, { useMemo, useRef } from 'react';
import { Download, GitCommit, Folder, AlertCircle } from 'lucide-react';
import { computeMultiVersionAlignedDiff } from '../utils/diffAligner';

interface MultiVersionDiffViewerProps {
  versions: Array<{ version: number; crid: string | null }>;
  fileName: string;
  getDecodedContent: (version: number) => string;
  wrapLines?: boolean;
  columnEncodings?: Record<number, string>;
  onColumnEncodingChange?: (version: number, enc: string) => void;
  onDownloadVersion?: (version: number) => void;
}

const ROW_HEIGHT = 22; // px

export const MultiVersionDiffViewer: React.FC<MultiVersionDiffViewerProps> = ({
  versions,
  fileName,
  getDecodedContent,
  wrapLines = false,
  columnEncodings = {},
  onColumnEncodingChange,
  onDownloadVersion
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Compute multi-version alignment grid
  const { rows, totalRows } = useMemo(() => {
    const verList = versions.map(v => ({
      version: v.version,
      content: getDecodedContent(v.version)
    }));
    return computeMultiVersionAlignedDiff(verList);
  }, [versions, getDecodedContent]);

  if (!versions || versions.length === 0) {
    return <div className="p-4 text-xs text-slate-500">표시할 버전이 없습니다.</div>;
  }

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 border border-slate-800 rounded-xl overflow-hidden select-text">
      {/* Overview stats bar */}
      <div className="px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-slate-400">
            총 <span className="text-mantis-400 font-bold">{versions.length}</span>개 버전 정렬 비교
            (총 <span className="text-amber-400 font-bold">{totalRows}</span>행 수평 정렬)
          </span>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">
          ※ 모든 버전의 행 높이가 수평으로 일치하며, 마우스 휠로 동시 스크롤됩니다.
        </span>
      </div>

      {/* Main horizontally and vertically scrollable container */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-x-auto overflow-y-auto font-mono text-[11px] leading-[22px] bg-slate-950 custom-horizontal-scrollbar relative"
      >
        <div className="flex min-w-max">
          {versions.map((verItem, colIdx) => {
            const v = verItem.version;
            const crid = verItem.crid;
            const enc = columnEncodings[v] || 'euc-kr';
            const sampleContent = getDecodedContent(v);
            const isDir = sampleContent.includes('[DIRECTORY:');

            return (
              <div
                key={v}
                className="flex-1 min-w-[380px] max-w-[560px] flex flex-col border-r border-slate-800/80 last:border-r-0 shrink-0"
              >
                {/* Column Sticky Header */}
                <div className="px-2.5 py-1.5 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between gap-1.5 sticky top-0 z-20 select-none shadow-sm">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isDir ? (
                      <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    ) : (
                      <GitCommit className="w-3.5 h-3.5 text-mantis-400 shrink-0" />
                    )}
                    <span className="font-bold font-mono text-slate-200 text-[11px] truncate">
                      @@/main/{v}
                    </span>
                    {isDir && (
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

                    {crid ? (
                      <span className="text-[9px] font-mono text-slate-300 bg-slate-800/90 px-1.5 py-0.5 rounded border border-slate-700/80 truncate">
                        CR #{crid}
                      </span>
                    ) : (
                      <span className="text-[9px] text-slate-600 italic">No CR</span>
                    )}
                  </div>
                </div>

                {/* Column Body Rows */}
                <div className="flex flex-col select-text">
                  {rows.map((row, rowIdx) => {
                    const diffLine = row.cols[v];
                    const text = diffLine?.text || '';
                    const lineNum = diffLine?.lineNum;
                    const type = diffLine?.type || 'spacer';

                    let bg = '';
                    let textColor = 'text-slate-300';
                    let lineNumColor = 'text-slate-600';

                    if (type === 'added') {
                      bg = 'bg-emerald-950/35 hover:bg-emerald-950/50';
                      textColor = 'text-emerald-200';
                      lineNumColor = 'text-emerald-400 font-bold';
                    } else if (type === 'removed') {
                      bg = 'bg-rose-950/35 hover:bg-rose-950/50';
                      textColor = 'text-rose-200';
                      lineNumColor = 'text-rose-400 font-bold';
                    } else if (type === 'spacer') {
                      bg = 'bg-slate-900/20';
                    }

                    return (
                      <div
                        key={rowIdx}
                        style={{ height: wrapLines ? 'auto' : `${ROW_HEIGHT}px` }}
                        className={`flex items-start min-h-[22px] ${bg} transition-colors border-b border-slate-900/40`}
                      >
                        {/* Gutter */}
                        <div
                          className={`w-11 shrink-0 px-1 text-right select-none border-r border-slate-800/60 font-mono text-[10px] ${lineNumColor} bg-slate-950/40`}
                        >
                          {type === 'added' ? (
                            <span className="flex items-center justify-between">
                              <span className="text-emerald-500 font-bold">+</span>
                              <span>{lineNum}</span>
                            </span>
                          ) : type === 'removed' ? (
                            <span className="flex items-center justify-between">
                              <span className="text-rose-500 font-bold">-</span>
                              <span>{lineNum}</span>
                            </span>
                          ) : (
                            lineNum || ''
                          )}
                        </div>

                        {/* Code text */}
                        <div
                          className={`flex-1 px-2.5 ${textColor} ${
                            wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
                          }`}
                        >
                          {type === 'spacer' ? (
                            <div className="w-full h-full opacity-10 flex items-center">
                              <div className="w-full border-b border-dashed border-slate-500" />
                            </div>
                          ) : (
                            text || ' '
                          )}
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
