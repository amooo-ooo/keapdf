/**
 * Text layer layout and typographical scaling utilities.
 *
 * Computes precision coordinates, word spacing, and horizontal scaling
 * factors for viewing mode text selection overlay spans to eliminate
 * inter-line vertical overlap and character drift against canvas glyphs.
 */

import type { TextLine, EditableTextSpan } from '../../core/types';

/**
 * Computed style parameters for a precision text layer span.
 */
export interface TextLineLayoutStyle {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  wordSpacing: number;
  scaleX: number;
  rotation: number;
  styleString: string;
}

/** In-memory cache for unscaled text measurements at 100px reference font size. */
const measurementCache = new Map<string, number>();

/** Maximum number of measurement entries retained in memory. */
const MAX_CACHE_ENTRIES = 2000;

/** Offscreen canvas context for measuring unscaled text widths. */
let offscreenCtx: CanvasRenderingContext2D | null = null;

/**
 * Initialises and retrieves an offscreen canvas rendering context.
 *
 * @return 2D canvas context or null in non-browser environments.
 */
function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!offscreenCtx) {
    const canvas = document.createElement('canvas');
    offscreenCtx = canvas.getContext('2d');
  }
  return offscreenCtx;
}

/**
 * Measures the base width of a text string at a normalized 100px font size.
 *
 * @param text The text string to measure.
 * @param fontFamily Resolved CSS font family.
 * @return Width in pixels at 100px font size.
 */
export function measureBaseTextWidth(text: string, fontFamily: string): number {
  if (!text) return 0;
  const cacheKey = `${text}|${fontFamily}`;
  const cached = measurementCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const ctx = getMeasurementContext();
  if (!ctx) return text.length * 55; // Standard fallback estimate

  ctx.font = `100px ${fontFamily}`;
  const width = ctx.measureText(text).width;

  if (measurementCache.size >= MAX_CACHE_ENTRIES) {
    measurementCache.clear();
  }
  measurementCache.set(cacheKey, width);
  return width;
}

/**
 * Computes calibrated layout metrics and inline styles for a TextLine.
 *
 * @param line Target TextLine containing word metrics and bounding box.
 * @param visualScale Current zoom scale factor.
 * @param cssFontFamily Resolved CSS font family string.
 * @return Precision layout style parameters.
 */
export function computeLineLayoutStyle(
  line: TextLine,
  visualScale: number,
  cssFontFamily: string
): TextLineLayoutStyle {
  const left = line.left * visualScale;
  const top = line.top * visualScale;
  const targetWidth = Math.max(1, line.width * visualScale);
  const targetHeight = Math.max(1, line.height * visualScale);
  const dominantFontSize = line.fontSize || 12;
  const fontSize = Math.min(targetHeight, dominantFontSize * visualScale);

  const words = line.words || [];
  let wordSpacing = 0;
  let spacesCount = 0;

  if (words.length > 1) {
    spacesCount = words.length - 1;
    const sumWordWidths = words.reduce((acc, w) => acc + w.width, 0);
    const totalSpaceInPdf = Math.max(0, line.width - sumWordWidths);
    const avgSpaceInPdf = totalSpaceInPdf / spacesCount;
    const standardSpaceInPdf = dominantFontSize * 0.28;
    const diffSpace = avgSpaceInPdf - standardSpaceInPdf;
    const extraWordSpacingPx = diffSpace * visualScale;
    // Bound extra spacing to prevent excessive word separation or overlapping
    wordSpacing = Math.max(-4, Math.min(28, extraWordSpacingPx));
  }

  const baseWidth = measureBaseTextWidth(line.text, cssFontFamily);
  const predictedWidth = (baseWidth * (fontSize / 100)) + (spacesCount * wordSpacing);

  let scaleX = 1;
  if (predictedWidth > 0 && targetWidth > 0) {
    const rawRatio = targetWidth / predictedWidth;
    // Keep horizontal stretch factor within realistic typographic bounds
    scaleX = Math.max(0.75, Math.min(1.35, rawRatio));
  }

  const rotation = line.rotation || 0;
  const transform = rotation !== 0
    ? `transform: rotate(${rotation}deg) scaleX(${scaleX.toFixed(4)});`
    : Math.abs(scaleX - 1) > 0.005
      ? `transform: scaleX(${scaleX.toFixed(4)});`
      : '';

  const wordSpacingStyle = Math.abs(wordSpacing) > 0.1
    ? `word-spacing: ${wordSpacing.toFixed(2)}px;`
    : '';

  const styleString = `left: ${left.toFixed(2)}px; top: ${top.toFixed(2)}px; font-size: ${fontSize.toFixed(2)}px; line-height: 1; height: ${targetHeight.toFixed(2)}px; overflow: hidden; font-family: ${cssFontFamily}; transform-origin: 0% 0%; ${transform} ${wordSpacingStyle}`.replace(/\s+/g, ' ').trim();

  return {
    left,
    top,
    width: targetWidth,
    height: targetHeight,
    fontSize,
    wordSpacing,
    scaleX,
    rotation,
    styleString,
  };
}

