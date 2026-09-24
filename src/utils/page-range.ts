/**
 * Page range parsing utilities for document imposition, splitting, and extraction.
 */

/**
 * Parses a 1-based page range string (e.g. "1-3, 5, 7-9") into an array of 0-based page indices.
 * Supports "all" or undefined/empty to include all pages.
 *
 * @param rangeStr The range string to parse.
 * @param totalPages The total number of pages in the source document.
 * @return An array of zero-based page indices.
 */
export function parsePageRange(rangeStr: string | undefined, totalPages: number): number[] {
  if (!rangeStr || rangeStr.trim() === '' || rangeStr.trim().toLowerCase() === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const indices = new Set<number>();
  const parts = rangeStr.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr.trim(), 10);
      const end = parseInt(endStr.trim(), 10);

      if (!isNaN(start) && !isNaN(end) && start >= 1 && end <= totalPages && start <= end) {
        for (let i = start - 1; i <= end - 1; i++) {
          indices.add(i);
        }
      }
    } else {
      const val = parseInt(trimmed, 10);
      if (!isNaN(val) && val >= 1 && val <= totalPages) {
        indices.add(val - 1);
      }
    }
  }

  const result = Array.from(indices).sort((a, b) => a - b);
  return result.length > 0 ? result : Array.from({ length: totalPages }, (_, i) => i);
}

/**
 * Parses a 1-based page range string strictly, validating that all tokens are within bounds.
 * Throws an Error with a descriptive message if any token is out of range or malformed.
 *
 * @param rangeStr The range string to parse.
 * @param totalPages The total number of pages in the source document.
 * @returns Sorted array of unique zero-based page indices.
 */
export function parsePageRangeStrict(rangeStr: string, totalPages: number): number[] {
  const indices = new Set<number>();
  const parts = rangeStr.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr.trim(), 10);
      const end = parseInt(endStr.trim(), 10);

      if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
        throw new Error(`Invalid range specification: "${trimmed}"`);
      }

      for (let i = start - 1; i <= end - 1; i++) {
        indices.add(i);
      }
    } else {
      const val = parseInt(trimmed, 10);
      if (isNaN(val) || val < 1 || val > totalPages) {
        throw new Error(`Invalid page number: "${trimmed}"`);
      }
      indices.add(val - 1);
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

/**
 * Formats an array of zero-based page indices into a canonical one-based page range string.
 * Groups consecutive runs into hyphenated spans and comma-separates disjoint pages.
 *
 * @param indices Array of zero-based page indices.
 * @returns Canonical one-based page range string.
 */
export function formatPageRange(indices: number[]): string {
  if (!indices || indices.length === 0) {
    return '';
  }

  const sorted = Array.from(new Set(indices))
    .filter(n => typeof n === 'number' && !isNaN(n) && n >= 0)
    .sort((a, b) => a - b);

  if (sorted.length === 0) {
    return '';
  }

  const ranges: string[] = [];
  let rangeStart = sorted[0] + 1;
  let rangeEnd = rangeStart;

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i] + 1;
    if (current === rangeEnd + 1) {
      rangeEnd = current;
    } else {
      ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);
      rangeStart = current;
      rangeEnd = current;
    }
  }
  ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);

  return ranges.join(', ');
}

