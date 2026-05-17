/**
 * DuckCSV — Webview Entry Point
 *
 * Wires together all modules and binds events.
 * Uses shared-bindings for common interactions; adds preview-specific bindings
 * (cell editing, context menu, refresh, openAsText, color toggle, header dblclick).
 */

import { dom } from './dom.js';
import { state } from './state.js';
import { sendMessage } from './messaging.js';
import { insertAtCursor } from './utils.js';
import { renderHeader, renderRows, getScroller } from './renderer.js';
import { applyDataPage, onPageDataReceived, getDataWindow } from './data-page.js';
import { showLoading, hideLoading, showError, showTooltip, hideTooltip, showContextMenu, updateStats } from './ui.js';
import { startCellEdit, isEditing, onCellEditConfirm, setAfterCommit } from './editing.js';
import { initResize } from './resize.js';
import { openFilterDropdown, onColumnValuesReceived } from './filter-dropdown.js';
import { clearQuery, isQueryActive, isQueryRunning, setQueryRunning, setSystemLoading, sortQueryResultsLocally, showAutocomplete, closeAutocomplete, handleAutocompleteKeydown } from './query.js';
import { handleCellClick, handleRowNumberClick, handleHeaderClickForSelection, handleCopyShortcut, handleArrowNavigation, clearSelection, handleSelectAll, getSelection, getSelectionMode, selectCell } from './selection.js';
import { bindSearchInput, bindQueryBar, bindHeaderInteractions, bindSelectionAndTooltip } from './shared-bindings.js';

// ─── Message Handler ─────────────────────────────────────────────────────────

function handleExtensionMessage(message) {
  switch (message.type) {
    case 'dataPage': onDataPageReceived(message.data); break;
    case 'pageData': onPageDataReceived(message); break;
    case 'columnValues': onColumnValuesReceived(message.data); break;
    case 'cellEditConfirm': onCellEditConfirm(message.data); break;
    case 'rowMutation': onRowMutation(message.data); break;
    case 'loading':
      if (message.loading) { showLoading(message.message); setSystemLoading(true); }
      else { hideLoading(); setSystemLoading(false); }
      break;
    case 'saving':
      if (message.saving) { showLoading('Saving...'); }
      else { hideLoading(); }
      break;
    case 'saved':
      hideLoading();
      break;
    case 'error': showError(message.message); break;
  }
}

function onDataPageReceived(data) {
  applyDataPage(data, { setOriginalHeaders: true, trackDirty: true });
}

