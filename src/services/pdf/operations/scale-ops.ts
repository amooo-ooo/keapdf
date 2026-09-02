import { PDFDocument } from 'pdf-lib';
import type { CanvasElement, PathElement, TextElement, ShapeElement } from '../../../stores/canvas-types';

/** Standard paper sizes in points (72 points per inch). */
export const STANDARD_PAPER_SIZES: Record<string, { width: number; height: number; label: string }> = {
  A4: { width: 595.28, height: 841.89, label: 'A4 (210 x 297 mm)' },
  Letter: { width: 612.0, height: 792.0, label: 'US Letter (8.5 x 11 in)' },
  Legal: { width: 612.0, height: 1008.0, label: 'US Legal (8.5 x 14 in)' },
  A3: { width: 841.89, height: 1190.55, label: 'A3 (297 x 420 mm)' },
  A5: { width: 419.53, height: 595.28, label: 'A5 (148 x 210 mm)' },
  Tabloid: { width: 792.0, height: 1224.0, label: 'Tabloid (11 x 17 in)' },
};

export type PaperSizePreset = 'A4' | 'Letter' | 'Legal' | 'A3' | 'A5' | 'Tabloid' | 'custom';
export type ScaleUnit = 'pt' | 'mm' | 'in';
export type ScaleOrientation = 'portrait' | 'landscape';
export type ScaleMode = 'proportional' | 'pad-margins';
export type PadMarginsAlignment = 'top-left' | 'center' | 'bottom-center';
export type PageScaleScope = 'current' | 'all' | 'selected';

export const POINTS_PER_INCH = 72;
export const MM_PER_INCH = 25.4;
export const POINTS_PER_MM = POINTS_PER_INCH / MM_PER_INCH; // ~2.834645669

/** Convert a numeric value from the given unit into PDF points. */
export function convertToPoints(value: number, unit: ScaleUnit): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  switch (unit) {
    case 'in':
      return value * POINTS_PER_INCH;
    case 'mm':
      return value * POINTS_PER_MM;
    case 'pt':
    default:
      return value;
  }
}

/** Convert a points value into the specified measurement unit. */
export function convertFromPoints(points: number, unit: ScaleUnit): number {
  if (Number.isNaN(points) || !Number.isFinite(points)) return 0;
  switch (unit) {
    case 'in':
      return Math.round((points / POINTS_PER_INCH) * 1000) / 1000;
    case 'mm':
      return Math.round((points / POINTS_PER_MM) * 10) / 10;
    case 'pt':
    default:
      return Math.round(points * 10) / 10;
  }
}

/** Resolves the target width and height in points given a preset and orientation. */
export function resolvePaperDimensions(
  preset: PaperSizePreset,
  orientation: ScaleOrientation,
  customDimensions?: { width: number; height: number },
): { width: number; height: number } {
  let baseWidth = 595.28;
  let baseHeight = 841.89;

  if (preset === 'custom' && customDimensions) {
    baseWidth = Math.max(10, customDimensions.width);
    baseHeight = Math.max(10, customDimensions.height);
  } else if (STANDARD_PAPER_SIZES[preset]) {
    baseWidth = STANDARD_PAPER_SIZES[preset].width;
    baseHeight = STANDARD_PAPER_SIZES[preset].height;
  }

  const isLandscape = orientation === 'landscape';
  const width = isLandscape ? Math.max(baseWidth, baseHeight) : Math.min(baseWidth, baseHeight);
  const height = isLandscape ? Math.min(baseWidth, baseHeight) : Math.max(baseWidth, baseHeight);

  return { width, height };
}

export interface ScalePageOptions {
  /** Target zero-based page indices to resize. */
  pageIndices: number[];
  /** Mode: 'proportional' scales content, 'pad-margins' alters page box and offsets content. */
  mode: ScaleMode;
  /** Resolved target page dimensions in points. */
  targetDimensions: { width: number; height: number };
  /** In proportional mode, whether to preserve aspect ratio and centre content. Default true. */
  constrainProportions?: boolean;
  /** In pad-margins mode, where to anchor the original content. Default 'center'. */
  alignment?: PadMarginsAlignment;
}

