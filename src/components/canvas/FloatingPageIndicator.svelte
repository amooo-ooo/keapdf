<script lang="ts">
  import { fade } from 'svelte/transition';
  import { useEditorStore } from '../../stores/editor.svelte';

  const store = useEditorStore();

  let visible = $state(false);
  let timeoutId: ReturnType<typeof setTimeout>;

  // Show indicator whenever the page index changes
  $effect(() => {
    // Explicitly reading the value tracks it as a dependency
    store.currentPageIndex;
    if (store.isDocumentLoaded) {
      showIndicator();
    }
    return () => clearTimeout(timeoutId);
  });

  function showIndicator() {
    visible = true;
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      visible = false;
    }, 2500);
  }

  function handleMouseEnter() {
    visible = true;
    clearTimeout(timeoutId);
  }

  function handleMouseLeave() {
    timeoutId = setTimeout(() => {
      visible = false;
    }, 1000);
  }
</script>

<div
  class="absolute bottom-2 right-2 p-1 z-50 pointer-events-auto flex items-end justify-end"
  role="presentation"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
>
  {#if visible && store.isDocumentLoaded}
    <div
      role="status"
      aria-live="polite"
      transition:fade={{ duration: 200 }}
      class="text-muted-foreground text-xs font-medium tracking-wide pointer-events-none select-none"
    >
      Page {store.currentPageIndex + 1} of {store.pageCount}
    </div>
  {/if}
</div>
