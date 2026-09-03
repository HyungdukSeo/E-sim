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
    // Generate statistical summary
    const totalFiles = topResults.reduce((acc, curr) => acc + (curr.files?.length || 0), 0);
    const modules = topResults.map(c => c.module).filter(Boolean);
    const mostFreqModule = modules.length > 0 ? modules.sort((a,b) => 
      modules.filter(v => v===a).length - modules.filter(v => v===b).length
    ).pop() : '다양한 모듈';
    
    responseText += `**💡 핵심 요약:**\n`;
    responseText += `검색된 상위 ${topResults.length}건의 이슈를 종합해 본 결과, 체크인 로그나 제목에서 키워드가 언급된 내역이 존재하며, **총 ${totalFiles}개의 소스 파일이 직접 수정**되었습니다. 주로 **${mostFreqModule}** 모듈과 연관되어 해결된 패턴을 보입니다. 자세한 원인이나 오류 메시지가 명시된 구체적인 내역은 아래 상세 목록을 통해 확인하실 수 있습니다.\n\n---\n\n`;
    
    responseText += `질문하신 내용과 밀접하게 연관된 핵심 CR 목록입니다. **CR 카드를 클릭하면 오른쪽 화면에서 소스 파일 변경 내역과 원문 상세 내용을 즉시 확인**하실 수 있습니다:\n\n`;
    topResults.slice(0, 5).forEach((item, i) => {
      responseText += `${i + 1}. **[#${item.crid}]** ${item.cleanSummary}\n`;
      responseText += `   - 🎯 **연관 이유:** ${item.matchReasons.slice(0, 2).join(' | ')}\n`;
      if (item.files && item.files.length > 0) {
        responseText += `   - 📂 **수정 파일:** \`${item.files.slice(0, 3).join('`, `')}\`${item.files.length > 3 ? ` 외 ${item.files.length - 3}개` : ''}\n`;
      }
      if (item.checkinLog) {
        const lines = item.checkinLog.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('==='));
        if (lines.length > 0) {
          const snippet = lines.slice(0, 2).join(' / ').substring(0, 150).replace(/\s+/g, ' ');
          responseText += `   - 📝 **변경 내역:** ${snippet}${snippet.length >= 150 ? '...' : ''}\n`;
        }
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

import { fetchFileDiffSSH } from './ssh.js';

const BINARY_EXTS = new Set(['.exe', '.o', '.a', '.so', '.dll', '.tar', '.gz', '.zip', '.class', '.jar', '.png', '.jpg', '.pdf']);

async function collectDeepDiffs(localAnalysis, sshConfig) {
  if (!sshConfig || !sshConfig.host) return '';
  
  const filesToFetch = [];
  
  // Extract up to 5 valid files from the top 3 matched CRs
  for (const cr of localAnalysis.matchedCrs.slice(0, 3)) {
    if (!cr.files) continue;
    
    for (let i = 0; i < cr.files.length; i++) {
      const fileName = cr.files[i];
      const filePath = cr.filePaths?.[i] || fileName;
      
      const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
      if (BINARY_EXTS.has(ext)) continue;
      
      // Found a text/source file
      filesToFetch.push({ crid: cr.crid, fileName, filePath, checkinLog: cr.checkinLog });
      
      if (filesToFetch.length >= 5) break;
    }
    if (filesToFetch.length >= 5) break;
  }
  
  if (filesToFetch.length === 0) return '';
  
  console.log(`[AI Deep Analysis] Fetching diffs for ${filesToFetch.length} files...`);
  
  let diffContext = '\n\n=== [DEEP CODE DIFF ANALYSIS] ===\n';
  diffContext += 'The following are actual code diffs (Unified Diff format) for the most relevant modified files:\n\n';
  
  for (const f of filesToFetch) {
    try {
      const diffResult = await fetchFileDiffSSH(sshConfig, f.filePath, f.checkinLog);
      if (diffResult.ok && diffResult.hasChanges && diffResult.unifiedDiff) {
        // Truncate massive diffs to avoid blowing up context window
        const diffText = diffResult.unifiedDiff.length > 5000 
          ? diffResult.unifiedDiff.substring(0, 5000) + '\n... (diff truncated due to length)'
          : diffResult.unifiedDiff;
          
        diffContext += `\n--- CR #${f.crid} : ${f.fileName} ---\n\`\`\`diff\n${diffText}\n\`\`\`\n`;
      }
    } catch (err) {
      console.warn(`[AI Deep Analysis] Failed to fetch diff for ${f.fileName}: ${err.message}`);
    }
  }
  
  return diffContext;
}

/**
 * Main AI Query Entrypoint
 */
export async function processAiQuery({ query, contextCrs = [], config = {} }) {
  const provider = config.provider || 'local';

  // 1. External LLM Provider Proxy
  if (provider !== 'local') {
    try {
      const localAnalysis = analyzeQueryLocally(query, contextCrs);
      let deepDiffContext = '';
      
      if (config.useDeepAnalysis && config.sshConfig) {
        deepDiffContext = await collectDeepDiffs(localAnalysis, config.sshConfig);
      }

      if (provider === 'custom' && config.customUrl) {
        return await queryCustomOpenAI(query, localAnalysis, deepDiffContext, config);
      }
      if (provider === 'openai') {
        return await queryOpenAI(query, localAnalysis, deepDiffContext, config);
      }
      if (provider === 'gemini') {
        return await queryGemini(query, localAnalysis, deepDiffContext, config);
      }
      if (provider === 'claude') {
        return await queryClaude(query, localAnalysis, deepDiffContext, config);
      }
    } catch (err) {
      console.warn(`[AI Proxy Error: ${provider}] Fallback to local NLP analyzer:`, err.message);
    }
  }

  // 2. Default: Intelligent Local NLP Analyzer
  return analyzeQueryLocally(query, contextCrs);
}

async function queryCustomOpenAI(query, localAnalysis, deepDiffContext, config) {
  const endpoint = config.customUrl.replace(/\/$/, '') + '/chat/completions';
  const apiKey = config.apiKey || 'b644f37bc89d3472041218af3976fb9e';
  const model = config.customModel || 'aico-rag-qwen2.5-coder-7b';

  let userContent = `Query: ${query}\n\nTop Matched CRs:\n${JSON.stringify(localAnalysis.matchedCrs.slice(0, 5), null, 2)}`;
  if (deepDiffContext) {
    userContent += `\n${deepDiffContext}\n\nPlease perform a deep analysis on the actual code diffs provided above. Explain the changes and provide a comprehensive conclusion based on the code.`;
  }

  const resp = await axios.post(endpoint, {
    model,
    messages: [
      { role: 'system', content: 'You are an expert telecom SSW software engineer analyzing Mantis bug CRs. Respond in helpful Korean markdown.' },
      { role: 'user', content: userContent }
    ]
  }, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 120000
  });

  return {
    answer: resp.data.choices[0].message.content,
    matchedCrs: localAnalysis.matchedCrs,
    provider: `custom (${model})`
  };
}

async function queryOpenAI(query, localAnalysis, deepDiffContext, config) {
  const apiKey = config.openaiApiKey || 'proxy-handled-key';
  const model = config.openaiModel || 'gpt-4o-mini';

  let userContent = `Query: ${query}\n\nTop Matched CRs:\n${JSON.stringify(localAnalysis.matchedCrs.slice(0, 5), null, 2)}`;
  if (deepDiffContext) {
    userContent += `\n${deepDiffContext}\n\nPlease perform a deep analysis on the actual code diffs provided above. Explain the changes and provide a comprehensive conclusion based on the code.`;
  }

  const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
    model,
    messages: [
      { role: 'system', content: 'You are an expert telecom SSW software engineer analyzing Mantis bug CRs. Respond in helpful Korean markdown.' },
      { role: 'user', content: userContent }
    ]
  }, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 120000
  });

  return {
    answer: resp.data.choices[0].message.content,
    matchedCrs: localAnalysis.matchedCrs,
    provider: `openai (${model})`
  };
}

