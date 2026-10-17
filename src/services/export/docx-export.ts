/**
 * Microsoft Word (.docx) Document Exporter.
 *
 * Synthesises a standards-compliant OpenXML WordprocessingML package (.docx)
 * preserving headings, styled paragraphs, bullet and numbered lists,
 * reconstructed tables, code blocks, embedded images, and page dimensions.
 */

import type { ExportDefinition, ExportContext } from '../../core/export-registry';
import { createZipArchive } from '../conversion/zip-utils';
import { downloadBytes } from '../../utils/download-utils';
import {
  extractStructuredDocumentFromContext,
  type ExtractedDocumentStructure,
  type ExtractedTableBlock,
  type ExtractedImageItem,
} from './pdf-structure-extractor';
import type { StyledRun, BlockAlignment } from '../conversion/types';

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
 * Converts PDF points (1/72 inch) to OpenXML twips (1/20 of a point).
 */
function pointsToTwips(pts: number): number {
  return Math.max(20, Math.round(pts * 20));
}

/**
 * Converts PDF points (1/72 inch) to English Metric Units (1 pt = 12,700 EMUs).
 */
function pointsToEmu(pts: number): number {
  return Math.max(12700, Math.round(pts * 12700));
}

/**
 * Maps a BlockAlignment to OpenXML w:jc value.
 */
function mapAlignmentToJc(align?: BlockAlignment): string {
  if (align === 'center') return 'center';
  if (align === 'right') return 'right';
  if (align === 'justify') return 'both';
  return 'left';
}

/**
 * Serialises a single StyledRun into a WordprocessingML <w:r> element.
 */
function buildWordRunXml(run: StyledRun, defaultFontSizePts?: number): string {
  const parts: string[] = [];
  const style = run.style;
  const rPrParts: string[] = [];

  if (style?.code) {
    rPrParts.push('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>');
  }
  if (style?.bold) {
    rPrParts.push('<w:b/>');
  }
  if (style?.italic) {
    rPrParts.push('<w:i/>');
  }
  if (style?.underline) {
    rPrParts.push('<w:u w:val="single"/>');
  }
  if (style?.strike) {
    rPrParts.push('<w:strike/>');
  }
  const effectiveSize = style?.fontSize ?? defaultFontSizePts;
  if (effectiveSize && effectiveSize > 0) {
    const halfPts = Math.max(12, Math.round(effectiveSize * 2));
    rPrParts.push(`<w:sz w:val="${halfPts}"/><w:szCs w:val="${halfPts}"/>`);
  }
  if (style?.fontColor) {
    const cleanHex = style.fontColor.replace(/^#/, '').toUpperCase();
    if (/^[0-9A-F]{6}$/.test(cleanHex)) {
      rPrParts.push(`<w:color w:val="${cleanHex}"/>`);
    }
  }

  const rPrXml = rPrParts.length > 0 ? `<w:rPr>${rPrParts.join('')}</w:rPr>` : '';
  const lines = run.text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const preserveSpace =
      lineText.startsWith(' ') || lineText.endsWith(' ') ? ' xml:space="preserve"' : '';
    const brXml = i > 0 ? '<w:br/>' : '';
    parts.push(`<w:r>${rPrXml}${brXml}<w:t${preserveSpace}>${escapeXml(lineText)}</w:t></w:r>`);
  }

  return parts.join('');
}

/**
 * Serialises an ExtractedTableBlock into a WordprocessingML <w:tbl> element.
 */
