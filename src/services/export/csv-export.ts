/**
 * Comma-Separated Values (.csv) Exporter.
 *
 * Extracts reconstructed tables and structured rows across PDF pages
 * into an RFC 4180 compliant UTF-8 CSV file.
 */

import type { ExportDefinition, ExportContext } from '../../core/export-registry';
import { downloadBytes } from '../../utils/download-utils';
import {
  extractStructuredDocumentFromContext,
  type ExtractedDocumentStructure,
} from './pdf-structure-extractor';
import { extractSpreadsheetSheetsFromStructure } from './xlsx-export';

/**
 * Formats a single CSV cell value adhering to RFC 4180 quoting rules.
 */
export function formatCsvField(value: string): string {
  if (
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serialises an ExtractedDocumentStructure into an RFC 4180 CSV string.
 */
export function buildCsvStringFromStructure(
  structure: ExtractedDocumentStructure
): string {
  const sheets = extractSpreadsheetSheetsFromStructure(structure);
  const csvLines: string[] = [];

  for (let sIdx = 0; sIdx < sheets.length; sIdx++) {
    const sheet = sheets[sIdx];
    if (sIdx > 0 && csvLines.length > 0) {
      csvLines.push('');
    }
    for (const row of sheet.rows) {
      if (row.every((c) => c.trim().length === 0)) continue;
      csvLines.push(row.map(formatCsvField).join(','));
    }
  }

  return csvLines.join('\r\n');
}

export const csvExport: ExportDefinition = {
  id: 'csv',
  label: 'CSV Spreadsheet',
  description: 'Export tables and structured rows as Comma-Separated Values',
  extension: '.csv',
  mimeType: 'text/csv',
  category: 'data',
  async export(ctx: ExportContext): Promise<void> {
    if (!ctx.editorStore.isDocumentLoaded) return;
    const structure = extractStructuredDocumentFromContext(ctx);
    const csvText = buildCsvStringFromStructure(structure);
    const bytes = new TextEncoder().encode(csvText);
    const baseName = ctx.editorStore.fileName.replace(/\.pdf$/i, '') || 'data';
    downloadBytes(bytes, `${baseName}.csv`, 'text/csv;charset=utf-8');
  },
};
