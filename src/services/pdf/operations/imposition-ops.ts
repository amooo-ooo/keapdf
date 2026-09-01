import {
  PDFDocument,
  PDFPage,
  degrees,
  rgb,
  StandardFonts,
  type Color
} from 'pdf-lib';
import { parsePageRange } from '../../../utils/page-range';
export { parsePageRange };
import type {
  NUpImpositionOptions,
  BookletImpositionOptions,
  SinglePageImpositionOptions,
  PosterizeImpositionOptions,
  CutAndStackImpositionOptions,
  StandardSheetSize,
  SheetOrientation,
  SheetDimensions,
  ImpositionConfig
} from './types';

/** Standard page sizes in PDF points (72 points = 1 inch). */
const STANDARD_SIZES: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612.0, 792.0],
  A3: [841.89, 1190.55],
  A5: [419.53, 595.28],
  Legal: [612.0, 1008.0],
  Tabloid: [792.0, 1224.0]
};


/**
 * Resolves sheet dimensions in points based on standard preset or custom size and orientation.
 *
 * @param preset The standard sheet size preset name or 'custom'.
 * @param orientation The desired sheet orientation ('auto', 'portrait', 'landscape').
 * @param defaultSourceDimensions Default dimensions derived from source page.
 * @param custom Custom sheet dimensions if preset is 'custom'.
 * @return Resolved width and height in points.
 */
export function resolveSheetDimensions(
  preset: StandardSheetSize,
  orientation: SheetOrientation,
  defaultSourceDimensions: { widthPts: number; heightPts: number },
  custom?: SheetDimensions
): { width: number; height: number } {
  let width = 595.28;
  let height = 841.89;

  if (preset === 'source') {
    width = defaultSourceDimensions.widthPts;
    height = defaultSourceDimensions.heightPts;
  } else if (preset === 'source-2x') {
    width = defaultSourceDimensions.widthPts * 2;
    height = defaultSourceDimensions.heightPts;
  } else if (preset === 'custom' && custom) {
    width = custom.widthPts > 0 ? custom.widthPts : 595.28;
    height = custom.heightPts > 0 ? custom.heightPts : 841.89;
  } else if (STANDARD_SIZES[preset]) {
    const [w, h] = STANDARD_SIZES[preset];
    width = w;
    height = h;
  }

  if (orientation === 'landscape' && width < height) {
    const temp = width;
    width = height;
    height = temp;
  } else if (orientation === 'portrait' && width > height) {
    const temp = width;
    width = height;
    height = temp;
  }

  return { width, height };
}

/**
 * Applies multi-page N-Up layout imposition to a PDF document.
 *
 * @param pdfBytes The source PDF binary data.
 * @param options N-Up layout configuration options.
 * @return A Promise resolving to the imposed PDF byte buffer.
 */
