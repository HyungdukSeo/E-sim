import axios from 'axios';
import path from 'path';
import { checkOmniRouteAlive, checkOmniRouteStatus, readOmniRouteToken, readClaudeToken, isInvalidOmniRouteKey, hasCommand, runCliAI } from './cli-models.js';

function isBinaryDiff(fileName, content) {
  if (!fileName) return false;
  const lower = fileName.toLowerCase();
  const binaryExts = ['.so', '.a', '.o', '.bin', '.tar', '.gz', '.zip', '.png', '.jpg', '.jpeg', '.pdf', '.exe', '.dll', '.dylib', '.class', '.jar'];
  if (binaryExts.some(ext => lower.endsWith(ext) || lower.includes(ext + '.'))) return true;
  if (content && typeof content === 'string' && content.includes('\0')) return true;
  return false;
}

function sanitizeDiffText(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/\0/g, '');
}

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
    const rawUrl = config.customUrl.trim().replace(/\/$/, '');
    const endpoint = rawUrl.endsWith('/chat/completions') ? rawUrl : `${rawUrl}/chat/completions`;
    const apiKey = config.apiKey || 'b644f37bc89d3472041218af3976fb9e';
    const model = config.customModel || config.model || 'aico-rag-qwen2.5-coder-7b';

    const resp = await axios.post(endpoint, {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 180000
    });
    return { content: resp.data.choices[0].message.content, provider: `Custom LLM (${model})` };
  }

  // 2. OpenAI / Codex
  if (provider === 'openai') {
    const model = config.openaiModel || config.model || 'gpt-5.5';
    let cliError = null;

    // 1) Codex CLI
    if (hasCommand('codex')) {
      try {
        return await runCliAI('codex', { systemPrompt, userPrompt, model, timeoutMs: 180000 });
      } catch (err) {
        console.warn('[Codex CLI execution failed, trying direct API fallback]:', err.message);
        cliError = err;
      }
    }

    // 2) Direct OpenAI API
    const apiKey = config.openaiApiKey || (config.apiKey && config.apiKey.startsWith('sk-') && !config.apiKey.startsWith('sk-ant-') && !config.apiKey.includes('omniroute') ? config.apiKey : null);
    if (apiKey && apiKey !== 'proxy-handled-key') {
      const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: model.startsWith('gpt-') ? model : 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      }, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 180000
      });
      return { content: resp.data.choices[0].message.content, provider: `OpenAI (${model})` };
    }

    if (cliError) throw cliError;
    throw new Error('Codex CLI 또는 OpenAI API 키가 필요합니다.');
  }

  // 3. Antigravity / Gemini
  if (provider === 'gemini') {
    const model = config.geminiModel || config.model || 'gemini-3.7-flash-high';
    let cliError = null;
    if (hasCommand('agy')) {
      try {
        return await runCliAI('agy', { systemPrompt, userPrompt, model, timeoutMs: 180000 });
      } catch (err) {
        console.warn('[Antigravity(agy) CLI execution failed, trying direct API fallback]:', err.message);
        cliError = err;
      }
    }
    if (config.geminiApiKey && config.geminiApiKey !== 'proxy-handled-key') {
      const apiKey = config.geminiApiKey;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const resp = await axios.post(url, {
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }]
      }, { timeout: 180000 });
      const content = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { content, provider: `Gemini API (${model})` };
    }
    throw new Error('Antigravity(agy) CLI 또는 Gemini API 키가 필요합니다.');
  }

  // 4. Claude Code / Anthropic
  if (provider === 'claude') {
    const model = config.claudeModel || config.model || 'sonnet';
    let cliError = null;
    if (hasCommand('claude')) {
      try {
        return await runCliAI('claude', { systemPrompt, userPrompt, model, timeoutMs: 180000 });
      } catch (err) {
        console.warn('[Claude CLI execution failed, trying direct API/Token fallback]:', err.message);
        cliError = err;
      }
    }
    const detectedToken = readClaudeToken();
    const apiKey = config.claudeApiKey || (config.apiKey && config.apiKey.startsWith('sk-ant-') ? config.apiKey : null) || detectedToken;
    if (apiKey && apiKey !== 'proxy-handled-key') {
      const isOauthToken = apiKey.startsWith('oauth_') || apiKey.length > 80;
      const headers = {
        'anthropic-version': '2023-06-01'
      };
      if (isOauthToken) {
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['anthropic-beta'] = 'oauth-2024-05-20';
      } else {
        headers['x-api-key'] = apiKey;
      }

      const resp = await axios.post('https://api.anthropic.com/v1/messages', {
        model: model.includes('sonnet') ? 'claude-3-5-sonnet-latest' : model,
        max_tokens: 4096,
        system: systemPrompt.replace(/\0/g, ''),
        messages: [{ role: 'user', content: userPrompt.replace(/\0/g, '') }]
      }, {
        headers,
        timeout: 120000
      });
      return { content: resp.data.content?.[0]?.text || '', provider: `Claude API (${model})` };
    }
    if (cliError) throw cliError;
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
 * Built-in Deep Local Diff Analysis Engine
 * Performs AST/heuristic static code analysis on Unified Diffs
 * Generates professional 4-section report without external API dependency
 */
export function buildLocalDiffAnalysisReport({ cr, validDiffs, notice = '' }) {
  const fileStats = (validDiffs || []).map(f => {
    const raw = f.unifiedDiff || '';
    const lines = raw.split('\n');
    let added = 0;
    let deleted = 0;
    const addedCode = [];
    const deletedCode = [];
    const functions = new Set();
    const keywords = new Set();

    for (const l of lines) {
      if (l.startsWith('@@')) {
        const fnMatch = l.match(/@@\s+[^@]+@@\s*(.*)$/);
        if (fnMatch && fnMatch[1]?.trim()) {
          functions.add(fnMatch[1].trim());
        }
      } else if (l.startsWith('+') && !l.startsWith('+++')) {
        added++;
        const trimmed = l.substring(1).trim();
        if (trimmed && addedCode.length < 20) addedCode.push(trimmed);

        if (/exp_date|expire|license|lic_|auth|token|cert|key/i.test(trimmed)) keywords.add('라이센스/인증 검증');
        if (/null|nullptr|nil|!ptr/i.test(trimmed)) keywords.add('널 포인터 예외 방어');
        if (/malloc|calloc|free|new |delete /i.test(trimmed)) keywords.add('동적 메모리 할당/해제');
        if (/mutex|lock|unlock|pthread|atomic|sync/i.test(trimmed)) keywords.add('동시성/스레드 동기화');
        if (/return\s+(-1|false|NULL|err|status)/i.test(trimmed)) keywords.add('오류 조기 반환(Fail-fast)');
        if (/LOG_|ERR|WARN|INFO|printf|syslog/i.test(trimmed)) keywords.add('진단/에러 로깅 강화');
        if (/select|insert|update|delete\s+from|db_|query/i.test(trimmed)) keywords.add('데이터베이스 트랜잭션');
        if (/socket|connect|send|recv|packet|port|ip|tcp|udp/i.test(trimmed)) keywords.add('네트워크 소켓 I/O');
      } else if (l.startsWith('-') && !l.startsWith('---')) {
        deleted++;
        const trimmed = l.substring(1).trim();
        if (trimmed && deletedCode.length < 10) deletedCode.push(trimmed);
      }
    }

    const fileName = f.fileName || '';
    const ext = path.extname(fileName).toLowerCase();
    const isHeader = ext === '.h' || ext === '.hpp';
    const isConfig = ['.json', '.xml', '.conf', '.ini', '.yaml', '.properties'].includes(ext);
    const isSql = ext === '.sql';

    return {
      fileName,
      oldVersion: f.oldVersion || 'prev',
      newVersion: f.newVersion || 'curr',
      added,
      deleted,
      net: added - deleted,
      addedCode,
      deletedCode,
      functions: Array.from(functions),
      keywords: Array.from(keywords),
      isHeader,
      isConfig,
      isSql,
      diffSnippet: raw.length > 2500 ? raw.substring(0, 2500) + '\n... (일부 긴 diff 생략)' : raw
    };
  });

  const totalAdded = fileStats.reduce((sum, s) => sum + s.added, 0);
  const totalDeleted = fileStats.reduce((sum, s) => sum + s.deleted, 0);
  const allKeywords = Array.from(new Set(fileStats.flatMap(s => s.keywords)));
  const allFunctions = Array.from(new Set(fileStats.flatMap(s => s.functions)));
  const hasHeaderChanges = fileStats.some(s => s.isHeader);
  const hasSqlChanges = fileStats.some(s => s.isSql);
  const hasConfigChanges = fileStats.some(s => s.isConfig);

  let riskLevel = '낮음 (Low Risk)';
  const riskFactors = [];
  if (hasHeaderChanges) {
    riskLevel = '중간 (Medium Risk)';
    riskFactors.push('헤더 파일(`.h`) 변경 포함 -> 의존 모듈 전체 재컴파일 및 구조체 ABI 호환성 검증 필요');
  }
  if (hasSqlChanges) {
    riskLevel = '주의 (High Risk)';
    riskFactors.push('DB SQL 스키마/쿼리 변경 포함 -> 데이터베이스 마이그레이션 및 롤백 절차 필수');
  }
  if (hasConfigChanges) {
    riskFactors.push('환경설정/파라미터 변경 포함 -> 배포 시 설정 파일 동기화 필요');
  }
  if (allKeywords.includes('동시성/스레드 동기화')) {
    riskLevel = '주의 (High Risk)';
    riskFactors.push('스레드 동기화/락 제어 로직 변경 -> 데드락 및 경쟁 상태(Race Condition) 시험 필수');
  }
  if (riskFactors.length === 0) {
    riskFactors.push('단일 기능/로직 보완형 변경으로 전반적인 시스템 영향도 안정적임');
  }

  // Section 1: 목적 & 원인
  const summaryText = cr.cleanSummary || cr.summary || '수정 내역';
  const checkinLog = cr.checkinLog?.trim() || '체크인 로그 없음';
  
  let section1 = `### 1. 🎯 수정 핵심 목적 & 버그 원인 분석\n\n` +
    `- **핵심 목적:** ${summaryText}\n` +
    `- **모듈 / 고객사:** \`${cr.module || '미지정'}\` / \`${cr.customer || '미지정'}\`\n` +
    `- **체크인 상세 요약:** ${checkinLog.replace(/\n+/g, ' ')}\n` +
    `- **변경 규모:** 총 **${fileStats.length}개 파일** (${totalAdded > 0 ? `+${totalAdded}` : '0'} 라인 추가, ${totalDeleted > 0 ? `-${totalDeleted}` : '0'} 라인 삭제)\n`;

  if (allKeywords.length > 0) {
    section1 += `- **식별된 핵심 로직 패턴:** ${allKeywords.map(k => `\`${k}\``).join(', ')}\n`;
  }
  if (allFunctions.length > 0) {
    section1 += `- **영향 함수/블록:** ${allFunctions.slice(0, 5).map(fn => `\`${fn}\``).join(', ')}\n`;
  }

  // Section 2: 코드 변경점 상세 요약
  let section2 = `### 2. 🔬 구체적 코드 변경점 상세 요약\n\n`;
  section2 += `| 파일명 | 버전 변화 | 추가 (+) | 삭제 (-) | 순변화 | 감지된 핵심 패턴 |\n`;
  section2 += `| :--- | :---: | :---: | :---: | :---: | :--- |\n`;
  fileStats.forEach(s => {
    const kwText = s.keywords.length > 0 ? s.keywords.join(', ') : (s.isHeader ? '헤더 선언부' : '일반 로직');
    const netText = s.net > 0 ? `+${s.net}` : `${s.net}`;
    section2 += `| \`${s.fileName}\` | \`${s.oldVersion} → ${s.newVersion}\` | **+${s.added}** | **-${s.deleted}** | \`${netText}\` | ${kwText} |\n`;
  });
  section2 += `\n#### 📄 파일별 세부 코드 Diff 분석:\n`;

  fileStats.forEach(s => {
    section2 += `\n##### 🔹 \`${s.fileName}\` (${s.oldVersion} → ${s.newVersion})\n`;
    if (s.keywords.length > 0) {
      section2 += `- **중요 변경 특성:** ${s.keywords.join(' / ')}\n`;
    }
    if (s.functions.length > 0) {
      section2 += `- **수정 위치:** \`${s.functions.join('`, `')}\`\n`;
    }
    if (s.addedCode.length > 0) {
      section2 += `- **주요 추가 로직 발췌:**\n\`\`\`c\n` + s.addedCode.slice(0, 6).join('\n') + `\n\`\`\`\n`;
    }
    if (s.deletedCode.length > 0) {
      section2 += `- **제거/대체된 기존 로직:**\n\`\`\`c\n` + s.deletedCode.slice(0, 4).join('\n') + `\n\`\`\`\n`;
    }
  });

  // Section 3: 잠재적 부작용 & 영향 영역
  let section3 = `### 3. ⚠️ 잠재적 부작용(Side Effects) & 영향 영역\n\n` +
    `- **종합 위험도 평가:** **${riskLevel}**\n` +
    `- **주요 영향 검토 항목:**\n` +
    riskFactors.map(rf => `  - ${rf}`).join('\n') + '\n';
  
  if (allKeywords.includes('오류 조기 반환(Fail-fast)')) {
    section3 += `  - **반환값 호환성:** 오류 발생 시 조기 반환(\`return -1\` 등) 분기가 추가되었으므로 상위 호출자(Caller)에서 해당 반환 코드를 적절히 수신하여 처리하는지 확인 필요\n`;
  }
  if (allKeywords.includes('동적 메모리 할당/해제')) {
    section3 += `  - **메모리 안정성:** 동적 할당 및 해제 로직의 대칭성 검증 및 예외 종료 경로에서의 메모리 누수(Leak) 방지 점검 필요\n`;
  }

  // Section 4: 종합 평가 및 테스트/운영 주의사항
  let section4 = `### 4. 💡 종합 평가 및 테스트/운영 주의사항\n\n` +
    `1. **기능 회귀 테스트 (Regression Test):**\n` +
    `   - 기존 정상 케이스가 신규 추가된 유효성 검사 분기에 의해 오차단되지 않는지 기본 동작 검증\n` +
    `2. **예외 및 경계 조건 테스트 (Boundary Test):**\n` +
    `   - 변경된 로직(${allKeywords.join(', ') || '조건 분기'})의 비정상/경계값 입력 시 정확한 오류 코드 반환 및 로그 기록 확인\n` +
    `3. **운영 로그 모니터링:**\n` +
    `   - 실 서비스 반영 후 신규 추가된 로그 키워드 모니터링을 통한 이상 징후 조기 포착\n`;

  const headerNotice = notice ? `${notice}\n\n` : '';
  return headerNotice + `${section1}\n${section2}\n${section3}\n${section4}`;
}

