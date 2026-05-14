/**
 * SQL query bar: execution, results display, and autocomplete.
 */

import { dom } from './dom.js';
import { state, SQL_KEYWORDS } from './state.js';
import { sendMessage } from './messaging.js';
import { toggle } from './utils.js';
import { renderHeader, renderQueryRows } from './renderer.js';
import { showTable, toggleLoadMore } from './ui.js';

// ─── Query State ─────────────────────────────────────────────────────────────

let queryActive = false;

export function isQueryActive() { return queryActive; }

export function onQueryResult(data) {
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

export function clearQuery() {
  queryActive = false;
  toggle(dom.queryClearBtn, false);
  hideQueryError();
  if (dom.queryInput) { dom.queryInput.value = ''; }
  sendMessage({ type: 'clearQuery' });
}

export function resetQueryState() {
  queryActive = false;
  toggle(dom.queryClearBtn, false);
}

function showQueryError(msg) {
  if (dom.queryError) {
    dom.queryError.textContent = msg;
    dom.queryError.classList.remove('hidden');
  }
}

function hideQueryError() {
  if (dom.queryError) { dom.queryError.classList.add('hidden'); }
}

// ─── Autocomplete ────────────────────────────────────────────────────────────

let acDropdown = null;
let acItems = [];
let acSelectedIndex = -1;

export function showAutocomplete(inputEl) {
  const { word, items } = getCompletions(inputEl);

  if (items.length === 0) { closeAutocomplete(); return; }

  acItems = items;
  acSelectedIndex = 0;

  if (!acDropdown) {
    acDropdown = document.createElement('div');
    acDropdown.className = 'ac-dropdown';
    document.body.appendChild(acDropdown);
  }

  const rect = inputEl.getBoundingClientRect();
  acDropdown.style.left = rect.left + 'px';
  acDropdown.style.top = rect.bottom + 2 + 'px';
  acDropdown.style.minWidth = Math.min(rect.width, 250) + 'px';

  renderItems();
}

export function closeAutocomplete() {
  if (acDropdown) { acDropdown.remove(); acDropdown = null; }
  acItems = [];
  acSelectedIndex = -1;
}

export function handleAutocompleteKeydown(e) {
  if (!acDropdown || acItems.length === 0) { return false; }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acSelectedIndex = (acSelectedIndex + 1) % acItems.length;
    renderItems();
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    acSelectedIndex = (acSelectedIndex - 1 + acItems.length) % acItems.length;
    renderItems();
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
  if (e.key === 'Escape') { closeAutocomplete(); return true; }

  return false;
}

function getCompletions(inputEl) {
  const value = inputEl.value;
  const cursorPos = inputEl.selectionStart;
  const textBeforeCursor = value.slice(0, cursorPos);

  const wordMatch = textBeforeCursor.match(/[\w.]+$/);
  if (!wordMatch) { return { word: '', items: [] }; }

  const word = wordMatch[0];
  if (word.length < 1) { return { word: '', items: [] }; }

  const lower = word.toLowerCase();

  const columnNames = state.headers
    .filter(h => h)
    .map(h => /[^a-zA-Z0-9_]/.test(h) ? `"${h}"` : h);

  const allItems = SQL_KEYWORDS.concat(columnNames);
  const matches = allItems.filter(item =>
    item.toLowerCase().startsWith(lower) && item.toLowerCase() !== lower
  );

  return { word, items: [...new Set(matches)].slice(0, 10) };
}

function renderItems() {
  if (!acDropdown) { return; }
  acDropdown.innerHTML = '';

  acItems.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'ac-item' + (i === acSelectedIndex ? ' ac-item-active' : '');
    div.textContent = item;

    const unquoted = item.replace(/^"|"$/g, '');
    if (state.headers.includes(item) || state.headers.includes(unquoted)) {
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
  const before = value.slice(0, cursorPos - currentWord.length);
  const after = value.slice(cursorPos);
  const needsSpace = item.includes(' ') ? '' : ' ';

  inputEl.value = before + item + needsSpace + after;
  const newPos = before.length + item.length + needsSpace.length;
  inputEl.setSelectionRange(newPos, newPos);
  inputEl.focus();

  closeAutocomplete();
}
