import { getContext, setContext } from 'svelte';
import type { CanvasStore } from './canvas.svelte';
import type { EditorActions } from './editor-actions';
import {
  type CanvasElement,
  type CanvasElementKind,
  type ElementDropPayload,
  type FormFieldVariant,
  type HandlePosition,
  type PathElement,
  type Point,
  type ShapeVariant,
  type TextElement,
} from './canvas-types';
import type { PageTransform } from './types';
import type { ElementRegistry } from '../core/element-registry';
import {
  AddElementCommand,
  RemoveElementCommand,
  MoveElementCommand,
  ResizeElementCommand,
  RotateElementCommand,
  UpdateElementPropertyCommand,
} from '../commands';
import { screenToPageCoords } from '../utils/geometry';
import { safeClone } from '../utils/clone-utils';
import { computeDragSnap, computeResizeSnap, extractSnapCandidates } from '../utils/snapping-engine';
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
  fontFamily?: string;
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
}

export class CanvasActions {
  constructor(
    private canvasStore: CanvasStore,
    public editorActions: EditorActions | undefined,
    private elementRegistry: ElementRegistry,
  ) {}

  setEditorActions(actions: EditorActions): void {
    this.editorActions = actions;
  }

  createElement(
    kind: CanvasElementKind,
    pageIndex: number,
    x: number,
    y: number,
    options?: CreateElementOptions,
  ): void {
    if (!this.elementRegistry.has(kind)) {
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
    if (options?.fontFamily != null) overrides.fontFamily = options.fontFamily;
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

    const element = def.create(id, pageIndex, x, y, overrides) as CanvasElement;

    this.canvasStore.addElement(element);
    this.canvasStore.selectElement(id);
    this.editorActions?.pushCommand(new AddElementCommand(`Add ${kind}`, element));
    this.editorActions?.setTool('select');
  }

  screenToPageCoords(clientX: number, clientY: number, pageEl: HTMLElement, zoom: number, pageTransform?: PageTransform): { x: number; y: number } {
    return screenToPageCoords(clientX, clientY, pageEl, zoom, pageTransform);
  }

    startDrag(elementId: string, pointerX: number, pointerY: number, pageEl: HTMLElement, zoom: number, pageTransform?: PageTransform): void {
        const element = this.canvasStore.elements.find((e) => e.id === elementId);
        if (!element || element.locked) return;

        const { x, y } = this.screenToPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
        const grabOffsetX = x - element.x;
        const grabOffsetY = y - element.y;
        const pathEl = element.kind === 'path' && 'points' in element ? (element as PathElement) : null;
        
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
        };
        
        this.canvasStore.selectElement(elementId);
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
        const cachedSpans = this.editorActions?.service?.document?.getCachedPageSpans(pageIndex);
        const hiddenSpanIds = this.editorActions?.store?.hiddenSpanIds;
        return extractSnapCandidates(
            pageIndex,
            this.canvasStore.getElementsByPage(pageIndex),
            excludeElementId,
            cachedSpans,
            hiddenSpanIds,
        );
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

        const element = this.canvasStore.elements.find((e) => e.id === state.elementId);
        if (!element) return;

        const { x, y } = this.screenToPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
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
    }

