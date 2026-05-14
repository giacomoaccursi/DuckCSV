/**
 * CSV Enhanced — Workspace Webview Entry Point
 *
 * Multi-table environment. Reuses rendering/query/selection modules.
 * Adds tables bar and table dropdown.
 */

import { dom } from './dom.js';
import { state } from './state.js';
import { sendMessage } from './messaging.js';
import { toggle } from './utils.js';
import { renderHeader, renderRows, renderQueryRows } from './renderer.js';
import { showLoading, hideLoading, showTable, showError, toggleLoadMore, updateStats, showTooltip, hideTooltip, showContextMenu } from './ui.js';
import { isEditing } from './editing.js';
import { initResize } from './resize.js';
import { openFilterDropdown, onColumnValuesReceived } from './filter-dropdown.js';
import { onQueryResult, clearQuery, resetQueryState, isQueryActive, sortQueryResultsLocally, showAutocomplete, closeAutocomplete, handleAutocompleteKeydown } from './query.js';
import { handleCellClick, handleRowNumberClick, handleHeaderClickForSelection, handleCopyShortcut, clearSelection, handleSelectAll } from './selection.js';
import { renderTablesBar } from './tables-bar.js';
import { updateTableDropdown, bindTableDropdown } from './table-dropdown.js';

const DEBOUNCE_MS = 300;
let searchTimeout = null;
let activeTableName = '';

// ─── Message Handler ─────────────────────────────────────────────────────────

function handleExtensionMessage(message) {
  switch (message.type) {
    case 'dataPage': onDataPageReceived(message.data); break;
    case 'columnValues': onColumnValuesReceived(message.data); break;
    case 'queryResult': onQueryResult(message.data); break;
    case 'tableList': onTableListReceived(message.tables); break;
    case 'loading': message.loading ? showLoading() : hideLoading(); break;
    case 'error': showError(message.message); break;
  }
}

function onDataPageReceived(data) {
  resetQueryState();

  state.headers = data.headers;
  state.originalHeaders = data.headers;
  state.columnTypes = data.columnTypes || [];
  state.rows = data.rows;
  state.rowids = data.rowids || [];
  state.totalRows = data.totalRows;
  state.filteredRows = data.filteredRows;
  state.hasMore = data.hasMore;
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
  toggleLoadMore(data.hasMore);

  if (dom.loadMoreBtn) {
    dom.loadMoreBtn.disabled = false;
    dom.loadMoreBtn.textContent = 'Load More Rows';
  }
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
    allHeaders.push(t.name); // table name itself
  });
  state.originalHeaders = allHeaders;

  // Show/hide empty state
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
  // Search
  if (dom.searchInput) {
    dom.searchInput.addEventListener('input', (e) => {
      if (searchTimeout) { clearTimeout(searchTimeout); }
      searchTimeout = setTimeout(() => {
        sendMessage({ type: 'search', term: e.target.value.trim() });
      }, DEBOUNCE_MS);
    });
  }

  // Add table buttons
  const addTableBtn = document.getElementById('addTableBtn');
  const emptyAddBtn = document.getElementById('emptyAddBtn');

  if (addTableBtn) {
    addTableBtn.addEventListener('click', () => sendMessage({ type: 'addTable', filePath: '' }));
  }
  if (emptyAddBtn) {
    emptyAddBtn.addEventListener('click', () => sendMessage({ type: 'addTable', filePath: '' }));
  }

  // Table dropdown
  bindTableDropdown();

  // Query bar
  const queryRunBtn = document.getElementById('queryRunBtn');
  const querySideBtn = document.getElementById('querySideBtn');
  const queryClearBtn = document.getElementById('queryClearBtn');
  const queryInput = document.getElementById('queryInput');

  if (queryRunBtn) {
    queryRunBtn.addEventListener('click', () => {
      const sql = queryInput ? queryInput.value.trim() : '';
      if (sql) { sendMessage({ type: 'executeQuery', sql, mode: 'inline' }); }
    });
  }
  if (querySideBtn) {
    querySideBtn.addEventListener('click', () => {
      const sql = queryInput ? queryInput.value.trim() : '';
      if (sql) { sendMessage({ type: 'executeQuery', sql, mode: 'side' }); }
    });
  }
  if (queryClearBtn) { queryClearBtn.addEventListener('click', clearQuery); }

  if (queryInput) {
    queryInput.addEventListener('keydown', (e) => {
      if (handleAutocompleteKeydown(e)) { return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        closeAutocomplete();
        const sql = queryInput.value.trim();
        if (sql) { sendMessage({ type: 'executeQuery', sql, mode: 'inline' }); }
      } else if (e.key === 'Escape') {
        clearQuery();
      }
    });
    queryInput.addEventListener('input', () => showAutocomplete(queryInput));
    queryInput.addEventListener('blur', () => setTimeout(closeAutocomplete, 150));
    queryInput.addEventListener('focus', () => {
      if (queryInput.value.trim()) { showAutocomplete(queryInput); }
    });
  }

  // Load more
  if (dom.loadMoreBtn) {
    dom.loadMoreBtn.addEventListener('click', () => {
      dom.loadMoreBtn.disabled = true;
      dom.loadMoreBtn.textContent = 'Loading...';
      sendMessage({ type: 'loadMore' });
    });
  }

  // Header: sort + resize
  let headerClickTimer = null;

  if (dom.tableHeader) {
    dom.tableHeader.addEventListener('click', (e) => {
      if (e.target.closest('.filter-btn') || e.target.closest('.resize-handle')) { return; }
      const th = e.target.closest('th.sortable-header');
      if (!th) { return; }

      const colIdx = parseInt(th.dataset.columnIndex, 10);
      if (isNaN(colIdx)) { return; }

      if (headerClickTimer) { clearTimeout(headerClickTimer); }
      headerClickTimer = setTimeout(() => {
        headerClickTimer = null;

        let newDirection = 'asc';
        if (state.sort.columnIndex === colIdx) {
          if (state.sort.direction === 'asc') { newDirection = 'desc'; }
          else if (state.sort.direction === 'desc') { newDirection = 'none'; }
        }

        if (isQueryActive()) {
          sortQueryResultsLocally(colIdx, newDirection);
        } else {
          sendMessage({ type: 'sort', columnIndex: colIdx, direction: newDirection });
        }
      }, 150);
    });

    dom.tableHeader.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('resize-handle')) { initResize(e); }

      const corner = e.target.closest('.row-number-header');
      if (corner) { handleSelectAll(); }

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

  // Selection
  document.addEventListener('mousedown', (e) => {
    const rowNum = e.target.closest('td.row-number');
    if (rowNum) { handleRowNumberClick(e); return; }
    const td = e.target.closest('td.editable-cell');
    if (td && !isEditing()) { handleCellClick(e); }
  });

  document.addEventListener('keydown', (e) => { handleCopyShortcut(e); });

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

  // Context menu (copy only in workspace — no editing)
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