function onRowMutation(data) {
  state.totalRows = data.totalRows;
  state.filteredRows = data.filteredRows;
  state.isDirty = true;

  // If filteredRows equals totalRows, filters were cleared by the backend
  if (data.filteredRows === data.totalRows) {
    state.filters = {};
    state.searchTerm = '';
    const searchInput = document.getElementById('searchInput');
    if (searchInput) { searchInput.value = ''; }
  }

  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) { saveBtn.disabled = false; }

  const dw = getDataWindow();
  if (dw) {
    dw.setTotalRows(data.filteredRows);
    dw.invalidate();
  }

  updateStats();
  const scroller = getScroller();
  if (scroller) {
    scroller.update(data.filteredRows);
  } else {
    renderRows();
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
  // Shared: search, query bar, header, selection/tooltip
  bindSearchInput(dom.searchInput, sendMessage);

  bindQueryBar(
    { queryInput: dom.queryInput, queryRunBtn: dom.queryRunBtn, querySideBtn: dom.querySideBtn, queryClearBtn: dom.queryClearBtn, queryExportBtn: document.getElementById('queryExportBtn') },
    { sendMessage, isQueryRunning, setQueryRunning, isQueryActive, clearQuery, closeAutocomplete, handleAutocompleteKeydown, showAutocomplete, state }
  );

  const headerCtrl = bindHeaderInteractions(dom.tableHeader, {
    state, sendMessage, initResize, handleSelectAll, handleHeaderClickForSelection, isQueryActive, sortQueryResultsLocally, openFilterDropdown,
  });

  bindSelectionAndTooltip({ handleCellClick, handleRowNumberClick, handleCopyShortcut, handleArrowNavigation, isEditing, showTooltip, hideTooltip, onEnterCell: () => {
    if (document.body.dataset.readonly) { return; }
    const sel = getSelection();
    if (!sel) { return; }
    const row = sel.endRow;
    const col = sel.endCol;
    const td = document.querySelector(`tr[data-row-index="${row}"] td[data-column-index="${col}"]`);
    if (td) { clearSelection(); startCellEdit(td); }
  }});

  // Preview-specific: toolbar buttons
  const saveBtn = document.getElementById('saveBtn');
  const saveAsBtn = document.getElementById('saveAsBtn');
  if (saveBtn) { saveBtn.addEventListener('click', () => sendMessage({ type: 'save' })); }
  if (saveAsBtn) { saveAsBtn.addEventListener('click', () => sendMessage({ type: 'saveAs' })); }

  // Cmd+S / Ctrl+S to save
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (e.shiftKey) {
        sendMessage({ type: 'saveAs' });
      } else {
        sendMessage({ type: 'save' });
      }
    }
  });

  if (dom.colorBtn) { dom.colorBtn.addEventListener('click', toggleColumnColors); }

  // Export button (standalone, for query result panel)
  const exportBtn = document.getElementById('queryExportBtn');
  if (exportBtn && !dom.queryInput) {
    exportBtn.addEventListener('click', () => {
      sendMessage({ type: 'exportQueryResult', headers: [], rows: [] });
    });
  }

  const openWorkspaceBtn = document.getElementById('openWorkspaceBtn');
  if (openWorkspaceBtn) { openWorkspaceBtn.addEventListener('click', () => sendMessage({ type: 'openWorkspace' })); }

  // Preview-specific: header dblclick to insert column name into query
  if (dom.tableHeader) {
    dom.tableHeader.addEventListener('dblclick', (e) => {
      headerCtrl.clearTimer();
      if (e.target.closest('.filter-btn') || e.target.closest('.resize-handle')) { return; }
      const th = e.target.closest('th.sortable-header');
      if (!th || !dom.queryInput) { return; }

      const colIdx = parseInt(th.dataset.columnIndex, 10);
      if (isNaN(colIdx)) { return; }

      const colName = state.headers[colIdx] || '';
      const quoted = /[^a-zA-Z0-9_]/.test(colName) ? `"${colName}"` : colName;
      insertAtCursor(dom.queryInput, quoted);
    });
  }

  // Preview-specific: cell editing (disabled in readonly mode)
  if (!document.body.dataset.readonly) {
    document.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td.editable-cell');
      if (td) { clearSelection(); startCellEdit(td); }
    });
  }

  // Preview-specific: context menu (insert/delete rows, copy)
  document.addEventListener('contextmenu', (e) => {
    if (document.body.dataset.readonly) {
      // Readonly: only allow copy
      const cell = e.target.closest('td.editable-cell');
      if (!cell) { return; }
      e.preventDefault();
      const text = cell.dataset.fullText || cell.textContent;
      showContextMenu(e.pageX, e.pageY, [
        { label: 'Copy cell', action: () => sendMessage({ type: 'copyToClipboard', text }) },
      ]);
      return;
    }

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

      const sel = getSelection();
      if (sel && getSelectionMode() === 'row') {
        const minRow = Math.min(sel.startRow, sel.endRow);
        const maxRow = Math.max(sel.startRow, sel.endRow);

        const dw = getDataWindow();
        const rowids = [];
        for (let r = minRow; r <= maxRow; r++) {
          const rid = dw ? dw.getRowid(r) : (state.rowids[r] ?? -1);
          if (rid >= 0) { rowids.push(rid); }
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
setAfterCommit((row, col) => selectCell(row, col));
showLoading();
sendMessage({ type: 'ready' });
