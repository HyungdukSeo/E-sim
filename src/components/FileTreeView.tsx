import React, { useState, useMemo } from 'react';
import { 
  Folder, 
  FolderOpen, 
  FileCode, 
  FileText, 
  Database, 
  Terminal, 
  Settings, 
  Copy, 
  Check, 
  ChevronRight, 
  ChevronDown, 
  Search, 
  List, 
  FolderTree,
  ChevronsUpDown,
  ChevronsDownUp,
  Minimize2,
  GitCompare
} from 'lucide-react';

interface FileTreeViewProps {
  filePaths: string[];
  onOpenDiff?: (filePath: string) => void;
}

interface TreeNode {
  name: string;
  fullPath: string;
  isFolder: boolean;
  fileCount: number;
  children: Record<string, TreeNode>;
}

function getFileIcon(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.c') || lower.endsWith('.cc') || lower.endsWith('.cpp')) {
    return <FileCode className="w-4 h-4 text-blue-400 flex-shrink-0" />;
  }
  if (lower.endsWith('.h') || lower.endsWith('.hh') || lower.endsWith('.hpp')) {
    return <FileCode className="w-4 h-4 text-purple-400 flex-shrink-0" />;
  }
  if (lower.endsWith('.sh') || lower.endsWith('.csh') || lower.endsWith('.bash')) {
    return <Terminal className="w-4 h-4 text-amber-400 flex-shrink-0" />;
  }
  if (lower.endsWith('.sql') || lower.includes('.tbl') || lower.includes('.db')) {
    return <Database className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
  }
  if (lower.startsWith('makefile') || lower === 'makeall' || lower.endsWith('.mk')) {
    return <Settings className="w-4 h-4 text-rose-400 flex-shrink-0" />;
  }
  return <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />;
}

// Build raw tree from paths
function buildRawTree(paths: string[]): TreeNode {
  const root: TreeNode = {
    name: 'root',
    fullPath: '',
    isFolder: true,
    fileCount: paths.length,
    children: {}
  };

  for (const rawPath of paths) {
    const cleanPath = rawPath.replace(/^\/+/, '');
    const parts = cleanPath.split('/');

    let current = root;
    let accumulatedPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      accumulatedPath += '/' + part;

      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          fullPath: accumulatedPath,
          isFolder: !isFile,
          fileCount: isFile ? 0 : 1,
          children: {}
        };
      } else {
        if (!isFile) {
          current.children[part].fileCount++;
        }
      }

      current = current.children[part];
    }
  }

  return root;
}

// Compact single-child folder chains (e.g. view/hyungduk_view/vobs/REL/SSW_KTC4_41A)
function compactTree(node: TreeNode): TreeNode {
  if (!node.isFolder) return node;

  const newChildren: Record<string, TreeNode> = {};
  for (const key of Object.keys(node.children)) {
    newChildren[key] = compactTree(node.children[key]);
  }
  node.children = newChildren;

  const childKeys = Object.keys(node.children);
  if (childKeys.length === 1 && node.name !== 'root') {
    const singleChild = node.children[childKeys[0]];
    if (singleChild.isFolder) {
      return {
        name: `${node.name}/${singleChild.name}`,
        fullPath: singleChild.fullPath,
        isFolder: true,
        fileCount: singleChild.fileCount,
        children: singleChild.children
      };
    }
  }

  return node;
}