    endDrag(): void {
        const state = this.canvasStore.dragState;
        if (state && state.mode === 'move') {
            const element = this.canvasStore.elements.find((e) => e.id === state.elementId);
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
                const pathEl = element.kind === 'path' && 'points' in element ? (element as PathElement) : null;
                this.editorActions?.pushCommand(
                    new MoveElementCommand(
                        'Move Element',
                        state.elementId,
                        state.originX,
                        state.originY,
                        element.x,
                        element.y,
                        Date.now(),
                        originPageIndex,
                        element.pageIndex,
                        state.originPoints,
                        pathEl?.points ? JSON.parse(JSON.stringify(pathEl.points)) : undefined,
                    )
                );
            }
        }
    }

    startResize(elementId: string, handle: HandlePosition, pointerX: number, pointerY: number, pageEl: HTMLElement, zoom: number, pageTransform?: PageTransform): void {
        const element = this.canvasStore.elements.find((e) => e.id === elementId);
        if (!element || element.locked) return;

        const { x, y } = this.screenToPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
        
        const isText = element.kind === 'text';
        const textEl = isText ? (element as TextElement) : null;
        
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
            originFontSize: textEl ? textEl.fontSize : undefined,
            originLines: textEl?.lines ? JSON.parse(JSON.stringify(textEl.lines)) : undefined,
            originSegments: textEl?.segments ? JSON.parse(JSON.stringify(textEl.segments)) : undefined,
        };
        
        this.canvasStore.selectElement(elementId);
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
        if (!state || state.mode !== 'resize' || !state.handle) return;
        
        const element = this.canvasStore.elements.find(e => e.id === state.elementId);
        if (!element) return;

        const { x, y } = this.screenToPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
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

        if (element.kind === 'text' && state.originFontSize !== undefined) {
            const scale = newHeight / state.originHeight;
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
    }

    endResize(): void {
        const state = this.canvasStore.dragState;
        if (state && state.mode === 'resize') {
            const element = this.canvasStore.elements.find((e) => e.id === state.elementId);
            const hasResized = element && (element.width !== state.originWidth || element.height !== state.originHeight);
            this.canvasStore.clearDragState();
            if (hasResized && element) {
                const textEl = element.kind === 'text' ? (element as TextElement) : null;
                this.editorActions?.pushCommand(
                    new ResizeElementCommand(
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
                        Date.now(),
                        state.originLines,
                        textEl?.lines ? JSON.parse(JSON.stringify(textEl.lines)) : undefined,
                        state.originSegments,
                        textEl?.segments ? JSON.parse(JSON.stringify(textEl.segments)) : undefined,
                    )
                );
            }
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
    const options: CreateElementOptions = {};
    if (payload.variant) {
      options.variant = payload.variant;
    }
    if (payload.label) {
      options.label = payload.label;
    }
    if (payload.text) {
      options.text = payload.text;
    }
    if (payload.author) {
      options.author = payload.author;
    }
    if (payload.fontSize) {
      options.fontSize = payload.fontSize;
    }
    if (payload.fontWeight) {
      options.fontWeight = payload.fontWeight;
    }
    if (payload.fontFamily) {
      options.fontFamily = payload.fontFamily;
    }
    if (payload.color) {
      options.color = payload.color;
    }
    if (payload.backgroundColor) {
      options.backgroundColor = payload.backgroundColor;
    }
    if (payload.borderColor) {
      options.borderColor = payload.borderColor;
    }
    if (payload.borderWidth != null) {
      options.borderWidth = payload.borderWidth;
    }
    if (payload.borderStyle) {
      options.borderStyle = payload.borderStyle;
    }
    if (payload.borderRadius != null) {
      options.borderRadius = payload.borderRadius;
    }
    if (payload.textAlign) {
      options.textAlign = payload.textAlign;
    }
    if (payload.placeholder) {
      options.placeholder = payload.placeholder;
    }
    if (payload.value) {
      options.value = payload.value;
    }
    if (payload.width != null) {
      options.width = payload.width;
    }
    if (payload.height != null) {
      options.height = payload.height;
    }
    if (payload.options != null) {
      options.options = payload.options;
    }
    if (payload.required != null) {
      options.required = payload.required;
    }
    if (payload.readOnly != null) {
      options.readOnly = payload.readOnly;
    }
    if (payload.src != null) {
      options.src = payload.src;
    }
    this.createElement(payload.kind, pageIndex, x, y, options);
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
            for (const key of Object.keys(updates)) {
                prevProps[key] = (el as unknown as Record<string, unknown>)[key];
            }
            this.canvasStore.updateElementProperties(id, updates);
            this.editorActions?.recordDebouncedCommand(
                new UpdateElementPropertyCommand('Update Element Property', id, prevProps, updates),
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
