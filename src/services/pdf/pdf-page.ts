import type { PdfiumEngine } from '../../core/pdfium-engine';
import type { TextOptions, ShapeOptions, ImageOptions, FormFieldPlaceholderOptions } from './operations/types';
import type { EditableTextSpan, EditableFormFieldSpan, TextMutationOptions, AnnotationItem, EditableImageSpan, EditableShapeSpan, PageCharacter, PageCropInfo } from '../../core/types';
import type { FontCharsetIndex } from './font-charset-index';
import { getPageObjectMatrix, getPageCropInfo, pdfBoxToDomBounds, pdfToDomCoords } from '../../core/pdfium-helpers';

import { drawText } from './operations/draw-text';
import { drawRectangle, drawCircle, drawLine, drawArrow, drawPath } from './operations/draw-shapes';
import { drawImage } from './operations/draw-image';
import { drawFormFieldPlaceholder } from './operations/draw-form-field';

import * as pageOps from './operations/page-ops';
import * as textEditOps from './operations/text-edit-ops';
import * as metadataOps from './operations/metadata-ops';
import { addHighlightAnnotation, addInkAnnotation, addTextAnnotation, type NoteAnnotationOptions } from './operations/add-annotations';
import type { ContentBounds } from './operations/crop-ops';

/**
 * High-level facade for interacting with a specific page within a PDF document.
 * Provides a fluent, chainable API for applying mutations and retrieving page data.
 */
export class PdfPage {
  /**
   * Initializes a new PdfPage.
   * @param engine The underlying PDFium engine instance.
   * @param pageIndex The zero-based index of this page.
   * @param docHandle The handle of the parent document.
   * @param pageHandle The handle for this specific page.
   */
  public isDisposed = false;

  private assertNotDisposed(): void {
    if (this.isDisposed) throw new Error('Cannot operate on a disposed PdfPage');
  }

  constructor(
    private engine: PdfiumEngine,
    private document: import('./pdf-document').PdfDocument,
    private pageIndex: number,
    private docHandle: number,
    public readonly pageHandle: number
  ) {}

  /**
   * Marks this page instance as disposed.
   */
  public dispose(): void {
    this.isDisposed = true;
  }

  /**
   * Queues an AcroForm field to be added to the page when the document is saved.
   * @param options The form field options.
   * @returns The current PdfPage instance for chaining.
   */
  public addAcroFormField(options: FormFieldPlaceholderOptions): this {
    this.document.addPendingAcroFormField(this.pageIndex, options);
    return this;
  }

  /**
   * Retrieves the pending AcroForm fields for this page.
   * @returns An array of FormFieldPlaceholderOptions.
   */
  public getPendingAcroFormFields(): FormFieldPlaceholderOptions[] {
    return this.document.getPendingAcroFormFieldsForPage(this.pageIndex);
  }

  /**
   * Retrieves the zero-based index of this page.
   * @returns The page index.
   */
  public getIndex(): number {
    return this.pageIndex;
  }

  /**
   * Commits any drawing or structural modifications made to the page.
   * This is necessary before saving the document or re-rendering the page.
   * @returns The current PdfPage instance for chaining.
   */
  public generateContent(): this {
    this.assertNotDisposed();
    const mod = this.engine.getModule();
    mod.FPDFPage_GenerateContent(this.pageHandle);
    return this;
  }

  /**
   * Retrieves the physical dimensions of the page in points (1/72 inch).
   * @returns An object containing the widthPts and heightPts.
   */
  public getDimensions(): { widthPts: number; heightPts: number } {
    this.assertNotDisposed();
    return pageOps.getDimensions(this.engine, this.pageHandle);
  }

  /**
   * Renders the page into an HTMLCanvasElement at the specified scale.
   * @param scale The zoom scale for rendering (default: 1.0).
   * @param options Additional render options (applyDpr, maxPixelArea).
   * @returns An object containing the rendered canvas and its point dimensions.
   */
  public render(scale: number = 1.0, options?: pageOps.RenderOptions): {
    widthPts: number; heightPts: number; canvas: HTMLCanvasElement } {
    this.assertNotDisposed();
    return pageOps.render(this.engine, this.pageHandle, scale, options);
  }

