import axios from 'axios';
import { checkOmniRouteAlive, checkOmniRouteStatus, readOmniRouteToken, isInvalidOmniRouteKey, hasCommand, runCliAI } from './cli-models.js';

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
import { getCRDiffCache } from './diff-cache.js';

const BINARY_EXTS = new Set(['.exe', '.o', '.a', '.so', '.dll', '.tar', '.gz', '.zip', '.class', '.jar', '.png', '.jpg', '.pdf']);

async function collectDeepDiffs(localAnalysis, sshConfig) {
  const filesToFetch = [];
  
  // Extract up to 5 valid files from the top 3 matched CRs
  for (const cr of localAnalysis.matchedCrs.slice(0, 3)) {
    if (!cr.files) continue;
    
    // Check if we have local cache first!
    const cached = getCRDiffCache(cr.crid);
    if (cached && cached.files && cached.files.length > 0) {
      for (const f of cached.files) {
        if (f.hasChanges && f.unifiedDiff) {
          filesToFetch.push({ crid: cr.crid, fileName: f.fileName, filePath: f.filePath, unifiedDiff: f.unifiedDiff });
          if (filesToFetch.length >= 5) break;
        }
      }
    } else if (sshConfig && sshConfig.host) {
      for (let i = 0; i < cr.files.length; i++) {
        const fileName = cr.files[i];
        const filePath = cr.filePaths?.[i] || fileName;
        
        const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
        if (BINARY_EXTS.has(ext)) continue;
        
        filesToFetch.push({ crid: cr.crid, fileName, filePath, checkinLog: cr.checkinLog, needsSSH: true });
        if (filesToFetch.length >= 5) break;
      }
    }
    if (filesToFetch.length >= 5) break;
  }
  
  if (filesToFetch.length === 0) return '';
  
  let diffContext = '\n\n=== [DEEP CODE DIFF ANALYSIS] ===\n';
  diffContext += 'The following are actual code diffs (Unified Diff format) for the most relevant modified files:\n\n';
  
  for (const f of filesToFetch) {
    try {
      let diffText = f.unifiedDiff;
      if (!diffText && f.needsSSH && sshConfig) {
        const diffResult = await fetchFileDiffSSH(sshConfig, f.filePath, f.checkinLog);
        if (diffResult.ok && diffResult.hasChanges && diffResult.unifiedDiff) {
          diffText = diffResult.unifiedDiff;
        }
      }

      if (diffText) {
        const truncated = diffText.length > 4000 
          ? diffText.substring(0, 4000) + '\n... (diff truncated due to length)'
          : diffText;
          
        diffContext += `\n--- CR #${f.crid} : ${f.fileName} ---\n\`\`\`diff\n${truncated}\n\`\`\`\n`;
      }
    } catch (err) {
      console.warn(`[AI Deep Analysis] Failed to fetch diff for ${f.fileName}: ${err.message}`);
    }
  }
  
  return diffContext;
}

/**
 * Universal LLM Dispatcher
 */
