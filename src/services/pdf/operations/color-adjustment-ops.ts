/**
 * PDF page colour, contrast, and tonal adjustment operations.
 *
 * Provides high-performance pixel-level transformations and pdf-lib
 * raster replacement for brightness, contrast, colour inversion,
 * greyscale conversion, sepia, and scanned text binarisation.
 */

import { parsePageRangeStrict } from '../../../utils/page-range';

/** Scope of pages targeted for colour adjustment. */
export type ColorAdjustmentScope = 'all' | 'current' | 'selected' | 'custom';

/** Available preset profiles for quick colour adjustments. */
export type ColorAdjustmentPreset =
  | 'default'
  | 'high_contrast'
  | 'invert'
  | 'grayscale'
  | 'sepia'
  | 'binarize';

/** Options configuring colour and contrast processing. */
export interface ColorAdjustmentOptions {
  /** Brightness adjustment factor from -100 to 100 (default: 0). */
  brightness: number;
  /** Contrast adjustment factor from -100 to 100 (default: 0). */
  contrast: number;
  /** Whether to invert colours (photo negative / dark mode). */
  invert: boolean;
  /** Whether to convert all pixels to monochrome greyscale. */
  grayscale: boolean;
  /** Sepia tone intensity from 0 to 100 (default: 0). */
  sepia: number;
  /** Hue rotation in degrees from -180 to 180 (default: 0). */
  hueRotate: number;
  /** Saturation adjustment factor from -100 to 100 (default: 0). */
  saturation: number;
  /** Scanned text binarisation threshold (0 to 255, 0 = disabled). */
  binarizeThreshold: number;
  /** Target scope of pages. */
  scope: ColorAdjustmentScope;
  /** Active page index for current page scope resolution (default: 0). */
  currentPageIndex?: number;
  /** Custom 1-based page range string (e.g. '1-3, 5'). */
  customRange?: string;
  /** Explicit zero-based page indices overriding scope. */
  pageIndices?: number[];
  /** Rasterisation rendering DPI (default: 150). */
  dpi?: number;
}

/** Result summary of a colour adjustment operation. */
export interface ColorAdjustmentResult {
  /** Serialised modified PDF bytes. */
  bytes: Uint8Array;
  /** Array of zero-based page indices that were updated. */
  affectedPages: number[];
}

/**
 * Create default, neutral colour adjustment options.
 *
 * @return Default ColorAdjustmentOptions.
 */
export function createDefaultColorAdjustmentOptions(): ColorAdjustmentOptions {
  return {
    brightness: 0,
    contrast: 0,
    invert: false,
    grayscale: false,
    sepia: 0,
    hueRotate: 0,
    saturation: 0,
    binarizeThreshold: 0,
    scope: 'current',
    dpi: 150,
  };
}

/**
 * Return parameter settings corresponding to a named preset profile.
 *
 * @param preset The target preset identifier.
 * @return Partial ColorAdjustmentOptions matching the preset.
 */
export function getPresetColorAdjustments(
  preset: ColorAdjustmentPreset
): Partial<ColorAdjustmentOptions> {
  switch (preset) {
    case 'high_contrast':
      return {
        brightness: 10,
        contrast: 40,
        invert: false,
        grayscale: false,
        sepia: 0,
        hueRotate: 0,
        saturation: 10,
        binarizeThreshold: 0,
      };
    case 'invert':
      return {
        brightness: 0,
        contrast: 0,
        invert: true,
        grayscale: false,
        sepia: 0,
        hueRotate: 0,
        saturation: 0,
        binarizeThreshold: 0,
      };
    case 'grayscale':
      return {
        brightness: 0,
        contrast: 0,
        invert: false,
        grayscale: true,
        sepia: 0,
        hueRotate: 0,
        saturation: 0,
        binarizeThreshold: 0,
      };
    case 'sepia':
      return {
        brightness: 0,
        contrast: 5,
        invert: false,
        grayscale: false,
        sepia: 75,
        hueRotate: 0,
        saturation: -10,
        binarizeThreshold: 0,
      };
    case 'binarize':
      return {
        brightness: 10,
        contrast: 50,
        invert: false,
        grayscale: true,
        sepia: 0,
        hueRotate: 0,
        saturation: 0,
        binarizeThreshold: 128,
      };
    case 'default':
    default:
      return {
        brightness: 0,
        contrast: 0,
        invert: false,
        grayscale: false,
        sepia: 0,
        hueRotate: 0,
        saturation: 0,
        binarizeThreshold: 0,
      };
  }
}

/**
 * Precompute a 256-element lookup table (LUT) combining brightness,
 * contrast, and colour inversion for sub-millisecond per-frame execution.
 *
 * @param brightness Brightness delta from -100 to 100.
 * @param contrast Contrast delta from -100 to 100.
 * @param invert Whether to invert channel values.
 * @return Precomputed Uint8Array mapping [0..255] to adjusted values.
 */
