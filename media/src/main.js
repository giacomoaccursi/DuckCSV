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
import { showLoading, hideLoading, showTable, showError, toggleLoadMore, updateStats, showTooltip, hideTooltip, showContextMenu } from './ui.js';
import { startCellEdit, isEditing, onCellEditConfirm } from './editing.js';
import { initResize } from './resize.js';
import { openFilterDropdown, onColumnValuesReceived, closeFilterDropdown } from './filter-dropdown.js';
import { onQueryResult, clearQuery, resetQueryState, showAutocomplete, closeAutocomplete, handleAutocompleteKeydown } from './query.js';
import { handleCellClick, handleRowNumberClick, handleHeaderClickForSelection, handleCopyShortcut, clearSelection, handleSelectAll } from './selection.js';

const DEBOUNCE_MS = 300;
let searchTimeout = null;

// ─── Message Handler ─────────────────────────────────────────────────────────

function handleExtensionMessage(message) {
  switch (message.type) {
    case 'dataPage': onDataPageReceived(message.data); break;
    case 'columnValues': onColumnValuesReceived(message.data); break;
    case 'cellEditConfirm': onCellEditConfirm(); break;
    case 'queryResult': onQueryResult(message.data); break;
    case 'loading': message.loading ? showLoading() : hideLoading(); break;
    case 'error': showError(message.message); break;
  }
}

function onDataPageReceived(data) {
  resetQueryState();

  state.headers = data.headers;
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
  state.isDirty = data.isDirty;

  if (dom.searchInput && document.activeElement !== dom.searchInput) {
    dom.searchInput.value = data.searchTerm;
  }

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
  if (dom.addRowBtn) { dom.addRowBtn.addEventListener('click', () => sendMessage({ type: 'addRow' })); }

  // Query bar
  if (dom.queryRunBtn) {
    dom.queryRunBtn.addEventListener('click', () => {
      const sql = dom.queryInput ? dom.queryInput.value.trim() : '';
      if (sql) { sendMessage({ type: 'executeQuery', sql, mode: 'inline' }); }
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
        if (sql) { sendMessage({ type: 'executeQuery', sql, mode: 'inline' }); }
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

  // Load more
  if (dom.loadMoreBtn) {
    dom.loadMoreBtn.addEventListener('click', () => {
      dom.loadMoreBtn.disabled = true;
      dom.loadMoreBtn.textContent = 'Loading...';
      sendMessage({ type: 'loadMore' });
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
        sendMessage({ type: 'sort', columnIndex: colIdx, direction: newDirection });
      }, 250);
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

  // Context menu
  document.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('td.editable-cell');
    if (!cell) { return; }
    e.preventDefault();
    const text = cell.dataset.fullText || cell.textContent;
    const rowid = parseInt(cell.dataset.rowid, 10);
    showContextMenu(e.pageX, e.pageY, [
      { label: 'Copy cell', action: () => sendMessage({ type: 'copyToClipboard', text }) },
      { label: 'Delete row', action: () => sendMessage({ type: 'deleteRow', rowid }) },
    ]);
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────

window.addEventListener('message', (event) => handleExtensionMessage(event.data));
bindEvents();
showLoading();
sendMessage({ type: 'ready' });
