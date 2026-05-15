/**
 * UI state management: loading, error, stats, tooltip, context menu.
 */

import { dom } from './dom.js';
import { state } from './state.js';
import { toggle, formatFileSize } from './utils.js';

// ─── Loading / Error / Table visibility ──────────────────────────────────────

export function showLoading(message) {
  toggle(dom.loadingContainer, true);
  toggle(dom.tableContainer, false);
  toggle(dom.errorContainer, false);
  const textEl = dom.loadingContainer?.querySelector('div:last-child');
  if (textEl) { textEl.textContent = message || 'Loading...'; }
}

export function hideLoading() {
  toggle(dom.loadingContainer, false);
}

export function showTable() {
  toggle(dom.tableContainer, true);
  toggle(dom.errorContainer, false);
  toggle(dom.loadingContainer, false);
}

export function showError(message) {
  hideLoading();
  toggle(dom.tableContainer, false);
  toggle(dom.errorContainer, true);
  if (dom.errorText) { dom.errorText.textContent = message; }
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export function updateStats() {
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

// ─── Tooltip ─────────────────────────────────────────────────────────────────

let tooltipEl = null;

export function showTooltip(text, x, y) {
  hideTooltip();
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'tooltip';
  tooltipEl.textContent = text;
  tooltipEl.style.left = (x + 10) + 'px';
  tooltipEl.style.top = (y + 10) + 'px';
  document.body.appendChild(tooltipEl);
}

export function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.remove();
    tooltipEl = null;
  }
}

// ─── Context Menu ────────────────────────────────────────────────────────────

let contextMenuEl = null;

export function showContextMenu(x, y, items) {
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
    document.addEventListener('mousedown', handleOutsideClick);
  }, 0);
}

export function closeContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
  document.removeEventListener('mousedown', handleOutsideClick);
}

function handleOutsideClick(e) {
  if (contextMenuEl && !contextMenuEl.contains(e.target)) {
    closeContextMenu();
  }
}