function buildWordTableXml(table: ExtractedTableBlock): string {
  const gridColsXml = table.columnWidths
    .map((w) => `<w:gridCol w:w="${pointsToTwips(w)}"/>`)
    .join('');

  const rowsXml = table.rows
    .map((row) => {
      const trPrXml = row.isHeader ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
      const cellsXml = row.cells
        .map((cell, cIdx) => {
          const colW = table.columnWidths[cIdx] ?? 100;
          const shdXml = row.isHeader
            ? '<w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/>'
            : '';
          const tcPrXml = `<w:tcPr><w:tcW w:w="${pointsToTwips(colW)}" w:type="dxa"/>${shdXml}</w:tcPr>`;
          const jcXml = `<w:jc w:val="${mapAlignmentToJc(cell.align)}"/>`;
          const runsXml =
            cell.runs.length > 0
              ? cell.runs
                  .map((r) =>
                    buildWordRunXml(
                      row.isHeader ? { ...r, style: { ...r.style, bold: true } } : r,
                      9.5
                    )
                  )
                  .join('')
              : `<w:r><w:t>${escapeXml(cell.text)}</w:t></w:r>`;
          return `<w:tc>${tcPrXml}<w:p><w:pPr>${jcXml}</w:pPr>${runsXml}</w:p></w:tc>`;
        })
        .join('');
      return `<w:tr>${trPrXml}${cellsXml}</w:tr>`;
    })
    .join('');

  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/><w:left w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/><w:right w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/></w:tblBorders></w:tblPr><w:tblGrid>${gridColsXml}</w:tblGrid>${rowsXml}</w:tbl>`;
}

/**
 * Serialises an inline DrawingML image (<w:drawing>) referencing rId.
 */
function buildWordImageParagraphXml(
  img: ExtractedImageItem,
  relId: string,
  docPrId: number
): string {
  const cx = pointsToEmu(img.width);
  const cy = pointsToEmu(img.height);
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="Picture ${docPrId}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="image${docPrId}.${img.extension}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

/**
 * Builds a complete OpenXML .docx binary archive from an ExtractedDocumentStructure.
 */
export async function buildDocxBytesFromStructure(
  structure: ExtractedDocumentStructure
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {};

  const bodyElements: string[] = [];
  const relEntries: string[] = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
  ];
  let nextRelIdx = 3;
  let nextImageIdx = 1;

  for (let pIdx = 0; pIdx < structure.pages.length; pIdx++) {
    const page = structure.pages[pIdx];
    if (pIdx > 0) {
      bodyElements.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    }

    for (const block of page.blocks) {
      if (block.kind === 'heading') {
        const headingStyle = `Heading${Math.min(4, block.level)}`;
        const jcXml = `<w:jc w:val="${mapAlignmentToJc(block.align)}"/>`;
        const runsXml = block.runs
          .map((r) => buildWordRunXml(r, block.fontSize))
          .join('');
        bodyElements.push(
          `<w:p><w:pPr><w:pStyle w:val="${headingStyle}"/>${jcXml}</w:pPr>${runsXml}</w:p>`
        );
      } else if (block.kind === 'paragraph') {
        const jcXml = `<w:jc w:val="${mapAlignmentToJc(block.align)}"/>`;
        const runsXml = block.runs
          .map((r) => buildWordRunXml(r, block.fontSize))
          .join('');
        bodyElements.push(
          `<w:p><w:pPr><w:spacing w:after="120"/>${jcXml}</w:pPr>${runsXml}</w:p>`
        );
      } else if (block.kind === 'list') {
        const numId = block.ordered ? 2 : 1;
        for (const item of block.items) {
          const ilvl = Math.max(0, Math.min(4, item.indentLevel));
          const runsXml = item.runs.map((r) => buildWordRunXml(r, 10.5)).join('');
          bodyElements.push(
            `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${runsXml}</w:p>`
          );
        }
      } else if (block.kind === 'code') {
        const codeRun: StyledRun = {
          text: block.code,
          style: { code: true, fontSize: 9 },
        };
        bodyElements.push(
          `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/><w:spacing w:before="80" w:after="120"/></w:pPr>${buildWordRunXml(codeRun, 9)}</w:p>`
        );
      } else if (block.kind === 'table') {
        bodyElements.push(buildWordTableXml(block));
      } else if (block.kind === 'image') {
        const relId = `rId${nextRelIdx++}`;
        const imgIndex = nextImageIdx++;
        const mediaPath = `media/image${imgIndex}.${block.image.extension}`;
        files[`word/${mediaPath}`] = block.image.data;
        relEntries.push(
          `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${mediaPath}"/>`
        );
        bodyElements.push(buildWordImageParagraphXml(block.image, relId, imgIndex));
      }
    }
  }

  if (bodyElements.length === 0) {
    bodyElements.push('<w:p><w:r><w:t></w:t></w:r></w:p>');
  }

  const firstPage = structure.pages[0];
  const pageWidthTwips = pointsToTwips(firstPage?.widthPts ?? 595.28);
  const pageHeightTwips = pointsToTwips(firstPage?.heightPts ?? 841.89);
  const orientAttr = pageWidthTwips > pageHeightTwips ? ' w:orient="landscape"' : '';

  const sectPrXml = `<w:sectPr><w:pgSz w:w="${pageWidthTwips}" w:h="${pageHeightTwips}"${orientAttr}/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <w:body>${bodyElements.join('')}${sectPrXml}</w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="21"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="44"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading4">
    <w:name w:val="heading 4"/>
    <w:pPr><w:spacing w:before="120" w:after="60"/><w:outlineLvl w:val="3"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/>
    <w:pPr><w:ind w:left="720"/><w:spacing w:after="80"/></w:pPr>
  </w:style>
</w:styles>`;

  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relEntries.join('\n  ')}
</Relationships>`;

  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${escapeXml(structure.title)}</dc:title>
  <dc:creator>Kea PDF</dc:creator>
</cp:coreProperties>`;

  files['[Content_Types].xml'] = encoder.encode(contentTypesXml);
  files['_rels/.rels'] = encoder.encode(rootRelsXml);
  files['docProps/core.xml'] = encoder.encode(coreXml);
  files['word/_rels/document.xml.rels'] = encoder.encode(docRelsXml);
  files['word/styles.xml'] = encoder.encode(stylesXml);
  files['word/numbering.xml'] = encoder.encode(numberingXml);
  files['word/document.xml'] = encoder.encode(documentXml);

  return createZipArchive(files);
}

export const docxExport: ExportDefinition = {
  id: 'docx',
  label: 'Word Document',
  description: 'Convert PDF into an editable Microsoft Word document',
  extension: '.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  category: 'office',
  async export(ctx: ExportContext): Promise<void> {
    if (!ctx.editorStore.isDocumentLoaded) return;
    const structure = extractStructuredDocumentFromContext(ctx);
    const bytes = await buildDocxBytesFromStructure(structure);
    const baseName = ctx.editorStore.fileName.replace(/\.pdf$/i, '') || 'document';
    downloadBytes(
      bytes,
      `${baseName}.docx`,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  },
};
