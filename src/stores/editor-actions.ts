import { getContext, setContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';

import type { PdfEditorService } from '../services/pdf-editor';
import type { 
  EditableSpan,
  EditableTextSpan, 
  EditableImageSpan, 
  EditableShapeSpan,
  EditableFormFieldSpan,
  TextMutationOptions,
  TextLine,
  SanitizeOptions,
  SanitizeSummary,
  SanitizationInspection,
  CompressOptions,
  CompressSummary,
  CompressionInspection,
  CompressionLevel,
  HighlightRect,
  DocumentMetadata,
  DocumentMetadataUpdate,
  ColorRgba,
} from '../core/types';
import type { EditorStore, AppTheme } from './editor.svelte';
import { getFileBuffer, setFileBuffer } from './editor.svelte';
import type { CanvasStore } from './canvas.svelte';
import type { HistoryStore } from './history.svelte';
import type { EditorTool, CropUnit, CropScope, PageTransform } from './types';
import { isToolAllowedInMode, isMutationAllowedInMode, type DocumentViewMode } from '../core/document-mode';
import type { CanvasElement, TextElement, TextSegment, TextElementLine, ShapeElement, FormFieldElement, PathElement } from './canvas-types';
import type { CanvasActions } from './canvas-actions';
import { downloadBytes } from '../utils/download-utils';
import { safeClone } from '../utils/clone-utils';
import { UNICODE_TRAILING_WS_REGEX, UNICODE_LEADING_WS_REGEX } from '../utils/text-range-utils';
import { useSelection } from './selection.svelte';
import type { PageCropMargins } from '../services/pdf/operations/crop-ops';
import type {
  ScalePageOptions,
  PageScaleScope,
} from '../services/pdf/operations/scale-ops';
import type { ImpositionConfig } from '../services/pdf/operations/types';
import type { SavedSignature } from '../services/signature-storage';
import type { SignPdfOptions, SignatureValidationResult } from '../services/pdf/operations/signature-ops';
import { isSyntheticCanvasCharIndex, resolveCanvasTextChar } from '../services/pdf/unified-text-provider';
import type { ErasableCandidate } from '../services/eraser/eraser-engine';
import type { Command, CommandContext } from '../core/command';
import {
  CompoundCommand,
  AddElementCommand,
  RemoveElementCommand,
  UpdateElementPropertyCommand,
  HideSpanCommand,
  ReplaceTextCommand,
  ReplaceOcrTextCommand,
  ApplyOcrLayerCommand,
  DeleteTextCommand,
  RotatePageCommand,
  MutateDocumentCommand,
  RemoveAcroFormFieldCommand,
  UnlockFormsCommand,
} from '../commands';
import { PasswordRequiredError } from '../core/pdfium-engine';
import {
  computePermissionBitmask,
  type PdfPermissionFlags,
} from '../services/pdf/operations/security-ops';
import type { OcrPageResult } from '../services/ocr';
import type { ToolRegistry, ToolContext } from '../core/tool-registry';
import type { ExportRegistry } from '../core/export-registry';
import type { PluginManager } from '../core/plugin-manager';
import { findClosestGoogleFont, loadGoogleFont } from '../services/font-loader';
import {
  fetchPdfFromUrl,
  formatUrlLoadErrorMessage,
  syncUrlParameter,
} from '../services/url-document-loader';
import { isImageFile, inferImageMimeType } from '../utils/file-type-utils';
import type { DocumentConversionOptions } from '../services/conversion';
import type { OutlineItemFlat } from '../services/pdf/operations/outline-ops';

const EDITOR_ACTIONS_KEY = Symbol('editor-actions');

/** Minimum and maximum zoom bounds. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 5.0;
export const ZOOM_STEP = 1.2;

/**
 * Target options for programmatic scrolling and element centering.
 */
export interface ScrollTargetOptions {
  destY?: number;
  targetTop?: number;
  behavior?: ScrollBehavior;
}

export type ScrollCallback = (index: number, options?: ScrollTargetOptions) => void;

/**
 * Safely clone a canvas element and update its page index and optional identifier,
 * keeping any original text or form field span calibrated to the new page.
 */
function remapElementPageIndex(
  element: CanvasElement,
  newPageIndex: number,
  newId?: string,
): CanvasElement {
  const cloned = safeClone(element);
  const updated: CanvasElement = {
    ...cloned,
    pageIndex: newPageIndex,
    ...(newId ? { id: newId } : {}),
  };
  if ('originalSpan' in updated && updated.originalSpan) {
    updated.originalSpan = {
      ...updated.originalSpan,
      pageIndex: newPageIndex,
    };
  }
  return updated;
}

export class EditorActions {
  /** DOM references for hidden file inputs. Set by the root component. */
  fileInputEl: HTMLInputElement | null = null;
  mergeFileInputEl: HTMLInputElement | null = null;
  imageFileInputEl: HTMLInputElement | null = null;
  imageAsPageFileInputEl: HTMLInputElement | null = null;
  videoFileInputEl: HTMLInputElement | null = null;
  audioFileInputEl: HTMLInputElement | null = null;
  threeDFileInputEl: HTMLInputElement | null = null;
  attachmentFileInputEl: HTMLInputElement | null = null;
  mergeFilesInputEl: HTMLInputElement | null = null;
  quickConvertFileInputEl: HTMLInputElement | null = null;

  /**
   * Scroll callback registered by Canvas.svelte.
   * Called when programmatic page navigation requires a scroll.
   */
  private scrollCallback: ScrollCallback | null = null;
  
  private isAddingToWorkspace: boolean = false;
  private _canvasActions: CanvasActions | null = null;
  private _pluginManager: PluginManager | null = null;
  private zoomDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public readonly store: EditorStore,
    public readonly service: PdfEditorService,
    public readonly historyStore?: HistoryStore,
    public canvasStore?: CanvasStore,
    public toolRegistry?: ToolRegistry,
    public exportRegistry?: ExportRegistry,
  ) {}

  get canvasActions(): CanvasActions | null {
    return this._canvasActions;
  }

  set canvasActions(actions: CanvasActions | null) {
    this._canvasActions = actions;
  }

  setCanvasActions(canvasActions: CanvasActions): void {
    this._canvasActions = canvasActions;
  }

  setPluginManager(pluginManager: PluginManager): void {
    this._pluginManager = pluginManager;
  }

  /**
   * Sets the visual colour theme of the application.
   *
   * @param theme Target theme: 'system', 'light', or 'dark'.
   */
  setTheme(theme: AppTheme): void {
    this.store.setTheme(theme);
  }

  /**
   * Captures an immutable snapshot of current editor and canvas state.
   *
   * @param description Brief explanation of the action that produced the snapshot.
   * @param forcePdfSave Whether to force serialization of the underlying PDFium document.
   * @param explicitFileId Optional explicit workspace file ID to bind.
   * @param explicitFileName Optional explicit file name.
   * @param explicitBuffer Optional explicit document buffer.
   * @return The newly generated HistorySnapshot object.
   */
  /**
   * Constructs a command execution context.
   */
  getCommandContext(): CommandContext {
    return {
      editorStore: this.store,
      canvasStore: this.canvasStore ?? (null as unknown as CanvasStore),
      service: this.service,
    };
  }

  /**
   * Pushes an already-executed command onto the active history stack.
   *
   * @param command The command that was executed.
   */
  pushCommand(command: Command): void {
    if (!this.historyStore) return;
    const fileId = this.store.activeWorkspaceFileId ?? undefined;
    if (fileId && this.historyStore.activeFileId !== fileId) {
      this.historyStore.setActiveFileId(fileId);
    }
    this.historyStore.pushCommand(command, fileId);
    if (this.service?.document && typeof this.service.document.pushCommand === 'function') {
      this.service.document.pushCommand(command);
    }
  }

  /**
   * Executes a command and pushes it onto the active history stack.
   *
   * @param command The command to execute.
   */
  async executeCommand(command: Command): Promise<void> {
    if (!this.historyStore) return;
    await this.historyStore.executeCommand(
      command,
      this.getCommandContext(),
      this.store.activeWorkspaceFileId ?? undefined,
    );
    if (this.service.document && typeof this.service.document.pushCommand === 'function') {
      this.service.document.pushCommand(command);
    }
  }

  /**
   * Queues a debounced command push to coalesce continuous rapid changes.
   *
   * @param command The command to record.
   * @param delayMs Debounce delay in milliseconds. Defaults to 300ms.
   */
  recordDebouncedCommand(command: Command, delayMs: number = 300): void {
    if (!this.historyStore) return;
    this.historyStore.recordDebouncedCommand(
      command,
      delayMs,
      this.store.activeWorkspaceFileId ?? undefined,
    );
  }

  /**
   * Executes a destructive WASM document mutation with full buffer undo/redo support.
   *
   * Captures references to the previous and new binary document buffers and records
   * a typed MutateDocumentCommand on the history stack.
   *
   * @param description Human-readable description of the operation.
   * @param targetPageIndex Active page index after the mutation completes.
   * @param mutateFn The mutation function executing operations on the document.
   * @param indexMap Optional function to remap page indices for canvas elements and transforms.
   */
  async executeDocumentMutation(
    description: string,
    targetPageIndex: number,
    mutateFn: () => void | Promise<void>,
    indexMap?: (oldIndex: number) => number,
    skipPush?: boolean,
    duplicateCopies?: Array<{ sourceIndex: number; targetIndex: number }>,
    additionalElements?: CanvasElement[],
    additionalTransforms?: Record<number, PageTransform>,
    additionalScannedPages?: number[],
  ): Promise<MutateDocumentCommand | undefined> {
    const fileId = this.store.activeWorkspaceFileId;
    if (!fileId || !this.store.isDocumentLoaded) return;
    if (this.store.isReadOnly && !isMutationAllowedInMode(this.store.viewMode, description)) return;
    if (this.store.canMutateDocument === false && !isMutationAllowedInMode(this.store.viewMode, description)) return;

    const prevSaved = this.service.document.save();
    const prevBuffer = prevSaved.buffer.slice(
      prevSaved.byteOffset,
      prevSaved.byteOffset + prevSaved.byteLength,
    ) as ArrayBuffer;
    const prevPageIndex = this.store.currentPageIndex;
    const prevElements = this.canvasStore
      ? safeClone(this.canvasStore.elements)
      : (this.service.getFile(fileId)?.canvasElements ? safeClone(this.service.getFile(fileId)!.canvasElements!) : []);
    const prevTransforms = { ...this.store.pageTransforms };

    try {
      await mutateFn();
    } catch (err) {
      this.service.loadDocumentFromBuffer(prevBuffer);
      throw err;
    }

    if (indexMap) {
      this.remapPageIndices(indexMap, duplicateCopies);
    }

    if (additionalElements && additionalElements.length > 0) {
      if (this.canvasStore) {
        this.canvasStore.elements = [...this.canvasStore.elements, ...additionalElements];
      }
      const activeFile = this.service.getFile(fileId);
      if (activeFile) {
        activeFile.canvasElements = this.canvasStore
          ? safeClone(this.canvasStore.elements)
          : [...(activeFile.canvasElements ?? []), ...additionalElements];
      }
    }
    if (additionalTransforms && Object.keys(additionalTransforms).length > 0) {
      this.store.pageTransforms = { ...this.store.pageTransforms, ...additionalTransforms };
      const activeFile = this.service.getFile(fileId);
      if (activeFile) {
        activeFile.pageTransforms = safeClone(this.store.pageTransforms);
      }
    }
    if (additionalScannedPages && additionalScannedPages.length > 0) {
      if (!this.store.scannedPages) {
        this.store.scannedPages = new Set<number>();
      }
      for (const page of additionalScannedPages) {
        this.store.scannedPages.add(page);
      }
      const activeFile = this.service.getFile(fileId);
      if (activeFile) {
        activeFile.scannedPages = Array.from(this.store.scannedPages);
      }
    }

    const savedBytes = this.service.document.save();
    const newBuffer = savedBytes.buffer.slice(
      savedBytes.byteOffset,
      savedBytes.byteOffset + savedBytes.byteLength
    ) as ArrayBuffer;

    const newElements = this.canvasStore
      ? safeClone(this.canvasStore.elements)
      : (this.service.getFile(fileId)?.canvasElements ? safeClone(this.service.getFile(fileId)!.canvasElements!) : []);
    const newTransforms = { ...this.store.pageTransforms };

    const cmd = new MutateDocumentCommand(
      description,
      fileId,
      prevBuffer,
      newBuffer,
      prevPageIndex,
      targetPageIndex,
      prevElements,
      newElements,
      prevTransforms,
      newTransforms,
    );

    if (!skipPush) {
      this.pushCommand(cmd);
    }
    setFileBuffer(fileId, newBuffer);
    this.store.pageCount = this.service.document.getPageCount();
    this.store.currentPageIndex = Math.min(targetPageIndex, Math.max(0, this.store.pageCount - 1));
    this.store.incrementRenderVersion();
    if (this.store.selectedSpan && this.store.selectedSpan.pageIndex === targetPageIndex) {
      this.clearSelection(true);
    }
    this.refreshDocument();
    
    return cmd;
  }

  /**
   * Performs an undo operation for the active workspace file.
   *
   * @return Promise resolving to true if undo succeeded, false otherwise.
   */
  async undo(): Promise<boolean> {
    const fileId = this.store.activeWorkspaceFileId ?? undefined;
    if (this.historyStore && fileId && this.historyStore.activeFileId !== fileId) {
      this.historyStore.setActiveFileId(fileId);
    }
    if (!this.historyStore || !this.historyStore.canUndo) return false;
    const ctx = this.getCommandContext();
    const success = await this.historyStore.undoCommand(
      ctx,
      fileId,
    );
    if (success) {
      if (this.service.document && typeof this.service.document.syncCommandStacks === 'function' && this.historyStore.activeCommandState) {
        this.service.document.syncCommandStacks(
          this.historyStore.activeCommandState.past,
          this.historyStore.activeCommandState.future,
        );
      }
      this.refreshDocument();
      return true;
    }
    return false;
  }

  /**
   * Performs a redo operation for the active workspace file.
   *
   * @return Promise resolving to true if redo succeeded, false otherwise.
   */
  async redo(): Promise<boolean> {
    const fileId = this.store.activeWorkspaceFileId ?? undefined;
    if (this.historyStore && fileId && this.historyStore.activeFileId !== fileId) {
      this.historyStore.setActiveFileId(fileId);
    }
    if (!this.historyStore || !this.historyStore.canRedo) return false;
    const ctx = this.getCommandContext();
    const success = await this.historyStore.redoCommand(
      ctx,
      fileId,
    );
    if (success) {
      if (this.service.document && typeof this.service.document.syncCommandStacks === 'function' && this.historyStore.activeCommandState) {
        this.service.document.syncCommandStacks(
          this.historyStore.activeCommandState.past,
          this.historyStore.activeCommandState.future,
        );
      }
      this.refreshDocument();
      return true;
    }
    return false;
  }

  // -- Initialization --

  async initializeEngine(): Promise<void> {
    try {
      await this.service.initialize();
      this.store.isInitialized = true;
    } catch (err) {
      console.error('Failed to initialize PDFium engine:', err);
    }
  }

  async loadDemoDocument(presetIdOrUrl: string): Promise<void> {
    const trimmed = (presetIdOrUrl || '').trim();
    if (!trimmed) return;

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      await this.loadDocumentFromUrl(trimmed);
      return;
    }

    const { resolveDemoPreset } = await import('../services/demo-documents/registry');
    const preset = resolveDemoPreset(trimmed);
    if (!preset) {
      this.store.loadError = `Unknown compliance test document identifier: "${trimmed}".`;
      return;
    }

    this.store.isLoadingDocument = true;
    this.store.loadingProgress = `Loading ${preset.title}...`;
    this.store.loadError = null;

    try {
      let buffer: ArrayBuffer | null = null;
      let usedRemoteBenchmark = false;

      // 1. Attempt streaming real-world benchmark PDF from CORS-enabled URL
      if (preset.primaryUrl && typeof fetch !== 'undefined') {
        try {
          this.store.loadingProgress = `Streaming ${preset.title} from ${preset.origin}...`;
          const result = await fetchPdfFromUrl(preset.primaryUrl, 15000);
          buffer = result.buffer;
          usedRemoteBenchmark = true;
        } catch (primaryErr) {
          console.warn(`Primary benchmark fetch failed for "${preset.id}", trying fallback mirrors:`, primaryErr);

          if (preset.remoteFallbackUrls && preset.remoteFallbackUrls.length > 0) {
            for (const fallbackUrl of preset.remoteFallbackUrls) {
              try {
                this.store.loadingProgress = `Fetching fallback mirror for ${preset.title}...`;
                const result = await fetchPdfFromUrl(fallbackUrl, 10000);
                buffer = result.buffer;
                usedRemoteBenchmark = true;
                break;
              } catch {
                // Continue to next mirror or procedural generator
              }
            }
          }
        }
      }

      // 2. Resilient fallback: compile procedural compliance document
      if (!buffer) {
        this.store.loadingProgress = `Compiling fallback document for ${preset.title}...`;
        const bytes = await preset.generateBuffer();
        buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
      }

      await this.loadDocumentFromBuffer(buffer, preset.fileName);

      // Attach companion canvas elements for procedural fallback
      const shouldAttachCanvasElements = !usedRemoteBenchmark;
      const canvasElements = (shouldAttachCanvasElements && preset.getCanvasElements)
        ? await preset.getCanvasElements()
        : [];

      if (this.canvasStore && canvasElements.length > 0) {
        this.canvasStore.elements = safeClone(canvasElements);
        const activeFile = this.service.getFile(this.store.activeWorkspaceFileId ?? '');
        if (activeFile) {
          activeFile.canvasElements = safeClone(canvasElements);
        }
      }

      syncUrlParameter(preset.id);
    } catch (err) {
      console.error(`Failed to load compliance document "${preset.id}":`, err);
      this.store.loadError = err instanceof Error ? err.message : `Failed to load ${preset.title}.`;
    } finally {
      this.store.isLoadingDocument = false;
      this.store.loadingProgress = null;
    }
  }

  async loadDocumentFromUrl(url: string, addToWorkspace?: boolean): Promise<void> {
    const trimmed = (url || '').trim();
    if (!trimmed) return;

    this.store.isLoadingDocument = true;
    this.store.loadingProgress = `Fetching PDF from ${trimmed}...`;
    this.store.loadError = null;

    try {
      const { buffer, fileName } = await fetchPdfFromUrl(trimmed);
      await this.loadDocumentFromBuffer(buffer, fileName, addToWorkspace);
      syncUrlParameter(trimmed);
    } catch (err) {
      console.error(`Failed to load PDF from URL "${trimmed}":`, err);
      const friendlyMessage = formatUrlLoadErrorMessage(err, trimmed);
      this.store.loadError = friendlyMessage;
    } finally {
      this.store.isLoadingDocument = false;
      this.store.loadingProgress = null;
    }
  }

  /**
   * Loads the public sample PDF demo template document.
   */
  async loadSampleDocument(): Promise<void> {
    try {
      const resp = await fetch('/sample.pdf');
      if (!resp.ok) {
        throw new Error('Failed to fetch sample.pdf');
      }
      const buffer = await resp.arrayBuffer();
      await this.loadDocumentFromBuffer(buffer, 'sample.pdf');
    } catch (err) {
      console.error('Failed to load sample PDF:', err);
    }
  }

  // -- Document lifecycle --

  /**
   * Resets all workspace state, clearing active documents, canvas elements,
   * page transforms, span caches, and command histories.
   */
  clearWorkspaceState(): void {
    this.service.clearWorkspace();
    this.historyStore?.clearAll();
    this.store.pageTransforms = {};
    this.store.hiddenSpanIds.clear();
    this.store.pageVersions = {};
    this.store.activeWorkspaceFileId = null;
    this.store.fileName = 'No document';
    this.store.pageCount = 0;
    this.store.currentPageIndex = 0;
    this.store.isDocumentLoaded = false;
    this.clearSelection(false);
    useSelection().clear();
    if (this.canvasStore) {
      this.canvasStore.elements = [];
      this.canvasStore.selectElement(null);
      this.canvasStore.clearDragState();
    }
    this.store.scannedPages = new Set();
    this.store.pageOcrResults = new Map();
    this.store.isOcrRunning = false;
    this.store.ocrProgress = null;
    this.store.showOcrDialog = false;
  }

  async loadDocumentFromBuffer(
    buffer: ArrayBuffer,
    fileName: string,
    addToWorkspace?: boolean,
  ): Promise<void> {
    if (!this.store.isInitialized) {
      await this.initializeEngine();
      if (!this.store.isInitialized) {
        return;
      }
    }

    let finalBuffer = buffer;
    let finalFileName = fileName;

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      const { documentConverter } = await import('../services/conversion');
      if (documentConverter.isConvertible(fileName, buffer)) {
        try {
          const converted = await documentConverter.convertDocument({
            name: fileName,
            buffer,
          });
          finalBuffer = converted.buffer;
          finalFileName = converted.fileName;
        } catch (err) {
          console.error('Failed to convert document buffer:', err);
        }
      }
    }

    const adding = addToWorkspace !== undefined ? addToWorkspace : this.isAddingToWorkspace;

    if (adding) {
      await this.saveActiveFileToWorkspace();
    } else {
      this.clearWorkspaceState();
    }

    try {
      this.service.loadDocumentFromBuffer(finalBuffer);
      this.store.fileName = finalFileName;
      this.store.currentPageIndex = 0;
      this.store.isDocumentLoaded = true;
      this.clearSelection(false);
      useSelection().clear();
      this.store.pageTransforms = {};
      this.store.hiddenSpanIds.clear();
      this.store.pageVersions = {};
      if (this.canvasStore) {
        this.canvasStore.elements = [];
        this.canvasStore.selectElement(null);
        this.canvasStore.clearDragState();
      }
      this.store.pageCount = this.service.document.getPageCount();
      this.store.scannedPages = new Set();
      this.store.pageOcrResults = new Map();
      this.detectScannedPages();
      this.store.incrementRenderVersion();
      
      let thumbnailDataUri: string | undefined;
      if (this.store.pageCount > 0) {
        try {
          const { canvas } = this.service.document.getPage(0).render(0.2, { applyDpr: false });
          thumbnailDataUri = canvas.toDataURL('image/jpeg', 0.6);
        } catch (e) {
          console.error('Failed to generate thumbnail', e);
        }
      }

      const newFileId = crypto.randomUUID();
      setFileBuffer(newFileId, finalBuffer);
      this.service.addFile({
        id: newFileId,
        fileName: finalFileName,
        thumbnail: thumbnailDataUri,
        sizeBytes: finalBuffer.byteLength,
        canvasElements: [],
        pageTransforms: {},
        hiddenSpanIds: [],
        currentPageIndex: 0,
        pageVersions: {},
      });
      this.store.activeWorkspaceFileId = newFileId;
      this.historyStore?.initFile(newFileId);

      if (this._pluginManager) {
        this._pluginManager.emit('document:loaded', {
          fileName: finalFileName,
          pageCount: this.store.pageCount,
        });
      }
    } catch (err) {
      if (err instanceof PasswordRequiredError) {
        this.store.pendingPasswordBuffer = finalBuffer;
        this.store.pendingPasswordFileName = finalFileName;
        this.store.passwordPromptError = null;
        this.store.showPasswordPromptDialog = true;
        return;
      }
      this.store.loadError = err instanceof Error ? err.message : 'Failed to load PDF document.';
      console.error('Failed to load PDF buffer:', err);
    }
  }

  async loadDocumentFromFile(file: File, addToWorkspace?: boolean): Promise<void> {
    if (!this.store.isInitialized) {
      await this.initializeEngine();
      if (!this.store.isInitialized) return;
    }
    try {
      let buffer = await file.arrayBuffer();
      let fileName = file.name;
      if (isImageFile(buffer, file.name) || file.type.startsWith('image/')) {
        const { mergeFilesToPdfBuffer } = await import('../services/file-merger');
        const converted = await mergeFilesToPdfBuffer([
          { name: file.name, buffer, mimeType: file.type || inferImageMimeType(file.name) },
        ], this.service.engine);
        buffer = converted.buffer;
        fileName = converted.fileName;
      } else if (!file.name.toLowerCase().endsWith('.pdf')) {
        const { documentConverter } = await import('../services/conversion');
        if (documentConverter.isConvertible(file.name, buffer, file.type)) {
          const converted = await documentConverter.convertDocument({
            name: file.name,
            buffer,
            mimeType: file.type,
          });
          buffer = converted.buffer;
          fileName = converted.fileName;
        }
      }
      await this.loadDocumentFromBuffer(buffer, fileName, addToWorkspace);
    } catch (err) {
      console.error('Failed to read file:', err);
    }
  }

  async loadDocumentsFromFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;

    if (!this.store.isInitialized) {
      await this.initializeEngine();
      if (!this.store.isInitialized) return;
    }

    // Clear workspace if we are completely replacing it, only ONCE
    if (!this.isAddingToWorkspace) {
      this.clearWorkspaceState();
    }

    // Now we must ensure subsequent files in this batch do not clear it
    const originalIsAdding = this.isAddingToWorkspace;
    try {
      this.isAddingToWorkspace = true;

      for (const file of files) {
        try {
          let buffer = await file.arrayBuffer();
          let fileName = file.name;
          if (isImageFile(buffer, file.name) || file.type.startsWith('image/')) {
            const { mergeFilesToPdfBuffer } = await import('../services/file-merger');
            const converted = await mergeFilesToPdfBuffer([
              { name: file.name, buffer, mimeType: file.type || inferImageMimeType(file.name) },
            ], this.service.engine);
            buffer = converted.buffer;
            fileName = converted.fileName;
          } else if (!file.name.toLowerCase().endsWith('.pdf')) {
            const { documentConverter } = await import('../services/conversion');
            if (documentConverter.isConvertible(file.name, buffer, file.type)) {
              const converted = await documentConverter.convertDocument({
                name: file.name,
                buffer,
                mimeType: file.type,
              });
              buffer = converted.buffer;
              fileName = converted.fileName;
            }
          }
          await this.loadDocumentFromBuffer(buffer, fileName);
        } catch (err) {
          console.error('Failed to read file:', err);
        }
      }
    } finally {
      // Restore the original state
      this.isAddingToWorkspace = originalIsAdding;
    }
  }

  openConvertDialog(file?: File): void {
    this.store.openConvertDialog(file);
  }

  closeConvertDialog(): void {
    this.store.closeConvertDialog();
  }

  async convertAndLoadDocument(
    file: File,
    options?: DocumentConversionOptions,
    addToWorkspace: boolean = false
  ): Promise<void> {
    if (!this.store.isInitialized) {
      await this.initializeEngine();
      if (!this.store.isInitialized) return;
    }
    this.store.isLoadingDocument = true;
    this.store.loadingProgress = `Converting ${file.name} to PDF...`;
    this.store.loadError = null;
    try {
      const { documentConverter } = await import('../services/conversion');
      const buffer = await file.arrayBuffer();
      const converted = await documentConverter.convertDocument(
        { name: file.name, buffer, mimeType: file.type },
        options
      );
      await this.loadDocumentFromBuffer(converted.buffer, converted.fileName, addToWorkspace);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error during document conversion.';
      this.store.loadError = `Failed to convert document: ${message}`;
      console.error('Failed to convert document:', err);
      throw err;
    } finally {
      this.store.isLoadingDocument = false;
    }
  }

  // -- File input triggers --

  triggerFileOpen(addToWorkspace: boolean = false): void {
    this.isAddingToWorkspace = addToWorkspace;
    if (!this.store.isInitialized) {
      void this.initializeEngine();
    }
    this.fileInputEl?.click();
  }

  triggerMergeFiles(): void {
    if (!this.store.isInitialized) {
      void this.initializeEngine();
    }
    this.mergeFilesInputEl?.click();
  }

  triggerQuickConvert(): void {
    if (!this.store.isInitialized) {
      void this.initializeEngine();
    }
    this.quickConvertFileInputEl?.click();
  }

  /**
   * Automatically converts one or more files to PDF format, triggers an immediate
   * browser download of each converted PDF byte stream, and loads the converted
   * document into the viewport workspace.
   *
   * @param files Array of files to convert and download.
   * @param options Optional document conversion formatting options.
   */
  async quickConvertFiles(files: File[], options?: DocumentConversionOptions): Promise<void> {
    if (!files || files.length === 0) return;

    if (!this.store.isInitialized) {
      await this.initializeEngine();
      if (!this.store.isInitialized) return;
    }

    this.store.isLoadingDocument = true;
    this.store.loadingProgress = files.length === 1
      ? `Converting ${files[0].name} to PDF...`
      : `Converting ${files.length} files to PDF...`;
    this.store.loadError = null;

    try {
      if (!this.isAddingToWorkspace) {
        this.clearWorkspaceState();
      }

      const originalIsAdding = this.isAddingToWorkspace;
      this.isAddingToWorkspace = true;

      try {
        for (const file of files) {
          let buffer: ArrayBuffer | Uint8Array = await file.arrayBuffer();
          let fileName = file.name;

          if (isImageFile(buffer, file.name) || file.type.startsWith('image/')) {
            const { mergeFilesToPdfBuffer } = await import('../services/file-merger');
            const converted = await mergeFilesToPdfBuffer([
              { name: file.name, buffer, mimeType: file.type || inferImageMimeType(file.name) },
            ], this.service.engine);
            buffer = converted.buffer;
            fileName = converted.fileName;
          } else if (!file.name.toLowerCase().endsWith('.pdf')) {
            const { documentConverter } = await import('../services/conversion');
            if (!documentConverter.isConvertible(file.name, buffer, file.type)) {
              throw new Error(`Unsupported document format for conversion: "${file.name}".`);
            }
            const converted = await documentConverter.convertDocument(
              {
                name: file.name,
                buffer,
                mimeType: file.type,
              },
              options
            );
            buffer = converted.buffer;
            fileName = converted.fileName;
          }

          const pdfBytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
          downloadBytes(pdfBytes, fileName, 'application/pdf');

          await this.loadDocumentFromBuffer(buffer, fileName);
        }
      } finally {
        this.isAddingToWorkspace = originalIsAdding;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error during document conversion.';
      this.store.loadError = `Failed to convert document: ${message}`;
      console.error('Failed to quick convert document:', err);
    } finally {
      this.store.isLoadingDocument = false;
    }
  }

  /**
   * Merges multiple PDF files and or images as pages into a single document,
   * then immediately loads the resulting document into the workspace.
   *
   * @param files Array of File objects to merge.
   */
  async mergeAndLoadFiles(files: File[]): Promise<void> {
    if (!files || files.length === 0) return;

    if (!this.store.isInitialized) {
      await this.initializeEngine();
      if (!this.store.isInitialized) return;
    }

    this.store.isLoadingDocument = true;
    this.store.loadingProgress = `Merging ${files.length} files...`;
    this.store.loadError = null;

    try {
      const { mergeFilesToPdfBuffer } = await import('../services/file-merger');
      const result = await mergeFilesToPdfBuffer(files, this.service.engine);
      await this.loadDocumentFromBuffer(result.buffer, result.fileName);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error during merge.';
      this.store.loadError = `Failed to merge files: ${message}`;
      console.error('Failed to merge files:', err);
    } finally {
      this.store.isLoadingDocument = false;
    }
  }

  triggerMergeUpload(): void {
    const selection = useSelection();
    let fileIds = Array.from(selection.selectedIds).filter((id: string) => id.startsWith('file_'));
    
    // Visually, the active file is always selected. Include it if there are other selections.
    const activeFileIdStr = `file_${this.store.activeWorkspaceFileId}`;
    if (fileIds.length > 0 && !fileIds.includes(activeFileIdStr)) {
      fileIds = [activeFileIdStr, ...fileIds];
    }
    
    if (fileIds.length > 1) {
      this.mergeWorkspaceFiles(fileIds.map((id: string) => id.replace('file_', '')), this.store.pageCount);
      return;
    }
    this.mergeFileInputEl?.click();
  }

  async mergeWorkspaceFiles(fileIds: string[], atIndex?: number): Promise<void> {
    if (this.store.isReadOnly || this.store.canMergeFiles === false) return;
    const filesToMerge = fileIds
      .map(id => this.service.getFile(id))
      .filter((f): f is NonNullable<typeof f> => f !== undefined);
      
    if (filesToMerge.length < 2) return;
    
    // Merge into the first target file in memory
    const firstFile = filesToMerge[0];
    if (this.store.activeWorkspaceFileId !== firstFile.id) {
       await this.switchWorkspaceFile(firstFile.id);
    } else {
       this.commitActiveEdits();
    }
    
    const targetInsertionIndex = atIndex !== undefined ? atIndex : this.store.pageCount;
    let totalPagesAdded = 0;
    const additionalElements: CanvasElement[] = [];
    const additionalTransforms: Record<number, PageTransform> = {};
    const additionalScannedPages: number[] = [];

    await this.executeDocumentMutation(
      'Merge Workspace Files',
      targetInsertionIndex,
      async () => {
        let targetIndex = targetInsertionIndex;
        for (let i = 1; i < filesToMerge.length; i++) {
          const secondaryFile = filesToMerge[i];
          const fileBuf = getFileBuffer(secondaryFile.id);
          if (!fileBuf) continue;
          const previousPageCount = this.store.pageCount;
          if (isImageFile(fileBuf, secondaryFile.fileName)) {
            await this.service.document.importImageAsPage(
              fileBuf,
              inferImageMimeType(secondaryFile.fileName),
              targetIndex,
            );
          } else {
            this.service.document.merge(fileBuf, targetIndex);
          }
          this.store.pageCount = this.service.document.getPageCount();
          const added = this.store.pageCount - previousPageCount;
          totalPagesAdded += added;

          // Merge canvas elements with mapped page indices and fresh identifiers
          if (secondaryFile.canvasElements && secondaryFile.canvasElements.length > 0) {
            for (const elem of secondaryFile.canvasElements) {
              const mappedPageIndex = elem.pageIndex + targetIndex;
              const freshId = this.canvasStore?.generateId() ?? crypto.randomUUID();
              additionalElements.push(remapElementPageIndex(elem, mappedPageIndex, freshId));
            }
          }

          // Merge page transforms calibrated by insertion offset
          if (secondaryFile.pageTransforms) {
            for (const [pageKey, transform] of Object.entries(secondaryFile.pageTransforms)) {
              const mappedPageIndex = Number(pageKey) + targetIndex;
              additionalTransforms[mappedPageIndex] = safeClone(transform);
            }
          }

          // Merge hidden span identifiers from previous redactions
          if (secondaryFile.hiddenSpanIds && secondaryFile.hiddenSpanIds.length > 0) {
            if (!this.store.hiddenSpanIds) {
              this.store.hiddenSpanIds = new SvelteSet<string>();
            }
            for (const spanId of secondaryFile.hiddenSpanIds) {
              this.store.hiddenSpanIds.add(spanId);
            }
          }

          // Merge scanned page designations with adjusted indices
          if (secondaryFile.scannedPages && secondaryFile.scannedPages.length > 0) {
            for (const scannedPage of secondaryFile.scannedPages) {
              additionalScannedPages.push(scannedPage + targetIndex);
            }
          }

          targetIndex += added;
        }
        
        // Remove the merged files from the workspace
        const idsToRemove = new Set(filesToMerge.slice(1).map(f => f.id));
        for (const id of idsToRemove) {
          this.service.removeFile(id);
          this.historyStore?.clearFile(id);
        }
      },
      (old: number) => (old >= targetInsertionIndex ? old + totalPagesAdded : old),
      false,
      undefined,
      additionalElements,
      additionalTransforms,
      additionalScannedPages,
    );

    // Synchronise target file state cache
    firstFile.canvasElements = this.canvasStore
      ? safeClone(this.canvasStore.elements)
      : [...(firstFile.canvasElements ?? []), ...additionalElements];
    firstFile.pageTransforms = safeClone(this.store.pageTransforms);
    firstFile.hiddenSpanIds = this.store.hiddenSpanIds ? Array.from(this.store.hiddenSpanIds) : [];
    firstFile.scannedPages = this.store.scannedPages ? Array.from(this.store.scannedPages) : [];

    if (this.canvasStore) {
      this.canvasStore.selectElement(null);
      this.canvasStore.clearDragState();
      this.canvasStore.hoveredElementId = null;
      this.canvasStore.editingElementId = null;
    }

    this.goToPage(targetInsertionIndex);
    useSelection().clear();
  }

  triggerImageImport(): void {
    this.imageFileInputEl?.click();
  }

  triggerImageImportAsPage(): void {
    this.imageAsPageFileInputEl?.click();
  }

  triggerVideoImport(): void {
    this.videoFileInputEl?.click();
  }

  triggerAudioImport(): void {
    this.audioFileInputEl?.click();
  }

  trigger3DImport(): void {
    this.threeDFileInputEl?.click();
  }

  triggerAttachmentImport(): void {
    this.attachmentFileInputEl?.click();
  }

  openQrBarcodeModal(): void {
    this.store.showQrBarcodeModal = true;
  }
  
  /**
   * Commits active inline text editing sessions, flushes active DOM elements,
   * and clears browser window DOM text selection ranges.
   */
  commitActiveEdits(): void {
    if (typeof document !== 'undefined' && document.activeElement) {
      const el = document.activeElement as { blur?: () => void };
      if (typeof el.blur === 'function') {
        el.blur();
      }
    }

    if (this.store.inlineEdit) {
      this.submitInlineEdit();
    }

    if (typeof window !== 'undefined' && typeof window.getSelection === 'function') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        sel.removeAllRanges();
      }
    }
  }

  // -- Workspace --
  
  async saveActiveFileToWorkspace(): Promise<void> {
    if (this.store.activeWorkspaceFileId && this.store.isDocumentLoaded) {
      const currentActiveFile = this.service.getFile(this.store.activeWorkspaceFileId);
      if (currentActiveFile) {
        // Synchronously flush in-flight edits before capturing state
        this.commitActiveEdits();
        if (typeof this.historyStore?.flushDebounced === 'function') {
          this.historyStore.flushDebounced();
        }

        // Snapshot active file interactive state first, decoupled from WASM document saving
        try {
          currentActiveFile.canvasElements = this.canvasStore
            ? safeClone(this.canvasStore.elements)
            : [];
          currentActiveFile.pageTransforms = safeClone(this.store.pageTransforms) ?? {};
          currentActiveFile.hiddenSpanIds = Array.from(this.store.hiddenSpanIds);
          currentActiveFile.currentPageIndex = this.store.currentPageIndex;
          currentActiveFile.pageVersions = { ...this.store.pageVersions };
          currentActiveFile.scannedPages = Array.from(this.store.scannedPages);
        } catch (err) {
          console.warn('Failed to snapshot interactive file state to workspace:', err);
        }

        // Serialize active WASM document state in an isolated block
        try {
          const latestBuffer = this.service.document.save();
          const bufferArray = latestBuffer.buffer.slice(
            latestBuffer.byteOffset,
            latestBuffer.byteOffset + latestBuffer.byteLength
          ) as ArrayBuffer;
          setFileBuffer(currentActiveFile.id, bufferArray);
          currentActiveFile.sizeBytes = bufferArray.byteLength;
        } catch (err) {
          console.warn('Failed to export WASM document buffer to workspace:', err);
        }
      }
    }
  }

  async switchWorkspaceFile(id: string): Promise<void> {
    if (this.store.activeWorkspaceFileId === id) return;

    await this.saveActiveFileToWorkspace();

    const file = this.service.getFile(id);
    if (!file) return;

    const fileBuffer = getFileBuffer(id);
    if (!fileBuffer) return;

    try {
      // Clear transient selections, drag state, and DOM focus/ranges
      this.clearSelection(false);
      useSelection().clear();
      if (this.canvasStore) {
        this.canvasStore.selectElement(null);
        this.canvasStore.clearDragState();
        this.canvasStore.hoveredElementId = null;
        this.canvasStore.editingElementId = null;
      }
      if (typeof window !== 'undefined' && typeof window.getSelection === 'function') {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          sel.removeAllRanges();
        }
      }
      if (typeof document !== 'undefined' && document.activeElement) {
        const el = document.activeElement as { blur?: () => void };
        if (typeof el.blur === 'function') {
          el.blur();
        }
      }

      // Load document buffer into WASM engine
      this.service.loadDocumentFromBuffer(fileBuffer);
      this.store.fileName = file.fileName;
      this.store.isDocumentLoaded = true;
      this.store.pageCount = this.service.document.getPageCount();
      this.store.activeWorkspaceFileId = id;
      this.store.currentPageIndex = Math.min(
        file.currentPageIndex ?? 0,
        Math.max(0, this.store.pageCount - 1),
      );

      // Restore scoped document state with safe cloning
      this.store.pageTransforms = file.pageTransforms ? safeClone(file.pageTransforms) : {};
      this.store.hiddenSpanIds = new SvelteSet(file.hiddenSpanIds ?? []);
      this.store.pageVersions = file.pageVersions ? { ...file.pageVersions } : {};
      if (this.canvasStore) {
        this.canvasStore.elements = file.canvasElements ? safeClone(file.canvasElements) : [];
      }
      this.store.scannedPages = new Set(file.scannedPages ?? []);
      this.store.pageOcrResults = new Map();
      if (!file.scannedPages) {
        this.detectScannedPages();
      }

      this.historyStore?.setActiveFileId(id);
      this.store.incrementRenderVersion();

      if (typeof window !== 'undefined' && typeof window.getSelection === 'function') {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          sel.removeAllRanges();
        }
      }
    } catch (err) {
      console.error('Failed to switch workspace file:', err);
    }
  }

  reorderWorkspaceFiles(fromIndices: number[], toIndex: number): void {
    this.service.reorderFiles(fromIndices, toIndex);
    
    // Update selection
    const selection = useSelection();
    selection.clear();
    const files = this.store.workspaceFiles;
    for (let i = 0; i < fromIndices.length; i++) {
       const file = files[toIndex + i];
       if (file) {
         selection.select(`file_${file.id}`, true, false);
       }
    }
  }

  // -- Document refresh --

  refreshDocument(): void {
    if (!this.store.isDocumentLoaded || !this.service?.document || typeof this.service.document.getPageCount !== 'function') return;
    this.store.pageCount = this.service.document.getPageCount();
    this.store.currentPageIndex = Math.min(
      this.store.currentPageIndex,
      Math.max(0, this.store.pageCount - 1),
    );
    
    if (this.store.activeWorkspaceFileId && this.store.pageCount > 0) {
      const activeFile = this.service.getFile(this.store.activeWorkspaceFileId);
      if (activeFile) {
        try {
          const { canvas } = this.service.document.getPage(0).render(0.2, { applyDpr: false });
          activeFile.thumbnail = canvas.toDataURL('image/jpeg', 0.6);
        } catch (e) {
          console.error('Failed to update thumbnail on refresh', e);
        }
      }
    }

    this.store.incrementRenderVersion();
  }

  // -- Navigation --

  registerScrollCallback(cb: ScrollCallback): void {
    this.scrollCallback = cb;
  }

  goToPage(index: number, options?: ScrollTargetOptions): void {
    if (index < 0 || index >= this.store.pageCount) return;
    if (this.store.inlineEdit) {
      this.submitInlineEdit();
    }
    this.store.currentPageIndex = index;
    this.store.clearSelection();
    this.scrollCallback?.(index, options);
  }

  /**
   * Navigates to an outline bookmark and selects/focuses the corresponding text on that page.
   * Matches both canvas text elements and PDF text spans using exact, whitespace-normalized,
   * case-insensitive, and substring comparisons, disambiguated by destY when available.
   *
   * @param item The outline item to navigate to and select.
   */
  selectOutlineItem(item: OutlineItemFlat): void {
    if (!this.store.isDocumentLoaded || item.pageIndex === null || item.pageIndex === undefined) return;
    const pageIndex = item.pageIndex;
    if (pageIndex < 0 || pageIndex >= this.store.pageCount) return;

    if (this.store.inlineEdit) {
      this.submitInlineEdit();
    }

    this.store.currentPageIndex = pageIndex;

    // Retrieve page height for destY coordinate transformation if available
    let pageH = 792;
    try {
      const dims = this.service.document.getPageDimensions(pageIndex);
      if (dims && dims.heightPts > 0) {
        pageH = dims.heightPts;
      }
    } catch {}

    const targetTitle = (item.title || '').trim();
    const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizedTarget = normalize(targetTitle);

    // Expected top offset in page points if destY is provided (destY is measured from page bottom)
    const expectedTop = item.destY !== undefined ? Math.max(0, pageH - item.destY) : undefined;

    interface OutlineMatchCandidate {
      type: 'canvas' | 'pdf';
      canvasElement?: TextElement;
      pdfSpan?: EditableTextSpan;
      top: number;
      score: number;
      distanceToDestY: number;
    }

    const candidates: OutlineMatchCandidate[] = [];

    // 1. Check canvas text elements on target page
    if (this.canvasStore) {
      const canvasTextEls = this.canvasStore.elements.filter(
        (el): el is TextElement => el.kind === 'text' && el.pageIndex === pageIndex
      );
      for (const el of canvasTextEls) {
        const text = (el.text || '').trim();
        if (!text) continue;
        const normText = normalize(text);

        let score = 0;
        if (text === targetTitle) {
          score = 4;
        } else if (normText === normalizedTarget) {
          score = 3;
        } else if (normText.startsWith(normalizedTarget) || normalizedTarget.startsWith(normText)) {
          score = 2;
        } else if (normText.includes(normalizedTarget) || normalizedTarget.includes(normText)) {
          score = 1;
        }

        if (score > 0) {
          const distanceToDestY = expectedTop !== undefined ? Math.abs(el.y - expectedTop) : el.y;
          candidates.push({
            type: 'canvas',
            canvasElement: el,
            top: el.y,
            score,
            distanceToDestY,
          });
        }
      }
    }

    // 2. Check PDF text spans on target page
    try {
      const pageSpans = this.service.document.getPage(pageIndex).extractTextSpans();
      for (const span of pageSpans) {
        const text = (span.text || '').trim();
        if (!text) continue;
        const normText = normalize(text);

        let score = 0;
        if (text === targetTitle) {
          score = 4;
        } else if (normText === normalizedTarget) {
          score = 3;
        } else if (normText.startsWith(normalizedTarget) || normalizedTarget.startsWith(normText)) {
          score = 2;
        } else if (normText.includes(normalizedTarget) || normalizedTarget.includes(normText)) {
          score = 1;
        }

        if (score > 0) {
          const distanceToDestY = expectedTop !== undefined ? Math.abs(span.top - expectedTop) : span.top;
          candidates.push({
            type: 'pdf',
            pdfSpan: span,
            top: span.top,
            score,
            distanceToDestY,
          });
        }
      }
    } catch {}

    // Sort candidates by score descending, then distanceToDestY ascending
    candidates.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.distanceToDestY - b.distanceToDestY;
    });

    const bestMatch = candidates[0];

    if (bestMatch) {
      if (bestMatch.type === 'canvas' && bestMatch.canvasElement) {
        this.clearSelection(true);
        this.canvasStore?.selectElement(bestMatch.canvasElement.id);
        this.scrollCallback?.(pageIndex, { targetTop: bestMatch.canvasElement.y, behavior: 'smooth' });

        if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
          setTimeout(() => {
            const el = document.querySelector(`[data-element-id="${bestMatch.canvasElement!.id}"]`) as HTMLElement | null;
            el?.focus?.({ preventScroll: true });
          }, 50);
        }
      } else if (bestMatch.type === 'pdf' && bestMatch.pdfSpan) {
        this.canvasStore?.selectElement(null);
        this.selectSpan(bestMatch.pdfSpan);
        this.scrollCallback?.(pageIndex, { targetTop: bestMatch.pdfSpan.top, behavior: 'smooth' });

        if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
          setTimeout(() => {
            const el = document.querySelector(`[data-span-id="${bestMatch.pdfSpan!.id}"]`) as HTMLElement | null;
            el?.focus?.({ preventScroll: true });
          }, 50);
        }
      }
    } else {
      this.store.clearSelection();
      this.canvasStore?.selectElement(null);
      this.scrollCallback?.(pageIndex, { destY: item.destY, behavior: 'smooth' });
    }
  }

  goToPrevPage(): void {
    if (this.store.canGoPrev) {
      this.goToPage(this.store.currentPageIndex - 1);
    }
  }

  goToNextPage(): void {
    if (this.store.canGoNext) {
      this.goToPage(this.store.currentPageIndex + 1);
    }
  }

  /** Called by the IntersectionObserver in Canvas (no scroll triggered). */
  setCurrentPageFromScroll(index: number): void {
    this.store.currentPageIndex = index;
  }

  /**
   * Constructs a tool execution context.
   */
  getToolContext(pageIndex?: number, containerEl?: HTMLElement): ToolContext {
    if (!this._canvasActions) {
      throw new Error("CanvasActions not initialized on EditorActions");
    }
    return {
      editorStore: this.store,
      canvasStore: this.canvasStore ?? (null as unknown as CanvasStore),
      actions: this,
      canvasActions: this._canvasActions,
      pageIndex,
      containerEl,
    };
  }

  // -- Tool selection --

  setTool(tool: EditorTool): void {
    if (this.store.activeTool === tool) return;
    if (!isToolAllowedInMode(this.store.viewMode, tool)) return;

    if (this.canvasStore) {
      this.canvasStore.clearDragState();
      if (this.canvasStore.editingElementId) {
        this.canvasStore.selectElement(null);
      }
    }

    if (this.store.inlineEdit) {
      this.submitInlineEdit();
    }
    const oldToolId = this.store.activeTool;
    if (this.toolRegistry && this._canvasActions) {
      const ctx = this.getToolContext();
      this.toolRegistry.get(oldToolId)?.onDeactivate?.(ctx);
    }
    this.store.activeTool = tool;
    if (this.toolRegistry && this._canvasActions) {
      const ctx = this.getToolContext();
      this.toolRegistry.get(tool)?.onActivate?.(ctx);
    }
    this.store.clearSelection();
  }

  // -- Zoom --

  setZoom(zoom: number, isContinuous: boolean = false): void {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
    this.store.zoom = clamped;

    if (isContinuous) {
      this.store.isZooming = true;
      if (this.zoomDebounceTimer) {
        clearTimeout(this.zoomDebounceTimer);
      }
      this.zoomDebounceTimer = setTimeout(() => {
        this.store.isZooming = false;
        this.zoomDebounceTimer = null;
      }, 150);
    } else {
      if (this.zoomDebounceTimer) {
        clearTimeout(this.zoomDebounceTimer);
        this.zoomDebounceTimer = null;
      }
      this.store.isZooming = false;
    }
  }

  zoomIn(): void {
    this.setZoom(this.store.zoom * ZOOM_STEP);
  }

  zoomOut(): void {
    this.setZoom(this.store.zoom / ZOOM_STEP);
  }

  resetZoom(): void {
    this.setZoom(1.0);
  }

  /**
   * Cleans up any active timers and listeners owned by actions.
   */
  destroy(): void {
    if (this.zoomDebounceTimer) {
      clearTimeout(this.zoomDebounceTimer);
      this.zoomDebounceTimer = null;
    }
  }

  // -- Text & Object editing --

  /**
   * Clears any active span or object selection.
   * Optionally commits active inline edits before clearing.
   *
   * @param commitActiveEdit Whether to submit active inline edits before clearing.
   */
  clearSelection(commitActiveEdit: boolean = true): void {
    if (commitActiveEdit) {
      this.commitActiveEdits();
    } else {
      if (typeof window !== 'undefined' && typeof window.getSelection === 'function') {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          sel.removeAllRanges();
        }
      }
      if (typeof document !== 'undefined' && document.activeElement) {
        const el = document.activeElement as { blur?: () => void };
        if (typeof el.blur === 'function') {
          el.blur();
        }
      }
    }
    this.store.clearSelection();
    if (this.canvasStore) {
      this.canvasStore.selectElement(null);
    }
  }

  /**
   * Sets the active viewing mode and synchronises tool, selection, and panel states.
   *
   * @param mode Target document viewing mode.
   * @param collapseRightPanel Whether to collapse the right panel when entering viewing mode.
   */
  setViewMode(mode: DocumentViewMode, collapseRightPanel?: boolean): void {
    this.store.setViewMode(mode, collapseRightPanel);
    if (mode === 'viewing' || !this.store.canSelectElements) {
      this.clearSelection(false);
      this.canvasStore?.selectElement(null);
      try {
        useSelection().clear();
      } catch {
        // Context might not be available in isolated test environments
      }
    }
  }

  /**
   * Selects a canvas or PDF overlay span, submitting any active inline edit beforehand.
   * If a text span is selected after an edit mutation, re-resolves the matching span
   * from the refreshed page data to guarantee up-to-date metrics and IDs.
   *
   * @param span The span to select.
   */
  selectSpan(span: EditableSpan): void {
    if (this.store.isReadOnly || this.store.canSelectElements === false) {
      return;
    }
    if (this.store.inlineEdit) {
      this.submitInlineEdit();
    }
    if (span.type === 'text' && !(span as EditableTextSpan).isOcr && this.store.isDocumentLoaded) {
      try {
        const pageSpans = this.service.document.getPage(span.pageIndex).extractTextSpans();
        let freshSpan = pageSpans.find((s) => s.id === span.id);
        if (!freshSpan) {
          let minDistance = Infinity;
          for (const s of pageSpans) {
            const dist = Math.hypot(s.left - span.left, s.top - span.top);
            if (dist <= 8.0 && dist < minDistance) {
              minDistance = dist;
              freshSpan = s;
            }
          }
        }
        const resolved = freshSpan || span;
        if (resolved.type === 'text') {
          const fontCandidate = (resolved as EditableTextSpan).rawFontFamily || (resolved as EditableTextSpan).fontFamily;
          if (fontCandidate) {
            const match = findClosestGoogleFont(fontCandidate);
            if (match && match.confidence >= 0.65) {
              (resolved as EditableTextSpan).matchedFontFamily = match.font;
              loadGoogleFont(match.font);
            }
          }
        }
        this.store.selectedSpan = resolved;
      } catch {
        this.store.selectedSpan = span;
      }
    } else {
      if (span.type === 'text') {
        const fontCandidate = (span as EditableTextSpan).rawFontFamily || (span as EditableTextSpan).fontFamily;
        if (fontCandidate) {
          const match = findClosestGoogleFont(fontCandidate);
          if (match && match.confidence >= 0.65) {
            (span as EditableTextSpan).matchedFontFamily = match.font;
            loadGoogleFont(match.font);
          }
        }
      }
      this.store.selectedSpan = span;
    }
    this.store.inlineEdit = null;
  }

  /**
   * Enters inline editing mode for a text span.
   * Hides the underlying text glyphs on the canvas page so the transparent
   * inline editor overlays seamlessly without ghost text.
   *
   * @param span The text span to edit inline.
   */
  startInlineEdit(span: EditableTextSpan): void {
    if (this.store.isReadOnly || this.store.canEditContent === false) return;

    if (this.store.inlineEdit) {
      if (this.store.inlineEdit.spanId === span.id) {
        return;
      }
      this.submitInlineEdit();
    }

    let targetSpan = span;
    if (this.store.isDocumentLoaded && !span.isOcr) {
      try {
        const pageSpans = this.service.document.getPage(span.pageIndex).extractTextSpans();
        let freshSpan = pageSpans.find((s) => s.id === span.id);
        if (!freshSpan) {
          let minDistance = Infinity;
          for (const s of pageSpans) {
            const dist = Math.hypot(s.left - span.left, s.top - span.top);
            if (dist <= 8.0 && dist < minDistance) {
              minDistance = dist;
              freshSpan = s;
            }
          }
        }
        if (freshSpan) {
          targetSpan = freshSpan;
        }
      } catch {}
    }

    const fontCandidate = targetSpan.rawFontFamily || targetSpan.fontFamily;
    const match = fontCandidate ? findClosestGoogleFont(fontCandidate) : null;
    const matchedFontFamily = match && match.confidence >= 0.65 ? match.font : undefined;
    if (matchedFontFamily) {
      targetSpan.matchedFontFamily = matchedFontFamily;
      loadGoogleFont(matchedFontFamily);
    }

    this.store.selectedSpan = targetSpan;
    this.store.inlineEdit = {
      spanId: targetSpan.id,
      textValue: targetSpan.text,
      span: { ...targetSpan },
      matchedFontFamily,
    };

    if (this.store.isDocumentLoaded) {
      try {
        this.service.document.getPage(targetSpan.pageIndex).hideTextSpan(targetSpan);
        this.store.hiddenSpanIds.add(targetSpan.id);
        this.service.document.invalidatePage(targetSpan.pageIndex);
        this.store.incrementPageVersion(targetSpan.pageIndex);
      } catch (err) {
        console.error('Failed to hide text span during inline edit:', err);
      }
    }
  }

  updateInlineText(value: string, lines?: TextLine[]): void {
    if (this.store.inlineEdit) {
      this.store.inlineEdit = {
        ...this.store.inlineEdit,
        textValue: value,
        styledLines: lines ?? this.store.inlineEdit.styledLines,
      };
    }
  }

  /**
   * Submits and commits the active inline text edit.
   * Clears inlineEdit state safely first to prevent recursive re-entry.
   *
   * @param extractedData Optional structured text and styled lines extracted directly from the editor DOM.
   */
  async submitInlineEdit(extractedData?: { text: string; lines?: TextLine[] }): Promise<void> {
    const { inlineEdit } = this.store;
    if (!inlineEdit) return;

    this.store.inlineEdit = null;
    this.store.hiddenSpanIds.delete(inlineEdit.spanId);

    const span = inlineEdit.span;
    const textValue = extractedData?.text ?? inlineEdit.textValue;
    const customLines = extractedData?.lines ?? inlineEdit.styledLines;

    if (span.isOcr) {
      const isMultiLine = Boolean(
        span.isParagraph ||
        (span.lines && span.lines.length > 1) ||
        (customLines && customLines.length > 1) ||
        textValue.includes('\n')
      );

      const prevOptions: TextMutationOptions = {
        text: span.text,
        fontSize: span.fontSize,
        fontFamily: span.fontFamily,
        color: span.color,
        backgroundColor: span.backgroundColor,
        underline: span.underline,
        strikethrough: span.strikethrough,
        lineHeight: span.lineHeight,
        fontWeight: span.fontWeight,
        fontStyle: span.fontStyle,
        left: span.left,
        top: span.top,
        lines: span.lines,
        reflowParagraph: isMultiLine,
      };

      const newOptions: TextMutationOptions = {
        text: textValue,
        fontSize: span.fontSize,
        fontFamily: span.fontFamily,
        color: span.color,
        backgroundColor: span.backgroundColor,
        underline: span.underline,
        strikethrough: span.strikethrough,
        lineHeight: span.lineHeight,
        fontWeight: span.fontWeight,
        fontStyle: span.fontStyle,
        lines: customLines || span.lines,
        reflowParagraph: isMultiLine,
      };

      await this.executeCommand(
        new ReplaceOcrTextCommand('Edit Scanned Text', span.pageIndex, span, prevOptions, newOptions)
      );
      this.refreshDocument();
      return;
    }

    if (textValue.trim().length > 0) {
      // Detect if span or custom lines have mixed font sizes across lines or words
      const hasMixedFontSize =
        (span.lines && span.lines.some((l) => Math.abs(l.fontSize - span.lines![0].fontSize) > 0.2)) ||
        (span.lines && span.lines.some((l) => l.words && l.words.some((w) => Math.abs(w.fontSize - l.words[0].fontSize) > 0.2))) ||
        (customLines && customLines.some((l) => Math.abs(l.fontSize - customLines[0].fontSize) > 0.2)) ||
        (customLines && customLines.some((l) => l.words && l.words.some((w) => Math.abs(w.fontSize - l.words[0].fontSize) > 0.2)));

      const isMultiLine = Boolean(
        span.isParagraph ||
        (span.lines && span.lines.length > 1) ||
        (customLines && customLines.length > 1) ||
        textValue.includes('\n')
      );

      const prevOptions: TextMutationOptions = {
        text: span.text,
        fontSize: span.fontSize,
        fontFamily: span.fontFamily,
        color: span.color,
        backgroundColor: span.backgroundColor,
        underline: span.underline,
        strikethrough: span.strikethrough,
        lineHeight: span.lineHeight,
        fontWeight: span.fontWeight,
        fontStyle: span.fontStyle,
        left: span.left,
        top: span.top,
        lines: span.lines,
        reflowParagraph: isMultiLine,
      };

      const newOptions: TextMutationOptions = {
        text: textValue,
        fontSize: hasMixedFontSize ? undefined : span.fontSize,
        fontFamily: span.fontFamily,
        color: span.color,
        backgroundColor: span.backgroundColor,
        underline: span.underline,
        strikethrough: span.strikethrough,
        lineHeight: span.lineHeight,
        fontWeight: span.fontWeight,
        fontStyle: span.fontStyle,
        lines: customLines || span.lines,
        reflowParagraph: isMultiLine,
      };

      await this.executeCommand(
        new ReplaceTextCommand('Edit Text', span.pageIndex, span, prevOptions, newOptions)
      );
    } else {
      // Emptied paragraph: delete and shift downstream lines up
      await this.executeCommand(
        new DeleteTextCommand('Delete Text', span.pageIndex, span)
      );
    }
    this.refreshDocument();
  }

  /**
   * Cancels the active inline text edit and restores the original text span on the page.
   */
  cancelInlineEdit(): void {
    const { inlineEdit } = this.store;
    if (inlineEdit) {
      const span = inlineEdit.span;
      this.store.hiddenSpanIds.delete(inlineEdit.spanId);
      this.store.inlineEdit = null;

      if (span.isOcr) {
        this.store.incrementPageVersion(span.pageIndex);
        this.refreshDocument();
        return;
      }

      if (this.store.isDocumentLoaded) {
        try {
          this.service.document.replaceTextSpan(
            span.pageIndex,
            span,
            {
              text: span.text,
              fontSize: span.fontSize,
              fontFamily: span.fontFamily,
              color: span.color,
              lineHeight: span.lineHeight,
              fontWeight: span.fontWeight,
              fontStyle: span.fontStyle,
            }
          );
          this.store.incrementPageVersion(span.pageIndex);
          this.refreshDocument();
        } catch (err) {
          console.error('Failed to restore text span on inline edit cancel:', err);
        }
      }
    }
  }

  applyTextMutation(options: TextMutationOptions, targetSpan?: EditableTextSpan, recordHistory: boolean = true): void {
    const spanToMutate = targetSpan || (this.store.selectedSpan?.type === 'text' ? this.store.selectedSpan as EditableTextSpan : undefined);
    if (!spanToMutate || spanToMutate.type !== 'text' || !this.store.isDocumentLoaded) return;
    const pageIndex = spanToMutate.pageIndex;

    const prevOptions: TextMutationOptions = {
      text: spanToMutate.text,
      fontSize: spanToMutate.fontSize,
      fontFamily: spanToMutate.fontFamily,
      color: spanToMutate.color,
      lineHeight: spanToMutate.lineHeight,
      letterSpacing: spanToMutate.letterSpacing,
      fontWeight: spanToMutate.fontWeight,
      fontStyle: spanToMutate.fontStyle,
      underline: spanToMutate.underline,
      strikethrough: spanToMutate.strikethrough,
      backgroundColor: spanToMutate.backgroundColor,
      textAlign: spanToMutate.textAlign,
      left: spanToMutate.left,
      top: spanToMutate.top,
      lines: spanToMutate.lines,
      reflowParagraph: true,
    };

    if (spanToMutate.isOcr) {
      const cmd = new ReplaceOcrTextCommand(
        'Change Scanned Text Style',
        pageIndex,
        spanToMutate,
        prevOptions,
        options,
      );
      if (recordHistory) {
        this.executeCommand(cmd);
      } else {
        cmd.execute(this.getCommandContext());
      }
      this.refreshDocument();
      return;
    }

    const cmd = new ReplaceTextCommand(
      'Change Text Style',
      pageIndex,
      spanToMutate,
      prevOptions,
      options,
    );

    if (recordHistory) {
      this.executeCommand(cmd);
    } else {
      cmd.execute(this.getCommandContext());
    }
    this.refreshDocument();
  }

  async deleteSelectedSpan(): Promise<void> {
    if (this.store.isReadOnly || this.store.canEditContent === false) return;
    const { selectedSpan } = this.store;
    if (!selectedSpan || !this.store.isDocumentLoaded) return;
    
    if (selectedSpan.type === 'text') {
      const textSpan = selectedSpan as EditableTextSpan;
      if (textSpan.isOcr) {
        await this.executeCommand(
          new ReplaceOcrTextCommand('Delete Scanned Text', textSpan.pageIndex, textSpan, {
            text: textSpan.text,
            fontSize: textSpan.fontSize,
            fontFamily: textSpan.fontFamily,
          }, {
            text: '',
          })
        );
      } else {
        await this.executeCommand(
          new DeleteTextCommand('Delete Text', selectedSpan.pageIndex, selectedSpan)
        );
      }
    } else if (selectedSpan.type === 'form-field') {
      const fieldSpan = selectedSpan as EditableFormFieldSpan;
      const fieldName = fieldSpan.fieldName || fieldSpan.name || fieldSpan.fieldId;
      const commands: Command[] = [
        new HideSpanCommand('Hide Form Field', fieldSpan.id),
      ];
      if (fieldName) {
        commands.push(new RemoveAcroFormFieldCommand('Remove Native Form Field', fieldName));
      }
      await this.executeCommand(new CompoundCommand('Delete Form Field', commands));
      this.store.clearSelection();
    } else if ('pdfObjectIndex' in selectedSpan && typeof selectedSpan.pdfObjectIndex === 'number') {
      await this.executeDocumentMutation('Delete Object', selectedSpan.pageIndex, () => {
        this.service.document.getPage(selectedSpan.pageIndex).removeObject(selectedSpan.pdfObjectIndex);
        this.service.document.invalidatePage(selectedSpan.pageIndex);
        this.store.clearSelection();
        this.store.incrementPageVersion(selectedSpan.pageIndex);
      });
    }
    this.refreshDocument();
  }

  /**
   * Deletes the currently selected canvas element if one is selected.
   */
  deleteSelectedElement(): void {
    if (this.store.isReadOnly) return;
    if (this._canvasActions) {
      this._canvasActions.deleteSelectedElement();
      return;
    }
    const id = this.canvasStore?.selectedElementId;
    if (id && this.canvasStore) {
      const el = this.canvasStore.elements.find((item) => item.id === id);
      if (el && !el.locked) {
        const kind = el.kind ?? 'Element';
        const index = this.canvasStore.elements.findIndex((item) => item.id === id);
        const snapshot = safeClone(el);
        this.canvasStore.removeElement(id);
        this.pushCommand(new RemoveElementCommand(`Delete ${kind}`, id, snapshot, index));
      }
    }
  }

  /**
   * Deletes the currently active selection across canvas elements and PDF layer spans.
   * Prioritises canvas layer elements, falling back to selected PDF spans.
   */
  async deleteSelected(): Promise<void> {
    if (this.store.isReadOnly) return;
    if (this.canvasStore?.selectedElementId) {
      this.deleteSelectedElement();
      return;
    }
    if (this.store.hasSelection) {
      await this.deleteSelectedSpan();
      return;
    }
  }

  /**
   * Erases an individual annotation candidate across canvas or PDF layers.
   * Returns an undo command if a canvas element was deleted, or null if handled by PDF mutation.
   */
  async eraseCandidate(candidate: ErasableCandidate): Promise<Command | null> {
    const targetElementId = candidate.canvasElementId || candidate.canvasElement?.id;
    if (candidate.source === 'canvas' && targetElementId && this.canvasStore) {
      const el = this.canvasStore.getElementById(targetElementId);
      if (el && !el.locked) {
        const kind = el.kind ?? 'Element';
        const index = this.canvasStore.elements.findIndex((item) => item.id === el.id);
        const snapshot = safeClone(el) as CanvasElement;
        this.canvasStore.removeElement(el.id);
        return new RemoveElementCommand(`Erase ${kind}`, el.id, snapshot, index);
      }
      return null;
    }

    if (candidate.source === 'pdf-annotation' && typeof candidate.pdfAnnotIndex === 'number') {
      if (this.service?.document) {
        const page = this.service.document.getPage(candidate.pageIndex);
        page.removeAnnotation(candidate.pdfAnnotIndex);
        page.generateContent();
        this.service.document.invalidatePage(candidate.pageIndex);
        this.store.incrementPageVersion(candidate.pageIndex);
        this.refreshDocument();
      }
      return null;
    }

    if (candidate.source === 'pdf-shape' && typeof candidate.pdfObjectIndex === 'number') {
      if (this.service?.document) {
        const page = this.service.document.getPage(candidate.pageIndex);
        page.removeObject(candidate.pdfObjectIndex);
        page.generateContent();
        this.service.document.invalidatePage(candidate.pageIndex);
        this.store.incrementPageVersion(candidate.pageIndex);
        this.refreshDocument();
      }
      return null;
    }

    if (candidate.source === 'pdf-text-highlight' && candidate.pdfSpanId) {
      if (this.service?.document) {
        const page = this.service.document.getPage(candidate.pageIndex);
        const textSpans = page.extractTextSpans();
        const targetSpan = textSpans.find((s) => s.id === candidate.pdfSpanId);
        if (targetSpan) {
          targetSpan.backgroundColor = undefined;
          if (targetSpan.lines) {
            for (const line of targetSpan.lines) {
              line.backgroundColor = undefined;
              if (line.words) {
                for (const word of line.words) {
                  word.backgroundColor = undefined;
                }
              }
            }
          }
          this.service.document.replaceTextSpan(candidate.pageIndex, targetSpan, {
            text: targetSpan.text,
            fontSize: targetSpan.fontSize,
            fontFamily: targetSpan.fontFamily,
            color: targetSpan.color,
            backgroundColor: undefined,
          });
          page.generateContent();
          this.service.document.invalidatePage(candidate.pageIndex);
          this.store.incrementPageVersion(candidate.pageIndex);
          this.refreshDocument();
        }
      }
      return null;
    }

    return null;
  }

  /**
   * Commits an eraser gesture stroke with unified undo/redo history support.
   */
  commitEraserStroke(
    pageIndex: number,
    canvasCommands: Command[],
    hadPdfMutations: boolean,
    prevBuffer?: ArrayBuffer,
    prevElements?: CanvasElement[]
  ): void {
    const fileId = this.store.activeWorkspaceFileId;
    if (hadPdfMutations && fileId && prevBuffer && this.service?.document) {
      try {
        const newBufferRaw = this.service.document.save();
        const newBuffer = newBufferRaw.buffer.slice(
          newBufferRaw.byteOffset,
          newBufferRaw.byteOffset + newBufferRaw.byteLength
        ) as ArrayBuffer;
        setFileBuffer(fileId, newBuffer);
        const newElements = this.canvasStore ? safeClone(this.canvasStore.elements) : [];

        this.pushCommand(
          new MutateDocumentCommand(
            'Erase Annotations',
            fileId,
            prevBuffer,
            newBuffer,
            pageIndex,
            pageIndex,
            prevElements,
            newElements
          )
        );
        return;
      } catch (err) {
        console.error('Failed to commit PDF eraser stroke:', err);
      }
    }

    if (canvasCommands.length === 1) {
      this.pushCommand(canvasCommands[0]);
    } else if (canvasCommands.length > 1) {
      this.pushCommand(new CompoundCommand('Erase Annotations', canvasCommands));
    }
  }

  /**
   * Redacts a specific text character range on a page, permanently deleting only
   * the selected text characters from the PDF content stream (preserving neighbours)
   * and adding blackout shape elements.
   *
   * @param pageIndex Zero-based page index.
   * @param startCharIndex Starting character index (inclusive).
   * @param endCharIndex Ending character index (inclusive).
   * @param rects Array of bounding rectangles in DOM coordinates.
   * @param canvasStore The canvas store to add blackout elements to.
   */
  async redactTextRange(
    pageIndex: number,
    startCharIndex: number,
    endCharIndex: number,
    rects: HighlightRect[],
    canvasStore: CanvasStore
  ): Promise<void> {
    if (!this.store.isDocumentLoaded || rects.length === 0) return;

    if (isSyntheticCanvasCharIndex(startCharIndex) || isSyntheticCanvasCharIndex(endCharIndex)) {
      // Redaction targeting a canvas layer TextElement
      const startResolved = resolveCanvasTextChar(startCharIndex, pageIndex, canvasStore.elements);
      const endResolved = resolveCanvasTextChar(endCharIndex, pageIndex, canvasStore.elements);
      const targetElement = startResolved?.element || endResolved?.element;

      if (targetElement) {
        const startOffset = startResolved ? startResolved.charOffset : 0;
        const endOffset = endResolved ? endResolved.charOffset : targetElement.text.length - 1;
        const minOffset = Math.min(startOffset, endOffset);
        const maxOffset = Math.max(startOffset, endOffset);

        const chars = Array.from(targetElement.text);
        const updatedText = chars
          .map((ch, idx) => (idx >= minOffset && idx <= maxOffset ? ' ' : ch))
          .join('');

        const oldProps: Partial<TextElement> = { text: targetElement.text };
        const newProps: Partial<TextElement> = { text: updatedText };

        if (targetElement.lines && targetElement.lines.length > 0) {
          oldProps.lines = safeClone(targetElement.lines);
          const updatedLines: TextElementLine[] = safeClone(targetElement.lines);
          let offset = 0;
          for (const line of updatedLines) {
            if (line.segments && line.segments.length > 0) {
              for (const seg of line.segments) {
                const segChars = Array.from(seg.text);
                const updatedSegText = segChars
                  .map((ch, sIdx) => {
                    const currentGlobal = offset + sIdx;
                    return currentGlobal >= minOffset && currentGlobal <= maxOffset ? ' ' : ch;
                  })
                  .join('');
                seg.text = updatedSegText;
                offset += segChars.length;
              }
            } else if (line.text) {
              const lineChars = Array.from(line.text);
              const updatedLineText = lineChars
                .map((ch, lIdx) => {
                  const currentGlobal = offset + lIdx;
                  return currentGlobal >= minOffset && currentGlobal <= maxOffset ? ' ' : ch;
                })
                .join('');
              line.text = updatedLineText;
              offset += lineChars.length;
            }
            if (offset < targetElement.text.length) {
              if (targetElement.text[offset] === '\r' && targetElement.text[offset + 1] === '\n') {
                offset += 2;
              } else if (targetElement.text[offset] === '\n') {
                offset += 1;
              }
            }
          }
          newProps.lines = updatedLines;
        }

        const addedCommands: Command[] = [
          new UpdateElementPropertyCommand(
            'Redact Canvas Text',
            targetElement.id,
            oldProps,
            newProps,
          ),
        ];

        canvasStore.updateElement(targetElement.id, newProps);

        for (const rect of rects) {
          if (rect.width > 0 && rect.height > 0) {
            const blackoutShape: ShapeElement = {
              id: canvasStore.generateId(),
              kind: 'shape',
              variant: 'rectangle',
              pageIndex,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              rotation: targetElement.rotation || 0,
              locked: false,
              visible: true,
              flipX: false,
              flipY: false,
              fill: '#000000',
              stroke: '#000000',
              strokeWidth: 0,
              opacity: 1.0,
            };
            canvasStore.addElement(blackoutShape);
            addedCommands.push(new AddElementCommand('Redact Area', blackoutShape, false));
          }
        }

        if (addedCommands.length === 1) {
          this.pushCommand(addedCommands[0]);
        } else if (addedCommands.length > 1) {
          this.pushCommand(new CompoundCommand('Redact Canvas Text', addedCommands));
        }
      }
    } else {
      await this.executeDocumentMutation('Redact Text', pageIndex, () => {
        this.service.document.redactTextRange(pageIndex, startCharIndex, endCharIndex);

        for (const rect of rects) {
          canvasStore.addElement({
            id: canvasStore.generateId(),
            kind: 'shape',
            variant: 'rectangle',
            pageIndex,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            rotation: 0,
            locked: false,
            visible: true,
            flipX: false,
            flipY: false,
            fill: '#000000',
            stroke: '#000000',
            strokeWidth: 0,
            opacity: 1.0,
          });
        }
      });
    }

    this.store.clearSelection();
    this.store.incrementPageVersion(pageIndex);
  }

  /**
   * Redacts text and canvas objects across the specified rectangles on a page (area mode),
   * permanently deleting text objects within the area from the PDF content stream,
   * purging covered canvas elements, and adding blackout shape elements.
   *
   * @param pageIndex Zero-based page index.
   * @param rects Array of bounding rectangles in DOM coordinates.
   * @param canvasStore The canvas store to add blackout elements to.
   */
  async redactArea(pageIndex: number, rects: HighlightRect[], canvasStore: CanvasStore): Promise<void> {
    if (!this.store.isDocumentLoaded || rects.length === 0) return;

    await this.executeDocumentMutation('Redact Area', pageIndex, () => {
      this.service.document.deleteTextInRects(pageIndex, rects);

      // Purge or remove canvas elements on this page that are fully covered by any redaction rect
      const pageElements = canvasStore.getElementsByPage(pageIndex);
      for (const el of pageElements) {
        if (el.kind === 'shape' && el.fill === '#000000' && el.strokeWidth === 0) {
          continue; // preserve existing blackout rectangles
        }
        for (const rect of rects) {
          const elRight = el.x + el.width;
          const elBottom = el.y + el.height;
          const rectRight = rect.x + rect.width;
          const rectBottom = rect.y + rect.height;

          const isFullyCovered =
            el.x >= rect.x - 2 &&
            el.y >= rect.y - 2 &&
            elRight <= rectRight + 2 &&
            elBottom <= rectBottom + 2;

          if (isFullyCovered) {
            canvasStore.removeElement(el.id);
            break;
          }
        }
      }

      for (const rect of rects) {
        canvasStore.addElement({
          id: canvasStore.generateId(),
          kind: 'shape',
          variant: 'rectangle',
          pageIndex,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          rotation: 0,
          locked: false,
          visible: true,
          flipX: false,
          flipY: false,
          fill: '#000000',
          stroke: '#000000',
          strokeWidth: 0,
          opacity: 1.0,
        });
      }
    });

    this.store.clearSelection();
    this.store.incrementPageVersion(pageIndex);
  }

  /**
   * Redacts text across the specified rectangles on a page.
   * Alias for redactArea.
   *
   * @param pageIndex Zero-based page index.
   * @param rects Array of bounding rectangles in DOM coordinates.
   * @param canvasStore The canvas store to add blackout elements to.
   */
  async redactText(pageIndex: number, rects: HighlightRect[], canvasStore: CanvasStore): Promise<void> {
    await this.redactArea(pageIndex, rects, canvasStore);
  }


  // -- Helper for bulk operations --
  
  private getTargetPageIndices(defaultIndex: number): number[] {
    const selection = useSelection();
    const selectedPageIds = Array.from(selection.selectedIds).filter((id: string) => id.startsWith('page_'));
    
    if (selectedPageIds.length > 0) {
      const indices = selectedPageIds.map((id: string) => parseInt(id.replace('page_', ''), 10));
      // Sort descending to ensure safe mutations (deletions and insertions won't shift indices of earlier pages)
      return indices.sort((a, b) => b - a);
    }
    return [defaultIndex];
  }

  // -- Page operations --

  rotatePage(index: number): void {
    if (!this.store.isDocumentLoaded || this.store.isReadOnly) return;
    const indices = this.getTargetPageIndices(index);
    if (indices.length === 1) {
      this.executeCommand(new RotatePageCommand('Rotate Page', indices[0], 90));
    } else {
      const commands = indices.map((idx) => new RotatePageCommand('Rotate Page', idx, 90));
      this.executeCommand(new CompoundCommand('Rotate Pages', commands));
    }
    this.refreshDocument();
  }

  async flattenPage(index: number): Promise<void> {
    if (!this.store.isDocumentLoaded) return;
    const indices = this.getTargetPageIndices(index);
    await this.executeDocumentMutation('Flatten Page', this.store.currentPageIndex, () => {
      for (const idx of indices) {
        this.service.document.flattenPage(idx);
      }
    });
  }

  async rasterizePage(index: number): Promise<void> {
    if (!this.store.isDocumentLoaded) return;
    const indices = this.getTargetPageIndices(index);
    
    try {
      await this.executeDocumentMutation('Rasterize Page', this.store.currentPageIndex, async () => {
        for (const idx of indices) {
          // Render at 3x scale for high-quality rasterization
          const blob = await this.service.document.getPage(idx).exportAsBlob('jpeg', 3.0);
          const buffer = await blob.arrayBuffer();
          
          await this.service.document.importImageAsPage(buffer, 'image/jpeg', idx);
          this.service.document.deletePage(idx + 1);
        }
      });
      useSelection().clear();
    } catch (err) {
      console.error('Failed to rasterize pages:', err);
    }
  }

  // -- Page Crop operations --

  async startCropMode(pageIndex?: number, unit: CropUnit = 'pt', scope: CropScope = 'current'): Promise<void> {
    if (!this.store.isDocumentLoaded || this.store.isReadOnly || this.store.canMutateDocument === false) return;
    const targetIdx = pageIndex ?? this.store.currentPageIndex;

    const hasTransforms = Object.values(this.store.pageTransforms).some(
      (t) => t && (t.rotation !== 0 || t.scaleX !== 1 || t.scaleY !== 1),
    );
    if (hasTransforms) {
      await this.bakePageTransforms();
    }

    this.clearSelection(true);
    if (this.canvasStore) {
      this.canvasStore.selectElement(null);
    }
    this.store.activeCrop = {
      pageIndex: targetIdx,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      unit,
      scope,
    };
  }

  cancelCropMode(): void {
    this.store.activeCrop = null;
  }

  updateCropMargins(margins: Partial<PageCropMargins>): void {
    if (!this.store.activeCrop) return;
    const cur = this.store.activeCrop.margins;
    const newTop = margins.top !== undefined ? margins.top : cur.top;
    const newRight = margins.right !== undefined ? margins.right : cur.right;
    const newBottom = margins.bottom !== undefined ? margins.bottom : cur.bottom;
    const newLeft = margins.left !== undefined ? margins.left : cur.left;

    if (
      cur.top === newTop &&
      cur.right === newRight &&
      cur.bottom === newBottom &&
      cur.left === newLeft
    ) {
      return;
    }

    this.store.activeCrop = {
      ...this.store.activeCrop,
      margins: {
        top: newTop,
        right: newRight,
        bottom: newBottom,
        left: newLeft,
      },
    };
  }

  setCropUnit(unit: CropUnit): void {
    if (!this.store.activeCrop) return;
    this.store.activeCrop.unit = unit;
  }

  setCropScope(scope: CropScope): void {
    if (!this.store.activeCrop) return;
    this.store.activeCrop.scope = scope;
  }

  async cropPage(
    pageIndex: number,
    margins: PageCropMargins,
    scope: CropScope = 'current',
  ): Promise<void> {
    if (!this.store.isDocumentLoaded) return;
    const fileId = this.store.activeWorkspaceFileId;
    if (!fileId) return;

    let targetIndices: number[];
    if (scope === 'all') {
      targetIndices = Array.from({ length: this.store.pageCount }, (_, i) => i);
    } else if (scope === 'selected') {
      targetIndices = this.getTargetPageIndices(pageIndex);
    } else {
      targetIndices = [pageIndex];
    }

    if (targetIndices.length === 0) return;

    const targetSet = new Set(targetIndices);

    await this.executeDocumentMutation('Crop Page', pageIndex, async () => {
      const { cropPages } = await import('../services/pdf/operations/crop-ops');
      const buffer = await this.service.document.saveAsync(this.store.pageTransforms);
      const croppedBytes = await cropPages(buffer, {
        pageIndices: targetIndices,
        margins,
      });

      const croppedBuffer = croppedBytes.buffer.slice(
        croppedBytes.byteOffset,
        croppedBytes.byteOffset + croppedBytes.byteLength,
      ) as ArrayBuffer;

      this.service.loadDocumentFromBuffer(croppedBuffer);
      this.store.pageTransforms = {};

      // Adjust canvas elements on cropped pages by subtracting top/left margins
      if (this.canvasStore && (margins.left !== 0 || margins.top !== 0)) {
        this.canvasStore.elements = this.canvasStore.elements.map((el) => {
          if (targetSet.has(el.pageIndex)) {
            return {
              ...el,
              x: el.x - margins.left,
              y: el.y - margins.top,
            };
          }
          return el;
        });
      }

      this.clearSelection(true);
      if (this.canvasStore) {
        this.canvasStore.selectElement(null);
        this.canvasStore.clearDragState();
        this.canvasStore.hoveredElementId = null;
      }
      this.store.activeCrop = null;
      for (const idx of targetIndices) {
        this.store.incrementPageVersion(idx);
      }
    });
  }

  async resetPageCrop(pageIndex: number, scope: CropScope = 'current'): Promise<void> {
    if (!this.store.isDocumentLoaded) return;
    const fileId = this.store.activeWorkspaceFileId;
    if (!fileId) return;

    let targetIndices: number[];
    if (scope === 'all') {
      targetIndices = Array.from({ length: this.store.pageCount }, (_, i) => i);
    } else if (scope === 'selected') {
      targetIndices = this.getTargetPageIndices(pageIndex);
    } else {
      targetIndices = [pageIndex];
    }

    if (targetIndices.length === 0) return;

    // Cache pre-reset crop offsets so canvas elements can be shifted back to original coordinates
    const pageCropOffsets = new Map<number, { left: number; top: number }>();
    if (this.service?.document) {
      for (const idx of targetIndices) {
        try {
          const page = this.service.document.getPage(idx);
          if (page && 'getCropInfo' in page && typeof page.getCropInfo === 'function') {
            const cropInfo = page.getCropInfo();
            if (cropInfo && (cropInfo.hasCropBox || cropInfo.hasCrop)) {
              const domCropLeft = cropInfo.domCropLeft ?? cropInfo.marginLeft ?? 0;
              const domCropTop = cropInfo.domCropTop ?? cropInfo.marginTop ?? 0;
              pageCropOffsets.set(idx, { left: domCropLeft, top: domCropTop });
            }
          }
        } catch {
          // Page query best effort
        }
      }
    }

    await this.executeDocumentMutation('Reset Page Crop', pageIndex, async () => {
      const { resetCropPages } = await import('../services/pdf/operations/crop-ops');
      const buffer = await this.service.document.saveAsync(this.store.pageTransforms);
      const resetBytes = await resetCropPages(buffer, targetIndices);

      const resetBuffer = resetBytes.buffer.slice(
        resetBytes.byteOffset,
        resetBytes.byteOffset + resetBytes.byteLength,
      ) as ArrayBuffer;

      this.service.loadDocumentFromBuffer(resetBuffer);
      this.store.pageTransforms = {};

      // Restore canvas element coordinates by adding back the previous crop margins
      if (this.canvasStore && pageCropOffsets.size > 0) {
        this.canvasStore.elements = this.canvasStore.elements.map((el) => {
          const offset = pageCropOffsets.get(el.pageIndex);
          if (offset && (offset.left !== 0 || offset.top !== 0)) {
            return {
              ...el,
              x: el.x + offset.left,
              y: el.y + offset.top,
            };
          }
          return el;
        });
      }

      this.clearSelection(true);
      if (this.canvasStore) {
        this.canvasStore.selectElement(null);
        this.canvasStore.clearDragState();
        this.canvasStore.hoveredElementId = null;
      }
      this.store.activeCrop = null;
      for (const idx of targetIndices) {
        this.store.incrementPageVersion(idx);
      }
    });
  }

  openPageScaleDialog(): void {
    this.store.openPageScaleDialog();
  }

  closePageScaleDialog(): void {
    this.store.closePageScaleDialog();
  }

  async scalePage(
    pageIndex: number,
    options: Omit<ScalePageOptions, 'pageIndices'>,
    scope: PageScaleScope = 'current',
  ): Promise<void> {
    if (!this.store.isDocumentLoaded) return;
    const fileId = this.store.activeWorkspaceFileId;
    if (!fileId) return;

    let targetIndices: number[];
    if (scope === 'all') {
      targetIndices = Array.from({ length: this.store.pageCount }, (_, i) => i);
    } else if (scope === 'selected') {
      targetIndices = this.getTargetPageIndices(pageIndex);
    } else {
      targetIndices = [pageIndex];
    }

    if (targetIndices.length === 0) return;

    const fullScaleOptions: ScalePageOptions = {
      ...options,
      pageIndices: targetIndices,
    };

    await this.executeDocumentMutation('Scale Page', pageIndex, async () => {
      const { scalePages, transformCanvasElementsForScale } = await import('../services/pdf/operations/scale-ops');
      const buffer = await this.service.document.saveAsync(this.store.pageTransforms);
      const scaledBytes = await scalePages(buffer, fullScaleOptions);

      const scaledBuffer = scaledBytes.buffer.slice(
        scaledBytes.byteOffset,
        scaledBytes.byteOffset + scaledBytes.byteLength,
      ) as ArrayBuffer;

      // Snapshot original page dimensions before document buffer is reloaded
      const originalPageDims = new Map<number, { width: number; height: number }>();
      for (const idx of targetIndices) {
        const dims = this.getPageDimensions(idx);
        originalPageDims.set(idx, { width: dims.widthPts, height: dims.heightPts });
      }

      this.service.loadDocumentFromBuffer(scaledBuffer);
      this.store.pageTransforms = {};

      // Re-project canvas overlay elements to match scaled or margin-padded geometry
      if (this.canvasStore && this.canvasStore.elements.length > 0) {
        const metricsLookup = (idx: number) => {
          return originalPageDims.get(idx) ?? { width: 595.28, height: 841.89 };
        };
        this.canvasStore.elements = transformCanvasElementsForScale(
          this.canvasStore.elements,
          targetIndices,
          metricsLookup,
          fullScaleOptions,
        );
      }

      this.clearSelection(true);
      if (this.canvasStore) {
        this.canvasStore.selectElement(null);
        this.canvasStore.clearDragState();
        this.canvasStore.hoveredElementId = null;
      }
      for (const idx of targetIndices) {
        this.store.incrementPageVersion(idx);
      }
    });
  }

  /**
   * Retrieve unscaled dimensions in points for a given page.
   *
   * @param pageIndex Zero-based page index.
   */
  getPageDimensions(pageIndex: number): { widthPts: number; heightPts: number } {
    if (!this.service.document) {
      return { widthPts: 595.28, heightPts: 841.89 };
    }
    return this.service.document.getPageDimensions(pageIndex);
  }


  /**
   * Remap page indices across canvas elements, page transforms, and page versions
   * after a structural page operation.
   *
   * @param indexMap A function mapping old page indices to new page indices, or -1 for deleted pages.
   * @param duplicateCopies Optional array of source and target page index pairs for duplicated pages.
   */
  private remapPageIndices(
    indexMap: (oldIndex: number) => number,
    duplicateCopies?: Array<{ sourceIndex: number; targetIndex: number }>,
  ): void {
    const currentFile = this.store.activeWorkspaceFileId
      ? this.service.getFile(this.store.activeWorkspaceFileId)
      : undefined;

    if (this.canvasStore) {
      // Remap canvas elements, removing those on deleted pages.
      const remappedElements: CanvasElement[] = [];
      for (const el of this.canvasStore.elements) {
        const newIndex = indexMap(el.pageIndex);
        if (newIndex >= 0) {
          remappedElements.push(newIndex === el.pageIndex ? el : remapElementPageIndex(el, newIndex));
        }
      }

      // Clone canvas elements for duplicated pages
      if (duplicateCopies && duplicateCopies.length > 0) {
        for (const copy of duplicateCopies) {
          const sourceElements = this.canvasStore.elements.filter(el => el.pageIndex === copy.sourceIndex);
          for (const el of sourceElements) {
            remappedElements.push(remapElementPageIndex(el, copy.targetIndex, this.canvasStore.generateId()));
          }
        }
      }
      this.canvasStore.elements = remappedElements;
      if (currentFile) {
        currentFile.canvasElements = safeClone(remappedElements);
      }
    } else if (currentFile?.canvasElements) {
      const remappedElements: CanvasElement[] = [];
      for (const el of currentFile.canvasElements) {
        const newIndex = indexMap(el.pageIndex);
        if (newIndex >= 0) {
          remappedElements.push(newIndex === el.pageIndex ? el : remapElementPageIndex(el, newIndex));
        }
      }
      currentFile.canvasElements = remappedElements;
    }

    // Remap page transforms.
    const oldTransforms = this.store.pageTransforms;
    const newTransforms: Record<number, typeof oldTransforms[number]> = {};
    for (const [key, value] of Object.entries(oldTransforms)) {
      const newIndex = indexMap(Number(key));
      if (newIndex >= 0) {
        newTransforms[newIndex] = { ...value };
      }
    }
    if (duplicateCopies && duplicateCopies.length > 0) {
      for (const copy of duplicateCopies) {
        const sourceTransform = oldTransforms[copy.sourceIndex];
        if (sourceTransform) {
          newTransforms[copy.targetIndex] = { ...sourceTransform };
        }
      }
    }
    this.store.pageTransforms = newTransforms;

    // Remap page versions.
    const oldVersions = this.store.pageVersions;
    const newVersions: Record<number, number> = {};
    for (const [key, value] of Object.entries(oldVersions)) {
      const newIndex = indexMap(Number(key));
      if (newIndex >= 0) {
        newVersions[newIndex] = value;
      }
    }
    if (duplicateCopies && duplicateCopies.length > 0) {
      for (const copy of duplicateCopies) {
        newVersions[copy.targetIndex] = 1;
      }
    }
    this.store.pageVersions = newVersions;

    // Remap scanned pages.
    if (this.store.scannedPages && this.store.scannedPages.size > 0) {
      const newScannedPages = new Set<number>();
      for (const oldPage of this.store.scannedPages) {
        const newIndex = indexMap(oldPage);
        if (newIndex >= 0) {
          newScannedPages.add(newIndex);
        }
      }
      if (duplicateCopies && duplicateCopies.length > 0) {
        for (const copy of duplicateCopies) {
          if (this.store.scannedPages.has(copy.sourceIndex)) {
            newScannedPages.add(copy.targetIndex);
          }
        }
      }
      this.store.scannedPages = newScannedPages;
    }
  }

  async deletePage(index: number): Promise<void> {
    if (!this.store.isDocumentLoaded || this.store.pageCount <= 1 || this.store.isReadOnly || this.store.canMutateDocument === false) return;
    const indices = this.getTargetPageIndices(index);
    const deletedSet = new Set(indices);
    const indexMap = (oldIdx: number) => {
      if (deletedSet.has(oldIdx)) return -1;
      let shift = 0;
      for (const d of deletedSet) {
        if (d < oldIdx) shift++;
      }
      return oldIdx - shift;
    };
    const targetPage = Math.max(0, Math.min(this.store.currentPageIndex, this.store.pageCount - indices.length - 1));

    await this.executeDocumentMutation('Delete Page', targetPage, () => {
      for (const idx of [...indices].sort((a, b) => b - a)) {
        if (this.service.document.getPageCount() <= 1) break;
        this.service.document.deletePage(idx);
      }
    }, indexMap);

    useSelection().clear();
  }

  async addBlankPage(afterIndex: number): Promise<void> {
    if (!this.store.isDocumentLoaded || this.store.isReadOnly || this.store.canMutateDocument === false) return;
    const indices = this.getTargetPageIndices(afterIndex);
    const sortedIndices = [...indices].sort((a, b) => a - b);
    const insertAfter = sortedIndices[sortedIndices.length - 1];
    const targetIndex = insertAfter + 1;
    const indexMap = (old: number) => (old >= targetIndex ? old + 1 : old);

    await this.executeDocumentMutation('Add Blank Page', targetIndex, () => {
      this.service.document.addBlankPage(targetIndex);
    }, indexMap);

    useSelection().clear();
  }

  async duplicatePage(index: number | number[]): Promise<void> {
    if (!this.store.isDocumentLoaded || this.store.isReadOnly || this.store.canMutateDocument === false) return;
    const initialIndex = Array.isArray(index) ? index[0] : index;
    const rawIndices = Array.isArray(index) ? index : this.getTargetPageIndices(initialIndex);
    const sortedIndices = Array.from(new Set(rawIndices)).sort((a, b) => b - a);
    const targetIndex = initialIndex + 1;

    const indexMap = (old: number) => {
      let shift = 0;
      for (const idx of sortedIndices) {
        if (old > idx) shift++;
      }
      return old + shift;
    };

    const duplicateCopies = sortedIndices.map((idx) => ({
      sourceIndex: idx,
      targetIndex: indexMap(idx) + 1,
    }));

    await this.executeDocumentMutation(
      'Duplicate Page',
      targetIndex,
      () => {
        for (const idx of sortedIndices) {
          this.service.document.duplicatePage(idx);
        }
      },
      indexMap,
      false,
      duplicateCopies,
    );

    useSelection().clear();
  }



  async reorderPages(fromIndices: number[], toIndex: number): Promise<void> {
    if (!this.store.isDocumentLoaded || fromIndices.length === 0 || this.store.isReadOnly || this.store.canReorderPages === false) return;

    const indexMap = (old: number) => {
      if (fromIndices.includes(old)) {
        const sortedFrom = [...fromIndices].sort((a, b) => a - b);
        const offset = sortedFrom.indexOf(old);
        return toIndex + offset;
      } else {
        let newIdx = old;
        const removedBefore = fromIndices.filter(i => i < old).length;
        newIdx -= removedBefore;
        if (toIndex <= newIdx) {
          newIdx += fromIndices.length;
        }
        return newIdx;
      }
    };

    let newActivePage = this.store.currentPageIndex;
    if (fromIndices.includes(newActivePage)) {
      const sortedFrom = [...fromIndices].sort((a, b) => a - b);
      const offset = sortedFrom.indexOf(newActivePage);
      newActivePage = toIndex + offset;
    } else {
      let newIdx = newActivePage;
      const removedBefore = fromIndices.filter(i => i < newActivePage).length;
      newIdx -= removedBefore;
      if (toIndex <= newIdx) {
        newIdx += fromIndices.length;
      }
      newActivePage = newIdx;
    }

    await this.executeDocumentMutation('Reorder Pages', newActivePage, () => {
      this.service.document.reorderPages(fromIndices, toIndex);
    }, indexMap);

    const selection = useSelection();
    selection.clear();
    for (let i = 0; i < fromIndices.length; i++) {
      selection.select(`page_${toIndex + i}`, true, false);
    }
  }

  mergePdfFromFile(file: File, atIndex: number): void {
    this.mergePdfsFromFiles([file], atIndex);
  }

  async mergePdfsFromFiles(files: File[], atIndex: number): Promise<void> {
    if (this.store.isReadOnly || this.store.canMergeFiles === false) return;
    try {
      let totalPagesAdded = 0;
      await this.executeDocumentMutation(
        'Merge Files',
        atIndex,
        async () => {
          let currentIndex = atIndex;
          for (const file of files) {
            const buf = await file.arrayBuffer();
            const previousPageCount = this.store.pageCount;
            if (isImageFile(buf, file.name) || file.type.startsWith('image/')) {
              await this.service.document.importImageAsPage(
                buf,
                file.type || inferImageMimeType(file.name),
                currentIndex,
              );
            } else {
              this.service.document.merge(buf, currentIndex);
            }
            this.store.pageCount = this.service.document.getPageCount();
            const added = this.store.pageCount - previousPageCount;
            totalPagesAdded += added;
            currentIndex += added;
          }
        },
        (old: number) => (old >= atIndex ? old + totalPagesAdded : old),
      );
    } catch (err) {
      console.error('Failed to merge files:', err);
    }
  }

  async importImagesFromFiles(files: File[], atIndex: number): Promise<void> {
    try {
      let totalPagesAdded = 0;
      await this.executeDocumentMutation(
        'Import Image Page',
        atIndex,
        async () => {
          let currentIndex = atIndex;
          for (const file of files) {
            const buf = await file.arrayBuffer();
            await this.service.document.importImageAsPage(
              buf,
              file.type || inferImageMimeType(file.name),
              currentIndex,
            );
            currentIndex++;
            totalPagesAdded++;
          }
        },
        (old: number) => (old >= atIndex ? old + totalPagesAdded : old),
      );
    } catch (err) {
      console.error('Failed to import images as pages:', err);
    }
  }

  async extractPages(
    indices: number[],
    mode: 'split' | 'extract',
    rangeString: string,
    options?: { autoDownload?: boolean; targetFileIndex?: number }
  ): Promise<{ splitBytes: Uint8Array; newFileName: string } | void> {
    if (!this.store.isDocumentLoaded || this.store.isReadOnly || this.store.canExtractPages === false) return;
    
    try {
      this.commitActiveEdits();
      const sortedIndices = Array.from(new Set(indices)).sort((a, b) => a - b);
      if (sortedIndices.length === 0) return;
      const extractedSet = new Set(sortedIndices);

      // Partition and re-index canvas elements
      const allCurrentElements = this.canvasStore ? safeClone(this.canvasStore.elements) : [];
      const extractedElements: CanvasElement[] = [];
      const remainingElements: CanvasElement[] = [];

      for (const el of allCurrentElements) {
        if (extractedSet.has(el.pageIndex)) {
          const newPageIndex = sortedIndices.indexOf(el.pageIndex);
          extractedElements.push(remapElementPageIndex(el, newPageIndex, crypto.randomUUID()));
        } else {
          let shift = 0;
          for (const d of sortedIndices) {
            if (d < el.pageIndex) shift++;
          }
          const remainingPageIndex = el.pageIndex - shift;
          remainingElements.push(remapElementPageIndex(el, remainingPageIndex));
        }
      }

      // Partition and re-index page transforms
      const extractedTransforms: Record<number, PageTransform> = {};
      const remainingTransforms: Record<number, PageTransform> = {};

      for (const [keyStr, transform] of Object.entries(this.store.pageTransforms)) {
        const pageIdx = parseInt(keyStr, 10);
        if (isNaN(pageIdx) || !transform) continue;
        if (extractedSet.has(pageIdx)) {
          const newPageIndex = sortedIndices.indexOf(pageIdx);
          extractedTransforms[newPageIndex] = safeClone(transform);
        } else {
          let shift = 0;
          for (const d of sortedIndices) {
            if (d < pageIdx) shift++;
          }
          remainingTransforms[pageIdx - shift] = safeClone(transform);
        }
      }

      const splitBytes = this.service.document.split(sortedIndices);
      const splitBuffer = splitBytes.buffer.slice(splitBytes.byteOffset, splitBytes.byteOffset + splitBytes.byteLength) as ArrayBuffer;
      
      if (mode === 'split') {
        const deletedSet = new Set(sortedIndices);
        const indexMap = (oldIdx: number) => {
          if (deletedSet.has(oldIdx)) return -1;
          let shift = 0;
          for (const d of deletedSet) {
            if (d < oldIdx) shift++;
          }
          return oldIdx - shift;
        };
        const targetPage = Math.max(0, Math.min(this.store.currentPageIndex, this.store.pageCount - sortedIndices.length - 1));

        await this.executeDocumentMutation('Split Document', targetPage, () => {
          const descIndices = [...sortedIndices].sort((a, b) => b - a);
          for (const idx of descIndices) {
            if (this.service.document.getPageCount() > 1) {
              this.service.document.deletePage(idx);
            }
          }
          this.store.pageCount = this.service.document.getPageCount();
          this.store.currentPageIndex = Math.max(0, Math.min(this.store.currentPageIndex, this.store.pageCount - 1));
        }, indexMap);

        if (this.canvasStore) {
          this.canvasStore.elements = remainingElements;
        }
        this.store.pageTransforms = remainingTransforms;
        this.refreshDocument();
      }
      
      const baseName = this.store.fileName.replace(/\.[^/.]+$/, "");
      let suffix = rangeString.replace(/,/g, '_').replace(/\s/g, '');
      let newFileName = `${baseName}_${suffix}.pdf`;
      
      if (newFileName.length > 50) {
        const existingSplits = this.store.workspaceFiles
          .map(f => f.fileName)
          .filter(name => name.startsWith(`${baseName}-split-`));
          
        let maxInc = 0;
        for (const name of existingSplits) {
          const match = name.match(/-split-(\d+)\.pdf$/);
          if (match) {
            maxInc = Math.max(maxInc, parseInt(match[1], 10));
          }
        }
        newFileName = `${baseName}-split-${maxInc + 1}.pdf`;
      }
      
      const wasAdding = this.isAddingToWorkspace;
      try {
        this.isAddingToWorkspace = true;
        await this.loadDocumentFromBuffer(splitBuffer, newFileName);
      } finally {
        this.isAddingToWorkspace = wasAdding;
      }

      const activeFileId = this.store.activeWorkspaceFileId;
      const newFile = activeFileId ? this.service.getFile(activeFileId) : undefined;
      if (newFile) {
        newFile.canvasElements = safeClone(extractedElements);
        newFile.pageTransforms = safeClone(extractedTransforms);
      }
      if (this.canvasStore) {
        this.canvasStore.elements = safeClone(extractedElements);
      }
      this.store.pageTransforms = safeClone(extractedTransforms);
      this.store.incrementRenderVersion();

      if (options?.targetFileIndex !== undefined) {
        const newFileIndex = this.store.workspaceFiles.length - 1;
        const clampedTarget = Math.max(0, Math.min(options.targetFileIndex, newFileIndex));
        if (newFileIndex !== clampedTarget && clampedTarget >= 0) {
          this.service.reorderFiles([newFileIndex], clampedTarget);
        }
        if (activeFileId) {
          const selection = useSelection();
          selection.clear();
          selection.select(`file_${activeFileId}`, false, false);
        }
      }

      if (options?.autoDownload) {
        let exportBytes = splitBytes;
        if (extractedElements.length > 0) {
          const originalBytes = this.service.document.save();
          const originalBuffer = originalBytes.buffer.slice(
            originalBytes.byteOffset,
            originalBytes.byteOffset + originalBytes.byteLength
          ) as ArrayBuffer;
          try {
            await this.service.burnElementsToDocument(extractedElements);
            exportBytes = await this.service.document.saveAsync(extractedTransforms);
          } catch (err) {
            console.warn('Failed to burn canvas elements to auto-downloaded PDF:', err);
          } finally {
            this.service.loadDocumentFromBuffer(originalBuffer);
            this.refreshDocument();
          }
        }
        downloadBytes(exportBytes, newFileName, 'application/pdf');
      }

      return { splitBytes, newFileName };
    } catch (err) {
      console.error('Failed to extract pages:', err);
      throw err;
    }
  }

  // -- Text overlay --

  async addTextOverlay(
    pageIndex: number,
    text: string,
    posX: number,
    posY: number,
    fontSize: number,
  ): Promise<void> {
    if (!this.store.isDocumentLoaded) return;
    await this.executeDocumentMutation('Add Text Overlay', pageIndex, () => {
      this.service.document.drawText(pageIndex, {
        text,
        x: posX,
        y: posY,
        fontSize,
        color: '#000000',
        fontFamily: 'Helvetica',
      });
      this.store.incrementPageVersion(pageIndex);
    });
  }

  // -- Export --

  async applyCanvasComponentsToPdf(elements: CanvasElement[], onApplied?: () => void): Promise<void> {
    const hasTransforms = Object.values(this.store.pageTransforms).some(
      t => t && (t.rotation !== 0 || t.scaleX !== 1 || t.scaleY !== 1)
    );
    if (!this.store.isDocumentLoaded || (elements.length === 0 && !hasTransforms)) return;
    try {
      await this.executeDocumentMutation('Bake Canvas Components', this.store.currentPageIndex, async () => {
        await this.service.applyCanvasElementsToPdf(elements, this.store.pageTransforms);
        
        const affectedPages = new Set(elements.map(e => e.pageIndex));
        for (const pIdx of Object.keys(this.store.pageTransforms)) {
          affectedPages.add(parseInt(pIdx, 10));
        }
        for (const pageIndex of affectedPages) {
          this.store.incrementPageVersion(pageIndex);
        }
        
        this.store.pageTransforms = {};

        if (this.canvasStore) {
          this.canvasStore.elements = [];
          this.canvasStore.clearDragState();
          this.canvasStore.selectElement(null);
        }
      });
      
      if (onApplied) {
        onApplied();
      }
    } catch (err) {
      console.error('Failed to apply canvas components to PDF:', err);
    }
  }

  async bakePageTransforms(): Promise<void> {
    const hasTransforms = Object.values(this.store.pageTransforms).some(
      t => t && (t.rotation !== 0 || t.scaleX !== 1 || t.scaleY !== 1)
    );
    if (!this.store.isDocumentLoaded || !hasTransforms) return;

    try {
      await this.executeDocumentMutation('Bake Page Transforms', this.store.currentPageIndex, async () => {
        // Re-project active canvas overlay elements before resetting transforms
        if (this.canvasStore && this.canvasStore.elements.length > 0) {
          this.canvasStore.elements = this.canvasStore.elements.map((el) => {
            const t = this.store.pageTransforms[el.pageIndex];
            if (!t || (t.scaleX === 1 && t.scaleY === 1)) return el;
            const sx = t.scaleX ?? 1;
            const sy = t.scaleY ?? 1;
            const sMin = Math.min(sx, sy);
            const updated = { ...el };
            updated.x = Math.round(el.x * sx * 10) / 10;
            updated.y = Math.round(el.y * sy * 10) / 10;
            updated.width = Math.round(el.width * sx * 10) / 10;
            updated.height = Math.round(el.height * sy * 10) / 10;
            if (el.kind === 'text') {
              const textEl = updated as TextElement;
              if (textEl.fontSize) {
                textEl.fontSize = Math.max(4, Math.round(textEl.fontSize * sy * 10) / 10);
              }
              if (textEl.lines && Array.isArray(textEl.lines)) {
                textEl.lines = textEl.lines.map((ln) => ({
                  ...ln,
                  lineHeight: ln.lineHeight ? Math.round(ln.lineHeight * sy * 10) / 10 : ln.lineHeight,
                  segments: ln.segments
                    ? ln.segments.map((seg) => ({
                        ...seg,
                        fontSize: seg.fontSize ? Math.max(4, Math.round(seg.fontSize * sy * 10) / 10) : seg.fontSize,
                      }))
                    : ln.segments,
                }));
              }
            } else if (el.kind === 'form-field') {
              const formEl = updated as FormFieldElement;
              if (formEl.fontSize) {
                formEl.fontSize = Math.max(4, Math.round(formEl.fontSize * sMin * 10) / 10);
              }
              if (formEl.borderWidth !== undefined) {
                formEl.borderWidth = Math.max(0.5, Math.round(formEl.borderWidth * sMin * 10) / 10);
              }
              if (formEl.borderRadius !== undefined) {
                formEl.borderRadius = Math.round(formEl.borderRadius * sMin * 10) / 10;
              }
            } else if (el.kind === 'shape') {
              const shapeEl = updated as ShapeElement;
              if (shapeEl.strokeWidth) {
                shapeEl.strokeWidth = Math.max(0.5, Math.round(shapeEl.strokeWidth * Math.min(sx, sy) * 10) / 10);
              }
            } else if (el.kind === 'path') {
              const pathEl = updated as PathElement;
              if (pathEl.strokeWidth) {
                pathEl.strokeWidth = Math.max(0.5, Math.round(pathEl.strokeWidth * Math.min(sx, sy) * 10) / 10);
              }
              if (pathEl.points && Array.isArray(pathEl.points)) {
                pathEl.points = pathEl.points.map((pt) => ({
                  x: Math.round(pt.x * sx * 10) / 10,
                  y: Math.round(pt.y * sy * 10) / 10,
                }));
              }
            }
            return updated;
          });
        }

        const finalBytes = await this.service.document.saveAsync(this.store.pageTransforms);
        const bufferArray = finalBytes.buffer.slice(finalBytes.byteOffset, finalBytes.byteOffset + finalBytes.byteLength) as ArrayBuffer;
        this.service.loadDocumentFromBuffer(bufferArray);
        this.store.pageTransforms = {};
      });
    } catch (err) {
      console.error('Failed to bake page transforms into PDF:', err);
    }
  }

  async extractObjectToCanvas(
    type: 'image' | 'shape' | 'text' | 'form-field',
    span: EditableImageSpan | EditableShapeSpan | EditableTextSpan | EditableFormFieldSpan,
    canvasStore: CanvasStore
  ): Promise<string | undefined> {
    if (!this.store.isDocumentLoaded) return;
    if (this.store.isReadOnly || this.store.canMutateDocument === false) return;
    if (!canvasStore) return;

    const newId = canvasStore.generateId();

    let extractedElement: CanvasElement | null = null;

    if (type === 'image') {
      const imgSpan = span as EditableImageSpan;
      extractedElement = {
        id: newId,
        kind: 'image',
        pageIndex: imgSpan.pageIndex,
        x: imgSpan.left,
        y: imgSpan.top,
        width: imgSpan.width,
        height: imgSpan.height,
        rotation: imgSpan.rotation,
        flipX: imgSpan.flipX,
        flipY: imgSpan.flipY,
        locked: false,
        visible: true,
        src: imgSpan.src,
        opacity: 1,
        objectFit: 'fill'
      } as CanvasElement;
      canvasStore.elements.push(extractedElement);
    } else if (type === 'shape') {
      const shapeSpan = span as EditableShapeSpan;
      extractedElement = {
        id: newId,
        kind: 'shape',
        variant: 'rectangle',
        pageIndex: shapeSpan.pageIndex,
        x: shapeSpan.left,
        y: shapeSpan.top,
        width: shapeSpan.width,
        height: shapeSpan.height,
        rotation: shapeSpan.rotation,
        flipX: shapeSpan.flipX,
        flipY: shapeSpan.flipY,
        locked: false,
        visible: true,
        fill: shapeSpan.fill,
        stroke: 'transparent',
        strokeWidth: 0,
        opacity: 1,
      } as CanvasElement;
      canvasStore.elements.push(extractedElement);
    } else if (type === 'text') {
      const textSpan = span as EditableTextSpan;
      extractedElement = buildTextElementFromSpan(textSpan, newId);
      canvasStore.elements.push(extractedElement);
      this.store.hiddenSpanIds.add(span.id);
    } else if (type === 'form-field') {
      const formSpan = span as EditableFormFieldSpan;
      const sourceFieldName = formSpan.fieldName || formSpan.name || formSpan.fieldId;
      extractedElement = {
        id: newId,
        kind: 'form-field',
        variant: formSpan.variant,
        pageIndex: formSpan.pageIndex,
        x: formSpan.left,
        y: formSpan.top,
        width: formSpan.width,
        height: formSpan.height,
        rotation: formSpan.rotation || 0,
        locked: false,
        visible: true,
        flipX: false,
        label: (formSpan.variant === 'button' && typeof formSpan.value === 'string' && formSpan.value)
          ? formSpan.value
          : (formSpan.fieldName || formSpan.fieldId),
        placeholder: formSpan.placeholder || (typeof formSpan.value === 'string' ? formSpan.value : ''),
        value: typeof formSpan.value === 'string' ? formSpan.value : (formSpan.value ? 'true' : ''),
        options: formSpan.options ? [...formSpan.options] : undefined,
        readOnly: formSpan.readOnly ?? false,
        required: formSpan.required ?? false,
        fontSize: formSpan.fontSize ?? 13,
        fontFamily: formSpan.fontFamily ?? 'Helvetica',
        color: formSpan.color ?? '#111827',
        backgroundColor: formSpan.backgroundColor ?? '#ffffff',
        borderColor: formSpan.borderColor ?? '#d1d5db',
        borderWidth: formSpan.borderWidth ?? 1,
        borderStyle: formSpan.borderStyle ?? 'solid',
        borderRadius: formSpan.borderRadius ?? 4,
        textAlign: formSpan.textAlign ?? 'left',
        sourceFieldName,
        originalSpan: formSpan,
      } as CanvasElement;
      canvasStore.elements.push(extractedElement);
      this.store.hiddenSpanIds.add(span.id);
    }

    const mutateCmd = await this.executeDocumentMutation('Extract Object', span.pageIndex, () => {
      if (type === 'text') {
        this.service.document.getPage(span.pageIndex).hideTextSpan(span as EditableTextSpan);
      } else if (type === 'form-field') {
        const sourceFieldName = (span as EditableFormFieldSpan).fieldName || (span as EditableFormFieldSpan).name || (span as EditableFormFieldSpan).fieldId;
        if (sourceFieldName && typeof this.service?.document?.markAcroFormFieldRemoved === 'function') {
          this.service.document.markAcroFormFieldRemoved(sourceFieldName);
        }
      } else {
        this.service.document.getPage(span.pageIndex).removeObject((span as EditableImageSpan | EditableShapeSpan).pdfObjectIndex);
      }
    }, undefined, true);

    if (type !== 'text' && type !== 'form-field') {
      this.store.hiddenSpanIds.add(span.id);
    }

    // Clear the span selection so the editable-overlay-layer's SelectionOverlay
    // is removed. Without this, a stale overlay persists at the same position and
    // its onResizeStart callback can re-trigger extraction on pointer events.
    this.store.clearSelection();
    
    this.store.incrementPageVersion(span.pageIndex);
    this.refreshDocument();

    // Select the extracted canvas element synchronously. The caller
    // (startResize / startDrag / startRotate) also selects this element,
    // so this acts as an eager default for non-interaction extraction paths.
    canvasStore.selectElement(newId);

    if (extractedElement && mutateCmd) {
      const subCommands: Command[] = [
        mutateCmd,
        new HideSpanCommand('Hide Span', span.id),
        new AddElementCommand('Add Extracted Element', extractedElement, true),
      ];
      if (type === 'form-field') {
        const fieldName = (span as EditableFormFieldSpan).fieldName || (span as EditableFormFieldSpan).name || (span as EditableFormFieldSpan).fieldId;
        if (fieldName) {
          subCommands.unshift(new RemoveAcroFormFieldCommand('Remove Native Form Field', fieldName));
        }
      }
      this.pushCommand(
        new CompoundCommand('Extract Object to Canvas', subCommands)
      );
    }

    return newId;
  }

  async exportPdf(canvasStore?: CanvasStore): Promise<void> {
    if (!this.store.isDocumentLoaded) return;
    try {
      if (this.exportRegistry?.has('pdf')) {
        const handler = this.exportRegistry.get('pdf');
        if (handler && this.canvasStore) {
          await handler.export({
            editorStore: this.store,
            canvasStore: this.canvasStore,
            actions: this,
            service: this.service,
            canvasElements: (canvasStore ?? this.canvasStore).elements,
            pageTransforms: this.store.pageTransforms,
          });
          return;
        }
      }

      const originalBytes = this.service.document.save();
      const originalBuffer = originalBytes.buffer.slice(
        originalBytes.byteOffset,
        originalBytes.byteOffset + originalBytes.byteLength
      ) as ArrayBuffer;

      try {
        const elements = (canvasStore ?? this.canvasStore)?.elements ?? [];
        if (elements.length > 0) {
          await this.service.burnElementsToDocument(elements);
        }
        const bytes = await this.service.document.saveAsync(this.store.pageTransforms);
        downloadBytes(bytes, `edited_${this.store.fileName}`, 'application/pdf');
      } finally {
        this.service.loadDocumentFromBuffer(originalBuffer);
        this.refreshDocument();
      }
    } catch (err) {
      console.error('Failed to export PDF:', err);
    }
  }

  // -- Organizer view toggle --

  toggleOrganizerView(): void {
    if (this.store.inlineEdit) {
      this.submitInlineEdit();
    }
    this.store.showOrganizerView = !this.store.showOrganizerView;
    this.store.clearSelection();
  }

  // -- Document sanitization --

  openSanitizeDialog(): void {
    if (!this.store.isDocumentLoaded) return;
    this.store.showSanitizeDialog = true;
  }

  closeSanitizeDialog(): void {
    this.store.showSanitizeDialog = false;
  }

  async inspectDocumentForSanitization(): Promise<SanitizationInspection> {
    if (!this.store.isDocumentLoaded) {
      throw new Error('No document loaded');
    }
    return this.service.inspectActiveDocumentForSanitization(this.store.pageTransforms);
  }

  async sanitizeCurrentDocument(options: SanitizeOptions): Promise<SanitizeSummary> {
    if (!this.store.isDocumentLoaded) {
      throw new Error('No document loaded');
    }
    let summary!: SanitizeSummary;
    await this.executeDocumentMutation('Sanitize Document', this.store.currentPageIndex, async () => {
      summary = await this.service.sanitizeActiveDocument(options, this.store.pageTransforms);
      this.store.pageTransforms = {};
    });

    if (this.store.activeWorkspaceFileId) {
      const activeFile = this.service.getFile(this.store.activeWorkspaceFileId);
      if (activeFile) {
        const docBuffer = getFileBuffer(this.store.activeWorkspaceFileId);
        if (docBuffer) {
          activeFile.sizeBytes = docBuffer.byteLength;
        }
      }
    }

    return summary;
  }

  async sanitizeAndDownload(options: SanitizeOptions): Promise<SanitizeSummary> {
    if (!this.store.isDocumentLoaded) {
      throw new Error('No document loaded');
    }
    const { bytes, summary } = await this.service.sanitizeToBytes(options, this.store.pageTransforms);
    const baseName = this.store.fileName.replace(/\.[^/.]+$/, '');
    downloadBytes(bytes, `sanitized_${baseName}.pdf`, 'application/pdf');
    return summary;
  }

  async sanitizeAsNewWorkspaceFile(options: SanitizeOptions): Promise<SanitizeSummary> {
    if (!this.store.isDocumentLoaded) {
      throw new Error('No document loaded');
    }
    const { bytes, summary } = await this.service.sanitizeToBytes(options, this.store.pageTransforms);
    const bufferArray = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;

    const baseName = this.store.fileName.replace(/\.[^/.]+$/, '');
    const newFileName = `sanitized_${baseName}.pdf`;

    const wasAdding = this.isAddingToWorkspace;
    try {
      this.isAddingToWorkspace = true;
      await this.loadDocumentFromBuffer(bufferArray, newFileName);
    } finally {
      this.isAddingToWorkspace = wasAdding;
    }
    return summary;
  }

  openCompressDialog(preset: CompressionLevel = 'recommended'): void {
    if (!this.store.isDocumentLoaded) return;
    this.store.compressInitialPreset = preset;
    this.store.showCompressDialog = true;
  }

  closeCompressDialog(): void {
    this.store.showCompressDialog = false;
  }

  async inspectDocumentForCompression(): Promise<CompressionInspection> {
    if (!this.store.isDocumentLoaded) {
      throw new Error('No document loaded');
    }
    return this.service.inspectCompression(this.store.pageTransforms);
  }

  async compressCurrentDocument(options: CompressOptions): Promise<CompressSummary> {
    if (!this.store.isDocumentLoaded) {
      throw new Error('No document loaded');
    }
    let summary!: CompressSummary;
    await this.executeDocumentMutation('Compress Document', this.store.currentPageIndex, async () => {
      summary = await this.service.compressActiveDocument(options, this.store.pageTransforms);
      this.store.pageTransforms = {};
    });

    if (this.store.activeWorkspaceFileId) {
      const activeFile = this.service.getFile(this.store.activeWorkspaceFileId);
      if (activeFile) {
        const docBuffer = getFileBuffer(this.store.activeWorkspaceFileId);
        if (docBuffer) {
          activeFile.sizeBytes = docBuffer.byteLength;
        }
      }
    }

    return summary;
  }

  async compressAndDownload(options: CompressOptions): Promise<CompressSummary> {
    if (!this.store.isDocumentLoaded) {
      throw new Error('No document loaded');
    }
    const { bytes, summary } = await this.service.compressToBytes(options, this.store.pageTransforms);
    const baseName = this.store.fileName.replace(/\.[^/.]+$/, '');
    downloadBytes(bytes, `compressed_${baseName}.pdf`, 'application/pdf');
    return summary;
  }

  async compressAsNewWorkspaceFile(options: CompressOptions): Promise<CompressSummary> {
    if (!this.store.isDocumentLoaded) {
      throw new Error('No document loaded');
    }
    const { bytes, summary } = await this.service.compressToBytes(options, this.store.pageTransforms);
    const bufferArray = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;

    const baseName = this.store.fileName.replace(/\.[^/.]+$/, '');
    const newFileName = `compressed_${baseName}.pdf`;

    const wasAdding = this.isAddingToWorkspace;
    try {
      this.isAddingToWorkspace = true;
      await this.loadDocumentFromBuffer(bufferArray, newFileName);
    } finally {
      this.isAddingToWorkspace = wasAdding;
    }
    return summary;
  }

  // -- Optical Character Recognition (OCR) Actions --

  /**
   * Scans document pages to detect image-only scanned pages without native text.
   */
  detectScannedPages(): void {
    if (!this.store.isDocumentLoaded) return;
    const pageCount = this.store.pageCount;
    const maxStartupScan = 15;
    void (async () => {
      try {
        const { OcrService } = await import('../services/ocr');
        const ocrService = OcrService.getInstance();
        const detected = ocrService.detectDocumentScannedPages(
          this.service.document,
          pageCount > maxStartupScan ? { maxPages: maxStartupScan } : undefined
        );
        const scannedSet = new Set<number>();
        for (const [idx] of detected) {
          scannedSet.add(idx);
        }
        this.store.scannedPages = scannedSet;
      } catch (err) {
        console.error('Failed to detect scanned pages:', err);
      }
    })();
  }

  /**
   * Opens the OCR recognition dialog.
   */
  openOcrDialog(): void {
    if (!this.store.isDocumentLoaded) return;
    this.store.showOcrDialog = true;
  }

  /**
   * Closes the OCR recognition dialog.
   */
  closeOcrDialog(): void {
    this.store.showOcrDialog = false;
  }

  /**
   * Runs OCR text recognition on a specific page.
   *
   * @param pageIndex Zero-based page index.
   * @param options Recognition options (language, autoEmbed searchable layer).
   * @return Promise resolving to recognized OcrPageResult or null on error.
   */
  async runOcrOnPage(
    pageIndex: number,
    options?: { language?: string; autoEmbed?: boolean }
  ): Promise<OcrPageResult | null> {
    if (!this.store.isDocumentLoaded) return null;
    const pageCount = this.store.pageCount;
    if (pageIndex < 0 || pageIndex >= pageCount) return null;

    this.store.isOcrRunning = true;
    this.store.ocrProgress = {
      pageIndex,
      progress: 0,
      status: 'Initializing OCR engine...',
    };

    try {
      const { OcrService } = await import('../services/ocr');
      const ocrService = OcrService.getInstance();
      const page = this.service.document.getPage(pageIndex);
      const result = await ocrService.recognizePage(page, {
        language: options?.language || 'eng',
        scale: 1.5,
        onProgress: (p) => {
          this.store.ocrProgress = {
            pageIndex,
            progress: p.progress,
            status: p.status,
          };
        },
      });

      const updatedResults = new Map(this.store.pageOcrResults);
      updatedResults.set(pageIndex, result);
      this.store.pageOcrResults = updatedResults;

      // Invalidate page span cache so PdfPageView re-extracts with OCR spans merged
      this.service.document.clearCachedPageSpans(pageIndex);
      this.store.incrementPageVersion(pageIndex);
      this.store.incrementRenderVersion();

      if (options?.autoEmbed) {
        await this.executeCommand(
          new ApplyOcrLayerCommand('Embed Searchable Text Layer', pageIndex, result)
        );
      }

      return result;
    } catch (err) {
      console.error('Failed to run OCR on page:', err);
      return null;
    } finally {
      this.store.isOcrRunning = false;
      this.store.ocrProgress = null;
    }
  }

  /**
   * Runs OCR text recognition across multiple pages or the entire document.
   */
  async runOcrOnDocument(options?: {
    language?: string;
    autoEmbed?: boolean;
    pageIndices?: number[];
  }): Promise<void> {
    if (!this.store.isDocumentLoaded) return;
    const targets = options?.pageIndices ?? Array.from({ length: this.store.pageCount }, (_, i) => i);
    for (const pageIdx of targets) {
      await this.runOcrOnPage(pageIdx, options);
    }
  }

  /**
   * Applies imposition layout to the document and routes output to destination.
   *
   * @param config The imposition configuration parameters.
   * @param destination Target destination: 'replace' active document, 'workspace' file, or 'download'.
   * @param canvasStore Optional active canvas store with pending overlay elements.
   */
  async applyImposition(
    config: ImpositionConfig,
    destination: 'replace' | 'workspace' | 'download',
    canvasStore?: CanvasStore
  ): Promise<void> {
    if (!this.store.isDocumentLoaded) {
      throw new Error('No document loaded');
    }

    if (canvasStore && canvasStore.elements.length > 0) {
      await this.service.burnElementsToDocument(canvasStore.elements);
      canvasStore.elements = [];
      canvasStore.clearDragState();
      canvasStore.selectElement(null);
      this.refreshDocument();
    }

    const currentBytes = await this.service.document.saveAsync(this.store.pageTransforms);
    const { applyImposition: runImposition } = await import('../services/pdf/operations/imposition-ops');
    const imposedBytes = await runImposition(currentBytes, config);

    const baseName = this.store.fileName.replace(/\.[^/.]+$/, '');
    let modeSuffix: string = config.type;
    if (config.type === 'nup') modeSuffix = `${config.grid.cols}x${config.grid.rows}-up`;
    else if (config.type === 'booklet') modeSuffix = 'booklet';
    else if (config.type === 'single-page') modeSuffix = 'single-page';
    else if (config.type === 'posterize') modeSuffix = 'poster';
    else if (config.type === 'cut-stack') modeSuffix = 'cut-stack';

    const newFileName = `${baseName}_${modeSuffix}.pdf`;

    if (destination === 'download') {
      downloadBytes(imposedBytes, newFileName, 'application/pdf');
      return;
    }

    const imposedBuffer = imposedBytes.buffer.slice(
      imposedBytes.byteOffset,
      imposedBytes.byteOffset + imposedBytes.byteLength
    ) as ArrayBuffer;

    if (destination === 'workspace') {
      const wasAdding = this.isAddingToWorkspace;
      try {
        this.isAddingToWorkspace = true;
        await this.loadDocumentFromBuffer(imposedBuffer, newFileName);
      } finally {
        this.isAddingToWorkspace = wasAdding;
      }
    } else {
      await this.executeDocumentMutation('Apply Imposition', 0, () => {
        this.store.pageTransforms = {};
        this.service.loadDocumentFromBuffer(imposedBuffer);
        this.store.fileName = newFileName;
        this.store.currentPageIndex = 0;
        this.store.pageCount = this.service.document.getPageCount();
        this.store.clearSelection();
        this.store.pageVersions = {};
      });
    }
  }

  /**
   * Opens the comprehensive document information and metadata inspector dialog.
   */
  openDocumentInfoDialog(): void {
    this.store.showDocumentInfoDialog = true;
  }

  /**
   * Closes the document information and metadata inspector dialog.
   */
  closeDocumentInfoDialog(): void {
    this.store.showDocumentInfoDialog = false;
  }

  /**
   * Retrieves extended document metadata including all custom fields, XMP stream, and metrics.
   *
   * @return A promise resolving to the full DocumentMetadata object.
   */
  async getExtendedDocumentMetadata(): Promise<DocumentMetadata> {
    const activeBuffer = this.store.activeWorkspaceFileId
      ? getFileBuffer(this.store.activeWorkspaceFileId)
      : undefined;

    return this.service.document.getExtendedMetadata(
      activeBuffer,
      this.store.fileName,
      activeBuffer?.byteLength
    );
  }

  /**
   * Updates metadata fields and custom dictionary tags in the active document,
   * synchronizes the non-reactive binary storage buffer, and triggers a UI update.
   *
   * @param updates The metadata fields and custom key-value pairs to set.
   * @return A promise resolving when updates are applied and document reloaded.
   */
  async updateDocumentMetadata(updates: DocumentMetadataUpdate): Promise<void> {
    if (!this.store.isDocumentLoaded) return;
    try {
      await this.executeDocumentMutation('Update Metadata', this.store.currentPageIndex, async () => {
        const { bytes } = await this.service.document.updateMetadata(updates);
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;

        if (this.store.activeWorkspaceFileId) {
          setFileBuffer(this.store.activeWorkspaceFileId, buffer);
        }

        this.service.loadDocumentFromBuffer(buffer);
      });
    } catch (err) {
      console.error('Failed to update document metadata:', err);
      throw err;
    }
  }

  /**
   * Adds the currently selected text (or specified parameters) to the document outline.
   * If level is omitted or set to auto, automatically infers the outline hierarchy level.
   *
   * @param options Optional outline configuration overrides.
   */
  async addTextToOutline(options?: {
    title?: string;
    pageIndex?: number;
    level?: number;
    destY?: number;
    oldTitle?: string;
  }): Promise<void> {
    if (!this.store.isDocumentLoaded) return;

    const selectedSpan = this.store.selectedSpan?.type === 'text' ? (this.store.selectedSpan as EditableTextSpan) : null;
    const canvasElement = this.canvasStore?.selectedElement?.kind === 'text' ? (this.canvasStore.selectedElement as TextElement) : null;

    const resolvedText = (
      options?.title ||
      selectedSpan?.text ||
      canvasElement?.text ||
      ''
    ).trim();

    if (!resolvedText) return;

    const targetPageIndex = options?.pageIndex ?? selectedSpan?.pageIndex ?? (canvasElement?.pageIndex ?? this.store.currentPageIndex);

    let resolvedLevel = options?.level;
    if (!resolvedLevel || resolvedLevel < 1 || resolvedLevel > 6) {
      const rawLower = (
        selectedSpan?.rawFontFamily ||
        selectedSpan?.fontFamily ||
        canvasElement?.rawFontFamily ||
        canvasElement?.fontFamily ||
        ''
      ).toLowerCase();
      const isBold =
        selectedSpan?.fontWeight === 'bold' ||
        canvasElement?.fontWeight === 'bold' ||
        rawLower.includes('bold') ||
        rawLower.includes('black') ||
        rawLower.includes('heavy') ||
        rawLower.includes('semibold') ||
        rawLower.includes('demibold') ||
        rawLower.includes('extrabold');

      const rawFontSize = selectedSpan?.fontSize ?? canvasElement?.fontSize ?? 12;
      const fontSize = Math.round(rawFontSize * 10) / 10;

      const { inferOutlineLevel } = await import('../services/pdf/operations/outline-ops');
      resolvedLevel = inferOutlineLevel({
        text: resolvedText,
        fontSize,
        isBold,
      });
    }

    let resolvedDestY = options?.destY;
    if (resolvedDestY === undefined) {
      try {
        const dims = this.service.document.getPageDimensions(targetPageIndex);
        const pageH = dims.heightPts;
        const topY = selectedSpan?.top ?? canvasElement?.y;
        if (topY !== undefined) {
          resolvedDestY = Math.max(0, pageH - topY);
        }
      } catch {
        resolvedDestY = undefined;
      }
    }

    try {
      await this.executeDocumentMutation('Add to Outline', targetPageIndex, async () => {
        const bytes = await this.service.document.addOutlineItem({
          title: resolvedText,
          pageIndex: targetPageIndex,
          level: resolvedLevel!,
          destY: resolvedDestY,
          oldTitle: options?.oldTitle,
        });

        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;

        if (this.store.activeWorkspaceFileId) {
          setFileBuffer(this.store.activeWorkspaceFileId, buffer);
        }

        this.service.loadDocumentFromBuffer(buffer);
      });
    } catch (err) {
      console.error('Failed to add text to outline:', err);
      throw err;
    }
  }

  /**
   * Reorders outline items by moving elements from fromIndices to toIndex.
   *
   * @param fromIndices Source indices to move.
   * @param toIndex Target insertion index.
   */
  async reorderOutline(fromIndices: number[], toIndex: number): Promise<void> {
    if (!this.store.isDocumentLoaded || fromIndices.length === 0) return;

    try {
      await this.executeDocumentMutation('Reorder Outline', this.store.currentPageIndex, async () => {
        const bytes = await this.service.document.reorderOutline(fromIndices, toIndex);
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;

        if (this.store.activeWorkspaceFileId) {
          setFileBuffer(this.store.activeWorkspaceFileId, buffer);
        }

        this.service.loadDocumentFromBuffer(buffer);
      });
    } catch (err) {
      console.error('Failed to reorder outline items:', err);
      throw err;
    }
  }

  /**
   * Automatically sorts outline items in natural document reading order (top to bottom).
   */
  async sortOutlineTopToBottom(): Promise<void> {
    if (!this.store.isDocumentLoaded) return;

    try {
      await this.executeDocumentMutation('Sort Outline Top to Bottom', this.store.currentPageIndex, async () => {
        const bytes = await this.service.document.sortOutlineTopToBottom();
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;

        if (this.store.activeWorkspaceFileId) {
          setFileBuffer(this.store.activeWorkspaceFileId, buffer);
        }

        this.service.loadDocumentFromBuffer(buffer);
      });
    } catch (err) {
      console.error('Failed to sort outline items:', err);
      throw err;
    }
  }

  /**
   * Updates the heading level of an outline item at a given index.
   *
   * @param index Flat index of outline item.
   * @param newLevel Desired heading level (1 to 6).
   */
  async updateOutlineItemLevel(index: number, newLevel: number): Promise<void> {
    if (!this.store.isDocumentLoaded) return;

    try {
      await this.executeDocumentMutation('Update Outline Level', this.store.currentPageIndex, async () => {
        const bytes = await this.service.document.updateOutlineItemLevel(index, newLevel);
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;

        if (this.store.activeWorkspaceFileId) {
          setFileBuffer(this.store.activeWorkspaceFileId, buffer);
        }

        this.service.loadDocumentFromBuffer(buffer);
      });
    } catch (err) {
      console.error('Failed to update outline item level:', err);
      throw err;
    }
  }

  /**
   * Automatically scans document pages for headings (H1 to H3 by default) and generates an outline.
   *
   * @param options Optional extraction configuration.
   */
  async generateAutomaticOutline(options?: { maxLevel?: number }): Promise<void> {
    if (!this.store.isDocumentLoaded) return;

    const pageCount = this.service.document.getPageCount();
    const allPageSpans: EditableTextSpan[][] = [];
    const pageHeights: number[] = [];

    for (let i = 0; i < pageCount; i++) {
      try {
        const dims = this.service.document.getPageDimensions(i);
        pageHeights.push(dims.heightPts);
        const page = this.service.document.getPage(i);
        allPageSpans.push(page.extractTextSpans());
      } catch {
        pageHeights.push(792);
        allPageSpans.push([]);
      }
    }

    const { extractAutomaticOutlineItems } = await import('../services/pdf/operations/outline-ops');
    const items = extractAutomaticOutlineItems(allPageSpans, pageHeights, options);
    if (items.length === 0) return;

    try {
      await this.executeDocumentMutation('Generate Automatic Outline', this.store.currentPageIndex, async () => {
        const bytes = await this.service.document.setOutline(items);
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;

        if (this.store.activeWorkspaceFileId) {
          setFileBuffer(this.store.activeWorkspaceFileId, buffer);
        }

        this.service.loadDocumentFromBuffer(buffer);
      });
    } catch (err) {
      console.error('Failed to generate automatic outline:', err);
      throw err;
    }
  }

  /**
   * Removes an item from the document outline by title.
   *
   * @param title Title of the bookmark to remove.
   * @param pageIndex Optional page index constraint.
   */
  async removeOutlineItem(title: string, pageIndex?: number): Promise<void> {
    if (!this.store.isDocumentLoaded) return;
    const targetPageIndex = pageIndex ?? this.store.currentPageIndex;

    try {
      await this.executeDocumentMutation('Remove Outline Item', targetPageIndex, async () => {
        const bytes = await this.service.document.removeOutlineItem(title, pageIndex);
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;

        if (this.store.activeWorkspaceFileId) {
          setFileBuffer(this.store.activeWorkspaceFileId, buffer);
        }

        this.service.loadDocumentFromBuffer(buffer);
      });
    } catch (err) {
      console.error('Failed to remove outline item:', err);
      throw err;
    }
  }

  /**
   * Opens the E-Sign dialog with the specified initial tab.
   *
   * @param tab Initial tab mode ('signatures', 'draw', 'type', 'upload').
   */
  openEsignDialog(tab: 'signatures' | 'draw' | 'type' | 'upload' = 'signatures'): void {
    this.store.esignInitialTab = tab;
    this.store.showEsignDialog = true;
  }

  /**
   * Opens the ISO 32000 Certificate Secure Signing dialog.
   */
  openCertSignDialog(): void {
    this.store.showCertSignDialog = true;
  }

  /**
   * Opens the ISO 32000 Digital Signature Verification dialog.
   */
  openValidateSignaturesDialog(): void {
    this.store.showValidateSignaturesDialog = true;
  }

  /**
   * Places a saved signature as an interactive element onto the current canvas page.
   *
   * @param signature The saved signature record containing dataUrl and aspect ratio.
   * @param targetPageIndex Optional zero-based target page index.
   * @param canvasStore Optional CanvasStore instance.
   */
  placeSignatureOnCanvas(
    signature: SavedSignature,
    targetPageIndex?: number,
    canvasStore?: CanvasStore
  ): void {
    const pageIdx = targetPageIndex !== undefined ? targetPageIndex : this.store.currentPageIndex;
    const aspect = signature.aspectRatio > 0 ? signature.aspectRatio : 3;

    // Default target signature width on PDF in points
    const defaultWidth = 160;
    const defaultHeight = Math.max(30, Math.round(defaultWidth / aspect));

    let centerX = 200;
    let centerY = 300;

    try {
      if (this.service.document) {
        const dims = this.service.document.getPage(pageIdx).getDimensions();
        centerX = Math.max(20, (dims.widthPts - defaultWidth) / 2);
        centerY = Math.max(20, (dims.heightPts - defaultHeight) / 2);
      }
    } catch {
      // Safe fallback
    }

    const targetCanvasStore = canvasStore ?? this.canvasStore;

    try {
      if (targetCanvasStore) {
        const elementId = targetCanvasStore.generateId();
        const newElement: CanvasElement = {
          id: elementId,
          kind: 'image',
          pageIndex: pageIdx,
          x: centerX,
          y: centerY,
          width: defaultWidth,
          height: defaultHeight,
          rotation: 0,
          locked: false,
          visible: true,
          flipX: false,
          flipY: false,
          src: signature.dataUrl,
          objectFit: 'contain',
          opacity: 1,
        };
        targetCanvasStore.addElement(newElement);
        targetCanvasStore.selectElement(elementId);
        this.pushCommand(new AddElementCommand('Place Signature', newElement));
      }
    } finally {
      this.store.showEsignDialog = false;
    }
  }

  /**
   * Digitally signs the active document conforming to PDF ISO 32000 Section 12.8,
   * applying any pending canvas elements first and reloading into the engine.
   *
   * @param options Digital signing options and identity keys.
   * @param canvasStore Optional CanvasStore instance to bake pending elements.
   * @return A promise resolving to the signed PDF bytes.
   */
  async signActiveDocument(
    options: SignPdfOptions,
    canvasStore?: CanvasStore
  ): Promise<Uint8Array> {
    if (canvasStore && canvasStore.elements.length > 0) {
      await this.applyCanvasComponentsToPdf(canvasStore.elements, () => {
        canvasStore.elements = [];
      });
    }

    let signedBytes!: Uint8Array;
    await this.executeDocumentMutation('Sign Document', this.store.currentPageIndex, async () => {
      signedBytes = await this.service.signActiveDocument(options, this.store.pageTransforms);

      if (this.store.activeWorkspaceFileId) {
        const buffer = signedBytes.buffer.slice(
          signedBytes.byteOffset,
          signedBytes.byteOffset + signedBytes.byteLength
        ) as ArrayBuffer;
        setFileBuffer(this.store.activeWorkspaceFileId, buffer);
      }
    });

    return signedBytes;
  }

  /**
   * Inspects and validates all ISO 32000 digital signatures present in the active document.
   *
   * @return A promise resolving to an array of signature validation reports.
   */
  /**
   * Inspects and validates all ISO 32000 digital signatures present in the active document.
   *
   * @return A promise resolving to an array of signature validation reports.
   */
  async validateActiveDocumentSignatures(): Promise<SignatureValidationResult[]> {
    return this.service.validateActiveDocumentSignatures(this.store.pageTransforms);
  }

  /**
   * Submits a password to decrypt and open a password-protected document.
   */
  async submitDocumentPassword(password: string): Promise<boolean> {
    const buffer = this.store.pendingPasswordBuffer;
    const fileName = this.store.pendingPasswordFileName || 'document.pdf';
    if (!buffer) return false;

    try {
      this.service.loadDocumentFromBuffer(buffer, password);
      this.store.fileName = fileName;
      this.store.currentPageIndex = 0;
      this.store.isDocumentLoaded = true;
      this.clearSelection(false);
      useSelection().clear();
      this.store.pageTransforms = {};
      this.store.hiddenSpanIds.clear();
      this.store.pageVersions = {};
      if (this.canvasStore) {
        this.canvasStore.elements = [];
        this.canvasStore.selectElement(null);
        this.canvasStore.clearDragState();
      }
      this.store.pageCount = this.service.document.getPageCount();
      this.store.scannedPages = new Set();
      this.store.pageOcrResults = new Map();
      this.detectScannedPages();
      this.store.isOwnerUnlocked = this.service.document.isOwnerUnlocked();
      this.store.incrementRenderVersion();

      let thumbnailDataUri: string | undefined;
      if (this.store.pageCount > 0) {
        try {
          const { canvas } = this.service.document.getPage(0).render(0.2, { applyDpr: false });
          thumbnailDataUri = canvas.toDataURL('image/jpeg', 0.6);
        } catch (e) {
          console.error('Failed to generate thumbnail', e);
        }
      }

      const newFileId = crypto.randomUUID();
      setFileBuffer(newFileId, buffer);
      this.service.addFile({
        id: newFileId,
        fileName,
        thumbnail: thumbnailDataUri,
        sizeBytes: buffer.byteLength,
        canvasElements: [],
        pageTransforms: {},
        hiddenSpanIds: [],
        currentPageIndex: 0,
        pageVersions: {},
      });
      this.store.activeWorkspaceFileId = newFileId;
      this.historyStore?.initFile(newFileId);

      this.store.closePasswordPromptDialog();
      return true;
    } catch (err) {
      if (err instanceof PasswordRequiredError) {
        this.store.passwordPromptError = 'Incorrect password. Please try again.';
      } else {
        this.store.passwordPromptError =
          err instanceof Error ? err.message : 'Failed to decrypt document.';
      }
      return false;
    }
  }

  /**
   * Cancels the pending password prompt dialog and clears pending buffers.
   */
  cancelPasswordPrompt(): void {
    this.store.closePasswordPromptDialog();
  }

  /**
   * Applies ISO 32000 standard encryption, passwords, and permissions to the active document.
   */
  async applyPasswordSecurity(
    userPassword?: string,
    ownerPassword?: string,
    permissions?: number
  ): Promise<void> {
    if (!this.store.isDocumentLoaded) return;
    const fileId = this.store.activeWorkspaceFileId;
    if (!fileId) return;

    this.service.applyPasswordSecurity({
      userPassword,
      ownerPassword,
      permissions,
    });

    const encryptedBytes = await this.service.document.saveAsync(this.store.pageTransforms);
    const newBuffer = encryptedBytes.buffer.slice(
      encryptedBytes.byteOffset,
      encryptedBytes.byteOffset + encryptedBytes.byteLength
    ) as ArrayBuffer;

    const authPwd = ownerPassword || userPassword || '';
    setFileBuffer(fileId, newBuffer);
    this.service.loadDocumentFromBuffer(newBuffer, authPwd);
    this.store.isOwnerUnlocked = this.service.document.isOwnerUnlocked();
    this.store.incrementRenderVersion();
  }

  /**
   * Removes password security and permissions restrictions from the active document.
   */
  async removePasswordSecurity(ownerPassword?: string): Promise<boolean> {
    if (!this.store.isDocumentLoaded) return false;
    const fileId = this.store.activeWorkspaceFileId;
    if (!fileId) return false;

    try {
      this.service.removePasswordSecurity(ownerPassword);
      const decryptedBytes = await this.service.document.saveAsync(this.store.pageTransforms);
      const newBuffer = decryptedBytes.buffer.slice(
        decryptedBytes.byteOffset,
        decryptedBytes.byteOffset + decryptedBytes.byteLength
      ) as ArrayBuffer;

      setFileBuffer(fileId, newBuffer);
      this.service.loadDocumentFromBuffer(newBuffer);
      this.store.isOwnerUnlocked = true;
      this.store.incrementRenderVersion();
      return true;
    } catch (err) {
      console.error('Failed to remove password security:', err);
      throw err;
    }
  }

  /**
   * Authenticates with owner password to unlock administrative permissions.
   */
  unlockOwnerPermissions(password: string): boolean {
    if (!this.store.isDocumentLoaded) return false;
    const ok = this.service.unlockOwnerPermissions(password);
    this.store.isOwnerUnlocked = ok;
    return ok;
  }

  /**
   * Unlocks all interactive AcroForm fields and annotations with full undo/redo parity.
   */
  async unlockForms(): Promise<{ fieldsUnlockedCount: number; annotationsUnlockedCount: number }> {
    if (!this.store.isDocumentLoaded) {
      return { fieldsUnlockedCount: 0, annotationsUnlockedCount: 0 };
    }
    const fileId = this.store.activeWorkspaceFileId;
    if (!fileId) {
      return { fieldsUnlockedCount: 0, annotationsUnlockedCount: 0 };
    }

    const currentBytes = await this.service.document.saveAsync(this.store.pageTransforms);
    const prevBuffer = currentBytes.buffer.slice(
      currentBytes.byteOffset,
      currentBytes.byteOffset + currentBytes.byteLength
    ) as ArrayBuffer;

    const result = await this.service.unlockAcroFormFields(currentBytes);
    const newBuffer = result.unlockedBytes.buffer.slice(
      result.unlockedBytes.byteOffset,
      result.unlockedBytes.byteOffset + result.unlockedBytes.byteLength
    ) as ArrayBuffer;

    const cmd = new UnlockFormsCommand(
      `Unlock ${result.fieldsUnlockedCount} Form Fields`,
      fileId,
      prevBuffer,
      newBuffer,
      result.fieldsUnlockedCount,
      result.annotationsUnlockedCount
    );

    this.executeCommand(cmd);
    return {
      fieldsUnlockedCount: result.fieldsUnlockedCount,
      annotationsUnlockedCount: result.annotationsUnlockedCount,
    };
  }

  /**
   * Opens the granular permissions manager dialog.
   */
  openPermissionsDialog(): void {
    this.store.openPermissionsDialog();
  }

  /**
   * Applies granular permission flags to the active document.
   */
  async applyPermissions(permissions: PdfPermissionFlags, ownerPassword?: string): Promise<void> {
    const mask = computePermissionBitmask(permissions);
    await this.applyPasswordSecurity(undefined, ownerPassword, mask);
    this.store.closePermissionsDialog();
  }
}