export async function applyNUpImposition(
  pdfBytes: Uint8Array,
  options: NUpImpositionOptions
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const outDoc = await PDFDocument.create();

  const totalSrcPages = srcDoc.getPageCount();
  if (totalSrcPages === 0) {
    return outDoc.save();
  }

  const selectedIndices = parsePageRange(options.pageRange, totalSrcPages);
  if (selectedIndices.length === 0) {
    return outDoc.save();
  }

  const embeddedPages = await outDoc.embedPdf(srcDoc, selectedIndices);
  const firstSrcPage = srcDoc.getPage(selectedIndices[0]);
  const srcFirstDims = firstSrcPage.getSize();

  const cols = Math.max(1, options.grid.cols);
  const rows = Math.max(1, options.grid.rows);
  const cellsPerPage = cols * rows;

  const sheetDims = resolveSheetDimensions(
    options.sheetSize,
    options.orientation,
    { widthPts: srcFirstDims.width, heightPts: srcFirstDims.height },
    options.customDimensions
  );

  const margin = Math.max(0, options.marginPts);
  const gutter = Math.max(0, options.gutterPts);

  const availWidth = Math.max(10, sheetDims.width - 2 * margin - (cols - 1) * gutter);
  const availHeight = Math.max(10, sheetDims.height - 2 * margin - (rows - 1) * gutter);
  const cellWidth = availWidth / cols;
  const cellHeight = availHeight / rows;

  const borderColor = rgb(0.75, 0.75, 0.75);
  const cutColor = rgb(0.65, 0.65, 0.65);

  const totalOutSheets = Math.ceil(embeddedPages.length / cellsPerPage);

  for (let sheetIdx = 0; sheetIdx < totalOutSheets; sheetIdx++) {
    const sheetPage = outDoc.addPage([sheetDims.width, sheetDims.height]);

    // Draw cut lines between grid cells if enabled
    if (options.drawCutMarks) {
      for (let c = 1; c < cols; c++) {
        const cutX = margin + c * cellWidth + (c - 0.5) * gutter;
        sheetPage.drawLine({
          start: { x: cutX, y: 0 },
          end: { x: cutX, y: sheetDims.height },
          color: cutColor,
          thickness: 0.5,
          dashArray: [3, 3]
        });
      }
      for (let r = 1; r < rows; r++) {
        const cutY = sheetDims.height - margin - r * cellHeight - (r - 0.5) * gutter;
        sheetPage.drawLine({
          start: { x: 0, y: cutY },
          end: { x: sheetDims.width, y: cutY },
          color: cutColor,
          thickness: 0.5,
          dashArray: [3, 3]
        });
      }
    }

    for (let cellIdx = 0; cellIdx < cellsPerPage; cellIdx++) {
      const pageIndexInSelected = sheetIdx * cellsPerPage + cellIdx;
      if (pageIndexInSelected >= embeddedPages.length) break;

      const embeddedPage = embeddedPages[pageIndexInSelected];
      const { width: pWidth, height: pHeight } = embeddedPage;

      let col = 0;
      let row = 0;

      if (options.pageFlow === 'vertical') {
        col = Math.floor(cellIdx / rows);
        row = cellIdx % rows;
      } else if (options.pageFlow === 'horizontal-rtl') {
        row = Math.floor(cellIdx / cols);
        col = cols - 1 - (cellIdx % cols);
      } else {
        // 'horizontal'
        row = Math.floor(cellIdx / cols);
        col = cellIdx % cols;
      }

      const cellX = margin + col * (cellWidth + gutter);
      const cellY = sheetDims.height - margin - (row + 1) * cellHeight - row * gutter;

      let rotateDeg = 0;
      let targetW = pWidth;
      let targetH = pHeight;

      const scaleNormal = Math.min(cellWidth / pWidth, cellHeight / pHeight);

      if (options.autoRotateSubpages) {
        const scaleRotated = Math.min(cellWidth / pHeight, cellHeight / pWidth);
        if (scaleRotated > scaleNormal * 1.05) {
          rotateDeg = 90;
          targetW = pHeight;
          targetH = pWidth;
        }
      }

      const scale = Math.min(cellWidth / targetW, cellHeight / targetH);
      const drawWidth = targetW * scale;
      const drawHeight = targetH * scale;

      const drawX = cellX + (cellWidth - drawWidth) / 2;
      const drawY = cellY + (cellHeight - drawHeight) / 2;

      if (rotateDeg === 90) {
        sheetPage.drawPage(embeddedPage, {
          x: drawX + drawWidth,
          y: drawY,
          width: pWidth * scale,
          height: pHeight * scale,
          rotate: degrees(90)
        });
      } else {
        sheetPage.drawPage(embeddedPage, {
          x: drawX,
          y: drawY,
          width: drawWidth,
          height: drawHeight
        });
      }

      if (options.drawPageBorders) {
        sheetPage.drawRectangle({
          x: drawX,
          y: drawY,
          width: drawWidth,
          height: drawHeight,
          borderColor,
          borderWidth: 0.5
        });
      }
    }
  }

  return outDoc.save();
}

/**
 * Applies booklet imposition (saddle-stitch folding layout) to a PDF document.
 *
 * @param pdfBytes The source PDF binary data.
 * @param options Booklet imposition configuration options.
 * @return A Promise resolving to the imposed PDF byte buffer.
 */
