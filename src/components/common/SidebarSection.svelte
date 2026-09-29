<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronDown, ChevronRight } from 'lucide-svelte';
  import { cn } from '$lib/utils';
  import { sidebarSectionHeaderVariants } from './sidebar-section';

  interface Props {
    title: string;
    collapsible?: boolean;
    defaultExpanded?: boolean;
    borderBottom?: boolean;
    class?: string;
    headerClass?: string;
    headerActions?: Snippet;
    children?: Snippet;
  }

  let {
    title,
    collapsible = false,
    defaultExpanded = true,
    borderBottom = true,
    class: customClass = '',
    headerClass = '',
    headerActions,
    children,
  }: Props = $props();

  let userExpanded = $state<boolean | null>(null);
  const isExpanded = $derived(userExpanded !== null ? userExpanded : defaultExpanded);

  function toggleExpand(): void {
    if (collapsible) {
      userExpanded = !isExpanded;
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (collapsible && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      toggleExpand();
    }
  }
</script>

<section class={cn("sidebar-section", (collapsible && !isExpanded) ? "sidebar-section-collapsed" : "sidebar-section-expanded", borderBottom && "sidebar-divider", customClass)}>
  {#if collapsible}
    <div
      class={cn(sidebarSectionHeaderVariants({ collapsible: true }), headerClass)}
      onclick={toggleExpand}
      onkeydown={handleKeyDown}
      role="button"
      tabindex="0"
      aria-expanded={isExpanded}
    >
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="sidebar-section-title truncate">{title}</span>
      </div>

      <div class="flex items-center gap-1">
        {@render headerActions?.()}
        {#if isExpanded}
          <ChevronDown class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {:else}
          <ChevronRight class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {/if}
      </div>
    </div>
  {:else}
    <div class={cn(sidebarSectionHeaderVariants({ collapsible: false }), headerClass)}>
      <span class="sidebar-section-title truncate">{title}</span>
      {#if headerActions}
        <div class="flex items-center gap-1">
          {@render headerActions()}
        </div>
      {/if}
    </div>
  {/if}

  {#if !collapsible || isExpanded}
    <div class="sidebar-section-content">
      {@render children?.()}
    </div>
  {/if}
</section>
