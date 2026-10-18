import { getContext, setContext } from 'svelte';
import type { CanvasStore } from './canvas.svelte';
import type { EditorActions } from './editor-actions';
import {
  type CanvasElement,
  type CanvasElementKind,
  type DragState,
  type ElementDropPayload,
  type FormFieldVariant,
  type HandlePosition,
  type LineEndpointHandle,
  type PathElement,
  type Point,
  type ShapeVariant,
  type TextElement,
} from './canvas-types';
import type { PageTransform } from './types';
import { type ElementRegistry, createElementFromPayload } from '../core/element-registry';
import {
  AddElementCommand,
  RemoveElementCommand,
  MoveElementCommand,
  ResizeElementCommand,
  RotateElementCommand,
  AdjustLineEndpointsCommand,
  UpdateElementPropertyCommand,
  ReorderElementCommand,
  CompoundCommand,
} from '../commands';
import {
  capturePageMetrics,
  screenToPageCoords,
  screenToPageCoordsWithMetrics,
  type CachedPageMetrics,
} from '../utils/geometry';
import { safeClone } from '../utils/clone-utils';
import { computeDragSnap, computeResizeSnap, extractSnapCandidates } from '../utils/snapping-engine';
import { getLineEndpoints, elementFromLineEndpoints } from '../utils/line-geometry';
import { snapLineEndpoint } from '../utils/line-snapping';
import type { SnapCandidate } from '../types/snapping-types';

const CANVAS_ACTIONS_KEY = Symbol('canvas-actions');

/** Options for creating canvas elements. */
interface CreateElementOptions {
  variant?: ShapeVariant | FormFieldVariant;
  label?: string;
  src?: string;
  text?: string;
  author?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  fontFamily?: string;
  rawFontFamily?: string;
  lineHeight?: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none' | 'inset' | 'underline';
  borderRadius?: number;
  textAlign?: 'left' | 'center' | 'right';
  placeholder?: string;
  value?: string;
  options?: string[];
  required?: boolean;
  readOnly?: boolean;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  title?: string;
  poster?: string;
  modelFormat?: string;
  description?: string;
  payload?: string;
  symbology?: 'qr-code' | 'code-128';
  fgColor?: string;
  bgColor?: string;
  includeText?: boolean;
  svgContent?: string;
}

export class CanvasActions {
  private cachedInteractionPageEl: HTMLElement | null = null;
  private cachedInteractionZoom: number = 0;
  private cachedInteractionMetrics: CachedPageMetrics | null = null;
  private cachedSnapCandidatesByKey: Map<string, SnapCandidate[]> = new Map();
  private dragJustEnded: boolean = false;
  private promotingMixedSpansInDrag: boolean = false;

  constructor(
    private canvasStore: CanvasStore,
    public editorActions: EditorActions | undefined,
    private elementRegistry?: ElementRegistry,
  ) {}

  /**
   * Consumes and resets the post-interaction guard flag so synthetic click events
   * immediately following a drag, resize, rotate, or endpoint adjustment do not
   * collapse or clear active multi-selections.
   *
   * @return True if an interaction just ended and the click should be ignored.
   */
  public consumeDragEnd(): boolean {
    if (this.dragJustEnded) {
      this.dragJustEnded = false;
      return true;
    }
    return false;
  }

  setEditorActions(actions: EditorActions): void {
    this.editorActions = actions;
  }

  /**
   * Clears cached page metrics and snap candidates for the active drag or resize session.
   */
  public clearInteractionCache(): void {
    this.cachedInteractionPageEl = null;
    this.cachedInteractionZoom = 0;
    this.cachedInteractionMetrics = null;
    this.cachedSnapCandidatesByKey.clear();
  }

  /**
   * Adjusts cached page bounding rect offsets by a viewport scroll delta to avoid synchronous DOM reflows.
   *
   * @param deltaX Horizontal scroll delta in pixels.
   * @param deltaY Vertical scroll delta in pixels.
   */
  public adjustCachedPageMetricsForScroll(deltaX: number, deltaY: number): void {
    if (this.cachedInteractionMetrics && (deltaX !== 0 || deltaY !== 0)) {
      this.cachedInteractionMetrics = {
        ...this.cachedInteractionMetrics,
        rect: {
          ...this.cachedInteractionMetrics.rect,
          left: this.cachedInteractionMetrics.rect.left - deltaX,
          top: this.cachedInteractionMetrics.rect.top - deltaY,
        },
      };
    }
  }

  private getOrMeasureInteractionMetrics(pageEl: HTMLElement, zoom: number): CachedPageMetrics {
    const fastEnabled = this.editorActions?.featureFlags
      ? this.editorActions.featureFlags.isEnabled('performance.fast-element-interaction')
      : true;
    if (
      fastEnabled &&
      this.cachedInteractionPageEl === pageEl &&
      this.cachedInteractionZoom === zoom &&
      this.cachedInteractionMetrics
    ) {
      return this.cachedInteractionMetrics;
    }
    const metrics = capturePageMetrics(pageEl);
    if (fastEnabled) {
      this.cachedInteractionPageEl = pageEl;
      this.cachedInteractionZoom = zoom;
      this.cachedInteractionMetrics = metrics;
    }
    return metrics;
  }

  private resolveInteractionPageCoords(
    clientX: number,
    clientY: number,
    pageEl: HTMLElement,
    zoom: number,
    pageTransform?: PageTransform,
  ): { x: number; y: number } {
    const metrics = this.getOrMeasureInteractionMetrics(pageEl, zoom);
    return screenToPageCoordsWithMetrics(clientX, clientY, metrics, zoom, pageTransform);
  }

