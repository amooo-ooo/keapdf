/**
 * Unified PDF layout engine built on pdf-lib.
 * Handles top-down cursor coordinates, font metrics, word-wrapping,
 * multi-page table flow with repeating headers, slide canvas geometries,
 * and two-pass header/footer decoration with page numbers.
 */

import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  PDFString,
  StandardFonts,
  rgb,
  type RGB,
} from 'pdf-lib';
import { normalizePngBytesForEmbed } from '../pdf/operations/annotation-extract-ops';
import type {
  DocumentConversionOptions,
  DocumentMargins,
  FlowDocument,
  GridDocument,
  SlideDocument,
  ParagraphBlock,
  HeadingBlock,
  ListBlock,
  ListItem,
  CodeBlock,
  QuoteBlock,
  AlertBlock,
  AlertType,
  DiagramBlock,
  MathBlock,
  TableBlock,
  ImageBlock,
  StyledRun,
  TextStyle,
  PageDimensions,
  PageSizePreset,
} from './types';
import { sanitizeTextForWinAnsi, safeWidthOfText } from './winansi-sanitizer';
import { measureDiagramBlock, renderMermaidVectorDiagram } from './diagram-renderer';
import { formatLatexFormula, layoutMathBlock, renderMathBlock } from './math-renderer';
import { buildOutlineTree, type OutlineItemFlat } from '../pdf/operations/outline-tree';
import { writeOutlinesToPdf } from '../pdf/operations/outline-ops';

export const STANDARD_PAGE_SIZES: Record<PageSizePreset, PageDimensions> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612.0, height: 792.0 },
  legal: { width: 612.0, height: 1008.0 },
  slide_16_9: { width: 960.0, height: 540.0 },
  slide_4_3: { width: 720.0, height: 540.0 },
  custom: { width: 595.28, height: 841.89 },
};

/**
 * Conventional standard page margins (0.50 in / 12.7 mm / 36 pt) for Markdown, HTML, and document conversion.
 */
export const DEFAULT_MARGINS: DocumentMargins = {
  top: 36,
  right: 36,
  bottom: 36,
  left: 36,
};

/**
 * Conventional compact page margins for wide tabular spreadsheets (0.50 in vertical, 0.40 in / 10 mm horizontal).
 */
export const DEFAULT_SPREADSHEET_MARGINS: DocumentMargins = {
  top: 36,
  right: 28,
  bottom: 36,
  left: 28,
};

/**
 * Exact GitHub Markdown and industry standard colour palette tokens.
 */
export const GFM_COLOURS = {
  text: rgb(0.122, 0.137, 0.157), // #1F2328 primary text
  slateText: rgb(0.118, 0.161, 0.231), // #1E293B spreadsheet/code text
  muted: rgb(0.349, 0.388, 0.431), // #59636E muted secondary text
  border: rgb(0.816, 0.843, 0.871), // #D0D7DE standard dividing border
  subtleBorder: rgb(0.886, 0.910, 0.941), // #E2E8F0 light gridline
  subtleBg: rgb(0.965, 0.973, 0.980), // #F6F8FA surface/zebra/code background
  spreadsheetHeaderBg: rgb(0.945, 0.961, 0.976), // #F1F5F9 slate header fill
  spreadsheetZebraBg: rgb(0.973, 0.980, 0.988), // #F8FAFC spreadsheet alternating fill
  link: rgb(0.035, 0.412, 0.855), // #0969DA accent link/checkbox fill
  gutterText: rgb(0.392, 0.455, 0.545), // #64748B code gutter numbers
  gutterBorder: rgb(0.882, 0.894, 0.910), // #E1E4E8 gutter separator
  codeHeaderBg: rgb(0.918, 0.933, 0.949), // #EAEEF2 code language banner fill
} as const;

export const GFM_COLORS = GFM_COLOURS;

/**
 * GitHub Markdown Alert / Callout configuration adhering to Primer design tokens.
 */
export const ALERT_CONFIGS: Record<AlertType, { border: RGB; bg: RGB; defaultTitle: string }> = {
  note: {
    border: rgb(0.035, 0.412, 0.855), // #0969DA
    bg: rgb(0.941, 0.965, 0.988), // #F0F6FC
    defaultTitle: 'Note',
  },
  tip: {
    border: rgb(0.102, 0.498, 0.216), // #1A7F37
    bg: rgb(0.953, 0.984, 0.961), // #DAFBE1
    defaultTitle: 'Tip',
  },
  important: {
    border: rgb(0.510, 0.314, 0.875), // #8250DF
    bg: rgb(0.984, 0.941, 1.0), // #FBF0FF
    defaultTitle: 'Important',
  },
  warning: {
    border: rgb(0.604, 0.404, 0.0), // #9A6700
    bg: rgb(1.0, 0.973, 0.871), // #FFF8C5
    defaultTitle: 'Warning',
  },
  caution: {
    border: rgb(0.812, 0.133, 0.180), // #CF222E
    bg: rgb(1.0, 0.922, 0.914), // #FFEBE9
    defaultTitle: 'Caution',
  },
};

/**
 * Parses a hex colour string (#RRGGBB, #RGB, #RRGGBBAA) into a pdf-lib RGB colour.
 */
