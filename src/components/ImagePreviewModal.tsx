import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  Download, 
  ExternalLink, 
  ImageIcon,
  Loader2,
  AlertTriangle
} from 'lucide-react';
import { AttachmentItem } from '../types/cr';
import { getAttachmentViewUrl, getAttachmentDownloadUrl } from '../services/api';

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  attachment: AttachmentItem | null;
  mantisUrl: string;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  isOpen,
  onClose,
  attachment,
  mantisUrl
}) => {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Reset controls when attachment changes
  useEffect(() => {
    if (isOpen) {
      setZoom(1);
      setRotation(0);
      setLoading(true);
      setError(false);
    }
  }, [isOpen, attachment?.id]);

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        setZoom(prev => Math.min(prev + 0.25, 4));
      } else if (e.key === '-' || e.key === '_') {
        setZoom(prev => Math.max(prev - 0.25, 0.25));
      } else if (e.key === '0') {
        setZoom(1);
        setRotation(0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !attachment) return null;

  const viewUrl = getAttachmentViewUrl(attachment.id, mantisUrl);
  const downloadUrl = getAttachmentDownloadUrl(attachment.id, attachment.filename, mantisUrl);
  const originalMantisUrl = `${mantisUrl.replace(/\/$/, '')}/file_download.php?file_id=${attachment.id}&type=bug`;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950/90 backdrop-blur-md animate-fadeIn">
      {/* Top Header Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/80 bg-slate-900/90 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-mantis-500/20 border border-mantis-500/30 flex items-center justify-center text-mantis-400 shrink-0">
            <ImageIcon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-slate-100 truncate" title={attachment.filename}>
              {attachment.filename}
            </h3>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              {attachment.size && <span>{attachment.size}</span>}
              {attachment.date && <span>• {attachment.date}</span>}
              <span>• {Math.round(zoom * 100)}%</span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setZoom(prev => Math.max(prev - 0.25, 0.25))}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="축소 (-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-mono transition-colors"
            title="원래 크기 (100%)"
          >
            100%
          </button>
          <button
            onClick={() => setZoom(prev => Math.min(prev + 0.25, 4))}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="확대 (+)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setRotation(prev => (prev + 90) % 360)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="90° 회전"
          >
            <RotateCw className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-slate-800 mx-1" />

          {/* Download */}
          <a
            href={downloadUrl}
            download={attachment.filename}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mantis-600 hover:bg-mantis-500 text-slate-950 font-bold text-xs transition-colors shadow-sm"
            title="로컬로 파일 다운로드"
          >
            <Download className="w-3.5 h-3.5" />
            다운로드
          </a>

          {/* External Mantis Link */}
          <a
            href={originalMantisUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-mantis-400 transition-colors"
            title="Mantis 웹에서 원본 열기"
          >
            <ExternalLink className="w-4 h-4" />
          </a>

          {/* Close */}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 transition-colors ml-1"
            title="닫기 (ESC)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Image Stage */}
      <div 
        className="flex-1 min-h-0 flex items-center justify-center p-6 overflow-auto select-none"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {loading && !error && (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-mantis-400" />
            <span className="text-xs">이미지를 불러오는 중입니다...</span>
          </div>
        )}

        {error ? (
          <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-center space-y-3 max-w-md">
            <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-rose-300">이미지를 표시할 수 없습니다</h4>
              <p className="text-[11px] text-slate-400">
                사내망 연결 상태(VPN/Mantis 서버)를 확인하거나 아래 다운로드 링크를 이용해주세요.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <a
                href={downloadUrl}
                download={attachment.filename}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                직접 다운로드
              </a>
              <a
                href={originalMantisUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Mantis 웹에서 열기
              </a>
            </div>
          </div>
        ) : (
          <img
            src={viewUrl}
            alt={attachment.filename}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              transformOrigin: 'center center',
              transition: 'transform 0.15s ease-out'
            }}
            className={`max-w-full max-h-[82vh] object-contain rounded-lg shadow-2xl border border-slate-800/80 cursor-grab active:cursor-grabbing ${loading ? 'hidden' : 'block'}`}
          />
        )}
      </div>
    </div>,
    document.body
  );
};
