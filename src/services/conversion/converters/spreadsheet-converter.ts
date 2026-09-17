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
import { sanitizeTextForWinAnsi } from '../winansi-sanitizer';

/**
 * Decodes a spreadsheet buffer detecting UTF-16, UTF-8 BOM, and Windows-1252 encodings.
 */
export function decodeSpreadsheetBuffer(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length >= 2) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Robust RFC 4180 compliant delimited text parser.
 * Handles quoted fields, embedded delimiters, escaped quotes (""), and multiline values.
 */
export function parseDelimitedText(text: string, customDelimiter?: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  if (clean.trim().length === 0) return [];

  let delimiter = customDelimiter;
  if (!delimiter) {
    const firstLine = clean.split(/\r\n|\n|\r/)[0] ?? '';
    const counts: Record<string, number> = {
      ',': (firstLine.match(/,/g) ?? []).length,
      '\t': (firstLine.match(/\t/g) ?? []).length,
      ';': (firstLine.match(/;/g) ?? []).length,
      '|': (firstLine.match(/\|/g) ?? []).length,
    };
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    delimiter = sorted[0][1] > 0 ? sorted[0][0] : ',';
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let wasQuoted = false;
  let i = 0;

  while (i < clean.length) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
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

    if (char === '"' && currentField.length === 0) {
      inQuotes = true;
      wasQuoted = true;
      i++;
      continue;
    }

    if (char === delimiter) {
      const val = wasQuoted ? currentField : currentField.trim();
      currentRow.push(sanitizeTextForWinAnsi(val));
      currentField = '';
      wasQuoted = false;
      i++;
      continue;
    }

    if (char === '\r') {
      if (nextChar === '\n') i++;
      const val = wasQuoted ? currentField : currentField.trim();
      currentRow.push(sanitizeTextForWinAnsi(val));
      currentField = '';
      wasQuoted = false;
      rows.push(currentRow);
      currentRow = [];
      i++;
      continue;
    }

    if (char === '\n') {
      const val = wasQuoted ? currentField : currentField.trim();
      currentRow.push(sanitizeTextForWinAnsi(val));
      currentField = '';
      wasQuoted = false;
      rows.push(currentRow);
      currentRow = [];
      i++;
      continue;
    }

    currentField += char;
    i++;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    const val = wasQuoted ? currentField : currentField.trim();
    currentRow.push(sanitizeTextForWinAnsi(val));
    rows.push(currentRow);
  }

  // Filter trailing blank lines and normalise column count across all rows
  const activeRows = rows.filter((r) => r.some((c) => c.length > 0));
  const maxCols = activeRows.reduce((max, r) => Math.max(max, r.length), 0);
  for (const r of activeRows) {
    while (r.length < maxCols) {
      r.push('');
    }
  }

  return activeRows;
}

/**
 * Extracts shared strings table from xl/sharedStrings.xml, skipping phonetic annotations.
 */
function parseSharedStrings(xml?: string): string[] {
  if (!xml) return [];
  const root = parseXml(xml);
  const siNodes = findDescendants(root, 'si');
  const strings: string[] = [];

  for (const si of siNodes) {
    let fullText = '';
    for (const child of si.children) {
      if (child.localName === 't') {
        fullText += child.text;
      } else if (child.localName === 'r') {
        const t = findFirstChild(child, 't');
        if (t) fullText += t.text;
      }
      // Omit phonetic reading annotations <rPh>
    }
    strings.push(sanitizeTextForWinAnsi(fullText));
  }

  return strings;
}

/**
 * Extracts column index from cell reference like "A1", "$B$23".
 */
function cellRefToColIndex(ref?: string): number {
  if (!ref) return 0;
  const letters = ref.replace(/[^A-Za-z]/g, '').toUpperCase();
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
        // Inline rich text string
        const tNodes = findDescendants(c, 't');
        cellValue = tNodes.map((t) => t.text).join('');
      } else if (type === 'b') {
        // Boolean
        const vNode = findFirstChild(c, 'v');
        cellValue = vNode?.text === '1' ? 'TRUE' : 'FALSE';
      } else {
        // Number, date or standard value
        const vNode = findFirstChild(c, 'v');
        if (vNode && vNode.text !== '') {
          cellValue = vNode.text;
        } else {
          // Fallback to formula expression if cached value is absent
          const fNode = findFirstChild(c, 'f');
          if (fNode && fNode.text) {
            cellValue = `=${fNode.text}`;
          }
        }
      }

      // Pad missing preceding columns with empty strings
      while (rowValues.length < colIdx) {
        rowValues.push('');
      }

      rowValues.push(sanitizeTextForWinAnsi(cellValue.trim()));
    }

    if (rowValues.length > 0) {
      rows.push(rowValues);
    }
  }

  // Normalise column count across rows using reduce to prevent stack limits
  const maxCols = rows.reduce((max, r) => Math.max(max, r.length), 0);
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
      const state = getAttribute(sheetNodes[i], 'state');
      // Skip hidden sheets to preserve data confidentiality
      if (state === 'hidden' || state === 'veryHidden') {
        continue;
      }

      const sheetName = getAttribute(sheetNodes[i], 'name') ?? `Sheet ${i + 1}`;
      const sheetXml =
        getZipText(entries, `xl/worksheets/sheet${i + 1}.xml`) ??
        getZipText(entries, `xl/worksheets/sheet${i + 1}.XML`);

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

    // Check for legacy Excel 97-2003 OLE2 Compound File Binary
    const bytes = input.buffer instanceof Uint8Array ? input.buffer : new Uint8Array(input.buffer);
    const isCfb =
      bytes.length >= 8 &&
      bytes[0] === 0xd0 &&
      bytes[1] === 0xcf &&
      bytes[2] === 0x11 &&
      bytes[3] === 0xe0;

    if (isCfb) {
      throw new Error(
        `Legacy Excel binary format (.xls 97-2003) is not supported in client-side conversion. Please save the workbook as .xlsx or .csv.`
      );
    }

    const isTsv =
      lowerName.endsWith('.tsv') ||
      (input.mimeType !== undefined &&
        (input.mimeType.includes('tab-separated-values') || input.mimeType.includes('tsv')));
    const isCsv = lowerName.endsWith('.csv') || (input.mimeType !== undefined && input.mimeType.includes('csv'));
    const isCsvOrTsv = isCsv || isTsv;

    let gridDoc: GridDocument;
    const baseName = input.name.replace(/\.[^/.]+$/, '');

    if (isCsvOrTsv) {
      const text = typeof input.buffer === 'string'
        ? input.buffer
        : decodeSpreadsheetBuffer(input.buffer);
      const delimiter = isTsv ? '\t' : undefined;
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
    const columnCount = gridDoc.sheets.reduce((max, s) => {
      const sheetMax = s.rows.reduce((m, r) => Math.max(m, r.length), 0);
      return Math.max(max, sheetMax);
    }, 0);

    return {
      buffer,
      pageCount,
      fileName: `${baseName}.pdf`,
      format: isTsv ? 'tsv' : isCsv ? 'csv' : 'xlsx',
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
