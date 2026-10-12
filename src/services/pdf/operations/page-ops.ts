import type { PdfiumEngine } from '../../../core/pdfium-engine';

/**
 * Retrieves the physical point dimensions of a specific page.
 * @param engine The PDFium engine instance.
 * @param pageHandle The active page handle.
 * @returns An object containing widthPts and heightPts.
 */
export function getDimensions(engine: PdfiumEngine, pageHandle: number): { widthPts: number; heightPts: number } {
  const mod = engine.getModule();
  const widthPts = mod.FPDF_GetPageWidthF(pageHandle);
  const heightPts = mod.FPDF_GetPageHeightF(pageHandle);
  return { widthPts, heightPts };
}

/**
 * Rotates the page visually and structurally.
 * @param engine The PDFium engine instance.
 * @param pageHandle The active page handle.
 * @param degreesDelta The rotation degrees (90, 180, 270).
 */
export function rotate(engine: PdfiumEngine, pageHandle: number, degreesDelta: 90 | 180 | 270): void {
  const mod = engine.getModule();
  const currentRot = mod.FPDFPage_GetRotation(pageHandle);
  const addRot = degreesDelta / 90;
  const newRot = (currentRot + addRot) % 4;
  mod.FPDFPage_SetRotation(pageHandle, newRot);
  mod.FPDFPage_GenerateContent(pageHandle);
}

/**
 * Flattens annotations and interactive forms into the page stream.
 * @param engine The PDFium engine instance.
 * @param pageHandle The active page handle.
 */
export function flatten(engine: PdfiumEngine, pageHandle: number): void {
  const mod = engine.getModule();
  const result = mod.FPDFPage_Flatten(pageHandle, 0); // FLAT_NORMALDISPLAY = 0
  if (result === 0) {
    console.warn(`Failed to flatten page.`);
  } else {
    mod.FPDFPage_GenerateContent(pageHandle);
  }
}

export interface RenderOptions {
  /**
   * Whether to apply window.devicePixelRatio scaling.
   * Set to false for fixed-size renders like thumbnails.
   * Default: true
   */
  applyDpr?: boolean;
  /**
   * Maximum total pixel area (width * height) for rendered canvas.
   * Clamps dimensions proportionally if exceeded to prevent memory explosions.
   * Default: 4,000,000 (~4 megapixels)
   */
  maxPixelArea?: number;
  /**
   * Optional target canvas to reuse instead of creating a new one.
   * If provided, the canvas dimensions and style are updated in-place.
   */
  targetCanvas?: HTMLCanvasElement;
  /**
   * Optional active PDFium form fill environment handle.
   * When provided, FPDF_FFLDraw renders interactive form appearances onto the bitmap.
   */
  formHandle?: number;
  /**
   * Whether to render the page bitmap with a transparent paper background
   * so canvas elements stacked in the back band (zIndex < 10) remain visible beneath PDF content.
   */
  transparentBackground?: boolean;
}

/**
 * Scratch ImageData and aligned buffer reused across sequential render passes
 * to avoid allocating multi-megabyte Uint8ClampedArray buffers on every frame.
 */
let scratchImageData: ImageData | null = null;
let scratchAlignedBuffer: ArrayBuffer | null = null;

/**
 * Releases cached scratch rendering buffers to free heap memory.
 */
export function clearRenderScratchBuffers(): void {
  scratchImageData = null;
  scratchAlignedBuffer = null;
}

/**
 * Renders the page stream into a browser Canvas element at a specified scale.
 * Extracts the pixel data from the WASM heap directly.
 * @param engine The PDFium engine instance.
 * @param pageHandle The active page handle.
 * @param scale The display scaling factor (default: 1.0).
 * @param options Additional render options.
 * @returns An object containing the HTML canvas and natural dimensions.
 * @throws If bitmap creation or context extraction fails.
 */