export function parseColor(hex?: string, fallback: RGB = rgb(0.1, 0.1, 0.1)): RGB {
  if (!hex) return fallback;
  let clean = hex.replace('#', '').trim();
  if (clean.length === 8) {
    clean = clean.slice(0, 6);
  }
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

export const parseColour = parseColor;

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
async function loadFontSet(
  doc: PDFDocument,
  family: 'helvetica' | 'times' | 'courier' = 'helvetica'
): Promise<FontSet> {
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

  if (family === 'courier') {
    return {
      regular: mono,
      bold: monoBold,
      italic: await doc.embedFont(StandardFonts.CourierOblique),
      boldItalic: await doc.embedFont(StandardFonts.CourierBoldOblique),
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
  outlineItems?: OutlineItemFlat[];
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
    outlineItems: [],
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
 * Prevents redundant breaks if cursor is already at top of page.
 */
function ensureVerticalSpace(ctx: LayoutContext, requiredHeight: number): void {
  if (
    ctx.cursorY > ctx.margins.top &&
    ctx.cursorY + requiredHeight > ctx.pageHeight - ctx.margins.bottom
  ) {
    breakPage(ctx);
  }
}

/**
 * Tokenises text into words, whitespace, and single newlines.
 * Sanitises input against WinAnsi limitations and normalises line breaks.
 */
function splitIntoWords(text: string): string[] {
  const clean = sanitizeTextForWinAnsi(text).replace(/\r\n|\r/g, '\n');
  return clean.match(/\n|\S+|\t|[ ]+/g) ?? [];
}

interface WrappedTextLine {
  readonly segments: Array<{
    readonly text: string;
    readonly font: PDFFont;
    readonly size: number;
    readonly color: RGB;
    readonly width: number;
    readonly isWhitespace?: boolean;
    readonly link?: string;
    readonly underline?: boolean;
    readonly strike?: boolean;
  }>;
  readonly width: number;
  readonly height: number;
}

/**
 * Splits a single oversized word into smaller chunks fitting maxWidth.
 */
function breakOversizedWord(
  word: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  for (let i = 0; i < word.length; i++) {
    const candidate = currentChunk + word[i];
    if (safeWidthOfText(font, candidate, size) <= maxWidth || currentChunk.length === 0) {
      currentChunk = candidate;
    } else {
      chunks.push(currentChunk);
      currentChunk = word[i];
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Wraps a collection of styled runs across lines to fit within a given maximum width.
 */
function wrapRunsToLines(
  runs: readonly StyledRun[],
  fonts: FontSet,
  maxWidth: number,
  defaultSize: number,
  defaultColor: RGB = GFM_COLOURS.text
): WrappedTextLine[] {
  const lines: WrappedTextLine[] = [];
  let currentSegments: WrappedTextLine['segments'] = [];
  let currentLineWidth = 0;
  let currentMaxHeight = defaultSize * 1.3;

  function flushCurrentLine(): void {
    lines.push({
      segments: currentSegments,
      width: currentLineWidth,
      height: currentMaxHeight,
    });
    currentSegments = [];
    currentLineWidth = 0;
    currentMaxHeight = defaultSize * 1.3;
  }

  for (const run of runs) {
    const font = resolveFontForStyle(fonts, run.style);
    const size = run.style?.fontSize ?? defaultSize;
    const color = parseColor(run.style?.fontColor, defaultColor);
    const link = run.link;
    const underline = Boolean(run.style?.underline || run.link);
    const strike = Boolean(run.style?.strike);
    const rawText = run.style?.math ? formatLatexFormula(run.text) : run.text;
    const words = splitIntoWords(rawText);

    for (const word of words) {
      if (word === '\n') {
        flushCurrentLine();
        continue;
      }

      const isSpace = /^\s+$/.test(word);
      const wordWidth = safeWidthOfText(font, word, size);
      const wordHeight = size * 1.3;

      // Check if word alone exceeds maxWidth and needs character-level splitting
      if (!isSpace && wordWidth > maxWidth && currentSegments.length === 0) {
        const subChunks = breakOversizedWord(word, font, size, maxWidth);
        for (let cIdx = 0; cIdx < subChunks.length; cIdx++) {
          const chunk = subChunks[cIdx];
          const chunkWidth = safeWidthOfText(font, chunk, size);
          if (cIdx < subChunks.length - 1) {
            lines.push({
              segments: [{ text: chunk, font, size, color, width: chunkWidth, link, underline, strike }],
              width: chunkWidth,
              height: wordHeight,
            });
          } else {
            currentSegments.push({ text: chunk, font, size, color, width: chunkWidth, link, underline, strike });
            currentLineWidth = chunkWidth;
            currentMaxHeight = wordHeight;
          }
        }
        continue;
      }

      if (currentLineWidth + wordWidth <= maxWidth || currentSegments.length === 0) {
        currentSegments.push({
          text: word,
          font,
          size,
          color,
          width: wordWidth,
          isWhitespace: isSpace,
          link,
          underline,
          strike,
        });
        currentLineWidth += wordWidth;
        if (wordHeight > currentMaxHeight) currentMaxHeight = wordHeight;
      } else {
        // Line full: flush and start new line
        flushCurrentLine();

        // Skip leading whitespace on wrapped new line
        if (!isSpace) {
          currentSegments.push({
            text: word,
            font,
            size,
            color,
            width: wordWidth,
            isWhitespace: false,
            link,
            underline,
            strike,
          });
          currentLineWidth = wordWidth;
          if (wordHeight > currentMaxHeight) currentMaxHeight = wordHeight;
        }
      }
    }
  }

  if (currentSegments.length > 0) {
    flushCurrentLine();
  }

  return lines;
}

/**
 * Renders a wrapped line at the given top-down cursor position.
 * Trims trailing whitespace width for exact horizontal alignment and registers PDF URI link annotations.
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
  // Compute line width excluding trailing whitespace
  let contentWidth = line.width;
  for (let i = line.segments.length - 1; i >= 0; i--) {
    if (line.segments[i].isWhitespace) {
      contentWidth -= line.segments[i].width;
    } else {
      break;
    }
  }

  let xOffset = 0;
  if (align === 'center') {
    xOffset = Math.max(0, (containerWidth - contentWidth) / 2);
  } else if (align === 'right') {
    xOffset = Math.max(0, containerWidth - contentWidth);
  }

  let curX = startX + xOffset;
  const baselineY = pageHeight - cursorY - line.height * 0.8;

  for (const seg of line.segments) {
    const textToDraw = sanitizeTextForWinAnsi(seg.text);
    if (textToDraw.length > 0) {
      page.drawText(textToDraw, {
        x: curX,
        y: baselineY,
        size: seg.size,
        font: seg.font,
        color: seg.color,
      });

      if (!seg.isWhitespace) {
        if (seg.underline) {
          page.drawLine({
            start: { x: curX, y: baselineY - 1.5 },
            end: { x: curX + seg.width, y: baselineY - 1.5 },
            thickness: 0.6,
            color: seg.color,
          });
        }

        if (seg.strike) {
          page.drawLine({
            start: { x: curX, y: baselineY + seg.size * 0.32 },
            end: { x: curX + seg.width, y: baselineY + seg.size * 0.32 },
            thickness: 0.6,
            color: seg.color,
          });
        }

        if (seg.link) {
          const action = page.doc.context.obj({
            Type: 'Action',
            S: 'URI',
            URI: PDFString.of(seg.link),
          });
          const annot = page.doc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [curX, baselineY - 2, curX + seg.width, baselineY + seg.size + 2],
            Border: [0, 0, 0],
            A: action,
          });
          page.node.addAnnot(page.doc.context.register(annot));
        }
      }
    }
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
    defaultSize,
    GFM_COLOURS.text
  );

  const spaceBefore = block.spaceBefore ?? 0;
  const spaceAfter = block.spaceAfter ?? 8;

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

/**
 * Renders a heading block into the layout context adhering strictly to GitHub Markdown typography hierarchy.
 * Levels 1 and 2 feature iconic full-width bottom dividing borders.
 */
function renderHeading(ctx: LayoutContext, block: HeadingBlock): void {
  const levelConfigs: Record<
    number,
    { size: number; before: number; after: number; color: RGB; hasBottomRule?: boolean }
  > = {
    1: { size: 22, before: 24, after: 12, color: GFM_COLOURS.text, hasBottomRule: true },
    2: { size: 16.5, before: 20, after: 10, color: GFM_COLOURS.text, hasBottomRule: true },
    3: { size: 13.5, before: 16, after: 6, color: GFM_COLOURS.text },
    4: { size: 11, before: 12, after: 4, color: GFM_COLOURS.text },
    5: { size: 9.5, before: 10, after: 4, color: GFM_COLOURS.text },
    6: { size: 8.5, before: 8, after: 4, color: GFM_COLOURS.muted },
  };

  const config = levelConfigs[block.level] ?? levelConfigs[1];
  const runs: readonly StyledRun[] =
    block.runs && block.runs.length > 0
      ? block.runs.map((r) => ({
          ...r,
          text: sanitizeTextForWinAnsi(r.text),
          style: {
            bold: true,
            fontSize: config.size,
            ...r.style,
          },
        }))
      : [
          {
            text: sanitizeTextForWinAnsi(block.text),
            style: {
              bold: true,
              fontSize: config.size,
            },
          },
        ];

  const lines = wrapRunsToLines(
    runs,
    ctx.fonts,
    ctx.printableWidth,
    config.size,
    config.color
  );

  // Keep with next: ensure heading and at least one subsequent line have space
  ensureVerticalSpace(ctx, config.size * 2 + config.before);
  ctx.cursorY += config.before;

  if (lines.length > 0) {
    ensureVerticalSpace(ctx, lines[0].height);
  }

  if (!block.unlisted && block.text.trim().length > 0 && ctx.outlineItems) {
    ctx.outlineItems.push({
      title: sanitizeTextForWinAnsi(block.text.trim()),
      pageIndex: ctx.pages.length - 1,
      level: block.level,
      destY: ctx.pageHeight - ctx.cursorY,
    });
  }

  for (const line of lines) {
    ensureVerticalSpace(ctx, line.height);
    drawWrappedLine(
      ctx.activePage,
      ctx.pageHeight,
      line,
      ctx.margins.left,
      ctx.cursorY,
      block.align ?? 'left',
      ctx.printableWidth
    );
    ctx.cursorY += line.height;
  }

  // Draw GFM full-width bottom border rule for H1 and H2
  if (config.hasBottomRule) {
    ctx.cursorY += 4;
    ensureVerticalSpace(ctx, 4);
    const rulePdfY = ctx.pageHeight - ctx.cursorY;
    ctx.activePage.drawLine({
      start: { x: ctx.margins.left, y: rulePdfY },
      end: { x: ctx.margins.left + ctx.printableWidth, y: rulePdfY },
      thickness: 1.0,
      color: GFM_COLOURS.border,
    });
    ctx.cursorY += 4;
  }

  ctx.cursorY += config.after;
}

/**
 * Renders a bullet, ordered, or GFM task list block into the layout context.
 * GFM task lists render interactive-style vector checkbox glyphs.
 */
function renderList(ctx: LayoutContext, block: ListBlock): void {
  const defaultSize = ctx.options.fontSize ?? 10.5;

  for (let i = 0; i < block.items.length; i++) {
    const rawItem = block.items[i];
    const isTask = typeof rawItem === 'object' && rawItem !== null && 'isTask' in rawItem && Boolean((rawItem as ListItem).isTask);
    const isChecked = typeof rawItem === 'object' && rawItem !== null && 'isChecked' in rawItem && Boolean((rawItem as ListItem).isChecked);
    const indentLevel = (typeof rawItem === 'object' && rawItem !== null && 'indentLevel' in rawItem ? (rawItem as ListItem).indentLevel : block.indentLevel) ?? 0;
    const itemRuns: readonly StyledRun[] = 'runs' in rawItem ? (rawItem as ListItem).runs : (rawItem as readonly StyledRun[]);

    const indentOffset = indentLevel * 16;
    const markerWidth = 16;
    const contentWidth = Math.max(100, ctx.printableWidth - indentOffset - markerWidth);

    const lines = wrapRunsToLines(
      itemRuns,
      ctx.fonts,
      contentWidth,
      defaultSize,
      isChecked ? GFM_COLOURS.muted : GFM_COLOURS.text
    );

    if (lines.length === 0) continue;

    ensureVerticalSpace(ctx, lines[0].height);

    if (isTask) {
      // Draw GFM vector task list checkbox
      const boxSize = 9.5;
      const boxX = ctx.margins.left + indentOffset;
      const boxPdfY = ctx.pageHeight - ctx.cursorY - lines[0].height * 0.8;

      if (isChecked) {
        // Checked state: accent blue filled square with crisp white tick
        ctx.activePage.drawRectangle({
          x: boxX,
          y: boxPdfY,
          width: boxSize,
          height: boxSize,
          color: GFM_COLOURS.link,
        });
        ctx.activePage.drawLine({
          start: { x: boxX + 2, y: boxPdfY + 4.2 },
          end: { x: boxX + 3.8, y: boxPdfY + 2.2 },
          thickness: 1.3,
          color: rgb(1, 1, 1),
        });
        ctx.activePage.drawLine({
          start: { x: boxX + 3.8, y: boxPdfY + 2.2 },
          end: { x: boxX + 7.5, y: boxPdfY + 7.2 },
          thickness: 1.3,
          color: rgb(1, 1, 1),
        });
      } else {
        // Unchecked state: clean white card with subtle border
        ctx.activePage.drawRectangle({
          x: boxX,
          y: boxPdfY,
          width: boxSize,
          height: boxSize,
          color: rgb(1, 1, 1),
          borderColor: GFM_COLOURS.border,
          borderWidth: 1.0,
        });
      }
    } else {
      // Standard bullet or counter
      let bulletText = block.ordered ? `${i + 1}.` : '\u2022';
      if (!block.ordered) {
        if (indentLevel === 1) bulletText = '-';
        else if (indentLevel >= 2) bulletText = '\u2022';
      }

      const bulletPdfY = ctx.pageHeight - ctx.cursorY - lines[0].height * 0.8;
      ctx.activePage.drawText(bulletText, {
        x: ctx.margins.left + indentOffset,
        y: bulletPdfY,
        size: defaultSize,
        font: block.ordered ? ctx.fonts.regular : ctx.fonts.bold,
        color: GFM_COLOURS.text,
      });
    }

    for (const line of lines) {
      ensureVerticalSpace(ctx, line.height);
      drawWrappedLine(
        ctx.activePage,
        ctx.pageHeight,
        line,
        ctx.margins.left + indentOffset + markerWidth,
        ctx.cursorY,
        'left',
        contentWidth
      );
      ctx.cursorY += line.height;
    }

    ctx.cursorY += 3;
  }

  ctx.cursorY += 6;
}

/**
 * Renders a code block into the layout context with syntax background card, language pill, and line numbers.
 * Strictly draws the background card before foreground text to adhere to the PDF painter's algorithm.
 */
function renderCodeBlock(ctx: LayoutContext, block: CodeBlock): void {
  const codeLines = block.code.split('\n');
  const fontSize = 8.5;
  const lineHeight = fontSize * 1.38;
  const padding = 10;
  const digits = Math.max(3, String(codeLines.length).length);
  const lineNumberWidth = block.showLineNumbers !== false ? digits * 7 + 8 : 0;
  const textStartX = ctx.margins.left + padding + lineNumberWidth;
  const contentWidth = Math.max(100, ctx.printableWidth - padding * 2 - lineNumberWidth);

  const headerHeight = block.language ? 18 : 0;
  const totalHeight = codeLines.length * lineHeight + padding * 2 + headerHeight;

  if (totalHeight <= ctx.printableHeight && ctx.cursorY + totalHeight > ctx.pageHeight - ctx.margins.bottom) {
    breakPage(ctx);
  }

  ctx.cursorY += 6;

  // Ensure room for language header and at least one line of code
  if (ctx.cursorY + headerHeight + lineHeight + padding * 2 > ctx.pageHeight - ctx.margins.bottom) {
    breakPage(ctx);
  }

  // Language header banner if specified
  if (block.language) {
    const headerPdfY = ctx.pageHeight - ctx.cursorY - headerHeight;
    ctx.activePage.drawRectangle({
      x: ctx.margins.left,
      y: headerPdfY,
      width: ctx.printableWidth,
      height: headerHeight,
      color: GFM_COLOURS.codeHeaderBg,
      borderColor: GFM_COLOURS.border,
      borderWidth: 0.5,
    });
    ctx.activePage.drawText(sanitizeTextForWinAnsi(block.language.toLowerCase()), {
      x: ctx.margins.left + 10,
      y: headerPdfY + 5,
      size: 7.5,
      font: ctx.fonts.bold,
      color: GFM_COLOURS.muted,
    });
    ctx.cursorY += headerHeight;
  }

  let startIdx = 0;
  while (startIdx < codeLines.length) {
    const pageBottom = ctx.pageHeight - ctx.margins.bottom;
    const availableHeight = pageBottom - ctx.cursorY - padding * 2;
    const maxLinesOnPage = Math.max(1, Math.floor(availableHeight / lineHeight));
    const endIdx = Math.min(codeLines.length, startIdx + maxLinesOnPage);
    const chunkLineCount = endIdx - startIdx;

    const sliceHeight = chunkLineCount * lineHeight + padding * 2;
    const pdfY = ctx.pageHeight - ctx.cursorY - sliceHeight;

    // Draw background card first so foreground code text renders cleanly on top
    ctx.activePage.drawRectangle({
      x: ctx.margins.left,
      y: pdfY,
      width: ctx.printableWidth,
      height: sliceHeight,
      color: GFM_COLOURS.subtleBg,
      borderColor: GFM_COLOURS.border,
      borderWidth: 0.5,
    });

    ctx.cursorY += padding;

    for (let idx = startIdx; idx < endIdx; idx++) {
      if (block.showLineNumbers !== false) {
        const lineNumStr = `${idx + 1}`.padStart(digits, ' ');
        ctx.activePage.drawText(lineNumStr, {
          x: ctx.margins.left + padding,
          y: ctx.pageHeight - ctx.cursorY - lineHeight * 0.8,
          size: fontSize,
          font: ctx.fonts.mono,
          color: GFM_COLOURS.gutterText,
        });

        const gutterRuleX = ctx.margins.left + padding + lineNumberWidth - 4;
        const gutterRulePdfY = ctx.pageHeight - ctx.cursorY - lineHeight;
        ctx.activePage.drawLine({
          start: { x: gutterRuleX, y: gutterRulePdfY },
          end: { x: gutterRuleX, y: gutterRulePdfY + lineHeight },
          thickness: 0.5,
          color: GFM_COLOURS.gutterBorder,
        });
      }

      const rawCode = codeLines[idx];
      const text = sanitizeTextForWinAnsi(rawCode);
      const maxChars = Math.floor(contentWidth / (fontSize * 0.6));
      const truncated = text.length > maxChars ? text.slice(0, maxChars) : text;

      ctx.activePage.drawText(truncated, {
        x: textStartX,
        y: ctx.pageHeight - ctx.cursorY - lineHeight * 0.8,
        size: fontSize,
        font: ctx.fonts.mono,
        color: GFM_COLOURS.text,
      });

      ctx.cursorY += lineHeight;
    }

    ctx.cursorY += padding;
    startIdx = endIdx;

    if (startIdx < codeLines.length) {
      breakPage(ctx);
    }
  }

  ctx.cursorY += 8;
}

/**
 * Renders a blockquote into the layout context with an accent left border and muted text.
 * Adheres to GitHub Markdown 0.25em border-left in #D0D7DE.
 */
function renderQuote(ctx: LayoutContext, block: QuoteBlock): void {
  const fontSize = ctx.options.fontSize ?? 10.5;
  const paddingLeft = 14;
  const contentWidth = ctx.printableWidth - paddingLeft;

  const runs: readonly StyledRun[] =
    block.runs && block.runs.length > 0
      ? block.runs.map((r) => ({
          ...r,
          text: sanitizeTextForWinAnsi(r.text),
          style: {
            italic: true,
            fontSize,
            ...r.style,
          },
        }))
      : [
          {
            text: sanitizeTextForWinAnsi(block.text),
            style: {
              italic: true,
              fontSize,
            },
          },
        ];

  const lines = wrapRunsToLines(runs, ctx.fonts, contentWidth, fontSize, GFM_COLOURS.muted);
  ctx.cursorY += 4;

  for (const line of lines) {
    ensureVerticalSpace(ctx, line.height);

    // Accent line alongside current line
    const pdfBorderY = ctx.pageHeight - ctx.cursorY - line.height;
    ctx.activePage.drawRectangle({
      x: ctx.margins.left,
      y: pdfBorderY,
      width: 3.5,
      height: line.height,
      color: rgb(0.2, 0.45, 0.85),
    });

    drawWrappedLine(
      ctx.activePage,
      ctx.pageHeight,
      line,
      ctx.margins.left + paddingLeft,
      ctx.cursorY,
      'left',
      contentWidth
    );
    ctx.cursorY += line.height;
  }

  ctx.cursorY += 8;
}

/**
 * Renders a horizontal divider line into the layout context.
 */
function renderDivider(ctx: LayoutContext): void {
  ctx.cursorY += 8;
  ensureVerticalSpace(ctx, 4);

  const pdfY = ctx.pageHeight - ctx.cursorY;
  ctx.activePage.drawLine({
    start: { x: ctx.margins.left, y: pdfY },
    end: { x: ctx.margins.left + ctx.printableWidth, y: pdfY },
    thickness: 0.5,
    color: rgb(0.85, 0.88, 0.92),
  });

  ctx.cursorY += 8;
}

/**
 * Renders an image block into the layout context.
 */
async function renderImage(ctx: LayoutContext, block: ImageBlock): Promise<void> {
  let embeddedImage;
  try {
    embeddedImage = block.mimeType.includes('png')
      ? await ctx.doc.embedPng(block.data)
      : await ctx.doc.embedJpg(block.data);
  } catch {
    return;
  }

  const naturalWidth = Math.max(1, block.width ?? embeddedImage.width);
  const naturalHeight = Math.max(1, block.height ?? embeddedImage.height);
  const aspect = naturalWidth / naturalHeight;

  let renderWidth = Math.min(ctx.printableWidth, naturalWidth);
  let renderHeight = renderWidth / aspect;

  if (renderHeight > ctx.printableHeight * 0.6) {
    renderHeight = ctx.printableHeight * 0.6;
    renderWidth = Math.min(ctx.printableWidth, renderHeight * aspect);
  }

  ensureVerticalSpace(ctx, renderHeight + 10);

  const pdfY = ctx.pageHeight - ctx.cursorY - renderHeight;
  const startX = ctx.margins.left + (ctx.printableWidth - renderWidth) / 2;

  ctx.activePage.drawImage(embeddedImage, {
    x: startX,
    y: pdfY,
    width: renderWidth,
    height: renderHeight,
  });

  ctx.cursorY += renderHeight + 8;
}

/**
 * Resolves column widths for a table.
 */
function resolveColumnWidths(
  table: TableBlock,
  printableWidth: number
): number[] {
  const colCount = Math.max(
    ...table.rows.map((r) => r.cells.length),
    1
  );

  if (table.columnWidths && table.columnWidths.length === colCount) {
    const sanitised = table.columnWidths.map((w) => Math.max(1, w));
    const sum = sanitised.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      return sanitised.map((w) => (w / sum) * printableWidth);
    }
  }

  const equalWidth = printableWidth / colCount;
  return Array(colCount).fill(equalWidth);
}

/**
 * Renders a single table row, returning the computed row height.
 */
function drawTableRow(
  ctx: LayoutContext,
  rowCells: TableBlock['rows'][number]['cells'],
  colWidths: number[],
  isHeader: boolean,
  rowIndex: number,
  hasBorders: boolean,
  hasZebra: boolean
): number {
  const isWide = colWidths.length > 10;
  const paddingX = isWide ? 3 : 6;
  const paddingY = isWide ? 3 : 5;
  const fontSize = isHeader ? (isWide ? 7.5 : 9.5) : (ctx.options.fontSize ?? (isWide ? 7 : 9));

  // Measure cell line wraps to determine maximum row height
  const cellWrappedLines = rowCells.map((cell, colIdx) => {
    const colW = colWidths[colIdx] ?? colWidths[colWidths.length - 1] ?? 50;
    const cellInnerW = Math.max(15, colW - paddingX * 2);
    return wrapRunsToLines(
      cell.runs,
      ctx.fonts,
      cellInnerW,
      fontSize,
      isHeader ? rgb(1, 1, 1) : rgb(0.12, 0.15, 0.22)
    );
  });

  const maxContentHeight = Math.max(
    ...cellWrappedLines.map((lines) =>
      lines.reduce((sum, l) => sum + l.height, 0)
    ),
    fontSize * 1.3
  );

  const rowHeight = maxContentHeight + paddingY * 2;

  // Background shading
  let bgColor: RGB | undefined;
  if (isHeader) {
    bgColor = rgb(0.12, 0.16, 0.26); // Dark slate header
  } else if (hasZebra && rowIndex % 2 === 1) {
    bgColor = rgb(0.97, 0.98, 0.995); // Zebra light fill
  }

  const pdfY = ctx.pageHeight - ctx.cursorY - rowHeight;

  if (bgColor) {
    ctx.activePage.drawRectangle({
      x: ctx.margins.left,
      y: pdfY,
      width: ctx.printableWidth,
      height: rowHeight,
      color: bgColor,
    });
  }

  // Draw cells
  let currentX = ctx.margins.left;
  for (let c = 0; c < rowCells.length; c++) {
    const colW = colWidths[c] ?? colWidths[colWidths.length - 1] ?? 50;
    const lines = cellWrappedLines[c];
    let textCursorY = ctx.cursorY + paddingY;

    for (const line of lines) {
      drawWrappedLine(
        ctx.activePage,
        ctx.pageHeight,
        line,
        currentX + paddingX,
        textCursorY,
        rowCells[c]?.align ?? 'left',
        colW - paddingX * 2
      );
      textCursorY += line.height;
    }

    if (hasBorders && !isHeader) {
      // Vertical cell border
      ctx.activePage.drawLine({
        start: { x: currentX + colW, y: pdfY },
        end: { x: currentX + colW, y: pdfY + rowHeight },
        thickness: 0.5,
        color: rgb(0.88, 0.9, 0.93),
      });
    }

    currentX += colW;
  }

  // Horizontal border under row
  if (hasBorders || isHeader) {
    ctx.activePage.drawLine({
      start: { x: ctx.margins.left, y: pdfY },
      end: { x: ctx.margins.left + ctx.printableWidth, y: pdfY },
      thickness: isHeader ? 1.5 : 0.5,
      color: isHeader ? rgb(0.2, 0.45, 0.85) : rgb(0.88, 0.9, 0.93),
    });
  }

  return rowHeight;
}

/**
 * Renders a table block with automatic pagination and repeating headers.
 */
function renderTable(ctx: LayoutContext, table: TableBlock): void {
  if (table.rows.length === 0) return;

  const colWidths = resolveColumnWidths(table, ctx.printableWidth);
  const headerRow = table.rows.find((r) => r.isHeader) ?? table.rows[0];
  const bodyRows = table.rows.filter((r) => r !== headerRow);
  const hasBorders = table.hasBorders !== false;
  const hasZebra = table.hasZebraStriping !== false;

  ctx.cursorY += 6;

  // Render header
  ensureVerticalSpace(ctx, 30);
  const headerH = drawTableRow(ctx, headerRow.cells, colWidths, true, 0, hasBorders, false);
  ctx.cursorY += headerH;

  // Render body rows
  for (let rIdx = 0; rIdx < bodyRows.length; rIdx++) {
    const row = bodyRows[rIdx];
    // Check if row fits; if not, break page and re-render header
    if (ctx.cursorY + 25 > ctx.pageHeight - ctx.margins.bottom) {
      breakPage(ctx);
      const reHeaderH = drawTableRow(ctx, headerRow.cells, colWidths, true, 0, hasBorders, false);
      ctx.cursorY += reHeaderH;
    }

    const rowH = drawTableRow(ctx, row.cells, colWidths, false, rIdx, hasBorders, hasZebra);
    ctx.cursorY += rowH;
  }

  ctx.cursorY += 10;
}

/**
 * Decorates pages with running headers, thin rules, and "Page X of Y" page numbers.
 */
function decorateDocumentPages(ctx: LayoutContext, title?: string): void {
  const totalPages = ctx.pages.length;
  const rawTitle = title ?? ctx.options.title;
  const docTitle = rawTitle ? sanitizeTextForWinAnsi(rawTitle) : undefined;

  for (let i = 0; i < totalPages; i++) {
    const page = ctx.pages[i];

    // Running header on pages > 0 if title is available
    if (i > 0 && docTitle) {
      const headerY = Math.min(ctx.pageHeight - 15, ctx.pageHeight - ctx.margins.top + 15);
      const maxTitleWidth = ctx.printableWidth - 20;
      let displayTitle = docTitle;
      if (safeWidthOfText(ctx.fonts.regular, displayTitle, 8.5) > maxTitleWidth) {
        displayTitle = `${displayTitle.slice(0, 40)}...`;
      }

      page.drawText(displayTitle, {
        x: ctx.margins.left,
        y: headerY,
        size: 8.5,
        font: ctx.fonts.regular,
        color: rgb(0.5, 0.55, 0.65),
      });

      page.drawLine({
        start: { x: ctx.margins.left, y: headerY - 6 },
        end: { x: ctx.pageWidth - ctx.margins.right, y: headerY - 6 },
        thickness: 0.5,
        color: rgb(0.88, 0.9, 0.94),
      });
    }

    // Running footer with page counter if enabled
    if (ctx.options.includePageNumbers !== false) {
      const footerY = Math.max(12, Math.min(ctx.margins.bottom - 20, 24));
      const pageText = `Page ${i + 1} of ${totalPages}`;
      const pageTextWidth = safeWidthOfText(ctx.fonts.regular, pageText, 8.5);

      page.drawLine({
        start: { x: ctx.margins.left, y: footerY + 12 },
        end: { x: ctx.pageWidth - ctx.margins.right, y: footerY + 12 },
        thickness: 0.5,
        color: rgb(0.88, 0.9, 0.94),
      });

      page.drawText(pageText, {
        x: ctx.pageWidth - ctx.margins.right - pageTextWidth,
        y: footerY,
        size: 8.5,
        font: ctx.fonts.regular,
        color: rgb(0.5, 0.55, 0.65),
      });
    }
  }
}

/**
 * Lays out a FlowDocument (Word, Markdown, Text) into a multi-page PDF.
 */
export async function layoutFlowDocument(
  doc: PDFDocument,
  flowDoc: FlowDocument,
  options?: DocumentConversionOptions
): Promise<{ pageCount: number }> {
  const ctx = await createLayoutContext(doc, options);

  for (const block of flowDoc.blocks) {
    switch (block.type) {
      case 'paragraph':
        renderParagraph(ctx, block);
        break;
      case 'heading':
        renderHeading(ctx, block);
        break;
      case 'list':
        renderList(ctx, block);
        break;
      case 'code':
        renderCodeBlock(ctx, block);
        break;
      case 'quote':
        renderQuote(ctx, block);
        break;
      case 'divider':
        renderDivider(ctx);
        break;
      case 'pageBreak':
        breakPage(ctx);
        break;
      case 'table':
        renderTable(ctx, block);
        break;
      case 'image':
        await renderImage(ctx, block);
        break;
    }
  }

  decorateDocumentPages(ctx, flowDoc.title);
  return { pageCount: ctx.pages.length };
}

/**
 * Lays out a GridDocument (Spreadsheets: XLSX, CSV, TSV) into a multi-page PDF.
 */
export async function layoutGridDocument(
  doc: PDFDocument,
  gridDoc: GridDocument,
  options?: DocumentConversionOptions
): Promise<{ pageCount: number }> {
  const maxCols = gridDoc.sheets.reduce((max, s) => {
    const sheetMax = s.rows.reduce((m, r) => Math.max(m, r.length), 0);
    return Math.max(max, sheetMax);
  }, 1);

  const effectiveOrientation = options?.orientation ?? (maxCols > 5 ? 'landscape' : 'portrait');
  const effectiveOptions: DocumentConversionOptions = {
    ...options,
    orientation: effectiveOrientation,
  };

  const ctx = await createLayoutContext(doc, effectiveOptions);

  for (let sIdx = 0; sIdx < gridDoc.sheets.length; sIdx++) {
    const sheet = gridDoc.sheets[sIdx];
    if (sIdx > 0) {
      breakPage(ctx);
    }

    // Render sheet header badge
    const badgeText = sheet.name || `Sheet ${sIdx + 1}`;
    renderHeading(ctx, {
      type: 'heading',
      level: 2,
      text: badgeText,
    });

    if (sheet.rows.length === 0) continue;

    const tableBlock: TableBlock = {
      type: 'table',
      rows: sheet.rows.map((row, rIdx) => ({
        isHeader: rIdx === 0,
        cells: row.map((cellText) => ({
          runs: [{ text: cellText }],
          isHeader: rIdx === 0,
        })),
      })),
      hasBorders: options?.includeGridlines !== false,
      hasZebraStriping: options?.alternateRowShading !== false,
    };

    renderTable(ctx, tableBlock);
  }

  decorateDocumentPages(ctx, gridDoc.title);
  return { pageCount: ctx.pages.length };
}

/**
 * Lays out a SlideDocument (Presentations: PPTX) into a 16:9 or 4:3 PDF slide deck.
 */
export async function layoutSlideDocument(
  doc: PDFDocument,
  slideDoc: SlideDocument,
  options?: DocumentConversionOptions
): Promise<{ pageCount: number }> {
  const slideDims: PageDimensions = {
    width: slideDoc.width || 960,
    height: slideDoc.height || 540,
  };

  const slidesToRender =
    slideDoc.slides.length > 0 ? slideDoc.slides : [{ slideIndex: 0, elements: [] }];

  const fonts = await loadFontSet(doc, options?.fontFamily ?? 'helvetica');

  for (let sIdx = 0; sIdx < slidesToRender.length; sIdx++) {
    const slide = slidesToRender[sIdx];
    const page = doc.addPage([slideDims.width, slideDims.height]);

    // Slide background
    page.drawRectangle({
      x: 0,
      y: 0,
      width: slideDims.width,
      height: slideDims.height,
      color: parseColor(slide.backgroundColor, rgb(0.985, 0.988, 0.995)),
    });

    // Top accent border
    page.drawRectangle({
      x: 0,
      y: slideDims.height - 6,
      width: slideDims.width,
      height: 6,
      color: rgb(0.18, 0.42, 0.85),
    });

    let cursorY = 48;

    // Slide Title
    if (slide.title) {
      const cleanTitle = sanitizeTextForWinAnsi(slide.title);
      const titleLines = wrapRunsToLines(
        [{ text: cleanTitle, style: { bold: true, fontSize: 24 } }],
        fonts,
        slideDims.width - 96,
        24,
        rgb(0.1, 0.15, 0.28)
      );

      for (const line of titleLines) {
        drawWrappedLine(page, slideDims.height, line, 48, cursorY, 'left');
        cursorY += line.height;
      }

      cursorY += 8;
      const pdfDividerY = slideDims.height - cursorY;
      page.drawLine({
        start: { x: 48, y: pdfDividerY },
        end: { x: slideDims.width - 48, y: pdfDividerY },
        thickness: 1.5,
        color: rgb(0.85, 0.88, 0.94),
      });
      cursorY += 20;
    }

    // Slide content elements
    for (const el of slide.elements) {
      if (el.kind === 'bullet_list' && el.items && el.items.length > 0) {
        for (const item of el.items) {
          const lines = wrapRunsToLines(
            [{ text: sanitizeTextForWinAnsi(item), style: { fontSize: 14 } }],
            fonts,
            slideDims.width - 130,
            14,
            rgb(0.15, 0.2, 0.3)
          );

          if (lines.length > 0) {
            const bulletY = slideDims.height - cursorY - lines[0].height * 0.8;
            page.drawText('\u2022', {
              x: 56,
              y: bulletY,
              size: 16,
              font: fonts.bold,
              color: rgb(0.2, 0.45, 0.85),
            });

            for (const line of lines) {
              drawWrappedLine(page, slideDims.height, line, 76, cursorY, 'left');
              cursorY += line.height;
            }
            cursorY += 6;
          }
        }
      } else if (el.kind === 'subtitle' && el.runs) {
        const lines = wrapRunsToLines(
          el.runs,
          fonts,
          slideDims.width - 96,
          16,
          rgb(0.3, 0.35, 0.45)
        );
        for (const line of lines) {
          drawWrappedLine(page, slideDims.height, line, 48, cursorY, 'left');
          cursorY += line.height;
        }
        cursorY += 10;
      } else if (el.kind === 'body' && el.runs) {
        const lines = wrapRunsToLines(
          el.runs,
          fonts,
          slideDims.width - 96,
          13,
          rgb(0.2, 0.25, 0.35)
        );
        for (const line of lines) {
          drawWrappedLine(page, slideDims.height, line, 48, cursorY, 'left');
          cursorY += line.height;
        }
        cursorY += 12;
      } else if (el.kind === 'card' && el.title) {
        const cardTitle = sanitizeTextForWinAnsi(el.title);
        const cardH = 80;
        const cardPdfY = slideDims.height - cursorY - cardH;

        page.drawRectangle({
          x: 48,
          y: cardPdfY,
          width: slideDims.width - 96,
          height: cardH,
          color: rgb(1, 1, 1),
          borderColor: rgb(0.86, 0.89, 0.94),
          borderWidth: 1,
        });

        page.drawText(cardTitle, {
          x: 64,
          y: cardPdfY + cardH - 26,
          size: 14,
          font: fonts.bold,
          color: rgb(0.12, 0.18, 0.32),
        });

        if (el.runs) {
          const cardLines = wrapRunsToLines(el.runs, fonts, slideDims.width - 128, 11);
          let cardCurY = cursorY + 36;
          for (const cLine of cardLines) {
            drawWrappedLine(page, slideDims.height, cLine, 64, cardCurY, 'left');
            cardCurY += cLine.height;
          }
        }

        cursorY += cardH + 16;
      }
    }

    // Slide footer numbering
    if (options?.showSlideNumbers !== false) {
      const footerText = `Slide ${sIdx + 1} of ${slidesToRender.length}`;
      const footerW = safeWidthOfText(fonts.regular, footerText, 9);
      page.drawText(footerText, {
        x: slideDims.width - 48 - footerW,
        y: 20,
        size: 9,
        font: fonts.regular,
        color: rgb(0.5, 0.55, 0.65),
      });

      if (slideDoc.title) {
        page.drawText(sanitizeTextForWinAnsi(slideDoc.title), {
          x: 48,
          y: 20,
          size: 9,
          font: fonts.regular,
          color: rgb(0.5, 0.55, 0.65),
        });
      }
    }
  }

  return { pageCount: slidesToRender.length };
}
