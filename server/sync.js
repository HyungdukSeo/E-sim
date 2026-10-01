import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { parse } from 'csv-parse/sync';
import { ROOT_DIR, BUNDLED_DATA_DIR, DATA_DIR, DB_FILE, META_FILE } from './paths.js';
import { deleteCRDiffCache, backgroundDiffIndexer } from './diff-cache.js';

export { ROOT_DIR, BUNDLED_DATA_DIR, DATA_DIR, DB_FILE, META_FILE };

// Auto-seed database only if user data directory is empty and external/bundled source exists
function autoSeedBundledDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      console.log(`[DB] Preserved existing database: ${DB_FILE} (${fs.statSync(DB_FILE).size} bytes)`);
      return;
    }

    const bundledDb = path.join(BUNDLED_DATA_DIR, 'cr_database.json');
    const bundledMeta = path.join(BUNDLED_DATA_DIR, 'cr_meta.json');

    if (fs.existsSync(bundledDb)) {
      console.log(`[DB] Seeding writable database from local/bundled data: ${bundledDb} -> ${DB_FILE}`);
      fs.copyFileSync(bundledDb, DB_FILE);
    }
    if (!fs.existsSync(META_FILE) && fs.existsSync(bundledMeta)) {
      fs.copyFileSync(bundledMeta, META_FILE);
    }
  } catch (err) {
    console.warn('[DB] Auto-seed error (non-fatal):', err.message);
  }
}

autoSeedBundledDatabase();

// In-memory cache for 0ms API response
let inMemoryCrs = null;
let inMemoryMeta = null;

export function parseTitleTags(title) {
  if (!title) return { customer: '', vob: '', module: '', authorInTitle: '', cleanSummary: '' };
  
  let customer = '';
  let vob = '';
  let module = '';
  let authorInTitle = '';
  let cleanSummary = title.trim();

  const match = title.match(/^\[([^,\]]+)(?:,([^\]]*))?\](?:\s*\[([^\]]*)\])?(?:\s*-\s*\[([^\]]*)\])?(?:\s*-\s*\[([^\]]*)\])?\s*(.*)$/);
  
  if (match) {
    customer = (match[1] || '').trim();
    vob = (match[2] || '').trim();
    authorInTitle = (match[4] || '').trim();
    module = (match[5] || '').trim();
    cleanSummary = (match[6] || '').trim();
  } else {
    const brackets = [...title.matchAll(/\[(.*?)\]/g)].map(m => m[1]);
    if (brackets.length >= 1) {
      const first = brackets[0];
      if (first.includes(',')) {
        const parts = first.split(',');
        customer = parts[0].trim();
        vob = parts.slice(1).join(',').trim();
      } else {
        customer = first.trim();
      }
    }
  }

  const normCustomer = customer.toUpperCase();
  if (normCustomer.includes('KT')) customer = 'KT';
  else if (normCustomer.includes('LGU') || normCustomer.includes('LGT')) customer = 'LGU+';
  else if (normCustomer.includes('SKB') || normCustomer.includes('SKT')) customer = 'SKB';
  else if (normCustomer.includes('공통')) customer = '공통';

  return { customer, vob, module, authorInTitle, cleanSummary: cleanSummary || title };
}

/**
 * Determine if an entry is a ClearCase directory element or branch activity rather than a source file
 */
export function isDirectoryElement(fileName, filePath = '') {
  if (!fileName) return false;
  // ClearCase branch activity names
  if (fileName.startsWith('crdb') || fileName.startsWith('cr_')) return true;

  const cleanName = fileName.split('/').pop() || fileName;
  const hasExt = cleanName.includes('.') && !cleanName.startsWith('.');
  if (hasExt) return false; // Typical source file with extension

  // Known extensionless files
  const lower = cleanName.toLowerCase();
  const knownFiles = new Set(['makefile', 'makeall', 'dockerfile', 'readme', 'license', 'cmakelists.txt']);
  if (knownFiles.has(lower) || lower.startsWith('makefile')) return false;

  // Extensionless and not a known build file -> Directory element in ClearCase
  return true;
}

