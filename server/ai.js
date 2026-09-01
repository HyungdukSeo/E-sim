import axios from 'axios';

const STOP_WORDS = new Set([
  'ssw', 'cr', 'crid', '시', '에서', '을', '를', '이', '가', '의', '에', '으로', '로', 
  '와', '과', '도', '은', '는', '때', '관련', '관련된', '문제', '문제점', '찾아줘', 
  '알려줘', '해줘', '어떻게', '못하는', '기다리느라', '위해', '대한', '하는', '있는', 
  '있음', '없음', '현상', '보완', '개선', '추가', '수정', '등', '중', '및', '대해', '부탁',
  '왜', '안나와', '안나옴', '안나오네', '안나오냐', '어디', '어디에', '조회', '내용인데', '내용'
]);

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

export function extractDomainKeywords(query) {
  if (!query) return [];
  const raw = query.toLowerCase().replace(/[^a-zA-Z0-9가-힣_\-\.]/g, ' ').split(/\s+/).filter(Boolean);
  const keywords = [];

  for (const t of raw) {
    if (STOP_WORDS.has(t)) continue;
    let clean = t;
    ['에서', '으로', '부터', '까지', '에게', '관련된', '관련', '기동시', '구동시', '때문에', '하느라', '느라', '는', '은', '이', '가'].forEach(s => {
      if (clean.length > s.length + 1 && clean.endsWith(s)) {
        clean = clean.substring(0, clean.length - s.length);
      }
    });
    if (clean && !STOP_WORDS.has(clean) && clean.length >= 2) {
      keywords.push(clean);
    }
  }

  // Preserve raw tokens if nothing extracted
  if (keywords.length === 0 && raw.length > 0) {
    return raw.filter(r => r.length >= 2);
  }

  return [...new Set(keywords)];
}

/**
 * Intelligent Local Analyzer
 * Extracts high-relevance CRs, scores by section weights, and provides exact match explanations
 */
