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

/**
 * Renders a heading block into the layout context.
 */
function renderHeading(ctx: LayoutContext, block: HeadingBlock): void {
  const levelConfigs: Record<1 | 2 | 3 | 4, { size: number; before: number; after: number; color: RGB }> = {
    1: { size: 22, before: 18, after: 8, color: rgb(0.1, 0.15, 0.28) },
    2: { size: 16, before: 14, after: 6, color: rgb(0.15, 0.2, 0.32) },
    3: { size: 13, before: 10, after: 4, color: rgb(0.2, 0.25, 0.38) },
    4: { size: 11, before: 8, after: 4, color: rgb(0.25, 0.3, 0.42) },
  };

  const config = levelConfigs[block.level] ?? levelConfigs[1];
  const runs: StyledRun[] = [
    {
      text: block.text,
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

  ctx.cursorY += config.before;

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

  ctx.cursorY += config.after;
}

/**
 * Renders a bullet or ordered list block into the layout context.
 */
function renderList(ctx: LayoutContext, block: ListBlock): void {
  const defaultSize = ctx.options.fontSize ?? 10.5;
  const indentOffset = (block.indentLevel ?? 0) * 16;
  const bulletWidth = 16;
  const contentWidth = ctx.printableWidth - indentOffset - bulletWidth;

  for (let i = 0; i < block.items.length; i++) {
    const itemRuns = block.items[i];
    const bulletText = block.ordered ? `${i + 1}.` : '•';
    const lines = wrapRunsToLines(
      itemRuns,
      ctx.fonts,
      contentWidth,
      defaultSize
    );

    if (lines.length === 0) continue;

    ensureVerticalSpace(ctx, lines[0].height);

    // Draw bullet / number
    const bulletPdfY = ctx.pageHeight - ctx.cursorY - lines[0].height * 0.8;
    ctx.activePage.drawText(bulletText, {
      x: ctx.margins.left + indentOffset,
      y: bulletPdfY,
      size: defaultSize,
      font: block.ordered ? ctx.fonts.regular : ctx.fonts.bold,
      color: rgb(0.2, 0.25, 0.35),
    });

    for (const line of lines) {
      ensureVerticalSpace(ctx, line.height);
      drawWrappedLine(
        ctx.activePage,
        ctx.pageHeight,
        line,
        ctx.margins.left + indentOffset + bulletWidth,
        ctx.cursorY,
        'left',
        contentWidth
      );
      ctx.cursorY += line.height;
    }

    ctx.cursorY += 3; // Space between list items
  }

  ctx.cursorY += 6;
}

/**
 * Renders a code block into the layout context with syntax background card.
 */
function renderCodeBlock(ctx: LayoutContext, block: CodeBlock): void {
  const codeLines = block.code.split('\n');
  const fontSize = 8.5;
  const lineHeight = fontSize * 1.35;
  const padding = 10;
  const lineNumberWidth = block.showLineNumbers !== false ? 28 : 0;
  const textStartX = ctx.margins.left + padding + lineNumberWidth;
  const contentWidth = ctx.printableWidth - padding * 2 - lineNumberWidth;

  const totalHeight = codeLines.length * lineHeight + padding * 2;

  // If entire code block fits on current page, keep together; otherwise break per line
  if (totalHeight <= ctx.printableHeight && ctx.cursorY + totalHeight > ctx.pageHeight - ctx.margins.bottom) {
    breakPage(ctx);
  }

  ctx.cursorY += 6;

  for (let idx = 0; idx < codeLines.length; idx++) {
    ensureVerticalSpace(ctx, lineHeight + (idx === 0 ? padding : 0) + (idx === codeLines.length - 1 ? padding : 0));

    // Draw background slice
    const cardTop = ctx.cursorY;
    const sliceHeight = lineHeight + (idx === 0 ? padding : 0) + (idx === codeLines.length - 1 ? padding : 0);
    const pdfY = ctx.pageHeight - cardTop - sliceHeight;

    ctx.activePage.drawRectangle({
      x: ctx.margins.left,
      y: pdfY,
      width: ctx.printableWidth,
      height: sliceHeight,
      color: rgb(0.96, 0.97, 0.98),
      borderColor: rgb(0.88, 0.9, 0.93),
      borderWidth: 0.5,
    });

    if (idx === 0) ctx.cursorY += padding;

    // Draw line number if enabled
    if (block.showLineNumbers !== false) {
      const lineNumStr = `${idx + 1}`.padStart(3, ' ');
      ctx.activePage.drawText(lineNumStr, {
        x: ctx.margins.left + padding,
        y: ctx.pageHeight - ctx.cursorY - lineHeight * 0.8,
        size: fontSize,
        font: ctx.fonts.mono,
        color: rgb(0.6, 0.65, 0.72),
      });
    }

    // Draw code text
    const text = codeLines[idx];
    const maxChars = Math.floor(contentWidth / (fontSize * 0.6));
    const truncated = text.length > maxChars ? text.slice(0, maxChars) : text;

    ctx.activePage.drawText(truncated, {
      x: textStartX,
      y: ctx.pageHeight - ctx.cursorY - lineHeight * 0.8,
      size: fontSize,
      font: ctx.fonts.mono,
      color: rgb(0.15, 0.18, 0.24),
    });

    ctx.cursorY += lineHeight;

    if (idx === codeLines.length - 1) ctx.cursorY += padding;
  }

  ctx.cursorY += 8;
}

/**
 * Renders a blockquote into the layout context with an accent left border.
 */
function renderQuote(ctx: LayoutContext, block: QuoteBlock): void {
  const fontSize = (ctx.options.fontSize ?? 10.5) * 1.05;
  const paddingLeft = 14;
  const contentWidth = ctx.printableWidth - paddingLeft;

  const runs: StyledRun[] = [
    {
      text: block.text,
      style: {
        italic: true,
        fontSize,
      },
    },
  ];

  const lines = wrapRunsToLines(runs, ctx.fonts, contentWidth, fontSize, rgb(0.25, 0.3, 0.4));
  const totalHeight = lines.reduce((acc, l) => acc + l.height, 0) + 8;

  ensureVerticalSpace(ctx, totalHeight);

  const startY = ctx.cursorY;
  const borderHeight = totalHeight - 4;
  const pdfBorderY = ctx.pageHeight - startY - borderHeight;

  // Left accent line
  ctx.activePage.drawRectangle({
    x: ctx.margins.left,
    y: pdfBorderY,
    width: 3.5,
    height: borderHeight,
    color: rgb(0.2, 0.45, 0.85),
  });

  ctx.cursorY += 4;

  for (const line of lines) {
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
    // If embedding fails, gracefully skip image
    return;
  }

  const naturalWidth = block.width ?? embeddedImage.width;
  const naturalHeight = block.height ?? embeddedImage.height;
  const aspect = naturalWidth / naturalHeight;

  let renderWidth = Math.min(ctx.printableWidth, naturalWidth);
  let renderHeight = renderWidth / aspect;

  if (renderHeight > ctx.printableHeight * 0.6) {
    renderHeight = ctx.printableHeight * 0.6;
    renderWidth = renderHeight * aspect;
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
    const sum = table.columnWidths.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      return table.columnWidths.map((w) => (w / sum) * printableWidth);
    }
  }

  // Equal division fallback
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
  const paddingX = 6;
  const paddingY = 5;
  const fontSize = isHeader ? 9.5 : (ctx.options.fontSize ?? 9);

  // Measure cell line wraps to determine maximum row height
  const cellWrappedLines = rowCells.map((cell, colIdx) => {
    const colW = colWidths[colIdx] ?? colWidths[colWidths.length - 1];
    const cellInnerW = Math.max(20, colW - paddingX * 2);
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
    const colW = colWidths[c] ?? colWidths[colWidths.length - 1];
    const lines = cellWrappedLines[c];
    let textCursorY = ctx.cursorY + paddingY;

    for (const line of lines) {
      drawWrappedLine(
        ctx.activePage,
        ctx.pageHeight,
        line,
        currentX + paddingX,
        textCursorY,
        rowCells[c]?.align ?? (isHeader ? 'left' : 'left'),
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
    // Check if row fits; if not, break page and re-render header!
    if (ctx.cursorY + 30 > ctx.pageHeight - ctx.margins.bottom) {
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
  const docTitle = title ?? ctx.options.title;

  for (let i = 0; i < totalPages; i++) {
    const page = ctx.pages[i];

    // Running header on pages > 0 if title is available
    if (i > 0 && docTitle) {
      const headerY = ctx.pageHeight - ctx.margins.top + 20;
      page.drawText(docTitle, {
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
      const footerY = Math.max(20, ctx.margins.bottom - 24);
      const pageText = `Page ${i + 1} of ${totalPages}`;
      const pageTextWidth = ctx.fonts.regular.widthOfTextAtSize(pageText, 8.5);

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
  // Auto-detect landscape if maximum columns > 5
  const maxCols = Math.max(
    ...gridDoc.sheets.flatMap((s) => s.rows.map((r) => r.length)),
    1
  );

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

  const fonts = await loadFontSet(doc, options?.fontFamily ?? 'helvetica');

  for (let sIdx = 0; sIdx < slideDoc.slides.length; sIdx++) {
    const slide = slideDoc.slides[sIdx];
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
      const titleLines = wrapRunsToLines(
        [{ text: slide.title, style: { bold: true, fontSize: 24 } }],
        fonts,
        slideDims.width - 96,
        24,
        rgb(0.1, 0.15, 0.28)
      );

      for (const line of titleLines) {
        drawWrappedLine(page, slideDims.height, line, 48, cursorY, 'left');
        cursorY += line.height;
      }

      // Divider below title
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
            [{ text: item, style: { fontSize: 14 } }],
            fonts,
            slideDims.width - 130,
            14,
            rgb(0.15, 0.2, 0.3)
          );

          if (lines.length > 0) {
            const bulletY = slideDims.height - cursorY - lines[0].height * 0.8;
            page.drawText('•', {
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
        // Draw presentation card container
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

        page.drawText(el.title, {
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
      const footerText = `Slide ${sIdx + 1} of ${slideDoc.slides.length}`;
      const footerW = fonts.regular.widthOfTextAtSize(footerText, 9);
      page.drawText(footerText, {
        x: slideDims.width - 48 - footerW,
        y: 20,
        size: 9,
        font: fonts.regular,
        color: rgb(0.5, 0.55, 0.65),
      });

      if (slideDoc.title) {
        page.drawText(slideDoc.title, {
          x: 48,
          y: 20,
          size: 9,
          font: fonts.regular,
          color: rgb(0.5, 0.55, 0.65),
        });
      }
    }
  }

  return { pageCount: slideDoc.slides.length };
}
