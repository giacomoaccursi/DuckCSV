/**
 * Query History — dropdown with scrollable list, delete per item, clear all.
 */

import { sendMessage } from './messaging.js';

let history = [];
let dropdown = null;

export function initHistory(initial) {
  history = initial || [];
}

export function addToHistory(sql) {
  const idx = history.indexOf(sql);
  if (idx !== -1) { history.splice(idx, 1); }
  history.unshift(sql);
  if (history.length > 50) { history.length = 50; }
  sendMessage({ type: 'saveHistory', history });
}

export function getHistory() {
  return history;
}

export function openHistoryDropdown(anchorEl, onSelect) {
  closeHistoryDropdown();
  if (history.length === 0) { return; }

  dropdown = document.createElement('div');
  dropdown.className = 'history-dropdown';

  // Scrollable list
  const list = document.createElement('div');
  list.className = 'history-list';

  history.forEach((sql, i) => {
    const item = document.createElement('div');
    item.className = 'history-item';

    const text = document.createElement('span');
    text.className = 'history-text';
    text.textContent = sql;
    text.title = sql;
    item.appendChild(text);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'history-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      history.splice(i, 1);
      sendMessage({ type: 'saveHistory', history });
      openHistoryDropdown(anchorEl, onSelect); // Re-render
    });
    item.appendChild(removeBtn);

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onSelect(sql);
      closeHistoryDropdown();
    });

    list.appendChild(item);
  });

  dropdown.appendChild(list);

  // Clear all button (fixed at bottom)
  const clearBtn = document.createElement('div');
  clearBtn.className = 'history-clear';
  clearBtn.textContent = 'Clear all';
  clearBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    history = [];
    sendMessage({ type: 'saveHistory', history });
    closeHistoryDropdown();
  });
  dropdown.appendChild(clearBtn);

  // Position below anchor
  const rect = anchorEl.getBoundingClientRect();
  dropdown.style.top = rect.bottom + 'px';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.minWidth = '300px';

  document.body.appendChild(dropdown);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('mousedown', outsideClickHandler);
  }, 0);
}

export function closeHistoryDropdown() {
  if (dropdown) {
    dropdown.remove();
    dropdown = null;
    document.removeEventListener('mousedown', outsideClickHandler);
  }
}

function outsideClickHandler(e) {
  if (dropdown && !dropdown.contains(e.target)) {
    closeHistoryDropdown();
  }
}
