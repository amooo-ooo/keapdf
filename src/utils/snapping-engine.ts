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

  const draggedYPoints = [
    { coord: draggedRect.y, isCenter: false },
    { coord: draggedRect.y + draggedRect.height / 2, isCenter: true },
    { coord: draggedRect.y + draggedRect.height, isCenter: false },
  ];

  const matchX = evaluateAxisSnap(
    draggedXPoints,
    targetXPoints,
    draggedRect.y,
    draggedRect.y + draggedRect.height,
    threshold,
  );

  const matchY = evaluateAxisSnap(
    draggedYPoints,
    targetYPoints,
    draggedRect.x,
    draggedRect.x + draggedRect.width,
    threshold,
  );

  let finalX = draggedRect.x;
  let finalY = draggedRect.y;
  const guides: SnapGuide[] = [];

  if (matchX) {
    finalX += matchX.delta;
    guides.push({
      id: `guide-x-${matchX.guideCoord}`,
      orientation: 'vertical',
      coordinate: matchX.guideCoord,
      pageIndex,
      start: matchX.start,
      end: matchX.end,
      kind: matchX.kind,
      matchedElementId: matchX.matchedId,
    });
  }

  if (matchY) {
    finalY += matchY.delta;
    guides.push({
      id: `guide-y-${matchY.guideCoord}`,
      orientation: 'horizontal',
      coordinate: matchY.guideCoord,
      pageIndex,
      start: matchY.start,
      end: matchY.end,
      kind: matchY.kind,
      matchedElementId: matchY.matchedId,
    });
  }

  if (enableSpacing && candidates.length >= 2) {
    const spacingGuides = computeSpacingSnap(
      { x: finalX, y: finalY, width: draggedRect.width, height: draggedRect.height },
      candidates,
      pageIndex,
      threshold,
    );

    if (spacingGuides.length > 0) {
      guides.push(...spacingGuides);
    }
  }

  return {
    x: finalX,
    y: finalY,
    snappedX: matchX !== null,
    snappedY: matchY !== null,
    guides,
  };
}

/**
 * Computes equidistant gap distribution snapping across collinear elements.
 */
export function computeSpacingSnap(
  draggedRect: Rect,
  candidates: SnapCandidate[],
  pageIndex: number,
  threshold: number,
): SnapGuide[] {
  const guides: SnapGuide[] = [];

  // Check horizontal spacing along similar Y bands
  const horizontalOverlapCandidates = candidates.filter((c) => {
    const overlapY =
      Math.min(draggedRect.y + draggedRect.height, c.rect.y + c.rect.height) -
      Math.max(draggedRect.y, c.rect.y);
    return overlapY > 0;
  });

  if (horizontalOverlapCandidates.length >= 2) {
    const sorted = [...horizontalOverlapCandidates].sort((a, b) => a.rect.x - b.rect.x);
    for (let i = 0; i < sorted.length - 1; i++) {
      const c1 = sorted[i];
      const c2 = sorted[i + 1];
      const knownGap = c2.rect.x - (c1.rect.x + c1.rect.width);

      if (knownGap > 0) {
        // Dragged element placed after c2
        const gapAfter = draggedRect.x - (c2.rect.x + c2.rect.width);
        if (Math.abs(gapAfter - knownGap) <= threshold) {
          const midY = (draggedRect.y + c2.rect.y) / 2;
          guides.push({
            id: `spacing-h-${c2.id}-${Math.round(knownGap)}`,
            orientation: 'horizontal',
            coordinate: midY,
            pageIndex,
            start: c2.rect.x + c2.rect.width,
            end: draggedRect.x,
            kind: 'spacing-gap',
            label: `${Math.round(knownGap)} pt`,
            matchedElementId: c2.id,
          });
        }

        // Dragged element placed before c1
        const gapBefore = c1.rect.x - (draggedRect.x + draggedRect.width);
        if (Math.abs(gapBefore - knownGap) <= threshold) {
          const midY = (draggedRect.y + c1.rect.y) / 2;
          guides.push({
            id: `spacing-h-${c1.id}-${Math.round(knownGap)}`,
            orientation: 'horizontal',
            coordinate: midY,
            pageIndex,
            start: draggedRect.x + draggedRect.width,
            end: c1.rect.x,
            kind: 'spacing-gap',
            label: `${Math.round(knownGap)} pt`,
            matchedElementId: c1.id,
          });
        }
      }
    }
  }

  // Check vertical spacing along similar X bands
  const verticalOverlapCandidates = candidates.filter((c) => {
    const overlapX =
      Math.min(draggedRect.x + draggedRect.width, c.rect.x + c.rect.width) -
      Math.max(draggedRect.x, c.rect.x);
    return overlapX > 0;
  });

  if (verticalOverlapCandidates.length >= 2) {
    const sorted = [...verticalOverlapCandidates].sort((a, b) => a.rect.y - b.rect.y);
    for (let i = 0; i < sorted.length - 1; i++) {
      const c1 = sorted[i];
      const c2 = sorted[i + 1];
      const knownGap = c2.rect.y - (c1.rect.y + c1.rect.height);

      if (knownGap > 0) {
        // Dragged element placed below c2
        const gapBelow = draggedRect.y - (c2.rect.y + c2.rect.height);
        if (Math.abs(gapBelow - knownGap) <= threshold) {
          const midX = (draggedRect.x + c2.rect.x) / 2;
          guides.push({
            id: `spacing-v-${c2.id}-${Math.round(knownGap)}`,
            orientation: 'vertical',
            coordinate: midX,
            pageIndex,
            start: c2.rect.y + c2.rect.height,
            end: draggedRect.y,
            kind: 'spacing-gap',
            label: `${Math.round(knownGap)} pt`,
            matchedElementId: c2.id,
          });
        }

        // Dragged element placed above c1
        const gapAbove = c1.rect.y - (draggedRect.y + draggedRect.height);
        if (Math.abs(gapAbove - knownGap) <= threshold) {
          const midX = (draggedRect.x + c1.rect.x) / 2;
          guides.push({
            id: `spacing-v-${c1.id}-${Math.round(knownGap)}`,
            orientation: 'vertical',
            coordinate: midX,
            pageIndex,
            start: draggedRect.y + draggedRect.height,
            end: c1.rect.y,
            kind: 'spacing-gap',
            label: `${Math.round(knownGap)} pt`,
            matchedElementId: c1.id,
          });
        }
      }
    }
  }

  return guides;
}