export function analyzeQueryLocally(query, allCrs) {
  const cleanQ = (query || '').trim();
  const keywords = extractDomainKeywords(cleanQ);

  // Check if query contains a CR ID number (e.g. 15725, 0015725, #15725)
  const idMatch = cleanQ.match(/(\d{4,7})/);
  const targetId = idMatch ? idMatch[1].padStart(7, '0') : null;
  const targetNumeric = idMatch ? parseInt(idMatch[1], 10) : null;

  const scored = [];

  for (const cr of allCrs) {
    // 1. Exact CR ID match (Priority 1)
    if (targetId && (cr.crid === targetId || cr.id === targetNumeric || String(cr.id) === idMatch[1])) {
      scored.push({
        crid: cr.crid,
        id: cr.id,
        summary: cr.summary,
        cleanSummary: cr.cleanSummary || cr.summary,
        module: cr.module || '',
        customer: cr.customer || '',
        vob: cr.vob || '',
        status: cr.status || 'opened',
        reporter: cr.reporter || '',
        assignee: cr.assignee || '',
        dateSubmitted: cr.dateSubmitted || '',
        lastUpdated: cr.lastUpdated || '',
        files: cr.files || [],
        filePaths: cr.filePaths || [],
        checkinLog: cr.checkinLog || '',
        score: 99999,
        matchReasons: [`CR 번호 #${cr.crid} 정확히 일치`],
        highlightKeywords: [targetId]
      });
      continue;
    }

    const sum = expandCompoundText(cr.summary || '').toLowerCase();
    const cleanSum = expandCompoundText(cr.cleanSummary || '').toLowerCase();
    const mod = (cr.module || '').toLowerCase();
    const rep = (cr.reporter || '').toLowerCase();
    const ass = (cr.assignee || '').toLowerCase();
    const checkin = (cr.checkinLog || '').toLowerCase();
    const files = (cr.files || []).join(' ').toLowerCase();

    let score = 0;
    const matchReasons = [];
    const highlightKeywords = [];

    for (const kw of keywords) {
      let kwScore = 0;
      const isRare = (kw === 'plsm' || kw === 'ipcdrm' || kw === 'ipcrdm' || kw === '암호화' || kw === '복호화' || kw.length >= 4);
      const baseWeight = isRare ? 45 : 14;

      // 1. Module match
      if (mod.includes(kw)) {
        kwScore += baseWeight * 3;
        matchReasons.push(`모듈 [${cr.module}] 키워드 '${kw}' 일치`);
        highlightKeywords.push(kw);
      }
      // 2. Summary match
      if (sum.includes(kw) || cleanSum.includes(kw)) {
        kwScore += baseWeight * 2.5;
        matchReasons.push(`제목 내 '${kw}' 키워드 일치`);
        highlightKeywords.push(kw);
      }
      // 3. Reporter / Assignee match
      if (rep.includes(kw) || ass.includes(kw)) {
        kwScore += baseWeight * 2;
        matchReasons.push(`작성자/담당자 [${cr.reporter || cr.assignee}] 일치`);
        highlightKeywords.push(kw);
      }
      // 4. Source file name match
      if (files.includes(kw)) {
        const matchedF = (cr.files || []).filter(f => f.toLowerCase().includes(kw));
        kwScore += baseWeight * 1.8;
        matchReasons.push(`수정 소스파일 [${matchedF.slice(0, 2).join(', ')}] 일치`);
        highlightKeywords.push(kw);
      }
      // 5. Check-in log match
      if (checkin.includes(kw)) {
        kwScore += baseWeight * 0.8;
        matchReasons.push(`체크인 로그 내 '${kw}' 언급`);
        highlightKeywords.push(kw);
      }
      // 6. Fast Anagram check for 4-6 char block names (e.g. ipcdrm <-> ipcrdm)
      if (kw.length >= 4 && kw.length <= 7 && (kw === 'ipcdrm' || kw === 'ipcrdm' || kw === 'pslm' || kw === 'plsm')) {
        if (mod.includes('ipcrdm') || sum.includes('ipcrdm') || files.includes('ipcrdm') || files.includes('Ipcrdm')) {
          kwScore += baseWeight * 2.5;
          matchReasons.push(`유사 블록명 일치 (${kw} ↔ ipcrdm)`);
          highlightKeywords.push('ipcrdm');
        }
      }

      score += kwScore;
    }

    // Co-occurrence bonus: multiple distinct keywords match
    const distinctMatchedTokens = new Set(highlightKeywords).size;
    if (distinctMatchedTokens >= 2) {
      score *= (1 + distinctMatchedTokens * 1.2);
    }

    if (score >= 10) {
      scored.push({
        crid: cr.crid,
        id: cr.id,
        summary: cr.summary,
        cleanSummary: cr.cleanSummary || cr.summary,
        module: cr.module || '',
        customer: cr.customer || '',
        vob: cr.vob || '',
        status: cr.status || 'opened',
        reporter: cr.reporter || '',
        assignee: cr.assignee || '',
        dateSubmitted: cr.dateSubmitted || '',
        lastUpdated: cr.lastUpdated || '',
        files: cr.files || [],
        filePaths: cr.filePaths || [],
        checkinLog: cr.checkinLog || '',
        score,
        matchReasons: [...new Set(matchReasons)],
        highlightKeywords: [...new Set(highlightKeywords)]
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, 10);

  // Fallback: If no matches, search whole string query
  if (topResults.length === 0 && cleanQ.length >= 2) {
    const lowerQ = cleanQ.toLowerCase();
    for (const cr of allCrs) {
      const fullText = `${cr.summary} ${cr.module} ${cr.reporter} ${cr.assignee} ${cr.files?.join(' ')}`.toLowerCase();
      if (fullText.includes(lowerQ)) {
        topResults.push({
          crid: cr.crid,
          id: cr.id,
          summary: cr.summary,
          cleanSummary: cr.cleanSummary || cr.summary,
          module: cr.module || '',
          customer: cr.customer || '',
          vob: cr.vob || '',
          status: cr.status || 'opened',
          reporter: cr.reporter || '',
          assignee: cr.assignee || '',
          dateSubmitted: cr.dateSubmitted || '',
          lastUpdated: cr.lastUpdated || '',
          files: cr.files || [],
          filePaths: cr.filePaths || [],
          checkinLog: cr.checkinLog || '',
          score: 10,
          matchReasons: [`검색어 '${cleanQ}' 전문 포함`],
          highlightKeywords: [cleanQ]
        });
        if (topResults.length >= 10) break;
      }
    }
  }

  // Generate structured textual summary
  let responseText = `### 🔍 연관 CR 분석 결과 (총 ${topResults.length}건 발견)\n\n`;
  if (keywords.length > 0) {
    responseText += `**질의 핵심 키워드:** ${keywords.map(k => `\`${k}\``).join(' ')}\n\n`;
  }

  if (topResults.length > 0) {
    responseText += `질문하신 내용과 가장 밀접하게 연관된 상위 CR 목록입니다. **CR 카드를 클릭하면 오른쪽 화면에서 소스 파일 변경 내역과 원문 상세 내용을 즉시 확인**하실 수 있습니다:\n\n`;
    topResults.slice(0, 5).forEach((item, i) => {
      responseText += `${i + 1}. **[#${item.crid}]** ${item.cleanSummary}\n`;
      responseText += `   - 🎯 **연관 이유:** ${item.matchReasons.slice(0, 2).join(' | ')}\n`;
      if (item.files && item.files.length > 0) {
        responseText += `   - 📂 **수정 파일:** \`${item.files.slice(0, 3).join('`, `')}\`${item.files.length > 3 ? ` 외 ${item.files.length - 3}개` : ''}\n`;
      }
    });
  } else {
    responseText += `입력하신 내용(\`${cleanQ}\`)과 직접 일치하는 CR을 찾지 못했습니다.\n\n`;
    responseText += `- **추천 키워드 검색 예시:**\n`;
    responseText += `  - \`PLSM 기동 실패\`, \`Altibase 연결\`, \`타임아웃\`, \`메모리 누수\`, \`0015725\`\n`;
    responseText += `  - 모듈명(예: \`IUDH\`, \`PLSM\`, \`EGISS\`) 또는 파일명(예: \`IudhAsSts.c\`)으로 검색해 보세요.`;
  }

  return {
    answer: responseText,
    matchedCrs: topResults,
    provider: 'local-nlp'
  };
}

