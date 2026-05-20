/**
 * Search input binding with debounced messaging.
 */

const DEBOUNCE_MS = 300;

export function bindSearchInput(searchInput, sendMessage) {
  if (!searchInput) { return; }
  let timeout = null;
  searchInput.addEventListener('input', (e) => {
    if (timeout) { clearTimeout(timeout); }
    timeout = setTimeout(() => {
      sendMessage({ type: 'search', term: e.target.value.trim() });
    }, DEBOUNCE_MS);
  });
}
