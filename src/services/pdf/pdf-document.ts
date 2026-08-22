import type { PdfiumEngine } from '../../core/pdfium-engine';
import { PdfPage } from './pdf-page';
import { FontCharsetIndex } from './font-charset-index';
import type {
  OutlineNode,
  DocumentInfo,
  DocumentMetadata,
  DocumentMetadataUpdate,
  SanitizeOptions,
  SanitizeSummary,
  SanitizationInspection,
} from '../../core/types';
import type { PDFAcroField } from 'pdf-lib';
import * as docOps from './operations/document-ops';
import * as metadataOps from './operations/metadata-ops';
import { inspectPdfForSanitization, sanitizePdf } from './operations/sanitize-ops';
import { signPdfIso32000, verifyPdfSignatures, type SignPdfOptions, type SignatureValidationResult } from './operations/signature-ops';
import type { FormFieldPlaceholderOptions } from './operations/types';
import type { PageTransform } from '../../stores/types';

/**
 * High-level facade for interacting with a PDF document via PDFium.
 * Handles page lifecycle management and document-level operations.
 */
export class PdfDocument {
  private static readonly MAX_CACHED_PAGES = 10;

  /**
   * Cached LRU map of loaded pages to prevent WASM page handle memory leaks.
   */
  private pages: Map<number, PdfPage> = new Map();

  /**
   * Document-wide font character set index for in-place edit heuristics.
   */
  private _fontCharsetIndex: FontCharsetIndex;

  /**
   * Initializes a new PdfDocument.
   * @param engine The underlying PDFium engine instance.
   */
  constructor(private engine: PdfiumEngine) {
    this._fontCharsetIndex = new FontCharsetIndex(engine, () => this.getDocHandle());
  }

  /**
   * Returns the document-wide font charset index.
   * Lazily builds on first access by scanning all pages.
   */
  public get fontCharsetIndex(): FontCharsetIndex {
    return this._fontCharsetIndex;
  }

  /**
   * Retrieves the underlying document handle from the engine.
   * @returns The active document handle.
   * @throws If no document is currently loaded.
   */
  private getDocHandle(): number {
    const handle = this.engine.getDocumentHandle();
    if (!handle) throw new Error('No active document handle.');
    return handle;
  }

  /**
   * Gets the total number of pages in the document.
   * @returns The page count.
   */
  public getPageCount(): number {
    return docOps.getPageCount(this.engine, this.getDocHandle());
  }

  /**
   * Retrieves a specific page from the document.
   * Employs an LRU cache bounded to MAX_CACHED_PAGES to prevent WASM handle exhaustion.
   * @param pageIndex The zero-based index of the page.
   * @returns A PdfPage instance representing the requested page.
   * @throws If the page fails to load.
   */
  public getPage(pageIndex: number): PdfPage {
    const existing = this.pages.get(pageIndex);
    if (existing) {
      this.pages.delete(pageIndex);
      this.pages.set(pageIndex, existing);
      return existing;
    }

    const mod = this.engine.getModule();

    if (this.pages.size >= PdfDocument.MAX_CACHED_PAGES) {
      const oldestKey = this.pages.keys().next().value;
      if (oldestKey !== undefined) {
        const oldPage = this.pages.get(oldestKey)!;
        oldPage.generateContent();
        mod.FPDF_ClosePage(oldPage.pageHandle);
        this.pages.delete(oldestKey);
      }
    }

    const docHandle = this.getDocHandle();
    const pageHandle = mod.FPDF_LoadPage(docHandle, pageIndex);
    if (!pageHandle) throw new Error(`Failed to load page at index ${pageIndex}.`);

    const page = new PdfPage(this.engine, pageIndex, docHandle, pageHandle);
    this.pages.set(pageIndex, page);
    return page;
  }

