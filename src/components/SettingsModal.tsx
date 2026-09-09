import React, { useState, useRef, useEffect } from 'react';
import { 
  X, 
  Settings, 
  Database, 
  Download, 
  Upload, 
  Bot, 
  Check, 
  AlertCircle, 
  Save, 
  ExternalLink,
  HardDrive,
  FileJson,
  Terminal,
  Zap,
  RefreshCw,
  Play,
  Pause,
  Layers,
  Cpu,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { AppSettings, SyncMeta } from '../types/cr';
import { testSSH, saveSettingsToDisk, fetchDiffWorkerStatus, controlDiffWorker, DiffWorkerStatus } from '../services/api';
import axios from 'axios';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  meta: SyncMeta;
  onRefreshData: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  meta,
  onRefreshData
}) => {
  const [form, setForm] = useState<AppSettings>({ ...settings });
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [sshTestStatus, setSshTestStatus] = useState<string | null>(null);
  const [sshTesting, setSshTesting] = useState(false);
  const [sshTestResult, setSshTestResult] = useState<{ok: boolean; message: string} | null>(null);

  // Background Diff Worker Status & Control
  const [workerStatus, setWorkerStatus] = useState<DiffWorkerStatus | null>(null);
  const [workerLoading, setWorkerLoading] = useState(false);

  const loadWorkerStatus = async () => {
    try {
      const res = await fetchDiffWorkerStatus();
      if (res.ok && res.status) {
        setWorkerStatus(res.status);
      }
    } catch {
      // Ignore background fetch errors
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadWorkerStatus();
      const timer = setInterval(loadWorkerStatus, 2500);
      return () => clearInterval(timer);
    }
  }, [isOpen]);

  const handleToggleWorker = async () => {
    if (!workerStatus) return;
    setWorkerLoading(true);
    try {
      const res = await controlDiffWorker(!workerStatus.enabled);
      if (res.ok && res.status) {
        setWorkerStatus(res.status);
      }
    } catch (err: any) {
      console.error('Failed to toggle worker:', err);
    } finally {
      setWorkerLoading(false);
    }
  };

  const handleConcurrencyChange = async (newConcurrency: number) => {
    setForm(prev => ({ ...prev, diffConcurrency: newConcurrency }));
    try {
      const res = await controlDiffWorker(undefined, newConcurrency);
      if (res.ok && res.status) {
        setWorkerStatus(res.status);
      }
    } catch (err: any) {
      console.error('Failed to change concurrency:', err);
    }
  };

  const DEFAULT_PROVIDER_MODELS: Record<string, string> = {
    custom: 'aico-rag-qwen2.5-coder-7b',
    openai: 'gpt-5.6-sol',
    gemini: 'gemini-3.8-flash-high',
    claude: 'claude-3-5-sonnet-latest'
  };

  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const handleProviderChange = (newProvider: 'local' | 'custom' | 'openai' | 'gemini' | 'claude') => {
    setForm(prev => {
      const currentProvider = prev.ai.provider;
      const currentModel = prev.ai.model;

      const updatedProviderModels = {
        ...DEFAULT_PROVIDER_MODELS,
        ...(prev.ai.providerModels || {})
      };
      if (currentProvider !== 'local' && currentModel) {
        updatedProviderModels[currentProvider] = currentModel;
      }

      const nextModel = updatedProviderModels[newProvider] || DEFAULT_PROVIDER_MODELS[newProvider] || '';

      return {
        ...prev,
        ai: {
          ...prev.ai,
          provider: newProvider,
          model: nextModel,
          providerModels: updatedProviderModels
        }
      };
    });
  };

  const handleModelChange = (newModel: string) => {
    setForm(prev => ({
      ...prev,
      ai: {
        ...prev.ai,
        model: newModel,
        providerModels: {
          ...DEFAULT_PROVIDER_MODELS,
          ...(prev.ai.providerModels || {}),
          [prev.ai.provider]: newModel
        }
      }
    }));
  };

  useEffect(() => {
    if (form.ai.provider === 'openai' || form.ai.provider === 'gemini' || form.ai.provider === 'claude') {
      setIsLoadingModels(true);
      const targetProvider = form.ai.provider;

      axios.get(`/api/ai/models?provider=${targetProvider}`)
        .then(res => {
          if (res.data && res.data.models && Array.isArray(res.data.models)) {
            const list = res.data.models;
            setAvailableModels(list);

            const modelIds = list.map((m: any) => typeof m === 'string' ? m : m.id);

            setForm(prev => {
              if (prev.ai.provider !== targetProvider) return prev;

              const savedModel = prev.ai.providerModels?.[targetProvider] || prev.ai.model;
              const chosenModel = modelIds.includes(savedModel) ? savedModel : (modelIds[0] || savedModel);

              return {
                ...prev,
                ai: {
                  ...prev.ai,
                  model: chosenModel,
                  providerModels: {
                    ...DEFAULT_PROVIDER_MODELS,
                    ...(prev.ai.providerModels || {}),
                    [targetProvider]: chosenModel
                  }
                }
              };
            });
          }
        })
        .catch(err => console.error('Failed to fetch models:', err))
        .finally(() => setIsLoadingModels(false));
    }
  }, [form.ai.provider]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(form);
    await saveSettingsToDisk(form);
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      onClose();
    }, 1200);
  };

  const handleExportDB = () => {
    window.location.href = '/api/database/export';
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setImportStatus('파일 읽는 중...');
      const text = await file.text();
      const crs = JSON.parse(text);

      setImportStatus('데이터베이스에 병합하는 중...');
      const resp = await axios.post('/api/database/import', { crs });
      
      if (resp.data.ok) {
        setImportStatus(`성공! 총 ${resp.data.totalCount}건 동기화 완료`);
        onRefreshData();
        setTimeout(() => setImportStatus(null), 3000);
      }
    } catch (err: any) {
      setImportStatus(`오류 발생: ${err.message}`);
      setTimeout(() => setImportStatus(null), 4000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150">
      <div 
        className="w-full max-w-2xl max-h-[90vh] glass-panel rounded-3xl border border-slate-700/80 shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-main">환경 설정 & 데이터베이스 이식 관리</h2>
              <p className="text-xs text-slate-400">Mantis 연동, AI 모델, 독립 DB 파일 내보내기/가져오기</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6 text-xs">
          
          {/* 1. Independent Database Management (Core Requirement) */}
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-mantis-400" />
                독립 단일 DB 파일 관리 (Portability & Update)
              </h3>
              <span className="text-[11px] font-mono text-mantis-300">
                {meta.totalCount.toLocaleString()}건 저장됨
              </span>
            </div>

            <p className="text-slate-400 text-[11px] leading-relaxed">
              모든 CR 데이터는 프로젝트 디렉토리 내 <code className="text-emerald-300 bg-slate-950 px-1.5 py-0.5 rounded font-mono">data/cr_database.json</code> 독립 단일 파일로 저장됩니다.
              이 파일 하나만 다른 PC나 맥북/윈도우로 복사해도 즉시 동작하며, 새로운 CR이 추가되어도 증분 업데이트(Merge)를 지원합니다.
            </p>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {/* Export Button */}
              <button
                type="button"
                onClick={handleExportDB}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold transition-all"
              >
                <Download className="w-3.5 h-3.5 text-mantis-400" />
                <span>DB 파일 내보내기 (.json)</span>
              </button>

              {/* Import Button */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold transition-all"
              >
                <Upload className="w-3.5 h-3.5 text-blue-400" />
                <span>외부 DB 파일 가져와 병합</span>
              </button>
            </div>

            {importStatus && (
              <div className="p-2.5 rounded-xl bg-slate-950 text-mantis-300 border border-mantis-500/30 text-xs font-mono">
                {importStatus}
              </div>
            )}
          </div>

          {/* 2. Mantis Server URL Configuration */}
          <div className="space-y-2">
            <label className="block font-bold text-slate-200">
              사내 MantisBT 서버 URL
            </label>
            <input
              type="text"
              value={form.mantisUrl}
              onChange={e => setForm(f => ({ ...f, mantisUrl: e.target.value }))}
              placeholder="http://192.168.16.200"
              className="w-full px-3.5 py-2.5 bg-slate-900 text-slate-100 rounded-xl border border-slate-700 focus:border-mantis-500 outline-none font-mono"
            />
            <p className="text-main0 text-[11px]">
              기본값: <code className="text-slate-400">http://192.168.16.200</code> (로컬 네트워크 환경에서 접근)
            </p>
          </div>

          {/* 3. AI Assistant Settings */}
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Bot className="w-4 h-4 text-indigo-400" />
              AI 어시스턴트 & 모델 연동 설정
            </h3>

            <div className="space-y-2">
              <label className="block font-semibold text-slate-300">AI 공급자 (Provider)</label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  { key: 'local', label: '로컬 NLP (기본)' },
                  { key: 'custom', label: 'Custom LLM' },
                  { key: 'openai', label: 'Codex' },
                  { key: 'gemini', label: 'Antigravity' },
                  { key: 'claude', label: 'Claude' }
                ].map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleProviderChange(item.key as any)}
                    className={`py-2 px-2.5 rounded-xl border text-xs font-semibold transition-all text-center ${
                      form.ai.provider === item.key
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {form.ai.provider === 'custom' && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-slate-400 mb-1">Custom 엔드포인트 URL</label>
                  <input
                    type="text"
                    value={form.ai.customUrl}
                    onChange={e => setForm(f => ({ ...f, ai: { ...f.ai, customUrl: e.target.value } }))}
                    placeholder="http://10.100.8.39:8502/v1"
                    className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-200 font-mono"
                  />
                </div>
              </div>
            )}

            {(form.ai.provider === 'openai' || form.ai.provider === 'gemini' || form.ai.provider === 'claude' || form.ai.provider === 'custom') && (
              <div className="space-y-3 pt-2">
                {form.ai.provider === 'custom' && (
                  <div>
                    <label className="block text-slate-400 mb-1">API Key</label>
                    <input
                      type="password"
                      value={form.ai.apiKey}
                      onChange={e => setForm(f => ({ ...f, ai: { ...f.ai, apiKey: e.target.value } }))}
                      placeholder="API 키를 입력하세요"
                      className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-200 font-mono"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-slate-400 mb-1">모델명</label>
                  {(form.ai.provider === 'openai' || form.ai.provider === 'gemini' || form.ai.provider === 'claude') ? (
                    isLoadingModels ? (
                      <div className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-400 flex items-center justify-center">
                        <span className="animate-pulse">모델 리스트 불러오는 중...</span>
                      </div>
                    ) : (
                      <select
                        value={form.ai.model}
                        onChange={e => handleModelChange(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-200 font-mono"
                      >
                        {availableModels.length > 0 ? (
                          availableModels.map(m => {
                            const id = typeof m === 'string' ? m : m.id;
                            const label = typeof m === 'string' ? m : (m.displayName && m.displayName !== m.id ? `${m.displayName} (${m.id})` : m.id);
                            return (
                              <option key={id} value={id}>{label}</option>
                            );
                          })
                        ) : (
                          <option value="">모델 리스트 없음</option>
                        )}
                      </select>
                    )
                  ) : (
                    <input
                      type="text"
                      value={form.ai.model}
                      onChange={e => handleModelChange(e.target.value)}
                      placeholder="aico-rag-qwen2.5-coder-7b 등"
                      className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-200 font-mono"
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* SECTION 4: ClearCase SSH Server Connection */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-indigo-400" />
                ClearCase VOB 서버 SSH 연동 (웹 내장 Diff 뷰어용)
              </h3>
              <span className="text-[10px] text-main0 font-mono">
                {form.ssh?.host || '미설정'}
              </span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              사내 ClearCase VOB 서버의 SSH 접속 정보를 입력하시면, 수정 소스 파일 목록에서 <strong>[⚡ Diff]</strong> 버튼 클릭 시 이전 버전(<code>@@/main/1</code>)과 수정 버전(<code>@@/main/2</code>)의 소스를 실시간으로 읽어와 웹 화면에 바로 라인별 Diff를 보여줍니다.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-slate-400 text-[11px] mb-1">서버 IP / 호스트명</label>
                <input
                  type="text"
                  value={form.ssh?.host || ''}
                  onChange={e => setForm(f => ({ ...f, ssh: { ...(f.ssh || { port: 22, username: 'dev', password: '', enabled: true }), host: e.target.value } }))}
                  placeholder="예: 192.168.16.200 또는 arena"
                  className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-200 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] mb-1">SSH 포트</label>
                <input
                  type="number"
                  value={form.ssh?.port || 22}
                  onChange={e => setForm(f => ({ ...f, ssh: { ...(f.ssh || { host: '', username: 'dev', password: '', enabled: true }), port: parseInt(e.target.value, 10) || 22 } }))}
                  placeholder="22"
                  className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-200 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] mb-1">계정 (ID / Username)</label>
                <input
                  type="text"
                  value={form.ssh?.username || ''}
                  onChange={e => setForm(f => ({ ...f, ssh: { ...(f.ssh || { host: '', port: 22, password: '', enabled: true }), username: e.target.value } }))}
                  placeholder="예: dev 또는 hyungduk"
                  className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-200 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] mb-1">비밀번호 (Password)</label>
                <input
                  type="password"
                  value={form.ssh?.password || ''}
                  onChange={e => setForm(f => ({ ...f, ssh: { ...(f.ssh || { host: '', port: 22, username: 'dev', enabled: true }), password: e.target.value } }))}
                  placeholder="서버 비밀번호"
                  className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-200 text-xs font-mono"
                />
              </div>
            </div>

            {/* Test Connection Button & Status */}
            <div className="pt-2 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={async () => {
                  setSshTestStatus('연결 테스트 중...');
                  try {
                    const res = await testSSH(form.ssh || { host: '', port: 22, username: '', password: '', enabled: true });
                    setSshTestStatus(`✅ ${res.message}`);
                  } catch (err: any) {
                    setSshTestStatus(`❌ ${err.message}`);
                  }
                }}
                className="px-3 py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"
              >
                <Zap className="w-3.5 h-3.5 text-indigo-400" />
                SSH 연결 테스트
              </button>

              {sshTestStatus && (
                <span className="text-[11px] font-mono text-slate-300 truncate max-w-sm">
                  {sshTestStatus}
                </span>
              )}
            </div>
          </div>

          {/* SECTION 5: Local Source Diff Dataset Auto-Indexer */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900/90 via-slate-900/60 to-emerald-950/20 border border-emerald-500/20 space-y-3.5 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                  <Layers className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    로컬 소스코드 Diff 데이터셋 자동 구축 현황
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    앱 실행 중 백그라운드에서 전수 Unified Diff를 자동 수집하여 AI 코드 분석용 데이터셋을 생성합니다.
                  </p>
                </div>
              </div>

              {/* Status Badge & Control Button */}
              <div className="flex items-center gap-2">
                {workerStatus && (
                  <div className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1.5 border ${
                    workerStatus.status === 'running'
                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 animate-pulse'
                      : workerStatus.status === 'completed'
                      ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                      : workerStatus.status === 'waiting_ssh'
                      ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                      : workerStatus.status === 'paused'
                      ? 'bg-slate-800 text-slate-400 border-slate-700'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    {workerStatus.status === 'running' && (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin text-emerald-400 shrink-0" />
                        <span>
                          {workerStatus.activeCrids && workerStatus.activeCrids.length > 0 ? (
                            <>
                              <span className="font-bold text-emerald-300">
                                {workerStatus.activeCrids.length}개 동시 수집 중
                              </span>
                              <span className="text-[10px] text-emerald-400/80 ml-1 font-mono">
                                ({workerStatus.activeCrids.slice(0, 3).map(id => `#${id}`).join(', ')}
                                {workerStatus.activeCrids.length > 3 ? ` 외 ${workerStatus.activeCrids.length - 3}건` : ''})
                              </span>
                            </>
                          ) : (
                            `수집 준비 (${workerStatus.concurrency || form.diffConcurrency || 3}워커)`
                          )}
                        </span>
                      </>
                    )}
                    {workerStatus.status === 'completed' && (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-blue-400" />
                        데이터셋 구축 완료 (100%)
                      </>
                    )}
                    {workerStatus.status === 'waiting_ssh' && (
                      <>
                        <AlertCircle className="w-3 h-3 text-amber-400" />
                        SSH 설정 대기
                      </>
                    )}
                    {workerStatus.status === 'paused' && (
                      <>
                        <Pause className="w-3 h-3 text-slate-400" />
                        일시정지됨
                      </>
                    )}
                    {workerStatus.status === 'idle' && (
                      <>
                        <Clock className="w-3 h-3 text-slate-400" />
                        대기 중
                      </>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleToggleWorker}
                  disabled={workerLoading || !workerStatus}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all border ${
                    workerStatus?.enabled
                      ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                      : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  }`}
                  title={workerStatus?.enabled ? '자동 수집 일시정지' : '자동 수집 시작/재개'}
                >
                  {workerStatus?.enabled ? (
                    <>
                      <Pause className="w-3 h-3" />
                      일시정지
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3" />
                      자동 수집 시작
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Parallel Worker Concurrency Control */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 bg-slate-950/80 p-3 rounded-xl border border-slate-800/90">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                    동시 수집 속도 (Concurrency)
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-bold border border-amber-500/30">
                      {workerStatus?.concurrency || form.diffConcurrency || 3}개 동시 병렬
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    동시에 SSH로 소스코드를 수집할 CR 개수를 설정합니다 (최대 10개 초초고속 병렬 수집 지원).
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 self-end sm:self-auto bg-slate-900/90 p-1 rounded-xl border border-slate-800">
                {[
                  { value: 1, label: '1개', desc: '안전' },
                  { value: 3, label: '3개', desc: '권장' },
                  { value: 5, label: '5개', desc: '고속' },
                  { value: 8, label: '8개', desc: '초고속' },
                  { value: 10, label: '10개', desc: '초초고속 🚀' }
                ].map(opt => {
                  const currentVal = workerStatus?.concurrency || form.diffConcurrency || 3;
                  const isSelected = currentVal === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleConcurrencyChange(opt.value)}
                      className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${
                        isSelected
                          ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold shadow-md shadow-amber-500/20 scale-[1.03]'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80'
                      }`}
                      title={`${opt.label} (${opt.desc})`}
                    >
                      <span>{opt.label}</span>
                      {opt.value === 10 && <span className="ml-1 text-[10px]">🚀</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Progress Bar & Percentage */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                  전체 데이터셋 완성률
                </span>
                <span className="font-mono font-bold text-emerald-400 text-sm">
                  {workerStatus?.percentage ?? 0}%
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${Math.min(100, Math.max(0, workerStatus?.percentage ?? 0))}%` }}
                />
              </div>
            </div>

            {/* Detailed Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-center font-mono">
              <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
                <div className="text-[10px] text-slate-400">인덱싱된 CR</div>
                <div className="text-xs font-bold text-slate-200 mt-0.5">
                  {workerStatus ? `${workerStatus.cachedCRs} / ${workerStatus.targetCRsWithFiles || workerStatus.totalCRs}` : '-'}
                </div>
              </div>

              <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
                <div className="text-[10px] text-slate-400">수집된 소스 파일</div>
                <div className="text-xs font-bold text-emerald-300 mt-0.5">
                  {workerStatus?.totalFiles ? `${workerStatus.totalFiles.toLocaleString()}개` : '0개'}
                </div>
              </div>

              <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
                <div className="text-[10px] text-slate-400">데이터셋 용량</div>
                <div className="text-xs font-bold text-cyan-300 mt-0.5">
                  {workerStatus?.totalSizeFormatted || '0 B'}
                </div>
              </div>

              <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
                <div className="text-[10px] text-slate-400">남은 대상</div>
                <div className="text-xs font-bold text-amber-300 mt-0.5">
                  {workerStatus ? `${Math.max(0, (workerStatus.targetCRsWithFiles || workerStatus.totalCRs) - workerStatus.cachedCRs)}개 남음` : '-'}
                </div>
              </div>
            </div>

            {/* Note & Incremental Sync Info */}
            <div className="text-[11px] text-slate-400 bg-slate-950/50 p-2.5 rounded-xl border border-slate-800/60 leading-relaxed flex items-start gap-2">
              <span className="text-emerald-400 font-bold shrink-0">✨ 무인 자동화:</span>
              <span>
                백그라운드에서 최대 10개 병렬 워커로 빠르게 수집합니다. Mantis 동기화로 <strong>새로 추가되거나 갱신(Update)된 CR은 우선순위 큐에 자동 등록되어 즉시 데이터셋에 증분 반영</strong>됩니다.
              </span>
            </div>
          </div>

          {/* Footer Save Button */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-mantis-500 hover:bg-mantis-400 text-slate-950 font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-mantis-500/20"
            >
              {saveSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  저장됨!
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  설정 저장
                </>
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