export async function applyBookletImposition(
  pdfBytes: Uint8Array,
  options: BookletImpositionOptions
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const outDoc = await PDFDocument.create();

  const totalSrcPages = srcDoc.getPageCount();
  if (totalSrcPages === 0) {
    return outDoc.save();
  }

  const selectedIndices = parsePageRange(options.pageRange, totalSrcPages);
  if (selectedIndices.length === 0) {
    return outDoc.save();
  }

  let paddedPageCount = selectedIndices.length;
  if (options.autoPad && paddedPageCount % 4 !== 0) {
    paddedPageCount = Math.ceil(paddedPageCount / 4) * 4;
  }

  const embeddedPages = await outDoc.embedPdf(srcDoc, selectedIndices);
  const firstSrcPage = srcDoc.getPage(selectedIndices[0]);
  const srcDims = firstSrcPage.getSize();

  // Default booklet sheet size: landscape 2x source width
  const sheetDims = resolveSheetDimensions(
    options.sheetSize === 'source' ? 'source-2x' : options.sheetSize,
    options.orientation === 'auto' ? 'landscape' : options.orientation,
    { widthPts: srcDims.width * 2, heightPts: srcDims.height },
    options.customDimensions
  );

  const margin = Math.max(0, options.marginPts);
  const gutter = Math.max(0, options.gutterPts);
  const halfWidth = sheetDims.width / 2;

  const slotWidth = halfWidth - margin - gutter / 2;
  const slotHeight = sheetDims.height - 2 * margin;

  const totalSheets = Math.ceil(paddedPageCount / 4);
  const T = totalSheets * 4;

  interface SheetSideLayout {
    sheetNumber: number;
    side: 'front' | 'back';
    leftSourceIdx: number | null;
    rightSourceIdx: number | null;
  }

  const frontSheets: SheetSideLayout[] = [];
  const backSheets: SheetSideLayout[] = [];

  for (let k = 1; k <= totalSheets; k++) {
    // Standard saddle stitch 1-based page indices:
    // Front: Left = T - 2*(k - 1), Right = 2*k - 1
    // Back:  Left = 2*k,          Right = T - (2*k - 1)
    let fLeft1 = T - 2 * (k - 1);
    let fRight1 = 2 * k - 1;
    let bLeft1 = 2 * k;
    let bRight1 = T - (2 * k - 1);

    if (options.bindingSide === 'right') {
      // Swapped for Right-to-Left binding
      const tempF = fLeft1;
      fLeft1 = fRight1;
      fRight1 = tempF;

      const tempB = bLeft1;
      bLeft1 = bRight1;
      bRight1 = tempB;
    }

    const toZeroIdx = (oneIdx: number): number | null => {
      const zeroIdx = oneIdx - 1;
      return zeroIdx < selectedIndices.length ? zeroIdx : null;
    };

    frontSheets.push({
      sheetNumber: k,
      side: 'front',
      leftSourceIdx: toZeroIdx(fLeft1),
      rightSourceIdx: toZeroIdx(fRight1)
    });

    backSheets.push({
      sheetNumber: k,
      side: 'back',
      leftSourceIdx: toZeroIdx(bLeft1),
      rightSourceIdx: toZeroIdx(bRight1)
    });
  }

  const orderedSheetSides: SheetSideLayout[] = [];
  if (options.outputMode === 'front-then-back') {
    orderedSheetSides.push(...frontSheets, ...backSheets);
  } else {
    // Interleaved duplex: Front 1, Back 1, Front 2, Back 2...
    for (let k = 0; k < totalSheets; k++) {
      orderedSheetSides.push(frontSheets[k]);
      orderedSheetSides.push(backSheets[k]);
    }
  }

  const borderColor = rgb(0.75, 0.75, 0.75);
  const foldColor = rgb(0.7, 0.7, 0.7);

  const drawSlot = (
    sheetPage: PDFPage,
    sourceZeroIdx: number | null,
    slotLeftX: number,
    slotY: number,
    sWidth: number,
    sHeight: number
  ) => {
    if (sourceZeroIdx === null || sourceZeroIdx >= embeddedPages.length) {
      return;
    }

    const embeddedPage = embeddedPages[sourceZeroIdx];
    const { width: pW, height: pH } = embeddedPage;

    const scale = Math.min(sWidth / pW, sHeight / pH);
    const drawW = pW * scale;
    const drawH = pH * scale;

    const drawX = slotLeftX + (sWidth - drawW) / 2;
    const drawY = slotY + (sHeight - drawH) / 2;

    sheetPage.drawPage(embeddedPage, {
      x: drawX,
      y: drawY,
      width: drawW,
      height: drawH
    });

    if (options.drawPageBorders) {
      sheetPage.drawRectangle({
        x: drawX,
        y: drawY,
        width: drawW,
        height: drawH,
        borderColor,
        borderWidth: 0.5
      });
    }
  };

  for (const sheetLayout of orderedSheetSides) {
    const sheetPage = outDoc.addPage([sheetDims.width, sheetDims.height]);

    // Draw fold line down the center spine if enabled
    if (options.drawFoldLine) {
      sheetPage.drawLine({
        start: { x: halfWidth, y: 0 },
        end: { x: halfWidth, y: sheetDims.height },
        color: foldColor,
        thickness: 0.5,
        dashArray: [4, 4]
      });
    }

    // Left Slot
    const leftSlotX = margin;
    const slotY = margin;
    drawSlot(sheetPage, sheetLayout.leftSourceIdx, leftSlotX, slotY, slotWidth, slotHeight);

    // Right Slot
    const rightSlotX = halfWidth + gutter / 2;
    drawSlot(sheetPage, sheetLayout.rightSourceIdx, rightSlotX, slotY, slotWidth, slotHeight);
  }

  return outDoc.save();
}

