/**
 * CSV Enhanced — Webview Entry Point
 *
 * Wires together all modules and binds events.
 */

import { dom } from './dom.js';
import { state } from './state.js';
import { sendMessage } from './messaging.js';
import { toggle, insertAtCursor } from './utils.js';
import { renderHeader, renderRows } from './renderer.js';
import { showLoading, hideLoading, showTable, showError, updateStats, showTooltip, hideTooltip, showContextMenu } from './ui.js';
import { startCellEdit, isEditing, onCellEditConfirm } from './editing.js';
import { initResize } from './resize.js';
import { openFilterDropdown, onColumnValuesReceived, closeFilterDropdown } from './filter-dropdown.js';
import { onQueryResult, clearQuery, resetQueryState, isQueryActive, isQueryRunning, setQueryRunning, setSystemLoading, sortQueryResultsLocally, showAutocomplete, closeAutocomplete, handleAutocompleteKeydown } from './query.js';
import { handleCellClick, handleRowNumberClick, handleHeaderClickForSelection, handleCopyShortcut, handleArrowNavigation, clearSelection, handleSelectAll, getSelection, getSelectionMode } from './selection.js';

const DEBOUNCE_MS = 300;
let searchTimeout = null;

// ─── Message Handler ─────────────────────────────────────────────────────────

function handleExtensionMessage(message) {
  switch (message.type) {
    case 'dataPage': onDataPageReceived(message.data); break;
    case 'columnValues': onColumnValuesReceived(message.data); break;
    case 'cellEditConfirm': onCellEditConfirm(); break;
    case 'queryResult': onQueryResult(message.data); break;
    case 'modeInfo': showModeBanner(message.mode, message.savePath); break;
    case 'loading':
      if (message.loading) { showLoading(); setSystemLoading(true); }
      else { hideLoading(); setSystemLoading(false); }
      break;
    case 'error': showError(message.message); break;
  }
}

function onDataPageReceived(data) {
  resetQueryState();

  state.headers = data.headers;
  state.originalHeaders = data.headers; // preserve for autocomplete
  state.columnTypes = data.columnTypes || [];
  state.rows = data.rows;
  state.rowids = data.rowids || [];
  state.totalRows = data.totalRows;
  state.filteredRows = data.filteredRows;
  state.delimiter = data.delimiter;
  state.fileName = data.fileName;
  state.fileSize = data.fileSize;
  state.sort = data.sort;
  state.filters = data.filters;
  state.searchTerm = data.searchTerm;
  state.isDirty = data.isDirty;

  if (dom.searchInput && document.activeElement !== dom.searchInput) {
    dom.searchInput.value = data.searchTerm;
  }

  renderHeader();
  renderRows();
  updateStats();
  showTable();
}

// ─── Mode Banner ─────────────────────────────────────────────────────────────

function showModeBanner(mode, savePath) {
  // Remove existing banner if any
  const existing = document.getElementById('modeBanner');
  if (existing) { existing.remove(); }

  const banner = document.createElement('div');
  banner.id = 'modeBanner';
  banner.className = mode === 'edit' ? 'mode-banner mode-edit' : 'mode-banner mode-readonly';

  const fileName = savePath.split('/').pop() || savePath;

  if (mode === 'edit') {
    banner.textContent = `\u270F Edit mode \u2014 Changes are saved directly to ${fileName}`;
  } else {
    banner.textContent = `\uD83D\uDD12 Read-only mode \u2014 Changes will be saved to ${fileName}`;
  }

  // Insert at the top of #app, before toolbar
  const app = document.getElementById('app');
  if (app && app.firstChild) {
    app.insertBefore(banner, app.firstChild);
  }
}

// ─── Column Coloring Toggle ──────────────────────────────────────────────────

function toggleColumnColors() {
  state.colorColumnsEnabled = !state.colorColumnsEnabled;
  if (dom.colorBtn) { dom.colorBtn.classList.toggle('btn-active', state.colorColumnsEnabled); }
  renderHeader();
  renderRows();
}

// ─── Event Binding ───────────────────────────────────────────────────────────

