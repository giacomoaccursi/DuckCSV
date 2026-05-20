import { describe, it, expect } from 'vitest';
import { escapeRegex, formatFileSize } from '../../media/src/core/utils.js';

describe('escapeRegex', () => {
  it('escapes dots', () => {
    expect(escapeRegex('file.txt')).toBe('file\\.txt');
  });

  it('escapes asterisks', () => {
    expect(escapeRegex('a*b')).toBe('a\\*b');
  });

  it('escapes question marks', () => {
    expect(escapeRegex('a?b')).toBe('a\\?b');
  });

  it('escapes parentheses', () => {
    expect(escapeRegex('(a)')).toBe('\\(a\\)');
  });

  it('escapes brackets', () => {
    expect(escapeRegex('[a]')).toBe('\\[a\\]');
  });

  it('escapes curly braces', () => {
    expect(escapeRegex('{a}')).toBe('\\{a\\}');
  });

  it('escapes pipe', () => {
    expect(escapeRegex('a|b')).toBe('a\\|b');
  });

  it('escapes caret and dollar', () => {
    expect(escapeRegex('^start$')).toBe('\\^start\\$');
  });

  it('escapes backslash', () => {
    expect(escapeRegex('a\\b')).toBe('a\\\\b');
  });

  it('escapes plus', () => {
    expect(escapeRegex('a+b')).toBe('a\\+b');
  });

  it('leaves normal text unchanged', () => {
    expect(escapeRegex('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(escapeRegex('')).toBe('');
  });

  it('escapes multiple special chars together', () => {
    expect(escapeRegex('file (1).txt')).toBe('file \\(1\\)\\.txt');
  });
});

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1.0 MB');
    expect(formatFileSize(2621440)).toBe('2.5 MB');
  });

  it('handles zero', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('handles boundary at 1024', () => {
    expect(formatFileSize(1023)).toBe('1023 B');
    expect(formatFileSize(1024)).toBe('1.0 KB');
  });

  it('handles boundary at 1MB', () => {
    expect(formatFileSize(1048575)).toBe('1024.0 KB');
    expect(formatFileSize(1048576)).toBe('1.0 MB');
  });
});
