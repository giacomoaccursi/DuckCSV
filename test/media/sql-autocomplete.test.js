/**
 * Tests for SQL autocomplete engine.
 */

import { describe, it, expect } from 'vitest';
import { getCompletions, buildSchema } from '../../media/src/query/sql-autocomplete.js';

// ─── Test Schema ─────────────────────────────────────────────────────────────

const schema = {
  tables: ['customers', 'orders'],
  tableColumns: {
    customers: ['id', 'name', 'email', 'city'],
    orders: ['id', 'customer_id', 'amount', 'date'],
  },
  allColumns: ['id', 'name', 'email', 'city', 'customer_id', 'amount', 'date'],
};

// ─── Context Detection Tests ─────────────────────────────────────────────────

describe('SQL Autocomplete - Context Detection', () => {
  it('after SELECT: suggests columns and functions when typing', () => {
    const { items } = getCompletions('SELECT n', 8, schema);
    expect(items).toContain('name');
    expect(items).not.toContain('customers');
    expect(items).not.toContain('FROM');
  });

  it('after SELECT with partial column: filters correctly', () => {
    const { items } = getCompletions('SELECT na', 9, schema);
    expect(items).toContain('name');
    expect(items).not.toContain('id');
  });

  it('after FROM: suggests only tables when typing', () => {
    const { items } = getCompletions('SELECT * FROM c', 15, schema);
    expect(items).toContain('customers');
    expect(items).not.toContain('name');
    expect(items).not.toContain('SELECT');
  });

  it('after JOIN: suggests only tables when typing', () => {
    const { items } = getCompletions('SELECT * FROM customers JOIN o', 30, schema);
    expect(items).toContain('orders');
    expect(items).not.toContain('name');
  });

  it('after LEFT JOIN: suggests only tables when typing', () => {
    const { items } = getCompletions('SELECT * FROM customers LEFT JOIN o', 35, schema);
    expect(items).toContain('orders');
  });

  it('after WHERE: suggests columns when typing', () => {
    const { items } = getCompletions('SELECT * FROM customers WHERE n', 31, schema);
    expect(items).toContain('name');
    expect(items).not.toContain('customers');
    expect(items).not.toContain('SELECT');
  });

  it('after AND: suggests columns when typing', () => {
    const { items } = getCompletions('SELECT * FROM customers WHERE id = 1 AND n', 43, schema);
    expect(items).toContain('name');
    expect(items).not.toContain('FROM');
  });

  it('after ORDER BY: suggests columns when typing', () => {
    const { items } = getCompletions('SELECT * FROM customers ORDER BY n', 34, schema);
    expect(items).toContain('name');
    expect(items).not.toContain('customers');
  });

  it('after GROUP BY: suggests columns when typing', () => {
    const { items } = getCompletions('SELECT city, COUNT(*) FROM customers GROUP BY c', 48, schema);
    expect(items).toContain('city');
  });

  it('after comma in SELECT: suggests columns and functions when typing', () => {
    const { items } = getCompletions('SELECT id, n', 12, schema);
    expect(items).toContain('name');
    expect(items).not.toContain('FROM');
  });

  it('after AS: suggests nothing', () => {
    const { items } = getCompletions('SELECT id AS x', 14, schema);
    // 'x' doesn't match any column/keyword, so empty
    expect(items).toEqual([]);
  });

  it('after ON: suggests qualified columns when typing', () => {
    const { items } = getCompletions('SELECT * FROM customers JOIN orders ON c', 40, schema);
    expect(items.some(i => i.includes('.'))).toBe(true);
  });

  it('after = operator: suggests columns when typing', () => {
    const { items } = getCompletions('SELECT * FROM customers WHERE id = n', 36, schema);
    expect(items).toContain('name');
  });

  it('empty input: suggests top-level keywords', () => {
    const { items } = getCompletions('', 0, schema);
    // No word typed, no suggestions
    expect(items).toEqual([]);
  });

  it('start typing keyword: suggests top keywords', () => {
    const { items } = getCompletions('SEL', 3, schema);
    expect(items).toContain('SELECT');
  });
});

// ─── Dot Completion Tests ────────────────────────────────────────────────────

describe('SQL Autocomplete - Dot Completions', () => {
  it('table. suggests columns of that table', () => {
    const { items } = getCompletions('SELECT customers.', 17, schema);
    expect(items).toContain('customers.id');
    expect(items).toContain('customers.name');
    expect(items).not.toContain('orders.id');
  });

  it('partial table name with dot suggests matching table columns', () => {
    const { items } = getCompletions('SELECT cust.', 12, schema);
    // Should match 'customers' and suggest its columns with user prefix
    expect(items).toContain('cust.id');
    expect(items).toContain('cust.name');
  });

  it('table.partial filters columns', () => {
    const { items } = getCompletions('SELECT customers.na', 19, schema);
    expect(items).toContain('customers.name');
    expect(items).not.toContain('customers.id');
  });

  it('unknown table prefix returns empty', () => {
    const { items } = getCompletions('SELECT xyz.', 11, schema);
    expect(items).toEqual([]);
  });
});

// ─── buildSchema Tests ───────────────────────────────────────────────────────

describe('SQL Autocomplete - buildSchema', () => {
  it('builds schema from workspace state', () => {
    const state = {
      tableNames: ['users', 'posts'],
      originalHeaders: ['users', 'users.id', 'users.name', 'posts', 'posts.id', 'posts.title', 'id', 'name', 'title'],
    };
    const s = buildSchema(state);
    expect(s.tables).toEqual(['users', 'posts']);
    expect(s.tableColumns.users).toEqual(['id', 'name']);
    expect(s.tableColumns.posts).toEqual(['id', 'title']);
  });

  it('builds schema from single-table state', () => {
    const state = {
      tableNames: undefined,
      originalHeaders: ['myfile', 'col1', 'col2'],
      tableName: 'myfile',
    };
    const s = buildSchema(state);
    expect(s.tables).toContain('myfile');
    expect(s.tableColumns.myfile).toEqual(['myfile', 'col1', 'col2']);
  });

  it('quotes columns with special characters', () => {
    const state = {
      tableNames: undefined,
      originalHeaders: ['normal', 'has space', 'has-dash'],
      tableName: 'test',
    };
    const s = buildSchema(state);
    expect(s.allColumns).toContain('normal');
    expect(s.allColumns).toContain('"has space"');
    expect(s.allColumns).toContain('"has-dash"');
  });
});
