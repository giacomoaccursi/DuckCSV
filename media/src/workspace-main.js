/**
 * DuckCSV — Workspace Webview Entry Point
 *
 * Multi-table environment. Uses shared-bindings for common interactions;
 * adds workspace-specific bindings (add-table, table dropdown, tables bar, empty state).
 */

import { dom } from './core/dom.js';
import { state } from './core/state.js';
import { sendMessage } from './core/messaging.js';
import { toggle, insertAtCursor } from './core/utils.js';
import { showLoading, hideLoading, showError, showTooltip, hideTooltip, showContextMenu } from './ui/ui.js';
import { isEditing } from './ui/editing.js';
import { initResize } from './ui/resize.js';
import { openFilterDropdown, onColumnValuesReceived } from './ui/filter-dropdown.js';
import { clearQuery, isQueryActive, isQueryRunning, setQueryRunning, setSystemLoading, showAutocomplete, closeAutocomplete, handleAutocompleteKeydown, showQueryError } from './query/query.js';
import { addToHistory as addToHistoryWs, openHistoryDropdown, initHistory } from './query/query-history.js';
import { handleCellClick, handleRowNumberClick, handleHeaderClickForSelection, handleCopyShortcut, handleArrowNavigation, handleSelectAll } from './ui/selection.js';
import { renderTablesBar } from './ui/tables-bar.js';
import { updateTableDropdown, bindTableDropdown } from './ui/table-dropdown.js';
import { bindSearchInput } from './shared/bind-search.js';
import { bindQueryBar } from './shared/bind-query-bar.js';
import { bindHeaderInteractions, clearSortingLock } from './shared/bind-header.js';
import { bindSelectionAndTooltip } from './shared/bind-selection.js';
import { applyDataPage, onPageDataReceived } from './data/data-page.js';
import { bindSqlHighlight } from './query/sql-highlight.js';
import { bindAutoPairs } from './query/auto-pairs.js';
import { on } from './core/event-bus.js';
import { renderHeader, renderRows, getScroller } from './ui/renderer.js';
import { initSelectionStats, updateSelectionStats } from './ui/selection-stats.js';

let activeTableName = '';

// ─── Message Handler ─────────────────────────────────────────────────────────

function handleExtensionMessage(message) {
  switch (message.type) {
    case 'dataPage': onDataPageReceived(message.data); break;
    case 'pageData': onPageDataReceived(message); break;
    case 'columnValues': onColumnValuesReceived(message.data); break;
    case 'tableList': onTableListReceived(message.tables); break;
    case 'loading':
      if (message.loading) { showLoading(message.message); setSystemLoading(true); }
      else { hideLoading(); setSystemLoading(false); }
      break;
    case 'error': showError(message.message); clearSortingLock(); break;
    case 'queryError': setQueryRunning(false); showQueryError(message.message); break;
    case 'queryHistory': initHistory(message.history); break;
  }
}

function onDataPageReceived(data) {
  applyDataPage(data, { setOriginalHeaders: false, trackDirty: false });
}

function onTableListReceived(tables) {
  renderTablesBar(tables);
  updateTableDropdown(tables, activeTableName);

  if (tables.length > 0 && !activeTableName) {
    activeTableName = tables[0].name;
  }

  // Update autocomplete with all table columns
  const allHeaders = [];
  const tableNames = [];
  tables.forEach(t => {
    tableNames.push(t.name);
    t.headers.forEach(h => {
      allHeaders.push(h);
      allHeaders.push(`${t.name}.${h}`);
    });
    allHeaders.push(t.name);
  });
  state.originalHeaders = allHeaders;
  state.tableNames = tableNames;

  if (tables.length === 0) {
    toggle(dom.tableContainer, false);
  }
}

// ─── Event Binding ───────────────────────────────────────────────────────────

function bindEvents() {
  // Shared: search, query bar, header, selection/tooltip
  bindSearchInput(dom.searchInput, sendMessage);

  bindQueryBar({
    queryInput: document.getElementById('queryInput'), queryRunBtn: document.getElementById('queryRunBtn'),
    querySideBtn: document.getElementById('querySideBtn'), queryClearBtn: document.getElementById('queryClearBtn'),
    queryExportBtn: document.getElementById('queryExportBtn'),
    sendMessage, isQueryRunning, setQueryRunning, isQueryActive, clearQuery,
    closeAutocomplete, handleAutocompleteKeydown, showAutocomplete, addToHistory: addToHistoryWs,
  });

  bindHeaderInteractions(dom.tableHeader, {
    state, sendMessage, initResize, handleSelectAll, handleHeaderClickForSelection, openFilterDropdown,
  });

  // Header dblclick to insert column name into query
  if (dom.tableHeader) {
    dom.tableHeader.addEventListener('dblclick', (e) => {
      if (e.target.closest('.filter-btn') || e.target.closest('.resize-handle')) { return; }
      const th = e.target.closest('th.sortable-header');
      const queryInput = document.getElementById('queryInput');
      if (!th || !queryInput) { return; }

      const colIdx = parseInt(th.dataset.columnIndex, 10);
      if (isNaN(colIdx)) { return; }

      const colName = state.headers[colIdx] || '';
      const quoted = /[^a-zA-Z0-9_]/.test(colName) ? `"${colName}"` : colName;
      insertAtCursor(queryInput, quoted);
    });
  }

  bindSelectionAndTooltip({ handleCellClick, handleRowNumberClick, handleCopyShortcut, handleArrowNavigation, isEditing, showTooltip, hideTooltip });

  // Workspace-specific: add table buttons
  const addTableBtn = document.getElementById('addTableBtn');

  if (addTableBtn) {
    addTableBtn.addEventListener('click', () => sendMessage({ type: 'addTable', filePath: '' }));
  }

  // Workspace-specific: table dropdown
  bindTableDropdown();

  // Query history button
  const historyBtn = document.getElementById('queryHistoryBtn');
  const wsQueryInput = document.getElementById('queryInput');
  if (historyBtn && wsQueryInput) {
    historyBtn.addEventListener('click', () => {
      openHistoryDropdown(historyBtn, (sql) => {
        wsQueryInput.value = sql;
        wsQueryInput.focus();
        wsQueryInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  }

  // Workspace-specific: context menu (copy only — no editing)
  document.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('td.editable-cell');
    if (!cell) { return; }
    e.preventDefault();
    const text = cell.dataset.fullText || cell.textContent;
    showContextMenu(e.pageX, e.pageY, [
      { label: 'Copy cell', action: () => sendMessage({ type: 'copyToClipboard', text }) },
    ]);
  });

  // Profile button click handler
  document.addEventListener('click', (e) => {
    const profileBtn = e.target.closest('.profile-btn');
    if (!profileBtn) { return; }
    const colIdx = parseInt(profileBtn.dataset.columnIndex, 10);
    if (isNaN(colIdx)) { return; }
    sendMessage({ type: 'profileColumn', columnIndex: colIdx });
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────

// Event bus: react to data-page events
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
initSelectionStats();
sendMessage({ type: 'ready' });
