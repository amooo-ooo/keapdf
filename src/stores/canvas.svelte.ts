import { getContext, setContext } from 'svelte';
import type {
    CanvasElement,
    DragState,
    ElementDropPayload,
    DropPreviewState,
    SnapGuide,
} from './canvas-types';

const CANVAS_STORE_KEY = Symbol('canvas-store');
const EMPTY_ELEMENTS: CanvasElement[] = Object.freeze([]) as unknown as CanvasElement[];

/** Maximum z-index threshold below which canvas elements render behind the raw PDF layer. */
export const RAW_PDF_LAYER_Z_THRESHOLD = 10;
/** Base z-index for canvas elements in the back band (behind raw PDF content). */
const BACK_BAND_BASE_Z_INDEX = 2;
/** Maximum z-index in the back band so elements stay strictly below the PDF raster (z-10). */
const BACK_BAND_MAX_Z_INDEX = 9;
/** Base z-index for canvas elements in the front band (above raw PDF content). */
const FRONT_BAND_BASE_Z_INDEX = 21;

function isElementBehindPdf(el: CanvasElement): boolean {
    return typeof el.zIndex === 'number' && el.zIndex < RAW_PDF_LAYER_Z_THRESHOLD;
}

export class CanvasStore {
    elements = $state<CanvasElement[]>([]);
    selectedElementIds = $state<string[]>([]);
    dragState = $state<DragState | null>(null);
    hoveredElementId = $state<string | null>(null);
    editingElementId = $state<string | null>(null);
    activeDropPayload = $state<ElementDropPayload | null>(null);
    dropPreview = $state<DropPreviewState | null>(null);
    activeDropPageIndex = $state<number | null>(null);
    activeSnapGuides = $state<SnapGuide[]>([]);

    private elementByIdMap = $derived.by(() => {
        const map = new Map<string, CanvasElement>();
        for (const el of this.elements) {
            map.set(el.id, el);
        }
        return map;
    });

    private selectedElementIdSet = $derived.by(() => new Set<string>(this.selectedElementIds));

    private selectedElementsCache = $derived.by(() => {
        if (this.selectedElementIds.length === 0) {
            return { list: EMPTY_ELEMENTS };
        }
        const list: CanvasElement[] = [];
        for (const el of this.elements) {
            if (this.selectedElementIdSet.has(el.id)) {
                list.push(el);
            }
        }
        return { list };
    });

    get selectedElementId(): string | null {
        return this.selectedElementIds[this.selectedElementIds.length - 1] ?? null;
    }

    set selectedElementId(id: string | null) {
        if (id === null) {
            this.selectedElementIds = [];
        } else {
            this.selectedElementIds = [id];
        }
    }

    get selectedElement(): CanvasElement | null {
        const id = this.selectedElementId;
        return id ? (this.elementByIdMap.get(id) ?? null) : null;
    }

    get selectedElements(): CanvasElement[] {
        return this.selectedElementsCache.list;
    }

    elementsByPage = $derived.by(() => {
        const map = new Map<number, CanvasElement[]>();
        for (const el of this.elements) {
            const list = map.get(el.pageIndex);
            if (list) {
                list.push(el);
            } else {
                map.set(el.pageIndex, [el]);
            }
        }
        return map;
    });

    addElement(element: CanvasElement): void {
        this.elements.push(element);
    }

    getElementById(id: string): CanvasElement | null {
        return this.elementByIdMap.get(id) ?? null;
    }

    updateElement(id: string, updates: Partial<CanvasElement>): void {
        const el = this.elementByIdMap.get(id);
        if (el) {
            Object.assign(el, updates);
        }
    }

    updateElementPosition(id: string, x: number, y: number): void {
        this.updateElement(id, { x, y } as Partial<CanvasElement>);
    }

    updateElementBounds(
        id: string,
        x: number,
        y: number,
        width: number,
        height: number,
        fontSize?: number,
    ): void {
        const updates: Record<string, unknown> = { x, y, width, height };
        if (fontSize !== undefined) {
            updates.fontSize = fontSize;
        }
        this.updateElement(id, updates as Partial<CanvasElement>);
    }

    updateElementRotation(id: string, rotation: number): void {
        this.updateElement(id, { rotation } as Partial<CanvasElement>);
    }

    updateElementProperties(id: string, updates: Record<string, unknown>): void {
        const el = this.elementByIdMap.get(id);
        if (el) {
            Object.assign(el, updates);
        }
    }

