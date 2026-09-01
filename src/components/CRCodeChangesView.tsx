import React, { useState } from 'react';
import { 
  FileCode, 
  AlertTriangle, 
  CheckCircle2, 
  HelpCircle, 
  Copy, 
  Check, 
  Terminal, 
  Layers, 
  Wrench, 
  Sparkles,
  ExternalLink,
  Code2,
  GitCompare
} from 'lucide-react';
import { CRItem } from '../types/cr';

interface CRCodeChangesViewProps {
  cr: CRItem;
  mantisUrl: string;
  onOpenDiff?: (filePath: string) => void;
}

export const CRCodeChangesView: React.FC<CRCodeChangesViewProps> = ({ cr, mantisUrl }) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const details = cr.details;
  const mantisLink = `${mantisUrl.replace(/\/$/, '')}/view.php?id=${cr.id}`;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  return (
    <div className="space-y-4 text-xs">
      
      {/* 1. Root Cause Analysis (원인 분석) */}
      {details?.cause && details.cause !== '.' && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-amber-300 flex items-center gap-1.5 text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              원인 분석 (Root Cause Analysis)
            </h4>
            <button
              onClick={() => handleCopy(details.cause!, 'cause')}
              className="text-amber-400 hover:text-amber-200 text-[11px] flex items-center gap-1"
            >
              {copiedKey === 'cause' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              복사
            </button>
          </div>
          <p className="text-slate-200 whitespace-pre-wrap leading-relaxed font-sans text-xs bg-slate-950/40 p-3 rounded-xl border border-slate-800">
            {details.cause}
          </p>
        </div>
      )}

      {/* 2. Fix & Patch Description (보완/변경 내역) */}
      {details?.fix && details.fix !== '.' && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-emerald-300 flex items-center gap-1.5 text-xs">
              <Wrench className="w-4 h-4 text-emerald-400" />
              보완 및 변경 내역 (Fix & Patch Description)
            </h4>
            <button
              onClick={() => handleCopy(details.fix!, 'fix')}
              className="text-emerald-400 hover:text-emerald-200 text-[11px] flex items-center gap-1"
            >
              {copiedKey === 'fix' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              복사
            </button>
          </div>
          <p className="text-slate-200 whitespace-pre-wrap leading-relaxed font-sans text-xs bg-slate-950/40 p-3 rounded-xl border border-slate-800">
            {details.fix}
          </p>
        </div>
      )}

      {/* 3. Actual Code Snippets (소스 변경 사항) */}
      {details?.codeChanges && details.codeChanges !== '.' && (
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-mantis-500/30 space-y-2.5 shadow-lg">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-mantis-300 flex items-center gap-1.5 text-xs">
              <Code2 className="w-4 h-4 text-mantis-400" />
              소스 변경 사항 (Code Snippets & Comments)
            </h4>
            <button
              onClick={() => handleCopy(details.codeChanges!, 'codeChanges')}
              className="text-mantis-400 hover:text-mantis-200 text-[11px] flex items-center gap-1"
            >
              {copiedKey === 'codeChanges' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              코드 복사
            </button>
          </div>

          <pre className="p-3.5 rounded-xl bg-slate-950 text-emerald-400/95 font-mono text-[11px] leading-relaxed overflow-x-auto border border-slate-800 whitespace-pre-wrap select-all shadow-inner">
            {details.codeChanges}
          </pre>
        </div>
      )}

      {/* 4. Problem & Requirements (#1.문제점/요구사항) */}
      {details?.problem && details.problem !== '.' && (
        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-200 flex items-center gap-1.5 text-xs">
              <HelpCircle className="w-4 h-4 text-blue-400" />
              문제점 및 요구사항 (Problem & Requirements)
            </h4>
            <button
              onClick={() => handleCopy(details.problem!, 'problem')}
              className="text-slate-400 hover:text-slate-200 text-[11px] flex items-center gap-1"
            >
              {copiedKey === 'problem' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              복사
            </button>
          </div>
          <p className="text-slate-300 whitespace-pre-wrap leading-relaxed font-sans text-xs bg-slate-950/40 p-3 rounded-xl border border-slate-800">
            {details.problem}
          </p>
        </div>
      )}

      {/* 5. Test Procedures & Logs (시험검증절차) */}
      {details?.testProcedure && details.testProcedure !== '.' && (
        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-purple-300 flex items-center gap-1.5 text-xs">
              <CheckCircle2 className="w-4 h-4 text-purple-400" />
              시험 검증 절차 및 패치 전/후 로그
            </h4>
            <button
              onClick={() => handleCopy(details.testProcedure!, 'testProcedure')}
              className="text-purple-400 hover:text-purple-200 text-[11px] flex items-center gap-1"
            >
              {copiedKey === 'testProcedure' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              로그 복사
            </button>
          </div>
          <pre className="p-3.5 rounded-xl bg-slate-950 text-slate-300 font-mono text-[10px] leading-relaxed overflow-x-auto border border-slate-800 whitespace-pre-wrap select-all">
            {details.testProcedure}
          </pre>
        </div>
      )}

      {/* Fallback info when details are empty */}
      {!details?.cause && !details?.fix && !details?.codeChanges && !details?.problem && (
        <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-3">
          <FileCode className="w-8 h-8 text-slate-600 mx-auto" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-300">
              Mantis 본문 추가 상세 필드를 불러오는 중이거나 기재되어 있지 않습니다.
            </p>
            <p className="text-[11px] text-slate-500">
              상단 'Mantis 웹 원본 보기' 버튼을 클릭하시면 Mantis 웹페이지의 모든 코멘트와 첨부파일을 직접 확인하실 수 있습니다.
            </p>
          </div>
          <a
            href={mantisLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-mantis-300 text-xs font-semibold transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Mantis 원본 페이지 열기
          </a>
        </div>
      )}

    </div>
  );
};
