<script lang="ts">
    import { useCanvasStore } from '../../stores/canvas.svelte';
    import CanvasElementComponent from './CanvasElement.svelte';
    import SelectionOverlay from './SelectionOverlay.svelte';

    interface Props {
        pageIndex: number;
        zoom: number;
    }

    let { pageIndex, zoom }: Props = $props();

    const canvasStore = useCanvasStore();

    const elements = $derived(canvasStore.getElementsByPage(pageIndex));
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

    {#if canvasStore.selectedElement?.pageIndex === pageIndex && canvasStore.selectedElement.visible}
        <SelectionOverlay element={canvasStore.selectedElement} {zoom} />
    {/if}

    {#if canvasStore.dropPreview && canvasStore.dropPreview.pageIndex === pageIndex}
        {@const preview = canvasStore.dropPreview}
        <div
            class="drop-preview-indicator absolute pointer-events-none z-50 border-2 border-dashed border-primary/80 bg-primary/10 transition-none {preview.kind === 'shape' && preview.label?.toLowerCase() === 'circle' ? 'rounded-full' : 'rounded-xs'}"
            style="
                left: {preview.x * zoom}px;
                top: {preview.y * zoom}px;
                width: {preview.width * zoom}px;
                height: {preview.height * zoom}px;
            "
        ></div>
    {/if}
</div>
