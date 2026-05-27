/**
 * Query bar button and input binding (run, side, clear, export, autocomplete).
 */

export function bindQueryBar(ctx) {
  const { queryInput, queryRunBtn, querySideBtn, queryClearBtn, queryExportBtn,
    sendMessage, isQueryRunning, setQueryRunning, isQueryActive, clearQuery,
    closeAutocomplete, handleAutocompleteKeydown, showAutocomplete, addToHistory } = ctx;

  if (queryRunBtn) {
    queryRunBtn.addEventListener('click', () => {
      if (isQueryRunning()) {
        sendMessage({ type: 'cancelQuery' });
        setQueryRunning(false);
        return;
      }
      const sql = queryInput ? queryInput.value.trim() : '';
      if (sql) {
        setQueryRunning(true);
        if (addToHistory) { addToHistory(sql); }
        sendMessage({ type: 'executeQuery', sql, mode: 'inline' });
      }
    });
  }

  if (querySideBtn) {
    querySideBtn.addEventListener('click', () => {
      const sql = queryInput ? queryInput.value.trim() : '';
      if (sql) {
        if (addToHistory) { addToHistory(sql); }
        sendMessage({ type: 'executeQuery', sql, mode: 'side' });
      }
    });
  }

  if (queryClearBtn) { queryClearBtn.addEventListener('click', clearQuery); }

  if (queryExportBtn) {
    queryExportBtn.addEventListener('click', () => {
      if (isQueryActive()) {
        sendMessage({ type: 'exportQueryResult', headers: [], rows: [] });
      }
    });
  }

  if (queryInput) {
    queryInput.addEventListener('keydown', (e) => {
      if (handleAutocompleteKeydown(e)) { return; }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        closeAutocomplete();
        const sql = queryInput.value.trim();
        if (sql) {
          if (addToHistory) { addToHistory(sql); }
          sendMessage({ type: 'executeQuery', sql, mode: 'side' });
        }
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        closeAutocomplete();
        const sql = queryInput.value.trim();
        if (sql) {
          if (addToHistory) { addToHistory(sql); }
          setQueryRunning(true);
          sendMessage({ type: 'executeQuery', sql, mode: 'inline' });
        }
      } else if (e.key === 'Escape') {
        clearQuery();
      }
    });
    queryInput.addEventListener('input', () => {
      autoExpandTextarea(queryInput);
      showAutocomplete(queryInput);
    });
    queryInput.addEventListener('blur', () => setTimeout(closeAutocomplete, 150));
    queryInput.addEventListener('focus', () => {
      if (queryInput.value.trim()) { showAutocomplete(queryInput); }
    });
  }
}


function autoExpandTextarea(textarea) {
  textarea.style.height = 'auto';
  const maxHeight = 150; // ~6 lines
  textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
  textarea.style.overflow = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
}
