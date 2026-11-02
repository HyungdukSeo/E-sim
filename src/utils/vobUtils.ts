import { CRItem } from '../types/cr';

export const VOB_CREATION_PROJECT = 'VOB 생성';
export const PACKAGE_PROJECT = 'Package 제작';
export const INCIDENT_REPORT_PROJECT = '장애내역';

export type RecordKind = 'cr' | 'vob' | 'package' | 'report';

/**
 * Some Mantis projects share the CR number space but are not change requests
 * (no Check-in Log, no source diff): VOB creation records, package build
 * requests and weekly incident reports. Mirrors server/sync.js NON_CR_PROJECTS.
 */
export function getRecordKind(cr?: CRItem | null): RecordKind {
  switch (cr?.project) {
    case VOB_CREATION_PROJECT: return 'vob';
    case PACKAGE_PROJECT: return 'package';
    case INCIDENT_REPORT_PROJECT: return 'report';
    default: return 'cr';
  }
}

export function isNonCrRecord(cr?: CRItem | null): boolean {
  return getRecordKind(cr) !== 'cr';
}

export function isVobCreationCR(cr?: CRItem | null): boolean {
  return getRecordKind(cr) === 'vob';
}

export function extractVobName(text?: string): string {
  if (!text) return '';
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/[[\]()]/g, ' ');
  const m = clean.match(/\b([A-Z0-9]{2,}(?:_[A-Za-z0-9]+)+)\b/);
  return m ? m[1] : '';
}

/**
 * Title shape: "[완료][KT-C4] SSW_KTC4_41A 생성 - 설명".
 * Mirrors server/sync.js parseVobCreationTitle for records that were synced
 * before the server learned to parse these titles.
 */
export function parseVobCreationTitle(title?: string): { stage: string; customer: string; vob: string; cleanSummary: string } {
  if (!title) return { stage: '', customer: '', vob: '', cleanSummary: '' };
  const brackets = [...title.matchAll(/\[([^\]]*)\]/g)].map(m => m[1].trim());
  const stripped = title.replace(/^\s*(?:\[[^\]]*\]\s*)+/, '').trim();
  return {
    stage: brackets.length >= 2 ? brackets[0] : '',
    customer: brackets.length >= 2 ? brackets[1] : brackets[0] || '',
    vob: extractVobName(stripped) || extractVobName(title),
    cleanSummary: stripped || title
  };
}

export function getVobCreationTarget(cr: CRItem): string {
  return cr.details?.vobCreation?.targetVob || parseVobCreationTitle(cr.summary).vob || cr.vob || '';
}

export function getPackageTargetVob(cr: CRItem): string {
  return cr.details?.packageInfo?.targetVob || parseVobCreationTitle(cr.summary).vob || cr.vob || '';
}
