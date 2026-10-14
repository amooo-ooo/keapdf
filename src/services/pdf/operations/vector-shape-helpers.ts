import type { ExtendedWrappedPdfiumModule, PdfiumEngine } from '../../../core/pdfium-engine';
import type { PageCropInfo, PdfMatrix } from '../../../core/types';
import { pdfToDomCoords } from '../../../core/pdfium-helpers';

/**
 * Result of extracting raw PDFium path styling and geometry.
 */
export interface RawPathExtractionResult {
  fill: string;
  stroke: string;
  strokeWidth: number;
  variant: 'rectangle' | 'circle' | 'line' | 'arrow' | 'path';
  opacity: number;
  hasFill: boolean;
  hasStroke: boolean;
  fillMode: number;
  fillRule?: 'nonzero' | 'evenodd';
  strokeLineCap: 'butt' | 'round' | 'square';
  strokeLineJoin: 'miter' | 'round' | 'bevel';
  svgPath?: string;
  viewBox?: string;
  baseWidth?: number;
  baseHeight?: number;
}

/**
 * Formats RGBA colour components into standard CSS string.
 */
export function rgbaToCss(r: number, g: number, b: number, a: number): string {
  if (a <= 0) return 'transparent';
  const clampedR = Math.max(0, Math.min(255, Math.round(r)));
  const clampedG = Math.max(0, Math.min(255, Math.round(g)));
  const clampedB = Math.max(0, Math.min(255, Math.round(b)));
  const clampedA = Math.max(0, Math.min(255, Math.round(a)));

  if (clampedA === 255) {
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${toHex(clampedR)}${toHex(clampedG)}${toHex(clampedB)}`;
  }
  return `rgba(${clampedR}, ${clampedG}, ${clampedB}, ${Number((clampedA / 255).toFixed(3))})`;
}

/**
 * Maps PDFium line cap integer to standard SVG/CSS stroke-linecap token.
 */
export function parsePdfLineCap(cap: number): 'butt' | 'round' | 'square' {
  switch (cap) {
    case 1:
      return 'round';
    case 2:
      return 'square';
    case 0:
    default:
      return 'butt';
  }
}

/**
 * Maps PDFium line join integer to standard SVG/CSS stroke-linejoin token.
 */
export function parsePdfLineJoin(join: number): 'miter' | 'round' | 'bevel' {
  switch (join) {
    case 1:
      return 'round';
    case 2:
      return 'bevel';
    case 0:
    default:
      return 'miter';
  }
}

/**
 * Scratch memory pointers allocated for path extraction to avoid repeated malloc.
 */
export interface PathExtractionPointers {
  rPtr: number;
  gPtr: number;
  bPtr: number;
  aPtr: number;
  wPtr: number;
  fillModePtr: number;
  strokePtr: number;
  xPtr: number;
  yPtr: number;
}

/**
 * Allocates scratch memory buffers required for path extraction.
 */
export function allocatePathPointers(engine: PdfiumEngine): PathExtractionPointers {
  return {
    rPtr: engine.allocateMemory(4),
    gPtr: engine.allocateMemory(4),
    bPtr: engine.allocateMemory(4),
    aPtr: engine.allocateMemory(4),
    wPtr: engine.allocateMemory(4),
    fillModePtr: engine.allocateMemory(4),
    strokePtr: engine.allocateMemory(4),
    xPtr: engine.allocateMemory(4),
    yPtr: engine.allocateMemory(4),
  };
}

/**
 * Frees scratch memory buffers after path extraction completes.
 */
export function freePathPointers(engine: PdfiumEngine, ptrs: PathExtractionPointers): void {
  engine.freeMemory(ptrs.rPtr);
  engine.freeMemory(ptrs.gPtr);
  engine.freeMemory(ptrs.bPtr);
  engine.freeMemory(ptrs.aPtr);
  engine.freeMemory(ptrs.wPtr);
  engine.freeMemory(ptrs.fillModePtr);
  engine.freeMemory(ptrs.strokePtr);
  engine.freeMemory(ptrs.xPtr);
  engine.freeMemory(ptrs.yPtr);
}

/**
 * Applies a 2D affine transformation matrix to PDF point coordinates.
 */
function transformPdfPoint(x: number, y: number, matrix?: PdfMatrix | null): { x: number; y: number } {
  if (!matrix) return { x, y };
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

/**
 * Extracts complete styling, stroke parameters, fill colour, opacity, and geometry
 * from a native PDFium path object handle.
 */
export function extractRawPathProperties(
  mod: ExtendedWrappedPdfiumModule,
  objHandle: number,
  cropInfo: PageCropInfo,
  domLeft: number,
  domTop: number,
  domWidth: number,
  domHeight: number,
  ptrs: PathExtractionPointers,
  matrix?: PdfMatrix | null
): RawPathExtractionResult {
  const heapU32 = mod.pdfium.HEAPU32;
  const heap32 = mod.pdfium.HEAP32;
  const heapF32 = mod.pdfium.HEAPF32;

  // Draw mode (fill mode and stroke active flag)
  let fillMode = 0;
  let hasStroke = false;
  if (typeof mod.FPDFPath_GetDrawMode === 'function') {
    const okDraw = mod.FPDFPath_GetDrawMode(objHandle, ptrs.fillModePtr, ptrs.strokePtr);
    if (okDraw) {
      fillMode = heap32[ptrs.fillModePtr >> 2];
      hasStroke = Boolean(heap32[ptrs.strokePtr >> 2]);
    }
  }

  // Fill colour
  let fill = 'transparent';
  let fillAlpha = 0;
  const hasFill = fillMode !== 0;
  if (typeof mod.FPDFPageObj_GetFillColor === 'function') {
    const okFill = mod.FPDFPageObj_GetFillColor(objHandle, ptrs.rPtr, ptrs.gPtr, ptrs.bPtr, ptrs.aPtr);
    if (okFill) {
      const fr = heapU32[ptrs.rPtr >> 2];
      const fg = heapU32[ptrs.gPtr >> 2];
      const fb = heapU32[ptrs.bPtr >> 2];
      const fa = heapU32[ptrs.aPtr >> 2];
      fillAlpha = fa;
      if (hasFill && fa > 0) {
        fill = rgbaToCss(fr, fg, fb, fa);
      }
    }
  }

  // Stroke width
  let strokeWidth = 0;
  if (typeof mod.FPDFPageObj_GetStrokeWidth === 'function') {
    const okWidth = mod.FPDFPageObj_GetStrokeWidth(objHandle, ptrs.wPtr);
    if (okWidth) {
      strokeWidth = Math.max(0, heapF32[ptrs.wPtr >> 2]);
    }
  }

  // Stroke colour
  let stroke = 'transparent';
  let strokeAlpha = 0;
  if (typeof mod.FPDFPageObj_GetStrokeColor === 'function') {
    const okStroke = mod.FPDFPageObj_GetStrokeColor(objHandle, ptrs.rPtr, ptrs.gPtr, ptrs.bPtr, ptrs.aPtr);
    if (okStroke) {
      const sr = heapU32[ptrs.rPtr >> 2];
      const sg = heapU32[ptrs.gPtr >> 2];
      const sb = heapU32[ptrs.bPtr >> 2];
      const sa = heapU32[ptrs.aPtr >> 2];
      strokeAlpha = sa;
      if (hasStroke && sa > 0) {
        stroke = rgbaToCss(sr, sg, sb, sa);
      }
    }
  }

  if (!hasStroke) {
    stroke = 'transparent';
    strokeWidth = 0;
  }

  // Line cap and join
  let strokeLineCap: 'butt' | 'round' | 'square' = 'butt';
  if (typeof mod.FPDFPageObj_GetLineCap === 'function') {
    strokeLineCap = parsePdfLineCap(mod.FPDFPageObj_GetLineCap(objHandle));
  }

  let strokeLineJoin: 'miter' | 'round' | 'bevel' = 'miter';
  if (typeof mod.FPDFPageObj_GetLineJoin === 'function') {
    strokeLineJoin = parsePdfLineJoin(mod.FPDFPageObj_GetLineJoin(objHandle));
  }

  // Opacity calculation
  const maxAlpha = Math.max(hasFill ? fillAlpha : 0, hasStroke ? strokeAlpha : 0);
  const opacity = maxAlpha > 0 ? Number((maxAlpha / 255).toFixed(3)) : 1;

  // Path segments and geometry
  let segCount = 0;
  if (typeof mod.FPDFPath_CountSegments === 'function') {
    segCount = mod.FPDFPath_CountSegments(objHandle);
  }

  let svgPath: string | undefined;
  let variant: 'rectangle' | 'circle' | 'line' | 'arrow' | 'path' = 'rectangle';

  if (segCount > 0 && typeof mod.FPDFPath_GetPathSegment === 'function' && typeof mod.FPDFPathSegment_GetPoint === 'function') {
    const rawPoints: Array<{ relX: number; relY: number; type: number; isClose: boolean }> = [];
    let pathD = '';
    let s = 0;

    while (s < segCount) {
      const segHandle = mod.FPDFPath_GetPathSegment(objHandle, s);
      if (!segHandle) {
        s++;
        continue;
      }

      const segType = typeof mod.FPDFPathSegment_GetType === 'function' ? mod.FPDFPathSegment_GetType(segHandle) : 0;
      const isClose = typeof mod.FPDFPathSegment_GetClose === 'function' ? Boolean(mod.FPDFPathSegment_GetClose(segHandle)) : false;
      const okPt = mod.FPDFPathSegment_GetPoint(segHandle, ptrs.xPtr, ptrs.yPtr);
      if (!okPt) {
        s++;
        continue;
      }

      const pdfX = heapF32[ptrs.xPtr >> 2];
      const pdfY = heapF32[ptrs.yPtr >> 2];
      const tPt = transformPdfPoint(pdfX, pdfY, matrix);
      const domPt = pdfToDomCoords(tPt.x, tPt.y, cropInfo);
      const relX = Number((domPt.x - domLeft).toFixed(2));
      const relY = Number((domPt.y - domTop).toFixed(2));

      rawPoints.push({ relX, relY, type: segType, isClose });

      if (segType === 2) {
        // FPDF_SEGMENT_MOVETO
        pathD += `M ${relX} ${relY} `;
        s++;
      } else if (segType === 0) {
        // FPDF_SEGMENT_LINETO
        pathD += `L ${relX} ${relY} `;
        if (isClose) pathD += 'Z ';
        s++;
      } else if (segType === 1) {
        // FPDF_SEGMENT_BEZIERTO (group of 3 points: cp1, cp2, end)
        const cp1X = relX;
        const cp1Y = relY;

        let cp2X = cp1X;
        let cp2Y = cp1Y;
        let endX = cp1X;
        let endY = cp1Y;
        let bezierClose = false;

        if (s + 1 < segCount) {
          const seg2 = mod.FPDFPath_GetPathSegment(objHandle, s + 1);
          if (seg2 && mod.FPDFPathSegment_GetPoint(seg2, ptrs.xPtr, ptrs.yPtr)) {
            const pt2PdfX = heapF32[ptrs.xPtr >> 2];
            const pt2PdfY = heapF32[ptrs.yPtr >> 2];
            const tPt2 = transformPdfPoint(pt2PdfX, pt2PdfY, matrix);
            const pt2 = pdfToDomCoords(tPt2.x, tPt2.y, cropInfo);
            cp2X = Number((pt2.x - domLeft).toFixed(2));
            cp2Y = Number((pt2.y - domTop).toFixed(2));
            rawPoints.push({ relX: cp2X, relY: cp2Y, type: 1, isClose: false });
          }
        }

        if (s + 2 < segCount) {
          const seg3 = mod.FPDFPath_GetPathSegment(objHandle, s + 2);
          if (seg3 && mod.FPDFPathSegment_GetPoint(seg3, ptrs.xPtr, ptrs.yPtr)) {
            const pt3PdfX = heapF32[ptrs.xPtr >> 2];
            const pt3PdfY = heapF32[ptrs.yPtr >> 2];
            const tPt3 = transformPdfPoint(pt3PdfX, pt3PdfY, matrix);
            const pt3 = pdfToDomCoords(tPt3.x, tPt3.y, cropInfo);
            endX = Number((pt3.x - domLeft).toFixed(2));
            endY = Number((pt3.y - domTop).toFixed(2));
            bezierClose = typeof mod.FPDFPathSegment_GetClose === 'function' ? Boolean(mod.FPDFPathSegment_GetClose(seg3)) : false;
            rawPoints.push({ relX: endX, relY: endY, type: 1, isClose: bezierClose });
          }
        }

        pathD += `C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY} `;
        if (bezierClose) pathD += 'Z ';
        s += 3;
      } else {
        s++;
      }
    }

    svgPath = pathD.trim();

    // Classify shape variant from segment patterns
    if (segCount === 2 && !hasFill) {
      variant = 'line';
    } else if (segCount === 13 && rawPoints.filter((p) => p.type === 1).length >= 12) {
      variant = 'circle';
    } else if (segCount === 5 && rawPoints.every((p) => p.type === 2 || p.type === 0)) {
      variant = 'rectangle';
    } else if (segCount > 2) {
      variant = 'path';
    }
  }

  const roundedW = Math.max(1, Math.round(domWidth));
  const roundedH = Math.max(1, Math.round(domHeight));
  const viewBox = `0 0 ${roundedW} ${roundedH}`;
  const fillRule: 'nonzero' | 'evenodd' = fillMode === 2 ? 'evenodd' : 'nonzero';

  return {
    fill,
    stroke,
    strokeWidth,
    variant,
    opacity,
    hasFill,
    hasStroke,
    fillMode,
    fillRule,
    strokeLineCap,
    strokeLineJoin,
    svgPath,
    viewBox,
    baseWidth: domWidth,
    baseHeight: domHeight,
  };
}