/**
 * Converts a hex color string ('#ffffff' or '#fff') into a pdf-lib Color object.
 *
 * @param hex Hex color string.
 * @return pdf-lib Color.
 */
function parseHexColor(hex?: string): Color {
  if (!hex || !hex.startsWith('#')) return rgb(1, 1, 1);
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    return rgb(r, g, b);
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    return rgb(r, g, b);
  }
  return rgb(1, 1, 1);
}

/**
 * Merges all selected pages into a single continuous large canvas page.
 *
 * @param pdfBytes The source PDF binary data.
 * @param options Single page layout configuration options.
 * @return A Promise resolving to the imposed PDF byte buffer.
 */
export async function applySingleLargePageImposition(
  pdfBytes: Uint8Array,
  options: SinglePageImpositionOptions
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const outDoc = await PDFDocument.create();

  const totalSrcPages = srcDoc.getPageCount();
  if (totalSrcPages === 0) {
    return outDoc.save();
  }

  const selectedIndices = parsePageRange(options.pageRange, totalSrcPages);
  if (selectedIndices.length === 0) {
    return outDoc.save();
  }

  const embeddedPages = await outDoc.embedPdf(srcDoc, selectedIndices);
  const margin = Math.max(0, options.marginPts);
  const spacing = Math.max(0, options.spacingPts);

  const pageSizes = embeddedPages.map((ep) => ({ width: ep.width, height: ep.height }));
  const borderColor = rgb(0.75, 0.75, 0.75);
  const bgCol = parseHexColor(options.backgroundColor);

  if (options.layout === 'vertical-strip') {
    // Stacked vertically from top to bottom
    const maxWidth = Math.max(...pageSizes.map((p) => p.width));
    const totalHeight =
      pageSizes.reduce((sum, p) => sum + p.height, 0) +
      2 * margin +
      Math.max(0, pageSizes.length - 1) * spacing;
    const sheetWidth = maxWidth + 2 * margin;

    const sheetPage = outDoc.addPage([sheetWidth, totalHeight]);
    sheetPage.drawRectangle({
      x: 0,
      y: 0,
      width: sheetWidth,
      height: totalHeight,
      color: bgCol
    });

    let currentTop = totalHeight - margin;

    for (const embeddedPage of embeddedPages) {
      const pW = embeddedPage.width;
      const pH = embeddedPage.height;
      const pX = margin + (maxWidth - pW) / 2;
      const pY = currentTop - pH;

      sheetPage.drawPage(embeddedPage, {
        x: pX,
        y: pY,
        width: pW,
        height: pH
      });

      if (options.drawPageBorders) {
        sheetPage.drawRectangle({
          x: pX,
          y: pY,
          width: pW,
          height: pH,
          borderColor,
          borderWidth: 0.5
        });
      }

      currentTop -= pH + spacing;
    }
  } else if (options.layout === 'horizontal-strip') {
    // Placed side by side from left to right
    const maxHeight = Math.max(...pageSizes.map((p) => p.height));
    const totalWidth =
      pageSizes.reduce((sum, p) => sum + p.width, 0) +
      2 * margin +
      Math.max(0, pageSizes.length - 1) * spacing;
    const sheetHeight = maxHeight + 2 * margin;

    const sheetPage = outDoc.addPage([totalWidth, sheetHeight]);
    sheetPage.drawRectangle({
      x: 0,
      y: 0,
      width: totalWidth,
      height: sheetHeight,
      color: bgCol
    });

    let currentLeft = margin;

    for (const embeddedPage of embeddedPages) {
      const pW = embeddedPage.width;
      const pH = embeddedPage.height;
      const pX = currentLeft;
      const pY = margin + (maxHeight - pH) / 2;

      sheetPage.drawPage(embeddedPage, {
        x: pX,
        y: pY,
        width: pW,
        height: pH
      });

      if (options.drawPageBorders) {
        sheetPage.drawRectangle({
          x: pX,
          y: pY,
          width: pW,
          height: pH,
          borderColor,
          borderWidth: 0.5
        });
      }

      currentLeft += pW + spacing;
    }
  } else {
    // Grid on single page
    const cols = Math.max(1, options.gridCols || Math.ceil(Math.sqrt(pageSizes.length)));
    const rows = Math.ceil(pageSizes.length / cols);

    const maxColWidths = Array(cols).fill(0);
    const maxRowHeights = Array(rows).fill(0);

    for (let i = 0; i < pageSizes.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      maxColWidths[col] = Math.max(maxColWidths[col], pageSizes[i].width);
      maxRowHeights[row] = Math.max(maxRowHeights[row], pageSizes[i].height);
    }

    const totalWidth =
      maxColWidths.reduce((a, b) => a + b, 0) + 2 * margin + Math.max(0, cols - 1) * spacing;
    const totalHeight =
      maxRowHeights.reduce((a, b) => a + b, 0) + 2 * margin + Math.max(0, rows - 1) * spacing;

    const sheetPage = outDoc.addPage([totalWidth, totalHeight]);
    sheetPage.drawRectangle({
      x: 0,
      y: 0,
      width: totalWidth,
      height: totalHeight,
      color: bgCol
    });

    for (let i = 0; i < embeddedPages.length; i++) {
      const embeddedPage = embeddedPages[i];
      const col = i % cols;
      const row = Math.floor(i / cols);

      let colOffset = margin;
      for (let c = 0; c < col; c++) {
        colOffset += maxColWidths[c] + spacing;
      }

      let rowOffset = margin;
      for (let r = 0; r < row; r++) {
        rowOffset += maxRowHeights[r] + spacing;
      }

      const cellW = maxColWidths[col];
      const cellH = maxRowHeights[row];
      const pW = embeddedPage.width;
      const pH = embeddedPage.height;

      const pX = colOffset + (cellW - pW) / 2;
      const pY = totalHeight - rowOffset - cellH + (cellH - pH) / 2;

      sheetPage.drawPage(embeddedPage, {
        x: pX,
        y: pY,
        width: pW,
        height: pH
      });

      if (options.drawPageBorders) {
        sheetPage.drawRectangle({
          x: pX,
          y: pY,
          width: pW,
          height: pH,
          borderColor,
          borderWidth: 0.5
        });
      }
    }
  }

  return outDoc.save();
}