  createElement(
    kind: CanvasElementKind,
    pageIndex: number,
    x: number,
    y: number,
    options?: CreateElementOptions,
  ): void {
    if (!this.elementRegistry || !this.elementRegistry.has(kind)) {
      throw new Error(`Unsupported canvas element kind: ${kind}`);
    }

    const id = this.canvasStore.generateId();
    const def = this.elementRegistry.get(kind);

    // Build overrides from the UI-level CreateElementOptions.
    const overrides: Record<string, unknown> = {};
    if (options?.width != null) overrides.width = options.width;
    if (options?.height != null) overrides.height = options.height;
    if (options?.variant != null) overrides.variant = options.variant;
    if (options?.src != null) overrides.src = options.src;
    if (options?.text != null) overrides.text = options.text;
    if (options?.author != null) overrides.author = options.author;
    if (options?.color != null) overrides.color = options.color;
    if (options?.fontSize != null) overrides.fontSize = options.fontSize;
    if (options?.fontWeight != null) overrides.fontWeight = options.fontWeight;
    if (options?.fontStyle != null) overrides.fontStyle = options.fontStyle;
    if (options?.fontFamily != null) overrides.fontFamily = options.fontFamily;
    if (options?.rawFontFamily != null) overrides.rawFontFamily = options.rawFontFamily;
    if (options?.lineHeight != null) overrides.lineHeight = options.lineHeight;
    if (options?.label != null) overrides.label = options.label;
    if (options?.backgroundColor != null) overrides.backgroundColor = options.backgroundColor;
    if (options?.borderColor != null) overrides.borderColor = options.borderColor;
    if (options?.borderWidth != null) overrides.borderWidth = options.borderWidth;
    if (options?.borderStyle != null) overrides.borderStyle = options.borderStyle;
    if (options?.borderRadius != null) overrides.borderRadius = options.borderRadius;
    if (options?.textAlign != null) overrides.textAlign = options.textAlign;
    if (options?.placeholder != null) overrides.placeholder = options.placeholder;
    if (options?.value != null) overrides.value = options.value;
    if (options?.options != null) overrides.options = options.options;
    if (options?.required != null) overrides.required = options.required;
    if (options?.readOnly != null) overrides.readOnly = options.readOnly;
    if (options?.fileName != null) overrides.fileName = options.fileName;
    if (options?.fileSize != null) overrides.fileSize = options.fileSize;
    if (options?.mimeType != null) overrides.mimeType = options.mimeType;
    if (options?.title != null) overrides.title = options.title;
    if (options?.poster != null) overrides.poster = options.poster;
    if (options?.modelFormat != null) overrides.modelFormat = options.modelFormat;
    if (options?.description != null) overrides.description = options.description;
    if (options?.payload != null) overrides.payload = options.payload;
    if (options?.symbology != null) overrides.symbology = options.symbology;
    if (options?.fgColor != null) overrides.fgColor = options.fgColor;
    if (options?.bgColor != null) overrides.bgColor = options.bgColor;
    if (options?.includeText != null) overrides.includeText = options.includeText;
    if (options?.svgContent != null) overrides.svgContent = options.svgContent;

    const element = def.create(id, pageIndex, x, y, overrides) as CanvasElement;

    this.canvasStore.addElement(element);
    if (this.editorActions?.store?.canSelectElements !== false) {
      this.canvasStore.selectElement(id);
    }
    this.editorActions?.pushCommand(new AddElementCommand(`Add ${kind}`, element));
    if (this.editorActions?.store?.canSelectElements !== false) {
      this.editorActions?.setTool('select');
    }
  }

  screenToPageCoords(clientX: number, clientY: number, pageEl: HTMLElement, zoom: number, pageTransform?: PageTransform): { x: number; y: number } {
    return screenToPageCoords(clientX, clientY, pageEl, zoom, pageTransform);
  }

    startDrag(elementId: string, pointerX: number, pointerY: number, pageEl: HTMLElement, zoom: number, pageTransform?: PageTransform): void {
        if (this.editorActions?.store?.isReadOnly || this.editorActions?.store?.canMoveElements === false) return;
        const element = this.canvasStore.getElementById(elementId);
        if (!element || element.locked) return;

        this.dragJustEnded = false;
        this.promotingMixedSpansInDrag = false;
        this.clearInteractionCache();
        const { x, y } = this.resolveInteractionPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
        const grabOffsetX = x - element.x;
        const grabOffsetY = y - element.y;
        const pathEl = element.kind === 'path' && 'points' in element ? (element as PathElement) : null;

        const otherElementOrigins: Record<string, { originX: number; originY: number; originPoints?: Point[] }> = {};
        const otherElementPageOrigins: Record<string, number> = {};
        if (this.canvasStore.isSelected(elementId)) {
            for (const otherId of this.canvasStore.selectedElementIds) {
                if (otherId === elementId) continue;
                const otherEl = this.canvasStore.getElementById(otherId);
                if (!otherEl || otherEl.locked) continue;
                const otherPath = otherEl.kind === 'path' && 'points' in otherEl ? (otherEl as PathElement) : null;
                otherElementOrigins[otherId] = {
                    originX: otherEl.x,
                    originY: otherEl.y,
                    originPoints: otherPath ? JSON.parse(JSON.stringify(otherPath.points)) : undefined,
                };
                otherElementPageOrigins[otherId] = otherEl.pageIndex;
            }
        } else {
            this.canvasStore.selectElement(elementId);
        }

        this.canvasStore.dragState = {
            elementId,
            mode: 'move',
            handle: null,
            startX: x,
            startY: y,
            originX: element.x,
            originY: element.y,
            originWidth: element.width,
            originHeight: element.height,
            originPageIndex: element.pageIndex,
            grabOffsetX,
            grabOffsetY,
            originPoints: pathEl ? JSON.parse(JSON.stringify(pathEl.points)) : undefined,
            otherElementOrigins: Object.keys(otherElementOrigins).length > 0 ? otherElementOrigins : undefined,
            otherElementPageOrigins: Object.keys(otherElementPageOrigins).length > 0 ? otherElementPageOrigins : undefined,
        };
    }

    private getPageDimensions(
        pageIndex: number,
        pageEl?: HTMLElement,
        zoom: number = 1,
    ): { width: number; height: number } {
        const fromDoc = this.editorActions?.service?.document?.getPageDimensions(pageIndex);
        if (fromDoc && fromDoc.widthPts > 0 && fromDoc.heightPts > 0) {
            return { width: fromDoc.widthPts, height: fromDoc.heightPts };
        }
        if (
            pageEl &&
            this.cachedInteractionPageEl === pageEl &&
            this.cachedInteractionMetrics &&
            this.cachedInteractionMetrics.halfW > 0 &&
            this.cachedInteractionMetrics.halfH > 0
        ) {
            return {
                width: (this.cachedInteractionMetrics.halfW * 2) / (zoom || 1),
                height: (this.cachedInteractionMetrics.halfH * 2) / (zoom || 1),
            };
        }
        if (pageEl && pageEl.offsetWidth > 0 && pageEl.offsetHeight > 0) {
            return {
                width: pageEl.offsetWidth / (zoom || 1),
                height: pageEl.offsetHeight / (zoom || 1),
            };
        }
        return { width: 612, height: 792 };
    }

    /**
     * Extracts snap candidates for a page combining canvas elements and cached PDF layout objects.
     *
     * @param pageIndex Target page index.
     * @param excludeElementId Optional canvas element ID to exclude from candidates.
     */
    private getSnapCandidates(pageIndex: number, excludeElementId?: string): SnapCandidate[] {
        const fastEnabled = this.editorActions?.featureFlags
            ? this.editorActions.featureFlags.isEnabled('performance.fast-element-interaction')
            : true;
        const pageElements = this.canvasStore.getElementsByPage(pageIndex);
        const cacheKey = `${pageIndex}:${excludeElementId ?? ''}:${pageElements.length}`;
        if (fastEnabled && this.canvasStore.dragState) {
            const cached = this.cachedSnapCandidatesByKey.get(cacheKey);
            if (cached) {
                return cached;
            }
        }
        const cachedSpans = this.editorActions?.service?.document?.getCachedPageSpans(pageIndex);
        const hiddenSpanIds = this.editorActions?.store?.hiddenSpanIds;
        const candidates = extractSnapCandidates(
            pageIndex,
            pageElements,
            excludeElementId,
            cachedSpans,
            hiddenSpanIds,
        );
        if (fastEnabled && this.canvasStore.dragState) {
            this.cachedSnapCandidatesByKey.set(cacheKey, candidates);
        }
        return candidates;
    }

