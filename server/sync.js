import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { parse } from 'csv-parse/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const BUNDLED_DATA_DIR = path.join(ROOT_DIR, 'data');

// Determine writable data directory
function getWritableDataDirectory() {
  if (process.env.USER_DATA_DIR) {
    const dir = path.join(process.env.USER_DATA_DIR, 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  
  if (process.resourcesPath) {
    const appData = process.env.APPDATA || (process.platform === 'darwin' 
      ? path.join(os.homedir(), 'Library', 'Application Support') 
      : path.join(os.homedir(), '.config'));
    const dir = path.join(appData, 'Mantis CR Ultra Hub', 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  const localDataDir = path.join(ROOT_DIR, 'data');
  if (!fs.existsSync(localDataDir)) fs.mkdirSync(localDataDir, { recursive: true });
  return localDataDir;
}

export const DATA_DIR = getWritableDataDirectory();
export const DB_FILE = path.join(DATA_DIR, 'cr_database.json');
export const META_FILE = path.join(DATA_DIR, 'cr_meta.json');

// Auto-seed bundled database if user data directory is empty
function autoSeedBundledDatabase() {
  try {
    const bundledDb = path.join(BUNDLED_DATA_DIR, 'cr_database.json');
    const bundledMeta = path.join(BUNDLED_DATA_DIR, 'cr_meta.json');

    if (!fs.existsSync(DB_FILE) && fs.existsSync(bundledDb)) {
      console.log(`[DB] Seeding writable database from bundled data: ${bundledDb} -> ${DB_FILE}`);
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

export function parseCheckinLog(log) {
  if (!log) return { files: [], filePaths: [] };

  const lines = log.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const filesSet = new Set();
  const filePathsSet = new Set();

  for (const line of lines) {
    const cleanLine = line.replace(/^"+|"+$/g, '').trim();
    if (!cleanLine) continue;

    const parts = cleanLine.split(',');
    const rawPath = parts[0] || '';
    
    if (rawPath.includes('/')) {
      const normalizedPath = rawPath.replace(/(_|@@)\/(main|branch|[a-zA-Z0-9_\-\.]+)\/.*$/, '').replace(/_$/, '');
      const fileName = normalizedPath.split('/').pop() || '';
      
      if (fileName) {
        filesSet.add(fileName);
        filePathsSet.add(normalizedPath);
      }
    }
  }

  return {
    files: Array.from(filesSet),
    filePaths: Array.from(filePathsSet)
  };
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
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    inMemoryCrs = JSON.parse(raw);
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
  
  for (const cr of existingCrs) {
    crMap.set(cr.crid, cr);
  }

  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  for (let index = 0; index < records.length; index++) {
    const row = records[index];
    const crid = (row['CRID'] || row['\ufeffCRID'] || row['id'] || String(index + 1)).padStart(7, '0');
    const numericId = parseInt(crid, 10) || (index + 1);
    const summary = row['제목'] || row['Summary'] || row['summary'] || '';
    const checkinLogRaw = row['Check-in Log'] || row['check_in_log'] || '';
    const lastUpdated = row['최종 갱신'] || row['Last Update'] || '';
    const status = (row['상태'] || row['Status'] || 'opened').toLowerCase().trim();

    const existing = crMap.get(crid);

    if (existing) {
      if (existing.lastUpdated !== lastUpdated || existing.status !== status || existing.summary !== summary || existing.checkinLog !== checkinLogRaw) {
        const titleParsed = parseTitleTags(summary);
        const checkinParsed = parseCheckinLog(checkinLogRaw);

        crMap.set(crid, {
          ...existing,
          project: row['프로젝트'] || row['Project'] || existing.project,
          reporter: row['보고자'] || row['Reporter'] || existing.reporter,
          assignee: row['담당자'] || row['Handler'] || row['Assignee'] || existing.assignee,
          productVersion: row['제품 버전'] || row['Product Version'] || existing.productVersion,
          dateSubmitted: row['보고 날짜'] || row['Date Submitted'] || existing.dateSubmitted,
          viewState: row['상태 보기'] || row['View Status'] || existing.viewState,
          lastUpdated,
          summary,
          status,
          targetVersion: row['적용 버전'] || row['Target Version'] || existing.targetVersion,
          checkinLog: checkinLogRaw,
          customer: titleParsed.customer,
          vob: titleParsed.vob,
          module: titleParsed.module,
          authorInTitle: titleParsed.authorInTitle,
          cleanSummary: titleParsed.cleanSummary,
          files: checkinParsed.files,
          filePaths: checkinParsed.filePaths
        });
        updatedCount++;
      } else {
        unchangedCount++;
      }
    } else {
      const titleParsed = parseTitleTags(summary);
      const checkinParsed = parseCheckinLog(checkinLogRaw);

      crMap.set(crid, {
        crid,
        id: numericId,
        project: row['프로젝트'] || row['Project'] || '기타',
        reporter: row['보고자'] || row['Reporter'] || '',
        assignee: row['담당자'] || row['Handler'] || row['Assignee'] || '',
        productVersion: row['제품 버전'] || row['Product Version'] || '',
        dateSubmitted: row['보고 날짜'] || row['Date Submitted'] || '',
        viewState: row['상태 보기'] || row['View Status'] || '공개',
        lastUpdated,
        summary,
        status,
        targetVersion: row['적용 버전'] || row['Target Version'] || '',
        checkinLog: checkinLogRaw,
        customer: titleParsed.customer,
        vob: titleParsed.vob,
        module: titleParsed.module,
        authorInTitle: titleParsed.authorInTitle,
        cleanSummary: titleParsed.cleanSummary,
        files: checkinParsed.files,
        filePaths: checkinParsed.filePaths
      });
      addedCount++;
    }
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
    durationMs,
    dbFilePath: DB_FILE,
    status: 'success'
  };

  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');

  // Update in-memory cache
  inMemoryCrs = allMergedCrs;
  inMemoryMeta = meta;

  console.log(`[Sync Summary] Total: ${allMergedCrs.length} CRs (Added: ${addedCount}, Updated: ${updatedCount}, Unchanged: ${unchangedCount}) in ${durationMs}ms`);

  return { meta, crs: allMergedCrs };
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
 * Scrape full issue details (problem, cause, fix, codeChanges, dbChanges, testProcedure) from view.php?id=...
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

    const details = {
      problem: fields['#1.문제점/요구사항'] || '',
      cause: fields['원인분석'] || '',
      fix: fields['보완/변경내역'] || '',
      codeChanges: fields['소스변경사항'] || '',
      dbChanges: fields['GUI/DB 변경내역'] || '',
      blocks: fields['변경 Library 및 Block'] || fields['패치대상블록'] || '',
      testProcedure: fields['시험검증절차'] || '',
      priority: fields['우선순위'] || '',
      issueReason: fields['#2.발행이유'] || ''
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

