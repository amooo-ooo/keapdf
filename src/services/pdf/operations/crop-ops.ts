import type { EditableSpan } from '../../../core/types';

/**
 * Visual margins in points to trim from the page edges.
 */
export interface PageCropMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Calculated PDF CropBox rectangle in points.
 */
export interface PageCropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Execution parameters for cropping one or more PDF pages.
 */
export interface CropPageOptions {
  /** Target zero-based page indices to crop. */
  pageIndices: number[];
  /** Visual margins to crop in points. */
  margins: PageCropMargins;
}

/** Conversion factor: 72 points per inch. */
const POINTS_PER_INCH = 72;

/** Conversion factor: 25.4 millimeters per inch. */
const MM_PER_INCH = 25.4;

/** Minimum allowed page dimension in points after cropping. */
const MIN_PAGE_DIMENSION_PTS = 10;

/**
 * Converts a point measurement to the specified target unit.
 *
 * @param points Value in PDF points.
 * @param unit Target unit: 'pt', 'in', or 'mm'.
 * @return Value in the target unit.
 */
export function convertFromPoints(points: number, unit: 'pt' | 'in' | 'mm'): number {
  switch (unit) {
    case 'in':
      return points / POINTS_PER_INCH;
    case 'mm':
      return (points / POINTS_PER_INCH) * MM_PER_INCH;
    case 'pt':
    default:
      return points;
  }
}

/**
 * Converts a measurement in a given unit to PDF points.
 *
 * @param value Measurement value.
 * @param unit Source unit: 'pt', 'in', or 'mm'.
 * @return Value in PDF points.
 */
export function convertToPoints(value: number, unit: 'pt' | 'in' | 'mm'): number {
  switch (unit) {
    case 'in':
      return value * POINTS_PER_INCH;
    case 'mm':
      return (value / MM_PER_INCH) * POINTS_PER_INCH;
    case 'pt':
    default:
      return value;
  }
}

/**
 * Axis-aligned content boundary in PDF points.
 */
export interface ContentBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Calculates tight crop margins from bounding coordinates.
 *
 * @param bounds Content bounding box in points.
 * @param pageDims Natural width and height of the page in points.
 * @param padding Optional padding in points around content bounds (default: 18 pt / 0.25 in).
 * @return Recommended PageCropMargins in points.
 */
export function calculateMarginsFromBounds(
  bounds: ContentBounds | null,
  pageDims: { widthPts: number; heightPts: number },
  padding: number = 18,
): PageCropMargins {
  if (!bounds) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  if (
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.top) ||
    !Number.isFinite(bounds.right) ||
    !Number.isFinite(bounds.bottom)
  ) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  const cropLeft = Math.max(0, Math.floor(bounds.left - padding));
  const cropTop = Math.max(0, Math.floor(bounds.top - padding));
  const cropRight = Math.max(0, Math.floor(pageDims.widthPts - bounds.right - padding));
  const cropBottom = Math.max(0, Math.floor(pageDims.heightPts - bounds.bottom - padding));

  // Verify that margins do not collapse the page
  const remainingWidth = pageDims.widthPts - cropLeft - cropRight;
  const remainingHeight = pageDims.heightPts - cropTop - cropBottom;

  if (remainingWidth < MIN_PAGE_DIMENSION_PTS || remainingHeight < MIN_PAGE_DIMENSION_PTS) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  return {
    top: cropTop,
    right: cropRight,
    bottom: cropBottom,
    left: cropLeft,
  };
}

/**
 * Calculates tight crop margins around all content spans on a page.
 * Useful for auto-trimming white margins.
 *
 * @param spans Array of editable spans located on the page.
 * @param pageDims Natural width and height of the page in points.
 * @param padding Optional padding in points around content bounds (default: 18 pt / 0.25 in).
 * @return Recommended PageCropMargins in points.
 */
export function calculateContentMargins(
  spans: EditableSpan[],
  pageDims: { widthPts: number; heightPts: number },
  padding: number = 18,
): PageCropMargins {
  if (spans.length === 0) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;

  for (const span of spans) {
    minLeft = Math.min(minLeft, span.left);
    minTop = Math.min(minTop, span.top);
    maxRight = Math.max(maxRight, span.left + span.width);
    maxBottom = Math.max(maxBottom, span.top + span.height);
  }

  return calculateMarginsFromBounds(
    { left: minLeft, top: minTop, right: maxRight, bottom: maxBottom },
    pageDims,
    padding,
  );
}

/**
 * Calculates page crop margins from two drag points on the page.
 * Clamps coordinates to page dimensions and ensures minimum dimension constraints.
 *
 * @param start Point where drag began in PDF points.
 * @param current Current pointer position in PDF points.
 * @param pageWidth Total page width in PDF points.
 * @param pageHeight Total page height in PDF points.
 * @param minDimension Minimum width and height for crop window in points (default: 10).
 * @return Computed PageCropMargins.
 */