    updateDrag(
        pointerX: number,
        pointerY: number,
        pageEl: HTMLElement,
        zoom: number,
        pageTransform?: PageTransform,
        targetPageIndex?: number,
        options?: { disabledSnap?: boolean; screenThresholdPx?: number },
    ): void {
        const state = this.canvasStore.dragState;
        if (!state || state.mode !== 'move') return;

        const element = this.canvasStore.getElementById(state.elementId);
        if (!element) return;

        const { x, y } = this.resolveInteractionPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
        const grabOffsetX = state.grabOffsetX ?? (state.startX - state.originX);
        const grabOffsetY = state.grabOffsetY ?? (state.startY - state.originY);

        let newX = x - grabOffsetX;
        let newY = y - grabOffsetY;
        const resolvedTargetPage = targetPageIndex !== undefined ? targetPageIndex : element.pageIndex;

        if (!options?.disabledSnap) {
            const pageDims = this.getPageDimensions(resolvedTargetPage, pageEl, zoom);
            const candidates = this.getSnapCandidates(resolvedTargetPage, element.id);

            const cropMargins = this.editorActions?.store?.activeCrop?.pageIndex === resolvedTargetPage
                ? this.editorActions?.store?.activeCrop?.margins
                : undefined;

            const snapResult = computeDragSnap(
                { x: newX, y: newY, width: element.width, height: element.height },
                candidates,
                pageDims,
                resolvedTargetPage,
                zoom,
                cropMargins,
                { screenThresholdPx: options?.screenThresholdPx, disabled: options?.disabledSnap },
            );

            newX = snapResult.x;
            newY = snapResult.y;
            this.canvasStore.activeSnapGuides = snapResult.guides;
        } else {
            this.canvasStore.clearSnapGuides();
        }

        const updates: Partial<CanvasElement> = {
            x: newX,
            y: newY,
        };

        if (resolvedTargetPage !== element.pageIndex) {
            updates.pageIndex = resolvedTargetPage;
        }

        if (element.kind === 'path' && state.originPoints) {
            const dx = newX - state.originX;
            const dy = newY - state.originY;
            (updates as Partial<PathElement>).points = state.originPoints.map((p) => ({
                x: p.x + dx,
                y: p.y + dy,
            }));
        }

        this.canvasStore.updateElement(state.elementId, updates);

        const multiTransformEnabled =
            !this.editorActions?.featureFlags ||
            (this.editorActions.featureFlags.isEnabled('select-tool.multiselect') &&
                this.editorActions.featureFlags.isEnabled('select-tool.multiselect.transform'));

        if (
            multiTransformEnabled &&
            !this.promotingMixedSpansInDrag &&
            this.editorActions &&
            Array.isArray(this.editorActions.store?.selectedSpans) &&
            this.editorActions.store.selectedSpans.length > 0 &&
            typeof this.editorActions.extractSelectedSpansToCanvas === 'function' &&
            (Math.abs(newX - state.originX) > 0.5 || Math.abs(newY - state.originY) > 0.5)
        ) {
            this.promotingMixedSpansInDrag = true;
            const existingIds = new Set(this.canvasStore.selectedElementIds);
            void this.editorActions
                .extractSelectedSpansToCanvas(undefined, this.canvasStore)
                .then(() => {
                    this.promotingMixedSpansInDrag = false;
                    const currentDrag = this.canvasStore.dragState;
                    if (!currentDrag || currentDrag.mode !== 'move') return;
                    const primaryEl = this.canvasStore.getElementById(currentDrag.elementId);
                    const currentDx = primaryEl ? primaryEl.x - currentDrag.originX : 0;
                    const currentDy = primaryEl ? primaryEl.y - currentDrag.originY : 0;
                    if (!currentDrag.otherElementOrigins) currentDrag.otherElementOrigins = {};
                    if (!currentDrag.otherElementPageOrigins) currentDrag.otherElementPageOrigins = {};
                    const extractedElementIds = this.canvasStore.selectedElementIds.filter((id) => !existingIds.has(id));
                    for (const extId of extractedElementIds) {
                        if (extId === currentDrag.elementId || currentDrag.otherElementOrigins[extId]) continue;
                        const extEl = this.canvasStore.getElementById(extId);
                        if (!extEl || extEl.locked) continue;
                        const extPath = extEl.kind === 'path' && 'points' in extEl ? (extEl as PathElement) : null;
                        currentDrag.otherElementOrigins[extId] = {
                            originX: extEl.x,
                            originY: extEl.y,
                            originPoints: extPath ? JSON.parse(JSON.stringify(extPath.points)) : undefined,
                        };
                        currentDrag.otherElementPageOrigins[extId] = extEl.pageIndex;
                        this.canvasStore.updateElement(extId, {
                            x: extEl.x + currentDx,
                            y: extEl.y + currentDy,
                        });
                    }
                    const withoutPrimary = this.canvasStore.selectedElementIds.filter((id) => id !== currentDrag.elementId);
                    this.canvasStore.selectedElementIds = [...withoutPrimary, currentDrag.elementId];
                })
                .catch(() => {
                    this.promotingMixedSpansInDrag = false;
                });
        }

        if (state.otherElementOrigins) {
            const dx = newX - state.originX;
            const dy = newY - state.originY;
            const primaryOriginPage = state.originPageIndex ?? element.pageIndex;
            const didCrossPage = resolvedTargetPage !== primaryOriginPage;
            for (const [otherId, origin] of Object.entries(state.otherElementOrigins)) {
                const otherOriginPage = state.otherElementPageOrigins?.[otherId];
                const otherUpdates: Partial<CanvasElement> = {
                    x: origin.originX + dx,
                    y: origin.originY + dy,
                };
                if (didCrossPage) {
                    otherUpdates.pageIndex = resolvedTargetPage;
                } else if (otherOriginPage !== undefined) {
                    otherUpdates.pageIndex = otherOriginPage;
                }
                if (origin.originPoints) {
                    (otherUpdates as Partial<PathElement>).points = origin.originPoints.map((p) => ({
                        x: p.x + dx,
                        y: p.y + dy,
                    }));
                }
                this.canvasStore.updateElement(otherId, otherUpdates);
            }
        }
    }

