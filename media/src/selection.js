/**
 * Cell/row/column selection with copy support (Excel-like).
 *
 * - Click cell: select single cell
 * - Click row number: select entire row
 * - Ctrl/Cmd+Click header: select entire column
 * - Shift+Click: extend selection range
 * - Cmd+C / Ctrl+C: copy selection as tab-separated text
 */

import { dom } from './dom.js';
import { state } from './state.js';
import { sendMessage } from './messaging.js';

// Selection state: { startRow, startCol, endRow, endCol } or null
let selection = null;
let selectionMode = 'none'; // 'cell' | 'row' | 'column' | 'none'
let isDragging = false;

export function getSelection() { return selection; }

export function clearSelection() {
  selection = null;
  selectionMode = 'none';
  removeHighlights();
}

export function handleCellClick(e) {
  const td = e.target.closest('td.editable-cell');
  if (!td) { return; }

  const row = parseInt(td.closest('tr').dataset.rowIndex, 10);
  const col = parseInt(td.dataset.columnIndex, 10);
  if (isNaN(row) || isNaN(col)) { return; }

  if (e.shiftKey && selection) {
    // Extend selection
    selection.endRow = row;
    selection.endCol = col;
  } else {
    selection = { startRow: row, startCol: col, endRow: row, endCol: col };
    selectionMode = 'cell';
  }

  applyHighlights();
}

