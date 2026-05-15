/**
 * Shared sort utilities for local (client-side) column sorting.
 * Used by query.js and query-result-main.js.
 */

/**
 * Detect whether a column is predominantly numeric by sampling rows.
 * Returns true if >90% of non-empty sampled values are numeric.
 */
export function detectNumeric(rows, colIdx) {
  const sample = Math.min(rows.length, 100);
  let numCount = 0;
  let nonEmpty = 0;
  for (let i = 0; i < sample; i++) {
    const val = (rows[i][colIdx] || '').replace(/[,\s]/g, '');
    if (!val) { continue; }
    nonEmpty++;
    if (!isNaN(Number(val)) && isFinite(Number(val))) { numCount++; }
  }
  return nonEmpty > 0 && (numCount / nonEmpty) > 0.9;
}

/**
 * Sort rows in place by the given column index and direction.
 * Returns the sorted array (same reference).
 */
export function sortRows(rows, colIdx, direction) {
  const dir = direction === 'asc' ? 1 : -1;
  const isNum = detectNumeric(rows, colIdx);

  rows.sort((a, b) => {
    const va = a[colIdx] || '';
    const vb = b[colIdx] || '';
    if (va === vb) { return 0; }
    if (va === '') { return 1; }
    if (vb === '') { return -1; }

    let cmp;
    if (isNum) {
      cmp = parseFloat(va.replace(/[,\s]/g, '')) - parseFloat(vb.replace(/[,\s]/g, ''));
    } else {
      cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
    }
    return cmp * dir;
  });

  return rows;
}
