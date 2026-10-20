<script lang="ts">
    import { useCanvasStore } from '../../stores/canvas.svelte';
    import { useCanvasActions } from '../../stores/canvas-actions';
    import { useEditorStore } from '../../stores/editor.svelte';
    import { useEditorActions } from '../../stores/editor-actions';
    import { getResizeHandlePositions, getHandleCursor, getRotateCursorClass } from '../../utils/geometry';
    import { resolveSelectionVariation, type SelectionVariation } from '../../utils/line-geometry';
    import { tryUseFeatureFlagStore } from '../../core/feature-flags';
    import LineSelectionOverlay from './LineSelectionOverlay.svelte';
    import type { HandlePosition, LineEndpointHandle } from '../../stores/canvas-types';
    import type { EditableTextSpan } from '../../core/types';

    interface Props {
        element: {
            id: string;
            x: number;
            y: number;
            width: number;
            height: number;
            rotation?: number;
            kind?: string;
            variant?: string;
            type?: string;
            selectionVariation?: SelectionVariation;
        };
        zoom: number;
        variation?: SelectionVariation;
        onResizeStart?: (e: PointerEvent, handle: HandlePosition, pageEl: HTMLElement) => void;
        onRotateStart?: (e: PointerEvent, pageEl: HTMLElement) => void;
        onAdjustStart?: (e: PointerEvent, handle: LineEndpointHandle, pageEl: HTMLElement) => void;
        showRotateCursor?: boolean;
    }

    let { element, zoom, variation = 'auto', onResizeStart, onRotateStart, onAdjustStart, showRotateCursor = true }: Props = $props();

    const canvasStore = useCanvasStore();
    const canvasActions = useCanvasActions();
    const editorStore = useEditorStore();
    const editorActions = useEditorActions();
    const featureFlags = tryUseFeatureFlagStore();

    const isPageObj = $derived(element.id.startsWith('page_'));
    const canRotateOverlay = $derived(
        !isPageObj &&
        (showRotateCursor ||
            Boolean(
                featureFlags &&
                featureFlags.isEnabled('select-tool.multiselect') &&
                featureFlags.isEnabled('select-tool.multiselect.transform')
            ))
    );
    const isPage = $derived(isPageObj || !canRotateOverlay);

    const selectedEl = $derived(
        canvasStore.getElementById(element.id) ||
        (editorStore.selectedSpan?.id === element.id ? editorStore.selectedSpan : undefined) ||
        element
    );
    const resolvedVariation = $derived(resolveSelectionVariation(selectedEl, variation, featureFlags));

    const rect = $derived({
        x: 0,
        y: 0,
        width: element.width,
        height: element.height
    });

    const handles = $derived(getResizeHandlePositions(rect));

    const isDragging = $derived(canvasStore.dragState?.mode === 'move');
    const isEditing = $derived(canvasStore.editingElementId === element.id || editorStore.inlineEdit?.spanId === element.id);
    const pointerEventsClass = $derived(isDragging || !editorStore.canResizeElements || editorStore.isReadOnly ? 'pointer-events-none' : 'pointer-events-auto');
    const rotatePointerEventsClass = $derived(isDragging || isEditing || !canRotateOverlay || !editorStore.canResizeElements || editorStore.isReadOnly ? 'pointer-events-none' : 'pointer-events-auto');

    function handlePointerDown(e: PointerEvent, handle: HandlePosition): void {
        if (e.button !== 0 || !editorStore.canResizeElements || editorStore.isReadOnly) return;
        if (e.detail > 1) return;
        e.stopPropagation();
        const target = e.target as HTMLElement;
        const pageEl = target.closest('[data-page-element]') as HTMLElement;
        if (onResizeStart) {
            onResizeStart(e, handle, pageEl || target);
        } else if (pageEl) {
            const selectedEl = canvasStore.getElementById(element.id);
            const pt = selectedEl ? editorStore.getPageTransform(selectedEl.pageIndex) : undefined;
            canvasActions.startResize(element.id, handle, e.clientX, e.clientY, pageEl, zoom, pt);
        }
    }

    function handleRotatePointerDown(e: PointerEvent): void {
        if (e.button !== 0 || !editorStore.canResizeElements || editorStore.isReadOnly) return;
        if (e.detail > 1) return;
        e.stopPropagation();
        const target = e.target as HTMLElement;
        const pageEl = target.closest('[data-page-element]') as HTMLElement;
        if (onRotateStart) {
            onRotateStart(e, pageEl || target);
        } else if (pageEl) {
            const selectedEl = canvasStore.getElementById(element.id);
            const pt = selectedEl ? editorStore.getPageTransform(selectedEl.pageIndex) : undefined;
            canvasActions.startRotate(element.id, e.clientX, e.clientY, pageEl, zoom, pt);
        }
    }

    function handleOverlayDblClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;
        if (target.getAttribute('aria-label')?.includes('Rotate') || target.getAttribute('aria-label')?.includes('Resize')) {
            return;
        }
        e.stopPropagation();
        const selectedEl = canvasStore.getElementById(element.id);
        if (selectedEl && selectedEl.kind === 'form-field') {
            if (editorStore.isReadOnly || !editorStore.canEditValues) return;
            canvasActions.endResize();
            canvasActions.endDrag();
            canvasStore.editingElementId = element.id;
            return;
        }
        if (editorStore.isReadOnly || !editorStore.canEditContent) return;
        if (selectedEl && selectedEl.kind === 'text') {
            canvasActions.endResize();
            canvasActions.endDrag();
            canvasStore.editingElementId = element.id;
        } else if (editorStore.selectedSpan?.id === element.id && editorStore.selectedSpan.type === 'text') {
            editorActions.setCurrentPageFromScroll(editorStore.selectedSpan.pageIndex);
            editorActions.startInlineEdit(editorStore.selectedSpan as EditableTextSpan);
        }
    }

    function handleKeyDown(e: KeyboardEvent): void {
        if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditing && !isPage) {
            if (!editorStore.canDeleteElements || editorStore.isReadOnly) return;
            e.preventDefault();
            e.stopPropagation();
            void editorActions.deleteSelected();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            editorActions.clearSelection(true);
            canvasStore.selectElement(null);
        }
    }

    const CORNER_HANDLES: HandlePosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