/**
 * Computes calibrated layout metrics and inline styles for a fallback EditableTextSpan.
 *
 * @param span Target text span.
 * @param visualScale Current zoom scale factor.
 * @param cssFontFamily Resolved CSS font family string.
 * @return Precision layout style parameters.
 */
export function computeSpanFallbackLayoutStyle(
  span: EditableTextSpan,
  visualScale: number,
  cssFontFamily: string
): TextLineLayoutStyle {
  const left = span.left * visualScale;
  const top = span.top * visualScale;
  const targetWidth = Math.max(1, span.width * visualScale);
  const targetHeight = Math.max(1, span.height * visualScale);
  const dominantFontSize = span.fontSize || 12;
  const fontSize = Math.min(targetHeight, dominantFontSize * visualScale);

  const words = span.text ? span.text.trim().split(/\s+/) : [];
  let wordSpacing = 0;
  let spacesCount = 0;

  if (words.length > 1) {
    spacesCount = words.length - 1;
    const estWordsWidth = words.reduce((acc, w) => acc + (w.length * dominantFontSize * 0.52), 0);
    const totalSpaceInPdf = Math.max(0, span.width - estWordsWidth);
    const avgSpaceInPdf = totalSpaceInPdf / spacesCount;
    const standardSpaceInPdf = dominantFontSize * 0.28;
    const diffSpace = avgSpaceInPdf - standardSpaceInPdf;
    wordSpacing = Math.max(-4, Math.min(28, diffSpace * visualScale));
  }

  const baseWidth = measureBaseTextWidth(span.text, cssFontFamily);
  const predictedWidth = (baseWidth * (fontSize / 100)) + (spacesCount * wordSpacing);

  let scaleX = 1;
  if (predictedWidth > 0 && targetWidth > 0) {
    const rawRatio = targetWidth / predictedWidth;
    scaleX = Math.max(0.75, Math.min(1.35, rawRatio));
  }

  const rotation = span.rotation || 0;
  const transform = rotation !== 0
    ? `transform: rotate(${rotation}deg) scaleX(${scaleX.toFixed(4)});`
    : Math.abs(scaleX - 1) > 0.005
      ? `transform: scaleX(${scaleX.toFixed(4)});`
      : '';

  const wordSpacingStyle = Math.abs(wordSpacing) > 0.1
    ? `word-spacing: ${wordSpacing.toFixed(2)}px;`
    : '';

  const styleString = `left: ${left.toFixed(2)}px; top: ${top.toFixed(2)}px; font-size: ${fontSize.toFixed(2)}px; line-height: 1; height: ${targetHeight.toFixed(2)}px; overflow: hidden; font-family: ${cssFontFamily}; transform-origin: 0% 0%; ${transform} ${wordSpacingStyle}`.replace(/\s+/g, ' ').trim();

  return {
    left,
    top,
    width: targetWidth,
    height: targetHeight,
    fontSize,
    wordSpacing,
    scaleX,
    rotation,
    styleString,
  };
}
