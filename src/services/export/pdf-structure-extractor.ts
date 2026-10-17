/**
 * PDF Document Structure Extractor for High-Fidelity Format Conversion.
 *
 * Reconstructs semantic blocks (headings, paragraphs, styled runs, lists,
 * code blocks, spatial tables, and images) and positioned slide elements
 * from native PDFium pages and active canvas overlay elements.
 */

import type { PdfDocument } from '../pdf/pdf-document';
import type {
  EditableTextSpan,
  EditableImageSpan,
  EditableShapeSpan,
  TextLine,
  TextWord,
  ColorRgba,
} from '../../core/types';
import type { CanvasElement, TextElement, ImageElement } from '../../stores/canvas-types';
import type { ExportContext } from '../../core/export-registry';
import type {
  StyledRun,
  TextStyle,
  BlockAlignment,
} from '../conversion/types';

export interface ExtractedImageItem {
  readonly id: string;
  readonly data: Uint8Array;
  readonly mimeType: 'image/png' | 'image/jpeg';
  readonly extension: 'png' | 'jpg';
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ExtractedTableCell {
  readonly text: string;
  readonly runs: readonly StyledRun[];
  readonly align: BlockAlignment;
  readonly isHeader: boolean;
}

export interface ExtractedTableRow {
  readonly cells: readonly ExtractedTableCell[];
  readonly isHeader: boolean;
}

export interface ExtractedTableBlock {
  readonly kind: 'table';
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
  readonly columnWidths: readonly number[];
  readonly rows: readonly ExtractedTableRow[];
}

export interface ExtractedHeadingBlock {
  readonly kind: 'heading';
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly text: string;
  readonly runs: readonly StyledRun[];
  readonly align: BlockAlignment;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
}

export interface ExtractedParagraphBlock {
  readonly kind: 'paragraph';
  readonly text: string;
  readonly runs: readonly StyledRun[];
  readonly align: BlockAlignment;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
}

export interface ExtractedListItem {
  readonly text: string;
  readonly runs: readonly StyledRun[];
  readonly indentLevel: number;
}

export interface ExtractedListBlock {
  readonly kind: 'list';
  readonly ordered: boolean;
  readonly items: readonly ExtractedListItem[];
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface ExtractedCodeBlock {
  readonly kind: 'code';
  readonly code: string;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface ExtractedImageBlock {
  readonly kind: 'image';
  readonly image: ExtractedImageItem;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export type ExtractedPageBlock =
  | ExtractedHeadingBlock
  | ExtractedParagraphBlock
  | ExtractedListBlock
  | ExtractedCodeBlock
  | ExtractedTableBlock
  | ExtractedImageBlock;

export interface PositionedTextBox {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
  readonly runs: readonly StyledRun[];
  readonly fontSize: number;
  readonly isHeading: boolean;
  readonly headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly isList: boolean;
  readonly align: BlockAlignment;
}

export interface ExtractedPageStructure {
  readonly pageIndex: number;
  readonly widthPts: number;
  readonly heightPts: number;
  readonly blocks: readonly ExtractedPageBlock[];
  readonly tables: readonly ExtractedTableBlock[];
  readonly images: readonly ExtractedImageItem[];
  readonly positionedTextBoxes: readonly PositionedTextBox[];
}

export interface ExtractedDocumentStructure {
  readonly title: string;
  readonly pages: readonly ExtractedPageStructure[];
}

/**
 * Converts a ColorRgba object into a 6-digit uppercase hex colour string (#RRGGBB).
 */
function rgbaToHex(color?: ColorRgba): string | undefined {
  if (!color) return undefined;
  const r = Math.max(0, Math.min(255, Math.round(color.r)));
  const g = Math.max(0, Math.min(255, Math.round(color.g)));
  const b = Math.max(0, Math.min(255, Math.round(color.b)));
  if (r === 0 && g === 0 && b === 0) return undefined;
  const hex = [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `#${hex}`;
}

/**
 * Checks whether a font family name indicates a monospace typeface.
 */
function isMonospaceFont(fontFamily?: string, rawFontFamily?: string): boolean {
  const combined = `${fontFamily ?? ''} ${rawFontFamily ?? ''}`.toLowerCase();
  return (
    combined.includes('courier') ||
    combined.includes('mono') ||
    combined.includes('consolas') ||
    combined.includes('menlo') ||
    combined.includes('fira') ||
    combined.includes('sourcecode')
  );
}

/**
 * Decodes a base64 data URL (data:image/png;base64,... or data:image/jpeg;base64,...) into binary bytes.
 */
function decodeDataUrlToBytes(
  src: string
): { data: Uint8Array; mimeType: 'image/png' | 'image/jpeg'; extension: 'png' | 'jpg' } | null {
  if (!src || !src.startsWith('data:image/')) return null;
  const commaIdx = src.indexOf(',');
  if (commaIdx < 0) return null;

  const header = src.slice(0, commaIdx).toLowerCase();
  const base64 = src.slice(commaIdx + 1);
  if (!base64) return null;

  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const isJpeg = header.includes('jpeg') || header.includes('jpg');
    return {
      data: bytes,
      mimeType: isJpeg ? 'image/jpeg' : 'image/png',
      extension: isJpeg ? 'jpg' : 'png',
    };
  } catch {
    return null;
  }
}

/**
 * Converts a TextWord into a StyledRun.
 */
function wordToStyledRun(word: TextWord, trailingSpace: boolean): StyledRun {
  const bold =
    word.fontWeight === 'bold' ||
    word.fontWeight === '700' ||
    (word.rawFontFamily ?? '').toLowerCase().includes('bold');
  const italic =
    word.fontStyle === 'italic' ||
    word.fontStyle === 'oblique' ||
    (word.rawFontFamily ?? '').toLowerCase().includes('italic') ||
    (word.rawFontFamily ?? '').toLowerCase().includes('oblique');
  const mono = isMonospaceFont(word.fontFamily, word.rawFontFamily);

  const style: TextStyle = {
    bold: bold || undefined,
    italic: italic || undefined,
    underline: word.underline || undefined,
    strike: word.strikethrough || undefined,
    code: mono || undefined,
    fontSize: word.fontSize > 0 ? Math.round(word.fontSize * 10) / 10 : undefined,
    fontColor: rgbaToHex(word.color),
  };

  return {
    text: trailingSpace ? `${word.text} ` : word.text,
    style,
  };
}

/**
 * Coalesces adjacent StyledRun items with identical styling.
 */
function coalesceStyledRuns(runs: readonly StyledRun[]): StyledRun[] {
  const result: StyledRun[] = [];
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const prev = result[result.length - 1];
    if (
      prev &&
      prev.link === run.link &&
      Boolean(prev.style?.bold) === Boolean(run.style?.bold) &&
      Boolean(prev.style?.italic) === Boolean(run.style?.italic) &&
      Boolean(prev.style?.underline) === Boolean(run.style?.underline) &&
      Boolean(prev.style?.strike) === Boolean(run.style?.strike) &&
      Boolean(prev.style?.code) === Boolean(run.style?.code) &&
      prev.style?.fontSize === run.style?.fontSize &&
      prev.style?.fontColor === run.style?.fontColor
    ) {
      result[result.length - 1] = {
        ...prev,
        text: prev.text + run.text,
      };
    } else {
      result.push(run);
    }
  }
  return result;
}

/**
 * Extracts StyledRun items from an EditableTextSpan.
 */
function extractRunsFromSpan(span: EditableTextSpan): StyledRun[] {
  if (span.lines && span.lines.length > 0) {
    const rawRuns: StyledRun[] = [];
    for (let lIdx = 0; lIdx < span.lines.length; lIdx++) {
      const line = span.lines[lIdx];
      if (lIdx > 0 && rawRuns.length > 0) {
        const lastRun = rawRuns[rawRuns.length - 1];
        if (!lastRun.text.endsWith(' ') && !lastRun.text.endsWith('\n')) {
          rawRuns.push({ text: ' ', style: lastRun.style });
        }
      }
      if (line.words && line.words.length > 0) {
        for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
          const word = line.words[wIdx];
          const hasSpaceAfter = wIdx < line.words.length - 1;
          rawRuns.push(wordToStyledRun(word, hasSpaceAfter));
        }
      } else if (line.text.trim().length > 0) {
        rawRuns.push({
          text: line.text.trim(),
          style: {
            bold: line.fontWeight === 'bold' || undefined,
            italic: line.fontStyle === 'italic' || undefined,
            underline: line.underline || undefined,
            strike: line.strikethrough || undefined,
            code: isMonospaceFont(line.fontFamily, line.rawFontFamily) || undefined,
            fontSize: line.fontSize > 0 ? Math.round(line.fontSize * 10) / 10 : undefined,
            fontColor: rgbaToHex(line.color),
          },
        });
      }
    }
    const coalesced = coalesceStyledRuns(rawRuns);
    if (coalesced.length > 0) return coalesced;
  }

  const bold =
    span.fontWeight === 'bold' ||
    span.fontWeight === '700' ||
    (span.rawFontFamily ?? '').toLowerCase().includes('bold');
  const italic =
    span.fontStyle === 'italic' ||
    span.fontStyle === 'oblique' ||
    (span.rawFontFamily ?? '').toLowerCase().includes('italic');
  const mono = isMonospaceFont(span.fontFamily, span.rawFontFamily);

  return [
    {
      text: span.text,
      style: {
        bold: bold || undefined,
        italic: italic || undefined,
        underline: span.underline || undefined,
        strike: span.strikethrough || undefined,
        code: mono || undefined,
        fontSize: span.fontSize > 0 ? Math.round(span.fontSize * 10) / 10 : undefined,
        fontColor: rgbaToHex(span.color),
      },
    },
  ];
}

/**
 * Converts a canvas TextElement into an EditableTextSpan for unified extraction.
 */
function canvasTextElementToSpan(el: TextElement): EditableTextSpan {
  let text = el.text ?? '';
  if (!text && el.lines && el.lines.length > 0) {
    text = el.lines.map((l) => l.text).join('\n');
  } else if (!text && el.segments && el.segments.length > 0) {
    text = el.segments.map((s) => s.text).join(' ');
  }

  return {
    type: 'text',
    id: el.id,
    pageIndex: el.pageIndex,
    text,
    left: el.x,
    top: el.y,
    width: el.width,
    height: el.height,
    fontSize: el.fontSize ?? 12,
    fontFamily: el.fontFamily ?? 'Helvetica',
    rawFontFamily: el.fontFamily ?? 'Helvetica',
    color: { r: 0, g: 0, b: 0, a: 255 },
    baselineY: el.y + (el.fontSize ?? 12),
    charStartIndex: 0,
    charCount: text.length,
    fontWeight: el.fontWeight,
    fontStyle: el.fontStyle,
    underline: el.underline,
    strikethrough: el.strikethrough,
    textAlign: el.textAlign,
  };
}

interface HorizontalCellSegment {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly text: string;
  readonly runs: readonly StyledRun[];
  readonly fontSize: number;
  readonly isBold: boolean;
}

interface HorizontalRowBand {
  readonly top: number;
  readonly bottom: number;
  readonly cells: HorizontalCellSegment[];
  readonly sourceSpanIds: Set<string>;
}

/**
 * Extracts all individual lines across spans to detect multi-column tabular alignments.
 */
function extractHorizontalRowBands(spans: readonly EditableTextSpan[]): HorizontalRowBand[] {
  const segments: (HorizontalCellSegment & { spanId: string })[] = [];

  for (const span of spans) {
    const lines: readonly TextLine[] =
      span.lines && span.lines.length > 0
        ? span.lines
        : [
            {
              text: span.text,
              left: span.left,
              top: span.top,
              right: span.left + span.width,
              bottom: span.top + span.height,
              width: span.width,
              height: span.height,
              fontSize: span.fontSize,
              baselineY: span.baselineY,
              lineHeight: span.height,
              charStartIndex: span.charStartIndex,
              charCount: span.charCount,
              words: [],
              fontWeight: span.fontWeight,
              fontStyle: span.fontStyle,
              color: span.color,
            },
          ];

    for (const line of lines) {
      if (!line.text || line.text.trim().length === 0) continue;

      // Split a single line into distinct horizontal segments if words have large column gaps (> 2.2x fontSize)
      if (line.words && line.words.length > 1) {
        const sortedWords = [...line.words].sort((a, b) => a.left - b.left);
        let groupWords: TextWord[] = [sortedWords[0]];
        const gapThreshold = Math.max(18, (line.fontSize || 10) * 2.2);

        for (let i = 1; i < sortedWords.length; i++) {
          const prev = sortedWords[i - 1];
          const curr = sortedWords[i];
          const gap = curr.left - prev.right;
          if (gap >= gapThreshold) {
            const segLeft = groupWords[0].left;
            const segRight = groupWords[groupWords.length - 1].right;
            const segTop = Math.min(...groupWords.map((w) => w.top));
            const segBottom = Math.max(...groupWords.map((w) => w.bottom));
            const segRuns = coalesceStyledRuns(
              groupWords.map((w, idx) => wordToStyledRun(w, idx < groupWords.length - 1))
            );
            const segText = segRuns.map((r) => r.text).join('').trim();
            if (segText.length > 0) {
              segments.push({
                spanId: span.id,
                left: segLeft,
                right: segRight,
                top: segTop,
                bottom: segBottom,
                text: segText,
                runs: segRuns,
                fontSize: line.fontSize || span.fontSize || 10,
                isBold: groupWords.some((w) => w.fontWeight === 'bold'),
              });
            }
            groupWords = [curr];
          } else {
            groupWords.push(curr);
          }
        }

        if (groupWords.length > 0) {
          const segLeft = groupWords[0].left;
          const segRight = groupWords[groupWords.length - 1].right;
          const segTop = Math.min(...groupWords.map((w) => w.top));
          const segBottom = Math.max(...groupWords.map((w) => w.bottom));
          const segRuns = coalesceStyledRuns(
            groupWords.map((w, idx) => wordToStyledRun(w, idx < groupWords.length - 1))
          );
          const segText = segRuns.map((r) => r.text).join('').trim();
          if (segText.length > 0) {
            segments.push({
              spanId: span.id,
              left: segLeft,
              right: segRight,
              top: segTop,
              bottom: segBottom,
              text: segText,
              runs: segRuns,
              fontSize: line.fontSize || span.fontSize || 10,
              isBold: groupWords.some((w) => w.fontWeight === 'bold'),
            });
          }
        }
      } else {
        const text = line.text.trim();
        const isBold =
          line.fontWeight === 'bold' ||
          span.fontWeight === 'bold' ||
          (span.rawFontFamily ?? '').toLowerCase().includes('bold');
        segments.push({
          spanId: span.id,
          left: line.left,
          right: line.right,
          top: line.top,
          bottom: line.bottom,
          text,
          runs: [
            {
              text,
              style: {
                bold: isBold || undefined,
                italic: line.fontStyle === 'italic' || span.fontStyle === 'italic' || undefined,
                fontSize: line.fontSize || span.fontSize || 10,
                fontColor: rgbaToHex(line.color ?? span.color),
              },
            },
          ],
          fontSize: line.fontSize || span.fontSize || 10,
          isBold,
        });
      }
    }
  }

  // Sort segments top-to-bottom, then left-to-right
  segments.sort((a, b) => {
    const midA = (a.top + a.bottom) / 2;
    const midB = (b.top + b.bottom) / 2;
    if (Math.abs(midA - midB) <= Math.max(a.fontSize, b.fontSize) * 0.65) {
      return a.left - b.left;
    }
    return midA - midB;
  });

  // Group into horizontal row bands
  const bands: HorizontalRowBand[] = [];
  for (const seg of segments) {
    const segMid = (seg.top + seg.bottom) / 2;
    const lastBand = bands[bands.length - 1];
    if (
      lastBand &&
      Math.abs(segMid - (lastBand.top + lastBand.bottom) / 2) <= Math.max(seg.fontSize, 10) * 0.7
    ) {
      lastBand.cells.push(seg);
      lastBand.sourceSpanIds.add(seg.spanId);
    } else {
      bands.push({
        top: seg.top,
        bottom: seg.bottom,
        cells: [seg],
        sourceSpanIds: new Set([seg.spanId]),
      });
    }
  }

  for (const band of bands) {
    band.cells.sort((a, b) => a.left - b.left);
  }

  return bands;
}

/**
 * Reconstructs spatial TableBlocks from consecutive multi-column horizontal row bands.
 */
function detectSpatialTables(
  spans: readonly EditableTextSpan[],
  _shapes: readonly EditableShapeSpan[]
): { tables: ExtractedTableBlock[]; consumedSpanIds: Set<string> } {
  const bands = extractHorizontalRowBands(spans);
  const tables: ExtractedTableBlock[] = [];
  const consumedSpanIds = new Set<string>();