export async function callLLM({ systemPrompt, userPrompt, config = {} }) {
  const provider = config.provider || 'local';

  // 1. Custom LLM Endpoint
  if (provider === 'custom' && config.customUrl) {
    const endpoint = config.customUrl.replace(/\/$/, '') + '/chat/completions';
    const apiKey = config.apiKey || 'b644f37bc89d3472041218af3976fb9e';
    const model = config.customModel || 'aico-rag-qwen2.5-coder-7b';

    const resp = await axios.post(endpoint, {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 120000
    });
    return { content: resp.data.choices[0].message.content, provider: `Custom LLM (${model})` };
  }

  // 2. OpenAI / Codex
  if (provider === 'openai') {
    const apiKey = config.openaiApiKey;
    const model = config.openaiModel || 'gpt-4o-mini';

    if (apiKey && apiKey !== 'proxy-handled-key') {
      const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      }, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 120000
      });
      return { content: resp.data.choices[0].message.content, provider: `OpenAI (${model})` };
    }
    throw new Error('OpenAI API 키가 설정되지 않았습니다.');
  }

  // 3. Antigravity / Gemini
  if (provider === 'gemini') {
    const model = config.geminiModel || config.model || 'gemini-3.7-flash-high';
    if (hasCommand('agy')) {
      return await runCliAI('agy', { systemPrompt, userPrompt, model, timeoutMs: 90000 });
    }
    if (config.geminiApiKey && config.geminiApiKey !== 'proxy-handled-key') {
      const apiKey = config.geminiApiKey;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const resp = await axios.post(url, {
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }]
      }, { timeout: 120000 });
      const content = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { content, provider: `Gemini API (${model})` };
    }
    throw new Error('Antigravity(agy) CLI 또는 Gemini API 키가 필요합니다.');
  }

  // 4. Claude Code / Anthropic
  if (provider === 'claude') {
    const model = config.claudeModel || config.model || 'sonnet';
    if (hasCommand('claude')) {
      return await runCliAI('claude', { systemPrompt, userPrompt, model, timeoutMs: 90000 });
    }
    if (config.claudeApiKey && config.claudeApiKey !== 'proxy-handled-key') {
      const apiKey = config.claudeApiKey;
      const resp = await axios.post('https://api.anthropic.com/v1/messages', {
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      }, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        timeout: 120000
      });
      return { content: resp.data.content?.[0]?.text || '', provider: `Claude API (${model})` };
    }
    throw new Error('Claude CLI 또는 Anthropic API 키가 필요합니다.');
  }

  // 5. OmniRoute Gateway
  if (provider === 'omniroute') {
    const omniStatus = await checkOmniRouteStatus(config.omnirouteUrl, config.omnirouteApiKey);
    if (!omniStatus.alive) {
      throw new Error('OmniRoute 서비스가 로컬(localhost:20128)에서 실행 중이지 않습니다.');
    }
    if (!omniStatus.ready) {
      throw new Error('OmniRoute API 토큰 인증에 실패했습니다. 설정에서 올바른 API 키를 입력해 주세요.');
    }
    let baseUrl = (config.omnirouteUrl || config.baseUrl || 'http://localhost:20128/v1').trim().replace(/\/$/, '');
    if (!baseUrl.endsWith('/v1') && !baseUrl.includes('/v1/')) {
      baseUrl += '/v1';
    }
    const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
    const apiKey = !isInvalidOmniRouteKey(config.omnirouteApiKey)
      ? config.omnirouteApiKey.trim()
      : (omniStatus.effectiveKey || readOmniRouteToken() || 'sk-omniroute');
    const model = config.model || config.omnirouteModel || 'auto';

    const resp = await axios.post(endpoint, {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    });
    return {
      content: resp.data.choices?.[0]?.message?.content || '',
      provider: `OmniRoute (${model})`
    };
  }

  // Local fallback explanation
  return {
    content: `[로컬 NLP 모드]\n\n설정된 외부 AI 공급자(${provider})가 없거나 로컬 모드입니다. 상단 환경설정에서 AI 공급자를 확인해 주세요.`,
    provider: 'local-fallback'
  };
}

/**
 * 1. Single CR Deep Diff Analysis
 */
