import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  ExternalLink,
  RefreshCw,
  Copy,
  Check,
  GitBranch,
  Server,
  Zap,
  User,
  Calendar,
  Clock,
  History,
  ArrowRight,
  Layers,
  FileCode2,
  Network,
  Package,
  Paperclip,
  Download,
  FileText,
  AlertTriangle,
  MapPin,
  Cpu,
  Boxes,
  Hash
} from 'lucide-react';
import { CRItem, AttachmentItem } from '../types/cr';
import { fetchCRDetail, getAttachmentDownloadUrl } from '../services/api';
import { copyToClipboard } from '../utils/clipboard';
import { getRecordKind, getVobCreationTarget, getPackageTargetVob, parseVobCreationTitle, formatRecordId, RecordKind } from '../utils/vobUtils';

interface RecordDetailViewProps {
  cr: CRItem;
  allCrs: CRItem[];
  mantisUrl: string;
  isSplitView?: boolean;
  onClose: () => void;
  onSelectCR: (cr: CRItem) => void;
  onUpdateCR?: (updated: CRItem) => void;
  onOpenVobHistory?: (vob: string) => void;
  onOpenVobTree?: (vob: string) => void;
}

/**
 * Detail view for Mantis records that share the CR number space but are not
 * change requests — VOB 생성 / Package 제작 / 장애내역. They have no Check-in
 * Log, no source diff and no AI diff analysis, so the CR tabs make no sense
 * for them; each kind gets its own body built from the project's custom fields.
 */
