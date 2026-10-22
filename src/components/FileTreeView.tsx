import React, { useState, useMemo, useEffect } from 'react';
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
  GitCompare,
  GitBranch,
  CornerDownRight,
  Layers
} from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';
import { 
  isDirectoryElement, 
  filterOutDirectories, 
  KNOWN_CODE_EXTS 
} from '../utils/fileUtils';
import { fetchVobTree } from '../services/api';

export { isDirectoryElement, filterOutDirectories };

interface FileTreeViewProps {
  filePaths: string[];
  onOpenDiff?: (filePath: string) => void;
}

interface TreeNode {
  name: string;
  fullPath: string;
  realFullPath?: string;
  isFolder: boolean;
  fileCount: number;
  children: Record<string, TreeNode>;
}

export interface VobLineageNode {
  vob: string;
  isOther?: boolean;
  baseVob: string | null;
  files: Array<{ fullPath: string; subPath: string }>;
  children: VobLineageNode[];
}

// Module-level cache for Mantis VOB lineage map
let cachedVobTreeMap: Record<string, string | null> | null = null;
let vobTreePromise: Promise<Record<string, string | null>> | null = null;

async function getVobBaseMap(): Promise<Record<string, string | null>> {
  if (cachedVobTreeMap) return cachedVobTreeMap;
  if (!vobTreePromise) {
    vobTreePromise = fetchVobTree()
      .then(res => {
        const map: Record<string, string | null> = {};
        if (res && res.nodes) {
          for (const node of res.nodes) {
            map[node.vob] = node.baseVob || null;
          }
        }
        cachedVobTreeMap = map;
        return map;
      })
      .catch(err => {
        console.warn('Failed to load VOB tree for lineage, using fallback heuristic:', err);
        return {};
      });
  }
  return vobTreePromise;
}

/**
 * Parses ClearCase file path to extract VOB name and internal relative subPath.
 * Example: /view/hyungduk_view/vobs/REL/SSW_KTC4_41A/SSW/db/altibase/util/css_rep_drop.exe
 *   -> { vob: "SSW_KTC4_41A", subPath: "SSW/db/altibase/util/css_rep_drop.exe" }
 */
export function parseVobFromFilePath(path: string): { vob: string; subPath: string } | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, '/');
  const match = normalized.match(/\/vobs\/(?:REL\/|DEV\/|PRJ\/|TMP\/)?([^/]+)\/(.*)$/i);
  if (match) {
    return {
      vob: match[1],
      subPath: match[2]
    };
  }
  return null;
}

/**
 * Parses VOB version string to aid heuristic predecessor matching.
 * e.g. SSW_KTC4_40A -> prefix: "ssw_ktc4_", versionNum: 40, versionSuffix: "a"
 */
function parseVobVersion(vob: string): { prefix: string; versionNum: number; versionSuffix: string } | null {
  const m = vob.match(/^(.*?)(?:_)?(\d+)([a-zA-Z]*)$/);
  if (m) {
    return {
      prefix: m[1].toLowerCase(),
      versionNum: parseInt(m[2], 10),
      versionSuffix: (m[3] || '').toLowerCase()
    };
  }
  return null;
}

/**
 * Finds parent VOB among all VOBs present in the current CR file set.
 */