export async function analyzeSingleCRDiff({ cr, diffPayload, config = {} }) {
  const files = diffPayload?.files || [];
  const validDiffs = files.filter(f => f.hasChanges && f.unifiedDiff);

  let diffText = '';
  validDiffs.forEach(f => {
    const truncated = f.unifiedDiff.length > 5000 
      ? f.unifiedDiff.substring(0, 5000) + '\n... (일부 긴 diff 생략)' 
      : f.unifiedDiff;
    diffText += `\n### 파일: \`${f.fileName}\` (${f.oldVersion} -> ${f.newVersion})\n\`\`\`diff\n${truncated}\n\`\`\`\n`;
  });

  const systemPrompt = `당신은 통신 소프트웨어(SSW) 전문가이자 시니어 코드 리뷰어입니다.
Mantis CR의 메타데이터와 실제 소스코드 변경 내역(Unified Diff)을 면밀히 분석하여 한국어 마크다운 리포트를 작성합니다.
다음 4가지 섹션을 명확하고 전문적으로 작성하세요:
1. 🎯 **수정 핵심 목적 & 버그 원인 분석**
2. 🔬 **구체적 코드 변경점 상세 요약** (함수 단위, if 분기문, 변수 처리, 알고리즘 변경 내용 명시)
3. ⚠️ **잠재적 부작용(Side Effects) & 영향 영역** (연관 모듈, 성능, 메모리 누수, 예외 처리 등)
4. 💡 **종합 평가 및 테스트/운영 주의사항**`;

  const userPrompt = `[CR 기본 정보]
- CR 번호: #${cr.crid}
- 제목: ${cr.cleanSummary || cr.summary}
- 모듈: ${cr.module || '미지정'}
- 고객사: ${cr.customer || '미지정'}
- 체크인 로그:
${cr.checkinLog || '로그 없음'}

[실제 소스 코드 변경 내역 (총 ${validDiffs.length}개 파일 변경)]
${diffText || '(변경 코드가 없거나 바이너리 파일입니다.)'}`;

  try {
    const res = await callLLM({ systemPrompt, userPrompt, config });
    return {
      analysis: res.content,
      provider: res.provider,
      fileCount: validDiffs.length
    };
  } catch (err) {
    console.warn(`[AI Diff Analysis Error] ${config.provider || 'unknown'}:`, err.message);
    const fallbackText = `> 💡 **알림**: 선택하신 AI 공급자(\`${config.provider || 'AI'}\`)가 비활성화 또는 응답 불가 상태여서 **[로컬 코드 Diff 요약 모드]**로 자동 전환하여 결과를 표시합니다.\n\n` +
      `### 🎯 CR #${cr.crid} 코드 수정 개요\n` +
      `- **요약:** ${cr.cleanSummary || cr.summary}\n` +
      `- **수정 파일 수:** 총 ${validDiffs.length}개 파일 변경\n\n` +
      `### 📝 변경 파일 목록\n` +
      validDiffs.map(f => `- \`${f.fileName}\` (${f.oldVersion} -> ${f.newVersion})`).join('\n') +
      `\n\n*(상세한 AI 심층 분석을 원하실 경우 환경설정에서 활성화된 AI 공급자를 선택하거나 OmniRoute를 실행해 주세요.)*`;

    return {
      analysis: fallbackText,
      provider: 'local-summary (기본 자동전환)',
      isFallback: true,
      fileCount: validDiffs.length
    };
  }
}

/**
 * 2. Multiple CR Cross-Comparison Diff Analysis
 */
