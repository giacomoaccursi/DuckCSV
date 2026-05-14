"use strict";
(() => {
  // media/src/dom.js
  var dom = {
    tableContainer: document.getElementById("tableContainer"),
    tableBody: document.getElementById("tableBody"),
    tableHeader: document.getElementById("tableHeader"),
    searchInput: document.getElementById("searchInput"),
    stats: document.getElementById("stats"),
    loadingContainer: document.getElementById("loadingContainer"),
    errorContainer: document.getElementById("errorContainer"),
    errorText: document.getElementById("errorText"),
    refreshBtn: document.getElementById("refreshBtn"),
    openAsTextBtn: document.getElementById("openAsTextBtn"),
    colorBtn: document.getElementById("colorBtn"),
    addRowBtn: document.getElementById("addRowBtn"),
    loadMoreBtn: document.getElementById("loadMoreBtn"),
    loadMoreContainer: document.getElementById("loadMoreContainer"),
    queryInput: document.getElementById("queryInput"),
    queryRunBtn: document.getElementById("queryRunBtn"),
    querySideBtn: document.getElementById("querySideBtn"),
    queryClearBtn: document.getElementById("queryClearBtn"),
    queryError: document.getElementById("queryError")
  };

  // media/src/state.js
  var COLUMN_COLORS = [
    "rgba(66, 135, 245, 0.10)",
    "rgba(72, 199, 142, 0.10)",
    "rgba(245, 166, 35, 0.10)",
    "rgba(155, 89, 182, 0.10)",
    "rgba(231, 76, 60, 0.10)",
    "rgba(26, 188, 156, 0.10)",
    "rgba(241, 196, 15, 0.08)",
    "rgba(232, 67, 147, 0.10)"
  ];
  var SQL_KEYWORDS = [
    "SELECT",
    "FROM",
    "WHERE",
    "ORDER BY",
    "GROUP BY",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "AND",
    "OR",
    "NOT",
    "IN",
    "BETWEEN",
    "LIKE",
    "IS NULL",
    "IS NOT NULL",
    "AS",
    "DISTINCT",
    "ASC",
    "DESC",
    "COUNT",
    "SUM",
    "AVG",
    "MIN",
    "MAX",
    "JOIN",
    "LEFT JOIN",
    "INNER JOIN",
    "ON",
    "UNION"
  ];
  var state = {
    headers: [],
    // current displayed headers (may change with query results)
    originalHeaders: [],
    // always the file's original headers (for autocomplete)
    rows: [],
    rowids: [],
    totalRows: 0,
    filteredRows: 0,
    hasMore: false,
    delimiter: "",
    fileName: "",
    fileSize: 0,
    sort: { columnIndex: -1, direction: "none" },
    filters: {},
    searchTerm: "",
    isDirty: false,
    columnValues: null,
    colorColumnsEnabled: false,
    columnWidths: {}
  };

  // media/src/messaging.js
  var vscode = acquireVsCodeApi();
  function sendMessage(message) {
    vscode.postMessage(message);
  }

  // media/src/utils.js
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function formatFileSize(bytes) {
    if (bytes < 1024) {
      return bytes + " B";
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + " KB";
    }
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }
  function toggle(el, visible) {
    if (!el) {
      return;
    }
    el.classList.toggle("hidden", !visible);
  }
  function insertAtCursor(input, text) {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const value = input.value;
    const needsSpace = start > 0 && value[start - 1] !== " " ? " " : "";
    input.value = value.slice(0, start) + needsSpace + text + " " + value.slice(end);
    const newPos = start + needsSpace.length + text.length + 1;
    input.setSelectionRange(newPos, newPos);
    input.focus();
  }

  // media/src/renderer.js
  function getColumnColor(colIndex) {
    if (!state.colorColumnsEnabled) {
      return "";
    }
    return COLUMN_COLORS[colIndex % COLUMN_COLORS.length];
  }
  function renderHeader() {
    if (!dom.tableHeader) {
      return;
    }
    dom.tableHeader.innerHTML = "";
    const selRow = document.createElement("tr");
    selRow.className = "column-select-row";
    const selCorner = document.createElement("th");
    selCorner.className = "row-number-header column-select-corner";
    selRow.appendChild(selCorner);
    state.headers.forEach((_, i) => {
      const selTh = document.createElement("th");
      selTh.className = "column-select-cell";
      selTh.dataset.columnIndex = i;
      selTh.title = "Click to select entire column";
      const box = document.createElement("div");
      box.className = "column-select-box";
      selTh.appendChild(box);
      selRow.appendChild(selTh);
    });
    dom.tableHeader.appendChild(selRow);
    const tr = document.createElement("tr");
    const rowNumTh = document.createElement("th");
    rowNumTh.className = "row-number-header";
    rowNumTh.textContent = "#";
    rowNumTh.title = "Row Number";
    tr.appendChild(rowNumTh);
    state.headers.forEach((header, i) => {
      const th = document.createElement("th");
      th.className = "sortable-header";
      th.dataset.columnIndex = i;
      if (state.columnWidths[i]) {
        th.style.width = state.columnWidths[i];
        th.style.minWidth = state.columnWidths[i];
        th.style.maxWidth = state.columnWidths[i];
      }
      const colColor = getColumnColor(i);
      if (colColor) {
        th.style.backgroundColor = colColor;
      }
      const content = document.createElement("div");
      content.className = "header-content";
      const textSpan = document.createElement("span");
      textSpan.className = "header-text";
      textSpan.textContent = header || `Column ${i + 1}`;
      content.appendChild(textSpan);
      const sortIndicator = document.createElement("span");
      sortIndicator.className = "sort-indicator";
      if (state.sort.columnIndex === i) {
        th.classList.add("sort-active");
        sortIndicator.textContent = state.sort.direction === "asc" ? " \u25B2" : " \u25BC";
      } else {
        sortIndicator.textContent = " \u21C5";
      }
      content.appendChild(sortIndicator);
      th.appendChild(content);
      const filterBtn = document.createElement("button");
      filterBtn.className = "filter-btn";
      filterBtn.title = "Filter column";
      filterBtn.dataset.columnIndex = i;
      filterBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16"><path fill="currentColor" d="M1 2h14l-5.5 6.5V14l-3-2V8.5L1 2z"/></svg>';
      if (state.filters[i] && state.filters[i].length > 0) {
        filterBtn.classList.add("filter-active");
      }
      th.appendChild(filterBtn);
      const resizeHandle = document.createElement("div");
      resizeHandle.className = "resize-handle";
      th.appendChild(resizeHandle);
      th.title = (header || `Column ${i + 1}`) + " (click to sort, funnel to filter)";
      tr.appendChild(th);
    });
    dom.tableHeader.appendChild(tr);
  }
  function renderRows() {
    if (!dom.tableBody) {
      return;
    }
    if (state.rows.length === 0) {
      dom.tableBody.innerHTML = '<tr><td colspan="100" class="empty-message">No data to display</td></tr>';
      return;
    }
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < state.rows.length; i++) {
      fragment.appendChild(createRow(state.rows[i], i, state.rowids[i]));
    }
    dom.tableBody.innerHTML = "";
    dom.tableBody.appendChild(fragment);
  }
  function renderQueryRows(rows) {
    if (!dom.tableBody) {
      return;
    }
    if (rows.length === 0) {
      dom.tableBody.innerHTML = '<tr><td colspan="100" class="empty-message">No results</td></tr>';
      return;
    }
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < rows.length; i++) {
      const tr = document.createElement("tr");
      const numTd = document.createElement("td");
      numTd.className = "row-number";
      numTd.textContent = i + 1;
      tr.appendChild(numTd);
      rows[i].forEach((cell) => {
        const td = document.createElement("td");
        td.textContent = cell || "";
        td.title = cell || "";
        tr.appendChild(td);
      });
      fragment.appendChild(tr);
    }
    dom.tableBody.innerHTML = "";
    dom.tableBody.appendChild(fragment);
  }
  function createRow(row, displayIndex, rowid) {
    const tr = document.createElement("tr");
    tr.dataset.rowIndex = displayIndex;
    tr.dataset.rowid = rowid;
    const numTd = document.createElement("td");
    numTd.className = "row-number";
    numTd.textContent = displayIndex + 1;
    tr.appendChild(numTd);
    row.forEach((cell, colIndex) => {
      const td = document.createElement("td");
      td.className = "editable-cell";
      const text = cell || "";
      if (state.columnWidths[colIndex]) {
        td.style.width = state.columnWidths[colIndex];
        td.style.minWidth = state.columnWidths[colIndex];
        td.style.maxWidth = state.columnWidths[colIndex];
      }
      const colColor = getColumnColor(colIndex);
      if (colColor) {
        td.style.backgroundColor = colColor;
      }
      if (state.searchTerm && text.toLowerCase().includes(state.searchTerm.toLowerCase())) {
        td.innerHTML = highlightMatch(text, state.searchTerm);
      } else {
        td.textContent = text;
      }
      td.title = "Double-click to edit";
      td.dataset.columnIndex = colIndex;
      td.dataset.rowid = rowid;
      td.dataset.fullText = text;
      tr.appendChild(td);
    });
    return tr;
  }
  function highlightMatch(text, term) {
    const escaped = escapeHtml(text);
    const regex = new RegExp(`(${escapeRegex(term)})`, "gi");
    return escaped.replace(regex, '<span class="search-match">$1</span>');
  }

  // media/src/ui.js
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
    if (dom.errorText) {
      dom.errorText.textContent = message;
    }
  }
  function toggleLoadMore(visible) {
    toggle(dom.loadMoreContainer, visible);
  }
  function updateStats() {
    if (!dom.stats) {
      return;
    }
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
      parts.push(`\u2022 ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""} active`);
    }
    if (state.isDirty) {
      parts.push("\u2022 Modified");
    }
    dom.stats.textContent = parts.join(" ");
  }
  var tooltipEl = null;
  function showTooltip(text, x, y) {
    hideTooltip();
    tooltipEl = document.createElement("div");
    tooltipEl.className = "tooltip";
    tooltipEl.textContent = text;
    tooltipEl.style.left = x + 10 + "px";
    tooltipEl.style.top = y + 10 + "px";
    document.body.appendChild(tooltipEl);
  }
  function hideTooltip() {
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  }
  var contextMenuEl = null;
  function showContextMenu(x, y, items) {
    closeContextMenu();
    contextMenuEl = document.createElement("div");
    contextMenuEl.className = "context-menu";
    contextMenuEl.style.left = x + "px";
    contextMenuEl.style.top = y + "px";
    items.forEach((item) => {
      const btn = document.createElement("button");
      btn.className = "context-menu-item";
      btn.textContent = item.label;
      btn.addEventListener("click", () => {
        item.action();
        closeContextMenu();
      });
      contextMenuEl.appendChild(btn);
    });
    document.body.appendChild(contextMenuEl);
    setTimeout(() => {
      document.addEventListener("mousedown", handleOutsideClick);
    }, 0);
  }
  function closeContextMenu() {
    if (contextMenuEl) {
      contextMenuEl.remove();
      contextMenuEl = null;
    }
    document.removeEventListener("mousedown", handleOutsideClick);
  }
  function handleOutsideClick(e) {
    if (contextMenuEl && !contextMenuEl.contains(e.target)) {
      closeContextMenu();
    }
  }

  // media/src/editing.js
  var editingCell = null;
  function startCellEdit(td) {
    if (editingCell) {
      commitEdit();
    }
    const rowid = parseInt(td.dataset.rowid, 10);
    const columnIndex = parseInt(td.dataset.columnIndex, 10);
    const currentValue = td.dataset.fullText || "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "cell-edit-input";
    input.value = currentValue;
    td.innerHTML = "";
    td.appendChild(input);
    td.classList.add("editing");
    input.focus();
    input.select();
    editingCell = { td, input, rowid, columnIndex, originalValue: currentValue };
    input.addEventListener("keydown", handleKeydown);
    input.addEventListener("blur", handleBlur);
  }
  function isEditing() {
    return editingCell !== null;
  }
  function onCellEditConfirm() {
    state.isDirty = true;
    updateStats();
  }
  function handleKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitEdit();
    }
  }
  function handleBlur() {
    setTimeout(() => {
      if (editingCell) {
        commitEdit();
      }
    }, 50);
  }
  function commitEdit() {
    if (!editingCell) {
      return;
    }
    const { td, input, rowid, columnIndex, originalValue } = editingCell;
    const newValue = input.value;
    input.removeEventListener("keydown", handleKeydown);
    input.removeEventListener("blur", handleBlur);
    td.classList.remove("editing");
    editingCell = null;
    td.textContent = newValue;
    td.dataset.fullText = newValue;
    if (newValue !== originalValue) {
      td.classList.add("cell-modified");
      setTimeout(() => td.classList.remove("cell-modified"), 1500);
      sendMessage({ type: "editCell", rowid, columnIndex, value: newValue });
    }
  }
  function cancelEdit() {
    if (!editingCell) {
      return;
    }
    const { td, input, originalValue } = editingCell;
    input.removeEventListener("keydown", handleKeydown);
    input.removeEventListener("blur", handleBlur);
    td.classList.remove("editing");
    td.textContent = originalValue;
    editingCell = null;
  }

  // media/src/resize.js
  var resizeState = null;
  function initResize(e) {
    e.preventDefault();
    e.stopPropagation();
    const th = e.target.parentElement;
    resizeState = { th, startX: e.pageX, startWidth: th.offsetWidth };
    document.body.classList.add("resizing");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
  }
  function onMove(e) {
    if (!resizeState) {
      return;
    }
    const newWidth = Math.max(40, resizeState.startWidth + (e.pageX - resizeState.startX));
    const widthStr = newWidth + "px";
    resizeState.th.style.width = widthStr;
    resizeState.th.style.minWidth = widthStr;
    resizeState.th.style.maxWidth = widthStr;
    const colIdx = resizeState.th.dataset.columnIndex;
    if (colIdx !== void 0) {
      state.columnWidths[colIdx] = widthStr;
      const cells = dom.tableBody.querySelectorAll(`td[data-column-index="${colIdx}"]`);
      cells.forEach((td) => {
        td.style.width = widthStr;
        td.style.minWidth = widthStr;
        td.style.maxWidth = widthStr;
      });
    }
  }
  function onEnd() {
    resizeState = null;
    document.body.classList.remove("resizing");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onEnd);
  }

  // media/src/filter-dropdown.js
  var activeDropdown = null;
  function openFilterDropdown(columnIndex, anchorEl) {
    closeFilterDropdown();
    sendMessage({ type: "getColumnValues", columnIndex });
    state.columnValues = { columnIndex, values: null };
    const dropdown = document.createElement("div");
    dropdown.className = "filter-dropdown";
    dropdown.dataset.columnIndex = columnIndex;
    const rect = anchorEl.closest("th").getBoundingClientRect();
    dropdown.style.left = rect.left + "px";
    dropdown.style.top = rect.bottom + "px";
    dropdown.innerHTML = '<div class="filter-dropdown-loading">Loading values...</div>';
    document.body.appendChild(dropdown);
    activeDropdown = dropdown;
    setTimeout(() => {
      document.addEventListener("mousedown", handleOutsideClick2);
    }, 0);
  }
  function onColumnValuesReceived(data) {
    if (!activeDropdown || !state.columnValues) {
      return;
    }
    if (state.columnValues.columnIndex !== data.columnIndex) {
      return;
    }
    state.columnValues.values = data.values;
    renderContent(data.columnIndex, data.values);
  }
  function closeFilterDropdown() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
    }
    state.columnValues = null;
    document.removeEventListener("mousedown", handleOutsideClick2);
  }
  function handleOutsideClick2(e) {
    if (activeDropdown && !activeDropdown.contains(e.target) && !e.target.closest(".filter-btn")) {
      closeFilterDropdown();
    }
  }
  function renderContent(columnIndex, values) {
    if (!activeDropdown) {
      return;
    }
    const currentSelection = state.filters[columnIndex] || [];
    const selectionSet = new Set(currentSelection);
    activeDropdown.innerHTML = "";
    const searchBox = document.createElement("input");
    searchBox.type = "text";
    searchBox.className = "filter-search";
    searchBox.placeholder = "Search values...";
    activeDropdown.appendChild(searchBox);
    const btnRow = document.createElement("div");
    btnRow.className = "filter-btn-row";
    const selectAllBtn = document.createElement("button");
    selectAllBtn.className = "btn btn-sm";
    selectAllBtn.textContent = "Select All";
    const clearBtn = document.createElement("button");
    clearBtn.className = "btn btn-sm";
    clearBtn.textContent = "Clear";
    btnRow.appendChild(selectAllBtn);
    btnRow.appendChild(clearBtn);
    activeDropdown.appendChild(btnRow);
    const list = document.createElement("div");
    list.className = "filter-values-list";
    function renderList(filter) {
      list.innerHTML = "";
      const filtered = filter ? values.filter((v) => v.toLowerCase().includes(filter.toLowerCase())) : values;
      filtered.forEach((value) => {
        const item = document.createElement("label");
        item.className = "filter-value-item";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = value;
        checkbox.checked = selectionSet.has(value);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            selectionSet.add(value);
          } else {
            selectionSet.delete(value);
          }
        });
        const text = document.createElement("span");
        text.className = "filter-value-text";
        text.textContent = value;
        text.title = value;
        item.appendChild(checkbox);
        item.appendChild(text);
        list.appendChild(item);
      });
    }
    renderList("");
    activeDropdown.appendChild(list);
    const applyBtn = document.createElement("button");
    applyBtn.className = "btn btn-primary btn-sm filter-apply-btn";
    applyBtn.textContent = "Apply";
    activeDropdown.appendChild(applyBtn);
    searchBox.addEventListener("input", () => renderList(searchBox.value.trim()));
    selectAllBtn.addEventListener("click", () => {
      values.forEach((v) => selectionSet.add(v));
      renderList(searchBox.value.trim());
    });
    clearBtn.addEventListener("click", () => {
      selectionSet.clear();
      renderList(searchBox.value.trim());
    });
    applyBtn.addEventListener("click", () => {
      const newFilters = { ...state.filters };
      if (selectionSet.size === 0 || selectionSet.size === values.length) {
        delete newFilters[columnIndex];
      } else {
        newFilters[columnIndex] = Array.from(selectionSet);
      }
      sendMessage({ type: "setFilters", filters: newFilters });
      closeFilterDropdown();
    });
    searchBox.focus();
  }

  // media/src/query.js
  var queryActive = false;
  function onQueryResult(data) {
    if (data.error) {
      showQueryError(data.error);
      return;
    }
    hideQueryError();
    queryActive = true;
    toggle(dom.queryClearBtn, true);
    state.headers = data.headers;
    state.rows = data.rows;
    state.rowids = [];
    state.filteredRows = data.rowCount;
    state.totalRows = data.rowCount;
    state.hasMore = false;
    renderHeader();
    renderQueryRows(data.rows);
    showTable();
    toggleLoadMore(false);
    if (dom.stats) {
      dom.stats.textContent = `Query: ${data.rowCount} rows \u2022 ${data.executionTimeMs.toFixed(1)}ms`;
    }
  }
  function clearQuery() {
    queryActive = false;
    toggle(dom.queryClearBtn, false);
    hideQueryError();
    if (dom.queryInput) {
      dom.queryInput.value = "";
    }
    sendMessage({ type: "clearQuery" });
  }
  function resetQueryState() {
    queryActive = false;
    toggle(dom.queryClearBtn, false);
  }
  function showQueryError(msg) {
    if (dom.queryError) {
      dom.queryError.textContent = msg;
      dom.queryError.classList.remove("hidden");
    }
  }
  function hideQueryError() {
    if (dom.queryError) {
      dom.queryError.classList.add("hidden");
    }
  }
  var acDropdown = null;
  var acItems = [];
  var acSelectedIndex = -1;
  function showAutocomplete(inputEl) {
    const { word, items } = getCompletions(inputEl);
    if (items.length === 0) {
      closeAutocomplete();
      return;
    }
    acItems = items;
    acSelectedIndex = 0;
    if (!acDropdown) {
      acDropdown = document.createElement("div");
      acDropdown.className = "ac-dropdown";
      document.body.appendChild(acDropdown);
    }
    const rect = inputEl.getBoundingClientRect();
    acDropdown.style.left = rect.left + "px";
    acDropdown.style.top = rect.bottom + 2 + "px";
    acDropdown.style.minWidth = Math.min(rect.width, 250) + "px";
    renderItems();
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
    if (!acDropdown || acItems.length === 0) {
      return false;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      acSelectedIndex = (acSelectedIndex + 1) % acItems.length;
      renderItems();
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      acSelectedIndex = (acSelectedIndex - 1 + acItems.length) % acItems.length;
      renderItems();
      return true;
    }
    if (e.key === "Tab" || e.key === "Enter" && acSelectedIndex >= 0) {
      if (acItems[acSelectedIndex]) {
        e.preventDefault();
        const { word } = getCompletions(dom.queryInput);
        acceptCompletion(dom.queryInput, acItems[acSelectedIndex], word);
        return true;
      }
    }
    if (e.key === "Escape") {
      closeAutocomplete();
      return true;
    }
    return false;
  }
  function getCompletions(inputEl) {
    const value = inputEl.value;
    const cursorPos = inputEl.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const wordMatch = textBeforeCursor.match(/[\w.]+$/);
    if (!wordMatch) {
      return { word: "", items: [] };
    }
    const word = wordMatch[0];
    if (word.length < 1) {
      return { word: "", items: [] };
    }
    const lower = word.toLowerCase();
    const columnNames = state.originalHeaders.filter((h) => h).map((h) => /[^a-zA-Z0-9_]/.test(h) ? `"${h}"` : h);
    const allItems = SQL_KEYWORDS.concat(columnNames);
    const matches = allItems.filter(
      (item) => item.toLowerCase().startsWith(lower) && item.toLowerCase() !== lower
    );
    return { word, items: [...new Set(matches)].slice(0, 10) };
  }
  function renderItems() {
    if (!acDropdown) {
      return;
    }
    acDropdown.innerHTML = "";
    acItems.forEach((item, i) => {
      const div = document.createElement("div");
      div.className = "ac-item" + (i === acSelectedIndex ? " ac-item-active" : "");
      div.textContent = item;
      const unquoted = item.replace(/^"|"$/g, "");
      if (state.originalHeaders.includes(item) || state.originalHeaders.includes(unquoted)) {
        const badge = document.createElement("span");
        badge.className = "ac-badge";
        badge.textContent = "column";
        div.appendChild(badge);
      }
      div.addEventListener("mousedown", (e) => {
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
    const before = value.slice(0, cursorPos - currentWord.length);
    const after = value.slice(cursorPos);
    const needsSpace = item.includes(" ") ? "" : " ";
    inputEl.value = before + item + needsSpace + after;
    const newPos = before.length + item.length + needsSpace.length;
    inputEl.setSelectionRange(newPos, newPos);
    inputEl.focus();
    closeAutocomplete();
  }

  // media/src/selection.js
  var selection = null;
  var selectionMode = "none";
  var isDragging = false;
  function clearSelection() {
    selection = null;
    selectionMode = "none";
    removeHighlights();
  }
  function handleCellClick(e) {
    const td = e.target.closest("td.editable-cell");
    if (!td) {
      return;
    }
    const row = parseInt(td.closest("tr").dataset.rowIndex, 10);
    const col = parseInt(td.dataset.columnIndex, 10);
    if (isNaN(row) || isNaN(col)) {
      return;
    }
    if (e.shiftKey && selection) {
      selection.endRow = row;
      selection.endCol = col;
    } else {
      selection = { startRow: row, startCol: col, endRow: row, endCol: col };
      selectionMode = "cell";
    }
    applyHighlights();
  }
  function handleRowNumberClick(e) {
    const td = e.target.closest("td.row-number");
    if (!td) {
      return;
    }
    const tr = td.closest("tr");
    const row = parseInt(tr.dataset.rowIndex, 10);
    if (isNaN(row)) {
      return;
    }
    const maxCol = state.headers.length - 1;
    selection = { startRow: row, startCol: 0, endRow: row, endCol: maxCol };
    selectionMode = "row";
    isDragging = true;
    document.body.classList.add("selecting");
    applyHighlights();
    const onMove2 = (ev) => {
      const rowEl = ev.target.closest("tr[data-row-index]");
      if (!rowEl) {
        return;
      }
      const newRow = parseInt(rowEl.dataset.rowIndex, 10);
      if (isNaN(newRow)) {
        return;
      }
      selection.endRow = newRow;
      applyHighlights();
    };
    const onUp = () => {
      isDragging = false;
      document.body.classList.remove("selecting");
      document.removeEventListener("mousemove", onMove2);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove2);
    document.addEventListener("mouseup", onUp);
  }
  function handleSelectAll() {
    const maxRow = state.rows.length - 1;
    const maxCol = state.headers.length - 1;
    if (maxRow < 0 || maxCol < 0) {
      return;
    }
    selection = { startRow: 0, startCol: 0, endRow: maxRow, endCol: maxCol };
    selectionMode = "cell";
    applyHighlights();
  }
  function handleHeaderClickForSelection(colIdx, e) {
    const maxRow = state.rows.length - 1;
    if (maxRow < 0) {
      return;
    }
    selection = { startRow: 0, startCol: colIdx, endRow: maxRow, endCol: colIdx };
    selectionMode = "column";
    isDragging = true;
    document.body.classList.add("selecting");
    applyHighlights();
    const onMove2 = (ev) => {
      const selCell = ev.target.closest(".column-select-cell");
      if (!selCell) {
        return;
      }
      const newCol = parseInt(selCell.dataset.columnIndex, 10);
      if (isNaN(newCol)) {
        return;
      }
      selection.endCol = newCol;
      applyHighlights();
    };
    const onUp = () => {
      isDragging = false;
      document.body.classList.remove("selecting");
      document.removeEventListener("mousemove", onMove2);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove2);
    document.addEventListener("mouseup", onUp);
  }
  function handleCopyShortcut(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key !== "c") {
      return;
    }
    if (!selection) {
      return;
    }
    e.preventDefault();
    const text = getSelectionText();
    if (text) {
      sendMessage({ type: "copyToClipboard", text });
    }
  }
  function getSelectionText() {
    if (!selection) {
      return "";
    }
    const minRow = Math.min(selection.startRow, selection.endRow);
    const maxRow = Math.max(selection.startRow, selection.endRow);
    const minCol = Math.min(selection.startCol, selection.endCol);
    const maxCol = Math.max(selection.startCol, selection.endCol);
    const delimiter = getDelimiterChar(state.delimiter);
    const lines = [];
    for (let r = minRow; r <= maxRow; r++) {
      if (r >= state.rows.length) {
        break;
      }
      const cells = [];
      for (let c = minCol; c <= maxCol; c++) {
        const val = state.rows[r][c] || "";
        if (val.includes(delimiter) || val.includes('"') || val.includes("\n")) {
          cells.push('"' + val.replace(/"/g, '""') + '"');
        } else {
          cells.push(val);
        }
      }
      lines.push(cells.join(delimiter));
    }
    return lines.join("\n");
  }
  function getDelimiterChar(delimiterName) {
    switch (delimiterName) {
      case "Comma":
        return ",";
      case "Semicolon":
        return ";";
      case "Tab":
        return "	";
      case "Pipe":
        return "|";
      default:
        return ",";
    }
  }
  function applyHighlights() {
    removeHighlights();
    if (!selection) {
      return;
    }
    const minRow = Math.min(selection.startRow, selection.endRow);
    const maxRow = Math.max(selection.startRow, selection.endRow);
    const minCol = Math.min(selection.startCol, selection.endCol);
    const maxCol = Math.max(selection.startCol, selection.endCol);
    const rows = dom.tableBody.querySelectorAll("tr");
    rows.forEach((tr) => {
      const rowIdx = parseInt(tr.dataset.rowIndex, 10);
      if (isNaN(rowIdx) || rowIdx < minRow || rowIdx > maxRow) {
        return;
      }
      const cells = tr.querySelectorAll("td.editable-cell");
      cells.forEach((td) => {
        const colIdx = parseInt(td.dataset.columnIndex, 10);
        if (colIdx >= minCol && colIdx <= maxCol) {
          td.classList.add("selected");
        }
      });
    });
  }
  function removeHighlights() {
    const selected = dom.tableBody.querySelectorAll("td.selected");
    selected.forEach((td) => td.classList.remove("selected"));
  }

  // media/src/main.js
  var DEBOUNCE_MS = 300;
  var searchTimeout = null;
  function handleExtensionMessage(message) {
    switch (message.type) {
      case "dataPage":
        onDataPageReceived(message.data);
        break;
      case "columnValues":
        onColumnValuesReceived(message.data);
        break;
      case "cellEditConfirm":
        onCellEditConfirm();
        break;
      case "queryResult":
        onQueryResult(message.data);
        break;
      case "loading":
        message.loading ? showLoading() : hideLoading();
        break;
      case "error":
        showError(message.message);
        break;
    }
  }
  function onDataPageReceived(data) {
    resetQueryState();
    state.headers = data.headers;
    state.originalHeaders = data.headers;
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
      dom.loadMoreBtn.textContent = "Load More Rows";
    }
  }
  function toggleColumnColors() {
    state.colorColumnsEnabled = !state.colorColumnsEnabled;
    if (dom.colorBtn) {
      dom.colorBtn.classList.toggle("btn-active", state.colorColumnsEnabled);
    }
    renderHeader();
    renderRows();
  }
  function bindEvents() {
    if (dom.searchInput) {
      dom.searchInput.addEventListener("input", (e) => {
        if (searchTimeout) {
          clearTimeout(searchTimeout);
        }
        searchTimeout = setTimeout(() => {
          sendMessage({ type: "search", term: e.target.value.trim() });
        }, DEBOUNCE_MS);
      });
    }
    if (dom.refreshBtn) {
      dom.refreshBtn.addEventListener("click", () => sendMessage({ type: "refresh" }));
    }
    if (dom.openAsTextBtn) {
      dom.openAsTextBtn.addEventListener("click", () => sendMessage({ type: "openAsText" }));
    }
    if (dom.colorBtn) {
      dom.colorBtn.addEventListener("click", toggleColumnColors);
    }
    if (dom.addRowBtn) {
      dom.addRowBtn.addEventListener("click", () => sendMessage({ type: "addRow" }));
    }
    if (dom.queryRunBtn) {
      dom.queryRunBtn.addEventListener("click", () => {
        const sql = dom.queryInput ? dom.queryInput.value.trim() : "";
        if (sql) {
          sendMessage({ type: "executeQuery", sql, mode: "inline" });
        }
      });
    }
    if (dom.querySideBtn) {
      dom.querySideBtn.addEventListener("click", () => {
        const sql = dom.queryInput ? dom.queryInput.value.trim() : "";
        if (sql) {
          sendMessage({ type: "executeQuery", sql, mode: "side" });
        }
      });
    }
    if (dom.queryClearBtn) {
      dom.queryClearBtn.addEventListener("click", clearQuery);
    }
    if (dom.queryInput) {
      dom.queryInput.addEventListener("keydown", (e) => {
        if (handleAutocompleteKeydown(e)) {
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          closeAutocomplete();
          const sql = dom.queryInput.value.trim();
          if (sql) {
            sendMessage({ type: "executeQuery", sql, mode: "inline" });
          }
        } else if (e.key === "Escape") {
          clearQuery();
        }
      });
      dom.queryInput.addEventListener("input", () => showAutocomplete(dom.queryInput));
      dom.queryInput.addEventListener("blur", () => setTimeout(closeAutocomplete, 150));
      dom.queryInput.addEventListener("focus", () => {
        if (dom.queryInput.value.trim()) {
          showAutocomplete(dom.queryInput);
        }
      });
    }
    if (dom.loadMoreBtn) {
      dom.loadMoreBtn.addEventListener("click", () => {
        dom.loadMoreBtn.disabled = true;
        dom.loadMoreBtn.textContent = "Loading...";
        sendMessage({ type: "loadMore" });
      });
    }
    let headerClickTimer = null;
    if (dom.tableHeader) {
      dom.tableHeader.addEventListener("click", (e) => {
        if (e.target.closest(".filter-btn") || e.target.closest(".resize-handle")) {
          return;
        }
        const th = e.target.closest("th.sortable-header");
        if (!th) {
          return;
        }
        const colIdx = parseInt(th.dataset.columnIndex, 10);
        if (isNaN(colIdx)) {
          return;
        }
        if (headerClickTimer) {
          clearTimeout(headerClickTimer);
        }
        headerClickTimer = setTimeout(() => {
          headerClickTimer = null;
          let newDirection = "asc";
          if (state.sort.columnIndex === colIdx) {
            if (state.sort.direction === "asc") {
              newDirection = "desc";
            } else if (state.sort.direction === "desc") {
              newDirection = "none";
            }
          }
          sendMessage({ type: "sort", columnIndex: colIdx, direction: newDirection });
        }, 250);
      });
      dom.tableHeader.addEventListener("dblclick", (e) => {
        if (headerClickTimer) {
          clearTimeout(headerClickTimer);
          headerClickTimer = null;
        }
        if (e.target.closest(".filter-btn") || e.target.closest(".resize-handle")) {
          return;
        }
        const th = e.target.closest("th.sortable-header");
        if (!th || !dom.queryInput) {
          return;
        }
        const colIdx = parseInt(th.dataset.columnIndex, 10);
        if (isNaN(colIdx)) {
          return;
        }
        const colName = state.headers[colIdx] || "";
        const quoted = /[^a-zA-Z0-9_]/.test(colName) ? `"${colName}"` : colName;
        insertAtCursor(dom.queryInput, quoted);
      });
      dom.tableHeader.addEventListener("mousedown", (e) => {
        if (e.target.classList.contains("resize-handle")) {
          initResize(e);
          return;
        }
        const corner = e.target.closest(".row-number-header");
        if (corner) {
          handleSelectAll();
          return;
        }
        const selCell = e.target.closest(".column-select-cell");
        if (selCell) {
          const colIdx = parseInt(selCell.dataset.columnIndex, 10);
          if (!isNaN(colIdx)) {
            handleHeaderClickForSelection(colIdx, e);
          }
        }
      });
    }
    document.addEventListener("click", (e) => {
      const filterBtn = e.target.closest(".filter-btn");
      if (!filterBtn) {
        return;
      }
      e.stopPropagation();
      const colIdx = parseInt(filterBtn.dataset.columnIndex, 10);
      if (!isNaN(colIdx)) {
        openFilterDropdown(colIdx, filterBtn);
      }
    });
    document.addEventListener("dblclick", (e) => {
      const td = e.target.closest("td.editable-cell");
      if (td) {
        clearSelection();
        startCellEdit(td);
      }
    });
    document.addEventListener("mousedown", (e) => {
      const rowNum = e.target.closest("td.row-number");
      if (rowNum) {
        handleRowNumberClick(e);
        return;
      }
      const td = e.target.closest("td.editable-cell");
      if (td && !isEditing()) {
        handleCellClick(e);
      }
    });
    document.addEventListener("keydown", (e) => {
      handleCopyShortcut(e);
    });
    document.addEventListener("mouseover", (e) => {
      if (isEditing()) {
        return;
      }
      const cell = e.target.closest("td, th");
      if (cell && cell.scrollWidth > cell.clientWidth && !cell.classList.contains("editing")) {
        showTooltip(cell.dataset.fullText || cell.textContent, e.pageX, e.pageY);
      }
    });
    document.addEventListener("mouseout", (e) => {
      if (e.target.closest("td, th")) {
        hideTooltip();
      }
    });
    document.addEventListener("contextmenu", (e) => {
      const cell = e.target.closest("td.editable-cell");
      if (!cell) {
        return;
      }
      e.preventDefault();
      const text = cell.dataset.fullText || cell.textContent;
      const rowid = parseInt(cell.dataset.rowid, 10);
      showContextMenu(e.pageX, e.pageY, [
        { label: "Copy cell", action: () => sendMessage({ type: "copyToClipboard", text }) },
        { label: "Delete row", action: () => sendMessage({ type: "deleteRow", rowid }) }
      ]);
    });
  }
  window.addEventListener("message", (event) => handleExtensionMessage(event.data));
  bindEvents();
  showLoading();
  sendMessage({ type: "ready" });
})();
