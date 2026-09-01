import type { PdfiumEngine } from '../../../core/pdfium-engine';
import { encodeUtf16Le } from '../../../core/pdfium-helpers';
import { parseColor } from '../utils';
import type { ShapeOptions, PathOptions } from './types';

const FPDF_ANNOT_TEXT = 1;
const FPDF_ANNOT_HIGHLIGHT = 9;
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
  const rotation = options.rotation || 0;
  const flipX = options.flipX || false;
  const flipY = options.flipY || false;

  // Centre: (cx, cy) = (x + width/2, y + height/2) in page coords
  const cx = options.x + width / 2;
  const cy = options.y + height / 2;

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const corners = [
    { px: options.x, py: options.y }, // TL
    { px: options.x + width, py: options.y }, // TR
    { px: options.x, py: options.y + height }, // BL
    { px: options.x + width, py: options.y + height } // BR
  ];

  const rotatedCorners = corners.map(corner => {
    let dx = corner.px - cx;
    let dy = corner.py - cy;
    if (flipX) dx = -dx;
    if (flipY) dy = -dy;

    const rx = cx + dx * cos - dy * sin;
    const ry = cy + dx * sin + dy * cos;
    return { x: rx, pdfY: pageHeight - ry };
  });

  const TL = rotatedCorners[0];
  const TR = rotatedCorners[1];
  const BL = rotatedCorners[2];
  const BR = rotatedCorners[3];

  let minX = TL.x;
  let maxX = TL.x;
  let minPdfY = TL.pdfY;
  let maxPdfY = TL.pdfY;

  for (const corner of rotatedCorners) {
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minPdfY = Math.min(minPdfY, corner.pdfY);
    maxPdfY = Math.max(maxPdfY, corner.pdfY);
  }

  // Set Bounding Box
  const rectPtr = engine.allocateMemory(16); // 4 floats
  const heap = mod.pdfium.HEAPF32;
  heap[rectPtr >> 2] = minX;
  heap[(rectPtr >> 2) + 1] = minPdfY;
  heap[(rectPtr >> 2) + 2] = maxX;
  heap[(rectPtr >> 2) + 3] = maxPdfY;
  mod.FPDFAnnot_SetRect(annotHandle, rectPtr);
  engine.freeMemory(rectPtr);

  // Set colour (/C dictionary entry per ISO 32000-1)
  const fill = parseColor(options.fill || '#ffff00');
  const alpha = typeof options.opacity === 'number' ? Math.round(options.opacity * 255) : fill.a;
  mod.FPDFAnnot_SetColor(annotHandle, 0, fill.r, fill.g, fill.b, alpha);

  // Set Flags (Print = 4)
  if (mod.FPDFAnnot_SetFlags) {
    mod.FPDFAnnot_SetFlags(annotHandle, 4);
  }

  // Standard QuadPoints order: TopLeft, TopRight, BottomLeft, BottomRight
  const quadPtr = engine.allocateMemory(32); // 8 floats
  
  heap[quadPtr >> 2] = TL.x;
  heap[(quadPtr >> 2) + 1] = TL.pdfY;
  heap[(quadPtr >> 2) + 2] = TR.x;
  heap[(quadPtr >> 2) + 3] = TR.pdfY;
  heap[(quadPtr >> 2) + 4] = BL.x;
  heap[(quadPtr >> 2) + 5] = BL.pdfY;
  heap[(quadPtr >> 2) + 6] = BR.x;
  heap[(quadPtr >> 2) + 7] = BR.pdfY;

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
  // Use generous padding to prevent clipping at mitre joins and sharp angles.
  const padding = Math.max(strokeWidth * 2, 8);
  
  const rectPtr = createRect(
    engine, 
    minX - padding, 
    minY - padding, 
    (maxX - minX) + padding * 2, 
    (maxY - minY) + padding * 2, 
    pageHeight
  );
  mod.FPDFAnnot_SetRect(annotHandle, rectPtr);
  engine.freeMemory(rectPtr);

  // Set colour (/C dictionary entry per ISO 32000-1)
  const stroke = parseColor(options.stroke || '#000000');
  const alpha = typeof options.opacity === 'number' ? Math.round(options.opacity * 255) : stroke.a;
  mod.FPDFAnnot_SetColor(annotHandle, 0, stroke.r, stroke.g, stroke.b, alpha);
  
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

  // Set colour (/C dictionary entry per ISO 32000-1)
  const col = parseColor(options.color || '#fef08a');
  mod.FPDFAnnot_SetColor(annotHandle, 0, col.r, col.g, col.b, col.a);

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

