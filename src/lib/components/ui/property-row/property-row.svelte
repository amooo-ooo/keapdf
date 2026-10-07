<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { cn, type WithElementRef } from '$lib/utils.js';

  export type PropertyRowProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    label?: string;
    description?: string;
    class?: string;
    labelSnippet?: Snippet;
    children?: Snippet;
  };

  let {
    ref = $bindable(null),
    class: className,
    label,
    description,
    labelSnippet,
    children,
    ...restProps
  }: PropertyRowProps = $props();
</script>

<div
  bind:this={ref}
  data-slot="property-row"
  class={cn("property-row", className)}
  {...restProps}
>
  <div class="property-row-label">
    {#if labelSnippet}
      {@render labelSnippet()}
    {:else if label}
      <span class="truncate" title={label}>{label}</span>
      {#if description}
        <span class="text-xs text-muted-foreground/80 block truncate" title={description}>{description}</span>
      {/if}
    {/if}
  </div>
  <div class="property-row-control">
    {@render children?.()}
  </div>
</div>
