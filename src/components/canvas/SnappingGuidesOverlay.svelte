<script lang="ts">
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import type { SnapGuide } from '../../types/snapping-types';

  interface Props {
    pageIndex: number;
    zoom: number;
  }

  const { pageIndex, zoom }: Props = $props();
  const canvasStore = useCanvasStore();

  const pageGuides = $derived(
    canvasStore.activeSnapGuides.filter((guide: SnapGuide) => guide.pageIndex === pageIndex)
  );
</script>

{#if pageGuides.length > 0}
  <div
    class="snapping-guides-overlay absolute inset-0 pointer-events-none z-50 overflow-visible select-none"
    style="transform: translateZ(0);"
    aria-hidden="true"
  >
    <svg
      class="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
      style="transform: translateZ(0);"
    >
      {#each pageGuides as guide (guide.id)}
        {#if guide.orientation === 'vertical'}
          {@const x = (guide.coordinate * zoom).toFixed(1)}
          {@const y1 = (guide.start * zoom).toFixed(1)}
          {@const y2 = (guide.end * zoom).toFixed(1)}
          <line
            class="guide-line guide-line-vertical stroke-snap-guide"
            x1={x}
            y1={y1}
            x2={x}
            y2={y2}
            stroke="var(--snap-guide)"
            stroke-width="1"
            stroke-dasharray="4 3"
            shape-rendering="crispEdges"
          />
          {#if guide.kind === 'spacing-gap'}
            <line
              x1={(guide.coordinate * zoom - 3).toFixed(1)}
              y1={y1}
              x2={(guide.coordinate * zoom + 3).toFixed(1)}
              y2={y1}
              stroke="var(--snap-guide)"
              stroke-width="1"
              shape-rendering="crispEdges"
            />
            <line
              x1={(guide.coordinate * zoom - 3).toFixed(1)}
              y1={y2}
              x2={(guide.coordinate * zoom + 3).toFixed(1)}
              y2={y2}
              stroke="var(--snap-guide)"
              stroke-width="1"
              shape-rendering="crispEdges"
            />
          {/if}
        {:else}
          {@const y = (guide.coordinate * zoom).toFixed(1)}
          {@const x1 = (guide.start * zoom).toFixed(1)}
          {@const x2 = (guide.end * zoom).toFixed(1)}
          <line
            class="guide-line guide-line-horizontal stroke-snap-guide"
            x1={x1}
            y1={y}
            x2={x2}
            y2={y}
            stroke="var(--snap-guide)"
            stroke-width="1"
            stroke-dasharray="4 3"
            shape-rendering="crispEdges"
          />
          {#if guide.kind === 'spacing-gap'}
            <line
              x1={x1}
              y1={(guide.coordinate * zoom - 3).toFixed(1)}
              x2={x1}
              y2={(guide.coordinate * zoom + 3).toFixed(1)}
              stroke="var(--snap-guide)"
              stroke-width="1"
              shape-rendering="crispEdges"
            />
            <line
              x1={x2}
              y1={(guide.coordinate * zoom - 3).toFixed(1)}
              x2={x2}
              y2={(guide.coordinate * zoom + 3).toFixed(1)}
              stroke="var(--snap-guide)"
              stroke-width="1"
              shape-rendering="crispEdges"
            />
          {/if}
        {/if}
      {/each}
    </svg>

    {#each pageGuides as guide (guide.id)}
      {#if guide.label}
        {@const midX =
          guide.orientation === 'horizontal'
            ? ((guide.start + guide.end) / 2) * zoom
            : guide.coordinate * zoom}
        {@const midY =
          guide.orientation === 'vertical'
            ? ((guide.start + guide.end) / 2) * zoom
            : guide.coordinate * zoom}
        <div
          class="guide-pill-badge absolute -translate-x-1/2 -translate-y-1/2 bg-snap-guide text-snap-guide-foreground font-sans font-medium rounded-full px-1.5 py-0.5 text-[10px] whitespace-nowrap pointer-events-none border border-white/20 dark:border-white/10"
          style="left: {midX.toFixed(1)}px; top: {midY.toFixed(1)}px;"
        >
          {guide.label}
        </div>
      {/if}
    {/each}
  </div>
{/if}
