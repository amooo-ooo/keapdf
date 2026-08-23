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

  async switchWorkspaceFile(id: string): Promise<void> {
    if (this.store.activeWorkspaceFileId === id) return;

    await this.saveActiveFileToWorkspace();

    const file = this.service.getFile(id);
    if (!file) return;

    const fileBuffer = getFileBuffer(id);
    if (!fileBuffer) return;

    try {
      this.service.loadDocumentFromBuffer(fileBuffer);
      this.store.fileName = file.fileName;
      this.store.currentPageIndex = 0;
      this.store.isDocumentLoaded = true;
      this.store.clearSelection();
      this.store.pageCount = this.service.document.getPageCount();
      this.store.incrementRenderVersion();
      this.store.activeWorkspaceFileId = id;
      this.historyStore?.setActiveFileId(id);
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
    if (!this.store.isDocumentLoaded) return;
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

  registerScrollCallback(cb: (index: number) => void): void {
    this.scrollCallback = cb;
  }

  goToPage(index: number): void {
    if (index < 0 || index >= this.store.pageCount) return;
    if (this.store.inlineEdit) {
      this.submitInlineEdit();
    }
    this.store.currentPageIndex = index;
    this.store.clearSelection();
    this.scrollCallback?.(index);
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

  // -- Tool selection --

  setTool(tool: EditorTool): void {
    if (this.store.activeTool === tool) return;
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

