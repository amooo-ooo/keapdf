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

    {#if canvasStore.selectedElement?.pageIndex === pageIndex && canvasStore.selectedElement.visible && canvasStore.editingElementId !== canvasStore.selectedElement.id}
        <SelectionOverlay element={canvasStore.selectedElement} {zoom} />
    {/if}
</div>
