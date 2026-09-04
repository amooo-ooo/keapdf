/**
 * Word Document (.docx) to PDF Converter.
 * Parses OpenXML packages into an IDR FlowDocument and renders through pdf-layout-engine.
 */

import { PDFDocument } from 'pdf-lib';
import type {
  ConversionInputItem,
  ConvertedDocumentResult,
  DocumentConversionOptions,
  FlowDocument,
  DocumentBlock,
  TableBlock,
  TableCell,
  TableRow,
  StyledRun,
  TextStyle,
  FormatConverter,
} from '../types';
import { unzipArchive, getZipText } from '../zip-utils';
import {
  parseXml,
  findChildren,
  findFirstChild,
  findFirstDescendant,
  getAttribute,
  type XmlNode,
} from '../xml-parser';
import { layoutFlowDocument } from '../pdf-layout-engine';

/**
 * Extracts text style properties from a w:rPr run properties node.
 */
function parseRunStyle(rPr?: XmlNode): TextStyle {
  if (!rPr) return {};

  const bold = findFirstChild(rPr, 'b') !== undefined;
  const italic = findFirstChild(rPr, 'i') !== undefined;
  const underline = findFirstChild(rPr, 'u') !== undefined;
  const strike = findFirstChild(rPr, 'strike') !== undefined;

  let fontSize: number | undefined;
  const szNode = findFirstChild(rPr, 'sz');
  if (szNode) {
    const val = getAttribute(szNode, 'val');
    if (val) {
      const halfPts = parseInt(val, 10);
      if (!isNaN(halfPts) && halfPts > 0) {
        fontSize = halfPts / 2; // OOXML sz is in half-points
      }
    }
  }

  let fontColor: string | undefined;
  const colorNode = findFirstChild(rPr, 'color');
  if (colorNode) {
    const val = getAttribute(colorNode, 'val');
    if (val && val !== 'auto') {
      fontColor = `#${val}`;
    }
  }

  return { bold, italic, underline, strike, fontSize, fontColor };
}

/**
 * Extracts styled runs from a paragraph (w:p) node.
 */
function extractRunsFromParagraph(pNode: XmlNode): StyledRun[] {
  const runs: StyledRun[] = [];

  for (const child of pNode.children) {
    if (child.localName === 'r') {
      const rPr = findFirstChild(child, 'rPr');
      const style = parseRunStyle(rPr);

      // Check for line break inside run
      const brNodes = findChildren(child, 'br');
      for (const br of brNodes) {
        const brType = getAttribute(br, 'type');
        if (brType !== 'page') {
          runs.push({ text: '\n' });
        }
      }

      // Check for text
      const tNodes = findChildren(child, 't');
      for (const tNode of tNodes) {
        if (tNode.text.length > 0) {
          runs.push({ text: tNode.text, style });
        }
      }
    } else if (child.localName === 'hyperlink') {
      // Hyperlink container wrapping runs
      const subRuns = extractRunsFromParagraph(child);
      runs.push(...subRuns);
    }
  }

  return runs;
}

/**
 * Parses a table (w:tbl) node into an IDR TableBlock.
 */
function parseTableNode(tblNode: XmlNode): TableBlock {
  const rows: TableRow[] = [];
  const trNodes = findChildren(tblNode, 'tr');

  for (let rIdx = 0; rIdx < trNodes.length; rIdx++) {
    const tr = trNodes[rIdx];
    const tcNodes = findChildren(tr, 'tc');
    const cells: TableCell[] = [];

    // Check if table header row
    const trPr = findFirstChild(tr, 'trPr');
    const isHeader = rIdx === 0 || (trPr && findFirstChild(trPr, 'tblHeader') !== undefined);

    for (const tc of tcNodes) {
      const pNodes = findChildren(tc, 'p');
      const cellRuns: StyledRun[] = [];

      for (let pIdx = 0; pIdx < pNodes.length; pIdx++) {
        if (pIdx > 0 && cellRuns.length > 0) {
          cellRuns.push({ text: '\n' });
        }
        const runs = extractRunsFromParagraph(pNodes[pIdx]);
        cellRuns.push(...runs);
      }

      // Background shading
      let bg: string | undefined;
      const tcPr = findFirstChild(tc, 'tcPr');
      if (tcPr) {
        const shd = findFirstChild(tcPr, 'shd');
        if (shd) {
          const fill = getAttribute(shd, 'fill');
          if (fill && fill !== 'auto' && fill !== 'none') {
            bg = `#${fill}`;
          }
        }
      }

      cells.push({
        runs: cellRuns,
        background: bg,
        isHeader,
      });
    }

    rows.push({ cells, isHeader });
  }

  return {
    type: 'table',
    rows,
    hasBorders: true,
    hasZebraStriping: true,
  };
}

