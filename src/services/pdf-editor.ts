import { PdfiumEngine } from '../core/pdfium-engine';
import { PdfDocument } from './pdf/pdf-document';
import type { CanvasElement } from '../stores/canvas-types';
import type { PageTransform } from '../stores/types';
import type {
  SanitizeOptions,
  SanitizeSummary,
  SanitizationInspection,
  CompressOptions,
  CompressSummary,
  CompressionInspection,
  DocumentMetadata,
  DocumentMetadataUpdate,
  EditableTextSpan,
} from '../core/types';
import type { SignPdfOptions, SignatureValidationResult } from './pdf/operations/signature-ops';
import type { WorkspaceFile } from '../stores/editor.svelte';
import { deleteFileBuffer, clearAllFileBuffers } from '../stores/editor.svelte';
import type { ElementRegistry, BurnContext } from '../core/element-registry';
import type { UnlockFormsResult } from './pdf/operations/form-ops';
import type { SecurityOptions } from './pdf/operations/security-ops';

/**
 * Manages the PDF editor workspace and provides direct access to the PdfDocument facade.
 */
export class PdfEditorService {
  public readonly engine: PdfiumEngine;
  private _workspaceFiles: WorkspaceFile[];
  private _document: PdfDocument | null = null;
  private _elementRegistry: ElementRegistry | null = null;
  private _isEncryptionPreservationEnabled: () => boolean = () => true;

  constructor(
    workspaceFilesRef: WorkspaceFile[] = [],
    elementRegistry?: ElementRegistry,
    engine?: PdfiumEngine
  ) {
    this.engine = engine ?? PdfiumEngine.getInstance();
    this._workspaceFiles = workspaceFilesRef;
    if (elementRegistry) {
      this._elementRegistry = elementRegistry;
    }
  }

  /**
   * Sets or updates the active element registry used for element serialization.
   */
  public setElementRegistry(registry: ElementRegistry): void {
    this._elementRegistry = registry;
  }

  /**
   * Provides direct access to the active PDF document facade.
   * Returns a cached PdfDocument instance bound to the current engine state.
   */
  public get document(): PdfDocument {
    if (!this._document) {
      this._document = new PdfDocument(this.engine);
    }
    return this._document;
  }

  /**
   * Initializes the underlying PDFium engine.
   */
  public async initialize(): Promise<void> {
    await this.engine.initialize();
  }

  /**
   * Loads a PDF document from an ArrayBuffer into the active engine.
   * @param buffer The ArrayBuffer containing the PDF document.
   * @param password Optional password for opening encrypted documents.
   */
  public loadDocumentFromBuffer(buffer: ArrayBuffer, password: string = ''): void {
    if (this._document) {
      this._document.closeAllPages();
    }
    this._document = null;
    this.engine.loadDocumentFromBuffer(buffer, password);
    this.document.setRawBuffer(buffer);
    this.document.setSecurityCredential(password);
    this.document.setEncryptionPreservationResolver(this._isEncryptionPreservationEnabled);
  }

  /**
   * Reloads a serialisation of the active document, reusing the password that unlocked it
   * so encrypted documents reopen after rewrites, rollbacks and temporary export passes.
   *
   * @param buffer Bytes derived from the active document.
   */
  public reloadDocumentFromBuffer(buffer: ArrayBuffer): void {
    this.loadDocumentFromBuffer(buffer, this._document?.getSecurityCredential() ?? '');
  }

  /**
   * Installs the predicate deciding whether encrypted documents keep their encryption
   * across pdf-lib rewrites (wired to the 'security.preserve-encryption' feature flag).
   *
   * @param resolver Predicate evaluated lazily on every rewrite.
   */
  public setEncryptionPreservationResolver(resolver: () => boolean): void {
    this._isEncryptionPreservationEnabled = resolver;
    this._document?.setEncryptionPreservationResolver(resolver);
  }

  /**
   * Unlocks AcroForm interactive form fields and widget annotations.
   */
  public async unlockAcroFormFields(bytes: Uint8Array): Promise<UnlockFormsResult> {
    const { unlockAcroFormFields } = await import('./pdf/operations/form-ops');
    return unlockAcroFormFields(bytes);
  }

  /**
   * Applies ISO 32000 standard encryption and access permissions to the active document.
   */
  public applyPasswordSecurity(options: SecurityOptions): { success: boolean; isEncrypted: boolean; permissions: number } {
    return this.document.applySecurity(options);
  }

  /**
   * Removes encryption and security restrictions from the active document.
   */
  public removePasswordSecurity(ownerPassword?: string): { success: boolean } {
    return this.document.removeSecurity(ownerPassword);
  }

  /**
   * Authenticates with owner password to unlock administrative permissions.
   */
  public unlockOwnerPermissions(ownerPassword: string): boolean {
    return this.document.unlockOwnerPermissions(ownerPassword);
  }

  /**
   * Adds a file to the active workspace.
   */
  public addFile(file: WorkspaceFile): void {
    this._workspaceFiles.push(file);
  }

