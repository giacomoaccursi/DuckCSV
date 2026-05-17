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

let anchorElement = null;

export function openHistoryDropdown(anchorEl, onSelect) {
  if (dropdown) {
    closeHistoryDropdown();
    return;
  }
  if (history.length === 0) { return; }
  anchorElement = anchorEl;
  renderDropdown(anchorEl, onSelect);
}

function renderDropdown(anchorEl, onSelect) {
  if (dropdown) { dropdown.remove(); }

  dropdown = document.createElement('div');
  dropdown.className = 'history-dropdown';

  if (history.length === 0) {
    closeHistoryDropdown();
    return;
  }

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
      renderDropdown(anchorEl, onSelect);
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

  // Position below anchor, aligned to query bar for more space
  const rect = anchorEl.getBoundingClientRect();
  const queryBar = anchorEl.closest('.query-bar');
  const barRect = queryBar ? queryBar.getBoundingClientRect() : rect;
  dropdown.style.top = barRect.bottom + 2 + 'px';
  dropdown.style.left = barRect.left + 'px';
  dropdown.style.minWidth = Math.min(400, barRect.width) + 'px';
  dropdown.style.maxWidth = barRect.width + 'px';

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
  if (dropdown && !dropdown.contains(e.target) && anchorElement && !anchorElement.contains(e.target)) {
    closeHistoryDropdown();
  }
}
