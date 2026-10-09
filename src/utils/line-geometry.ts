/**
 * Line and arrow geometry utilities for endpoint-based selection and transformations.
 *
 * Provides bidirectional coordinate mappings between standard bounding boxes
 * and linear start and end endpoints, accounting for rotation and horizontal reflection.
 */

import type { Point } from '../stores/canvas-types';
import type { FeatureFlagStore } from '../core/feature-flags.svelte';

/** Coordinates representing the start and end terminals of a line or arrow. */
export interface LineEndpoints {
  /** Start point coordinate in PDF page points. */
  start: Point;
  /** End point coordinate in PDF page points. */
  end: Point;
}

/** Supported selection overlay variation modes. */
export type SelectionVariation = 'box' | 'line' | 'auto';

/** Minimal element geometric properties required for endpoint calculation. */
export interface ElementGeometryBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
}

/** Candidate element descriptor for selection variation resolution. */
export interface SelectionVariationCandidate {
  kind?: string;
  variant?: string;
  type?: string;
  selectionVariation?: SelectionVariation;
}

/**
 * Computes the page-space start and end terminal points for a line or arrow element.
 *
 * Reflects start and end points across the bounding centre when horizontal flip is active
 * so that visual terminal handles match the rendered line orientation and arrowhead.
 *
 * @param element Element geometry descriptor containing bounding box, rotation, and reflection.
 * @return Resolved start and end points in PDF page points.
 */
export function getLineEndpoints(element: ElementGeometryBounds): LineEndpoints {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const halfWidth = element.width / 2;
  const rad = ((element.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const flipSign = element.flipX ? -1 : 1;

  return {
    start: {
      x: cx - halfWidth * cos * flipSign,
      y: cy - halfWidth * sin * flipSign,
    },
    end: {
      x: cx + halfWidth * cos * flipSign,
      y: cy + halfWidth * sin * flipSign,
    },
  };
}

/**
 * Converts start and end terminal coordinates into standard element bounding box properties.
 *
 * Computes the Euclidean distance and directional angle, ensuring the angle is normalised
 * to the range between zero and three hundred and sixty degrees.
 *
 * @param start Start point coordinate in PDF page points.
 * @param end End point coordinate in PDF page points.
 * @param height Height thickness in PDF page points, defaulting to twenty.
 * @return Normalised element bounding box and rotation angle in degrees.
 */
export function elementFromLineEndpoints(
  start: Point,
  end: Point,
  height: number = 20,
): { x: number; y: number; width: number; height: number; rotation: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const width = Math.max(5, length);
  const cx = (start.x + end.x) / 2;
  const cy = (start.y + end.y) / 2;

  let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angleDeg < 0) {
    angleDeg += 360;
  }

  const x = cx - width / 2;
  const y = cy - height / 2;

  return {
    x,
    y,
    width,
    height,
    rotation: angleDeg,
  };
}

/**
 * Identifies whether an element represents a linear shape, specifically a line or arrow.
 *
 * Inspects both canvas element descriptors and native PDF layout span records.
 *
 * @param element Canvas element or span candidate to inspect.
 * @return True if the element is a line or arrow shape variant.
 */
export function isLineElement(
  element: SelectionVariationCandidate | null | undefined,
): boolean {
  if (!element) return false;
  if (element.kind === 'shape' && (element.variant === 'line' || element.variant === 'arrow')) {
    return true;
  }
  if (element.type === 'shape' && (element.variant === 'line' || element.variant === 'arrow')) {
    return true;
  }
  return false;
}

/**
 * Resolves the visual selection variation for an element based on explicit mode and feature gating.
 *
 * Prioritises explicit caller overrides, followed by element-level properties, feature flag status,
 * and finally automatic taxonomy inspection.
 *
 * @param element Element descriptor to inspect.
 * @param explicitVariation Optional explicit variation override.
 * @param featureFlags Optional feature flag store instance for capability checks.
 * @return Resolved selection overlay variation, either line or box.
 */
export function resolveSelectionVariation(
  element: SelectionVariationCandidate | null | undefined,
  explicitVariation: SelectionVariation = 'auto',
  featureFlags?: FeatureFlagStore,
): 'box' | 'line' {
  if (explicitVariation === 'box') {
    return 'box';
  }
  if (explicitVariation === 'line') {
    return 'line';
  }

  if (featureFlags && !featureFlags.isEnabled('select-tool.line-endpoints')) {
    return 'box';
  }

  return isLineElement(element) ? 'line' : 'box';
}
