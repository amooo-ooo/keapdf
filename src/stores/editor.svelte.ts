/**
 * Central reactive state store for the PDF editor.
 *
 * Uses Svelte 5 class-based $state pattern. All reactive state lives here,
 * with derived getters for computed values. Business logic lives in
 * EditorActions which mutates this store.
 */

import { getContext, setContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import type {
  EditableSpan
} from '../core/types';
import type { CanvasElementKind } from './canvas-types';
import { DEFAULT_PAGE_TRANSFORM, type EditorTool, type InlineEditState, type LeftPanelMode, type PageTransform } from './types';

// Non-reactive storage for binary PDF payloads to prevent reactive proxy overhead
const fileBufferStore = new Map<string, ArrayBuffer>();

export function getFileBuffer(id: string): ArrayBuffer | undefined {
  return fileBufferStore.get(id);
}

export function setFileBuffer(id: string, buffer: ArrayBuffer): void {
  fileBufferStore.set(id, buffer);
}

export function deleteFileBuffer(id: string): void {
  fileBufferStore.delete(id);
}

export function clearAllFileBuffers(): void {
  fileBufferStore.clear();
}

export interface WorkspaceFile {
  id: string;
  fileName: string;
  thumbnail?: string;
  sizeBytes?: number;
}

const EDITOR_STORE_KEY = Symbol('editor-store');

export class EditorStore {
  // -- Document lifecycle --
  isInitialized = $state(false);
  isDocumentLoaded = $state(false);
  fileName = $state('No document');
  pageCount = $state(0);
  renderVersion = $state(0);
  pageVersions = $state<Record<number, number>>({});

  // -- Workspace --
  workspaceFiles = $state<WorkspaceFile[]>([]);
  activeWorkspaceFileId = $state<string | null>(null);

  // -- Navigation --
  currentPageIndex = $state(0);
  zoom = $state(1.0);
  scrollFraction = $state(0);

  // -- Interaction --
  activeTool = $state<EditorTool>('select');
  annotateColor = $state('#fde047');
  annotateStrokeWidth = $state(2);
  selectedSpan = $state<EditableSpan | null>(null);
  inlineEdit = $state<InlineEditState | null>(null);

  // -- UI panels --
  leftPanelMode = $state<LeftPanelMode>('workspace');
  leftPanelCollapsed = $state(false);
  rightPanelCollapsed = $state(false);

  // -- Views and modals --
  showOrganizerView = $state(false);
  splitDialogMode = $state<'split' | 'extract' | null>(null);
  showExportImagesDialog = $state(false);
  showSanitizeDialog = $state(false);
  showImpositionDialog = $state(false);
  showDocumentInfoDialog = $state(false);
  showEsignDialog = $state(false);
  showCertSignDialog = $state(false);
  showValidateSignaturesDialog = $state(false);
  esignInitialTab = $state<'signatures' | 'draw' | 'type' | 'upload'>('signatures');
  impositionInitialMode = $state<'nup' | 'booklet' | 'single-page' | 'posterize' | 'cut-stack'>('nup');
  activeMockupTool = $state<string | null>(null);

  // -- Drag-and-drop --
  isDraggingOver = $state(false);

  // -- Element placement mode --
  placingElementKind = $state<CanvasElementKind | null>(null);

  hiddenSpanIds = new SvelteSet<string>();

  // -- Page transforms --
  pageTransforms = $state<Record<number, PageTransform>>({});

  // -- Derived values --

  get zoomPercent(): number {
    return Math.round(this.zoom * 100);
  }

  get canGoNext(): boolean {
    return this.currentPageIndex < this.pageCount - 1;
  }

  get canGoPrev(): boolean {
    return this.currentPageIndex > 0;
  }

  get hasSelection(): boolean {
    return this.selectedSpan !== null;
  }

  get isInlineEditing(): boolean {
    return this.inlineEdit !== null;
  }

  // -- Convenience mutations --

  incrementRenderVersion(): void {
    this.renderVersion++;
  }

  incrementPageVersion(pageIndex: number): void {
    this.pageVersions[pageIndex] = (this.pageVersions[pageIndex] || 0) + 1;
  }

  clearSelection(): void {
    this.selectedSpan = null;
    this.inlineEdit = null;
  }

  /** Retrieve the visual transform for a page, falling back to identity. */
  getPageTransform(pageIndex: number): PageTransform {
    return this.pageTransforms[pageIndex] ?? DEFAULT_PAGE_TRANSFORM;
  }

  /** Merge partial updates into a page's visual transform. */
  updatePageTransform(pageIndex: number, updates: Partial<PageTransform>): void {
    const current = this.getPageTransform(pageIndex);
    this.pageTransforms[pageIndex] = { ...current, ...updates };
  }

  /** Open the imposition dialog with the given initial mode. */
  openImpositionDialog(mode: 'nup' | 'booklet' | 'single-page' | 'posterize' | 'cut-stack' = 'nup'): void {
    this.impositionInitialMode = mode;
    this.showImpositionDialog = true;
  }
}

/** Provide the store via Svelte context from a root component. */
export function provideEditorStore(store: EditorStore): void {
  setContext(EDITOR_STORE_KEY, store);
}

/** Retrieve the store from Svelte context in any child component. */
export function useEditorStore(): EditorStore {
  return getContext<EditorStore>(EDITOR_STORE_KEY);
}