  /**
   * Flushes and closes a specific cached page handle so it can be cleanly reloaded.
   * Called after in-place mutations (text edits, redactions, object removals).
   * @param pageIndex The zero-based index of the page to invalidate.
   */
  public invalidatePage(pageIndex: number): void {
    const existing = this.pages.get(pageIndex);
    if (existing) {
      const mod = this.engine.getModule();
      existing.generateContent();
      mod.FPDF_ClosePage(existing.pageHandle);
      this.pages.delete(pageIndex);
    }
    this._fontCharsetIndex.invalidate();
  }

  /**
   * Flushes pending mutations and closes all active WASM page handles.
   */
  public closeAllPages(): void {
    const mod = this.engine.getModule();
    for (const page of this.pages.values()) {
      page.generateContent();
      mod.FPDF_ClosePage(page.pageHandle);
    }
    this.pages.clear();
  }

  /**
   * Merges another PDF document into this one.
   * @param buffer The ArrayBuffer containing the PDF to merge.
   * @param atIndex The zero-based index at which to insert the merged pages.
   */
  public merge(buffer: ArrayBuffer, atIndex: number): void {
    this.closeAllPages();
    docOps.mergePdfBuffer(this.engine, this.getDocHandle(), buffer, atIndex);
  }

  /**
   * Splits specific pages from the current document into a new PDF.
   * @param pageIndices Array of zero-based page indices to extract.
   * @returns A Uint8Array containing the newly created PDF.
   */
  public split(pageIndices: number[]): Uint8Array {
    return docOps.splitPdf(this.engine, this.getDocHandle(), pageIndices);
  }

  /**
   * Adds a new blank page to the document.
   * @param atIndex The zero-based index at which to insert the blank page.
   * @param widthPts Optional width in points. Defaults to standard A4 (595.28).
   * @param heightPts Optional height in points. Defaults to standard A4 (841.89).
   */
  public addBlankPage(atIndex: number, widthPts?: number, heightPts?: number): void {
    this.closeAllPages();
    docOps.addBlankPage(this.engine, this.getDocHandle(), atIndex, widthPts, heightPts);
  }

  /**
   * Duplicates an existing page.
   * @param pageIndex The zero-based index of the page to duplicate.
   */
  public duplicatePage(pageIndex: number): void {
    this.closeAllPages();
    docOps.duplicatePage(this.engine, this.getDocHandle(), pageIndex);
  }

  /**
   * Reorders pages within the document.
   * @param fromIndices Array of zero-based page indices to move.
   * @param toIndex The zero-based destination index.
   */
  public reorderPages(fromIndices: number[], toIndex: number): void {
    this.closeAllPages();
    docOps.reorderPages(this.engine, this.getDocHandle(), fromIndices, toIndex);
  }

  /**
   * Deletes a page from the document.
   * @param pageIndex The zero-based index of the page to delete.
   */
  public deletePage(pageIndex: number): void {
    this.closeAllPages();
    const existing = this.pages.get(pageIndex);
    if (existing) {
      const mod = this.engine.getModule();
      existing.generateContent();
      mod.FPDF_ClosePage(existing.pageHandle);
      this.pages.delete(pageIndex);
    }
    docOps.deletePage(this.engine, this.getDocHandle(), pageIndex);
  }

  /**
   * Imports an image file and appends it as a new page in the document.
   * @param imageBuffer The image file data as an ArrayBuffer.
   * @param mimeType The MIME type of the image.
   * @param atIndex The zero-based index at which to insert the new image page.
   */
  public async importImageAsPage(imageBuffer: ArrayBuffer, mimeType: string, atIndex: number): Promise<void> {
    this.closeAllPages();
    await docOps.importImageAsPage(this.engine, this.getDocHandle(), imageBuffer, mimeType, atIndex);
  }

  /**
   * Retrieves the document outline (bookmarks).
   * @returns An array of OutlineNode objects representing the document structure.
   */
  public getOutline(): OutlineNode[] {
    return metadataOps.getOutline(this.engine, this.getDocHandle());
  }

