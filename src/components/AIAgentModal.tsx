import React, { useState } from 'react';
import { 
  X, 
  Bot, 
  Send, 
  Sparkles, 
  Copy, 
  Check, 
  ExternalLink,
  ArrowRight,
  Loader2,
  FileCode,
  Layers,
  Tag,
  Bookmark,
  Calendar,
  User,
  Clock,
  Code2,
  CheckCircle2,
  AlertCircle,
  HelpCircle
} from 'lucide-react';
import { CRItem, AppSettings, SSHConfig } from '../types/cr';
import { queryAI, fetchCRDetail } from '../services/api';
import { SimilarCRs } from './SimilarCRs';
import { FileTreeView } from './FileTreeView';
import { CRCodeChangesView } from './CRCodeChangesView';
import { DiffViewerModal } from './DiffViewerModal';

interface AIAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  allCrs: CRItem[];
  filteredCrs: CRItem[];
  selectedCR: CRItem | null;
  onSelectCR: (cr: CRItem) => void;
  aiSettings: AppSettings['ai'];
  sshConfig?: SSHConfig;
  onOpenSettings: () => void;
  mantisUrl: string;
  bookmarks: Set<string>;
  onToggleBookmark: (crid: string) => void;
}

const PRESET_PROMPTS = [
  {
    title: 'PLSM 및 IPCRDM 기동 이슈',
    query: 'SSW 기동시 plsm 에서 IPCDRM 기동을 기다리느라 정상기동을 못하는 문제관련된 CR 찾아줘'
  },
  {
    title: 'KT 고객사 최근 이슈 요약',
    query: 'KT 고객사와 관련된 최근 버그 및 CR들의 주요 원인과 수정 내역을 요약해줘.'
  },
  {
    title: '타임아웃(Timeout) 발생 CR 분석',
    query: '타임아웃(Timeout)이나 지연으로 인해 발생한 CR들을 찾아보고 원인을 분석해줘.'
  },
  {
    title: '미해결(opened) 긴급 이슈',
    query: '현재 미해결(opened) 상태인 CR들 중 주요 문제점과 수정이 필요한 모듈을 정리해줘.'
  }
];

