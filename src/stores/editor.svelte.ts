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
  EditableSpan,
  EditableFormFieldSpan,
  CompressionLevel,
} from '../core/types';
import type { CanvasElement, CanvasElementKind } from './canvas-types';
import { DEFAULT_PAGE_TRANSFORM, type ActiveCropState, type PendingDigitalSignatureState, type EditorTool, type SelectMode, type InlineEditState, type LeftPanelMode, type PageTransform, type DocumentViewMode, type ViewModeConfig } from './types';
import { getViewModeConfig, isTabAllowedInMode, isToolAllowedInMode } from '../core/document-mode';

// Non-reactive storage for binary PDF payloads to prevent reactive proxy overhead
const fileBufferStore = new Map<string, ArrayBuffer>();

// Non-reactive, memory-only storage for passwords that unlocked encrypted workspace files
const fileCredentialStore = new Map<string, string>();

export function getFileBuffer(id: string): ArrayBuffer | undefined {
  return fileBufferStore.get(id);
}

export function setFileBuffer(id: string, buffer: ArrayBuffer): void {
  fileBufferStore.set(id, buffer);
}

export function deleteFileBuffer(id: string): void {
  fileBufferStore.delete(id);
  fileCredentialStore.delete(id);
}

export function clearAllFileBuffers(): void {
  fileBufferStore.clear();
  fileCredentialStore.clear();
}

/**
 * Returns the password that unlocked an encrypted workspace file.
 *
 * @param id Workspace file id.
 * @return The recorded password, empty when none was required.
 */
export function getFileCredential(id: string): string {
  return fileCredentialStore.get(id) ?? '';
}

/**
 * Records the password that unlocks a workspace file so its stored buffer can be reopened.
 *
 * @param id Workspace file id.
 * @param password Password to record; an empty value forgets any stored password.
 */
export function setFileCredential(id: string, password: string): void {
  if (password) {
    fileCredentialStore.set(id, password);
  } else {
    fileCredentialStore.delete(id);
  }
}

export interface WorkspaceFile {
  id: string;
  fileName: string;
  thumbnail?: string;
  sizeBytes?: number;
  pageCount?: number;
  canvasElements?: CanvasElement[];
  pageTransforms?: Record<number, PageTransform>;
  hiddenSpanIds?: string[];
  currentPageIndex?: number;
  pageVersions?: Record<number, number>;
  scannedPages?: number[];
  formFieldValues?: Record<string, string | boolean>;
}

export type AppTheme = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'kea_theme';

function getInitialTheme(): AppTheme {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // Ignore storage access errors in restricted execution contexts
  }
  return 'system';
}

export function applyThemeToDocument(theme: AppTheme): void {
  if (typeof document === 'undefined' || !document?.documentElement?.classList) return;
  const rootEl = document.documentElement;
  rootEl.classList.add('theme-transition-suppressed');
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  rootEl.classList.toggle('dark', isDark);
  // note: force synchronous style recalculation before re-enabling transitions
  void rootEl.offsetHeight;
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      rootEl.classList.remove('theme-transition-suppressed');
    });
  } else {
    rootEl.classList.remove('theme-transition-suppressed');
  }
}

const EDITOR_STORE_KEY = Symbol('editor-store');

export class EditorStore {
  // Theme state
  theme = $state<AppTheme>(getInitialTheme());

  constructor() {
    if (typeof window !== 'undefined') {
      applyThemeToDocument(this.theme);
      if (typeof window.matchMedia === 'function') {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        mq.addEventListener?.('change', () => {
          if (this.theme === 'system') {
            applyThemeToDocument('system');
          }
        });
      }
    }
  }

  // Document lifecycle
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
  isZooming = $state(false);
  scrollFraction = $state(0);

  // -- Viewing mode --
  viewMode = $state<DocumentViewMode>('editing');

  // -- Interaction --
  activeTool = $state<EditorTool>('select');
  selectMode = $state<SelectMode>('select');
  annotateColor = $state('#fde047');
  annotateStrokeWidth = $state(1);
  selectedSpans = $state<EditableSpan[]>([]);

  get selectedSpan(): EditableSpan | null {
    return this.selectedSpans[this.selectedSpans.length - 1] ?? null;
  }

  set selectedSpan(span: EditableSpan | null) {
    if (span === null) {
      this.selectedSpans = [];
    } else {
      this.selectedSpans = [span];
    }
  }