    endDrag(): void {
        const state = this.canvasStore.dragState;
        this.promotingMixedSpansInDrag = false;
        this.clearInteractionCache();
        if (state && state.mode === 'move') {
            const element = this.canvasStore.getElementById(state.elementId);
            const originPageIndex = state.originPageIndex ?? element?.pageIndex ?? 0;
            const hasMoved = element && (
                element.x !== state.originX ||
                element.y !== state.originY ||
                element.pageIndex !== originPageIndex
            );
            
            if (hasMoved && element && element.kind === 'path' && state.originPoints) {
                const dx = element.x - state.originX;
                const dy = element.y - state.originY;
                const shiftedPoints = state.originPoints.map((p: Point) => ({ x: p.x + dx, y: p.y + dy }));
                this.canvasStore.updateElement(state.elementId, { points: shiftedPoints });
            }
            
            this.canvasStore.clearDragState();
            if (hasMoved && element) {
                this.dragJustEnded = true;
                const now = Date.now();
                const pathEl = element.kind === 'path' && 'points' in element ? (element as PathElement) : null;
                const primaryCmd = new MoveElementCommand(
                    'Move Element',
                    state.elementId,
                    state.originX,
                    state.originY,
                    element.x,
                    element.y,
                    now,
                    originPageIndex,
                    element.pageIndex,
                    state.originPoints,
                    pathEl?.points ? JSON.parse(JSON.stringify(pathEl.points)) : undefined,
                );

                if (state.otherElementOrigins && Object.keys(state.otherElementOrigins).length > 0) {
                    const moveCommands: import('../core/command').Command[] = [primaryCmd];
                    for (const [otherId, origin] of Object.entries(state.otherElementOrigins)) {
                        const otherEl = this.canvasStore.getElementById(otherId);
                        if (!otherEl) continue;
                        const otherOriginPage = state.otherElementPageOrigins?.[otherId] ?? otherEl.pageIndex;
                        const otherPath = otherEl.kind === 'path' && 'points' in otherEl ? (otherEl as PathElement) : null;
                        moveCommands.push(
                            new MoveElementCommand(
                                'Move Element',
                                otherId,
                                origin.originX,
                                origin.originY,
                                otherEl.x,
                                otherEl.y,
                                now,
                                otherOriginPage,
                                otherEl.pageIndex,
                                origin.originPoints,
                                otherPath?.points ? JSON.parse(JSON.stringify(otherPath.points)) : undefined,
                            )
                        );
                    }
                    this.editorActions?.pushCommand(
                        moveCommands.length === 1 ? primaryCmd : new CompoundCommand('Move Elements', moveCommands)
                    );
                } else {
                    this.editorActions?.pushCommand(primaryCmd);
                }
            }
        }
    }

    startResize(elementId: string, handle: HandlePosition | LineEndpointHandle, pointerX: number, pointerY: number, pageEl: HTMLElement, zoom: number, pageTransform?: PageTransform): void {
        if (handle === 'start' || handle === 'end') {
            this.startEndpointAdjust(elementId, handle, pointerX, pointerY, pageEl, zoom, pageTransform);
            return;
        }

        if (this.editorActions?.store?.isReadOnly || this.editorActions?.store?.canResizeElements === false) return;
        const element = this.canvasStore.getElementById(elementId);
        if (!element || element.locked) return;

        this.dragJustEnded = false;
        this.clearInteractionCache();
        const { x, y } = this.resolveInteractionPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
        
        const isText = element.kind === 'text';
        const textEl = isText ? (element as TextElement) : null;
        const pathEl = element.kind === 'path' && 'points' in element ? (element as PathElement) : null;

        const multiTransformEnabled =
            !this.editorActions?.featureFlags ||
            (this.editorActions.featureFlags.isEnabled('select-tool.multiselect') &&
                this.editorActions.featureFlags.isEnabled('select-tool.multiselect.transform'));

        const otherResizeOrigins: NonNullable<import('./canvas-types').DragState['otherResizeOrigins']> = {};
        if (
            multiTransformEnabled &&
            this.canvasStore.isSelected(elementId) &&
            this.canvasStore.selectedElementIds.length > 1
        ) {
            for (const otherId of this.canvasStore.selectedElementIds) {
                if (otherId === elementId) continue;
                const otherEl = this.canvasStore.getElementById(otherId);
                if (!otherEl || otherEl.locked) continue;
                const otherText = otherEl.kind === 'text' ? (otherEl as TextElement) : null;
                const otherPath = otherEl.kind === 'path' && 'points' in otherEl ? (otherEl as PathElement) : null;
                otherResizeOrigins[otherId] = {
                    originX: otherEl.x,
                    originY: otherEl.y,
                    originWidth: otherEl.width,
                    originHeight: otherEl.height,
                    originFontSize: otherText ? otherText.fontSize : undefined,
                    originLines: otherText?.lines ? JSON.parse(JSON.stringify(otherText.lines)) : undefined,
                    originSegments: otherText?.segments ? JSON.parse(JSON.stringify(otherText.segments)) : undefined,
                    originPoints: otherPath ? JSON.parse(JSON.stringify(otherPath.points)) : undefined,
                };
            }
            const orderedIds = [...this.canvasStore.selectedElementIds.filter((id) => id !== elementId), elementId];
            this.canvasStore.selectElements(orderedIds, false);
        } else {
            this.canvasStore.selectElement(elementId);
        }

        this.canvasStore.dragState = {
            elementId,
            mode: 'resize',
            handle,
            startX: x,
            startY: y,
            originX: element.x,
            originY: element.y,
            originWidth: element.width,
            originHeight: element.height,
            originPoints: pathEl ? JSON.parse(JSON.stringify(pathEl.points)) : undefined,
            originFontSize: textEl ? textEl.fontSize : undefined,
            originLines: textEl?.lines ? JSON.parse(JSON.stringify(textEl.lines)) : undefined,
            originSegments: textEl?.segments ? JSON.parse(JSON.stringify(textEl.segments)) : undefined,
            otherResizeOrigins: Object.keys(otherResizeOrigins).length > 0 ? otherResizeOrigins : undefined,
        };
    }

