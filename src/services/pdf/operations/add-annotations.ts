import type { PdfiumEngine } from '../../../core/pdfium-engine';
import { encodeUtf16Le } from '../../../core/pdfium-helpers';
import { parseColor } from '../utils';
import type { ShapeOptions, PathOptions } from './types';

const FPDF_ANNOT_TEXT = 1;
const FPDF_ANNOT_HIGHLIGHT = 8;
const FPDF_ANNOT_INK = 15;

/**
 * Helper to allocate and set an FS_RECTF structure
 */
function createRect(engine: PdfiumEngine, x: number, y: number, width: number, height: number, pageHeight: number): number {
  const rectPtr = engine.allocateMemory(16); // 4 floats
  const heap = engine.getModule().pdfium.HEAPF32;
  
  // PDF coordinates: origin at bottom-left.
  const left = x;
  const right = x + width;
  const top = pageHeight - y;
  const bottom = pageHeight - (y + height);

  heap[rectPtr >> 2] = left;
  heap[(rectPtr >> 2) + 1] = bottom;
  heap[(rectPtr >> 2) + 2] = right;
  heap[(rectPtr >> 2) + 3] = top;
  
  return rectPtr;
}

/**
 * Adds a Highlight annotation to the PDF page.
 */
export function addHighlightAnnotation(
  engine: PdfiumEngine,
  pageHandle: number,
  options: ShapeOptions
): void {
  const mod = engine.getModule();
  const pageHeight = mod.FPDF_GetPageHeightF(pageHandle);
  
  // Create highlight annotation
  const annotHandle = mod.FPDFPage_CreateAnnot(pageHandle, FPDF_ANNOT_HIGHLIGHT);
  if (!annotHandle) return;

  const width = options.width || 0;
  const height = options.height || 0;

  // Set Bounding Box
  const rectPtr = createRect(engine, options.x, options.y, width, height, pageHeight);
  mod.FPDFAnnot_SetRect(annotHandle, rectPtr);
  engine.freeMemory(rectPtr);

  // Set Color
  const fill = parseColor(options.fill || '#ffff00');
  mod.FPDFAnnot_SetColor(annotHandle, 1, fill.r, fill.g, fill.b, fill.a);

  // Set Flags (Print = 4)
  if (mod.FPDFAnnot_SetFlags) {
    mod.FPDFAnnot_SetFlags(annotHandle, 4);
  }

  // Note: Highlight annotations technically require QuadPoints to correctly select text.
  // FPDFAnnot_AppendAttachmentPoints adds a quadpoint based on 4 points (8 floats).
  const quadPtr = engine.allocateMemory(32); // 8 floats
  const heap = mod.pdfium.HEAPF32;
  
  // Point order for QuadPoints: bottom-left, bottom-right, top-right, top-left
  // Actually PDF specification requires: x1 y1 x2 y2 x3 y3 x4 y4 (in counter-clockwise or specific order)
  // Standard QuadPoints order: TopLeft, TopRight, BottomLeft, BottomRight
  const left = options.x;
  const right = options.x + width;
  const top = pageHeight - options.y;
  const bottom = pageHeight - (options.y + height);

  heap[quadPtr >> 2] = left;
  heap[(quadPtr >> 2) + 1] = top;
  heap[(quadPtr >> 2) + 2] = right;
  heap[(quadPtr >> 2) + 3] = top;
  heap[(quadPtr >> 2) + 4] = left;
  heap[(quadPtr >> 2) + 5] = bottom;
  heap[(quadPtr >> 2) + 6] = right;
  heap[(quadPtr >> 2) + 7] = bottom;

  if (mod.FPDFAnnot_AppendAttachmentPoints) {
    mod.FPDFAnnot_AppendAttachmentPoints(annotHandle, quadPtr);
  }
  engine.freeMemory(quadPtr);

  // Close annotation to commit changes and free resources
  if (mod.FPDFPage_CloseAnnot) {
    mod.FPDFPage_CloseAnnot(annotHandle);
  }
}

/**
 * Adds an Ink annotation (freehand drawing) to the PDF page.
 */
