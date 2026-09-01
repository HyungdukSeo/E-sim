import React, { useState, useRef } from 'react';
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
  Zap
} from 'lucide-react';
import { AppSettings, SyncMeta } from '../types/cr';
import { testSSH } from '../services/api';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(form);
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
              <h2 className="text-base font-bold text-white">환경 설정 & 데이터베이스 이식 관리</h2>
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
            <p className="text-slate-500 text-[11px]">
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { key: 'local', label: '로컬 NLP (기본)' },
                  { key: 'ollama', label: '로컬 Ollama' },
                  { key: 'openai', label: 'OpenAI (GPT)' },
                  { key: 'gemini', label: 'Google Gemini' }
                ].map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, ai: { ...f.ai, provider: item.key as any } }))}
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

            {form.ai.provider === 'ollama' && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-slate-400 mb-1">Ollama 엔드포인트 URL</label>
                  <input
                    type="text"
                    value={form.ai.ollamaUrl}
                    onChange={e => setForm(f => ({ ...f, ai: { ...f.ai, ollamaUrl: e.target.value } }))}
                    placeholder="http://localhost:11434"
                    className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">모델 이름</label>
                  <input
                    type="text"
                    value={form.ai.model}
                    onChange={e => setForm(f => ({ ...f, ai: { ...f.ai, model: e.target.value } }))}
                    placeholder="llama3, mistral, qwen2.5 등"
                    className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-200 font-mono"
                  />
                </div>
              </div>
            )}

            {(form.ai.provider === 'openai' || form.ai.provider === 'gemini') && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-slate-400 mb-1">API Key</label>
                  <input
                    type="password"
                    value={form.ai.apiKey}
                    onChange={e => setForm(f => ({ ...f, ai: { ...f.ai, apiKey: e.target.value } }))}
                    placeholder="sk-... 또는 AIzaSy..."
                    className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">모델명 (선택사항)</label>
                  <input
                    type="text"
                    value={form.ai.model}
                    onChange={e => setForm(f => ({ ...f, ai: { ...f.ai, model: e.target.value } }))}
                    placeholder={form.ai.provider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash'}
                    className="w-full px-3 py-2 bg-slate-950 rounded-xl border border-slate-700 text-slate-200 font-mono"
                  />
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
              <span className="text-[10px] text-slate-500 font-mono">
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