/**
 * Computes the scaling and translation parameters for a given page geometry.
 */
export function computePageTransformMetrics(
  currentWidth: number,
  currentHeight: number,
  targetWidth: number,
  targetHeight: number,
  mode: ScaleMode,
  alignment: PadMarginsAlignment = 'center',
  constrainProportions = true,
): {
  scaleX: number;
  scaleY: number;
  tx: number;
  ty: number;
  visualShiftX: number;
  visualShiftY: number;
} {
  if (mode === 'proportional') {
    if (constrainProportions) {
      const uniformScale = Math.min(targetWidth / currentWidth, targetHeight / currentHeight);
      const scaledW = currentWidth * uniformScale;
      const scaledH = currentHeight * uniformScale;
      const tx = (targetWidth - scaledW) / 2;
      const ty = (targetHeight - scaledH) / 2;
      return {
        scaleX: uniformScale,
        scaleY: uniformScale,
        tx,
        ty,
        visualShiftX: tx,
        visualShiftY: ty,
      };
    }

    const scaleX = targetWidth / currentWidth;
    const scaleY = targetHeight / currentHeight;
    return {
      scaleX,
      scaleY,
      tx: 0,
      ty: 0,
      visualShiftX: 0,
      visualShiftY: 0,
    };
  }

  // Margin padding mode: content scale is 1.0
  let tx = 0;
  let ty = 0;
  let visualShiftX = 0;
  let visualShiftY = 0;

  switch (alignment) {
    case 'top-left':
      // In PDF coordinate system, origin is bottom-left
      tx = 0;
      ty = targetHeight - currentHeight;
      // In visual DOM coordinate system, origin is top-left
      visualShiftX = 0;
      visualShiftY = 0;
      break;
    case 'bottom-center':
      tx = (targetWidth - currentWidth) / 2;
      ty = 0;
      visualShiftX = (targetWidth - currentWidth) / 2;
      visualShiftY = targetHeight - currentHeight;
      break;
    case 'center':
    default:
      tx = (targetWidth - currentWidth) / 2;
      ty = (targetHeight - currentHeight) / 2;
      visualShiftX = (targetWidth - currentWidth) / 2;
      visualShiftY = (targetHeight - currentHeight) / 2;
      break;
  }

  return {
    scaleX: 1.0,
    scaleY: 1.0,
    tx,
    ty,
    visualShiftX,
    visualShiftY,
  };
}

/**
 * Resizes PDF pages to target dimensions using pdf-lib.
 * Conforms to ISO 32000-1 coordinate transformations.
 */
export async function scalePages(
  pdfBytes: Uint8Array | ArrayBuffer,
  options: ScalePageOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();
  const targetIndices = options.pageIndices.filter((idx) => idx >= 0 && idx < totalPages);

  for (const pageIdx of targetIndices) {
    const page = pdfDoc.getPage(pageIdx);
    const { width: curW, height: curH } = page.getSize();
    const targetW = Math.max(10, options.targetDimensions.width);
    const targetH = Math.max(10, options.targetDimensions.height);

    const metrics = computePageTransformMetrics(
      curW,
      curH,
      targetW,
      targetH,
      options.mode,
      options.alignment ?? 'center',
      options.constrainProportions ?? true,
    );

    // Apply new page box dimensions
    page.setSize(targetW, targetH);

    if (options.mode === 'proportional') {
      page.scaleContent(metrics.scaleX, metrics.scaleY);
      if (metrics.tx !== 0 || metrics.ty !== 0) {
        page.translateContent(metrics.tx, metrics.ty);
      }
      page.scaleAnnotations(metrics.scaleX, metrics.scaleY);
    } else {
      // Pad margins: translate existing content into target alignment
      if (metrics.tx !== 0 || metrics.ty !== 0) {
        page.translateContent(metrics.tx, metrics.ty);
      }
    }

    // Synchronise CropBox if defined on the page
    const cropBox = page.getCropBox();
    if (cropBox) {
      page.setCropBox(0, 0, targetW, targetH);
    }
  }

  return await pdfDoc.save({ useObjectStreams: false });
}

