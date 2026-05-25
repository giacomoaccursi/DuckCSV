/**
 * Cell/row/column selection with copy support (Excel-like).
 *
 * - Click cell: select single cell
 * - Click row number: select entire row
 * - Ctrl/Cmd+Click header: select entire column
 * - Shift+Click: extend selection range
 * - Cmd+C / Ctrl+C: copy selection as tab-separated text
 */

import { dom } from '../core/dom.js';
import { state } from '../core/state.js';
import { sendMessage } from '../core/messaging.js';
import { getScroller } from './renderer.js';
import { getDataWindow } from '../data/data-page.js';

// Selection state: { startRow, startCol, endRow, endCol } or null
let selection = null;
let selectionMode = 'none'; // 'cell' | 'row' | 'column' | 'none'
let isDragging = false;
let autoScrollInterval = null;

function startAutoScroll(ev) {
  stopAutoScroll();

  const wrapper = document.querySelector('.table-wrapper');
  if (!wrapper) { return; }

  const rect = wrapper.getBoundingClientRect();
  const edgeSize = 40;

  autoScrollInterval = setInterval(() => {
    const y = ev.clientY;
    const x = ev.clientX;

    if (y < rect.top + edgeSize) {
      wrapper.scrollTop -= 20;
    } else if (y > rect.bottom - edgeSize) {
      wrapper.scrollTop += 20;
    }

    if (x < rect.left + edgeSize) {
      wrapper.scrollLeft -= 20;
    } else if (x > rect.right - edgeSize) {
      wrapper.scrollLeft += 20;
    }
  }, 50);
}

function stopAutoScroll() {
  if (autoScrollInterval) {
    clearInterval(autoScrollInterval);
    autoScrollInterval = null;
  }
}

export function getSelection() { return selection; }
export function getSelectionMode() { return selectionMode; }

/** Check if a row/col is within the current selection range */
export function isInSelection(rowIdx, colIdx) {
  if (!selection) { return false; }
  const minRow = Math.min(selection.startRow, selection.endRow);
  const maxRow = Math.max(selection.startRow, selection.endRow);
  const minCol = Math.min(selection.startCol, selection.endCol);
  const maxCol = Math.max(selection.startCol, selection.endCol);
  return rowIdx >= minRow && rowIdx <= maxRow && colIdx >= minCol && colIdx <= maxCol;
}

export function clearSelection() {
  selection = null;
  selectionMode = 'none';
  removeHighlights();
}

