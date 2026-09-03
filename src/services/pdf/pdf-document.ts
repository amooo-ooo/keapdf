import type { Command, CommandContext } from '../../core/command';
import type {
  EditableFormFieldSpan,
  EditableImageSpan,
  EditableShapeSpan,
  EditableTextSpan,
  FormFieldVariantType,
  HighlightRect,
  PageCharacter,
  TextMutationOptions,
} from '../../core/types';
import { transformPointForPageRotation } from '../../utils/geometry';
import { parseColor } from './utils';
import type {
  ShapeOptions,
  PathOptions,
  ImageOptions,
  TextOptions,
} from './operations/types';
import type { NoteAnnotationOptions } from './operations/add-annotations';
import { degrees, PDFName, PDFHexString, PDFBool, type PDFAcroTerminal, type PDFRadioGroup, type PDFForm } from 'pdf-lib';
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
  CompressOptions,
  CompressSummary,
  CompressionInspection,
  PageRasterizer,
} from '../../core/types';
import type { PDFAcroField } from 'pdf-lib';
import * as docOps from './operations/document-ops';
import * as metadataOps from './operations/metadata-ops';
import * as outlineOps from './operations/outline-ops';
import { exportAsBlob } from './operations/page-ops';
import { inspectPdfForSanitization, sanitizePdf } from './operations/sanitize-ops';
import { inspectPdfForCompression, compressPdf } from './operations/compress-ops';
import { signPdfIso32000, verifyPdfSignatures, type SignPdfOptions, type SignatureValidationResult } from './operations/signature-ops';
import type { FormFieldPlaceholderOptions } from './operations/types';
import type { PageTransform } from '../../stores/types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isGeneratedInternalId(id?: string): boolean {
  if (!id) return false;
  return (
    id.startsWith('elem_') ||
    id.startsWith('form_field_') ||
    id.startsWith('element_') ||
    UUID_REGEX.test(id)
  );
}

/**
 * Resolves an AcroForm field name prioritizing native source name, then explicit id, then label.
 */
function resolveAcroFieldName(field: FormFieldPlaceholderOptions): string {
  if (field.sourceFieldName && field.sourceFieldName.trim().length > 0) {
    return field.sourceFieldName.trim();
  }
  if (field.id && !isGeneratedInternalId(field.id)) {
    return field.id.trim();
  }
  if (field.label && field.label.trim().length > 0) {
    return field.label.trim();
  }
  return field.id || 'field';
}

/**
 * Derives a unique, collision-free field name within the current PDF document form.
 */
function getUniqueAcroFieldName(form: PDFForm, baseName: string, usedNames: Set<string>): string {
  let candidate = baseName;
  let counter = 1;
  while (usedNames.has(candidate) || form.getFieldMaybe(candidate) !== undefined) {
    candidate = `${baseName}_${counter}`;
    counter++;
  }
  usedNames.add(candidate);
  return candidate;
}

/**
 * High-level facade for interacting with a PDF document via PDFium.
 * Handles page lifecycle management and document-level operations.
 */
export class PdfDocument {
  /**
   * Cached extracted AcroForm field spans mapped by zero-based page index.
   */
  private _cachedAcroFormFieldSpans: Map<number, EditableFormFieldSpan[]> | null = null;
  private _acroFormInitPromise: Promise<Map<number, EditableFormFieldSpan[]>> | null = null;
  private _rawBuffer: ArrayBuffer | Uint8Array | null = null;
  private _cachedMetadata: DocumentMetadata | null = null;
  private removedAcroFormFieldNames = new Set<string>();
  private pendingAcroFormFieldsByPage = new Map<number, FormFieldPlaceholderOptions[]>();

  /**
   * Cached physical page dimensions in points, mapped by page index.
   * Invariant across zooms and viewport scrolling; cleared on mutations.
   */
  private _pageDimensionsCache: Map<number, { widthPts: number; heightPts: number }> = new Map();

  /**
   * Cached extracted overlay spans and objects mapped by page index.
   */
  private _pageSpansCache: Map<
    number,
    {
      textSpans: EditableTextSpan[];
      pageCharacters?: PageCharacter[];
      images: EditableImageSpan[];
      shapes: EditableShapeSpan[];
      formFields: EditableFormFieldSpan[];
    }
  > = new Map();

  public setRawBuffer(buffer: ArrayBuffer | Uint8Array | null): void {
    this._rawBuffer = buffer;
    this._cachedMetadata = null;
    this._cachedAcroFormFieldSpans = null;
    this._acroFormInitPromise = null;
    this.removedAcroFormFieldNames.clear();
    this.pendingAcroFormFieldsByPage.clear();
    this._pageDimensionsCache.clear();
    this._pageSpansCache.clear();
    if (buffer) {
      this.initAcroFormFieldSpans(buffer).catch((err: unknown) => {
        console.warn('Background AcroForm extraction failed:', err);
      });
    }
  }

  public addPendingAcroFormField(pageIndex: number, field: FormFieldPlaceholderOptions): void {
    let fields = this.pendingAcroFormFieldsByPage.get(pageIndex);
    if (!fields) {
      fields = [];
      this.pendingAcroFormFieldsByPage.set(pageIndex, fields);
    }
    fields.push(field);
  }

  public getPendingAcroFormFieldsForPage(pageIndex: number): FormFieldPlaceholderOptions[] {
    return this.pendingAcroFormFieldsByPage.get(pageIndex) || [];
  }

  public getAllPendingAcroFormFields(): Array<{ pageIndex: number; field: FormFieldPlaceholderOptions }> {
    const result: Array<{ pageIndex: number; field: FormFieldPlaceholderOptions }> = [];
    for (const [pageIndex, fields] of this.pendingAcroFormFieldsByPage.entries()) {
      for (const field of fields) {
        result.push({ pageIndex, field });
      }
    }
    return result;
  }

  public markAcroFormFieldRemoved(fieldName: string): void {
    this.removedAcroFormFieldNames.add(fieldName);
    if (this._cachedAcroFormFieldSpans) {
      for (const [pageIdx, spans] of this._cachedAcroFormFieldSpans.entries()) {
        const filtered = spans.filter(s => s.fieldName !== fieldName && s.fieldId !== fieldName);
        this._cachedAcroFormFieldSpans.set(pageIdx, filtered);
      }
    }
  }

