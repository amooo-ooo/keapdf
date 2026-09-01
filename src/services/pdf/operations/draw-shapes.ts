import type { PdfiumEngine } from '../../../core/pdfium-engine';
import { setPageObjectMatrix, getPageCropInfo } from '../../../core/pdfium-helpers';
import { parseColor, buildTransformMatrix } from '../utils';
import type { ShapeOptions } from './types';

/**
 * Draws a rectangle shape on a PDF page.
 *
 * @param engine The PDFium engine instance.
 * @param pageHandle Handle to the target PDF page.
 * @param options Styling and layout configuration for the rectangle.
 */
export function drawRectangle(
  engine: PdfiumEngine,
  pageHandle: number,
  options: ShapeOptions
): void {
  const mod = engine.getModule();
  const pageHeight = mod.FPDF_GetPageHeightF(pageHandle);
  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const cropOffset = cropInfo.hasCropBox ? { cropX: cropInfo.cropLeft, cropY: cropInfo.cropBottom } : undefined;
  const fill = parseColor(options.fill || 'transparent');
  const stroke = parseColor(options.stroke || '#000000');
  const strokeWidth = options.strokeWidth || 0;
  
  const rectObj = mod.FPDFPageObj_CreateNewRect(0, 0, options.width || 0, options.height || 0);
  if (rectObj) {
    mod.FPDFPageObj_SetFillColor(rectObj, fill.r, fill.g, fill.b, fill.a);
    if (strokeWidth > 0 && stroke.a > 0) {
      mod.FPDFPageObj_SetStrokeColor(rectObj, stroke.r, stroke.g, stroke.b, stroke.a);
      mod.FPDFPageObj_SetStrokeWidth(rectObj, strokeWidth);
      mod.FPDFPath_SetDrawMode(rectObj, fill.a > 0 ? 1 : 0, true);
    } else {
      mod.FPDFPath_SetDrawMode(rectObj, fill.a > 0 ? 1 : 0, false);
    }
    
    const matrix = buildTransformMatrix(
      options.x,
      options.y,
      options.width || 0,
      options.height || 0,
      pageHeight,
      options.rotation || 0,
      options.flipX || false,
      options.flipY || false,
      cropOffset
    );
    
    setPageObjectMatrix(engine, mod, rectObj, matrix);
    mod.FPDFPage_InsertObject(pageHandle, rectObj);
  }
}

/**
 * Draws a circle or ellipse shape on a PDF page using Bezier curves.
 *
 * @param engine The PDFium engine instance.
 * @param pageHandle Handle to the target PDF page.
 * @param options Styling and layout configuration for the circle.
 */
export function drawCircle(
  engine: PdfiumEngine,
  pageHandle: number,
  options: ShapeOptions
): void {
  const mod = engine.getModule();
  const pageHeight = mod.FPDF_GetPageHeightF(pageHandle);
  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const cropOffset = cropInfo.hasCropBox ? { cropX: cropInfo.cropLeft, cropY: cropInfo.cropBottom } : undefined;
  const fill = parseColor(options.fill || 'transparent');
  const stroke = parseColor(options.stroke || '#000000');
  const strokeWidth = options.strokeWidth || 0;
  
  const width = options.width || 0;
  const height = options.height || 0;
  const rx = width / 2;
  const ry = height / 2;
  const ox = rx;
  const oy = ry;
  const k = 0.552284749831;
  
  const pathObj = mod.FPDFPageObj_CreateNewPath(ox + rx, oy);
  if (pathObj) {
    mod.FPDFPath_BezierTo(pathObj, ox + rx, oy + k * ry, ox + k * rx, oy + ry, ox, oy + ry);
    mod.FPDFPath_BezierTo(pathObj, ox - k * rx, oy + ry, ox - rx, oy + k * ry, ox - rx, oy);
    mod.FPDFPath_BezierTo(pathObj, ox - rx, oy - k * ry, ox - k * rx, oy - ry, ox, oy - ry);
    mod.FPDFPath_BezierTo(pathObj, ox + k * rx, oy - ry, ox + rx, oy - k * ry, ox + rx, oy);
    mod.FPDFPath_Close(pathObj);
    
    mod.FPDFPageObj_SetFillColor(pathObj, fill.r, fill.g, fill.b, fill.a);
    if (strokeWidth > 0 && stroke.a > 0) {
      mod.FPDFPageObj_SetStrokeColor(pathObj, stroke.r, stroke.g, stroke.b, stroke.a);
      mod.FPDFPageObj_SetStrokeWidth(pathObj, strokeWidth);
      mod.FPDFPath_SetDrawMode(pathObj, fill.a > 0 ? 1 : 0, true);
    } else {
      mod.FPDFPath_SetDrawMode(pathObj, fill.a > 0 ? 1 : 0, false);
    }
    
    const matrix = buildTransformMatrix(
      options.x,
      options.y,
      width,
      height,
      pageHeight,
      options.rotation || 0,
      options.flipX || false,
      options.flipY || false,
      cropOffset
    );
    
    setPageObjectMatrix(engine, mod, pathObj, matrix);
    mod.FPDFPage_InsertObject(pageHandle, pathObj);
  }
}

