import { describe, it, expect } from 'vitest';
import { quoteCsvField, escapeHtml } from '../../src/shared/csvUtils';

describe('quoteCsvField', () => {
  it('returns plain value unchanged', () => {
    expect(quoteCsvField('hello', ',')).toBe('hello');
  });

  it('quotes value containing delimiter', () => {
    expect(quoteCsvField('a,b', ',')).toBe('"a,b"');
  });

  it('quotes value containing double quotes and escapes them', () => {
    expect(quoteCsvField('say "hi"', ',')).toBe('"say ""hi"""');
  });

  it('quotes value containing newline', () => {
    expect(quoteCsvField('line1\nline2', ',')).toBe('"line1\nline2"');
  });

  it('quotes value containing carriage return', () => {
    expect(quoteCsvField('line1\rline2', ',')).toBe('"line1\rline2"');
  });

  it('handles empty string', () => {
    expect(quoteCsvField('', ',')).toBe('');
  });

  it('works with semicolon delimiter', () => {
    expect(quoteCsvField('a;b', ';')).toBe('"a;b"');
    expect(quoteCsvField('a,b', ';')).toBe('a,b');
  });

  it('works with tab delimiter', () => {
    expect(quoteCsvField('a\tb', '\t')).toBe('"a\tb"');
  });

  it('handles value with both delimiter and quotes', () => {
    expect(quoteCsvField('he said "yes, ok"', ',')).toBe('"he said ""yes, ok"""');
  });
});

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes greater-than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes all special chars together', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('returns plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});
