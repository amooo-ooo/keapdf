/**
 * PowerPoint Presentation (.pptx) to PDF Converter.
 * Parses PresentationML slide decks into an IDR SlideDocument and renders through pdf-layout-engine.
 */

import { PDFDocument } from 'pdf-lib';
import type {
  ConversionInputItem,
  ConvertedDocumentResult,
  DocumentConversionOptions,
  SlideDocument,
  SlideData,
  SlideElement,
  StyledRun,
  TextStyle,
  TableBlock,
  TableRow,
  TableCell,
  FormatConverter,
} from '../types';
import { unzipArchive, getZipText, type ZipEntryMap } from '../zip-utils';
import {
  parseXml,
  findDescendants,
  findChildren,
  findFirstChild,
  findFirstDescendant,
  getAttribute,
  type XmlNode,
} from '../xml-parser';
import { layoutSlideDocument } from '../pdf-layout-engine';
import { sanitizeTextForWinAnsi } from '../winansi-sanitizer';

/**
 * Converts English Metric Units (EMUs) to PDF points.
 * 1 inch = 914,400 EMUs = 72 PDF points (1 pt = 12,700 EMUs).
 */
function emuToPoints(emu?: string | number): number {
  if (!emu) return 0;
  const num = typeof emu === 'number' ? emu : parseInt(emu, 10);
  return isNaN(num) ? 0 : Math.round(num / 12700);
}

/**
 * Parses DrawingML run properties (a:rPr) into a TextStyle.
 */
function parseDrawingRunStyle(rPr?: XmlNode): TextStyle {
  if (!rPr) return {};
  const bVal = getAttribute(rPr, 'b');
  const iVal = getAttribute(rPr, 'i');
  const uVal = getAttribute(rPr, 'u');
  const strikeVal = getAttribute(rPr, 'strike');
  const szVal = getAttribute(rPr, 'sz');

  const bold = bVal === '1' || bVal === 'true';
  const italic = iVal === '1' || iVal === 'true';
  const underline = Boolean(uVal && uVal !== 'none');
  const strike = Boolean(strikeVal && strikeVal !== 'noStrike');

  let fontSize: number | undefined;
  if (szVal) {
    const hundredths = parseInt(szVal, 10);
    if (!isNaN(hundredths) && hundredths > 0) {
      fontSize = hundredths / 100;
    }
  }

  let fontColor: string | undefined;
  const srgb = findFirstDescendant(rPr, 'srgbClr');
  if (srgb) {
    const val = getAttribute(srgb, 'val');
    if (val) {
      fontColor = `#${val}`;
    }
  }

  return { bold, italic, underline, strike, fontSize, fontColor };
}

/**
 * Extracts StyledRun items from a DrawingML paragraph (a:p).
 */
function extractSlideParagraphRuns(pNode: XmlNode): StyledRun[] {
  const runs: StyledRun[] = [];
  for (const child of pNode.children) {
    if (child.localName === 'r') {
      const rPr = findFirstChild(child, 'rPr');
      const style = parseDrawingRunStyle(rPr);
      const tNode = findFirstChild(child, 't');
      if (tNode && tNode.text.length > 0) {
        runs.push({
          text: sanitizeTextForWinAnsi(tNode.text),
          style,
        });
      }
    } else if (child.localName === 'br') {
      runs.push({ text: '\n' });
    } else if (child.localName === 'fld') {
      const tNode = findFirstDescendant(child, 't');
      if (tNode && tNode.text.length > 0) {
        runs.push({ text: sanitizeTextForWinAnsi(tNode.text) });
      }
    }
  }

  if (runs.length === 0) {
    const tNodes = findDescendants(pNode, 't');
    const fallback = sanitizeTextForWinAnsi(tNodes.map((t) => t.text).join('').trim());
    if (fallback.length > 0) {
      runs.push({ text: fallback });
    }
  }

  return runs;
}

/**
 * Parses a DrawingML table (a:tbl) into a TableBlock.
 */
