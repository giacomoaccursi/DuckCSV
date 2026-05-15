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
import { renderHeader, renderRows } from './renderer.js';
import { showLoading, hideLoading, showTable, showError, updateStats, showTooltip, hideTooltip, showContextMenu } from './ui.js';
import { isEditing } from './editing.js';
import { initResize } from './resize.js';
import { openFilterDropdown, onColumnValuesReceived } from './filter-dropdown.js';
import { onQueryResult, clearQuery, resetQueryState, isQueryActive, isQueryRunning, setQueryRunning, setSystemLoading, sortQueryResultsLocally, showAutocomplete, closeAutocomplete, handleAutocompleteKeydown } from './query.js';
import { handleCellClick, handleRowNumberClick, handleHeaderClickForSelection, handleCopyShortcut, handleArrowNavigation, clearSelection, handleSelectAll } from './selection.js';
import { renderTablesBar } from './tables-bar.js';
import { updateTableDropdown, bindTableDropdown } from './table-dropdown.js';
import { bindSearchInput, bindQueryBar, bindHeaderInteractions, bindSelectionAndTooltip } from './shared-bindings.js';

let activeTableName = '';

// ─── Message Handler ─────────────────────────────────────────────────────────

function handleExtensionMessage(message) {
  switch (message.type) {
    case 'dataPage': onDataPageReceived(message.data); break;
    case 'columnValues': onColumnValuesReceived(message.data); break;
    case 'queryResult': onQueryResult(message.data); break;
    case 'tableList': onTableListReceived(message.tables); break;
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
  state.isDirty = false;

  if (dom.searchInput && document.activeElement !== dom.searchInput) {
    dom.searchInput.value = data.searchTerm;
  }

  hideEmptyState();
  renderHeader();
  renderRows();
  updateStats();
  showTable();
}

function onTableListReceived(tables) {
  renderTablesBar(tables);
  updateTableDropdown(tables, activeTableName);

  if (tables.length > 0 && !activeTableName) {
    activeTableName = tables[0].name;
  }

  // Update autocomplete with all table columns
  const allHeaders = [];
  tables.forEach(t => {
    t.headers.forEach(h => {
      allHeaders.push(h);
      allHeaders.push(`${t.name}.${h}`);
    });
    allHeaders.push(t.name);
  });
  state.originalHeaders = allHeaders;

  if (tables.length === 0) {
    showEmptyState();
  } else {
    hideEmptyState();
  }
}

function showEmptyState() {
  toggle(document.getElementById('emptyState'), true);
  toggle(dom.tableContainer, false);
}

function hideEmptyState() {
  toggle(document.getElementById('emptyState'), false);
}

// ─── Event Binding ───────────────────────────────────────────────────────────

function bindEvents() {
  // Shared: search, query bar, header, selection/tooltip
  bindSearchInput(dom.searchInput, sendMessage);

  bindQueryBar(
    { queryInput: document.getElementById('queryInput'), queryRunBtn: document.getElementById('queryRunBtn'), querySideBtn: document.getElementById('querySideBtn'), queryClearBtn: document.getElementById('queryClearBtn'), queryExportBtn: document.getElementById('queryExportBtn') },
    { sendMessage, isQueryRunning, setQueryRunning, isQueryActive, clearQuery, closeAutocomplete, handleAutocompleteKeydown, showAutocomplete, state }
  );

  bindHeaderInteractions(dom.tableHeader, {
    state, sendMessage, initResize, handleSelectAll, handleHeaderClickForSelection, isQueryActive, sortQueryResultsLocally,
  });

  bindSelectionAndTooltip({ handleCellClick, handleRowNumberClick, handleCopyShortcut, handleArrowNavigation, isEditing, showTooltip, hideTooltip });

  // Workspace-specific: add table buttons
  const addTableBtn = document.getElementById('addTableBtn');
  const emptyAddBtn = document.getElementById('emptyAddBtn');

  if (addTableBtn) {
    addTableBtn.addEventListener('click', () => sendMessage({ type: 'addTable', filePath: '' }));
  }
  if (emptyAddBtn) {
    emptyAddBtn.addEventListener('click', () => sendMessage({ type: 'addTable', filePath: '' }));
  }

  // Workspace-specific: table dropdown
  bindTableDropdown();

  // Workspace-specific: filter button (delegated)
  document.addEventListener('click', (e) => {
    const filterBtn = e.target.closest('.filter-btn');
    if (!filterBtn) { return; }
    e.stopPropagation();
    const colIdx = parseInt(filterBtn.dataset.columnIndex, 10);
    if (!isNaN(colIdx)) { openFilterDropdown(colIdx, filterBtn); }
  });

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

window.addEventListener('message', (event) => handleExtensionMessage(event.data));
bindEvents();
sendMessage({ type: 'ready' });