const TreeNodeItem: React.FC<{
  node: TreeNode;
  level: number;
  openFolders: Set<string>;
  toggleFolder: (path: string) => void;
  onCopyPath: (path: string) => void;
  copiedPath: string | null;
  onOpenDiff?: (path: string) => void;
}> = ({ node, level, openFolders, toggleFolder, onCopyPath, copiedPath, onOpenDiff }) => {
  const isOpen = openFolders.has(node.fullPath);
  const childrenKeys = Object.keys(node.children).sort((a, b) => {
    const aIsFolder = node.children[a].isFolder;
    const bIsFolder = node.children[b].isFolder;
    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
    return a.localeCompare(b);
  });

  if (node.isFolder) {
    return (
      <div className="select-none">
        <div
          onClick={() => toggleFolder(node.fullPath)}
          style={{ paddingLeft: `${level * 16 + 6}px` }}
          className="py-1.5 px-2 rounded-xl hover:bg-slate-850 cursor-pointer flex items-center justify-between group transition-all text-xs"
        >
          <div className="flex items-center gap-2 truncate">
            <span className="text-main0 group-hover:text-slate-300 transition-colors">
              {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </span>
            {isOpen ? (
              <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-amber-400/90 flex-shrink-0" />
            )}
            
            {/* Highlighted Folder Path */}
            <span className="font-semibold text-slate-200 group-hover:text-main truncate font-mono text-[12px]">
              {node.name.includes('/') ? (
                <>
                  <span className="text-slate-400">{node.name.substring(0, node.name.lastIndexOf('/') + 1)}</span>
                  <span className="text-amber-300 font-bold">{node.name.substring(node.name.lastIndexOf('/') + 1)}</span>
                </>
              ) : (
                node.name
              )}
            </span>

            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 font-mono font-medium">
              {node.fileCount}
            </span>
          </div>

          <button
            onClick={e => {
              e.stopPropagation();
              onCopyPath(node.fullPath);
            }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-main transition-all text-[10px] flex items-center gap-1"
            title="폴더 경로 복사"
          >
            {copiedPath === node.fullPath ? <Check className="w-3 h-3 text-mantis-600 dark:text-mantis-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>

        {isOpen && (
          <div className="border-l border-slate-800/80 ml-3.5">
            {childrenKeys.map(key => (
              <TreeNodeItem
                key={node.children[key].fullPath}
                node={node.children[key]}
                level={level + 1}
                openFolders={openFolders}
                toggleFolder={toggleFolder}
                onCopyPath={onCopyPath}
                copiedPath={copiedPath}
                onOpenDiff={onOpenDiff}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File Node
  return (
    <div
      style={{ paddingLeft: `${level * 16 + 18}px` }}
      className="py-1 px-2 rounded-lg hover:bg-slate-850/80 flex items-center justify-between group transition-colors text-xs"
    >
      <div className="flex items-center gap-2 truncate">
        {getFileIcon(node.name)}
        <span className="font-mono text-slate-200 group-hover:text-mantis-700 dark:text-mantis-300 truncate font-medium text-[11px]">
          {node.name}
        </span>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {onOpenDiff && (
          <button
            onClick={() => onOpenDiff(node.fullPath)}
            className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-300 hover:text-main border border-indigo-500/30 text-[10px] font-semibold flex items-center gap-1 transition-all"
            title="ClearCase Diff 비교 (SSH / vimdiff)"
          >
            <GitCompare className="w-3 h-3 text-indigo-400" />
            <span>Diff</span>
          </button>
        )}

        <button
          onClick={() => onCopyPath(node.fullPath)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-main transition-all"
          title="파일 전체 경로 복사"
        >
          {copiedPath === node.fullPath ? <Check className="w-3 h-3 text-mantis-600 dark:text-mantis-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
    </div>
  );
};

export const FileTreeView: React.FC<FileTreeViewProps> = ({ filePaths, onOpenDiff }) => {
  const [viewMode, setViewMode] = useState<'tree' | 'flat'>('tree');
  const [isCompact, setIsCompact] = useState(true);
  const [filterQuery, setFilterQuery] = useState('');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // Filter paths
  const filteredPaths = useMemo(() => {
    if (!filterQuery.trim()) return filePaths;
    const q = filterQuery.toLowerCase();
    return filePaths.filter(p => p.toLowerCase().includes(q));
  }, [filePaths, filterQuery]);

  // Build tree (compacted or raw)
  const tree = useMemo(() => {
    const raw = buildRawTree(filteredPaths);
    return isCompact ? compactTree(raw) : raw;
  }, [filteredPaths, isCompact]);

  // Manage open folders (Auto open top 2 levels by default)
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    function autoOpen(node: TreeNode, depth: number) {
      if (depth > 2) return;
      if (node.fullPath) initial.add(node.fullPath);
      Object.values(node.children).forEach(c => {
        if (c.isFolder) autoOpen(c, depth + 1);
      });
    }
    const raw = buildRawTree(filePaths);
    const t = compactTree(raw);
    autoOpen(t, 0);
    return initial;
  });

  const toggleFolder = (path: string) => {
    setOpenFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleExpandAll = () => {
    const all = new Set<string>();
    function collect(node: TreeNode) {
      if (node.isFolder && node.fullPath) all.add(node.fullPath);
      Object.values(node.children).forEach(collect);
    }
    collect(tree);
    setOpenFolders(all);
  };

  const handleCollapseAll = () => {
    setOpenFolders(new Set());
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  const handleCopyAll = () => {
    navigator.clipboard.writeText(filteredPaths.join('\n'));
    setCopiedPath('all');
    setTimeout(() => setCopiedPath(null), 1500);
  };

  if (!filePaths || filePaths.length === 0) {
    return (
      <div className="p-8 text-center text-main0 text-xs">
        수정된 소스 파일 목록이 없습니다.
      </div>
    );
  }

  const rootChildrenKeys = Object.keys(tree.children).sort((a, b) => {
    const aIsFolder = tree.children[a].isFolder;
    const bIsFolder = tree.children[b].isFolder;
    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-3">
      {/* Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        
        {/* Filter input */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-3.5 h-3.5 text-main0 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={filterQuery}
            onChange={e => setFilterQuery(e.target.value)}
            placeholder="경로 또는 파일명 필터... (예: Makefile, .c)"
            className="w-full pl-8 pr-3 py-1.5 bg-slate-950 text-slate-200 text-xs rounded-xl border border-slate-800 focus:border-mantis-500 outline-none"
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {viewMode === 'tree' && (
            <>
              {/* Compact Folders Toggle Button */}
              <button
                onClick={() => setIsCompact(p => !p)}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition-all ${
                  isCompact
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
                title="단일 하위 경로를 한 줄로 압축하여 표시"
              >
                <Minimize2 className="w-3 h-3" />
                <span>압축 경로 {isCompact ? 'ON' : 'OFF'}</span>
              </button>

              <button
                onClick={handleExpandAll}
                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-medium flex items-center gap-1"
                title="모든 폴더 펼치기"
              >
                <ChevronsUpDown className="w-3 h-3" />
                모두 펼치기
              </button>
              <button
                onClick={handleCollapseAll}
                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-medium flex items-center gap-1"
                title="모든 폴더 접기"
              >
                <ChevronsDownUp className="w-3 h-3" />
                모두 접기
              </button>
            </>
          )}

          {/* Copy all paths */}
          <button
            onClick={handleCopyAll}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-mantis-700 dark:text-mantis-300 border border-slate-700 text-[11px] font-semibold flex items-center gap-1"
          >
            {copiedPath === 'all' ? <Check className="w-3 h-3 text-mantis-600 dark:text-mantis-400" /> : <Copy className="w-3 h-3" />}
            전체 경로 복사
          </button>

          {/* View mode toggle */}
          <div className="flex items-center p-0.5 bg-slate-950 rounded-lg border border-slate-800 ml-1">
            <button
              onClick={() => setViewMode('tree')}
              className={`p-1 px-2 rounded flex items-center gap-1 text-[11px] font-semibold transition-all ${
                viewMode === 'tree' ? 'bg-mantis-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-main'
              }`}
              title="폴더 트리 구조 뷰"
            >
              <FolderTree className="w-3.5 h-3.5" />
              <span>트리</span>
            </button>
            <button
              onClick={() => setViewMode('flat')}
              className={`p-1 px-2 rounded flex items-center gap-1 text-[11px] font-semibold transition-all ${
                viewMode === 'flat' ? 'bg-mantis-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-main'
              }`}
              title="전체 평면 목록 뷰"
            >
              <List className="w-3.5 h-3.5" />
              <span>목록</span>
            </button>
          </div>
        </div>

      </div>

      {/* Main Files Display Area */}
      <div className="p-3 rounded-2xl bg-slate-950/90 border border-slate-800 max-h-[520px] overflow-y-auto font-mono text-xs shadow-inner">
        {filteredPaths.length === 0 ? (
          <div className="py-8 text-center text-main0 text-xs font-sans">
            필터 조건과 일치하는 파일이 없습니다.
          </div>
        ) : viewMode === 'tree' ? (
          <div className="space-y-0.5">
            {rootChildrenKeys.map(key => (
              <TreeNodeItem
                key={tree.children[key].fullPath}
                node={tree.children[key]}
                level={0}
                openFolders={openFolders}
                toggleFolder={toggleFolder}
                onCopyPath={handleCopyPath}
                copiedPath={copiedPath}
                onOpenDiff={onOpenDiff}
              />
            ))}
          </div>
        ) : (
          /* Flat List Mode */
          <div className="space-y-1.5 font-sans">
            {filteredPaths.map((fPath, idx) => {
              const fileName = fPath.split('/').pop() || fPath;
              return (
                <div
                  key={idx}
                  className="p-2 px-3 rounded-xl bg-slate-900/90 border border-slate-800/80 hover:border-slate-700 flex items-center justify-between gap-2 group transition-all"
                >
                  <div className="flex items-center gap-2 truncate">
                    {getFileIcon(fileName)}
                    <div className="truncate">
                      <span className="font-mono font-bold text-mantis-700 dark:text-mantis-300 text-xs">
                        {fileName}
                      </span>
                      <span className="font-mono text-main0 text-[10px] ml-2 select-all">
                        {fPath}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {onOpenDiff && (
                      <button
                        onClick={() => onOpenDiff(fPath)}
                        className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-300 hover:text-main border border-indigo-500/30 text-[10px] font-semibold flex items-center gap-1 transition-all"
                        title="ClearCase Diff 비교 (SSH / vimdiff)"
                      >
                        <GitCompare className="w-3 h-3 text-indigo-400" />
                        <span>Diff</span>
                      </button>
                    )}

                    <button
                      onClick={() => handleCopyPath(fPath)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-main transition-all flex-shrink-0"
                      title="경로 복사"
                    >
                      {copiedPath === fPath ? <Check className="w-3 h-3 text-mantis-600 dark:text-mantis-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] text-main0 px-1 font-mono">
        <span>
          총 <strong className="text-slate-300">{filteredPaths.length.toLocaleString()}</strong>개 파일
          {filteredPaths.length !== filePaths.length && ` (전체 ${filePaths.length.toLocaleString()}개 중 필터됨)`}
        </span>
        <span className="text-[10px] text-main0 font-sans">
          💡 <strong className="text-amber-400">압축 경로</strong>: 단일 경로를 한 줄로 결합하여 분기 지점(<code className="text-slate-300">BASE</code>, <code className="text-slate-300">SSW</code>, <code className="text-slate-300">STK</code> 등)을 즉시 펼쳐볼 수 있습니다.
        </span>
      </div>
    </div>
  );
};