export const AIAgentModal: React.FC<AIAgentModalProps> = ({
  isOpen,
  onClose,
  allCrs,
  filteredCrs,
  selectedCR: initialSelectedCR,
  onSelectCR,
  aiSettings,
  sshConfig,
  onOpenSettings,
  mantisUrl,
  bookmarks,
  onToggleBookmark
}) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Array<{
    role: 'user' | 'assistant';
    text: string;
    matchedCrs?: any[];
    provider?: string;
  }>>([]);
  const [previewCR, setPreviewCR] = useState<CRItem | null>(initialSelectedCR);
  const [activeRightTab, setActiveRightTab] = useState<'details' | 'overview' | 'checkin' | 'raw'>('details');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [diffTargetFile, setDiffTargetFile] = useState<string | null>(null);

  // Auto fetch details for previewCR if not yet fetched
  React.useEffect(() => {
    if (previewCR && !previewCR.detailsFetched) {
      fetchCRDetail(previewCR.crid)
        .then(res => {
          if (res && res.cr) {
            setPreviewCR(res.cr);
          }
        })
        .catch(err => console.warn('AIAgent preview details error:', err));
    }
  }, [previewCR?.crid]);

  if (!isOpen) return null;

  const handleSend = async (customQuery?: string) => {
    const q = (customQuery || query).trim();
    if (!q || loading) return;

    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setQuery('');
    setLoading(true);

    try {
      const res = await queryAI(q, [], aiSettings);

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: res.answer,
          matchedCrs: res.matchedCrs,
          provider: res.provider || aiSettings.provider
        }
      ]);

      // Automatically preview the top #1 matched CR on the right panel
      if (res.matchedCrs && res.matchedCrs.length > 0) {
        const topId = res.matchedCrs[0].crid;
        const fullCR = allCrs.find(c => c.crid === topId) || res.matchedCrs[0];
        setPreviewCR(fullCR);
      }
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: `요청을 처리하는 중 오류가 발생했습니다: ${err.message}`
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPreview = (cr: any) => {
    const fullCR = allCrs.find(c => c.crid === cr.crid) || cr;
    setPreviewCR(fullCR);
  };

  const handleCopy = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const getStatusBadgeClass = (status: string) => {
    const s = (status || '').toLowerCase();
    if (s.includes('open')) return 'badge-status-opened';
    if (s.includes('resolv')) return 'badge-status-resolved';
    if (s.includes('submit')) return 'badge-status-submitted';
    if (s.includes('validat')) return 'badge-status-validated';
    if (s.includes('live')) return 'badge-status-live';
    if (s.includes('assign')) return 'badge-status-assigned';
    return 'badge-status-postponed';
  };

  const isPreviewBookmarked = previewCR ? bookmarks.has(previewCR.crid) : false;
  const mantisLink = previewCR ? `${mantisUrl.replace(/\/$/, '')}/view.php?id=${previewCR.id}` : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 lg:p-6 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150">
      <div 
        className="w-full max-w-[1600px] h-[92vh] glass-panel rounded-3xl border border-slate-700/80 shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Top Header */}
        <div className="p-4 px-6 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Mantis CR AI 지능형 분석 & 실시간 뷰어</h2>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase font-semibold">
                  {aiSettings.provider === 'local' ? '고도화 로컬 NLP' : aiSettings.provider}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                질문 시 연관된 CR 카드를 생성하며, <strong className="text-mantis-300">카드를 클릭하면 오른쪽 화면에 소스 파일 변경 내역과 원문이 즉시 표시</strong>됩니다.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onOpenSettings}
              className="text-xs text-indigo-300 hover:text-indigo-200 px-3 py-1.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 transition-colors"
            >
              ⚙️ AI 설정
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2-Column Split Content Area */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          
          {/* LEFT COLUMN: Chat & Interactive CR Cards List (7 Cols) */}
          <div className="lg:col-span-7 flex flex-col border-r border-slate-800 h-full overflow-hidden bg-slate-950/50">
            
            {/* Chat Messages Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col justify-center max-w-xl mx-auto text-center space-y-5 py-6">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
                    <Sparkles className="w-6 h-6" />
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-base font-bold text-white">어떤 CR을 찾고 계신가요?</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      증상, 모듈명(예: PLSM, IPCRDM), 수정 파일, 키워드를 자연어로 입력하세요.
                    </p>
                  </div>

                  {/* Preset Buttons */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left pt-2">
                    {PRESET_PROMPTS.map((p, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSend(p.query)}
                        className="p-3 rounded-2xl bg-slate-900/80 hover:bg-slate-850 border border-slate-800 hover:border-indigo-500/40 text-left transition-all space-y-1 group"
                      >
                        <div className="flex items-center justify-between text-xs font-bold text-indigo-300 group-hover:text-indigo-200">
                          <span>{p.title}</span>
                          <ArrowRight className="w-3 h-3 text-slate-600 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
                        </div>
                        <p className="text-[11px] text-slate-400 line-clamp-2 leading-snug">
                          {p.query}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div key={idx} className="space-y-3">
                    
                    {/* User Question Bubble */}
                    {msg.role === 'user' && (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] bg-mantis-500 text-slate-950 font-bold text-xs sm:text-sm p-3.5 px-4 rounded-2xl shadow-lg leading-relaxed">
                          {msg.text}
                        </div>
                      </div>
                    )}

                    {/* AI Assistant Answer Card */}
                    {msg.role === 'assistant' && (
                      <div className="space-y-3">
                        <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
                          
                          {/* Briefing Text Header */}
                          <div className="flex items-center justify-between text-xs text-indigo-300 font-bold border-b border-slate-800 pb-2">
                            <span className="flex items-center gap-1.5">
                              <Sparkles className="w-4 h-4 text-indigo-400" />
                              분석 결과 요약
                            </span>
                            <button
                              onClick={() => handleCopy(msg.text, `msg_${idx}`)}
                              className="text-slate-400 hover:text-slate-200 flex items-center gap-1 text-[11px]"
                            >
                              {copiedField === `msg_${idx}` ? <Check className="w-3 h-3 text-mantis-400" /> : <Copy className="w-3 h-3" />}
                              복사
                            </button>
                          </div>

                          <div className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
                            {msg.text}
                          </div>

                        </div>

                        {/* Interactive Matched CR Cards */}
                        {msg.matchedCrs && msg.matchedCrs.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <div className="flex items-center justify-between text-xs font-bold text-slate-300 px-1">
                              <span>📌 추천 연관 CR 목록 (클릭하여 오른쪽에서 상세 보기)</span>
                              <span className="text-mantis-400 font-mono text-[11px]">총 {msg.matchedCrs.length}건</span>
                            </div>

                            <div className="space-y-2.5">
                              {msg.matchedCrs.map((item: any, cIdx: number) => {
                                const isSelected = previewCR?.crid === item.crid;
                                return (
                                  <div
                                    key={item.crid || cIdx}
                                    onClick={() => handleSelectPreview(item)}
                                    className={`p-3.5 rounded-2xl border cursor-pointer transition-all space-y-2 group ${
                                      isSelected
                                        ? 'bg-slate-850 border-mantis-500/80 shadow-lg shadow-mantis-500/10 ring-1 ring-mantis-500/50'
                                        : 'bg-slate-900/80 hover:bg-slate-850 border-slate-800 hover:border-indigo-500/50'
                                    }`}
                                  >
                                    {/* Card Header: CRID, Status, Project, Customer, Reason */}
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        <span className={`font-mono text-sm font-extrabold px-2 py-0.5 rounded-lg ${
                                          isSelected ? 'bg-mantis-500 text-slate-950' : 'bg-slate-800 text-mantis-400 group-hover:text-mantis-300'
                                        }`}>
                                          #{item.crid}
                                        </span>

                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${getStatusBadgeClass(item.status)}`}>
                                          {item.status}
                                        </span>

                                        {item.customer && (
                                          <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px] font-bold">
                                            {item.customer}
                                          </span>
                                        )}

                                        {item.module && (
                                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-medium">
                                            🏷️ {item.module}
                                          </span>
                                        )}
                                      </div>

                                      <span className="text-[10px] font-semibold text-slate-500 group-hover:text-indigo-300 flex items-center gap-1 transition-colors">
                                        상세보기 <ArrowRight className="w-3 h-3" />
                                      </span>
                                    </div>

                                    {/* Title */}
                                    <h4 className="text-xs sm:text-sm font-bold text-slate-100 group-hover:text-white leading-snug">
                                      {item.cleanSummary || item.summary}
                                    </h4>

                                    {/* Match Reasons Badges */}
                                    {item.matchReasons && item.matchReasons.length > 0 && (
                                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                        {item.matchReasons.map((r: string, rIdx: number) => (
                                          <span
                                            key={rIdx}
                                            className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-semibold flex items-center gap-1"
                                          >
                                            🎯 {r}
                                          </span>
                                        ))}
                                      </div>
                                    )}

                                    {/* Modified Files Chips */}
                                    {item.files && item.files.length > 0 && (
                                      <div className="flex flex-wrap items-center gap-1 text-[10px] text-indigo-300 pt-1">
                                        <FileCode className="w-3 h-3 text-indigo-400" />
                                        <span>수정 소스:</span>
                                        {item.files.slice(0, 4).map((f: string, fIdx: number) => (
                                          <code key={fIdx} className="bg-slate-950 text-slate-200 px-1.5 py-0.2 rounded font-mono border border-slate-800">
                                            {f}
                                          </code>
                                        ))}
                                        {item.files.length > 4 && (
                                          <span className="text-slate-500 font-mono">+{item.files.length - 4}개</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                ))
              )}

              {loading && (
                <div className="glass-panel p-4 rounded-2xl border border-slate-800 flex items-center gap-3 text-slate-300 text-xs">
                  <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                  <span>Mantis 데이터베이스와 체크인 로그를 교차 분석하는 중...</span>
                </div>
              )}
            </div>

            {/* Input Form Bar */}
            <div className="p-3 sm:p-4 border-t border-slate-800 bg-slate-900/90">
              <form
                onSubmit={e => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="예: SSW 기동시 plsm 에서 IPCDRM 대기 이슈, 타임아웃 해결 내역..."
                  className="flex-1 px-4 py-3 bg-slate-950 text-slate-100 text-xs sm:text-sm rounded-xl border border-slate-700/80 focus:border-indigo-500 outline-none"
                />
                <button
                  type="submit"
                  disabled={!query.trim() || loading}
                  className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:hover:bg-indigo-600 text-white font-bold text-xs transition-all flex items-center gap-1.5 flex-shrink-0 shadow-lg shadow-indigo-600/20"
                >
                  <Send className="w-4 h-4" />
                  <span>검색/질의</span>
                </button>
              </form>
            </div>

          </div>

          {/* RIGHT COLUMN: Live CR Detail & Check-in Source Explorer (5 Cols) */}
          <div className="lg:col-span-5 flex flex-col h-full overflow-hidden bg-slate-900/40">
            {previewCR ? (
              <div className="flex flex-col h-full overflow-hidden">
                
                {/* Right Panel Header */}
                <div className="p-4 border-b border-slate-800 bg-slate-900/90 flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-extrabold text-mantis-400">
                        #{previewCR.crid}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${getStatusBadgeClass(previewCR.status)}`}>
                        {previewCR.status}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-semibold">
                        {previewCR.project}
                      </span>
                      {previewCR.customer && (
                        <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px] font-bold">
                          {previewCR.customer}
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-bold text-white leading-snug break-words">
                      {previewCR.cleanSummary || previewCR.summary}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => onToggleBookmark(previewCR.crid)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-amber-400 transition-colors"
                      title={isPreviewBookmarked ? '북마크 해제' : '북마크 추가'}
                    >
                      <Bookmark className={`w-3.5 h-3.5 ${isPreviewBookmarked ? 'fill-amber-400 text-amber-400' : ''}`} />
                    </button>

                    <button
                      onClick={() => handleCopy(previewCR.crid, 'preview_crid')}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                      title="CRID 복사"
                    >
                      {copiedField === 'preview_crid' ? <Check className="w-3.5 h-3.5 text-mantis-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>

                    <a
                      href={mantisLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-mantis-400 transition-colors"
                      title="Mantis 웹 원본 보기"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                {/* Right Panel Tabs */}
                <div className="px-4 border-b border-slate-800 bg-slate-900/60 flex items-center gap-4 text-xs font-semibold overflow-x-auto">
                  <button
                    onClick={() => setActiveRightTab('details')}
                    className={`py-2.5 border-b-2 transition-all flex items-center gap-1.5 flex-shrink-0 ${
                      activeRightTab === 'details'
                        ? 'border-mantis-400 text-mantis-300'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-mantis-400" />
                    원인분석 & 소스 변경점
                    {previewCR.details?.codeChanges && previewCR.details.codeChanges !== '.' && (
                      <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                        코드포함
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => setActiveRightTab('overview')}
                    className={`py-2.5 border-b-2 transition-all flex items-center gap-1.5 flex-shrink-0 ${
                      activeRightTab === 'overview'
                        ? 'border-mantis-400 text-mantis-300'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    개요 & 메타데이터
                  </button>

                  <button
                    onClick={() => setActiveRightTab('checkin')}
                    className={`py-2.5 border-b-2 transition-all flex items-center gap-1.5 flex-shrink-0 ${
                      activeRightTab === 'checkin'
                        ? 'border-mantis-400 text-mantis-300'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    수정 소스 파일
                    {previewCR.files && previewCR.files.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-mantis-500/20 text-mantis-400 text-[10px]">
                        {previewCR.files.length}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => setActiveRightTab('raw')}
                    className={`py-2.5 border-b-2 transition-all flex items-center gap-1.5 flex-shrink-0 ${
                      activeRightTab === 'raw'
                        ? 'border-mantis-400 text-mantis-300'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    Check-in Log
                  </button>
                </div>

                {/* Right Panel Tab Body */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                  {activeRightTab === 'details' && (
                    <CRCodeChangesView 
                      cr={previewCR} 
                      mantisUrl={mantisUrl} 
                      onOpenDiff={path => setDiffTargetFile(path)}
                    />
                  )}

                  {activeRightTab === 'overview' && (
                    <div className="space-y-4">
                      
                      {/* Full Raw Title */}
                      <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                        <span className="text-[10px] text-slate-500 font-semibold">전체 원본 제목</span>
                        <p className="font-mono text-slate-200 select-all break-all leading-snug">
                          {previewCR.summary}
                        </p>
                      </div>

                      {/* Key Metadata Fields */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-0.5">
                          <span className="text-slate-500 text-[10px] flex items-center gap-1">
                            <User className="w-3 h-3" /> 보고자
                          </span>
                          <p className="font-semibold text-slate-200">{previewCR.reporter || '-'}</p>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-0.5">
                          <span className="text-slate-500 text-[10px] flex items-center gap-1">
                            <User className="w-3 h-3" /> 담당자
                          </span>
                          <p className="font-semibold text-slate-200">{previewCR.assignee || '-'}</p>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-0.5">
                          <span className="text-slate-500 text-[10px] flex items-center gap-1">
                            <Tag className="w-3 h-3" /> 대상 모듈
                          </span>
                          <p className="font-semibold text-slate-200">{previewCR.module || '-'}</p>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-0.5">
                          <span className="text-slate-500 text-[10px] flex items-center gap-1">
                            <Layers className="w-3 h-3" /> 적용 VOB
                          </span>
                          <p className="font-semibold text-teal-300 font-mono">{previewCR.vob || '-'}</p>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-0.5">
                          <span className="text-slate-500 text-[10px] flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> 보고 날짜
                          </span>
                          <p className="font-semibold text-slate-200 font-mono">{previewCR.dateSubmitted || '-'}</p>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-0.5">
                          <span className="text-slate-500 text-[10px] flex items-center gap-1">
                            <Clock className="w-3 h-3" /> 최종 갱신
                          </span>
                          <p className="font-semibold text-slate-200 font-mono">{previewCR.lastUpdated || '-'}</p>
                        </div>
                      </div>

                      {/* Similar CRs */}
                      <SimilarCRs
                        currentCR={previewCR}
                        allCrs={allCrs}
                        onSelectCR={cr => setPreviewCR(cr)}
                      />
                    </div>
                  )}

                  {activeRightTab === 'checkin' && (
                    <FileTreeView 
                      filePaths={previewCR.filePaths || []} 
                      onOpenDiff={path => setDiffTargetFile(path)}
                    />
                  )}

                  {activeRightTab === 'raw' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>Raw Check-in Log</span>
                        {previewCR.checkinLog && (
                          <button
                            onClick={() => handleCopy(previewCR.checkinLog, 'raw_log')}
                            className="text-mantis-400 hover:text-mantis-300 flex items-center gap-1 text-[11px]"
                          >
                            {copiedField === 'raw_log' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            복사
                          </button>
                        )}
                      </div>

                      {previewCR.checkinLog ? (
                        <pre className="p-3 rounded-xl bg-slate-950 text-emerald-400 font-mono text-[10px] leading-relaxed overflow-x-auto border border-slate-800 whitespace-pre-wrap select-all">
                          {previewCR.checkinLog}
                        </pre>
                      ) : (
                        <div className="p-8 text-center text-slate-500 text-xs">
                          Check-in 로그가 비어 있습니다.
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-500 space-y-2">
                <FileCode className="w-10 h-10 text-slate-600" />
                <p className="text-sm font-semibold text-slate-400">선택된 CR이 없습니다</p>
                <p className="text-xs max-w-xs">
                  왼쪽 목록에서 검색된 CR 카드를 클릭하시면 이곳에 전체 원문, 메타데이터 및 소스 파일 수정 내역이 표시됩니다.
                </p>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Built-in Diff Viewer Modal */}
      <DiffViewerModal
        isOpen={Boolean(diffTargetFile)}
        onClose={() => setDiffTargetFile(null)}
        filePath={diffTargetFile || ''}
        checkinLog={previewCR?.checkinLog}
        sshConfig={sshConfig}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
};