export function addInkAnnotation(
  engine: PdfiumEngine,
  pageHandle: number,
  options: PathOptions
): void {
  const mod = engine.getModule();
  const pageHeight = mod.FPDF_GetPageHeightF(pageHandle);

  if (!options.points || options.points.length === 0) return;

  // Create Ink annotation
  const annotHandle = mod.FPDFPage_CreateAnnot(pageHandle, FPDF_ANNOT_INK);
  if (!annotHandle) return;

  // Calculate bounding box
  let minX = options.points[0].x;
  let minY = options.points[0].y;
  let maxX = minX;
  let maxY = minY;
  
  for (const p of options.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const strokeWidth = options.strokeWidth || 1;
  // Use generous padding to prevent clipping at miter joins and sharp angles.
  const padding = strokeWidth * 1.5;
  
  const rectPtr = createRect(
    engine, 
    minX - padding, 
    minY - padding, 
    (maxX - minX) + strokeWidth, 
    (maxY - minY) + strokeWidth, 
    pageHeight
  );
  mod.FPDFAnnot_SetRect(annotHandle, rectPtr);
  engine.freeMemory(rectPtr);

  // Set Color
  const stroke = parseColor(options.stroke || '#000000');
  const alpha = typeof options.opacity === 'number' ? Math.round(options.opacity * 255) : stroke.a;
  mod.FPDFAnnot_SetColor(annotHandle, 1, stroke.r, stroke.g, stroke.b, alpha);
  
  // Set Flags (Print = 4)
  if (mod.FPDFAnnot_SetFlags) {
    mod.FPDFAnnot_SetFlags(annotHandle, 4);
  }

  // Set Border (Stroke Width)
  if (mod.FPDFAnnot_SetBorder) {
    mod.FPDFAnnot_SetBorder(annotHandle, 0, 0, strokeWidth);
  }
  
  // Add Ink Stroke points
  if (mod.FPDFAnnot_AddInkStroke) {
    const pointCount = options.points.length;
    const pathPtr = engine.allocateMemory(pointCount * 8); // 2 floats per point
    const heap = mod.pdfium.HEAPF32;
    
    for (let i = 0; i < pointCount; i++) {
      const p = options.points[i];
      heap[(pathPtr >> 2) + i * 2] = p.x;
      heap[(pathPtr >> 2) + i * 2 + 1] = pageHeight - p.y;
    }
    
    mod.FPDFAnnot_AddInkStroke(annotHandle, pathPtr, pointCount);
    engine.freeMemory(pathPtr);
  }

  // Close annotation to commit changes and free resources
  if (mod.FPDFPage_CloseAnnot) {
    mod.FPDFPage_CloseAnnot(annotHandle);
  }
}

/** Options for sticky note text annotation. */
export interface NoteAnnotationOptions {
  x: number;
  y: number;
  width?: number;
  height?: number;
  author?: string;
  contents: string;
  color?: string;
}

/**
 * Adds a Text (Sticky Note) annotation to the PDF page.
 */
export function addTextAnnotation(
  engine: PdfiumEngine,
  pageHandle: number,
  options: NoteAnnotationOptions
): void {
  const mod = engine.getModule();
  const pageHeight = mod.FPDF_GetPageHeightF(pageHandle);

  const annotHandle = mod.FPDFPage_CreateAnnot(pageHandle, FPDF_ANNOT_TEXT);
  if (!annotHandle) return;

  const width = options.width || 24;
  const height = options.height || 24;

  const rectPtr = createRect(engine, options.x, options.y, width, height, pageHeight);
  mod.FPDFAnnot_SetRect(annotHandle, rectPtr);
  engine.freeMemory(rectPtr);

  const col = parseColor(options.color || '#fef08a');
  mod.FPDFAnnot_SetColor(annotHandle, 1, col.r, col.g, col.b, col.a);

  if (mod.FPDFAnnot_SetFlags) {
    mod.FPDFAnnot_SetFlags(annotHandle, 4);
  }

  if (mod.FPDFAnnot_SetStringValue && options.contents) {
    const valBuf = encodeUtf16Le(engine, options.contents);
    try {
      mod.FPDFAnnot_SetStringValue(annotHandle, 'Contents', valBuf.ptr);
    } catch {
      // ignore if string value setter is unsupported
    } finally {
      valBuf.dispose();
    }
  }

  if (mod.FPDFAnnot_SetStringValue && options.author) {
    const valBuf = encodeUtf16Le(engine, options.author);
    try {
      mod.FPDFAnnot_SetStringValue(annotHandle, 'T', valBuf.ptr);
    } catch {
      // ignore
    } finally {
      valBuf.dispose();
    }
  }

  if (mod.FPDFPage_CloseAnnot) {
    mod.FPDFPage_CloseAnnot(annotHandle);
  }
}

