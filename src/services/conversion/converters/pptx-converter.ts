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
 * Extracts slide elements from a single slide XML (ppt/slides/slideN.xml).
 */
function parseSlideXml(xml: string, slideIndex: number): SlideData {
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
      const tNodes = findDescendants(p, 't');
      const rawText = tNodes.map((t) => t.text).join('').trim();
      const text = sanitizeTextForWinAnsi(rawText);
      if (text.length === 0) continue;

      if (isTitlePh && !slideTitle) {
        slideTitle = text;
        elements.push({
          kind: 'title',
          title: text,
        });
      } else if (isSubTitlePh) {
        elements.push({
          kind: 'subtitle',
          runs: [{ text }],
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

  let width = 960; // Default 16:9 widescreen in pt
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

    const slideData = parseSlideXml(slideXml, slideNum - 1);
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
        slides.push(parseSlideXml(xml, i));
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