export function calculateColorAdjustmentLUT(
  brightness: number,
  contrast: number,
  invert: boolean
): Uint8Array {
  const lut = new Uint8Array(256);
  const brightnessOffset = (brightness * 255) / 100;

  let contrastFactor = 1.0;
  if (contrast !== 0) {
    const clampedContrast = Math.max(-100, Math.min(100, contrast));
    contrastFactor =
      (259 * (clampedContrast + 255)) / (255 * (259 - clampedContrast));
  }

  for (let i = 0; i < 256; i++) {
    let val = i + brightnessOffset;
    if (contrast !== 0) {
      val = contrastFactor * (val - 128) + 128;
    }
    if (invert) {
      val = 255 - val;
    }
    lut[i] = Math.max(0, Math.min(255, Math.round(val)));
  }

  return lut;
}

/**
 * Apply colour, contrast, inversion, and tonal filters directly to an
 * ImageData pixel buffer in place.
 *
 * @param imageData The ImageData object to transform.
 * @param options Adjustment configuration options.
 */
export function applyColorAdjustmentsToImageData(
  imageData: ImageData,
  options: ColorAdjustmentOptions
): void {
  const data = imageData.data;
  const len = data.length;
  const lut = calculateColorAdjustmentLUT(
    options.brightness,
    options.contrast,
    options.invert
  );

  const isBinarize = options.binarizeThreshold > 0;
  const binarizeThresh = options.binarizeThreshold;
  const isGrayscale = options.grayscale;
  const hasSepia = options.sepia > 0;
  const sepiaFactor = Math.min(100, Math.max(0, options.sepia)) / 100;
  const sepiaInv = 1 - sepiaFactor;
  const hasSaturation = !isGrayscale && !isBinarize && options.saturation !== 0;
  const satFactor = 1 + Math.max(-100, Math.min(100, options.saturation)) / 100;

  const hasHue = !isGrayscale && !isBinarize && options.hueRotate !== 0;
  let cosA = 1;
  let sinA = 0;
  if (hasHue) {
    const rad = (options.hueRotate * Math.PI) / 180;
    cosA = Math.cos(rad);
    sinA = Math.sin(rad);
  }

  for (let i = 0; i < len; i += 4) {
    let r = lut[data[i]];
    let g = lut[data[i + 1]];
    let b = lut[data[i + 2]];

    if (isBinarize) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const binVal = lum < binarizeThresh ? 0 : 255;
      data[i] = binVal;
      data[i + 1] = binVal;
      data[i + 2] = binVal;
      continue;
    }

    if (isGrayscale) {
      const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      r = lum;
      g = lum;
      b = lum;
    } else if (hasSaturation) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = Math.max(0, Math.min(255, Math.round(lum + satFactor * (r - lum))));
      g = Math.max(0, Math.min(255, Math.round(lum + satFactor * (g - lum))));
      b = Math.max(0, Math.min(255, Math.round(lum + satFactor * (b - lum))));
    }

    if (hasHue) {
      const hr =
        r * (0.213 + cosA * 0.787 - sinA * 0.213) +
        g * (0.715 - cosA * 0.715 - sinA * 0.715) +
        b * (0.072 - cosA * 0.072 + sinA * 0.928);
      const hg =
        r * (0.213 - cosA * 0.213 + sinA * 0.143) +
        g * (0.715 + cosA * 0.285 + sinA * 0.14) +
        b * (0.072 - cosA * 0.072 - sinA * 0.283);
      const hb =
        r * (0.213 - cosA * 0.213 - sinA * 0.787) +
        g * (0.715 - cosA * 0.715 + sinA * 0.715) +
        b * (0.072 + cosA * 0.928 + sinA * 0.072);

      r = Math.max(0, Math.min(255, Math.round(hr)));
      g = Math.max(0, Math.min(255, Math.round(hg)));
      b = Math.max(0, Math.min(255, Math.round(hb)));
    }

    if (hasSepia) {
      const sr = Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b);
      const sg = Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b);
      const sb = Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b);
      r = Math.round(sepiaInv * r + sepiaFactor * sr);
      g = Math.round(sepiaInv * g + sepiaFactor * sg);
      b = Math.round(sepiaInv * b + sepiaFactor * sb);
    }

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

/**
 * Generate a CSS filter string corresponding to current colour options,
 * enabling GPU-accelerated interactive preview during slider drag.
 *
 * @param options Adjustment options to format.
 * @return CSS filter rule string (e.g. 'brightness(110%) contrast(140%)').
 */