/** Provide actions via Svelte context from a root component. */
export function provideEditorActions(actions: EditorActions): void {
  setContext(EDITOR_ACTIONS_KEY, actions);
}

/** Retrieve actions from Svelte context in any child component. */
export function useEditorActions(): EditorActions {
  return getContext<EditorActions>(EDITOR_ACTIONS_KEY);
}

/** Convert a ColorRgba object to a CSS rgba string. */
function colorToCss(c?: ColorRgba): string {
  if (!c) return 'rgba(0, 0, 0, 1)';
  const alpha = c.a !== undefined ? (c.a <= 1 ? c.a : c.a / 255) : 1;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

/** Check if a font or weight denotes bold typography. */
function isBoldTypography(rawFont?: string, weight?: string | number): boolean {
  if (typeof weight === 'number') return weight >= 600;
  if (weight === 'bold') return true;
  const raw = (rawFont || '').toLowerCase();
  return (
    raw.includes('bold') ||
    raw.includes('black') ||
    raw.includes('heavy') ||
    raw.includes('semibold') ||
    raw.includes('demibold') ||
    raw.includes('extrabold')
  );
}

/** Check if a font or style denotes italic typography. */
function isItalicTypography(rawFont?: string, style?: string): boolean {
  if (style === 'italic' || style === 'oblique') return true;
  const raw = (rawFont || '').toLowerCase();
  return raw.includes('italic') || raw.includes('oblique');
}

/**
 * Extracts structured multi-line and multi-segment typography from an EditableTextSpan,
 * preserving individual portion styles (bold, italic, font family, color, size).
 *
 * @param span The source native editable text span.
 * @param id The unique element ID for the created text element.
 * @return A fully populated TextElement.
 */
export function buildTextElementFromSpan(span: EditableTextSpan, id: string): TextElement {
  const sourceLines =
    span.lines && span.lines.length > 0
      ? span.lines
      : [
          {
            text: span.text,
            left: span.left,
            top: span.top,
            right: span.left + span.width,
            bottom: span.top + span.height,
            width: span.width,
            height: span.height,
            fontSize: span.fontSize,
            baselineY: span.baselineY,
            lineHeight: span.lineHeight || span.fontSize * 1.25,
            charStartIndex: span.charStartIndex,
            charCount: span.charCount,
            words: [],
            fontFamily: span.fontFamily,
            rawFontFamily: span.rawFontFamily,
            color: span.color,
            fontWeight: span.fontWeight,
            fontStyle: span.fontStyle,
          },
        ];

  const elementLines: TextElementLine[] = [];
  const allSegments: TextSegment[] = [];

  for (const line of sourceLines) {
    const lineSegments: TextSegment[] = [];
    const lineTopRel = Math.max(0, line.top - span.top);
    const lineLeftRel = Math.max(0, line.left - span.left);
    const lH = line.lineHeight || span.lineHeight || line.fontSize * 1.25;

    if (line.hasBulletPrefix && line.bulletWord) {
      const bWord = line.bulletWord;
      const bRawFont = bWord.rawFontFamily || line.rawFontFamily || span.rawFontFamily || 'Helvetica';
      const bDetectedFont = bWord.fontFamily || line.fontFamily || span.fontFamily || 'Helvetica';
      const bIsBold = isBoldTypography(bRawFont, bWord.fontWeight || line.fontWeight);
      const bIsItalic = isItalicTypography(bRawFont, bWord.fontStyle || line.fontStyle);
      const bColStr = colorToCss(bWord.color || line.color || span.color);
      const bFSize = bWord.fontSize || line.fontSize || span.fontSize;
      const bLeftRel = Math.max(0, bWord.left - span.left);
      const bTopRel = Math.max(0, (bWord.top ?? line.top) - span.top);

      const bulletSegment: TextSegment = {
        text: bWord.text,
        fontSize: bFSize,
        fontFamily: bDetectedFont,
        rawFontFamily: bRawFont,
        fontWeight: bIsBold ? 'bold' : 'normal',
        fontStyle: bIsItalic ? 'italic' : 'normal',
        color: bColStr,
        charStartIndex: bWord.charStartIndex,
        charCount: bWord.charCount,
        left: bLeftRel,
        top: bTopRel,
        width: bWord.width,
        height: bWord.height,
        baselineY: bWord.baselineY,
      };
      lineSegments.push(bulletSegment);
      allSegments.push(bulletSegment);
    }

    if (line.words && line.words.length > 0) {
      let currentSegmentWords: typeof line.words = [];
      let currentStyleKey = '';

      const flushSegment = (): void => {
        if (currentSegmentWords.length === 0) return;
        const firstW = currentSegmentWords[0];
        const lastW = currentSegmentWords[currentSegmentWords.length - 1];

        let segText = '';
        for (let wIdx = 0; wIdx < currentSegmentWords.length; wIdx++) {
          const w = currentSegmentWords[wIdx];
          if (wIdx > 0) {
            const prev = currentSegmentWords[wIdx - 1];
            const gap = w.left - prev.right;
            const endsWithWs = UNICODE_TRAILING_WS_REGEX.test(segText);
            const startsWithWs = UNICODE_LEADING_WS_REGEX.test(w.text);
            const hasSpace =
              !endsWithWs &&
              !startsWithWs &&
              (Boolean(w.hasPrecedingSpace) || gap >= Math.min(prev.fontSize, w.fontSize) * 0.12 || gap >= 0.5);
            if (hasSpace) {
              segText += ' ';
            }
          } else if (lineSegments.length > 0) {
            const prevSeg = lineSegments[lineSegments.length - 1];
            const endsWithWs = UNICODE_TRAILING_WS_REGEX.test(prevSeg.text);
            const startsWithWs = UNICODE_LEADING_WS_REGEX.test(w.text);
            const prevLeft = prevSeg.left ?? 0;
            const prevWidth = prevSeg.width ?? 0;
            const gap = w.left - (prevLeft + prevWidth);
            const hasSpace =
              !endsWithWs &&
              !startsWithWs &&
              (Boolean(w.hasPrecedingSpace) || gap >= 0.5);
            if (hasSpace) {
              segText += ' ';
            }
          }
          segText += w.text;
        }

        const rawFont = firstW.rawFontFamily || line.rawFontFamily || span.rawFontFamily || 'Helvetica';
        const detectedFont = firstW.fontFamily || line.fontFamily || span.fontFamily || 'Helvetica';
        const isBold = isBoldTypography(rawFont, firstW.fontWeight || line.fontWeight);
        const isItalic = isItalicTypography(rawFont, firstW.fontStyle || line.fontStyle);
        const colStr = colorToCss(firstW.color || line.color || span.color);
        const fSize = firstW.fontSize || line.fontSize || span.fontSize;

        const segLeftRel = Math.max(0, firstW.left - span.left);
        const segTopRel = Math.max(0, firstW.top - span.top);
        const segW = Math.max(1, lastW.right - firstW.left);
        const segH = Math.max(fSize * 1.1, lastW.bottom - firstW.top);

        const segment: TextSegment = {
          text: segText,
          fontSize: fSize,
          fontFamily: detectedFont,
          rawFontFamily: rawFont,
          fontWeight: isBold ? 'bold' : 'normal',
          fontStyle: isItalic ? 'italic' : 'normal',
          color: colStr,
          charStartIndex: firstW.charStartIndex,
          charCount: currentSegmentWords.reduce((sum, w) => sum + w.charCount, 0),
          left: segLeftRel,
          top: segTopRel,
          width: segW,
          height: segH,
          baselineY: firstW.baselineY,
        };

        lineSegments.push(segment);
        allSegments.push(segment);
        currentSegmentWords = [];
      };

      for (const word of line.words) {
        const rawFont = word.rawFontFamily || line.rawFontFamily || span.rawFontFamily || '';
        const isBold = isBoldTypography(rawFont, word.fontWeight || line.fontWeight);
        const isItalic = isItalicTypography(rawFont, word.fontStyle || line.fontStyle);
        const col = colorToCss(word.color || line.color || span.color);
        const fSize = Math.round((word.fontSize || line.fontSize || span.fontSize) * 10) / 10;

        const styleKey = `${rawFont}__${isBold}__${isItalic}__${col}__${fSize}`;

        if (currentSegmentWords.length > 0 && styleKey !== currentStyleKey) {
          flushSegment();
        }

        currentStyleKey = styleKey;
        currentSegmentWords.push(word);
      }

      flushSegment();
    } else {
      const rawFont = line.rawFontFamily || span.rawFontFamily || 'Helvetica';
      const detectedFont = line.fontFamily || span.fontFamily || 'Helvetica';
      const isBold = isBoldTypography(rawFont, line.fontWeight || span.fontWeight);
      const isItalic = isItalicTypography(rawFont, line.fontStyle || span.fontStyle);
      const colStr = colorToCss(line.color || span.color);
      const fSize = line.fontSize || span.fontSize;

      const segment: TextSegment = {
        text: line.text,
        fontSize: fSize,
        fontFamily: detectedFont,
        rawFontFamily: rawFont,
        fontWeight: isBold ? 'bold' : 'normal',
        fontStyle: isItalic ? 'italic' : 'normal',
        color: colStr,
        charStartIndex: line.charStartIndex,
        charCount: line.charCount,
        left: lineLeftRel,
        top: lineTopRel,
        width: line.width,
        height: line.height,
        baselineY: line.baselineY,
      };

      lineSegments.push(segment);
      allSegments.push(segment);
    }

    elementLines.push({
      text: line.text,
      segments: lineSegments,
      lineHeight: lH,
      top: lineTopRel,
      left: lineLeftRel,
      width: line.width,
      height: line.height,
      fontSize: line.fontSize || span.fontSize,
      baselineY: line.baselineY,
    });
  }

  const dominantRawFont = span.rawFontFamily || span.fontFamily || 'Helvetica';
  const dominantIsBold = isBoldTypography(dominantRawFont, span.fontWeight);
  const dominantIsItalic = isItalicTypography(dominantRawFont, span.fontStyle);

  const advanceBuffer = Math.max(8, Math.round(span.fontSize * 0.5 * 10) / 10);
  const maxLineWidth = elementLines.reduce(
    (max, l) => Math.max(max, (l.left || 0) + (l.width || 0)),
    span.width
  );
  const calculatedWidth = Math.ceil(Math.max(span.width, maxLineWidth) + advanceBuffer);

  return {
    id,
    kind: 'text',
    pageIndex: span.pageIndex,
    x: span.left,
    y: span.top,
    width: calculatedWidth,
    height: Math.ceil(span.height + 2),
    rotation: span.rotation || 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    text: span.text,
    fontSize: span.fontSize,
    fontFamily: span.fontFamily || 'Helvetica',
    rawFontFamily: span.rawFontFamily,
    color: colorToCss(span.color),
    fontWeight: dominantIsBold ? 'bold' : 'normal',
    fontStyle: dominantIsItalic ? 'italic' : 'normal',
    textAlign: 'left',
    lineHeight: span.lineHeight || span.fontSize * 1.25,
    lines: elementLines,
    segments: allSegments,
    originalSpan: span,
  };
}
