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
    const maxDy = Math.max(0, height - minHeight);
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
    const maxDx = Math.max(0, width - minWidth);
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

/** Pre-measured page layout metrics to avoid forced reflows during gestures. */
export interface CachedPageMetrics {
  rect: { left: number; top: number; width: number; height: number };
  halfW: number;
  halfH: number;
}

/**
 * Captures static page metrics once at gesture start to eliminate layout thrashing.
 *
 * @param pageEl The page container element.
 * @returns Cached metrics for use in high-frequency pointer event handlers.
 */
export function capturePageMetrics(pageEl: HTMLElement): CachedPageMetrics {
  const domRect = pageEl.getBoundingClientRect();
  return {
    rect: {
      left: domRect.left,
      top: domRect.top,
      width: domRect.width,
      height: domRect.height,
    },
    halfW: pageEl.offsetWidth / 2,
    halfH: pageEl.offsetHeight / 2,
  };
}

/**
 * Converts viewport (screen) coordinates to page-point coordinates using pre-measured metrics.
 * Performs zero DOM reads, preventing forced synchronous layouts during pointer tracking.
 */
export function screenToPageCoordsWithMetrics(
  clientX: number,
  clientY: number,
  metrics: CachedPageMetrics,
  zoom: number = 1,
  pageTransform?: PageTransform,
): Point {
  const rotation = pageTransform?.rotation ?? 0;
  const scaleX = pageTransform?.scaleX ?? 1;
  const scaleY = pageTransform?.scaleY ?? 1;
  const { rect, halfW, halfH } = metrics;

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

  return {
    x: (lx + halfW) / zoom,
    y: (ly + halfH) / zoom,
  };
}

/** Convert viewport (screen) coordinates to page-point coordinates. */
export function screenToPageCoords(
  clientX: number,
  clientY: number,
  pageEl: HTMLElement,
  zoom: number = 1,
  pageTransform?: PageTransform,
): Point {
  const metrics = capturePageMetrics(pageEl);
  return screenToPageCoordsWithMetrics(clientX, clientY, metrics, zoom, pageTransform);
}

