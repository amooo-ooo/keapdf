import type { CanvasElement, PathElement, TextElement, ShapeElement, FormFieldElement } from '../../../stores/canvas-types';
import { scaleLetterSpacingValue } from '../../../core/typography-metrics';

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
  const { PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();
  const targetIndices = options.pageIndices.filter((idx) => idx >= 0 && idx < totalPages);

  const translateAnnotationsOnPage = (
    page: ReturnType<typeof pdfDoc.getPage>,
    tx: number,
    ty: number,
  ): void => {
    if (tx === 0 && ty === 0) return;
    try {
      const annots = page.node.Annots();
      if (!annots) return;
      for (let i = 0; i < annots.size(); i++) {
        const annotDict = pdfDoc.context.lookup(annots.get(i));
        if (!(annotDict instanceof PDFDict)) continue;

        const readPdfNumber = (val: unknown): number | undefined =>
          val instanceof PDFNumber ? val.asNumber() : undefined;

        const rect = annotDict.lookup(PDFName.of('Rect'));
        if (rect instanceof PDFArray && rect.size() >= 4) {
          const x1 = readPdfNumber(rect.lookup(0));
          const y1 = readPdfNumber(rect.lookup(1));
          const x2 = readPdfNumber(rect.lookup(2));
          const y2 = readPdfNumber(rect.lookup(3));
          if (
            typeof x1 === 'number' &&
            typeof y1 === 'number' &&
            typeof x2 === 'number' &&
            typeof y2 === 'number'
          ) {
            rect.set(0, PDFNumber.of(x1 + tx));
            rect.set(1, PDFNumber.of(y1 + ty));
            rect.set(2, PDFNumber.of(x2 + tx));
            rect.set(3, PDFNumber.of(y2 + ty));
          }
        }

        const quadPoints = annotDict.lookup(PDFName.of('QuadPoints'));
        if (quadPoints instanceof PDFArray) {
          for (let q = 0; q + 1 < quadPoints.size(); q += 2) {
            const qx = readPdfNumber(quadPoints.lookup(q));
            const qy = readPdfNumber(quadPoints.lookup(q + 1));
            if (typeof qx === 'number' && typeof qy === 'number') {
              quadPoints.set(q, PDFNumber.of(qx + tx));
              quadPoints.set(q + 1, PDFNumber.of(qy + ty));
            }
          }
        }

        const inkList = annotDict.lookup(PDFName.of('InkList'));
        if (inkList instanceof PDFArray) {
          for (let s = 0; s < inkList.size(); s++) {
            const stroke = inkList.lookup(s);
            if (stroke instanceof PDFArray) {
              for (let p = 0; p + 1 < stroke.size(); p += 2) {
                const px = readPdfNumber(stroke.lookup(p));
                const py = readPdfNumber(stroke.lookup(p + 1));
                if (typeof px === 'number' && typeof py === 'number') {
                  stroke.set(p, PDFNumber.of(px + tx));
                  stroke.set(p + 1, PDFNumber.of(py + ty));
                }
              }
            }
          }
        }
      }
    } catch {
      // Ignore malformed annotation dictionaries during page scaling
    }
  };

  for (const pageIdx of targetIndices) {
    const page = pdfDoc.getPage(pageIdx);
    const prevMediaBox = page.getMediaBox();
    const prevCropBox = page.getCropBox();
    const hadCustomCropBox =
      Boolean(prevCropBox) &&
      (Math.abs(prevCropBox.x - prevMediaBox.x) > 0.01 ||
        Math.abs(prevCropBox.y - prevMediaBox.y) > 0.01 ||
        Math.abs(prevCropBox.width - prevMediaBox.width) > 0.01 ||
        Math.abs(prevCropBox.height - prevMediaBox.height) > 0.01);

    const { width: curW, height: curH } = page.getSize();
    const targetW = Math.max(10, options.targetDimensions.width);
    const targetH = Math.max(10, options.targetDimensions.height);

    const pageRot = ((page.getRotation().angle % 360) + 360) % 360;
    const isOrthogonal = pageRot === 90 || pageRot === 270;

    const curVisualW = isOrthogonal ? curH : curW;
    const curVisualH = isOrthogonal ? curW : curH;

    const metrics = computePageTransformMetrics(
      curVisualW,
      curVisualH,
      targetW,
      targetH,
      options.mode,
      options.alignment ?? 'center',
      options.constrainProportions ?? true,
    );

    // Apply new page box dimensions calibrated to rotation
    const targetUserW = isOrthogonal ? targetH : targetW;
    const targetUserH = isOrthogonal ? targetW : targetH;
    page.setSize(targetUserW, targetUserH);

    const effSx = isOrthogonal ? metrics.scaleY : metrics.scaleX;
    const effSy = isOrthogonal ? metrics.scaleX : metrics.scaleY;
    const effTx = isOrthogonal ? metrics.ty : metrics.tx;
    const effTy = isOrthogonal ? metrics.tx : metrics.ty;

    if (options.mode === 'proportional') {
      page.scaleContent(effSx, effSy);
      if (effTx !== 0 || effTy !== 0) {
        page.translateContent(effTx, effTy);
      }
      page.scaleAnnotations(effSx, effSy);
      if (effTx !== 0 || effTy !== 0) {
        translateAnnotationsOnPage(page, effTx, effTy);
      }
      if (hadCustomCropBox && prevCropBox) {
        page.setCropBox(
          prevCropBox.x * effSx + effTx,
          prevCropBox.y * effSy + effTy,
          prevCropBox.width * effSx,
          prevCropBox.height * effSy,
        );
      } else if (prevCropBox) {
        page.setCropBox(0, 0, targetUserW, targetUserH);
      }
    } else {
      // Pad margins: translate existing content into target alignment
      if (effTx !== 0 || effTy !== 0) {
        page.translateContent(effTx, effTy);
        translateAnnotationsOnPage(page, effTx, effTy);
      }
      if (hadCustomCropBox && prevCropBox) {
        page.setCropBox(
          prevCropBox.x + effTx,
          prevCropBox.y + effTy,
          prevCropBox.width,
          prevCropBox.height,
        );
      } else if (prevCropBox) {
        page.setCropBox(0, 0, targetUserW, targetUserH);
      }
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
        if (textEl.lineHeight) {
          textEl.lineHeight = Math.round(textEl.lineHeight * sy * 10) / 10;
        }
        if (textEl.letterSpacing) {
          textEl.letterSpacing = scaleLetterSpacingValue(textEl.letterSpacing, sx);
        }
        if (textEl.wordSpacing !== undefined) {
          textEl.wordSpacing = Math.round(textEl.wordSpacing * sx * 100) / 100;
        }
        if (textEl.lines && Array.isArray(textEl.lines)) {
          textEl.lines = textEl.lines.map((ln) => ({
            ...ln,
            fontSize: ln.fontSize ? Math.max(4, Math.round(ln.fontSize * sy * 10) / 10) : ln.fontSize,
            lineHeight: ln.lineHeight ? Math.round(ln.lineHeight * sy * 10) / 10 : ln.lineHeight,
            letterSpacing: ln.letterSpacing ? scaleLetterSpacingValue(ln.letterSpacing, sx) : ln.letterSpacing,
            wordSpacing: ln.wordSpacing !== undefined ? Math.round(ln.wordSpacing * sx * 100) / 100 : ln.wordSpacing,
            left: ln.left !== undefined ? Math.round((ln.left * sx + shiftX) * 10) / 10 : ln.left,
            top: ln.top !== undefined ? Math.round((ln.top * sy + shiftY) * 10) / 10 : ln.top,
            width: ln.width !== undefined ? Math.round(ln.width * sx * 10) / 10 : ln.width,
            height: ln.height !== undefined ? Math.round(ln.height * sy * 10) / 10 : ln.height,
            baselineY: ln.baselineY !== undefined ? Math.round((ln.baselineY * sy + shiftY) * 10) / 10 : ln.baselineY,
            segments: ln.segments
              ? ln.segments.map((seg) => ({
                  ...seg,
                  fontSize: seg.fontSize ? Math.max(4, Math.round(seg.fontSize * sy * 10) / 10) : seg.fontSize,
                  letterSpacing: seg.letterSpacing ? scaleLetterSpacingValue(seg.letterSpacing, sx) : seg.letterSpacing,
                  wordSpacing: seg.wordSpacing !== undefined ? Math.round(seg.wordSpacing * sx * 100) / 100 : seg.wordSpacing,
                  left: seg.left !== undefined ? Math.round((seg.left * sx + shiftX) * 10) / 10 : seg.left,
                  top: seg.top !== undefined ? Math.round((seg.top * sy + shiftY) * 10) / 10 : seg.top,
                  width: seg.width !== undefined ? Math.round(seg.width * sx * 10) / 10 : seg.width,
                  height: seg.height !== undefined ? Math.round(seg.height * sy * 10) / 10 : seg.height,
                }))
              : ln.segments,
          }));
        }
        if (textEl.segments && Array.isArray(textEl.segments)) {
          textEl.segments = textEl.segments.map((seg) => ({
            ...seg,
            fontSize: seg.fontSize ? Math.max(4, Math.round(seg.fontSize * sy * 10) / 10) : seg.fontSize,
            letterSpacing: seg.letterSpacing ? scaleLetterSpacingValue(seg.letterSpacing, sx) : seg.letterSpacing,
            wordSpacing: seg.wordSpacing !== undefined ? Math.round(seg.wordSpacing * sx * 100) / 100 : seg.wordSpacing,
            left: seg.left !== undefined ? Math.round((seg.left * sx + shiftX) * 10) / 10 : seg.left,
            top: seg.top !== undefined ? Math.round((seg.top * sy + shiftY) * 10) / 10 : seg.top,
            width: seg.width !== undefined ? Math.round(seg.width * sx * 10) / 10 : seg.width,
            height: seg.height !== undefined ? Math.round(seg.height * sy * 10) / 10 : seg.height,
          }));
        }
        if (textEl.originalSpan) {
          const orig = textEl.originalSpan;
          textEl.originalSpan = {
            ...orig,
            left: Math.round((orig.left * sx + shiftX) * 10) / 10,
            top: Math.round((orig.top * sy + shiftY) * 10) / 10,
            width: Math.round(orig.width * sx * 10) / 10,
            height: Math.round(orig.height * sy * 10) / 10,
            fontSize: Math.max(4, Math.round(orig.fontSize * sy * 10) / 10),
            lineHeight: orig.lineHeight ? Math.round(orig.lineHeight * sy * 10) / 10 : orig.lineHeight,
            letterSpacing: orig.letterSpacing ? scaleLetterSpacingValue(orig.letterSpacing, sx) : orig.letterSpacing,
            wordSpacing: orig.wordSpacing !== undefined ? Math.round(orig.wordSpacing * sx * 100) / 100 : orig.wordSpacing,
            baselineY: orig.baselineY !== undefined ? Math.round((orig.baselineY * sy + metrics.ty) * 10) / 10 : orig.baselineY,
          };
        }
      } else if (element.kind === 'form-field') {
        const formEl = updated as FormFieldElement;
        const sMin = Math.min(sx, sy);
        if (formEl.fontSize) {
          formEl.fontSize = Math.max(4, Math.round(formEl.fontSize * sMin * 10) / 10);
        }
        if (formEl.borderWidth !== undefined) {
          formEl.borderWidth = Math.max(0.5, Math.round(formEl.borderWidth * sMin * 10) / 10);
        }
        if (formEl.borderRadius !== undefined) {
          formEl.borderRadius = Math.round(formEl.borderRadius * sMin * 10) / 10;
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

      if (element.kind === 'text') {
        const textEl = updated as TextElement;
        if (textEl.lines && Array.isArray(textEl.lines)) {
          textEl.lines = textEl.lines.map((ln) => ({
            ...ln,
            left: ln.left !== undefined ? Math.round((ln.left + shiftX) * 10) / 10 : ln.left,
            top: ln.top !== undefined ? Math.round((ln.top + shiftY) * 10) / 10 : ln.top,
            baselineY: ln.baselineY !== undefined ? Math.round((ln.baselineY + shiftY) * 10) / 10 : ln.baselineY,
            segments: ln.segments
              ? ln.segments.map((seg) => ({
                  ...seg,
                  left: seg.left !== undefined ? Math.round((seg.left + shiftX) * 10) / 10 : seg.left,
                  top: seg.top !== undefined ? Math.round((seg.top + shiftY) * 10) / 10 : seg.top,
                }))
              : ln.segments,
          }));
        }
        if (textEl.segments && Array.isArray(textEl.segments)) {
          textEl.segments = textEl.segments.map((seg) => ({
            ...seg,
            left: seg.left !== undefined ? Math.round((seg.left + shiftX) * 10) / 10 : seg.left,
            top: seg.top !== undefined ? Math.round((seg.top + shiftY) * 10) / 10 : seg.top,
          }));
        }
        if (textEl.originalSpan) {
          const orig = textEl.originalSpan;
          textEl.originalSpan = {
            ...orig,
            left: Math.round((orig.left + shiftX) * 10) / 10,
            top: Math.round((orig.top + shiftY) * 10) / 10,
            baselineY: orig.baselineY !== undefined ? Math.round((orig.baselineY + metrics.ty) * 10) / 10 : orig.baselineY,
          };
        }
      } else if (element.kind === 'path') {
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