  /**
   * Retrieves a file from the workspace by its unique ID.
   */
  public getFile(id: string): WorkspaceFile | undefined {
    return this._workspaceFiles.find(f => f.id === id);
  }

  /**
   * Removes a file from the workspace.
   */
  public removeFile(id: string): void {
    const index = this._workspaceFiles.findIndex(f => f.id === id);
    if (index !== -1) {
      this._workspaceFiles.splice(index, 1);
      deleteFileBuffer(id);
    }
  }

  /**
   * Reorders files within the workspace.
   */
  public reorderFiles(fromIndices: number[], toIndex: number): void {
    if (fromIndices.length === 0 || toIndex < 0 || toIndex > this._workspaceFiles.length) return;
    
    const sortedFrom = Array.from(new Set(fromIndices)).sort((a, b) => a - b);
    const movedFiles = sortedFrom.map(i => this._workspaceFiles[i]);
    
    // Adjust target index to account for elements removed before it.
    const adjustedToIndex = toIndex - sortedFrom.filter(i => i < toIndex).length;
    
    for (let i = sortedFrom.length - 1; i >= 0; i--) {
        this._workspaceFiles.splice(sortedFrom[i], 1);
    }
    
    this._workspaceFiles.splice(adjustedToIndex, 0, ...movedFiles);
  }

  /**
   * Clears all files from the workspace and releases WASM document resources.
   */
  public clearWorkspace(): void {
    if (this._document) {
      this._document.dispose();
    }
    this.engine.closeCurrentDocument();
    this._document = null;
    this._workspaceFiles.length = 0;
    clearAllFileBuffers();
  }

  /**
   * Serializes canvas overlay elements onto the active PDF pages using registered element definitions.
   *
   * @param elements Array of CanvasElements to burn.
   */
  public async burnElementsToDocument(elements: CanvasElement[]): Promise<void> {
    if (elements.length === 0) return;

    const byPage = new Map<number, CanvasElement[]>();
    for (const el of elements) {
      if (!byPage.has(el.pageIndex)) byPage.set(el.pageIndex, []);
      byPage.get(el.pageIndex)!.push(el);
    }

    const doc = this.document;

    for (const [pageIndex, pageElements] of byPage.entries()) {
      if (pageIndex >= doc.getPageCount()) continue;
      const page = doc.getPage(pageIndex);
      const dims = page.getDimensions();
      const burnCtx: BurnContext = {
        page,
        document: doc,
        pageWidth: dims.widthPts,
        pageHeight: dims.heightPts,
      };

      let backInsertCursor = 0;

      const sortedPageElements = pageElements
        .map((el, idx) => ({ el, idx }))
        .sort((a, b) => {
          const zA = a.el.zIndex ?? 21;
          const zB = b.el.zIndex ?? 21;
          if (zA !== zB) return zA - zB;
          return a.idx - b.idx;
        })
        .map((entry) => entry.el);

      for (const el of sortedPageElements) {
        if (this._elementRegistry && this._elementRegistry.has(el.kind)) {
          const def = this._elementRegistry.get(el.kind);
          try {
            const isBackBand =
              typeof el.zIndex === 'number' &&
              el.zIndex < 10 &&
              typeof page.reorderObject === 'function';
            let burnTarget: CanvasElement = el;
            if (
              isBackBand &&
              el.kind === 'text' &&
              el.originalSpan &&
              typeof page.deleteTextSpan === 'function'
            ) {
              try {
                page.deleteTextSpan(el.originalSpan as unknown as EditableTextSpan, { reflowDownstream: false });
                burnTarget = { ...el, originalSpan: undefined };
              } catch {
                // Best-effort cleanup prior to measuring object count
              }
            }

            const countBefore = typeof page.getObjectCount === 'function' ? page.getObjectCount() : 0;
            await def.burn(burnTarget, burnCtx);
            const countAfter = typeof page.getObjectCount === 'function' ? page.getObjectCount() : 0;

            if (isBackBand && countAfter > countBefore) {
              for (let objIdx = countBefore; objIdx < countAfter; objIdx++) {
                if (page.reorderObject(objIdx, backInsertCursor)) {
                  backInsertCursor++;
                }
              }
            }
          } catch (e) {
            console.error(`Failed to burn element ${el.id}:`, e);
          }
        }
      }
    }
  }

  /**
   * Bakes arbitrary UI-drawn CanvasElements and page transforms into the active PDF document stream.
   * This bridges the gap between the interactive frontend UI and the low-level PDFium backend.
   */
  public async applyCanvasElementsToPdf(elements: CanvasElement[], pageTransforms?: Record<number, PageTransform>): Promise<void> {
    if (elements.length === 0 && (!pageTransforms || Object.keys(pageTransforms).length === 0)) return;

    await this.burnElementsToDocument(elements);

    const doc = this.document;
    const finalBytes = await doc.saveAsync(pageTransforms);
    const bufferArray = finalBytes.buffer.slice(finalBytes.byteOffset, finalBytes.byteOffset + finalBytes.byteLength) as ArrayBuffer;
    this.reloadDocumentFromBuffer(bufferArray);
  }