/** Check if a point is within an axis-aligned rect. */
export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** Check if a point is within a rotated rect (rotated around its center). */
export function pointInRotatedRect(point: Point, rect: Rect, rotationDegrees: number = 0): boolean {
  if (rotationDegrees === 0) {
    return pointInRect(point, rect);
  }

  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;

  const rad = -rotationDegrees * (Math.PI / 180);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const localX = dx * cos - dy * sin + cx;
  const localY = dx * sin + dy * cos + cy;

  return (
    localX >= rect.x &&
    localX <= rect.x + rect.width &&
    localY >= rect.y &&
    localY <= rect.y + rect.height
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

/**
 * Get rotate cursor class for a given handle position.
 * When isPage is true, the cursor rotate style is omitted solely for the page.
 */
export function getRotateCursorClass(handle: HandlePosition, isPage: boolean = false): string {
  if (isPage) return '';
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

/**
 * Transform a point's coordinates when a page is rotated.
 * Converts from pre-rotation coordinate space to post-rotation coordinate space.
 * @param point - The point in the old coordinate space
 * @param degreesDelta - Clockwise rotation: 90, 180, or 270
 * @param pageWidth - Page width BEFORE rotation (in points)
 * @param pageHeight - Page height BEFORE rotation (in points)
 */
export function transformPointForPageRotation(
  point: Point,
  degreesDelta: 90 | 180 | 270,
  pageWidth: number,
  pageHeight: number,
): Point {
  switch (degreesDelta) {
    case 90:
      return { x: pageHeight - point.y, y: point.x };
    case 180:
      return { x: pageWidth - point.x, y: pageHeight - point.y };
    case 270:
      return { x: point.y, y: pageWidth - point.x };
  }
}

/**
 * Transform a rectangle's coordinates and dimensions when a page is rotated.
 * Handles width/height swapping for 90/270 degree rotations.
 * @param rect - The rectangle in the old coordinate space
 * @param degreesDelta - Clockwise rotation: 90, 180, or 270
 * @param pageWidth - Page width BEFORE rotation (in points)
 * @param pageHeight - Page height BEFORE rotation (in points)
 */
export function transformRectForPageRotation(
  rect: Rect,
  degreesDelta: 90 | 180 | 270,
  pageWidth: number,
  pageHeight: number,
): Rect {
  switch (degreesDelta) {
    case 90:
      return {
        x: pageHeight - (rect.y + rect.height),
        y: rect.x,
        width: rect.height,
        height: rect.width,
      };
    case 180:
      return {
        x: pageWidth - (rect.x + rect.width),
        y: pageHeight - (rect.y + rect.height),
        width: rect.width,
        height: rect.height,
      };
    case 270:
      return {
        x: rect.y,
        y: pageWidth - (rect.x + rect.width),
        width: rect.height,
        height: rect.width,
      };
  }
}

/** Parameters required to compute viewport centering for a page. */
export interface ViewportCenteringParams {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  pageOffsetLeft: number;
  pageOffsetTop: number;
  pageWidth: number;
  pageHeight: number;
  visibleOffsetX?: number;
  visibleWidth?: number;
  visibleOffsetY?: number;
  visibleHeight?: number;
}

/** Scroll offsets for positioning the viewport. */
export interface ViewportScrollPosition {
  scrollLeft: number;
  scrollTop: number;
}

/**
 * Calculates the exact scroll offsets to center a page in the viewport.
 * Horizontally centers the page within the visible viewport area.
 * Vertically centers the page if it fits inside the viewport, or aligns its top
 * with comfortable padding if the page is taller than the viewport.
 */
export function calculatePageCenteringScroll(
  params: ViewportCenteringParams
): ViewportScrollPosition {
  const {
    viewportWidth,
    viewportHeight,
    pageOffsetLeft,
    pageOffsetTop,
    pageWidth,
    pageHeight,
    visibleOffsetX,
    visibleWidth,
    visibleOffsetY,
    visibleHeight,
  } = params;

  // Horizontal center:
  // If a visible sub-area is specified (e.g. canvas opening between side panels),
  // center relative to that area. Otherwise center across the full viewport width.
  const targetVisibleWidth = visibleWidth ?? viewportWidth;
  const targetVisibleOffsetX = visibleOffsetX ?? 0;
  const pageCenterX = pageOffsetLeft + pageWidth / 2;
  const targetCenterX = targetVisibleOffsetX + targetVisibleWidth / 2;
  const targetScrollLeft = Math.max(0, pageCenterX - targetCenterX);

  // Vertical center:
  // If the page fits within the viewport height, center it vertically with equal margins above and below.
  // If the page is taller than the viewport, align its top with padding so the top header is visible.
  const targetVisibleHeight = visibleHeight ?? viewportHeight;
  const targetVisibleOffsetY = visibleOffsetY ?? 0;
  let targetScrollTop: number;
  if (pageHeight <= targetVisibleHeight) {
    const pageCenterY = pageOffsetTop + pageHeight / 2;
    const targetCenterY = targetVisibleOffsetY + targetVisibleHeight / 2;
    targetScrollTop = Math.max(0, pageCenterY - targetCenterY);
  } else {
    targetScrollTop = Math.max(0, pageOffsetTop - targetVisibleOffsetY - 24);
  }

  return {
    scrollLeft: Math.round(targetScrollLeft),
    scrollTop: Math.round(targetScrollTop),
  };
}

/**
 * Rect bounds representing a page layout in viewport or screen coordinates.
 */
export interface PageLayoutBound {
  pageIndex: number;
  top: number;
  bottom: number;
}

/**
 * Resolves which page an element or pointer belongs to based on vertical position
 * and midpoint thresholds between adjacent pages.
 *
 * @param pointerY The vertical coordinate of the pointer or element center.
 * @param pageBounds List of page bounds sorted in ascending order of layout.
 * @param fallbackIndex The fallback page index if no bounds are available.
 * @returns The resolved target page index.
 */
export function resolveTargetPageIndex(
  pointerY: number,
  pageBounds: PageLayoutBound[],
  fallbackIndex: number = 0,
): number {
  if (pageBounds.length === 0) return fallbackIndex;
  if (pageBounds.length === 1) return pageBounds[0].pageIndex;

  const first = pageBounds[0];
  const second = pageBounds[1];
  const firstThreshold = (first.bottom + second.top) / 2;
  if (pointerY < firstThreshold) {
    return first.pageIndex;
  }

  for (let i = 1; i < pageBounds.length - 1; i++) {
    const current = pageBounds[i];
    const prev = pageBounds[i - 1];
    const next = pageBounds[i + 1];

    const topThreshold = (prev.bottom + current.top) / 2;
    const bottomThreshold = (current.bottom + next.top) / 2;

    if (pointerY >= topThreshold && pointerY < bottomThreshold) {
      return current.pageIndex;
    }
  }

  const last = pageBounds[pageBounds.length - 1];
  const secondToLast = pageBounds[pageBounds.length - 2];
  const lastThreshold = (secondToLast.bottom + last.top) / 2;

  if (pointerY >= lastThreshold) {
    return last.pageIndex;
  }

  return first.pageIndex;
}

/**
 * Viewport rect for determining out-of-bounds scrolling.
 */
export interface ViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Calculates scrolling speeds when dragging out of viewport bounds.
 * Returns speedX = 0 and speedY = 0 when pointer is within viewport bounds.
 *
 * @param clientX Horizontal pointer coordinate.
 * @param clientY Vertical pointer coordinate.
 * @param viewport Viewport bounding rect.
 * @param maxSpeed Maximum speed in pixels per frame.
 * @returns Object with speedX and speedY.
 */
export function calculateOutOfBoundsScrollSpeeds(
  clientX: number,
  clientY: number,
  viewport: ViewportRect,
  maxSpeed: number = 20,
): { speedX: number; speedY: number } {
  let speedX = 0;
  let speedY = 0;

  // Out-of-bounds vertical scrolling
  if (clientY < viewport.top) {
    const overflowY = viewport.top - clientY;
    speedY = -Math.min(maxSpeed, Math.max(2, Math.round(overflowY * 0.4)));
  } else if (clientY > viewport.bottom) {
    const overflowY = clientY - viewport.bottom;
    speedY = Math.min(maxSpeed, Math.max(2, Math.round(overflowY * 0.4)));
  }

  // Out-of-bounds horizontal scrolling
  if (clientX < viewport.left) {
    const overflowX = viewport.left - clientX;
    speedX = -Math.min(maxSpeed, Math.max(2, Math.round(overflowX * 0.4)));
  } else if (clientX > viewport.right) {
    const overflowX = clientX - viewport.right;
    speedX = Math.min(maxSpeed, Math.max(2, Math.round(overflowX * 0.4)));
  }

  return { speedX, speedY };
}

/** Standard default inter-page vertical gap in pixels. */
export const BASE_PAGE_GAP = 32;

/** Parameters for computing page layout dimensions and inter-page spacing. */
export interface PageLayoutDimensionsParams {
  widthPts: number;
  heightPts: number;
  zoom: number;
  pageTransform?: PageTransform;
  isLastPage?: boolean;
}

/** Computed layout dimensions and margin spacing for a page container. */
export interface PageLayoutDimensions {
  width: number;
  height: number;
  spacing: number;
}

/**
 * Calculates layout box dimensions and inter-page spacing for a PDF page.
 *
 * Ensures that visual scaling and orthogonal rotations (90/270 degrees) are
 * fully accounted for in the DOM layout box, and that inter-page spacing scales
 * proportionally with page resize so adjacent pages never collide or collapse.
 *
 * @param params Page dimensions, zoom factor, transform, and document position.
 * @returns Object with width, height, and spacing in pixels.
 */
export function calculatePageLayoutDimensions(
  params: PageLayoutDimensionsParams,
): PageLayoutDimensions {
  const {
    widthPts,
    heightPts,
    zoom,
    pageTransform,
    isLastPage = false,
  } = params;

  const rotation = pageTransform?.rotation ?? 0;
  const isRotatedOrthogonal = rotation === 90 || rotation === 270;
  const scaleX = pageTransform?.scaleX ?? 1;
  const scaleY = pageTransform?.scaleY ?? 1;

  const rawWidth = isRotatedOrthogonal ? heightPts * scaleY : widthPts * scaleX;
  const rawHeight = isRotatedOrthogonal ? widthPts * scaleX : heightPts * scaleY;

  const width = Math.round(rawWidth * zoom);
  const height = Math.round(rawHeight * zoom);

  const effectiveVerticalScale = isRotatedOrthogonal ? scaleX : scaleY;
  const spacing = isLastPage
    ? 0
    : Math.round(BASE_PAGE_GAP * Math.max(0.25, effectiveVerticalScale));

  return { width, height, spacing };
}

/** Parameters for pure arithmetic zoom scroll offset calculation. */
export interface ZoomScrollParams {
  currentZoom: number;
  newZoom: number;
  scrollLeft: number;
  scrollTop: number;
  pointerViewportX: number;
  pointerViewportY: number;
  paddingLeft?: number;
  paddingTop?: number;
}

/**
 * Calculates new scrollLeft and scrollTop to preserve the exact point
 * under the pointer during zoom without requiring DOM measurements or layout reflows.
 */
export function calculateZoomScrollOffsets(params: ZoomScrollParams): ViewportScrollPosition {
  const {
    currentZoom,
    newZoom,
    scrollLeft,
    scrollTop,
    pointerViewportX,
    pointerViewportY,
    paddingLeft = 0,
    paddingTop = 0,
  } = params;

  if (newZoom === currentZoom || currentZoom <= 0) {
    return { scrollLeft, scrollTop };
  }

  // Content point in unzoomed space relative to content origin
  const contentX = (scrollLeft + pointerViewportX - paddingLeft) / currentZoom;
  const contentY = (scrollTop + pointerViewportY - paddingTop) / currentZoom;

  // New scroll position keeping content point aligned with pointer in viewport
  const newScrollLeft = Math.max(0, Math.round(contentX * newZoom + paddingLeft - pointerViewportX));
  const newScrollTop = Math.max(0, Math.round(contentY * newZoom + paddingTop - pointerViewportY));

  return {
    scrollLeft: newScrollLeft,
    scrollTop: newScrollTop,
  };
}

/** Default wheel zoom sensitivity divisor matching initial commit (140). */
export const DEFAULT_ZOOM_WHEEL_DIVISOR = 140;

/**
 * Calculates a smooth zoom factor from an accumulated wheel delta.
 *
 * Uses the calibrated exponential curve from the initial commit: 2^(-deltaY / 140).
 *
 * @param deltaY Accumulated vertical wheel delta in pixels.
 * @param divisor Sensitivity divisor (default: 140).
 * @returns Multiplicative zoom factor.
 */
export function calculateSmoothZoomFactor(
  deltaY: number,
  divisor: number = DEFAULT_ZOOM_WHEEL_DIVISOR
): number {
  if (deltaY === 0 || !Number.isFinite(deltaY)) {
    return 1.0;
  }
  return Math.pow(2, -deltaY / divisor);
}

/** Precomputed vertical bounds for a page in the document flow. */
export interface PageVerticalOffset {
  pageIndex: number;
  top: number;
  bottom: number;
  threshold: number;
}

/**
 * Precomputes cumulative vertical offsets and transition thresholds for all pages.
 *
 * @param pageLayouts Array of layout dimensions for each page.
 * @param initialTop The vertical starting offset of the first page.
 * @returns Array of PageVerticalOffset for fast O(log N) lookup.
 */
export function computePageVerticalOffsets(
  pageLayouts: PageLayoutDimensions[],
  initialTop: number = 0,
): PageVerticalOffset[] {
  const offsets: PageVerticalOffset[] = [];
  let currentTop = initialTop;

  for (let i = 0; i < pageLayouts.length; i++) {
    const layout = pageLayouts[i];
    const top = currentTop;
    const bottom = top + layout.height;
    const isLast = i === pageLayouts.length - 1;
    const threshold = isLast ? bottom : bottom + layout.spacing / 2;

    offsets.push({
      pageIndex: i,
      top,
      bottom,
      threshold,
    });

    currentTop = bottom + layout.spacing;
  }

  return offsets;
}

/**
 * Resolves the active page index from precomputed vertical offsets via binary search.
 *
 * @param scrollY Target scroll vertical coordinate.
 * @param offsets Precomputed page vertical offsets.
 * @returns Zero-based page index.
 */
export function resolvePageIndexFromOffsets(
  scrollY: number,
  offsets: PageVerticalOffset[],
): number {
  if (offsets.length === 0) return 0;
  if (offsets.length === 1) return 0;

  if (scrollY < offsets[0].threshold) {
    return 0;
  }

  const lastIdx = offsets.length - 1;
  if (scrollY >= offsets[lastIdx - 1].threshold) {
    return lastIdx;
  }

  // Binary search across thresholds
  let low = 0;
  let high = lastIdx;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const prevThreshold = mid > 0 ? offsets[mid - 1].threshold : -Infinity;
    const currentThreshold = offsets[mid].threshold;

    if (scrollY >= prevThreshold && scrollY < currentThreshold) {
      return mid;
    }

    if (scrollY < prevThreshold) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return 0;
}
