import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { DATA_DIR } from './paths.js';
import { getVobList } from './diff-cache.js';

/**
 * Zero-dependency concurrency limiter (drops external p-limit requirement)
 */
function pLimit(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    active--;
    if (queue.length > 0) {
      const item = queue.shift();
      item();
    }
  };
  return function (fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++;
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(next);
      };
      if (active < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

const VOB_TREE_CACHE_FILE = path.join(DATA_DIR, 'vob_tree.json');

/**
 * Extract clean VOB name from text or title
 */
function extractVobCandidate(text) {
  if (!text) return '';
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/[\[\]\(\)]/g, ' ').trim();
  const match = clean.match(/\b([A-Z0-9_]{3,30}_[A-Z0-9_]{2,10})\b/);
  return match ? match[1].trim() : '';
}

/**
 * Categorize a VOB into a major family group
 */
export function classifyVobFamily(vobName) {
  const v = (vobName || '').toUpperCase();
  if (v.includes('REL_SSW') || v.startsWith('REL_') || v.includes('_REL_')) return { id: 'rel', name: 'REL 표준 릴리즈', color: 'indigo' };
  if (v.includes('KT') || v.includes('POTS')) return { id: 'kt', name: 'KT 계열', color: 'emerald' };
  if (v.includes('SKB') || v.includes('SKT')) return { id: 'skb', name: 'SKB 계열', color: 'rose' };
  if (v.includes('LGU') || v.includes('LGT') || v.includes('LG_') || v.includes('LGD') || v.includes('LGH')) return { id: 'lgu', name: 'LGU+ 계열', color: 'fuchsia' };
  if (v.includes('KCT')) return { id: 'kct', name: 'KCT 계열', color: 'amber' };
  if (v.includes('HDAE') || v.includes('HYUNDAI') || v.includes('AUTOEVER')) return { id: 'hdae', name: '현대오토에버', color: 'cyan' };
  if (v.includes('INTL') || v.includes('XVR') || v.includes('MGCF') || v.includes('EMS') || v.includes('CSCF')) return { id: 'infra', name: '인프라/글로벌/기타', color: 'blue' };
  return { id: 'etc', name: '기타/특수 VOB', color: 'slate' };
}

/**
 * Scrape Mantis "VOB 생성" project issues to obtain official Base VOB definitions
 */