  /**
   * Inspects the active document for sensitive metadata and artifacts before sanitization.
   *
   * @param pageTransforms Optional active visual transforms.
   * @return A promise resolving to the inspection summary.
   */
  public async inspectActiveDocumentForSanitization(
    pageTransforms?: Record<number, PageTransform>
  ): Promise<SanitizationInspection> {
    return this.document.inspectForSanitization(pageTransforms);
  }

  /**
   * Sanitizes the active PDF document in-place, purging selected sensitive data
   * and reloading the sanitized stream into the WASM engine.
   *
   * @param options The sanitization flags to apply.
   * @param pageTransforms Optional active visual transforms.
   * @return A promise resolving to the summary of purged items.
   */
  public async sanitizeActiveDocument(
    options: SanitizeOptions,
    pageTransforms?: Record<number, PageTransform>
  ): Promise<SanitizeSummary> {
    const { bytes, summary } = await this.document.sanitize(options, pageTransforms);
    const bufferArray = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    this.reloadDocumentFromBuffer(bufferArray);
    return summary;
  }

  /**
   * Generates a sanitized copy of the active PDF as binary bytes without
   * replacing the active document in the engine.
   *
   * @param options The sanitization flags to apply.
   * @param pageTransforms Optional active visual transforms.
   * @return A promise resolving to the clean bytes and removal summary.
   */
  public async sanitizeToBytes(
    options: SanitizeOptions,
    pageTransforms?: Record<number, PageTransform>
  ): Promise<{ bytes: Uint8Array; summary: SanitizeSummary }> {
    return this.document.sanitize(options, pageTransforms);
  }

  /**
   * Compresses the active PDF document in-place, applying compression
   * settings and reloading the compressed stream into the WASM engine.
   *
   * @param options The compression preset and options to apply.
   * @param pageTransforms Optional active visual transforms.
   * @return A promise resolving to the compression summary.
   */
  public async compressActiveDocument(
    options: CompressOptions,
    pageTransforms?: Record<number, PageTransform>
  ): Promise<CompressSummary> {
    const { bytes, summary } = await this.document.compress(options, pageTransforms);
    const bufferArray = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    this.reloadDocumentFromBuffer(bufferArray);
    return summary;
  }

  /**
   * Generates a compressed copy of the active PDF as binary bytes without
   * replacing the active document in the engine.
   *
   * @param options The compression preset and options to apply.
   * @param pageTransforms Optional active visual transforms.
   * @return A promise resolving to the compressed bytes and savings summary.
   */
  public async compressToBytes(
    options: CompressOptions,
    pageTransforms?: Record<number, PageTransform>
  ): Promise<{ bytes: Uint8Array; summary: CompressSummary }> {
    return this.document.compress(options, pageTransforms);
  }

  /**
   * Inspects the active document for compression characteristics.
   *
   * @param pageTransforms Optional active visual transforms.
   * @return A promise resolving to compression inspection details.
   */
  public async inspectCompression(
    pageTransforms?: Record<number, PageTransform>
  ): Promise<CompressionInspection> {
    return this.document.inspectCompression(pageTransforms);
  }

  /**
   * Updates document metadata and custom dictionary properties,
   * reloading the modified PDF into the engine.
   *
   * @param updates The metadata fields and custom tags to update.
   * @return A promise resolving to the updated PDF bytes and metadata.
   */
  public async updateDocumentMetadata(
    updates: DocumentMetadataUpdate
  ): Promise<{ bytes: Uint8Array; metadata: DocumentMetadata }> {
    const result = await this.document.updateMetadata(updates);
    const bufferArray = result.bytes.buffer.slice(
      result.bytes.byteOffset,
      result.bytes.byteOffset + result.bytes.byteLength
    ) as ArrayBuffer;
    this.reloadDocumentFromBuffer(bufferArray);
    return result;
  }

  /**
   * Digitally signs the active document conforming to PDF ISO 32000 Section 12.8,
   * reloading the signed stream into the WASM engine.
   *
   * @param options Digital signing options and identity keys.
   * @param pageTransforms Optional active visual transforms.
   * @return A promise resolving to the signed PDF bytes.
   */
  public async signActiveDocument(
    options: SignPdfOptions,
    pageTransforms?: Record<number, PageTransform>
  ): Promise<Uint8Array> {
    const signedBytes = await this.document.sign(options, pageTransforms);
    const bufferArray = signedBytes.buffer.slice(
      signedBytes.byteOffset,
      signedBytes.byteOffset + signedBytes.byteLength
    ) as ArrayBuffer;
    this.reloadDocumentFromBuffer(bufferArray);
    return signedBytes;
  }

  /**
   * Cryptographically validates all ISO 32000 digital signatures present in the active document.
   *
   * @param pageTransforms Optional active visual transforms.
   * @return A promise resolving to an array of signature validation reports.
   */
  public async validateActiveDocumentSignatures(
    pageTransforms?: Record<number, PageTransform>
  ): Promise<SignatureValidationResult[]> {
    return this.document.validateSignatures(pageTransforms);
  }
}