export function calculateDragCropMargins(
  start: { x: number; y: number },
  current: { x: number; y: number },
  pageWidth: number,
  pageHeight: number,
  minDimension: number = 10,
): PageCropMargins {
  const clampedStartX = Math.max(0, Math.min(pageWidth, start.x));
  const clampedStartY = Math.max(0, Math.min(pageHeight, start.y));
  const clampedCurX = Math.max(0, Math.min(pageWidth, current.x));
  const clampedCurY = Math.max(0, Math.min(pageHeight, current.y));

  let minX = Math.min(clampedStartX, clampedCurX);
  let maxX = Math.max(clampedStartX, clampedCurX);
  let minY = Math.min(clampedStartY, clampedCurY);
  let maxY = Math.max(clampedStartY, clampedCurY);

  if (maxX - minX < minDimension) {
    if (maxX + (minDimension - (maxX - minX)) <= pageWidth) {
      maxX = minX + minDimension;
    } else {
      minX = Math.max(0, maxX - minDimension);
    }
  }

  if (maxY - minY < minDimension) {
    if (maxY + (minDimension - (maxY - minY)) <= pageHeight) {
      maxY = minY + minDimension;
    } else {
      minY = Math.max(0, maxY - minDimension);
    }
  }

  return {
    left: Math.round(minX * 10) / 10,
    top: Math.round(minY * 10) / 10,
    right: Math.round((pageWidth - maxX) * 10) / 10,
    bottom: Math.round((pageHeight - maxY) * 10) / 10,
  };
}

/**
 * Calculates page crop margins based on a desired width and/or height,
 * adjusting right and bottom margins while preserving current left and top offsets.
 *
 * @param currentMargins Existing crop margins.
 * @param pageWidth Total page width in points.
 * @param pageHeight Total page height in points.
 * @param dimensions Desired width and/or height in points.
 * @param minDimension Minimum allowable width and height in points.
 * @return Updated PageCropMargins.
 */
export function calculateCropMarginsFromDimensions(
  currentMargins: PageCropMargins,
  pageWidth: number,
  pageHeight: number,
  dimensions: { width?: number; height?: number },
  minDimension: number = 10,
): PageCropMargins {
  let left = Math.max(0, Math.min(pageWidth - minDimension, currentMargins.left));
  let top = Math.max(0, Math.min(pageHeight - minDimension, currentMargins.top));
  let right = currentMargins.right;
  let bottom = currentMargins.bottom;

  if (dimensions.width !== undefined) {
    const targetW = Math.max(minDimension, Math.min(pageWidth - left, dimensions.width));
    right = Math.max(0, pageWidth - left - targetW);
    if (pageWidth - left - right < targetW) {
      left = Math.max(0, pageWidth - targetW);
    }
  }

  if (dimensions.height !== undefined) {
    const targetH = Math.max(minDimension, Math.min(pageHeight - top, dimensions.height));
    bottom = Math.max(0, pageHeight - top - targetH);
    if (pageHeight - top - bottom < targetH) {
      top = Math.max(0, pageHeight - targetH);
    }
  }

  return {
    left: Math.round(left * 10) / 10,
    top: Math.round(top * 10) / 10,
    right: Math.round(right * 10) / 10,
    bottom: Math.round(bottom * 10) / 10,
  };
}

/**
 * Calculates page crop margins for a single click on the canvas,
 * centring a target crop box around the click coordinate clamped to page boundaries.
 *
 * @param clickPoint The point where the click occurred { x, y } in page points.
 * @param pageWidth Total page width in points.
 * @param pageHeight Total page height in points.
 * @param targetSize Desired crop box size { width, height } in points.
 * @return Computed PageCropMargins.
 */
export function calculateClickCropMargins(
  clickPoint: { x: number; y: number },
  pageWidth: number,
  pageHeight: number,
  targetSize: { width?: number; height?: number } = {},
): PageCropMargins {
  const defaultW = Math.min(pageWidth, Math.max(10, targetSize.width ?? pageWidth * 0.75));
  const defaultH = Math.min(pageHeight, Math.max(10, targetSize.height ?? pageHeight * 0.75));

  const minX = Math.max(0, Math.min(pageWidth - defaultW, clickPoint.x - defaultW / 2));
  const minY = Math.max(0, Math.min(pageHeight - defaultH, clickPoint.y - defaultH / 2));
  const maxX = minX + defaultW;
  const maxY = minY + defaultH;

  return {
    left: Math.round(minX * 10) / 10,
    top: Math.round(minY * 10) / 10,
    right: Math.round((pageWidth - maxX) * 10) / 10,
    bottom: Math.round((pageHeight - maxY) * 10) / 10,
  };
}

