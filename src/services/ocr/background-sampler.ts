/**
 * Pixel-sampling background color detection for scanned document paper substrate.
 * Samples perimeter pixels around a bounding box to determine the optimal fill color
 * for covering old scanned text glyphs during inline text replacement.
 */

import type { OcrBoundingBox, SampledBackgroundColor } from './ocr-types';

/**
 * Converts RGB components to a 6-digit hex color string.
 */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (c: number): string => {
    const clamped = Math.max(0, Math.min(255, Math.round(c)));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Calculates relative luminance of an RGB color according to WCAG formula.
 */
function getLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Samples pixel color data around the perimeter of a bounding box on a canvas or ImageData.
 * Filters out dark text foreground pixels to isolate the underlying paper tone.
 *
 * @param source HTMLCanvasElement or ImageData representing the rendered page.
 * @param bbox Bounding box of the target text span in canvas pixel coordinates.
 * @param marginPadding Optional pixel margin offset around the bounding box (default: 2).
 * @return SampledBackgroundColor containing RGBA components and hex string.
 */
export function sampleBackgroundColor(
  source: HTMLCanvasElement | ImageData,
  bbox: OcrBoundingBox,
  marginPadding: number = 2
): SampledBackgroundColor {
  let imgData: ImageData | null = null;
  let width = 0;
  let height = 0;

  if ('data' in source && source.data instanceof Uint8ClampedArray) {
    imgData = source;
    width = source.width;
    height = source.height;
  } else if ('getContext' in source && typeof (source as HTMLCanvasElement).getContext === 'function') {
    const canvas = source as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { r: 255, g: 255, b: 255, a: 1, hex: '#ffffff', isLight: true };
    }
    width = canvas.width;
    height = canvas.height;
    try {
      imgData = ctx.getImageData(0, 0, width, height);
    } catch {
      return { r: 255, g: 255, b: 255, a: 1, hex: '#ffffff', isLight: true };
    }
  }

  if (!imgData || width <= 0 || height <= 0) {
    return { r: 255, g: 255, b: 255, a: 1, hex: '#ffffff', isLight: true };
  }

  const data = imgData.data;

  // Compute sample perimeter coordinates with bounds clamping
  const minX = Math.max(0, Math.floor(bbox.left - marginPadding));
  const maxX = Math.min(width - 1, Math.ceil(bbox.left + bbox.width + marginPadding));
  const minY = Math.max(0, Math.floor(bbox.top - marginPadding));
  const maxY = Math.min(height - 1, Math.ceil(bbox.top + bbox.height + marginPadding));

  if (maxX <= minX || maxY <= minY) {
    return { r: 255, g: 255, b: 255, a: 1, hex: '#ffffff' };
  }

  interface RgbSample {
    r: number;
    g: number;
    b: number;
    lum: number;
  }

  const samples: RgbSample[] = [];

  const addSample = (x: number, y: number): void => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = (y * width + x) * 4;
    const a = data[idx + 3];
    // Ignore fully transparent pixels
    if (a < 50) return;

    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const lum = getLuminance(r, g, b);

    // Filter out dark ink/text strokes (lum < 110) unless the entire page is dark
    samples.push({ r, g, b, lum });
  };

  // Sample top edge and bottom edge
  const stepX = Math.max(1, Math.floor((maxX - minX) / 20));
  for (let x = minX; x <= maxX; x += stepX) {
    addSample(x, minY);
    addSample(x, maxY);
  }

  // Sample left edge and right edge
  const stepY = Math.max(1, Math.floor((maxY - minY) / 20));
  for (let y = minY; y <= maxY; y += stepY) {
    addSample(minX, y);
    addSample(maxX, y);
  }

  if (samples.length === 0) {
    return { r: 255, g: 255, b: 255, a: 1, hex: '#ffffff' };
  }

  // Filter out dark text pixels if we have brighter paper pixels
  const maxLum = Math.max(...samples.map((s) => s.lum));
  const validSamples = maxLum > 140
    ? samples.filter((s) => s.lum >= maxLum - 80 && s.lum > 110)
    : samples;

  const targetSet = validSamples.length > 0 ? validSamples : samples;

  // Compute average of the filtered paper background samples
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (const s of targetSet) {
    sumR += s.r;
    sumG += s.g;
    sumB += s.b;
  }

  const avgR = Math.round(sumR / targetSet.length);
  const avgG = Math.round(sumG / targetSet.length);
  const avgB = Math.round(sumB / targetSet.length);

  return {
    r: avgR,
    g: avgG,
    b: avgB,
    a: 1.0,
    hex: rgbToHex(avgR, avgG, avgB),
  };
}