  activeFormField = $state<EditableFormFieldSpan | null>(null);
  formFieldVersion = $state<number>(0);
  inlineEdit = $state<InlineEditState | null>(null);

  // -- UI panels --
  leftPanelMode = $state<LeftPanelMode>('workspace');
  leftPanelCollapsed = $state(true);
  rightPanelCollapsed = $state(true);

  // -- Views and modals --
  showOrganizerView = $state(false);
  splitDialogMode = $state<'split' | 'extract' | null>(null);
  showExportImagesDialog = $state(false);
  showCompressDialog = $state(false);
  compressInitialPreset = $state<CompressionLevel>('recommended');
  showSanitizeDialog = $state(false);
  showAdjustColorsDialog = $state(false);
  showImpositionDialog = $state(false);
  showPageNumberingDialog = $state(false);
  pageNumberingInitialMode = $state<'page-numbers' | 'bates' | 'header-footer'>('page-numbers');
  showDocumentInfoDialog = $state(false);
  showEsignDialog = $state(false);
  showCertSignDialog = $state(false);
  showValidateSignaturesDialog = $state(false);
  showOpenUrlDialog = $state(false);
  openUrlDialogInitialUrl = $state('');
  showConvertDialog = $state(false);
  convertInitialFile = $state<File | null>(null);
  showComponentGalleryDialog = $state(false);
  showPageScaleDialog = $state(false);
  showPasswordPromptDialog = $state(false);
  pendingPasswordBuffer = $state<ArrayBuffer | null>(null);
  pendingPasswordFileName = $state<string>('');
  passwordPromptError = $state<string | null>(null);
  showPermissionsDialog = $state(false);
  isOwnerUnlocked = $state(true);
  loadError = $state<string | null>(null);
  isLoadingDocument = $state(false);
  loadingProgress = $state<string | null>(null);
  esignInitialTab = $state<'signatures' | 'draw' | 'type' | 'upload'>('signatures');
  impositionInitialMode = $state<'nup' | 'booklet' | 'single-page' | 'posterize' | 'cut-stack'>('nup');
  activeMockupTool = $state<string | null>(null);
  showQrBarcodeModal = $state(false);
  showOcrDialog = $state(false);
  isOcrRunning = $state(false);
  ocrProgress = $state<{ pageIndex: number; progress: number; status: string } | null>(null);
  scannedPages = $state<Set<number>>(new Set());
  pageOcrResults = $state<Map<number, import('../services/ocr/ocr-types').OcrPageResult>>(new Map());

  // -- Page crop tool interaction --
  activeCrop = $state<ActiveCropState | null>(null);

  // -- Interactive digital signature placement --
  pendingDigitalSignature = $state<PendingDigitalSignatureState | null>(null);
  isSigningDocument = $state(false);

  // -- Drag-and-drop --
  isDraggingOver = $state(false);

  // -- Element placement mode --
  placingElementKind = $state<CanvasElementKind | null>(null);

  hiddenSpanIds = new SvelteSet<string>();

  // Page transforms and optimistic actions
  pageTransforms = $state<Record<number, PageTransform>>({});
  optimisticRotations = $state<Record<number, number>>({});
  pendingRenderRotations = $state<Record<number, number>>({});
  optimisticDeletedPageIndices = $state<Set<number>>(new Set());
  optimisticPageOrder = $state<number[] | null>(null);
  isMutating = $state(false);

  // -- Derived values --

  get isCropping(): boolean {
    return this.activeCrop !== null;
  }

