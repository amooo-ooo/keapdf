/**
 * Snapping engine extensions for line and arrow endpoint transformations.
 *
 * Provides target alignment against page boundaries and sibling canvas elements,
 * as well as magnetic and shift-constrained angle snapping in forty-five degree increments.
 */

import type { Point } from '../stores/canvas-types';
import type { SnapGuide, SnapCandidate, SnapTargetKind } from '../types/snapping-types';
import { getScreenInvariantThreshold } from './snapping-engine';

/** Alignment target candidate used for coordinate snapping. */
export interface LineSnapTarget {
  /** Target coordinate in PDF page points. */
  coordinate: number;
  /** Starting extent of guideline in PDF page points. */
  start: number;
  /** Ending extent of guideline in PDF page points. */
  end: number;
  /** Semantic classification of the target. */
  kind: SnapTargetKind;
  /** Optional human-readable badge label. */
  label?: string;
}

/** Configuration options for line endpoint snapping. */
export interface LineEndpointSnapOptions {
  /** The point currently being repositioned by pointer interaction. */
  movingPoint: Point;
  /** The opposite terminal point remaining stationary. */
  fixedPoint: Point;
  /** Terminal identifier being adjusted. */
  handle: 'start' | 'end';
  /** Sibling element bounding box candidates available on the page. */
  candidates: SnapCandidate[];
  /** Page boundary dimensions in PDF page points. */
  pageDimensions: { width: number; height: number };
  /** Target page index. */
  pageIndex: number;
  /** Active viewport zoom factor. */
  zoom: number;
  /** Whether the shift modifier key is pressed. */
  shiftKey?: boolean;
  /** Whether snapping calculations are temporarily suppressed. */
  disabledSnap?: boolean;
  /** Screen-space pixel snapping distance threshold. */
  screenThresholdPx?: number;
  /** Base angle increment step in degrees, defaulting to forty-five. */
  angleSnapStepDeg?: number;
  /** Tolerance threshold in degrees for magnetic angle snapping. */
  angleSnapToleranceDeg?: number;
  /** Whether angle snapping is enabled. */
  enableAngleSnap?: boolean;
}

/** Result descriptor emitted by line endpoint snapping calculations. */
export interface LineEndpointSnapResult {
  /** Resolved point coordinate after target and angle constraints. */
  point: Point;
  /** Whether the horizontal coordinate snapped to an alignment target. */
  snappedX: boolean;
  /** Whether the vertical coordinate snapped to an alignment target. */
  snappedY: boolean;
  /** Whether the orientation angle snapped to an angular increment. */
  snappedAngle: boolean;
  /** Visual guidelines describing the active snapping relationships. */
  guides: SnapGuide[];
  /** Normalised snapping angle in degrees if angular snap occurred. */
  snappedAngleDeg?: number;
}

const DEFAULT_SNAP_PIXELS = 8;
const DEFAULT_ANGLE_TOLERANCE_DEG = 4;
const DEFAULT_ANGLE_STEP_DEG = 45;

/**
 * Calculates target coordinate and angular snapping for a dragged line endpoint.
 *
 * @param options Snapping parameters including candidate geometries, modifiers, and zoom.
 * @return Resolved endpoint coordinates and active visual guidelines.
 */
