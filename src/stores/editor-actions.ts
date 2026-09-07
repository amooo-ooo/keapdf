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
import type { EditorStore } from './editor.svelte';
import { getFileBuffer, setFileBuffer } from './editor.svelte';
import type { CanvasStore } from './canvas.svelte';
import type { HistoryStore } from './history.svelte';
import type { EditorTool, CropUnit, CropScope } from './types';
import type { CanvasElement, TextElement, TextSegment, TextElementLine, ShapeElement } from './canvas-types';
import type { CanvasActions } from './canvas-actions';
import { downloadBytes } from '../utils/download-utils';
import { safeClone } from '../utils/clone-utils';
import { UNICODE_TRAILING_WS_REGEX, UNICODE_LEADING_WS_REGEX } from '../utils/text-range-utils';
import { useSelection } from './selection.svelte';
import { cropPages, resetCropPages, type PageCropMargins } from '../services/pdf/operations/crop-ops';
import {
  scalePages,
  transformCanvasElementsForScale,
  type ScalePageOptions,
  type PageScaleScope,
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
} from '../commands';
import { OcrService } from '../services/ocr';
import type { OcrPageResult } from '../services/ocr';
import type { ToolRegistry, ToolContext } from '../core/tool-registry';
import type { ExportRegistry } from '../core/export-registry';
import type { PluginManager } from '../core/plugin-manager';
import { findClosestGoogleFont, loadGoogleFont } from '../services/font-loader';
import { resolveDemoPreset } from '../services/demo-documents/registry';
import {
  fetchPdfFromUrl,
  formatUrlLoadErrorMessage,
  syncUrlParameter,
} from '../services/url-document-loader';
import { mergeFilesToPdfBuffer, isImageFile, inferImageMimeType } from '../services/file-merger';
import { documentConverter, type DocumentConversionOptions } from '../services/conversion';
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

