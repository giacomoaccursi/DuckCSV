/**
 * Auto-pairing for quote characters and brackets in the query input.
 *
 * - Typing ' inserts '' with cursor in the middle
 * - Typing " inserts "" with cursor in the middle
 * - Typing ( inserts () with cursor in the middle
 * - If text is selected, wraps it: selection + ' → 'selection'
 */

const PAIRS = {
  "'": "'",
  '"': '"',
  '(': ')',
};

/**
 * Bind auto-pairing behavior to an input element.
 * @param {HTMLInputElement} input
 */
export function bindAutoPairs(input) {
  if (!input) { return; }

  input.addEventListener('keydown', (e) => {
    const close = PAIRS[e.key];
    if (!close) { return; }

    const { selectionStart, selectionEnd, value } = input;
    const hasSelection = selectionStart !== selectionEnd;

    if (hasSelection) {
      // Wrap selection: 'selectedText'
      e.preventDefault();
      const selected = value.slice(selectionStart, selectionEnd);
      const wrapped = e.key + selected + close;
      input.value = value.slice(0, selectionStart) + wrapped + value.slice(selectionEnd);
      // Place cursor after the closing char
      const newPos = selectionStart + wrapped.length;
      input.setSelectionRange(newPos, newPos);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Auto-pair: insert both chars, cursor in middle
      e.preventDefault();
      const before = value.slice(0, selectionStart);
      const after = value.slice(selectionStart);
      input.value = before + e.key + close + after;
      const newPos = selectionStart + 1;
      input.setSelectionRange(newPos, newPos);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}