export function render(
  engine: PdfiumEngine,
  pageHandle: number,
  scale: number = 1.0,
  options?: RenderOptions
): { widthPts: number; heightPts: number; canvas: HTMLCanvasElement } {
  const mod = engine.getModule();
  const widthPts = mod.FPDF_GetPageWidthF(pageHandle);
  const heightPts = mod.FPDF_GetPageHeightF(pageHandle);

  const dpr = options?.applyDpr !== false && typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const renderScale = scale * dpr;

  let pixelWidth = Math.max(1, Math.round(widthPts * renderScale));
  let pixelHeight = Math.max(1, Math.round(heightPts * renderScale));

  const maxArea = options?.maxPixelArea ?? 4_000_000;
  const area = pixelWidth * pixelHeight;
  if (area > maxArea) {
    const ratio = Math.sqrt(maxArea / area);
    pixelWidth = Math.max(1, Math.round(pixelWidth * ratio));
    pixelHeight = Math.max(1, Math.round(pixelHeight * ratio));
  }

  const bitmapHandle = mod.FPDFBitmap_Create(pixelWidth, pixelHeight, 1);
  if (!bitmapHandle) throw new Error('Failed to create PDFium bitmap handle.');

  try {
    const fillColour = options?.transparentBackground ? 0x00000000 : 0xffffffff;
    mod.FPDFBitmap_FillRect(bitmapHandle, 0, 0, pixelWidth, pixelHeight, fillColour);
    mod.FPDF_RenderPageBitmap(bitmapHandle, pageHandle, 0, 0, pixelWidth, pixelHeight, 0, 0x01);
    if (options?.formHandle) {
      engine.drawFormFill(options.formHandle, bitmapHandle, pageHandle, 0, 0, pixelWidth, pixelHeight, 0, 0x01);
    }

    const bufferPtr = mod.FPDFBitmap_GetBuffer(bitmapHandle);
    const pixelCount = pixelWidth * pixelHeight;

    const canvas = options?.targetCanvas ?? document.createElement('canvas');
    if (canvas.width !== pixelWidth) {
      canvas.width = pixelWidth;
    }
    if (canvas.height !== pixelHeight) {
      canvas.height = pixelHeight;
    }

    if (canvas.style) {
      const cssWidth = `${Math.round(widthPts * scale)}px`;
      const cssHeight = `${Math.round(heightPts * scale)}px`;
      if (canvas.style.width !== cssWidth) {
        canvas.style.width = cssWidth;
      }
      if (canvas.style.height !== cssHeight) {
        canvas.style.height = cssHeight;
      }
      canvas.style.display = 'block';
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to obtain canvas context.');

    // Reuse scratch ImageData if dimensions match, avoiding multi-megabyte heap churn
    let imgData: ImageData;
    if (scratchImageData && scratchImageData.width === pixelWidth && scratchImageData.height === pixelHeight) {
      imgData = scratchImageData;
    } else {
      imgData = ctx.createImageData(pixelWidth, pixelHeight);
      scratchImageData = imgData;
    }
    
    let src32: Uint32Array;
    if (bufferPtr % 4 === 0) {
      src32 = new Uint32Array(mod.pdfium.HEAPU8.buffer, bufferPtr, pixelCount);
    } else {
      // Reuse scratch aligned buffer when FPDFBitmap_GetBuffer returns an unaligned pointer.
      const requiredBytes = pixelCount * 4;
      if (!scratchAlignedBuffer || scratchAlignedBuffer.byteLength < requiredBytes) {
        scratchAlignedBuffer = new ArrayBuffer(requiredBytes);
      }
      const rawBytes = new Uint8Array(mod.pdfium.HEAPU8.buffer, bufferPtr, requiredBytes);
      new Uint8Array(scratchAlignedBuffer, 0, requiredBytes).set(rawBytes);
      src32 = new Uint32Array(scratchAlignedBuffer, 0, pixelCount);
    }
    const dst32 = new Uint32Array(imgData.data.buffer);

    if (options?.transparentBackground) {
      for (let i = 0; i < pixelCount; i++) {
        const px = src32[i];
        if (px === 0xffffffff || (px >>> 24) === 0) {
          dst32[i] = 0x00000000;
        } else {
          dst32[i] = (px & 0xff00ff00) | ((px & 0x000000ff) << 16) | ((px & 0x00ff0000) >> 16);
        }
      }
    } else {
      for (let i = 0; i < pixelCount; i++) {
        const px = src32[i];
        dst32[i] = (px & 0xff00ff00) | ((px & 0x000000ff) << 16) | ((px & 0x00ff0000) >> 16);
      }
    }

    ctx.putImageData(imgData, 0, 0);

    return { widthPts, heightPts, canvas };
  } finally {
    mod.FPDFBitmap_Destroy(bitmapHandle);
  }
}

/**
 * Exports a rendered page canvas to an image Blob.
 * @param canvas The rendered HTML canvas.
 * @param format Target image format.
 * @param quality Compression quality for JPEG.
 * @returns A promise resolving to the image Blob.
 */
export async function exportAsBlob(
  canvas: HTMLCanvasElement,
  format: 'png' | 'jpeg',
  quality: number = 0.95
): Promise<Blob> {
  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to convert page canvas to image blob.'));
      },
      mimeType,
      quality
    );
  });
}
