/**
 * SQL Autocomplete Engine — context-aware completions for the query bar.
 *
 * Analyzes the SQL text before the cursor to determine context,
 * then returns appropriate suggestions (tables, columns, keywords, functions).
 */

// ─── SQL Knowledge ───────────────────────────────────────────────────────────

const KEYWORDS_TOP = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'WITH', 'COPY'];

const KEYWORDS_CLAUSES = [
  'FROM', 'WHERE', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET',
  'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'CROSS JOIN', 'ON',
  'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'ILIKE',
  'IS NULL', 'IS NOT NULL', 'AS', 'DISTINCT', 'ALL',
  'ASC', 'DESC', 'UNION', 'EXCEPT', 'INTERSECT',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'SET', 'VALUES', 'INTO', 'TABLE', 'IF', 'EXISTS',
];

const FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'CAST', 'TRY_CAST', 'COALESCE', 'NULLIF',
  'LENGTH', 'LOWER', 'UPPER', 'TRIM', 'SUBSTRING', 'REPLACE', 'CONCAT',
  'ROUND', 'ABS', 'FLOOR', 'CEIL',
  'NOW', 'CURRENT_DATE', 'CURRENT_TIMESTAMP',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD',
  'STRFTIME', 'DATE_PART', 'DATE_TRUNC',
];

const ALL_KEYWORDS = [...KEYWORDS_TOP, ...KEYWORDS_CLAUSES, ...FUNCTIONS];

// ─── Context Detection ───────────────────────────────────────────────────────

/**
 * @typedef {'tables'|'columns'|'columns_qualified'|'keywords_top'|'functions'|'all'|'none'} CompletionContext
 */

/**
 * Determine what kind of completions to show based on text before cursor.
 * @param {string} textBefore - SQL text before the current word
 * @returns {CompletionContext}
 */
function detectContext(textBefore) {
  const trimmed = textBefore.trimEnd().toUpperCase();

  // After AS → user is defining an alias, don't suggest
  if (/\bAS\s*$/i.test(trimmed)) { return 'none'; }

  // After FROM, JOIN variants → suggest tables
  if (/\b(FROM|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|CROSS\s+JOIN|LEFT\s+OUTER\s+JOIN|RIGHT\s+OUTER\s+JOIN)\s*$/i.test(trimmed)) {
    return 'tables';
  }

  // After ON → suggest qualified columns (table.col)
  if (/\bON\s*$/i.test(trimmed)) { return 'columns_qualified'; }

  // After WHERE, AND, OR, HAVING → suggest columns
  if (/\b(WHERE|AND|OR|HAVING|SET)\s*$/i.test(trimmed)) { return 'columns'; }

  // After ORDER BY, GROUP BY → suggest columns
  if (/\b(ORDER\s+BY|GROUP\s+BY)\s*$/i.test(trimmed)) { return 'columns'; }

  // After SELECT → suggest columns, *, functions, DISTINCT
  if (/\bSELECT\s*$/i.test(trimmed) || /,\s*$/i.test(trimmed)) { return 'functions'; }

  // After comparison operators → suggest values/columns
  if (/[=<>!]+\s*$/i.test(trimmed)) { return 'columns'; }

  // Empty or start of statement
  if (!trimmed || /;\s*$/i.test(trimmed)) { return 'keywords_top'; }

  return 'all';
}

// ─── Completion Engine ───────────────────────────────────────────────────────

/**
 * @typedef {object} CompletionSchema
 * @property {string[]} tables - available table names
 * @property {Object<string, string[]>} tableColumns - map of tableName → column names
 * @property {string[]} allColumns - all column names (unqualified)
 */

/**
 * Get completions for the current cursor position.
 * @param {string} fullText - entire query text
 * @param {number} cursorPos - cursor position in the text
 * @param {CompletionSchema} schema - available tables and columns
 * @returns {{ word: string, items: string[] }}
 */
