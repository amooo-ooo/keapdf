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

  let idx = 0;
  while (idx < bands.length) {
    const band = bands[idx];
    if (band.cells.length < 2) {
      idx++;
      continue;
    }

    // Collect consecutive multi-column bands with reasonable vertical proximity
    const candidateBands: HorizontalRowBand[] = [band];
    let nextIdx = idx + 1;
    while (nextIdx < bands.length) {
      const prevBand = candidateBands[candidateBands.length - 1];
      const currBand = bands[nextIdx];
      const verticalGap = currBand.top - prevBand.bottom;
      if (currBand.cells.length >= 2 && verticalGap <= 36) {
        candidateBands.push(currBand);
        nextIdx++;
      } else {
        break;
      }
    }

    if (candidateBands.length >= 2) {
      // Determine column anchor centres by clustering cell left edges
      const colAnchors: number[] = [];
      const colRightEdges: number[] = [];
      const anchorTolerance = 28;

      for (const b of candidateBands) {
        for (const cell of b.cells) {
          let matchedCol = -1;
          for (let c = 0; c < colAnchors.length; c++) {
            if (Math.abs(cell.left - colAnchors[c]) <= anchorTolerance) {
              matchedCol = c;
              colAnchors[c] = (colAnchors[c] + cell.left) / 2;
              colRightEdges[c] = Math.max(colRightEdges[c], cell.right);
              break;
            }
          }
          if (matchedCol < 0) {
            colAnchors.push(cell.left);
            colRightEdges.push(cell.right);
          }
        }
      }

      // Sort column anchors left-to-right
      const sortedIndices = colAnchors
        .map((_, i) => i)
        .sort((a, b) => colAnchors[a] - colAnchors[b]);
      const sortedAnchors = sortedIndices.map((i) => colAnchors[i]);
      const sortedRights = sortedIndices.map((i) => colRightEdges[i]);
      const colCount = sortedAnchors.length;

      if (colCount >= 2 && colCount <= 20) {
        const tableRows: ExtractedTableRow[] = [];

        for (let rIdx = 0; rIdx < candidateBands.length; rIdx++) {
          const b = candidateBands[rIdx];
          const isHeader = rIdx === 0;
          const rowSlots: { texts: string[]; runs: StyledRun[] }[] = Array.from(
            { length: colCount },
            () => ({ texts: [], runs: [] })
          );

          for (const cell of b.cells) {
            // Find closest column anchor
            let bestCol = 0;
            let bestDist = Infinity;
            for (let c = 0; c < colCount; c++) {
              const dist = Math.abs(cell.left - sortedAnchors[c]);
              if (dist < bestDist) {
                bestDist = dist;
                bestCol = c;
              }
            }
            if (rowSlots[bestCol].texts.length > 0) {
              rowSlots[bestCol].runs.push({ text: ' ' });
            }
            rowSlots[bestCol].texts.push(cell.text);
            rowSlots[bestCol].runs.push(...cell.runs);
          }

          const cells: ExtractedTableCell[] = rowSlots.map((slot) => {
            const cellText = slot.texts.join(' ').trim();
            const isNum = /^-?[$\u20ac\u00a3\u00a5]?[\d,]+(\.\d+)?%?$/.test(cellText) && cellText.length > 0;
            return {
              text: cellText,
              runs: slot.runs.length > 0 ? coalesceStyledRuns(slot.runs) : [{ text: '' }],
              align: isNum && !isHeader ? 'right' : 'left',
              isHeader,
            };
          });

          tableRows.push({ cells, isHeader });
          for (const spanId of b.sourceSpanIds) {
            consumedSpanIds.add(spanId);
          }
        }

        const minLeft = Math.min(...sortedAnchors);
        const maxRight = Math.max(...sortedRights, minLeft + 100);
        const minTop = candidateBands[0].top;
        const maxBottom = candidateBands[candidateBands.length - 1].bottom;
        const colWidths = sortedAnchors.map((leftEdge, cIdx) => {
          const nextEdge = cIdx < colCount - 1 ? sortedAnchors[cIdx + 1] : maxRight;
          return Math.max(24, Math.round(nextEdge - leftEdge));
        });

        tables.push({
          kind: 'table',
          top: minTop,
          left: minLeft,
          width: Math.max(80, maxRight - minLeft),
          height: Math.max(20, maxBottom - minTop),
          columnWidths: colWidths,
          rows: tableRows,
        });

        idx = nextIdx;
        continue;
      }
    }

    idx++;
  }

  return { tables, consumedSpanIds };
}