export const RecordDetailView: React.FC<RecordDetailViewProps> = ({
  cr,
  allCrs,
  mantisUrl,
  isSplitView = false,
  onClose,
  onSelectCR,
  onUpdateCR,
  onOpenVobHistory,
  onOpenVobTree
}) => {
  const [current, setCurrent] = useState<CRItem>(cr);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const autoFetchedCridRef = useRef<string | null>(null);

  const kind = getRecordKind(current);

  // Fetch the project's custom fields once per opened record when missing.
  // Same stale-response guard as CRDetailModal: never re-fetch just because
  // onUpdateCR handed back a new object, and ignore results after close.
  useEffect(() => {
    setCurrent(cr);
    const k = getRecordKind(cr);
    const hasFields =
      (k === 'vob' && !!cr.details?.vobCreation) ||
      (k === 'package' && !!cr.details?.packageInfo) ||
      (k === 'report' && cr.detailsFetched && Array.isArray(cr.details?.attachments));
    if (hasFields || autoFetchedCridRef.current === cr.crid) return;
    autoFetchedCridRef.current = cr.crid;
    let cancelled = false;
    setLoading(true);
    fetchCRDetail(cr.crid, mantisUrl)
      .then(res => {
        if (cancelled || !res?.cr) return;
        setCurrent(res.cr);
        onUpdateCR?.(res.cr);
      })
      .catch(err => console.warn('Failed to fetch record details:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cr, mantisUrl]);

  const handleRefresh = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetchCRDetail(current.crid, mantisUrl, { refresh: true });
      if (res?.cr) {
        setCurrent(res.cr);
        onUpdateCR?.(res.cr);
      }
    } catch (err) {
      console.warn('Failed to refresh record:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (text: string, key: string) => {
    if (await copyToClipboard(text)) {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    }
  };

  const title = parseVobCreationTitle(current.summary);
  const targetVob = kind === 'vob' ? getVobCreationTarget(current) : kind === 'package' ? getPackageTargetVob(current) : '';
  const customer = kind === 'report' ? '' : title.customer || current.customer || '';
  const mantisLink = `${mantisUrl.replace(/\/$/, '')}/view.php?id=${current.id}`;

  const kindMeta: Record<RecordKind, { label: string; icon: React.ReactNode; chip: string; headline: string }> = {
    vob: { label: 'VOB 생성', icon: <GitBranch className="w-3 h-3" />, chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', headline: 'text-teal-300' },
    package: { label: 'Package 제작', icon: <Package className="w-3 h-3" />, chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30', headline: 'text-amber-200' },
    report: { label: '장애내역', icon: <AlertTriangle className="w-3 h-3" />, chip: 'bg-rose-500/15 text-rose-300 border-rose-500/30', headline: 'text-rose-200' },
    cr: { label: 'CR', icon: <FileCode2 className="w-3 h-3" />, chip: 'bg-slate-800 text-slate-300 border-slate-700', headline: 'text-slate-100' }
  };
  const meta = kindMeta[kind];
  const headline = kind === 'report' ? current.summary : targetVob || '(VOB 이름 미확인)';

  // Real CRs checked into this VOB (excludes other non-CR records).
  const relatedCrs = useMemo(() => {
    if (!targetVob) return [];
    const upper = targetVob.toUpperCase();
    return allCrs
      .filter(c => c.crid !== current.crid && getRecordKind(c) === 'cr' && (c.vob || '').toUpperCase() === upper)
      .sort((a, b) => (b.dateSubmitted || '').localeCompare(a.dateSubmitted || ''));
  }, [allCrs, targetVob, current.crid]);

  const openVobHistory = (vob?: string) => {
    if (vob && onOpenVobHistory) onOpenVobHistory(vob);
  };

  const content = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/90 flex items-start justify-between gap-3 flex-shrink-0">
        <div className="space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-0.5 rounded-md border text-xs font-bold flex items-center gap-1 ${meta.chip}`}>
              {meta.icon} {meta.label}
            </span>
            <span className="font-mono text-xs text-slate-400">{formatRecordId(current)}</span>
            {title.stage && kind !== 'report' && (
              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-semibold">
                {title.stage}
              </span>
            )}
            {customer && (
              <span className="px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/30 text-xs font-bold">
                {customer}
              </span>
            )}
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 text-[11px] font-semibold uppercase">
              {current.status}
            </span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <h2 className={`${kind === 'report' ? 'text-base sm:text-lg' : 'text-xl sm:text-2xl font-mono'} font-extrabold truncate ${meta.headline}`}>
              {headline}
            </h2>
            {targetVob && (
              <button
                onClick={() => handleCopy(targetVob, 'vob')}
                className="p-1 rounded-md hover:bg-slate-800 text-slate-500 hover:text-slate-200 transition-colors"
                title="VOB 이름 복사"
              >
                {copied === 'vob' ? <Check className="w-3.5 h-3.5 text-mantis-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
          {kind !== 'report' && (
            <p className="text-sm text-main leading-snug break-words">{title.cleanSummary || current.summary}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition-colors disabled:opacity-50"
            title="Mantis 서버에서 이 항목을 다시 조회합니다"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-mantis-400 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Mantis 갱신</span>
          </button>
          <a
            href={mantisLink}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-mantis-400 transition-colors"
            title="Mantis 원본 페이지 열기"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          {!isSplitView && (
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
        {kind === 'vob' && (
          <VobCreationBody
            cr={current}
            loading={loading}
            targetVob={targetVob}
            onOpenVobHistory={openVobHistory}
            onOpenVobTree={onOpenVobTree}
          />
        )}
        {kind === 'package' && (
          <PackageBody
            cr={current}
            allCrs={allCrs}
            loading={loading}
            targetVob={targetVob}
            onSelectCR={onSelectCR}
            onOpenVobHistory={openVobHistory}
          />
        )}
        {kind === 'report' && <ReportBody cr={current} loading={loading} />}

        {/* Attachments (any kind) */}
        {current.details?.attachments && current.details.attachments.length > 0 && (
          <AttachmentList attachments={current.details.attachments} mantisUrl={mantisUrl} />
        )}

        {/* CRs applied to this VOB (vob / package) */}
        {targetVob && (
          <section className="space-y-2">
            <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <FileCode2 className="w-3.5 h-3.5 text-mantis-400" /> 이 VOB에 적용된 CR
              <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-mono">{relatedCrs.length}</span>
            </h3>
            {relatedCrs.length > 0 ? (
              <ul className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
                {relatedCrs.slice(0, 12).map(c => (
                  <li key={c.crid}>
                    <button
                      onClick={() => onSelectCR(c)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-800/60 transition-colors flex items-center gap-3 text-xs"
                    >
                      <span className="font-mono text-mantis-400 font-bold shrink-0">#{c.crid}</span>
                      <span className="truncate text-slate-200 flex-1">{c.cleanSummary || c.summary}</span>
                      <span className="font-mono text-main0 shrink-0 hidden sm:inline">{c.dateSubmitted}</span>
                      {c.filePaths?.length ? (
                        <span className="shrink-0 px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">{c.filePaths.length} files</span>
                      ) : null}
                    </button>
                  </li>
                ))}
                {relatedCrs.length > 12 && (
                  <li className="px-3 py-2 text-[11px] text-main0 text-center">외 {relatedCrs.length - 12}건 — VOB 변경 이력에서 전체 확인</li>
                )}
              </ul>
            ) : (
              <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 text-center text-xs text-main0">
                이 VOB를 적용 VOB로 가진 CR이 아직 없습니다.
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );

  if (isSplitView) {
    return <div className="h-full glass-panel rounded-2xl border border-slate-800 overflow-hidden">{content}</div>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150">
      <div
        className="w-full max-w-3xl max-h-[90vh] glass-panel rounded-3xl border border-slate-700/80 shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {content}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* VOB 생성                                                            */
/* ------------------------------------------------------------------ */

const VobCreationBody: React.FC<{
  cr: CRItem;
  loading: boolean;
  targetVob: string;
  onOpenVobHistory: (vob?: string) => void;
  onOpenVobTree?: (vob: string) => void;
}> = ({ cr, loading, targetVob, onOpenVobHistory, onOpenVobTree }) => {
  const info = cr.details?.vobCreation;
  const baseVob = info?.baseVob || '';

  return (
    <>
      {/* Base -> Target */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => onOpenVobHistory(baseVob)}
          disabled={!baseVob}
          className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 font-mono text-sm text-slate-200 hover:border-mantis-500/50 hover:text-mantis-300 transition-colors disabled:opacity-60 disabled:cursor-default"
          title={baseVob ? `${baseVob} 변경 이력 보기` : '기준 VOB 정보 없음'}
        >
          <span className="block text-[10px] text-main0 font-sans mb-0.5">기준 VOB</span>
          {baseVob || (loading ? '조회 중...' : '-')}
        </button>
        <ArrowRight className="w-5 h-5 text-emerald-400 shrink-0" />
        <button
          onClick={() => onOpenVobHistory(targetVob)}
          disabled={!targetVob}
          className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/40 font-mono text-sm text-emerald-200 hover:bg-emerald-500/20 transition-colors disabled:opacity-60 disabled:cursor-default"
          title={targetVob ? `${targetVob} 변경 이력 보기` : ''}
        >
          <span className="block text-[10px] text-main0 font-sans mb-0.5">생성 VOB</span>
          {targetVob || '-'}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <MetaCell icon={<Server className="w-3 h-3" />} label="생성 위치 (개발서버)" value={info?.location} mono />
        <MetaCell icon={<Zap className="w-3 h-3" />} label="Trigger 설정" value={info?.trigger ? (info.trigger.toUpperCase() === 'O' ? '설정됨 (O)' : info.trigger) : ''} />
        <MetaCell icon={<User className="w-3 h-3" />} label="보고자" value={cr.reporter} />
        <MetaCell icon={<User className="w-3 h-3" />} label="담당자" value={cr.assignee} />
        <MetaCell icon={<Calendar className="w-3 h-3" />} label="생성 요청일" value={cr.dateSubmitted} mono />
        <MetaCell icon={<Clock className="w-3 h-3" />} label="최종 갱신" value={cr.lastUpdated} mono />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onOpenVobHistory(targetVob)}
          disabled={!targetVob}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-mantis-500/15 hover:bg-mantis-500/25 border border-mantis-500/30 text-mantis-300 text-xs font-semibold transition-colors disabled:opacity-50"
        >
          <History className="w-3.5 h-3.5" /> VOB 변경 이력
        </button>
        <button
          onClick={() => targetVob && onOpenVobTree?.(targetVob)}
          disabled={!targetVob || !onOpenVobTree}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors disabled:opacity-50"
        >
          <Network className="w-3.5 h-3.5" /> 계보 트리에서 보기
        </button>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
          <History className="w-3.5 h-3.5 text-mantis-400" /> VOB 계보 History
          {info?.history?.length ? (
            <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-mono">{info.history.length}</span>
          ) : null}
        </h3>
        {info?.history?.length ? (
          <ol className="relative border-l border-slate-800 ml-2 space-y-2">
            {info.history.map((step, idx) => (
              <li key={`${step.raw}-${idx}`} className="ml-4 relative">
                <span className={`absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full border ${idx === 0 ? 'bg-emerald-400 border-emerald-300' : 'bg-slate-800 border-slate-600'}`} />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span className="font-mono text-main0 w-[80px] shrink-0">{step.date}</span>
                  <button onClick={() => onOpenVobHistory(step.from)} className="font-mono text-slate-300 hover:text-mantis-300 transition-colors">
                    {step.from}
                  </button>
                  <ArrowRight className="w-3 h-3 text-slate-500" />
                  <button
                    onClick={() => onOpenVobHistory(step.to)}
                    className={`font-mono transition-colors ${idx === 0 ? 'text-emerald-300 font-bold' : 'text-slate-200 hover:text-mantis-300'}`}
                  >
                    {step.to}
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyBox>{loading ? 'Mantis에서 VOB 계보를 불러오는 중...' : 'Mantis 페이지에 [VOB] History 항목이 없습니다.'}</EmptyBox>
        )}
      </section>
    </>
  );
};

/* ------------------------------------------------------------------ */
/* Package 제작                                                        */
/* ------------------------------------------------------------------ */

const PackageBody: React.FC<{
  cr: CRItem;
  allCrs: CRItem[];
  loading: boolean;
  targetVob: string;
  onSelectCR: (cr: CRItem) => void;
  onOpenVobHistory: (vob?: string) => void;
}> = ({ cr, allCrs, loading, targetVob, onSelectCR, onOpenVobHistory }) => {
  const info = cr.details?.packageInfo;
  const relatedByNumber = useMemo(
    () => (info?.relatedCrids || []).map(crid => allCrs.find(c => c.crid === crid) || null),
    [info?.relatedCrids, allCrs]
  );

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <MetaCell
          icon={<Layers className="w-3 h-3" />}
          label="대상 VOB"
          value={targetVob}
          mono
          onClick={targetVob ? () => onOpenVobHistory(targetVob) : undefined}
        />
        <MetaCell icon={<Boxes className="w-3 h-3" />} label="Type" value={info?.type} />
        <MetaCell icon={<Package className="w-3 h-3" />} label="제품 / 용도" value={[info?.product, info?.purpose].filter(Boolean).join(' · ')} />
        <MetaCell icon={<MapPin className="w-3 h-3" />} label="적용예정 SITE" value={info?.site} />
        <MetaCell icon={<Cpu className="w-3 h-3" />} label="OS Type" value={info?.osType} />
        <MetaCell icon={<Calendar className="w-3 h-3" />} label="제작기한" value={info?.dueDate} mono />
        <MetaCell icon={<Boxes className="w-3 h-3" />} label="변경 lib/blk" value={info?.changedBlocks} />
        <MetaCell icon={<Hash className="w-3 h-3" />} label="시험의뢰 / 완료번호" value={[info?.testRequestNo, info?.testCompleteNo].filter(Boolean).join(' / ')} mono />
        <MetaCell icon={<User className="w-3 h-3" />} label="요청자 → 담당자" value={[cr.reporter, cr.assignee].filter(Boolean).join(' → ')} />
        <MetaCell icon={<Calendar className="w-3 h-3" />} label="요청일" value={cr.dateSubmitted} mono />
        <MetaCell icon={<Clock className="w-3 h-3" />} label="최종 갱신" value={cr.lastUpdated} mono />
      </div>

      {info?.relatedCrids?.length ? (
        <section className="space-y-2">
          <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <Hash className="w-3.5 h-3.5 text-mantis-400" /> 관련 CR번호
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {info.relatedCrids.map((crid, i) => {
              const target = relatedByNumber[i];
              return (
                <button
                  key={crid}
                  onClick={() => target && onSelectCR(target)}
                  disabled={!target}
                  className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 font-mono text-xs text-mantis-300 hover:border-mantis-500/50 transition-colors disabled:opacity-50 disabled:text-slate-400"
                  title={target ? target.summary : '로컬 DB에 없는 CR'}
                >
                  #{crid}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <TextBlock icon={<FileText className="w-3.5 h-3.5 text-mantis-400" />} title="제작요청사항" text={info?.request} loading={loading} />
      <TextBlock icon={<Check className="w-3.5 h-3.5 text-emerald-400" />} title="제작내역" text={info?.result} loading={loading} />
      <TextBlock icon={<Download className="w-3.5 h-3.5 text-amber-400" />} title="패키지 File" text={info?.files} loading={loading} mono />
    </>
  );
};

/* ------------------------------------------------------------------ */
/* 장애내역                                                            */
/* ------------------------------------------------------------------ */

const ReportBody: React.FC<{ cr: CRItem; loading: boolean }> = ({ cr, loading }) => (
  <>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
      <MetaCell icon={<User className="w-3 h-3" />} label="보고자" value={cr.reporter} />
      <MetaCell icon={<User className="w-3 h-3" />} label="담당자" value={cr.assignee} />
      <MetaCell icon={<Calendar className="w-3 h-3" />} label="보고일" value={cr.dateSubmitted} mono />
      <MetaCell icon={<Clock className="w-3 h-3" />} label="최종 갱신" value={cr.lastUpdated} mono />
    </div>
    <TextBlock icon={<FileText className="w-3.5 h-3.5 text-mantis-400" />} title="내용" text={cr.description || cr.details?.problem} loading={loading} />
    {!cr.description && !cr.details?.problem && !cr.details?.attachments?.length && !loading && (
      <EmptyBox>본문이 없습니다. 첨부된 장애현황 파일은 Mantis 원본 페이지에서 확인하세요.</EmptyBox>
    )}
  </>
);

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

const AttachmentList: React.FC<{ attachments: AttachmentItem[]; mantisUrl: string }> = ({ attachments, mantisUrl }) => (
  <section className="space-y-2">
    <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
      <Paperclip className="w-3.5 h-3.5 text-mantis-400" /> 첨부 파일
      <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-mono">{attachments.length}</span>
    </h3>
    <ul className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      {attachments.map(att => (
        <li key={att.id} className="px-3 py-2 flex items-center gap-3 text-xs">
          <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate text-slate-200 flex-1" title={att.filename}>{att.filename}</span>
          <span className="font-mono text-main0 shrink-0 hidden sm:inline">{att.size}</span>
          <span className="font-mono text-main0 shrink-0 hidden md:inline">{att.date}</span>
          <a
            href={getAttachmentDownloadUrl(att.id, att.filename, mantisUrl)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-mantis-300 transition-colors shrink-0"
            title="다운로드"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </li>
      ))}
    </ul>
  </section>
);

const MetaCell: React.FC<{ icon: React.ReactNode; label: string; value?: string; mono?: boolean; onClick?: () => void }> = ({ icon, label, value, mono, onClick }) => {
  const inner = (
    <>
      <span className="text-main0 text-[11px] flex items-center gap-1">
        {icon} {label}
      </span>
      <p className={`font-semibold break-words ${mono ? 'font-mono' : ''} ${onClick ? 'text-teal-300' : 'text-slate-200'}`}>{value || '-'}</p>
    </>
  );
  const cls = 'p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-1 text-left';
  return onClick ? (
    <button onClick={onClick} className={`${cls} hover:border-mantis-500/40 transition-colors`} title="VOB 변경 이력 보기">
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
};

const TextBlock: React.FC<{ icon: React.ReactNode; title: string; text?: string; loading: boolean; mono?: boolean }> = ({ icon, title, text, loading, mono }) => (
  <section className="space-y-2">
    <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
      {icon} {title}
    </h3>
    {text ? (
      <pre className={`p-3 rounded-xl bg-slate-900/50 border border-slate-800 text-xs text-slate-200 whitespace-pre-wrap break-words leading-relaxed ${mono ? 'font-mono' : 'font-sans'}`}>
        {text}
      </pre>
    ) : (
      <EmptyBox>{loading ? '불러오는 중...' : '내용 없음'}</EmptyBox>
    )}
  </section>
);

const EmptyBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 text-center text-xs text-main0">{children}</div>
);
