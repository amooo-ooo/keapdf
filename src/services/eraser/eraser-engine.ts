/**
 * Modular Eraser Engine for Kea PDF.
 *
 * Provides cross-layer hit testing, Z-index stacking resolution,
 * occlusion cooldown gating, and instant same-z-level deletion.
 */

import type { CanvasElement, PathElement, ShapeElement } from '../../stores/canvas-types';
import type { EditableShapeSpan, EditableTextSpan, AnnotationItem, PageCropInfo } from '../../core/types';
import { pointInRotatedRect } from '../../utils/geometry';
import { pdfBoxToDomBounds } from '../../core/pdfium-helpers';

export type EraserCandidateSource = 'canvas' | 'pdf-annotation' | 'pdf-shape' | 'pdf-text-highlight';

export type AnnotationCategory =
  | 'highlight'
  | 'redaction'
  | 'drawing'
  | 'note'
  | 'shape'
  | 'text'
  | 'image'
  | 'form-field'
  | 'other';

export interface ErasableCandidate {
  id: string;
  source: EraserCandidateSource;
  pageIndex: number;
  zIndex: number;
  zLevel: string;
  category: AnnotationCategory;
  bounds: { x: number; y: number; width: number; height: number };
  canvasElementId?: string;
  canvasElement?: CanvasElement;
  pdfAnnotIndex?: number;
  pdfObjectIndex?: number;
  pdfSpanId?: string;
  raw?: unknown;
}

export interface LastErasedState {
  elementId: string;
  zIndex: number;
  zLevel: string;
  category: AnnotationCategory;
  point: { x: number; y: number };
  timestamp: number;
}

export interface EraserResolutionOptions {
  waitDelayMs?: number;
  movementThreshold?: number;
}

/**
 * Calculates Euclidean distance between two points.
 */
export function euclideanDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/**
 * Computes shortest distance from point (px, py) to line segment (x1, y1)-(x2, y2).
 */
export function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(px - x1, py - y1);
  }

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return Math.hypot(px - projX, py - projY);
}

/**
 * Hit-tests whether a point is within radius of a freehand path's stroke.
 */
export function isPointNearPath(
  point: { x: number; y: number },
  points: { x: number; y: number }[],
  strokeWidth: number,
  radius: number
): boolean {
  if (!points || points.length === 0) return false;

  const threshold = Math.max(strokeWidth / 2 + radius, 6);

  if (points.length === 1) {
    return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= threshold;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dist = pointToSegmentDistance(point.x, point.y, p1.x, p1.y, p2.x, p2.y);
    if (dist <= threshold) {
      return true;
    }
  }

  return false;
}

/**
 * Hit-tests whether a point is inside an expanded rotated rectangle.
 */
export function isPointInExpandedRotatedRect(
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
  rotation: number,
  radius: number
): boolean {
  const expandedRect = {
    x: rect.x - radius,
    y: rect.y - radius,
    width: Math.max(rect.width + radius * 2, 4),
    height: Math.max(rect.height + radius * 2, 4),
  };
  return pointInRotatedRect(point, expandedRect, rotation);
}

/**
 * Resolves the semantic annotation category for a canvas element.
 */
export function getCanvasElementCategory(element: CanvasElement): AnnotationCategory {
  if (element.kind === 'path') {
    const path = element as PathElement;
    return path.isHighlight ? 'highlight' : 'drawing';
  }
  if (element.kind === 'shape') {
    const shape = element as ShapeElement;
    if (shape.isHighlight) return 'highlight';
    if (shape.fill === '#000000' && (shape.strokeWidth === 0 || !shape.strokeWidth)) {
      return 'redaction';
    }
    return 'shape';
  }
  if (element.kind === 'note') return 'note';
  if (element.kind === 'text') return 'text';
  if (element.kind === 'image') return 'image';
  if (element.kind === 'form-field') return 'form-field';
  return 'other';
}

/**
 * Resolves the semantic category for a native PDF annotation item.
 */
export function getPdfAnnotationCategory(annot: AnnotationItem): AnnotationCategory {
  const sub = (annot.subtype || '').toLowerCase();
  if (sub.includes('highlight') || sub.includes('underline') || sub.includes('strike') || sub.includes('squiggly')) {
    return 'highlight';
  }
  if (sub.includes('redact')) {
    return 'redaction';
  }
  if (sub.includes('ink')) {
    return 'drawing';
  }
  if (sub.includes('text')) {
    return 'note';
  }
  if (sub.includes('square') || sub.includes('circle') || sub.includes('line')) {
    return 'shape';
  }
  return 'other';
}

/**
 * Collects all erasable candidates intersecting point (px, py) across Canvas and PDF layers.
 */
