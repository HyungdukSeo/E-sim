import React from 'react';
import { Sparkles, ArrowRight, FileCode, CheckCircle2 } from 'lucide-react';
import { CRItem } from '../types/cr';

interface SimilarCRsProps {
  currentCR: CRItem;
  allCrs: CRItem[];
  onSelectCR: (cr: CRItem) => void;
}

export const SimilarCRs: React.FC<SimilarCRsProps> = ({
  currentCR,
  allCrs,
  onSelectCR
}) => {
  // Score similar CRs based on module, customer, vob, and shared files
  const similarItems = React.useMemo(() => {
    return allCrs
      .filter(c => c.crid !== currentCR.crid)
      .map(c => {
        let score = 0;
        const sharedFiles: string[] = [];

        // Same Module
        if (currentCR.module && c.module && currentCR.module.toLowerCase() === c.module.toLowerCase()) {
          score += 35;
        }

        // Shared Modified Files
        if (currentCR.files && c.files && currentCR.files.length > 0) {
          const common = currentCR.files.filter(f => c.files?.includes(f));
          if (common.length > 0) {
            score += common.length * 40;
            sharedFiles.push(...common);
          }
        }

        // Same Customer
        if (currentCR.customer && c.customer && currentCR.customer === c.customer) {
          score += 10;
        }

        // Same VOB
        if (currentCR.vob && c.vob && currentCR.vob === c.vob) {
          score += 15;
        }

        // Same Reporter
        if (currentCR.reporter && c.reporter === currentCR.reporter) {
          score += 5;
        }

        return { cr: c, score, sharedFiles };
      })
      .filter(item => item.score >= 25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [currentCR, allCrs]);

  if (similarItems.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2.5 pt-4 border-t border-slate-800">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-mantis-400" />
          연관/유사 CR 추천 ({similarItems.length}건)
        </h4>
        <span className="text-[10px] text-slate-500">동일 모듈 및 수정 소스파일 기반</span>
      </div>

      <div className="space-y-1.5">
        {similarItems.map(({ cr, score, sharedFiles }) => (
          <div
            key={cr.crid}
            onClick={() => onSelectCR(cr)}
            className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-mantis-500/40 cursor-pointer transition-all flex items-center justify-between gap-3 group"
          >
            <div className="space-y-1 truncate">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono font-bold text-mantis-400">#{cr.crid}</span>
                <span className="text-slate-400 truncate max-w-[280px] font-medium text-[11px] group-hover:text-white">
                  {cr.cleanSummary || cr.summary}
                </span>
              </div>

              {/* Shared files badge */}
              {sharedFiles.length > 0 && (
                <div className="flex items-center gap-1 text-[10px] text-indigo-300">
                  <FileCode className="w-2.5 h-2.5 text-indigo-400" />
                  <span>공통 파일: <code className="text-slate-300 font-mono">{sharedFiles.slice(0, 2).join(', ')}</code>{sharedFiles.length > 2 ? ` 외 ${sharedFiles.length - 2}개` : ''}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                {cr.status}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-mantis-400 group-hover:translate-x-0.5 transition-all" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
