import { getContext, setContext } from 'svelte';

import type { PdfEditorService } from '../services/pdf-editor';
import type { 
  EditableSpan,
  EditableTextSpan, 
  EditableImageSpan, 
  EditableShapeSpan,
  TextMutationOptions,
  TextLine,
  SanitizeOptions,
  SanitizeSummary,
  SanitizationInspection,
  HighlightRect,
  DocumentMetadata,
  DocumentMetadataUpdate,
} from '../core/types';
import type { EditorStore } from './editor.svelte';
import { getFileBuffer, setFileBuffer } from './editor.svelte';
import type { CanvasStore } from './canvas.svelte';
import type { HistoryStore } from './history.svelte';
import type { HistorySnapshot } from './history-types';
import type { EditorTool } from './types';
import type { CanvasElement, TextElement, TextSegment, TextElementLine } from './canvas-types';
import { downloadBytes } from '../utils/download-utils';
import { useSelection } from './selection.svelte';
import type { ImpositionConfig } from '../services/pdf/operations/types';
import type { ColorRgba } from '../core/types';
import { applyImposition } from '../services/pdf/operations/imposition-ops';
import type { SavedSignature } from '../services/signature-storage';
import type { SignPdfOptions, SignatureValidationResult } from '../services/pdf/operations/signature-ops';
import { isSyntheticCanvasCharIndex, resolveCanvasTextChar } from '../services/pdf/unified-text-provider';

const EDITOR_ACTIONS_KEY = Symbol('editor-actions');

/** Minimum and maximum zoom bounds. */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5.0;
const ZOOM_STEP = 1.2;

export class EditorActions {
  /** DOM references for hidden file inputs. Set by the root component. */
  fileInputEl: HTMLInputElement | null = null;
  mergeFileInputEl: HTMLInputElement | null = null;
  imageFileInputEl: HTMLInputElement | null = null;
  imageAsPageFileInputEl: HTMLInputElement | null = null;

  /**
   * Scroll callback registered by Canvas.svelte.
   * Called when programmatic page navigation requires a scroll.
   */
  private scrollCallback: ((index: number) => void) | null = null;
  
  private isAddingToWorkspace: boolean = false;

  constructor(
    public readonly store: EditorStore,
    public readonly service: PdfEditorService,
    public readonly historyStore?: HistoryStore,
    public canvasStore?: CanvasStore,
  ) {}

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
  captureSnapshot(
    description: string,
    forcePdfSave: boolean = false,
    explicitFileId?: string,
    explicitFileName?: string,
    explicitBuffer?: ArrayBuffer,
  ): HistorySnapshot {
    const fileId = explicitFileId ?? this.store.activeWorkspaceFileId ?? 'default-file';
    const fileName = explicitFileName ?? this.store.fileName;
    let docBuffer = explicitBuffer ?? getFileBuffer(fileId);

    if (forcePdfSave || !docBuffer) {
      if (this.store.isDocumentLoaded) {
        try {
          const savedBytes = this.service.document.save();
          const bufferArray = savedBytes.buffer.slice(
            savedBytes.byteOffset,
            savedBytes.byteOffset + savedBytes.byteLength
          ) as ArrayBuffer;
          setFileBuffer(fileId, bufferArray);
          docBuffer = bufferArray;
        } catch (err) {
          console.warn('Failed to save document buffer during snapshot capture:', err);
          if (!docBuffer) {
            docBuffer = new ArrayBuffer(0);
          }
        }
      } else {
        docBuffer = new ArrayBuffer(0);
      }
    }

    const canvasElements = this.canvasStore ? structuredClone(this.canvasStore.elements) : [];
    const selectedElementId = this.canvasStore?.selectedElementId ?? null;

    return {
      id: crypto.randomUUID(),
      description,
      timestamp: Date.now(),
      fileId,
      fileName,
      pageIndex: this.store.currentPageIndex,
      documentBuffer: docBuffer,
      canvasElements,
      pageTransforms: { ...this.store.pageTransforms },
      hiddenSpanIds: Array.from(this.store.hiddenSpanIds),
      selectedElementId,
    };
  }

  /**
   * Records a snapshot of the current state onto the active file history stack.
   *
   * @param description Description of the mutation.
   * @param forcePdfSave Whether the underlying PDFium document was modified.
   */
  recordSnapshot(description: string, forcePdfSave: boolean = false): void {
    if (!this.historyStore) return;
    const snapshot = this.captureSnapshot(description, forcePdfSave);
    this.historyStore.pushSnapshot(snapshot);
  }