async function queryGemini(query, localAnalysis, deepDiffContext, config) {
  const apiKey = config.geminiApiKey || 'proxy-handled-key';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel || 'gemini-1.5-flash'}:generateContent?key=${apiKey}`;

  let userContent = `You are an expert telecom SSW engineer analyzing Mantis bug CRs. Respond in Korean markdown.\nQuery: ${query}\n\nContext CRs:\n${JSON.stringify(localAnalysis.matchedCrs.slice(0, 5))}`;
  if (deepDiffContext) {
    userContent += `\n${deepDiffContext}\n\nPlease perform a deep analysis on the actual code diffs provided above. Explain the changes and provide a comprehensive conclusion based on the code.`;
  }

  const resp = await axios.post(url, {
    contents: [
      {
        parts: [
          { text: userContent }
        ]
      }
    ]
  }, { timeout: 120000 });

  const answer = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || localAnalysis.answer;

  return {
    answer,
    matchedCrs: localAnalysis.matchedCrs,
    provider: `gemini (${config.geminiModel || 'gemini-1.5-flash'})`
  };
}

async function queryClaude(query, localAnalysis, deepDiffContext, config) {
  const apiKey = config.claudeApiKey || config.apiKey || 'proxy-handled-key';
  const model = config.claudeModel || config.model || 'claude-3-5-sonnet-latest';

  let userContent = `Query: ${query}\n\nTop Matched CRs:\n${JSON.stringify(localAnalysis.matchedCrs.slice(0, 5), null, 2)}`;
  if (deepDiffContext) {
    userContent += `\n${deepDiffContext}\n\nPlease perform a deep analysis on the actual code diffs provided above. Explain the changes and provide a comprehensive conclusion based on the code.`;
  }

  const resp = await axios.post('https://api.anthropic.com/v1/messages', {
    model,
    max_tokens: 4096,
    system: 'You are an expert telecom SSW software engineer analyzing Mantis bug CRs. Respond in helpful Korean markdown.',
    messages: [
      { role: 'user', content: userContent }
    ]
  }, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    timeout: 120000
  });

  const answer = resp.data.content?.[0]?.text || '';

  return {
    answer,
    matchedCrs: localAnalysis.matchedCrs,
    provider: `claude (${model})`
  };
}