export function getCompletions(fullText, cursorPos, schema) {
  const textBeforeCursor = fullText.slice(0, cursorPos);

  // Extract the current word (including dots for qualified names)
  const wordMatch = textBeforeCursor.match(/[\w.]+$/);
  if (!wordMatch) { return { word: '', items: [] }; }

  const word = wordMatch[0];
  if (word.length < 1) { return { word: '', items: [] }; }

  const lower = word.toLowerCase();
  const textBeforeWord = textBeforeCursor.slice(0, textBeforeCursor.length - word.length);

  // Handle dot-qualified names (table.column)
  if (word.includes('.')) {
    return getDotCompletions(word, lower, schema);
  }

  const context = detectContext(textBeforeWord);

  switch (context) {
    case 'none':
      return { word, items: [] };

    case 'tables':
      return { word, items: filterMatch(schema.tables, lower) };

    case 'columns':
      return { word, items: filterMatch(schema.allColumns, lower) };

    case 'columns_qualified':
      // After ON: suggest table.column format
      return { word, items: filterMatch(getQualifiedColumns(schema), lower) };

    case 'functions':
      // After SELECT: columns + functions + * + DISTINCT
      return { word, items: filterMatch([...schema.allColumns, ...FUNCTIONS, '*', 'DISTINCT'], lower) };

    case 'keywords_top':
      return { word, items: filterMatch(KEYWORDS_TOP, lower) };

    case 'all':
    default:
      return { word, items: filterMatch([...ALL_KEYWORDS, ...schema.allColumns, ...schema.tables], lower) };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDotCompletions(word, lower, schema) {
  const parts = word.split('.');
  const prefix = parts[0].toLowerCase();

  // Find matching table
  const matchedTable = schema.tables.find(t => t.toLowerCase() === prefix)
    || schema.tables.find(t => t.toLowerCase().startsWith(prefix));

  if (!matchedTable || !schema.tableColumns[matchedTable]) {
    return { word, items: [] };
  }

  const userPrefix = parts[0]; // preserve user's casing
  const columns = schema.tableColumns[matchedTable].map(col => {
    const qualified = `${userPrefix}.${col}`;
    return /[^a-zA-Z0-9_]/.test(col) ? `${userPrefix}."${col}"` : qualified;
  });

  const matches = columns.filter(item =>
    item.toLowerCase().startsWith(lower) && item.toLowerCase() !== lower
  );

  return { word, items: [...new Set(matches)].slice(0, 15) };
}

function getQualifiedColumns(schema) {
  const result = [];
  for (const [table, columns] of Object.entries(schema.tableColumns)) {
    for (const col of columns) {
      const qualified = `${table}.${col}`;
      result.push(/[^a-zA-Z0-9_]/.test(col) ? `${table}."${col}"` : qualified);
    }
  }
  return result;
}

function filterMatch(items, lower) {
  const matches = items.filter(item =>
    item.toLowerCase().startsWith(lower) && item.toLowerCase() !== lower
  );
  return [...new Set(matches)].slice(0, 15);
}

/**
 * Build a CompletionSchema from the current state.
 * @param {object} state - app state with originalHeaders, tableNames
 * @returns {CompletionSchema}
 */
export function buildSchema(state) {
  const tables = state.tableNames || [];
  const tableColumns = {};
  const allColumns = [];

  // In workspace mode: originalHeaders contains tableName, tableName.col, col
  if (tables.length > 0) {
    for (const table of tables) {
      tableColumns[table] = [];
    }
    for (const h of (state.originalHeaders || [])) {
      if (!h) { continue; }
      if (tables.includes(h)) { continue; } // skip table names themselves
      const dotIdx = h.indexOf('.');
      if (dotIdx > 0) {
        const tablePart = h.slice(0, dotIdx);
        const colPart = h.slice(dotIdx + 1);
        if (tableColumns[tablePart]) {
          tableColumns[tablePart].push(colPart);
        }
      } else {
        allColumns.push(h);
      }
    }
  } else {
    // Single table mode: originalHeaders is just column names (+ maybe tableName)
    for (const h of (state.originalHeaders || [])) {
      if (h) { allColumns.push(h); }
    }
    // If there's a tableName in state, register it
    if (state.tableName) {
      tables.push(state.tableName);
      tableColumns[state.tableName] = [...allColumns];
    }
  }

  // Quote column names with special chars
  const quotedColumns = allColumns.map(c => /[^a-zA-Z0-9_]/.test(c) ? `"${c}"` : c);

  return { tables, tableColumns, allColumns: quotedColumns };
}
