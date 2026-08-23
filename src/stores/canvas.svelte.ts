import { getContext, setContext } from 'svelte';
import type { CanvasElement, DragState } from './canvas-types';

const CANVAS_STORE_KEY = Symbol('canvas-store');

export class CanvasStore {
    elements = $state<CanvasElement[]>([]);
    selectedElementId = $state<string | null>(null);
    dragState = $state<DragState | null>(null);
    hoveredElementId = $state<string | null>(null);
    editingElementId = $state<string | null>(null);

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

    updateElement(id: string, updates: Partial<CanvasElement>): void {
        const index = this.elements.findIndex((e) => e.id === id);
        if (index !== -1) {
            Object.assign(this.elements[index], updates);
        }
    }

    updateElementProperties(id: string, updates: Record<string, string | number | boolean>): void {
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
        return this.elementsByPage.get(pageIndex) ?? [];
    }

    clearDragState(): void {
        this.dragState = null;
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