  public unmarkAcroFormFieldRemoved(fieldName: string): void {
    this.removedAcroFormFieldNames.delete(fieldName);
  }

  public getRemovedAcroFormFieldNames(): string[] {
    return Array.from(this.removedAcroFormFieldNames);
  }

  public clearRemovedAcroFormFields(): void {
    this.removedAcroFormFieldNames.clear();
  }

  private static readonly MAX_CACHED_PAGES = 10;
  private static readonly MAX_CACHED_SPANS = 15;

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
  constructor(private engine: PdfiumEngine, private getDocHandleFn?: () => number) {
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
    if (this.getDocHandleFn) {
      return this.getDocHandleFn();
    }
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
        try {
          oldPage.generateContent();
        } catch {
          // Ignore error to ensure disposal
        } finally {
          oldPage.dispose();
          mod.FPDF_ClosePage(oldPage.pageHandle);
          this.pages.delete(oldestKey);
        }
      }
    }

    const docHandle = this.getDocHandle();
    const pageHandle = mod.FPDF_LoadPage(docHandle, pageIndex);
    if (!pageHandle) throw new Error(`Failed to load page at index ${pageIndex}.`);

    const page = new PdfPage(this.engine, this, pageIndex, docHandle, pageHandle);
    this.pages.set(pageIndex, page);
    if (!this._pageDimensionsCache.has(pageIndex)) {
      try {
        const dims = page.getDimensions();
        this._pageDimensionsCache.set(pageIndex, dims);
      } catch {
        // Safe fallback
      }
    }
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
      existing.dispose();
      mod.FPDF_ClosePage(existing.pageHandle);
      this.pages.delete(pageIndex);
    }
    this._fontCharsetIndex.invalidate();
    this._pageDimensionsCache.delete(pageIndex);
    this._pageSpansCache.delete(pageIndex);
  }

  /**
   * Flushes pending mutations and closes all active WASM page handles.
   */
  public closeAllPages(): void {
    const mod = this.engine.getModule();
    for (const page of this.pages.values()) {
      page.generateContent();
      page.dispose();
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
    this._cachedAcroFormFieldSpans = null;
    this._fontCharsetIndex.invalidate();
    this._pageDimensionsCache.clear();
    this._pageSpansCache.clear();
    this.pendingAcroFormFieldsByPage.clear();
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
    this._cachedAcroFormFieldSpans = null;
    this._fontCharsetIndex.invalidate();
    this._pageDimensionsCache.clear();
    this._pageSpansCache.clear();
    this.pendingAcroFormFieldsByPage.clear();
    docOps.addBlankPage(this.engine, this.getDocHandle(), atIndex, widthPts, heightPts);
  }

  /**
   * Duplicates an existing page.
   * @param pageIndex The zero-based index of the page to duplicate.
   */
  public duplicatePage(pageIndex: number): void {
    this.closeAllPages();
    this._cachedAcroFormFieldSpans = null;
    this._fontCharsetIndex.invalidate();
    this._pageDimensionsCache.clear();
    this._pageSpansCache.clear();
    this.pendingAcroFormFieldsByPage.clear();
    docOps.duplicatePage(this.engine, this.getDocHandle(), pageIndex);
  }

  /**
   * Reorders pages within the document.
   * @param fromIndices Array of zero-based page indices to move.
   * @param toIndex The zero-based destination index.
   */
  public reorderPages(fromIndices: number[], toIndex: number): void {
    this.closeAllPages();
    this._cachedAcroFormFieldSpans = null;
    this._fontCharsetIndex.invalidate();
    this._pageDimensionsCache.clear();
    this._pageSpansCache.clear();
    this.pendingAcroFormFieldsByPage.clear();
    docOps.reorderPages(this.engine, this.getDocHandle(), fromIndices, toIndex);
  }

  /**
   * Deletes a page from the document.
   * @param pageIndex The zero-based index of the page to delete.
   */
  public deletePage(pageIndex: number): void {
    this.closeAllPages();
    this._cachedAcroFormFieldSpans = null;
    this._fontCharsetIndex.invalidate();
    this._pageDimensionsCache.clear();
    this._pageSpansCache.clear();
    this.pendingAcroFormFieldsByPage.clear();
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
    this._cachedAcroFormFieldSpans = null;
    this._fontCharsetIndex.invalidate();
    this._pageDimensionsCache.clear();
    this._pageSpansCache.clear();
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
   * Adds or updates an outline item (bookmark) in the document.
   *
   * @param options The outline item configuration.
   * @return A promise resolving to the modified PDF byte array.
   */
  public async addOutlineItem(options: outlineOps.AddOrUpdateOutlineOptions): Promise<Uint8Array> {
    const rawBytes = await this.saveAsync();
    const updatedBytes = await outlineOps.addOrUpdateOutlineItem(rawBytes, options);
    this.setRawBuffer(updatedBytes);
    return updatedBytes;
  }

  /**
   * Sets the document outline explicitly from a list of flat outline items.
   *
   * @param items Flat list of outline items.
   * @return A promise resolving to the modified PDF byte array.
   */
  public async setOutline(items: outlineOps.OutlineItemFlat[]): Promise<Uint8Array> {
    const rawBytes = await this.saveAsync();
    const updatedBytes = await outlineOps.setOutlineItems(rawBytes, items);
    this.setRawBuffer(updatedBytes);
    return updatedBytes;
  }

  /**
   * Reorders outline items by moving elements from fromIndices to toIndex.
   *
   * @param fromIndices Source indices to move.
   * @param toIndex Target insertion index.
   * @return A promise resolving to the modified PDF byte array.
   */
  public async reorderOutline(fromIndices: number[], toIndex: number): Promise<Uint8Array> {
    const rawBytes = await this.saveAsync();
    const currentNodes = this.getOutline();
    const flatItems = outlineOps.flattenOutlineTree(currentNodes);
    const reordered = outlineOps.reorderOutlineItems(flatItems, fromIndices, toIndex);
    const updatedBytes = await outlineOps.setOutlineItems(rawBytes, reordered);
    this.setRawBuffer(updatedBytes);
    return updatedBytes;
  }

  /**
   * Sorts the document outline in natural top-to-bottom reading order.
   *
   * @return A promise resolving to the modified PDF byte array.
   */
  public async sortOutlineTopToBottom(): Promise<Uint8Array> {
    const rawBytes = await this.saveAsync();
    const currentNodes = this.getOutline();
    const flatItems = outlineOps.flattenOutlineTree(currentNodes);
    const sorted = outlineOps.sortOutlineTopToBottom(flatItems);
    const updatedBytes = await outlineOps.setOutlineItems(rawBytes, sorted);
    this.setRawBuffer(updatedBytes);
    return updatedBytes;
  }

  /**
   * Updates the heading level of an outline item at a given flat index.
   *
   * @param index Flat index of outline item.
   * @param newLevel Desired heading level (1 to 6).
   * @return A promise resolving to the modified PDF byte array.
   */
  public async updateOutlineItemLevel(index: number, newLevel: number): Promise<Uint8Array> {
    const rawBytes = await this.saveAsync();
    const updatedBytes = await outlineOps.updateOutlineItemLevel(rawBytes, index, newLevel);
    this.setRawBuffer(updatedBytes);
    return updatedBytes;
  }

  /**
   * Removes an outline item (bookmark) by title from the document.
   *
   * @param title The title of the outline item to remove.
   * @param pageIndex Optional page index constraint.
   * @return A promise resolving to the modified PDF byte array.
   */
  public async removeOutlineItem(title: string, pageIndex?: number): Promise<Uint8Array> {
    const rawBytes = await this.saveAsync();
    const updatedBytes = await outlineOps.removeOutlineItemFromPdf(rawBytes, title, pageIndex);
    this.setRawBuffer(updatedBytes);
    return updatedBytes;
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
   * Permanently purges an AcroForm field by name from the PDFDocument instance,
   * removing all associated widget annotations from page annotation arrays and unregistering the field.
   *
   * @param pdfDoc The pdf-lib PDFDocument instance.
   * @param fieldName The name of the field to purge.
   * @returns true if field was found and purged, false otherwise.
   */
  private purgeAcroFormField(pdfDoc: import('pdf-lib').PDFDocument, fieldName: string): boolean {
    try {
      const form = pdfDoc.getForm();
      const field = form.getFieldMaybe(fieldName);
      if (!field) return false;

      const widgets = field.acroField.getWidgets();
      for (const page of pdfDoc.getPages()) {
        const annots = page.node.Annots();
        if (annots) {
          for (let i = annots.size() - 1; i >= 0; i--) {
            const annotDict = annots.lookup(i);
            const annotRef = annots.get(i);
            const matches =
              annotDict === field.acroField.dict ||
              annotRef === field.acroField.ref ||
              widgets.some(w => {
                const wRef = (w as { ref?: unknown }).ref ?? pdfDoc.context.getObjectRef(w.dict);
                return annotDict === w.dict || (wRef !== undefined && annotRef === wRef);
              });
            if (matches) {
              annots.remove(i);
            }
          }
        }
      }
      form.acroForm.removeField(field.acroField);
      return true;
    } catch (err) {
      console.warn(`Failed to purge AcroForm field "${fieldName}":`, err);
      return false;
    }
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
    for (const page of this.pages.values()) {
      page.generateContent();
    }
    const pendingFields = this.getAllPendingAcroFormFields();
    const hasRemovedFields = this.removedAcroFormFieldNames.size > 0;
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

    if (pendingFields.length > 0 || hasTransforms || hasRemovedFields) {
      const {
        PDFDocument,
        TextAlignment,
      } = await import('pdf-lib');

      const pdfDoc = await PDFDocument.load(pdfiumBytes, { ignoreEncryption: true });

      // Purge removed AcroForm fields
      for (const fieldName of this.removedAcroFormFieldNames) {
        this.purgeAcroFormField(pdfDoc, fieldName);
      }

      // Also purge any source fields or replacement fields about to be re-added
      for (const { field } of pendingFields) {
        if (field.sourceFieldName) {
          this.purgeAcroFormField(pdfDoc, field.sourceFieldName);
        }
        if (field.id) {
          this.purgeAcroFormField(pdfDoc, field.id);
        }
      }

      if (pageTransforms) {
        const pageCount = pdfDoc.getPageCount();
        for (let i = 0; i < pageCount; i++) {
          const transform = pageTransforms[i];
          if (!transform) continue;
          const { rotation = 0, scaleX = 1, scaleY = 1 } = transform;
          if (rotation === 0 && scaleX === 1 && scaleY === 1) continue;

          const page = pdfDoc.getPage(i);
          const existingAngle = page.getRotation().angle;
          const normalizedR = ((rotation % 360) + 360) % 360;
          const roundedOrthogonal = (Math.round(normalizedR / 90) * 90) % 360;
          const finalAngle = ((existingAngle + roundedOrthogonal) % 360 + 360) % 360;
          page.setRotation(degrees(finalAngle));

          const isScaleIdentity = Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001;
          if (!isScaleIdentity) {
            const rawSize = page.getSize();
            page.setSize(rawSize.width * scaleX, rawSize.height * scaleY);
          }
        }
      }

      // Synchronize /MK /R on existing native AcroForm widgets when page is rotated
      const form = pdfDoc.getForm();
      const pages = pdfDoc.getPages();
      const pageMap = new Map<unknown, number>();
      pages.forEach((p, idx) => pageMap.set(p.ref, idx));

      for (const f of form.getFields()) {
        for (const w of f.acroField.getWidgets()) {
          const pRef = w.P();
          let pIndex = pRef ? pageMap.get(pRef) : undefined;
          if (pIndex === undefined) {
            for (let p = 0; p < pages.length; p++) {
              const annots = pages[p].node.Annots();
              if (annots) {
                for (let a = 0; a < annots.size(); a++) {
                  const wRef = (w as { ref?: unknown }).ref ?? pdfDoc.context.getObjectRef(w.dict);
                  if (annots.get(a) === w.dict || annots.lookup(a) === w.dict || (wRef !== undefined && annots.get(a) === wRef)) {
                    pIndex = p;
                    break;
                  }
                }
              }
              if (pIndex !== undefined) break;
            }
          }
          if (pIndex !== undefined) {
            const targetPage = pages[pIndex];
            const pAngle = ((targetPage.getRotation().angle % 360) + 360) % 360;
            if (pAngle !== 0) {
              const mk = w.getOrCreateAppearanceCharacteristics();
              mk.setRotation(pAngle);
            }
          }
        }
      }

      // Apply AcroForm fields
      if (pendingFields.length > 0) {
        // Ensure Chromium and PDF viewers refresh appearances from form values
        form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
        const usedFieldNames = new Set<string>();

        for (const { pageIndex, field } of pendingFields) {
          const page = pdfDoc.getPage(pageIndex);
          const cropBox = page.getCropBox() || page.getMediaBox();
          const cropX = cropBox.x ?? 0;
          const cropY = cropBox.y ?? 0;
          const cropW = cropBox.width;
          const cropH = cropBox.height;

          const pageRot = ((page.getRotation().angle % 360) + 360) % 360 as 0 | 90 | 180 | 270;
          const elemRot = (((Math.round((field.rotation ?? 0) / 90) * 90) % 360) + 360) % 360;
          const effectiveRot = (elemRot === pageRot || elemRot === 0
            ? pageRot
            : (pageRot + elemRot) % 360) as 0 | 90 | 180 | 270;

          const vx = field.x;
          const vy = field.y;
          const vw = field.width;
          const vh = field.height;

          let targetX = cropX + vx;
          let targetY = cropY + cropH - vy - vh;

          switch (pageRot) {
            case 0:
              targetX = cropX + vx;
              targetY = cropY + cropH - vy - vh;
              break;
            case 90:
              targetX = cropX + cropW - vy;
              targetY = cropY + vx;
              break;
            case 180:
              targetX = cropX + cropW - vx;
              targetY = cropY + vy + vh;
              break;
            case 270:
              targetX = cropX + vy;
              targetY = cropY + cropH - vx;
              break;
          }

          const fieldRotationDegrees = degrees(effectiveRot);

          const tooltipText = field.label || field.placeholder;
          const setTooltip = (acroField: PDFAcroField) => {
            if (tooltipText) {
              acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(tooltipText));
            }
          };

          const applyWidgetStyling = (acroTerminal: PDFAcroTerminal, f: FormFieldPlaceholderOptions = field) => {
            const widgets = acroTerminal.getWidgets();
            for (const w of widgets) {
              const mk = w.getOrCreateAppearanceCharacteristics();
              if (effectiveRot !== 0) {
                mk.setRotation(effectiveRot);
              }
              if (f.backgroundColor) {
                const rgb = parseColor(f.backgroundColor);
                if (rgb && rgb.a > 0) {
                  mk.setBackgroundColor([rgb.r / 255, rgb.g / 255, rgb.b / 255]);
                }
              }
              if (f.borderColor) {
                const rgb = parseColor(f.borderColor);
                if (rgb && rgb.a > 0) {
                  mk.setBorderColor([rgb.r / 255, rgb.g / 255, rgb.b / 255]);
                }
              }
              if (f.borderWidth !== undefined || f.borderStyle) {
                const bs = w.getOrCreateBorderStyle();
                if (f.borderWidth !== undefined) {
                  bs.setWidth(f.borderWidth);
                }
                if (f.borderStyle === 'dashed') {
                  bs.dict.set(PDFName.of('S'), PDFName.of('D'));
                  bs.dict.set(PDFName.of('D'), pdfDoc.context.obj([3, 3]));
                } else if (f.borderStyle === 'solid') {
                  bs.dict.set(PDFName.of('S'), PDFName.of('S'));
                }
              }
            }
          };

          if (field.variant === 'text-input') {
            const baseName = resolveAcroFieldName(field);
            const fieldName = getUniqueAcroFieldName(form, baseName, usedFieldNames);
            const textField = form.createTextField(fieldName);
            textField.addToPage(page, {
              x: targetX,
              y: targetY,
              width: vw,
              height: vh,
              rotate: fieldRotationDegrees,
            });
            setTooltip(textField.acroField);
            if (field.fontSize) textField.setFontSize(field.fontSize);
            if (field.readOnly) textField.enableReadOnly();
            if (field.required) textField.enableRequired();
            if (field.textAlign === 'center') textField.setAlignment(TextAlignment.Center);
            else if (field.textAlign === 'right') textField.setAlignment(TextAlignment.Right);
            else textField.setAlignment(TextAlignment.Left);
            if (field.value !== undefined && field.value !== '') {
              textField.setText(String(field.value));
            }
            applyWidgetStyling(textField.acroField, field);
          } else if (field.variant === 'checkbox') {
            const baseName = resolveAcroFieldName(field);
            const fieldName = getUniqueAcroFieldName(form, baseName, usedFieldNames);
            const checkbox = form.createCheckBox(fieldName);
            checkbox.addToPage(page, {
              x: targetX,
              y: targetY,
              width: vw,
              height: vh,
              rotate: fieldRotationDegrees,
            });
            setTooltip(checkbox.acroField);
            if (field.readOnly) checkbox.enableReadOnly();
            if (field.required) checkbox.enableRequired();
            const isChecked = field.value === true ||
              field.value === 'true' ||
              field.value === 'checked' ||
              field.value === '1' ||
              field.value === 'yes';
            if (isChecked) {
              checkbox.check();
            } else {
              checkbox.uncheck();
            }
            applyWidgetStyling(checkbox.acroField, field);
          } else if (field.variant === 'radio') {
            const groupName = resolveAcroFieldName(field);
            let radioGroup: PDFRadioGroup;
            try {
              radioGroup = form.getRadioGroup(groupName);
              if (!radioGroup) {
                radioGroup = form.createRadioGroup(groupName);
                usedFieldNames.add(groupName);
              }
            } catch {
              radioGroup = form.createRadioGroup(groupName);
              usedFieldNames.add(groupName);
            }
            const existingOptions = radioGroup.getOptions();
            let optName = field.options && field.options.length > 0 ? field.options[0] : '';
            if (!optName) {
              if (field.value && typeof field.value === 'string' && field.value !== 'true' && field.value !== 'false') {
                optName = field.value;
              } else {
                optName = field.label || `${groupName}_opt_${existingOptions.length + 1}`;
              }
            }
            let uniqueOpt = optName;
            let optCounter = 1;
            while (existingOptions.includes(uniqueOpt)) {
              uniqueOpt = `${optName}_${optCounter}`;
              optCounter++;
            }
            radioGroup.addOptionToPage(uniqueOpt, page, {
              x: targetX,
              y: targetY,
              width: vw,
              height: vh,
              rotate: fieldRotationDegrees,
            });
            setTooltip(radioGroup.acroField);
            if (field.readOnly) radioGroup.enableReadOnly();
            if (field.required) radioGroup.enableRequired();
            const isSelected = field.value === true ||
              field.value === 'true' ||
              field.value === 'checked' ||
              field.value === '1' ||
              field.value === uniqueOpt ||
              field.value === optName;
            if (isSelected) {
              try {
                radioGroup.select(uniqueOpt);
              } catch {}
            }
            applyWidgetStyling(radioGroup.acroField, field);
          } else if (field.variant === 'dropdown') {
            const baseName = resolveAcroFieldName(field);
            const fieldName = getUniqueAcroFieldName(form, baseName, usedFieldNames);
            const dropdown = form.createDropdown(fieldName);
            dropdown.addToPage(page, {
              x: targetX,
              y: targetY,
              width: vw,
              height: vh,
              rotate: fieldRotationDegrees,
            });
            setTooltip(dropdown.acroField);
            if (field.fontSize) dropdown.setFontSize(field.fontSize);
            if (field.readOnly) dropdown.enableReadOnly();
            if (field.required) dropdown.enableRequired();
            if (field.options && field.options.length > 0) {
              dropdown.addOptions(field.options);
              if (field.value && field.options.includes(String(field.value))) {
                dropdown.select(String(field.value));
              } else if (field.placeholder && field.options.includes(field.placeholder)) {
                dropdown.select(field.placeholder);
              }
            } else if (field.placeholder) {
              dropdown.addOptions([field.placeholder]);
              dropdown.select(field.placeholder);
            }
            applyWidgetStyling(dropdown.acroField, field);
          } else if (field.variant === 'signature' || field.variant === 'attachment') {
            const baseName = resolveAcroFieldName(field);
            const fieldName = getUniqueAcroFieldName(form, baseName, usedFieldNames);
            const textField = form.createTextField(fieldName);
            textField.addToPage(page, {
              x: targetX,
              y: targetY,
              width: vw,
              height: vh,
              rotate: fieldRotationDegrees,
            });
            setTooltip(textField.acroField);
            if (field.fontSize) textField.setFontSize(field.fontSize);
            if (field.readOnly) textField.enableReadOnly();
            if (field.required) textField.enableRequired();
            if (field.value !== undefined && field.value !== '') {
              textField.setText(String(field.value));
            } else {
              textField.setText(field.variant === 'signature' ? 'Signature' : 'Attachment');
            }
            applyWidgetStyling(textField.acroField, field);
          }
        }
      }

      pdfiumBytes = await pdfDoc.save({ useObjectStreams: false });
    }

    this.pendingAcroFormFieldsByPage.clear();
    this.removedAcroFormFieldNames.clear();
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
   * Inspects the current document for compression characteristics.
   *
   * @param pageTransforms Optional active visual transforms to bake before inspecting.
   * @return A promise resolving to compression inspection details.
   */
  public async inspectCompression(
    pageTransforms?: Record<number, PageTransform>
  ): Promise<CompressionInspection> {
    const rawBytes = await this.saveAsync(pageTransforms);
    return await inspectPdfForCompression(rawBytes);
  }

  /**
   * Compresses the current document according to specified options.
   *
   * @param options Compression preset and fine-tuning options.
   * @param pageTransforms Optional active visual transforms to bake before compressing.
   * @return A promise resolving to compressed bytes and a summary of savings.
   */
  public async compress(
    options: CompressOptions,
    pageTransforms?: Record<number, PageTransform>
  ): Promise<{ bytes: Uint8Array; summary: CompressSummary }> {
    const rawBytes = await this.saveAsync(pageTransforms);

    let pageRasterizer: PageRasterizer | undefined = undefined;
    if (options.level === 'flat_image') {
      pageRasterizer = async (pageIndex: number, scale: number, quality: number) => {
        const page = this.getPage(pageIndex);
        const { widthPts, heightPts } = page.getDimensions();
        const rendered = page.render(scale, { applyDpr: false });
        const blob = await exportAsBlob(rendered.canvas, 'jpeg', quality);
        const buf = await blob.arrayBuffer();
        return {
          bytes: new Uint8Array(buf),
          widthPts,
          heightPts,
        };
      };
    }

    const result = await compressPdf(rawBytes, options, pageRasterizer);
    return {
      bytes: result.compressedBytes,
      summary: result.summary,
    };
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

  /**
   * Asynchronously extracts all AcroForm field definitions and widget bounds across the document.
   * Caches results per-page to provide high-performance span access.
   *
   * @param rawBuffer Optional explicit binary buffer to parse.
   * @return A promise resolving to a Map of page index to EditableFormFieldSpan array.
   */
  public async initAcroFormFieldSpans(
    rawBuffer?: ArrayBuffer | Uint8Array
  ): Promise<Map<number, EditableFormFieldSpan[]>> {
    if (this._cachedAcroFormFieldSpans) {
      return this._cachedAcroFormFieldSpans;
    }
    if (this._acroFormInitPromise) {
      return this._acroFormInitPromise;
    }

    const buf = rawBuffer ?? this._rawBuffer;
    if (!buf || buf.byteLength === 0) {
      const emptyMap = new Map<number, EditableFormFieldSpan[]>();
      this._cachedAcroFormFieldSpans = emptyMap;
      return emptyMap;
    }

    this._acroFormInitPromise = (async () => {
      try {
        const {
          PDFDocument,
          PDFTextField,
          PDFCheckBox,
          PDFRadioGroup,
          PDFDropdown,
          PDFSignature,
          PDFButton,
        } = await import('pdf-lib');

        const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const form = pdfDoc.getForm();
        const fields = form.getFields();

        const pages = pdfDoc.getPages();
        const pageMap = new Map<unknown, number>();
        pages.forEach((p, idx) => pageMap.set(p.ref, idx));

        const byPage = new Map<number, EditableFormFieldSpan[]>();

        for (const field of fields) {
          const name = field.getName();
          let variant: FormFieldVariantType = 'text-input';
          if (field instanceof PDFTextField) variant = 'text-input';
          else if (field instanceof PDFCheckBox) variant = 'checkbox';
          else if (field instanceof PDFRadioGroup) variant = 'radio';
          else if (field instanceof PDFDropdown) variant = 'dropdown';
          else if (field instanceof PDFSignature) variant = 'signature';
          else if (field instanceof PDFButton) variant = 'text-input';

          let value: string | boolean | undefined;
          if (field instanceof PDFTextField) value = field.getText() || undefined;
          else if (field instanceof PDFCheckBox) value = field.isChecked();
          else if (field instanceof PDFRadioGroup) value = field.getSelected() || undefined;
          else if (field instanceof PDFDropdown) value = field.getSelected()?.[0] || undefined;

          let options: string[] | undefined;
          if (field instanceof PDFRadioGroup || field instanceof PDFDropdown) {
            options = field.getOptions();
          }

          const readOnly = field.isReadOnly();
          const required = field.isRequired();
          const widgets = field.acroField.getWidgets();

          for (let wIdx = 0; wIdx < widgets.length; wIdx++) {
            const widget = widgets[wIdx];
            const rect = widget.getRectangle();
            const pRef = widget.P();
            let pageIndex = pRef ? pageMap.get(pRef) : undefined;
            if (pageIndex === undefined) {
              for (let p = 0; p < pages.length; p++) {
                const annots = pages[p].node.Annots();
                if (annots) {
                  for (let a = 0; a < annots.size(); a++) {
                    const widgetRef = (widget as { ref?: unknown }).ref ?? pdfDoc.context.getObjectRef(widget.dict);
                    if (annots.get(a) === widget.dict || annots.lookup(a) === widget.dict || (widgetRef !== undefined && annots.get(a) === widgetRef)) {
                      pageIndex = p;
                      break;
                    }
                  }
                }
                if (pageIndex !== undefined) break;
              }
            }

            if (pageIndex !== undefined) {
              const targetPage = pages[pageIndex];
              const cropBox = targetPage.getCropBox() || targetPage.getMediaBox();
              const cropX = cropBox.x ?? 0;
              const cropY = cropBox.y ?? 0;
              const cropW = cropBox.width;
              const cropH = cropBox.height;
              const pageRotation = ((targetPage.getRotation().angle % 360) + 360) % 360 as 0 | 90 | 180 | 270;

              const rawX1 = rect.x;
              const rawY1 = rect.y;
              const rawX2 = rect.x + rect.width;
              const rawY2 = rect.y + rect.height;
              const pdfXMin = Math.min(rawX1, rawX2);
              const pdfXMax = Math.max(rawX1, rawX2);
              const pdfYMin = Math.min(rawY1, rawY2);
              const pdfYMax = Math.max(rawY1, rawY2);
              const width = Math.round((pdfXMax - pdfXMin) * 10) / 10;
              const height = Math.round((pdfYMax - pdfYMin) * 10) / 10;

              const unrotLeft = Math.round((pdfXMin - cropX) * 10) / 10;
              const unrotTop = Math.round((cropY + cropH - pdfYMax) * 10) / 10;

              let left = unrotLeft;
              let top = unrotTop;
              let rotation = 0;

              if (pageRotation !== 0) {
                const cx = unrotLeft + width / 2;
                const cy = unrotTop + height / 2;
                const newCenter = transformPointForPageRotation(
                  { x: cx, y: cy },
                  pageRotation,
                  cropW,
                  cropH
                );
                left = Math.round((newCenter.x - width / 2) * 10) / 10;
                top = Math.round((newCenter.y - height / 2) * 10) / 10;
                rotation = pageRotation;
              }

              let backgroundColor: string | undefined;
              let borderColor: string | undefined;
              let borderWidth: number | undefined;
              let borderStyle: 'solid' | 'dashed' | 'dotted' | 'none' | undefined;
              let textAlign: 'left' | 'center' | 'right' | undefined;

              const mk = widget.getAppearanceCharacteristics();
              if (mk) {
                const bgRgb = mk.getBackgroundColor();
                if (bgRgb && bgRgb.length >= 3) {
                  backgroundColor = `rgb(${Math.round(bgRgb[0] * 255)}, ${Math.round(bgRgb[1] * 255)}, ${Math.round(bgRgb[2] * 255)})`;
                }
                const bcRgb = mk.getBorderColor();
                if (bcRgb && bcRgb.length >= 3) {
                  borderColor = `rgb(${Math.round(bcRgb[0] * 255)}, ${Math.round(bcRgb[1] * 255)}, ${Math.round(bcRgb[2] * 255)})`;
                }
              }

              const bs = widget.getBorderStyle();
              if (bs) {
                borderWidth = bs.getWidth();
                const styleEntry = bs.dict?.get(PDFName.of('S'));
                if (styleEntry) {
                  const styleName = styleEntry.toString();
                  if (styleName.includes('D')) borderStyle = 'dashed';
                  else borderStyle = 'solid';
                }
              }

              const qEntry = field.acroField.dict.get(PDFName.of('Q'));
              if (qEntry) {
                const qObj = qEntry as { asNumber?: () => number };
                const qVal = typeof qObj.asNumber === 'function' ? qObj.asNumber() : Number(qEntry);
                if (qVal === 1) textAlign = 'center';
                else if (qVal === 2) textAlign = 'right';
                else if (qVal === 0) textAlign = 'left';
              }

              if (!byPage.has(pageIndex)) {
                byPage.set(pageIndex, []);
              }

              byPage.get(pageIndex)!.push({
                id: `form_field_${pageIndex}_${name}_${wIdx}`,
                type: 'form-field',
                pageIndex,
                fieldId: name,
                fieldName: name,
                variant,
                left,
                top,
                width,
                height,
                rotation,
                value,
                options,
                readOnly,
                required,
                backgroundColor,
                borderColor,
                borderWidth,
                borderStyle,
                textAlign,
              });
            }
          }
        }

        this._cachedAcroFormFieldSpans = byPage;
        return byPage;
      } catch (err) {
        console.warn('Failed to extract AcroForm fields with pdf-lib:', err);
        const fallback = new Map<number, EditableFormFieldSpan[]>();
        this._cachedAcroFormFieldSpans = fallback;
        return fallback;
      }
    })();

    return this._acroFormInitPromise;
  }

  /**
   * Retrieves extracted AcroForm fields as editable spans for the given page index.
   *
   * @param pageIndex Zero-based page index.
   * @return Array of EditableFormFieldSpan objects.
   */
  public extractFormFieldSpans(pageIndex: number): EditableFormFieldSpan[] {
    if (this._cachedAcroFormFieldSpans) {
      return this._cachedAcroFormFieldSpans.get(pageIndex) || [];
    }
    if (!this._acroFormInitPromise && this._rawBuffer) {
      this.initAcroFormFieldSpans(this._rawBuffer).catch((err: unknown) => {
        console.warn('Lazy AcroForm extraction error:', err);
      });
    }

    try {
      const page = this.getPage(pageIndex);
      const annots = page.getAnnotations();
      const dims = page.getDimensions();
      const widgetSpans: EditableFormFieldSpan[] = [];
      let idx = 0;
      for (const annot of annots) {
        if (annot.subtype === 'Widget') {
          const w = annot.rect.right - annot.rect.left;
          const h = annot.rect.top - annot.rect.bottom;
          const left = annot.rect.left;
          const top = dims.heightPts - annot.rect.top;
          widgetSpans.push({
            id: `form_field_${pageIndex}_widget_${idx}`,
            type: 'form-field',
            pageIndex,
            fieldId: `widget_${idx}`,
            fieldName: annot.contents && annot.contents !== '(No text content)' ? annot.contents : `Field ${idx + 1}`,
            variant: 'text-input',
            left,
            top,
            width: w,
            height: h,
            rotation: 0,
          });
          idx++;
        }
      }
      return widgetSpans;
    } catch {
      return [];
    }
  }

  public replaceTextSpan(
    pageIndex: number,
    targetSpan: EditableTextSpan,
    options: TextMutationOptions
  ): void {
    const page = this.getPage(pageIndex);
    page.replaceTextSpan(targetSpan, options, this._fontCharsetIndex);
    this.invalidatePage(pageIndex);
  }

  public positionTextSpan(
    pageIndex: number,
    targetSpan: EditableTextSpan,
    left: number,
    top: number
  ): void {
    this.replaceTextSpan(pageIndex, targetSpan, {
      ...targetSpan,
      left,
      top,
    });
  }

  public deleteTextSpan(pageIndex: number, targetSpan: EditableTextSpan): void {
    const page = this.getPage(pageIndex);
    page.deleteTextSpan(targetSpan);
    this.invalidatePage(pageIndex);
  }

  public extractTextSpans(pageIndex: number): EditableTextSpan[] {
    return this.getPage(pageIndex).extractTextSpans();
  }

  public extractCharacters(pageIndex: number): PageCharacter[] {
    return this.getPage(pageIndex).extractCharacters();
  }

  public redactTextRange(pageIndex: number, startIndex: number, endIndex: number): void {
    const page = this.getPage(pageIndex);
    page.redactTextRange(startIndex, endIndex);
    this.invalidatePage(pageIndex);
  }

  public deleteTextInRects(pageIndex: number, rects: HighlightRect[]): void {
    const page = this.getPage(pageIndex);
    page.deleteTextInRects(rects);
    this.invalidatePage(pageIndex);
  }

  public rotatePage(pageIndex: number, degreesDelta: 90 | 180 | 270): void {
    const page = this.getPage(pageIndex);
    const prevDims = page.getDimensions();
    page.rotate(degreesDelta);
    this.invalidatePage(pageIndex);

    if (this._cachedAcroFormFieldSpans?.has(pageIndex)) {
      const spans = this._cachedAcroFormFieldSpans.get(pageIndex);
      if (spans) {
        for (const span of spans) {
          const cx = span.left + span.width / 2;
          const cy = span.top + span.height / 2;
          const newCenter = transformPointForPageRotation(
            { x: cx, y: cy },
            degreesDelta,
            prevDims.widthPts,
            prevDims.heightPts
          );
          span.left = Math.round((newCenter.x - span.width / 2) * 10) / 10;
          span.top = Math.round((newCenter.y - span.height / 2) * 10) / 10;
          span.rotation = (((span.rotation || 0) + degreesDelta) % 360 + 360) % 360;
        }
      }
    }

    if (this.pendingAcroFormFieldsByPage.has(pageIndex)) {
      const pendingFields = this.pendingAcroFormFieldsByPage.get(pageIndex);
      if (pendingFields) {
        for (const field of pendingFields) {
          const cx = field.x + field.width / 2;
          const cy = field.y + field.height / 2;
          const newCenter = transformPointForPageRotation(
            { x: cx, y: cy },
            degreesDelta,
            prevDims.widthPts,
            prevDims.heightPts
          );
          field.x = Math.round((newCenter.x - field.width / 2) * 10) / 10;
          field.y = Math.round((newCenter.y - field.height / 2) * 10) / 10;
          field.rotation = (((field.rotation || 0) + degreesDelta) % 360 + 360) % 360;
        }
      }
    }
  }

  public flattenPage(pageIndex: number): void {
    const page = this.getPage(pageIndex);
    page.flatten();
    this.invalidatePage(pageIndex);
  }

  public getPageDimensions(pageIndex: number): { widthPts: number; heightPts: number } {
    const cached = this._pageDimensionsCache.get(pageIndex);
    if (cached) {
      return cached;
    }
    const page = this.getPage(pageIndex);
    const dims = page.getDimensions();
    this._pageDimensionsCache.set(pageIndex, dims);
    return dims;
  }

  /**
   * Retrieves memoized overlay spans and objects for a page.
   *
   * @param pageIndex Zero-based page index.
   */
  public getCachedPageSpans(pageIndex: number): {
    textSpans: EditableTextSpan[];
    pageCharacters?: PageCharacter[];
    images: EditableImageSpan[];
    shapes: EditableShapeSpan[];
    formFields: EditableFormFieldSpan[];
  } | undefined {
    const existing = this._pageSpansCache.get(pageIndex);
    if (existing) {
      this._pageSpansCache.delete(pageIndex);
      this._pageSpansCache.set(pageIndex, existing);
      return existing;
    }
    return undefined;
  }

  /**
   * Stores memoized overlay spans and objects for a page.
   *
   * @param pageIndex Zero-based page index.
   * @param spans Extracted spans and object collections.
   */
  public setCachedPageSpans(
    pageIndex: number,
    spans: {
      textSpans: EditableTextSpan[];
      pageCharacters?: PageCharacter[];
      images: EditableImageSpan[];
      shapes: EditableShapeSpan[];
      formFields: EditableFormFieldSpan[];
    }
  ): void {
    if (this._pageSpansCache.has(pageIndex)) {
      this._pageSpansCache.delete(pageIndex);
    } else if (this._pageSpansCache.size >= PdfDocument.MAX_CACHED_SPANS) {
      const oldestKey = this._pageSpansCache.keys().next().value;
      if (oldestKey !== undefined) {
        this._pageSpansCache.delete(oldestKey);
      }
    }
    this._pageSpansCache.set(pageIndex, spans);
  }

  /**
   * Clears memoized overlay spans for a specific page or the entire document.
   *
   * @param pageIndex Optional zero-based page index. Clears all pages if omitted.
   */
  public clearCachedPageSpans(pageIndex?: number): void {
    if (pageIndex !== undefined) {
      this._pageSpansCache.delete(pageIndex);
    } else {
      this._pageSpansCache.clear();
    }
  }

  public drawText(pageIndex: number, options: TextOptions): void {
    const page = this.getPage(pageIndex);
    page.drawText(options);
    this.invalidatePage(pageIndex);
  }

  public drawRectangle(pageIndex: number, options: ShapeOptions): void {
    const page = this.getPage(pageIndex);
    page.drawRectangle(options);
    page.generateContent();
    this.invalidatePage(pageIndex);
  }

  public drawCircle(pageIndex: number, options: ShapeOptions): void {
    const page = this.getPage(pageIndex);
    page.drawCircle(options);
    page.generateContent();
    this.invalidatePage(pageIndex);
  }

  public drawLine(pageIndex: number, options: ShapeOptions): void {
    const page = this.getPage(pageIndex);
    page.drawLine(options);
    page.generateContent();
    this.invalidatePage(pageIndex);
  }

  public drawArrow(pageIndex: number, options: ShapeOptions): void {
    const page = this.getPage(pageIndex);
    page.drawArrow(options);
    page.generateContent();
    this.invalidatePage(pageIndex);
  }

  public drawPath(pageIndex: number, options: PathOptions): void {
    const page = this.getPage(pageIndex);
    page.drawPath(options);
    page.generateContent();
    this.invalidatePage(pageIndex);
  }

  public drawImage(pageIndex: number, options: ImageOptions): void {
    const page = this.getPage(pageIndex);
    page.drawImage(options);
    page.generateContent();
    this.invalidatePage(pageIndex);
  }

  public addHighlightAnnotation(pageIndex: number, options: ShapeOptions): void {
    const page = this.getPage(pageIndex);
    page.addHighlightAnnotation(options);
    page.generateContent();
    this.invalidatePage(pageIndex);
  }

  public addInkAnnotation(pageIndex: number, options: PathOptions): void {
    const page = this.getPage(pageIndex);
    page.addInkAnnotation(options);
    page.generateContent();
    this.invalidatePage(pageIndex);
  }

  public addTextAnnotation(pageIndex: number, options: NoteAnnotationOptions): void {
    const page = this.getPage(pageIndex);
    page.addTextAnnotation(options);
    page.generateContent();
    this.invalidatePage(pageIndex);
  }

  public removeAnnotation(pageIndex: number, annotIndex: number): void {
    const page = this.getPage(pageIndex);
    page.removeAnnotation(annotIndex);
    page.generateContent();
    this.invalidatePage(pageIndex);
  }

  // Unified command and history execution

  /** Past command history stack for undo. */
  private pastCommands: Command[] = [];

  /** Future command history stack for redo. */
  private futureCommands: Command[] = [];

  /** Maximum command history depth. */
  private static readonly MAX_HISTORY_DEPTH = 50;

  public get canUndo(): boolean {
    return this.pastCommands.length > 0;
  }

  public get canRedo(): boolean {
    return this.futureCommands.length > 0;
  }

  public get undoDescription(): string | null {
    if (this.pastCommands.length === 0) return null;
    return this.pastCommands[this.pastCommands.length - 1].description;
  }

  public get redoDescription(): string | null {
    if (this.futureCommands.length === 0) return null;
    return this.futureCommands[this.futureCommands.length - 1].description;
  }

  public get undoCount(): number {
    return this.pastCommands.length;
  }

  public get redoCount(): number {
    return this.futureCommands.length;
  }

  public pushCommand(command: Command): void {
    if (this.pastCommands.length > 0 && typeof command.merge === 'function') {
      const prev = this.pastCommands[this.pastCommands.length - 1];
      const merged = command.merge(prev);
      if (merged) {
        this.pastCommands[this.pastCommands.length - 1] = merged;
        this.futureCommands = [];
        return;
      }
    }
    this.pastCommands.push(command);
    if (this.pastCommands.length > PdfDocument.MAX_HISTORY_DEPTH) {
      this.pastCommands.shift();
    }
    this.futureCommands = [];
  }

  public async executeCommand(command: Command, ctx: CommandContext): Promise<void> {
    await command.execute(ctx);
    this.pushCommand(command);
  }

  public async undo(ctx: CommandContext): Promise<boolean> {
    if (this.pastCommands.length === 0) return false;
    const cmd = this.pastCommands.pop()!;
    try {
      await cmd.undo(ctx);
      this.futureCommands.push(cmd);
      if (this.futureCommands.length > PdfDocument.MAX_HISTORY_DEPTH) {
        this.futureCommands.shift();
      }
      return true;
    } catch (err) {
      console.error(`Failed to undo command "${cmd.description}":`, err);
      this.pastCommands.push(cmd);
      return false;
    }
  }

  public async redo(ctx: CommandContext): Promise<boolean> {
    if (this.futureCommands.length === 0) return false;
    const cmd = this.futureCommands.pop()!;
    try {
      await cmd.execute(ctx);
      this.pastCommands.push(cmd);
      return true;
    } catch (err) {
      console.error(`Failed to redo command "${cmd.description}":`, err);
      this.futureCommands.push(cmd);
      return false;
    }
  }

  public clearHistory(): void {
    this.pastCommands = [];
    this.futureCommands = [];
  }

  public syncCommandStacks(past: Command[], future: Command[]): void {
    this.pastCommands = [...past];
    this.futureCommands = [...future];
  }

  public dispose(): void {
    this.closeAllPages();
    this.engine.closeCurrentDocument();
    this.pastCommands = [];
    this.futureCommands = [];
    this._fontCharsetIndex.invalidate();
  }

}
