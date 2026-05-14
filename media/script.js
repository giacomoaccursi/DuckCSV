/**
 * CSV Enhanced — Webview Script
 *
 * Organized into logical sections:
 *  1. VS Code API & State
 *  2. DOM References
 *  3. Messaging (extension ↔ webview)
 *  4. Sorting
 *  5. Search
 *  6. Rendering (header + body)
 *  7. UI Helpers (loading, error, stats, tooltip)
 *  8. Init & Event Binding
 */

(function () {
  'use strict';

  // ─── 1. VS Code API & State ────────────────────────────────────────────────

  const vscode = acquireVsCodeApi();

  /** @type {'asc' | 'desc' | 'none'} */
  const SORT_NONE = 'none';
  const SORT_ASC = 'asc';
  const SORT_DESC = 'desc';

  const state = {
    headers: [],
    rows: [],          // original data from extension
    filteredRows: [],  // after search filter
    sortedRows: [],    // after search + sort (this is what gets rendered)
    totalRows: 0,
    estimatedTotal: 0,
    delimiter: '',
    fileName: '',
    fileSize: 0,
    hasMore: false,
    searchTerm: '',
    sort: {
      columnIndex: -1,
      direction: SORT_NONE,
    },
  };

  // ─── 2. DOM References ─────────────────────────────────────────────────────

  const dom = {
    app: document.getElementById('app'),
    tableContainer: document.getElementById('tableContainer'),
    tableBody: document.getElementById('tableBody'),
    tableHeader: document.getElementById('tableHeader'),
    searchInput: document.getElementById('searchInput'),
    stats: document.getElementById('stats'),
    loadingContainer: document.getElementById('loadingContainer'),
    errorContainer: document.getElementById('errorContainer'),
    errorText: document.getElementById('errorText'),
    refreshBtn: document.getElementById('refreshBtn'),
    openAsTextBtn: document.getElementById('openAsTextBtn'),
    loadMoreBtn: document.getElementById('loadMoreBtn'),
    loadMoreContainer: document.getElementById('loadMoreContainer'),
  };

  // ─── 3. Messaging ─────────────────────────────────────────────────────────

  function sendMessage(message) {
    vscode.postMessage(message);
  }

  function handleExtensionMessage(message) {
    switch (message.type) {
      case 'csvData':
        onCsvDataReceived(message.data);
        break;
      case 'moreRows':
        onMoreRowsReceived(message.data);
        break;
      case 'error':
        showError(message.message);
        break;
    }
  }

  window.addEventListener('message', (event) => handleExtensionMessage(event.data));

  // ─── 4. Sorting ───────────────────────────────────────────────────────────

  /**
   * Cycle sort state for a column: none → asc → desc → none
   */
  function toggleSort(columnIndex) {
    if (state.sort.columnIndex !== columnIndex) {
      // New column: start with asc
      state.sort.columnIndex = columnIndex;
      state.sort.direction = SORT_ASC;
    } else {
      // Same column: cycle
      switch (state.sort.direction) {
        case SORT_NONE: state.sort.direction = SORT_ASC; break;
        case SORT_ASC:  state.sort.direction = SORT_DESC; break;
        case SORT_DESC: state.sort.direction = SORT_NONE; break;
      }
    }

    // Reset column if back to none
    if (state.sort.direction === SORT_NONE) {
      state.sort.columnIndex = -1;
    }

    applySortToFilteredRows();
    renderHeader();
    renderRows();
  }

  /**
   * Apply current sort state to filteredRows, producing sortedRows.
   */
  function applySortToFilteredRows() {
    if (state.sort.direction === SORT_NONE || state.sort.columnIndex < 0) {
      state.sortedRows = state.filteredRows;
      return;
    }

    const colIdx = state.sort.columnIndex;
    const isNumericColumn = detectNumericColumn(state.filteredRows, colIdx);
    const direction = state.sort.direction === SORT_ASC ? 1 : -1;

    // Create index array for stable sort
    const indices = state.filteredRows.map((_, i) => i);

    indices.sort((a, b) => {
      const valA = state.filteredRows[a][colIdx] || '';
      const valB = state.filteredRows[b][colIdx] || '';

      if (valA === valB) { return 0; }

      // Empty values always go last
      if (valA === '') { return 1; }
      if (valB === '') { return -1; }

      let comparison;
      if (isNumericColumn) {
        comparison = parseFloat(valA) - parseFloat(valB);
      } else {
        comparison = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
      }

      return comparison * direction;
    });

    state.sortedRows = indices.map(i => state.filteredRows[i]);
  }

  /**
   * Detect if a column contains predominantly numeric values.
   * Samples up to 100 non-empty values for performance.
   */
  function detectNumericColumn(rows, colIdx) {
    const sampleSize = Math.min(rows.length, 100);
    let numericCount = 0;
    let nonEmptyCount = 0;

    for (let i = 0; i < sampleSize; i++) {
      const val = rows[i][colIdx];
      if (!val || val.trim() === '') { continue; }

      nonEmptyCount++;
      if (isNumericValue(val)) {
        numericCount++;
      }
    }

    // Consider numeric if >90% of non-empty sampled values are numbers
    return nonEmptyCount > 0 && (numericCount / nonEmptyCount) > 0.9;
  }

  /**
   * Check if a string represents a numeric value.
   * Handles integers, decimals, negatives, and common formats (1,000.50).
   */
  function isNumericValue(val) {
    const cleaned = val.replace(/[,\s]/g, '');
    return cleaned !== '' && !isNaN(Number(cleaned)) && isFinite(Number(cleaned));
  }

  /**
   * Reset sort state (called when data changes).
   */
  function resetSort() {
    state.sort.columnIndex = -1;
    state.sort.direction = SORT_NONE;
  }

  // ─── 5. Search ────────────────────────────────────────────────────────────

  function applySearch(term) {
    state.searchTerm = term;

    if (!term) {
      state.filteredRows = state.rows;
    } else {
      const lower = term.toLowerCase();
      state.filteredRows = state.rows.filter(row =>
        row.some(cell => cell && cell.toLowerCase().includes(lower))
      );
    }

    // Re-apply sort on the new filtered set
    applySortToFilteredRows();

    // Reset scroll
    const wrapper = dom.tableContainer && dom.tableContainer.querySelector('.table-wrapper');
    if (wrapper) { wrapper.scrollTop = 0; }

    renderRows();
    updateStats();
  }

  // ─── 6. Rendering ─────────────────────────────────────────────────────────

  function renderHeader() {
    if (!dom.tableHeader) { return; }

    const tr = document.createElement('tr');

    // Row number column
    const rowNumTh = document.createElement('th');
    rowNumTh.className = 'row-number-header';
    rowNumTh.textContent = '#';
    rowNumTh.title = 'Row Number';
    tr.appendChild(rowNumTh);

    // Data columns
    state.headers.forEach((header, i) => {
      const th = document.createElement('th');
      th.className = 'sortable-header';
      th.dataset.columnIndex = i;

      // Header text
      const textSpan = document.createElement('span');
      textSpan.className = 'header-text';
      textSpan.textContent = header || `Column ${i + 1}`;
      th.appendChild(textSpan);

      // Sort indicator
      const indicator = document.createElement('span');
      indicator.className = 'sort-indicator';

      if (state.sort.columnIndex === i) {
        th.classList.add('sort-active');
        if (state.sort.direction === SORT_ASC) {
          indicator.textContent = ' \u25B2';
          th.classList.add('sort-asc');
        } else if (state.sort.direction === SORT_DESC) {
          indicator.textContent = ' \u25BC';
          th.classList.add('sort-desc');
        }
      }

      th.appendChild(indicator);
      th.title = (header || `Column ${i + 1}`) + ' (click to sort)';
      tr.appendChild(th);
    });

    dom.tableHeader.innerHTML = '';
    dom.tableHeader.appendChild(tr);
  }

  function renderRows() {
    if (!dom.tableBody || state.sortedRows.length === 0) {
      if (dom.tableBody) { dom.tableBody.innerHTML = ''; }
      return;
    }

    const fragment = document.createDocumentFragment();

    for (let i = 0; i < state.sortedRows.length; i++) {
      fragment.appendChild(createRow(state.sortedRows[i], i));
    }

    dom.tableBody.innerHTML = '';
    dom.tableBody.appendChild(fragment);
  }

  function createRow(row, index) {
    const tr = document.createElement('tr');
    tr.dataset.rowIndex = index;

    // Row number
    const numTd = document.createElement('td');
    numTd.className = 'row-number';
    numTd.textContent = index + 1;
    tr.appendChild(numTd);

    // Data cells
    row.forEach((cell, colIndex) => {
      const td = document.createElement('td');
      const text = cell || '';

      if (state.searchTerm && text.toLowerCase().includes(state.searchTerm.toLowerCase())) {
        td.innerHTML = highlightMatch(text, state.searchTerm);
      } else {
        td.textContent = text;
      }

      td.title = text;
      td.dataset.columnIndex = colIndex;
      td.dataset.fullText = text;
      tr.appendChild(td);
    });

    return tr;
  }

  function highlightMatch(text, term) {
    const escaped = escapeHtml(text);
    const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
    return escaped.replace(regex, '<span class="search-match">$1</span>');
  }

  // ─── 7. UI Helpers ────────────────────────────────────────────────────────

  function onCsvDataReceived(data) {
    state.headers = data.headers;
    state.rows = data.rows;
    state.totalRows = data.totalRows;
    state.estimatedTotal = data.estimatedTotal;
    state.delimiter = data.delimiter;
    state.fileName = data.fileName;
    state.fileSize = data.fileSize;
    state.hasMore = data.hasMore;
    state.filteredRows = data.rows;
    state.searchTerm = '';

    resetSort();
    state.sortedRows = data.rows;

    if (dom.searchInput) { dom.searchInput.value = ''; }

    renderHeader();
    renderRows();
    updateStats();
    hideLoading();
    showTable();
    toggleLoadMore(data.hasMore);
  }

  function onMoreRowsReceived(data) {
    state.rows = state.rows.concat(data.rows);
    state.totalRows = state.rows.length;
    state.hasMore = data.hasMore;

    // Re-apply search and sort
    if (state.searchTerm) {
      applySearch(state.searchTerm);
    } else {
      state.filteredRows = state.rows;
      applySortToFilteredRows();
    }

    renderRows();
    updateStats();
    toggleLoadMore(state.hasMore);

    if (dom.loadMoreBtn) {
      dom.loadMoreBtn.disabled = false;
      dom.loadMoreBtn.textContent = 'Load More Rows';
    }
  }

  function updateStats() {
    if (!dom.stats) { return; }

    const displayed = state.sortedRows.length;
    const searchInfo = state.searchTerm ? ` (filtered from ${state.totalRows})` : '';
    const moreInfo = state.hasMore ? ` \u2022 ${state.estimatedTotal}+ total` : '';
    const sizeInfo = state.fileSize ? ` \u2022 ${formatFileSize(state.fileSize)}` : '';
    const sortInfo = state.sort.direction !== SORT_NONE
      ? ` \u2022 Sorted: ${state.headers[state.sort.columnIndex] || 'Column ' + (state.sort.columnIndex + 1)} ${state.sort.direction === SORT_ASC ? '\u25B2' : '\u25BC'}`
      : '';

    dom.stats.textContent =
      `${displayed} rows${searchInfo}${moreInfo} \u2022 ${state.headers.length} columns${sizeInfo} \u2022 Delimiter: ${state.delimiter}${sortInfo}`;
  }

  function showLoading() {
    toggle(dom.loadingContainer, true);
    toggle(dom.tableContainer, false);
    toggle(dom.errorContainer, false);
  }

  function hideLoading() {
    toggle(dom.loadingContainer, false);
  }

  function showTable() {
    toggle(dom.tableContainer, true);
    toggle(dom.errorContainer, false);
  }

  function showError(message) {
    hideLoading();
    toggle(dom.tableContainer, false);
    toggle(dom.errorContainer, true);
    if (dom.errorText) { dom.errorText.textContent = message; }
  }

  function toggleLoadMore(visible) {
    toggle(dom.loadMoreContainer, visible);
  }

  function toggle(el, visible) {
    if (!el) { return; }
    el.classList.toggle('hidden', !visible);
  }

  // ─── Tooltip ───────────────────────────────────────────────────────────────

  let tooltipEl = null;

  function showTooltip(text, x, y) {
    hideTooltip();
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'tooltip';
    tooltipEl.textContent = text;
    tooltipEl.style.left = (x + 10) + 'px';
    tooltipEl.style.top = (y + 10) + 'px';
    document.body.appendChild(tooltipEl);
  }

  function hideTooltip() {
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  }

  // ─── Utility ───────────────────────────────────────────────────────────────

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) { return bytes + ' B'; }
    if (bytes < 1024 * 1024) { return (bytes / 1024).toFixed(1) + ' KB'; }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ─── 8. Init & Event Binding ──────────────────────────────────────────────

  function init() {
    bindEvents();
    showLoading();
  }

  function bindEvents() {
    // Search
    if (dom.searchInput) {
      dom.searchInput.addEventListener('input', (e) => applySearch(e.target.value.trim()));
    }

    // Toolbar buttons
    if (dom.refreshBtn) {
      dom.refreshBtn.addEventListener('click', () => {
        sendMessage({ type: 'refresh' });
        showLoading();
      });
    }

    if (dom.openAsTextBtn) {
      dom.openAsTextBtn.addEventListener('click', () => sendMessage({ type: 'openAsText' }));
    }

    if (dom.loadMoreBtn) {
      dom.loadMoreBtn.addEventListener('click', () => {
        dom.loadMoreBtn.disabled = true;
        dom.loadMoreBtn.textContent = 'Loading...';
        sendMessage({ type: 'loadMore', currentRows: state.rows.length });
      });
    }

    // Sort on header click (delegated)
    if (dom.tableHeader) {
      dom.tableHeader.addEventListener('click', (e) => {
        const th = e.target.closest('th.sortable-header');
        if (!th) { return; }
        const colIdx = parseInt(th.dataset.columnIndex, 10);
        if (!isNaN(colIdx)) {
          toggleSort(colIdx);
        }
      });
    }

    // Tooltip on truncated cells
    document.addEventListener('mouseover', (e) => {
      const cell = e.target.closest('td, th');
      if (cell && cell.scrollWidth > cell.clientWidth) {
        const text = cell.dataset.fullText || cell.textContent;
        showTooltip(text, e.pageX, e.pageY);
      }
    });

    document.addEventListener('mouseout', (e) => {
      if (e.target.closest('td, th')) { hideTooltip(); }
    });

    // Right-click to copy cell
    document.addEventListener('contextmenu', (e) => {
      const cell = e.target.closest('td');
      if (!cell) { return; }
      e.preventDefault();
      const text = cell.dataset.fullText || cell.textContent;
      sendMessage({ type: 'copyToClipboard', text });
    });
  }

  init();
})();