export async function scrapeMantisVobLineage(crs) {
  const vobCreateCrs = (crs || []).filter(c =>
    c.project === 'VOB 생성' || (c.summary && (c.summary.includes('VOB 생성') || c.summary.includes('vob 생성')))
  );

  console.log(`[VobTree] Found ${vobCreateCrs.length} VOB creation records. Fetching Base VOB from Mantis...`);

  const limit = pLimit(12);
  const mappings = [];

  const tasks = vobCreateCrs.map(cr => limit(async () => {
    try {
      const numericId = parseInt(cr.crid || cr.id, 10);
      const res = await axios.get(`http://192.168.16.200/view.php?id=${numericId}`, {
        timeout: 6000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Mantis CR Tree Indexer)' }
      });
      const html = res.data;
      const cleanLines = html.replace(/<[^>]+>/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);

      let baseVobRaw = '';
      let historyLines = [];
      let inHistory = false;

      for (let i = 0; i < cleanLines.length; i++) {
        const line = cleanLines[i];
        if (line.includes('기준 VOB이름') || line.includes('기준 VOB') || line.includes('기준VOB')) {
          baseVobRaw = cleanLines[i + 1] || '';
        }
        if (line.includes('[VOB] History')) {
          inHistory = true;
          continue;
        }
        if (inHistory) {
          if (line.startsWith('(') && line.includes('==>')) {
            historyLines.push(line);
          } else if (line.includes('[VOB]') || line.includes('001') || line.includes('수정일시')) {
            inHistory = false;
          }
        }
      }

      // 1. Identify target VOB
      let targetVob = extractVobCandidate(cr.summary);
      if (!targetVob) {
        // Fallback from HTML lines
        for (const line of cleanLines) {
          if (line.includes('[VOB] 생성 VOB이름') || line.includes('생성 VOB이름')) {
            targetVob = extractVobCandidate(line);
            if (targetVob) break;
          }
        }
      }

      // 2. Identify base VOB
      let baseVob = extractVobCandidate(baseVobRaw);
      if (!baseVob && (cr.summary.includes('<-') || cr.summary.includes('<='))) {
        // Parse "<- 32A" or "<= 40A" pattern
        const arrowMatch = cr.summary.match(/(?:<-|<=)\s*([A-Za-z0-9_]+)/);
        if (arrowMatch) {
          const rawToken = arrowMatch[1].trim();
          if (rawToken.includes('_')) {
            baseVob = rawToken;
          } else if (targetVob) {
            // Reconstruct full prefix e.g. POTS_KT_34A <- 32A => POTS_KT_32A
            const prefix = targetVob.substring(0, targetVob.lastIndexOf('_') + 1);
            baseVob = prefix + rawToken;
          }
        }
      }

      if (targetVob) {
        mappings.push({
          crid: cr.crid,
          targetVob,
          baseVob: baseVob || null,
          historyLines,
          summary: cr.summary,
          date: cr.dateSubmitted || null,
          reporter: cr.reporter || null,
          assignee: cr.assignee || null
        });
      }
    } catch (_) {
      // Offline fallback: rely on summary parsing
      const targetVob = extractVobCandidate(cr.summary);
      if (targetVob) {
        let baseVob = null;
        const arrowMatch = cr.summary.match(/(?:<-|<=)\s*([A-Za-z0-9_]+)/);
        if (arrowMatch) {
          const rawToken = arrowMatch[1].trim();
          if (rawToken.includes('_')) {
            baseVob = rawToken;
          } else {
            const prefix = targetVob.substring(0, targetVob.lastIndexOf('_') + 1);
            baseVob = prefix + rawToken;
          }
        }
        mappings.push({
          crid: cr.crid,
          targetVob,
          baseVob,
          summary: cr.summary,
          date: cr.dateSubmitted || null,
          reporter: cr.reporter || null,
          assignee: cr.assignee || null
        });
      }
    }
  }));

  await Promise.all(tasks);
  console.log(`[VobTree] Harvested ${mappings.length} VOB mappings from Mantis records.`);
  return mappings;
}

/**
 * Build the full hierarchy of VOBs combining Mantis creation records and real codebase VOB list
 */
