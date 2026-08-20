import type { PdfiumEngine } from '../../../core/pdfium-engine';
import { setPageObjectMatrix } from '../../../core/pdfium-helpers';

/**
 * Retrieves the total number of pages in the given document.
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @returns The total page count.
 */
export function getPageCount(engine: PdfiumEngine, docHandle: number): number {
  const mod = engine.getModule();
  return mod.FPDF_GetPageCount(docHandle);
}

/**
 * Merges the pages of a source PDF buffer into the target document at a specific index.
 * @param engine The PDFium engine instance.
 * @param destDocHandle The handle of the destination document.
 * @param sourcePdfBuffer The binary buffer of the source PDF to merge.
 * @param insertAtIndex The zero-based index to insert the source pages.
 * @throws If loading or importing the source PDF fails.
 */
export function mergePdfBuffer(engine: PdfiumEngine, destDocHandle: number, sourcePdfBuffer: ArrayBuffer, insertAtIndex: number): void {
  const mod = engine.getModule();
  const sourceBytes = new Uint8Array(sourcePdfBuffer);
  const sourceSize = sourceBytes.byteLength;
  const sourcePtr = engine.allocateMemory(sourceSize);

  try {
    const heapBytes = new Uint8Array(mod.pdfium.HEAPU8.buffer, sourcePtr, sourceSize);
    heapBytes.set(sourceBytes);

    const sourceDocHandle = mod.FPDF_LoadMemDocument(sourcePtr, sourceSize, '');
    if (!sourceDocHandle) {
      throw new Error('Failed to load source PDF for merging.');
    }

    try {
      const pageCount = mod.FPDF_GetPageCount(destDocHandle);
      const targetIndex = Math.max(0, Math.min(insertAtIndex, pageCount));

      const success = mod.FPDF_ImportPages(destDocHandle, sourceDocHandle, 0 as unknown as string, targetIndex);
      if (!success) {
        throw new Error('PDFium failed to merge pages into document.');
      }
    } finally {
      mod.FPDF_CloseDocument(sourceDocHandle);
    }
  } finally {
    engine.freeMemory(sourcePtr);
  }
}

/**
 * Reorders a selection of pages within the document.
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @param fromIndices An array of zero-based page indices to move.
 * @param toIndex The zero-based destination index for the moved pages.
 * @throws If an invalid index is provided or moving fails.
 */
export function reorderPages(engine: PdfiumEngine, docHandle: number, fromIndices: number[], toIndex: number): void {
  const mod = engine.getModule();
  const pageCount = mod.FPDF_GetPageCount(docHandle);
  if (toIndex < 0 || toIndex > pageCount) throw new Error('Invalid page reorder index.');
  if (fromIndices.length === 0) return;

  const indicesPtr = engine.allocateMemory(fromIndices.length * 4);
  try {
    const sortedIndices = [...fromIndices].sort((a, b) => a - b);
    for (let i = 0; i < sortedIndices.length; i++) {
      if (sortedIndices[i] < 0 || sortedIndices[i] >= pageCount) {
         throw new Error('Invalid page reorder index.');
      }
      mod.pdfium.HEAP32[(indicesPtr >> 2) + i] = sortedIndices[i];
    }
    
    const success = mod.FPDF_MovePages(docHandle, indicesPtr, sortedIndices.length, toIndex);
    if (!success) throw new Error(`Failed to move pages to index ${toIndex}.`);
  } finally {
    engine.freeMemory(indicesPtr);
  }
}

/**
 * Extracts a subset of pages into a new standalone PDF document.
 * @param engine The PDFium engine instance.
 * @param srcDocHandle The handle of the source document.
 * @param pageIndices An array of zero-based page indices to extract.
 * @returns A Uint8Array containing the serialized new PDF.
 * @throws If extraction or writing fails.
 */
