/**
 * Pure geometry and coordinate helpers for interactive and preset digital signature placement.
 *
 * Bridges top-left DOM/canvas coordinates (points increasing downward) and bottom-left
 * PDF coordinates (points increasing upward) while clamping freeform boxes to page bounds.
 */

/** Predefined or custom placement positions for a visual digital signature on a PDF page. */
export type SignaturePlacementPreset =
  | 'bottom-right'
  | 'bottom-left'
  | 'center'
  | 'top-right'
  | 'top-left'
  | 'custom';

/** Bounding rectangle in PDF points. */
export interface SignaturePlacementRect {
  /** Horizontal offset in points. */
  x: number;
  /** Vertical offset in points. */
  y: number;
  /** Box width in points. */
  width: number;
  /** Box height in points. */
  height: number;
}

/** Preset descriptor for UI controls and floating placement toolbars. */
export interface SignaturePresetOption {
  /** Preset identifier. */
  id: Exclude<SignaturePlacementPreset, 'custom'>;
  /** Full descriptive label. */
  label: string;
  /** Compact button label. */
  shortLabel: string;
}

/** Standard preset options for quick signature placement on a PDF page. */
export const SIGNATURE_PLACEMENT_PRESETS: readonly SignaturePresetOption[] = [
  { id: 'bottom-right', label: 'Bottom Right', shortLabel: 'Bottom R' },
  { id: 'bottom-left', label: 'Bottom Left', shortLabel: 'Bottom L' },
  { id: 'center', label: 'Center of Page', shortLabel: 'Center' },
  { id: 'top-right', label: 'Top Right', shortLabel: 'Top R' },
  { id: 'top-left', label: 'Top Left', shortLabel: 'Top L' },
] as const;

/** Default signature bounding box width in PDF points. */
export const DEFAULT_SIGNATURE_WIDTH_PTS = 180;

/** Default signature bounding box height in PDF points. */
export const DEFAULT_SIGNATURE_HEIGHT_PTS = 64;

/** Default page margin inset in PDF points for corner presets. */
export const DEFAULT_SIGNATURE_MARGIN_PTS = 36;

/**
 * Resolves a top-left canvas coordinate rectangle (in PDF points) for a given placement preset.
 *
 * @param preset Target placement preset identifier.
 * @param pageWidthPts Page width in PDF points.
 * @param pageHeightPts Page height in PDF points.
 * @param widthPts Signature box width in PDF points.
 * @param heightPts Signature box height in PDF points.
 * @param marginPts Inset margin from page edges in PDF points.
 * @return Bounding rectangle in top-left canvas coordinates.
 */
export function resolveSignaturePresetRect(
  preset: SignaturePlacementPreset,
  pageWidthPts: number,
  pageHeightPts: number,
  widthPts = DEFAULT_SIGNATURE_WIDTH_PTS,
  heightPts = DEFAULT_SIGNATURE_HEIGHT_PTS,
  marginPts = DEFAULT_SIGNATURE_MARGIN_PTS
): SignaturePlacementRect {
  const safePageW = pageWidthPts > 0 ? pageWidthPts : 612;
  const safePageH = pageHeightPts > 0 ? pageHeightPts : 792;
  const w = Math.min(Math.max(40, widthPts), safePageW);
  const h = Math.min(Math.max(24, heightPts), safePageH);
  const mX = Math.min(marginPts, Math.max(0, (safePageW - w) / 2));
  const mY = Math.min(marginPts, Math.max(0, (safePageH - h) / 2));

  let x = safePageW - w - mX;
  let y = safePageH - h - mY;

  switch (preset) {
    case 'bottom-left':
      x = mX;
      y = safePageH - h - mY;
      break;
    case 'center':
      x = (safePageW - w) / 2;
      y = (safePageH - h) / 2;
      break;
    case 'top-right':
      x = safePageW - w - mX;
      y = mY;
      break;
    case 'top-left':
      x = mX;
      y = mY;
      break;
    case 'bottom-right':
    case 'custom':
    default:
      x = safePageW - w - mX;
      y = safePageH - h - mY;
      break;
  }

  return {
    x: Math.round(Math.max(0, x) * 10) / 10,
    y: Math.round(Math.max(0, y) * 10) / 10,
    width: Math.round(w * 10) / 10,
    height: Math.round(h * 10) / 10,
  };
}

/**
 * Clamps a freeform top-left canvas signature rectangle so it remains inside the page boundaries.
 *
 * @param rect Proposed top-left rectangle in PDF points.
 * @param pageWidthPts Page width in PDF points.
 * @param pageHeightPts Page height in PDF points.
 * @param minWidthPts Minimum allowed box width in points.
 * @param minHeightPts Minimum allowed box height in points.
 * @return Clamped rectangle in top-left canvas coordinates.
 */
export function clampSignatureRectToPage(
  rect: SignaturePlacementRect,
  pageWidthPts: number,
  pageHeightPts: number,
  minWidthPts = 60,
  minHeightPts = 24
): SignaturePlacementRect {
  const safePageW = pageWidthPts > 0 ? pageWidthPts : 612;
  const safePageH = pageHeightPts > 0 ? pageHeightPts : 792;

  const width = Math.min(safePageW, Math.max(minWidthPts, rect.width));
  const height = Math.min(safePageH, Math.max(minHeightPts, rect.height));
  const x = Math.max(0, Math.min(safePageW - width, rect.x));
  const y = Math.max(0, Math.min(safePageH - height, rect.y));

  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    width: Math.round(width * 10) / 10,
    height: Math.round(height * 10) / 10,
  };
}

/**
 * Converts a top-left canvas signature rectangle into bottom-left PDF coordinates for pdf-lib.
 *
 * @param canvasRect Top-left rectangle in PDF points.
 * @param pageHeightPts Page height in PDF points.
 * @return Bottom-left rectangle in PDF points.
 */
export function canvasSignatureRectToPdfRect(
  canvasRect: SignaturePlacementRect,
  pageHeightPts: number
): SignaturePlacementRect {
  const safePageH = pageHeightPts > 0 ? pageHeightPts : 792;
  const pdfY = Math.max(0, safePageH - canvasRect.y - canvasRect.height);
  return {
    x: Math.round(canvasRect.x * 10) / 10,
    y: Math.round(pdfY * 10) / 10,
    width: Math.round(canvasRect.width * 10) / 10,
    height: Math.round(canvasRect.height * 10) / 10,
  };
}

/**
 * Converts a bottom-left PDF signature rectangle into top-left canvas coordinates.
 *
 * @param pdfRect Bottom-left rectangle in PDF points.
 * @param pageHeightPts Page height in PDF points.
 * @return Top-left rectangle in PDF points.
 */
export function pdfSignatureRectToCanvasRect(
  pdfRect: SignaturePlacementRect,
  pageHeightPts: number
): SignaturePlacementRect {
  const safePageH = pageHeightPts > 0 ? pageHeightPts : 792;
  const canvasY = Math.max(0, safePageH - pdfRect.y - pdfRect.height);
  return {
    x: Math.round(pdfRect.x * 10) / 10,
    y: Math.round(canvasY * 10) / 10,
    width: Math.round(pdfRect.width * 10) / 10,
    height: Math.round(pdfRect.height * 10) / 10,
  };
}