export function parseCheckinLog(log) {
  if (!log) return { files: [], filePaths: [] };

  const lines = log.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rawPaths = [];

  for (const line of lines) {
    const cleanLine = line.replace(/^"+|"+$/g, '').trim();
    if (!cleanLine) continue;

    const parts = cleanLine.split(',');
    const rawPath = parts[0] || '';
    
    if (rawPath.includes('/')) {
      const normalizedPath = rawPath.replace(/(_|@@)\/(main|branch|[a-zA-Z0-9_\-\.]+)\/.*$/, '').replace(/_$/, '');
      const fileName = normalizedPath.split('/').pop() || '';
      
      if (fileName && !isDirectoryElement(fileName, normalizedPath)) {
        rawPaths.push(normalizedPath);
      }
    }
  }

  const uniquePaths = Array.from(new Set(rawPaths));
  // Detect ClearCase directory elements:
  // When a file is added/deleted/renamed in ClearCase, its parent directory element is checked in too.
  // Any path that has children in the same check-in list is 100% a directory element.
  const rawPathSet = new Set(uniquePaths);
  const dirPaths = new Set();
  for (const p of uniquePaths) {
    let parent = p;
    let slashIdx;
    while ((slashIdx = parent.lastIndexOf('/')) > 0) {
      parent = parent.slice(0, slashIdx);
      if (rawPathSet.has(parent)) dirPaths.add(parent);
    }
  }

  const filesSet = new Set();
  const filePathsSet = new Set();

  for (const p of uniquePaths) {
    if (dirPaths.has(p)) continue;
    const fileName = p.split('/').pop() || '';
    if (isDirectoryElement(fileName, p)) continue;
    filesSet.add(fileName);
    filePathsSet.add(p);
  }

  return {
    files: Array.from(filesSet),
    filePaths: Array.from(filePathsSet)
  };
}

/**
 * Filter directory elements from a CR object's files and filePaths
 */
export function cleanCRFilePaths(cr) {
  if (!cr || !Array.isArray(cr.filePaths) || cr.filePaths.length === 0) return cr;

  const rawPaths = cr.filePaths;
  // A path is a directory element if some OTHER path in this same list
  // starts with "<path>/" (i.e. it has a child in this same check-in).
  // Checking that via Array#some inside a loop over every path is O(n^2) —
  // negligible for the typical CR with a handful of files, but this runs
  // for every CR on every server boot (getLocalDatabase's first call), and
  // a large release-style CR can have 1000+ filePaths, making this single
  // function the dominant cost of loading the whole database (measured:
  // ~26s for 7746 CRs, almost entirely this one CR's O(n^2) scan).
  // A directory path is by definition a strict PARENT of some other path
  // (i.e. that other path, with its last "/segment" removed, equals this
  // one) — so build the set of "parent of X" for every X once, in O(n),
  // instead of comparing every pair of paths.
  const rawPathSet = new Set(rawPaths);
  const dirPaths = new Set();
  for (const p of rawPaths) {
    let parent = p;
    let slashIdx;
    while ((slashIdx = parent.lastIndexOf('/')) > 0) {
      parent = parent.slice(0, slashIdx);
      if (rawPathSet.has(parent)) dirPaths.add(parent);
    }
  }

  const filteredPaths = [];
  const filteredFiles = [];
  for (let i = 0; i < rawPaths.length; i++) {
    const fp = rawPaths[i];
    const fn = (cr.files && cr.files[i]) || fp.split('/').pop() || '';
    if (!dirPaths.has(fp) && !isDirectoryElement(fn, fp)) {
      filteredPaths.push(fp);
      filteredFiles.push(fn);
    }
  }

  cr.filePaths = filteredPaths;
  cr.files = filteredFiles;
  return cr;
}

/**
 * Load the existing local database (with in-memory caching)
 */
