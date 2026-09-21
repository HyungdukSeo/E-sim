import { diffLines, Change } from 'diff';

export interface DiffLine {
  lineNum: number | null;
  text: string;
  type: 'unchanged' | 'added' | 'removed' | 'spacer';
}

export interface AlignedDiffRow {
  left: DiffLine;
  right: DiffLine;
  isModified: boolean;
}

export interface DiffChunk {
  type: 'added' | 'removed' | 'modified';
  startRow: number;
  rowCount: number;
  leftLineStart: number | null;
  leftLineEnd: number | null;
  rightLineStart: number | null;
  rightLineEnd: number | null;
}

export interface AlignedDiffResult {
  rows: AlignedDiffRow[];
  chunks: DiffChunk[];
  totalChanges: number;
}

export function computeAlignedDiff(leftText: string, rightText: string): AlignedDiffResult {
  if (!leftText && !rightText) {
    return { rows: [], chunks: [], totalChanges: 0 };
  }

  const changes: Change[] = diffLines(leftText, rightText);
  const rows: AlignedDiffRow[] = [];
  const chunks: DiffChunk[] = [];
  let totalChanges = 0;

  let leftLineNum = 1;
  let rightLineNum = 1;

  let i = 0;
  while (i < changes.length) {
    const current = changes[i];
    const next = i + 1 < changes.length ? changes[i + 1] : null;

    // Check for a modified block: removed followed by added, or added followed by removed
    if (current.removed && next && next.added) {
      // Modified chunk (replace)
      const removedLines = current.value.replace(/\n$/, '').split('\n');
      const addedLines = next.value.replace(/\n$/, '').split('\n');
      const maxLen = Math.max(removedLines.length, addedLines.length);

      const chunkStartRow = rows.length;
      const leftStart = leftLineNum;
      const rightStart = rightLineNum;

      for (let k = 0; k < maxLen; k++) {
        const leftTxt = k < removedLines.length ? removedLines[k] : '';
        const rightTxt = k < addedLines.length ? addedLines[k] : '';

        const leftLine: DiffLine = k < removedLines.length
          ? { lineNum: leftLineNum++, text: leftTxt, type: 'removed' }
          : { lineNum: null, text: '', type: 'spacer' };

        const rightLine: DiffLine = k < addedLines.length
          ? { lineNum: rightLineNum++, text: rightTxt, type: 'added' }
          : { lineNum: null, text: '', type: 'spacer' };

        rows.push({
          left: leftLine,
          right: rightLine,
          isModified: true
        });
      }

      chunks.push({
        type: 'modified',
        startRow: chunkStartRow,
        rowCount: maxLen,
        leftLineStart: leftStart,
        leftLineEnd: leftLineNum - 1,
        rightLineStart: rightStart,
        rightLineEnd: rightLineNum - 1
      });
      totalChanges++;
      i += 2;
    } else if (current.added && next && next.removed) {
      // Inverted modified chunk
      const addedLines = current.value.replace(/\n$/, '').split('\n');
      const removedLines = next.value.replace(/\n$/, '').split('\n');
      const maxLen = Math.max(removedLines.length, addedLines.length);

      const chunkStartRow = rows.length;
      const leftStart = leftLineNum;
      const rightStart = rightLineNum;

      for (let k = 0; k < maxLen; k++) {
        const leftTxt = k < removedLines.length ? removedLines[k] : '';
        const rightTxt = k < addedLines.length ? addedLines[k] : '';

        const leftLine: DiffLine = k < removedLines.length
          ? { lineNum: leftLineNum++, text: leftTxt, type: 'removed' }
          : { lineNum: null, text: '', type: 'spacer' };

        const rightLine: DiffLine = k < addedLines.length
          ? { lineNum: rightLineNum++, text: rightTxt, type: 'added' }
          : { lineNum: null, text: '', type: 'spacer' };

        rows.push({
          left: leftLine,
          right: rightLine,
          isModified: true
        });
      }

      chunks.push({
        type: 'modified',
        startRow: chunkStartRow,
        rowCount: maxLen,
        leftLineStart: leftStart,
        leftLineEnd: leftLineNum - 1,
        rightLineStart: rightStart,
        rightLineEnd: rightLineNum - 1
      });
      totalChanges++;
      i += 2;
    } else if (current.removed) {
      // Only removed lines
      const removedLines = current.value.replace(/\n$/, '').split('\n');
      const chunkStartRow = rows.length;
      const leftStart = leftLineNum;

      for (const line of removedLines) {
        rows.push({
          left: { lineNum: leftLineNum++, text: line, type: 'removed' },
          right: { lineNum: null, text: '', type: 'spacer' },
          isModified: true
        });
      }

      chunks.push({
        type: 'removed',
        startRow: chunkStartRow,
        rowCount: removedLines.length,
        leftLineStart: leftStart,
        leftLineEnd: leftLineNum - 1,
        rightLineStart: null,
        rightLineEnd: null
      });
      totalChanges++;
      i++;
    } else if (current.added) {
      // Only added lines
      const addedLines = current.value.replace(/\n$/, '').split('\n');
      const chunkStartRow = rows.length;
      const rightStart = rightLineNum;

      for (const line of addedLines) {
        rows.push({
          left: { lineNum: null, text: '', type: 'spacer' },
          right: { lineNum: rightLineNum++, text: line, type: 'added' },
          isModified: true
        });
      }

      chunks.push({
        type: 'added',
        startRow: chunkStartRow,
        rowCount: addedLines.length,
        leftLineStart: null,
        leftLineEnd: null,
        rightLineStart: rightStart,
        rightLineEnd: rightLineNum - 1
      });
      totalChanges++;
      i++;
    } else {
      // Unchanged lines
      const unchangedLines = current.value.replace(/\n$/, '').split('\n');
      for (const line of unchangedLines) {
        rows.push({
          left: { lineNum: leftLineNum++, text: line, type: 'unchanged' },
          right: { lineNum: rightLineNum++, text: line, type: 'unchanged' },
          isModified: false
        });
      }
      i++;
    }
  }

  return { rows, chunks, totalChanges };
}

