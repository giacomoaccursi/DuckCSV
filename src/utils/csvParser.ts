/**
 * CSV parsing utilities using PapaParse.
 */

import * as Papa from 'papaparse';
import { ParseResult, ParseOptions, ParseError, ValidationResult } from '../types';

/**
 * Parse CSV content into a structured format.
 * Parses the entire file (no row limit).
 */
export function parseCSV(content: string, options: ParseOptions = {}): ParseResult {
  const { delimiter, skipEmptyLines = true } = options;

  const result = Papa.parse<string[]>(content, {
    delimiter,
    skipEmptyLines: skipEmptyLines ? 'greedy' : false,
    quoteChar: '"',
    escapeChar: '"',
    header: false,
    dynamicTyping: false,
  });

  const allRows = result.data;
  const headers = allRows.length > 0 ? allRows[0] : [];
  const data = allRows.slice(1);

  const errors: ParseError[] = result.errors.map((err: Papa.ParseError) => ({
    type: err.type,
    code: err.code,
    message: err.message,
    row: err.row,
  }));

  return { data, headers, errors };
}

/**
 * Extract the first N lines of content for delimiter detection.
 */
export function getSample(content: string, lines: number = 10): string {
  return content.split('\n').slice(0, lines).join('\n');
}

/**
 * Validate that a parse result has a usable structure.
 */
export function validateCSV(result: ParseResult): ValidationResult {
  if (result.headers.length === 0) {
    return { valid: false, message: 'CSV file appears to be empty or has no headers' };
  }

  if (result.data.length === 0) {
    return { valid: false, message: 'CSV file has headers but no data rows' };
  }

  const expectedColumns = result.headers.length;
  const inconsistentRows = result.data.filter(row => row.length !== expectedColumns);

  if (inconsistentRows.length > result.data.length * 0.1) {
    return {
      valid: false,
      message: `Many rows have inconsistent column counts. Expected ${expectedColumns} columns.`,
    };
  }

  return { valid: true };
}