/**
 * Calibrates visual margins to native PDF user space coordinates based on page rotation.
 *
 * @param mediaBox The page's physical MediaBox.
 * @param rotationDeg The page's /Rotate dictionary angle (0, 90, 180, 270).
 * @param margins Visual margins specified from the top-left oriented viewport.
 * @return Computed CropBox in native unrotated PDF user space.
 */
export function computeRotationAwareCropBox(
  mediaBox: { x: number; y: number; width: number; height: number },
  rotationDeg: number,
  margins: PageCropMargins,
): PageCropBox {
  const normRot = ((rotationDeg % 360) + 360) % 360;
  const roundedRot = Math.round(normRot / 90) * 90 % 360;

  let x = mediaBox.x;
  let y = mediaBox.y;
  let width = mediaBox.width;
  let height = mediaBox.height;

  switch (roundedRot) {
    case 90: {
      // Visual top maps to PDF left, visual bottom maps to PDF right
      // Visual left maps to PDF bottom, visual right maps to PDF top
      x = mediaBox.x + margins.top;
      y = mediaBox.y + margins.left;
      width = mediaBox.width - margins.top - margins.bottom;
      height = mediaBox.height - margins.left - margins.right;
      break;
    }
    case 180: {
      // Visual top maps to PDF bottom, visual bottom maps to PDF top
      // Visual left maps to PDF right, visual right maps to PDF left
      x = mediaBox.x + margins.right;
      y = mediaBox.y + margins.top;
      width = mediaBox.width - margins.left - margins.right;
      height = mediaBox.height - margins.top - margins.bottom;
      break;
    }
    case 270: {
      // Visual top maps to PDF right, visual bottom maps to PDF left
      // Visual left maps to PDF top, visual right maps to PDF bottom
      x = mediaBox.x + margins.bottom;
      y = mediaBox.y + margins.right;
      width = mediaBox.width - margins.top - margins.bottom;
      height = mediaBox.height - margins.left - margins.right;
      break;
    }
    case 0:
    default: {
      x = mediaBox.x + margins.left;
      y = mediaBox.y + margins.bottom;
      width = mediaBox.width - margins.left - margins.right;
      height = mediaBox.height - margins.top - margins.bottom;
      break;
    }
  }

  // Clamp dimensions to minimum allowed size
  const clampedWidth = Math.max(MIN_PAGE_DIMENSION_PTS, width);
  const clampedHeight = Math.max(MIN_PAGE_DIMENSION_PTS, height);

  // If clamping occurred, adjust x and y to keep within mediaBox boundaries
  const maxX = mediaBox.x + mediaBox.width - clampedWidth;
  const maxY = mediaBox.y + mediaBox.height - clampedHeight;
  const clampedX = Math.max(mediaBox.x, Math.min(x, maxX));
  const clampedY = Math.max(mediaBox.y, Math.min(y, maxY));

  return {
    x: clampedX,
    y: clampedY,
    width: clampedWidth,
    height: clampedHeight,
  };
}

/**
 * Applies crop margins to the specified pages of a PDF document by updating /CropBox.
 *
 * @param pdfBytes Binary PDF buffer.
 * @param options Crop configuration options including target pages and margins.
 * @return A promise resolving to the modified PDF Uint8Array.
 */
export async function cropPages(
  pdfBytes: Uint8Array | ArrayBuffer,
  options: CropPageOptions,
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();

  for (const pageIdx of options.pageIndices) {
    if (pageIdx < 0 || pageIdx >= totalPages) continue;

    const page = pdfDoc.getPage(pageIdx);
    const baseBox = page.getCropBox() ?? page.getMediaBox();
    const rotationAngle = page.getRotation().angle;

    const cropBox = computeRotationAwareCropBox(baseBox, rotationAngle, options.margins);
    page.setCropBox(cropBox.x, cropBox.y, cropBox.width, cropBox.height);
  }

  return await pdfDoc.save({ useObjectStreams: false });
}

/**
 * Resets the /CropBox of target pages back to match /MediaBox.
 *
 * @param pdfBytes Binary PDF buffer.
 * @param pageIndices Target zero-based page indices to reset.
 * @return A promise resolving to the reset PDF Uint8Array.
 */
export async function resetCropPages(
  pdfBytes: Uint8Array | ArrayBuffer,
  pageIndices: number[],
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();

  for (const pageIdx of pageIndices) {
    if (pageIdx < 0 || pageIdx >= totalPages) continue;

    const page = pdfDoc.getPage(pageIdx);
    const mediaBox = page.getMediaBox();
    page.setCropBox(mediaBox.x, mediaBox.y, mediaBox.width, mediaBox.height);
  }

  return await pdfDoc.save({ useObjectStreams: false });
}