export function getLocalDatabase() {
  if (inMemoryCrs && inMemoryMeta) {
    return { meta: inMemoryMeta, crs: inMemoryCrs };
  }

  if (!fs.existsSync(DB_FILE)) {
    return { meta: { status: 'empty', totalCount: 0, lastSyncTime: null }, crs: [] };
  }

  try {
    let raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsedCrs = JSON.parse(raw);
    raw = null; // Release 234MB raw UTF-8 string immediately to reduce peak heap allocation
    for (let i = 0; i < parsedCrs.length; i++) {
      delete parsedCrs[i].checkinEntries;
      cleanCRFilePaths(parsedCrs[i]);
    }
    inMemoryCrs = parsedCrs;
    inMemoryMeta = { status: 'cached', totalCount: inMemoryCrs.length, lastSyncTime: null };
    if (fs.existsSync(META_FILE)) {
      inMemoryMeta = JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
    }
    return { meta: inMemoryMeta, crs: inMemoryCrs };
  } catch (err) {
    console.error('[DB] Error reading database file:', err);
    return { meta: { status: 'error', error: err.message }, crs: [] };
  }
}

export function reloadDatabase() {
  inMemoryCrs = null;
  inMemoryMeta = null;
  return getLocalDatabase();
}

/**
 * Sync Mantis Data and Upsert/Merge into single independent database file
 */