export function handleRowNumberClick(e) {
  const td = e.target.closest('td.row-number');
  if (!td) { return; }

  const tr = td.closest('tr');
  const row = parseInt(tr.dataset.rowIndex, 10);
  if (isNaN(row)) { return; }

  const maxCol = state.headers.length - 1;

  // Toggle: if same row already selected, deselect
  if (selection && selectionMode === 'row' && selection.startRow === row && selection.endRow === row) {
    clearSelection();
    return;
  }

  selection = { startRow: row, startCol: 0, endRow: row, endCol: maxCol };
  selectionMode = 'row';
  isDragging = true;
  document.body.classList.add('selecting');

  applyHighlights();

  // Drag to extend row selection
  const onMove = (ev) => {
    const rowEl = ev.target.closest('tr[data-row-index]');
    if (!rowEl) { return; }
    const newRow = parseInt(rowEl.dataset.rowIndex, 10);
    if (isNaN(newRow)) { return; }
    selection.endRow = newRow;
    applyHighlights();
  };

  const onUp = () => {
    isDragging = false;
    document.body.classList.remove('selecting');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

export function handleSelectAll() {
  const maxRow = state.rows.length - 1;
  const maxCol = state.headers.length - 1;
  if (maxRow < 0 || maxCol < 0) { return; }

  // Toggle: if already all selected, deselect
  if (selection && selection.startRow === 0 && selection.startCol === 0 && selection.endRow === maxRow && selection.endCol === maxCol) {
    clearSelection();
    return;
  }

  selection = { startRow: 0, startCol: 0, endRow: maxRow, endCol: maxCol };
  selectionMode = 'cell';
  applyHighlights();
}

export function handleHeaderClickForSelection(colIdx, e) {
  const maxRow = state.rows.length - 1;
  if (maxRow < 0) { return; }

  // Toggle: if same column already selected, deselect
  if (selection && selectionMode === 'column' && selection.startCol === colIdx && selection.endCol === colIdx) {
    clearSelection();
    return;
  }

  selection = { startRow: 0, startCol: colIdx, endRow: maxRow, endCol: colIdx };
  selectionMode = 'column';
  isDragging = true;
  document.body.classList.add('selecting');

  applyHighlights();

  // Drag to extend column selection
  const onMove = (ev) => {
    const selCell = ev.target.closest('.column-select-cell');
    if (!selCell) { return; }
    const newCol = parseInt(selCell.dataset.columnIndex, 10);
    if (isNaN(newCol)) { return; }
    selection.endCol = newCol;
    applyHighlights();
  };

  const onUp = () => {
    isDragging = false;
    document.body.classList.remove('selecting');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

export function handleCopyShortcut(e) {
  if (!(e.metaKey || e.ctrlKey) || e.key !== 'c') { return; }
  if (!selection) { return; }

  e.preventDefault();

  const text = getSelectionText();
  if (text) {
    sendMessage({ type: 'copyToClipboard', text });
  }
}

export function handleArrowNavigation(e) {
  if (!selection) { return false; }
  if (e.target.tagName === 'INPUT') { return false; }

  const { key } = e;
  if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Tab') {
    return false;
  }

  e.preventDefault();

  let row = selection.endRow;
  let col = selection.endCol;
  const maxRow = state.rows.length - 1;
  const maxCol = state.headers.length - 1;

  if (key === 'ArrowUp') { row = Math.max(0, row - 1); }
  else if (key === 'ArrowDown') { row = Math.min(maxRow, row + 1); }
  else if (key === 'ArrowLeft') { col = Math.max(0, col - 1); }
  else if (key === 'ArrowRight' || key === 'Tab') { col = Math.min(maxCol, col + 1); }

  selection = { startRow: row, startCol: col, endRow: row, endCol: col };
  selectionMode = 'cell';
  applyHighlights();
  scrollCellIntoView(row, col);
  return true;
}

function scrollCellIntoView(row, col) {
  const td = dom.tableBody.querySelector(`tr[data-row-index="${row}"] td[data-column-index="${col}"]`);
  if (td) { td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}

function getSelectionText() {
  if (!selection) { return ''; }

  const minRow = Math.min(selection.startRow, selection.endRow);
  const maxRow = Math.max(selection.startRow, selection.endRow);
  const minCol = Math.min(selection.startCol, selection.endCol);
  const maxCol = Math.max(selection.startCol, selection.endCol);

  const isSingleCell = (minRow === maxRow && minCol === maxCol);

  // Single cell: just copy the value, no header
  if (isSingleCell) {
    return state.rows[minRow]?.[minCol] || '';
  }

  // Multi-cell: include header + use file delimiter
  const delimiter = getDelimiterChar(state.delimiter);

  const lines = [];

  // Header row
  const headerCells = [];
  for (let c = minCol; c <= maxCol; c++) {
    headerCells.push(quoteIfNeeded(state.headers[c] || '', delimiter));
  }
  lines.push(headerCells.join(delimiter));

  // Data rows
  for (let r = minRow; r <= maxRow; r++) {
    if (r >= state.rows.length) { break; }
    const cells = [];
    for (let c = minCol; c <= maxCol; c++) {
      cells.push(quoteIfNeeded(state.rows[r][c] || '', delimiter));
    }
    lines.push(cells.join(delimiter));
  }

  return lines.join('\n');
}

function quoteIfNeeded(val, delimiter) {
  if (val.includes(delimiter) || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function getDelimiterChar(delimiterName) {
  switch (delimiterName) {
    case 'Comma': return ',';
    case 'Semicolon': return ';';
    case 'Tab': return '\t';
    case 'Pipe': return '|';
    default: return ',';
  }
}

function applyHighlights() {
  removeHighlights();
  if (!selection) { return; }

  const minRow = Math.min(selection.startRow, selection.endRow);
  const maxRow = Math.max(selection.startRow, selection.endRow);
  const minCol = Math.min(selection.startCol, selection.endCol);
  const maxCol = Math.max(selection.startCol, selection.endCol);

  const rows = dom.tableBody.querySelectorAll('tr');
  rows.forEach(tr => {
    const rowIdx = parseInt(tr.dataset.rowIndex, 10);
    if (isNaN(rowIdx) || rowIdx < minRow || rowIdx > maxRow) { return; }

    const cells = tr.querySelectorAll('td.editable-cell');
    cells.forEach(td => {
      const colIdx = parseInt(td.dataset.columnIndex, 10);
      if (colIdx >= minCol && colIdx <= maxCol) {
        td.classList.add('selected');
      }
    });
  });
}

function removeHighlights() {
  const selected = dom.tableBody.querySelectorAll('td.selected');
  selected.forEach(td => td.classList.remove('selected'));
}
