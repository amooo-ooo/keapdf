import type { PdfiumEngine } from '../../../core/pdfium-engine';
import { setPageObjectMatrix, getPageCropInfo } from '../../../core/pdfium-helpers';
import { buildTransformMatrix } from '../utils';
import type { ImageOptions } from './types';

/**
 * Draws an image onto a target PDF page.
 *
 * Converts RGBA pixel data to BGRA format in WASM memory, creates a PDFium
 * bitmap object, constructs a new image page object with optional object-fit
 * scaling and transformation matrix, and inserts it into the page.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle The handle to the loaded PDF document.
 * @param pageHandle The handle to the target PDF page.
 * @param options Options for image data, dimensions, positioning, and layout constraints.
 */
export function drawImage(
  engine: PdfiumEngine,
  docHandle: number,
  pageHandle: number,
  options: ImageOptions
): void {
  const mod = engine.getModule();
  const pageHeight = mod.FPDF_GetPageHeightF(pageHandle);
  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const cropOffset = cropInfo.hasCropBox ? { cropX: cropInfo.cropLeft, cropY: cropInfo.cropBottom } : undefined;
  const { width: imgW, height: imgH, imgData } = options.imageData;
  const rgba = imgData.data;
  const pixelCount = imgW * imgH;
  const bmpPtr = engine.allocateMemory(pixelCount * 4);

  let bitmapHandle = 0;
  try {
    const heap = mod.pdfium.HEAPU8;
    for (let i = 0; i < pixelCount; i++) {
      const idx = i * 4;
      heap[bmpPtr + idx] = rgba[idx + 2];     // B
      heap[bmpPtr + idx + 1] = rgba[idx + 1]; // G
      heap[bmpPtr + idx + 2] = rgba[idx];     // R
      heap[bmpPtr + idx + 3] = rgba[idx + 3]; // A
    }

    bitmapHandle = mod.FPDFBitmap_CreateEx(imgW, imgH, 4, bmpPtr, imgW * 4);
    if (bitmapHandle) {
      const imageObjHandle = mod.FPDFPageObj_NewImageObj(docHandle);
      if (imageObjHandle) {
        mod.FPDFImageObj_SetBitmap(0, 0, imageObjHandle, bitmapHandle);
        
        let renderX = options.x;
        let renderY = options.y;
        let renderW = options.width;
        let renderH = options.height;
        
        if (options.objectFit === 'contain') {
          const imgRatio = imgW / imgH;
          const boxRatio = (options.width || imgW) / (options.height || imgH);
          if (imgRatio > boxRatio) {
            renderW = options.width;
            renderH = (options.width || imgW) / imgRatio;
            renderY = options.y + ((options.height || imgH) - renderH) / 2;
          } else {
            renderH = options.height;
            renderW = (options.height || imgH) * imgRatio;
            renderX = options.x + ((options.width || imgW) - renderW) / 2;
          }
        } else if (options.objectFit === 'cover') {
          const imgRatio = imgW / imgH;
          const boxRatio = (options.width || imgW) / (options.height || imgH);
          if (imgRatio > boxRatio) {
            renderH = options.height;
            renderW = options.height * imgRatio;
            renderX = options.x - (renderW - options.width) / 2;
          } else {
            renderW = options.width;
            renderH = options.width / imgRatio;
            renderY = options.y - (renderH - options.height) / 2;
          }
        }
        
        const imgBaseMatrix = buildTransformMatrix(
          renderX,
          renderY,
          renderW || imgW,
          renderH || imgH,
          pageHeight,
          options.rotation || 0,
          options.flipX || false,
          options.flipY || false,
          cropOffset
        );
        
        const imageMatrix = {
            a: imgBaseMatrix.a * (renderW || imgW),
            b: imgBaseMatrix.b * (renderW || imgW),
            c: imgBaseMatrix.c * (renderH || imgH),
            d: imgBaseMatrix.d * (renderH || imgH),
            e: imgBaseMatrix.e,
            f: imgBaseMatrix.f
        };

        setPageObjectMatrix(engine, mod, imageObjHandle, imageMatrix);
        mod.FPDFPage_InsertObject(pageHandle, imageObjHandle);
      }
    }
  } finally {
    if (bitmapHandle) {
      mod.FPDFBitmap_Destroy(bitmapHandle);
    }
    engine.freeMemory(bmpPtr);
  }
}
