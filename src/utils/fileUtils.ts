export const KNOWN_CODE_EXTS = new Set([
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 's', 'asm',
  'sh', 'bash', 'csh', 'ksh', 'tcsh', 'py', 'pl', 'pm', 'rb',
  'java', 'go', 'rs', 'js', 'ts', 'jsx', 'tsx', 'json', 'xml',
  'yaml', 'yml', 'sql', 'tbl', 'awk', 'sed', 'mk', 'mak',
  'cfg', 'conf', 'ini', 'properties', 'txt', 'md', 'csv', 'log',
  'diff', 'patch', 'pc', 'ec', 'sqc', 'def', 'idl', 'dat', 'fmt',
  'ctl', 'dg', 'xdb', 'ucf', 'tab', 'dil', 'rlt'
]);

export const BINARY_EXTS = new Set([
  'exe', 'o', 'a', 'so', 'dll', 'tar', 'gz', 'zip',
  'class', 'jar', 'png', 'jpg', 'jpeg', 'gif', 'pdf',
  'bin'
]);

export function isPlatformDirectory(nameOrPath: string): boolean {
  if (!nameOrPath) return false;
  const name = nameOrPath.split('/').pop() || nameOrPath;
  return /^(linux|sunos|aix|hp-ux|solaris)_/i.test(name);
}

/**
 * Determine if an entry is a ClearCase directory element or branch activity rather than a source file
 */
export function isDirectoryElement(fileName?: string, filePath?: string, unifiedDiff?: string): boolean {
  const fn = fileName || '';
  const fp = filePath || '';
  if (!fn && !fp) return false;

  // ClearCase branch activity names
  if (fn.startsWith('crdb') || fn.startsWith('cr_') || fp.includes('/crdb') || fp.includes('/cr_')) {
    return true;
  }

  // Explicit directory marker in unified diff
  if (unifiedDiff && unifiedDiff.includes('[DIRECTORY:')) {
    return true;
  }

  const cleanName = fn.split('/').pop() || fn;
  const cleanPathName = fp.split('/').pop() || '';

  // Platform/arch build output directories (e.g. Linux_2.6.32_ICC, SunOS_5.10, etc.)
  if (isPlatformDirectory(cleanName) || isPlatformDirectory(cleanPathName)) {
    return true;
  }

  return false;
}

/**
 * Filter out directory elements and parent paths from an array of paths
 */
export function filterOutDirectories(paths: string[]): string[] {
  if (!paths || paths.length === 0) return [];
  const rawPathSet = new Set(paths);
  const dirPaths = new Set<string>();
  for (const p of paths) {
    let parent = p;
    let slashIdx: number;
    while ((slashIdx = parent.lastIndexOf('/')) > 0) {
      parent = parent.slice(0, slashIdx);
      if (rawPathSet.has(parent)) dirPaths.add(parent);
    }
  }

  return paths.filter(p => {
    if (dirPaths.has(p)) return false;
    if (isDirectoryElement(p, p)) return false;
    return true;
  });
}
