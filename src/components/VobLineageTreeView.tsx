import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Network,
  Search,
  ChevronRight,
  ChevronDown,
  GitBranch,
  Calendar,
  ExternalLink,
  Layers,
  ArrowRight,
  RefreshCw,
  FolderTree,
  X,
  FileCode2,
  FolderOpen,
  CornerDownRight,
  Sparkles,
  ChevronUp
} from 'lucide-react';
import { fetchVobTree, VobTreeNode, VobTreeResponse, VobTreeFlatNode } from '../services/api';
import { CRItem } from '../types/cr';

interface VobLineageTreeViewProps {
  allCrs?: CRItem[];
  onSelectVob: (vobName: string) => void;
  mantisUrl?: string;
}

export const VobLineageTreeView: React.FC<VobLineageTreeViewProps> = ({
  onSelectVob,
  mantisUrl = 'http://192.168.16.200'
}) => {
  const [treeData, setTreeData] = useState<VobTreeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Family filter (all or specific family)
  const [selectedFamily, setSelectedFamily] = useState<string>('all');

  // Expanded nodes set (set of vob names)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Highlighted VOB (target of scroll & pulse)
  const [highlightedVob, setHighlightedVob] = useState<string | null>(null);

  // Load tree data on mount
  const loadTree = async (forceRefresh = false) => {
    if (forceRefresh) setIsRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await fetchVobTree(forceRefresh);
      if (data && data.ok) {
        setTreeData(data);

        // Auto-expand all top-level roots initially
        const initialExpanded = new Set<string>();
        for (const root of data.roots || []) {
          initialExpanded.add(root.vob);
          // Also expand first level of children
          for (const c of root.children || []) {
            if (c.children && c.children.length > 0) {
              initialExpanded.add(c.vob);
            }
          }
        }
        setExpandedNodes(initialExpanded);
      } else {
        setError('VOB 계통도 데이터를 불러올 수 없습니다.');
      }
    } catch (err: any) {
      console.error('[VobLineageTreeView] Failed to load tree:', err);
      setError(err.message || '서버 연결에 실패했습니다.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadTree();
  }, []);

  // Close search dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Parent mapping for auto-expanding ancestors
  const parentMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!treeData) return map;
    for (const node of treeData.nodes || []) {
      if (node.baseVob) {
        map.set(node.vob, node.baseVob);
      }
    }
    return map;
  }, [treeData]);

  // Real-time search suggestions
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !treeData?.nodes) return [];

    return treeData.nodes
      .filter(n =>
        n.vob.toLowerCase().includes(q) ||
        (n.baseVob && n.baseVob.toLowerCase().includes(q)) ||
        (n.summary && n.summary.toLowerCase().includes(q)) ||
        (n.familyName && n.familyName.toLowerCase().includes(q))
      )
      .slice(0, 15);
  }, [searchQuery, treeData]);

  // Expand or collapse a single node
  const toggleNode = (vob: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(vob)) next.delete(vob);
      else next.add(vob);
      return next;
    });
  };

  // Expand all nodes
  const expandAll = () => {
    if (!treeData?.nodes) return;
    const all = new Set<string>();
    for (const n of treeData.nodes) {
      all.add(n.vob);
    }
    setExpandedNodes(all);
  };

  // Collapse all nodes
  const collapseAll = () => {
    setExpandedNodes(new Set());
  };

  // Jump to specific VOB node
  const handleSelectSearchResult = (vobName: string) => {
    setIsSearchFocused(false);
    setSearchQuery('');

    // If currently filtered by family and target node is not visible, switch to all
    const targetNode = treeData?.nodes?.find(n => n.vob === vobName);
    if (targetNode && selectedFamily !== 'all' && targetNode.family !== selectedFamily) {
      setSelectedFamily('all');
    }

    // 1. Auto-expand all ancestors of target VOB
    setExpandedNodes(prev => {
      const next = new Set(prev);
      let curr: string | undefined = vobName;
      while (curr) {
        next.add(curr);
        curr = parentMap.get(curr);
      }
      return next;
    });

    // 2. Set highlight
    setHighlightedVob(vobName);

    // 3. Smooth scroll to target element
    setTimeout(() => {
      const el = document.getElementById(`vob-node-${vobName}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);

    // Clear pulsing animation after 4 seconds
    setTimeout(() => {
      setHighlightedVob(prev => (prev === vobName ? null : prev));
    }, 4500);
  };

  // Render a recursive tree node
  const renderTreeNode = (node: VobTreeNode, depth = 0, isLast = false) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodes.has(node.vob);
    const isHighlighted = highlightedVob === node.vob;

    return (
      <div key={node.vob} className="relative flex flex-col">
        {/* Connection line for children */}
        {depth > 0 && (
          <div
            className="absolute left-[-22px] top-6 w-[20px] h-[2px] bg-slate-700/60 dark:bg-slate-700/60"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Node Card */}
        <div
          id={`vob-node-${node.vob}`}
          className={`group flex items-center justify-between gap-3 p-3 my-1.5 rounded-xl border transition-all duration-300 ${
            isHighlighted
              ? 'ring-4 ring-emerald-400 border-emerald-400 bg-emerald-500/20 dark:bg-emerald-950/60 shadow-xl shadow-emerald-500/30 scale-[1.01]'
              : 'border-slate-800/80 bg-slate-900/60 hover:bg-slate-800/80 hover:border-slate-700 text-slate-200'
          }`}
        >
          {/* Left: Expand toggle, VOB name, and Badges */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {hasChildren ? (
              <button
                onClick={() => toggleNode(node.vob)}
                className="w-6 h-6 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex-shrink-0"
                title={isExpanded ? '접기' : '펼치기'}
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-emerald-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                )}
              </button>
            ) : (
              <div className="w-6 h-6 flex items-center justify-center text-slate-600 flex-shrink-0">
                <CornerDownRight className="w-3.5 h-3.5" />
              </div>
            )}

            {/* VOB Icon & Name */}
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="font-mono font-bold text-sm tracking-tight text-main group-hover:text-emerald-400 transition-colors">
                {node.vob}
              </span>

              {/* Base VOB indicator if derived */}
              {node.baseVob ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                  <span className="text-slate-400">Base:</span>
                  <span className="font-mono font-semibold">{node.baseVob}</span>
                  {node.isHeuristicLink && (
                    <span className="text-[9px] text-amber-400" title="버전 시퀀스 자동 추정">(추정)</span>
                  )}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                  ROOT
                </span>
              )}

              {/* Child count badge */}
              {hasChildren && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-800 text-emerald-400 border border-slate-700">
                  <GitBranch className="w-3 h-3" />
                  {node.children.length}개 파생
                </span>
              )}
            </div>
          </div>

          {/* Right: Meta & Action buttons */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Created date & CR ID */}
            <div className="hidden sm:flex flex-col items-end text-[11px] text-slate-400 font-mono">
              {node.createdDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-500" />
                  {node.createdDate}
                </span>
              )}
              {node.crid && (
                <a
                  href={`${mantisUrl.replace(/\/$/, '')}/view.php?id=${parseInt(node.crid, 10)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-mantis-400 hover:text-mantis-300 hover:underline flex items-center gap-1"
                  title={node.summary || 'Mantis VOB 생성 티켓 보기'}
                >
                  #{node.crid}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>

            {/* CR and File count pill */}
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/80 text-xs text-slate-300">
              <span className="font-semibold text-emerald-400">{node.crCount.toLocaleString()}</span>
              <span className="text-slate-500">CRs</span>
              {node.fileCount > 0 && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="font-semibold text-cyan-400">{node.fileCount.toLocaleString()}</span>
                  <span className="text-slate-500">files</span>
                </>
              )}
            </div>

            {/* Direct jump to VobHistoryView */}
            <button
              onClick={() => onSelectVob(node.vob)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/50 transition-all shadow-sm"
              title="이 VOB의 전체 코드 변경 이력 조회"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>변경 이력</span>
            </button>
          </div>
        </div>

        {/* Render Children Recursively */}
        {hasChildren && isExpanded && (
          <div className="ml-6 pl-4 border-l-2 border-slate-700/60 flex flex-col space-y-1">
            {node.children.map((child, idx) =>
              renderTreeNode(child, depth + 1, idx === node.children.length - 1)
            )}
          </div>
        )}
      </div>
    );
  };

  // Filter roots by family
  const filteredFamilies = useMemo(() => {
    if (!treeData?.families) return [];
    if (selectedFamily === 'all') return treeData.families;
    return treeData.families.filter(f => f.id === selectedFamily);
  }, [treeData, selectedFamily]);

  return (
    <div className="flex flex-col space-y-6 relative pb-16">
      {/* 1. Header Title & Top Actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-slate-950 shadow-lg shadow-emerald-500/20">
            <Network className="w-5 h-5 font-bold" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-main flex items-center gap-2">
              ClearCase VOB 계통도
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium">
                Base ➔ Derived Lineage
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Mantis VOB 생성 기록 및 ClearCase 버전을 기반으로 원본 Base VOB와 파생 VOB의 상속 계보를 트리로 시각화합니다.
            </p>
          </div>
        </div>

        {/* Right Top Actions: Refresh, Expand/Collapse */}
        <div className="flex items-center gap-2">
          <button
            onClick={expandAll}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            모두 펼치기
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            모두 접기
          </button>
          <button
            onClick={() => loadTree(true)}
            disabled={isRefreshing}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            title="Mantis 서버에서 VOB 계보 최신 정보 재동기화"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>
      </div>

      {/* 2. ★ TRUE FLOATING / STICKY SEARCH & FILTER DOCK (페이지 스크롤 상관없이 언제나 상단에 고정) */}
      <div
        ref={searchContainerRef}
        className="sticky top-[68px] z-40 bg-slate-950/90 backdrop-blur-2xl p-3 rounded-2xl border border-emerald-500/40 shadow-2xl shadow-slate-950/90 space-y-2.5 transition-all"
      >
        {/* Search Input Bar */}
        <div className="relative flex items-center">
          <Search className="w-5 h-5 text-emerald-400 absolute left-4 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setIsSearchFocused(true);
            }}
            onFocus={() => setIsSearchFocused(true)}
            placeholder="VOB 이름, 베이스 VOB, 또는 고객사명 실시간 검색... (예: KTC4, 34A, POTS, REL, SKB)"
            className="w-full pl-12 pr-10 py-3 bg-slate-900/90 text-sm rounded-xl text-slate-100 placeholder-slate-500 border border-slate-800 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition-all font-mono"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
              className="absolute right-3.5 text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Family Category Filter Pills (스크롤 중에도 즉시 필터 변경 가능) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          <button
            onClick={() => setSelectedFamily('all')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              selectedFamily === 'all'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/25'
                : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            전체 VOB ({treeData?.totalVobs || 0})
          </button>
          {treeData?.families?.map(fam => (
            <button
              key={fam.id}
              onClick={() => setSelectedFamily(fam.id)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                selectedFamily === fam.id
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/25'
                  : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800 border border-slate-800'
              }`}
            >
              {fam.name} ({fam.roots.length} 계통)
            </button>
          ))}
        </div>

        {/* Autocomplete / Search Results Dropdown (100% 불투명 솔리드 배경으로 뒤 트리와의 겹침 차단) */}
        {isSearchFocused && searchResults.length > 0 && (
          <div 
            style={{ backgroundColor: '#020617' }}
            className="absolute left-0 right-0 top-full mt-2 bg-slate-950 border-2 border-emerald-500/60 rounded-xl shadow-2xl shadow-black max-h-96 overflow-y-auto z-50 divide-y divide-slate-800/80"
          >
            <div 
              style={{ backgroundColor: '#0f172a' }}
              className="p-2.5 px-3.5 text-[11px] font-semibold text-slate-300 flex items-center justify-between bg-slate-900 border-b border-slate-800 sticky top-0 z-10 shadow-sm"
            >
              <span>검색 결과 {searchResults.length}건 (선택 시 해당 위치로 자동 스크롤 및 강조)</span>
              <span className="text-emerald-400 font-medium">Esc 키를 누르면 닫힙니다</span>
            </div>
            {searchResults.map((item) => (
              <button
                key={item.vob}
                onClick={() => handleSelectSearchResult(item.vob)}
                style={{ backgroundColor: '#020617' }}
                className="w-full text-left p-3 hover:bg-slate-900 transition-all flex items-center justify-between group cursor-pointer border-l-4 border-l-transparent hover:border-l-emerald-400"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-slate-800/90 group-hover:bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-mono text-xs flex-shrink-0 border border-slate-700/60">
                    <FolderOpen className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-slate-100 group-hover:text-emerald-300">
                        {item.vob}
                      </span>
                      {item.baseVob && (
                        <span className="text-xs text-cyan-300 flex items-center gap-1 font-mono">
                          <ArrowRight className="w-3 h-3 text-slate-500" />
                          Base: {item.baseVob}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 truncate flex items-center gap-2 mt-0.5">
                      <span className="text-emerald-400 font-semibold">[{item.familyName}]</span>
                      {item.createdDate && <span>생성일: {item.createdDate}</span>}
                      {item.summary && <span className="text-slate-400">• {item.summary}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-400 flex-shrink-0">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-emerald-300 font-mono font-semibold border border-slate-700/60">
                    {item.crCount} CRs
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        )}

        {isSearchFocused && searchQuery.trim() && searchResults.length === 0 && (
          <div 
            style={{ backgroundColor: '#020617' }}
            className="absolute left-0 right-0 top-full mt-2 bg-slate-950 border border-slate-700 rounded-xl p-6 text-center text-slate-300 shadow-2xl shadow-black z-50"
          >
            <Search className="w-8 h-8 text-slate-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-200">'{searchQuery}'에 매칭되는 VOB가 없습니다.</p>
            <p className="text-xs text-slate-400 mt-1">철자를 확인하시거나 앞 글자(예: POTS, SSW, KTC)만 입력해 보세요.</p>
          </div>
        )}
      </div>

      {/* 4. Loading / Error / Tree Rendering */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <RefreshCw className="w-10 h-10 text-emerald-400 animate-spin" />
          <p className="text-sm font-semibold text-slate-300">
            사내 Mantis 및 코드베이스 VOB 계통도를 인덱싱하는 중...
          </p>
        </div>
      ) : error ? (
        <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-center space-y-3">
          <p className="text-sm text-rose-300 font-semibold">{error}</p>
          <button
            onClick={() => loadTree(true)}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
          >
            다시 시도
          </button>
        </div>
      ) : (
        <div className="flex flex-col space-y-8">
          {filteredFamilies.map((fam) => (
            <div
              key={fam.id}
              className="rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4 sm:p-6 shadow-xl space-y-4"
            >
              {/* Family Header */}
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20" />
                  <h3 className="text-base font-bold text-slate-100">{fam.name}</h3>
                  <span className="text-xs text-slate-400">({fam.roots.length}개 최상위 Base 계통)</span>
                </div>
              </div>

              {/* Family Root Trees */}
              <div className="flex flex-col space-y-3">
                {fam.roots.map((root, idx) =>
                  renderTreeNode(root, 0, idx === fam.roots.length - 1)
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