export function splitPdf(engine: PdfiumEngine, srcDocHandle: number, pageIndices: number[]): Uint8Array {
  const mod = engine.getModule();
  if (pageIndices.length === 0) throw new Error('No page indices provided for splitting.');

  const newDocHandle = mod.FPDF_CreateNewDocument();
  if (!newDocHandle) throw new Error('Failed to create new PDF document for split export.');

  const count = pageIndices.length;
  const indicesPtr = engine.allocateMemory(count * 4);

  try {
    const heap32 = mod.pdfium.HEAP32;
    for (let i = 0; i < count; i++) {
      heap32[(indicesPtr >> 2) + i] = pageIndices[i];
    }

    const success = mod.FPDF_ImportPagesByIndex(newDocHandle, srcDocHandle, indicesPtr, count, 0);
    if (!success) throw new Error('Failed to import split pages into new document.');

    const writerPtr = mod.PDFiumExt_OpenFileWriter();
    if (!writerPtr) throw new Error('Failed to open PDF file writer.');

    try {
      const saved = mod.PDFiumExt_SaveAsCopy(newDocHandle, writerPtr);
      if (!saved) throw new Error('Failed to save split document copy.');

      const size = mod.PDFiumExt_GetFileWriterSize(writerPtr);
      const dataPtr = engine.allocateMemory(size);
      try {
        mod.PDFiumExt_GetFileWriterData(writerPtr, dataPtr, size);
        const srcBytes = new Uint8Array(mod.pdfium.HEAPU8.buffer, dataPtr, size);
        const result = new Uint8Array(size);
        result.set(srcBytes);
        return result;
      } finally {
        engine.freeMemory(dataPtr);
      }
    } finally {
      mod.PDFiumExt_CloseFileWriter(writerPtr);
    }
  } finally {
    engine.freeMemory(indicesPtr);
    mod.FPDF_CloseDocument(newDocHandle);
  }
}

/**
 * Injects a new blank page into the document.
 * Inherits dimensions from the preceding page if width/height are not explicitly provided.
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @param insertAtIndex The zero-based index for the new page.
 * @param widthPts Optional fixed width in points.
 * @param heightPts Optional fixed height in points.
 */
export function addBlankPage(engine: PdfiumEngine, docHandle: number, insertAtIndex: number, widthPts?: number, heightPts?: number): void {
  const mod = engine.getModule();
  const pageCount = mod.FPDF_GetPageCount(docHandle);
  const targetIndex = Math.max(0, Math.min(insertAtIndex, pageCount));

  let finalWidth = widthPts;
  let finalHeight = heightPts;

  if (finalWidth === undefined || finalHeight === undefined) {
    const referenceIndex = targetIndex > 0 ? targetIndex - 1 : (pageCount > 0 ? 0 : -1);
    if (referenceIndex >= 0) {
      const refPageHandle = mod.FPDF_LoadPage(docHandle, referenceIndex);
      if (refPageHandle) {
        try {
          finalWidth = finalWidth ?? mod.FPDF_GetPageWidthF(refPageHandle);
          finalHeight = finalHeight ?? mod.FPDF_GetPageHeightF(refPageHandle);
        } finally {
          mod.FPDF_ClosePage(refPageHandle);
        }
      }
    }
    finalWidth = finalWidth ?? 595;
    finalHeight = finalHeight ?? 842;
  }

  const pageHandle = mod.FPDFPage_New(docHandle, targetIndex, finalWidth, finalHeight);
  if (!pageHandle) throw new Error('Failed to create new blank page.');

  try {
    mod.FPDFPage_GenerateContent(pageHandle);
  } finally {
    mod.FPDF_ClosePage(pageHandle);
  }
}

/**
 * Duplicates a specific page in the document, placing the copy immediately after.
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @param pageIndex The zero-based index of the page to duplicate.
 */