    updateResize(
        pointerX: number,
        pointerY: number,
        pageEl: HTMLElement,
        zoom: number,
        shiftKey: boolean = false,
        pageTransform?: PageTransform,
        options?: { disabledSnap?: boolean; screenThresholdPx?: number },
    ): void {
        const state = this.canvasStore.dragState;
        if (!state) return;
        if (state.mode === 'endpoint' || state.handle === 'start' || state.handle === 'end') {
            this.updateEndpointAdjust(pointerX, pointerY, pageEl, zoom, shiftKey, pageTransform, options);
            return;
        }
        if (state.mode !== 'resize' || !state.handle) return;
        
        const element = this.canvasStore.getElementById(state.elementId);
        if (!element) return;

        const { x, y } = this.resolveInteractionPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
        const rawDx = x - state.startX;
        const rawDy = y - state.startY;

        const theta = (element.rotation || 0) * (Math.PI / 180);
        const cosTheta = Math.cos(-theta);
        const sinTheta = Math.sin(-theta);
        const dx = rawDx * cosTheta - rawDy * sinTheta;
        const dy = rawDx * sinTheta + rawDy * cosTheta;

        let newX = state.originX;
        let newY = state.originY;
        let newWidth = state.originWidth;
        let newHeight = state.originHeight;

        const isCorner = state.handle.includes('-');
        // Images always preserve aspect ratio on both corner and edge handles
        const preserveAspect = (element.kind === 'image') || (isCorner && (element.kind === 'text' || shiftKey));

        if (preserveAspect) {
            let proposedW = newWidth;
            let proposedH = newHeight;
            
            if (state.handle.includes('left')) proposedW = state.originWidth - dx;
            else if (state.handle.includes('right')) proposedW = state.originWidth + dx;
            
            if (state.handle.includes('top')) proposedH = state.originHeight - dy;
            else if (state.handle.includes('bottom')) proposedH = state.originHeight + dy;

            if (isCorner) {
                // Project proposed dimensions onto the original aspect ratio diagonal for smooth, jitter-free scaling
                const dot = proposedW * state.originWidth + proposedH * state.originHeight;
                const magSq = state.originWidth * state.originWidth + state.originHeight * state.originHeight;
                if (magSq === 0) return;
                let scale = dot / magSq;
                
                // Unify minimum scale clamping to preserve aspect ratio exactly when shrinking
                const minScale = Math.max(10 / (state.originWidth || 1), 10 / (state.originHeight || 1));
                scale = Math.max(minScale, scale);
                
                newWidth = state.originWidth * scale;
                newHeight = state.originHeight * scale;
            } else {
                // Edge handle on an image: derive uniform scale from the single active axis
                let scale: number;
                if (state.handle === 'left' || state.handle === 'right') {
                    scale = Math.max(10 / state.originWidth, proposedW / state.originWidth);
                } else {
                    scale = Math.max(10 / state.originHeight, proposedH / state.originHeight);
                }
                newWidth = state.originWidth * scale;
                newHeight = state.originHeight * scale;
            }

            if (state.handle.includes('left')) newX = state.originX + (state.originWidth - newWidth);
            if (state.handle.includes('top')) newY = state.originY + (state.originHeight - newHeight);
            
        } else {
            if (state.handle.includes('left')) {
                const maxDx = state.originWidth - 10;
                const appliedDx = Math.min(dx, maxDx);
                newX = state.originX + appliedDx;
                newWidth = state.originWidth - appliedDx;
            } else if (state.handle.includes('right')) {
                newWidth = Math.max(10, state.originWidth + dx);
            }

            if (state.handle.includes('top')) {
                const maxDy = state.originHeight - 10;
                const appliedDy = Math.min(dy, maxDy);
                newY = state.originY + appliedDy;
                newHeight = state.originHeight - appliedDy;
            } else if (state.handle.includes('bottom')) {
                newHeight = Math.max(10, state.originHeight + dy);
            }
        }

        if (!options?.disabledSnap && (!element.rotation || element.rotation % 90 === 0)) {
            const pageDims = this.getPageDimensions(element.pageIndex, pageEl, zoom);
            const candidates = this.getSnapCandidates(element.pageIndex, element.id);

            const cropMargins = this.editorActions?.store?.activeCrop?.pageIndex === element.pageIndex
                ? this.editorActions?.store?.activeCrop?.margins
                : undefined;

            const snapResult = computeResizeSnap(
                state.handle,
                { x: newX, y: newY, width: newWidth, height: newHeight },
                candidates,
                pageDims,
                element.pageIndex,
                zoom,
                cropMargins,
                { screenThresholdPx: options?.screenThresholdPx, disabled: options?.disabledSnap },
            );

            newX = snapResult.x;
            newY = snapResult.y;
            this.canvasStore.activeSnapGuides = snapResult.guides;
        } else {
            this.canvasStore.clearSnapGuides();
        }

        const oldCenterX = state.originX + state.originWidth / 2;
        const oldCenterY = state.originY + state.originHeight / 2;
        
        const newCenterX_unrotated = newX + newWidth / 2;
        const newCenterY_unrotated = newY + newHeight / 2;

        const cxDelta = newCenterX_unrotated - oldCenterX;
        const cyDelta = newCenterY_unrotated - oldCenterY;

        const rotCos = Math.cos(theta);
        const rotSin = Math.sin(theta);
        const realCxDelta = cxDelta * rotCos - cyDelta * rotSin;
        const realCyDelta = cxDelta * rotSin + cyDelta * rotCos;
        
        const trueNewCenterX = oldCenterX + realCxDelta;
        const trueNewCenterY = oldCenterY + realCyDelta;
        
        const finalX = trueNewCenterX - newWidth / 2;
        const finalY = trueNewCenterY - newHeight / 2;

        const updates: Partial<CanvasElement> = {
            x: finalX,
            y: finalY,
            width: newWidth,
            height: newHeight
        };

        if (element.kind === 'path' && state.originPoints) {
            const sx = state.originWidth > 0 ? newWidth / state.originWidth : 1;
            const sy = state.originHeight > 0 ? newHeight / state.originHeight : 1;
            (updates as Partial<PathElement>).points = state.originPoints.map((p) => ({
                x: finalX + (p.x - state.originX) * sx,
                y: finalY + (p.y - state.originY) * sy,
            }));
        }

        if (element.kind === 'text' && state.originFontSize !== undefined && isCorner) {
            const scale = Math.min(newWidth / state.originWidth, newHeight / state.originHeight);
            const newFontSize = Math.max(1, state.originFontSize * scale);
            const textUpdates: Partial<TextElement> = {
                fontSize: newFontSize,
            };

            if (state.originLines && state.originLines.length > 0) {
                textUpdates.lines = state.originLines.map((line) => ({
                    ...line,
                    fontSize: line.fontSize ? Math.max(1, line.fontSize * scale) : newFontSize,
                    lineHeight: line.lineHeight !== undefined ? line.lineHeight * scale : undefined,
                    top: line.top !== undefined ? line.top * scale : undefined,
                    left: line.left !== undefined ? line.left * scale : undefined,
                    width: line.width !== undefined ? line.width * scale : undefined,
                    height: line.height !== undefined ? line.height * scale : undefined,
                    segments: (line.segments ?? []).map((seg) => ({
                        ...seg,
                        fontSize: seg.fontSize ? Math.max(1, seg.fontSize * scale) : newFontSize,
                        left: seg.left !== undefined ? seg.left * scale : undefined,
                        top: seg.top !== undefined ? seg.top * scale : undefined,
                        width: seg.width !== undefined ? seg.width * scale : undefined,
                        height: seg.height !== undefined ? seg.height * scale : undefined,
                    })),
                }));
            }

            if (state.originSegments && state.originSegments.length > 0) {
                textUpdates.segments = state.originSegments.map((seg) => ({
                    ...seg,
                    fontSize: seg.fontSize ? Math.max(1, seg.fontSize * scale) : newFontSize,
                    left: seg.left !== undefined ? seg.left * scale : undefined,
                    top: seg.top !== undefined ? seg.top * scale : undefined,
                    width: seg.width !== undefined ? seg.width * scale : undefined,
                    height: seg.height !== undefined ? seg.height * scale : undefined,
                }));
            }

            Object.assign(updates, textUpdates);
        }

        this.canvasStore.updateElement(state.elementId, updates);

        if (state.otherResizeOrigins && Object.keys(state.otherResizeOrigins).length > 0) {
            const scaleX = state.originWidth > 0 ? newWidth / state.originWidth : 1;
            const scaleY = state.originHeight > 0 ? newHeight / state.originHeight : 1;
            for (const [otherId, other] of Object.entries(state.otherResizeOrigins)) {
                const otherEl = this.canvasStore.getElementById(otherId);
                if (!otherEl) continue;
                const otherW = Math.max(10, other.originWidth * scaleX);
                const otherH = Math.max(10, other.originHeight * scaleY);
                const otherUpdates: Partial<CanvasElement> = {
                    width: otherW,
                    height: otherH,
                };
                if (otherEl.kind === 'path' && other.originPoints) {
                    const osx = other.originWidth > 0 ? otherW / other.originWidth : 1;
                    const osy = other.originHeight > 0 ? otherH / other.originHeight : 1;
                    (otherUpdates as Partial<PathElement>).points = other.originPoints.map((p) => ({
                        x: other.originX + (p.x - other.originX) * osx,
                        y: other.originY + (p.y - other.originY) * osy,
                    }));
                }
                if (otherEl.kind === 'text' && other.originFontSize !== undefined && isCorner) {
                    const otherScale = Math.min(scaleX, scaleY);
                    const otherFontSize = Math.max(1, other.originFontSize * otherScale);
                    const otherTextUpdates: Partial<TextElement> = {
                        fontSize: otherFontSize,
                    };
                    if (other.originLines && other.originLines.length > 0) {
                        otherTextUpdates.lines = other.originLines.map((line) => ({
                            ...line,
                            fontSize: line.fontSize ? Math.max(1, line.fontSize * otherScale) : otherFontSize,
                            lineHeight: line.lineHeight !== undefined ? line.lineHeight * otherScale : undefined,
                            top: line.top !== undefined ? line.top * otherScale : undefined,
                            left: line.left !== undefined ? line.left * otherScale : undefined,
                            width: line.width !== undefined ? line.width * otherScale : undefined,
                            height: line.height !== undefined ? line.height * otherScale : undefined,
                            segments: (line.segments ?? []).map((seg) => ({
                                ...seg,
                                fontSize: seg.fontSize ? Math.max(1, seg.fontSize * otherScale) : otherFontSize,
                                left: seg.left !== undefined ? seg.left * otherScale : undefined,
                                top: seg.top !== undefined ? seg.top * otherScale : undefined,
                                width: seg.width !== undefined ? seg.width * otherScale : undefined,
                                height: seg.height !== undefined ? seg.height * otherScale : undefined,
                            })),
                        }));
                    }
                    if (other.originSegments && other.originSegments.length > 0) {
                        otherTextUpdates.segments = other.originSegments.map((seg) => ({
                            ...seg,
                            fontSize: seg.fontSize ? Math.max(1, seg.fontSize * otherScale) : otherFontSize,
                            left: seg.left !== undefined ? seg.left * otherScale : undefined,
                            top: seg.top !== undefined ? seg.top * otherScale : undefined,
                            width: seg.width !== undefined ? seg.width * otherScale : undefined,
                            height: seg.height !== undefined ? seg.height * otherScale : undefined,
                        }));
                    }
                    Object.assign(otherUpdates, otherTextUpdates);
                }
                this.canvasStore.updateElement(otherId, otherUpdates);
            }
        }
    }