  /**
   * Retrieves basic file information such as file size and name.
   * @param fileName The name of the file.
   * @param sizeBytes The size of the file in bytes.
   * @returns A DocumentInfo object.
   */
  public getInfo(fileName: string, sizeBytes: number): DocumentInfo {
    return metadataOps.getDocumentInfo(this.engine, this.getDocHandle(), fileName, sizeBytes);
  }

  /**
   * Internal reference to the active document binary payload for rich metadata inspection.
   */
  private _rawBuffer: ArrayBuffer | Uint8Array | null = null;

  /**
   * Cached full metadata object.
   */
  private _cachedMetadata: DocumentMetadata | null = null;

  /**
   * Sets the active raw binary buffer for extended metadata parsing.
   * @param buffer The binary buffer.
   */
  public setRawBuffer(buffer: ArrayBuffer | Uint8Array): void {
    this._rawBuffer = buffer;
    this._cachedMetadata = null;
  }

  /**
   * Retrieves embedded document metadata tags (Title, Author, Subject, etc.).
   * Returns cached extended metadata if available, or extracts baseline metadata.
   * @param rawBuffer Optional binary buffer to extract extended custom tags from.
   * @returns A DocumentMetadata object containing parsed tags.
   */
  public getMetadata(rawBuffer?: ArrayBuffer | Uint8Array): DocumentMetadata {
    if (this._cachedMetadata && !rawBuffer) {
      return this._cachedMetadata;
    }
    const buf = rawBuffer ?? this._rawBuffer;
    if (buf && buf.byteLength > 0) {
      // Trigger lazy async enrichment if not yet cached
      this.getExtendedMetadata(buf).catch((err) => {
        console.warn('Failed to asynchronously extract extended metadata:', err);
      });
    }
    return metadataOps.getMetadata(this.engine, this.getDocHandle());
  }

  /**
   * Asynchronously extracts complete document metadata including all custom Info keys,
   * XMP metadata stream, file metrics, and signatures.
   *
   * @param rawBuffer Optional binary buffer to inspect.
   * @param fileName Optional file name.
   * @param sizeBytes Optional file size in bytes.
   * @return A promise resolving to the full DocumentMetadata.
   */
  public async getExtendedMetadata(
    rawBuffer?: ArrayBuffer | Uint8Array,
    fileName?: string,
    sizeBytes?: number
  ): Promise<DocumentMetadata> {
    const buf = rawBuffer ?? this._rawBuffer;
    const meta = await metadataOps.extractAllMetadata(
      this.engine,
      this.getDocHandle(),
      buf ?? undefined,
      fileName,
      sizeBytes
    );
    this._cachedMetadata = meta;
    return meta;
  }

  /**
   * Updates metadata fields and custom dictionary tags in the document.
   *
   * @param updates The metadata fields and custom key-value pairs to set.
   * @return A promise resolving to the updated bytes and newly extracted metadata.
   */
  public async updateMetadata(
    updates: DocumentMetadataUpdate
  ): Promise<{ bytes: Uint8Array; metadata: DocumentMetadata }> {
    const rawBytes = await this.saveAsync();
    const updatedBytes = await metadataOps.updateDocumentMetadata(rawBytes, updates);
    this.setRawBuffer(updatedBytes);
    const updatedMeta = await metadataOps.extractAllMetadata(
      this.engine,
      this.getDocHandle(),
      updatedBytes
    );
    this._cachedMetadata = updatedMeta;
    return { bytes: updatedBytes, metadata: updatedMeta };
  }

  /**
   * Gets the total number of digital signatures present in the document.
   * @returns The signature count.
   */
  public getSignatureCount(): number {
    return metadataOps.getSignatureCount(this.engine, this.getDocHandle());
  }

  /**
   * Gets the total number of file attachments embedded in the document.
   * @returns The attachment count.
   */
  public getAttachmentCount(): number {
    return metadataOps.getAttachmentCount(this.engine, this.getDocHandle());
  }