/**
 * Computes smart snapping adjustments during handle resize operations.
 */
export function computeResizeSnap(
  handle: HandlePosition,
  currentRect: Rect,
  candidates: SnapCandidate[],
  pageDimensions: { width: number; height: number },
  pageIndex: number,
  zoom: number,
  margins?: SnapMargins,
  options?: SnapOptions,
): SnapResult {
  if (options?.disabled) {
    return {
      x: currentRect.x,
      y: currentRect.y,
      snappedX: false,
      snappedY: false,
      guides: [],
    };
  }

  const thresholdPx = options?.screenThresholdPx ?? DEFAULT_SNAP_THRESHOLD_PX;
  const threshold = getScreenInvariantThreshold(thresholdPx, zoom);

  const enableElements = options?.enableElementSnap ?? true;
  const enableSize = options?.enableSizeSnap ?? true;

  const guides: SnapGuide[] = [];
  let finalX = currentRect.x;
  let finalY = currentRect.y;
  let finalWidth = currentRect.width;
  let finalHeight = currentRect.height;
  let snappedX = false;
  let snappedY = false;

  const targetXPoints: { coord: number; kind: SnapTargetKind; matchedId?: string }[] = [
    { coord: 0, kind: 'page-edge' },
    { coord: pageDimensions.width / 2, kind: 'page-center' },
    { coord: pageDimensions.width, kind: 'page-edge' },
  ];

  const targetYPoints: { coord: number; kind: SnapTargetKind; matchedId?: string }[] = [
    { coord: 0, kind: 'page-edge' },
    { coord: pageDimensions.height / 2, kind: 'page-center' },
    { coord: pageDimensions.height, kind: 'page-edge' },
  ];

  if (margins) {
    if (typeof margins.left === 'number' && margins.left > 0) {
      targetXPoints.push({ coord: margins.left, kind: 'page-margin' });
    }
    if (typeof margins.right === 'number' && margins.right > 0) {
      targetXPoints.push({ coord: pageDimensions.width - margins.right, kind: 'page-margin' });
    }
    if (typeof margins.top === 'number' && margins.top > 0) {
      targetYPoints.push({ coord: margins.top, kind: 'page-margin' });
    }
    if (typeof margins.bottom === 'number' && margins.bottom > 0) {
      targetYPoints.push({ coord: pageDimensions.height - margins.bottom, kind: 'page-margin' });
    }
  }

  if (enableElements) {
    for (const cand of candidates) {
      const { x, y, width, height } = cand.rect;
      targetXPoints.push(
        { coord: x, kind: 'element-edge', matchedId: cand.id },
        { coord: x + width / 2, kind: 'element-center', matchedId: cand.id },
        { coord: x + width, kind: 'element-edge', matchedId: cand.id },
      );
      targetYPoints.push(
        { coord: y, kind: 'element-edge', matchedId: cand.id },
        { coord: y + height / 2, kind: 'element-center', matchedId: cand.id },
        { coord: y + height, kind: 'element-edge', matchedId: cand.id },
      );

      // Check matching dimensions (equal width or equal height)
      if (enableSize) {
        if (Math.abs(finalWidth - width) <= threshold) {
          finalWidth = width;
          guides.push({
            id: `size-match-w-${cand.id}`,
            orientation: 'horizontal',
            coordinate: finalY + finalHeight,
            pageIndex,
            start: finalX,
            end: finalX + finalWidth,
            kind: 'size-match',
            label: `Width: ${Math.round(width)} pt`,
            matchedElementId: cand.id,
          });
        }
        if (Math.abs(finalHeight - height) <= threshold) {
          finalHeight = height;
          guides.push({
            id: `size-match-h-${cand.id}`,
            orientation: 'vertical',
            coordinate: finalX + finalWidth,
            pageIndex,
            start: finalY,
            end: finalY + finalHeight,
            kind: 'size-match',
            label: `Height: ${Math.round(height)} pt`,
            matchedElementId: cand.id,
          });
        }
      }
    }
  }

  // Handle active edge snapping
  if (handle.includes('left')) {
    let closestDelta = Infinity;
    let targetCoord = 0;
    for (const tp of targetXPoints) {
      const diff = tp.coord - finalX;
      if (Math.abs(diff) <= threshold && Math.abs(diff) < Math.abs(closestDelta)) {
        closestDelta = diff;
        targetCoord = tp.coord;
      }
    }
    if (Number.isFinite(closestDelta) && Math.abs(closestDelta) <= threshold) {
      finalX = targetCoord;
      finalWidth -= closestDelta;
      snappedX = true;
      guides.push({
        id: `resize-guide-x-${targetCoord}`,
        orientation: 'vertical',
        coordinate: targetCoord,
        pageIndex,
        start: finalY,
        end: finalY + finalHeight,
        kind: 'element-edge',
      });
    }
  } else if (handle.includes('right')) {
    const currentRight = finalX + finalWidth;
    let closestDelta = Infinity;
    let targetCoord = 0;
    for (const tp of targetXPoints) {
      const diff = tp.coord - currentRight;
      if (Math.abs(diff) <= threshold && Math.abs(diff) < Math.abs(closestDelta)) {
        closestDelta = diff;
        targetCoord = tp.coord;
      }
    }
    if (Number.isFinite(closestDelta) && Math.abs(closestDelta) <= threshold) {
      finalWidth += closestDelta;
      snappedX = true;
      guides.push({
        id: `resize-guide-x-${targetCoord}`,
        orientation: 'vertical',
        coordinate: targetCoord,
        pageIndex,
        start: finalY,
        end: finalY + finalHeight,
        kind: 'element-edge',
      });
    }
  }

  if (handle.includes('top')) {
    let closestDelta = Infinity;
    let targetCoord = 0;
    for (const tp of targetYPoints) {
      const diff = tp.coord - finalY;
      if (Math.abs(diff) <= threshold && Math.abs(diff) < Math.abs(closestDelta)) {
        closestDelta = diff;
        targetCoord = tp.coord;
      }
    }
    if (Number.isFinite(closestDelta) && Math.abs(closestDelta) <= threshold) {
      finalY = targetCoord;
      finalHeight -= closestDelta;
      snappedY = true;
      guides.push({
        id: `resize-guide-y-${targetCoord}`,
        orientation: 'horizontal',
        coordinate: targetCoord,
        pageIndex,
        start: finalX,
        end: finalX + finalWidth,
        kind: 'element-edge',
      });
    }
  } else if (handle.includes('bottom')) {
    const currentBottom = finalY + finalHeight;
    let closestDelta = Infinity;
    let targetCoord = 0;
    for (const tp of targetYPoints) {
      const diff = tp.coord - currentBottom;
      if (Math.abs(diff) <= threshold && Math.abs(diff) < Math.abs(closestDelta)) {
        closestDelta = diff;
        targetCoord = tp.coord;
      }
    }
    if (Number.isFinite(closestDelta) && Math.abs(closestDelta) <= threshold) {
      finalHeight += closestDelta;
      snappedY = true;
      guides.push({
        id: `resize-guide-y-${targetCoord}`,
        orientation: 'horizontal',
        coordinate: targetCoord,
        pageIndex,
        start: finalX,
        end: finalX + finalWidth,
        kind: 'element-edge',
      });
    }
  }

  return {
    x: finalX,
    y: finalY,
    snappedX,
    snappedY,
    guides,
  };
}