export class EditorActions {
  /** DOM references for hidden file inputs. Set by the root component. */
  fileInputEl: HTMLInputElement | null = null;
  mergeFileInputEl: HTMLInputElement | null = null;
  imageFileInputEl: HTMLInputElement | null = null;
  imageAsPageFileInputEl: HTMLInputElement | null = null;
  mergeFilesInputEl: HTMLInputElement | null = null;

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
  ): Promise<MutateDocumentCommand | undefined> {
    const fileId = this.store.activeWorkspaceFileId;
    if (!fileId || !this.store.isDocumentLoaded) return;

    const prevSaved = this.service.document.save();
    const prevBuffer = getFileBuffer(fileId) ?? (prevSaved.buffer.slice(prevSaved.byteOffset, prevSaved.byteOffset + prevSaved.byteLength) as ArrayBuffer);
    const prevPageIndex = this.store.currentPageIndex;
    const prevElements = this.canvasStore ? safeClone(this.canvasStore.elements) : [];
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

    const savedBytes = this.service.document.save();
    const newBuffer = savedBytes.buffer.slice(
      savedBytes.byteOffset,
      savedBytes.byteOffset + savedBytes.byteLength
    ) as ArrayBuffer;

    const newElements = this.canvasStore ? safeClone(this.canvasStore.elements) : [];
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
      return;
    }

    let finalBuffer = buffer;
    let finalFileName = fileName;

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
      console.error('Failed to load PDF buffer:', err);
    }
  }

  async loadDocumentFromFile(file: File, addToWorkspace?: boolean): Promise<void> {
    try {
      let buffer = await file.arrayBuffer();
      let fileName = file.name;
      if (isImageFile(buffer, file.name) || file.type.startsWith('image/')) {
        const converted = await mergeFilesToPdfBuffer([
          { name: file.name, buffer, mimeType: file.type || inferImageMimeType(file.name) },
        ], this.service.engine);
        buffer = converted.buffer;
        fileName = converted.fileName;
      } else if (documentConverter.isConvertible(file.name, buffer, file.type)) {
        const converted = await documentConverter.convertDocument({
          name: file.name,
          buffer,
          mimeType: file.type,
        });
        buffer = converted.buffer;
        fileName = converted.fileName;
      }
      await this.loadDocumentFromBuffer(buffer, fileName, addToWorkspace);
    } catch (err) {
      console.error('Failed to read file:', err);
    }
  }

  async loadDocumentsFromFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    
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
            const converted = await mergeFilesToPdfBuffer([
              { name: file.name, buffer, mimeType: file.type || inferImageMimeType(file.name) },
            ], this.service.engine);
            buffer = converted.buffer;
            fileName = converted.fileName;
          } else if (documentConverter.isConvertible(file.name, buffer, file.type)) {
            const converted = await documentConverter.convertDocument({
              name: file.name,
              buffer,
              mimeType: file.type,
            });
            buffer = converted.buffer;
            fileName = converted.fileName;
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

  async convertAndLoadDocument(file: File, options?: DocumentConversionOptions): Promise<void> {
    this.store.isLoadingDocument = true;
    this.store.loadingProgress = `Converting ${file.name} to PDF...`;
    this.store.loadError = null;
    try {
      const buffer = await file.arrayBuffer();
      const converted = await documentConverter.convertDocument(
        { name: file.name, buffer, mimeType: file.type },
        options
      );
      await this.loadDocumentFromBuffer(converted.buffer, converted.fileName);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error during document conversion.';
      this.store.loadError = `Failed to convert document: ${message}`;
      console.error('Failed to convert document:', err);
    } finally {
      this.store.isLoadingDocument = false;
    }
  }

  // -- File input triggers --

  triggerFileOpen(addToWorkspace: boolean = false): void {
    this.isAddingToWorkspace = addToWorkspace;
    this.fileInputEl?.click();
  }

  triggerMergeFiles(): void {
    this.mergeFilesInputEl?.click();
  }

  /**
   * Merges multiple PDF files and or images as pages into a single document,
   * then immediately loads the resulting document into the workspace.
   *
   * @param files Array of File objects to merge.
   */
  async mergeAndLoadFiles(files: File[]): Promise<void> {
    if (!files || files.length === 0) return;

    this.store.isLoadingDocument = true;
    this.store.loadingProgress = `Merging ${files.length} files...`;
    this.store.loadError = null;

    try {
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
    const filesToMerge = fileIds
      .map(id => this.service.getFile(id))
      .filter((f): f is NonNullable<typeof f> => f !== undefined);
      
    if (filesToMerge.length < 2) return;
    
    // We will merge everything into the first selected file IN MEMORY
    const firstFile = filesToMerge[0];
    if (this.store.activeWorkspaceFileId !== firstFile.id) {
       await this.switchWorkspaceFile(firstFile.id);
    }
    
    await this.executeDocumentMutation('Merge Workspace Files', this.store.currentPageIndex, async () => {
      let targetIndex = atIndex !== undefined ? atIndex : this.store.pageCount;
      for (let i = 1; i < filesToMerge.length; i++) {
         const fileBuf = getFileBuffer(filesToMerge[i].id);
         if (!fileBuf) continue;
         const previousPageCount = this.store.pageCount;
         if (isImageFile(fileBuf, filesToMerge[i].fileName)) {
           await this.service.document.importImageAsPage(
             fileBuf,
             inferImageMimeType(filesToMerge[i].fileName),
             targetIndex,
           );
         } else {
           this.service.document.merge(fileBuf, targetIndex);
         }
         this.store.pageCount = this.service.document.getPageCount();
         if (atIndex !== undefined) {
             targetIndex += (this.store.pageCount - previousPageCount);
         }
      }
      
      // Remove the merged files from the workspace
      const idsToRemove = new Set(filesToMerge.slice(1).map(f => f.id));
      for (const id of idsToRemove) {
        this.service.removeFile(id);
        this.historyStore?.clearFile(id);
      }
    });

    useSelection().clear();
  }

  triggerImageImport(): void {
    this.imageFileInputEl?.click();
  }

  triggerImageImportAsPage(): void {
    this.imageAsPageFileInputEl?.click();
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

    if (this.canvasStore) {
      this.canvasStore.clearDragState();
      if (this.canvasStore.editingElementId) {
        this.canvasStore.selectElement(null);
      }
    }

    if (this.store.inlineEdit) {
      this.submitInlineEdit();
    }
    this.store.activeTool = tool;
    this.store.clearSelection();
    this.store.incrementRenderVersion();
  }

  // -- Zoom --

  setZoom(zoom: number): void {
    this.store.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
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

  // -- Text & Object editing --

  /**
   * Clears any active span or object selection.
   * Optionally commits active inline edits before clearing.
   *
   * @param commitActiveEdit Whether to submit active inline edits before clearing.
   */
  clearSelection(commitActiveEdit: boolean = true): void {
    if (commitActiveEdit && this.store.inlineEdit) {
      this.submitInlineEdit();
    }
    this.store.clearSelection();
  }

  /**
   * Selects a canvas or PDF overlay span, submitting any active inline edit beforehand.
   * If a text span is selected after an edit mutation, re-resolves the matching span
   * from the refreshed page data to guarantee up-to-date metrics and IDs.
   *
   * @param span The span to select.
   */
  selectSpan(span: EditableSpan): void {
    if (this.store.inlineEdit) {
      this.submitInlineEdit();
    }
    if (span.type === 'text' && this.store.isDocumentLoaded) {
      try {
        const pageSpans = this.service.document.getPage(span.pageIndex).extractTextSpans();
        const freshSpan = pageSpans.find(
          (s) => s.id === span.id || (Math.abs(s.left - span.left) < 20 && Math.abs(s.top - span.top) < 20)
        );
        this.store.selectedSpan = freshSpan || span;
      } catch {
        this.store.selectedSpan = span;
      }
    } else {
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
    if (this.store.inlineEdit) {
      if (this.store.inlineEdit.spanId === span.id) {
        return;
      }
      this.submitInlineEdit();
    }

    let targetSpan = span;
    if (this.store.isDocumentLoaded) {
      try {
        const pageSpans = this.service.document.getPage(span.pageIndex).extractTextSpans();
        const freshSpan = pageSpans.find(
          (s) => s.id === span.id || (Math.abs(s.left - span.left) < 20 && Math.abs(s.top - span.top) < 20)
        );
        if (freshSpan) {
          targetSpan = freshSpan;
        }
      } catch {}
    }

    this.store.selectedSpan = targetSpan;
    this.store.inlineEdit = {
      spanId: targetSpan.id,
      textValue: targetSpan.text,
      span: { ...targetSpan },
    };

    if (this.store.isDocumentLoaded) {
      try {
        this.service.document.getPage(targetSpan.pageIndex).hideTextSpan(targetSpan);
        this.store.hiddenSpanIds.add(targetSpan.id);
        this.service.document.invalidatePage(targetSpan.pageIndex);
        this.store.incrementPageVersion(targetSpan.pageIndex);
        this.refreshDocument();
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
  submitInlineEdit(extractedData?: { text: string; lines?: TextLine[] }): void {
    const { inlineEdit } = this.store;
    if (!inlineEdit) return;

    this.store.inlineEdit = null;
    this.store.hiddenSpanIds.delete(inlineEdit.spanId);

    const span = inlineEdit.span;
    const textValue = extractedData?.text ?? inlineEdit.textValue;
    const customLines = extractedData?.lines ?? inlineEdit.styledLines;

    if (textValue.trim().length > 0) {
      // Detect if span or custom lines have mixed font sizes across lines or words
      const hasMixedFontSize =
        (span.lines && span.lines.some((l) => Math.abs(l.fontSize - span.lines![0].fontSize) > 0.2)) ||
        (span.lines && span.lines.some((l) => l.words && l.words.some((w) => Math.abs(w.fontSize - l.words[0].fontSize) > 0.2))) ||
        (customLines && customLines.some((l) => Math.abs(l.fontSize - customLines[0].fontSize) > 0.2)) ||
        (customLines && customLines.some((l) => l.words && l.words.some((w) => Math.abs(w.fontSize - l.words[0].fontSize) > 0.2)));

      this.applyTextMutation(
        {
          text: textValue,
          fontSize: hasMixedFontSize ? undefined : span.fontSize,
          fontFamily: span.fontFamily,
          color: span.color,
          lineHeight: span.lineHeight,
          fontWeight: span.fontWeight,
          fontStyle: span.fontStyle,
          lines: customLines || span.lines,
          reflowParagraph: true,
        },
        span,
        false
      );
      this.recordSnapshot('Edit Text', true);
    } else {
      // Emptied paragraph: delete and shift downstream lines up
      this.service.document.getPage(span.pageIndex).deleteTextSpan(span);
      this.service.document.invalidatePage(span.pageIndex);
      this.store.clearSelection();
      this.store.incrementPageVersion(span.pageIndex);
      this.refreshDocument();
      this.recordSnapshot('Delete Text', true);
    }
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

      if (this.store.isDocumentLoaded) {
        try {
          const charsetIndex = this.service.document.fontCharsetIndex;
          this.service.document.getPage(span.pageIndex).replaceTextSpan(
            span,
            {
              text: span.text,
              fontSize: span.fontSize,
              fontFamily: span.fontFamily,
              color: span.color,
              lineHeight: span.lineHeight,
              fontWeight: span.fontWeight,
              fontStyle: span.fontStyle,
            },
            charsetIndex
          );
          this.service.document.invalidatePage(span.pageIndex);
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
    const charsetIndex = this.service.document.fontCharsetIndex;
    this.service.document.getPage(pageIndex).replaceTextSpan(spanToMutate, options, charsetIndex);
    this.service.document.invalidatePage(pageIndex);
    this.store.incrementPageVersion(pageIndex);
    this.refreshDocument();

    try {
      const updatedSpans = this.service.document.getPage(pageIndex).extractTextSpans();
      const targetLeft = options.left !== undefined ? options.left : spanToMutate.left;
      const matchingSpan = updatedSpans.find(
        (s) => Math.abs(s.left - targetLeft) < 25 && Math.abs(s.top - spanToMutate.top) < 25
      );
      if (matchingSpan) {
        this.store.selectedSpan = matchingSpan;
      } else {
        this.store.clearSelection();
      }
    } catch {
      this.store.clearSelection();
    }

    if (recordHistory) {
      this.recordSnapshot('Change Text Style', true);
    }
  }

  deleteSelectedSpan(): void {
    const { selectedSpan } = this.store;
    if (!selectedSpan || !this.store.isDocumentLoaded) return;
    
    if (selectedSpan.type === 'text') {
      this.service.document.getPage(selectedSpan.pageIndex).deleteTextSpan(selectedSpan);
    } else {
      this.service.document.getPage(selectedSpan.pageIndex).removeObject(selectedSpan.pdfObjectIndex);
    }
    this.service.document.invalidatePage(selectedSpan.pageIndex);
    this.store.clearSelection();
    this.store.incrementPageVersion(selectedSpan.pageIndex);
    this.refreshDocument();
    this.recordSnapshot('Delete PDF Object', true);
  }

  /**
   * Redacts a specific text character range on a page, permanently deleting only
   * the selected text characters from the PDF content stream (preserving neighbors)
   * and adding blackout shape elements.
   *
   * @param pageIndex Zero-based page index.
   * @param startCharIndex Starting character index (inclusive).
   * @param endCharIndex Ending character index (inclusive).
   * @param rects Array of bounding rectangles in DOM coordinates.
   * @param canvasStore The canvas store to add blackout elements to.
   */
  redactTextRange(
    pageIndex: number,
    startCharIndex: number,
    endCharIndex: number,
    rects: HighlightRect[],
    canvasStore: CanvasStore
  ): void {
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

        canvasStore.updateElement(targetElement.id, {
          text: updatedText,
        });
      }
    } else {
      // Redaction targeting raw PDFium content stream
      const page = this.service.document.getPage(pageIndex);
      page.redactTextRange(startCharIndex, endCharIndex);
      this.service.document.invalidatePage(pageIndex);
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

    this.store.clearSelection();
    this.store.incrementPageVersion(pageIndex);
    this.refreshDocument();
    this.recordSnapshot('Redact Text', true);
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
  redactArea(pageIndex: number, rects: HighlightRect[], canvasStore: CanvasStore): void {
    if (!this.store.isDocumentLoaded || rects.length === 0) return;

    const page = this.service.document.getPage(pageIndex);
    page.deleteTextInRects(rects);
    this.service.document.invalidatePage(pageIndex);

    // Purge or remove canvas elements on this page that are fully covered by any redaction rect
    const pageElements = canvasStore.getElementsByPage(pageIndex);
    for (const el of pageElements) {
      if (el.kind === 'shape' && (el as any).fill === '#000000' && (el as any).strokeWidth === 0) {
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

    this.store.clearSelection();
    this.store.incrementPageVersion(pageIndex);
    this.refreshDocument();
    this.recordSnapshot('Redact Area', true);
  }

  /**
   * Redacts text across the specified rectangles on a page.
   * Alias for redactArea.
   *
   * @param pageIndex Zero-based page index.
   * @param rects Array of bounding rectangles in DOM coordinates.
   * @param canvasStore The canvas store to add blackout elements to.
   */
  redactText(pageIndex: number, rects: HighlightRect[], canvasStore: CanvasStore): void {
    this.redactArea(pageIndex, rects, canvasStore);
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
    if (!this.store.isDocumentLoaded) return;
    const indices = this.getTargetPageIndices(index);
    for (const idx of indices) {
      this.service.document.getPage(idx).rotate(90);
      if (this.store.pageTransforms[idx]) {
        this.store.pageTransforms[idx].rotation = 0;
      }
      this.store.incrementPageVersion(idx);
    }
    this.refreshDocument();
    this.recordSnapshot('Rotate Page', true);
  }

  flattenPage(index: number): void {
    if (!this.store.isDocumentLoaded) return;
    const indices = this.getTargetPageIndices(index);
    for (const idx of indices) {
      this.service.document.getPage(idx).flatten();
      this.store.incrementPageVersion(idx);
    }
    this.recordSnapshot('Flatten Page', true);
  }

  async rasterizePage(index: number): Promise<void> {
    if (!this.store.isDocumentLoaded) return;
    const indices = this.getTargetPageIndices(index);
    
    try {
      for (const idx of indices) {
        // Render at 3x scale for high-quality rasterization
        const blob = await this.service.document.getPage(idx).exportAsBlob('jpeg', 3.0);
        const buffer = await blob.arrayBuffer();
        
        await this.service.document.importImageAsPage(buffer, 'image/jpeg', idx);
        this.service.document.deletePage(idx + 1);
        this.store.incrementPageVersion(idx);
      }
      this.refreshDocument();
      useSelection().clear();
      this.recordSnapshot('Rasterize Page', true);
    } catch (err) {
      console.error('Failed to rasterize pages:', err);
    }
  }

  /**
   * Remap page indices across canvas elements, page transforms, and page versions
   * after a structural page operation.
   *
   * @param indexMap A function mapping old page indices to new page indices, or -1 for deleted pages.
   */
  private remapPageIndices(indexMap: (oldIndex: number) => number): void {
    if (!this.canvasStore) return;

    // Remap canvas elements, removing those on deleted pages.
    this.canvasStore.elements = this.canvasStore.elements
      .map(el => {
        const newIndex = indexMap(el.pageIndex);
        if (newIndex < 0) return null;
        return newIndex === el.pageIndex ? el : { ...el, pageIndex: newIndex };
      })
      .filter((el): el is CanvasElement => el !== null);

    // Remap page transforms.
    const oldTransforms = this.store.pageTransforms;
    const newTransforms: Record<number, typeof oldTransforms[number]> = {};
    for (const [key, value] of Object.entries(oldTransforms)) {
      const newIndex = indexMap(Number(key));
      if (newIndex >= 0) {
        newTransforms[newIndex] = value;
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
    this.store.pageVersions = newVersions;
  }

  deletePage(index: number): void {
    if (!this.store.isDocumentLoaded || this.store.pageCount <= 1) return;
    const indices = this.getTargetPageIndices(index);
    
    for (const idx of indices) {
      if (this.service.document.getPageCount() <= 1) break; // Cannot delete the last page
      this.service.document.deletePage(idx);
      const deletedIndex = idx;
      this.remapPageIndices((old) => {
        if (old === deletedIndex) return -1;
        if (old > deletedIndex) return old - 1;
        return old;
      });
    }
    
    this.store.currentPageIndex = Math.max(0, Math.min(this.store.currentPageIndex, this.service.document.getPageCount() - 1));
    this.refreshDocument();
    useSelection().clear();
    this.recordSnapshot('Delete Page', true);
  }

  addBlankPage(afterIndex: number): void {
    if (!this.store.isDocumentLoaded) return;
    const indices = this.getTargetPageIndices(afterIndex);
    for (const idx of indices) {
      this.service.document.addBlankPage(idx + 1);
      const atIndex = idx + 1;
      this.remapPageIndices((old) => old >= atIndex ? old + 1 : old);
    }
    this.refreshDocument();
    useSelection().clear();
    this.recordSnapshot('Add Blank Page', true);
  }

  duplicatePage(index: number): void {
    if (!this.store.isDocumentLoaded) return;
    const indices = this.getTargetPageIndices(index);
    for (const idx of indices) {
      this.service.document.duplicatePage(idx);
    }
    this.refreshDocument();
    useSelection().clear();
    this.recordSnapshot('Duplicate Page', true);
  }

  reorderPages(fromIndices: number[], toIndex: number): void {
    if (!this.store.isDocumentLoaded || fromIndices.length === 0) return;
    
    const activePage = this.store.currentPageIndex;
    
    this.service.document.reorderPages(fromIndices, toIndex);
    
    this.remapPageIndices((old) => {
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
    });

    this.refreshDocument();
    
    // Update active page tracking so viewer doesn't jump
    if (fromIndices.includes(activePage)) {
      const sortedFrom = [...fromIndices].sort((a, b) => a - b);
      const offset = sortedFrom.indexOf(activePage);
      this.store.currentPageIndex = toIndex + offset;
    } else {
      let newIdx = activePage;
      const removedBefore = fromIndices.filter(i => i < activePage).length;
      newIdx -= removedBefore;
      if (toIndex <= newIdx) {
        newIdx += fromIndices.length;
      }
      this.store.currentPageIndex = newIdx;
    }
    
    const selection = useSelection();
    selection.clear();
    for (let i = 0; i < fromIndices.length; i++) {
      selection.select(`page_${toIndex + i}`, true, false);
    }
    this.recordSnapshot('Reorder Pages', true);
  }

  mergePdfFromFile(file: File, atIndex: number): void {
    this.mergePdfsFromFiles([file], atIndex);
  }

  async mergePdfsFromFiles(files: File[], atIndex: number): Promise<void> {
    try {
      let currentIndex = atIndex;
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const previousPageCount = this.store.pageCount;
        this.service.document.merge(buf, currentIndex);
        this.store.pageCount = this.service.document.getPageCount();
        currentIndex += (this.store.pageCount - previousPageCount);
      }
      this.refreshDocument();
      this.recordSnapshot('Merge PDF', true);
    } catch (err) {
      console.error('Failed to merge PDF files:', err);
    }
  }

  async importImagesFromFiles(files: File[], atIndex: number): Promise<void> {
    try {
      let currentIndex = atIndex;
      for (const file of files) {
        const buf = await file.arrayBuffer();
        this.service.document.importImageAsPage(buf, file.type, currentIndex);
        currentIndex++;
      }
      this.refreshDocument();
      this.recordSnapshot('Import Image Page', true);
    } catch (err) {
      console.error('Failed to import images as pages:', err);
    }
  }

  async extractPages(indices: number[], mode: 'split' | 'extract', rangeString: string): Promise<void> {
    if (!this.store.isDocumentLoaded) return;
    
    try {
      const splitBytes = this.service.document.split(indices);
      const splitBuffer = splitBytes.buffer.slice(splitBytes.byteOffset, splitBytes.byteOffset + splitBytes.byteLength) as ArrayBuffer;
      
      if (mode === 'split') {
        const sortedIndices = [...indices].sort((a, b) => b - a);
        for (const idx of sortedIndices) {
          if (this.service.document.getPageCount() > 1) {
            this.service.document.deletePage(idx);
          }
        }
        this.store.pageCount = this.service.document.getPageCount();
        this.store.currentPageIndex = Math.max(0, Math.min(this.store.currentPageIndex, this.store.pageCount - 1));
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
    } catch (err) {
      console.error('Failed to extract pages:', err);
      throw err;
    }
  }

  // -- Text overlay --

  addTextOverlay(
    pageIndex: number,
    text: string,
    posX: number,
    posY: number,
    fontSize: number,
  ): void {
    if (!this.store.isDocumentLoaded) return;
    this.service.document.getPage(pageIndex).drawText({text, x: posX, y: posY, fontSize: fontSize, color: '#000000', fontFamily: 'Helvetica'});
    this.store.incrementPageVersion(pageIndex);
    this.recordSnapshot('Add Text Overlay', true);
  }

  // -- Export --

  async applyCanvasComponentsToPdf(elements: CanvasElement[], onApplied?: () => void): Promise<void> {
    const hasTransforms = Object.values(this.store.pageTransforms).some(
      t => t && (t.rotation !== 0 || t.scaleX !== 1 || t.scaleY !== 1)
    );
    if (!this.store.isDocumentLoaded || (elements.length === 0 && !hasTransforms)) return;
    try {
      await this.service.applyCanvasElementsToPdf(elements, this.store.pageTransforms);
      
      const affectedPages = new Set(elements.map(e => e.pageIndex));
      for (const pIdx of Object.keys(this.store.pageTransforms)) {
        affectedPages.add(parseInt(pIdx, 10));
      }
      for (const pageIndex of affectedPages) {
        this.store.incrementPageVersion(pageIndex);
      }
      
      this.store.pageTransforms = {};
      this.refreshDocument();
      
      if (onApplied) {
        onApplied();
      }
      this.recordSnapshot('Bake Canvas Components', true);
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
      const finalBytes = await this.service.document.saveAsync(this.store.pageTransforms);
      const bufferArray = finalBytes.buffer.slice(finalBytes.byteOffset, finalBytes.byteOffset + finalBytes.byteLength) as ArrayBuffer;
      this.service.loadDocumentFromBuffer(bufferArray);
      this.store.pageTransforms = {};
      this.refreshDocument();
      this.recordSnapshot('Bake Page Transforms', true);
    } catch (err) {
      console.error('Failed to bake page transforms into PDF:', err);
    }
  }

  extractObjectToCanvas(type: 'image' | 'shape' | 'text', span: EditableImageSpan | EditableShapeSpan | EditableTextSpan, canvasStore: CanvasStore): string | undefined {
    if (!this.store.isDocumentLoaded) return;
    if (!canvasStore) return;

    const newId = canvasStore.generateId();

    if (type === 'image') {
      const imgSpan = span as EditableImageSpan;
      canvasStore.elements.push({
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
      } as CanvasElement);
    } else if (type === 'shape') {
      const shapeSpan = span as EditableShapeSpan;
      canvasStore.elements.push({
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
      } as CanvasElement);
    } else if (type === 'text') {
      const textSpan = span as EditableTextSpan;
      const textElement = buildTextElementFromSpan(textSpan, newId);
      canvasStore.elements.push(textElement);
      this.service.document.getPage(span.pageIndex).hideTextSpan(textSpan);
      this.store.hiddenSpanIds.add(span.id);
    }

    if (type !== 'text') {
      this.service.document.getPage(span.pageIndex).removeObject((span as EditableImageSpan | EditableShapeSpan).pdfObjectIndex);
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

    this.recordSnapshot('Extract Object to Canvas', true);

    return newId;
  }

  async exportPdf(canvasStore?: CanvasStore): Promise<void> {
    if (!this.store.isDocumentLoaded) return;
    try {
      if (canvasStore && canvasStore.elements.length > 0) {
        await this.burnCanvasToPdf(canvasStore);
      }
      const bytes = await this.service.document.saveAsync(this.store.pageTransforms);
      downloadBytes(bytes, `edited_${this.store.fileName}`, 'application/pdf');
    } catch (err) {
      console.error('Failed to export PDF:', err);
    }
  }

  private async burnCanvasToPdf(canvasStore: CanvasStore): Promise<void> {
    const pageCount = this.service.document.getPageCount();
    for (const el of canvasStore.elements) {
      if (el.pageIndex >= pageCount) continue;
      const page = this.service.document.getPage(el.pageIndex);
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
        if (el.variant === 'rectangle') {
          page.drawRectangle({
            x: el.x, y: el.y, width: el.width, height: el.height,
            fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth,
            rotation: el.rotation, flipX: el.flipX, flipY: el.flipY
          });
        } else if (el.variant === 'circle') {
          page.drawCircle({
            x: el.x, y: el.y, width: el.width, height: el.height,
            fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth,
            rotation: el.rotation, flipX: el.flipX, flipY: el.flipY
          });
        } else if (el.variant === 'line') {
          page.drawLine({
            x: el.x, y: el.y, width: el.width, height: el.height,
            stroke: el.stroke, strokeWidth: el.strokeWidth,
            rotation: el.rotation, flipX: el.flipX, flipY: el.flipY
          });
        } else if (el.variant === 'arrow') {
          page.drawArrow({
            x: el.x, y: el.y, width: el.width, height: el.height,
            stroke: el.stroke, strokeWidth: el.strokeWidth,
            rotation: el.rotation, flipX: el.flipX, flipY: el.flipY
          });
        }
      } else if (el.kind === 'path') {
        page.drawPath({
          points: el.points,
          x: el.x, y: el.y, width: el.width, height: el.height,
          stroke: el.stroke, strokeWidth: el.strokeWidth,
          opacity: el.opacity, isHighlight: el.isHighlight,
          rotation: el.rotation, flipX: el.flipX, flipY: el.flipY
        });
      } else if (el.kind === 'image') {
        if (el.src) {
          const imgData = await this.getImageDataFromSrc(el.src);
          page.drawImage({
            id: el.id,
            x: el.x, y: el.y, width: el.width, height: el.height,
            objectFit: el.objectFit as any,
            imageData: {
              width: imgData.width,
              height: imgData.height,
              imgData: imgData
            },
            rotation: el.rotation, flipX: el.flipX, flipY: el.flipY
          });
        }
      } else if (el.kind === 'form-field') {
        page.drawFormFieldPlaceholder({
          id: el.id,
          variant: el.variant,
          label: el.label,
          placeholder: el.placeholder,
          x: el.x, y: el.y, width: el.width, height: el.height,
          rotation: el.rotation, flipX: el.flipX, flipY: el.flipY
        });
        page.addAcroFormField({
          id: el.id,
          variant: el.variant,
          label: el.label,
          placeholder: el.placeholder,
          x: el.x, y: el.y, width: el.width, height: el.height,
          rotation: el.rotation, flipX: el.flipX, flipY: el.flipY
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

    canvasStore.elements = [];
    canvasStore.clearDragState();
    canvasStore.selectElement(null);
    this.refreshDocument();
  }

  private async getImageDataFromSrc(src: string): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get 2D context'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, img.width, img.height));
      };
      img.onerror = reject;
      img.crossOrigin = 'anonymous';
      img.src = src;
    });
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
    const summary = await this.service.sanitizeActiveDocument(options, this.store.pageTransforms);
    this.store.pageTransforms = {};
    this.refreshDocument();

    if (this.store.activeWorkspaceFileId) {
      const activeFile = this.service.getFile(this.store.activeWorkspaceFileId);
      if (activeFile) {
        const savedBytes = this.service.document.save();
        const bufferArray = savedBytes.buffer.slice(
          savedBytes.byteOffset,
          savedBytes.byteOffset + savedBytes.byteLength
        ) as ArrayBuffer;
        setFileBuffer(activeFile.id, bufferArray);
        activeFile.sizeBytes = bufferArray.byteLength;
      }
    }

    this.recordSnapshot('Sanitize Document', true);

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
      await this.burnCanvasToPdf(canvasStore);
    }

    const currentBytes = await this.service.document.saveAsync(this.store.pageTransforms);
    const imposedBytes = await applyImposition(currentBytes, config);

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
      this.store.pageTransforms = {};
      this.service.loadDocumentFromBuffer(imposedBuffer);
      this.store.fileName = newFileName;
      this.store.currentPageIndex = 0;
      this.store.pageCount = this.service.document.getPageCount();
      this.store.clearSelection();
      this.store.pageVersions = {};
      this.refreshDocument();
      this.recordSnapshot('Apply Imposition', true);
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
      const { bytes } = await this.service.document.updateMetadata(updates);
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;

      if (this.store.activeWorkspaceFileId) {
        setFileBuffer(this.store.activeWorkspaceFileId, buffer);
      }

      this.service.loadDocumentFromBuffer(buffer);
      this.store.incrementRenderVersion();
      this.recordSnapshot('Update Metadata', true);
    } catch (err) {
      console.error('Failed to update document metadata:', err);
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
      const dims = this.service.document.getPage(pageIdx).getDimensions();
      centerX = Math.max(20, (dims.widthPts - defaultWidth) / 2);
      centerY = Math.max(20, (dims.heightPts - defaultHeight) / 2);
    } catch {
      // Fallback
    }

    if (canvasStore) {
      const elementId = canvasStore.generateId();
      canvasStore.addElement({
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
      });
      canvasStore.selectElement(elementId);
    }

    this.store.showEsignDialog = false;
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

    const signedBytes = await this.service.signActiveDocument(options, this.store.pageTransforms);

    if (this.store.activeWorkspaceFileId) {
      const buffer = signedBytes.buffer.slice(
        signedBytes.byteOffset,
        signedBytes.byteOffset + signedBytes.byteLength
      ) as ArrayBuffer;
      setFileBuffer(this.store.activeWorkspaceFileId, buffer);
    }

    this.store.incrementRenderVersion();
    this.recordSnapshot('Sign Document', true);
    return signedBytes;
  }

  /**
   * Inspects and validates all ISO 32000 digital signatures present in the active document.
   *
   * @return A promise resolving to an array of signature validation reports.
   */
  async validateActiveDocumentSignatures(): Promise<SignatureValidationResult[]> {
    return this.service.validateActiveDocumentSignatures(this.store.pageTransforms);
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
            if (gap >= Math.min(prev.fontSize, w.fontSize) * 0.18) {
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

  return {
    id,
    kind: 'text',
    pageIndex: span.pageIndex,
    x: span.left,
    y: span.top,
    width: span.width,
    height: span.height,
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
