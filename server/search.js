// CR 텍스트 검색 — src/services/searchEngine.ts 의 핵심 매칭 로직(parseSearchQuery,
// expandCompoundText, 키워드/구문 AND 매칭)만 서버(ESM)로 이식한 것. UI 전용인
// facet 집계·북마크·필드필터(project:/customer: 등)는 여기서는 필요 없어 뺐다 — MCP 도구가
// 필요한 건 "텍스트로 CR 찾기" 뿐이라 crid 매칭 + 키워드 AND 매칭만 구현한다.

const COMPOUND_EXPANSIONS = [
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

export function expandCompoundText(text) {
  let s = text || '';
  for (const [re, exp] of COMPOUND_EXPANSIONS) {
    s = s.replace(re, exp);
  }
  return s;
}

export function parseSearchQuery(query) {
  const result = { rawKeywords: [], exactPhrases: [] };
  if (!query || !query.trim()) return result;
  const cleanQuery = query.replace(/"([^"]+)"/g, (_, phrase) => {
    if (phrase.trim()) result.exactPhrases.push(phrase.trim().toLowerCase());
    return '';
  });
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    result.rawKeywords.push(token.toLowerCase());
  }
  return result;
}

const CR_SUMMARY_FIELDS = ['crid', 'project', 'reporter', 'assignee', 'summary', 'status', 'customer', 'module', 'dateSubmitted', 'lastUpdated'];

function toSummary(cr) {
  const out = {};
  for (const f of CR_SUMMARY_FIELDS) out[f] = cr[f];
  return out;
}

// allCrs: getLocalDatabase().crs 배열. q 가 숫자로만 구성되면 crid(7자리 zero-pad) 완전/부분
// 일치를 우선 정렬하고, 그 외엔 확장 텍스트에 대해 키워드 전부 포함(AND) 매칭한다.
export function searchCRs(allCrs, q, limit = 20) {
  const query = String(q || '').trim();
  const max = Math.max(1, Math.min(100, Number(limit) || 20));
  if (!query) return [];

  const isNumericQuery = /^\d+$/.test(query);
  if (isNumericQuery) {
    const padded = query.padStart(7, '0');
    const exact = [];
    const partial = [];
    for (const cr of allCrs) {
      const crid = String(cr.crid || '');
      if (crid === padded) exact.push(cr);
      else if (crid.includes(query)) partial.push(cr);
    }
    return [...exact, ...partial].slice(0, max).map(toSummary);
  }

  const parsed = parseSearchQuery(query);
  const hasKeywords = parsed.rawKeywords.length > 0 || parsed.exactPhrases.length > 0;
  if (!hasKeywords) return [];

  const results = [];
  for (const cr of allCrs) {
    const expandedSummary = expandCompoundText(cr.summary || '');
    const searchableText = `${cr.crid} ${cr.id} ${expandedSummary} ${cr.reporter || ''} ${cr.assignee || ''} ${cr.customer || ''} ${cr.vob || ''} ${cr.module || ''} ${(cr.files || []).join(' ')} ${cr.checkinLog || ''}`.toLowerCase();

    let ok = true;
    for (const phrase of parsed.exactPhrases) {
      if (!searchableText.includes(phrase)) { ok = false; break; }
    }
    if (ok) {
      for (const kw of parsed.rawKeywords) {
        if (!searchableText.includes(kw)) { ok = false; break; }
      }
    }
    if (ok) {
      results.push(cr);
      if (results.length >= max) break;
    }
  }
  return results.map(toSummary);
}