    removeElement(id: string): void {
        this.elements = this.elements.filter((e) => e.id !== id);
        this.selectedElementIds = this.selectedElementIds.filter((item) => item !== id);
        if (this.dragState && 'elementId' in this.dragState && this.dragState.elementId === id) {
            this.dragState = null;
        }
        if (this.hoveredElementId === id) {
            this.hoveredElementId = null;
        }
        if (this.editingElementId === id) {
            this.editingElementId = null;
        }
    }

    /**
     * Checks whether an element is currently in the active selection.
     */
    isSelected(id: string): boolean {
        return this.selectedElementIdSet.has(id);
    }

    /**
     * Selects a canvas element, optionally toggling or adding to existing multi-selection.
     */
    selectElement(id: string | null, isMulti: boolean = false): void {
        if (id === null) {
            this.selectedElementIds = [];
        } else if (isMulti) {
            if (this.selectedElementIds.includes(id)) {
                this.selectedElementIds = this.selectedElementIds.filter((item) => item !== id);
            } else {
                this.selectedElementIds = [...this.selectedElementIds, id];
            }
        } else {
            this.selectedElementIds = [id];
        }
        if (this.editingElementId && !this.selectedElementIds.includes(this.editingElementId)) {
            this.editingElementId = null;
        }
    }

    /**
     * Toggles an element's selection state.
     */
    toggleElement(id: string): void {
        this.selectElement(id, true);
    }

    /**
     * Sets the active selection to a collection of element identifiers.
     */
    selectElements(ids: string[], additive: boolean = false): void {
        if (additive) {
            const next = new Set([...this.selectedElementIds, ...ids]);
            this.selectedElementIds = Array.from(next);
        } else {
            this.selectedElementIds = [...ids];
        }
        if (this.editingElementId && !this.selectedElementIds.includes(this.editingElementId)) {
            this.editingElementId = null;
        }
    }

    getElementsByPage(pageIndex: number): CanvasElement[] {
        return this.elementsByPage.get(pageIndex) ?? EMPTY_ELEMENTS;
    }

    /**
     * Reorders an element among all canvas elements and the raw PDF layer on the same page.
     * Elements in the back band receive zIndex values in [2..9] (below raw PDF content at 10..20),
     * while elements in the front band receive zIndex values >= 21 (above raw PDF content).
     * Preserves relative ordering of elements on other pages.
     */
    reorderElement(elementId: string, direction: 'front' | 'back' | 'forward' | 'backward'): boolean {
        const target = this.elements.find((e) => e.id === elementId);
        if (!target) return false;

        const pageIndex = target.pageIndex;
        const pageElements = this.elements.filter((e) => e.pageIndex === pageIndex);
        if (!pageElements.some((e) => e.id === elementId)) return false;

        const backElements = pageElements.filter((e) => isElementBehindPdf(e));
        const frontElements = pageElements.filter((e) => !isElementBehindPdf(e));
        const isTargetInBack = isElementBehindPdf(target);

        if (!isTargetInBack) {
            const frontIdx = frontElements.findIndex((e) => e.id === elementId);
            if (frontIdx === -1) return false;

            if (direction === 'front') {
                if (frontIdx === frontElements.length - 1) return false;
                const [moved] = frontElements.splice(frontIdx, 1);
                frontElements.push(moved);
            } else if (direction === 'forward') {
                if (frontIdx === frontElements.length - 1) return false;
                const [moved] = frontElements.splice(frontIdx, 1);
                frontElements.splice(frontIdx + 1, 0, moved);
            } else if (direction === 'backward') {
                const [moved] = frontElements.splice(frontIdx, 1);
                if (frontIdx > 0) {
                    frontElements.splice(frontIdx - 1, 0, moved);
                } else {
                    backElements.push(moved);
                }
            } else if (direction === 'back') {
                const [moved] = frontElements.splice(frontIdx, 1);
                backElements.unshift(moved);
            }
        } else {
            const backIdx = backElements.findIndex((e) => e.id === elementId);
            if (backIdx === -1) return false;

            if (direction === 'back') {
                if (backIdx === 0) return false;
                const [moved] = backElements.splice(backIdx, 1);
                backElements.unshift(moved);
            } else if (direction === 'backward') {
                if (backIdx === 0) return false;
                const [moved] = backElements.splice(backIdx, 1);
                backElements.splice(backIdx - 1, 0, moved);
            } else if (direction === 'forward') {
                if (backIdx < backElements.length - 1) {
                    const [moved] = backElements.splice(backIdx, 1);
                    backElements.splice(backIdx + 1, 0, moved);
                } else {
                    const [moved] = backElements.splice(backIdx, 1);
                    frontElements.unshift(moved);
                }
            } else if (direction === 'front') {
                const [moved] = backElements.splice(backIdx, 1);
                frontElements.push(moved);
            }
        }

        for (let i = 0; i < backElements.length; i++) {
            backElements[i].zIndex = Math.min(BACK_BAND_MAX_Z_INDEX, BACK_BAND_BASE_Z_INDEX + i);
        }
        for (let i = 0; i < frontElements.length; i++) {
            frontElements[i].zIndex = FRONT_BAND_BASE_Z_INDEX + i;
        }

        const nextElementsOnPage = [...backElements, ...frontElements];
        let pageCursor = 0;
        this.elements = this.elements.map((el) => {
            if (el.pageIndex === pageIndex) {
                return nextElementsOnPage[pageCursor++];
            }
            return el;
        });

        return true;
    }

