import type { HandlePosition } from '../stores/canvas-types';
import type { PageTransform } from '../stores/types';

/** Axis-aligned bounding box in PDF points. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A 2D point in PDF coordinate space. */
export interface Point {
  x: number;
  y: number;
}

/** Minimum element dimensions in PDF points. */
const DEFAULT_MIN_WIDTH = 20;
const DEFAULT_MIN_HEIGHT = 20;

/** All handle positions in consistent order. */
const HANDLE_POSITIONS: HandlePosition[] = [
  'top-left', 'top', 'top-right', 'right',
  'bottom-right', 'bottom', 'bottom-left', 'left',
];

/** Clamp an element rect to stay within page bounds. */
export function clampToPage(rect: Rect, pageWidth: number, pageHeight: number): Rect {
  const x = Math.max(0, Math.min(rect.x, pageWidth - rect.width));
  const y = Math.max(0, Math.min(rect.y, pageHeight - rect.height));
  return { x, y, width: rect.width, height: rect.height };
}

/** Return the 8 handle positions for a given element rect. */
export function getResizeHandlePositions(rect: Rect): Record<HandlePosition, Point> {
  const { x, y, width, height } = rect;
  const midX = x + width / 2;
  const midY = y + height / 2;
  const right = x + width;
  const bottom = y + height;

  return {
    'top-left': { x, y },
    'top': { x: midX, y },
    'top-right': { x: right, y },
    'right': { x: right, y: midY },
    'bottom-right': { x: right, y: bottom },
    'bottom': { x: midX, y: bottom },
    'bottom-left': { x, y: bottom },
    'left': { x, y: midY },
  };
}

/**
 * Compute the new rect after dragging a resize handle.
 * Adjusts the appropriate edges based on handle position
 * while enforcing minimum dimensions.
 */
export function applyResize(
  handle: HandlePosition,
  deltaX: number,
  deltaY: number,
  originRect: Rect,
  minWidth: number = DEFAULT_MIN_WIDTH,
  minHeight: number = DEFAULT_MIN_HEIGHT,
): Rect {
  let { x, y, width, height } = originRect;

  // Vertical: top handles move top edge
  if (handle.includes('top')) {
    const maxDy = height - minHeight;
    const clampedDy = Math.min(deltaY, maxDy);
    y += clampedDy;
    height -= clampedDy;
  }

  // Vertical: bottom handles move bottom edge
  if (handle.includes('bottom')) {
    height = Math.max(minHeight, height + deltaY);
  }

  // Horizontal: left handles move left edge
  if (handle.includes('left')) {
    const maxDx = width - minWidth;
    const clampedDx = Math.min(deltaX, maxDx);
    x += clampedDx;
    width -= clampedDx;
  }

  // Horizontal: right handles move right edge
  if (handle.includes('right')) {
    width = Math.max(minWidth, width + deltaX);
  }

  return { x, y, width, height };
}

/** Convert viewport (screen) coordinates to page-point coordinates. */
export function screenToPageCoords(
  clientX: number,
  clientY: number,
  pageEl: HTMLElement,
  zoom: number,
  pageTransform?: PageTransform,
): Point {
  const rect = pageEl.getBoundingClientRect();
  const rotation = pageTransform?.rotation ?? 0;
  const scaleX = pageTransform?.scaleX ?? 1;
  const scaleY = pageTransform?.scaleY ?? 1;

  // Fast path for identity page transforms
  if (rotation === 0 && scaleX === 1 && scaleY === 1) {
    return {
      x: (clientX - rect.left) / zoom,
      y: (clientY - rect.top) / zoom,
    };
  }

  // Center of the bounding box is stable under center-origin rotation
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;

  // Un-rotate pointer offset
  const rad = -rotation * (Math.PI / 180);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ux = dx * cos - dy * sin;
  const uy = dx * sin + dy * cos;

  // Un-scale to get layout-space offset
  const lx = ux / scaleX;
  const ly = uy / scaleY;

  // offsetWidth/offsetHeight return pre-transform layout dimensions
  const halfW = pageEl.offsetWidth / 2;
  const halfH = pageEl.offsetHeight / 2;

  return {
    x: (lx + halfW) / zoom,
    y: (ly + halfH) / zoom,
  };
}

/** Check if a point is within a rect. */
export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** Get CSS cursor style for a given handle position. */
export function getHandleCursor(handle: HandlePosition): string {
  switch (handle) {
    case 'top-left':
    case 'bottom-right':
      return 'var(--cursor-nwse-resize, nwse-resize)';
    case 'top-right':
    case 'bottom-left':
      return 'var(--cursor-nesw-resize, nesw-resize)';
    case 'top':
    case 'bottom':
      return 'var(--cursor-ns-resize, ns-resize)';
    case 'left':
    case 'right':
      return 'var(--cursor-ew-resize, ew-resize)';
    default:
      return 'var(--cursor-default, default)';
  }
}

/** Get rotate cursor class for a given handle position. */
export function getRotateCursorClass(handle: HandlePosition): string {
  switch (handle) {
    case 'top-left':
      return 'cursor-rotate-tl';
    case 'top-right':
      return 'cursor-rotate-tr';
    case 'bottom-left':
      return 'cursor-rotate-bl';
    case 'bottom-right':
      return 'cursor-rotate-br';
    default:
      return 'cursor-rotate-tr';
  }
}

/** Get all handle positions as an ordered array. */
export function getAllHandlePositions(): HandlePosition[] {
  return HANDLE_POSITIONS;
}