export function selectCell(row, col) {
  selection = { startRow: row, startCol: col, endRow: row, endCol: col };
  selectionMode = 'cell';
  applyHighlights();
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

  // Right-click: don't reset selection if the row is already within the current selection
  if (e.button === 2 && selection && selectionMode === 'row') {
    const minRow = Math.min(selection.startRow, selection.endRow);
    const maxRow = Math.max(selection.startRow, selection.endRow);
    if (row >= minRow && row <= maxRow) {
      return; // Keep existing selection, let contextmenu handle it
    }
  }

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
  let lastEvent = e;
  const onMove = (ev) => {
    lastEvent = ev;
    startAutoScroll(ev);
    const rowEl = ev.target.closest('tr[data-row-index]');
    if (!rowEl) { return; }
    const newRow = parseInt(rowEl.dataset.rowIndex, 10);
    if (isNaN(newRow)) { return; }
    selection.endRow = newRow;
    applyHighlights();
  };

  const onUp = () => {
    isDragging = false;
    stopAutoScroll();
    document.body.classList.remove('selecting');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

export function handleSelectAll() {
  const dw = getDataWindow();
  const maxRow = (dw ? dw.getTotalRows() : state.filteredRows) - 1;
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
  const dw = getDataWindow();
  const maxRow = (dw ? dw.getTotalRows() : state.filteredRows) - 1;
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
  if (e.target.tagName === 'INPUT') { return false; }

  const { key } = e;
  if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Tab') {
    return false;
  }

  // If no selection, select the first visible cell
  if (!selection) {
    const scroller = getScroller();
    const range = scroller ? scroller.getVisibleRange() : { start: 0 };
    const firstRow = range.start >= 0 ? range.start : 0;
    selection = { startRow: firstRow, startCol: 0, endRow: firstRow, endCol: 0 };
    selectionMode = 'cell';
    applyHighlights();
    scrollCellIntoView(firstRow, 0);
    e.preventDefault();
    return true;
  }

  e.preventDefault();

  let row = selection.endRow;
  let col = selection.endCol;
  const dw2 = getDataWindow();
  const maxRow = (dw2 ? dw2.getTotalRows() : state.filteredRows) - 1;
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
  const scroller = getScroller();

  // If the row isn't in the DOM, scroll the virtual scroller to bring it in
  let td = dom.tableBody.querySelector(`tr[data-row-index="${row}"] td[data-column-index="${col}"]`);
  if (!td && scroller) {
    scroller.scrollToRow(row);
    // After scrollToRow, the row should now be in the DOM
    td = dom.tableBody.querySelector(`tr[data-row-index="${row}"] td[data-column-index="${col}"]`);
  }
  if (!td) { return; }

  const wrapper = document.querySelector('.table-wrapper');
  if (!wrapper) { return; }

  const wrapperRect = wrapper.getBoundingClientRect();
  const tdRect = td.getBoundingClientRect();

  const rowNumCol = wrapper.querySelector('td.row-number');
  const stickyOffset = rowNumCol ? rowNumCol.offsetWidth : 70;

  if (tdRect.left < wrapperRect.left + stickyOffset) {
    wrapper.scrollLeft -= (wrapperRect.left + stickyOffset - tdRect.left);
  } else if (tdRect.right > wrapperRect.right) {
    wrapper.scrollLeft += (tdRect.right - wrapperRect.right);
  }

  const thead = wrapper.querySelector('thead');
  const headerOffset = thead ? thead.offsetHeight : 0;

  if (tdRect.top < wrapperRect.top + headerOffset) {
    wrapper.scrollTop -= (wrapperRect.top + headerOffset - tdRect.top);
  } else if (tdRect.bottom > wrapperRect.bottom) {
    wrapper.scrollTop += (tdRect.bottom - wrapperRect.bottom);
  }
}

function getSelectionText() {
  if (!selection) { return ''; }

  const minRow = Math.min(selection.startRow, selection.endRow);
  const maxRow = Math.max(selection.startRow, selection.endRow);
  const minCol = Math.min(selection.startCol, selection.endCol);
  const maxCol = Math.max(selection.startCol, selection.endCol);

  const dw = getDataWindow();
  const isSingleCell = (minRow === maxRow && minCol === maxCol);

  // Single cell: just copy the value, no header
  if (isSingleCell) {
    const row = dw ? dw.getRow(minRow) : null;
    return row?.[minCol] || '';
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
    const row = dw ? dw.getRow(r) : null;
    if (!row) { continue; }
    const cells = [];
    for (let c = minCol; c <= maxCol; c++) {
      cells.push(quoteIfNeeded(row[c] || '', delimiter));
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

  // Direct indexed access: skip querySelectorAll, use children array
  const rows = dom.tableBody.children;
  const rowCount = rows.length;

  for (let i = 0; i < rowCount; i++) {
    const tr = rows[i];
    const rowIdx = parseInt(tr.dataset.rowIndex, 10);
    if (isNaN(rowIdx) || rowIdx < minRow || rowIdx > maxRow) { continue; }

    // children[0] is row-number td, data cells start at index 1
    const cells = tr.children;
    for (let c = minCol; c <= maxCol; c++) {
      const td = cells[c + 1]; // +1 to skip row-number column
      if (td) { td.classList.add('selected'); }
    }
  }
}

function removeHighlights() {
  const selected = dom.tableBody.querySelectorAll('td.selected');
  for (let i = 0; i < selected.length; i++) {
    selected[i].classList.remove('selected');
  }
}
