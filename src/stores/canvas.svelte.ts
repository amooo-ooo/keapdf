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

export class CanvasStore {
    elements = $state<CanvasElement[]>([]);
    selectedElementId = $state<string | null>(null);
    dragState = $state<DragState | null>(null);
    hoveredElementId = $state<string | null>(null);
    editingElementId = $state<string | null>(null);
    activeDropPayload = $state<ElementDropPayload | null>(null);
    dropPreview = $state<DropPreviewState | null>(null);
    activeDropPageIndex = $state<number | null>(null);
    activeSnapGuides = $state<SnapGuide[]>([]);

    selectedElement = $derived(this.elements.find((e) => e.id === this.selectedElementId) ?? null);

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
        return this.elements.find((e) => e.id === id) ?? null;
    }

    updateElement(id: string, updates: Partial<CanvasElement>): void {
        const index = this.elements.findIndex((e) => e.id === id);
        if (index !== -1) {
            Object.assign(this.elements[index], updates);
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
        const index = this.elements.findIndex((e) => e.id === id);
        if (index !== -1) {
            Object.assign(this.elements[index], updates);
        }
    }

    removeElement(id: string): void {
        this.elements = this.elements.filter((e) => e.id !== id);
        if (this.selectedElementId === id) {
            this.selectedElementId = null;
        }
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

    selectElement(id: string | null): void {
        this.selectedElementId = id;
        if (this.editingElementId && this.editingElementId !== id) {
            this.editingElementId = null;
        }
    }

    getElementsByPage(pageIndex: number): CanvasElement[] {
        return this.elementsByPage.get(pageIndex) ?? EMPTY_ELEMENTS;
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
            this.dropPreview.label === preview.label
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
