/**
 * SQL syntax highlighting for the query input.
 * Tokenizes SQL text and wraps keywords, strings, and numbers in colored spans.
 */

const SQL_KEYWORDS_SET = new Set([
  'SELECT', 'FROM', 'WHERE', 'ORDER', 'BY', 'GROUP', 'HAVING',
  'LIMIT', 'OFFSET', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN',
  'LIKE', 'ILIKE', 'IS', 'NULL', 'AS', 'DISTINCT', 'ALL',
  'ASC', 'DESC', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'ON',
  'UNION', 'EXCEPT', 'INTERSECT', 'INSERT', 'INTO', 'VALUES',
  'UPDATE', 'SET', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE',
  'INDEX', 'VIEW', 'IF', 'EXISTS', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END', 'CAST', 'TRUE', 'FALSE', 'WITH', 'RECURSIVE',
  'OVER', 'PARTITION', 'ROWS', 'RANGE', 'UNBOUNDED', 'PRECEDING',
  'FOLLOWING', 'CURRENT', 'ROW', 'TEMP', 'TEMPORARY', 'COPY', 'TO',
  'FORMAT', 'COMPRESSION',
]);

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Highlight SQL text and return HTML with colored spans.
 * @param {string} sql
 * @returns {string} HTML
 */
export function highlightSql(sql) {
  if (!sql) { return ''; }

  let result = '';
  let i = 0;

  while (i < sql.length) {
    // String literals (single quotes)
    if (sql[i] === "'") {
      let end = i + 1;
      while (end < sql.length && sql[end] !== "'") {
        if (sql[end] === '\\') { end++; }
        end++;
      }
      if (end < sql.length) { end++; } // include closing quote
      result += `<span class="sql-string">${escapeHtml(sql.slice(i, end))}</span>`;
      i = end;
      continue;
    }

    // Numbers (integers and decimals)
    if (/\d/.test(sql[i]) && (i === 0 || /[\s,()=<>!+\-*/]/.test(sql[i - 1]))) {
      let end = i;
      while (end < sql.length && /[\d.]/.test(sql[end])) { end++; }
      // Make sure it's not part of an identifier
      if (end >= sql.length || /[\s,()=<>!+\-*/;]/.test(sql[end])) {
        result += `<span class="sql-number">${escapeHtml(sql.slice(i, end))}</span>`;
        i = end;
        continue;
      }
    }

    // Words (potential keywords or identifiers)
    if (/[a-zA-Z_]/.test(sql[i])) {
      let end = i;
      while (end < sql.length && /[a-zA-Z0-9_]/.test(sql[end])) { end++; }
      const word = sql.slice(i, end);
      if (SQL_KEYWORDS_SET.has(word.toUpperCase())) {
        result += `<span class="sql-keyword">${escapeHtml(word)}</span>`;
      } else {
        result += escapeHtml(word);
      }
      i = end;
      continue;
    }

    // Everything else (operators, spaces, punctuation)
    result += escapeHtml(sql[i]);
    i++;
  }

  return result;
}

/**
 * Bind syntax highlighting to a query input + highlight overlay pair.
 * @param {HTMLInputElement} input
 * @param {HTMLElement} highlight
 */
export function bindSqlHighlight(input, highlight) {
  if (!input || !highlight) { return; }

  function update() {
    highlight.innerHTML = highlightSql(input.value) + '\u200b'; // zero-width space prevents collapse
    // Sync scroll position
    highlight.scrollTop = input.scrollTop;
    highlight.scrollLeft = input.scrollLeft;
  }

  input.addEventListener('input', update);
  input.addEventListener('scroll', () => {
    highlight.scrollTop = input.scrollTop;
    highlight.scrollLeft = input.scrollLeft;
  });
  // Initial render
  update();
}
