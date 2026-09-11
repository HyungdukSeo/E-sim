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
  Clock,
  Route,
  Network,
  Server,
  Plus,
  Trash2,
  FolderOpen
} from 'lucide-react';
import { AppSettings, SyncMeta } from '../types/cr';
import { 
  testSSH, 
  saveSettingsToDisk, 
  fetchSettingsFromDisk, 
  fetchDiffWorkerStatus, 
  controlDiffWorker, 
  DiffWorkerStatus, 
  openDataDirectory,
  fetchAIProvidersStatus,
  AIProviderStatusItem
} from '../services/api';
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
  const [dataFolderStatus, setDataFolderStatus] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [providersStatus, setProvidersStatus] = useState<Record<string, AIProviderStatusItem>>({});

  // Background Diff Worker Status & Control
  const [workerStatus, setWorkerStatus] = useState<DiffWorkerStatus | null>(null);
  const [workerLoading, setWorkerLoading] = useState(false);
  const [serverTestResults, setServerTestResults] = useState<Record<string, { loading: boolean; msg: string; ok?: boolean }>>({});

  // Ensure form.sshServers is initialized
  useEffect(() => {
    if (isOpen) {
      setForm(prev => {
        const servers = prev.sshServers && prev.sshServers.length > 0 
          ? prev.sshServers 
          : [
              {
                id: 'server-1',
                name: '1차 ClearCase 서버 (메인)',
                ...(prev.ssh || { host: '192.168.16.200', port: 22, username: 'dev', password: '', enabled: true })
              }
            ];
        return {
          ...prev,
          sshServers: servers,
          ssh: servers[0] ? { ...servers[0], servers } : prev.ssh
        };
      });
    }
  }, [isOpen]);

  const handleAddServer = () => {
    const newId = `server-${Date.now()}`;
    setForm(prev => {
      const currentList = prev.sshServers || [prev.ssh || { host: '', port: 22, username: 'dev', password: '', enabled: true }];
      const newServer = {
        id: newId,
        name: `${currentList.length + 1}차 ClearCase 서버 (보조)`,
        host: '',
        port: 22,
        username: prev.ssh?.username || 'dev',
        password: prev.ssh?.password || '',
        enabled: true
      };
      const updated = [...currentList, newServer];
      return {
        ...prev,
        sshServers: updated,
        ssh: updated[0] ? { ...updated[0], servers: updated } : prev.ssh
      };
    });
  };

  const handleUpdateServer = (index: number, updates: Partial<any>) => {
    setForm(prev => {
      const servers = [...(prev.sshServers || [])];
      if (servers[index]) {
        servers[index] = { ...servers[index], ...updates };
      }
      return {
        ...prev,
        sshServers: servers,
        ssh: servers[0] ? { ...servers[0], servers } : prev.ssh
      };
    });
  };

  const handleRemoveServer = (index: number) => {
    setForm(prev => {
      const servers = (prev.sshServers || []).filter((_, i) => i !== index);
      return {
        ...prev,
        sshServers: servers,
        ssh: servers[0] ? { ...servers[0], servers } : prev.ssh
      };
    });
  };

  const handleTestServer = async (server: any, idKey: string) => {
    setServerTestResults(prev => ({ ...prev, [idKey]: { loading: true, msg: '연결 테스트 중...' } }));
    try {
      const res = await testSSH(server);
      setServerTestResults(prev => ({ ...prev, [idKey]: { loading: false, msg: `✅ ${res.message}`, ok: true } }));
    } catch (err: any) {
      setServerTestResults(prev => ({ ...prev, [idKey]: { loading: false, msg: `❌ ${err.message}`, ok: false } }));
    }
  };

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
      fetchSettingsFromDisk().then(diskSettings => {
        if (diskSettings) {
          setForm(prev => {
            const merged = { ...prev, ...diskSettings };
            if (!merged.sshServers || merged.sshServers.length === 0) {
              if (diskSettings.ssh) {
                merged.sshServers = [{ id: 'server-1', name: '1차 ClearCase 서버 (메인)', ...diskSettings.ssh }];
              }
            }
            return merged;
          });
        }
      });
      // One-shot on open only — no auto-polling. Use the refresh button for
      // an on-demand re-check instead, same pattern as provider status.
      loadWorkerStatus();
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
    claude: 'claude-3-5-sonnet-latest',
    omniroute: 'auto'
  };

  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const fetchModelsForProvider = async (provider: string, omnirouteUrl?: string, omnirouteApiKey?: string) => {
    if (provider !== 'openai' && provider !== 'gemini' && provider !== 'claude' && provider !== 'omniroute') {
      return;
    }
    setIsLoadingModels(true);
    try {
      let url = `/api/ai/models?provider=${provider}`;
      if (provider === 'omniroute') {
        const cleanBaseUrl = omnirouteUrl || form.ai.omnirouteUrl || 'http://localhost:20128/v1';
        const rawKey = omnirouteApiKey !== undefined ? omnirouteApiKey : form.ai.omnirouteApiKey;
        const cleanApiKey = (rawKey && rawKey !== 'CHANGEME' && rawKey !== 'sk-omniroute')
          ? rawKey
          : (providersStatus.omniroute?.detectedKey || '');
        url += `&baseUrl=${encodeURIComponent(cleanBaseUrl)}&apiKey=${encodeURIComponent(cleanApiKey)}`;
      }

      const res = await axios.get(url);
      if (res.data && res.data.models && Array.isArray(res.data.models)) {
        const list = res.data.models;
        setAvailableModels(list);

        const modelIds = list.map((m: any) => typeof m === 'string' ? m : m.id);

        setForm(prev => {
          if (prev.ai.provider !== provider) return prev;

          const savedModel = prev.ai.providerModels?.[provider] || prev.ai.model;
          const chosenModel = modelIds.includes(savedModel) ? savedModel : (modelIds[0] || savedModel || 'auto');

          return {
            ...prev,
            ai: {
              ...prev.ai,
              model: chosenModel,
              providerModels: {
                ...DEFAULT_PROVIDER_MODELS,
                ...(prev.ai.providerModels || {}),
                [provider]: chosenModel
              }
            }
          };
        });
      }
    } catch (err) {
      console.error('Failed to fetch models:', err);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleProviderChange = (newProvider: 'local' | 'custom' | 'openai' | 'gemini' | 'claude' | 'omniroute') => {
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
    if (form.ai.provider === 'openai' || form.ai.provider === 'gemini' || form.ai.provider === 'claude' || form.ai.provider === 'omniroute') {
      fetchModelsForProvider(form.ai.provider, form.ai.omnirouteUrl, form.ai.omnirouteApiKey);
    }
  }, [form.ai.provider]);

  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);

  // forceRefresh bypasses the server-side CLI-path cache (see server/cli-models.js).
  // Without it, clicking "실시간 감지" right after the modal's own auto-check almost
  // always hits the cache and returns near-instantly — the spinner flashes so briefly
  // it looks like the button did nothing. The manual button always forces a real
  // re-check, and we also floor the spinner at ~400ms so the click always reads as
  // having done something even when the result truly is unchanged.
  const refreshProvidersStatus = React.useCallback(async (forceRefresh = false) => {
    const startedAt = Date.now();
    try {
      setIsRefreshingProviders(true);
      const res = await fetchAIProvidersStatus({
        omnirouteUrl: form.ai.omnirouteUrl,
        omnirouteApiKey: form.ai.omnirouteApiKey,
        customUrl: form.ai.customUrl,
        openaiApiKey: form.ai.apiKey,
        claudeApiKey: form.ai.apiKey,
        geminiApiKey: form.ai.apiKey,
        forceRefresh
      });
      if (res && res.status) {
        setProvidersStatus(res.status);
        const currentKey = form.ai.omnirouteApiKey;
        const isDefaultOrPlaceholder = !currentKey || currentKey === 'sk-omniroute' || currentKey === 'CHANGEME';
        if (res.status.omniroute?.detectedKey && isDefaultOrPlaceholder) {
          setForm(prev => ({
            ...prev,
            ai: {
              ...prev.ai,
              omnirouteApiKey: res.status.omniroute.detectedKey || ''
            }
          }));
        }
      }
    } catch {
      // ignore
    } finally {
      if (forceRefresh) {
        const elapsed = Date.now() - startedAt;
        const MIN_SPINNER_MS = 400;
        if (elapsed < MIN_SPINNER_MS) {
          await new Promise(r => setTimeout(r, MIN_SPINNER_MS - elapsed));
        }
      }
      setIsRefreshingProviders(false);
    }
  }, [form.ai.omnirouteUrl, form.ai.omnirouteApiKey, form.ai.customUrl, form.ai.apiKey]);

  useEffect(() => {
    if (!isOpen) return;
    // One-shot check on open only — 3s auto-polling was hammering execSync-based
    // CLI detection (which/where, sqlite3) on every tick and could hang the UI.
    // Use the "실시간 감지" refresh button for an on-demand re-check instead.
    refreshProvidersStatus();
  }, [isOpen, refreshProvidersStatus]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const primaryServer = form.sshServers?.find(s => s.enabled) || form.sshServers?.[0] || form.ssh;
    const finalForm = {
      ...form,
      ssh: {
        ...primaryServer,
        servers: form.sshServers
      }
    };
    onSaveSettings(finalForm);
    await saveSettingsToDisk(finalForm);
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      onClose();
    }, 1200);
  };

  const handleOpenDataFolder = async () => {
    try {
      setDataFolderStatus('데이터 폴더 여는 중...');
      const res = await openDataDirectory();
      if (res.ok) {
        setDataFolderStatus('📂 데이터 저장 폴더를 열었습니다.');
      } else {
        setDataFolderStatus('⚠️ 폴더 열기 요청 실패');
      }
      setTimeout(() => setDataFolderStatus(null), 4000);
    } catch (e: any) {
      setDataFolderStatus(`❌ 오류: ${e.message}`);
      setTimeout(() => setDataFolderStatus(null), 4000);
    }
  };

  const handleExportDB = () => {
    setIsExporting(true);
    setDataFolderStatus('📦 전체 DB 및 소스코드 Diff 캐시를 하나의 ZIP 번들로 압축 생성 중입니다 (약 10~15초 소요)...');

    const link = document.createElement('a');
    link.href = '/api/database/export';
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      setIsExporting(false);
      setDataFolderStatus('✓ 압축 번들 다운로드가 시작되었습니다!');
      setTimeout(() => setDataFolderStatus(null), 5000);
    }, 4000);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const isZip = file.name.toLowerCase().endsWith('.zip');
      setImportStatus(isZip 
        ? `📦 번들 파일 업로드 및 압축 해제 중입니다 (${(file.size / (1024 * 1024)).toFixed(1)} MB)... 잠시만 기다려주세요.` 
        : 'JSON 데이터베이스 파일 읽는 중...');

      // Direct binary streaming upload
      const response = await fetch('/api/database/import-bundle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Filename': encodeURIComponent(file.name)
        },
        body: file
      });

      const res = await response.json();
      if (res.ok) {
        if (res.isBundle) {
          setImportStatus(`🎉 복원 완료! 총 ${res.totalCount.toLocaleString()}건 CR 및 ${res.cachedDiffs.toLocaleString()}건 Diff 캐시 복원됨 (${res.totalSize || ''})`);
        } else {
          setImportStatus(`🎉 성공! 총 ${res.totalCount.toLocaleString()}건 동기화 완료`);
        }
        onRefreshData();
        loadWorkerStatus();
        setTimeout(() => setImportStatus(null), 6000);
      } else {
        throw new Error(res.error || '가져오기 실패');
      }
    } catch (err: any) {
      setImportStatus(`❌ 오류 발생: ${err.message}`);
      setTimeout(() => setImportStatus(null), 5000);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  if (!isOpen) return null;

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
                영구 데이터베이스 & Diff 캐시 보존 관리
              </h3>
              <span className="text-[11px] font-mono text-mantis-300">
                {meta.totalCount.toLocaleString()}건 저장됨
              </span>
            </div>

            <p className="text-slate-400 text-[11px] leading-relaxed">
              모든 Mantis CR 메타데이터 DB와 Diff 캐시는 시스템 표준 영구 데이터 디렉토리에 보존되어, <strong className="text-emerald-300 font-semibold">앱을 업데이트하거나 재설치(덮어쓰기)해도 데이터가 절대 삭제되지 않습니다.</strong>
              &nbsp;<strong>'DB&Cache 내보내기'</strong>로 전체 데이터셋을 하나의 압축 파일(.zip)로 백업하여 다른 PC의 데이터 저장 폴더에 넣거나 가져오기하면, <strong className="text-cyan-300">ClearCase SSH 추가 수집 없이 즉시 100% 동일하게 사용</strong>할 수 있습니다.
            </p>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {/* Open Data Directory Button */}
              <button
                type="button"
                onClick={handleOpenDataFolder}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-200 border border-emerald-700/60 font-semibold transition-all cursor-pointer shadow-sm"
                title="앱 재설치 시에도 보존되는 OS 영구 데이터 폴더를 엽니다"
              >
                <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
                <span>데이터 저장 폴더 열기 (영구 보존)</span>
              </button>

              {/* Export Button */}
              <button
                type="button"
                onClick={handleExportDB}
                disabled={isExporting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold transition-all cursor-pointer shadow-sm disabled:opacity-50"
                title="Mantis CR DB와 전체 소스코드 Diff 캐시(데이터셋)를 하나의 .zip 파일로 압축하여 다운로드합니다."
              >
                {isExporting ? (
                  <RefreshCw className="w-3.5 h-3.5 text-mantis-400 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-mantis-400" />
                )}
                <span>{isExporting ? 'DB&Cache 압축 중...' : 'DB&Cache 내보내기 (.zip)'}</span>
              </button>

              {/* Import Button */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,.json"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold transition-all cursor-pointer shadow-sm"
                title="내보낸 .zip 번들 파일 또는 .json 파일을 선택하여 즉시 복원합니다."
              >
                <Upload className="w-3.5 h-3.5 text-blue-400" />
                <span>외부 DB&Cache 가져오기 (.zip/.json)</span>
              </button>
            </div>

            {(dataFolderStatus || importStatus) && (
              <div className="p-2.5 rounded-xl bg-slate-950 text-mantis-300 border border-mantis-500/30 text-xs font-mono">
                {dataFolderStatus || importStatus}
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

            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="block font-semibold text-slate-300">AI 공급자 (Provider)</label>
                  <button
                    type="button"
                    onClick={() => refreshProvidersStatus(true)}
                    className="p-1 rounded-md text-slate-400 hover:text-indigo-300 hover:bg-slate-800 transition-all flex items-center gap-1 text-[11px] cursor-pointer"
                    title="실시간 공급자 구동 상태 즉시 새로고침"
                  >
                    <RefreshCw className={`w-3 h-3 ${isRefreshingProviders ? 'animate-spin text-indigo-400' : ''}`} />
                    <span>실시간 감지</span>
                  </button>
                </div>
                <span className="text-[11px] text-slate-400">
                  {providersStatus[form.ai.provider]?.ready 
                    ? <span className="text-emerald-400 font-medium">● 정상 작동 준비됨</span> 
                    : form.ai.provider === 'local' 
                    ? <span className="text-emerald-400 font-medium">● 상시 사용 가능</span> 
                    : <span className="text-amber-400 font-medium">▲ 미구동 (로컬 NLP로 자동 대체)</span>}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {[
                  { key: 'local', label: '로컬 NLP', badge: '기본' },
                  { key: 'omniroute', label: 'OmniRoute', badge: 'Gateway' },
                  { key: 'custom', label: 'Custom LLM' },
                  { key: 'openai', label: 'Codex' },
                  { key: 'gemini', label: 'Antigravity' },
                  { key: 'claude', label: 'Claude' }
                ].map(item => {
                  const status = providersStatus[item.key];
                  const isReady = item.key === 'local' ? true : (status ? status.ready : false);
                  const isSelected = form.ai.provider === item.key;

                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => handleProviderChange(item.key as any)}
                      title={status?.reason || (isReady ? '정상 사용 가능' : '미구동/설정 필요')}
                      className={`relative py-2 px-1 rounded-xl border text-xs font-semibold transition-all text-center flex flex-col items-center justify-between min-h-[66px] cursor-pointer select-none ${
                        isSelected
                          ? 'bg-indigo-50 dark:bg-indigo-950/60 border-2 border-indigo-600 dark:border-indigo-400 shadow-md ring-2 ring-indigo-500/40 font-bold'
                          : isReady
                          ? 'bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 shadow-sm'
                          : 'bg-slate-100/80 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 hover:border-slate-400'
                      }`}
                    >
                      {/* Top row: Status Dot + Label */}
                      <div className="flex items-center justify-center gap-1 w-full px-0.5">
                        <span 
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            isReady 
                              ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' 
                              : 'bg-slate-400 dark:bg-slate-600'
                          }`} 
                        />
                        <span className={`font-extrabold text-[10.5px] sm:text-[11px] tracking-tight leading-tight whitespace-nowrap overflow-hidden text-ellipsis ${
                          isSelected
                            ? 'text-indigo-950 dark:text-indigo-100'
                            : isReady
                            ? 'text-neutral-900 dark:text-neutral-100'
                            : 'text-neutral-500 dark:text-neutral-400'
                        }`}>
                          {item.label}
                        </span>
                      </div>

                      {/* Bottom row: Badge + Status Text */}
                      <div className="flex items-center justify-center gap-1 w-full mt-1">
                        {item.badge && (
                          <span className={`text-[9px] px-1 py-0.2 rounded font-mono font-bold whitespace-nowrap ${
                            isSelected
                              ? 'bg-indigo-600/20 text-indigo-950 dark:text-indigo-200'
                              : 'bg-indigo-500/15 dark:bg-indigo-500/25 text-indigo-900 dark:text-indigo-200'
                          }`}>
                            {item.badge}
                          </span>
                        )}
                        <span className={`text-[10px] font-mono whitespace-nowrap font-extrabold ${
                          isReady 
                            ? 'text-emerald-800 dark:text-emerald-400' 
                            : 'text-amber-800 dark:text-amber-400'
                        }`}>
                          {isReady ? '준비됨' : '미구동'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Provider Unready / Fallback Explanatory Notice */}
              {form.ai.provider !== 'local' && providersStatus[form.ai.provider] && !providersStatus[form.ai.provider].ready && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="font-bold text-amber-950 dark:text-amber-300">
                      선택하신 [{providersStatus[form.ai.provider]?.label}] 공급자가 현재 미구동/미설정 상태입니다.
                    </div>
                    <div className="text-[11px] text-amber-800 dark:text-amber-300/80 leading-relaxed font-medium">
                      {providersStatus[form.ai.provider]?.reason}. 질의 시 오류 없이 <strong>[로컬 NLP (기본)]</strong> 엔진으로 자동 전환되어 정상 동작합니다.
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* OmniRoute Dedicated Configuration */}
            {form.ai.provider === 'omniroute' && (
              <div className="space-y-3 pt-2">
                <div className="p-3.5 rounded-xl bg-slate-950/90 border border-indigo-500/30 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                        <Route className="w-3.5 h-3.5 text-indigo-400" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-slate-200">OmniRoute 로컬 AI 게이트웨이 연동</span>
                        <span className="text-[10px] text-slate-400 ml-2 font-mono">http://localhost:20128/v1</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a 
                        href="https://github.com/diegosouzapw/OmniRoute" 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 hover:underline"
                      >
                        GitHub <ExternalLink className="w-3 h-3" />
                      </a>
                      <span className="text-slate-600 text-xs">•</span>
                      <a 
                        href="https://velog.io/@okorion/OmniRoute-%EC%97%AC%EB%9F%AC-AI-Provider%EB%A5%BC-%ED%95%98%EB%82%98%EC%9D%98-%EC%97%94%EB%93%9C%ED%8F%AC%EC%9D%B8%ED%8A%B8%EB%A1%9C-%EB%AC%B6%EB%8A%94-%EB%A1%9C%EC%BB%AC-AI-Gateway-edkx3iud" 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 hover:underline"
                      >
                        가이드 <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 text-[11px] mb-1 font-medium">Gateway 엔드포인트 URL</label>
                      <input
                        type="text"
                        value={form.ai.omnirouteUrl || 'http://localhost:20128/v1'}
                        onChange={e => setForm(f => ({ ...f, ai: { ...f.ai, omnirouteUrl: e.target.value } }))}
                        placeholder="http://localhost:20128/v1"
                        className="w-full px-3 py-2 bg-slate-900 rounded-xl border border-slate-700 text-slate-200 text-xs font-mono focus:border-indigo-500 outline-none"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-slate-400 text-[11px] font-medium">API 토큰 (Bearer Token)</label>
                        {providersStatus.omniroute?.detectedKey && (
                          <span className="text-[10px] text-emerald-400 font-mono">
                            ✓ 로컬 키 자동 감지됨
                          </span>
                        )}
                      </div>
                      <input
                        type="password"
                        value={form.ai.omnirouteApiKey !== undefined && form.ai.omnirouteApiKey !== 'CHANGEME' ? form.ai.omnirouteApiKey : (providersStatus.omniroute?.detectedKey || '')}
                        onChange={e => setForm(f => ({ ...f, ai: { ...f.ai, omnirouteApiKey: e.target.value } }))}
                        placeholder={providersStatus.omniroute?.detectedKey ? `자동 감지됨 (${providersStatus.omniroute.detectedKey.slice(0, 10)}...)` : "sk-omniroute"}
                        className="w-full px-3 py-2 bg-slate-900 rounded-xl border border-slate-700 text-slate-200 text-xs font-mono focus:border-indigo-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-indigo-950/30 border border-indigo-500/20 text-[11px] text-slate-300 space-y-1">
                    <p className="leading-relaxed">
                      💡 로컬 터미널에서 <code className="text-indigo-300 bg-slate-900 px-1 py-0.5 rounded font-mono">npx omniroute</code> 또는 <code className="text-indigo-300 bg-slate-900 px-1 py-0.5 rounded font-mono">omniroute start</code>를 실행하면 20128 포트에서 Anthropic Claude, OpenAI, Gemini, Ollama 등의 공급자를 하나로 묶어 자동 라우팅합니다.
                    </p>
                    <p className="text-slate-400 text-[10px]">
                      추천 가상 모델: <code className="text-emerald-400 font-mono">auto</code> (스마트 분기), <code className="text-emerald-400 font-mono">auto/coding</code> (Diff 코드 분석 최적화), <code className="text-emerald-400 font-mono">auto/fast</code> (최고속 응답)
                    </p>
                  </div>
                </div>
              </div>
            )}

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

            {(form.ai.provider === 'openai' || form.ai.provider === 'gemini' || form.ai.provider === 'claude' || form.ai.provider === 'custom' || form.ai.provider === 'omniroute') && (
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-slate-400 text-xs font-medium">선택된 모델</label>
                    {(form.ai.provider === 'openai' || form.ai.provider === 'gemini' || form.ai.provider === 'claude' || form.ai.provider === 'omniroute') && (
                      <button
                        type="button"
                        onClick={() => fetchModelsForProvider(form.ai.provider, form.ai.omnirouteUrl, form.ai.omnirouteApiKey)}
                        disabled={isLoadingModels}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors font-medium cursor-pointer"
                      >
                        <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                        모델 새로고침
                      </button>
                    )}
                  </div>

                  {(form.ai.provider === 'openai' || form.ai.provider === 'gemini' || form.ai.provider === 'claude' || form.ai.provider === 'omniroute') ? (
                    isLoadingModels ? (
                      <div className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-400 flex items-center justify-center text-xs">
                        <span className="animate-pulse flex items-center gap-2">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                          모델 리스트 불러오는 중...
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <select
                          value={form.ai.model}
                          onChange={e => handleModelChange(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-200 font-mono text-xs focus:border-indigo-500 outline-none"
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
                            <option value={form.ai.model || 'auto'}>{form.ai.model || 'auto'}</option>
                          )}
                        </select>

                        {form.ai.provider === 'omniroute' && (
                          <div className="flex items-center gap-2 pt-0.5">
                            <span className="text-[11px] text-slate-400 shrink-0">커스텀 모델 직접 입력:</span>
                            <input
                              type="text"
                              value={form.ai.model}
                              onChange={e => handleModelChange(e.target.value)}
                              placeholder="auto 또는 특정 모델명 (예: auto/coding, gpt-4o, claude-3-5-sonnet)"
                              className="flex-1 px-3 py-1.5 bg-slate-950 rounded-lg border border-slate-800 text-slate-200 font-mono text-xs focus:border-indigo-500 outline-none"
                            />
                          </div>
                        )}
                      </div>
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

          {/* SECTION 4: ClearCase SSH Server Connection (Multi-Server Support) */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center">
                  <Server className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    ClearCase VOB 서버 다중 연동 (자동 Fallback 탐색)
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono">
                      {(form.sshServers || []).length}대 등록됨
                    </span>
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    사내에 여러 대의 ClearCase 서버가 있는 경우 순차적으로 탐색하여 VOB 소스를 자동으로 찾아옵니다.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleAddServer}
                className="px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>서버 추가</span>
              </button>
            </div>

            <div className="p-2.5 rounded-xl bg-indigo-950/20 border border-indigo-500/10 text-[11px] text-slate-300 leading-relaxed">
              💡 <strong>다중 서버 자동 폴백 동작 방식:</strong> Diff 조회 시 등록된 서버들을 순서대로 탐색합니다. 1차 서버에 마운트되어 있지 않거나 찾을 수 없는 VOB/소스 파일인 경우, 등록된 2차, 3차 보조 서버를 백그라운드에서 자동으로 조회하여 소스를 찾아냅니다.
            </div>

            {/* List of ClearCase Servers */}
            <div className="space-y-3">
              {(form.sshServers || [form.ssh]).map((server, idx) => {
                const sKey = server.id || `srv-${idx}`;
                const testState = serverTestResults[sKey];

                return (
                  <div 
                    key={sKey}
                    className={`p-3.5 rounded-xl border transition-all space-y-3 ${
                      server.enabled !== false 
                        ? 'bg-slate-950/80 border-slate-700/80 shadow-sm' 
                        : 'bg-slate-950/40 border-slate-800/60 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-md font-bold font-mono uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          {idx === 0 ? '1차 (기본)' : `${idx + 1}차 (폴백)`}
                        </span>
                        <input
                          type="text"
                          value={server.name || `${idx + 1}차 ClearCase 서버`}
                          onChange={e => handleUpdateServer(idx, { name: e.target.value })}
                          placeholder="서버 별칭 (예: 메인 VOB 서버, 과거 레거시 서버)"
                          className="px-2 py-1 bg-slate-900 rounded-lg border border-slate-700 text-slate-200 text-xs font-semibold w-56 focus:border-indigo-500 outline-none"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={server.enabled !== false}
                            onChange={e => handleUpdateServer(idx, { enabled: e.target.checked })}
                            className="rounded border-slate-700 text-indigo-500 focus:ring-0"
                          />
                          <span>활성화</span>
                        </label>

                        {(form.sshServers || []).length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveServer(idx)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title="이 서버 삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 pt-0.5">
                      <div className="sm:col-span-2">
                        <label className="block text-slate-400 text-[10px] mb-1 font-medium">서버 IP / 호스트명</label>
                        <input
                          type="text"
                          value={server.host || ''}
                          onChange={e => handleUpdateServer(idx, { host: e.target.value })}
                          placeholder="예: 192.168.16.200 또는 arena"
                          className="w-full px-2.5 py-1.5 bg-slate-900 rounded-xl border border-slate-700 text-slate-200 text-xs font-mono focus:border-indigo-500 outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-slate-400 text-[10px] mb-1 font-medium">포트</label>
                        <input
                          type="number"
                          value={server.port || 22}
                          onChange={e => handleUpdateServer(idx, { port: parseInt(e.target.value, 10) || 22 })}
                          placeholder="22"
                          className="w-full px-2.5 py-1.5 bg-slate-900 rounded-xl border border-slate-700 text-slate-200 text-xs font-mono focus:border-indigo-500 outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-slate-400 text-[10px] mb-1 font-medium">계정 (Username)</label>
                        <input
                          type="text"
                          value={server.username || ''}
                          onChange={e => handleUpdateServer(idx, { username: e.target.value })}
                          placeholder="예: dev 또는 hyungduk"
                          className="w-full px-2.5 py-1.5 bg-slate-900 rounded-xl border border-slate-700 text-slate-200 text-xs font-mono focus:border-indigo-500 outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                      <div>
                        <label className="block text-slate-400 text-[10px] mb-1 font-medium">비밀번호 (Password)</label>
                        <input
                          type="password"
                          value={server.password || ''}
                          onChange={e => handleUpdateServer(idx, { password: e.target.value })}
                          placeholder="서버 SSH 비밀번호"
                          className="w-full px-2.5 py-1.5 bg-slate-900 rounded-xl border border-slate-700 text-slate-200 text-xs font-mono focus:border-indigo-500 outline-none"
                        />
                      </div>

                      <div className="flex items-end justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => handleTestServer(server, sKey)}
                          disabled={testState?.loading}
                          className="px-3 py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
                        >
                          <Zap className={`w-3.5 h-3.5 text-indigo-400 ${testState?.loading ? 'animate-spin' : ''}`} />
                          <span>연결 테스트</span>
                        </button>

                        {testState?.msg && (
                          <span className={`text-[11px] font-mono truncate max-w-xs ${testState.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {testState.msg}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
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
                <button
                  type="button"
                  onClick={loadWorkerStatus}
                  className="p-1 rounded-md text-slate-400 hover:text-emerald-300 hover:bg-slate-800 transition-all flex items-center gap-1 text-[11px] cursor-pointer"
                  title="수집 현황 즉시 새로고침"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
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
              <div className="p-2 rounded-xl bg-slate-900/60 dark:bg-slate-950/70 border border-slate-300 dark:border-slate-800/80 shadow-sm">
                <div className="text-[10px] text-neutral-600 dark:text-slate-400 font-semibold">인덱싱된 CR</div>
                <div className="text-xs font-bold text-neutral-900 dark:text-slate-100 mt-0.5">
                  {workerStatus ? `${Math.min(workerStatus.cachedCRs, workerStatus.targetCRsWithFiles || workerStatus.totalCRs)} / ${workerStatus.targetCRsWithFiles || workerStatus.totalCRs}` : '-'}
                </div>
              </div>

              <div className="p-2 rounded-xl bg-slate-900/60 dark:bg-slate-950/70 border border-slate-300 dark:border-slate-800/80 shadow-sm">
                <div className="text-[10px] text-neutral-600 dark:text-slate-400 font-semibold">수집된 소스 파일</div>
                <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">
                  {workerStatus?.totalFiles ? `${workerStatus.totalFiles.toLocaleString()}개` : '0개'}
                </div>
              </div>

              <div className="p-2 rounded-xl bg-slate-900/60 dark:bg-slate-950/70 border border-slate-300 dark:border-slate-800/80 shadow-sm">
                <div className="text-[10px] text-neutral-600 dark:text-slate-400 font-semibold">데이터셋 용량</div>
                <div className="text-xs font-bold text-cyan-700 dark:text-cyan-300 mt-0.5">
                  {workerStatus?.totalSizeFormatted || '0 B'}
                </div>
              </div>

              <div className="p-2 rounded-xl bg-slate-900/60 dark:bg-slate-950/70 border border-slate-300 dark:border-slate-800/80 shadow-sm">
                <div className="text-[10px] text-neutral-600 dark:text-slate-400 font-semibold">남은 대상</div>
                <div className="text-xs font-bold text-amber-700 dark:text-amber-300 mt-0.5">
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
