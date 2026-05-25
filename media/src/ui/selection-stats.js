/**
 * Selection Stats Bar — shows count, sum, avg, min, max for selected cells.
 * All calculations are done backend-side via SQL queries.
 * Debounced to avoid spamming the backend during drag selection.
 */

import { getSelection } from './selection.js';
import { sendMessage } from '../core/messaging.js';

let statsBar = null;
let debounceTimer = null;

export function initSelectionStats() {
  statsBar = document.getElementById('selectionStats');
  if (!statsBar) {
    statsBar = createStatsBar();
  }
}

/** Called on selection change — debounces and sends request to backend. */
export function updateSelectionStats() {
  if (debounceTimer) { clearTimeout(debounceTimer); }
  debounceTimer = setTimeout(requestStats, 150);
}

/** Called when the backend responds with stats. */
export function onSelectionStatsResult(data) {
  if (!statsBar) { return; }

  if (!data || data.count === 0) {
    statsBar.classList.add('hidden');
    return;
  }

  statsBar.classList.remove('hidden');

  const countEl = statsBar.querySelector('[data-stat="count"]');
  const sumEl = statsBar.querySelector('[data-stat="sum"]');
  const avgEl = statsBar.querySelector('[data-stat="avg"]');
  const minEl = statsBar.querySelector('[data-stat="min"]');
  const maxEl = statsBar.querySelector('[data-stat="max"]');

  if (countEl) { countEl.textContent = data.count.toLocaleString(); }

  if (data.hasNumeric && data.sum !== undefined) {
    if (sumEl) { sumEl.textContent = formatNumber(data.sum); }
    if (avgEl) { avgEl.textContent = formatNumber(data.avg); }
    if (minEl) { minEl.textContent = formatNumber(data.min); }
    if (maxEl) { maxEl.textContent = formatNumber(data.max); }

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

function requestStats() {
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

  // Build array of column indices
  const columns = [];
  for (let c = minCol; c <= maxCol; c++) {
    columns.push(c);
  }

  sendMessage({ type: 'selectionStats', columns, startRow: minRow, endRow: maxRow });
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
  if (n === undefined || n === null) { return '-'; }
  if (Number.isInteger(n)) { return n.toLocaleString(); }
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