  get isPlacingDigitalSignature(): boolean {
    return this.pendingDigitalSignature !== null;
  }

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
    return this.selectedSpans.length > 0;
  }

  isSpanSelected(spanId: string): boolean {
    return this.selectedSpans.some((s) => s.id === spanId);
  }

  get isInlineEditing(): boolean {
    return this.inlineEdit !== null;
  }

  get isReadOnly(): boolean {
    return this.viewMode === 'viewing';
  }

  get isSuggestingMode(): boolean {
    return this.viewMode === 'suggesting';
  }

  get isEditingMode(): boolean {
    return this.viewMode === 'editing';
  }

  get canEditContent(): boolean {
    return this.viewMode === 'editing';
  }

  get canMutateDocument(): boolean {
    return this.viewModeConfig.canMutateDocument;
  }

  get canAnnotate(): boolean {
    return this.viewModeConfig.canAnnotate;
  }

  get canSelectElements(): boolean {
    return this.viewModeConfig.canSelectElements;
  }

  get canEditValues(): boolean {
    return this.viewModeConfig.canEditValues;
  }

  get canReorderPages(): boolean {
    return this.viewModeConfig.canReorderPages;
  }

  get canMergeFiles(): boolean {
    return this.viewModeConfig.canMergeFiles;
  }

  get canExtractPages(): boolean {
    return this.viewModeConfig.canExtractPages;
  }

  get canExtractImages(): boolean {
    return this.viewModeConfig.canExtractImages;
  }

  get canMoveElements(): boolean {
    return this.viewModeConfig.canMoveElements;
  }

  get canResizeElements(): boolean {
    return this.viewModeConfig.canResizeElements;
  }

  get canDeleteElements(): boolean {
    return this.viewModeConfig.canDeleteElements;
  }

  get canEditElements(): boolean {
    return this.viewModeConfig.canEditContent;
  }

  get canRotateElements(): boolean {
    return this.viewModeConfig.canResizeElements;
  }

  get canDuplicateElements(): boolean {
    return this.viewModeConfig.canEditContent;
  }

  get viewModeConfig(): ViewModeConfig {
    return getViewModeConfig(this.viewMode);
  }

  /**
   * Sets the active document viewing mode and reconciles tool and tab selections.
   *
   * @param mode Target viewing mode ('editing', 'viewing', or 'suggesting').
   * @param collapseRightPanel Whether to collapse the right panel when entering viewing mode.
   */
  setViewMode(mode: DocumentViewMode, collapseRightPanel: boolean = true): void {
    if (this.viewMode === mode) {
      if (mode === 'editing' || mode === 'suggesting') {
        this.rightPanelCollapsed = false;
      } else if (mode === 'viewing' && collapseRightPanel) {
        this.rightPanelCollapsed = true;
      }
      return;
    }
    this.viewMode = mode;

    if (mode === 'viewing') {
      if (collapseRightPanel) {
        this.rightPanelCollapsed = true;
      }
      if (!this.viewModeConfig.canSelectElements) {
        this.clearSelection();
      }
      this.placingElementKind = null;
      this.showOrganizerView = false;
      this.showSanitizeDialog = false;
      this.showAdjustColorsDialog = false;
      this.showCompressDialog = false;
      this.showPageScaleDialog = false;
      this.showImpositionDialog = false;
      this.showPageNumberingDialog = false;
      if (this.isCropping) {
        this.activeCrop = null;
      }
      if (this.isPlacingDigitalSignature) {
        this.pendingDigitalSignature = null;
      }
      if (!isToolAllowedInMode(mode, this.activeTool)) {
        this.activeTool = 'select';
      }
      if (!isTabAllowedInMode(mode, this.leftPanelMode)) {
        this.leftPanelMode = 'workspace';
      }
    } else if (mode === 'suggesting') {
      this.rightPanelCollapsed = false;
      this.inlineEdit = null;
      this.showOrganizerView = false;
      this.showSanitizeDialog = false;
      this.showAdjustColorsDialog = false;
      this.showCompressDialog = false;
      this.showPageScaleDialog = false;
      this.showImpositionDialog = false;
      this.showPageNumberingDialog = false;
      if (this.isCropping) {
        this.activeCrop = null;
      }
      if (this.isPlacingDigitalSignature) {
        this.pendingDigitalSignature = null;
      }
      if (!isToolAllowedInMode(mode, this.activeTool)) {
        this.activeTool = 'select';
      }
      if (!isTabAllowedInMode(mode, this.leftPanelMode)) {
        this.leftPanelMode = 'workspace';
      }
    } else if (mode === 'editing') {
      this.rightPanelCollapsed = false;
    }
  }

  incrementRenderVersion(): void {
    this.renderVersion++;
  }

  incrementPageVersion(pageIndex: number): void {
    this.pageVersions[pageIndex] = (this.pageVersions[pageIndex] || 0) + 1;
  }

  incrementFormFieldVersion(): void {
    this.formFieldVersion++;
  }

  setActiveFormField(field: EditableFormFieldSpan | null): void {
    this.activeFormField = field;
  }

  clearSelection(): void {
    this.selectedSpans = [];
    this.activeFormField = null;
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

  /** Retrieve the pending optimistic rotation delta in degrees for a given page. */
  getOptimisticRotation(pageIndex: number): number {
    return this.optimisticRotations[pageIndex] ?? 0;
  }

  /** Add an optimistic rotation delta for immediate visual feedback. */
  addOptimisticRotation(pageIndex: number, degreesDelta: number): void {
    const current = this.optimisticRotations[pageIndex] ?? 0;
    this.optimisticRotations = {
      ...this.optimisticRotations,
      [pageIndex]: (((current + degreesDelta) % 360) + 360) % 360,
    };
  }

  /** Subtract an applied or failed rotation delta from pending optimistic rotation. */
  subtractOptimisticRotation(pageIndex: number, degreesDelta: number): void {
    const current = this.optimisticRotations[pageIndex] ?? 0;
    if (current === 0) return;
    const next = (((current - degreesDelta) % 360) + 360) % 360;
    const nextRotations = { ...this.optimisticRotations };
    if (next === 0) {
      delete nextRotations[pageIndex];
    } else {
      nextRotations[pageIndex] = next;
    }
    this.optimisticRotations = nextRotations;
  }

  /** Clear pending optimistic rotation for a page. */
  clearOptimisticRotation(pageIndex: number): void {
    const nextRotations = { ...this.optimisticRotations };
    delete nextRotations[pageIndex];
    this.optimisticRotations = nextRotations;
  }

  /** Retrieve background-executed rotation delta awaiting final canvas bitmap commit. */
  getPendingRenderRotation(pageIndex: number): number {
    return this.pendingRenderRotations[pageIndex] ?? 0;
  }

  /** Record rotation applied to WASM in the background before the bitmap re-renders. */
  addPendingRenderRotation(pageIndex: number, degreesDelta: number): void {
    const current = this.pendingRenderRotations[pageIndex] ?? 0;
    const next = (((current + degreesDelta) % 360) + 360) % 360;
    const nextRotations = { ...this.pendingRenderRotations };
    if (next === 0) {
      delete nextRotations[pageIndex];
    } else {
      nextRotations[pageIndex] = next;
    }
    this.pendingRenderRotations = nextRotations;
  }

  /** Clear background-executed rotation delta once the bitmap re-renders. */
  clearPendingRenderRotation(pageIndex?: number): void {
    if (pageIndex === undefined) {
      if (Object.keys(this.pendingRenderRotations).length > 0) {
        this.pendingRenderRotations = {};
      }
      return;
    }
    if (this.pendingRenderRotations[pageIndex] === undefined) return;
    const nextRotations = { ...this.pendingRenderRotations };
    delete nextRotations[pageIndex];
    this.pendingRenderRotations = nextRotations;
  }

  /** Compute the combined visual rotation accounting for base transform, optimistic rotation, and unrendered background rotation. */
  getEffectivePageRotation(pageIndex: number): number {
    const base = this.pageTransforms[pageIndex]?.rotation ?? 0;
    const opt = this.optimisticRotations[pageIndex] ?? 0;
    const pendingRender = this.pendingRenderRotations[pageIndex] ?? 0;
    return (((base + opt + pendingRender) % 360) + 360) % 360;
  }

  /** Compute the layout rotation relative to current WASM page dimensions. */
  getLayoutPageRotation(pageIndex: number): number {
    const base = this.pageTransforms[pageIndex]?.rotation ?? 0;
    const opt = this.optimisticRotations[pageIndex] ?? 0;
    return (((base + opt) % 360) + 360) % 360;
  }

  /** Check whether a page is currently marked as optimistically deleted. */
  isPageOptimisticallyDeleted(pageIndex: number): boolean {
    return this.optimisticDeletedPageIndices.has(pageIndex);
  }

  /** Mark a page as optimistically deleted for exit transitions. */
  markPageOptimisticallyDeleted(pageIndex: number): void {
    this.optimisticDeletedPageIndices.add(pageIndex);
  }

  /** Clear optimistic deletion state for a page or all pages. */
  clearOptimisticPageDeletion(pageIndex?: number): void {
    if (pageIndex !== undefined) {
      this.optimisticDeletedPageIndices.delete(pageIndex);
    } else {
      this.optimisticDeletedPageIndices.clear();
    }
  }

  /** Compute the active visual sequence of pages accounting for pending optimistic reorders. */
  get effectivePageOrder(): number[] {
    if (this.optimisticPageOrder && this.optimisticPageOrder.length === this.pageCount) {
      return this.optimisticPageOrder;
    }
    return Array.from({ length: this.pageCount }, (_, i) => i);
  }

  /** Set or clear the pending optimistic page sequence. */
  setOptimisticPageOrder(order: number[] | null): void {
    this.optimisticPageOrder = order;
  }

  /** Retrieve the underlying document page index displayed at a given visual position. */
  getEffectivePageIndex(visualIndex: number): number {
    const order = this.effectivePageOrder;
    return order[visualIndex] ?? visualIndex;
  }

  /** Retrieve the visual position of a given document page index. */
  getVisualPageIndex(pageIndex: number): number {
    const order = this.effectivePageOrder;
    const idx = order.indexOf(pageIndex);
    return idx !== -1 ? idx : pageIndex;
  }

  /** Open the imposition dialog with the given initial mode. */
  openImpositionDialog(mode: 'nup' | 'booklet' | 'single-page' | 'posterize' | 'cut-stack' = 'nup'): void {
    this.impositionInitialMode = mode;
    this.showImpositionDialog = true;
  }

  /** Open the compress document dialog with optional initial preset. */
  openCompressDialog(preset: CompressionLevel = 'recommended'): void {
    this.compressInitialPreset = preset;
    this.showCompressDialog = true;
  }

  /** Open the URL document loader dialog with optional pre-filled URL. */
  openUrlDialog(initialUrl: string = ''): void {
    this.openUrlDialogInitialUrl = initialUrl;
    this.showOpenUrlDialog = true;
  }

  /** Open the document conversion dialog with optional pre-selected file. */
  openConvertDialog(file?: File): void {
    this.convertInitialFile = file ?? null;
    this.showConvertDialog = true;
  }

  /** Close the document conversion dialog. */
  closeConvertDialog(): void {
    this.showConvertDialog = false;
    this.convertInitialFile = null;
  }

  /** Open the UI component variant gallery dialog. */
  openComponentGalleryDialog(): void {
    this.showComponentGalleryDialog = true;
  }

  /** Close the UI component variant gallery dialog. */
  closeComponentGalleryDialog(): void {
    this.showComponentGalleryDialog = false;
  }

  /** Open the page scale and resizing dialog. */
  openPageScaleDialog(): void {
    this.showPageScaleDialog = true;
  }

  /** Close the page scale and resizing dialog. */
  closePageScaleDialog(): void {
    this.showPageScaleDialog = false;
  }

  /** Open the adjust colours and contrast dialog. */
  openAdjustColorsDialog(): void {
    this.showAdjustColorsDialog = true;
  }

  /** Close the adjust colours and contrast dialog. */
  closeAdjustColorsDialog(): void {
    this.showAdjustColorsDialog = false;
  }

  /** Open the page numbering and Bates numbering dialog with the given initial mode. */
  openPageNumberingDialog(
    mode: 'page-numbers' | 'bates' | 'header-footer' = 'page-numbers'
  ): void {
    this.pageNumberingInitialMode = mode;
    this.showPageNumberingDialog = true;
  }

  /** Close the page numbering and Bates numbering dialog. */
  closePageNumberingDialog(): void {
    this.showPageNumberingDialog = false;
  }

  /** Open the granular permissions configuration dialog. */
  openPermissionsDialog(): void {
    this.showPermissionsDialog = true;
  }

  /** Close the granular permissions configuration dialog. */
  closePermissionsDialog(): void {
    this.showPermissionsDialog = false;
  }

  /** Close the password decryption prompt dialog and discard pending buffer. */
  closePasswordPromptDialog(): void {
    this.showPasswordPromptDialog = false;
    this.pendingPasswordBuffer = null;
    this.pendingPasswordFileName = '';
    this.passwordPromptError = null;
  }

  /** Clears active document loading error banner. */
  clearLoadError(): void {
    this.loadError = null;
  }

  /**
   * Sets the visual colour theme of the application.
   * Updates state, persists preference in local storage, and synchronises the document root class.
   */
  setTheme(theme: AppTheme): void {
    this.theme = theme;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch {
        // Ignore storage write failure
      }
    }
    applyThemeToDocument(theme);
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