    endResize(): void {
        const state = this.canvasStore.dragState;
        if (state && (state.mode === 'endpoint' || state.handle === 'start' || state.handle === 'end')) {
            this.endEndpointAdjust();
            return;
        }

        this.clearInteractionCache();
        if (state && state.mode === 'resize') {
            const element = this.canvasStore.getElementById(state.elementId);
            const hasResized = element && (element.width !== state.originWidth || element.height !== state.originHeight);
            this.canvasStore.clearSnapGuides();
            this.canvasStore.clearDragState();
            if (hasResized && element) {
                this.dragJustEnded = true;
                const now = Date.now();
                const textEl = element.kind === 'text' ? (element as TextElement) : null;
                const pathEl = element.kind === 'path' && 'points' in element ? (element as PathElement) : null;
                const primaryCmd = new ResizeElementCommand(
                    'Resize Element',
                    state.elementId,
                    {
                        x: state.originX,
                        y: state.originY,
                        width: state.originWidth,
                        height: state.originHeight,
                        fontSize: state.originFontSize,
                    },
                    {
                        x: element.x,
                        y: element.y,
                        width: element.width,
                        height: element.height,
                        fontSize: textEl?.fontSize,
                    },
                    now,
                    state.originLines,
                    textEl?.lines ? JSON.parse(JSON.stringify(textEl.lines)) : undefined,
                    state.originSegments,
                    textEl?.segments ? JSON.parse(JSON.stringify(textEl.segments)) : undefined,
                    state.originPoints,
                    pathEl?.points ? JSON.parse(JSON.stringify(pathEl.points)) : undefined,
                );
                if (state.otherResizeOrigins && Object.keys(state.otherResizeOrigins).length > 0) {
                    const commands: import('../core/command').Command[] = [primaryCmd];
                    for (const [otherId, other] of Object.entries(state.otherResizeOrigins)) {
                        const otherEl = this.canvasStore.getElementById(otherId);
                        if (!otherEl) continue;
                        if (otherEl.width === other.originWidth && otherEl.height === other.originHeight) continue;
                        const otherTextEl = otherEl.kind === 'text' ? (otherEl as TextElement) : null;
                        const otherPathEl = otherEl.kind === 'path' && 'points' in otherEl ? (otherEl as PathElement) : null;
                        commands.push(
                            new ResizeElementCommand(
                                'Resize Element',
                                otherId,
                                {
                                    x: other.originX,
                                    y: other.originY,
                                    width: other.originWidth,
                                    height: other.originHeight,
                                    fontSize: other.originFontSize,
                                },
                                {
                                    x: otherEl.x,
                                    y: otherEl.y,
                                    width: otherEl.width,
                                    height: otherEl.height,
                                    fontSize: otherTextEl?.fontSize,
                                },
                                now,
                                other.originLines,
                                otherTextEl?.lines ? JSON.parse(JSON.stringify(otherTextEl.lines)) : undefined,
                                other.originSegments,
                                otherTextEl?.segments ? JSON.parse(JSON.stringify(otherTextEl.segments)) : undefined,
                                other.originPoints,
                                otherPathEl?.points ? JSON.parse(JSON.stringify(otherPathEl.points)) : undefined,
                            )
                        );
                    }
                    if (commands.length === 1) {
                        this.editorActions?.pushCommand(commands[0]);
                    } else {
                        this.editorActions?.pushCommand(new CompoundCommand('Resize Elements', commands));
                    }
                } else {
                    this.editorActions?.pushCommand(primaryCmd);
                }
            }
        }
    }

