<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import PageThumbnail from './PageThumbnail.svelte';

  const store = useEditorStore();

  let stripEl: HTMLElement | null = $state(null);

  $effect(() => {
    const pageIndex = store.currentPageIndex;
    if (stripEl && store.isDocumentLoaded && store.pageCount > 0 && pageIndex >= 0) {
      const targetChild = stripEl.children[pageIndex] as HTMLElement;
      if (targetChild) {
        targetChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  });
</script>

<div bind:this={stripEl} class="flex flex-col gap-1 py-1">
  {#each Array.from({ length: store.pageCount }, (_, i) => i) as pageIdx (pageIdx)}
    <PageThumbnail
      pageIndex={pageIdx}
      isActive={store.currentPageIndex === pageIdx}
    />
  {/each}
</div>
