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
  GitCompare,
  Paperclip,
  Download,
  Eye,
  ImageIcon,
  FileArchive,
  FileText
} from 'lucide-react';
import { CRItem, AttachmentItem } from '../types/cr';
import { copyToClipboard } from '../utils/clipboard';
import { getAttachmentViewUrl, getAttachmentDownloadUrl } from '../services/api';
import { ImagePreviewModal } from './ImagePreviewModal';

interface CRCodeChangesViewProps {
  cr: CRItem;
  mantisUrl: string;
  onOpenDiff?: (filePath: string) => void;
}

export const CRCodeChangesView: React.FC<CRCodeChangesViewProps> = ({ cr, mantisUrl }) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<AttachmentItem | null>(null);

  const details = cr.details;
  const mantisLink = `${mantisUrl.replace(/\/$/, '')}/view.php?id=${cr.id}`;

  const handleCopy = async (text: string, key: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    }
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

      {/* 6. Attachments (첨부 파일) */}
      {details?.attachments && details.attachments.length > 0 && (
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-700/60 space-y-3 shadow-lg">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-100 flex items-center gap-1.5 text-xs">
              <Paperclip className="w-4 h-4 text-mantis-400" />
              첨부 파일 (Attachments)
              <span className="px-2 py-0.5 rounded-full bg-mantis-500/20 text-mantis-300 border border-mantis-500/30 text-[10px] font-bold">
                {details.attachments.length}개
              </span>
            </h4>
            <span className="text-[11px] text-slate-400">
              이미지 클릭 시 확대 미리보기 가능
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {details.attachments.map((att) => {
              const viewUrl = getAttachmentViewUrl(att.id, mantisUrl);
              const downloadUrl = getAttachmentDownloadUrl(att.id, att.filename, mantisUrl);
              const originalMantisUrl = `${mantisUrl.replace(/\/$/, '')}/file_download.php?file_id=${att.id}&type=bug`;

              return (
                <div
                  key={att.id}
                  className="group relative flex flex-col justify-between rounded-xl bg-slate-950/70 border border-slate-800/80 hover:border-mantis-500/40 p-3 transition-all hover:shadow-md space-y-2.5"
                >
                  {/* Image Preview Thumbnail if image */}
                  {att.isImage && (
                    <div 
                      onClick={() => setSelectedImage(att)}
                      className="relative w-full h-36 rounded-lg bg-slate-900/90 border border-slate-800 overflow-hidden cursor-pointer flex items-center justify-center group/img"
                    >
                      <img 
                        src={viewUrl} 
                        alt={att.filename}
                        loading="lazy"
                        className="w-full h-full object-contain transition-transform duration-200 group-hover/img:scale-105"
                      />
                      <div className="absolute inset-0 bg-slate-950/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-semibold backdrop-blur-[2px]">
                        <Eye className="w-4 h-4 text-mantis-300" />
                        <span>확대 미리보기</span>
                      </div>
                    </div>
                  )}

                  {/* File Info */}
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-slate-800/90 border border-slate-700/50 flex items-center justify-center text-slate-300 shrink-0">
                        {att.isImage ? (
                          <ImageIcon className="w-4 h-4 text-mantis-400" />
                        ) : ['zip', 'tar', 'gz', 'tgz', 'rar', '7z'].includes(att.extension) ? (
                          <FileArchive className="w-4 h-4 text-amber-400" />
                        ) : (
                          <FileText className="w-4 h-4 text-blue-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate" title={att.filename}>
                          {att.filename}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                          {att.size && <span>{att.size}</span>}
                          {att.date && <span>• {att.date}</span>}
                        </div>
                      </div>
                    </div>

                    <span className="uppercase text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50 shrink-0">
                      {att.extension || 'FILE'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800/60">
                    {att.isImage && (
                      <button
                        onClick={() => setSelectedImage(att)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5 text-mantis-400" />
                        미리보기
                      </button>
                    )}
                    <a
                      href={downloadUrl}
                      download={att.filename}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-mantis-600 hover:bg-mantis-500 text-slate-950 text-[11px] font-bold transition-colors shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" />
                      다운로드
                    </a>
                    <a
                      href={originalMantisUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-mantis-300 transition-colors"
                      title="Mantis 웹 원본 링크"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Fallback info when details are empty */}
      {!details?.cause && !details?.fix && !details?.codeChanges && !details?.problem && (!details?.attachments || details.attachments.length === 0) && (
        <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-3">
          <FileCode className="w-8 h-8 text-slate-600 mx-auto" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-300">
              Mantis 본문 추가 상세 필드를 불러오는 중이거나 기재되어 있지 않습니다.
            </p>
            <p className="text-[11px] text-main0">
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

      {/* Image Preview Modal */}
      <ImagePreviewModal
        isOpen={!!selectedImage}
        onClose={() => setSelectedImage(null)}
        attachment={selectedImage}
        mantisUrl={mantisUrl}
      />

    </div>
  );
};
