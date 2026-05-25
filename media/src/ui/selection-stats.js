/**
 * Selection Stats Bar — shows count, sum, avg, min, max for selected cells.
 * Purely frontend calculation (no backend queries).
 */

import { getSelection } from './selection.js';
import { getDataWindow } from '../data/data-page.js';

let statsBar = null;

export function initSelectionStats() {
  statsBar = document.getElementById('selectionStats');
  if (!statsBar) {
    statsBar = createStatsBar();
  }
}

export function updateSelectionStats() {
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

  // Collect numeric values from selection
  const values = [];
  let totalCount = 0;

  for (let r = minRow; r <= maxRow; r++) {
    const row = dw.getRow(r);
    if (!row) { continue; }
    for (let c = minCol; c <= maxCol; c++) {
      const cell = row[c];
      totalCount++;
      if (cell === null || cell === undefined || cell === '') { continue; }
      const num = Number(cell);
      if (!isNaN(num)) {
        values.push(num);
      }
    }
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

  if (countEl) { countEl.textContent = totalCount.toLocaleString(); }

  if (values.length > 0) {
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    if (sumEl) { sumEl.textContent = formatNumber(sum); }
    if (avgEl) { avgEl.textContent = formatNumber(avg); }
    if (minEl) { minEl.textContent = formatNumber(min); }
    if (maxEl) { maxEl.textContent = formatNumber(max); }

    // Show numeric stats
    if (sumEl) { sumEl.parentElement.classList.remove('hidden'); }
    if (avgEl) { avgEl.parentElement.classList.remove('hidden'); }
    if (minEl) { minEl.parentElement.classList.remove('hidden'); }
    if (maxEl) { maxEl.parentElement.classList.remove('hidden'); }
  } else {
    // Only show count for non-numeric selections
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