export async function buildVobTree(allCrs, forceRefresh = false) {
  // 1. Check local cache first unless forced
  if (!forceRefresh && fs.existsSync(VOB_TREE_CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(VOB_TREE_CACHE_FILE, 'utf-8'));
      if (cached && Array.isArray(cached.nodes) && cached.nodes.length > 0) {
        return cached;
      }
    } catch (_) {}
  }

  const vobList = getVobList(allCrs);
  const mappings = await scrapeMantisVobLineage(allCrs);

  // Map of targetVob -> creation record
  const mappingByTarget = new Map();
  for (const m of mappings) {
    if (!m.targetVob) continue;
    // Keep the one with explicit baseVob if duplicate
    const existing = mappingByTarget.get(m.targetVob);
    if (!existing || (!existing.baseVob && m.baseVob)) {
      mappingByTarget.set(m.targetVob, m);
    }
  }

  // Calculate stats per VOB from allCrs
  const vobStats = new Map();
  for (const v of vobList) {
    vobStats.set(v.vob, { crCount: v.crCount, fileCount: v.fileCount, firstDate: null, lastDate: null });
  }

  for (const cr of allCrs || []) {
    if (!cr.filePaths) continue;
    const date = cr.dateSubmitted ? new Date(cr.dateSubmitted).getTime() : 0;
    for (const fp of cr.filePaths) {
      const vobMatch = fp.match(/\/vobs\/[^/]+\/([^/]+)\//);
      if (!vobMatch) continue;
      const vob = vobMatch[1];
      const s = vobStats.get(vob);
      if (s && date > 0) {
        if (!s.firstDate || date < s.firstDate) s.firstDate = date;
        if (!s.lastDate || date > s.lastDate) s.lastDate = date;
      }
    }
  }

  // Set of all known VOB names (from codebase + Mantis creation records)
  const allKnownVobs = new Set([
    ...vobList.map(v => v.vob),
    ...mappings.map(m => m.targetVob),
    ...mappings.map(m => m.baseVob).filter(Boolean)
  ]);

  // Build node map
  const nodeMap = new Map();

  for (const vob of allKnownVobs) {
    const creation = mappingByTarget.get(vob);
    const stats = vobStats.get(vob) || { crCount: 0, fileCount: 0, firstDate: null, lastDate: null };
    const family = classifyVobFamily(vob);

    let baseVob = creation?.baseVob || null;

    // Self-reference protection
    if (baseVob === vob) baseVob = null;

    nodeMap.set(vob, {
      vob,
      baseVob,
      family: family.id,
      familyName: family.name,
      familyColor: family.color,
      crCount: stats.crCount || 0,
      fileCount: stats.fileCount || 0,
      createdDate: creation?.date || (stats.firstDate ? new Date(stats.firstDate).toISOString().slice(0, 10) : null),
      crid: creation?.crid || null,
      summary: creation?.summary || null,
      historyLines: creation?.historyLines || [],
      reporter: creation?.reporter || null,
      assignee: creation?.assignee || null,
      children: []
    });
  }

  // Heuristic linking for orphan VOBs that have clean numeric progression
  // (e.g. POTS_KT_11A -> POTS_KT_10A if POTS_KT_11A has no explicit base)
  for (const [vob, node] of nodeMap.entries()) {
    if (!node.baseVob) {
      const numMatch = vob.match(/^(.+_)([0-9]{2,4})([A-Z]?)$/);
      if (numMatch) {
        const prefix = numMatch[1];
        const num = parseInt(numMatch[2], 10);
        const suffix = numMatch[3] || '';
        // Look for immediate predecessor e.g. 11A -> 10A, 34A -> 33A/32A
        for (let diff = 1; diff <= 5; diff++) {
          const candidateNum = String(num - diff).padStart(numMatch[2].length, '0');
          const candidateVob = `${prefix}${candidateNum}${suffix}`;
          if (nodeMap.has(candidateVob) && candidateVob !== vob) {
            node.baseVob = candidateVob;
            node.isHeuristicLink = true;
            break;
          }
        }
      }
    }
  }

  // Connect parent -> children
  const roots = [];

  for (const node of nodeMap.values()) {
    if (node.baseVob && nodeMap.has(node.baseVob)) {
      const parent = nodeMap.get(node.baseVob);
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children by createdDate ascending or vob name
  const sortNodes = (nodes) => {
    nodes.sort((a, b) => {
      if (a.createdDate && b.createdDate) return a.createdDate.localeCompare(b.createdDate);
      return a.vob.localeCompare(b.vob);
    });
    for (const n of nodes) {
      if (n.children && n.children.length > 0) {
        sortNodes(n.children);
      }
    }
  };

  sortNodes(roots);

  // Group roots by Family for top-level presentation
  const familyGroups = {};
  for (const root of roots) {
    if (!familyGroups[root.family]) {
      familyGroups[root.family] = {
        id: root.family,
        name: root.familyName,
        color: root.familyColor,
        roots: []
      };
    }
    familyGroups[root.family].roots.push(root);
  }

  // Flat list of all nodes for 0ms instant search
  const flatNodes = Array.from(nodeMap.values()).map(n => ({
    vob: n.vob,
    baseVob: n.baseVob,
    family: n.family,
    familyName: n.familyName,
    familyColor: n.familyColor,
    crCount: n.crCount,
    fileCount: n.fileCount,
    createdDate: n.createdDate,
    crid: n.crid,
    summary: n.summary,
    childCount: n.children.length
  }));

  const payload = {
    updatedAt: new Date().toISOString(),
    totalVobs: nodeMap.size,
    rootCount: roots.length,
    families: Object.values(familyGroups),
    roots,
    nodes: flatNodes
  };

  // Cache to disk
  try {
    fs.writeFileSync(VOB_TREE_CACHE_FILE, JSON.stringify(payload), 'utf-8');
    console.log(`[VobTree] Saved VOB Lineage Tree to ${VOB_TREE_CACHE_FILE} (${payload.totalVobs} VOBs)`);
  } catch (err) {
    console.warn('[VobTree] Cache write warning:', err.message);
  }

  return payload;
}
