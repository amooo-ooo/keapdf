/**
 * Unified PDF layout engine built on pdf-lib.
 * Handles top-down cursor coordinates, font metrics, word-wrapping,
 * multi-page table flow with repeating headers, slide canvas geometries,
 * and two-pass header/footer decoration with page numbers.
 */

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
  type RGB,
} from 'pdf-lib';
import type {
  DocumentConversionOptions,
  DocumentMargins,
  FlowDocument,
  GridDocument,
  SlideDocument,
  ParagraphBlock,
  HeadingBlock,
  ListBlock,
  CodeBlock,
  QuoteBlock,
  TableBlock,
  ImageBlock,
  StyledRun,
  TextStyle,
  PageDimensions,
  PageSizePreset,
} from './types';

export const STANDARD_PAGE_SIZES: Record<PageSizePreset, PageDimensions> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612.0, height: 792.0 },
  legal: { width: 612.0, height: 1008.0 },
  slide_16_9: { width: 960.0, height: 540.0 },
  slide_4_3: { width: 720.0, height: 540.0 },
  custom: { width: 595.28, height: 841.89 },
};

const DEFAULT_MARGINS: DocumentMargins = {
  top: 54,
  right: 54,
  bottom: 54,
  left: 54,
};

/**
 * Parses a hex color string (#RRGGBB, #RGB) into a pdf-lib RGB color.
 */
export function parseColor(hex?: string, fallback: RGB = rgb(0.1, 0.1, 0.1)): RGB {
  if (!hex) return fallback;
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    return isNaN(r) || isNaN(g) || isNaN(b) ? fallback : rgb(r, g, b);
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    return isNaN(r) || isNaN(g) || isNaN(b) ? fallback : rgb(r, g, b);
  }
  return fallback;
}

interface FontSet {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly italic: PDFFont;
  readonly boldItalic: PDFFont;
  readonly mono: PDFFont;
  readonly monoBold: PDFFont;
}

/**
 * Font manager that embeds standard PDF fonts into a PDFDocument.
 */
async function loadFontSet(doc: PDFDocument, family: 'helvetica' | 'times' | 'courier' = 'helvetica'): Promise<FontSet> {
  const mono = await doc.embedFont(StandardFonts.Courier);
  const monoBold = await doc.embedFont(StandardFonts.CourierBold);

  if (family === 'times') {
    return {
      regular: await doc.embedFont(StandardFonts.TimesRoman),
      bold: await doc.embedFont(StandardFonts.TimesRomanBold),
      italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
      boldItalic: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
      mono,
      monoBold,
    };
  }

  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    mono,
    monoBold,
  };
}

/**
 * Resolves the appropriate PDFFont for a given text style.
 */
function resolveFontForStyle(fonts: FontSet, style?: TextStyle): PDFFont {
  if (style?.fontFamily === 'courier') {
    return style.bold ? fonts.monoBold : fonts.mono;
  }
  if (style?.bold && style?.italic) {
    return fonts.boldItalic;
  }
  if (style?.bold) {
    return fonts.bold;
  }
  if (style?.italic) {
    return fonts.italic;
  }
  return fonts.regular;
}

interface LayoutContext {
  readonly doc: PDFDocument;
  readonly fonts: FontSet;
  readonly options: DocumentConversionOptions;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly margins: DocumentMargins;
  readonly printableWidth: number;
  readonly printableHeight: number;
  pages: PDFPage[];
  activePage: PDFPage;
  cursorY: number;
}

/**
 * Resolves page dimensions based on options and orientation.
 */
export function resolveDimensions(options?: DocumentConversionOptions): PageDimensions {
  const preset = options?.pageSize ?? 'a4';
  let dims = options?.customDimensions ?? STANDARD_PAGE_SIZES[preset] ?? STANDARD_PAGE_SIZES.a4;

  const orientation = options?.orientation ?? 'auto';
  if (orientation === 'landscape' && dims.width < dims.height) {
    dims = { width: dims.height, height: dims.width };
  } else if (orientation === 'portrait' && dims.width > dims.height) {
    dims = { width: dims.height, height: dims.width };
  }

  return dims;
}

/**
 * Creates an execution layout context.
 */
async function createLayoutContext(
  doc: PDFDocument,
  options?: DocumentConversionOptions,
  overrideDims?: PageDimensions
): Promise<LayoutContext> {
  const dims = overrideDims ?? resolveDimensions(options);
  const margins = options?.margins ?? DEFAULT_MARGINS;
  const fonts = await loadFontSet(doc, options?.fontFamily ?? 'helvetica');

  const printableWidth = Math.max(100, dims.width - margins.left - margins.right);
  const printableHeight = Math.max(100, dims.height - margins.top - margins.bottom);

  const initialPage = doc.addPage([dims.width, dims.height]);
  const pages = [initialPage];

  return {
    doc,
    fonts,
    options: options ?? {},
    pageWidth: dims.width,
    pageHeight: dims.height,
    margins,
    printableWidth,
    printableHeight,
    pages,
    activePage: initialPage,
    cursorY: margins.top,
  };
}

/**
 * Triggers a page break in the layout context.
 */