/**
 * Main AI Query Entrypoint
 */
export async function processAiQuery({ query, contextCrs = [], config = {} }) {
  const provider = config.provider || 'local';

  // 1. External LLM Provider Proxy
  if (provider !== 'local') {
    try {
      if (provider === 'ollama' && config.ollamaEndpoint) {
        return await queryOllama(query, contextCrs, config);
      }
      if (provider === 'openai' && config.openaiApiKey) {
        return await queryOpenAI(query, contextCrs, config);
      }
      if (provider === 'gemini' && config.geminiApiKey) {
        return await queryGemini(query, contextCrs, config);
      }
    } catch (err) {
      console.warn(`[AI Proxy Error: ${provider}] Fallback to local NLP analyzer:`, err.message);
    }
  }

  // 2. Default: Intelligent Local NLP Analyzer
  return analyzeQueryLocally(query, contextCrs);
}

async function queryOllama(query, contextCrs, config) {
  const endpoint = config.ollamaEndpoint.replace(/\/$/, '') + '/api/generate';
  const model = config.ollamaModel || 'llama3';
  const localAnalysis = analyzeQueryLocally(query, contextCrs);

  const prompt = `You are a telecom software engineering assistant for Mantis CR bug tracking.
Query: "${query}"
Context CRs:
${localAnalysis.matchedCrs.map(c => `- CR #${c.crid}: ${c.cleanSummary} [Module: ${c.module}, Files: ${c.files?.slice(0, 3).join(', ')}]`).join('\n')}

Please analyze these CRs and answer the user query in Korean concisely.`;

  const resp = await axios.post(endpoint, {
    model,
    prompt,
    stream: false
  }, { timeout: 30000 });

  return {
    answer: resp.data.response,
    matchedCrs: localAnalysis.matchedCrs,
    provider: `ollama (${model})`
  };
}

async function queryOpenAI(query, contextCrs, config) {
  const apiKey = config.openaiApiKey;
  const model = config.openaiModel || 'gpt-4o-mini';
  const localAnalysis = analyzeQueryLocally(query, contextCrs);

  const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
    model,
    messages: [
      { role: 'system', content: 'You are an expert telecom SSW software engineer analyzing Mantis bug CRs. Respond in helpful Korean markdown.' },
      { role: 'user', content: `Query: ${query}\n\nTop Matched CRs:\n${JSON.stringify(localAnalysis.matchedCrs.slice(0, 5), null, 2)}` }
    ]
  }, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 30000
  });

  return {
    answer: resp.data.choices[0].message.content,
    matchedCrs: localAnalysis.matchedCrs,
    provider: `openai (${model})`
  };
}

async function queryGemini(query, contextCrs, config) {
  const apiKey = config.geminiApiKey;
  const localAnalysis = analyzeQueryLocally(query, contextCrs);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const resp = await axios.post(url, {
    contents: [
      {
        parts: [
          { text: `You are an expert telecom SSW engineer analyzing Mantis bug CRs. Respond in Korean markdown.\nQuery: ${query}\n\nContext CRs:\n${JSON.stringify(localAnalysis.matchedCrs.slice(0, 5))}` }
        ]
      }
    ]
  }, { timeout: 30000 });

  const answer = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || localAnalysis.answer;

  return {
    answer,
    matchedCrs: localAnalysis.matchedCrs,
    provider: 'gemini-1.5-flash'
  };
}