  /**
   * Saves the current document state to a byte array.
   * Ensures all opened pages are properly flushed and closed before saving to prevent memory leaks.
   * @returns A Uint8Array containing the serialized PDF file.
   * @throws If the file writer fails to initialize or save.
   */
  public save(): Uint8Array {
    const mod = this.engine.getModule();
    const docHandle = this.getDocHandle();

    this.closeAllPages();

    const writerPtr = mod.PDFiumExt_OpenFileWriter();
    if (!writerPtr) throw new Error('Failed to open PDF file writer.');

    try {
      const ok = mod.PDFiumExt_SaveAsCopy(docHandle, writerPtr);
      if (!ok) throw new Error('Failed to save document copy.');

      const size = mod.PDFiumExt_GetFileWriterSize(writerPtr);
      const dataPtr = this.engine.allocateMemory(size);
      try {
        mod.PDFiumExt_GetFileWriterData(writerPtr, dataPtr, size);
        const srcBytes = new Uint8Array(mod.pdfium.HEAPU8.buffer, dataPtr, size);
        const result = new Uint8Array(size);
        result.set(srcBytes);
        return result;
      } finally {
        this.engine.freeMemory(dataPtr);
      }
    } finally {
      mod.PDFiumExt_CloseFileWriter(writerPtr);
    }
  }