/**
 * Draws a straight line shape on a PDF page.
 *
 * @param engine The PDFium engine instance.
 * @param pageHandle Handle to the target PDF page.
 * @param options Styling and layout configuration for the line.
 */
export function drawLine(
  engine: PdfiumEngine,
  pageHandle: number,
  options: ShapeOptions
): void {
  const mod = engine.getModule();
  const pageHeight = mod.FPDF_GetPageHeightF(pageHandle);
  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const cropOffset = cropInfo.hasCropBox ? { cropX: cropInfo.cropLeft, cropY: cropInfo.cropBottom } : undefined;
  const stroke = parseColor(options.stroke || '#000000');
  const strokeWidth = options.strokeWidth || 0;
  const width = options.width || 0;
  const height = options.height || 0;
  
  const pathObj = mod.FPDFPageObj_CreateNewPath(0, height / 2);
  if (pathObj) {
    mod.FPDFPath_LineTo(pathObj, width, height / 2);
    if (strokeWidth > 0 && stroke.a > 0) {
      mod.FPDFPageObj_SetStrokeColor(pathObj, stroke.r, stroke.g, stroke.b, stroke.a);
      mod.FPDFPageObj_SetStrokeWidth(pathObj, strokeWidth);
      mod.FPDFPath_SetDrawMode(pathObj, 0, true);
    }
    
    const matrix = buildTransformMatrix(
      options.x,
      options.y,
      width,
      height,
      pageHeight,
      options.rotation || 0,
      options.flipX || false,
      options.flipY || false,
      cropOffset
    );
    
    setPageObjectMatrix(engine, mod, pathObj, matrix);
    mod.FPDFPage_InsertObject(pageHandle, pathObj);
  }
}

/**
 * Draws an arrow shape on a PDF page consisting of a stem line and triangular arrowhead.
 *
 * @param engine The PDFium engine instance.
 * @param pageHandle Handle to the target PDF page.
 * @param options Styling and layout configuration for the arrow.
 */