export function duplicatePage(engine: PdfiumEngine, docHandle: number, pageIndex: number): void {
  const mod = engine.getModule();
  const newDocHandle = mod.FPDF_CreateNewDocument();
  if (!newDocHandle) throw new Error('Failed to create temp document for duplication.');

  const indicesPtr = engine.allocateMemory(4);
  try {
    mod.pdfium.HEAP32[indicesPtr >> 2] = pageIndex;
    let success = mod.FPDF_ImportPagesByIndex(newDocHandle, docHandle, indicesPtr, 1, 0);
    if (!success) throw new Error(`Failed to copy page at index ${pageIndex} to temp document.`);

    mod.pdfium.HEAP32[indicesPtr >> 2] = 0;
    success = mod.FPDF_ImportPagesByIndex(docHandle, newDocHandle, indicesPtr, 1, pageIndex + 1);
    if (!success) throw new Error(`Failed to import duplicated page back to original document.`);
  } finally {
    engine.freeMemory(indicesPtr);
    mod.FPDF_CloseDocument(newDocHandle);
  }
}

/**
 * Imports an external image file and appends it as a new page, scaling to fit standard constraints.
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @param imageBuffer The binary buffer of the image.
 * @param mimeType The MIME type of the image.
 * @param insertAtIndex The zero-based index to insert the new image page.
 */
export async function importImageAsPage(
  engine: PdfiumEngine,
  docHandle: number,
  imageBuffer: ArrayBuffer,
  mimeType: string,
  insertAtIndex: number
): Promise<void> {
  const mod = engine.getModule();
  const blob = new Blob([imageBuffer], { type: mimeType });
  const imgUrl = URL.createObjectURL(blob);

  const imgDataResult = await new Promise<{ width: number; height: number; imgData: ImageData }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Failed to get canvas context.'));
      ctx.drawImage(img, 0, 0);
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        imgData: ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight)
      });
    };
    img.onerror = () => reject(new Error('Failed to load image for dimensions.'));
    img.src = imgUrl;
  });

  URL.revokeObjectURL(imgUrl);

  let pageWidth = imgDataResult.width > 0 ? imgDataResult.width : 595;
  let pageHeight = imgDataResult.height > 0 ? imgDataResult.height : 842;

  if (pageWidth > 1200 || pageHeight > 1200) {
    const aspect = pageWidth / pageHeight;
    if (aspect >= 1) {
      pageWidth = 842;
      pageHeight = 842 / aspect;
    } else {
      pageHeight = 842;
      pageWidth = 842 * aspect;
    }
  }

  const pageCount = mod.FPDF_GetPageCount(docHandle);
  const targetIndex = Math.max(0, Math.min(insertAtIndex, pageCount));

  const pageHandle = mod.FPDFPage_New(docHandle, targetIndex, pageWidth, pageHeight);
  if (!pageHandle) throw new Error('Failed to create new page for image import.');

  const { width, height, imgData } = imgDataResult;
  const rgba = imgData.data;
  const pixelCount = width * height;
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

    bitmapHandle = mod.FPDFBitmap_CreateEx(width, height, 4, bmpPtr, width * 4);
    if (!bitmapHandle) throw new Error('Failed to create bitmap for image.');

    const imageObjHandle = mod.FPDFPageObj_NewImageObj(docHandle);
    if (!imageObjHandle) throw new Error('Failed to create image page object.');

    mod.FPDFImageObj_SetBitmap(0, 0, imageObjHandle, bitmapHandle);

    setPageObjectMatrix(engine, mod, imageObjHandle, {
      a: pageWidth, b: 0, c: 0, d: pageHeight, e: 0, f: 0,
    });

    mod.FPDFPage_InsertObject(pageHandle, imageObjHandle);
    mod.FPDFPage_GenerateContent(pageHandle);
  } finally {
    if (bitmapHandle) mod.FPDFBitmap_Destroy(bitmapHandle);
    engine.freeMemory(bmpPtr);
    mod.FPDF_ClosePage(pageHandle);
  }
}

/**
 * Removes a specified page from the document.
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @param pageIndex The zero-based index of the page to delete.
 * @throws If attempting to delete the last remaining page.
 */
export function deletePage(engine: PdfiumEngine, docHandle: number, pageIndex: number): void {
  const mod = engine.getModule();
  const pageCount = mod.FPDF_GetPageCount(docHandle);
  if (pageCount <= 1) throw new Error('Cannot delete the last page in a PDF.');
  mod.FPDFPage_Delete(docHandle, pageIndex);
}
