<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import PageThumbnail from './PageThumbnail.svelte';

  const store = useEditorStore();

  let stripEl: HTMLElement | null = $state(null);

  $effect(() => {
    if (stripEl && store.isDocumentLoaded && store.pageCount > 0) {
      const frac = store.scrollFraction;
      if (isNaN(frac)) return;
      
      const idx1 = Math.min(Math.floor(frac), store.pageCount - 1);
      const idx2 = Math.min(Math.ceil(frac), store.pageCount - 1);
      const ratio = frac - idx1;
      
      const children = stripEl.children;
      const el1 = children[idx1] as HTMLElement;
      const el2 = children[idx2] as HTMLElement;
      
      if (el1) {
         let targetCenterY = el1.offsetTop + el1.offsetHeight / 2;
         if (el2 && idx2 !== idx1) {
            const center2 = el2.offsetTop + el2.offsetHeight / 2;
            targetCenterY = targetCenterY + (center2 - targetCenterY) * ratio;
         }
         
         if (stripEl.parentElement) {
            const parent = stripEl.parentElement;
            const parentClientHeight = parent.clientHeight;
            if (parent.scrollHeight > parentClientHeight) {
              const targetScrollTop = targetCenterY - parentClientHeight / 2;
              parent.scrollTop = targetScrollTop;
            }
         }
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