  /**
   * Saves the current document state to a byte array and asynchronously applies pending AcroForm fields.
   * Ensures all opened pages are properly flushed and closed before saving to prevent memory leaks.
   * @returns A Promise resolving to a Uint8Array containing the serialized PDF file.
   */
  public async saveAsync(pageTransforms?: Record<number, PageTransform>): Promise<Uint8Array> {
    const mod = this.engine.getModule();
    const docHandle = this.getDocHandle();
    const pendingFields: { pageIndex: number; field: FormFieldPlaceholderOptions }[] = [];

    for (const page of this.pages.values()) {
      page.generateContent();
      const fields = page.getPendingAcroFormFields();
      if (fields && fields.length > 0) {
        pendingFields.push(...fields.map(f => ({ pageIndex: page.getIndex(), field: f })));
      }
    }
    this.closeAllPages();

    const writerPtr = mod.PDFiumExt_OpenFileWriter();
    if (!writerPtr) throw new Error('Failed to open PDF file writer.');

    let pdfiumBytes: Uint8Array;
    try {
      const ok = mod.PDFiumExt_SaveAsCopy(docHandle, writerPtr);
      if (!ok) throw new Error('Failed to save document copy.');

      const size = mod.PDFiumExt_GetFileWriterSize(writerPtr);
      const dataPtr = this.engine.allocateMemory(size);
      try {
        mod.PDFiumExt_GetFileWriterData(writerPtr, dataPtr, size);
        const srcBytes = new Uint8Array(mod.pdfium.HEAPU8.buffer, dataPtr, size);
        pdfiumBytes = new Uint8Array(size);
        pdfiumBytes.set(srcBytes);
      } finally {
        this.engine.freeMemory(dataPtr);
      }
    } finally {
      mod.PDFiumExt_CloseFileWriter(writerPtr);
    }

    const hasTransforms = pageTransforms && Object.values(pageTransforms).some(
      t => t && (t.rotation !== 0 || t.scaleX !== 1 || t.scaleY !== 1)
    );

    if (pendingFields.length > 0 || hasTransforms) {
      const {
        PDFDocument,
        PDFName,
        PDFHexString,
        PDFContentStream,
        degrees,
        pushGraphicsState,
        popGraphicsState,
        concatTransformationMatrix
      } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(pdfiumBytes);

      // Apply page transforms (rotation and scaling)
      if (hasTransforms && pageTransforms) {
        const pageCount = pdfDoc.getPageCount();
        for (let i = 0; i < pageCount; i++) {
          const transform = pageTransforms[i];
          if (!transform) continue;
          const { rotation = 0, scaleX = 1, scaleY = 1 } = transform;
          if (rotation === 0 && scaleX === 1 && scaleY === 1) continue;

          const page = pdfDoc.getPage(i);
          const existingAngle = page.getRotation().angle;
          const rawSize = page.getSize();
          const rawW = rawSize.width;
          const rawH = rawSize.height;

          const normalizedR = ((rotation % 360) + 360) % 360;
          const roundedOrthogonal = (Math.round(normalizedR / 90) * 90) % 360;
          const isOrthogonal =
            Math.abs(normalizedR - roundedOrthogonal) < 0.5 ||
            Math.abs(normalizedR - roundedOrthogonal) > 359.5;

          const isScaleIdentity = Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001;

          if (isOrthogonal && isScaleIdentity) {
            // Clean native PDF page rotation: updates /Rotate dictionary entry
            const finalAngle = ((existingAngle + roundedOrthogonal) % 360 + 360) % 360;
            page.setRotation(degrees(finalAngle));
          } else if (isOrthogonal && !isScaleIdentity) {
            // Orthogonal rotation with scaling
            const finalAngle = ((existingAngle + roundedOrthogonal) % 360 + 360) % 360;
            page.setRotation(degrees(finalAngle));

            const isFinalLandscape = finalAngle === 90 || finalAngle === 270;
            if (isFinalLandscape) {
              page.setSize(rawW * scaleY, rawH * scaleX);
            } else {
              page.setSize(rawW * scaleX, rawH * scaleY);
            }

            const start = PDFContentStream.of(
              pdfDoc.context.obj({}),
              [pushGraphicsState(), concatTransformationMatrix(scaleX, 0, 0, scaleY, 0, 0)]
            );
            const startRef = pdfDoc.context.register(start);
            const end = PDFContentStream.of(
              pdfDoc.context.obj({}),
              [popGraphicsState()]
            );
            const endRef = pdfDoc.context.register(end);

            page.node.normalize();
            page.node.wrapContentStreams(startRef, endRef);
          } else {
            // Non-orthogonal arbitrary angle rotation and/or scaling
            const totalR = ((existingAngle + normalizedR) % 360 + 360) % 360;
            const rad = (totalR * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const absCos = Math.abs(cos);
            const absSin = Math.abs(sin);

            const scaledW = rawW * scaleX;
            const scaledH = rawH * scaleY;
            const W_new = scaledW * absCos + scaledH * absSin;
            const H_new = scaledW * absSin + scaledH * absCos;

            const a = scaleX * cos;
            const b = -scaleX * sin;
            const c = scaleY * sin;
            const d = scaleY * cos;
            const e = W_new / 2 - a * (rawW / 2) - c * (rawH / 2);
            const f = H_new / 2 - b * (rawW / 2) - d * (rawH / 2);

            const start = PDFContentStream.of(
              pdfDoc.context.obj({}),
              [pushGraphicsState(), concatTransformationMatrix(a, b, c, d, e, f)]
            );
            const startRef = pdfDoc.context.register(start);
            const end = PDFContentStream.of(
              pdfDoc.context.obj({}),
              [popGraphicsState()]
            );
            const endRef = pdfDoc.context.register(end);

            page.node.normalize();
            page.node.wrapContentStreams(startRef, endRef);
            page.setRotation(degrees(0));
            page.setSize(W_new, H_new);
          }
        }
      }

      // Apply AcroForm fields
      if (pendingFields.length > 0) {
        const form = pdfDoc.getForm();

        for (const { pageIndex, field } of pendingFields) {
          const page = pdfDoc.getPage(pageIndex);
          const { height: pageHeight } = page.getSize();

          const pdfLibY = pageHeight - field.y - field.height;

          const tooltipText = field.label || field.placeholder;
          const setTooltip = (acroField: PDFAcroField) => {
            if (tooltipText) {
              acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(tooltipText));
            }
          };

          if (field.variant === 'text-input') {
            const textField = form.createTextField(field.id);
            textField.addToPage(page, { x: field.x, y: pdfLibY, width: field.width, height: field.height });
            setTooltip(textField.acroField);
            if (field.placeholder) {
              textField.setText(field.placeholder);
            }
          } else if (field.variant === 'checkbox') {
            const checkbox = form.createCheckBox(field.id);
            checkbox.addToPage(page, { x: field.x, y: pdfLibY, width: field.width, height: field.height });
            setTooltip(checkbox.acroField);
          } else if (field.variant === 'radio') {
            let radioGroup;
            try {
              radioGroup = form.getRadioGroup(field.id);
              if (!radioGroup) {
                radioGroup = form.createRadioGroup(field.id);
              }
            } catch {
              radioGroup = form.createRadioGroup(field.id);
            }
            radioGroup.addOptionToPage(field.id + '_opt', page, { x: field.x, y: pdfLibY, width: field.width, height: field.height });
            setTooltip(radioGroup.acroField);
          } else if (field.variant === 'dropdown') {
            const dropdown = form.createDropdown(field.id);
            dropdown.addToPage(page, { x: field.x, y: pdfLibY, width: field.width, height: field.height });
            setTooltip(dropdown.acroField);
            if (field.placeholder) {
              dropdown.addOptions([field.placeholder]);
              dropdown.select(field.placeholder);
            }
          } else if (field.variant === 'signature' || field.variant === 'attachment') {
            const textField = form.createTextField(field.id);
            textField.setText(field.variant === 'signature' ? 'Signature' : 'Attachment');
            textField.addToPage(page, { x: field.x, y: pdfLibY, width: field.width, height: field.height });
            setTooltip(textField.acroField);
          }
        }
      }

      pdfiumBytes = await pdfDoc.save();
    }

    return pdfiumBytes;
  }

