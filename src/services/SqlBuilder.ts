/**
 * SqlBuilder — utility class for SQL construction.
 * Extracted from TableManager to separate SQL building from business logic.
 */

import { SortState, ColumnFilters } from '../types';

export class SqlBuilder {
  /** Quote a SQL identifier (double-quote escaping). */
  static quote(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  /** Build a WHERE clause from column filters and a search term. */
  static buildWhere(filters: ColumnFilters, searchTerm: string, headers: string[]): string {
    const clauses: string[] = [];

    for (const [colIdx, values] of Object.entries(filters)) {
      if (values.length === 0) { continue; }
      const colName = SqlBuilder.quote(headers[parseInt(colIdx, 10)]);
      const escaped = values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
      clauses.push(`${colName} IN (${escaped})`);
    }

    if (searchTerm) {
      const escaped = searchTerm.replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
      const searchClauses = headers.map(h => `CAST(${SqlBuilder.quote(h)} AS VARCHAR) ILIKE '%${escaped}%' ESCAPE '\\'`);
      clauses.push(`(${searchClauses.join(' OR ')})`);
    }

    return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  }

  /** Build an ORDER BY clause from sort state. */
  static buildOrderBy(sort: SortState, headers: string[]): string {
    if (sort.direction === 'none' || sort.columnIndex < 0 || sort.columnIndex >= headers.length) {
      return '';
    }
    const dir = sort.direction === 'asc' ? 'ASC' : 'DESC';
    return `ORDER BY ${SqlBuilder.quote(headers[sort.columnIndex])} ${dir} NULLS LAST`;
  }
}
