import type { Command, CommandContext } from '../../core/command';
import type {
  EditableFormFieldSpan,
  EditableImageSpan,
  EditableShapeSpan,
  EditableTextSpan,
  FormFieldVariantType,
  HighlightRect,
  PageCharacter,
  PageCropInfo,
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
import type { PDFAcroTerminal, PDFRadioGroup, PDFForm, PDFAcroField, PDFArray, PDFString } from 'pdf-lib';
import type { PdfiumEngine } from '../../core/pdfium-engine';
import { pdfBoxToDomBounds } from '../../core/pdfium-helpers';
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
import * as docOps from './operations/document-ops';
import { mergePdfBuffersWithAcroForms, splitPdfBufferWithAcroForms } from './operations/acroform-transfer-ops';
import * as metadataOps from './operations/metadata-ops';
import * as securityOps from './operations/security-ops';
import type { SecurityOptions } from './operations/security-ops';
import type { AddOrUpdateOutlineOptions, OutlineItemFlat } from './operations/outline-ops';
import { exportAsBlob } from './operations/page-ops';
import type { SignPdfOptions, SignatureValidationResult } from './operations/signature-ops';
import type { FormFieldPlaceholderOptions } from './operations/types';
import {
  applyPageNumbering as runPageNumberingOp,
  type PageNumberingOptions,
  type PageNumberingResult,
} from './operations/page-numbering-ops';
import type { DocumentTypographyProfile } from './operations/document-typography';
import type { PageTransform } from '../../stores/types';
import { resolveVerbatimPdfBytes } from './verbatim-bytes';
import type { PdfEncryptionContext } from './encryption/pdf-lib-encryption';

/** FPDF_SaveAsCopy flag that serialises the document without its security handler. */
const FPDF_REMOVE_SECURITY = 3;

/**
 * Plaintext snapshot of the document for pdf-lib rewrites. Rewritten output must be
 * passed through seal() so encrypted documents stay encrypted with their original
 * file key, /Encrypt dictionary, passwords and permissions.
 */
export interface PdfRewriteSession {
  /** Decrypted serialisation including pending AcroForm, link and transform changes. */
  readonly bytes: Uint8Array;
  /** Whether seal() re-encrypts its input. */
  readonly isEncrypted: boolean;
  /**
   * Re-applies the source document encryption to rewritten bytes.
   *
   * @param output Plaintext bytes derived from this session.
   * @return Encrypted bytes for encrypted sources, otherwise the input unchanged.
   */
  seal(output: Uint8Array): Promise<Uint8Array>;
}

/**
 * Views a buffer as a Uint8Array without copying.
 *
 * @param buffer Source buffer.
 * @return Byte view over the buffer.
 */
function toUint8Array(buffer: ArrayBuffer | Uint8Array): Uint8Array {
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

/**
 * Builds a rewrite session over plaintext bytes.
 *
 * @param bytes Plaintext serialisation.
 * @param encryption Context of the source document, null when unencrypted.
 * @return The rewrite session.
 */
function createRewriteSession(bytes: Uint8Array, encryption: PdfEncryptionContext | null): PdfRewriteSession {
  return {
    bytes,
    isEncrypted: encryption !== null,
    async seal(output: Uint8Array): Promise<Uint8Array> {
      if (!encryption) return output;
      const { encryptPdfBytes } = await import('./encryption/pdf-lib-encryption');
      return encryptPdfBytes(output, encryption);
    },
  };
}

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
  private _cachedTypographyProfile: DocumentTypographyProfile | null = null;
  private removedAcroFormFieldNames = new Set<string>();
  private pendingAcroFormFieldsByPage = new Map<number, FormFieldPlaceholderOptions[]>();
  private _formHandle: number = 0;
  private _formFillInfoPtr: number = 0;
  private _modifiedFormFieldValues = new Map<string, string | boolean>();
  private _pageRotationDeltas = new Map<
    number,
    {
      delta: 90 | 180 | 270;
      initialWidthPts: number;
      initialHeightPts: number;
      initialAngle: number;
      expectedAngle: number;
    }
  >();

  /** Password that opened or last re-secured the document, used to resolve the file key. */
  private _securityCredential = '';
  /** Memoised encryption context of the active security handler. */
  private _encryptionContextPromise: Promise<PdfEncryptionContext | null> | null = null;
  /** Whether the raw buffer no longer reflects the active security handler. */
  private _isSecurityHandlerStale = false;
  /** Resolves whether pdf-lib rewrites of encrypted documents must be re-encrypted. */
  private _isEncryptionPreservationEnabled: () => boolean = () => true;

  /**
   * Cached physical page dimensions in points, mapped by page index.
   * Invariant across zooms and viewport scrolling; cleared on mutations.
   */
  private _pageDimensionsCache: Map<number, { widthPts: number; heightPts: number }> = new Map();

  /**
   * Persistent 16-byte scratch pointer for zero-allocation dimension queries.
   */
  private _dimScratchPtr: number = 0;

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

  /**
   * Retrieves a persistent 16-byte scratch pointer in WASM memory for fast dimension queries.
   */
  private getDimScratch(): number {
    if (!this._dimScratchPtr && this.engine.isReady) {
      try {
        this._dimScratchPtr = this.engine.allocateMemory(16);
      } catch {
        this._dimScratchPtr = 0;
      }
    }
    return this._dimScratchPtr;
  }

  /**
   * Disposes the persistent dimension scratch pointer.
   */
  private disposeDimScratch(): void {
    if (this._dimScratchPtr && this.engine.isReady) {
      try {
        this.engine.freeMemory(this._dimScratchPtr);
      } catch {
        // Safe disposal
      }
      this._dimScratchPtr = 0;
    }
  }

  private _isPdfiumDirty = false;

  public markDirty(): void {
    this._isPdfiumDirty = true;
  }

  public getRawBuffer(): ArrayBuffer | Uint8Array | null {
    return this._rawBuffer;
  }

  /**
   * Records the password that opened the document so pdf-lib rewrites can be re-encrypted.
   *
   * @param password User or owner password, empty for documents without an open password.
   */
  public setSecurityCredential(password: string): void {
    this._securityCredential = password;
    this._encryptionContextPromise = null;
  }

  /**
   * Returns the password recorded for the active security handler.
   *
   * @return The recorded password, empty when none was required.
   */
  public getSecurityCredential(): string {
    return this._securityCredential;
  }

  /**
   * Installs the predicate deciding whether encrypted documents keep their encryption
   * across pdf-lib rewrites (wired to the 'security.preserve-encryption' feature flag).
   *
   * @param resolver Predicate evaluated lazily on every rewrite.
   */
  public setEncryptionPreservationResolver(resolver: () => boolean): void {
    this._isEncryptionPreservationEnabled = resolver;
  }

  /**
   * Resolves the encryption context of the active security handler.
   * Rejects when the handler cannot be reproduced, so callers never emit plaintext
   * objects into a document that declares /Encrypt.
   *
   * @return The context, or null for unencrypted documents or when preservation is disabled.
   */
  public getEncryptionContext(): Promise<PdfEncryptionContext | null> {
    if (
      typeof this.engine.getModule !== 'function' ||
      // note: engines without the EPDF security extension cannot report or reproduce encryption
      typeof this.engine.getModule().EPDF_IsEncrypted !== 'function' ||
      !this._isEncryptionPreservationEnabled() ||
      !this.isEncrypted()
    ) {
      return Promise.resolve(null);
    }

    this._encryptionContextPromise ??= (async () => {
      const { resolvePdfEncryptionContext } = await import('./encryption/pdf-lib-encryption');
      const source =
        !this._isSecurityHandlerStale && this._rawBuffer
          ? toUint8Array(this._rawBuffer)
          : this.serialise(0);
      return resolvePdfEncryptionContext(source, this._securityCredential);
    })().catch((err: unknown) => {
      this._encryptionContextPromise = null;
      throw err;
    });
    return this._encryptionContextPromise;
  }

  /**
   * Serialises a plaintext snapshot for pdf-lib rewrites together with a sealer that
   * restores the original encryption on the rewritten output.
   *
   * @param pageTransforms Optional page rotation and scaling transforms to bake.
   * @return The rewrite session.
   */
  public async saveForRewrite(
    pageTransforms?: Record<number, PageTransform> | Map<number, PageTransform>
  ): Promise<PdfRewriteSession> {
    const { bytes, encryption } = await this.serialiseWithPendingChanges(pageTransforms, 'plaintext');
    return createRewriteSession(bytes, encryption);
  }

  /**
   * Runs an external pdf-lib transform over a plaintext snapshot of the document and
   * re-applies the source encryption to its output.
   *
   * @param transform Rewriter receiving decrypted bytes and returning plaintext output.
   * @param pageTransforms Optional page rotation and scaling transforms to bake.
   * @return The rewritten bytes, encrypted when the source document was encrypted.
   */
  public async rewrite(
    transform: (bytes: Uint8Array) => Promise<Uint8Array>,
    pageTransforms?: Record<number, PageTransform> | Map<number, PageTransform>
  ): Promise<Uint8Array> {
    const session = await this.saveForRewrite(pageTransforms);
    return session.seal(await transform(session.bytes));
  }

  /**
   * Returns true if the document has any unbaked in-memory PDFium mutations,
   * modified form field values, pending annotations/attachments, or non-identity page transforms.
   */
  public hasUnbakedModifications(
    pageTransforms?: Record<number, PageTransform> | Map<number, PageTransform>
  ): boolean {
    if (this._isPdfiumDirty) return true;
    if (this._pageRotationDeltas.size > 0) return true;
    if (this._modifiedFormFieldValues.size > 0) return true;
    if (this.pendingAcroFormFieldsByPage.size > 0) return true;
    if (this.removedAcroFormFieldNames.size > 0) return true;
    if (this.pendingLinkAnnotationsByPage.size > 0) return true;
    if (this.pendingAttachments.length > 0) return true;
    if (pageTransforms) {
      const entries =
        pageTransforms instanceof Map
          ? Array.from(pageTransforms.values())
          : Object.values(pageTransforms);
      for (const t of entries) {
        if (
          t &&
          ((t.rotation && t.rotation % 360 !== 0) ||
            (t.scaleX !== undefined && t.scaleX !== 1) ||
            (t.scaleY !== undefined && t.scaleY !== 1))
        ) {
          return true;
        }
      }
    }
    return false;
  }

  public setRawBuffer(buffer: ArrayBuffer | Uint8Array | null): void {
    this.disposeFormFillEnvironment();
    this.clearModifiedFormFieldValues();
    this._rawBuffer = buffer;
    this._encryptionContextPromise = null;
    this._isSecurityHandlerStale = false;
    this._isPdfiumDirty = false;
    this._pageRotationDeltas.clear();
    this._cachedMetadata = null;
    this._cachedTypographyProfile = null;
    this._cachedAcroFormFieldSpans = null;
    this._acroFormInitPromise = null;
    this.removedAcroFormFieldNames.clear();
    this.pendingAcroFormFieldsByPage.clear();
    this.pendingLinkAnnotationsByPage.clear();
    this.pendingAttachments = [];
    this._pageDimensionsCache.clear();
    this._pageSpansCache.clear();
    this._fontCharsetIndex.invalidate();
    this.disposeDimScratch();
  }

  public pendingLinkAnnotationsByPage: Map<
    number,
    Array<{ x: number; y: number; width: number; height: number; uri?: string; fileName?: string }>
  > = new Map();
  public pendingAttachments: Array<{ fileName: string; bytes: Uint8Array; mimeType?: string; description?: string }> = [];

  public addPendingAcroFormField(pageIndex: number, field: FormFieldPlaceholderOptions): void {
    let fields = this.pendingAcroFormFieldsByPage.get(pageIndex);
    if (!fields) {
      fields = [];
      this.pendingAcroFormFieldsByPage.set(pageIndex, fields);
    }
    fields.push(field);
  }

  public addPendingLinkAnnotation(
    pageIndex: number,
    link: { x: number; y: number; width: number; height: number; uri?: string; fileName?: string }
  ): void {
    let links = this.pendingLinkAnnotationsByPage.get(pageIndex);
    if (!links) {
      links = [];
      this.pendingLinkAnnotationsByPage.set(pageIndex, links);
    }
    links.push(link);
  }

  public addPendingAttachment(attachment: { fileName: string; bytes: Uint8Array; mimeType?: string; description?: string }): void {
    this.pendingAttachments.push(attachment);
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

  /**
   * Ensures the PDFium form fill environment is initialised for the active document.
   * Conforms to Google Chromium PDFium form fill architecture.
   *
   * @return Form handle integer, or 0 if not available.
   */
  public ensureFormFillEnvironment(): number {
    if (this._formHandle) return this._formHandle;
    try {
      const docHandle = this.getDocHandle();
      const res = this.engine.initFormFillEnvironment(docHandle);
      if (res) {
        this._formHandle = res.formHandle;
        this._formFillInfoPtr = res.formFillInfoPtr;
      }
    } catch {
      // Safe fallback when docHandle is not yet ready
    }
    return this._formHandle;
  }

  /**
   * Returns the active PDFium form fill environment handle, if initialised.
   *
   * @return Form handle integer.
   */
  public getFormHandle(): number {
    return this._formHandle || this.ensureFormFillEnvironment();
  }

  /**
   * Disposes the PDFium form fill environment and frees native resources.
   */
  public disposeFormFillEnvironment(): void {
    if (this._formHandle || this._formFillInfoPtr) {
      this.engine.exitFormFillEnvironment(this._formHandle, this._formFillInfoPtr);
      this._formHandle = 0;
      this._formFillInfoPtr = 0;
    }
  }

  /**
   * Returns true if AcroForm field definitions have already been extracted and cached.
   */
  public hasCachedAcroFormSpans(): boolean {
    return this._cachedAcroFormFieldSpans !== null;
  }

  /**
   * Updates an AcroForm field value in the active document state.
   * Synchronises cached spans and queues the value for persistence upon save.
   * Clones span arrays and objects immutably to notify Svelte 5 raw state consumers.
   *
   * @param fieldName Target field identifier or name.
   * @param value New text value or boolean checkbox state.
   * @param pageIndex Optional zero-based page index for targeting.
   */
  public setFormFieldValue(fieldName: string, value: string | boolean, pageIndex?: number): void {
    this._modifiedFormFieldValues.set(fieldName, value);
    if (this._cachedAcroFormFieldSpans) {
      for (const [pageIdx, spans] of this._cachedAcroFormFieldSpans.entries()) {
        const nextSpans = spans.map((span) => {
          if (span.fieldName === fieldName || span.fieldId === fieldName || span.name === fieldName) {
            return { ...span, value };
          }
          return span;
        });
        this._cachedAcroFormFieldSpans.set(pageIdx, nextSpans);
      }
    }
    if (pageIndex !== undefined) {
      const cached = this._pageSpansCache.get(pageIndex);
      if (cached) {
        cached.formFields = cached.formFields.map((span) => {
          if (span.fieldName === fieldName || span.fieldId === fieldName || span.name === fieldName) {
            return { ...span, value };
          }
          return span;
        });
      }
    } else {
      for (const cached of this._pageSpansCache.values()) {
        cached.formFields = cached.formFields.map((span) => {
          if (span.fieldName === fieldName || span.fieldId === fieldName || span.name === fieldName) {
            return { ...span, value };
          }
          return span;
        });
      }
    }
  }

  /**
   * Restores or sets multiple user-modified AcroForm field values in batch.
   *
   * @param values Map or Record of field names to values.
   */
  public setAllFormFieldValues(values: ReadonlyMap<string, string | boolean> | Record<string, string | boolean>): void {
    const entries = values instanceof Map || 'entries' in values && typeof values.entries === 'function'
      ? (values as ReadonlyMap<string, string | boolean>).entries()
      : Object.entries(values as Record<string, string | boolean>);
    for (const [name, val] of entries) {
      this.setFormFieldValue(name, val);
    }
  }

  /**
   * Retrieves the current modified value for an AcroForm field, if any.
   *
   * @param fieldName Target field identifier or name.
   * @return Current field value or undefined.
   */
  public getFormFieldValue(fieldName: string): string | boolean | undefined {
    return this._modifiedFormFieldValues.get(fieldName);
  }

  /**
   * Retrieves all user-modified AcroForm field values.
   *
   * @return Readonly map of field names to values.
   */
  public getModifiedFormFieldValues(): ReadonlyMap<string, string | boolean> {
    return this._modifiedFormFieldValues;
  }

  /**
   * Clears all queued modified AcroForm field values.
   */
  public clearModifiedFormFieldValues(): void {
    this._modifiedFormFieldValues.clear();
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
          const formHandle = this.getFormHandle();
          if (formHandle) {
            this.engine.pageFormBeforeClose(oldPage.pageHandle, formHandle);
          }
          oldPage.dispose();
          mod.FPDF_ClosePage(oldPage.pageHandle);
          this.pages.delete(oldestKey);
        }
      }
    }

    const docHandle = this.getDocHandle();
    const pageHandle = mod.FPDF_LoadPage(docHandle, pageIndex);
    if (!pageHandle) throw new Error(`Failed to load page at index ${pageIndex}.`);

    const formHandle = this.getFormHandle();
    if (formHandle) {
      this.engine.pageFormAfterLoad(pageHandle, formHandle);
    }

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
    this._isPdfiumDirty = true;
    const existing = this.pages.get(pageIndex);
    if (existing) {
      if (this.engine.isReady) {
        const mod = this.engine.getModule();
        const formHandle = this.getFormHandle();
        if (formHandle) {
          this.engine.pageFormBeforeClose(existing.pageHandle, formHandle);
        }
        existing.generateContent();
        existing.dispose();
        mod.FPDF_ClosePage(existing.pageHandle);
      } else {
        existing.dispose();
      }
      this.pages.delete(pageIndex);
    }
    this._fontCharsetIndex.invalidatePage(pageIndex);
    this._cachedTypographyProfile = null;
    this._pageDimensionsCache.delete(pageIndex);
    this._pageSpansCache.delete(pageIndex);
  }

  /**
   * Reorders an object in the page content stream.
   *
   * @param pageIndex Zero-based page index.
   * @param fromIndex Zero-based source index of the object.
   * @param toIndex Zero-based target index of the object.
   * @returns Whether the object was successfully reordered.
   */
  public reorderPageObject(pageIndex: number, fromIndex: number, toIndex: number): boolean {
    const page = this.getPage(pageIndex);
    return page.reorderObject(fromIndex, toIndex);
  }

  /**
   * Flushes pending mutations and closes all active WASM page handles.
   */
  public closeAllPages(): void {
    if (!this.engine.isReady) {
      this.pages.clear();
      this.disposeDimScratch();
      return;
    }
    const mod = this.engine.getModule();
    const formHandle = this.getFormHandle();
    for (const page of this.pages.values()) {
      if (formHandle) {
        this.engine.pageFormBeforeClose(page.pageHandle, formHandle);
      }
      page.generateContent();
      page.dispose();
      mod.FPDF_ClosePage(page.pageHandle);
    }
    this.pages.clear();
    this.disposeDimScratch();
  }

  /**
   * Merges another PDF document into this one.
   * @param buffer The ArrayBuffer containing the PDF to merge.
   * @param atIndex The zero-based index at which to insert the merged pages.
   */
  public merge(buffer: ArrayBuffer, atIndex: number): void {
    this._isPdfiumDirty = true;
    this.closeAllPages();
    this._pageRotationDeltas.clear();
    this._cachedAcroFormFieldSpans = null;
    this._cachedTypographyProfile = null;
    this._fontCharsetIndex.invalidate();
    this._pageDimensionsCache.clear();
    this._pageSpansCache.clear();
    this.pendingAcroFormFieldsByPage.clear();
    docOps.mergePdfBuffer(this.engine, this.getDocHandle(), buffer, atIndex);
  }

  /**
   * Asynchronously merges another PDF document into this one, preserving all AcroForms
   * and reloading the engine state without dangling memory references.
   * @param buffer The ArrayBuffer or Uint8Array containing the PDF to merge.
   * @param atIndex The zero-based index at which to insert the merged pages.
   */
  public async mergeAsync(buffer: ArrayBuffer | Uint8Array, atIndex: number): Promise<void> {
    this._isPdfiumDirty = true;
    this.closeAllPages();
    this._pageRotationDeltas.clear();
    this._cachedAcroFormFieldSpans = null;
    this._acroFormInitPromise = null;
    this._cachedTypographyProfile = null;
    this._fontCharsetIndex.invalidate();
    this._pageDimensionsCache.clear();
    this._pageSpansCache.clear();

    const encryption = await this.getEncryptionContext();
    const session = createRewriteSession(this.serialise(encryption ? FPDF_REMOVE_SECURITY : 0), encryption);
    const mergedBytes = await session.seal(await mergePdfBuffersWithAcroForms(session.bytes, buffer, atIndex));
    this.disposeFormFillEnvironment();
    this._rawBuffer = mergedBytes;
    this._encryptionContextPromise = null;
    if (!this.getDocHandleFn) {
      this.engine.loadDocumentFromBuffer(mergedBytes, this._securityCredential);
    }
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
   * Asynchronously splits specific pages from the current document into a new PDF,
   * preserving all AcroForms, interactive form widgets, and values.
   * @param pageIndices Array of zero-based page indices to extract.
   * @returns A Promise resolving to a Uint8Array containing the newly created PDF.
   */
  public async splitAsync(pageIndices: number[]): Promise<Uint8Array> {
    const session = await this.saveForRewrite();
    return session.seal(await splitPdfBufferWithAcroForms(session.bytes, pageIndices));
  }

  /**
   * Adds a new blank page to the document.
   * @param atIndex The zero-based index at which to insert the blank page.
   * @param widthPts Optional width in points. Defaults to standard A4 (595.28).
   * @param heightPts Optional height in points. Defaults to standard A4 (841.89).
   */
  public addBlankPage(atIndex: number, widthPts?: number, heightPts?: number): void {
    this._isPdfiumDirty = true;
    this.closeAllPages();
    this._pageRotationDeltas.clear();
    this._cachedAcroFormFieldSpans = null;
    this._cachedTypographyProfile = null;
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
    this._isPdfiumDirty = true;
    this.closeAllPages();
    this._pageRotationDeltas.clear();
    this._cachedAcroFormFieldSpans = null;
    this._cachedTypographyProfile = null;
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
    this._isPdfiumDirty = true;
    this.closeAllPages();
    this._pageRotationDeltas.clear();
    this._cachedAcroFormFieldSpans = null;
    this._cachedTypographyProfile = null;
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
    this._isPdfiumDirty = true;
    this.closeAllPages();
    this._pageRotationDeltas.clear();
    this._cachedAcroFormFieldSpans = null;
    this._cachedTypographyProfile = null;
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
    this._isPdfiumDirty = true;
    this.closeAllPages();
    this._pageRotationDeltas.clear();
    this._cachedAcroFormFieldSpans = null;
    this._cachedTypographyProfile = null;
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
  public async addOutlineItem(options: AddOrUpdateOutlineOptions): Promise<Uint8Array> {
    const outlineOps = await import('./operations/outline-ops');
    const session = await this.saveForRewrite();
    const updatedBytes = await session.seal(await outlineOps.addOrUpdateOutlineItem(session.bytes, options));
    this.setRawBuffer(updatedBytes);
    return updatedBytes;
  }

  /**
   * Sets the document outline explicitly from a list of flat outline items.
   *
   * @param items Flat list of outline items.
   * @return A promise resolving to the modified PDF byte array.
   */
  public async setOutline(items: OutlineItemFlat[]): Promise<Uint8Array> {
    const outlineOps = await import('./operations/outline-ops');
    const session = await this.saveForRewrite();
    const updatedBytes = await session.seal(await outlineOps.setOutlineItems(session.bytes, items));
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
    const outlineOps = await import('./operations/outline-ops');
    const session = await this.saveForRewrite();
    const currentNodes = this.getOutline();
    const flatItems = outlineOps.flattenOutlineTree(currentNodes);
    const reordered = outlineOps.reorderOutlineItems(flatItems, fromIndices, toIndex);
    const updatedBytes = await session.seal(await outlineOps.setOutlineItems(session.bytes, reordered));
    this.setRawBuffer(updatedBytes);
    return updatedBytes;
  }

  /**
   * Sorts the document outline in natural top-to-bottom reading order.
   *
   * @return A promise resolving to the modified PDF byte array.
   */
  public async sortOutlineTopToBottom(): Promise<Uint8Array> {
    const outlineOps = await import('./operations/outline-ops');
    const session = await this.saveForRewrite();
    const currentNodes = this.getOutline();
    const flatItems = outlineOps.flattenOutlineTree(currentNodes);
    const sorted = outlineOps.sortOutlineTopToBottom(flatItems);
    const updatedBytes = await session.seal(await outlineOps.setOutlineItems(session.bytes, sorted));
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
    const outlineOps = await import('./operations/outline-ops');
    const session = await this.saveForRewrite();
    const updatedBytes = await session.seal(await outlineOps.updateOutlineItemLevel(session.bytes, index, newLevel));
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
    const outlineOps = await import('./operations/outline-ops');
    const session = await this.saveForRewrite();
    const updatedBytes = await session.seal(await outlineOps.removeOutlineItemFromPdf(session.bytes, title, pageIndex));
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
   * Checks whether the current document is encrypted.
   */
  public isEncrypted(): boolean {
    return securityOps.isPdfEncrypted(this.engine, this.getDocHandle());
  }

  /**
   * Checks whether owner permissions are currently unlocked for the active document.
   */
  public isOwnerUnlocked(): boolean {
    return securityOps.isPdfOwnerUnlocked(this.engine, this.getDocHandle());
  }

  /**
   * Unlocks owner administrative permissions using the configured owner password.
   */
  public unlockOwnerPermissions(ownerPassword: string): boolean {
    return securityOps.unlockPdfOwnerPermissions(this.engine, this.getDocHandle(), ownerPassword);
  }

  /**
   * Applies ISO 32000 standard encryption and access permissions to the active document.
   */
  public applySecurity(options: SecurityOptions): { success: boolean; isEncrypted: boolean; permissions: number } {
    this._isPdfiumDirty = true;
    const result = securityOps.applyPdfSecurity(this.engine, this.getDocHandle(), options);
    // note: the handle now carries a new security handler that the raw buffer predates
    this._securityCredential = options.ownerPassword || options.userPassword || '';
    this._isSecurityHandlerStale = true;
    this._encryptionContextPromise = null;
    return result;
  }

  /**
   * Removes encryption and security restrictions from the active document.
   */
  public removeSecurity(ownerPassword?: string): { success: boolean } {
    this._isPdfiumDirty = true;
    const result = securityOps.removePdfSecurity(this.engine, this.getDocHandle(), ownerPassword);
    this._securityCredential = '';
    this._isSecurityHandlerStale = true;
    this._encryptionContextPromise = null;
    return result;
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
    const session = await this.saveForRewrite();
    const updatedBytes = await session.seal(await metadataOps.updateDocumentMetadata(session.bytes, updates));
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
    return this.serialise(0);
  }

  /**
   * Serialises the PDFium document through the native file writer.
   * Ensures all opened pages are flushed and closed before saving to prevent memory leaks.
   *
   * @param flags FPDF_SaveAsCopy flags; 0 keeps the active security handler.
   * @return A Uint8Array containing the serialised PDF file.
   * @throws If the file writer fails to initialise or save.
   */
  private serialise(flags: number): Uint8Array {
    const mod = this.engine.getModule();
    const docHandle = this.getDocHandle();

    this.closeAllPages();

    const writerPtr = mod.PDFiumExt_OpenFileWriter();
    if (!writerPtr) throw new Error('Failed to open PDF file writer.');

    try {
      const ok =
        flags === 0
          ? mod.PDFiumExt_SaveAsCopy(docHandle, writerPtr)
          : mod.FPDF_SaveAsCopy(docHandle, writerPtr, flags);
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
   * Encrypted documents remain encrypted with their original security handler.
   * @param pageTransforms Optional map or record of page rotation and scaling transforms to bake into the saved document.
   * @returns A Promise resolving to a Uint8Array containing the serialized PDF file.
   */
  public async saveAsync(pageTransforms?: Record<number, PageTransform> | Map<number, PageTransform>): Promise<Uint8Array> {
    const { bytes } = await this.serialiseWithPendingChanges(pageTransforms, 'preserve');
    return bytes;
  }

  /**
   * Serialises the document and applies pending AcroForm fields, links, attachments and
   * page transforms through pdf-lib. pdf-lib only ever operates on decrypted bytes; in
   * 'preserve' mode its output is re-encrypted with the original file key.
   *
   * @param pageTransforms Optional page rotation and scaling transforms to bake.
   * @param mode 'preserve' keeps encryption, 'plaintext' strips it for further rewrites.
   * @return Serialised bytes and the encryption context of the source document.
   */
  private async serialiseWithPendingChanges(
    pageTransforms: Record<number, PageTransform> | Map<number, PageTransform> | undefined,
    mode: 'preserve' | 'plaintext'
  ): Promise<{ bytes: Uint8Array; encryption: PdfEncryptionContext | null }> {
    const pendingFields = this.getAllPendingAcroFormFields();
    const hasRemovedFields = this.removedAcroFormFieldNames.size > 0;

    const getTransform = (idx: number): PageTransform | undefined => {
      if (!pageTransforms) return undefined;
      if (pageTransforms instanceof Map) return pageTransforms.get(idx);
      return (pageTransforms as Record<number, PageTransform>)[idx];
    };

    const hasTransforms = Boolean(pageTransforms && (
      pageTransforms instanceof Map
        ? Array.from(pageTransforms.values()).some(
            t => t && (t.rotation !== 0 || t.scaleX !== 1 || t.scaleY !== 1)
          )
        : Object.values(pageTransforms).some(
            t => t && (t.rotation !== 0 || t.scaleX !== 1 || t.scaleY !== 1)
          )
    ));
    const hasPendingLinks = this.pendingLinkAnnotationsByPage.size > 0;
    const hasPendingAttachments = this.pendingAttachments.length > 0;
    const hasModifiedFormFields = this._modifiedFormFieldValues.size > 0;
    const hasPageRotationDeltas = this._pageRotationDeltas.size > 0;
    const needsPdfLibPass =
      pendingFields.length > 0 ||
      hasTransforms ||
      hasRemovedFields ||
      hasPendingLinks ||
      hasPendingAttachments ||
      hasModifiedFormFields ||
      hasPageRotationDeltas;

    let pdfiumBytes: Uint8Array;
    let encryption: PdfEncryptionContext | null = null;

    if (typeof this.engine.getModule !== 'function') {
      if (this._rawBuffer) {
        pdfiumBytes = this._rawBuffer instanceof Uint8Array ? this._rawBuffer : new Uint8Array(this._rawBuffer);
      } else {
        throw new Error('PDFium engine module not available.');
      }
    } else {
      for (const page of this.pages.values()) {
        page.generateContent();
      }
      // note: native PDFium saves already re-encrypt, so the key is only needed for pdf-lib passes
      encryption = needsPdfLibPass || mode === 'plaintext' ? await this.getEncryptionContext() : null;
      pdfiumBytes = this.serialise(encryption ? FPDF_REMOVE_SECURITY : 0);
    }

    if (needsPdfLibPass) {
      const {
        PDFDocument,
        TextAlignment,
        degrees,
        PDFName,
        PDFHexString,
        PDFBool,
        PDFArray,
        PDFNumber,
        PDFString,
        StandardFonts,
        rgb,
        PDFTextField,
        PDFCheckBox,
        PDFRadioGroup,
        PDFDropdown,
        PDFOptionList,
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

      if (hasPageRotationDeltas) {
        const pageCount = pdfDoc.getPageCount();
        for (const [rotPageIdx, rotInfo] of this._pageRotationDeltas.entries()) {
          if (rotPageIdx < 0 || rotPageIdx >= pageCount) continue;
          const page = pdfDoc.getPage(rotPageIdx);
          const currentAngle = (((page.getRotation().angle % 360) + 360) % 360);
          if (currentAngle !== rotInfo.expectedAngle) {
            page.setRotation(degrees(rotInfo.expectedAngle));
          }
        }
      }

      if (hasTransforms) {
        const pageCount = pdfDoc.getPageCount();
        for (let i = 0; i < pageCount; i++) {
          const transform = getTransform(i);
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
            const isOrthogonal = finalAngle === 90 || finalAngle === 270;
            const effSx = isOrthogonal ? scaleY : scaleX;
            const effSy = isOrthogonal ? scaleX : scaleY;

            const origCropBox = page.getCropBox();
            const origMediaBox = page.getMediaBox();

            page.scale(effSx, effSy);

            if (origCropBox) {
              page.setCropBox(
                origCropBox.x * effSx,
                origCropBox.y * effSy,
                origCropBox.width * effSx,
                origCropBox.height * effSy,
              );
            }
            if (origMediaBox && (origMediaBox.x !== 0 || origMediaBox.y !== 0)) {
              page.setMediaBox(
                origMediaBox.x * effSx,
                origMediaBox.y * effSy,
                origMediaBox.width * effSx,
                origMediaBox.height * effSy,
              );
            }
            const bleedBox = page.getBleedBox();
            if (bleedBox) {
              page.setBleedBox(
                bleedBox.x * effSx,
                bleedBox.y * effSy,
                bleedBox.width * effSx,
                bleedBox.height * effSy,
              );
            }
            const trimBox = page.getTrimBox();
            if (trimBox) {
              page.setTrimBox(
                trimBox.x * effSx,
                trimBox.y * effSy,
                trimBox.width * effSx,
                trimBox.height * effSy,
              );
            }
            const artBox = page.getArtBox();
            if (artBox) {
              page.setArtBox(
                artBox.x * effSx,
                artBox.y * effSy,
                artBox.width * effSx,
                artBox.height * effSy,
              );
            }
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

      // Apply user-modified AcroForm field values to existing native fields
      if (this._modifiedFormFieldValues.size > 0) {
        form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
        for (const [fieldName, val] of this._modifiedFormFieldValues.entries()) {
          try {
            const f = form.getFieldMaybe(fieldName);
            if (!f) continue;
            if (f instanceof PDFTextField) {
              f.setText(typeof val === 'string' ? val : String(val));
            } else if (f instanceof PDFCheckBox) {
              const isChecked = val === true || val === 'true' || val === '1' || val === 'yes';
              if (isChecked) {
                f.check();
              } else {
                f.uncheck();
              }
            } else if (f instanceof PDFRadioGroup) {
              if (typeof val === 'string' && val !== 'false' && val !== '') {
                try {
                  f.select(val);
                } catch {}
              } else {
                try {
                  f.clear();
                } catch {}
              }
            } else if ((f instanceof PDFDropdown || f instanceof PDFOptionList) && typeof val === 'string') {
              try {
                f.select(val);
              } catch {}
            }
          } catch (err) {
            console.warn(`Failed to update AcroForm field "${fieldName}" in PDF:`, err);
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

          const transform = getTransform(pageIndex);
          const sx = transform?.scaleX ?? 1;
          const sy = transform?.scaleY ?? 1;
          const sMin = Math.min(sx, sy);

          const pageRot = ((page.getRotation().angle % 360) + 360) % 360 as 0 | 90 | 180 | 270;
          const elemRot = (((Math.round((field.rotation ?? 0) / 90) * 90) % 360) + 360) % 360;
          const effectiveRot = (elemRot === pageRot || elemRot === 0
            ? pageRot
            : (pageRot + elemRot) % 360) as 0 | 90 | 180 | 270;

          const vx = field.x * sx;
          const vy = field.y * sy;
          const vw = field.width * sx;
          const vh = field.height * sy;
          const scaledFontSize = field.fontSize ? Math.max(4, Math.round(field.fontSize * sMin * 10) / 10) : undefined;
          const scaledBorderWidth = field.borderWidth !== undefined ? Math.max(0.5, Math.round(field.borderWidth * sMin * 10) / 10) : undefined;

          const isCenterRotatedWithPage = pageRot !== 0 && elemRot !== 0;

          let targetX = cropX + vx;
          let targetY = cropY + cropH - vy - vh;
          let fieldRotationDegrees = degrees(effectiveRot);

          if (isCenterRotatedWithPage) {
            const isOrthogonal = pageRot === 90 || pageRot === 270;
            const rotPageW = isOrthogonal ? cropH * sy : cropW * sx;
            const rotPageH = isOrthogonal ? cropW * sx : cropH * sy;
            const reverseRot = ((360 - pageRot) % 360) as 90 | 180 | 270;
            const unrotCenter = transformPointForPageRotation(
              { x: vx + vw / 2, y: vy + vh / 2 },
              reverseRot,
              rotPageW,
              rotPageH,
            );
            const unrotX = Math.round((unrotCenter.x - vw / 2) * 10) / 10;
            const unrotY = Math.round((unrotCenter.y - vh / 2) * 10) / 10;
            targetX = cropX + unrotX;
            targetY = cropY + cropH * sy - unrotY - vh;
            fieldRotationDegrees = degrees(0);
          } else {
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
          }

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
              if (scaledBorderWidth !== undefined || f.borderStyle) {
                const bs = w.getOrCreateBorderStyle();
                if (scaledBorderWidth !== undefined) {
                  bs.setWidth(scaledBorderWidth);
                }
                if (f.borderStyle === 'dashed') {
                  bs.dict.set(PDFName.of('S'), PDFName.of('D'));
                  bs.dict.set(PDFName.of('D'), pdfDoc.context.obj([3 * sMin, 3 * sMin]));
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
            if (scaledFontSize) textField.setFontSize(scaledFontSize);
            if (field.readOnly) textField.enableReadOnly();
            if (field.required) textField.enableRequired();
            if (field.multiline) textField.enableMultiline();
            if (field.password) textField.enablePassword();
            if (field.maxLength) textField.setMaxLength(field.maxLength);
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
            const isComposite = vw > 28 * sx && Boolean(field.label);
            const widgetSize = isComposite ? Math.min(vh, 16 * sy) : Math.min(vw, vh);
            const widgetW = isComposite ? widgetSize : vw;
            const widgetH = isComposite ? widgetSize : vh;
            let widgetX = targetX;
            let widgetY = targetY;
            if (isComposite && pageRot === 0) {
              widgetY = targetY + (vh - widgetSize) / 2;
            }

            checkbox.addToPage(page, {
              x: widgetX,
              y: widgetY,
              width: widgetW,
              height: widgetH,
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

            if (isComposite && pageRot === 0 && field.label) {
              const baseFs = field.fontSize && field.fontSize > 0 ? Math.min(field.fontSize, 13) : 11;
              const fontSize = baseFs * sMin;
              const textX = targetX + widgetSize + 6 * sx;
              const textY = targetY + (vh - fontSize) / 2;
              try {
                const font = await pdfDoc.embedStandardFont(StandardFonts.Helvetica);
                let col = rgb(0.067, 0.094, 0.153);
                if (field.color) {
                  const parsed = parseColor(field.color);
                  if (parsed) col = rgb(parsed.r / 255, parsed.g / 255, parsed.b / 255);
                }
                page.drawText(field.label, {
                  x: textX,
                  y: textY,
                  size: fontSize,
                  font,
                  color: col,
                });
              } catch (err) {
                console.warn('Failed to draw checkbox label text:', err);
              }
            }
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

            const isComposite = vw > 28 * sx && Boolean(field.label);
            const widgetSize = isComposite ? Math.min(vh, 16 * sy) : Math.min(vw, vh);
            const widgetW = isComposite ? widgetSize : vw;
            const widgetH = isComposite ? widgetSize : vh;
            let widgetX = targetX;
            let widgetY = targetY;
            if (isComposite && pageRot === 0) {
              widgetY = targetY + (vh - widgetSize) / 2;
            }

            radioGroup.addOptionToPage(uniqueOpt, page, {
              x: widgetX,
              y: widgetY,
              width: widgetW,
              height: widgetH,
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

            if (isComposite && pageRot === 0 && field.label) {
              const baseFs = field.fontSize && field.fontSize > 0 ? Math.min(field.fontSize, 13) : 11;
              const fontSize = baseFs * sMin;
              const textX = targetX + widgetSize + 6 * sx;
              const textY = targetY + (vh - fontSize) / 2;
              try {
                const font = await pdfDoc.embedStandardFont(StandardFonts.Helvetica);
                let col = rgb(0.067, 0.094, 0.153);
                if (field.color) {
                  const parsed = parseColor(field.color);
                  if (parsed) col = rgb(parsed.r / 255, parsed.g / 255, parsed.b / 255);
                }
                page.drawText(field.label, {
                  x: textX,
                  y: textY,
                  size: fontSize,
                  font,
                  color: col,
                });
              } catch (err) {
                console.warn('Failed to draw radio button label text:', err);
              }
            }
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
            if (scaledFontSize) dropdown.setFontSize(scaledFontSize);
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
          } else if (field.variant === 'button') {
            const baseName = resolveAcroFieldName(field);
            const fieldName = getUniqueAcroFieldName(form, baseName, usedFieldNames);
            const button = form.createButton(fieldName);
            button.addToPage(field.label || 'Button', page, {
              x: targetX,
              y: targetY,
              width: vw,
              height: vh,
              rotate: fieldRotationDegrees,
            });
            setTooltip(button.acroField);
            if (field.readOnly) button.enableReadOnly();
            if (field.required) button.enableRequired();
            applyWidgetStyling(button.acroField, field);
          } else if (field.variant === 'signature') {
            const baseName = resolveAcroFieldName(field);
            const fieldName = getUniqueAcroFieldName(form, baseName, usedFieldNames);

            let sigRect: [number, number, number, number];
            if (isCenterRotatedWithPage) {
              sigRect = [targetX, targetY, targetX + vw, targetY + vh];
            } else {
              switch (pageRot) {
                case 0:
                  sigRect = [cropX + vx, cropY + cropH - vy - vh, cropX + vx + vw, cropY + cropH - vy];
                  break;
                case 90:
                  sigRect = [cropX + vy, cropY + vx, cropX + vy + vh, cropY + vx + vw];
                  break;
                case 180:
                  sigRect = [cropX + cropW - vx - vw, cropY + vy, cropX + cropW - vx, cropY + vy + vh];
                  break;
                case 270:
                  sigRect = [cropX + cropW - vy - vh, cropY + cropH - vx - vw, cropX + cropW - vy, cropY + cropH - vx];
                  break;
              }
            }

            const widgetDict = pdfDoc.context.obj({
              Type: PDFName.of('Annot'),
              Subtype: PDFName.of('Widget'),
              FT: PDFName.of('Sig'),
              Rect: sigRect,
              T: PDFString.of(fieldName),
              F: 4,
              P: page.ref,
            });

            if (effectiveRot !== 0) {
              widgetDict.set(
                PDFName.of('MK'),
                pdfDoc.context.obj({
                  R: PDFNumber.of(effectiveRot),
                }),
              );
            }

            if (tooltipText) {
              widgetDict.set(PDFName.of('TU'), PDFHexString.fromText(tooltipText));
            }

            const widgetRef = pdfDoc.context.register(widgetDict);
            page.node.addAnnot(widgetRef);

            const fieldsArray = form.acroForm.dict.lookup(PDFName.of('Fields'));
            const targetFieldsArray: PDFArray = fieldsArray instanceof PDFArray ? fieldsArray : pdfDoc.context.obj([]);
            if (targetFieldsArray !== fieldsArray) {
              form.acroForm.dict.set(PDFName.of('Fields'), targetFieldsArray);
            }
            targetFieldsArray.push(widgetRef);

            const existingSigFlags = form.acroForm.dict.lookup(PDFName.of('SigFlags'));
            const currentFlags = existingSigFlags instanceof PDFNumber ? existingSigFlags.asNumber() : 0;
            form.acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(currentFlags | 1));

            if (field.value && typeof field.value === 'string' && field.value !== '') {
              if (field.value.startsWith('data:image/')) {
                try {
                  const base64Data = field.value.split(',')[1];
                  if (base64Data) {
                    const imgBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
                    const embeddedImg = field.value.includes('image/jpeg') || field.value.includes('image/jpg')
                      ? await pdfDoc.embedJpg(imgBytes)
                      : await pdfDoc.embedPng(imgBytes);
                    const scale = Math.min((vw - 8 * sx) / embeddedImg.width, (vh - 8 * sy) / embeddedImg.height);
                    const drawW = embeddedImg.width * scale;
                    const drawH = embeddedImg.height * scale;
                    page.drawImage(embeddedImg, {
                      x: sigRect[0] + (sigRect[2] - sigRect[0] - drawW) / 2,
                      y: sigRect[1] + (sigRect[3] - sigRect[1] - drawH) / 2,
                      width: drawW,
                      height: drawH,
                    });
                  }
                } catch (err) {
                  console.warn('Failed to embed signature image:', err);
                }
              } else {
                try {
                  const font = await pdfDoc.embedStandardFont(StandardFonts.TimesRomanItalic);
                  const baseFs = Math.max(10, Math.min(vh * 0.45, 18 * sMin));
                  const fontSize = baseFs;
                  page.drawText(field.value, {
                    x: sigRect[0] + 8 * sx,
                    y: sigRect[1] + (sigRect[3] - sigRect[1] - fontSize) / 2,
                    size: fontSize,
                    font,
                    color: rgb(0.1, 0.15, 0.3),
                  });
                } catch (err) {
                  console.warn('Failed to draw text signature:', err);
                }
              }
            }
          } else if (field.variant === 'attachment') {
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
            if (scaledFontSize) textField.setFontSize(scaledFontSize);
            if (field.readOnly) textField.enableReadOnly();
            if (field.required) textField.enableRequired();
            if (field.value !== undefined && field.value !== '') {
              textField.setText(String(field.value));
            } else {
              textField.setText('Attachment');
            }
            applyWidgetStyling(textField.acroField, field);
          }
        }
      }

      // Apply pending file attachments conforming to ISO 32000-2 Associated Files
      if (this.pendingAttachments.length > 0) {
        for (const att of this.pendingAttachments) {
          try {
            await pdfDoc.attach(att.bytes, att.fileName, {
              mimeType: att.mimeType,
              description: att.description,
            });
          } catch (err) {
            console.warn('Failed to embed file attachment into PDF:', err);
          }
        }
      }

      // Apply pending interactive Link annotations conforming to ISO 32000
      if (this.pendingLinkAnnotationsByPage.size > 0) {
        for (const [pageIndex, links] of this.pendingLinkAnnotationsByPage.entries()) {
          if (pageIndex >= pdfDoc.getPageCount()) continue;
          const page = pdfDoc.getPage(pageIndex);
          const cropBox = page.getCropBox() || page.getMediaBox();
          const cropX = cropBox.x ?? 0;
          const cropY = cropBox.y ?? 0;
          const cropW = cropBox.width;
          const cropH = cropBox.height;
          const pageRot = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;

          const transform = getTransform(pageIndex);
          const sx = transform?.scaleX ?? 1;
          const sy = transform?.scaleY ?? 1;

          for (const link of links) {
            const vx = link.x * sx;
            const vy = link.y * sy;
            const vw = link.width * sx;
            const vh = link.height * sy;

            let rect: [number, number, number, number];
            switch (pageRot) {
              case 0:
                rect = [
                  cropX + vx,
                  cropY + cropH - vy - vh,
                  cropX + vx + vw,
                  cropY + cropH - vy,
                ];
                break;
              case 90:
                rect = [
                  cropX + vy,
                  cropY + vx,
                  cropX + vy + vh,
                  cropY + vx + vw,
                ];
                break;
              case 180:
                rect = [
                  cropX + cropW - vx - vw,
                  cropY + vy,
                  cropX + cropW - vx,
                  cropY + vy + vh,
                ];
                break;
              case 270:
                rect = [
                  cropX + cropW - vy - vh,
                  cropY + cropH - vx - vw,
                  cropX + cropW - vy,
                  cropY + cropH - vx,
                ];
                break;
            }

            try {
              let actionDict: { Type: string; S: string; URI?: PDFString; F?: PDFString } | null = null;
              const uriStr = link.uri?.trim();

              if (uriStr && /^https?:\/\//i.test(uriStr)) {
                actionDict = {
                  Type: 'Action',
                  S: 'URI',
                  URI: PDFString.of(uriStr),
                };
              } else if (uriStr && /^(mailto|tel):/i.test(uriStr)) {
                actionDict = {
                  Type: 'Action',
                  S: 'URI',
                  URI: PDFString.of(uriStr),
                };
              } else if (link.fileName) {
                // ISO 32000-1 Clause 12.6.4.5 Launch Action for embedded attachments
                actionDict = {
                  Type: 'Action',
                  S: 'Launch',
                  F: PDFString.of(link.fileName),
                };
              } else if (uriStr && !uriStr.startsWith('blob:')) {
                actionDict = {
                  Type: 'Action',
                  S: 'URI',
                  URI: PDFString.of(uriStr),
                };
              }

              if (actionDict) {
                const annot = pdfDoc.context.obj({
                  Type: 'Annot',
                  Subtype: 'Link',
                  Rect: rect,
                  F: 4, // Print flag per ISO 32000 Table 165
                  H: 'I', // Invert highlight on click per ISO 32000 Table 173
                  Border: [0, 0, 0],
                  BS: {
                    Type: 'Border',
                    W: 0,
                    S: 'S',
                  },
                  P: page.ref,
                  A: actionDict,
                });
                page.node.addAnnot(pdfDoc.context.register(annot));
              }
            } catch (err) {
              console.warn('Failed to add Link annotation:', err);
            }
          }
        }
      }

      if (encryption && mode === 'preserve') {
        const { saveEncryptedPdfDocument } = await import('./encryption/pdf-lib-encryption');
        pdfiumBytes = await saveEncryptedPdfDocument(pdfDoc, encryption);
      } else {
        pdfiumBytes = await pdfDoc.save({ useObjectStreams: false });
      }
    }

    this._cachedAcroFormFieldSpans = null;
    this._acroFormInitPromise = null;
    this.pendingAcroFormFieldsByPage.clear();
    this.pendingLinkAnnotationsByPage.clear();
    this.pendingAttachments = [];
    this.removedAcroFormFieldNames.clear();
    return { bytes: pdfiumBytes, encryption };
  }

  /**
   * Inspects the current document for sensitive metadata, attachments, scripts,
   * annotations, and bookmarks before sanitization.
   *
   * @param pageTransforms Optional active visual transforms to preserve when inspecting.
   * @return A promise resolving to the sanitization inspection summary.
   */
  public async inspectForSanitization(pageTransforms?: Record<number, PageTransform>): Promise<SanitizationInspection> {
    const { inspectPdfForSanitization } = await import('./operations/sanitize-ops');
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
    const { sanitizePdf } = await import('./operations/sanitize-ops');
    const session = await this.saveForRewrite(pageTransforms);
    const { sanitizedBytes, summary } = await sanitizePdf(session.bytes, options);
    return { bytes: await session.seal(sanitizedBytes), summary };
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
    const { inspectPdfForCompression } = await import('./operations/compress-ops');
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
    const { compressPdf } = await import('./operations/compress-ops');
    const session = await this.saveForRewrite(pageTransforms);

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

    const result = await compressPdf(session.bytes, options, pageRasterizer);
    return {
      bytes: await session.seal(result.compressedBytes),
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
    const { signPdfIso32000 } = await import('./operations/signature-ops');
    const { hasPopulatedSignatures } = await import('./operations/signature-revision-ops');
    const encryption = await this.getEncryptionContext();
    let rawBytes = resolveVerbatimPdfBytes(this, pageTransforms) ?? (await this.saveAsync(pageTransforms));
    // note: first signatures rewrite the whole file, so encrypted sources are signed as plaintext
    // and re-encrypted; later signatures append encrypted objects to the original bytes
    if (encryption && !hasPopulatedSignatures(rawBytes)) {
      rawBytes = (await this.saveForRewrite(pageTransforms)).bytes;
    }
    const signedBytes = await signPdfIso32000(rawBytes, options, encryption ?? undefined);
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
    const { verifyPdfSignatures } = await import('./operations/signature-ops');
    const rawBytes = resolveVerbatimPdfBytes(this, pageTransforms) ?? (await this.saveAsync(pageTransforms));
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
    const isInternalBuffer = !rawBuffer || rawBuffer === this._rawBuffer;
    if (isInternalBuffer && this._cachedAcroFormFieldSpans) {
      return this._cachedAcroFormFieldSpans;
    }
    if (isInternalBuffer && this._acroFormInitPromise) {
      return this._acroFormInitPromise;
    }

    const buf = rawBuffer ?? this._rawBuffer;
    if (!buf) {
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
          PDFOptionList,
          PDFSignature,
          PDFButton,
          PDFName,
        } = await import('pdf-lib');

        const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const form = pdfDoc.getForm();
        const fields = form.getFields();

        const pages = pdfDoc.getPages();
        const pageMap = new Map<unknown, number>();
        pages.forEach((p, idx) => pageMap.set(p.ref, idx));

        let annotToPageMap: Map<unknown, number> | null = null;
        function getAnnotToPageMap(): Map<unknown, number> {
          if (!annotToPageMap) {
            annotToPageMap = new Map<unknown, number>();
            for (let p = 0; p < pages.length; p++) {
              const annots = pages[p].node.Annots();
              if (annots) {
                for (let a = 0; a < annots.size(); a++) {
                  const entry = annots.get(a);
                  const lookedUp = annots.lookup(a);
                  if (entry) annotToPageMap.set(entry, p);
                  if (lookedUp) annotToPageMap.set(lookedUp, p);
                }
              }
            }
          }
          return annotToPageMap;
        }

        const byPage = new Map<number, EditableFormFieldSpan[]>();

        for (const field of fields) {
          const name = field.getName();
          let variant: FormFieldVariantType = 'text-input';
          if (field instanceof PDFTextField) variant = 'text-input';
          else if (field instanceof PDFCheckBox) variant = 'checkbox';
          else if (field instanceof PDFRadioGroup) variant = 'radio';
          else if (field instanceof PDFDropdown) variant = 'dropdown';
          else if (field instanceof PDFOptionList) variant = 'dropdown';
          else if (field instanceof PDFSignature) variant = 'signature';
          else if (field instanceof PDFButton) variant = 'button';

          let value: string | boolean | undefined;
          let label: string | undefined;
          if (field instanceof PDFTextField) value = field.getText() || undefined;
          else if (field instanceof PDFCheckBox) value = field.isChecked();
          else if (field instanceof PDFRadioGroup) value = field.getSelected() || undefined;
          else if (field instanceof PDFDropdown) value = field.getSelected()?.[0] || undefined;
          else if (field instanceof PDFOptionList) value = field.getSelected()?.[0] || undefined;
          else if (field instanceof PDFButton) {
            const mk = field.acroField.getWidgets()[0]?.getAppearanceCharacteristics();
            const ca = mk?.dict.lookup(PDFName.of('CA'));
            if (ca && 'decodeText' in ca && typeof (ca as { decodeText(): string }).decodeText === 'function') {
              value = (ca as { decodeText(): string }).decodeText();
            } else if (ca && 'asString' in ca && typeof (ca as { asString(): string }).asString === 'function') {
              value = (ca as { asString(): string }).asString();
            }
            if (typeof value === 'string') {
              label = value;
            }
          }

          if (this._modifiedFormFieldValues.has(name)) {
            value = this._modifiedFormFieldValues.get(name);
          }

          let options: string[] | undefined;
          if (field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList) {
            options = field.getOptions();
          }

          let multiline: boolean | undefined;
          let password: boolean | undefined;
          if (field instanceof PDFTextField) {
            multiline = field.isMultiline();
            password = field.isPassword();
          }

          const readOnly = field.isReadOnly();
          const required = field.isRequired();
          const widgets = field.acroField.getWidgets();

          for (let wIdx = 0; wIdx < widgets.length; wIdx++) {
            const widget = widgets[wIdx];
            const rect = widget.getRectangle();
            const rawFlags = widget.dict.lookup(PDFName.of('F'));
            const flags = typeof (rawFlags as unknown as { asNumber?: () => number })?.asNumber === 'function'
              ? (rawFlags as unknown as { asNumber(): number }).asNumber()
              : (typeof rawFlags === 'number' ? rawFlags : 0);
            if ((flags & 2) !== 0 || (flags & 32) !== 0 || Math.abs(rect.width) <= 0 || Math.abs(rect.height) <= 0) {
              continue;
            }
            if (field instanceof PDFSignature) {
              const hasSignedValue = Boolean(
                field.acroField.dict.lookup(PDFName.of('V')) || widget.dict.lookup(PDFName.of('V'))
              );
              if (hasSignedValue || (flags & 128) !== 0 || (rect.width <= 0 && rect.height <= 0)) {
                continue;
              }
            }
            const pRef = widget.P();
            let pageIndex = pRef ? pageMap.get(pRef) : undefined;
            if (pageIndex === undefined) {
              const map = getAnnotToPageMap();
              const widgetRef = (widget as { ref?: unknown }).ref ?? pdfDoc.context.getObjectRef(widget.dict);
              if (widgetRef && map.has(widgetRef)) {
                pageIndex = map.get(widgetRef);
              } else if (map.has(widget.dict)) {
                pageIndex = map.get(widget.dict);
              }
            }

            if (pageIndex !== undefined) {
              const targetPage = pages[pageIndex];
              const cropBox = targetPage.getCropBox?.() || targetPage.getMediaBox?.() || { x: 0, y: 0, width: targetPage.getWidth?.() ?? 612, height: targetPage.getHeight?.() ?? 792 };
              const cropX = cropBox.x ?? 0;
              const cropY = cropBox.y ?? 0;
              const cropW = cropBox.width;
              const cropH = cropBox.height;
              const pageRotation = (((targetPage?.getRotation?.()?.angle ?? 0) % 360 + 360) % 360) as 0 | 90 | 180 | 270;

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
              const widgetRot = (((mk?.getRotation?.() || 0) % 360) + 360) % 360;
              if (widgetRot !== 0 && widgetRot !== pageRotation) {
                rotation = ((rotation + widgetRot) % 360 + 360) % 360;
              }

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

              let fontSize: number | undefined;
              let fontFamily: string | undefined;
              let color: string | undefined;
              try {
                const daEntry = widget.dict.lookup(PDFName.of('DA'))
                  || field.acroField.dict.lookup(PDFName.of('DA'))
                  || form.acroForm.dict.lookup(PDFName.of('DA'));
                let daStr = '';
                if (daEntry && 'decodeText' in daEntry && typeof (daEntry as { decodeText(): string }).decodeText === 'function') {
                  daStr = (daEntry as { decodeText(): string }).decodeText();
                } else if (daEntry && 'asString' in daEntry && typeof (daEntry as { asString(): string }).asString === 'function') {
                  daStr = (daEntry as { asString(): string }).asString();
                }
                if (daStr) {
                  const tfMatch = /\/([A-Za-z0-9_+-]+)\s+([0-9.]+)\s+Tf/.exec(daStr);
                  if (tfMatch) {
                    const rawFontName = tfMatch[1].toLowerCase();
                    const rawFontSize = parseFloat(tfMatch[2]);
                    if (rawFontSize > 0) {
                      fontSize = rawFontSize;
                    }
                    if (rawFontName.includes('cour')) fontFamily = 'Courier';
                    else if (rawFontName.includes('time') || rawFontName.includes('tiro')) fontFamily = 'Times-Roman';
                    else fontFamily = 'Helvetica';
                  }
                  const rgMatch = /([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+rg/.exec(daStr);
                  if (rgMatch) {
                    color = `rgb(${Math.round(parseFloat(rgMatch[1]) * 255)}, ${Math.round(parseFloat(rgMatch[2]) * 255)}, ${Math.round(parseFloat(rgMatch[3]) * 255)})`;
                  } else {
                    const gMatch = /([0-9.]+)\s+g/.exec(daStr);
                    if (gMatch) {
                      const g = Math.round(parseFloat(gMatch[1]) * 255);
                      color = `rgb(${g}, ${g}, ${g})`;
                    }
                  }
                }
              } catch {
                // Ignore DA parsing errors and fall back to standard defaults
              }

              let maxLength: number | undefined;
              let isComb: boolean | undefined;
              let doNotSpellCheck: boolean | undefined;
              let doNotScroll: boolean | undefined;

              if (field instanceof PDFTextField) {
                const ml = field.getMaxLength();
                if (typeof ml === 'number' && ml > 0) maxLength = ml;
              } else if (field.acroField) {
                const maxLenEntry = field.acroField.dict.get(PDFName.of('MaxLen'));
                if (maxLenEntry) {
                  const mlNum = Number(maxLenEntry);
                  if (!Number.isNaN(mlNum) && mlNum > 0) maxLength = mlNum;
                }
              }

              const rawFf = (field as { acroField?: { getFlags?: () => number } }).acroField?.getFlags?.() ?? 0;
              if ((rawFf & 16777216) !== 0 && maxLength && maxLength > 0 && !multiline) {
                isComb = true;
              }
              if ((rawFf & 4194304) !== 0) {
                doNotSpellCheck = true;
              }
              if ((rawFf & 8388608) !== 0) {
                doNotScroll = true;
              }

              const exportValue = (field instanceof PDFRadioGroup && options && wIdx < options.length)
                ? options[wIdx]
                : (widget.getOnValue?.()?.decodeText?.() || undefined);

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
                label,
                options,
                exportValue,
                multiline,
                password,
                fontSize,
                fontFamily,
                color,
                readOnly,
                required,
                backgroundColor,
                borderColor,
                borderWidth,
                borderStyle,
                textAlign,
                maxLength,
                isComb,
                combCellCount: isComb ? maxLength : undefined,
                doNotSpellCheck,
                doNotScroll,
              });
            }
          }
        }

        if (isInternalBuffer && this._pageRotationDeltas.size > 0) {
          for (const [rotPageIdx, rotInfo] of this._pageRotationDeltas.entries()) {
            const spans = byPage.get(rotPageIdx);
            if (!spans || spans.length === 0) continue;
            const rotatedSpans = spans.map((span) => {
              const cx = span.left + span.width / 2;
              const cy = span.top + span.height / 2;
              const newCenter = transformPointForPageRotation(
                { x: cx, y: cy },
                rotInfo.delta,
                rotInfo.initialWidthPts,
                rotInfo.initialHeightPts,
              );
              return {
                ...span,
                left: Math.round((newCenter.x - span.width / 2) * 10) / 10,
                top: Math.round((newCenter.y - span.height / 2) * 10) / 10,
                rotation: (((span.rotation || 0) + rotInfo.delta) % 360 + 360) % 360,
              };
            });
            byPage.set(rotPageIdx, rotatedSpans);
          }
        }

        this._cachedAcroFormFieldSpans = byPage;
        for (const [pageIdx, pageSpans] of this._pageSpansCache.entries()) {
          pageSpans.formFields = byPage.get(pageIdx) || [];
        }
        return byPage;
      } catch (err) {
        console.warn('Failed to extract AcroForm fields with pdf-lib:', err);
        const fallback = new Map<number, EditableFormFieldSpan[]>();
        this._cachedAcroFormFieldSpans = fallback;
        return fallback;
      } finally {
        this._acroFormInitPromise = null;
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
      this.initAcroFormFieldSpans().catch((err: unknown) => {
        console.warn('Lazy AcroForm extraction error:', err);
      });
    }

    try {
      const page = this.getPage(pageIndex);
      const dims = typeof page.getDimensions === 'function' ? page.getDimensions() : { widthPts: 612, heightPts: 792 };
      const cropInfo: PageCropInfo = typeof page.getCropInfo === 'function'
        ? page.getCropInfo()
        : {
            cropLeft: 0,
            cropBottom: 0,
            cropRight: dims.widthPts,
            cropTop: dims.heightPts,
            cropWidth: dims.widthPts,
            cropHeight: dims.heightPts,
            rotation: 0,
            hasCrop: false,
            hasCropBox: false,
            domCropLeft: 0,
            domCropTop: 0,
            marginLeft: 0,
            marginBottom: 0,
            marginRight: 0,
            marginTop: 0,
          };

      const mod = this.engine?.getModule?.();
      if (typeof mod?.FPDFPage_GetAnnotCount === 'function') {
        const formHandle = this.getFormHandle();
        if (formHandle && page.pageHandle) {
          this.engine.pageFormAfterLoad(page.pageHandle, formHandle);
        }

        const annotCount = mod.FPDFPage_GetAnnotCount(page.pageHandle);
        const rectPtr = this.engine.allocateMemory(16);
        const widgetSpans: EditableFormFieldSpan[] = [];
        const nameWidgetCounts = new Map<string, number>();

        try {
          for (let i = 0; i < annotCount; i++) {
            const annotHandle = mod.FPDFPage_GetAnnot(page.pageHandle, i);
            if (!annotHandle) continue;

            try {
              const subtypeCode = mod.FPDFAnnot_GetSubtype(annotHandle);
              if (subtypeCode !== 20) continue;

              const annotFlags = typeof mod.FPDFAnnot_GetFlags === 'function'
                ? mod.FPDFAnnot_GetFlags(annotHandle)
                : 0;

              if ((annotFlags & 2) !== 0 || (annotFlags & 32) !== 0) {
                continue;
              }

              mod.FPDFAnnot_GetRect(annotHandle, rectPtr);
              const heap = mod.pdfium.HEAPF32;
              const rLeft = heap[rectPtr >> 2] || 0;
              const rTop = heap[(rectPtr >> 2) + 1] || 0;
              const rRight = heap[(rectPtr >> 2) + 2] || 0;
              const rBottom = heap[(rectPtr >> 2) + 3] || 0;

              const pdfXMin = Math.min(rLeft, rRight);
              const pdfXMax = Math.max(rLeft, rRight);
              const pdfYMin = Math.min(rTop, rBottom);
              const pdfYMax = Math.max(rTop, rBottom);

              const w = pdfXMax - pdfXMin;
              const h = pdfYMax - pdfYMin;
              if (w <= 0 || h <= 0) {
                continue;
              }

              const pageRotation = (cropInfo.rotation * 90) % 360;
              const domBounds = pdfBoxToDomBounds(pdfXMin, pdfYMin, pdfXMax, pdfYMax, cropInfo);
              const unrotW = Math.round((pdfXMax - pdfXMin) * 10) / 10;
              const unrotH = Math.round((pdfYMax - pdfYMin) * 10) / 10;

              let left = Math.round(domBounds.left * 10) / 10;
              let top = Math.round(domBounds.top * 10) / 10;
              let width = Math.round((domBounds.right - domBounds.left) * 10) / 10;
              let height = Math.round((domBounds.bottom - domBounds.top) * 10) / 10;
              let rotation = 0;

              if (pageRotation !== 0) {
                const centerX = (domBounds.left + domBounds.right) / 2;
                const centerY = (domBounds.top + domBounds.bottom) / 2;
                width = unrotW;
                height = unrotH;
                left = Math.round((centerX - width / 2) * 10) / 10;
                top = Math.round((centerY - height / 2) * 10) / 10;
                rotation = pageRotation;
              }

              const rawFormType = formHandle && typeof mod.FPDFAnnot_GetFormFieldType === 'function'
                ? mod.FPDFAnnot_GetFormFieldType(formHandle, annotHandle)
                : -1;

              if (rawFormType === 7 && (width <= 0 || height <= 0 || (annotFlags & 128) !== 0)) {
                continue;
              }

              let variant: FormFieldVariantType = 'text-input';
              if (rawFormType === 1) variant = 'button';
              else if (rawFormType === 2) variant = 'checkbox';
              else if (rawFormType === 3) variant = 'radio';
              else if (rawFormType === 4 || rawFormType === 5) variant = 'dropdown';
              else if (rawFormType === 7) variant = 'signature';

              const readUtf16 = (fn: (...args: number[]) => number, ...args: number[]): string => {
                if (typeof fn !== 'function') return '';
                const req = fn(...args, 0, 0);
                if (req <= 2) return '';
                const ptr = this.engine.allocateMemory(req);
                try {
                  fn(...args, ptr, req);
                  const u8 = new Uint8Array(mod.pdfium.HEAPU8.buffer, ptr, req - 2);
                  let str = '';
                  for (let b = 0; b < u8.length; b += 2) {
                    const ch = u8[b] | (u8[b + 1] << 8);
                    if (ch !== 0) str += String.fromCharCode(ch);
                  }
                  return str;
                } finally {
                  this.engine.freeMemory(ptr);
                }
              };

              const fieldName = formHandle ? readUtf16(mod.FPDFAnnot_GetFormFieldName, formHandle, annotHandle) : '';
              const finalName = fieldName || `widget_${i}`;
              const wIdx = nameWidgetCounts.get(finalName) || 0;
              nameWidgetCounts.set(finalName, wIdx + 1);

              let rawValue: string | boolean | undefined;

              if (formHandle && typeof mod.FPDFAnnot_GetFormFieldValue === 'function') {
                const valStr = readUtf16(mod.FPDFAnnot_GetFormFieldValue, formHandle, annotHandle);
                if (valStr) rawValue = valStr;
              }

              let exportValue: string | undefined;
              if (formHandle && typeof mod.FPDFAnnot_GetFormFieldExportValue === 'function') {
                const expStr = readUtf16(mod.FPDFAnnot_GetFormFieldExportValue, formHandle, annotHandle);
                if (expStr) exportValue = expStr;
              }

              if (variant === 'checkbox' && formHandle && typeof mod.FPDFAnnot_IsChecked === 'function') {
                rawValue = Boolean(mod.FPDFAnnot_IsChecked(formHandle, annotHandle));
              }

              if (this._modifiedFormFieldValues.has(finalName)) {
                rawValue = this._modifiedFormFieldValues.get(finalName);
              }

              let options: string[] | undefined;
              if (formHandle && (variant === 'dropdown' || variant === 'radio') && typeof mod.FPDFAnnot_GetOptionCount === 'function') {
                const optCount = mod.FPDFAnnot_GetOptionCount(formHandle, annotHandle);
                if (optCount > 0 && typeof mod.FPDFAnnot_GetOptionLabel === 'function') {
                  options = [];
                  for (let o = 0; o < optCount; o++) {
                    options.push(readUtf16(mod.FPDFAnnot_GetOptionLabel, formHandle, annotHandle, o));
                  }
                }
              }

              const fieldFlags = formHandle && typeof mod.FPDFAnnot_GetFormFieldFlags === 'function'
                ? mod.FPDFAnnot_GetFormFieldFlags(formHandle, annotHandle)
                : 0;

              const readOnly = (fieldFlags & 1) !== 0;
              const required = (fieldFlags & 2) !== 0;
              const multiline = variant === 'text-input' ? (fieldFlags & 4096) !== 0 : undefined;
              const password = variant === 'text-input' ? (fieldFlags & 8192) !== 0 : undefined;
              const doNotSpellCheck = (fieldFlags & 4194304) !== 0;
              const doNotScroll = (fieldFlags & 8388608) !== 0;
              const isComb = (fieldFlags & 16777216) !== 0;

              widgetSpans.push({
                id: `form_field_${pageIndex}_${finalName}_${wIdx}`,
                type: 'form-field',
                pageIndex,
                fieldId: finalName,
                fieldName: finalName,
                variant,
                left,
                top,
                width,
                height,
                rotation,
                value: rawValue,
                exportValue,
                options,
                multiline,
                password,
                readOnly,
                required,
                isComb,
                doNotSpellCheck,
                doNotScroll,
              });
            } finally {
              mod.FPDFPage_CloseAnnot(annotHandle);
            }
          }
        } finally {
          this.engine.freeMemory(rectPtr);
        }

        return widgetSpans;
      }

      if (typeof page.getAnnotations === 'function') {
        const annots = page.getAnnotations();
        const widgetSpans: EditableFormFieldSpan[] = [];
        const pageRotation = (cropInfo.rotation * 90) % 360;
        let idx = 0;
        for (const annot of annots) {
          if (annot.subtype === 'Widget') {
            const pdfXMin = Math.min(annot.rect.left, annot.rect.right);
            const pdfXMax = Math.max(annot.rect.left, annot.rect.right);
            const pdfYMin = Math.min(annot.rect.bottom, annot.rect.top);
            const pdfYMax = Math.max(annot.rect.bottom, annot.rect.top);
            const unrotW = Math.round((pdfXMax - pdfXMin) * 10) / 10;
            const unrotH = Math.round((pdfYMax - pdfYMin) * 10) / 10;
            const domBounds = pdfBoxToDomBounds(pdfXMin, pdfYMin, pdfXMax, pdfYMax, cropInfo);
            let left = Math.round(domBounds.left * 10) / 10;
            let top = Math.round(domBounds.top * 10) / 10;
            let width = Math.round((domBounds.right - domBounds.left) * 10) / 10;
            let height = Math.round((domBounds.bottom - domBounds.top) * 10) / 10;
            let rotation = 0;
            if (pageRotation !== 0) {
              const centerX = (domBounds.left + domBounds.right) / 2;
              const centerY = (domBounds.top + domBounds.bottom) / 2;
              width = unrotW;
              height = unrotH;
              left = Math.round((centerX - width / 2) * 10) / 10;
              top = Math.round((centerY - height / 2) * 10) / 10;
              rotation = pageRotation;
            }
            const fieldName = annot.contents && annot.contents !== '(No text content)' ? annot.contents : `Field ${idx + 1}`;
            const modifiedValue = this._modifiedFormFieldValues.get(fieldName);
            widgetSpans.push({
              id: `form_field_${pageIndex}_widget_${idx}`,
              type: 'form-field',
              pageIndex,
              fieldId: `widget_${idx}`,
              fieldName,
              variant: 'text-input',
              left,
              top,
              width,
              height,
              rotation,
              value: modifiedValue,
            });
            idx++;
          }
        }
        return widgetSpans;
      }

      return [];
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
    const { baselineY, ...rest } = targetSpan;
    this.replaceTextSpan(pageIndex, targetSpan, {
      ...rest,
      left,
      top,
    });
  }

  public deleteTextSpan(pageIndex: number, targetSpan: EditableTextSpan, options: { reflowDownstream?: boolean } = {}): void {
    const page = this.getPage(pageIndex);
    page.deleteTextSpan(targetSpan, options);
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
    const mod = this.engine?.getModule?.();
    const prevRotCode =
      page.pageHandle && typeof mod?.FPDFPage_GetRotation === 'function'
        ? mod.FPDFPage_GetRotation(page.pageHandle)
        : 0;
    const prevAngle = (((prevRotCode * 90) % 360) + 360) % 360;
    const existingRot = this._pageRotationDeltas.get(pageIndex);
    const initialWidthPts = existingRot ? existingRot.initialWidthPts : prevDims.widthPts;
    const initialHeightPts = existingRot ? existingRot.initialHeightPts : prevDims.heightPts;
    const initialAngle = existingRot ? existingRot.initialAngle : prevAngle;
    const nextDelta = (((existingRot ? existingRot.delta : 0) + degreesDelta) % 360 + 360) % 360;
    const expectedAngle = (((initialAngle + nextDelta) % 360) + 360) % 360;
    if (nextDelta === 0) {
      this._pageRotationDeltas.delete(pageIndex);
    } else {
      this._pageRotationDeltas.set(pageIndex, {
        delta: nextDelta as 90 | 180 | 270,
        initialWidthPts,
        initialHeightPts,
        initialAngle,
        expectedAngle,
      });
    }

    page.rotate(degreesDelta);
    this._isPdfiumDirty = true;
    try {
      this._pageDimensionsCache.set(pageIndex, page.getDimensions());
    } catch {
      this._pageDimensionsCache.delete(pageIndex);
    }
    this._pageSpansCache.delete(pageIndex);

    if (this._cachedAcroFormFieldSpans?.has(pageIndex)) {
      const spans = this._cachedAcroFormFieldSpans.get(pageIndex);
      if (spans) {
        const nextSpans = spans.map((span) => {
          const cx = span.left + span.width / 2;
          const cy = span.top + span.height / 2;
          const newCenter = transformPointForPageRotation(
            { x: cx, y: cy },
            degreesDelta,
            prevDims.widthPts,
            prevDims.heightPts,
          );
          return {
            ...span,
            left: Math.round((newCenter.x - span.width / 2) * 10) / 10,
            top: Math.round((newCenter.y - span.height / 2) * 10) / 10,
            rotation: (((span.rotation || 0) + degreesDelta) % 360 + 360) % 360,
          };
        });
        this._cachedAcroFormFieldSpans.set(pageIndex, nextSpans);
      }
    }

    if (this.pendingAcroFormFieldsByPage.has(pageIndex)) {
      const pendingFields = this.pendingAcroFormFieldsByPage.get(pageIndex);
      if (pendingFields) {
        const nextFields = pendingFields.map((field) => {
          const cx = field.x + field.width / 2;
          const cy = field.y + field.height / 2;
          const newCenter = transformPointForPageRotation(
            { x: cx, y: cy },
            degreesDelta,
            prevDims.widthPts,
            prevDims.heightPts,
          );
          return {
            ...field,
            x: Math.round((newCenter.x - field.width / 2) * 10) / 10,
            y: Math.round((newCenter.y - field.height / 2) * 10) / 10,
            rotation: (((field.rotation || 0) + degreesDelta) % 360 + 360) % 360,
          };
        });
        this.pendingAcroFormFieldsByPage.set(pageIndex, nextFields);
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

    if (this.engine.isReady) {
      try {
        const mod = this.engine.getModule();
        if (typeof mod.FPDF_GetPageSizeByIndex === 'function') {
          const scratch = this.getDimScratch();
          if (scratch) {
            const docHandle = this.getDocHandle();
            const widthPtr = scratch;
            const heightPtr = scratch + 8;
            const ok = mod.FPDF_GetPageSizeByIndex(docHandle, pageIndex, widthPtr, heightPtr);
            if (ok) {
              const widthPts = new Float64Array(mod.pdfium.HEAPF64.buffer, widthPtr, 1)[0];
              const heightPts = new Float64Array(mod.pdfium.HEAPF64.buffer, heightPtr, 1)[0];
              if (widthPts > 0 && heightPts > 0) {
                const dims = { widthPts, heightPts };
                this._pageDimensionsCache.set(pageIndex, dims);
                return dims;
              }
            }
          }
        }
      } catch {
        // Safe fallback to loading page directly
      }
    }

    const page = this.getPage(pageIndex);
    const dims = page.getDimensions();
    this._pageDimensionsCache.set(pageIndex, dims);
    return dims;
  }

  /**
   * Retrieves dimensions for all pages in the document.
   * Leverages fast zero-load dimension resolution.
   *
   * @return Array of page dimensions indexed by page number.
   */
  public getAllPageDimensions(): Array<{ widthPts: number; heightPts: number }> {
    const count = this.getPageCount();
    const result: Array<{ widthPts: number; heightPts: number }> = new Array(count);
    for (let i = 0; i < count; i++) {
      result[i] = this.getPageDimensions(i);
    }
    return result;
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
   * Retrieves the memoised document typography profile, if available.
   */
  public getCachedTypographyProfile(): DocumentTypographyProfile | null {
    return this._cachedTypographyProfile;
  }

  /**
   * Stores the memoised document typography profile.
   *
   * @param profile Computed document typography profile or null.
   */
  public setCachedTypographyProfile(profile: DocumentTypographyProfile | null): void {
    this._cachedTypographyProfile = profile;
  }

  /**
   * Clears memoised overlay spans for a specific page or the entire document.
   *
   * @param pageIndex Optional zero-based page index. Clears all pages if omitted.
   */
  public clearCachedPageSpans(pageIndex?: number): void {
    this._cachedTypographyProfile = null;
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

  /**
   * Apply page numbering, Bates numbering, or running header/footer text across document pages.
   *
   * @param options Configuration for numbering mode, page scope, position, and typography.
   * @param metadata Optional metadata context for {file} and {date} tokens.
   * @return Summary of stamped page indices and generated labels.
   */
  public applyPageNumbering(
    options: PageNumberingOptions,
    metadata?: { fileName?: string; dateStr?: string }
  ): PageNumberingResult {
    this._isPdfiumDirty = true;
    this.closeAllPages();
    const result = runPageNumberingOp(this.engine, this.getDocHandle(), options, {
      fileName: metadata?.fileName,
      dateStr: metadata?.dateStr,
      charsetIndex: this._fontCharsetIndex,
    });
    for (const pageIdx of result.stampedPageIndices) {
      this._pageSpansCache.delete(pageIdx);
      this._fontCharsetIndex.invalidatePage(pageIdx);
    }
    this._cachedTypographyProfile = null;
    return result;
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
    this._cachedTypographyProfile = null;
    this._fontCharsetIndex.invalidate();
  }

}
