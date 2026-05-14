/**
 * CSV Enhanced — Webview Script
 *
 * Purely presentational. All data logic (sort, filter, search, pagination)
 * is handled by the extension backend. This script only:
 *  - Renders data received from the extension
 *  - Sends user interactions as messages to the extension
 *
 * Sections:
 *  1. VS Code API & State
 *  2. DOM References
 *  3. Messaging
 *  4. Rendering
 *  5. Column Filter Dropdown
 *  6. UI Helpers
 *  7. Init & Event Binding
 */

(function () {
  'use strict';

  // ─── 1. VS Code API & State ────────────────────────────────────────────────

  const vscode = acquireVsCodeApi();

  const state = {
    headers: [],
    rows: [],
    totalRows: 0,
    filteredRows: 0,
    hasMore: false,
    delimiter: '',
    fileName: '',
    fileSize: 0,
    sort: { columnIndex: -1, direction: 'none' },
    filters: {},
    searchTerm: '',
    // Column values for filter dropdown
    columnValues: null, // { columnIndex, values }
  };

  const DEBOUNCE_MS = 300;
  let searchTimeout = null;

  // ─── 2. DOM References ─────────────────────────────────────────────────────

  const dom = {
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
      case 'dataPage':
        onDataPageReceived(message.data);
        break;
      case 'columnValues':
        onColumnValuesReceived(message.data);
        break;
      case 'loading':
        message.loading ? showLoading() : hideLoading();
        break;
      case 'error':
        showError(message.message);
        break;
    }
  }

  window.addEventListener('message', (event) => handleExtensionMessage(event.data));

  // ─── 4. Rendering ─────────────────────────────────────────────────────────

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

      // Header content wrapper
      const content = document.createElement('div');
      content.className = 'header-content';

      // Text
      const textSpan = document.createElement('span');
      textSpan.className = 'header-text';
      textSpan.textContent = header || `Column ${i + 1}`;
      content.appendChild(textSpan);

      // Sort indicator
      const sortIndicator = document.createElement('span');
      sortIndicator.className = 'sort-indicator';
      if (state.sort.columnIndex === i) {
        th.classList.add('sort-active');
        if (state.sort.direction === 'asc') {
          sortIndicator.textContent = ' \u25B2';
        } else if (state.sort.direction === 'desc') {
          sortIndicator.textContent = ' \u25BC';
        }
      }
      content.appendChild(sortIndicator);

      th.appendChild(content);

      // Filter button
      const filterBtn = document.createElement('button');
      filterBtn.className = 'filter-btn';
      filterBtn.title = 'Filter column';
      filterBtn.dataset.columnIndex = i;
      filterBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16"><path fill="currentColor" d="M1 2h14l-5.5 6.5V14l-3-2V8.5L1 2z"/></svg>';

      // Highlight if filter is active on this column
      if (state.filters[i] && state.filters[i].length > 0) {
        filterBtn.classList.add('filter-active');
      }

      th.appendChild(filterBtn);

      th.title = (header || `Column ${i + 1}`) + ' (click to sort, funnel to filter)';
      tr.appendChild(th);
    });

    dom.tableHeader.innerHTML = '';
    dom.tableHeader.appendChild(tr);
  }

  function renderRows() {
    if (!dom.tableBody) { return; }

    if (state.rows.length === 0) {
      dom.tableBody.innerHTML = '<tr><td colspan="100" class="empty-message">No data to display</td></tr>';
      return;
    }

    const fragment = document.createDocumentFragment();

    for (let i = 0; i < state.rows.length; i++) {
      fragment.appendChild(createRow(state.rows[i], i));
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

  // ─── 5. Column Filter Dropdown ────────────────────────────────────────────

  let activeDropdown = null;

  function openFilterDropdown(columnIndex, anchorEl) {
    closeFilterDropdown();

    // Request values from backend
    sendMessage({ type: 'getColumnValues', columnIndex });

    // Store which column we're filtering — values arrive async
    state.columnValues = { columnIndex, values: null };

    // Create dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'filter-dropdown';
    dropdown.dataset.columnIndex = columnIndex;

    // Position below the header
    const rect = anchorEl.closest('th').getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = rect.bottom + 'px';

    // Loading state
    dropdown.innerHTML = '<div class="filter-dropdown-loading">Loading values...</div>';

    document.body.appendChild(dropdown);
    activeDropdown = dropdown;

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('mousedown', handleDropdownOutsideClick);
    }, 0);
  }

  function onColumnValuesReceived(data) {
    if (!activeDropdown || !state.columnValues) { return; }
    if (state.columnValues.columnIndex !== data.columnIndex) { return; }

    state.columnValues.values = data.values;
    renderFilterDropdownContent(data.columnIndex, data.values);
  }

  function renderFilterDropdownContent(columnIndex, values) {
    if (!activeDropdown) { return; }

    const currentSelection = state.filters[columnIndex] || [];
    const selectionSet = new Set(currentSelection);

    activeDropdown.innerHTML = '';

    // Search input
    const searchBox = document.createElement('input');
    searchBox.type = 'text';
    searchBox.className = 'filter-search';
    searchBox.placeholder = 'Search values...';
    activeDropdown.appendChild(searchBox);

    // Buttons row
    const btnRow = document.createElement('div');
    btnRow.className = 'filter-btn-row';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'btn btn-sm';
    selectAllBtn.textContent = 'Select All';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-sm';
    clearBtn.textContent = 'Clear';

    btnRow.appendChild(selectAllBtn);
    btnRow.appendChild(clearBtn);
    activeDropdown.appendChild(btnRow);

    // Values list
    const list = document.createElement('div');
    list.className = 'filter-values-list';

    function renderList(filter) {
      list.innerHTML = '';
      const filtered = filter
        ? values.filter(v => v.toLowerCase().includes(filter.toLowerCase()))
        : values;

      filtered.forEach(value => {
        const item = document.createElement('label');
        item.className = 'filter-value-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = value;
        checkbox.checked = selectionSet.has(value);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            selectionSet.add(value);
          } else {
            selectionSet.delete(value);
          }
        });

        const text = document.createElement('span');
        text.className = 'filter-value-text';
        text.textContent = value;
        text.title = value;

        item.appendChild(checkbox);
        item.appendChild(text);
        list.appendChild(item);
      });
    }

    renderList('');
    activeDropdown.appendChild(list);

    // Apply button
    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-primary btn-sm filter-apply-btn';
    applyBtn.textContent = 'Apply';
    activeDropdown.appendChild(applyBtn);

    // Event handlers
    searchBox.addEventListener('input', () => renderList(searchBox.value.trim()));

    selectAllBtn.addEventListener('click', () => {
      values.forEach(v => selectionSet.add(v));
      renderList(searchBox.value.trim());
    });

    clearBtn.addEventListener('click', () => {
      selectionSet.clear();
      renderList(searchBox.value.trim());
    });

    applyBtn.addEventListener('click', () => {
      const newFilters = { ...state.filters };
      if (selectionSet.size === 0 || selectionSet.size === values.length) {
        // No filter or all selected = remove filter for this column
        delete newFilters[columnIndex];
      } else {
        newFilters[columnIndex] = Array.from(selectionSet);
      }
      sendMessage({ type: 'setFilters', filters: newFilters });
      closeFilterDropdown();
    });

    searchBox.focus();
  }

  function closeFilterDropdown() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
    }
    state.columnValues = null;
    document.removeEventListener('mousedown', handleDropdownOutsideClick);
  }

  function handleDropdownOutsideClick(e) {
    if (activeDropdown && !activeDropdown.contains(e.target) && !e.target.closest('.filter-btn')) {
      closeFilterDropdown();
    }
  }

  // ─── 6. UI Helpers ────────────────────────────────────────────────────────

  function onDataPageReceived(data) {
    state.headers = data.headers;
    state.rows = data.rows;
    state.totalRows = data.totalRows;
    state.filteredRows = data.filteredRows;
    state.hasMore = data.hasMore;
    state.delimiter = data.delimiter;
    state.fileName = data.fileName;
    state.fileSize = data.fileSize;
    state.sort = data.sort;
    state.filters = data.filters;
    state.searchTerm = data.searchTerm;

    // Sync search input (don't override if user is typing)
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

  function updateStats() {
    if (!dom.stats) { return; }

    const parts = [];
    parts.push(`${state.rows.length} of ${state.filteredRows} rows`);

    if (state.filteredRows < state.totalRows) {
      parts.push(`(${state.totalRows} total)`);
    }

    parts.push(`\u2022 ${state.headers.length} columns`);

    if (state.fileSize) {
      parts.push(`\u2022 ${formatFileSize(state.fileSize)}`);
    }

    parts.push(`\u2022 ${state.delimiter}`);

    const activeFilterCount = Object.keys(state.filters).length;
    if (activeFilterCount > 0) {
      parts.push(`\u2022 ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} active`);
    }

    dom.stats.textContent = parts.join(' ');
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
    toggle(dom.loadingContainer, false);
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

  // ─── 7. Init & Event Binding ──────────────────────────────────────────────

  function init() {
    bindEvents();
    showLoading();
    sendMessage({ type: 'ready' });
  }

  function bindEvents() {
    // Search with debounce
    if (dom.searchInput) {
      dom.searchInput.addEventListener('input', (e) => {
        if (searchTimeout) { clearTimeout(searchTimeout); }
        searchTimeout = setTimeout(() => {
          sendMessage({ type: 'search', term: e.target.value.trim() });
        }, DEBOUNCE_MS);
      });
    }

    // Toolbar buttons
    if (dom.refreshBtn) {
      dom.refreshBtn.addEventListener('click', () => sendMessage({ type: 'refresh' }));
    }

    if (dom.openAsTextBtn) {
      dom.openAsTextBtn.addEventListener('click', () => sendMessage({ type: 'openAsText' }));
    }

    if (dom.loadMoreBtn) {
      dom.loadMoreBtn.addEventListener('click', () => {
        dom.loadMoreBtn.disabled = true;
        dom.loadMoreBtn.textContent = 'Loading...';
        sendMessage({ type: 'loadMore' });
      });
    }

    // Sort on header click (delegated)
    if (dom.tableHeader) {
      dom.tableHeader.addEventListener('click', (e) => {
        // Ignore clicks on filter button
        if (e.target.closest('.filter-btn')) { return; }

        const th = e.target.closest('th.sortable-header');
        if (!th) { return; }

        const colIdx = parseInt(th.dataset.columnIndex, 10);
        if (isNaN(colIdx)) { return; }

        // Cycle: none → asc → desc → none
        let newDirection = 'asc';
        if (state.sort.columnIndex === colIdx) {
          if (state.sort.direction === 'asc') { newDirection = 'desc'; }
          else if (state.sort.direction === 'desc') { newDirection = 'none'; }
        }

        sendMessage({ type: 'sort', columnIndex: colIdx, direction: newDirection });
      });
    }

    // Filter button click (delegated)
    document.addEventListener('click', (e) => {
      const filterBtn = e.target.closest('.filter-btn');
      if (!filterBtn) { return; }

      e.stopPropagation();
      const colIdx = parseInt(filterBtn.dataset.columnIndex, 10);
      if (isNaN(colIdx)) { return; }

      openFilterDropdown(colIdx, filterBtn);
    });

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