  /**
   * Rotates the page by the specified number of degrees clockwise.
   * @param degreesDelta The rotation amount (must be 90, 180, or 270).
   * @returns The current PdfPage instance for chaining.
   */
  public rotate(degreesDelta: 90 | 180 | 270): this {
    this.assertNotDisposed();
    pageOps.rotate(this.engine, this.pageHandle, degreesDelta);
    return this;
  }

  /**
   * Flattens the page by merging all interactive elements (like annotations and form fields)
   * directly into the primary page content stream.
   * @returns The current PdfPage instance for chaining.
   */
  public flatten(): this {
    this.assertNotDisposed();
    pageOps.flatten(this.engine, this.pageHandle);
    return this;
  }

  /**
   * Renders the page and exports it directly as an image blob.
   * @param format The image format ('png' or 'jpeg').
   * @param scale The rendering scale for the export (default: 1.0).
   * @returns A promise resolving to the generated image Blob.
   */
  public async exportAsBlob(format: 'png' | 'jpeg', scale: number = 1.0): Promise<Blob> {
    this.assertNotDisposed();
    const rendered = this.render(scale);
    return pageOps.exportAsBlob(rendered.canvas, format);
  }

  /**
   * Extracts all interactive annotations present on the page.
   * @returns An array of AnnotationItem objects.
   */
  public getAnnotations(): AnnotationItem[] {
    this.assertNotDisposed();
    return metadataOps.getPageAnnotations(this.engine, this.pageHandle);
  }

  /**
   * Analyzes the page content stream to extract text blocks that can be natively edited.
   * @returns An array of EditableTextSpan objects.
   */
  public extractTextSpans(): EditableTextSpan[] {
    this.assertNotDisposed();
    return textEditOps.extractEditableSpans(this.engine, this.pageIndex, this.pageHandle);
  }

  /**
   * Extracts existing native AcroForm fields on this page as editable overlay spans.
   * @returns An array of EditableFormFieldSpan objects.
   */
  public extractFormFieldSpans(): EditableFormFieldSpan[] {
    this.assertNotDisposed();
    return this.document.extractFormFieldSpans(this.pageIndex);
  }

  /**
   * Extracts all individual character metrics and bounding boxes on the page.
   *
   * @return An array of PageCharacter objects.
   */
  public extractCharacters(): PageCharacter[] {
    this.assertNotDisposed();
    return textEditOps.extractPageCharacters(this.engine, this.pageIndex, this.pageHandle);
  }

  /**
   * Replaces an existing native text span with new content.
   * @param targetSpan The original text span to replace.
   * @param options The new text content and formatting options.
   * @param charsetIndex Optional document-wide font charset index for in-place editing.
   * @returns The current PdfPage instance for chaining.
   */
  public replaceTextSpan(
    targetSpan: EditableTextSpan,
    options: TextMutationOptions,
    charsetIndex?: FontCharsetIndex
  ): this {
    this.assertNotDisposed();
    textEditOps.replaceTextSpan(this.engine, this.docHandle, this.pageIndex, this.pageHandle, targetSpan, options, charsetIndex);
    return this;
  }

  /**
   * Completely removes a native text span from the page content stream.
   * @param targetSpan The text span to delete.
   * @returns The current PdfPage instance for chaining.
   */
  public deleteTextSpan(targetSpan: EditableTextSpan): this {
    this.assertNotDisposed();
    textEditOps.deleteTextSpan(this.engine, this.docHandle, this.pageIndex, this.pageHandle, targetSpan);
    return this;
  }

  /**
   * Permanently deletes all text objects that fall within the specified bounding rectangles.
   * Used for free-form area / marquee redactions.
   *
   * @param rects Array of bounding rectangles in DOM coordinates to redact.
   * @return The current PdfPage instance for chaining.
   */
  public deleteTextInRects(rects: import('../../core/types').HighlightRect[]): this {
    this.assertNotDisposed();
    textEditOps.removeTextInRects(this.engine, this.pageHandle, rects);
    return this;
  }

  /**
   * Permanently redacts only the characters in the specified character range,
   * leaving neighboring text and surrounding spans completely intact.
   *
   * @param startIndex Starting character index (inclusive).
   * @param endIndex Ending character index (inclusive).
   * @return The current PdfPage instance for chaining.
   */
  public redactTextRange(startIndex: number, endIndex: number): this {
    this.assertNotDisposed();
    textEditOps.redactTextRange(
      this.engine,
      this.docHandle,
      this.pageIndex,
      this.pageHandle,
      startIndex,
      endIndex
    );
    return this;
  }