/**
 * Splits a large source page across multiple tiled sheets (Posterize print layout).
 *
 * @param pdfBytes The source PDF binary data.
 * @param options Posterize imposition configuration options.
 * @return A Promise resolving to the imposed PDF byte buffer.
 */
export async function applyPosterizeImposition(
  pdfBytes: Uint8Array,
  options: PosterizeImpositionOptions
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const outDoc = await PDFDocument.create();

  const totalSrcPages = srcDoc.getPageCount();
  if (totalSrcPages === 0) {
    return outDoc.save();
  }

  const srcPageIndex = Math.max(0, Math.min(options.sourcePageIndex || 0, totalSrcPages - 1));
  const [embeddedPage] = await outDoc.embedPdf(srcDoc, [srcPageIndex]);

  const { width: srcW, height: srcH } = embeddedPage;

  const sheetDims = resolveSheetDimensions(
    options.sheetSize,
    options.orientation,
    { widthPts: srcW, heightPts: srcH },
    options.customDimensions
  );

  const margin = Math.max(0, options.marginPts);
  const overlap = Math.max(0, options.overlapPts);

  const printableW = Math.max(20, sheetDims.width - 2 * margin);
  const printableH = Math.max(20, sheetDims.height - 2 * margin);

  const effectiveStepX = Math.max(10, printableW - overlap);
  const effectiveStepY = Math.max(10, printableH - overlap);

  let scale = options.tileScale && options.tileScale > 0 ? options.tileScale : 1.0;

  let cols = 1;
  let rows = 1;

  if (options.tileGrid && options.tileGrid.cols > 0 && options.tileGrid.rows > 0) {
    cols = options.tileGrid.cols;
    rows = options.tileGrid.rows;
    // Calculate scale required to span the grid
    const targetScaledW = cols * effectiveStepX + overlap;
    const targetScaledH = rows * effectiveStepY + overlap;
    scale = Math.max(targetScaledW / srcW, targetScaledH / srcH);
  } else {
    const totalScaledW = srcW * scale;
    const totalScaledH = srcH * scale;
    cols = Math.max(1, Math.ceil((totalScaledW - overlap) / effectiveStepX));
    rows = Math.max(1, Math.ceil((totalScaledH - overlap) / effectiveStepY));
  }

  const scaledW = srcW * scale;
  const scaledH = srcH * scale;

  let font;
  if (options.drawSheetNumbers) {
    font = await outDoc.embedFont(StandardFonts.Helvetica);
  }

  const cutColor = rgb(0.65, 0.65, 0.65);
  const labelColor = rgb(0.35, 0.35, 0.35);

  const totalTiles = cols * rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sheetPage = outDoc.addPage([sheetDims.width, sheetDims.height]);

      // Draw the scaled embedded page positioned so that the current tile is in view
      sheetPage.drawPage(embeddedPage, {
        x: margin - c * effectiveStepX,
        y: margin - (rows - 1 - r) * effectiveStepY,
        width: scaledW,
        height: scaledH
      });

      // Draw cut / trim marks around printable tile frame
      if (options.drawCutGuides) {
        sheetPage.drawRectangle({
          x: margin,
          y: margin,
          width: printableW,
          height: printableH,
          borderColor: cutColor,
          borderWidth: 0.5
        });

        // If overlap exists, draw dashed indicator along overlapping boundaries
        if (overlap > 0) {
          if (c < cols - 1) {
            sheetPage.drawLine({
              start: { x: sheetDims.width - margin - overlap, y: margin },
              end: { x: sheetDims.width - margin - overlap, y: sheetDims.height - margin },
              color: cutColor,
              thickness: 0.5,
              dashArray: [3, 3]
            });
          }
          if (r < rows - 1) {
            sheetPage.drawLine({
              start: { x: margin, y: margin + overlap },
              end: { x: sheetDims.width - margin, y: margin + overlap },
              color: cutColor,
              thickness: 0.5,
              dashArray: [3, 3]
            });
          }
        }
      }

      // Draw sheet label in bottom margin if enabled
      if (options.drawSheetNumbers && font) {
        const tileIndex = r * cols + c + 1;
        const labelText = `Tile ${tileIndex} of ${totalTiles} (Row ${r + 1}/${rows}, Col ${c + 1}/${cols})`;
        sheetPage.drawText(labelText, {
          x: margin,
          y: Math.max(2, margin - 10),
          size: 7,
          font,
          color: labelColor
        });
      }
    }
  }

  return outDoc.save();
}

