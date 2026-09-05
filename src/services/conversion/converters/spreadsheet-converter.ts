/**
 * Spreadsheet (Excel .xlsx, CSV, TSV) to PDF Converter.
 * Parses tabular grids into an IDR GridDocument and renders through pdf-layout-engine.
 */

import { PDFDocument } from 'pdf-lib';
import type {
  ConversionInputItem,
  ConvertedDocumentResult,
  DocumentConversionOptions,
  GridDocument,
  SheetData,
  FormatConverter,
} from '../types';
import { unzipArchive, getZipText } from '../zip-utils';
import {
  parseXml,
  findDescendants,
  findChildren,
  findFirstChild,
  findFirstDescendant,
  getAttribute,
} from '../xml-parser';
import { layoutGridDocument } from '../pdf-layout-engine';

/**
 * Robust RFC 4180 compliant delimited text parser.
 * Handles quoted fields, embedded delimiters, escaped quotes (""), and multiline values.
 */
export function parseDelimitedText(text: string, customDelimiter?: string): string[][] {
  const clean = text.replace(/^\uFEFF/, ''); // Strip UTF-8 BOM if present
  if (clean.trim().length === 0) return [];

  let delimiter = customDelimiter;
  if (!delimiter) {
    // Auto-detect delimiter from first non-empty line
    const firstLine = clean.split(/\r?\n/)[0] ?? '';
    const counts: Record<string, number> = {
      '\t': (firstLine.match(/\t/g) ?? []).length,
      ',': (firstLine.match(/,/g) ?? []).length,
      ';': (firstLine.match(/;/g) ?? []).length,
      '|': (firstLine.match(/\|/g) ?? []).length,
    };
    delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',';
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < clean.length) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i += 2;
          continue;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (char === delimiter) {
      currentRow.push(currentField.trim());
      currentField = '';
      i++;
      continue;
    }

    if (char === '\r') {
      if (nextChar === '\n') i++;
      currentRow.push(currentField.trim());
      currentField = '';
      rows.push(currentRow);
      currentRow = [];
      i++;
      continue;
    }

    if (char === '\n') {
      currentRow.push(currentField.trim());
      currentField = '';
      rows.push(currentRow);
      currentRow = [];
      i++;
      continue;
    }

    currentField += char;
    i++;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }

  // Filter out trailing empty rows
  return rows.filter((r) => r.some((c) => c.length > 0));
}

/**
 * Extracts shared strings table from xl/sharedStrings.xml.
 */
function parseSharedStrings(xml?: string): string[] {
  if (!xml) return [];
  const root = parseXml(xml);
  const siNodes = findDescendants(root, 'si');
  const strings: string[] = [];

  for (const si of siNodes) {
    const tNodes = findDescendants(si, 't');
    const fullText = tNodes.map((t) => t.text).join('');
    strings.push(fullText);
  }

  return strings;
}

/**
 * Extracts column letter from cell reference like "A1", "BC23".
 */
function cellRefToColIndex(ref?: string): number {
  if (!ref) return 0;
  const letters = ref.replace(/[0-9]/g, '').toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, col - 1);
}

/**
 * Parses a single worksheet XML (xl/worksheets/sheetN.xml) into a 2D string array.
 */
function parseWorksheetXml(xml: string, sharedStrings: string[]): string[][] {
  const root = parseXml(xml);
  const sheetData = findFirstDescendant(root, 'sheetData');
  if (!sheetData) return [];

  const rows: string[][] = [];
  const rowNodes = findChildren(sheetData, 'row');

  for (const rowNode of rowNodes) {
    const cNodes = findChildren(rowNode, 'c');
    const rowValues: string[] = [];

    for (const c of cNodes) {
      const colIdx = cellRefToColIndex(getAttribute(c, 'r'));
      const type = getAttribute(c, 't');

      let cellValue = '';

      if (type === 's') {
        // Shared string index
        const vNode = findFirstChild(c, 'v');
        if (vNode) {
          const idx = parseInt(vNode.text, 10);
          cellValue = sharedStrings[idx] ?? '';
        }
      } else if (type === 'inlineStr') {
        // Inline string
        const tNode = findFirstDescendant(c, 't');
        if (tNode) cellValue = tNode.text;
      } else if (type === 'b') {
        // Boolean
        const vNode = findFirstChild(c, 'v');
        cellValue = vNode?.text === '1' ? 'TRUE' : 'FALSE';
      } else {
        // Number or standard value
        const vNode = findFirstChild(c, 'v');
        cellValue = vNode?.text ?? '';
      }

      // Pad missing preceding columns with empty strings
      while (rowValues.length < colIdx) {
        rowValues.push('');
      }

      rowValues.push(cellValue.trim());
    }

    if (rowValues.length > 0) {
      rows.push(rowValues);
    }
  }

  // Normalize column count across rows
  const maxCols = Math.max(...rows.map((r) => r.length), 0);
  for (const r of rows) {
    while (r.length < maxCols) {
      r.push('');
    }
  }

  return rows;
}

