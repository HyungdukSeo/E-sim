import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Download, ChevronUp, ChevronDown, WrapText, ArrowLeftRight } from 'lucide-react';
import { computeAlignedDiff, AlignedDiffRow, DiffChunk } from '../utils/diffAligner';

interface SideBySideDiffViewerProps {
  leftContent: string;
  rightContent: string;
  leftTitle: string;
  rightTitle: string;
  leftSubtitle?: string;
  rightSubtitle?: string;
  leftCrid?: string | null;
  rightCrid?: string | null;
  wrapLines?: boolean;
  onDownloadLeft?: () => void;
  onDownloadRight?: () => void;
  onSwap?: () => void;
}

const ROW_HEIGHT = 22; // px

export const SideBySideDiffViewer: React.FC<SideBySideDiffViewerProps> = ({
  leftContent,
  rightContent,
  leftTitle,
  rightTitle,
  leftSubtitle,
  rightSubtitle,
  leftCrid,
  rightCrid,
  wrapLines = false,
  onDownloadLeft,
  onDownloadRight,
  onSwap
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [currentChunkIndex, setCurrentChunkIndex] = useState<number>(-1);

  const { rows, chunks, totalChanges } = useMemo(() => {
    return computeAlignedDiff(leftContent, rightContent);
  }, [leftContent, rightContent]);

  // Navigate to chunk
  const jumpToChunk = (index: number) => {
    if (!chunks.length || !scrollContainerRef.current) return;
    const targetIdx = Math.max(0, Math.min(index, chunks.length - 1));
    setCurrentChunkIndex(targetIdx);
    const chunk = chunks[targetIdx];
    const targetScrollY = Math.max(0, chunk.startRow * ROW_HEIGHT - 60);
    scrollContainerRef.current.scrollTo({ top: targetScrollY, behavior: 'smooth' });
  };

  const handlePrevChange = () => {
    if (!chunks.length) return;
    const prev = currentChunkIndex <= 0 ? chunks.length - 1 : currentChunkIndex - 1;
    jumpToChunk(prev);
  };

  const handleNextChange = () => {
    if (!chunks.length) return;
    const next = currentChunkIndex >= chunks.length - 1 ? 0 : currentChunkIndex + 1;
    jumpToChunk(next);
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 border border-slate-800 rounded-xl overflow-hidden select-text">
      {/* Sub-toolbar for Diff controls */}
      <div className="px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-2 text-xs shrink-0 select-none">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-slate-400">
            총 <span className="text-amber-400 font-bold">{totalChanges}</span>개 변경 블록 ({rows.length}행)
          </span>
          {chunks.length > 0 && (
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5">
              <button
                onClick={handlePrevChange}
                className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded cursor-pointer transition-colors"
                title="이전 변경 블록 (Shift+Up)"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] font-mono text-slate-300 min-w-[36px] text-center">
                {currentChunkIndex >= 0 ? `${currentChunkIndex + 1} / ${chunks.length}` : `- / ${chunks.length}`}
              </span>
              <button
                onClick={handleNextChange}
                className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded cursor-pointer transition-colors"
                title="다음 변경 블록 (Shift+Down)"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {onSwap && (
          <button
            onClick={onSwap}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[10px] font-sans transition-colors cursor-pointer"
            title="좌우 비교 대상 위치 바꾸기"
          >
            <ArrowLeftRight className="w-3 h-3 text-mantis-400" />
            <span>좌우 반전</span>
          </button>
        )}
      </div>

      {/* Pane Headers */}
      <div className="grid grid-cols-[1fr_24px_1fr] bg-slate-900 border-b border-slate-800 shrink-0 select-none text-[11px]">
        {/* Left Header */}
        <div className="flex items-center justify-between px-3 py-1.5 border-r border-slate-800 bg-rose-950/20">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
            <span className="font-bold font-mono text-rose-200 truncate">{leftTitle}</span>
            {leftCrid && (
              <span className="text-[9px] font-mono px-1.5 py-0.2 bg-rose-900/40 border border-rose-700/50 text-rose-300 rounded shrink-0">
                CR #{leftCrid}
              </span>
            )}
            {leftSubtitle && <span className="text-[10px] text-slate-500 font-mono truncate">{leftSubtitle}</span>}
          </div>
          {onDownloadLeft && (
            <button
              onClick={onDownloadLeft}
              className="p-1 rounded hover:bg-rose-900/30 text-rose-400 hover:text-rose-200 transition-colors cursor-pointer shrink-0"
              title="좌측 버전 파일 다운로드"
            >
              <Download className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Center Divider Header */}
        <div className="bg-slate-900 flex items-center justify-center border-r border-slate-800">
          <div className="w-[1px] h-full bg-slate-800" />
        </div>

        {/* Right Header */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-emerald-950/20">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            <span className="font-bold font-mono text-emerald-200 truncate">{rightTitle}</span>
            {rightCrid && (
              <span className="text-[9px] font-mono px-1.5 py-0.2 bg-emerald-900/40 border border-emerald-700/50 text-emerald-300 rounded shrink-0">
                CR #{rightCrid}
              </span>
            )}
            {rightSubtitle && <span className="text-[10px] text-slate-500 font-mono truncate">{rightSubtitle}</span>}
          </div>
          {onDownloadRight && (
            <button
              onClick={onDownloadRight}
              className="p-1 rounded hover:bg-emerald-900/30 text-emerald-400 hover:text-emerald-200 transition-colors cursor-pointer shrink-0"
              title="우측 버전 파일 다운로드"
            >
              <Download className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Main Synchronized Body */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden font-mono text-[11px] leading-[22px] bg-slate-950 custom-horizontal-scrollbar relative"
      >
        <div className="grid grid-cols-[1fr_24px_1fr] min-w-full relative">
          {/* Left Panel */}
          <div className="flex flex-col border-r border-slate-800/80 overflow-x-auto select-text">
            {rows.map((row, idx) => {
              const { lineNum, text, type } = row.left;
              let bg = '';
              let textColor = 'text-slate-300';
              let lineNumColor = 'text-slate-600';

              if (type === 'removed') {
                bg = 'bg-rose-950/35 hover:bg-rose-950/50';
                textColor = 'text-rose-200';
                lineNumColor = 'text-rose-400 font-bold';
              } else if (type === 'spacer') {
                bg = 'bg-slate-900/25';
              }

              return (
                <div
                  key={idx}
                  style={{ height: wrapLines ? 'auto' : `${ROW_HEIGHT}px` }}
                  className={`flex items-start min-h-[22px] ${bg} transition-colors group`}
                >
                  {/* Gutter */}
                  <div
                    className={`w-11 shrink-0 px-1 text-right select-none border-r border-slate-800/60 font-mono text-[10px] ${lineNumColor} bg-slate-950/40`}
                  >
                    {type === 'removed' ? (
                      <span className="flex items-center justify-between">
                        <span className="text-rose-500 font-bold">-</span>
                        <span>{lineNum}</span>
                      </span>
                    ) : (
                      lineNum || ''
                    )}
                  </div>
                  {/* Code Text */}
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

          {/* Center Connector / Gap */}
          <div className="bg-slate-950 border-r border-slate-800/80 flex flex-col relative select-none">
            {rows.map((row, idx) => {
              const isModified = row.isModified;
              return (
                <div
                  key={idx}
                  style={{ height: wrapLines ? 'auto' : `${ROW_HEIGHT}px` }}
                  className="w-full min-h-[22px] flex items-center justify-center"
                >
                  {isModified && (
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400/80 shadow-[0_0_4px_rgba(251,191,36,0.6)]" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Right Panel */}
          <div className="flex flex-col overflow-x-auto select-text">
            {rows.map((row, idx) => {
              const { lineNum, text, type } = row.right;
              let bg = '';
              let textColor = 'text-slate-300';
              let lineNumColor = 'text-slate-600';

              if (type === 'added') {
                bg = 'bg-emerald-950/35 hover:bg-emerald-950/50';
                textColor = 'text-emerald-200';
                lineNumColor = 'text-emerald-400 font-bold';
              } else if (type === 'spacer') {
                bg = 'bg-slate-900/25';
              }

              return (
                <div
                  key={idx}
                  style={{ height: wrapLines ? 'auto' : `${ROW_HEIGHT}px` }}
                  className={`flex items-start min-h-[22px] ${bg} transition-colors group`}
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
                    ) : (
                      lineNum || ''
                    )}
                  </div>
                  {/* Code Text */}
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
      </div>
    </div>
  );
};