/**
 * Built-in Deep Local Multiple CR Comparison Engine
 */
export function buildLocalComparisonReport({ crs, diffMap, overlappingFiles, notice = '' }) {
  const crStats = crs.map(cr => {
    const diffs = diffMap[cr.crid]?.files || [];
    const valid = diffs.filter(d => d.hasChanges && d.unifiedDiff);
    const files = valid.map(v => v.fileName);
    const totalAdded = valid.reduce((sum, v) => sum + (v.unifiedDiff?.match(/^\+[^+]/gm)?.length || 0), 0);
    const totalDeleted = valid.reduce((sum, v) => sum + (v.unifiedDiff?.match(/^-[^-]/gm)?.length || 0), 0);
    return {
      crid: cr.crid,
      summary: cr.cleanSummary || cr.summary,
      module: cr.module || '미지정',
      customer: cr.customer || '미지정',
      files,
      valid,
      totalAdded,
      totalDeleted
    };
  });

  // Section 1: 요약 비교표
  let section1 = `### 1. 📊 핵심 변경 목적 및 접근 방식 비교 요약표\n\n`;
  section1 += `| CR 번호 | 제목 요약 | 모듈 / 고객사 | 변경 파일 | 코드 라인 변화 | 핵심 접근 방식 |\n`;
  section1 += `| :---: | :--- | :---: | :---: | :---: | :--- |\n`;
  crStats.forEach(s => {
    const net = s.totalAdded - s.totalDeleted;
    const netStr = net > 0 ? `+${net}` : `${net}`;
    section1 += `| **#${s.crid}** | ${s.summary} | \`${s.module}\` / \`${s.customer}\` | **${s.files.length}개** | +${s.totalAdded}/-${s.totalDeleted} (\`${netStr}\`) | ${s.module} 기능 보완 및 수정 |\n`;
  });

  // Section 2: 공통 수정 파일 및 코드 변경 흐름 비교
  let section2 = `\n### 2. 🔄 공통 수정 파일 및 코드 변경 흐름 비교\n\n`;
  if (overlappingFiles && overlappingFiles.length > 0) {
    section2 += `다음 **${overlappingFiles.length}개 파일**이 여러 CR에서 공통으로 수정되었습니다:\n\n`;
    overlappingFiles.forEach(f => {
      section2 += `#### 📁 공통 파일: \`${f}\`\n`;
      const relatedCRs = crStats.filter(s => s.files.includes(f));
      section2 += `- **수정 참여 CR:** ${relatedCRs.map(r => `#${r.crid}`).join(', ')}\n`;
      relatedCRs.forEach(r => {
        const fileDiff = r.valid.find(v => v.fileName === f);
        const snippet = fileDiff?.unifiedDiff ? fileDiff.unifiedDiff.substring(0, 500) + '...' : 'Diff 없음';
        section2 += `  - **CR #${r.crid} 변경 요약:** \`${fileDiff?.oldVersion} → ${fileDiff?.newVersion}\`\n`;
        section2 += `    \`\`\`diff\n${snippet}\n    \`\`\`\n`;
      });
      section2 += `- **상호 관계 분석:** 동일 파일에 대한 순차적/병렬 수정이 이루어졌으므로, 빌드 시 베이스라인 버전 충돌 및 로직 덮어쓰기 여부 확인이 필요합니다.\n\n`;
    });
  } else {
    section2 += `> ℹ️ **공통 수정 파일 없음 (독립 모듈)**\n> 비교 대상 CR들이 서로 다른 소스 파일을 수정하고 있어 코드 레벨의 직접적인 소스 머지 충돌(Merge Conflict) 가능성은 없습니다.\n\n`;
  }

  // Section 3: 상호 연관성 및 사이드이펙트
  let section3 = `### 3. ⚠️ 상호 연관성 및 사이드이펙트 / 코드 충돌 위험도\n\n`;
  if (overlappingFiles && overlappingFiles.length > 0) {
    section3 += `- **코드 충돌 위험도: [주의/중간]** 공통 파일(\`${overlappingFiles.join(', ')}\`)이 존재하므로 패치 적용 순서에 따라 컴파일 에러 또는 이전 수정사항 덮어쓰기 위험이 있습니다.\n`;
    section3 += `- **통합 빌드 검증:** 각 CR을 개별 반영하지 말고 순차적 머지 후 통합 빌드 및 단위 시험을 수행해야 합니다.\n`;
  } else {
    section3 += `- **코드 충돌 위험도: [안정/낮음]** 각 CR의 수정 범위가 독립된 파일에 국한되어 있어 소스 코드 충돌 위험은 극히 낮습니다.\n`;
    section3 += `- **기능적 상호작용 검증:** 수정된 개별 모듈 간 통신/인터페이스 메시지 규격 호환성을 중점적으로 확인하십시오.\n`;
  }

  // Section 4: 종합 진단 및 권고사항
  let section4 = `\n### 4. 💡 종합 진단 및 권고사항\n\n` +
    `1. **패치 릴리즈 순서 확정:**\n` +
    `   - CR 등록 일자 및 의존성 관계에 따라 이전 CR(#${crs[0]?.crid}) 선반영 후 후속 CR 반영 권고\n` +
    `2. **공통 기능 연계 회귀 시험:**\n` +
    `   - 대상 CR들이 적용된 통합 바이너리를 생성하여 전체 회귀 시험 수행\n` +
    `3. **배포 시 형상 관리 주의사항:**\n` +
    `   - ClearCase/Git 브랜치 병합 시 공통 수정 파일의 변경 내용이 누락되지 않도록 3-way merge 검증 진행\n`;

  const headerNotice = notice ? `${notice}\n\n` : '';
  return headerNotice + `${section1}${section2}${section3}${section4}`;
}