    /**
     * Initialises interactive start or end terminal adjustment for a line or arrow.
     *
     * @param elementId Identifier of the target linear shape element.
     * @param handle Start or end terminal handle being dragged.
     * @param pointerX Client screen horizontal pointer coordinate.
     * @param pointerY Client screen vertical pointer coordinate.
     * @param pageEl Reference to the enclosing page container element.
     * @param zoom Active viewport zoom level.
     * @param pageTransform Optional page transformation matrix.
     */
    startEndpointAdjust(
        elementId: string,
        handle: LineEndpointHandle,
        pointerX: number,
        pointerY: number,
        pageEl: HTMLElement,
        zoom: number,
        pageTransform?: PageTransform,
    ): void {
        if (this.editorActions?.store?.isReadOnly || this.editorActions?.store?.canResizeElements === false) return;
        const element = this.canvasStore.getElementById(elementId);
        if (!element || element.locked) return;

        this.clearInteractionCache();
        const { x, y } = this.resolveInteractionPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
        const endpoints = getLineEndpoints(element);

        this.canvasStore.dragState = {
            elementId,
            mode: 'endpoint',
            handle,
            endpointHandle: handle,
            startX: x,
            startY: y,
            originX: element.x,
            originY: element.y,
            originWidth: element.width,
            originHeight: element.height,
            originRotation: element.rotation,
            originFlipX: element.flipX,
            originFlipY: element.flipY,
            originStartPoint: endpoints.start,
            originEndPoint: endpoints.end,
        };

        this.canvasStore.selectElement(elementId);
    }

    /**
     * Updates linear element geometry and alignment guidelines during endpoint dragging.
     *
     * @param pointerX Client screen horizontal pointer coordinate.
     * @param pointerY Client screen vertical pointer coordinate.
     * @param pageEl Reference to the enclosing page container element.
     * @param zoom Active viewport zoom level.
     * @param shiftKey Whether the shift modifier key is pressed.
     * @param pageTransform Optional page transformation matrix.
     * @param options Snapping configuration overrides.
     */
    updateEndpointAdjust(
        pointerX: number,
        pointerY: number,
        pageEl: HTMLElement,
        zoom: number,
        shiftKey: boolean = false,
        pageTransform?: PageTransform,
        options?: { disabledSnap?: boolean; screenThresholdPx?: number },
    ): void {
        const state = this.canvasStore.dragState;
        if (!state || state.mode !== 'endpoint' || !state.originStartPoint || !state.originEndPoint) return;

        const element = this.canvasStore.getElementById(state.elementId);
        if (!element) return;

        const { x, y } = this.resolveInteractionPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
        const handle = state.endpointHandle ?? (state.handle as LineEndpointHandle);
        const isStart = handle === 'start';

        const movingPoint = { x, y };
        const fixedPoint = isStart ? state.originEndPoint : state.originStartPoint;

        const pageDims = this.getPageDimensions(element.pageIndex, pageEl, zoom);
        const candidates = this.getSnapCandidates(element.pageIndex, element.id);

        const snapResult = snapLineEndpoint({
            movingPoint,
            fixedPoint,
            handle,
            candidates,
            pageDimensions: pageDims,
            pageIndex: element.pageIndex,
            zoom,
            shiftKey,
            disabledSnap: options?.disabledSnap,
            screenThresholdPx: options?.screenThresholdPx,
        });

        const newStart = isStart ? snapResult.point : fixedPoint;
        const newEnd = isStart ? fixedPoint : snapResult.point;

        const newGeom = elementFromLineEndpoints(newStart, newEnd, state.originHeight);

        this.canvasStore.updateElement(state.elementId, {
            ...newGeom,
            flipX: false,
            flipY: false,
        });
        this.canvasStore.activeSnapGuides = snapResult.guides;
    }

    /**
     * Concludes interactive endpoint adjustment, clearing guides and pushing command to history.
     */
    endEndpointAdjust(): void {
        const state = this.canvasStore.dragState;
        this.clearInteractionCache();
        if (state && state.mode === 'endpoint') {
            const element = this.canvasStore.getElementById(state.elementId);
            this.canvasStore.clearSnapGuides();
            this.canvasStore.clearDragState();

            if (
                element &&
                (element.x !== state.originX ||
                    element.y !== state.originY ||
                    element.width !== state.originWidth ||
                    element.rotation !== state.originRotation ||
                    element.flipX !== state.originFlipX ||
                    element.flipY !== state.originFlipY)
            ) {
                this.dragJustEnded = true;
                this.editorActions?.pushCommand(
                    new AdjustLineEndpointsCommand(
                        'Adjust Line Endpoints',
                        state.elementId,
                        {
                            x: state.originX,
                            y: state.originY,
                            width: state.originWidth,
                            height: state.originHeight,
                            rotation: state.originRotation || 0,
                            flipX: state.originFlipX,
                            flipY: state.originFlipY,
                        },
                        {
                            x: element.x,
                            y: element.y,
                            width: element.width,
                            height: element.height,
                            rotation: element.rotation || 0,
                            flipX: element.flipX,
                            flipY: element.flipY,
                        },
                    ),
                );
            }
        }
    }

    /**
     * Resizes an element to explicit target dimensions and scales internal geometry such as path points.
     *
     * @param id Target canvas element ID.
     * @param newWidth Target width in PDF points.
     * @param newHeight Target height in PDF points.
     */
    resizeElementToDimensions(id: string, newWidth: number, newHeight: number): void {
        if (this.editorActions?.store?.isReadOnly || this.editorActions?.store?.canResizeElements === false) return;
        const element = this.canvasStore.getElementById(id);
        if (!element || element.locked) return;

        const targetW = Math.max(1, newWidth);
        const targetH = Math.max(1, newHeight);
        const updates: Record<string, unknown> = {};
        if (targetW !== element.width) updates.width = targetW;
        if (targetH !== element.height) updates.height = targetH;
        if (Object.keys(updates).length === 0) return;

        if (element.kind === 'path' && 'points' in element && Array.isArray(element.points)) {
            const sx = element.width > 0 ? targetW / element.width : 1;
            const sy = element.height > 0 ? targetH / element.height : 1;
            updates.points = element.points.map((p) => ({
                x: element.x + (p.x - element.x) * sx,
                y: element.y + (p.y - element.y) * sy,
            }));
        }

        this.updateElementProperties(id, updates);
    }