export async function compareMultipleCRDiffs({ crs, diffMap, config = {} }) {
  // Find overlapping files
  const fileToCRs = {};
  crs.forEach(cr => {
    const cached = diffMap[cr.crid];
    const files = cached?.files || cr.files || [];
    files.forEach(f => {
      const name = typeof f === 'string' ? f : f.fileName;
      if (!fileToCRs[name]) fileToCRs[name] = [];
      fileToCRs[name].push(cr.crid);
    });
  });

  const overlappingFiles = Object.keys(fileToCRs).filter(f => fileToCRs[f].length > 1);

  let crsContext = '';
  crs.forEach((cr, idx) => {
    crsContext += `\n--- [CR ${idx + 1}: #${cr.crid}] ---\n`;
    crsContext += `- 제목: ${cr.cleanSummary || cr.summary}\n`;
    crsContext += `- 모듈: ${cr.module} | 상태: ${cr.status} | 고객사: ${cr.customer}\n`;
    crsContext += `- 체크인 로그: ${cr.checkinLog?.replace(/\n/g, ' ') || '없음'}\n`;
    
    const diffs = diffMap[cr.crid]?.files || [];
    const valid = diffs.filter(d => d.hasChanges && d.unifiedDiff);
    crsContext += `- 변경 파일(${valid.length}개): ${valid.map(v => v.fileName).join(', ')}\n`;
    valid.forEach(v => {
      const truncated = v.unifiedDiff.length > 3000 ? v.unifiedDiff.substring(0, 3000) + '\n...(생략)' : v.unifiedDiff;
      crsContext += `  * 파일 \`${v.fileName}\` Diff:\n\`\`\`diff\n${truncated}\n\`\`\`\n`;
    });
  });

  const systemPrompt = `당신은 통신 소프트웨어(SSW) 전문가이자 시스템 아키텍트입니다.
사용자가 비교를 요청한 2~3개의 Mantis CR과 실제 소스코드 변경 내역을 바탕으로 심층 교차 비교 분석 리포트를 작성합니다.
다음 섹션으로 구성해 주세요:
1. 📊 **핵심 변경 목적 및 접근 방식 비교 요약표** (표 형태)
2. 🔄 **공통 수정 파일 및 코드 변경 흐름 비교** (공통 파일: ${overlappingFiles.join(', ') || '없음'} 중심, 이전 수정과 후속 수정의 관계, 로직 충돌/보완 여부)
3. ⚠️ **상호 연관성 및 사이드이펙트/코드 충돌 위험도**
4. 💡 **종합 진단 및 권고사항**`;

  const userPrompt = `[비교 대상 CR 목록]\n${crsContext}\n\n[공통 수정 파일]\n${overlappingFiles.length > 0 ? overlappingFiles.join(', ') : '공통 수정 파일 없음 (개별 파일 독립 수정)'}\n\n위 CR들의 실제 소스 코드 변경점을 상호 교차 비교하여 한국어 마크다운으로 상세히 분석해 주세요.`;

  try {
    const res = await callLLM({ systemPrompt, userPrompt, config });
    return {
      analysis: res.content,
      provider: res.provider,
      overlappingFiles,
      crCount: crs.length
    };
  } catch (err) {
    console.warn(`[AI Compare Error] ${config.provider || 'unknown'}:`, err.message);
    const fallbackText = `> 💡 **알림**: 선택하신 AI 공급자(\`${config.provider || 'AI'}\`)가 비활성화 또는 응답 불가 상태여서 **[로컬 교차 비교 요약 모드]**로 자동 전환되었습니다.\n\n` +
      `### 📊 비교 대상 CR 목록 (${crs.length}개)\n` +
      crs.map(c => `- **#${c.crid}**: ${c.cleanSummary || c.summary} (${(c.files || []).length}개 파일)`).join('\n') +
      `\n\n### 🔄 공통 수정 파일 분석\n` +
      (overlappingFiles.length > 0 
        ? `다음 파일이 여러 CR에서 중복 수정되었습니다:\n` + overlappingFiles.map(f => `- \`${f}\``).join('\n')
        : `- 공통으로 겹치는 수정 파일이 없습니다. (각 CR이 독립된 파일을 수정함)`) +
      `\n\n*(상세한 AI 심층 분석을 원하실 경우 환경설정에서 활성화된 AI 공급자를 선택하거나 OmniRoute를 실행해 주세요.)*`;

    return {
      analysis: fallbackText,
      provider: 'local-summary (기본 자동전환)',
      isFallback: true,
      overlappingFiles,
      crCount: crs.length
    };
  }
}

/**
 * Main AI Query Entrypoint
 */
