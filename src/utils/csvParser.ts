/**
 * CSV parsing utilities using PapaParse.
 */

import * as Papa from 'papaparse';
import { ParseResult, ParseOptions, ParseError, ValidationResult } from '../types';

/**
 * Parse CSV content into a structured format.
 */
export function parseCSV(content: string, options: ParseOptions = {}): ParseResult {
  const {
    delimiter,
    maxRows = 10000,
    skipEmptyLines = true,
  } = options;

  const result = Papa.parse<string[]>(content, {
    delimiter,
    skipEmptyLines: skipEmptyLines ? 'greedy' : false,
    preview: maxRows > 0 ? maxRows + 1 : 0, // +1 for header row
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

  return { data, headers, totalRows: data.length, errors };
}

/**
 * Estimate total row count without fully parsing the file.
 * Uses newline density in a sample to extrapolate.
 */
export function estimateRowCount(content: string): number {
  const sampleSize = Math.min(content.length, 10000);
  const sample = content.substring(0, sampleSize);
  const newlines = (sample.match(/\n/g) || []).length;

  if (newlines === 0) {
    return 1;
  }

  return Math.max(1, Math.floor((content.length / sampleSize) * newlines));
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