/**
 * Applies 2-up or 4-up Cut-and-Stack imposition.
 *
 * @param pdfBytes The source PDF binary data.
 * @param options Cut-and-stack layout configuration options.
 * @return A Promise resolving to the imposed PDF byte buffer.
 */
export async function applyCutAndStackImposition(
  pdfBytes: Uint8Array,
  options: CutAndStackImpositionOptions
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const outDoc = await PDFDocument.create();

  const totalSrcPages = srcDoc.getPageCount();
  if (totalSrcPages === 0) {
    return outDoc.save();
  }

  const selectedIndices = parsePageRange(options.pageRange, totalSrcPages);
  if (selectedIndices.length === 0) {
    return outDoc.save();
  }

  const embeddedPages = await outDoc.embedPdf(srcDoc, selectedIndices);
  const firstSrcPage = srcDoc.getPage(selectedIndices[0]);
  const srcFirstDims = firstSrcPage.getSize();

  const cols = Math.max(1, options.grid.cols);
  const rows = Math.max(1, options.grid.rows);
  const cellsPerSheet = cols * rows;

  const totalSheets = Math.ceil(embeddedPages.length / cellsPerSheet);
  const K = totalSheets; // Stack depth per cell

  const sheetDims = resolveSheetDimensions(
    options.sheetSize,
    options.orientation,
    { widthPts: srcFirstDims.width, heightPts: srcFirstDims.height },
    options.customDimensions
  );

  const margin = Math.max(0, options.marginPts);
  const gutter = Math.max(0, options.gutterPts);

  const availWidth = Math.max(10, sheetDims.width - 2 * margin - (cols - 1) * gutter);
  const availHeight = Math.max(10, sheetDims.height - 2 * margin - (rows - 1) * gutter);
  const cellWidth = availWidth / cols;
  const cellHeight = availHeight / rows;

  const borderColor = rgb(0.75, 0.75, 0.75);
  const cutColor = rgb(0.65, 0.65, 0.65);

  for (let sheetIdx = 0; sheetIdx < totalSheets; sheetIdx++) {
    const sheetPage = outDoc.addPage([sheetDims.width, sheetDims.height]);

    if (options.drawCutMarks) {
      for (let c = 1; c < cols; c++) {
        const cutX = margin + c * cellWidth + (c - 0.5) * gutter;
        sheetPage.drawLine({
          start: { x: cutX, y: 0 },
          end: { x: cutX, y: sheetDims.height },
          color: cutColor,
          thickness: 0.5,
          dashArray: [3, 3]
        });
      }
      for (let r = 1; r < rows; r++) {
        const cutY = sheetDims.height - margin - r * cellHeight - (r - 0.5) * gutter;
        sheetPage.drawLine({
          start: { x: 0, y: cutY },
          end: { x: sheetDims.width, y: cutY },
          color: cutColor,
          thickness: 0.5,
          dashArray: [3, 3]
        });
      }
    }

    for (let cellIdx = 0; cellIdx < cellsPerSheet; cellIdx++) {
      // In cut and stack: Cell index `cellIdx` on sheet `sheetIdx` gets page `sheetIdx + cellIdx * K`
      const sourceZeroIdx = sheetIdx + cellIdx * K;
      if (sourceZeroIdx >= embeddedPages.length) continue;

      const embeddedPage = embeddedPages[sourceZeroIdx];
      const { width: pWidth, height: pHeight } = embeddedPage;

      const row = Math.floor(cellIdx / cols);
      const col = cellIdx % cols;

      const cellX = margin + col * (cellWidth + gutter);
      const cellY = sheetDims.height - margin - (row + 1) * cellHeight - row * gutter;

      const scale = Math.min(cellWidth / pWidth, cellHeight / pHeight);
      const drawWidth = pWidth * scale;
      const drawHeight = pHeight * scale;

      const drawX = cellX + (cellWidth - drawWidth) / 2;
      const drawY = cellY + (cellHeight - drawHeight) / 2;

      sheetPage.drawPage(embeddedPage, {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight
      });

      if (options.drawPageBorders) {
        sheetPage.drawRectangle({
          x: drawX,
          y: drawY,
          width: drawWidth,
          height: drawHeight,
          borderColor,
          borderWidth: 0.5
        });
      }
    }
  }

  return outDoc.save();
}

/**
 * Universal dispatcher for all imposition operations.
 *
 * @param pdfBytes The source PDF binary data.
 * @param config Imposition configuration options.
 * @return A Promise resolving to the imposed PDF byte buffer.
 */
export async function applyImposition(
  pdfBytes: Uint8Array,
  config: ImpositionConfig
): Promise<Uint8Array> {
  switch (config.type) {
    case 'nup':
      return applyNUpImposition(pdfBytes, config);
    case 'booklet':
      return applyBookletImposition(pdfBytes, config);
    case 'single-page':
      return applySingleLargePageImposition(pdfBytes, config);
    case 'posterize':
      return applyPosterizeImposition(pdfBytes, config);
    case 'cut-stack':
      return applyCutAndStackImposition(pdfBytes, config);
    default:
      throw new Error(`Unsupported imposition type.`);
  }
}