export interface MultiVersionRow {
  cols: Record<number, DiffLine>;
  isModified: boolean;
}

export interface MultiVersionAlignedResult {
  rows: MultiVersionRow[];
  totalRows: number;
}

export function computeMultiVersionAlignedDiff(
  versions: Array<{ version: number; content: string }>
): MultiVersionAlignedResult {
  if (!versions || versions.length === 0) {
    return { rows: [], totalRows: 0 };
  }

  const verKeys = versions.map(v => v.version);

  if (versions.length === 1) {
    const v0 = versions[0];
    const lines = v0.content.split('\n');
    const rows: MultiVersionRow[] = lines.map((text, idx) => ({
      cols: {
        [v0.version]: { lineNum: idx + 1, text, type: 'unchanged' }
      },
      isModified: false
    }));
    return { rows, totalRows: rows.length };
  }

  // If 2 versions, use the high-precision 2-way aligned diff
  if (versions.length === 2) {
    const res = computeAlignedDiff(versions[0].content, versions[1].content);
    const rows: MultiVersionRow[] = res.rows.map(r => ({
      cols: {
        [versions[0].version]: r.left,
        [versions[1].version]: r.right
      },
      isModified: r.isModified
    }));
    return { rows, totalRows: rows.length };
  }

  // For N >= 3: Progressive alignment
  const grid: Array<Record<number, DiffLine>> = [];
  const v0 = versions[0];
  const lines0 = v0.content.split('\n');
  for (let i = 0; i < lines0.length; i++) {
    grid.push({
      [v0.version]: { lineNum: i + 1, text: lines0[i], type: 'unchanged' }
    });
  }

  for (let k = 1; k < versions.length; k++) {
    const prev = versions[k - 1];
    const curr = versions[k];
    const changes = diffLines(prev.content, curr.content);

    // Track the row indices in the current grid where prev.version has a non-spacer line
    const prevRowIndices: number[] = [];
    for (let r = 0; r < grid.length; r++) {
      const cell = grid[r][prev.version];
      if (cell && cell.type !== 'spacer') {
        prevRowIndices.push(r);
      }
    }

    let prevCursor = 0;
    let currLineNum = 1;

    for (const change of changes) {
      if (change.added) {
        const addedLines = change.value.replace(/\n$/, '').split('\n');
        // Insert at the position before the current prevRowIndex (or at the end if cursor is at end)
        const insertAt = prevCursor < prevRowIndices.length ? prevRowIndices[prevCursor] : grid.length;

        const newRows: Array<Record<number, DiffLine>> = [];
        for (const line of addedLines) {
          const newRow: Record<number, DiffLine> = {
            [curr.version]: { lineNum: currLineNum++, text: line, type: 'added' }
          };
          for (let p = 0; p < k; p++) {
            newRow[versions[p].version] = { lineNum: null, text: '', type: 'spacer' };
          }
          newRows.push(newRow);
        }

        grid.splice(insertAt, 0, ...newRows);

        // Shift all subsequent prevRowIndices by the number of inserted rows
        const numInserted = newRows.length;
        for (let idx = prevCursor; idx < prevRowIndices.length; idx++) {
          prevRowIndices[idx] += numInserted;
        }
      } else if (change.removed) {
        const removedLines = change.value.replace(/\n$/, '').split('\n');
        for (let r = 0; r < removedLines.length; r++) {
          if (prevCursor < prevRowIndices.length) {
            const rowIdx = prevRowIndices[prevCursor];
            grid[rowIdx][curr.version] = { lineNum: null, text: '', type: 'spacer' };
            prevCursor++;
          }
        }
      } else {
        const sameLines = change.value.replace(/\n$/, '').split('\n');
        for (let s = 0; s < sameLines.length; s++) {
          if (prevCursor < prevRowIndices.length) {
            const rowIdx = prevRowIndices[prevCursor];
            grid[rowIdx][curr.version] = { lineNum: currLineNum++, text: sameLines[s], type: 'unchanged' };
            prevCursor++;
          }
        }
      }
    }

    // Fill any missing rows for curr.version with spacer
    for (let g = 0; g < grid.length; g++) {
      if (!grid[g][curr.version]) {
        grid[g][curr.version] = { lineNum: null, text: '', type: 'spacer' };
      }
    }
  }

  const rows: MultiVersionRow[] = grid.map(colMap => {
    let isModified = false;
    for (const vk of verKeys) {
      const line = colMap[vk];
      if (line && (line.type === 'added' || line.type === 'removed' || line.type === 'spacer')) {
        isModified = true;
        break;
      }
    }
    return { cols: colMap, isModified };
  });

  return { rows, totalRows: rows.length };
}

