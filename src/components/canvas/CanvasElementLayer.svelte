<script lang="ts">
    import { useCanvasStore } from '../../stores/canvas.svelte';
    import { useEditorStore } from '../../stores/editor.svelte';
    import { tryUseElementRegistry, createElementFromPayload } from '../../core/element-registry';
    import CanvasElementComponent from './CanvasElement.svelte';
    import SelectionOverlay from './SelectionOverlay.svelte';
    import SnappingGuidesOverlay from './SnappingGuidesOverlay.svelte';

    interface Props {
        pageIndex: number;
        zoom: number;
    }

    let { pageIndex, zoom }: Props = $props();

    const canvasStore = useCanvasStore();
    const editorStore = useEditorStore();
    const elementRegistry = tryUseElementRegistry();

    const elements = $derived(canvasStore.getElementsByPage(pageIndex));

    const isCurrentDropPage = $derived(
        Boolean(canvasStore.dropPreview && canvasStore.dropPreview.pageIndex === pageIndex)
    );

    const isPreviewCircle = $derived(
        Boolean(
            canvasStore.dropPreview?.kind === 'shape' &&
            (canvasStore.dropPreview.label?.toLowerCase() === 'circle' ||
             canvasStore.dropPreview.payload?.variant === 'circle')
        )
    );

    const previewElement = $derived.by(() => {
        const preview = canvasStore.dropPreview;
        if (!preview || preview.pageIndex !== pageIndex || !elementRegistry) {
            return null;
        }
        const payload = preview.payload ?? canvasStore.activeDropPayload ?? {
            kind: preview.kind,
            label: preview.label,
            width: preview.width,
            height: preview.height,
        };
        try {
            return createElementFromPayload(
                elementRegistry,
                payload,
                pageIndex,
                preview.x,
                preview.y,
                'drop-preview-element',
                { width: preview.width, height: preview.height },
            );
        } catch {
            return null;
        }
    });
</script>

<div
    class="absolute inset-0 pointer-events-none z-40"
    data-page-element="true"
    data-canvas-layer="true"
>
    {#each elements as element (element.id)}
        {#if element.visible}
            <CanvasElementComponent {element} {zoom} isSelected={canvasStore.selectedElementId === element.id} />
        {/if}
    {/each}

    {#if canvasStore.selectedElement?.pageIndex === pageIndex && canvasStore.selectedElement.visible && !editorStore.isReadOnly && editorStore.canSelectElements}
        <SelectionOverlay element={canvasStore.selectedElement} {zoom} />
    {/if}

    {#if isCurrentDropPage && canvasStore.dropPreview}
        {@const preview = canvasStore.dropPreview}
        <div
            class="drop-preview-container absolute pointer-events-none z-50 transition-none"
            style="
                left: {preview.x * zoom}px;
                top: {preview.y * zoom}px;
                width: {preview.width * zoom}px;
                height: {preview.height * zoom}px;
            "
        >
            {#if previewElement}
                {@const def = elementRegistry?.tryGet(previewElement.kind)}
                {#if def?.component}
                    {@const Component = def.component}
                    <div
                        class="drop-preview-component absolute inset-0 flex pointer-events-none select-none {previewElement.kind === 'text' || previewElement.kind === 'note' || previewElement.kind === 'path' ? 'items-start overflow-visible' : 'items-center justify-center overflow-hidden'} {isPreviewCircle ? 'rounded-full' : 'rounded-xs'}"
                    >
                        <Component element={previewElement} {zoom} selected={false} editing={false} />
                    </div>
                {/if}
            {/if}

            <div
                class="drop-preview-indicator absolute inset-0 pointer-events-none ring-[1.5px] ring-inset ring-selection transition-none"
            >
                <div class="absolute -top-1 -left-1 w-2 h-2 bg-white border border-selection pointer-events-none z-10"></div>
                <div class="absolute -top-1 -right-1 w-2 h-2 bg-white border border-selection pointer-events-none z-10"></div>
                <div class="absolute -bottom-1 -left-1 w-2 h-2 bg-white border border-selection pointer-events-none z-10"></div>
                <div class="absolute -bottom-1 -right-1 w-2 h-2 bg-white border border-selection pointer-events-none z-10"></div>
            </div>
        </div>
    {/if}

    <SnappingGuidesOverlay {pageIndex} {zoom} />
</div>