function findParentVob(
  vob: string, 
  allVobs: Set<string>, 
  baseMap: Record<string, string | null>
): string | null {
  // 1. Walk up baseMap to find the closest ancestor present in allVobs
  let curr = baseMap[vob] || null;
  const visited = new Set<string>([vob]);
  while (curr && !visited.has(curr)) {
    visited.add(curr);
    if (allVobs.has(curr) && curr !== vob) {
      return curr;
    }
    curr = baseMap[curr] || null;
  }

  // 2. Fallback heuristic: check if another present VOB shares the same prefix and is a direct predecessor
  const parsed = parseVobVersion(vob);
  if (parsed) {
    let bestCandidate: string | null = null;
    let bestVerNum = -1;
    let bestVerSuffix = '';

    for (const other of allVobs) {
      if (other === vob) continue;
      const otherParsed = parseVobVersion(other);
      if (otherParsed && otherParsed.prefix === parsed.prefix) {
        // Must be older version
        const isSmaller = otherParsed.versionNum < parsed.versionNum || 
          (otherParsed.versionNum === parsed.versionNum && otherParsed.versionSuffix < parsed.versionSuffix);
        
        if (isSmaller) {
          // Find the closest/highest among predecessors
          if (
            otherParsed.versionNum > bestVerNum || 
            (otherParsed.versionNum === bestVerNum && otherParsed.versionSuffix > bestVerSuffix)
          ) {
            bestCandidate = other;
            bestVerNum = otherParsed.versionNum;
            bestVerSuffix = otherParsed.versionSuffix;
          }
        }
      }
    }

    if (bestCandidate) {
      return bestCandidate;
    }
  }

  return null;
}

/**
 * Builds hierarchical VOB Lineage tree (Base VOB -> Derived VOBs).
 */
