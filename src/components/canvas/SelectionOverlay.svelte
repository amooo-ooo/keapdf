<script lang="ts">
    import { useCanvasStore } from '../../stores/canvas.svelte';
    import { useCanvasActions } from '../../stores/canvas-actions';
    import { useEditorStore } from '../../stores/editor.svelte';
    import { getResizeHandlePositions, getHandleCursor, getAllHandlePositions, getRotateCursorClass } from '../../utils/geometry';
    import type { HandlePosition } from '../../stores/canvas-types';

    interface Props {
        element: { id: string; x: number; y: number; width: number; height: number; rotation?: number };
        zoom: number;
        onResizeStart?: (e: PointerEvent, handle: HandlePosition, pageEl: HTMLElement) => void;
        onRotateStart?: (e: PointerEvent, pageEl: HTMLElement) => void;
    }

    let { element, zoom, onResizeStart, onRotateStart }: Props = $props();

    const canvasStore = useCanvasStore();
    const canvasActions = useCanvasActions();
    const editorStore = useEditorStore();

    const rect = $derived({
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height
    });

    const handles = $derived(getResizeHandlePositions(rect));
    const handlePositions = getAllHandlePositions();

    const isDragging = $derived(canvasStore.dragState?.mode === 'move');
    const pointerEventsClass = $derived(isDragging ? 'pointer-events-none' : 'pointer-events-auto');

    function handlePointerDown(e: PointerEvent, handle: HandlePosition): void {
        if (e.detail > 1) return;
        e.stopPropagation();
        const target = e.target as HTMLElement;
        const pageEl = target.closest('[data-page-element]') as HTMLElement;
        if (onResizeStart) {
            onResizeStart(e, handle, pageEl || target);
        } else if (pageEl) {
            const selectedEl = canvasStore.elements.find(el => el.id === element.id);
            const pt = selectedEl ? editorStore.getPageTransform(selectedEl.pageIndex) : undefined;
            canvasActions.startResize(element.id, handle, e.clientX, e.clientY, pageEl, zoom, pt);
        }
    }

    function handleRotatePointerDown(e: PointerEvent): void {
        if (e.detail > 1) return;
        e.stopPropagation();
        const target = e.target as HTMLElement;
        const pageEl = target.closest('[data-page-element]') as HTMLElement;
        if (onRotateStart) {
            onRotateStart(e, pageEl || target);
        } else if (pageEl) {
            const selectedEl = canvasStore.elements.find(el => el.id === element.id);
            const pt = selectedEl ? editorStore.getPageTransform(selectedEl.pageIndex) : undefined;
            canvasActions.startRotate(element.id, e.clientX, e.clientY, pageEl, zoom, pt);
        }
    }

    function handleOverlayDblClick(e: MouseEvent): void {
        e.stopPropagation();
        const selectedEl = canvasStore.elements.find(el => el.id === element.id);
        if (selectedEl && selectedEl.kind === 'text') {
            canvasActions.endResize();
            canvasActions.endDrag();
            canvasStore.editingElementId = element.id;
        }
    }
</script>

<div
    class="selection-overlay-container absolute ring-[1.5px] ring-inset ring-[#0D99FF] pointer-events-none"
    style="
        left: {element.x * zoom}px;
        top: {element.y * zoom}px;
        width: {element.width * zoom}px;
        height: {element.height * zoom}px;
        transform: rotate({element.rotation || 0}deg);
    "
    ondblclick={handleOverlayDblClick}
    role="presentation"
>
    <!-- Top edge resize -->
    <div class="absolute -top-[3px] left-0 right-0 h-[6px] {pointerEventsClass}" style="cursor: ns-resize;" onpointerdown={(e) => handlePointerDown(e, 'top')} role="button" tabindex="0" aria-label="Resize top"></div>
    <!-- Bottom edge resize -->
    <div class="absolute -bottom-[3px] left-0 right-0 h-[6px] {pointerEventsClass}" style="cursor: ns-resize;" onpointerdown={(e) => handlePointerDown(e, 'bottom')} role="button" tabindex="0" aria-label="Resize bottom"></div>
    <!-- Left edge resize -->
    <div class="absolute top-0 bottom-0 -left-[3px] w-[6px] {pointerEventsClass}" style="cursor: ew-resize;" onpointerdown={(e) => handlePointerDown(e, 'left')} role="button" tabindex="0" aria-label="Resize left"></div>
    <!-- Right edge resize -->
    <div class="absolute top-0 bottom-0 -right-[3px] w-[6px] {pointerEventsClass}" style="cursor: ew-resize;" onpointerdown={(e) => handlePointerDown(e, 'right')} role="button" tabindex="0" aria-label="Resize right"></div>

    {#each handlePositions.filter((hp: string) => hp.includes('-')) as hp}
        <!-- Rotation hit area (larger, behind) -->
        <div
            class="absolute w-6 h-6 {pointerEventsClass} rounded-full -z-10 {getRotateCursorClass(hp as HandlePosition)}"
            style="
                left: {(handles[hp].x - element.x) * zoom - 12}px;
                top: {(handles[hp].y - element.y) * zoom - 12}px;
            "
            onpointerdown={handleRotatePointerDown}
            role="button"
            tabindex="0"
            aria-label="Rotate {hp}"
        ></div>

        <!-- Corner resize handle (white box) -->
        <div
            class="absolute w-2 h-2 bg-white border border-[#0D99FF] {pointerEventsClass} z-10"
            style="
                left: {(handles[hp].x - element.x) * zoom - 4}px;
                top: {(handles[hp].y - element.y) * zoom - 4}px;
                cursor: {getHandleCursor(hp)};
            "
            onpointerdown={(e) => handlePointerDown(e, hp)}
            role="button"
            tabindex="0"
            aria-label="Resize {hp}"
        ></div>
    {/each}
</div>
