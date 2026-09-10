import React, { useState, useEffect } from 'react';
import { 
  X, 
  Sparkles, 
  GitCompare, 
  Bot, 
  Copy, 
  Check, 
  Loader2, 
  FileCode, 
  Layers, 
  Tag, 
  Calendar, 
  User, 
  AlertTriangle,
  ArrowRight,
  Code2,
  ExternalLink,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { CRItem, AppSettings, SSHConfig } from '../types/cr';
import { compareCRsAPI, fetchCRDiffCache, loadSettings } from '../services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DiffViewerModal } from './DiffViewerModal';

interface CRComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  crs: CRItem[];
  aiSettings?: AppSettings['ai'];
  sshConfig?: SSHConfig;
  sshServers?: SSHConfig[];
  mantisUrl: string;
}

export const CRComparisonModal: React.FC<CRComparisonModalProps> = ({
  isOpen,
  onClose,
  crs,
  aiSettings,
  sshConfig,
  sshServers,
  mantisUrl
}) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<string>('');
  const [diffMap, setDiffMap] = useState<Record<string, any>>({});
  const [copiedText, setCopiedText] = useState(false);
  const [diffTargetFile, setDiffTargetFile] = useState<string | null>(null);
  const [activeDiffCR, setActiveDiffCR] = useState<CRItem | null>(null);

  // Calculate overlapping and unique files
  const fileToCRs: Record<string, string[]> = {};
  crs.forEach(cr => {
    (cr.files || []).forEach(f => {
      if (!fileToCRs[f]) fileToCRs[f] = [];
      if (!fileToCRs[f].includes(cr.crid)) {
        fileToCRs[f].push(cr.crid);
      }
    });
  });

  const allUniqueFiles = Object.keys(fileToCRs);
  const commonFiles = allUniqueFiles.filter(f => fileToCRs[f].length > 1);

  // Check cached diffs for selected CRs on open
  useEffect(() => {
    if (isOpen && crs.length >= 2) {
      crs.forEach(cr => {
        fetchCRDiffCache(cr.crid)
          .then(res => {
            if (res && res.ok && res.data) {
              setDiffMap(prev => ({ ...prev, [cr.crid]: res.data }));
            }
          })
          .catch(() => {});
      });
    } else {
      setAnalysisResult(null);
    }
  }, [isOpen, crs]);

  if (!isOpen || crs.length < 2) return null;

  const handleRunComparison = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const activeAiConfig = aiSettings || loadSettings().ai;
      const res = await compareCRsAPI(crs, activeAiConfig, sshConfig);
      if (res && res.ok) {
        setAnalysisResult(res.analysis);
        setAiProvider(res.provider);
        if (res.diffMap) {
          setDiffMap(prev => ({ ...prev, ...res.diffMap }));
        }
      } else {
        setAnalysisResult(`비교 분석 중 오류가 발생했습니다: ${(res as any)?.error || '알 수 없는 오류'}`);
      }
    } catch (err: any) {
      setAnalysisResult(`비교 분석 요청 실패: ${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCopy = () => {
    if (!analysisResult) return;
    navigator.clipboard.writeText(analysisResult);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 lg:p-6 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150">
      <div 
        className="w-full max-w-[1400px] h-[92vh] glass-panel rounded-3xl border border-slate-700/80 shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 px-6 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <GitCompare className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-main">CR 코드 변경점 교차 비교 분석</h2>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase font-semibold">
                  {crs.length}개 CR 비교
                </span>
              </div>
              <p className="text-xs text-slate-400">
                선택한 CR들의 공통 수정 파일과 실제 소스코드 변경 내역(Diff)을 교차 비교하여 상호 연관성 및 코드 흐름을 분석합니다.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {analysisResult && (
              <button
                onClick={() => { setAnalysisResult(null); setAiProvider(''); }}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700/80 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                title="비교 분석 결과를 지우고 초기화합니다"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                <span>화면 비우기</span>
              </button>
            )}

            <button
              onClick={handleRunComparison}
              disabled={analyzing}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50 cursor-pointer"
            >
              {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {analysisResult ? 'AI 교차 비교 재분석' : 'AI 교차 비교 분석 시작'}
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body Scrollable Area */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* Section 1: Selected CRs Overview Cards */}
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              비교 대상 CR 메타데이터
            </h3>

            <div className={`grid grid-cols-1 ${crs.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'} gap-4`}>
              {crs.map((cr, idx) => {
                const mantisLink = `${mantisUrl.replace(/\/$/, '')}/view.php?id=${cr.id}`;
                const hasCache = !!diffMap[cr.crid]?.files?.length;
                return (
                  <div key={cr.crid} className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 transition-all space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] font-bold">
                          {idx + 1}
                        </span>
                        <span className="font-mono text-base font-extrabold text-mantis-400">
                          #{cr.crid}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-semibold">
                          {cr.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {hasCache && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold" title="로컬 Diff 캐시 준비됨">
                            Diff 캐시 ⚡
                          </span>
                        )}
                        <a 
                          href={mantisLink} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-mantis-400 transition-colors"
                          title="Mantis 원본 열기"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>

                    <h4 className="text-xs font-bold text-main line-clamp-2" title={cr.cleanSummary || cr.summary}>
                      {cr.cleanSummary || cr.summary}
                    </h4>

                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-slate-800/80 text-slate-400">
                      <div><span className="text-slate-400">모듈:</span> <strong className="text-slate-200">{cr.module || '-'}</strong></div>
                      <div><span className="text-slate-400">고객사:</span> <strong className="text-slate-200">{cr.customer || '-'}</strong></div>
                      <div><span className="text-slate-400">담당자:</span> <strong className="text-slate-200">{cr.assignee || '-'}</strong></div>
                      <div><span className="text-slate-400">수정파일:</span> <strong className="text-indigo-300 font-mono">{cr.files?.length || 0}개</strong></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: Overlapping Files Matrix */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-300 flex items-center gap-2">
                <FileCode className="w-4 h-4 text-purple-400" />
                수정 파일 교차 현황 (공통 수정 파일: <span className="text-purple-400 font-bold">{commonFiles.length}개</span> / 전체 고유 파일: {allUniqueFiles.length}개)
              </h3>
            </div>

            {commonFiles.length > 0 ? (
              <div className="space-y-2">
                <div className="p-2.5 rounded-xl bg-purple-950/30 border border-purple-500/30 flex items-center gap-2 text-xs text-purple-200">
                  <AlertTriangle className="w-4 h-4 text-purple-400 flex-shrink-0" />
                  <span>
                    아래 파일들은 <strong>선택된 CR들에서 동시에 수정된 핵심 파일</strong>입니다. 코드 충돌이나 후속 패치 영향도를 중점적으로 검토해야 합니다.
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                  {commonFiles.map(file => (
                    <div key={file} className="p-2.5 rounded-xl bg-slate-800/60 border border-purple-500/40 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-mono font-bold text-purple-300 truncate" title={file}>
                          {file}
                        </p>
                        <div className="flex items-center gap-1 mt-1">
                          {fileToCRs[file].map(crid => (
                            <span key={crid} className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              #{crid}
                            </span>
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          const ownerCR = crs.find(c => c.files?.includes(file)) || crs[0];
                          setActiveDiffCR(ownerCR);
                          setDiffTargetFile(file);
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-[11px] font-semibold text-slate-200 flex-shrink-0 transition-colors"
                        title="Diff 확인"
                      >
                        Diff 보기
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800/80 text-xs text-slate-400">
                선택한 CR 간에 완전히 겹치는 동일 수정 파일은 발견되지 않았습니다. (각각 서로 다른 파일/모듈 독립 수정)
              </div>
            )}
          </div>

          {/* Section 3: AI Cross-Comparison Report */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-300 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                AI 엔진 교차 비교 분석 리포트 {aiProvider ? `(${aiProvider})` : ''}
              </h3>

              {analysisResult && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setAnalysisResult(null); setAiProvider(''); }}
                    className="flex items-center gap-1 text-slate-400 hover:text-rose-400 text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-500/15 border border-slate-700/60 hover:border-rose-500/30 transition-all cursor-pointer"
                    title="비교 분석 결과를 지우고 초기화합니다"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    결과 비우기
                  </button>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 text-slate-400 hover:text-slate-200 text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    {copiedText ? <Check className="w-3.5 h-3.5 text-mantis-400" /> : <Copy className="w-3.5 h-3.5" />}
                    리포트 복사
                  </button>
                </div>
              )}
            </div>

            {analyzing && (
              <div className="p-12 glass-panel rounded-2xl border border-indigo-500/30 flex flex-col items-center justify-center gap-3 text-center">
                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-main">각 CR의 실제 소스코드 Diff를 교차 대조하여 AI 분석 중입니다...</p>
                  <p className="text-xs text-slate-400">동일 파일의 함수 수정 흐름, 상충 여부, 인과관계를 종합 판단하고 있습니다.</p>
                </div>
              </div>
            )}

            {!analyzing && analysisResult && (
              <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
                <div className="prose prose-invert prose-sm max-w-none text-slate-200 text-xs leading-relaxed space-y-4">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {analysisResult}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {!analyzing && !analysisResult && (
              <div className="p-12 border border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center gap-3 text-center">
                <GitCompare className="w-10 h-10 text-slate-600" />
                <div className="space-y-1 max-w-md">
                  <h4 className="text-sm font-bold text-slate-300">AI 교차 비교 분석이 아직 실행되지 않았습니다</h4>
                  <p className="text-xs text-slate-400">
                    상단의 <strong>[AI 교차 비교 분석 시작]</strong> 버튼을 누르면 두 CR의 코드 변경 내역을 대조하여 상호 인과관계와 충돌 위험도를 AI가 종합 리포트로 작성해 드립니다.
                  </p>
                </div>
                <button
                  onClick={handleRunComparison}
                  className="mt-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-indigo-500/20"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  AI 교차 비교 분석 실행
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Diff Viewer Modal for Common Files */}
      {diffTargetFile && activeDiffCR && (
        <DiffViewerModal
          isOpen={!!diffTargetFile}
          onClose={() => {
            setDiffTargetFile(null);
            setActiveDiffCR(null);
          }}
          filePath={diffTargetFile}
          checkinLog={activeDiffCR.checkinLog}
          sshConfig={sshConfig || { host: '', port: 22, username: '', password: '', enabled: false }}
          sshServers={sshServers}
        />
      )}
    </div>
  );
};