export function generateCssFilterString(
  options: ColorAdjustmentOptions
): string {
  const filters: string[] = [];

  if (options.brightness !== 0) {
    const bVal = Math.round(100 + options.brightness);
    filters.push(`brightness(${bVal}%)`);
  }
  if (options.contrast !== 0) {
    const cVal = Math.round(100 + options.contrast);
    filters.push(`contrast(${cVal}%)`);
  }
  if (options.invert) {
    filters.push('invert(100%)');
  }
  if (options.grayscale || options.binarizeThreshold > 0) {
    filters.push('grayscale(100%)');
  } else if (options.saturation !== 0) {
    const sVal = Math.round(100 + options.saturation);
    filters.push(`saturate(${sVal}%)`);
  }
  if (options.sepia > 0) {
    filters.push(`sepia(${options.sepia}%)`);
  }
  if (options.hueRotate !== 0) {
    filters.push(`hue-rotate(${options.hueRotate}deg)`);
  }

  return filters.length > 0 ? filters.join(' ') : 'none';
}

/**
 * Resolve target zero-based page indices according to selected scope
 * and boundary constraints.
 *
 * @param scope Target scope mode.
 * @param currentPageIndex Active document page index.
 * @param totalPages Total page count in document.
 * @param selectedIndices Array of explicitly selected page indices.
 * @param customRange Optional range string for 'custom' scope.
 * @return Sorted array of validated target page indices.
 */
export function resolveTargetPageIndices(
  scope: ColorAdjustmentScope,
  currentPageIndex: number,
  totalPages: number,
  selectedIndices: number[] = [],
  customRange?: string
): number[] {
  if (totalPages <= 0) return [];

  if (scope === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  if (scope === 'current') {
    const valid = Math.max(0, Math.min(currentPageIndex, totalPages - 1));
    return [valid];
  }

  if (scope === 'selected' && selectedIndices.length > 0) {
    const filtered = selectedIndices.filter(
      (idx) => idx >= 0 && idx < totalPages
    );
    return filtered.length > 0
      ? filtered
      : [Math.max(0, Math.min(currentPageIndex, totalPages - 1))];
  }

  if (scope === 'custom' && customRange && customRange.trim().length > 0) {
    return parsePageRangeStrict(customRange, totalPages);
  }

  return [Math.max(0, Math.min(currentPageIndex, totalPages - 1))];
}

/**
 * Apply colour and contrast adjustments across target pages in a PDF document.
 *
 * Render target pages via the supplied page rasteriser, process pixel buffers,
 * and embed the adjusted imagery back into the PDF using pdf-lib.
 *
 * @param pdfBytes Source document bytes.
 * @param options Colour adjustment options.
 * @param pageRasterizer High-resolution page rendering delegate.
 * @return Promise resolving to the modified PDF bytes and affected page indices.
 */
export async function adjustPdfColors(
  pdfBytes: Uint8Array | ArrayBuffer,
  options: ColorAdjustmentOptions,
  pageRasterizer: (
    pageIndex: number,
    scale: number
  ) => Promise<{ widthPts: number; heightPts: number; canvas: HTMLCanvasElement }>
): Promise<ColorAdjustmentResult> {
  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();

  const targetPages =
    options.pageIndices && options.pageIndices.length > 0
      ? options.pageIndices.filter((idx) => idx >= 0 && idx < totalPages)
      : resolveTargetPageIndices(
          options.scope,
          options.currentPageIndex ?? 0,
          totalPages,
          options.pageIndices ?? [],
          options.customRange
        );

  if (targetPages.length === 0) {
    const bytes = await pdfDoc.save({ useObjectStreams: false });
    return { bytes, affectedPages: [] };
  }

  const dpi = options.dpi ?? 150;
  const renderScale = dpi / 72.0;

  for (const pageIdx of targetPages) {
    const origPage = pdfDoc.getPage(pageIdx);
    const origSize = origPage.getSize();
    const origRotation = origPage.getRotation();

    const { canvas } = await pageRasterizer(pageIdx, renderScale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error(
        `Failed to obtain canvas context for page ${pageIdx + 1}`
      );
    }

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyColorAdjustmentsToImageData(imgData, options);
    ctx.putImageData(imgData, 0, 0);

    let imgBytes: Uint8Array;
    if (typeof canvas.toBlob === 'function') {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error('Failed to encode adjusted page canvas'));
          },
          'image/jpeg',
          0.92
        );
      });
      imgBytes = new Uint8Array(await blob.arrayBuffer());
    } else if (typeof canvas.toDataURL === 'function') {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const base64 = dataUrl.split(',')[1] ?? '';
      const binary = atob(base64);
      imgBytes = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j++) {
        imgBytes[j] = binary.charCodeAt(j);
      }
    } else {
      throw new Error('Canvas does not support export to image format');
    }

    const embeddedImg = await pdfDoc.embedJpg(imgBytes);

    const newPage = pdfDoc.insertPage(pageIdx, [
      origSize.width,
      origSize.height,
    ]);
    newPage.setRotation(origRotation);
    newPage.drawImage(embeddedImg, {
      x: 0,
      y: 0,
      width: origSize.width,
      height: origSize.height,
    });
    pdfDoc.removePage(pageIdx + 1);
  }

  const bytes = await pdfDoc.save({ useObjectStreams: false });
  return { bytes, affectedPages: targetPages };
}
