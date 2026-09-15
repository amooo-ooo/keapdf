import type { Rect } from './geometry';
import type { CanvasElement, HandlePosition } from '../stores/canvas-types';
import type {
  EditableTextSpan,
  EditableImageSpan,
  EditableShapeSpan,
  EditableFormFieldSpan,
} from '../core/types';
import type {
  SnapGuide,
  SnapOptions,
  SnapResult,
  SnapCandidate,
  SnapMargins,
  SnapTargetKind,
} from '../types/snapping-types';

/** Memoized PDF overlay spans and layout objects. */
export interface CachedPdfPageSpans {
  textSpans?: readonly EditableTextSpan[];
  images?: readonly EditableImageSpan[];
  shapes?: readonly EditableShapeSpan[];
  formFields?: readonly EditableFormFieldSpan[];
}

/**
 * Extracts snap candidate bounding boxes from canvas elements and native PDF layout objects.
 *
 * Combines sibling canvas elements and memoized PDF layout objects (text blocks,
 * columns, images, shapes, and form fields) into unified snapping candidates.
 * Filters out hidden spans and degenerate bounding boxes.
 */
export function extractSnapCandidates(
  pageIndex: number,
  canvasElements: readonly CanvasElement[],
  excludeElementId?: string,
  pdfSpans?: CachedPdfPageSpans,
  hiddenSpanIds?: ReadonlySet<string>,
): SnapCandidate[] {
  const candidates: SnapCandidate[] = [];

  for (const element of canvasElements) {
    if (element.pageIndex === pageIndex && element.id !== excludeElementId) {
      if (element.width > 0 && element.height > 0) {
        candidates.push({
          id: element.id,
          rect: {
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
          },
          pageIndex,
        });
      }
    }
  }

  if (pdfSpans) {
    if (pdfSpans.textSpans) {
      for (const span of pdfSpans.textSpans) {
        if (span.pageIndex === pageIndex && (!hiddenSpanIds || !hiddenSpanIds.has(span.id))) {
          if (span.width > 0 && span.height > 0) {
            candidates.push({
              id: span.id,
              rect: {
                x: span.left,
                y: span.top,
                width: span.width,
                height: span.height,
              },
              pageIndex,
            });
          }
        }
      }
    }

    if (pdfSpans.images) {
      for (const img of pdfSpans.images) {
        if (img.pageIndex === pageIndex && (!hiddenSpanIds || !hiddenSpanIds.has(img.id))) {
          if (img.width > 0 && img.height > 0) {
            candidates.push({
              id: img.id,
              rect: {
                x: img.left,
                y: img.top,
                width: img.width,
                height: img.height,
              },
              pageIndex,
            });
          }
        }
      }
    }

    if (pdfSpans.shapes) {
      for (const shape of pdfSpans.shapes) {
        if (shape.pageIndex === pageIndex && (!hiddenSpanIds || !hiddenSpanIds.has(shape.id))) {
          if (shape.width > 0 && shape.height > 0) {
            candidates.push({
              id: shape.id,
              rect: {
                x: shape.left,
                y: shape.top,
                width: shape.width,
                height: shape.height,
              },
              pageIndex,
            });
          }
        }
      }
    }

    if (pdfSpans.formFields) {
      for (const ff of pdfSpans.formFields) {
        if (ff.pageIndex === pageIndex && (!hiddenSpanIds || !hiddenSpanIds.has(ff.id))) {
          if (ff.width > 0 && ff.height > 0) {
            candidates.push({
              id: ff.id,
              rect: {
                x: ff.left,
                y: ff.top,
                width: ff.width,
                height: ff.height,
              },
              pageIndex,
            });
          }
        }
      }
    }
  }

  return candidates;
}

/** Default screen-space threshold in pixels. */
export const DEFAULT_SNAP_THRESHOLD_PX = 6;

