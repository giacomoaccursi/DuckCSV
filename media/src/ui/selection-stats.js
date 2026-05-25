/**
 * Selection Stats Bar — shows count, sum, avg, min, max for selected cells.
 * Purely frontend calculation (no backend queries).
 * Only reads rows already in cache — never triggers backend fetches.
 * Debounced to avoid blocking during drag selection.
 */

import { getSelection } from './selection.js';
import { getDataWindow } from '../data/data-page.js';

let statsBar = null;
let debounceTimer = null;

/** Max cells to process before bailing (avoids blocking on huge selections). */
const MAX_CELLS = 50000;

export function initSelectionStats() {
  statsBar = document.getElementById('selectionStats');
  if (!statsBar) {
    statsBar = createStatsBar();
  }
}

export function updateSelectionStats() {
  if (debounceTimer) { clearTimeout(debounceTimer); }
  debounceTimer = setTimeout(computeStats, 80);
}

function computeStats() {
  if (!statsBar) { return; }

  const selection = getSelection();
  if (!selection) {
    statsBar.classList.add('hidden');
    return;
  }

  const minRow = Math.min(selection.startRow, selection.endRow);
  const maxRow = Math.max(selection.startRow, selection.endRow);
  const minCol = Math.min(selection.startCol, selection.endCol);
  const maxCol = Math.max(selection.startCol, selection.endCol);

  // Single cell — don't show stats
  if (minRow === maxRow && minCol === maxCol) {
    statsBar.classList.add('hidden');
    return;
  }

  const dw = getDataWindow();
  if (!dw) {
    statsBar.classList.add('hidden');
    return;
  }

  // Collect numeric values from selection — only from cached rows
  const numericValues = [];
  let totalCount = 0;
  let cellsProcessed = 0;
  const colSpan = maxCol - minCol + 1;

  for (let r = minRow; r <= maxRow; r++) {
    // Only read rows already in cache — don't trigger fetches
    if (!dw.isLoaded(r)) { continue; }
    const row = dw.getRow(r);
    if (!row) { continue; }

    for (let c = minCol; c <= maxCol; c++) {
      totalCount++;
      cellsProcessed++;
      const cell = row[c];
      if (cell !== null && cell !== undefined && cell !== '') {
        const num = Number(cell);
        if (!isNaN(num)) {
          numericValues.push(num);
        }
      }
    }

    // Bail if we've processed too many cells
    if (cellsProcessed >= MAX_CELLS) { break; }
  }

  if (totalCount === 0) {
    statsBar.classList.add('hidden');
    return;
  }

  statsBar.classList.remove('hidden');

  const countEl = statsBar.querySelector('[data-stat="count"]');
  const sumEl = statsBar.querySelector('[data-stat="sum"]');
  const avgEl = statsBar.querySelector('[data-stat="avg"]');
  const minEl = statsBar.querySelector('[data-stat="min"]');
  const maxEl = statsBar.querySelector('[data-stat="max"]');

  // For count, show the full selection size (not just cached)
  const fullCount = (maxRow - minRow + 1) * colSpan;
  if (countEl) { countEl.textContent = fullCount.toLocaleString(); }

  if (numericValues.length > 0) {
    const sum = numericValues.reduce((a, b) => a + b, 0);
    const avg = sum / numericValues.length;
    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);

    if (sumEl) { sumEl.textContent = formatNumber(sum); }
    if (avgEl) { avgEl.textContent = formatNumber(avg); }
    if (minEl) { minEl.textContent = formatNumber(min); }
    if (maxEl) { maxEl.textContent = formatNumber(max); }

    if (sumEl) { sumEl.parentElement.classList.remove('hidden'); }
    if (avgEl) { avgEl.parentElement.classList.remove('hidden'); }
    if (minEl) { minEl.parentElement.classList.remove('hidden'); }
    if (maxEl) { maxEl.parentElement.classList.remove('hidden'); }
  } else {
    if (sumEl) { sumEl.parentElement.classList.add('hidden'); }
    if (avgEl) { avgEl.parentElement.classList.add('hidden'); }
    if (minEl) { minEl.parentElement.classList.add('hidden'); }
    if (maxEl) { maxEl.parentElement.classList.add('hidden'); }
  }
}

function createStatsBar() {
  const bar = document.createElement('div');
  bar.id = 'selectionStats';
  bar.className = 'selection-stats hidden';
  bar.innerHTML = `
    <span class="selection-stat">Count: <b data-stat="count">0</b></span>
    <span class="selection-stat">Sum: <b data-stat="sum">0</b></span>
    <span class="selection-stat">Avg: <b data-stat="avg">0</b></span>
    <span class="selection-stat">Min: <b data-stat="min">0</b></span>
    <span class="selection-stat">Max: <b data-stat="max">0</b></span>
  `;

  const tableContainer = document.getElementById('tableContainer');
  if (tableContainer) {
    tableContainer.appendChild(bar);
  } else {
    document.getElementById('app').appendChild(bar);
  }

  return bar;
}

function formatNumber(n) {
  if (Number.isInteger(n)) { return n.toLocaleString(); }
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
