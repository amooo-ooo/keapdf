import { getContext, setContext } from 'svelte';
import type { CanvasStore } from './canvas.svelte';
import type { EditorActions } from './editor-actions';
import {
  type CanvasElement,
  type CanvasElementKind,
  type ElementDropPayload,
  type HandlePosition,
  type TextElement,
  ELEMENT_DEFAULTS,
} from './canvas-types';
import type { PageTransform } from './types';
import type { ElementRegistry } from '../core/element-registry';

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

    const element = def.create(id, pageIndex, x, y, overrides);

    this.canvasStore.addElement(element);
    this.canvasStore.selectElement(id);
    this.editorActions?.recordSnapshot(`Add ${kind}`);
  }

    screenToPageCoords(clientX: number, clientY: number, pageEl: HTMLElement, zoom: number, pageTransform?: PageTransform): { x: number; y: number } {
        const rect = pageEl.getBoundingClientRect();
        const rotation = pageTransform?.rotation ?? 0;
        const scaleX = pageTransform?.scaleX ?? 1;
        const scaleY = pageTransform?.scaleY ?? 1;

        if (rotation === 0 && scaleX === 1 && scaleY === 1) {
            return {
                x: (clientX - rect.left) / zoom,
                y: (clientY - rect.top) / zoom
            };
        }

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = clientX - cx;
        const dy = clientY - cy;

        const rad = -rotation * (Math.PI / 180);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const ux = dx * cos - dy * sin;
        const uy = dx * sin + dy * cos;

        const lx = ux / scaleX;
        const ly = uy / scaleY;

        const halfW = pageEl.offsetWidth / 2;
        const halfH = pageEl.offsetHeight / 2;

        return {
            x: (lx / zoom) + halfW,
            y: (ly / zoom) + halfH
        };
    }

    startDrag(elementId: string, pointerX: number, pointerY: number, pageEl: HTMLElement, zoom: number, pageTransform?: PageTransform): void {
        const element = this.canvasStore.elements.find((e) => e.id === elementId);
        if (!element || element.locked) return;

        const { x, y } = this.screenToPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
        
        this.canvasStore.dragState = {
            elementId,
            mode: 'move',
            handle: null,
            startX: x,
            startY: y,
            originX: element.x,
            originY: element.y,
            originWidth: element.width,
            originHeight: element.height
        };
        
        this.canvasStore.selectElement(elementId);
    }

    updateDrag(pointerX: number, pointerY: number, pageEl: HTMLElement, zoom: number, pageTransform?: PageTransform): void {
        const state = this.canvasStore.dragState;
        if (!state || state.mode !== 'move') return;

        const { x, y } = this.screenToPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
        const dx = x - state.startX;
        const dy = y - state.startY;

        this.canvasStore.updateElement(state.elementId, {
            x: state.originX + dx,
            y: state.originY + dy
        });
    }

    endDrag(): void {
        const state = this.canvasStore.dragState;
        if (state && state.mode === 'move') {
            const element = this.canvasStore.elements.find((e) => e.id === state.elementId);
            const hasMoved = element && (element.x !== state.originX || element.y !== state.originY);
            this.canvasStore.clearDragState();
            if (hasMoved) {
                this.editorActions?.recordSnapshot('Move Element');
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

    updateResize(pointerX: number, pointerY: number, pageEl: HTMLElement, zoom: number, shiftKey: boolean = false, pageTransform?: PageTransform): void {
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
            if (hasResized) {
                this.editorActions?.recordSnapshot('Resize Element');
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
            originRotation: element.rotation || 0
        };
        
        this.canvasStore.selectElement(elementId);
    }

    updateRotate(pointerX: number, pointerY: number, pageEl: HTMLElement, zoom: number, pageTransform?: PageTransform): void {
        const state = this.canvasStore.dragState;
        if (!state || state.mode !== 'rotate' || state.originRotation === undefined) return;

        const { x, y } = this.screenToPageCoords(pointerX, pointerY, pageEl, zoom, pageTransform);
        
        const centerX = state.originX + state.originWidth / 2;
        const centerY = state.originY + state.originHeight / 2;

        const startAngle = Math.atan2(state.startY - centerY, state.startX - centerX);
        const currentAngle = Math.atan2(y - centerY, x - centerX);
        
        let deltaAngle = (currentAngle - startAngle) * (180 / Math.PI);
        let newRotation = (state.originRotation + deltaAngle) % 360;
        
        if (newRotation < 0) {
            newRotation += 360;
        }

        this.canvasStore.updateElement(state.elementId, {
            rotation: Math.round(newRotation)
        });
    }

    endRotate(): void {
        const state = this.canvasStore.dragState;
        if (state && state.mode === 'rotate') {
            const element = this.canvasStore.elements.find((e) => e.id === state.elementId);
            const hasRotated = element && element.rotation !== state.originRotation;
            this.canvasStore.clearDragState();
            if (hasRotated) {
                this.editorActions?.recordSnapshot('Rotate Element');
            }
        }
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
    this.createElement(payload.kind, pageIndex, x, y, options);
  }

    deleteSelectedElement(): void {
        const id = this.canvasStore.selectedElementId;
        if (id) {
            const el = this.canvasStore.elements.find((e) => e.id === id);
            const kind = el?.kind ?? 'Element';
            this.canvasStore.removeElement(id);
            this.editorActions?.recordSnapshot(`Delete ${kind}`);
        }
    }

    duplicateSelectedElement(): void {
        const element = this.canvasStore.selectedElement;
        if (!element) return;

        const newId = this.canvasStore.generateId();
        const newElement = {
            ...structuredClone($state.snapshot(element)),
            id: newId,
            x: element.x + 20,
            y: element.y + 20
        } as CanvasElement;

        this.canvasStore.addElement(newElement);
        this.canvasStore.selectElement(newId);
        this.editorActions?.recordSnapshot('Duplicate Element');
    }

    updateElementProperties(id: string, updates: Record<string, string | number | boolean>): void {
        this.canvasStore.updateElementProperties(id, updates);
        this.editorActions?.recordDebouncedSnapshot('Update Element Property', 300);
    }
}

/** Provide canvas actions via Svelte context from a root component. */
export function provideCanvasActions(actions: CanvasActions): void {
  setContext(CANVAS_ACTIONS_KEY, actions);
}

/** Format a variant string into a human-readable label. */
function formatVariantLabel(variant: string): string {
  return variant
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function useCanvasActions(): CanvasActions {
    const actions = getContext<CanvasActions>(CANVAS_ACTIONS_KEY);
    if (!actions) {
        throw new Error('CanvasActions not found in context');
    }
    return actions;
}