export function snapLineEndpoint(options: LineEndpointSnapOptions): LineEndpointSnapResult {
  const {
    movingPoint,
    fixedPoint,
    candidates,
    pageDimensions,
    pageIndex,
    zoom,
    shiftKey = false,
    disabledSnap = false,
    screenThresholdPx = DEFAULT_SNAP_PIXELS,
    angleSnapStepDeg = DEFAULT_ANGLE_STEP_DEG,
    angleSnapToleranceDeg = DEFAULT_ANGLE_TOLERANCE_DEG,
    enableAngleSnap = true,
  } = options;

  if (disabledSnap) {
    return {
      point: { x: movingPoint.x, y: movingPoint.y },
      snappedX: false,
      snappedY: false,
      snappedAngle: false,
      guides: [],
    };
  }

  const threshold = getScreenInvariantThreshold(screenThresholdPx, zoom);
  const guides: SnapGuide[] = [];

  let candidateX = movingPoint.x;
  let candidateY = movingPoint.y;
  let snappedX = false;
  let snappedY = false;
  let bestDistX = threshold;
  let bestDistY = threshold;

  // Horizontal target snapping candidates
  const xTargets: LineSnapTarget[] = [
    { coordinate: 0, start: 0, end: pageDimensions.height, kind: 'page-edge' },
    { coordinate: pageDimensions.width / 2, start: 0, end: pageDimensions.height, kind: 'page-center', label: 'Page Centre' },
    { coordinate: pageDimensions.width, start: 0, end: pageDimensions.height, kind: 'page-edge' },
  ];

  for (const candidate of candidates) {
    const left = candidate.rect.x;
    const midX = candidate.rect.x + candidate.rect.width / 2;
    const right = candidate.rect.x + candidate.rect.width;
    const minY = Math.min(candidate.rect.y, movingPoint.y);
    const maxY = Math.max(candidate.rect.y + candidate.rect.height, movingPoint.y);

    xTargets.push(
      { coordinate: left, start: minY, end: maxY, kind: 'element-edge' },
      { coordinate: midX, start: minY, end: maxY, kind: 'element-center' },
      { coordinate: right, start: minY, end: maxY, kind: 'element-edge' },
    );
  }

  for (const target of xTargets) {
    const dist = Math.abs(movingPoint.x - target.coordinate);
    if (dist < bestDistX) {
      bestDistX = dist;
      candidateX = target.coordinate;
      snappedX = true;
    }
  }

  // Vertical target snapping candidates
  const yTargets: LineSnapTarget[] = [
    { coordinate: 0, start: 0, end: pageDimensions.width, kind: 'page-edge' },
    { coordinate: pageDimensions.height / 2, start: 0, end: pageDimensions.width, kind: 'page-center', label: 'Page Centre' },
    { coordinate: pageDimensions.height, start: 0, end: pageDimensions.width, kind: 'page-edge' },
  ];

  for (const candidate of candidates) {
    const top = candidate.rect.y;
    const midY = candidate.rect.y + candidate.rect.height / 2;
    const bottom = candidate.rect.y + candidate.rect.height;
    const minX = Math.min(candidate.rect.x, movingPoint.x);
    const maxX = Math.max(candidate.rect.x + candidate.rect.width, movingPoint.x);

    yTargets.push(
      { coordinate: top, start: minX, end: maxX, kind: 'element-edge' },
      { coordinate: midY, start: minX, end: maxX, kind: 'element-center' },
      { coordinate: bottom, start: minX, end: maxX, kind: 'element-edge' },
    );
  }

  for (const target of yTargets) {
    const dist = Math.abs(movingPoint.y - target.coordinate);
    if (dist < bestDistY) {
      bestDistY = dist;
      candidateY = target.coordinate;
      snappedY = true;
    }
  }

  if (snappedX) {
    const matched = xTargets.find((t) => Math.abs(t.coordinate - candidateX) < 0.001);
    if (matched) {
      guides.push({
        id: `line-snap-x-${matched.coordinate.toFixed(1)}`,
        orientation: 'vertical',
        coordinate: matched.coordinate,
        pageIndex,
        start: matched.start,
        end: matched.end,
        kind: matched.kind,
        label: matched.label,
      });
    }
  }

  if (snappedY) {
    const matched = yTargets.find((t) => Math.abs(t.coordinate - candidateY) < 0.001);
    if (matched) {
      guides.push({
        id: `line-snap-y-${matched.coordinate.toFixed(1)}`,
        orientation: 'horizontal',
        coordinate: matched.coordinate,
        pageIndex,
        start: matched.start,
        end: matched.end,
        kind: matched.kind,
        label: matched.label,
      });
    }
  }

  // Angle snapping calculation
  let finalPoint: Point = { x: candidateX, y: candidateY };
  let snappedAngle = false;
  let snappedAngleDeg: number | undefined;

  if (enableAngleSnap) {
    const dx = candidateX - fixedPoint.x;
    const dy = candidateY - fixedPoint.y;
    const length = Math.hypot(dx, dy);

    if (length > 1) {
      let currentAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (currentAngle < 0) {
        currentAngle += 360;
      }

      let closestStop = 0;
      let minAngleDiff = 360;
      const step = Math.max(1, angleSnapStepDeg);

      for (let stop = 0; stop <= 360; stop += step) {
        const diff = Math.abs(currentAngle - stop);
        const circularDiff = Math.min(diff, 360 - diff);
        if (circularDiff < minAngleDiff) {
          minAngleDiff = circularDiff;
          closestStop = stop === 360 ? 0 : stop;
        }
      }

      const shouldSnapAngle = shiftKey || (!snappedX && !snappedY && minAngleDiff <= angleSnapToleranceDeg);

      if (shouldSnapAngle) {
        snappedAngle = true;
        snappedAngleDeg = closestStop;

        const rad = (closestStop * Math.PI) / 180;
        finalPoint = {
          x: fixedPoint.x + length * Math.cos(rad),
          y: fixedPoint.y + length * Math.sin(rad),
        };

        // Suppress conflicting target snap guidelines when angular constraint repositions the point
        const toleranceCoord = 0.5;
        for (let i = guides.length - 1; i >= 0; i--) {
          const g = guides[i];
          if (g.orientation === 'vertical' && Math.abs(g.coordinate - finalPoint.x) > toleranceCoord) {
            guides.splice(i, 1);
            snappedX = false;
          } else if (g.orientation === 'horizontal' && Math.abs(g.coordinate - finalPoint.y) > toleranceCoord) {
            guides.splice(i, 1);
            snappedY = false;
          }
        }

        if (closestStop === 0 || closestStop === 180) {
          guides.push({
            id: `line-angle-${closestStop}`,
            orientation: 'horizontal',
            coordinate: fixedPoint.y,
            pageIndex,
            start: Math.min(fixedPoint.x, finalPoint.x),
            end: Math.max(fixedPoint.x, finalPoint.x),
            kind: 'element-edge',
            label: `${closestStop}deg`,
          });
        } else if (closestStop === 90 || closestStop === 270) {
          guides.push({
            id: `line-angle-${closestStop}`,
            orientation: 'vertical',
            coordinate: fixedPoint.x,
            pageIndex,
            start: Math.min(fixedPoint.y, finalPoint.y),
            end: Math.max(fixedPoint.y, finalPoint.y),
            kind: 'element-edge',
            label: `${closestStop}deg`,
          });
        }
      }
    }
  }

  return {
    point: finalPoint,
    snappedX,
    snappedY,
    snappedAngle,
    guides,
    snappedAngleDeg,
  };
}
