/**
 * Utility functions for CSV delimiter detection.
 */

const DELIMITERS = [',', ';', '\t', '|'] as const;

/**
 * Auto-detect the delimiter used in a CSV file by analyzing
 * consistency of delimiter counts across the first few lines.
 */
export function detectDelimiter(
  sample: string,
  configuredDelimiter: string = 'auto'
): string {
  if (configuredDelimiter !== 'auto') {
    return configuredDelimiter === '\\t' ? '\t' : configuredDelimiter;
  }

  const lines = sample.split('\n').slice(0, 5).filter(line => line.trim());

  if (lines.length === 0) {
    return ',';
  }

  let bestDelimiter = ',';
  let bestScore = 0;

  for (const delimiter of DELIMITERS) {
    const counts = lines.map(line => countOutsideQuotes(line, delimiter));
    const first = counts[0];
    const hasDelimiters = first > 0;

    if (!hasDelimiters) {
      continue;
    }

    const allConsistent = counts.every(c => c === first);
    const score = allConsistent ? first * 100 : first * 10;

    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

/**
 * Count delimiter occurrences outside of quoted strings.
 */
function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (i + 1 < line.length && line[i + 1] === '"') {
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      count++;
    }
  }

  return count;
}

/**
 * Get a human-readable name for a delimiter character.
 */
export function getDelimiterName(delimiter: string): string {
  switch (delimiter) {
    case ',': return 'Comma';
    case ';': return 'Semicolon';
    case '\t': return 'Tab';
    case '|': return 'Pipe';
    default: return 'Custom';
  }
}
