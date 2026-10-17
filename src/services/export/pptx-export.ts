/**
 * Microsoft PowerPoint (.pptx) Presentation Exporter.
 *
 * Synthesises a standards-compliant OpenXML PresentationML package (.pptx)
 * where each PDF page becomes a slide with accurately positioned editable
 * text shapes, tables, and embedded media images.
 */

import type { ExportDefinition, ExportContext } from '../../core/export-registry';
import { createZipArchive } from '../conversion/zip-utils';
import { downloadBytes } from '../../utils/download-utils';
import {
  extractStructuredDocumentFromContext,
  type ExtractedDocumentStructure,
  type ExtractedPageStructure,
  type ExtractedTableBlock,
  type ExtractedImageItem,
} from './pdf-structure-extractor';
import type { StyledRun } from '../conversion/types';

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
 * Converts PDF points (1/72 inch) to English Metric Units (1 pt = 12,700 EMUs).
 */
function pointsToEmu(pts: number): number {
  return Math.max(0, Math.round(pts * 12700));
}

/**
 * Serialises a StyledRun into a DrawingML <a:r> element.
 */
function buildDrawingRunXml(run: StyledRun, defaultFontSizePts: number): string {
  const style = run.style;
  const attrs: string[] = ['lang="en-GB"'];
  const fontSize = style?.fontSize ?? defaultFontSizePts;
  if (fontSize > 0) {
    attrs.push(`sz="${Math.max(600, Math.round(fontSize * 100))}"`);
  }
  if (style?.bold) {
    attrs.push('b="1"');
  }
  if (style?.italic) {
    attrs.push('i="1"');
  }
  if (style?.underline) {
    attrs.push('u="sng"');
  }
  if (style?.strike) {
    attrs.push('strike="sngStrike"');
  }

  let fillXml = '';
  if (style?.fontColor) {
    const cleanHex = style.fontColor.replace(/^#/, '').toUpperCase();
    if (/^[0-9A-F]{6}$/.test(cleanHex)) {
      fillXml = `<a:solidFill><a:srgbClr val="${cleanHex}"/></a:solidFill>`;
    }
  }

  return `<a:r><a:rPr ${attrs.join(' ')}>${fillXml}</a:rPr><a:t>${escapeXml(run.text)}</a:t></a:r>`;
}

/**
 * Serialises an ExtractedTableBlock into a PresentationML <p:graphicFrame> containing <a:tbl>.
 */
function buildSlideTableXml(table: ExtractedTableBlock, shapeId: number): string {
  const x = pointsToEmu(table.left);
  const y = pointsToEmu(table.top);
  const cx = Math.max(127000, pointsToEmu(table.width));
  const cy = Math.max(127000, pointsToEmu(table.height));

  const gridColsXml = table.columnWidths
    .map((w) => `<a:gridCol w="${Math.max(127000, pointsToEmu(w))}"/>`)
    .join('');

  const rowHeightEmu = Math.max(
    180000,
    Math.round(cy / Math.max(1, table.rows.length))
  );

  const rowsXml = table.rows
    .map((row) => {
      const cellsXml = row.cells
        .map((cell) => {
          const runsXml =
            cell.runs.length > 0
              ? cell.runs
                  .map((r) =>
                    buildDrawingRunXml(
                      row.isHeader ? { ...r, style: { ...r.style, bold: true } } : r,
                      10
                    )
                  )
                  .join('')
              : `<a:r><a:rPr lang="en-GB" sz="1000"/><a:t>${escapeXml(cell.text)}</a:t></a:r>`;
          return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${runsXml}</a:p></a:txBody><a:tcPr/></a:tc>`;
        })
        .join('');
      return `<a:tr h="${rowHeightEmu}">${cellsXml}</a:tr>`;
    })
    .join('');

  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${shapeId}" name="Table ${shapeId}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${gridColsXml}</a:tblGrid>${rowsXml}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

/**
 * Serialises an ExtractedImageItem into a PresentationML <p:pic> element.
 */
function buildSlidePictureXml(
  img: ExtractedImageItem,
  relId: string,
  shapeId: number
): string {
  const x = pointsToEmu(img.left);
  const y = pointsToEmu(img.top);
  const cx = Math.max(127000, pointsToEmu(img.width));
  const cy = Math.max(127000, pointsToEmu(img.height));

  return `<p:pic><p:nvPicPr><p:cNvPr id="${shapeId}" name="Picture ${shapeId}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

/**
 * Builds the XML and relationship entries for a single slide from an ExtractedPageStructure.
 */
function buildSlideXmlForPage(
  page: ExtractedPageStructure,
  files: Record<string, Uint8Array>,
  nextMediaCounter: { value: number }
): { slideXml: string; slideRelsXml: string } {
  const shapeNodes: string[] = [];
  const slideRels: string[] = [];
  let shapeId = 2;
  let relIdx = 1;
  let hasAssignedTitle = false;

  for (const block of page.blocks) {
    if (block.kind === 'heading' || block.kind === 'paragraph') {
      const isSlideTitle =
        !hasAssignedTitle && block.kind === 'heading' && block.level <= 2;
      if (isSlideTitle) {
        hasAssignedTitle = true;
      }
      const isSubtitle =
        hasAssignedTitle && block.kind === 'heading' && block.level >= 2;
      const phXml = isSlideTitle
        ? '<p:ph type="title"/>'
        : isSubtitle
          ? '<p:ph type="subTitle"/>'
          : '';
      const x = pointsToEmu(block.left);
      const y = pointsToEmu(block.top);
      const cx = Math.max(254000, pointsToEmu(block.width));
      const cy = Math.max(127000, pointsToEmu(block.height));
      const runsXml = block.runs
        .map((r) => buildDrawingRunXml(r, block.fontSize))
        .join('');
      const algnAttr =
        block.align === 'center'
          ? ' algn="ctr"'
          : block.align === 'right'
            ? ' algn="r"'
            : '';

      shapeNodes.push(
        `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="TextBox ${shapeId}"/><p:cNvSpPr txBox="1"/><p:nvPr>${phXml}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:pPr${algnAttr}/>${runsXml}</a:p></p:txBody></p:sp>`
      );
      shapeId++;
    } else if (block.kind === 'list') {
      const x = pointsToEmu(block.left);
      const y = pointsToEmu(block.top);
      const cx = Math.max(254000, pointsToEmu(block.width));
      const cy = Math.max(127000, pointsToEmu(block.height));
      const paragraphsXml = block.items
        .map((item) => {
          const runsXml = item.runs
            .map((r) => buildDrawingRunXml(r, 12))
            .join('');
          return `<a:p><a:pPr lvl="${Math.min(4, item.indentLevel)}"/><a:buChar char="\u2022"/>${runsXml}</a:p>`;
        })
        .join('');
      shapeNodes.push(
        `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="List ${shapeId}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraphsXml}</p:txBody></p:sp>`
      );
      shapeId++;
    } else if (block.kind === 'code') {
      const x = pointsToEmu(block.left);
      const y = pointsToEmu(block.top);
      const cx = Math.max(254000, pointsToEmu(block.width));
      const cy = Math.max(127000, pointsToEmu(block.height));
      const linesXml = block.code
        .split('\n')
        .map(
          (line) =>
            `<a:p>${buildDrawingRunXml({ text: line, style: { code: true, fontSize: 9.5 } }, 9.5)}</a:p>`
        )
        .join('');
      shapeNodes.push(
        `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="Code ${shapeId}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="F6F8FA"/></a:solidFill></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${linesXml}</p:txBody></p:sp>`
      );
      shapeId++;
    } else if (block.kind === 'table') {
      shapeNodes.push(buildSlideTableXml(block, shapeId++));
    } else if (block.kind === 'image') {
      const relId = `rId${relIdx++}`;
      const mediaIdx = nextMediaCounter.value++;
      const mediaFile = `image${mediaIdx}.${block.image.extension}`;
      files[`ppt/media/${mediaFile}`] = block.image.data;
      slideRels.push(
        `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaFile}"/>`
      );
      shapeNodes.push(buildSlidePictureXml(block.image, relId, shapeId++));
    }
  }

  const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${shapeNodes.join('\n      ')}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

  const slideRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${slideRels.join('\n  ')}
</Relationships>`;

  return { slideXml, slideRelsXml };
}

/**
 * Builds a complete OpenXML .pptx binary archive from an ExtractedDocumentStructure.
 */
export async function buildPptxBytesFromStructure(
  structure: ExtractedDocumentStructure
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {};

  const firstPage = structure.pages[0];
  const slideWidthPts = firstPage?.widthPts ?? 960;
  const slideHeightPts = firstPage?.heightPts ?? 540;
  const cx = Math.max(914400, pointsToEmu(slideWidthPts));
  const cy = Math.max(914400, pointsToEmu(slideHeightPts));

  const pagesToExport: readonly ExtractedPageStructure[] =
    structure.pages.length > 0
      ? structure.pages
      : [
          {
            pageIndex: 0,
            widthPts: slideWidthPts,
            heightPts: slideHeightPts,
            blocks: [],
            tables: [],
            images: [],
            positionedTextBoxes: [],
          },
        ];

  const sldIdEntries: string[] = [];
  const presRelEntries: string[] = [];
  const contentTypeSlideOverrides: string[] = [];
  const nextMediaCounter = { value: 1 };

  for (let i = 0; i < pagesToExport.length; i++) {
    const slideNum = i + 1;
    const relId = `rId${slideNum}`;
    const sldId = 256 + i;

    const { slideXml, slideRelsXml } = buildSlideXmlForPage(
      pagesToExport[i],
      files,
      nextMediaCounter
    );

    files[`ppt/slides/slide${slideNum}.xml`] = encoder.encode(slideXml);
    files[`ppt/slides/_rels/slide${slideNum}.xml.rels`] = encoder.encode(slideRelsXml);

    sldIdEntries.push(`<p:sldId id="${sldId}" r:id="${relId}"/>`);
    presRelEntries.push(
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slideNum}.xml"/>`
    );
    contentTypeSlideOverrides.push(
      `<Override PartName="/ppt/slides/slide${slideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    );
  }

  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    ${sldIdEntries.join('\n    ')}
  </p:sldIdLst>
  <p:sldSz cx="${cx}" cy="${cy}"/>
  <p:notesSz cx="${cy}" cy="${cx}"/>
</p:presentation>`;

  const presRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${presRelEntries.join('\n  ')}
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  ${contentTypeSlideOverrides.join('\n  ')}
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
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
  files['ppt/presentation.xml'] = encoder.encode(presentationXml);
  files['ppt/_rels/presentation.xml.rels'] = encoder.encode(presRelsXml);

  return createZipArchive(files);
}

export const pptxExport: ExportDefinition = {
  id: 'pptx',
  label: 'PowerPoint',
  description: 'Convert PDF pages into editable Microsoft PowerPoint slides',
  extension: '.pptx',
  mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  category: 'office',
  async export(ctx: ExportContext): Promise<void> {
    if (!ctx.editorStore.isDocumentLoaded) return;
    const structure = extractStructuredDocumentFromContext(ctx);
    const bytes = await buildPptxBytesFromStructure(structure);
    const baseName = ctx.editorStore.fileName.replace(/\.pdf$/i, '') || 'presentation';
    downloadBytes(
      bytes,
      `${baseName}.pptx`,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
  },
};
