/**
 * DuckCSV — Webview Entry Point
 *
 * Wires together all modules and binds events.
 * Uses shared-bindings for common interactions; adds preview-specific bindings
 * (cell editing, context menu, refresh, openAsText, color toggle, header dblclick).
 */

import { dom } from './core/dom.js';
import { state } from './core/state.js';
import { sendMessage } from './core/messaging.js';
import { insertAtCursor } from './core/utils.js';
import { renderHeader, renderRows, getScroller } from './ui/renderer.js';
import { applyDataPage, onPageDataReceived, onRowMutation } from './data/data-page.js';
import { showLoading, hideLoading, showError, showTooltip, hideTooltip, showContextMenu } from './ui/ui.js';
import { startCellEdit, isEditing, onCellEditConfirm, setAfterCommit } from './ui/editing.js';
import { initResize } from './ui/resize.js';
import { openFilterDropdown, onColumnValuesReceived } from './ui/filter-dropdown.js';
import { clearQuery, isQueryActive, isQueryRunning, setQueryRunning, setSystemLoading, showAutocomplete, closeAutocomplete, handleAutocompleteKeydown, showQueryError } from './query/query.js';
import { initHistory, addToHistory, openHistoryDropdown } from './query/query-history.js';
import { handleCellClick, handleRowNumberClick, handleHeaderClickForSelection, handleCopyShortcut, handleArrowNavigation, clearSelection, handleSelectAll, getSelection, selectCell } from './ui/selection.js';
import { bindSearchInput } from './shared/bind-search.js';
import { bindQueryBar } from './shared/bind-query-bar.js';
import { bindHeaderInteractions, clearSortingLock } from './shared/bind-header.js';
import { bindSelectionAndTooltip } from './shared/bind-selection.js';
import { buildContextMenuItems } from './ui/context-menu.js';
import { bindSqlHighlight } from './query/sql-highlight.js';
import { bindAutoPairs } from './query/auto-pairs.js';
import { bindShortcutsButton } from './ui/shortcuts-overlay.js';
import { on } from './core/event-bus.js';
import { initSelectionStats, updateSelectionStats, onSelectionStatsResult } from './ui/selection-stats.js';

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
    case 'error': showError(message.message); clearSortingLock(); break;
    case 'queryError':
      setQueryRunning(false);
      showQueryError(message.message);
      const qi = document.getElementById('queryInput');
      if (qi) { qi.focus(); }
      break;
    case 'queryHistory': initHistory(message.history); break;
    case 'selectionStatsResult': onSelectionStatsResult(message.data); break;
  }
}

function onDataPageReceived(data) {
  applyDataPage(data, { setOriginalHeaders: true, trackDirty: true });
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

  bindQueryBar({
    queryInput: dom.queryInput, queryRunBtn: dom.queryRunBtn, querySideBtn: dom.querySideBtn,
    queryClearBtn: dom.queryClearBtn, queryExportBtn: document.getElementById('queryExportBtn'),
    sendMessage, isQueryRunning, setQueryRunning, isQueryActive, clearQuery,
    closeAutocomplete, handleAutocompleteKeydown, showAutocomplete, addToHistory,
  });

  const headerCtrl = bindHeaderInteractions(dom.tableHeader, {
    state, sendMessage, initResize, handleSelectAll, handleHeaderClickForSelection, openFilterDropdown,
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

  // Cmd+S / Ctrl+S to save, Cmd+Z / Cmd+Shift+Z for undo/redo
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (e.shiftKey) {
        sendMessage({ type: 'saveAs' });
      } else {
        sendMessage({ type: 'save' });
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        sendMessage({ type: 'redo' });
      } else {
        sendMessage({ type: 'undo' });
      }
    }
  });

  if (dom.colorBtn) { dom.colorBtn.addEventListener('click', toggleColumnColors); }

  // Query history button
  const historyBtn = document.getElementById('queryHistoryBtn');
  const queryInputEl = document.getElementById('queryInput');
  if (historyBtn && queryInputEl) {
    historyBtn.addEventListener('click', () => {
      openHistoryDropdown(historyBtn, (sql) => {
        queryInputEl.value = sql;
        queryInputEl.focus();
        queryInputEl.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  }

  // Export button (standalone, for query result panel)
  const exportBtn = document.getElementById('exportBtnStandalone') || ((!dom.queryInput) ? document.getElementById('queryExportBtn') : null);
  if (exportBtn) {
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

  // Preview-specific: cell editing (disabled in readonly mode only)
  document.addEventListener('dblclick', (e) => {
    if (document.body.dataset.readonly) { return; }
    const td = e.target.closest('td.editable-cell');
    if (td) { clearSelection(); startCellEdit(td); }
  });

  // Profile button click handler
  document.addEventListener('click', (e) => {
    const profileBtn = e.target.closest('.profile-btn');
    if (!profileBtn) { return; }
    const colIdx = parseInt(profileBtn.dataset.columnIndex, 10);
    if (isNaN(colIdx)) { return; }
    sendMessage({ type: 'profileColumn', columnIndex: colIdx });
  });

  // Preview-specific: context menu
  document.addEventListener('contextmenu', (e) => {
    const result = buildContextMenuItems(e);
    if (!result) { return; }
    e.preventDefault();
    showContextMenu(e.pageX, e.pageY, result.items);
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────

// Event bus: react to data-page events (breaks circular dependency)
on('data:pageApplied', () => { renderHeader(); renderRows(); });
on('data:mutated', ({ filteredRows }) => {
  const scroller = getScroller();
  if (scroller) { scroller.update(filteredRows); } else { renderRows(); }
});
on('data:ready', () => { const s = getScroller(); if (s) { s.softRefresh(); } });
on('selection:changed', () => { updateSelectionStats(); });

window.addEventListener('message', (event) => handleExtensionMessage(event.data));
bindEvents();
bindSqlHighlight(document.getElementById('queryInput'), document.getElementById('queryHighlight'));
bindAutoPairs(document.getElementById('queryInput'));
bindShortcutsButton();
setAfterCommit((row, col) => selectCell(row, col));
initSelectionStats();
showLoading();
sendMessage({ type: 'ready' });