  /**
   * Queues a debounced snapshot capture for continuous property adjustments.
   *
   * @param description Description of the mutation.
   * @param delayMs Debounce delay in milliseconds. Defaults to 300ms.
   */
  recordDebouncedSnapshot(description: string, delayMs: number = 300): void {
    if (!this.historyStore) return;
    this.historyStore.recordDebounced(() => this.captureSnapshot(description, false), delayMs);
  }

  /**
   * Restores a history snapshot into the active editor, canvas, and PDFium document state.
   *
   * @param snapshot The target snapshot to restore.
   */
  async restoreSnapshot(snapshot: HistorySnapshot): Promise<void> {
    if (this.store.inlineEdit) {
      this.cancelInlineEdit();
    }

    const currentBuffer = this.store.activeWorkspaceFileId
      ? getFileBuffer(this.store.activeWorkspaceFileId)
      : undefined;

    const needsBufferReload =
      !this.store.isDocumentLoaded ||
      currentBuffer !== snapshot.documentBuffer ||
      this.store.fileName !== snapshot.fileName;

    if (needsBufferReload && snapshot.documentBuffer.byteLength > 0) {
      setFileBuffer(snapshot.fileId, snapshot.documentBuffer);
      this.service.loadDocumentFromBuffer(snapshot.documentBuffer);
      this.store.fileName = snapshot.fileName;
      this.store.isDocumentLoaded = true;
      this.store.pageCount = this.service.document.getPageCount();
    }

    this.store.activeWorkspaceFileId = snapshot.fileId;
    this.historyStore?.setActiveFileId(snapshot.fileId);

    // Restore canvas overlay elements
    if (this.canvasStore) {
      this.canvasStore.elements = structuredClone(snapshot.canvasElements);
      this.canvasStore.selectElement(snapshot.selectedElementId);
      this.canvasStore.clearDragState();
    }

    // Restore page transforms
    this.store.pageTransforms = { ...snapshot.pageTransforms };

    // Restore hidden spans
    this.store.hiddenSpanIds.clear();
    for (const spanId of snapshot.hiddenSpanIds) {
      this.store.hiddenSpanIds.add(spanId);
    }

    // Restore active page index bounded to valid range
    const maxPageIndex = Math.max(0, this.service.document.getPageCount() - 1);
    this.store.currentPageIndex = Math.max(0, Math.min(snapshot.pageIndex, maxPageIndex));

    this.store.clearSelection();
    this.store.incrementRenderVersion();
    this.refreshDocument();
  }

  /**
   * Performs an undo operation for the active workspace file.
   *
   * @return Promise resolving to true if undo succeeded, false otherwise.
   */
  async undo(): Promise<boolean> {
    if (!this.historyStore || !this.historyStore.canUndo) return false;
    const previousSnapshot = this.historyStore.undo(this.store.activeWorkspaceFileId ?? undefined);
    if (!previousSnapshot) return false;
    await this.restoreSnapshot(previousSnapshot);
    return true;
  }

  /**
   * Performs a redo operation for the active workspace file.
   *
   * @return Promise resolving to true if redo succeeded, false otherwise.
   */
  async redo(): Promise<boolean> {
    if (!this.historyStore || !this.historyStore.canRedo) return false;
    const nextSnapshot = this.historyStore.redo(this.store.activeWorkspaceFileId ?? undefined);
    if (!nextSnapshot) return false;
    await this.restoreSnapshot(nextSnapshot);
    return true;
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

  async loadDocumentFromBuffer(buffer: ArrayBuffer, fileName: string): Promise<void> {
    if (!this.store.isInitialized) {
      return;
    }

    if (this.isAddingToWorkspace) {
      await this.saveActiveFileToWorkspace();
    }

    try {
      this.service.loadDocumentFromBuffer(buffer);
      this.store.fileName = fileName;
      this.store.currentPageIndex = 0;
      this.store.isDocumentLoaded = true;
      this.store.clearSelection();
      this.store.hiddenSpanIds.clear();
      this.store.pageCount = this.service.document.getPageCount();
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
      if (!this.isAddingToWorkspace) {
        this.service.clearWorkspace();
        this.historyStore?.clearAll();
      }
      setFileBuffer(newFileId, buffer);
      this.service.addFile({
        id: newFileId,
        fileName,
        thumbnail: thumbnailDataUri,
        sizeBytes: buffer.byteLength
      });
      this.store.activeWorkspaceFileId = newFileId;
      const initialSnapshot = this.captureSnapshot('Open Document', false, newFileId, fileName, buffer);
      this.historyStore?.initFile(newFileId, initialSnapshot);
    } catch (err) {
      console.error('Failed to load PDF buffer:', err);
    }
  }

  async loadDocumentFromFile(file: File): Promise<void> {
    try {
      const buffer = await file.arrayBuffer();
      await this.loadDocumentFromBuffer(buffer, file.name);
    } catch (err) {
      console.error('Failed to read file:', err);
    }
  }

  async loadDocumentsFromFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    
    // Clear workspace if we're completely replacing it, only ONCE
    if (!this.isAddingToWorkspace) {
      this.service.clearWorkspace();
    }

    // Now we must ensure subsequent files in this batch don't clear it
    const originalIsAdding = this.isAddingToWorkspace;
    try {
      this.isAddingToWorkspace = true;

      for (const file of files) {
        try {
          const buffer = await file.arrayBuffer();
          await this.loadDocumentFromBuffer(buffer, file.name);
        } catch (err) {
          console.error('Failed to read file:', err);
        }
      }
    } finally {
      // Restore the original state
      this.isAddingToWorkspace = originalIsAdding;
    }
  }