/**
 * Parses a DOCX package into an IDR FlowDocument.
 */
export async function parseDocxPackage(
  buffer: ArrayBuffer | Uint8Array
): Promise<FlowDocument> {
  const entries = await unzipArchive(buffer);
  const docXml = getZipText(entries, 'word/document.xml');
  if (!docXml) {
    throw new Error('Invalid DOCX archive: word/document.xml missing.');
  }

  const root = parseXml(docXml);
  const body = findFirstDescendant(root, 'body');
  if (!body) {
    return { blocks: [] };
  }

  const blocks: DocumentBlock[] = [];
  let documentTitle: string | undefined;

  for (const child of body.children) {
    if (child.localName === 'p') {
      // Check for explicit page break in paragraph
      const br = findFirstDescendant(child, 'br');
      if (br && getAttribute(br, 'type') === 'page') {
        blocks.push({ type: 'pageBreak' });
        continue;
      }

      const pPr = findFirstChild(child, 'pPr');
      let pStyle = '';
      let isBullet = false;
      let align: 'left' | 'center' | 'right' | undefined;

      if (pPr) {
        const styleNode = findFirstChild(pPr, 'pStyle');
        if (styleNode) {
          pStyle = (getAttribute(styleNode, 'val') ?? '').toLowerCase();
        }

        const jcNode = findFirstChild(pPr, 'jc');
        if (jcNode) {
          const jcVal = getAttribute(jcNode, 'val');
          if (jcVal === 'center') align = 'center';
          else if (jcVal === 'right') align = 'right';
        }

        if (findFirstChild(pPr, 'numPr')) {
          isBullet = true;
        }
      }

      const runs = extractRunsFromParagraph(child);
      if (runs.length === 0) continue;

      const plainText = runs.map((r) => r.text).join('').trim();
      if (plainText.length === 0) continue;

      if (pStyle.includes('heading1') || pStyle.includes('title')) {
        if (!documentTitle) documentTitle = plainText;
        blocks.push({
          type: 'heading',
          level: 1,
          text: plainText,
          align,
        });
      } else if (pStyle.includes('heading2')) {
        blocks.push({
          type: 'heading',
          level: 2,
          text: plainText,
          align,
        });
      } else if (pStyle.includes('heading3')) {
        blocks.push({
          type: 'heading',
          level: 3,
          text: plainText,
          align,
        });
      } else if (pStyle.includes('heading4')) {
        blocks.push({
          type: 'heading',
          level: 4,
          text: plainText,
          align,
        });
      } else if (isBullet) {
        blocks.push({
          type: 'list',
          ordered: false,
          items: [runs],
        });
      } else {
        blocks.push({
          type: 'paragraph',
          runs,
          align,
          spaceAfter: 6,
        });
      }
    } else if (child.localName === 'tbl') {
      const tableBlock = parseTableNode(child);
      if (tableBlock.rows.length > 0) {
        blocks.push(tableBlock);
      }
    }
  }

  return {
    title: documentTitle,
    blocks,
  };
}

export class DocxConverter implements FormatConverter {
  readonly id = 'docx';
  readonly displayName = 'Microsoft Word (.docx)';
  readonly formats = ['docx'] as const;
  readonly extensions = ['.docx'] as const;
  readonly mimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ] as const;

  canConvert(fileName: string, _buffer: ArrayBuffer | Uint8Array, mimeType?: string): boolean {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.docx')) return true;
    if (mimeType && this.mimeTypes.includes(mimeType as typeof this.mimeTypes[number])) return true;
    return false;
  }

  async convert(
    input: ConversionInputItem,
    options?: DocumentConversionOptions
  ): Promise<ConvertedDocumentResult> {
    const startTime = Date.now();
    const flowDoc = await parseDocxPackage(input.buffer);

    const doc = await PDFDocument.create();
    const { pageCount } = await layoutFlowDocument(doc, flowDoc, options);

    const pdfBytes = await doc.save();
    const buffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer;

    const baseName = input.name.replace(/\.[^/.]+$/, '');

    let wordCount = 0;
    for (const b of flowDoc.blocks) {
      if (b.type === 'paragraph') {
        wordCount += b.runs.reduce((acc, r) => acc + (r.text.match(/\S+/g)?.length ?? 0), 0);
      } else if (b.type === 'heading') {
        wordCount += (b.text.match(/\S+/g)?.length ?? 0);
      }
    }

    return {
      buffer,
      pageCount,
      fileName: `${baseName}.pdf`,
      format: 'docx',
      metadata: {
        title: flowDoc.title ?? baseName,
        wordCount,
        conversionDurationMs: Date.now() - startTime,
      },
    };
  }
}