    /**
     * Restores an explicit ordering of elements and optional per-element z-index values.
     */
    reorderElementsByIds(orderedIds: string[], zIndexMap?: Record<string, number | undefined>): void {
        const elementMap = new Map<string, CanvasElement>();
        for (const el of this.elements) {
            if (zIndexMap && Object.prototype.hasOwnProperty.call(zIndexMap, el.id)) {
                el.zIndex = zIndexMap[el.id];
            }
            elementMap.set(el.id, el);
        }

        const reordered: CanvasElement[] = [];
        for (const id of orderedIds) {
            const el = elementMap.get(id);
            if (el) {
                reordered.push(el);
                elementMap.delete(id);
            }
        }

        for (const remaining of elementMap.values()) {
            reordered.push(remaining);
        }

        this.elements = reordered;
    }

    /**
     * Inspects the stacking order metrics of an element within its page,
     * accounting for both the front band (above raw PDF content) and back band (below raw PDF content).
     */
    getElementOrder(elementId: string): {
        isAtTop: boolean;
        isAtBottom: boolean;
        isBehindPdf: boolean;
        index: number;
        total: number;
    } {
        const target = this.elements.find((e) => e.id === elementId);
        if (!target) {
            return { isAtTop: true, isAtBottom: true, isBehindPdf: false, index: -1, total: 0 };
        }

        const pageElements = this.elements.filter((e) => e.pageIndex === target.pageIndex);
        const backElements = pageElements.filter((e) => isElementBehindPdf(e));
        const frontElements = pageElements.filter((e) => !isElementBehindPdf(e));
        const orderedPageElements = [...backElements, ...frontElements];
        const index = orderedPageElements.findIndex((e) => e.id === elementId);
        const total = orderedPageElements.length;
        const behindPdf = isElementBehindPdf(target);

        const isAtTop = !behindPdf && frontElements.findIndex((e) => e.id === elementId) === frontElements.length - 1;
        const isAtBottom = behindPdf && backElements.findIndex((e) => e.id === elementId) === 0;

        return {
            isAtTop,
            isAtBottom,
            isBehindPdf: behindPdf,
            index,
            total,
        };
    }

    bringToFront(elementId: string): boolean {
        return this.reorderElement(elementId, 'front');
    }

    bringForward(elementId: string): boolean {
        return this.reorderElement(elementId, 'forward');
    }

    sendBackward(elementId: string): boolean {
        return this.reorderElement(elementId, 'backward');
    }

    sendToBack(elementId: string): boolean {
        return this.reorderElement(elementId, 'back');
    }

    clearDragState(): void {
        this.dragState = null;
        this.clearSnapGuides();
    }

    clearSnapGuides(): void {
        if (this.activeSnapGuides.length > 0) {
            this.activeSnapGuides = [];
        }
    }

    setDropPreview(preview: DropPreviewState | null): void {
        if (!preview && !this.dropPreview) {
            return;
        }
        if (
            preview &&
            this.dropPreview &&
            this.dropPreview.pageIndex === preview.pageIndex &&
            this.dropPreview.x === preview.x &&
            this.dropPreview.y === preview.y &&
            this.dropPreview.width === preview.width &&
            this.dropPreview.height === preview.height &&
            this.dropPreview.kind === preview.kind &&
            this.dropPreview.label === preview.label &&
            this.dropPreview.payload === preview.payload
        ) {
            return;
        }
        this.dropPreview = preview;
    }

    clearDropState(): void {
        this.activeDropPayload = null;
        this.dropPreview = null;
        this.activeDropPageIndex = null;
        this.clearSnapGuides();
    }

    generateId(): string {
        return crypto.randomUUID();
    }
}

/** Provide the canvas store via Svelte context from a root component. */
export function provideCanvasStore(store: CanvasStore): void {
    setContext(CANVAS_STORE_KEY, store);
}

export function useCanvasStore(): CanvasStore {
    const store = getContext<CanvasStore>(CANVAS_STORE_KEY);
    if (!store) {
        throw new Error('CanvasStore not found in context');
    }
    return store;
}
