<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { cn, type WithElementRef } from '$lib/utils.js';

  export type PropertyCardProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    label?: string;
    actionText?: string;
    class?: string;
    icon?: Snippet;
    action?: Snippet;
    children?: Snippet;
    onAction?: () => void;
  };

  let {
    ref = $bindable(null),
    class: className,
    label,
    actionText = 'Edit',
    icon,
    action,
    children,
    onAction,
    ...restProps
  }: PropertyCardProps = $props();
</script>

<div
  bind:this={ref}
  data-slot="property-card"
  class={cn("property-card", className)}
  {...restProps}
>
  <div class="flex items-center gap-2 min-w-0 flex-1">
    {#if icon}
      {@render icon()}
    {/if}
    {#if label}
      <span class="text-xs font-medium text-foreground truncate" title={label}>{label}</span>
    {/if}
    {@render children?.()}
  </div>
  <div class="shrink-0 flex items-center">
    {#if action}
      {@render action()}
    {:else if onAction}
      <button
        type="button"
        class="text-xs text-muted-foreground hover:text-foreground font-normal transition-colors cursor-pointer select-none"
        onclick={onAction}
      >
        {actionText}
      </button>
    {/if}
  </div>
</div>
