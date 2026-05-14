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

  selection = { startRow: 0, startCol: 0, endRow: maxRow, endCol: maxCol };
  selectionMode = 'cell';
  applyHighlights();
}

export function handleHeaderClickForSelection(colIdx, e) {
  const maxRow = state.rows.length - 1;
  if (maxRow < 0) { return; }

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

function getSelectionText() {
  if (!selection) { return ''; }

  const minRow = Math.min(selection.startRow, selection.endRow);
  const maxRow = Math.max(selection.startRow, selection.endRow);
  const minCol = Math.min(selection.startCol, selection.endCol);
  const maxCol = Math.max(selection.startCol, selection.endCol);

  // Use the file's delimiter for copy (matches the original format)
  const delimiter = getDelimiterChar(state.delimiter);

  const lines = [];
  for (let r = minRow; r <= maxRow; r++) {
    if (r >= state.rows.length) { break; }
    const cells = [];
    for (let c = minCol; c <= maxCol; c++) {
      const val = state.rows[r][c] || '';
      // Quote if value contains delimiter, quotes, or newlines
      if (val.includes(delimiter) || val.includes('"') || val.includes('\n')) {
        cells.push('"' + val.replace(/"/g, '""') + '"');
      } else {
        cells.push(val);
      }
    }
    lines.push(cells.join(delimiter));
  }

  return lines.join('\n');
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
