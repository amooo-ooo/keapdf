import {
  PDFDocument,
  PDFPage,
  degrees,
  rgb,
  StandardFonts,
  type Color
} from 'pdf-lib';
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
 * Parses a page range string (e.g. "1-5, 8, 11-14") into zero-based page indices.
 *
 * @param rangeStr The range string or undefined/'all'.
 * @param totalPages The total number of pages in the source document.
 * @return An array of zero-based page indices.
 */
export function parsePageRange(rangeStr: string | undefined, totalPages: number): number[] {
  if (!rangeStr || rangeStr.trim() === '' || rangeStr.trim().toLowerCase() === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const indices = new Set<number>();
  const parts = rangeStr.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr.trim(), 10);
      const end = parseInt(endStr.trim(), 10);

      if (!isNaN(start) && !isNaN(end) && start >= 1 && end <= totalPages && start <= end) {
        for (let i = start - 1; i <= end - 1; i++) {
          indices.add(i);
        }
      }
    } else {
      const val = parseInt(trimmed, 10);
      if (!isNaN(val) && val >= 1 && val <= totalPages) {
        indices.add(val - 1);
      }
    }
  }

  const result = Array.from(indices).sort((a, b) => a - b);
  return result.length > 0 ? result : Array.from({ length: totalPages }, (_, i) => i);
}

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

