/**
 * CSV Enhanced — Webview Script
 *
 * Purely presentational. All data logic is in the extension backend.
 *
 * Sections:
 *  1. VS Code API & State
 *  2. DOM References
 *  3. Messaging
 *  4. Rendering
 *  5. Column Filter Dropdown
 *  6. Column Coloring
 *  7. Cell Editing
 *  8. UI Helpers
 *  9. Init & Event Binding
 */

(function () {
  'use strict';

  // ─── 1. VS Code API & State ────────────────────────────────────────────────

  const vscode = acquireVsCodeApi();

  const DEBOUNCE_MS = 300;
  let searchTimeout = null;

  // Palette of colors that work on both light and dark themes (low opacity)
  const COLUMN_COLORS = [
    'rgba(66, 135, 245, 0.10)',
    'rgba(72, 199, 142, 0.10)',
    'rgba(245, 166, 35, 0.10)',
    'rgba(155, 89, 182, 0.10)',
    'rgba(231, 76, 60, 0.10)',
    'rgba(26, 188, 156, 0.10)',
    'rgba(241, 196, 15, 0.08)',
    'rgba(232, 67, 147, 0.10)',
  ];

  const state = {
    headers: [],
    rows: [],
    rowids: [],
    totalRows: 0,
    filteredRows: 0,
    hasMore: false,
    delimiter: '',
    fileName: '',
    fileSize: 0,
    sort: { columnIndex: -1, direction: 'none' },
    filters: {},
    searchTerm: '',
    isDirty: false,
    columnValues: null,
    colorColumnsEnabled: false,
    columnWidths: {}, // columnIndex → width string (e.g. '150px')
  };

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
    colorBtn: document.getElementById('colorBtn'),
    addRowBtn: document.getElementById('addRowBtn'),
    loadMoreBtn: document.getElementById('loadMoreBtn'),
    loadMoreContainer: document.getElementById('loadMoreContainer'),
    queryInput: document.getElementById('queryInput'),
    queryRunBtn: document.getElementById('queryRunBtn'),
    querySideBtn: document.getElementById('querySideBtn'),
    queryClearBtn: document.getElementById('queryClearBtn'),
    queryError: document.getElementById('queryError'),
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
      case 'cellEditConfirm':
        onCellEditConfirm();
        break;
      case 'queryResult':
        onQueryResult(message.data);
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

      // Apply saved column width
      if (state.columnWidths[i]) {
        th.style.width = state.columnWidths[i];
        th.style.minWidth = state.columnWidths[i];
        th.style.maxWidth = state.columnWidths[i];
      }

      // Apply column color to header
      const colColor = getColumnColor(i);
      if (colColor) {
        th.style.backgroundColor = colColor;
      }

      // Header content wrapper
      const content = document.createElement('div');
      content.className = 'header-content';

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
      } else {
        // Show hint that sorting is available
        sortIndicator.textContent = ' \u21C5';
      }
      content.appendChild(sortIndicator);
      th.appendChild(content);

      // Filter button
      const filterBtn = document.createElement('button');
      filterBtn.className = 'filter-btn';
      filterBtn.title = 'Filter column';
      filterBtn.dataset.columnIndex = i;
      filterBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16"><path fill="currentColor" d="M1 2h14l-5.5 6.5V14l-3-2V8.5L1 2z"/></svg>';
      if (state.filters[i] && state.filters[i].length > 0) {
        filterBtn.classList.add('filter-active');
      }
      th.appendChild(filterBtn);

      // Resize handle
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'resize-handle';
      th.appendChild(resizeHandle);

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
      fragment.appendChild(createRow(state.rows[i], i, state.rowids[i]));
    }

    dom.tableBody.innerHTML = '';
    dom.tableBody.appendChild(fragment);
  }

  function createRow(row, displayIndex, rowid) {
    const tr = document.createElement('tr');
    tr.dataset.rowIndex = displayIndex;
    tr.dataset.rowid = rowid;

    // Row number
    const numTd = document.createElement('td');
    numTd.className = 'row-number';
    numTd.textContent = displayIndex + 1;
    tr.appendChild(numTd);

    // Data cells
    row.forEach((cell, colIndex) => {
      const td = document.createElement('td');
      td.className = 'editable-cell';
      const text = cell || '';

      // Apply saved column width
      if (state.columnWidths[colIndex]) {
        td.style.width = state.columnWidths[colIndex];
        td.style.minWidth = state.columnWidths[colIndex];
        td.style.maxWidth = state.columnWidths[colIndex];
      }

      // Apply column color
      const colColor = getColumnColor(colIndex);
      if (colColor) {
        td.style.backgroundColor = colColor;
      }

      if (state.searchTerm && text.toLowerCase().includes(state.searchTerm.toLowerCase())) {
        td.innerHTML = highlightMatch(text, state.searchTerm);
      } else {
        td.textContent = text;
      }

      td.title = 'Double-click to edit';
      td.dataset.columnIndex = colIndex;
      td.dataset.rowid = rowid;
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

    sendMessage({ type: 'getColumnValues', columnIndex });
    state.columnValues = { columnIndex, values: null };

    const dropdown = document.createElement('div');
    dropdown.className = 'filter-dropdown';
    dropdown.dataset.columnIndex = columnIndex;

    const rect = anchorEl.closest('th').getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = rect.bottom + 'px';
    dropdown.innerHTML = '<div class="filter-dropdown-loading">Loading values...</div>';

    document.body.appendChild(dropdown);
    activeDropdown = dropdown;

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

    const searchBox = document.createElement('input');
    searchBox.type = 'text';
    searchBox.className = 'filter-search';
    searchBox.placeholder = 'Search values...';
    activeDropdown.appendChild(searchBox);

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
          if (checkbox.checked) { selectionSet.add(value); }
          else { selectionSet.delete(value); }
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

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-primary btn-sm filter-apply-btn';
    applyBtn.textContent = 'Apply';
    activeDropdown.appendChild(applyBtn);

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

  // ─── 6. Column Resize ──────────────────────────────────────────────────────

  let resizeState = null; // { th, startX, startWidth }

  function initResize(e) {
    const handle = e.target;
    if (!handle.classList.contains('resize-handle')) { return; }

    e.preventDefault();
    e.stopPropagation();

    const th = handle.parentElement;
    const startX = e.pageX;
    const startWidth = th.offsetWidth;

    resizeState = { th, startX, startWidth };
    document.body.classList.add('resizing');

    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  }

  function onResizeMove(e) {
    if (!resizeState) { return; }
    const diff = e.pageX - resizeState.startX;
    const newWidth = Math.max(40, resizeState.startWidth + diff);
    const widthStr = newWidth + 'px';

    resizeState.th.style.width = widthStr;
    resizeState.th.style.minWidth = widthStr;
    resizeState.th.style.maxWidth = widthStr;

    // Save to state
    const colIdx = resizeState.th.dataset.columnIndex;
    if (colIdx !== undefined) {
      state.columnWidths[colIdx] = widthStr;

      // Also resize the corresponding column cells
      const cells = dom.tableBody.querySelectorAll(`td[data-column-index="${colIdx}"]`);
      cells.forEach(td => {
        td.style.width = widthStr;
        td.style.minWidth = widthStr;
        td.style.maxWidth = widthStr;
      });
    }
  }

  function onResizeEnd() {
    resizeState = null;
    document.body.classList.remove('resizing');
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  }

  // ─── 7. Column Coloring ───────────────────────────────────────────────────

  function toggleColumnColors() {
    state.colorColumnsEnabled = !state.colorColumnsEnabled;

    // Update button active state
    if (dom.colorBtn) {
      dom.colorBtn.classList.toggle('btn-active', state.colorColumnsEnabled);
    }

    renderHeader();
    renderRows();
  }

  function getColumnColor(colIndex) {
    if (!state.colorColumnsEnabled) { return ''; }
    return COLUMN_COLORS[colIndex % COLUMN_COLORS.length];
  }

  // ─── 7. Cell Editing ──────────────────────────────────────────────────────

  let editingCell = null;

  function startCellEdit(td) {
    if (editingCell) { commitEdit(); }

    const rowid = parseInt(td.dataset.rowid, 10);
    const columnIndex = parseInt(td.dataset.columnIndex, 10);
    const currentValue = td.dataset.fullText || '';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cell-edit-input';
    input.value = currentValue;

    td.innerHTML = '';
    td.appendChild(input);
    td.classList.add('editing');

    input.focus();
    input.select();

    editingCell = { td, input, rowid, columnIndex, originalValue: currentValue };

    input.addEventListener('keydown', handleEditKeydown);
    input.addEventListener('blur', handleEditBlur);
  }

  function handleEditKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit();
    }
  }

  function handleEditBlur() {
    setTimeout(() => {
      if (editingCell) { commitEdit(); }
    }, 50);
  }

  function commitEdit() {
    if (!editingCell) { return; }

    const { td, input, rowid, columnIndex, originalValue } = editingCell;
    const newValue = input.value;

    input.removeEventListener('keydown', handleEditKeydown);
    input.removeEventListener('blur', handleEditBlur);
    td.classList.remove('editing');

    editingCell = null;

    td.textContent = newValue;
    td.dataset.fullText = newValue;

    if (newValue !== originalValue) {
      td.classList.add('cell-modified');
      setTimeout(() => td.classList.remove('cell-modified'), 1500);
      sendMessage({ type: 'editCell', rowid, columnIndex, value: newValue });
    }
  }

  function cancelEdit() {
    if (!editingCell) { return; }

    const { td, input, originalValue } = editingCell;

    input.removeEventListener('keydown', handleEditKeydown);
    input.removeEventListener('blur', handleEditBlur);
    td.classList.remove('editing');

    td.textContent = originalValue;
    editingCell = null;
  }

  function onCellEditConfirm() {
    state.isDirty = true;
    updateStats();
  }

  // ─── 8. Query Results ─────────────────────────────────────────────────────

  let queryActive = false;

  function onQueryResult(data) {
    if (data.error) {
      showQueryError(data.error);
      return;
    }

    hideQueryError();
    queryActive = true;
    toggle(dom.queryClearBtn, true);

    // Render query result in the table (different headers/rows)
    state.headers = data.headers;
    state.rows = data.rows;
    state.rowids = [];
    state.filteredRows = data.rowCount;
    state.totalRows = data.rowCount;
    state.hasMore = false;

    renderHeader();
    renderQueryRows(data.rows, data.headers);
    showTable();
    toggleLoadMore(false);

    if (dom.stats) {
      dom.stats.textContent = `Query: ${data.rowCount} rows \u2022 ${data.executionTimeMs.toFixed(1)}ms`;
    }
  }

  function renderQueryRows(rows, headers) {
    if (!dom.tableBody) { return; }

    if (rows.length === 0) {
      dom.tableBody.innerHTML = '<tr><td colspan="100" class="empty-message">No results</td></tr>';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < rows.length; i++) {
      const tr = document.createElement('tr');

      const numTd = document.createElement('td');
      numTd.className = 'row-number';
      numTd.textContent = i + 1;
      tr.appendChild(numTd);

      rows[i].forEach((cell) => {
        const td = document.createElement('td');
        td.textContent = cell || '';
        td.title = cell || '';
        tr.appendChild(td);
      });

      fragment.appendChild(tr);
    }

    dom.tableBody.innerHTML = '';
    dom.tableBody.appendChild(fragment);
  }

  function clearQuery() {
    queryActive = false;
    toggle(dom.queryClearBtn, false);
    hideQueryError();
    if (dom.queryInput) { dom.queryInput.value = ''; }
    sendMessage({ type: 'clearQuery' });
  }

  function showQueryError(msg) {
    if (dom.queryError) {
      dom.queryError.textContent = msg;
      dom.queryError.classList.remove('hidden');
    }
  }

  function hideQueryError() {
    if (dom.queryError) {
      dom.queryError.classList.add('hidden');
    }
  }

  // ─── 9. Query Autocomplete ────────────────────────────────────────────────

  const SQL_KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'ORDER BY', 'GROUP BY', 'HAVING',
    'LIMIT', 'OFFSET', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN',
    'LIKE', 'IS NULL', 'IS NOT NULL', 'AS', 'DISTINCT',
    'ASC', 'DESC', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
    'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'UNION',
  ];

  let acDropdown = null;
  let acItems = [];
  let acSelectedIndex = -1;

  function getCompletions(inputEl) {
    const value = inputEl.value;
    const cursorPos = inputEl.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);

    // Extract the current word being typed
    const wordMatch = textBeforeCursor.match(/[\w.]+$/);
    if (!wordMatch) { return { word: '', items: [] }; }

    const word = wordMatch[0];
    if (word.length < 1) { return { word: '', items: [] }; }

    const lower = word.toLowerCase();

    // Combine keywords + column names
    const columnNames = state.headers.filter(h => h);
    const allItems = SQL_KEYWORDS.concat(columnNames);

    const matches = allItems.filter(item =>
      item.toLowerCase().startsWith(lower) && item.toLowerCase() !== lower
    );

    // Deduplicate and limit
    const unique = [...new Set(matches)].slice(0, 10);

    return { word, items: unique };
  }

  function showAutocomplete(inputEl) {
    const { word, items } = getCompletions(inputEl);

    if (items.length === 0) {
      closeAutocomplete();
      return;
    }

    acItems = items;
    acSelectedIndex = 0;

    if (!acDropdown) {
      acDropdown = document.createElement('div');
      acDropdown.className = 'ac-dropdown';
      document.body.appendChild(acDropdown);
    }

    // Position below the input
    const rect = inputEl.getBoundingClientRect();
    acDropdown.style.left = rect.left + 'px';
    acDropdown.style.top = rect.bottom + 2 + 'px';
    acDropdown.style.minWidth = Math.min(rect.width, 250) + 'px';

    renderAutocompleteItems();
  }

  function renderAutocompleteItems() {
    if (!acDropdown) { return; }
    acDropdown.innerHTML = '';

    acItems.forEach((item, i) => {
      const div = document.createElement('div');
      div.className = 'ac-item' + (i === acSelectedIndex ? ' ac-item-active' : '');
      div.textContent = item;

      // Indicate if it's a column name
      if (state.headers.includes(item)) {
        const badge = document.createElement('span');
        badge.className = 'ac-badge';
        badge.textContent = 'column';
        div.appendChild(badge);
      }

      div.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const { word } = getCompletions(dom.queryInput);
        acceptCompletion(dom.queryInput, item, word);
      });

      acDropdown.appendChild(div);
    });
  }

  function acceptCompletion(inputEl, item, currentWord) {
    const cursorPos = inputEl.selectionStart;
    const value = inputEl.value;

    // Replace the current word with the selected item
    const before = value.slice(0, cursorPos - currentWord.length);
    const after = value.slice(cursorPos);
    const needsSpace = item.includes(' ') ? '' : ' ';

    inputEl.value = before + item + needsSpace + after;
    const newPos = before.length + item.length + needsSpace.length;
    inputEl.setSelectionRange(newPos, newPos);
    inputEl.focus();

    closeAutocomplete();
  }

  function closeAutocomplete() {
    if (acDropdown) {
      acDropdown.remove();
      acDropdown = null;
    }
    acItems = [];
    acSelectedIndex = -1;
  }

  function handleAutocompleteKeydown(e) {
    if (!acDropdown || acItems.length === 0) { return false; }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acSelectedIndex = (acSelectedIndex + 1) % acItems.length;
      renderAutocompleteItems();
      return true;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      acSelectedIndex = (acSelectedIndex - 1 + acItems.length) % acItems.length;
      renderAutocompleteItems();
      return true;
    }

    if (e.key === 'Tab' || (e.key === 'Enter' && acSelectedIndex >= 0)) {
      if (acItems[acSelectedIndex]) {
        e.preventDefault();
        const { word } = getCompletions(dom.queryInput);
        acceptCompletion(dom.queryInput, acItems[acSelectedIndex], word);
        return true;
      }
    }

    if (e.key === 'Escape') {
      closeAutocomplete();
      return true;
    }

    return false;
  }

  // ─── 10. UI Helpers ───────────────────────────────────────────────────────

  function onDataPageReceived(data) {
    queryActive = false;
    toggle(dom.queryClearBtn, false);

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

    if (state.isDirty) {
      parts.push('\u2022 Modified');
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

  // ─── Context Menu ────────────────────────────────────────────────────────

  let contextMenuEl = null;

  function showContextMenu(x, y, items) {
    closeContextMenu();

    contextMenuEl = document.createElement('div');
    contextMenuEl.className = 'context-menu';
    contextMenuEl.style.left = x + 'px';
    contextMenuEl.style.top = y + 'px';

    items.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'context-menu-item';
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        item.action();
        closeContextMenu();
      });
      contextMenuEl.appendChild(btn);
    });

    document.body.appendChild(contextMenuEl);

    setTimeout(() => {
      document.addEventListener('mousedown', handleContextMenuOutsideClick);
    }, 0);
  }

  function closeContextMenu() {
    if (contextMenuEl) {
      contextMenuEl.remove();
      contextMenuEl = null;
    }
    document.removeEventListener('mousedown', handleContextMenuOutsideClick);
  }

  function handleContextMenuOutsideClick(e) {
    if (contextMenuEl && !contextMenuEl.contains(e.target)) {
      closeContextMenu();
    }
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

  // ─── 9. Init & Event Binding ──────────────────────────────────────────────

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

    if (dom.colorBtn) {
      dom.colorBtn.addEventListener('click', () => toggleColumnColors());
    }

    if (dom.addRowBtn) {
      dom.addRowBtn.addEventListener('click', () => sendMessage({ type: 'addRow' }));
    }

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

    if (dom.queryClearBtn) {
      dom.queryClearBtn.addEventListener('click', () => clearQuery());
    }

    if (dom.queryInput) {
      dom.queryInput.addEventListener('keydown', (e) => {
        // Let autocomplete handle navigation keys first
        if (handleAutocompleteKeydown(e)) { return; }

        if (e.key === 'Enter') {
          e.preventDefault();
          closeAutocomplete();
          const sql = dom.queryInput.value.trim();
          if (sql) { sendMessage({ type: 'executeQuery', sql, mode: 'inline' }); }
        } else if (e.key === 'Escape') {
          if (queryActive) { clearQuery(); }
        }
      });

      dom.queryInput.addEventListener('input', () => {
        showAutocomplete(dom.queryInput);
      });

      dom.queryInput.addEventListener('blur', () => {
        // Delay to allow mousedown on dropdown items
        setTimeout(() => closeAutocomplete(), 150);
      });

      dom.queryInput.addEventListener('focus', () => {
        if (dom.queryInput.value.trim()) {
          showAutocomplete(dom.queryInput);
        }
      });
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
        if (e.target.closest('.filter-btn')) { return; }
        if (e.target.closest('.resize-handle')) { return; }
        const th = e.target.closest('th.sortable-header');
        if (!th) { return; }

        const colIdx = parseInt(th.dataset.columnIndex, 10);
        if (isNaN(colIdx)) { return; }

        let newDirection = 'asc';
        if (state.sort.columnIndex === colIdx) {
          if (state.sort.direction === 'asc') { newDirection = 'desc'; }
          else if (state.sort.direction === 'desc') { newDirection = 'none'; }
        }

        sendMessage({ type: 'sort', columnIndex: colIdx, direction: newDirection });
      });

      // Column resize (delegated mousedown on resize handles)
      dom.tableHeader.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('resize-handle')) {
          initResize(e);
        }
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

    // Double-click to edit cell (delegated)
    document.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td.editable-cell');
      if (!td) { return; }
      startCellEdit(td);
    });

    // Tooltip on truncated cells (skip if editing)
    document.addEventListener('mouseover', (e) => {
      if (editingCell) { return; }
      const cell = e.target.closest('td, th');
      if (cell && cell.scrollWidth > cell.clientWidth && !cell.classList.contains('editing')) {
        const text = cell.dataset.fullText || cell.textContent;
        showTooltip(text, e.pageX, e.pageY);
      }
    });

    document.addEventListener('mouseout', (e) => {
      if (e.target.closest('td, th')) { hideTooltip(); }
    });

    // Right-click context menu on cells
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

  init();
})();
