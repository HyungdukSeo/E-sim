import { CRItem, FilterState } from '../types/cr';

const COMPOUND_EXPANSIONS: [RegExp, string][] = [
  [/암[\/\-]복호화/gi, '암/복호화 암호화 복호화 암호 복호'],
  [/송[\/\-]수신/gi, '송/수신 송신 수신'],
  [/인[\/\-]디코딩/gi, '인/디코딩 인코딩 디코딩'],
  [/등[\/\-]해제/gi, '등/해제 등록 해제'],
  [/생성[\/\-]삭제/gi, '생성/삭제 생성 삭제'],
  [/시작[\/\-]종료/gi, '시작/종료 시작 종료'],
  [/추가[\/\-]삭제/gi, '추가/삭제 추가 삭제'],
  [/동기[\/\-]비동기/gi, '동기/비동기 동기 비동기'],
  [/주[\/\-]예비/gi, '주/예비 주 예비 액티브 스탠바이 act sby'],
  [/절체/gi, '절체 failover switchover 절채'],
];

export function expandCompoundText(text: string): string {
  let s = text || '';
  for (const [re, exp] of COMPOUND_EXPANSIONS) {
    s = s.replace(re, exp);
  }
  return s;
}

export interface SearchResult {
  items: CRItem[];
  totalMatches: number;
  facets: {
    projects: Record<string, number>;
    statuses: Record<string, number>;
    customers: Record<string, number>;
    reporters: Record<string, number>;
    assignees: Record<string, number>;
    withCheckinCount: number;
  };
}

interface ParsedQuery {
  rawKeywords: string[];
  exactPhrases: string[];
  fieldFilters: {
    project?: string;
    customer?: string;
    author?: string;
    assignee?: string;
    status?: string;
    vob?: string;
    file?: string;
    crid?: string;
    isCheckin?: boolean;
  };
}

export function parseSearchQuery(query: string): ParsedQuery {
  const result: ParsedQuery = {
    rawKeywords: [],
    exactPhrases: [],
    fieldFilters: {}
  };

  if (!query || !query.trim()) return result;

  // Extract exact phrases: "some phrase"
  let cleanQuery = query.replace(/"([^"]+)"/g, (_, phrase) => {
    if (phrase.trim()) result.exactPhrases.push(phrase.trim().toLowerCase());
    return '';
  });

  const tokens = cleanQuery.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    const colonIdx = token.indexOf(':');
    if (colonIdx > 0) {
      const key = token.substring(0, colonIdx).toLowerCase();
      const val = token.substring(colonIdx + 1).trim().toLowerCase();
      
      if (key === 'project' || key === 'p') result.fieldFilters.project = val;
      else if (key === 'site' || key === 'customer' || key === 'c') result.fieldFilters.customer = val;
      else if (key === 'author' || key === 'reporter' || key === 'rep') result.fieldFilters.author = val;
      else if (key === 'assignee' || key === 'ass') result.fieldFilters.assignee = val;
      else if (key === 'status' || key === 's') result.fieldFilters.status = val;
      else if (key === 'vob' || key === 'v') result.fieldFilters.vob = val;
      else if (key === 'file' || key === 'f') result.fieldFilters.file = val;
      else if (key === 'id' || key === 'crid') result.fieldFilters.crid = val;
      else if (key === 'is' && (val === 'checkin' || val === 'ci')) result.fieldFilters.isCheckin = true;
      else {
        result.rawKeywords.push(token.toLowerCase());
      }
    } else {
      result.rawKeywords.push(token.toLowerCase());
    }
  }

  return result;
}