  /**
   * Updates a text span with a new transformation matrix and text value.
   * @param targetSpan The text span to update.
   * @param newText The new text value.
   * @param matrix The new transformation matrix.
   * @returns boolean true if successfully updated, false otherwise.
   */
  public updateTextSpanTransform(targetSpan: EditableTextSpan, newText: string, matrix: import('../../core/types').PdfMatrix): boolean {
    this.assertNotDisposed();
    return textEditOps.updateTextSpanTransform(this.engine, this.pageHandle, targetSpan, newText, matrix);
  }

  /**
   * Temporarily hides a text span by replacing its string with a space.
   * @param targetSpan The text span to hide.
   * @returns The current PdfPage instance for chaining.
   */
  public hideTextSpan(targetSpan: EditableTextSpan): this {
    this.assertNotDisposed();
    textEditOps.hideTextSpan(this.engine, this.pageHandle, targetSpan);
    return this;
  }

  /**
   * Returns the count of page objects currently present on this page.
   */
  public getObjectCount(): number {
    this.assertNotDisposed();
    const mod = this.engine.getModule();
    return typeof mod.FPDFPage_CountObjects === 'function'
      ? mod.FPDFPage_CountObjects(this.pageHandle)
      : 0;
  }

  /**
   * Removes a generic native object (like an image or path) from the page stream by its index.
   * @param objectIndex The zero-based index of the object on the page.
   * @returns The current PdfPage instance for chaining.
   */
  public removeObject(objectIndex: number): this {
    this.assertNotDisposed();
    const mod = this.engine.getModule();
    const obj = mod.FPDFPage_GetObject(this.pageHandle, objectIndex);
    if (obj) {
      mod.FPDFPage_RemoveObject(this.pageHandle, obj);
      mod.FPDFPageObj_Destroy(obj);
    }
    return this;
  }

  /**
   * Removes a native PDF annotation from the page by its index.
   * @param annotIndex The zero-based index of the annotation on the page.
   * @returns The current PdfPage instance for chaining.
   */
  public removeAnnotation(annotIndex: number): this {
    this.assertNotDisposed();
    const mod = this.engine.getModule();
    if (typeof mod.FPDFPage_RemoveAnnot === 'function') {
      mod.FPDFPage_RemoveAnnot(this.pageHandle, annotIndex);
    }
    return this;
  }