export function buildVobLineageHierarchy(
  paths: string[], 
  baseMap: Record<string, string | null>
): VobLineageNode[] {
  const vobMap = new Map<string, Array<{ fullPath: string; subPath: string }>>();
  const otherFiles: Array<{ fullPath: string; subPath: string }> = [];

  for (const rawPath of paths) {
    const parsed = parseVobFromFilePath(rawPath);
    if (parsed) {
      if (!vobMap.has(parsed.vob)) {
        vobMap.set(parsed.vob, []);
      }
      vobMap.get(parsed.vob)!.push({ fullPath: rawPath, subPath: parsed.subPath });
    } else {
      otherFiles.push({ fullPath: rawPath, subPath: rawPath.replace(/^\/+/, '') });
    }
  }

  const allVobSet = new Set(vobMap.keys());
  const nodeMap = new Map<string, VobLineageNode>();

  for (const [vob, files] of vobMap.entries()) {
    nodeMap.set(vob, {
      vob,
      baseVob: baseMap[vob] || null,
      files,
      children: []
    });
  }

  const rootNodes: VobLineageNode[] = [];

  for (const [vob, node] of nodeMap.entries()) {
    const parentName = findParentVob(vob, allVobSet, baseMap);
    if (parentName && nodeMap.has(parentName)) {
      node.baseVob = node.baseVob || parentName;
      nodeMap.get(parentName)!.children.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  function sortVobNodes(nodes: VobLineageNode[]) {
    nodes.sort((a, b) => a.vob.localeCompare(b.vob));
    for (const n of nodes) {
      sortVobNodes(n.children);
    }
  }
  sortVobNodes(rootNodes);

  if (otherFiles.length > 0) {
    rootNodes.push({
      vob: '기타 파일 (Non-VOB)',
      isOther: true,
      baseVob: null,
      files: otherFiles,
      children: []
    });
  }

  return rootNodes;
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
  if (lower.endsWith('.sql') || lower.includes('.tbl') || lower.includes('.db') || lower.endsWith('.dat') || lower.endsWith('.fmt')) {
    return <Database className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
  }
  if (lower.startsWith('makefile') || lower === 'makeall' || lower.endsWith('.mk')) {
    return <Settings className="w-4 h-4 text-rose-400 flex-shrink-0" />;
  }
  return <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />;
}

// Build raw tree from paths with optional mapping to actual full clearcase path
function buildRawTree(paths: string[], subToFullMap?: Record<string, string>): TreeNode {
  const cleanPaths = filterOutDirectories(paths);

  const root: TreeNode = {
    name: 'root',
    fullPath: '',
    isFolder: true,
    fileCount: cleanPaths.length,
    children: {}
  };

  for (const rawPath of cleanPaths) {
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
          realFullPath: isFile && subToFullMap ? (subToFullMap[cleanPath] || subToFullMap[accumulatedPath] || rawPath) : rawPath,
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

  // Ensure any node with children is strictly treated as a folder
  function ensureFolderFlags(node: TreeNode) {
    if (Object.keys(node.children).length > 0) {
      node.isFolder = true;
      Object.values(node.children).forEach(ensureFolderFlags);
    }
  }
  ensureFolderFlags(root);

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
        realFullPath: singleChild.realFullPath,
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

  const effectivePath = node.realFullPath || node.fullPath;

  if (node.isFolder) {
    return (
      <div className="select-none">
        <div
          onClick={() => toggleFolder(node.fullPath)}
          style={{ paddingLeft: `${level * 16 + 6}px` }}
          className="py-1.5 px-2 rounded-xl hover:bg-slate-850 cursor-pointer flex items-center justify-between group transition-all text-xs"
        >
          <div className="flex items-center gap-2 truncate">
            <span className="text-slate-400 group-hover:text-slate-200 transition-colors">
              {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </span>
            {isOpen ? (
              <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-amber-400/90 flex-shrink-0" />
            )}
            
            {/* Highlighted Folder Path */}
            <span className="font-semibold text-slate-200 group-hover:text-white truncate font-mono text-[12px]">
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
            onClick={async e => {
              e.stopPropagation();
              await onCopyPath(effectivePath);
            }}
            className={`p-1 rounded-lg hover:bg-slate-700 transition-all text-[10px] flex items-center gap-1 ${
              copiedPath === effectivePath
                ? 'opacity-100 text-emerald-400 bg-emerald-500/10'
                : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-200'
            }`}
            title={copiedPath === effectivePath ? '폴더 경로 복사 완료!' : '폴더 경로 복사'}
          >
            {copiedPath === effectivePath ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
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
        <span className="font-mono text-slate-200 group-hover:text-mantis-300 truncate font-medium text-[11px]">
          {node.name}
        </span>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {onOpenDiff && (
          <button
            onClick={() => onOpenDiff(effectivePath)}
            className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-300 hover:text-white border border-indigo-500/30 text-[10px] font-semibold flex items-center gap-1 transition-all"
            title="ClearCase Diff 비교 (SSH / vimdiff)"
          >
            <GitCompare className="w-3 h-3 text-indigo-400" />
            <span>Diff</span>
          </button>
        )}

        <button
          onClick={async e => {
            e.stopPropagation();
            await onCopyPath(effectivePath);
          }}
          className={`p-1 rounded hover:bg-slate-700 transition-all ${
            copiedPath === effectivePath
              ? 'opacity-100 text-emerald-400 bg-emerald-500/10'
              : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-200'
          }`}
          title={copiedPath === effectivePath ? '파일 경로 복사 완료!' : '파일 전체 경로 복사'}
        >
          {copiedPath === effectivePath ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
};

/**
 * Item representing a VOB in the Lineage Tree, including its internal file sub-tree
 * and any child VOBs deriving from it.
 */
const VobLineageNodeItem: React.FC<{
  node: VobLineageNode;
  isRoot: boolean;
  depth: number;
  openVobs: Set<string>;
  toggleVob: (vob: string) => void;
  openFolders: Set<string>;
  toggleFolder: (path: string) => void;
  isCompact: boolean;
  onCopyPath: (path: string) => void;
  copiedPath: string | null;
  onOpenDiff?: (path: string) => void;
}> = ({
  node,
  isRoot,
  depth,
  openVobs,
  toggleVob,
  openFolders,
  toggleFolder,
  isCompact,
  onCopyPath,
  copiedPath,
  onOpenDiff
}) => {
  const isOpen = openVobs.has(node.vob);

  // Build tree for internal files
  const vobSubTree = useMemo(() => {
    if (node.files.length === 0) return null;
    const subToFullMap: Record<string, string> = {};
    const subPaths = node.files.map(f => {
      const cleanSub = f.subPath.replace(/^\/+/, '');
      subToFullMap[cleanSub] = f.fullPath;
      subToFullMap['/' + cleanSub] = f.fullPath;
      return cleanSub;
    });
    const raw = buildRawTree(subPaths, subToFullMap);
    return isCompact ? compactTree(raw) : raw;
  }, [node.files, isCompact]);

  const vobSubTreeKeys = useMemo(() => {
    if (!vobSubTree) return [];
    return Object.keys(vobSubTree.children).sort((a, b) => {
      const aIsFolder = vobSubTree.children[a].isFolder;
      const bIsFolder = vobSubTree.children[b].isFolder;
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
      return a.localeCompare(b);
    });
  }, [vobSubTree]);

  return (
    <div className="relative">
      {/* Branch connector line for child VOB */}
      {depth > 0 && (
        <div className="absolute -left-3 top-4 w-3 h-5 border-l-2 border-b-2 border-indigo-500/40 rounded-bl pointer-events-none" />
      )}

      <div className={`rounded-xl border transition-all ${
        node.isOther
          ? 'bg-slate-900/60 border-slate-800'
          : isRoot
          ? 'bg-gradient-to-r from-emerald-950/30 via-slate-900/80 to-slate-900/80 border-emerald-500/35 shadow-lg shadow-emerald-950/20'
          : 'bg-gradient-to-r from-indigo-950/30 via-slate-900/80 to-slate-900/80 border-indigo-500/35 shadow-lg shadow-indigo-950/20'
      }`}>
        {/* VOB Header Bar */}
        <div 
          onClick={() => toggleVob(node.vob)}
          className="p-2.5 px-3 flex items-center justify-between cursor-pointer hover:bg-white/[0.02] select-none"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400 group-hover:text-slate-200 transition-colors">
              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </span>

            {depth > 0 && (
              <span className="text-indigo-400 font-bold text-xs select-none">ㄴ</span>
            )}

            <div className={`p-1.5 rounded-lg flex-shrink-0 ${
              node.isOther
                ? 'bg-slate-800 text-slate-400'
                : isRoot
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
            }`}>
              {node.isOther ? <Folder className="w-4 h-4" /> : <GitBranch className="w-4 h-4" />}
            </div>

            <div className="flex items-center gap-2 truncate">
              <span className="font-mono font-bold text-xs sm:text-sm text-slate-100 tracking-tight truncate">
                {node.vob}
              </span>

              {!node.isOther && (
                isRoot ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex-shrink-0">
                    BASE VOB
                  </span>
                ) : (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      파생 VOB
                    </span>
                    {node.baseVob && (
                      <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
                        (Base: <strong className="text-indigo-300 font-semibold">{node.baseVob}</strong>)
                      </span>
                    )}
                  </div>
                )
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="px-2 py-0.5 rounded-md bg-slate-800/90 text-slate-300 text-[11px] font-mono font-medium border border-slate-700/60">
              {node.files.length}개 파일
            </span>

            <button
              onClick={async e => {
                e.stopPropagation();
                const allVobPaths = node.files.map(f => f.fullPath).join('\n');
                await onCopyPath(allVobPaths);
              }}
              className="p-1 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-semibold border border-slate-700 flex items-center gap-1 transition-all"
              title="이 VOB의 모든 파일 경로 복사"
            >
              <Copy className="w-3 h-3" />
              <span className="hidden sm:inline">경로 복사</span>
            </button>
          </div>
        </div>

        {/* Body: Internal files + child VOBs */}
        {isOpen && (
          <div className="p-3 pt-1 border-t border-slate-800/60 space-y-3">
            {/* Internal Files of this VOB */}
            {node.files.length > 0 && vobSubTree && (
              <div className="bg-slate-950/70 rounded-xl p-2 border border-slate-800/80">
                <div className="text-[10px] font-bold text-slate-400 mb-1 px-1.5 uppercase tracking-wider flex items-center justify-between">
                  <span>수정 파일 목록 ({node.files.length})</span>
                  <span className="text-[9px] text-slate-500 font-normal">
                    {node.vob} 내부 경로
                  </span>
                </div>

                <div className="space-y-0.5 font-mono">
                  {vobSubTreeKeys.map(key => (
                    <TreeNodeItem
                      key={vobSubTree.children[key].fullPath}
                      node={vobSubTree.children[key]}
                      level={0}
                      openFolders={openFolders}
                      toggleFolder={toggleFolder}
                      onCopyPath={onCopyPath}
                      copiedPath={copiedPath}
                      onOpenDiff={onOpenDiff}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Child VOBs in lineage */}
            {node.children.length > 0 && (
              <div className="pl-4 pt-1 space-y-3 border-l-2 border-indigo-500/25 ml-2.5">
                <div className="text-[11px] font-semibold text-indigo-300 flex items-center gap-1.5 pt-0.5">
                  <CornerDownRight className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{node.vob} 기반 파생 VOB ({node.children.length})</span>
                </div>
                {node.children.map(child => (
                  <VobLineageNodeItem
                    key={child.vob}
                    node={child}
                    isRoot={false}
                    depth={depth + 1}
                    openVobs={openVobs}
                    toggleVob={toggleVob}
                    openFolders={openFolders}
                    toggleFolder={toggleFolder}
                    isCompact={isCompact}
                    onCopyPath={onCopyPath}
                    copiedPath={copiedPath}
                    onOpenDiff={onOpenDiff}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const FileTreeView: React.FC<FileTreeViewProps> = ({ filePaths, onOpenDiff }) => {
  const [viewMode, setViewMode] = useState<'vobTree' | 'tree' | 'flat'>('vobTree');
  const [isCompact, setIsCompact] = useState(true);
  const [filterQuery, setFilterQuery] = useState('');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // Mantis VOB lineage map
  const [vobBaseMap, setVobBaseMap] = useState<Record<string, string | null>>(() => cachedVobTreeMap || {});

  useEffect(() => {
    if (!cachedVobTreeMap) {
      getVobBaseMap().then(map => setVobBaseMap(map));
    }
  }, []);

  // Filter out directory elements from raw filePaths
  const cleanPaths = useMemo(() => {
    return filterOutDirectories(filePaths || []);
  }, [filePaths]);

  // Filter paths by search query
  const filteredPaths = useMemo(() => {
    if (!filterQuery.trim()) return cleanPaths;
    const q = filterQuery.toLowerCase();
    return cleanPaths.filter(p => p.toLowerCase().includes(q));
  }, [cleanPaths, filterQuery]);

  // Build classic filesystem tree (compacted or raw)
  const tree = useMemo(() => {
    const raw = buildRawTree(filteredPaths);
    return isCompact ? compactTree(raw) : raw;
  }, [filteredPaths, isCompact]);

  // Build VOB Lineage Hierarchy
  const vobHierarchy = useMemo(() => {
    return buildVobLineageHierarchy(filteredPaths, vobBaseMap);
  }, [filteredPaths, vobBaseMap]);

  // Manage open VOB cards (default: open all VOBs in current set)
  const [openVobs, setOpenVobs] = useState<Set<string>>(() => {
    const s = new Set<string>();
    function collect(nodes: VobLineageNode[]) {
      for (const n of nodes) {
        s.add(n.vob);
        collect(n.children);
      }
    }
    const initialHierarchy = buildVobLineageHierarchy(cleanPaths, cachedVobTreeMap || {});
    collect(initialHierarchy);
    return s;
  });

  // Keep openVobs populated when hierarchy changes
  useEffect(() => {
    setOpenVobs(prev => {
      const next = new Set(prev);
      function collect(nodes: VobLineageNode[]) {
        for (const n of nodes) {
          next.add(n.vob);
          collect(n.children);
        }
      }
      collect(vobHierarchy);
      return next;
    });
  }, [vobHierarchy]);

  const toggleVob = (vob: string) => {
    setOpenVobs(prev => {
      const next = new Set(prev);
      if (next.has(vob)) next.delete(vob);
      else next.add(vob);
      return next;
    });
  };

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
    const raw = buildRawTree(cleanPaths);
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
    // Expand all folders
    const allFolders = new Set<string>();
    function collectFolders(node: TreeNode) {
      if (node.isFolder && node.fullPath) allFolders.add(node.fullPath);
      Object.values(node.children).forEach(collectFolders);
    }
    collectFolders(tree);
    setOpenFolders(allFolders);

    // Also expand all VOB cards
    const allV = new Set<string>();
    function collectVobs(nodes: VobLineageNode[]) {
      for (const n of nodes) {
        allV.add(n.vob);
        collectVobs(n.children);
      }
    }
    collectVobs(vobHierarchy);
    setOpenVobs(allV);
  };

  const handleCollapseAll = () => {
    setOpenFolders(new Set());
    setOpenVobs(new Set());
  };

  const handleCopyPath = async (path: string) => {
    const ok = await copyToClipboard(path);
    if (ok) {
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1500);
    }
  };

  const handleCopyAll = async () => {
    const ok = await copyToClipboard(filteredPaths.join('\n'));
    if (ok) {
      setCopiedPath('all');
      setTimeout(() => setCopiedPath(null), 1500);
    }
  };

  if (!filePaths || filePaths.length === 0) {
    return (
      <div className="p-8 text-center text-slate-400 text-xs">
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
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={filterQuery}
            onChange={e => setFilterQuery(e.target.value)}
            placeholder="VOB, 경로 또는 파일명 검색... (예: 41A, Makefile, .c)"
            className="w-full pl-8 pr-3 py-1.5 bg-slate-950 text-slate-200 text-xs rounded-xl border border-slate-800 focus:border-mantis-500 outline-none"
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {viewMode !== 'flat' && (
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
                title="모든 VOB 및 폴더 펼치기"
              >
                <ChevronsUpDown className="w-3 h-3" />
                모두 펼치기
              </button>
              <button
                onClick={handleCollapseAll}
                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-medium flex items-center gap-1"
                title="모든 VOB 및 폴더 접기"
              >
                <ChevronsDownUp className="w-3 h-3" />
                모두 접기
              </button>
            </>
          )}

          {/* Copy all paths */}
          <button
            onClick={handleCopyAll}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-mantis-300 border border-slate-700 text-[11px] font-semibold flex items-center gap-1"
          >
            {copiedPath === 'all' ? <Check className="w-3 h-3 text-mantis-400" /> : <Copy className="w-3 h-3" />}
            전체 경로 복사
          </button>

          {/* View mode toggle */}
          <div className="flex items-center p-0.5 bg-slate-950 rounded-lg border border-slate-800 ml-1">
            <button
              onClick={() => setViewMode('vobTree')}
              className={`p-1 px-2.5 rounded flex items-center gap-1.5 text-[11px] font-semibold transition-all ${
                viewMode === 'vobTree' ? 'bg-mantis-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
              title="VOB 계통 (Base -> 파생) 기준 트리 뷰"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>VOB 계통</span>
            </button>
            <button
              onClick={() => setViewMode('tree')}
              className={`p-1 px-2.5 rounded flex items-center gap-1.5 text-[11px] font-semibold transition-all ${
                viewMode === 'tree' ? 'bg-mantis-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
              title="전체 디렉토리 경로 트리 뷰"
            >
              <FolderTree className="w-3.5 h-3.5" />
              <span>경로 트리</span>
            </button>
            <button
              onClick={() => setViewMode('flat')}
              className={`p-1 px-2.5 rounded flex items-center gap-1.5 text-[11px] font-semibold transition-all ${
                viewMode === 'flat' ? 'bg-mantis-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
              title="전체 파일 단순 목록 뷰"
            >
              <List className="w-3.5 h-3.5" />
              <span>목록</span>
            </button>
          </div>
        </div>

      </div>

      {/* Main Files Display Area */}
      <div className="p-3 rounded-2xl bg-slate-950/90 border border-slate-800 max-h-[540px] overflow-y-auto font-mono text-xs shadow-inner">
        {filteredPaths.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs font-sans">
            필터 조건과 일치하는 파일이 없습니다.
          </div>
        ) : viewMode === 'vobTree' ? (
          /* VOB Lineage Tree Mode */
          <div className="space-y-3 font-sans">
            {vobHierarchy.map(rootNode => (
              <VobLineageNodeItem
                key={rootNode.vob}
                node={rootNode}
                isRoot={true}
                depth={0}
                openVobs={openVobs}
                toggleVob={toggleVob}
                openFolders={openFolders}
                toggleFolder={toggleFolder}
                isCompact={isCompact}
                onCopyPath={handleCopyPath}
                copiedPath={copiedPath}
                onOpenDiff={onOpenDiff}
              />
            ))}
          </div>
        ) : viewMode === 'tree' ? (
          /* Classic Directory Tree Mode */
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
              const parsed = parseVobFromFilePath(fPath);
              return (
                <div
                  key={idx}
                  className="p-2 px-3 rounded-xl bg-slate-900/90 border border-slate-800/80 hover:border-slate-700 flex items-center justify-between gap-2 group transition-all"
                >
                  <div className="flex items-center gap-2 truncate">
                    {getFileIcon(fileName)}
                    <div className="truncate flex items-center gap-2">
                      <span className="font-mono font-bold text-mantis-300 text-xs">
                        {fileName}
                      </span>
                      {parsed && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-mono">
                          {parsed.vob}
                        </span>
                      )}
                      <span className="font-mono text-slate-400 text-[10px] select-all truncate">
                        {parsed ? parsed.subPath : fPath}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {onOpenDiff && (
                      <button
                        onClick={() => onOpenDiff(fPath)}
                        className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-300 hover:text-white border border-indigo-500/30 text-[10px] font-semibold flex items-center gap-1 transition-all"
                        title="ClearCase Diff 비교 (SSH / vimdiff)"
                      >
                        <GitCompare className="w-3 h-3 text-indigo-400" />
                        <span>Diff</span>
                      </button>
                    )}

                    <button
                      onClick={async () => {
                        await handleCopyPath(fPath);
                      }}
                      className={`p-1 rounded bg-slate-800 hover:bg-slate-700 transition-all flex-shrink-0 ${
                        copiedPath === fPath
                          ? 'opacity-100 text-emerald-400 bg-emerald-500/10'
                          : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-200'
                      }`}
                      title={copiedPath === fPath ? '경로 복사 완료!' : '경로 복사'}
                    >
                      {copiedPath === fPath ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 font-mono">
        <span>
          총 <strong className="text-slate-300">{filteredPaths.length.toLocaleString()}</strong>개 파일
          {vobHierarchy.length > 0 && (
            <span className="ml-2 text-mantis-400 font-semibold">
              ({vobHierarchy.length}개 VOB 그룹)
            </span>
          )}
          {filteredPaths.length !== cleanPaths.length && ` (전체 ${cleanPaths.length.toLocaleString()}개 중 필터됨)`}
        </span>
        <span className="text-[10px] text-slate-400 font-sans">
          💡 <strong className="text-mantis-400">VOB 계통</strong>: Base VOB 기준으로 파생된 VOB들을 계통도 트리(Base → 파생)로 정리하여 보여줍니다.
        </span>
      </div>
    </div>
  );
};