/** Priority weights for snap target kinds. */
const PRIORITY_BONUS_CENTER = 2.0;
const PRIORITY_BONUS_PAGE_CENTER = 3.0;

/** Convert screen pixels to resolution-independent page points. */
export function getScreenInvariantThreshold(screenThresholdPx: number, zoom: number): number {
  return screenThresholdPx / Math.max(0.05, zoom);
}

/** Candidate axis evaluation match. */
interface AxisMatch {
  delta: number;
  guideCoord: number;
  start: number;
  end: number;
  kind: SnapTargetKind;
  matchedId?: string;
  score: number;
}

/**
 * Evaluates candidate snap targets along a single 1D axis.
 *
 * Compares test points of the dragged element against all target points
 * and returns the best matching alignment candidate within the threshold.
 */
function evaluateAxisSnap(
  draggedPoints: { coord: number; isCenter: boolean }[],
  targetPoints: {
    coord: number;
    isCenter: boolean;
    kind: SnapTargetKind;
    matchedId?: string;
    targetOrthogonalStart: number;
    targetOrthogonalEnd: number;
  }[],
  draggedOrthogonalStart: number,
  draggedOrthogonalEnd: number,
  threshold: number,
): AxisMatch | null {
  let bestMatch: AxisMatch | null = null;

  for (const target of targetPoints) {
    for (const dragged of draggedPoints) {
      const diff = target.coord - dragged.coord;
      const distance = Math.abs(diff);

      if (distance <= threshold) {
        let score = distance;
        if (dragged.isCenter && target.isCenter) {
          score -= target.kind === 'page-center' ? PRIORITY_BONUS_PAGE_CENTER : PRIORITY_BONUS_CENTER;
        } else if (target.kind === 'page-center') {
          score -= PRIORITY_BONUS_PAGE_CENTER * 0.5;
        }

        if (!bestMatch || score < bestMatch.score) {
          const start = Math.min(draggedOrthogonalStart, target.targetOrthogonalStart);
          const end = Math.max(draggedOrthogonalEnd, target.targetOrthogonalEnd);

          bestMatch = {
            delta: diff,
            guideCoord: target.coord,
            start,
            end,
            kind: target.kind,
            matchedId: target.matchedId,
            score,
          };
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Computes 2D smart snapping for canvas element movement.
 *
 * Checks alignments against page edges, centrelines, margins, and sibling element bounds.
 */
export function computeDragSnap(
  draggedRect: Rect,
  candidates: SnapCandidate[],
  pageDimensions: { width: number; height: number },
  pageIndex: number,
  zoom: number,
  margins?: SnapMargins,
  options?: SnapOptions,
): SnapResult {
  if (options?.disabled) {
    return {
      x: draggedRect.x,
      y: draggedRect.y,
      snappedX: false,
      snappedY: false,
      guides: [],
    };
  }

  const thresholdPx = options?.screenThresholdPx ?? DEFAULT_SNAP_THRESHOLD_PX;
  const threshold = getScreenInvariantThreshold(thresholdPx, zoom);

  const enablePage = options?.enablePageSnap ?? true;
  const enableElements = options?.enableElementSnap ?? true;
  const enableSpacing = options?.enableSpacingSnap ?? true;

  const targetXPoints: {
    coord: number;
    isCenter: boolean;
    kind: SnapTargetKind;
    matchedId?: string;
    targetOrthogonalStart: number;
    targetOrthogonalEnd: number;
  }[] = [];

  const targetYPoints: {
    coord: number;
    isCenter: boolean;
    kind: SnapTargetKind;
    matchedId?: string;
    targetOrthogonalStart: number;
    targetOrthogonalEnd: number;
  }[] = [];

  if (enablePage) {
    targetXPoints.push(
      {
        coord: 0,
        isCenter: false,
        kind: 'page-edge',
        targetOrthogonalStart: 0,
        targetOrthogonalEnd: pageDimensions.height,
      },
      {
        coord: pageDimensions.width / 2,
        isCenter: true,
        kind: 'page-center',
        targetOrthogonalStart: 0,
        targetOrthogonalEnd: pageDimensions.height,
      },
      {
        coord: pageDimensions.width,
        isCenter: false,
        kind: 'page-edge',
        targetOrthogonalStart: 0,
        targetOrthogonalEnd: pageDimensions.height,
      },
    );

    targetYPoints.push(
      {
        coord: 0,
        isCenter: false,
        kind: 'page-edge',
        targetOrthogonalStart: 0,
        targetOrthogonalEnd: pageDimensions.width,
      },
      {
        coord: pageDimensions.height / 2,
        isCenter: true,
        kind: 'page-center',
        targetOrthogonalStart: 0,
        targetOrthogonalEnd: pageDimensions.width,
      },
      {
        coord: pageDimensions.height,
        isCenter: false,
        kind: 'page-edge',
        targetOrthogonalStart: 0,
        targetOrthogonalEnd: pageDimensions.width,
      },
    );

    if (margins) {
      if (typeof margins.left === 'number' && margins.left > 0) {
        targetXPoints.push({
          coord: margins.left,
          isCenter: false,
          kind: 'page-margin',
          targetOrthogonalStart: 0,
          targetOrthogonalEnd: pageDimensions.height,
        });
      }
      if (typeof margins.right === 'number' && margins.right > 0) {
        targetXPoints.push({
          coord: pageDimensions.width - margins.right,
          isCenter: false,
          kind: 'page-margin',
          targetOrthogonalStart: 0,
          targetOrthogonalEnd: pageDimensions.height,
        });
      }
      if (typeof margins.top === 'number' && margins.top > 0) {
        targetYPoints.push({
          coord: margins.top,
          isCenter: false,
          kind: 'page-margin',
          targetOrthogonalStart: 0,
          targetOrthogonalEnd: pageDimensions.width,
        });
      }
      if (typeof margins.bottom === 'number' && margins.bottom > 0) {
        targetYPoints.push({
          coord: pageDimensions.height - margins.bottom,
          isCenter: false,
          kind: 'page-margin',
          targetOrthogonalStart: 0,
          targetOrthogonalEnd: pageDimensions.width,
        });
      }
    }
  }

  if (enableElements) {
    for (const cand of candidates) {
      const { x, y, width, height } = cand.rect;
      targetXPoints.push(
        {
          coord: x,
          isCenter: false,
          kind: 'element-edge',
          matchedId: cand.id,
          targetOrthogonalStart: y,
          targetOrthogonalEnd: y + height,
        },
        {
          coord: x + width / 2,
          isCenter: true,
          kind: 'element-center',
          matchedId: cand.id,
          targetOrthogonalStart: y,
          targetOrthogonalEnd: y + height,
        },
        {
          coord: x + width,
          isCenter: false,
          kind: 'element-edge',
          matchedId: cand.id,
          targetOrthogonalStart: y,
          targetOrthogonalEnd: y + height,
        },
      );

      targetYPoints.push(
        {
          coord: y,
          isCenter: false,
          kind: 'element-edge',
          matchedId: cand.id,
          targetOrthogonalStart: x,
          targetOrthogonalEnd: x + width,
        },
        {
          coord: y + height / 2,
          isCenter: true,
          kind: 'element-center',
          matchedId: cand.id,
          targetOrthogonalStart: x,
          targetOrthogonalEnd: x + width,
        },
        {
          coord: y + height,
          isCenter: false,
          kind: 'element-edge',
          matchedId: cand.id,
          targetOrthogonalStart: x,
          targetOrthogonalEnd: x + width,
        },
      );
    }
  }

  const draggedXPoints = [
    { coord: draggedRect.x, isCenter: false },
    { coord: draggedRect.x + draggedRect.width / 2, isCenter: true },
    { coord: draggedRect.x + draggedRect.width, isCenter: false },
  ];

