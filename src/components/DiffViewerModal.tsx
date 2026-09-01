import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  GitCompare, 
  Copy, 
  Check, 
  Columns, 
  AlignJustify, 
  Maximize2, 
  Minimize2, 
  Terminal, 
  AlertCircle, 
  RefreshCw, 
  Settings,
  ChevronDown,
  ChevronUp,
  Search,
  FileCode2,
  CheckCircle2
} from 'lucide-react';
import { diffLines, diffWordsWithSpace } from 'diff';
import { SSHConfig, DiffResult } from '../types/cr';
import { fetchFileDiff } from '../services/api';

interface DiffViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  checkinLog?: string;
  sshConfig?: SSHConfig;
  onOpenSettings?: () => void;
}

interface AlignedDiffRow {
  id: number;
  oldLineNum?: number;
  oldText?: string;
  newLineNum?: number;
  newText?: string;
  type: 'unchanged' | 'modified' | 'added' | 'deleted';
  isChange: boolean;
}

export const DiffViewerModal: React.FC<DiffViewerModalProps> = ({
  isOpen,
  onClose,
  filePath,
  checkinLog,
  sshConfig,
  onOpenSettings
}) => {
  const [loading, setLoading] = useState(false);
  const [diffData, setDiffData] = useState<DiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  const [isMaximized, setIsMaximized] = useState(false);
  const [copiedVimdiff, setCopiedVimdiff] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0);

  // Left & Right Encoding state (default EUC-KR for Korean Telecom ClearCase)
  const [leftEncoding, setLeftEncoding] = useState<'euc-kr' | 'utf-8' | 'windows-949' | 'iso-8859-1'>('euc-kr');
  const [rightEncoding, setRightEncoding] = useState<'euc-kr' | 'utf-8' | 'windows-949' | 'iso-8859-1'>('euc-kr');

  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<{ [key: number]: HTMLTableRowElement | null }>({});

  const cleanFilePath = filePath.replace(/(_|@@)\/.*$/, '');
  const fileName = cleanFilePath.split('/').pop() || cleanFilePath;

  // Helper to decode Base64 to text with specific encoding
  const decodeBase64WithEncoding = (base64Str?: string, fallbackStr?: string, encoding: string = 'euc-kr'): string => {
    if (!base64Str) return fallbackStr || '';
    try {
      const binary = atob(base64Str);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const decoder = new TextDecoder(encoding);
      return decoder.decode(bytes);
    } catch (err) {
      console.warn(`[TextDecoder Error (${encoding})]`, err);
      return fallbackStr || '';
    }
  };

  // Compute default fallback vimdiff command
  let fallbackVimdiff = `vimdiff ${cleanFilePath}@@/main/1 ${cleanFilePath}@@/main/2`;
  if (checkinLog) {
    const lines = checkinLog.split(/\r?\n/);
    for (const l of lines) {
      if (l.includes(filePath) || l.includes(fileName)) {
        const vMatch = l.match(/(_|@@)(\/[a-zA-Z0-9_\-\.\/]+)\/(\d+)/);
        if (vMatch) {
          const branch = vMatch[2];
          const ver = parseInt(vMatch[3], 10);
          fallbackVimdiff = `vimdiff ${cleanFilePath}@@${branch}/${Math.max(0, ver - 1)} ${cleanFilePath}@@${branch}/${ver}`;
        }
        break;
      }
    }
  }

  const loadDiff = async () => {
    if (!filePath) return;
    setLoading(true);
    setError(null);

    const config = sshConfig || { host: '', port: 22, username: '', password: '', enabled: true };

    try {
      const res = await fetchFileDiff(config, filePath, checkinLog);
      setDiffData(res);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'SSH Diff 조회 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && filePath) {
      loadDiff();
    } else {
      setDiffData(null);
      setError(null);
      setSearchQuery('');
      setCurrentChangeIndex(0);
    }
  }, [isOpen, filePath]);

  // Keyboard Escape Handler
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

  const vimdiffCmd = diffData?.vimdiffCommand || fallbackVimdiff;

  const handleCopyVimdiff = () => {
    navigator.clipboard.writeText(vimdiffCmd);
    setCopiedVimdiff(true);
    setTimeout(() => setCopiedVimdiff(false), 2000);
  };

  // Build True Aligned Side-by-Side Diff Matrix with dynamic Left & Right Encoding
  const { alignedRows, changeRowIds, stats } = useMemo(() => {
    const oldStr = decodeBase64WithEncoding(diffData?.oldBase64, diffData?.oldContent, leftEncoding);
    const newStr = decodeBase64WithEncoding(diffData?.newBase64, diffData?.newContent, rightEncoding);

    if (!oldStr && !newStr) {
      return { alignedRows: [], changeRowIds: [], stats: { added: 0, deleted: 0, modified: 0, total: 0 } };
    }

    const changes = diffLines(oldStr, newStr);
    const rows: AlignedDiffRow[] = [];
    let oldLineCounter = 1;
    let newLineCounter = 1;
    let rowIdCounter = 0;
    let addedCount = 0;
    let deletedCount = 0;
    let modifiedCount = 0;

    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      const nextChange = changes[i + 1];

      // Pair consecutive Removed + Added blocks into Modified rows
      if (change.removed && nextChange && nextChange.added) {
        const remLines = change.value.replace(/\n$/, '').split('\n');
        const addLines = nextChange.value.replace(/\n$/, '').split('\n');
        const maxLen = Math.max(remLines.length, addLines.length);

        for (let j = 0; j < maxLen; j++) {
          const oldL = remLines[j];
          const newL = addLines[j];
          const isMod = oldL !== undefined && newL !== undefined;
          const isDel = oldL !== undefined && newL === undefined;
          const isAdd = oldL === undefined && newL !== undefined;

          if (isMod) modifiedCount++;
          else if (isDel) deletedCount++;
          else if (isAdd) addedCount++;

          rows.push({
            id: rowIdCounter++,
            oldLineNum: oldL !== undefined ? oldLineCounter++ : undefined,
            oldText: oldL,
            newLineNum: newL !== undefined ? newLineCounter++ : undefined,
            newText: newL,
            type: isMod ? 'modified' : isDel ? 'deleted' : 'added',
            isChange: true
          });
        }
        i++; // Skip the next added block since it was merged
      } else if (change.removed) {
        const remLines = change.value.replace(/\n$/, '').split('\n');
        for (const line of remLines) {
          deletedCount++;
          rows.push({
            id: rowIdCounter++,
            oldLineNum: oldLineCounter++,
            oldText: line,
            type: 'deleted',
            isChange: true
          });
        }
      } else if (change.added) {
        const addLines = change.value.replace(/\n$/, '').split('\n');
        for (const line of addLines) {
          addedCount++;
          rows.push({
            id: rowIdCounter++,
            newLineNum: newLineCounter++,
            newText: line,
            type: 'added',
            isChange: true
          });
        }
      } else {
        const unchLines = change.value.replace(/\n$/, '').split('\n');
        for (const line of unchLines) {
          rows.push({
            id: rowIdCounter++,
            oldLineNum: oldLineCounter++,
            oldText: line,
            newLineNum: newLineCounter++,
            newText: line,
            type: 'unchanged',
            isChange: false
          });
        }
      }
    }

    const changeRowIds = rows.filter(r => r.isChange).map(r => r.id);
    return {
      alignedRows: rows,
      changeRowIds,
      stats: {
        added: addedCount,
        deleted: deletedCount,
        modified: modifiedCount,
        total: rows.length
      }
    };
  }, [diffData, leftEncoding, rightEncoding]);

  // Jump to change handler
  const jumpToChange = (direction: 'next' | 'prev') => {
    if (changeRowIds.length === 0) return;
    let nextIdx = direction === 'next' ? currentChangeIndex + 1 : currentChangeIndex - 1;
    if (nextIdx >= changeRowIds.length) nextIdx = 0;
    if (nextIdx < 0) nextIdx = changeRowIds.length - 1;

    setCurrentChangeIndex(nextIdx);
    const targetRowId = changeRowIds[nextIdx];
    const el = rowRefs.current[targetRowId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Render Word/Character Level Intra-line Highlight for Modified Rows
  const renderIntraLineDiff = (oldText?: string, newText?: string, side: 'old' | 'new' = 'old') => {
    if (oldText === undefined && newText === undefined) return null;
    if (oldText === undefined) return <span className="text-emerald-300 font-mono">{newText}</span>;
    if (newText === undefined) return <span className="text-rose-300 font-mono">{oldText}</span>;

    const wordDiffs = diffWordsWithSpace(oldText, newText);

    if (side === 'old') {
      return (
        <span className="font-mono">
          {wordDiffs.map((part, idx) => {
            if (part.added) return null; // Don't show added in old side
            if (part.removed) {
              return (
                <mark key={idx} className="bg-rose-500/30 text-rose-200 font-bold px-0.5 rounded">
                  {part.value}
                </mark>
              );
            }
            return <span key={idx} className="text-slate-300">{part.value}</span>;
          })}
        </span>
      );
    } else {
      return (
        <span className="font-mono">
          {wordDiffs.map((part, idx) => {
            if (part.removed) return null; // Don't show removed in new side
            if (part.added) {
              return (
                <mark key={idx} className="bg-emerald-500/30 text-emerald-200 font-bold px-0.5 rounded">
                  {part.value}
                </mark>
              );
            }
            return <span key={idx} className="text-slate-300">{part.value}</span>;
          })}
        </span>
      );
    }
  };

  // Render Line-by-Line Side-by-Side Diff
  const renderSideBySide = () => {
    if (alignedRows.length === 0) {
      return (
        <div className="p-12 text-center text-slate-500 font-mono text-xs space-y-2">
          <FileCode2 className="w-8 h-8 mx-auto text-slate-600" />
          <p>파일 내용이 비어있거나 이전/현재 버전 간의 변경점이 없습니다.</p>
        </div>
      );
    }

    const filteredRows = searchQuery
      ? alignedRows.filter(
          r =>
            (r.oldText && r.oldText.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (r.newText && r.newText.toLowerCase().includes(searchQuery.toLowerCase()))
        )
      : alignedRows;

    return (
      <div className="overflow-x-auto min-w-full font-mono text-[11px] leading-5">
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            <col className="w-12" />
            <col className="w-[calc(50%-48px)]" />
            <col className="w-12" />
            <col className="w-[calc(50%-48px)]" />
          </colgroup>
          <thead>
            <tr className="bg-slate-900/95 backdrop-blur text-xs font-semibold text-slate-400 border-b border-slate-800 select-none sticky top-0 z-10 shadow-sm">
              <th className="px-2 py-2 border-r border-slate-800 text-slate-500 text-[10px] text-right font-mono">#</th>
              <th className="px-3 py-1.5 text-left border-r border-slate-800 text-rose-400/90 font-mono">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="w-2 h-2 rounded-full bg-rose-500 inline-block"></span>
                    이전: {diffData?.prevVersion || '@@/main/0'}
                  </span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[10px] text-slate-500 font-normal hidden lg:inline">인코딩:</span>
                    <select
                      value={leftEncoding}
                      onChange={e => setLeftEncoding(e.target.value as any)}
                      className="bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-mono px-1.5 py-0.5 rounded cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-rose-400"
                    >
                      <option value="euc-kr">EUC-KR (한국어)</option>
                      <option value="utf-8">UTF-8</option>
                      <option value="windows-949">CP949 (Windows)</option>
                      <option value="iso-8859-1">ISO-8859-1</option>
                    </select>
                  </div>
                </div>
              </th>
              <th className="px-2 py-2 border-r border-slate-800 text-slate-500 text-[10px] text-right font-mono">#</th>
              <th className="px-3 py-1.5 text-left text-emerald-400/90 font-mono">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                    수정: {diffData?.currVersion || '@@/main/1'}
                  </span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[10px] text-slate-500 font-normal hidden lg:inline">인코딩:</span>
                    <select
                      value={rightEncoding}
                      onChange={e => setRightEncoding(e.target.value as any)}
                      className="bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-mono px-1.5 py-0.5 rounded cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    >
                      <option value="euc-kr">EUC-KR (한국어)</option>
                      <option value="utf-8">UTF-8</option>
                      <option value="windows-949">CP949 (Windows)</option>
                      <option value="iso-8859-1">ISO-8859-1</option>
                    </select>
                  </div>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(row => {
              const isSelectedChange = changeRowIds[currentChangeIndex] === row.id;

              // Row background style
              let leftBg = 'bg-slate-950/40 text-slate-300';
              let rightBg = 'bg-slate-950/40 text-slate-300';

              if (row.type === 'deleted') {
                leftBg = 'bg-rose-950/30 text-rose-300 border-l-2 border-rose-500';
                rightBg = 'bg-slate-950/20 text-slate-600 select-none';
              } else if (row.type === 'added') {
                leftBg = 'bg-slate-950/20 text-slate-600 select-none';
                rightBg = 'bg-emerald-950/30 text-emerald-300 border-l-2 border-emerald-500';
              } else if (row.type === 'modified') {
                leftBg = 'bg-rose-950/25 text-rose-200 border-l-2 border-amber-500/80';
                rightBg = 'bg-emerald-950/25 text-emerald-200 border-l-2 border-amber-500/80';
              }

              return (
                <tr
                  key={row.id}
                  ref={el => (rowRefs.current[row.id] = el)}
                  className={`hover:bg-slate-800/40 transition-colors ${
                    isSelectedChange ? 'ring-1 ring-amber-400/80 bg-amber-500/10' : ''
                  }`}
                >
                  {/* Left Gutter Line # */}
                  <td className="px-2 py-0.5 text-right text-slate-600 bg-slate-950/90 select-none border-r border-slate-800 text-[10px]">
                    {row.oldLineNum ?? ''}
                  </td>

                  {/* Left Content (Old) */}
                  <td className={`px-3 py-0.5 whitespace-pre overflow-x-auto border-r border-slate-800 ${leftBg}`}>
                    {row.type === 'modified'
                      ? renderIntraLineDiff(row.oldText, row.newText, 'old')
                      : row.oldText ?? (row.type === 'added' ? <span className="text-slate-700 italic">~</span> : '')}
                  </td>

                  {/* Right Gutter Line # */}
                  <td className="px-2 py-0.5 text-right text-slate-600 bg-slate-950/90 select-none border-r border-slate-800 text-[10px]">
                    {row.newLineNum ?? ''}
                  </td>

                  {/* Right Content (New) */}
                  <td className={`px-3 py-0.5 whitespace-pre overflow-x-auto ${rightBg}`}>
                    {row.type === 'modified'
                      ? renderIntraLineDiff(row.oldText, row.newText, 'new')
                      : row.newText ?? (row.type === 'deleted' ? <span className="text-slate-700 italic">~</span> : '')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // Render Unified Diff
  const renderUnified = () => {
    const patch = diffData?.unifiedDiff;
    if (!patch) return <div className="p-8 text-center text-slate-500 font-mono text-xs">Diff 정보가 없습니다.</div>;

    const lines = patch.split('\n');
    return (
      <div className="p-4 font-mono text-xs overflow-x-auto space-y-0.5 bg-slate-950">
        {lines.map((line, idx) => {
          let bg = 'text-slate-300';
          if (line.startsWith('+') && !line.startsWith('+++')) bg = 'bg-emerald-950/40 text-emerald-300 px-2 py-0.5 rounded border-l-2 border-emerald-500';
          else if (line.startsWith('-') && !line.startsWith('---')) bg = 'bg-rose-950/40 text-rose-300 px-2 py-0.5 rounded border-l-2 border-rose-500';
          else if (line.startsWith('@@')) bg = 'text-cyan-300 bg-cyan-950/40 px-2 py-1 rounded font-bold border-y border-cyan-800/40 my-1';

          return (
            <div key={idx} className={`whitespace-pre ${bg}`}>
              {line}
            </div>
          );
        })}
      </div>
    );
  };

  if (!isOpen) return null;

  // Render Modal via React Portal to document.body
  return createPortal(
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        className={`w-full bg-slate-900 rounded-3xl border border-slate-700/90 shadow-2xl overflow-hidden flex flex-col transition-all duration-200 ${
          isMaximized ? 'h-[96vh] max-w-[98vw]' : 'h-[88vh] max-w-6xl'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Top Header (Fixed at top) */}
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-900/98 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-mantis-500/20 text-mantis-400 flex items-center justify-center flex-shrink-0">
              <GitCompare className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-100 text-sm truncate font-mono">
                  {fileName}
                </span>
                {diffData && (
                  <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] font-mono text-mantis-400">
                    {diffData.prevVersion} ↔ {diffData.currVersion}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 truncate font-mono">
                {cleanFilePath}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            {/* Diff Navigation (Prev / Next Change) */}
            {changeRowIds.length > 0 && (
              <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-xl border border-slate-800 text-xs">
                <span className="text-[11px] font-mono text-slate-400 px-2 select-none">
                  변경점: <strong className="text-amber-300">{currentChangeIndex + 1}</strong> / {changeRowIds.length}
                </span>
                <button
                  onClick={() => jumpToChange('prev')}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                  title="이전 변경점으로 이동"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => jumpToChange('next')}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                  title="다음 변경점으로 이동"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* vimdiff Copy Command Button */}
            <button
              onClick={handleCopyVimdiff}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold font-mono transition-all ${
                copiedVimdiff
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-sm'
                  : 'bg-slate-800/90 hover:bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
              }`}
              title="사내 터미널 붙여넣기용 vimdiff 명령어 복사"
            >
              {copiedVimdiff ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Terminal className="w-3.5 h-3.5 text-mantis-400" />}
              <span>{copiedVimdiff ? '복사됨!' : 'vimdiff 복사'}</span>
            </button>

            {/* Split / Unified View Mode Toggle */}
            <div className="flex items-center p-0.5 bg-slate-950 rounded-xl border border-slate-800">
              <button
                onClick={() => setViewMode('split')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewMode === 'split' ? 'bg-mantis-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="좌우 2열 비교 (Side-by-Side)"
              >
                <Columns className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('unified')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewMode === 'unified' ? 'bg-mantis-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="인라인 통합 뷰 (Unified)"
              >
                <AlignJustify className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Refresh */}
            <button
              onClick={loadDiff}
              disabled={loading}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              title="Diff 다시 불러오기"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-mantis-400' : ''}`} />
            </button>

            {/* Maximize Toggle */}
            <button
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors hidden sm:inline-flex"
              title={isMaximized ? '기본 크기로' : '전체화면'}
            >
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-slate-300 transition-colors flex items-center gap-1 font-bold text-xs"
              title="닫기 (ESC)"
            >
              <X className="w-4 h-4" />
              <span className="hidden sm:inline">닫기</span>
            </button>
          </div>
        </div>

        {/* Sub-Header Toolbar: Stats & Search & CLI */}
        <div className="px-5 py-2 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs flex-shrink-0">
          {/* Diff Stats Badges */}
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-mono font-semibold">
              +{stats.added} 추가
            </span>
            <span className="px-2 py-0.5 rounded-md bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[11px] font-mono font-semibold">
              -{stats.deleted} 삭제
            </span>
            {stats.modified > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[11px] font-mono font-semibold">
                ~{stats.modified} 수정
              </span>
            )}
            <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
              (총 {stats.total} 라인)
            </span>
          </div>

          {/* Search Box in Diff */}
          <div className="flex items-center gap-2 ml-auto">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="코드 내 검색..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1 bg-slate-900 text-slate-200 rounded-xl border border-slate-800 text-xs font-mono outline-none focus:border-mantis-500 w-36 sm:w-48"
              />
            </div>

            {/* CLI Command snippet */}
            <div className="hidden lg:flex items-center gap-1 bg-slate-900 px-2 py-0.5 rounded-lg border border-slate-800 max-w-sm overflow-hidden">
              <Terminal className="w-3 h-3 text-slate-500 flex-shrink-0" />
              <code className="text-[10px] text-mantis-300 font-mono truncate select-all">
                {vimdiffCmd}
              </code>
            </div>
          </div>
        </div>

        {/* Modal Main Content Area */}
        <div ref={containerRef} className="flex-1 overflow-y-auto bg-slate-950 relative">
          {loading && (
            <div className="absolute inset-0 z-20 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-7 h-7 text-mantis-400 animate-spin" />
              <p className="text-xs font-semibold text-slate-300">
                ClearCase VOB 서버(SSH)에서 이전/현재 버전 소스를 읽어오는 중...
              </p>
            </div>
          )}

          {error ? (
            <div className="p-6 max-w-xl mx-auto space-y-4 my-6">
              <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-3 shadow-lg">
                <div className="flex items-center gap-2 font-bold text-sm text-amber-300">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  {sshConfig?.host ? `ClearCase 소스 파일 조회 실패 (${sshConfig.username}@${sshConfig.host})` : 'ClearCase SSH 연동 필요'}
                </div>
                <p className="text-xs leading-relaxed text-slate-300 whitespace-pre-line font-mono">
                  {error}
                </p>
                {!sshConfig?.host ? (
                  <p className="text-xs text-slate-400 leading-relaxed">
                    사내 ClearCase VOB 서버의 IP, Port, ID, Password가 설정되어 있어야 웹 화면에서 실시간 Diff를 직접 불러올 수 있습니다.
                  </p>
                ) : (
                  <p className="text-xs text-slate-400 leading-relaxed">
                    SSH 서버 연결은 정상이나, ClearCase 서버 내에 해당 파일이 아직 체크인되지 않았거나 View가 마운트되지 않았을 수 있습니다.
                  </p>
                )}

                <div className="pt-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={loadDiff}
                    disabled={loading}
                    className="px-4 py-2 rounded-xl bg-mantis-500 hover:bg-mantis-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    다시 시도
                  </button>

                  {onOpenSettings && (
                    <button
                      onClick={() => {
                        onClose();
                        onOpenSettings();
                      }}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs flex items-center gap-1.5 transition-all shadow-sm"
                    >
                      <Settings className="w-4 h-4 text-slate-400" />
                      SSH 설정 확인
                    </button>
                  )}

                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs flex items-center gap-1 transition-all"
                  >
                    <X className="w-3.5 h-3.5" />
                    창 닫기 (ESC)
                  </button>
                </div>
              </div>

              {/* Provide the vimdiff CLI box */}
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Terminal className="w-4 h-4 text-mantis-400" />
                    사내 터미널에서 직접 실행하기:
                  </span>
                  <button
                    onClick={handleCopyVimdiff}
                    className="text-[11px] text-slate-400 hover:text-mantis-300 flex items-center gap-1 transition-colors"
                  >
                    <Copy className="w-3 h-3" /> 복사
                  </button>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-mantis-300 select-all overflow-x-auto leading-relaxed">
                  {vimdiffCmd}
                </div>
              </div>
            </div>
          ) : (
            <>
              {viewMode === 'split' ? renderSideBySide() : renderUnified()}
            </>
          )}
        </div>

        {/* Modal Footer Info */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/98 text-xs text-slate-400 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/40 border border-emerald-400 inline-block"></span>
              <span>추가 (+{stats.added})</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/40 border border-rose-400 inline-block"></span>
              <span>삭제 (-{stats.deleted})</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/40 border border-amber-400 inline-block"></span>
              <span>수정 (~{stats.modified})</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-slate-500">
              {sshConfig?.host ? `SSH: ${sshConfig.username}@${sshConfig.host}` : 'SSH 미설정'}
            </span>

            <button
              onClick={onClose}
              className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
            >
              닫기
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
};