export async function processAiQuery({ query, contextCrs = [], config = {} }) {
  const provider = config.provider || 'local';

  // 1. External LLM Provider Proxy
  if (provider !== 'local') {
    let unavailableReason = null;

    // Quick availability sanity check
    if (provider === 'omniroute') {
      const omniStatus = await checkOmniRouteStatus(config.omnirouteUrl, config.omnirouteApiKey);
      if (!omniStatus.alive) {
        unavailableReason = 'OmniRoute 로컬 서비스(localhost:20128)가 현재 실행 중이지 않아';
      } else if (!omniStatus.ready) {
        unavailableReason = 'OmniRoute API 토큰 인증 실패로 인해';
      }
    } else if (provider === 'custom') {
      if (!config.customUrl || config.customUrl.trim().length < 5) {
        unavailableReason = 'Custom LLM 엔드포인트 URL이 설정되지 않아';
      }
    } else if (provider === 'openai') {
      if (!config.openaiApiKey || config.openaiApiKey === 'proxy-handled-key') {
        unavailableReason = 'OpenAI API 키가 설정되지 않아';
      }
    } else if (provider === 'gemini') {
      const hasAgy = hasCommand('agy');
      const hasKey = Boolean(config.geminiApiKey && config.geminiApiKey !== 'proxy-handled-key');
      if (!hasAgy && !hasKey) {
        unavailableReason = 'Antigravity(agy) CLI 또는 Gemini API 키가 감지되지 않아';
      }
    } else if (provider === 'claude') {
      const hasClaude = hasCommand('claude');
      const hasKey = Boolean(config.claudeApiKey && config.claudeApiKey !== 'proxy-handled-key');
      if (!hasClaude && !hasKey) {
        unavailableReason = 'Claude CLI 또는 Anthropic API 키가 감지되지 않아';
      }
    }

    if (unavailableReason) {
      console.warn(`[AI Provider Unavailable] ${provider}: ${unavailableReason} -> falling back to local NLP`);
      const fallbackResult = analyzeQueryLocally(query, contextCrs);
      const prefixNotice = `> 💡 **알림**: 선택하신 AI 공급자(\`${provider}\`)가 ${unavailableReason} **[로컬 NLP (기본)]** 엔진으로 자동 전환하여 분석했습니다.\n\n`;
      return {
        ...fallbackResult,
        answer: prefixNotice + fallbackResult.answer,
        provider: 'local-nlp (기본값으로 자동 전환)',
        isFallback: true,
        fallbackNotice: `${unavailableReason} [로컬 NLP (기본)] 값으로 동작했습니다.`
      };
    }

    try {
      const localAnalysis = analyzeQueryLocally(query, contextCrs);
      let deepDiffContext = '';
      
      if (config.useDeepAnalysis) {
        deepDiffContext = await collectDeepDiffs(localAnalysis, config.sshConfig);
      }

      const systemPrompt = 'You are an expert telecom SSW software engineer analyzing Mantis bug CRs. Respond in helpful Korean markdown.';
      let userPrompt = `Query: ${query}\n\nTop Matched CRs:\n${JSON.stringify(localAnalysis.matchedCrs.slice(0, 5), null, 2)}`;
      if (deepDiffContext) {
        userPrompt += `\n${deepDiffContext}\n\nPlease perform a deep analysis on the actual code diffs provided above. Explain the changes and provide a comprehensive conclusion based on the code.`;
      }

      const res = await callLLM({ systemPrompt, userPrompt, config });
      return {
        answer: res.content,
        matchedCrs: localAnalysis.matchedCrs,
        provider: res.provider
      };
    } catch (err) {
      console.warn(`[AI Proxy Error: ${provider}] Fallback to local NLP analyzer:`, err.message);
      const fallbackResult = analyzeQueryLocally(query, contextCrs);
      const prefixNotice = `> ⚠️ **알림**: 선택하신 AI 공급자(\`${provider}\`) 응답 실패 (${err.message})로 인해 **[로컬 NLP (기본)]** 엔진으로 안전하게 자동 전환하여 결과를 생성했습니다.\n\n`;
      return {
        ...fallbackResult,
        answer: prefixNotice + fallbackResult.answer,
        provider: 'local-nlp (기본값으로 자동 전환)',
        isFallback: true,
        fallbackNotice: `선택하신 [${provider}] 응답 실패로 인해 [로컬 NLP (기본)] 값으로 동작했습니다.`
      };
    }
  }

  // 2. Default: Intelligent Local NLP Analyzer
  return analyzeQueryLocally(query, contextCrs);
}