/**
 * Computes the median font size across all spans on a page to calibrate heading thresholds.
 */
function computeBodyFontSize(spans: readonly EditableTextSpan[]): number {
  if (spans.length === 0) return 10.5;
  const sizes: number[] = [];
  for (const s of spans) {
    if (s.fontSize > 0) {
      const weight = Math.max(1, Math.min(20, Math.round(s.text.length / 8)));
      for (let i = 0; i < weight; i++) {
        sizes.push(s.fontSize);
      }
    }
  }
  if (sizes.length === 0) return 10.5;
  sizes.sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length * 0.45)];
}

/**
 * Classifies a span's heading level (1..6) or undefined if it is body text.
 */
function classifyHeadingLevel(
  span: EditableTextSpan,
  bodyFontSize: number
): 1 | 2 | 3 | 4 | 5 | 6 | undefined {
  const text = span.text.trim();
  if (text.length === 0 || text.length > 180) return undefined;
  // Ignore running footer page counters like "Page 1 of 3"
  if (/^(page|slide)\s+\d+\s+of\s+\d+$/i.test(text)) return undefined;

  const ratio = span.fontSize / Math.max(8, bodyFontSize);
  const isBold =
    span.fontWeight === 'bold' ||
    span.fontWeight === '700' ||
    (span.rawFontFamily ?? '').toLowerCase().includes('bold');

  if (ratio >= 1.75 || span.fontSize >= 20) return 1;
  if (ratio >= 1.42 || span.fontSize >= 15.5) return 2;
  if (ratio >= 1.2 || span.fontSize >= 13) return 3;
  if (isBold && ratio >= 1.05 && (!span.lines || span.lines.length <= 2)) return 4;
  return undefined;
}

/**
 * Checks whether a line or span starts with a bullet or numbered list prefix.
 */
function parseListPrefix(
  rawText: string,
  hasBulletFlag?: boolean
): { ordered: boolean; cleanText: string } | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const bulletMatch = trimmed.match(/^(?:[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\u25CB]|[-*])\s+(.+)$/s);
  if (bulletMatch) {
    return { ordered: false, cleanText: bulletMatch[1].trim() };
  }

  const orderedMatch = trimmed.match(/^(?:\d+[.)]|\([a-zA-Z0-9]+\)|[a-zA-Z][.)])\s+(.+)$/s);
  if (orderedMatch) {
    return { ordered: true, cleanText: orderedMatch[1].trim() };
  }

  if (hasBulletFlag) {
    return { ordered: false, cleanText: trimmed.replace(/^[\u2022\-*]\s*/, '') };
  }

  return null;
}

/**
 * Infers horizontal alignment (left, centre, right) from span position on the page.
 */
function inferAlignment(
  span: EditableTextSpan,
  pageWidthPts: number
): BlockAlignment {
  if (span.textAlign === 'center' || span.textAlign === 'right') {
    return span.textAlign;
  }
  const margin = 48;
  const centerDiff = Math.abs(span.left + span.width / 2 - pageWidthPts / 2);
  if (span.width < pageWidthPts * 0.7 && centerDiff <= 18 && span.left > margin + 24) {
    return 'center';
  }
  return 'left';
}

/**
 * Extracts structured content from a single PDF page and its canvas overlay elements.
 */
