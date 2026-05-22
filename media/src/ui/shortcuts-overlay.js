/**
 * Keyboard shortcuts overlay — shows available shortcuts on button click.
 */

const SHORTCUTS = [
  { keys: '⌘ S', desc: 'Save' },
  { keys: '⌘ ⇧ S', desc: 'Save As (choose format)' },
  { keys: '⌘ Z', desc: 'Undo' },
  { keys: '⌘ ⇧ Z', desc: 'Redo' },
  { keys: '⌘ C', desc: 'Copy selection' },
  { keys: '⌘ Enter', desc: 'Run query in side panel' },
  { keys: '↑ ↓ ← →', desc: 'Navigate cells' },
  { keys: 'Double-click header', desc: 'Insert column in query' },
];

let overlay = null;

export function bindShortcutsButton() {
  const btn = document.getElementById('shortcutsBtn');
  if (!btn) { return; }

  btn.addEventListener('click', () => {
    if (overlay) { closeOverlay(); return; }
    showOverlay();
  });
}

function showOverlay() {
  overlay = document.createElement('div');
  overlay.className = 'shortcuts-overlay';

  const title = document.createElement('div');
  title.className = 'shortcuts-title';
  title.textContent = 'Keyboard Shortcuts';
  overlay.appendChild(title);

  const list = document.createElement('div');
  list.className = 'shortcuts-list';

  for (const { keys, desc } of SHORTCUTS) {
    const row = document.createElement('div');
    row.className = 'shortcuts-row';

    const keysEl = document.createElement('span');
    keysEl.className = 'shortcuts-keys';
    keysEl.textContent = keys;

    const descEl = document.createElement('span');
    descEl.className = 'shortcuts-desc';
    descEl.textContent = desc;

    row.appendChild(keysEl);
    row.appendChild(descEl);
    list.appendChild(row);
  }

  overlay.appendChild(list);
  document.body.appendChild(overlay);

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('mousedown', handleOutsideClick);
  }, 0);
}

function closeOverlay() {
  if (overlay) { overlay.remove(); overlay = null; }
  document.removeEventListener('mousedown', handleOutsideClick);
}

function handleOutsideClick(e) {
  if (overlay && !overlay.contains(e.target) && !e.target.closest('#shortcutsBtn')) {
    closeOverlay();
  }
}
