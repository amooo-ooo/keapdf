<script lang="ts">
    import { useCanvasStore } from '../../stores/canvas.svelte';
    import { useEditorStore } from '../../stores/editor.svelte';
    import { tryUseElementRegistry, createElementFromPayload } from '../../core/element-registry';
    import CanvasElementComponent from './CanvasElement.svelte';
    import SelectionOverlay from './SelectionOverlay.svelte';
    import SnappingGuidesOverlay from './SnappingGuidesOverlay.svelte';
    import { isLineElement } from '../../utils/line-geometry';

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

    const isPreviewCircle = $derived.by(() => {
        if (!isCurrentDropPage) return false;
        const preview = canvasStore.dropPreview;
        return Boolean(
            preview?.kind === 'shape' &&
            (preview.label?.toLowerCase() === 'circle' ||
             preview.payload?.variant === 'circle')
        );
    });

    const previewElement = $derived.by(() => {
        if (!isCurrentDropPage || !elementRegistry) {
            return null;
        }
        const preview = canvasStore.dropPreview;
        if (!preview) {
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
                0,
                0,
                'drop-preview-element',
                { width: preview.width, height: preview.height },
            );
        } catch {
            return null;
        }
    });

    const isPreviewLine = $derived.by(() => {
        if (!isCurrentDropPage) return false;
        const preview = canvasStore.dropPreview;
        return Boolean(
            (previewElement && isLineElement(previewElement)) ||
            (preview?.kind === 'shape' &&
             (preview.label?.toLowerCase() === 'line' ||
              preview.label?.toLowerCase() === 'arrow' ||
              (preview.payload as Record<string, unknown> | undefined)?.variant === 'line' ||
              (preview.payload as Record<string, unknown> | undefined)?.variant === 'arrow'))
        );
    });
</script>

<div
    class="absolute inset-[1px] pointer-events-none"
    data-page-element="true"
    data-canvas-layer="true"
>
    {#each elements as element (element.id)}
        {#if element.visible}
            <CanvasElementComponent {element} {zoom} isSelected={canvasStore.isSelected(element.id)} />
        {/if}
    {/each}

    {#if canvasStore.selectedElements.length > 0 && !editorStore.isReadOnly && editorStore.canSelectElements}
        {#each canvasStore.selectedElements as selEl (selEl.id)}
            {#if selEl.pageIndex === pageIndex && selEl.visible}
                <div class="absolute inset-0 pointer-events-none z-40">
                    <SelectionOverlay element={selEl} {zoom} showRotateCursor={canvasStore.selectedElements.length === 1} />
                </div>
            {/if}
        {/each}
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

            {#if isPreviewLine}
                <div class="drop-preview-indicator absolute inset-0 pointer-events-none transition-none overflow-visible">
                    <svg class="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                        <line
                            x1="0"
                            y1="50%"
                            x2="100%"
                            y2="50%"
                            stroke="var(--selection)"
                            stroke-width="1.5"
                            stroke-dasharray="3 3"
                            class="opacity-80"
                        />
                    </svg>
                    <!-- Start terminal square handle -->
                    <div class="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-white border border-selection pointer-events-none z-10"></div>
                    <!-- End terminal square handle -->
                    <div class="absolute left-full top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-white border border-selection pointer-events-none z-10"></div>
                </div>
            {:else}
                <div
                    class="drop-preview-indicator absolute inset-0 pointer-events-none ring-[1.5px] ring-inset ring-selection transition-none {isPreviewCircle ? 'rounded-full' : ''}"
                >
                    <div class="absolute -top-1 -left-1 w-2 h-2 bg-white border border-selection pointer-events-none z-10"></div>
                    <div class="absolute -top-1 -right-1 w-2 h-2 bg-white border border-selection pointer-events-none z-10"></div>
                    <div class="absolute -bottom-1 -left-1 w-2 h-2 bg-white border border-selection pointer-events-none z-10"></div>
                    <div class="absolute -bottom-1 -right-1 w-2 h-2 bg-white border border-selection pointer-events-none z-10"></div>
                </div>
            {/if}
        </div>
    {/if}

    <SnappingGuidesOverlay {pageIndex} {zoom} />
</div>