export function drawArrow(
  engine: PdfiumEngine,
  pageHandle: number,
  options: ShapeOptions
): void {
  const mod = engine.getModule();
  const pageHeight = mod.FPDF_GetPageHeightF(pageHandle);
  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const cropOffset = cropInfo.hasCropBox ? { cropX: cropInfo.cropLeft, cropY: cropInfo.cropBottom } : undefined;
  const stroke = parseColor(options.stroke || '#000000');
  const strokeWidth = options.strokeWidth || 0;
  const width = options.width || 0;
  const height = options.height || 0;
  
  const matrix = buildTransformMatrix(
    options.x,
    options.y,
    width,
    height,
    pageHeight,
    options.rotation || 0,
    options.flipX || false,
    options.flipY || false,
    cropOffset
  );
  
  const pathObj = mod.FPDFPageObj_CreateNewPath(0, height / 2);
  if (pathObj) {
    mod.FPDFPath_LineTo(pathObj, width, height / 2);
    if (strokeWidth > 0 && stroke.a > 0) {
      mod.FPDFPageObj_SetStrokeColor(pathObj, stroke.r, stroke.g, stroke.b, stroke.a);
      mod.FPDFPageObj_SetStrokeWidth(pathObj, strokeWidth);
      mod.FPDFPath_SetDrawMode(pathObj, 0, true);
    }
    setPageObjectMatrix(engine, mod, pathObj, matrix);
    mod.FPDFPage_InsertObject(pageHandle, pathObj);
  }
  
  const headObj = mod.FPDFPageObj_CreateNewPath(width, height / 2);
  if (headObj) {
    mod.FPDFPath_LineTo(headObj, width - 10, height / 2 + 3.5);
    mod.FPDFPath_LineTo(headObj, width - 10, height / 2 - 3.5);
    mod.FPDFPath_Close(headObj);
    
    mod.FPDFPageObj_SetFillColor(headObj, stroke.r, stroke.g, stroke.b, stroke.a);
    mod.FPDFPath_SetDrawMode(headObj, 1, false);
    
    setPageObjectMatrix(engine, mod, headObj, matrix);
    mod.FPDFPage_InsertObject(pageHandle, headObj);
  }
}

/**
 * Draws a polyline/path shape on a PDF page.
 *
 * @param engine The PDFium engine instance.
 * @param pageHandle Handle to the target PDF page.
 * @param options Styling and layout configuration for the path.
 */
export function drawPath(
  engine: PdfiumEngine,
  pageHandle: number,
  options: import('./types').PathOptions
): void {
  const mod = engine.getModule();
  const pageHeight = mod.FPDF_GetPageHeightF(pageHandle);
  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const cropOffset = cropInfo.hasCropBox ? { cropX: cropInfo.cropLeft, cropY: cropInfo.cropBottom } : undefined;
  const stroke = parseColor(options.stroke || '#000000');
  const strokeWidth = options.strokeWidth || 0;
  
  if (!options.points || options.points.length === 0) return;
  
  const p0 = options.points[0];
  const pathObj = mod.FPDFPageObj_CreateNewPath(p0.x, p0.y);
  if (pathObj) {
    for (let i = 1; i < options.points.length; i++) {
      const p = options.points[i];
      mod.FPDFPath_LineTo(pathObj, p.x, p.y);
    }
    
    if (strokeWidth > 0 && stroke.a > 0) {
      if (options.isHighlight) {
        // Use a blend mode for highlight (multiply)
        // PDFium requires using FPDFPageObj_SetBlendMode which may or may not be exposed.
        // We'll rely on opacity and stroke color.
        mod.FPDFPageObj_SetStrokeColor(pathObj, stroke.r, stroke.g, stroke.b, Math.round((options.opacity ?? 0.4) * 255));
      } else {
        mod.FPDFPageObj_SetStrokeColor(pathObj, stroke.r, stroke.g, stroke.b, stroke.a);
      }
      mod.FPDFPageObj_SetStrokeWidth(pathObj, strokeWidth);
      mod.FPDFPath_SetDrawMode(pathObj, 0, true);
      
      // Set line cap and join for smoother freehand drawing
      mod.FPDFPageObj_SetLineCap(pathObj, 1); // Round cap
      mod.FPDFPageObj_SetLineJoin(pathObj, 1); // Round join
    }
    
    // We apply rotation/flip matrix, but x/y are typically absolute for path points.
    // However, if the points are relative to x/y, we need to translate.
    // In our PDF page coords, points are absolute, so we translate by 0,0, but still use buildTransformMatrix for pageHeight flipping.
    const matrix = buildTransformMatrix(
      0, // The points already contain the absolute coordinates
      0,
      0,
      0,
      pageHeight,
      options.rotation || 0,
      options.flipX || false,
      options.flipY !== undefined ? !options.flipY : true, // Default to true to invert Y-axis for PDF space
      cropOffset
    );
    
    setPageObjectMatrix(engine, mod, pathObj, matrix);
    mod.FPDFPage_InsertObject(pageHandle, pathObj);
  }
}
