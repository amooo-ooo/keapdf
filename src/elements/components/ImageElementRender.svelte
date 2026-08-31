<script lang="ts">
  import type { ImageElement } from '../../stores/canvas-types';
  import type { ElementRenderProps } from '../../core/element-registry';

  let {
    element,
  }: ElementRenderProps<ImageElement> = $props();
</script>

{#if element.src}
  <img
    src={element.src}
    alt="Placed element"
    draggable="false"
    style="display: block; width: 100%; height: 100%; max-width: none; max-height: none; object-fit: {element.objectFit};"
  />
{:else}
  <div class="w-full h-full bg-muted flex items-center justify-center text-muted-foreground border border-dashed border-border text-xs">
    No image
  </div>
{/if}