function bindEvents() {
  // Search
  if (dom.searchInput) {
    dom.searchInput.addEventListener('input', (e) => {
      if (searchTimeout) { clearTimeout(searchTimeout); }
      searchTimeout = setTimeout(() => {
        sendMessage({ type: 'search', term: e.target.value.trim() });
      }, DEBOUNCE_MS);
    });
  }

  // Toolbar
  if (dom.refreshBtn) { dom.refreshBtn.addEventListener('click', () => sendMessage({ type: 'refresh' })); }
  if (dom.openAsTextBtn) { dom.openAsTextBtn.addEventListener('click', () => sendMessage({ type: 'openAsText' })); }
  if (dom.colorBtn) { dom.colorBtn.addEventListener('click', toggleColumnColors); }

  const openWorkspaceBtn = document.getElementById('openWorkspaceBtn');
  if (openWorkspaceBtn) { openWorkspaceBtn.addEventListener('click', () => sendMessage({ type: 'openWorkspace' })); }

  // Query bar
  if (dom.queryRunBtn) {
    dom.queryRunBtn.addEventListener('click', () => {
      if (isQueryRunning()) {
        sendMessage({ type: 'cancelQuery' });
        setQueryRunning(false);
        return;
      }
      const sql = dom.queryInput ? dom.queryInput.value.trim() : '';
      if (sql) {
        setQueryRunning(true);
        sendMessage({ type: 'executeQuery', sql, mode: 'inline' });
      }
    });
  }
  if (dom.querySideBtn) {
    dom.querySideBtn.addEventListener('click', () => {
      const sql = dom.queryInput ? dom.queryInput.value.trim() : '';
      if (sql) { sendMessage({ type: 'executeQuery', sql, mode: 'side' }); }
    });
  }
  if (dom.queryClearBtn) { dom.queryClearBtn.addEventListener('click', clearQuery); }

  if (dom.queryInput) {
    dom.queryInput.addEventListener('keydown', (e) => {
      if (handleAutocompleteKeydown(e)) { return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        closeAutocomplete();
        const sql = dom.queryInput.value.trim();
        if (sql) {
          setQueryRunning(true);
          sendMessage({ type: 'executeQuery', sql, mode: 'inline' });
        }
      } else if (e.key === 'Escape') {
        clearQuery();
      }
    });
    dom.queryInput.addEventListener('input', () => showAutocomplete(dom.queryInput));
    dom.queryInput.addEventListener('blur', () => setTimeout(closeAutocomplete, 150));
    dom.queryInput.addEventListener('focus', () => {
      if (dom.queryInput.value.trim()) { showAutocomplete(dom.queryInput); }
    });
  }

  // Header: sort (delayed) + dblclick insert + resize
  let headerClickTimer = null;

  if (dom.tableHeader) {
    dom.tableHeader.addEventListener('click', (e) => {
      if (e.target.closest('.filter-btn') || e.target.closest('.resize-handle')) { return; }
      const th = e.target.closest('th.sortable-header');
      if (!th) { return; }

      const colIdx = parseInt(th.dataset.columnIndex, 10);
      if (isNaN(colIdx)) { return; }

      // Normal click → sort (delayed for dblclick disambiguation)
      if (headerClickTimer) { clearTimeout(headerClickTimer); }
      headerClickTimer = setTimeout(() => {
        headerClickTimer = null;

        let newDirection = 'asc';
        if (state.sort.columnIndex === colIdx) {
          if (state.sort.direction === 'asc') { newDirection = 'desc'; }
          else if (state.sort.direction === 'desc') { newDirection = 'none'; }
        }

        if (isQueryActive()) {
          // Sort locally on query results
          sortQueryResultsLocally(colIdx, newDirection);
        } else {
          sendMessage({ type: 'sort', columnIndex: colIdx, direction: newDirection });
        }
      }, 150);
    });

    dom.tableHeader.addEventListener('dblclick', (e) => {
      if (headerClickTimer) { clearTimeout(headerClickTimer); headerClickTimer = null; }
      if (e.target.closest('.filter-btn') || e.target.closest('.resize-handle')) { return; }
      const th = e.target.closest('th.sortable-header');
      if (!th || !dom.queryInput) { return; }

      const colIdx = parseInt(th.dataset.columnIndex, 10);
      if (isNaN(colIdx)) { return; }

      const colName = state.headers[colIdx] || '';
      const quoted = /[^a-zA-Z0-9_]/.test(colName) ? `"${colName}"` : colName;
      insertAtCursor(dom.queryInput, quoted);
    });

    // Column select row mousedown (supports drag)
    dom.tableHeader.addEventListener('mousedown', (e) => {
      // Resize handle
      if (e.target.classList.contains('resize-handle')) { initResize(e); return; }

      // Select all on # click
      const corner = e.target.closest('.row-number-header');
      if (corner) { handleSelectAll(); return; }

      // Column select box
      const selCell = e.target.closest('.column-select-cell');
      if (selCell) {
        const colIdx = parseInt(selCell.dataset.columnIndex, 10);
        if (!isNaN(colIdx)) { handleHeaderClickForSelection(colIdx, e); }
      }
    });
  }

  // Filter button
  document.addEventListener('click', (e) => {
    const filterBtn = e.target.closest('.filter-btn');
    if (!filterBtn) { return; }
    e.stopPropagation();
    const colIdx = parseInt(filterBtn.dataset.columnIndex, 10);
    if (!isNaN(colIdx)) { openFilterDropdown(colIdx, filterBtn); }
  });

  // Cell editing
  document.addEventListener('dblclick', (e) => {
    const td = e.target.closest('td.editable-cell');
    if (td) { clearSelection(); startCellEdit(td); }
  });

  // Cell/row selection (single click)
  document.addEventListener('mousedown', (e) => {
    // Row number mousedown → select row (supports drag)
    const rowNum = e.target.closest('td.row-number');
    if (rowNum) { handleRowNumberClick(e); return; }

    // Cell click → select cell (only if not editing and not on interactive elements)
    const td = e.target.closest('td.editable-cell');
    if (td && !isEditing()) { handleCellClick(e); }
  });

  // Keyboard: Cmd+C to copy selection
  document.addEventListener('keydown', (e) => {
    handleCopyShortcut(e);
    handleArrowNavigation(e);
  });

  // Tooltip
  document.addEventListener('mouseover', (e) => {
    if (isEditing()) { return; }
    const cell = e.target.closest('td, th');
    if (cell && cell.scrollWidth > cell.clientWidth && !cell.classList.contains('editing')) {
      showTooltip(cell.dataset.fullText || cell.textContent, e.pageX, e.pageY);
    }
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('td, th')) { hideTooltip(); }
  });

  // Context menu on row numbers (Excel-like: insert above/below, delete)
  document.addEventListener('contextmenu', (e) => {
    const rowNum = e.target.closest('td.row-number');
    if (rowNum) {
      e.preventDefault();
      const tr = rowNum.closest('tr');
      const rowid = parseInt(tr.dataset.rowid, 10);
      if (isNaN(rowid)) { return; }

      const items = [
        { label: 'Insert row above', action: () => sendMessage({ type: 'addRowAt', rowid, position: 'above' }) },
        { label: 'Insert row below', action: () => sendMessage({ type: 'addRowAt', rowid, position: 'below' }) },
      ];

      // Check if multiple rows are selected
      const sel = getSelection();
      if (sel && getSelectionMode() === 'row') {
        const minRow = Math.min(sel.startRow, sel.endRow);
        const maxRow = Math.max(sel.startRow, sel.endRow);
        const count = maxRow - minRow + 1;

        // Collect rowids from selected rows
        const rowids = [];
        for (let r = minRow; r <= maxRow; r++) {
          if (state.rowids[r] !== undefined) {
            rowids.push(state.rowids[r]);
          }
        }

        if (rowids.length > 1) {
          items.push({ label: `Delete ${rowids.length} rows`, action: () => sendMessage({ type: 'deleteRows', rowids }) });
        } else {
          items.push({ label: 'Delete row', action: () => sendMessage({ type: 'deleteRow', rowid }) });
        }
      } else {
        items.push({ label: 'Delete row', action: () => sendMessage({ type: 'deleteRow', rowid }) });
      }

      showContextMenu(e.pageX, e.pageY, items);
      return;
    }

    const cell = e.target.closest('td.editable-cell');
    if (!cell) { return; }
    e.preventDefault();
    const text = cell.dataset.fullText || cell.textContent;
    const rowid2 = parseInt(cell.dataset.rowid, 10);
    showContextMenu(e.pageX, e.pageY, [
      { label: 'Copy cell', action: () => sendMessage({ type: 'copyToClipboard', text }) },
      { label: 'Delete row', action: () => sendMessage({ type: 'deleteRow', rowid: rowid2 }) },
    ]);
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────

window.addEventListener('message', (event) => handleExtensionMessage(event.data));
bindEvents();
showLoading();
sendMessage({ type: 'ready' });