</script>

{#if resolvedVariation === 'line'}
    <LineSelectionOverlay
        {element}
        {zoom}
        onAdjustStart={onAdjustStart ?? (onResizeStart ? ((e, handle, pageEl) => onResizeStart(e, handle as unknown as HandlePosition, pageEl)) : undefined)}
    />
{:else}
    <div
        class="selection-overlay-container absolute ring-[1.5px] ring-inset ring-selection pointer-events-none"
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
        <div class="absolute -top-[3px] left-0 right-0 h-[6px] {pointerEventsClass}" style="cursor: ns-resize;" onpointerdown={(e) => handlePointerDown(e, 'top')} onkeydown={handleKeyDown} role="button" tabindex="0" aria-label="Resize top"></div>
        <!-- Bottom edge resize -->
        <div class="absolute -bottom-[3px] left-0 right-0 h-[6px] {pointerEventsClass}" style="cursor: ns-resize;" onpointerdown={(e) => handlePointerDown(e, 'bottom')} onkeydown={handleKeyDown} role="button" tabindex="0" aria-label="Resize bottom"></div>
        <!-- Left edge resize -->
        <div class="absolute top-0 bottom-0 -left-[3px] w-[6px] {pointerEventsClass}" style="cursor: ew-resize;" onpointerdown={(e) => handlePointerDown(e, 'left')} onkeydown={handleKeyDown} role="button" tabindex="0" aria-label="Resize left"></div>
        <!-- Right edge resize -->
        <div class="absolute top-0 bottom-0 -right-[3px] w-[6px] {pointerEventsClass}" style="cursor: ew-resize;" onpointerdown={(e) => handlePointerDown(e, 'right')} onkeydown={handleKeyDown} role="button" tabindex="0" aria-label="Resize right"></div>

        {#each CORNER_HANDLES as hp (hp)}
            {#if canRotateOverlay}
                <!-- Rotation hit area (larger, behind) -->
                <div
                    class="absolute w-6 h-6 {rotatePointerEventsClass} rounded-full -z-10 {getRotateCursorClass(hp as HandlePosition, isPage)}"
                    style="
                        left: {handles[hp].x * zoom - 12}px;
                        top: {handles[hp].y * zoom - 12}px;
                        {isPage ? 'cursor: default;' : ''}
                    "
                    onpointerdown={handleRotatePointerDown}
                    onkeydown={handleKeyDown}
                    role="button"
                    tabindex="0"
                    aria-label="Rotate {hp}"
                ></div>
            {/if}

            <!-- Corner resize handle (white box) -->
            <div
                class="absolute w-2 h-2 bg-white border border-selection {pointerEventsClass} z-10"
                style="
                    left: {handles[hp].x * zoom - 4}px;
                    top: {handles[hp].y * zoom - 4}px;
                    cursor: {getHandleCursor(hp)};
                "
                onpointerdown={(e) => handlePointerDown(e, hp)}
                onkeydown={handleKeyDown}
                role="button"
                tabindex="0"
                aria-label="Resize {hp}"
            ></div>
        {/each}
    </div>
{/if}
