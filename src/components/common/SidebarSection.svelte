<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronDown, ChevronRight } from 'lucide-svelte';
  import { cn } from '$lib/utils';

  interface Props {
    title: string;
    collapsible?: boolean;
    defaultExpanded?: boolean;
    borderBottom?: boolean;
    class?: string;
    headerActions?: Snippet;
    children?: Snippet;
  }

  let {
    title,
    collapsible = false,
    defaultExpanded = true,
    borderBottom = true,
    class: customClass = '',
    headerActions,
    children,
  }: Props = $props();

  let expanded = $state(defaultExpanded);

  function toggleExpand(): void {
    if (collapsible) {
      expanded = !expanded;
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (collapsible && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      toggleExpand();
    }
  }
</script>

<section class={cn("sidebar-section pt-1.5 gap-1.5", (collapsible && !expanded) ? "pb-1.5" : "pb-3.5", borderBottom && "sidebar-divider", customClass)}>
  {#if collapsible}
    <div
      class="sidebar-section-header cursor-pointer hover:bg-muted/40 rounded transition-colors duration-150"
      onclick={toggleExpand}
      onkeydown={handleKeyDown}
      role="button"
      tabindex="0"
      aria-expanded={expanded}
    >
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="sidebar-section-title truncate">{title}</span>
      </div>

      <div class="flex items-center gap-1">
        {@render headerActions?.()}
        {#if expanded}
          <ChevronDown class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {:else}
          <ChevronRight class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {/if}
      </div>
    </div>
  {:else}
    <div class="sidebar-section-header">
      <span class="sidebar-section-title truncate">{title}</span>
      {#if headerActions}
        <div class="flex items-center gap-1">
          {@render headerActions()}
        </div>
      {/if}
    </div>
  {/if}

  {#if !collapsible || expanded}
    <div class="sidebar-section-content">
      {@render children?.()}
    </div>
  {/if}
</section>
