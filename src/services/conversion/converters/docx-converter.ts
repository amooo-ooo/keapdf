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
  BlockAlignment,
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
import { sanitizeTextForWinAnsi } from '../winansi-sanitizer';

/**
 * Parses OpenXML CT_OnOff boolean nodes where val="0" or "off" indicates false.
 */
function parseOnOff(node?: XmlNode): boolean {
  if (!node) return false;
  const val = getAttribute(node, 'val');
  if (!val) return true;
  return val !== '0' && val !== 'false' && val !== 'off' && val !== 'none';
}

/**
 * Extracts text style properties from a w:rPr run properties node.
 */
function parseRunStyle(rPr?: XmlNode): TextStyle {
  if (!rPr) return {};

  const bold = parseOnOff(findFirstChild(rPr, 'b'));
  const italic = parseOnOff(findFirstChild(rPr, 'i'));
  const underline = parseOnOff(findFirstChild(rPr, 'u'));
  const strike = parseOnOff(findFirstChild(rPr, 'strike'));

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
 * Extracts styled runs from a paragraph (w:p) node in sequential document order.
 */
function extractRunsFromParagraph(pNode: XmlNode): { runs: StyledRun[]; hasPageBreak: boolean } {
  const runs: StyledRun[] = [];
  let hasPageBreak = false;

  for (const child of pNode.children) {
    if (child.localName === 'r') {
      const rPr = findFirstChild(child, 'rPr');
      const style = parseRunStyle(rPr);

      // Iterate children in sequential document order to prevent inverted line breaks
      for (const rChild of child.children) {
        if (rChild.localName === 't') {
          if (rChild.text.length > 0) {
            runs.push({ text: sanitizeTextForWinAnsi(rChild.text), style });
          }
        } else if (rChild.localName === 'br') {
          const brType = getAttribute(rChild, 'type');
          if (brType === 'page') {
            hasPageBreak = true;
          } else {
            runs.push({ text: '\n' });
          }
        } else if (rChild.localName === 'cr') {
          runs.push({ text: '\n' });
        } else if (rChild.localName === 'tab') {
          runs.push({ text: '    ', style });
        }
      }
    } else if (child.localName === 'hyperlink') {
      const subResult = extractRunsFromParagraph(child);
      if (subResult.hasPageBreak) hasPageBreak = true;
      runs.push(...subResult.runs);
    }
  }

  return { runs, hasPageBreak };
}

/**
 * Parses a table (w:tbl) node into an IDR TableBlock with column spans and widths.
 */
function parseTableNode(tblNode: XmlNode): TableBlock {
  const rows: TableRow[] = [];
  const trNodes = findChildren(tblNode, 'tr');

  // Parse explicit column widths from tblGrid (20 dxa = 1 pt)
  const tblGrid = findFirstChild(tblNode, 'tblGrid');
  let columnWidths: number[] | undefined;
  if (tblGrid) {
    const gridCols = findChildren(tblGrid, 'gridCol');
    const widths = gridCols
      .map((c) => {
        const w = parseInt(getAttribute(c, 'w') ?? '0', 10);
        return isNaN(w) ? 0 : w / 20;
      })
      .filter((w) => w > 0);
    if (widths.length > 0) columnWidths = widths;
  }

  for (let rIdx = 0; rIdx < trNodes.length; rIdx++) {
    const tr = trNodes[rIdx];
    const tcNodes = findChildren(tr, 'tc');
    const cells: TableCell[] = [];

    const trPr = findFirstChild(tr, 'trPr');
    const isHeader = rIdx === 0 || (trPr !== undefined && findFirstChild(trPr, 'tblHeader') !== undefined);

    for (const tc of tcNodes) {
      const pNodes = findChildren(tc, 'p');
      const cellRuns: StyledRun[] = [];
      let cellAlign: BlockAlignment | undefined;

      for (let pIdx = 0; pIdx < pNodes.length; pIdx++) {
        if (pIdx > 0 && cellRuns.length > 0) {
          cellRuns.push({ text: '\n' });
        }
        const pPr = findFirstChild(pNodes[pIdx], 'pPr');
        if (pPr && !cellAlign) {
          const jc = getAttribute(findFirstChild(pPr, 'jc') ?? { tag: '', localName: '', attributes: {}, children: [], text: '' }, 'val');
          if (jc === 'center') cellAlign = 'center';
          else if (jc === 'right') cellAlign = 'right';
        }
        const { runs } = extractRunsFromParagraph(pNodes[pIdx]);
        cellRuns.push(...runs);
      }

      // Shading, colSpan, rowSpan
      let bg: string | undefined;
      let colSpan: number | undefined;
      let rowSpan: number | undefined;

      const tcPr = findFirstChild(tc, 'tcPr');
      if (tcPr) {
        const shd = findFirstChild(tcPr, 'shd');
        if (shd) {
          const fill = getAttribute(shd, 'fill');
          if (fill && fill !== 'auto' && fill !== 'none') {
            bg = `#${fill}`;
          }
        }

        const gridSpanNode = findFirstChild(tcPr, 'gridSpan');
        if (gridSpanNode) {
          const spanVal = parseInt(getAttribute(gridSpanNode, 'val') ?? '1', 10);
          if (!isNaN(spanVal) && spanVal > 1) {
            colSpan = spanVal;
          }
        }

        const vMergeNode = findFirstChild(tcPr, 'vMerge');
        if (vMergeNode) {
          const vVal = getAttribute(vMergeNode, 'val');
          if (vVal === 'restart') {
            rowSpan = 1;
          }
        }
      }

      cells.push({
        runs: cellRuns,
        background: bg,
        isHeader,
        colSpan,
        rowSpan,
        align: cellAlign,
      });
    }

    rows.push({ cells, isHeader });
  }

  return {
    type: 'table',
    rows,
    columnWidths,
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
  let activeListItems: (readonly StyledRun[])[] | null = null;
  let activeListOrdered = false;
  let activeListIndent = 0;

  function flushList(): void {
    if (activeListItems && activeListItems.length > 0) {
      blocks.push({
        type: 'list',
        ordered: activeListOrdered,
        items: activeListItems,
        indentLevel: activeListIndent > 0 ? activeListIndent : undefined,
      });
      activeListItems = null;
    }
  }

  for (const child of body.children) {
    if (child.localName === 'p') {
      const pPr = findFirstChild(child, 'pPr');
      let pStyle = '';
      let isBullet = false;
      let indentLevel = 0;
      let align: BlockAlignment | undefined;

      if (pPr) {
        const styleNode = findFirstChild(pPr, 'pStyle');
        if (styleNode) {
          pStyle = (getAttribute(styleNode, 'val') ?? '').toLowerCase().replace(/[\s_-]+/g, '');
        }

        const jcNode = findFirstChild(pPr, 'jc');
        if (jcNode) {
          const jcVal = getAttribute(jcNode, 'val');
          if (jcVal === 'center') align = 'center';
          else if (jcVal === 'right') align = 'right';
          else if (jcVal === 'both') align = 'justify';
        }

        const numPr = findFirstChild(pPr, 'numPr');
        if (numPr) {
          isBullet = true;
          const ilvlNode = findFirstChild(numPr, 'ilvl');
          if (ilvlNode) {
            const ilvl = parseInt(getAttribute(ilvlNode, 'val') ?? '0', 10);
            if (!isNaN(ilvl)) indentLevel = ilvl;
          }
        }
      }

      const { runs, hasPageBreak } = extractRunsFromParagraph(child);
      const plainText = runs.map((r) => r.text).join('').trim();

      // Preserve empty paragraphs as vertical spacing
      if (runs.length === 0 || plainText.length === 0) {
        flushList();
        if (hasPageBreak) {
          blocks.push({ type: 'pageBreak' });
        } else {
          blocks.push({
            type: 'paragraph',
            runs: [{ text: '' }],
            spaceAfter: 10,
          });
        }
        continue;
      }

      if (hasPageBreak) {
        flushList();
        blocks.push({ type: 'pageBreak' });
      }

      // Check heading hierarchy
      const outlineLvlNode = pPr ? findFirstChild(pPr, 'outlineLvl') : undefined;
      const outlineLvl = outlineLvlNode ? parseInt(getAttribute(outlineLvlNode, 'val') ?? '-1', 10) : -1;

      if (pStyle.includes('heading1') || pStyle.includes('title') || outlineLvl === 0) {
        flushList();
        if (!documentTitle) documentTitle = plainText;
        blocks.push({
          type: 'heading',
          level: 1,
          text: plainText,
          align,
        });
      } else if (pStyle.includes('heading2') || outlineLvl === 1) {
        flushList();
        blocks.push({
          type: 'heading',
          level: 2,
          text: plainText,
          align,
        });
      } else if (pStyle.includes('heading3') || outlineLvl === 2) {
        flushList();
        blocks.push({
          type: 'heading',
          level: 3,
          text: plainText,
          align,
        });
      } else if (pStyle.includes('heading4') || outlineLvl === 3) {
        flushList();
        blocks.push({
          type: 'heading',
          level: 4,
          text: plainText,
          align,
        });
      } else if (isBullet) {
        // Coalesce list items into active list
        if (activeListItems && activeListIndent === indentLevel) {
          activeListItems.push(runs);
        } else {
          flushList();
          activeListItems = [runs];
          activeListOrdered = false;
          activeListIndent = indentLevel;
        }
      } else {
        flushList();
        blocks.push({
          type: 'paragraph',
          runs,
          align,
          spaceAfter: 6,
        });
      }
    } else if (child.localName === 'tbl') {
      flushList();
      const tableBlock = parseTableNode(child);
      if (tableBlock.rows.length > 0) {
        blocks.push(tableBlock);
      }
    }
  }

  flushList();

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
        wordCount += b.text.match(/\S+/g)?.length ?? 0;
      } else if (b.type === 'list') {
        for (const item of b.items) {
          wordCount += item.reduce((acc, r) => acc + (r.text.match(/\S+/g)?.length ?? 0), 0);
        }
      } else if (b.type === 'table') {
        for (const row of b.rows) {
          for (const cell of row.cells) {
            wordCount += cell.runs.reduce((acc, r) => acc + (r.text.match(/\S+/g)?.length ?? 0), 0);
          }
        }
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