export function filterAndSearchCRs(
  allCrs: CRItem[],
  filterState: FilterState,
  bookmarks: Set<string>
): SearchResult {
  const {
    searchQuery,
    projects,
    statuses,
    customers,
    reporters,
    assignees,
    hasCheckinOnly,
    vob,
    fileKeyword,
    startDate,
    endDate,
    bookmarkedOnly
  } = filterState;

  const parsedQuery = parseSearchQuery(searchQuery);
  const hasKeywords = parsedQuery.rawKeywords.length > 0 || parsedQuery.exactPhrases.length > 0;
  const hasFieldFilters = Object.keys(parsedQuery.fieldFilters).length > 0;

  const filtered = allCrs.filter(cr => {
    // 1. Bookmarks filter
    if (bookmarkedOnly && !bookmarks.has(cr.crid)) {
      return false;
    }

    // 2. Facet filters (Sidebar)
    if (projects.length > 0 && !projects.includes(cr.project)) {
      return false;
    }
    if (statuses.length > 0 && !statuses.includes(cr.status)) {
      return false;
    }
    if (customers.length > 0 && !customers.includes(cr.customer || '공통/미지정')) {
      return false;
    }
    if (reporters.length > 0 && !reporters.includes(cr.reporter)) {
      return false;
    }
    if (assignees.length > 0 && !assignees.includes(cr.assignee)) {
      return false;
    }
    if (hasCheckinOnly && (!cr.files || cr.files.length === 0)) {
      return false;
    }
    if (vob && !(cr.vob || '').toLowerCase().includes(vob.toLowerCase())) {
      return false;
    }
    if (fileKeyword) {
      const matchFile = (cr.files || []).some(f => f.toLowerCase().includes(fileKeyword.toLowerCase())) ||
        (cr.checkinLog || '').toLowerCase().includes(fileKeyword.toLowerCase());
      if (!matchFile) return false;
    }
    if (startDate && cr.dateSubmitted && cr.dateSubmitted < startDate) {
      return false;
    }
    if (endDate && cr.dateSubmitted && cr.dateSubmitted > endDate) {
      return false;
    }

    // 3. Parsed query field filters (e.g. project:X-SSW, site:KT, file:IudhAsSts.c)
    if (hasFieldFilters) {
      const ff = parsedQuery.fieldFilters;
      if (ff.project && !cr.project.toLowerCase().includes(ff.project)) return false;
      if (ff.customer && !(cr.customer || '').toLowerCase().includes(ff.customer)) return false;
      if (ff.author && !(cr.reporter || '').toLowerCase().includes(ff.author) && !(cr.authorInTitle || '').toLowerCase().includes(ff.author)) return false;
      if (ff.assignee && !(cr.assignee || '').toLowerCase().includes(ff.assignee)) return false;
      if (ff.status && !cr.status.toLowerCase().includes(ff.status)) return false;
      if (ff.vob && !(cr.vob || '').toLowerCase().includes(ff.vob)) return false;
      if (ff.crid && !cr.crid.includes(ff.crid)) return false;
      if (ff.isCheckin && (!cr.files || cr.files.length === 0)) return false;
      if (ff.file) {
        const fileMatch = (cr.files || []).some(f => f.toLowerCase().includes(ff.file!)) ||
          (cr.checkinLog || '').toLowerCase().includes(ff.file!);
        if (!fileMatch) return false;
      }
    }

    // 4. Keyword & Phrase matching (Full-text in-memory search)
    if (hasKeywords) {
      const expandedSummary = expandCompoundText(cr.summary);
      const searchableText = `${cr.crid} ${cr.id} ${expandedSummary} ${cr.reporter} ${cr.assignee} ${cr.customer || ''} ${cr.vob || ''} ${cr.module || ''} ${(cr.files || []).join(' ')} ${cr.checkinLog || ''}`.toLowerCase();

      // Check exact phrases
      for (const phrase of parsedQuery.exactPhrases) {
        if (!searchableText.includes(phrase)) return false;
      }

      // Check all raw keywords (AND behavior)
      for (const kw of parsedQuery.rawKeywords) {
        if (!searchableText.includes(kw)) return false;
      }
    }

    return true;
  });

  // Calculate dynamic facets for the active result set
  const facetProjects: Record<string, number> = {};
  const facetStatuses: Record<string, number> = {};
  const facetCustomers: Record<string, number> = {};
  const facetReporters: Record<string, number> = {};
  const facetAssignees: Record<string, number> = {};
  let withCheckinCount = 0;

  for (const item of filtered) {
    if (item.project) facetProjects[item.project] = (facetProjects[item.project] || 0) + 1;
    if (item.status) facetStatuses[item.status] = (facetStatuses[item.status] || 0) + 1;
    const cust = item.customer || '공통/미지정';
    facetCustomers[cust] = (facetCustomers[cust] || 0) + 1;
    if (item.reporter) facetReporters[item.reporter] = (facetReporters[item.reporter] || 0) + 1;
    if (item.assignee) facetAssignees[item.assignee] = (facetAssignees[item.assignee] || 0) + 1;
    if (item.files && item.files.length > 0) withCheckinCount++;
  }

  return {
    items: filtered,
    totalMatches: filtered.length,
    facets: {
      projects: facetProjects,
      statuses: facetStatuses,
      customers: facetCustomers,
      reporters: facetReporters,
      assignees: facetAssignees,
      withCheckinCount
    }
  };
}

/**
 * Split text into parts and mark matched substring for visual highlighting
 */
export function highlightText(text: string, query: string): Array<{ text: string; isMatch: boolean }> {
  if (!text || !query.trim()) return [{ text, isMatch: false }];

  const parsed = parseSearchQuery(query);
  const keywords = [...parsed.rawKeywords, ...parsed.exactPhrases].filter(k => k.length > 0);
  if (keywords.length === 0) return [{ text, isMatch: false }];

  const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${escaped})`, 'gi');

  const parts = text.split(regex);
  return parts.map(part => ({
    text: part,
    isMatch: regex.test(part)
  }));
}
