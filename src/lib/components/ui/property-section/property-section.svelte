<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { cn, type WithElementRef } from '$lib/utils.js';

  export type PropertySectionProps = WithElementRef<HTMLAttributes<HTMLElement>> & {
    title?: string;
    class?: string;
    headerActions?: Snippet;
    children?: Snippet;
  };

  let {
    ref = $bindable(null),
    class: className,
    title,
    headerActions,
    children,
    ...restProps
  }: PropertySectionProps = $props();
</script>

<section
  bind:this={ref}
  data-slot="property-section"
  class={cn("property-section", className)}
  {...restProps}
>
  {#if title || headerActions}
    <div class="property-section-header">
      {#if title}
        <span class="text-xs font-semibold text-foreground tracking-tight truncate" title={title}>{title}</span>
      {/if}
      {#if headerActions}
        <div class="flex items-center gap-1">
          {@render headerActions()}
        </div>
      {/if}
    </div>
  {/if}
  <div class="property-section-content">
    {@render children?.()}
  </div>
</section>