/**
 * Recalculates canvas elements so they stay aligned with scaled or margin-padded pages.
 */
export function transformCanvasElementsForScale(
  elements: CanvasElement[],
  targetIndices: number[],
  pageMetricsLookup: (pageIndex: number) => { width: number; height: number },
  options: ScalePageOptions,
): CanvasElement[] {
  const targetSet = new Set(targetIndices);

  return elements.map((element) => {
    if (!targetSet.has(element.pageIndex)) {
      return element;
    }

    const { width: curW, height: curH } = pageMetricsLookup(element.pageIndex);
    const targetW = Math.max(10, options.targetDimensions.width);
    const targetH = Math.max(10, options.targetDimensions.height);

    const metrics = computePageTransformMetrics(
      curW,
      curH,
      targetW,
      targetH,
      options.mode,
      options.alignment ?? 'center',
      options.constrainProportions ?? true,
    );

    const updated = { ...element };

    if (options.mode === 'proportional') {
      const sx = metrics.scaleX;
      const sy = metrics.scaleY;
      const shiftX = metrics.visualShiftX;
      const shiftY = metrics.visualShiftY;

      updated.x = Math.round((element.x * sx + shiftX) * 10) / 10;
      updated.y = Math.round((element.y * sy + shiftY) * 10) / 10;
      updated.width = Math.round(element.width * sx * 10) / 10;
      updated.height = Math.round(element.height * sy * 10) / 10;

      if (element.kind === 'text') {
        const textEl = updated as TextElement;
        if (textEl.fontSize) {
          textEl.fontSize = Math.max(4, Math.round(textEl.fontSize * sy * 10) / 10);
        }
        if (textEl.lines && Array.isArray(textEl.lines)) {
          textEl.lines = textEl.lines.map((ln) => ({
            ...ln,
            lineHeight: ln.lineHeight ? Math.round(ln.lineHeight * sy * 10) / 10 : ln.lineHeight,
            segments: ln.segments
              ? ln.segments.map((seg) => ({
                  ...seg,
                  fontSize: seg.fontSize ? Math.max(4, Math.round(seg.fontSize * sy * 10) / 10) : seg.fontSize,
                }))
              : ln.segments,
          }));
        }
      } else if (element.kind === 'shape') {
        const shapeEl = updated as ShapeElement;
        if (shapeEl.strokeWidth) {
          shapeEl.strokeWidth = Math.max(0.5, Math.round(shapeEl.strokeWidth * Math.min(sx, sy) * 10) / 10);
        }
      } else if (element.kind === 'path') {
        const pathEl = updated as PathElement;
        if (pathEl.strokeWidth) {
          pathEl.strokeWidth = Math.max(0.5, Math.round(pathEl.strokeWidth * Math.min(sx, sy) * 10) / 10);
        }
        if (pathEl.points && Array.isArray(pathEl.points)) {
          pathEl.points = pathEl.points.map((pt) => ({
            x: Math.round((pt.x * sx + shiftX) * 10) / 10,
            y: Math.round((pt.y * sy + shiftY) * 10) / 10,
          }));
        }
      }
    } else {
      // Pad margins: translate coordinates by visual shift
      const shiftX = metrics.visualShiftX;
      const shiftY = metrics.visualShiftY;

      updated.x = Math.round((element.x + shiftX) * 10) / 10;
      updated.y = Math.round((element.y + shiftY) * 10) / 10;

      if (element.kind === 'path') {
        const pathEl = updated as PathElement;
        if (pathEl.points && Array.isArray(pathEl.points)) {
          pathEl.points = pathEl.points.map((pt) => ({
            x: Math.round((pt.x + shiftX) * 10) / 10,
            y: Math.round((pt.y + shiftY) * 10) / 10,
          }));
        }
      }
    }

    return updated;
  });
}
