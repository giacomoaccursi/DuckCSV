/**
 * Shared utility functions.
 */

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatFileSize(bytes) {
  if (bytes < 1024) { return bytes + ' B'; }
  if (bytes < 1024 * 1024) { return (bytes / 1024).toFixed(1) + ' KB'; }
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function toggle(el, visible) {
  if (!el) { return; }
  el.classList.toggle('hidden', !visible);
}

export function insertAtCursor(input, text) {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const value = input.value;
  const needsSpace = start > 0 && value[start - 1] !== ' ' ? ' ' : '';
  input.value = value.slice(0, start) + needsSpace + text + ' ' + value.slice(end);
  const newPos = start + needsSpace.length + text.length + 1;
  input.setSelectionRange(newPos, newPos);
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