/**
 * Parses an XLSX package into an IDR GridDocument.
 */
export async function parseXlsxPackage(
  buffer: ArrayBuffer | Uint8Array,
  baseTitle?: string
): Promise<GridDocument> {
  const entries = await unzipArchive(buffer);
  const sharedStringsXml = getZipText(entries, 'xl/sharedStrings.xml');
  const sharedStrings = parseSharedStrings(sharedStringsXml);

  const workbookXml = getZipText(entries, 'xl/workbook.xml');
  const sheets: SheetData[] = [];

  if (workbookXml) {
    const wbRoot = parseXml(workbookXml);
    const sheetNodes = findDescendants(wbRoot, 'sheet');

    for (let i = 0; i < sheetNodes.length; i++) {
      const sheetName = getAttribute(sheetNodes[i], 'name') ?? `Sheet ${i + 1}`;
      // In standard OpenXML, sheet XMLs are stored as sheet1.xml, sheet2.xml, etc.
      const sheetXml = getZipText(entries, `xl/worksheets/sheet${i + 1}.xml`)
        ?? getZipText(entries, `xl/worksheets/sheet${i + 1}.XML`);

      if (sheetXml) {
        const rows = parseWorksheetXml(sheetXml, sharedStrings);
        if (rows.length > 0) {
          sheets.push({ name: sheetName, rows });
        }
      }
    }
  }

  // Fallback: If no sheets were found via workbook, scan for any sheet*.xml in entries
  if (sheets.length === 0) {
    let sheetNum = 1;
    while (true) {
      const sheetXml = getZipText(entries, `xl/worksheets/sheet${sheetNum}.xml`);
      if (!sheetXml) break;
      const rows = parseWorksheetXml(sheetXml, sharedStrings);
      sheets.push({ name: `Sheet ${sheetNum}`, rows });
      sheetNum++;
    }
  }

  return {
    title: baseTitle,
    sheets,
  };
}

export class SpreadsheetConverter implements FormatConverter {
  readonly id = 'spreadsheet';
  readonly displayName = 'Spreadsheet (.xlsx, .csv, .tsv)';
  readonly formats = ['xlsx', 'xls', 'csv', 'tsv'] as const;
  readonly extensions = ['.xlsx', '.xls', '.csv', '.tsv'] as const;
  readonly mimeTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'text/tab-separated-values',
  ] as const;

  canConvert(fileName: string, _buffer: ArrayBuffer | Uint8Array, mimeType?: string): boolean {
    const lower = fileName.toLowerCase();
    for (const ext of this.extensions) {
      if (lower.endsWith(ext)) return true;
    }
    if (mimeType && this.mimeTypes.includes(mimeType as typeof this.mimeTypes[number])) {
      return true;
    }
    return false;
  }

  async convert(
    input: ConversionInputItem,
    options?: DocumentConversionOptions
  ): Promise<ConvertedDocumentResult> {
    const startTime = Date.now();
    const lowerName = input.name.toLowerCase();
    const isCsvOrTsv = lowerName.endsWith('.csv') || lowerName.endsWith('.tsv') || input.mimeType?.includes('csv');

    let gridDoc: GridDocument;
    const baseName = input.name.replace(/\.[^/.]+$/, '');

    if (isCsvOrTsv) {
      const text = typeof input.buffer === 'string'
        ? input.buffer
        : new TextDecoder('utf-8').decode(input.buffer);
      const delimiter = lowerName.endsWith('.tsv') ? '\t' : undefined;
      const rows = parseDelimitedText(text, delimiter);

      gridDoc = {
        title: baseName,
        sheets: [
          {
            name: baseName,
            rows,
          },
        ],
      };
    } else {
      // XLSX package
      gridDoc = await parseXlsxPackage(input.buffer, baseName);
    }

    const doc = await PDFDocument.create();
    const { pageCount } = await layoutGridDocument(doc, gridDoc, options);

    const pdfBytes = await doc.save();
    const buffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer;

    const rowCount = gridDoc.sheets.reduce((acc, s) => acc + s.rows.length, 0);
    const columnCount = Math.max(...gridDoc.sheets.flatMap((s) => s.rows.map((r) => r.length)), 0);

    return {
      buffer,
      pageCount,
      fileName: `${baseName}.pdf`,
      format: isCsvOrTsv ? 'csv' : 'xlsx',
      metadata: {
        title: baseName,
        sheetNames: gridDoc.sheets.map((s) => s.name),
        rowCount,
        columnCount,
        conversionDurationMs: Date.now() - startTime,
      },
    };
  }
}
