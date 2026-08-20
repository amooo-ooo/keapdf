import { PdfiumEngine } from '../core/pdfium-engine';
import { PdfDocument } from './pdf/pdf-document';
import type { CanvasElement } from '../stores/canvas-types';
import type { PageTransform } from '../stores/types';
import type {
  SanitizeOptions,
  SanitizeSummary,
  SanitizationInspection,
  DocumentMetadata,
  DocumentMetadataUpdate,
} from '../core/types';
import type { SignPdfOptions, SignatureValidationResult } from './pdf/operations/signature-ops';
import type { WorkspaceFile } from '../stores/editor.svelte';
import { deleteFileBuffer, clearAllFileBuffers } from '../stores/editor.svelte';

/**
 * Manages the PDF editor workspace and provides direct access to the PdfDocument facade.
 */
export class PdfEditorService {
  private engine: PdfiumEngine;
  private _workspaceFiles: WorkspaceFile[];
  private _document: PdfDocument | null = null;

  constructor(workspaceFilesRef: WorkspaceFile[] = []) {
    this.engine = PdfiumEngine.getInstance();
    this._workspaceFiles = workspaceFilesRef;
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
   */
  public loadDocumentFromBuffer(buffer: ArrayBuffer): void {
    if (this._document) {
      this._document.closeAllPages();
    }
    this._document = null;
    this.engine.loadDocumentFromBuffer(buffer);
    this.document.setRawBuffer(buffer);
    this.document.fontCharsetIndex.ensureBuilt();
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
      this._document.closeAllPages();
    }
    this._document = null;
    this._workspaceFiles.length = 0;
    clearAllFileBuffers();
  }

  /**
   * Bakes arbitrary UI-drawn CanvasElements and page transforms into the active PDF document stream.
   * This bridges the gap between the interactive frontend UI and the low-level PDFium backend.
   */
  public async applyCanvasElementsToPdf(elements: CanvasElement[], pageTransforms?: Record<number, PageTransform>): Promise<void> {
    if (elements.length === 0 && (!pageTransforms || Object.keys(pageTransforms).length === 0)) return;

    const byPage = new Map<number, CanvasElement[]>();
    for (const el of elements) {
      if (!byPage.has(el.pageIndex)) byPage.set(el.pageIndex, []);
      byPage.get(el.pageIndex)!.push(el);
    }

    const imageDatas = new Map<string, { width: number; height: number; imgData: ImageData }>();
    for (const el of elements) {
      if (el.kind === 'image' && el.src) {
        if (!imageDatas.has(el.id)) {
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
            img.src = el.src!;
          });
          imageDatas.set(el.id, imgDataResult);
        }
      }
    }

    const doc = this.document;

    for (const [pageIndex, pageElements] of byPage.entries()) {
      const page = doc.getPage(pageIndex);

      for (const el of pageElements) {
        if (el.kind === 'text') {
          page.drawText({
            text: el.text,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            fontSize: el.fontSize,
            fontFamily: el.fontFamily,
            rawFontFamily: el.rawFontFamily,
            color: el.color,
            fontWeight: el.fontWeight,
            fontStyle: el.fontStyle,
            lineHeight: el.lineHeight,
            lines: el.lines,
            segments: el.segments,
            rotation: el.rotation,
            flipX: el.flipX,
            flipY: el.flipY
          });
        } else if (el.kind === 'shape') {
          // If shape has opacity, convert its hex colors to rgba strings so parseColor handles them
          let fillStr = el.fill;
          let strokeStr = el.stroke;
          if (el.opacity !== undefined && el.opacity < 1.0) {
            const op = Math.round(el.opacity * 255).toString(16).padStart(2, '0');
            if (fillStr && fillStr.startsWith('#') && fillStr.length === 7) fillStr += op;
            if (strokeStr && strokeStr.startsWith('#') && strokeStr.length === 7) strokeStr += op;
          }

          const shapeOptions = {
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            fill: fillStr,
            stroke: strokeStr,
            strokeWidth: el.strokeWidth,
            rotation: el.rotation,
            flipX: el.flipX,
            flipY: el.flipY
          };

          if (el.variant === 'rectangle') {
            if (el.isHighlight) {
              page.addHighlightAnnotation(shapeOptions);
            } else {
              page.drawRectangle(shapeOptions);
            }
          } else if (el.variant === 'circle') {
            page.drawCircle(shapeOptions);
          } else if (el.variant === 'line') {
            page.drawLine(shapeOptions);
          } else if (el.variant === 'arrow') {
            page.drawArrow(shapeOptions);
          }
        } else if (el.kind === 'path') {
          let strokeStr = el.stroke;
          if (el.opacity !== undefined && el.opacity < 1.0) {
            const op = Math.round(el.opacity * 255).toString(16).padStart(2, '0');
            if (strokeStr && strokeStr.startsWith('#') && strokeStr.length === 7) strokeStr += op;
          }
          page.addInkAnnotation({
            x: el.x,
            y: el.y,
            points: el.points,
            stroke: strokeStr,
            strokeWidth: el.strokeWidth,
            isHighlight: el.isHighlight,
            opacity: el.opacity,
            rotation: el.rotation,
            flipX: el.flipX,
            flipY: el.flipY
          });
        } else if (el.kind === 'image') {
          const imgDataResult = imageDatas.get(el.id);
          if (imgDataResult) {
            page.drawImage({
              id: el.id,
              x: el.x,
              y: el.y,
              width: el.width,
              height: el.height,
              objectFit: el.objectFit,
              rotation: el.rotation,
              flipX: el.flipX,
              flipY: el.flipY,
              imageData: imgDataResult
            });
          }
        } else if (el.kind === 'form-field') {
          page.addAcroFormField({
            id: el.id,
            variant: el.variant || 'text-input',
            label: el.label,
            placeholder: el.placeholder,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            rotation: el.rotation,
            flipX: el.flipX,
            flipY: el.flipY
          });
        } else if (el.kind === 'note') {
          page.addTextAnnotation({
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            author: el.author,
            contents: el.text,
            color: el.color,
          });
        }
      }
    }

    const finalBytes = await doc.saveAsync(pageTransforms);
    const bufferArray = finalBytes.buffer.slice(finalBytes.byteOffset, finalBytes.byteOffset + finalBytes.byteLength) as ArrayBuffer;
    this.loadDocumentFromBuffer(bufferArray);
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
    this.loadDocumentFromBuffer(bufferArray);
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
    this.loadDocumentFromBuffer(bufferArray);
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
    this.loadDocumentFromBuffer(bufferArray);
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