export function extractPageStructure(
  doc: PdfDocument,
  pageIndex: number,
  canvasElements: readonly CanvasElement[] = []
): ExtractedPageStructure {
  const page = doc.getPage(pageIndex);
  const { widthPts, heightPts } = page.getDimensions();
  const nativeSpans = page.extractTextSpans();
  const { images: nativeImages, shapes: nativeShapes } = page.extractObjects();

  // Merge visible canvas text elements on this page
  const pageCanvasTextSpans: EditableTextSpan[] = canvasElements
    .filter(
      (el): el is TextElement =>
        el.pageIndex === pageIndex && el.kind === 'text' && el.visible !== false
    )
    .map(canvasTextElementToSpan);

  const allSpans = [...nativeSpans, ...pageCanvasTextSpans].filter(
    (s) => s.text && s.text.trim().length > 0
  );

  // Sort spans top-to-bottom, left-to-right
  allSpans.sort((a, b) => {
    if (Math.abs(a.top - b.top) <= Math.max(a.fontSize, b.fontSize) * 0.6) {
      return a.left - b.left;
    }
    return a.top - b.top;
  });

  // Extract images from native PDF image spans and canvas image elements
  const extractedImages: ExtractedImageItem[] = [];
  const rawImageSources: EditableImageSpan[] = [
    ...nativeImages,
    ...canvasElements
      .filter(
        (el): el is ImageElement =>
          el.pageIndex === pageIndex && el.kind === 'image' && el.visible !== false
      )
      .map(
        (el, i): EditableImageSpan => ({
          type: 'image',
          id: el.id,
          pageIndex,
          left: el.x,
          top: el.y,
          width: el.width,
          height: el.height,
          rotation: el.rotation ?? 0,
          flipX: el.flipX ?? false,
          flipY: el.flipY ?? false,
          src: el.src,
          pdfObjectIndex: 10000 + i,
        })
      ),
  ];

  for (const imgSpan of rawImageSources) {
    const decoded = decodeDataUrlToBytes(imgSpan.src);
    if (!decoded || decoded.data.byteLength === 0) continue;
    extractedImages.push({
      id: imgSpan.id,
      data: decoded.data,
      mimeType: decoded.mimeType,
      extension: decoded.extension,
      left: imgSpan.left,
      top: imgSpan.top,
      width: Math.max(16, imgSpan.width),
      height: Math.max(16, imgSpan.height),
    });
  }

  // Detect spatial tables
  const { tables, consumedSpanIds } = detectSpatialTables(allSpans, nativeShapes);

  const bodyFontSize = computeBodyFontSize(allSpans);
  const blocks: ExtractedPageBlock[] = [];
  const positionedTextBoxes: PositionedTextBox[] = [];

  // Build non-table semantic blocks
  let activeList: {
    ordered: boolean;
    items: ExtractedListItem[];
    top: number;
    left: number;
    right: number;
    bottom: number;
  } | null = null;

  let activeCode: {
    lines: string[];
    top: number;
    left: number;
    right: number;
    bottom: number;
  } | null = null;

  function flushActiveList(): void {
    if (activeList && activeList.items.length > 0) {
      blocks.push({
        kind: 'list',
        ordered: activeList.ordered,
        items: activeList.items,
        top: activeList.top,
        left: activeList.left,
        width: Math.max(40, activeList.right - activeList.left),
        height: Math.max(14, activeList.bottom - activeList.top),
      });
      activeList = null;
    }
  }

  function flushActiveCode(): void {
    if (activeCode && activeCode.lines.length > 0) {
      blocks.push({
        kind: 'code',
        code: activeCode.lines.join('\n'),
        top: activeCode.top,
        left: activeCode.left,
        width: Math.max(80, activeCode.right - activeCode.left),
        height: Math.max(16, activeCode.bottom - activeCode.top),
      });
      activeCode = null;
    }
  }

  for (const span of allSpans) {
    const trimmedText = span.text.trim();
    if (!trimmedText) continue;

    // Skip running page numbers at very bottom/top margins
    if (
      /^(page|slide)\s+\d+\s+of\s+\d+$/i.test(trimmedText) &&
      (span.top > heightPts - 55 || span.top < 45)
    ) {
      continue;
    }

    const runs = extractRunsFromSpan(span);
    const headingLevel = classifyHeadingLevel(span, bodyFontSize);
    const listPrefix = parseListPrefix(trimmedText, span.hasBulletPrefix);
    const align = inferAlignment(span, widthPts);

    positionedTextBoxes.push({
      id: span.id,
      left: span.left,
      top: span.top,
      width: Math.max(24, span.width),
      height: Math.max(12, span.height),
      text: trimmedText,
      runs,
      fontSize: span.fontSize || bodyFontSize,
      isHeading: headingLevel !== undefined,
      headingLevel,
      isList: listPrefix !== null,
      align,
    });

    if (consumedSpanIds.has(span.id)) {
      continue;
    }

    const isMono = isMonospaceFont(span.fontFamily, span.rawFontFamily);
    if (isMono && !headingLevel && !listPrefix) {
      flushActiveList();
      const spanLines =
        span.lines && span.lines.length > 0
          ? span.lines.map((l) => l.text)
          : trimmedText.split('\n');
      if (activeCode && span.top - activeCode.bottom <= 24) {
        activeCode.lines.push(...spanLines);
        activeCode.right = Math.max(activeCode.right, span.left + span.width);
        activeCode.bottom = Math.max(activeCode.bottom, span.top + span.height);
      } else {
        flushActiveCode();
        activeCode = {
          lines: [...spanLines],
          top: span.top,
          left: span.left,
          right: span.left + span.width,
          bottom: span.top + span.height,
        };
      }
      continue;
    }

    flushActiveCode();

    if (headingLevel !== undefined) {
      flushActiveList();
      blocks.push({
        kind: 'heading',
        level: headingLevel,
        text: trimmedText,
        runs,
        align,
        top: span.top,
        left: span.left,
        width: Math.max(40, span.width),
        height: Math.max(14, span.height),
        fontSize: span.fontSize || bodyFontSize,
      });
      continue;
    }

    if (listPrefix) {
      const cleanRuns: StyledRun[] = [
        {
          text: listPrefix.cleanText,
          style: runs[0]?.style,
        },
      ];
      const indentLevel = Math.max(0, Math.min(4, Math.floor((span.left - 54) / 20)));
      if (activeList && activeList.ordered === listPrefix.ordered) {
        activeList.items.push({
          text: listPrefix.cleanText,
          runs: cleanRuns,
          indentLevel,
        });
        activeList.right = Math.max(activeList.right, span.left + span.width);
        activeList.bottom = Math.max(activeList.bottom, span.top + span.height);
      } else {
        flushActiveList();
        activeList = {
          ordered: listPrefix.ordered,
          items: [
            {
              text: listPrefix.cleanText,
              runs: cleanRuns,
              indentLevel,
            },
          ],
          top: span.top,
          left: span.left,
          right: span.left + span.width,
          bottom: span.top + span.height,
        };
      }
      continue;
    }

    flushActiveList();
    blocks.push({
      kind: 'paragraph',
      text: trimmedText,
      runs,
      align,
      top: span.top,
      left: span.left,
      width: Math.max(40, span.width),
      height: Math.max(12, span.height),
      fontSize: span.fontSize || bodyFontSize,
    });
  }

  flushActiveList();
  flushActiveCode();

  // Add reconstructed tables and images into the page block stream sorted by vertical top coordinate
  for (const tbl of tables) {
    blocks.push(tbl);
  }
  for (const img of extractedImages) {
    blocks.push({
      kind: 'image',
      image: img,
      top: img.top,
      left: img.left,
      width: img.width,
      height: img.height,
    });
  }

  blocks.sort((a, b) => {
    if (Math.abs(a.top - b.top) <= 6) {
      return a.left - b.left;
    }
    return a.top - b.top;
  });

  return {
    pageIndex,
    widthPts,
    heightPts,
    blocks,
    tables,
    images: extractedImages,
    positionedTextBoxes,
  };
}