  /**
   * Inspects the current document for sensitive metadata, attachments, scripts,
   * annotations, and bookmarks before sanitization.
   *
   * @param pageTransforms Optional active visual transforms to preserve when inspecting.
   * @return A promise resolving to the sanitization inspection summary.
   */
  public async inspectForSanitization(pageTransforms?: Record<number, PageTransform>): Promise<SanitizationInspection> {
    const bytes = await this.saveAsync(pageTransforms);
    return inspectPdfForSanitization(bytes);
  }

  /**
   * Sanitizes the current document according to the specified options.
   *
   * @param options The sanitization flags to apply.
   * @param pageTransforms Optional active visual transforms to bake before sanitizing.
   * @return A promise resolving to the clean PDF bytes and a summary of purged items.
   */
  public async sanitize(
    options: SanitizeOptions,
    pageTransforms?: Record<number, PageTransform>
  ): Promise<{ bytes: Uint8Array; summary: SanitizeSummary }> {
    const rawBytes = await this.saveAsync(pageTransforms);
    const { sanitizedBytes, summary } = await sanitizePdf(rawBytes, options);
    return { bytes: sanitizedBytes, summary };
  }

  /**
   * Digitally signs the document conforming to PDF ISO 32000 Section 12.8.
   *
   * @param options The digital signature parameters and identity keys.
   * @param pageTransforms Optional active visual transforms to bake before signing.
   * @return A promise resolving to the signed PDF bytes.
   */
  public async sign(
    options: SignPdfOptions,
    pageTransforms?: Record<number, PageTransform>
  ): Promise<Uint8Array> {
    const rawBytes = await this.saveAsync(pageTransforms);
    const signedBytes = await signPdfIso32000(rawBytes, options);
    this.setRawBuffer(signedBytes);
    this._cachedMetadata = null;
    return signedBytes;
  }

  /**
   * Inspects and cryptographically validates all ISO 32000 digital signatures
   * in the document.
   *
   * @param pageTransforms Optional active visual transforms.
   * @return A promise resolving to an array of validation reports.
   */
  public async validateSignatures(
    pageTransforms?: Record<number, PageTransform>
  ): Promise<SignatureValidationResult[]> {
    const rawBytes = await this.saveAsync(pageTransforms);
    return verifyPdfSignatures(rawBytes);
  }
}