    /**
     * Resizes all currently selected unlocked elements to explicit target width and/or height in a single command.
     *
     * @param newWidth Optional target width in PDF points.
     * @param newHeight Optional target height in PDF points.
     */
    resizeSelectedElementsToDimensions(newWidth?: number, newHeight?: number): void {
        if (this.editorActions?.store?.isReadOnly || this.editorActions?.store?.canResizeElements === false) return;
        const multiTransformEnabled =
            !this.editorActions?.featureFlags ||
            (this.editorActions.featureFlags.isEnabled('select-tool.multiselect') &&
                this.editorActions.featureFlags.isEnabled('select-tool.multiselect.transform') &&
                this.editorActions.featureFlags.isEnabled('select-tool.multiselect.modify'));
        const ids = multiTransformEnabled && this.canvasStore.selectedElementIds.length > 0
            ? [...this.canvasStore.selectedElementIds]
            : (this.canvasStore.selectedElementId ? [this.canvasStore.selectedElementId] : []);
        if (ids.length === 0) return;

        const entries: Array<{ id: string; updates: Record<string, unknown> }> = [];
        for (const id of ids) {
            const element = this.canvasStore.getElementById(id);
            if (!element || element.locked) continue;

            const targetW = newWidth !== undefined ? Math.max(1, newWidth) : element.width;
            const targetH = newHeight !== undefined ? Math.max(1, newHeight) : element.height;
            const updates: Record<string, unknown> = {};
            if (targetW !== element.width) updates.width = targetW;
            if (targetH !== element.height) updates.height = targetH;
            if (Object.keys(updates).length === 0) continue;

            if (element.kind === 'path' && 'points' in element && Array.isArray(element.points)) {
                const sx = element.width > 0 ? targetW / element.width : 1;
                const sy = element.height > 0 ? targetH / element.height : 1;
                updates.points = element.points.map((p) => ({
                    x: element.x + (p.x - element.x) * sx,
                    y: element.y + (p.y - element.y) * sy,
                }));
            }
            entries.push({ id, updates });
        }

        if (entries.length > 0) {
            this.batchUpdateElementsProperties(entries);
        }
    }

    startRotate(elementId: string, pointerX: number, pointerY: number, pageEl: HTMLElement, zoom: number, pageTransform?: PageTransform): void {
        const element = this.canvasStore.elements.find((e) => e.id === elementId);
        if (!element || element.locked) return;

        const { x, y } = this.screenToPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
        this.canvasStore.dragState = {
            elementId,
            mode: 'rotate',
            handle: null,
            startX: x,
            startY: y,
            originX: element.x,
            originY: element.y,
            originWidth: element.width,
            originHeight: element.height,
            originRotation: element.rotation,
        };
        this.canvasStore.selectElement(elementId);
    }

    updateRotate(pointerX: number, pointerY: number, pageEl: HTMLElement, zoom: number, pageTransform?: PageTransform): void {
        const state = this.canvasStore.dragState;
        if (!state || state.mode !== 'rotate') return;

        const element = this.canvasStore.elements.find((e) => e.id === state.elementId);
        if (!element) return;

        const { x, y } = this.screenToPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
        const centerX = element.x + element.width / 2;
        const centerY = element.y + element.height / 2;
        const startAngle = Math.atan2(state.startY - centerY, state.startX - centerX) * (180 / Math.PI);
        const currentAngle = Math.atan2(y - centerY, x - centerX) * (180 / Math.PI);
        const angleDiff = currentAngle - startAngle;

        let newRotation = ((state.originRotation || 0) + angleDiff) % 360;
        if (newRotation < 0) newRotation += 360;

        // Snapping: 0, 90, 180, 270 (within 5 degrees)
        for (const snapAngle of [0, 90, 180, 270, 360]) {
            if (Math.abs(newRotation - snapAngle) < 5) {
                newRotation = snapAngle === 360 ? 0 : snapAngle;
                break;
            }
        }

        this.canvasStore.updateElementProperties(element.id, {
            rotation: Math.round(newRotation),
        });
    }

    endRotate(): void {
        const state = this.canvasStore.dragState;
        if (!state || state.mode !== 'rotate') return;

        const element = this.canvasStore.elements.find((e) => e.id === state.elementId);
        this.canvasStore.clearDragState();

        if (element && element.rotation !== state.originRotation) {
            this.editorActions?.pushCommand(
                new RotateElementCommand(
                    'Rotate Element',
                    state.elementId,
                    state.originRotation || 0,
                    element.rotation,
                )
            );
        }
    }

    onRotate(pointerX: number, pointerY: number, pageEl: HTMLElement, zoom: number, pageTransform?: PageTransform): void {
        this.updateRotate(pointerX, pointerY, pageEl, zoom, pageTransform);
    }

    onRotateEnd(): void {
        this.endRotate();
    }

  dropElement(payload: ElementDropPayload, pageIndex: number, x: number, y: number): void {
    const id = this.canvasStore.generateId();
    const element = createElementFromPayload(this.elementRegistry, payload, pageIndex, x, y, id);
    this.canvasStore.addElement(element);
    this.canvasStore.selectElement(element.id);
    this.editorActions?.pushCommand(new AddElementCommand(`Add ${payload.kind}`, element));
    this.editorActions?.setTool('select');
  }

    deleteElement(id: string): void {
        const el = this.canvasStore.elements.find((e) => e.id === id);
        if (!el || el.locked) return;
        const kind = el.kind ?? 'Element';
        const index = this.canvasStore.elements.findIndex((e) => e.id === id);
        const snapshot = safeClone(el) as CanvasElement;
        this.canvasStore.removeElement(id);
        this.editorActions?.pushCommand(new RemoveElementCommand(`Delete ${kind}`, id, snapshot, index));
    }

    deleteSelectedElement(): void {
        const id = this.canvasStore.selectedElementId;
        if (id) {
            this.deleteElement(id);
        }
    }

    duplicateSelectedElement(): void {
        const element = this.canvasStore.selectedElement;
        if (!element) return;

        const newId = this.canvasStore.generateId();
        const cloned = safeClone(element) as CanvasElement;
        const newElement = {
            ...cloned,
            id: newId,
            x: element.x + 20,
            y: element.y + 20
        } as CanvasElement;

        this.canvasStore.addElement(newElement);
        this.canvasStore.selectElement(newId);
        this.editorActions?.pushCommand(new AddElementCommand('Duplicate Element', newElement));
    }

    updateElementProperties(id: string, updates: Record<string, unknown>): void {
        const el = this.canvasStore.elements.find((e) => e.id === id);
        if (el) {
            const prevProps: Record<string, unknown> = {};
            const cleanUpdates: Record<string, unknown> = {};
            for (const key of Object.keys(updates)) {
                const rawPrev = (el as unknown as Record<string, unknown>)[key];
                prevProps[key] = rawPrev !== undefined && typeof rawPrev === 'object' && rawPrev !== null
                    ? safeClone(rawPrev)
                    : rawPrev;
                const rawNext = updates[key];
                cleanUpdates[key] = rawNext !== undefined && typeof rawNext === 'object' && rawNext !== null
                    ? safeClone(rawNext)
                    : rawNext;
            }
            this.canvasStore.updateElementProperties(id, updates);
            this.editorActions?.recordDebouncedCommand(
                new UpdateElementPropertyCommand('Update Element Property', id, prevProps, cleanUpdates),
                300,
            );
        }
    }
}

/** Provide canvas actions via Svelte context from a root component. */
export function provideCanvasActions(actions: CanvasActions): void {
  setContext(CANVAS_ACTIONS_KEY, actions);
}

export function useCanvasActions(): CanvasActions {
    const actions = getContext<CanvasActions>(CANVAS_ACTIONS_KEY);
    if (!actions) {
        throw new Error('CanvasActions not found in context');
    }
    return actions;
}