/**
 * Extracts structured content across all pages of a PdfDocument.
 */
export function extractStructuredDocument(
  doc: PdfDocument,
  canvasElements: readonly CanvasElement[] = [],
  fallbackTitle: string = 'Document'
): ExtractedDocumentStructure {
  const pageCount = doc.getPageCount();
  const pages: ExtractedPageStructure[] = [];

  for (let i = 0; i < pageCount; i++) {
    pages.push(extractPageStructure(doc, i, canvasElements));
  }

  let title = fallbackTitle;
  try {
    const meta = doc.getMetadata();
    if (meta.title && meta.title.trim().length > 0) {
      title = meta.title.trim();
    } else {
      const firstHeading = pages[0]?.blocks.find(
        (b): b is ExtractedHeadingBlock => b.kind === 'heading' && b.level === 1
      );
      if (firstHeading && firstHeading.text.trim().length > 0) {
        title = firstHeading.text.trim();
      }
    }
  } catch {
    // note: fallback to provided title when metadata lookup is unavailable
  }

  return {
    title,
    pages,
  };
}

/**
 * Extracts structured content directly from an ExportContext.
 */
export function extractStructuredDocumentFromContext(
  ctx: ExportContext
): ExtractedDocumentStructure {
  const baseName = ctx.editorStore.fileName.replace(/\.pdf$/i, '') || 'document';
  return extractStructuredDocument(ctx.service.document, ctx.canvasElements, baseName);
}