export async function syncMantisData(mantisUrl = 'http://192.168.16.200') {
  const exportUrl = `${mantisUrl.replace(/\/$/, '')}/csv_export.php`;
  console.log(`[Sync] Fetching Mantis CSV from ${exportUrl}...`);
  
  const startTime = Date.now();
  let response;
  try {
    response = await axios.get(exportUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/csv,text/plain,*/*'
      }
    });
  } catch (netErr) {
    console.error('[Sync Network Error]', netErr.message);
    const customMsg = `Mantis 서버(${mantisUrl})에 연결할 수 없습니다. (원인: ${netErr.message}) 사내망(VPN 또는 회사 Wi-Fi) 연결 상태를 확인해주세요.`;
    throw new Error(customMsg);
  }

  let csvText = Buffer.from(response.data).toString('utf-8');
  if (csvText.charCodeAt(0) === 0xFEFF) {
    csvText = csvText.slice(1);
  }

  console.log(`[Sync] CSV downloaded (${(csvText.length / 1024 / 1024).toFixed(2)} MB). Parsing records...`);

  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
  });

  const { crs: existingCrs } = getLocalDatabase();
  const crMap = new Map();
  
  // Normalize existing CR keys to 7-digit padded IDs for consistent lookup
  for (const cr of existingCrs) {
    const safeKey = String(cr.crid || cr.id).replace(/^[#\s]+/, '').trim().padStart(7, '0');
    crMap.set(safeKey, cr);
  }

  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let deletedCount = 0;
  const changedCrs = [];
  const serverCridSet = new Set();

  function getFieldValue(row, ...candidateKeys) {
    for (const key of candidateKeys) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
        return String(row[key]).trim();
      }
    }
    // Case-insensitive / BOM-strip fallback
    const entries = Object.entries(row);
    for (const key of candidateKeys) {
      const target = key.replace(/^\ufeff/, '').toLowerCase().trim();
      for (const [k, v] of entries) {
        if (v !== undefined && v !== null && String(v).trim() !== '') {
          const cleanK = k.replace(/^\ufeff/, '').toLowerCase().trim();
          if (cleanK === target) {
            return String(v).trim();
          }
        }
      }
    }
    return '';
  }

  for (let index = 0; index < records.length; index++) {
    const row = records[index];
    const rawCrid = getFieldValue(row, 'CRID', 'id', 'Id', 'ID', '이슈 ID', 'Issue ID', 'issue_id', '번호', '아이디');
    const cleanNumStr = rawCrid ? rawCrid.replace(/^[#\s]+/, '').trim() : '';
    const numericId = cleanNumStr ? (parseInt(cleanNumStr, 10) || (index + 1)) : (index + 1);
    const crid = cleanNumStr ? String(numericId).padStart(7, '0') : String(index + 1).padStart(7, '0');

    // Register all valid ID representations to prevent false-positive deletions
    if (cleanNumStr) {
      serverCridSet.add(crid);
      serverCridSet.add(cleanNumStr);
      serverCridSet.add(String(numericId));
    } else {
      serverCridSet.add(crid);
    }

    const summary = getFieldValue(row, '제목', 'Summary', 'summary');
    const checkinLogRaw = getFieldValue(row, 'Check-in Log', 'check_in_log', '체크인 로그', 'Checkin Log');
    const lastUpdated = getFieldValue(row, '최종 갱신', 'Last Update', 'updated', '수정일시');
    const status = (getFieldValue(row, '상태', 'Status', 'status') || 'opened').toLowerCase().trim();
    const project = getFieldValue(row, '프로젝트', 'Project', 'project') || '기타';
    const reporter = getFieldValue(row, '보고자', 'Reporter', 'reporter');
    const assignee = getFieldValue(row, '담당자', 'Handler', 'Assignee', 'assignee');
    const productVersion = getFieldValue(row, '제품 버전', 'Product Version', 'product_version');
    const dateSubmitted = getFieldValue(row, '보고 날짜', 'Date Submitted', 'date_submitted', '등록일시');
    const viewState = getFieldValue(row, '상태 보기', 'View Status', 'view_status') || '공개';
    const targetVersion = getFieldValue(row, '적용 버전', 'Target Version', 'target_version');

    const existing = crMap.get(crid) || crMap.get(cleanNumStr) || crMap.get(String(numericId));

    if (existing) {
      if (existing.lastUpdated !== lastUpdated || existing.status !== status || existing.summary !== summary || existing.checkinLog !== checkinLogRaw) {
        const titleParsed = parseTitleTags(summary);
        const checkinParsed = parseCheckinLog(checkinLogRaw);

        const updatedCr = {
          ...existing,
          project: project || existing.project,
          reporter: reporter || existing.reporter,
          assignee: assignee || existing.assignee,
          productVersion: productVersion || existing.productVersion,
          dateSubmitted: dateSubmitted || existing.dateSubmitted,
          viewState: viewState || existing.viewState,
          lastUpdated,
          summary,
          status,
          targetVersion: targetVersion || existing.targetVersion,
          checkinLog: checkinLogRaw,
          customer: titleParsed.customer,
          vob: titleParsed.vob,
          module: titleParsed.module,
          authorInTitle: titleParsed.authorInTitle,
          cleanSummary: titleParsed.cleanSummary,
          files: checkinParsed.files,
          filePaths: checkinParsed.filePaths
        };
        crMap.set(crid, updatedCr);
        changedCrs.push(updatedCr);
        updatedCount++;
      } else {
        unchangedCount++;
      }
    } else {
      const titleParsed = parseTitleTags(summary);
      const checkinParsed = parseCheckinLog(checkinLogRaw);

      const newCr = {
        crid,
        id: numericId,
        project,
        reporter,
        assignee,
        productVersion,
        dateSubmitted,
        viewState,
        lastUpdated,
        summary,
        status,
        targetVersion,
        checkinLog: checkinLogRaw,
        customer: titleParsed.customer,
        vob: titleParsed.vob,
        module: titleParsed.module,
        authorInTitle: titleParsed.authorInTitle,
        cleanSummary: titleParsed.cleanSummary,
        files: checkinParsed.files,
        filePaths: checkinParsed.filePaths
      };
      crMap.set(crid, newCr);
      changedCrs.push(newCr);
      addedCount++;
    }
  }

  // Automatically prune CRs that were deleted on Mantis server
  // Safety guard: only purge if records has a plausible count (> 10) to protect against truncated downloads
  if (records.length >= 10) {
    const deletedCridList = [];
    for (const [existingKey, existingCr] of crMap.entries()) {
      const paddedKey = String(existingKey).replace(/^[#\s]+/, '').trim().padStart(7, '0');
      const rawNumKey = String(existingCr.id || parseInt(existingKey, 10));

      const isPresent = serverCridSet.has(existingKey) || 
                        serverCridSet.has(paddedKey) || 
                        serverCridSet.has(rawNumKey);

      if (!isPresent) {
        crMap.delete(existingKey);
        deletedCount++;
        deletedCridList.push(existingKey);
        console.log(`[Sync] Pruned deleted CR #${existingKey} (id: ${rawNumKey}) from local database.`);
        try {
          deleteCRDiffCache(paddedKey);
          deleteCRDiffCache(existingKey);
          deleteCRDiffCache(rawNumKey);
          backgroundDiffIndexer.removeCR(paddedKey);
          backgroundDiffIndexer.removeCR(existingKey);
          backgroundDiffIndexer.removeCR(rawNumKey);
        } catch (e) {
          console.warn(`[Sync] Error cleaning cache for deleted CR #${existingKey}:`, e.message);
        }
      }
    }
    if (deletedCount > 0) {
      console.log(`[Sync] Successfully pruned ${deletedCount} deleted CRs from local DB: ${deletedCridList.slice(0, 30).join(', ')}${deletedCridList.length > 30 ? '...' : ''}`);
    }
  } else if (existingCrs.length > 20 && records.length < 10) {
    console.warn(`[Sync] Safety guard triggered: Mantis returned only ${records.length} records while local DB has ${existingCrs.length}. Skipping deleted CR pruning.`);
  }

  const allMergedCrs = Array.from(crMap.values());
  allMergedCrs.sort((a, b) => b.id - a.id);

  // Write compact JSON (no multi-megabyte whitespace bloat)
  const tempDbFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempDbFile, JSON.stringify(allMergedCrs), 'utf-8');
  fs.renameSync(tempDbFile, DB_FILE);

  const durationMs = Date.now() - startTime;
  const meta = {
    lastSyncTime: new Date().toISOString(),
    totalCount: allMergedCrs.length,
    mantisUrl,
    addedCount,
    updatedCount,
    unchangedCount,
    deletedCount,
    durationMs,
    dbFilePath: DB_FILE,
    status: 'success'
  };

  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');

  // Update in-memory cache
  inMemoryCrs = allMergedCrs;
  inMemoryMeta = meta;

  console.log(`[Sync Summary] Total: ${allMergedCrs.length} CRs (Added: ${addedCount}, Updated: ${updatedCount}, Unchanged: ${unchangedCount}, Deleted: ${deletedCount}) in ${durationMs}ms`);

  return { meta, crs: allMergedCrs, changedCrs, deletedCount };
}

export function importDatabase(importedCrs) {
  if (!Array.isArray(importedCrs)) {
    throw new Error('올바른 CR 배열 데이터 형식이 아닙니다.');
  }

  const { crs: currentCrs } = getLocalDatabase();
  const crMap = new Map();

  for (const cr of currentCrs) crMap.set(cr.crid, cr);

  let added = 0;
  let updated = 0;

  for (const cr of importedCrs) {
    if (!cr.crid) continue;
    delete cr.checkinEntries;
    if (crMap.has(cr.crid)) {
      crMap.set(cr.crid, { ...crMap.get(cr.crid), ...cr });
      updated++;
    } else {
      crMap.set(cr.crid, cr);
      added++;
    }
  }

  const merged = Array.from(crMap.values());
  merged.sort((a, b) => b.id - a.id);

  fs.writeFileSync(DB_FILE, JSON.stringify(merged), 'utf-8');

  const meta = {
    lastSyncTime: new Date().toISOString(),
    totalCount: merged.length,
    addedCount: added,
    updatedCount: updated,
    status: 'success'
  };
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');

  inMemoryCrs = merged;
  inMemoryMeta = meta;

  return { meta, totalCount: merged.length };
}

/**
/**
 * Parse attachments list from Mantis HTML view page
 */
export function parseAttachmentsFromMantisHtml(html) {
  const attachments = [];
  if (!html) return attachments;

  const rowMatch = html.match(/<td[^>]*class=["\x27]category["\x27][^>]*>[\s\S]*?(?:첨부\s*파일|Attached\s*Files)[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  if (!rowMatch) return attachments;

  const cellHtml = rowMatch[1];
  const itemRegex = /<a[^>]+href=["\x27]file_download\.php\?file_id=(\d+)[^"\x27]*["\x27][^>]*>([^<]+)<\/a>\s*(?:\[[^\]]*\])?(?:\s*\(([\d,]+)\s*bytes\))?(?:[\s\S]*?(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}))?/gi;

  let m;
  const seen = new Set();
  while ((m = itemRegex.exec(cellHtml)) !== null) {
    const fileId = m[1];
    let filename = m[2].trim();
    if (!filename || filename === '^' || filename === '&nbsp;' || seen.has(fileId)) continue;
    seen.add(fileId);

    filename = filename.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const rawBytes = m[3] ? parseInt(m[3].replace(/,/g, ''), 10) : undefined;
    let formattedSize = m[3] ? m[3] + ' bytes' : '';
    if (rawBytes !== undefined) {
      if (rawBytes >= 1024 * 1024) {
        formattedSize = (rawBytes / (1024 * 1024)).toFixed(1) + ' MB';
      } else if (rawBytes >= 1024) {
        formattedSize = (rawBytes / 1024).toFixed(1) + ' KB';
      } else {
        formattedSize = rawBytes + ' B';
      }
    }

    const date = (m[4] || '').trim();
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'].includes(ext);

    attachments.push({
      id: fileId,
      filename,
      size: formattedSize,
      sizeBytes: rawBytes,
      date,
      downloadUrl: `file_download.php?file_id=${fileId}&type=bug`,
      isImage,
      extension: ext
    });
  }

  return attachments;
}

/**
 * Scrape full issue details (problem, cause, fix, codeChanges, dbChanges, testProcedure, attachments) from view.php?id=...
 */
export async function fetchCRPageDetails(bugId, mantisUrl = 'http://192.168.16.200') {
  const numericId = parseInt(bugId, 10);
  const url = `${mantisUrl.replace(/\/$/, '')}/view.php?id=${numericId}`;
  
  try {
    const resp = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,*/*'
      }
    });

    const html = resp.data;
    const fields = {};
    const regex = /<td class="category"[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>/gis;
    let match;

    while ((match = regex.exec(html)) !== null) {
      const cat = match[1].replace(/<[^>]+>/g, '').trim();
      let val = match[2].replace(/<br\s*\/?>/gi, '\n');
      val = val.replace(/<[^>]+>/g, '').trim();
      val = val.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      fields[cat] = val;
    }

    const attachments = parseAttachmentsFromMantisHtml(html);

    const details = {
      problem: fields['#1.문제점/요구사항'] || '',
      cause: fields['원인분석'] || '',
      fix: fields['보완/변경내역'] || '',
      codeChanges: fields['소스변경사항'] || '',
      dbChanges: fields['GUI/DB 변경내역'] || '',
      blocks: fields['변경 Library 및 Block'] || fields['패치대상블록'] || '',
      testProcedure: fields['시험검증절차'] || '',
      priority: fields['우선순위'] || '',
      issueReason: fields['#2.발행이유'] || '',
      attachments
    };

    // Update in-memory and persist to DB file asynchronously
    const idStr = String(numericId).padStart(7, '0');
    const { crs } = getLocalDatabase();
    const found = crs.find(c => c.crid === idStr || c.id === numericId);

    if (found) {
      found.details = details;
      found.detailsFetched = true;

      // Save asynchronously
      setTimeout(() => {
        try {
          fs.writeFileSync(DB_FILE, JSON.stringify(crs), 'utf-8');
        } catch (e) {
          console.warn('[DB Save Details Error]', e.message);
        }
      }, 50);
    }

    return details;
  } catch (err) {
    console.warn(`[Detail Scraper] Failed to fetch CR #${bugId} from Mantis:`, err.message);
    return null;
  }
}