function breakPage(ctx: LayoutContext): void {
  const newPage = ctx.doc.addPage([ctx.pageWidth, ctx.pageHeight]);
  ctx.pages.push(newPage);
  ctx.activePage = newPage;
  ctx.cursorY = ctx.margins.top;
}

/**
 * Ensures enough vertical room exists on the current page, breaking if needed.
 */
function ensureVerticalSpace(ctx: LayoutContext, requiredHeight: number): void {
  if (ctx.cursorY + requiredHeight > ctx.pageHeight - ctx.margins.bottom) {
    breakPage(ctx);
  }
}

/**
 * Tokenizes text into words and whitespace.
 */
function splitIntoWords(text: string): string[] {
  return text.match(/\S+|\s+/g) ?? [];
}

interface WrappedTextLine {
  readonly segments: Array<{
    readonly text: string;
    readonly font: PDFFont;
    readonly size: number;
    readonly color: RGB;
    readonly width: number;
  }>;
  readonly width: number;
  readonly height: number;
}

/**
 * Wraps a collection of styled runs across lines to fit within a given maximum width.
 */
function wrapRunsToLines(
  runs: readonly StyledRun[],
  fonts: FontSet,
  maxWidth: number,
  defaultSize: number,
  defaultColor: RGB = rgb(0.1, 0.1, 0.1)
): WrappedTextLine[] {
  const lines: WrappedTextLine[] = [];
  let currentSegments: WrappedTextLine['segments'] = [];
  let currentLineWidth = 0;
  let currentMaxHeight = defaultSize * 1.3;

  for (const run of runs) {
    const font = resolveFontForStyle(fonts, run.style);
    const size = run.style?.fontSize ?? defaultSize;
    const color = parseColor(run.style?.fontColor, defaultColor);
    const words = splitIntoWords(run.text);

    for (const word of words) {
      if (word === '\n') {
        lines.push({
          segments: currentSegments,
          width: currentLineWidth,
          height: currentMaxHeight,
        });
        currentSegments = [];
        currentLineWidth = 0;
        currentMaxHeight = defaultSize * 1.3;
        continue;
      }

      const wordWidth = font.widthOfTextAtSize(word, size);
      const wordHeight = size * 1.3;

      if (currentLineWidth + wordWidth <= maxWidth || currentSegments.length === 0) {
        currentSegments.push({
          text: word,
          font,
          size,
          color,
          width: wordWidth,
        });
        currentLineWidth += wordWidth;
        if (wordHeight > currentMaxHeight) currentMaxHeight = wordHeight;
      } else {
        // Line full: flush and wrap
        lines.push({
          segments: currentSegments,
          width: currentLineWidth,
          height: currentMaxHeight,
        });
        currentSegments = [];
        currentLineWidth = 0;
        currentMaxHeight = defaultSize * 1.3;

        // Skip leading whitespace on wrapped new line
        if (!/^\s+$/.test(word)) {
          currentSegments.push({
            text: word,
            font,
            size,
            color,
            width: wordWidth,
          });
          currentLineWidth = wordWidth;
          if (wordHeight > currentMaxHeight) currentMaxHeight = wordHeight;
        }
      }
    }
  }

  if (currentSegments.length > 0) {
    lines.push({
      segments: currentSegments,
      width: currentLineWidth,
      height: currentMaxHeight,
    });
  }

  return lines;
}

/**
 * Renders a wrapped line at the given top-down cursor position.
 */
function drawWrappedLine(
  page: PDFPage,
  pageHeight: number,
  line: WrappedTextLine,
  startX: number,
  cursorY: number,
  align: 'left' | 'center' | 'right' | 'justify' = 'left',
  containerWidth: number = line.width
): void {
  let xOffset = 0;
  if (align === 'center') {
    xOffset = Math.max(0, (containerWidth - line.width) / 2);
  } else if (align === 'right') {
    xOffset = Math.max(0, containerWidth - line.width);
  }

  let curX = startX + xOffset;
  const baselineY = pageHeight - cursorY - line.height * 0.8;

  for (const seg of line.segments) {
    page.drawText(seg.text, {
      x: curX,
      y: baselineY,
      size: seg.size,
      font: seg.font,
      color: seg.color,
    });
    curX += seg.width;
  }
}

/**
 * Renders a paragraph block into the layout context.
 */
function renderParagraph(ctx: LayoutContext, block: ParagraphBlock): void {
  const defaultSize = ctx.options.fontSize ?? 10.5;
  const lines = wrapRunsToLines(
    block.runs,
    ctx.fonts,
    ctx.printableWidth,
    defaultSize
  );

  const spaceBefore = block.spaceBefore ?? 0;
  const spaceAfter = block.spaceAfter ?? 6;

  if (spaceBefore > 0) {
    ctx.cursorY += spaceBefore;
  }

  for (const line of lines) {
    ensureVerticalSpace(ctx, line.height);
    drawWrappedLine(
      ctx.activePage,
      ctx.pageHeight,
      line,
      ctx.margins.left,
      ctx.cursorY,
      block.align === 'center' ? 'center' : block.align === 'right' ? 'right' : 'left',
      ctx.printableWidth
    );
    ctx.cursorY += line.height;
  }

  ctx.cursorY += spaceAfter;
}