export function collectEraserCandidates(
  pageIndex: number,
  point: { x: number; y: number },
  radius: number,
  canvasElements: CanvasElement[],
  pdfShapeSpans: EditableShapeSpan[] = [],
  pdfTextSpans: EditableTextSpan[] = [],
  pdfAnnotations: AnnotationItem[] = [],
  cropInfo?: PageCropInfo
): ErasableCandidate[] {
  const candidates: ErasableCandidate[] = [];

  // Canvas layer elements (highest stacking tier: 10000+ for front band, 10+ for back band)
  const pageCanvasElements = canvasElements.filter(
    (el) => el.pageIndex === pageIndex && el.visible !== false && !el.locked,
  );
  for (let i = 0; i < pageCanvasElements.length; i++) {
    const el = pageCanvasElements[i];
    let isHit = false;

    if (el.kind === 'path') {
      const pathEl = el as PathElement;
      let testPoint = point;
      const rotDeg = pathEl.rotation || 0;
      if (rotDeg !== 0 || pathEl.flipX || pathEl.flipY) {
        const cx = pathEl.x + pathEl.width / 2;
        const cy = pathEl.y + pathEl.height / 2;
        let dx = point.x - cx;
        let dy = point.y - cy;
        if (rotDeg !== 0) {
          const rad = (-rotDeg * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const rx = dx * cos - dy * sin;
          const ry = dx * sin + dy * cos;
          dx = rx;
          dy = ry;
        }
        if (pathEl.flipX) dx = -dx;
        if (pathEl.flipY) dy = -dy;
        testPoint = { x: cx + dx, y: cy + dy };
      }
      isHit = isPointNearPath(testPoint, pathEl.points, pathEl.strokeWidth || 2, radius);
      if (!isHit && pathEl.points.length <= 1 && pathEl.width > 0 && pathEl.height > 0) {
        isHit = isPointInExpandedRotatedRect(point, { x: pathEl.x, y: pathEl.y, width: pathEl.width, height: pathEl.height }, pathEl.rotation || 0, radius);
      }
    } else {
      isHit = isPointInExpandedRotatedRect(
        point,
        { x: el.x, y: el.y, width: el.width, height: el.height },
        el.rotation || 0,
        radius
      );
    }

    if (isHit) {
      const category = getCanvasElementCategory(el);
      const zLevel = category === 'highlight' || category === 'redaction' ? category : `canvas_${el.id}`;
      const isBackBand = typeof el.zIndex === 'number' && el.zIndex < 10;
      candidates.push({
        id: `canvas_${el.id}`,
        source: 'canvas',
        pageIndex,
        zIndex: (isBackBand ? 10 : 10000) + i,
        zLevel,
        category,
        bounds: { x: el.x, y: el.y, width: el.width, height: el.height },
        canvasElementId: el.id,
        canvasElement: el,
        raw: el,
      });
    }
  }

  // Native PDF annotations (stacking tier: 2000+)
  if (pdfAnnotations && pdfAnnotations.length > 0) {
    for (const annot of pdfAnnotations) {
      // Exclude widget form fields unless specifically needed
      if (annot.subtype?.toLowerCase() === 'widget') continue;

      let domLeft = Math.min(annot.rect.left, annot.rect.right);
      let domTop = Math.min(annot.rect.top, annot.rect.bottom);
      let domWidth = Math.abs(annot.rect.right - annot.rect.left);
      let domHeight = Math.abs(annot.rect.top - annot.rect.bottom);

      if (cropInfo) {
        const bounds = pdfBoxToDomBounds(annot.rect.left, annot.rect.bottom, annot.rect.right, annot.rect.top, cropInfo);
        domLeft = bounds.left;
        domTop = bounds.top;
        domWidth = bounds.right - bounds.left;
        domHeight = bounds.bottom - bounds.top;
      }

      const rect = { x: domLeft, y: domTop, width: domWidth, height: domHeight };
      if (isPointInExpandedRotatedRect(point, rect, 0, radius)) {
        const category = getPdfAnnotationCategory(annot);
        const zLevel = category === 'highlight' || category === 'redaction' ? category : `pdf_annot_${annot.index}`;
        candidates.push({
          id: `pdf_annot_${pageIndex}_${annot.index}`,
          source: 'pdf-annotation',
          pageIndex,
          zIndex: 2000 + annot.index,
          zLevel,
          category,
          bounds: rect,
          pdfAnnotIndex: annot.index,
          raw: annot,
        });
      }
    }
  }

  // PDF Shape Spans (stacking tier: 1000+)
  if (pdfShapeSpans && pdfShapeSpans.length > 0) {
    const addedAnnotIndices = new Set(
      candidates
        .filter((c) => c.source === 'pdf-annotation' && typeof c.pdfAnnotIndex === 'number')
        .map((c) => c.pdfAnnotIndex!)
    );
    for (const shape of pdfShapeSpans) {
      if (shape.pageIndex !== pageIndex) continue;
      if (typeof shape.pdfAnnotIndex === 'number' && shape.pdfAnnotIndex >= 0) {
        if (addedAnnotIndices.has(shape.pdfAnnotIndex)) continue;
        const rect = { x: shape.left, y: shape.top, width: shape.width, height: shape.height };
        if (isPointInExpandedRotatedRect(point, rect, shape.rotation || 0, radius)) {
          const isRedaction = shape.fill === '#000000' || shape.fill === 'rgba(0, 0, 0, 1)';
          const category: AnnotationCategory = shape.isHighlight
            ? 'highlight'
            : isRedaction
              ? 'redaction'
              : 'shape';
          const zLevel = category === 'highlight' || category === 'redaction'
            ? category
            : `pdf_annot_${shape.pdfAnnotIndex}`;
          candidates.push({
            id: `pdf_annot_${pageIndex}_${shape.pdfAnnotIndex}`,
            source: 'pdf-annotation',
            pageIndex,
            zIndex: 2000 + shape.pdfAnnotIndex,
            zLevel,
            category,
            bounds: rect,
            pdfAnnotIndex: shape.pdfAnnotIndex,
            pdfSpanId: shape.id,
            raw: shape,
          });
          addedAnnotIndices.add(shape.pdfAnnotIndex);
        }
        continue;
      }
      if (shape.pdfObjectIndex < 0) continue;
      const rect = { x: shape.left, y: shape.top, width: shape.width, height: shape.height };
      if (isPointInExpandedRotatedRect(point, rect, shape.rotation || 0, radius)) {
        const isRedaction = shape.fill === '#000000' || shape.fill === 'rgba(0, 0, 0, 1)';
        const category: AnnotationCategory = shape.isHighlight
          ? 'highlight'
          : isRedaction
            ? 'redaction'
            : 'shape';
        const zLevel = category === 'highlight' || category === 'redaction'
          ? category
          : `pdf_shape_${shape.pdfObjectIndex}`;
        candidates.push({
          id: `pdf_shape_${pageIndex}_${shape.pdfObjectIndex}`,
          source: 'pdf-shape',
          pageIndex,
          zIndex: 1000 + shape.pdfObjectIndex,
          zLevel,
          category,
          bounds: rect,
          pdfObjectIndex: shape.pdfObjectIndex,
          pdfSpanId: shape.id,
          raw: shape,
        });
      }
    }
  }

  // PDF Text Highlight Backgrounds (stacking tier: 100+)
  if (pdfTextSpans && pdfTextSpans.length > 0) {
    for (const textSpan of pdfTextSpans) {
      if (textSpan.pageIndex !== pageIndex) continue;
      const hasSpanHighlight = Boolean(textSpan.backgroundColor && textSpan.backgroundColor !== 'transparent');
      const hasLineHighlight = Boolean(textSpan.lines && textSpan.lines.some((l) => l.backgroundColor && l.backgroundColor !== 'transparent'));

      if (!hasSpanHighlight && !hasLineHighlight) continue;

      const rect = { x: textSpan.left, y: textSpan.top, width: textSpan.width, height: textSpan.height };
      if (isPointInExpandedRotatedRect(point, rect, textSpan.rotation || 0, radius)) {
        candidates.push({
          id: `pdf_text_highlight_${textSpan.id}`,
          source: 'pdf-text-highlight',
          pageIndex,
          zIndex: 100 + (textSpan.charStartIndex || 0),
          zLevel: 'highlight',
          category: 'highlight',
          bounds: rect,
          pdfSpanId: textSpan.id,
          raw: textSpan,
        });
      }
    }
  }

  // Sort candidates by zIndex descending (uppermost first)
  candidates.sort((a, b) => b.zIndex - a.zIndex);

  return candidates;
}

/**
 * Resolves the uppermost candidate eligible for deletion, taking into account
 * cooldown delay and movement threshold for underlying elements, and allowing
 * immediate deletion for elements on the same Z-level.
 */
export function resolveUpperZCandidate(
  sortedCandidates: ErasableCandidate[],
  lastErased: LastErasedState | null,
  now: number,
  currentPoint: { x: number; y: number },
  options: EraserResolutionOptions = {}
): ErasableCandidate | null {
  if (!sortedCandidates || sortedCandidates.length === 0) return null;

  const waitDelayMs = options.waitDelayMs ?? 400;
  const movementThreshold = options.movementThreshold ?? 16;

  const top = sortedCandidates[0];

  if (!lastErased) {
    return top;
  }

  // Same Z-level: delete immediately with no delay or wait
  if (top.zLevel === lastErased.zLevel) {
    return top;
  }

  // If candidate is behind the last erased element (lower Z)
  if (top.zIndex < lastErased.zIndex) {
    const timeElapsed = now - lastErased.timestamp;
    const dist = euclideanDistance(currentPoint, lastErased.point);

    const waitSatisfied = timeElapsed >= waitDelayMs;
    const movementSatisfied = dist >= movementThreshold;

    if (!waitSatisfied && !movementSatisfied) {
      // Prevent deleting the element behind it immediately
      return null;
    }
  }

  return top;
}