function parseSlideTable(tblNode: XmlNode): TableBlock {
  const rows: TableRow[] = [];
  const trNodes = findChildren(tblNode, 'tr');

  const tblGrid = findFirstChild(tblNode, 'tblGrid');
  let columnWidths: number[] | undefined;
  if (tblGrid) {
    const cols = findChildren(tblGrid, 'gridCol');
    const widths = cols
      .map((c) => emuToPoints(getAttribute(c, 'w')))
      .filter((w) => w > 0);
    if (widths.length > 0) columnWidths = widths;
  }

  for (let rIdx = 0; rIdx < trNodes.length; rIdx++) {
    const tr = trNodes[rIdx];
    const tcNodes = findChildren(tr, 'tc');
    const isHeader = rIdx === 0;
    const cells: TableCell[] = [];

    for (const tc of tcNodes) {
      const txBody = findFirstChild(tc, 'txBody');
      const cellRuns: StyledRun[] = [];
      if (txBody) {
        const pNodes = findChildren(txBody, 'p');
        for (let pIdx = 0; pIdx < pNodes.length; pIdx++) {
          if (pIdx > 0 && cellRuns.length > 0) {
            cellRuns.push({ text: '\n' });
          }
          cellRuns.push(...extractSlideParagraphRuns(pNodes[pIdx]));
        }
      }
      cells.push({
        runs: cellRuns.length > 0 ? cellRuns : [{ text: '' }],
        isHeader,
      });
    }

    if (cells.length > 0) {
      rows.push({ cells, isHeader });
    }
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
 * Parses slide relationships (ppt/slides/_rels/slideN.xml.rels) into a map of rId -> target path.
 */
function parseSlideRels(entries: ZipEntryMap, slideNum: number): Map<string, string> {
  const map = new Map<string, string>();
  const relsXml =
    getZipText(entries, `ppt/slides/_rels/slide${slideNum}.xml.rels`) ??
    getZipText(entries, `ppt/slides/_rels/slide${slideNum}.XML.RELS`);
  if (!relsXml) return map;

  const root = parseXml(relsXml);
  for (const rel of findDescendants(root, 'Relationship')) {
    const id = getAttribute(rel, 'Id');
    const target = getAttribute(rel, 'Target');
    if (id && target) {
      map.set(id, target);
    }
  }
  return map;
}

/**
 * Resolves a slide media entry (e.g. ../media/image1.png) from the PPTX zip archive.
 */
function resolveSlideMedia(
  entries: ZipEntryMap,
  target: string
): { data: Uint8Array; mimeType: string } | undefined {
  const clean = target.replace(/^\/+/, '').replace(/^\.\.\//, '');
  const candidates = [
    clean.startsWith('ppt/') ? clean : `ppt/${clean}`,
    clean,
  ];
  for (const path of candidates) {
    const data = entries[path];
    if (data && data.byteLength > 0) {
      const lower = path.toLowerCase();
      if (lower.endsWith('.png')) return { data, mimeType: 'image/png' };
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return { data, mimeType: 'image/jpeg' };
    }
  }
  return undefined;
}

/**
 * Extracts slide elements from a single slide XML (ppt/slides/slideN.xml).
 */
function parseSlideXml(
  xml: string,
  slideIndex: number,
  entries?: ZipEntryMap,
  slideRels?: Map<string, string>
): SlideData {
  const root = parseXml(xml);
  const elements: SlideElement[] = [];

  let slideTitle: string | undefined;
  const spNodes = findDescendants(root, 'sp');

  for (const sp of spNodes) {
    const ph = findFirstDescendant(sp, 'ph');
    const phType = ph ? getAttribute(ph, 'type') : undefined;
    const isTitlePh = phType === 'title' || phType === 'ctrTitle';
    const isSubTitlePh = phType === 'subTitle';

    const txBody = findFirstChild(sp, 'txBody');
    if (!txBody) continue;

    const pNodes = findChildren(txBody, 'p');
    const bulletItems: string[] = [];

    for (const p of pNodes) {
      const pRuns = extractSlideParagraphRuns(p);
      const text = pRuns.map((r) => r.text).join('').trim();
      if (text.length === 0) continue;

      if (isTitlePh && !slideTitle) {
        slideTitle = text;
        elements.push({
          kind: 'title',
          title: text,
          runs: pRuns,
        });
      } else if (isSubTitlePh) {
        elements.push({
          kind: 'subtitle',
          runs: pRuns,
        });
      } else {
        bulletItems.push(text);
      }
    }

    if (bulletItems.length > 0) {
      elements.push({
        kind: 'bullet_list',
        items: bulletItems,
      });
    }
  }

  // Extract slide tables (a:tbl inside p:graphicFrame)
  for (const tblNode of findDescendants(root, 'tbl')) {
    const tableBlock = parseSlideTable(tblNode);
    if (tableBlock.rows.length > 0) {
      elements.push({
        kind: 'table',
        table: tableBlock,
      });
    }
  }

  // Extract embedded slide pictures (p:pic -> a:blip r:embed)
  if (entries && slideRels) {
    for (const picNode of findDescendants(root, 'pic')) {
      const blip = findFirstDescendant(picNode, 'blip');
      const embedId = blip ? getAttribute(blip, 'embed') : undefined;
      if (!embedId) continue;
      const target = slideRels.get(embedId);
      if (!target) continue;
      const media = resolveSlideMedia(entries, target);
      if (!media) continue;

      const xfrm = findFirstDescendant(picNode, 'xfrm');
      const off = xfrm ? findFirstChild(xfrm, 'off') : undefined;
      const ext = xfrm ? findFirstChild(xfrm, 'ext') : undefined;
      const xPts = off ? emuToPoints(getAttribute(off, 'x')) : undefined;
      const yPts = off ? emuToPoints(getAttribute(off, 'y')) : undefined;
      const wPts = ext ? emuToPoints(getAttribute(ext, 'cx')) : undefined;
      const hPts = ext ? emuToPoints(getAttribute(ext, 'cy')) : undefined;

      elements.push({
        kind: 'image',
        imageData: media.data,
        imageMime: media.mimeType,
        x: xPts && xPts > 0 ? xPts : undefined,
        y: yPts && yPts > 0 ? yPts : undefined,
        width: wPts && wPts > 0 ? wPts : undefined,
        height: hPts && hPts > 0 ? hPts : undefined,
      });
    }
  }

  return {
    slideIndex,
    title: slideTitle,
    elements,
  };
}

/**
 * Parses a PPTX package into an IDR SlideDocument.
 */
export async function parsePptxPackage(
  buffer: ArrayBuffer | Uint8Array,
  baseTitle?: string
): Promise<SlideDocument> {
  const entries = await unzipArchive(buffer);
  const presentationXml = getZipText(entries, 'ppt/presentation.xml');

  let width = 960; // note: default 16:9 widescreen in pt
  let height = 540;

  if (presentationXml) {
    const pRoot = parseXml(presentationXml);
    const sldSz = findFirstDescendant(pRoot, 'sldSz');
    if (sldSz) {
      const cx = emuToPoints(getAttribute(sldSz, 'cx'));
      const cy = emuToPoints(getAttribute(sldSz, 'cy'));
      if (cx > 0 && cy > 0) {
        width = cx;
        height = cy;
      }
    }
  }

  const slides: SlideData[] = [];
  let slideNum = 1;

  while (true) {
    const slideXml =
      getZipText(entries, `ppt/slides/slide${slideNum}.xml`) ??
      getZipText(entries, `ppt/slides/slide${slideNum}.XML`);
    if (!slideXml) break;

    const slideRels = parseSlideRels(entries, slideNum);
    const slideData = parseSlideXml(slideXml, slideNum - 1, entries, slideRels);
    slides.push(slideData);
    slideNum++;
  }

  // Fallback: If no sequential slideN.xml found, scan all entries for slide*.xml
  if (slides.length === 0) {
    const keys = Object.keys(entries).filter(
      (k) => k.toLowerCase().startsWith('ppt/slides/slide') && k.toLowerCase().endsWith('.xml')
    );
    for (let i = 0; i < keys.length; i++) {
      const xml = getZipText(entries, keys[i]);
      if (xml) {
        slides.push(parseSlideXml(xml, i, entries));
      }
    }
  }

  return {
    title: baseTitle ? sanitizeTextForWinAnsi(baseTitle) : undefined,
    width,
    height,
    slides: slides.length > 0 ? slides : [{ slideIndex: 0, elements: [] }],
  };
}

export class PptxConverter implements FormatConverter {
  readonly id = 'pptx';
  readonly displayName = 'Microsoft PowerPoint (.pptx)';
  readonly formats = ['pptx'] as const;
  readonly extensions = ['.pptx', '.ppt'] as const;
  readonly mimeTypes = [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
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
    const baseName = input.name.replace(/\.[^/.]+$/, '') || 'presentation';
    const slideDoc = await parsePptxPackage(input.buffer, baseName);

    const doc = await PDFDocument.create();
    const { pageCount } = await layoutSlideDocument(doc, slideDoc, options);

    const pdfBytes = await doc.save();
    const buffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer;

    return {
      buffer,
      pageCount,
      fileName: `${baseName}.pdf`,
      format: 'pptx',
      metadata: {
        title: baseName,
        slideCount: slideDoc.slides.length,
        conversionDurationMs: Date.now() - startTime,
      },
    };
  }
}