  /**
   * Analyzes the page content stream to extract editable objects (images, shapes).
   * @returns An object containing arrays of EditableImageSpan and EditableShapeSpan.
   */
  public extractObjects(): {
    images: EditableImageSpan[], shapes: EditableShapeSpan[] } {
    this.assertNotDisposed();
    const mod = this.engine.getModule();
    const objectCount = mod.FPDFPage_CountObjects(this.pageHandle);
    
    const images: EditableImageSpan[] = [];
    const shapes: EditableShapeSpan[] = [];

    const hasBoundsApi = typeof mod.FPDFPageObj_GetBounds === 'function';
    if (!hasBoundsApi) return { images, shapes };

    const leftPtr = this.engine.allocateMemory(4);
    const bottomPtr = this.engine.allocateMemory(4);
    const rightPtr = this.engine.allocateMemory(4);
    const topPtr = this.engine.allocateMemory(4);

    try {
      const heapF32 = mod.pdfium.HEAPF32;
      const heightPts = mod.FPDF_GetPageHeightF(this.pageHandle);
      const cropInfo = getPageCropInfo(this.engine, mod, this.pageHandle);

      for (let i = 0; i < objectCount; i++) {
        const objHandle = mod.FPDFPage_GetObject(this.pageHandle, i);
        if (!objHandle) continue;

        const objType = mod.FPDFPageObj_GetType(objHandle);
        // 1: Text, 2: Path, 3: Image, 4: Shading, 5: Form

        if (objType === 3 || objType === 2) {
          const ok = mod.FPDFPageObj_GetBounds(objHandle, leftPtr, bottomPtr, rightPtr, topPtr);
          if (!ok) continue;

          const objLeft = heapF32[leftPtr >> 2];
          const objBottom = heapF32[bottomPtr >> 2];
          const objRight = heapF32[rightPtr >> 2];
          const objTop = heapF32[topPtr >> 2];

          // Convert PDF coordinates (origin at bottom-left) to DOM coordinates (origin at top-left)
          let left: number;
          let top: number;
          let width: number;
          let height: number;

          if (cropInfo.rotation !== 0) {
            const bounds = pdfBoxToDomBounds(objLeft, objBottom, objRight, objTop, cropInfo);
            left = bounds.left;
            top = bounds.top;
            width = bounds.right - bounds.left;
            height = bounds.bottom - bounds.top;
          } else {
            left = objLeft - cropInfo.cropLeft;
            top = heightPts - (objTop - cropInfo.cropBottom);
            width = objRight - objLeft;
            height = objTop - objBottom;
          }
          
          if (width <= 0 || height <= 0) continue;

          if (objType === 3) {
            let src = '';
            const hasBitmapApi = typeof mod.FPDFImageObj_GetBitmap === 'function';
            
            if (hasBitmapApi) {
              const bitmap = mod.FPDFImageObj_GetBitmap(objHandle);
              if (bitmap) {
                try {
                  const bmpWidth = mod.FPDFBitmap_GetWidth(bitmap);
                  const bmpHeight = mod.FPDFBitmap_GetHeight(bitmap);
                  const stride = mod.FPDFBitmap_GetStride(bitmap);
                  const format = mod.FPDFBitmap_GetFormat(bitmap);
                  const bufferPtr = mod.FPDFBitmap_GetBuffer(bitmap);
                  
                  if (bmpWidth > 0 && bmpHeight > 0 && bufferPtr) {
                    const heapU8 = mod.pdfium.HEAPU8;
                    const size = stride * bmpHeight;
                    const rawBytes = new Uint8ClampedArray(heapU8.buffer, bufferPtr, size);
                    
                    let canvas: HTMLCanvasElement | null = null;
                    if (typeof document !== 'undefined') {
                        canvas = document.createElement('canvas');
                        canvas.width = bmpWidth;
                        canvas.height = bmpHeight;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                            const imgData = new ImageData(bmpWidth, bmpHeight);
                            for (let y = 0; y < bmpHeight; y++) {
                              for (let x = 0; x < bmpWidth; x++) {
                                const bytesPerPixel = (format === 4 || format === 3) ? 4 : (format === 2 ? 3 : 1);
                                const srcIdx = y * stride + x * bytesPerPixel; 
                                const dstIdx = (y * bmpWidth + x) * 4;
                                
                                if (format === 4 || format === 3) { // BGRA or BGRx
                                  imgData.data[dstIdx] = rawBytes[srcIdx + 2];     // R
                                  imgData.data[dstIdx + 1] = rawBytes[srcIdx + 1]; // G
                                  imgData.data[dstIdx + 2] = rawBytes[srcIdx];     // B
                                  imgData.data[dstIdx + 3] = format === 4 ? rawBytes[srcIdx + 3] : 255; // A
                                } else if (format === 2) { // BGR (3 bytes per pixel)
                                  imgData.data[dstIdx] = rawBytes[srcIdx + 2];     // R
                                  imgData.data[dstIdx + 1] = rawBytes[srcIdx + 1]; // G
                                  imgData.data[dstIdx + 2] = rawBytes[srcIdx];     // B
                                  imgData.data[dstIdx + 3] = 255;
                                } else if (format === 1) { // Grayscale
                                  imgData.data[dstIdx] = rawBytes[srcIdx];
                                  imgData.data[dstIdx + 1] = rawBytes[srcIdx];
                                  imgData.data[dstIdx + 2] = rawBytes[srcIdx];
                                  imgData.data[dstIdx + 3] = 255;
                                }
                              }
                            }
                            ctx.putImageData(imgData, 0, 0);
                            src = canvas.toDataURL('image/png');
                        }
                    }
                  }
                } catch (e) {
                  console.error('Failed to extract image bitmap', e);
                } finally {
                  if (typeof mod.FPDFBitmap_Destroy === 'function') {
                    mod.FPDFBitmap_Destroy(bitmap);
                  }
                }
              }
            }

            // Decompose the object's transform matrix for accurate dimensions.
            // GetBounds returns the axis-aligned bounding box which expands when
            // the image is rotated/skewed, causing distortion with object-fit:fill.
            // The matrix encodes the actual rendered width, height, rotation, and flip.
            let imgLeft = left;
            let imgTop = top;
            let imgWidth = width;
            let imgHeight = height;
            let imgRotation = 0;
            let imgFlipX = false;
            let imgFlipY = false;

            const matrix = getPageObjectMatrix(this.engine, mod, objHandle);
            if (matrix) {
              // For image objects, the matrix maps the unit square [0,1]x[0,1]
              // to the rendered rectangle on the page.
              // Column vectors: width=(a,b), height=(c,d), origin=(e,f)
              const renderW = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b);
              const renderH = Math.sqrt(matrix.c * matrix.c + matrix.d * matrix.d);

              if (renderW > 0 && renderH > 0) {
                imgWidth = renderW;
                imgHeight = renderH;

                // Rotation angle from the width-axis vector (negate for CSS CW convention)
                const angleRad = Math.atan2(matrix.b, matrix.a);
                imgRotation = -(angleRad * 180) / Math.PI;

                // Determinant sign detects reflection (flip)
                const det = matrix.a * matrix.d - matrix.b * matrix.c;
                if (det < 0) {
                  imgFlipY = true;
                }

                // Center of the image in PDF coordinates
                const centerPdfX = matrix.e + (matrix.a + matrix.c) / 2;
                const centerPdfY = matrix.f + (matrix.b + matrix.d) / 2;

                // Convert center to DOM coordinates (origin top-left)
                let centerDomX: number;
                let centerDomY: number;

                if (cropInfo.rotation !== 0) {
                  const pt = pdfToDomCoords(centerPdfX, centerPdfY, cropInfo);
                  centerDomX = pt.x;
                  centerDomY = pt.y;
                } else {
                  centerDomX = centerPdfX - cropInfo.cropLeft;
                  centerDomY = heightPts - (centerPdfY - cropInfo.cropBottom);
                }

                imgLeft = centerDomX - imgWidth / 2;
                imgTop = centerDomY - imgHeight / 2;
              }
            }

            images.push({
              type: 'image',
              id: `img_${this.pageIndex}_${i}`,
              pageIndex: this.pageIndex,
              left: imgLeft,
              top: imgTop,
              width: imgWidth,
              height: imgHeight,
              rotation: imgRotation,
              flipX: imgFlipX,
              flipY: imgFlipY,
              src,
              pdfObjectIndex: i
            });
          } else {
            shapes.push({
              type: 'shape',
              id: `shape_${this.pageIndex}_${i}`,
              pageIndex: this.pageIndex,
              left,
              top,
              width,
              height,
              rotation: 0,
              flipX: false,
              flipY: false,
              fill: 'transparent',
              pdfObjectIndex: i
            });
          }
        }
      }
    } finally {
      this.engine.freeMemory(leftPtr);
      this.engine.freeMemory(bottomPtr);
      this.engine.freeMemory(rightPtr);
      this.engine.freeMemory(topPtr);
    }

    // Sort spans by area (width * height) in descending order to fix layering/click-through.
    // Largest items (like background images) will be rendered first and pushed to the back.
    images.sort((a, b) => (b.width * b.height) - (a.width * a.height));
    shapes.sort((a, b) => (b.width * b.height) - (a.width * a.height));

    return { images, shapes };
  }

  /**
   * Retrieves the page CropBox margins, dimensions, and rotation info.
   *
   * @returns PageCropInfo describing CropBox offsets and dimensions.
   */
  public getCropInfo(): PageCropInfo {
    this.assertNotDisposed();
    const mod = this.engine.getModule();
    return getPageCropInfo(this.engine, mod, this.pageHandle);
  }

  /**
   * Fast-path bounding box computation across all page content (characters, paths, images).
   * Computes outer bounding rectangle without running paragraph detection, text encoding,
   * or bitmap decoding.
   *
   * @returns ContentBounds or null if page has no visible content.
   */
  public getContentBounds(): ContentBounds | null {
    this.assertNotDisposed();
    const mod = this.engine.getModule();
    const heightPts = mod.FPDF_GetPageHeightF(this.pageHandle);
    const cropInfo = getPageCropInfo(this.engine, mod, this.pageHandle);

    let minLeft = Infinity;
    let minTop = Infinity;
    let maxRight = -Infinity;
    let maxBottom = -Infinity;

    // 1. Fast character bounding scan
    let textPageHandle = 0;
    try {
      textPageHandle = mod.FPDFText_LoadPage(this.pageHandle);
      if (textPageHandle) {
        const totalChars = mod.FPDFText_CountChars(textPageHandle);
        if (totalChars > 0) {
          const leftPtr = this.engine.allocateMemory(8);
          const topPtr = this.engine.allocateMemory(8);
          const rightPtr = this.engine.allocateMemory(8);
          const bottomPtr = this.engine.allocateMemory(8);
          try {
            const heapF64 = mod.pdfium.HEAPF64;
            for (let i = 0; i < totalChars; i++) {
              const charCode = mod.FPDFText_GetUnicode(textPageHandle, i);
              if (charCode <= 32 || charCode === 0xa0) continue;

              mod.FPDFText_GetCharBox(textPageHandle, i, leftPtr, rightPtr, bottomPtr, topPtr);
              const left = heapF64[leftPtr >> 3] || 0;
              const top = heapF64[topPtr >> 3] || 0;
              const right = heapF64[rightPtr >> 3] || 0;
              const bottom = heapF64[bottomPtr >> 3] || 0;

              if (right > left && top > bottom) {
                let domLeft: number;
                let domTop: number;
                let domRight: number;
                let domBottom: number;

                if (cropInfo.rotation !== 0) {
                  const bounds = pdfBoxToDomBounds(left, bottom, right, top, cropInfo);
                  domLeft = bounds.left;
                  domTop = bounds.top;
                  domRight = bounds.right;
                  domBottom = bounds.bottom;
                } else {
                  domLeft = left - cropInfo.cropLeft;
                  domRight = right - cropInfo.cropLeft;
                  domTop = Math.max(0, heightPts - (top - cropInfo.cropBottom));
                  domBottom = Math.max(0, heightPts - (bottom - cropInfo.cropBottom));
                }

                minLeft = Math.min(minLeft, domLeft);
                minTop = Math.min(minTop, domTop);
                maxRight = Math.max(maxRight, domRight);
                maxBottom = Math.max(maxBottom, domBottom);
              }
            }
          } finally {
            this.engine.freeMemory(leftPtr);
            this.engine.freeMemory(topPtr);
            this.engine.freeMemory(rightPtr);
            this.engine.freeMemory(bottomPtr);
          }
        }
      }
    } finally {
      if (textPageHandle) {
        mod.FPDFText_ClosePage(textPageHandle);
      }
    }

    // 2. Fast object bounding scan (paths, images)
    const objectCount = mod.FPDFPage_CountObjects(this.pageHandle);
    if (objectCount > 0 && typeof mod.FPDFPageObj_GetBounds === 'function') {
      const leftPtr = this.engine.allocateMemory(4);
      const bottomPtr = this.engine.allocateMemory(4);
      const rightPtr = this.engine.allocateMemory(4);
      const topPtr = this.engine.allocateMemory(4);
      try {
        const heapF32 = mod.pdfium.HEAPF32;
        for (let i = 0; i < objectCount; i++) {
          const objHandle = mod.FPDFPage_GetObject(this.pageHandle, i);
          if (!objHandle) continue;
          const objType = mod.FPDFPageObj_GetType(objHandle);
          if (objType === 2 || objType === 3) {
            const ok = mod.FPDFPageObj_GetBounds(objHandle, leftPtr, bottomPtr, rightPtr, topPtr);
            if (!ok) continue;
            const objLeft = heapF32[leftPtr >> 2];
            const objBottom = heapF32[bottomPtr >> 2];
            const objRight = heapF32[rightPtr >> 2];
            const objTop = heapF32[topPtr >> 2];

            if (objRight > objLeft && objTop > objBottom) {
              let domLeft: number;
              let domTop: number;
              let domRight: number;
              let domBottom: number;

              if (cropInfo.rotation !== 0) {
                const bounds = pdfBoxToDomBounds(objLeft, objBottom, objRight, objTop, cropInfo);
                domLeft = bounds.left;
                domTop = bounds.top;
                domRight = bounds.right;
                domBottom = bounds.bottom;
              } else {
                domLeft = objLeft - cropInfo.cropLeft;
                domRight = objRight - cropInfo.cropLeft;
                domTop = Math.max(0, heightPts - (objTop - cropInfo.cropBottom));
                domBottom = Math.max(0, heightPts - (objBottom - cropInfo.cropBottom));
              }

              minLeft = Math.min(minLeft, domLeft);
              minTop = Math.min(minTop, domTop);
              maxRight = Math.max(maxRight, domRight);
              maxBottom = Math.max(maxBottom, domBottom);
            }
          }
        }
      } finally {
        this.engine.freeMemory(leftPtr);
        this.engine.freeMemory(bottomPtr);
        this.engine.freeMemory(rightPtr);
        this.engine.freeMemory(topPtr);
      }
    }

    if (!Number.isFinite(minLeft) || !Number.isFinite(minTop) || !Number.isFinite(maxRight) || !Number.isFinite(maxBottom)) {
      return null;
    }

    return {
      left: minLeft,
      top: minTop,
      right: maxRight,
      bottom: maxBottom,
    };
  }

  /**
   * Draws a new text element onto the page.
   * @param options The text content, position, and formatting specifications.
   * @param charsetIndex Optional document font character availability index.
   * @returns The current PdfPage instance for chaining.
   */
  public drawText(options: TextOptions, charsetIndex?: FontCharsetIndex): this {
    this.assertNotDisposed();
    drawText(this.engine, this.docHandle, this.pageHandle, options, charsetIndex);
    return this;
  }

  /**
   * Draws a rectangular shape onto the page.
   * @param options The rectangle dimensions, position, and styling.
   * @returns The current PdfPage instance for chaining.
   */
  public drawRectangle(options: ShapeOptions): this {
    this.assertNotDisposed();
    drawRectangle(this.engine, this.pageHandle, options);
    return this;
  }

  /**
   * Draws a circular or elliptical shape onto the page.
   * @param options The circle dimensions, position, and styling.
   * @returns The current PdfPage instance for chaining.
   */
  public drawCircle(options: ShapeOptions): this {
    this.assertNotDisposed();
    drawCircle(this.engine, this.pageHandle, options);
    return this;
  }

  /**
   * Draws a straight line onto the page.
   * @param options The line start/end coordinates and styling.
   * @returns The current PdfPage instance for chaining.
   */
  public drawLine(options: ShapeOptions): this {
    this.assertNotDisposed();
    drawLine(this.engine, this.pageHandle, options);
    return this;
  }

  /**
   * Draws a line terminating in an arrow head onto the page.
   * @param options The arrow coordinates and styling.
   * @returns The current PdfPage instance for chaining.
   */
  public drawArrow(options: ShapeOptions): this {
    this.assertNotDisposed();
    drawArrow(this.engine, this.pageHandle, options);
    return this;
  }

  /**
   * Draws a polyline/path onto the page.
   * @param options The path coordinates and styling.
   * @returns The current PdfPage instance for chaining.
   */
  public drawPath(options: import('./operations/types').PathOptions): this {
    this.assertNotDisposed();
    drawPath(this.engine, this.pageHandle, options);
    return this;
  }

  /**
   * Adds a Text Highlight annotation to the page.
   * @param options The dimensions and styling for the highlight.
   * @returns The current PdfPage instance for chaining.
   */
  public addHighlightAnnotation(options: ShapeOptions): this {
    this.assertNotDisposed();
    addHighlightAnnotation(this.engine, this.pageHandle, options);
    return this;
  }

  /**
   * Adds an Ink (freehand) annotation to the page.
   * @param options The path coordinates and styling for the ink.
   * @returns The current PdfPage instance for chaining.
   */
  public addInkAnnotation(options: import('./operations/types').PathOptions): this {
    this.assertNotDisposed();
    addInkAnnotation(this.engine, this.pageHandle, options);
    return this;
  }

  /**
   * Embeds and draws an image onto the page.
   * @param options The image data, positioning, and sizing.
   * @returns The current PdfPage instance for chaining.
   */
  public drawImage(options: ImageOptions): this {
    this.assertNotDisposed();
    drawImage(this.engine, this.docHandle, this.pageHandle, options);
    return this;
  }

  /**
   * Adds a Text (Sticky Note) annotation to the page.
   * @param options Sticky note text annotation options.
   * @returns The current PdfPage instance for chaining.
   */
  public addTextAnnotation(options: NoteAnnotationOptions): this {
    this.assertNotDisposed();
    addTextAnnotation(this.engine, this.pageHandle, options);
    return this;
  }

  /**
   * Draws a placeholder representation for an interactive form field.
   * @param options The form field type, position, and dimensions.
   * @returns The current PdfPage instance for chaining.
   */
  public drawFormFieldPlaceholder(options: FormFieldPlaceholderOptions): this {
    this.assertNotDisposed();
    drawFormFieldPlaceholder(this.engine, this.docHandle, this.pageHandle, options);
    return this;
  }
}
