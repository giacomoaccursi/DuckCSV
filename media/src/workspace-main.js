/**
 * DuckCSV — Workspace Webview Entry Point
 *
 * Multi-table environment. Uses shared-bindings for common interactions;
 * adds workspace-specific bindings (add-table, table dropdown, tables bar, empty state).
 */

import { dom } from './dom.js';
import { state } from './state.js';
import { sendMessage } from './messaging.js';
import { toggle } from './utils.js';
import { showLoading, hideLoading, showError, showTooltip, hideTooltip, showContextMenu } from './ui.js';
import { isEditing } from './editing.js';
import { initResize } from './resize.js';
import { openFilterDropdown, onColumnValuesReceived } from './filter-dropdown.js';
import { clearQuery, isQueryActive, isQueryRunning, setQueryRunning, setSystemLoading, showAutocomplete, closeAutocomplete, handleAutocompleteKeydown, showQueryError } from './query.js';
import { addToHistory as addToHistoryWs, openHistoryDropdown, initHistory } from './query-history.js';
import { handleCellClick, handleRowNumberClick, handleHeaderClickForSelection, handleCopyShortcut, handleArrowNavigation, handleSelectAll } from './selection.js';
import { renderTablesBar } from './tables-bar.js';
import { updateTableDropdown, bindTableDropdown } from './table-dropdown.js';
import { bindSearchInput, bindQueryBar, bindHeaderInteractions, bindSelectionAndTooltip, clearSortingLock } from './shared-bindings.js';
import { applyDataPage, onPageDataReceived } from './data-page.js';
import { bindSqlHighlight } from './sql-highlight.js';
import { on } from './event-bus.js';
import { renderHeader, renderRows, getScroller } from './renderer.js';

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
}

// ─── Init ────────────────────────────────────────────────────────────────────

// Event bus: react to data-page events
on('data:pageApplied', () => { renderHeader(); renderRows(); });
on('data:mutated', ({ filteredRows }) => {
  const scroller = getScroller();
  if (scroller) { scroller.update(filteredRows); } else { renderRows(); }
});
on('data:ready', () => { const s = getScroller(); if (s) { s.softRefresh(); } });

window.addEventListener('message', (event) => handleExtensionMessage(event.data));
bindEvents();
bindSqlHighlight(document.getElementById('queryInput'), document.getElementById('queryHighlight'));
sendMessage({ type: 'ready' });