/**
 * 1. Single CR Deep Diff Analysis
 */
export async function analyzeSingleCRDiff({ cr, diffPayload, config = {} }) {
  const files = diffPayload?.files || [];
  const validDiffs = files.filter(f => f.hasChanges && f.unifiedDiff);

  // 1. If provider is explicitly 'local', run the built-in deep analysis engine directly
  if (config.provider === 'local') {
    const analysisReport = buildLocalDiffAnalysisReport({ cr, validDiffs });
    return {
      analysis: analysisReport,
      provider: '로컬 심층 분석 엔진 (사내 보안 모드)',
      fileCount: validDiffs.length
    };
  }

  // 2. External Provider: format diff and call LLM
  let diffText = '';
  validDiffs.forEach(f => {
    let rawDiff = f.unifiedDiff || '';
    if (isBinaryDiff(f.fileName, rawDiff)) {
      diffText += `\n### 파일: \`${f.fileName}\` (${f.oldVersion} -> ${f.newVersion})\n*(바이너리 파일 변경 내역 - 코드 텍스트 분석 대상에서 제외됨)*\n`;
      return;
    }
    rawDiff = sanitizeDiffText(rawDiff);
    const truncated = rawDiff.length > 5000 
      ? rawDiff.substring(0, 5000) + '\n... (일부 긴 diff 생략)' 
      : rawDiff;
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
    const res = await callLLM({ 
      systemPrompt: sanitizeDiffText(systemPrompt), 
      userPrompt: sanitizeDiffText(userPrompt), 
      config 
    });
    return {
      analysis: res.content,
      provider: res.provider,
      fileCount: validDiffs.length
    };
  } catch (err) {
    console.warn(`[AI Diff Analysis Error] ${config.provider || 'unknown'}:`, err.message);
    const notice = `> 💡 **알림**: 선택하신 AI 공급자(\`${config.provider || 'AI'}\`)가 비활성화 또는 일시적 응답 불가 상태여서 **[로컬 심층 분석 엔진 (사내 보안 모드)]**으로 자동 전환하여 전체 분석 리포트를 생성했습니다.\n> *(원인: ${err.message})*`;
    const fallbackAnalysis = buildLocalDiffAnalysisReport({ cr, validDiffs, notice });

    return {
      analysis: fallbackAnalysis,
      provider: '로컬 심층 분석 (자동 전환)',
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

  // 1. If provider is explicitly 'local', run the built-in cross comparison engine directly
  if (config.provider === 'local') {
    const comparisonReport = buildLocalComparisonReport({ crs, diffMap, overlappingFiles });
    return {
      analysis: comparisonReport,
      provider: '로컬 교차 비교 엔진 (사내 보안 모드)',
      overlappingFiles,
      crCount: crs.length
    };
  }

  // 2. External Provider: format diff and call LLM
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
      let rawDiff = v.unifiedDiff || '';
      if (isBinaryDiff(v.fileName, rawDiff)) {
        crsContext += `  * 파일 \`${v.fileName}\`: (바이너리 파일 변경 - 코드 제외)\n`;
        return;
      }
      rawDiff = sanitizeDiffText(rawDiff);
      const truncated = rawDiff.length > 3000 ? rawDiff.substring(0, 3000) + '\n...(생략)' : rawDiff;
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
    const res = await callLLM({ 
      systemPrompt: sanitizeDiffText(systemPrompt), 
      userPrompt: sanitizeDiffText(userPrompt), 
      config 
    });
    return {
      analysis: res.content,
      provider: res.provider,
      overlappingFiles,
      crCount: crs.length
    };
  } catch (err) {
    console.warn(`[AI Compare Error] ${config.provider || 'unknown'}:`, err.message);
    const notice = `> 💡 **알림**: 선택하신 AI 공급자(\`${config.provider || 'AI'}\`)가 비활성화 또는 일시적 응답 불가 상태여서 **[로컬 교차 비교 엔진 (사내 보안 모드)]**으로 자동 전환되었습니다.\n> *(원인: ${err.message})*`;
    const fallbackAnalysis = buildLocalComparisonReport({ crs, diffMap, overlappingFiles, notice });

    return {
      analysis: fallbackAnalysis,
      provider: '로컬 교차 비교 (자동 전환)',
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
      const hasCodex = hasCommand('codex');
      const hasKey = Boolean(config.openaiApiKey && config.openaiApiKey !== 'proxy-handled-key');
      if (!hasCodex && !hasKey) {
        unavailableReason = 'Codex CLI 또는 OpenAI API 키가 감지되지 않아';
      }
    } else if (provider === 'gemini') {
      const hasAgy = hasCommand('agy');
      const hasKey = Boolean(config.geminiApiKey && config.geminiApiKey !== 'proxy-handled-key');
      if (!hasAgy && !hasKey) {
        unavailableReason = 'Antigravity(agy) CLI 또는 Gemini API 키가 감지되지 않아';
      }
    } else if (provider === 'claude') {
      const hasClaude = hasCommand('claude');
      const hasKey = Boolean((config.claudeApiKey && config.claudeApiKey !== 'proxy-handled-key') || readClaudeToken());
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

