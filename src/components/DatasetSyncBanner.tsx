import React from 'react';
import { Zap, Play, Pause, Settings, FileText, CheckCircle2 } from 'lucide-react';
import { DiffWorkerStatus, DiffTaskProgress } from '../services/api';

interface DatasetSyncBannerProps {
  workerStatus: DiffWorkerStatus | null;
  onToggleWorker?: () => void;
  onOpenSettings?: () => void;
}

export const DatasetSyncBanner: React.FC<DatasetSyncBannerProps> = ({
  workerStatus,
  onToggleWorker,
  onOpenSettings
}) => {
  if (!workerStatus) return null;

  const isRunning = workerStatus.status === 'running' || (workerStatus.activeTasks && workerStatus.activeTasks.length > 0);
  const isPaused = workerStatus.status === 'paused' || (!workerStatus.enabled && workerStatus.status !== 'completed');
  
  // Don't render banner if fully completed and not active, or disabled without active tasks
  if (!isRunning && !isPaused && workerStatus.status !== 'waiting_ssh') {
    return null;
  }

  const activeTasks: DiffTaskProgress[] = workerStatus.activeTasks || [];
  const percent = Math.min(100, Math.max(0, workerStatus.percentage ?? 0));

  return (
    <div className="sticky top-[61px] z-20 w-full bg-slate-950/95 dark:bg-slate-950/95 bg-opacity-95 backdrop-blur-md border-b border-emerald-500/30 dark:border-emerald-500/20 shadow-md transition-all animate-fadeIn">
      <div className="max-w-[1700px] mx-auto px-4 lg:px-6 py-2 flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5">
        
        {/* Left: Overall Status & Percentage */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              {isRunning && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isRunning ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
            </span>
            <span className="text-xs font-bold flex items-center gap-1.5 text-emerald-400">
              <Zap className="w-3.5 h-3.5" />
              {isRunning ? '데이터셋 실시간 수집 중' : isPaused ? '데이터셋 수집 일시정지됨' : 'ClearCase SSH 연결 대기 중'}
            </span>
          </div>

          <div className="flex items-center gap-2 pl-2 border-l border-slate-800 text-xs">
            <span className="text-slate-400">전체 완성률</span>
            <span className="font-mono font-bold text-emerald-400 text-xs">{percent}%</span>
            <span className="text-slate-500 font-mono text-[11px]">
              ({workerStatus.cachedCRs} / {workerStatus.targetCRsWithFiles || workerStatus.totalCRs} CR)
            </span>
          </div>
        </div>

        {/* Center: Real-time Active Tasks (Which CR, Which File, N / M) */}
        <div className="flex-1 w-full md:w-auto overflow-x-auto scrollbar-thin py-0.5">
          {activeTasks.length > 0 ? (
            <div className="flex items-center gap-2">
              {activeTasks.map((task) => {
                const filePercent = task.totalFiles > 0 
                  ? Math.min(100, Math.round((task.fileIndex / task.totalFiles) * 100))
                  : 0;

                return (
                  <div
                    key={task.crid}
                    className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-900/90 border border-emerald-500/30 text-xs text-slate-200 shadow-sm shrink-0 transition-all hover:border-emerald-400/50"
                    title={`전체 경로: ${task.filePath || task.currentFile}`}
                  >
                    <span className="font-mono font-bold text-mantis-400 shrink-0">
                      #{task.crid}
                    </span>
                    
                    <span className="text-slate-600">•</span>
                    
                    <span className="flex items-center gap-1 font-medium text-slate-300 max-w-[160px] sm:max-w-[200px] truncate" title={task.currentFile}>
                      <FileText className="w-3 h-3 text-cyan-400 shrink-0" />
                      <span className="truncate">{task.currentFile || '준비 중...'}</span>
                    </span>

                    <span className="text-slate-600">•</span>

                    <span className="font-mono text-emerald-400 font-semibold shrink-0 text-[11px]">
                      {task.fileIndex} / {task.totalFiles}개
                    </span>

                    {/* Mini Progress Bar */}
                    <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden shrink-0 border border-slate-700/50">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full transition-all duration-300"
                        style={{ width: `${filePercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-slate-400 flex items-center gap-1.5 py-0.5">
              {isRunning ? (
                <span>워커 디스패치 준비 중...</span>
              ) : (
                <span>수집 일시정지 상태입니다. 재개 버튼을 누르면 이어서 수집합니다.</span>
              )}
            </div>
          )}
        </div>

        {/* Right: Quick Action Controls */}
        <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
          {onToggleWorker && (
            <button
              onClick={onToggleWorker}
              className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all border ${
                workerStatus.enabled
                  ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
              }`}
              title={workerStatus.enabled ? '자동 수집 일시정지' : '자동 수집 재개'}
            >
              {workerStatus.enabled ? (
                <>
                  <Pause className="w-3 h-3" />
                  <span>일시정지</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" />
                  <span>수집 재개</span>
                </>
              )}
            </button>
          )}

          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1 transition-colors border border-slate-700/60"
              title="Diff 데이터셋 설정 열기"
            >
              <Settings className="w-3 h-3" />
              <span>설정</span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
