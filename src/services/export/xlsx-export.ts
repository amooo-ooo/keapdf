/**
 * Microsoft Excel (.xlsx) Workbook Exporter.
 *
 * Synthesises a standards-compliant OpenXML SpreadsheetML package (.xlsx)
 * with shared string table deduplication, native numeric cell typing,
 * auto-calculated column widths, and per-page worksheet tabs.
 */

import type { ExportDefinition, ExportContext } from '../../core/export-registry';
import { createZipArchive } from '../conversion/zip-utils';
import { downloadBytes } from '../../utils/download-utils';
import {
  extractStructuredDocumentFromContext,
  type ExtractedDocumentStructure,
  type ExtractedPageStructure,
} from './pdf-structure-extractor';

export interface ExportSheetGrid {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
}

/**
 * Escapes XML special characters for safe embedding in text and attribute nodes.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converts a 0-based column index into an A1-style column letter prefix (A, B, ..., Z, AA, AB).
 */
export function colIndexToLetter(colIdx: number): string {
  let n = colIdx + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters || 'A';
}

/**
 * Sanitises a worksheet tab name to adhere to Excel's 31-character and forbidden character rules.
 */
function sanitiseSheetName(raw: string, fallbackIndex: number, usedNames: Set<string>): string {
  const cleaned = raw
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28);
  const base = cleaned.length > 0 ? cleaned : `Page ${fallbackIndex + 1}`;
  let candidate = base;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base.slice(0, 25)} (${counter++})`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Extracts tabular row grids for a single page.
 * Prioritises reconstructed spatial tables while preserving surrounding headings and key-value rows.
 */
function extractPageRows(page: ExtractedPageStructure): string[][] {
  const rows: string[][] = [];

  for (const block of page.blocks) {
    if (block.kind === 'table') {
      for (const tRow of block.rows) {
        rows.push(tRow.cells.map((c) => c.text.trim()));
      }
    } else if (block.kind === 'heading' || block.kind === 'paragraph') {
      // Split colon-delimited key: value pairs or tab-separated segments into columns when no tables exist
      const text = block.text.trim();
      if (!text) continue;
      if (text.includes('\t')) {
        rows.push(text.split('\t').map((s) => s.trim()));
      } else if (page.tables.length === 0 && /^[^:]{2,40}:\s+\S+/.test(text)) {
        const colonIdx = text.indexOf(':');
        rows.push([
          text.slice(0, colonIdx).trim(),
          text.slice(colonIdx + 1).trim(),
        ]);
      } else {
        rows.push([text]);
      }
    } else if (block.kind === 'list') {
      for (let i = 0; i < block.items.length; i++) {
        const marker = block.ordered ? `${i + 1}.` : '\u2022';
        rows.push([marker, block.items[i].text.trim()]);
      }
    } else if (block.kind === 'code') {
      for (const line of block.code.split('\n')) {
        if (line.trim().length > 0) {
          rows.push([line]);
        }
      }
    }
  }

  return rows;
}

/**
 * Extracts structured spreadsheet sheets across all pages of an ExtractedDocumentStructure.
 */
export function extractSpreadsheetSheetsFromStructure(
  structure: ExtractedDocumentStructure
): ExportSheetGrid[] {
  const sheets: ExportSheetGrid[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < structure.pages.length; i++) {
    const page = structure.pages[i];
    const rows = extractPageRows(page);
    const firstHeading = page.blocks.find((b) => b.kind === 'heading');
    const rawName =
      structure.pages.length === 1 && firstHeading && 'text' in firstHeading
        ? firstHeading.text
        : `Page ${i + 1}`;
    const sheetName = sanitiseSheetName(rawName, i, usedNames);
    sheets.push({
      name: sheetName,
      rows: rows.length > 0 ? rows : [['']],
    });
  }

  if (sheets.length === 0) {
    sheets.push({ name: 'Page 1', rows: [['']] });
  }

  return sheets;
}

/**
 * Builds a complete OpenXML .xlsx binary archive from an ExtractedDocumentStructure.
 */
export async function buildXlsxBytesFromStructure(
  structure: ExtractedDocumentStructure
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  const sheets = extractSpreadsheetSheetsFromStructure(structure);

  const sharedStrings: string[] = [];
  const sharedStringIndex = new Map<string, number>();

  function getSharedStringIdx(val: string): number {
    const existing = sharedStringIndex.get(val);
    if (existing !== undefined) return existing;
    const idx = sharedStrings.length;
    sharedStrings.push(val);
    sharedStringIndex.set(val, idx);
    return idx;
  }

  const workbookSheetEntries: string[] = [];
  const workbookRelEntries: string[] = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdStrings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>',
  ];
  const contentTypeSheetOverrides: string[] = [];

  for (let sIdx = 0; sIdx < sheets.length; sIdx++) {
    const sheet = sheets[sIdx];
    const sheetNum = sIdx + 1;
    const relId = `rIdSheet${sheetNum}`;

    const maxCols = Math.max(
      1,
      sheet.rows.reduce((max, r) => Math.max(max, r.length), 0)
    );
    const colMaxChars = new Array<number>(maxCols).fill(8);

    const rowXmlParts: string[] = [];
    for (let rIdx = 0; rIdx < sheet.rows.length; rIdx++) {
      const row = sheet.rows[rIdx];
      const rowNum = rIdx + 1;
      const cellXmlParts: string[] = [];

      for (let cIdx = 0; cIdx < row.length; cIdx++) {
        const rawVal = row[cIdx] ?? '';
        if (rawVal.length === 0) continue;

        if (rawVal.length > colMaxChars[cIdx]) {
          colMaxChars[cIdx] = Math.min(60, rawVal.length);
        }

        const cellRef = `${colIndexToLetter(cIdx)}${rowNum}`;
        const styleAttr = rIdx === 0 ? ' s="1"' : '';

        // Check for pure finite numeric value (without leading zero padding like phone numbers)
        const cleanNumeric = rawVal.replace(/^\$/, '').replace(/,/g, '');
        const isNumeric =
          rIdx > 0 &&
          /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(cleanNumeric) &&
          Number.isFinite(Number(cleanNumeric));

        if (isNumeric) {
          cellXmlParts.push(`<c r="${cellRef}"${styleAttr}><v>${cleanNumeric}</v></c>`);
        } else if (rIdx > 0 && (rawVal === 'TRUE' || rawVal === 'FALSE')) {
          cellXmlParts.push(
            `<c r="${cellRef}" t="b"${styleAttr}><v>${rawVal === 'TRUE' ? '1' : '0'}</v></c>`
          );
        } else {
          const strIdx = getSharedStringIdx(rawVal);
          cellXmlParts.push(`<c r="${cellRef}" t="s"${styleAttr}><v>${strIdx}</v></c>`);
        }
      }

      rowXmlParts.push(`<row r="${rowNum}">${cellXmlParts.join('')}</row>`);
    }

    const colsXml = colMaxChars
      .map(
        (chars, idx) =>
          `<col min="${idx + 1}" max="${idx + 1}" width="${Math.max(10, chars + 4)}" customWidth="1"/>`
      )
      .join('');

    const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${colsXml}</cols>
  <sheetData>${rowXmlParts.join('')}</sheetData>
</worksheet>`;

    files[`xl/worksheets/sheet${sheetNum}.xml`] = encoder.encode(worksheetXml);
    workbookSheetEntries.push(
      `<sheet name="${escapeXml(sheet.name)}" sheetId="${sheetNum}" r:id="${relId}"/>`
    );
    workbookRelEntries.push(
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNum}.xml"/>`
    );
    contentTypeSheetOverrides.push(
      `<Override PartName="/xl/worksheets/sheet${sheetNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    );
  }

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
  ${sharedStrings
    .map((s) => {
      const preserve = s.startsWith(' ') || s.endsWith(' ') ? ' xml:space="preserve"' : '';
      return `<si><t${preserve}>${escapeXml(s)}</t></si>`;
    })
    .join('')}
</sst>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF6F8FA"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${workbookSheetEntries.join('\n    ')}
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookRelEntries.join('\n  ')}
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  ${contentTypeSheetOverrides.join('\n  ')}
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${escapeXml(structure.title)}</dc:title>
  <dc:creator>Kea PDF</dc:creator>
</cp:coreProperties>`;

  files['[Content_Types].xml'] = encoder.encode(contentTypesXml);
  files['_rels/.rels'] = encoder.encode(rootRelsXml);
  files['docProps/core.xml'] = encoder.encode(coreXml);
  files['xl/workbook.xml'] = encoder.encode(workbookXml);
  files['xl/_rels/workbook.xml.rels'] = encoder.encode(workbookRelsXml);
  files['xl/styles.xml'] = encoder.encode(stylesXml);
  files['xl/sharedStrings.xml'] = encoder.encode(sharedStringsXml);

  return createZipArchive(files);
}

export const xlsxExport: ExportDefinition = {
  id: 'xlsx',
  label: 'Excel Workbook',
  description: 'Extract tables and structured data into a Microsoft Excel workbook',
  extension: '.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  category: 'data',
  async export(ctx: ExportContext): Promise<void> {
    if (!ctx.editorStore.isDocumentLoaded) return;
    const structure = extractStructuredDocumentFromContext(ctx);
    const bytes = await buildXlsxBytesFromStructure(structure);
    const baseName = ctx.editorStore.fileName.replace(/\.pdf$/i, '') || 'workbook';
    downloadBytes(
      bytes,
      `${baseName}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  },
};