  // -- File input triggers --

  triggerFileOpen(addToWorkspace: boolean = false): void {
    this.isAddingToWorkspace = addToWorkspace;
    this.fileInputEl?.click();
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

  mergeWorkspaceFiles(fileIds: string[], atIndex?: number): void {
    const filesToMerge = fileIds
      .map(id => this.service.getFile(id))
      .filter((f): f is NonNullable<typeof f> => f !== undefined);
      
    if (filesToMerge.length < 2) return;
    
    // We will merge everything into the first selected file IN MEMORY
    const firstFile = filesToMerge[0];
    if (this.store.activeWorkspaceFileId !== firstFile.id) {
       this.switchWorkspaceFile(firstFile.id);
    }
    
    let targetIndex = atIndex !== undefined ? atIndex : this.store.pageCount;
    for (let i = 1; i < filesToMerge.length; i++) {
       const fileBuf = getFileBuffer(filesToMerge[i].id);
       if (!fileBuf) continue;
       const previousPageCount = this.store.pageCount;
       this.service.document.merge(fileBuf, targetIndex);
       this.store.pageCount = this.service.document.getPageCount();
       if (atIndex !== undefined) {
           targetIndex += (this.store.pageCount - previousPageCount);
       }
    }
    
    // Remove the merged files from the workspace
    const idsToRemove = new Set(filesToMerge.slice(1).map(f => f.id));
    for (const id of idsToRemove) {
      this.service.removeFile(id);
    }
    
    this.refreshDocument();
    useSelection().clear();
    this.recordSnapshot('Merge Workspace Files', true);
  }

  triggerImageImport(): void {
    this.imageFileInputEl?.click();
  }

  triggerImageImportAsPage(): void {
    this.imageAsPageFileInputEl?.click();
  }
  
  // -- Workspace --
  
  async saveActiveFileToWorkspace(): Promise<void> {
    if (this.store.activeWorkspaceFileId && this.store.isDocumentLoaded) {
      const currentActiveFile = this.service.getFile(this.store.activeWorkspaceFileId);
      if (currentActiveFile) {
        try {
          const hasTransforms = Object.values(this.store.pageTransforms).some(
            t => t && (t.rotation !== 0 || t.scaleX !== 1 || t.scaleY !== 1)
          );
          if (hasTransforms) {
            const latestBuffer = await this.service.document.saveAsync(this.store.pageTransforms);
            const bufferArray = latestBuffer.buffer.slice(latestBuffer.byteOffset, latestBuffer.byteOffset + latestBuffer.byteLength) as ArrayBuffer;
            setFileBuffer(currentActiveFile.id, bufferArray);
            currentActiveFile.sizeBytes = bufferArray.byteLength;
          } else {
            const latestBuffer = this.service.document.save();
            const bufferArray = latestBuffer.buffer.slice(latestBuffer.byteOffset, latestBuffer.byteOffset + latestBuffer.byteLength) as ArrayBuffer;
            setFileBuffer(currentActiveFile.id, bufferArray);
            currentActiveFile.sizeBytes = bufferArray.byteLength;
          }
        } catch (err) {
          console.warn('Failed to export current file state to workspace:', err);
        }
      }
    }
  }

