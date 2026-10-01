<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import PageThumbnail from './PageThumbnail.svelte';
  import {
    getDragGroup,
    getDragIndices,
    getDragPayloadData,
    setDragOverState,
    clearDragOverState,
  } from '../common/DraggableListItem.svelte';

  import { useFeatureFlagStore } from '../../core/feature-flags';

  import { untrack } from 'svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

  function resolveFeatureFlags(): ReturnType<typeof useFeatureFlagStore> | null {
    try {
      return useFeatureFlagStore();
    } catch {
      return null;
    }
  }
  const featureFlags = resolveFeatureFlags();

  let stripEl: HTMLElement | null = $state(null);

  const THUMBNAIL_ROW_HEIGHT = 48;
  const THUMBNAIL_OVERSCAN = 6;
  let visibleThumbnailRange = $state<{ start: number; end: number }>({ start: 0, end: 30 });

  function updateVisibleThumbnails(): void {
    if (!stripEl || store.pageCount <= 30) {
      const targetEnd = Math.max(0, store.pageCount - 1);
      const curStart = untrack(() => visibleThumbnailRange.start);
      const curEnd = untrack(() => visibleThumbnailRange.end);
      if (curStart !== 0 || curEnd !== targetEnd) {
        visibleThumbnailRange = { start: 0, end: targetEnd };
      }
      return;
    }
    const scrollContainer = stripEl.parentElement;
    if (!scrollContainer) return;

    const scrollTop = scrollContainer.scrollTop;
    const clientH = scrollContainer.clientHeight || 500;
    const start = Math.max(0, Math.floor(scrollTop / THUMBNAIL_ROW_HEIGHT) - THUMBNAIL_OVERSCAN);
    const end = Math.min(store.pageCount - 1, Math.ceil((scrollTop + clientH) / THUMBNAIL_ROW_HEIGHT) + THUMBNAIL_OVERSCAN);

    const curStart = untrack(() => visibleThumbnailRange.start);
    const curEnd = untrack(() => visibleThumbnailRange.end);
    if (start !== curStart || end !== curEnd) {
      visibleThumbnailRange = { start, end };
    }
  }

  $effect(() => {
    void store.pageCount;
    void store.currentPageIndex;
    // Break reactive cycle: updateVisibleThumbnails writes visibleThumbnailRange
    // which must not re-trigger this effect
    untrack(() => updateVisibleThumbnails());
  });

  $effect(() => {
    if (!stripEl) return;
    const scrollContainer = stripEl.parentElement;
    if (!scrollContainer) return;

    const onScroll = () => {
      updateVisibleThumbnails();
    };

    scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', onScroll);
    };
  });

  $effect(() => {
    const pageIndex = store.currentPageIndex;
    if (stripEl && store.isDocumentLoaded && store.pageCount > 0 && pageIndex >= 0) {
      if (store.pageCount <= 30 || (featureFlags && !featureFlags.isEnabled('performance.virtual-rendering'))) {
        const targetChild = stripEl.children[pageIndex] as HTMLElement;
        if (targetChild) {
          targetChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      } else {
        const scrollContainer = stripEl.parentElement;
        if (scrollContainer) {
          const targetTop = pageIndex * THUMBNAIL_ROW_HEIGHT;
          const currentTop = scrollContainer.scrollTop;
          const currentH = scrollContainer.clientHeight || 500;
          if (targetTop < currentTop || targetTop > currentTop + currentH - THUMBNAIL_ROW_HEIGHT) {
            scrollContainer.scrollTo({
              top: Math.max(0, targetTop - currentH / 2 + THUMBNAIL_ROW_HEIGHT / 2),
              behavior: 'smooth',
            });
          }
        }
      }
    }
  });

  function handleStripDragOver(e: DragEvent): void {
    const group = getDragGroup();
    if (group !== 'files' && group !== 'pages') return;
    if (store.pageCount === 0 || store.isReadOnly) return;
    if (group === 'pages' && !store.canReorderPages) return;
    if (group === 'files' && !store.canMergeFiles) return;

    if (stripEl && stripEl.children.length > 0) {
      const lastChild = stripEl.children[stripEl.children.length - 1] as HTMLElement;
      const lastRect = lastChild.getBoundingClientRect();
      if (e.clientY >= lastRect.bottom) {
        if (group === 'files') {
          const payload = getDragPayloadData();
          let fileIds: string[] = [];
          if (payload['application/x-workspace-file-ids']) {
            try {
              fileIds = JSON.parse(payload['application/x-workspace-file-ids']);
            } catch {
              fileIds = [];
            }
          }
          if (fileIds.length === 0) {
            fileIds = getDragIndices()
              .map(i => store.workspaceFiles[i]?.id)
              .filter((id): id is string => Boolean(id));
          }
          if (!fileIds.some(id => id !== store.activeWorkspaceFileId)) {
            return;
          }
        }
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = group === 'pages' ? 'move' : 'copy';
        }
        setDragOverState(`page_${store.pageCount - 1}`, 'bottom');
      }
    }
  }

  function handleStripDragLeave(e: DragEvent): void {
    if (stripEl && e.relatedTarget && stripEl.contains(e.relatedTarget as Node)) {
      return;
    }
    clearDragOverState();
  }

  function handleStripDrop(e: DragEvent): void {
    const group =
      getDragGroup() ||
      (e.dataTransfer?.types.includes('application/x-drag-group-files')
        ? 'files'
        : e.dataTransfer?.types.includes('application/x-drag-group-pages')
          ? 'pages'
          : e.dataTransfer?.getData('application/x-drag-group') || null);
    if (group !== 'files' && group !== 'pages') return;
    if (!stripEl || stripEl.children.length === 0 || store.isReadOnly) return;
    if (group === 'pages' && !store.canReorderPages) return;
    if (group === 'files' && !store.canMergeFiles) return;

    const lastChild = stripEl.children[stripEl.children.length - 1] as HTMLElement;
    const lastRect = lastChild.getBoundingClientRect();
    if (e.clientY >= lastRect.bottom) {
      e.preventDefault();
      e.stopPropagation();
      clearDragOverState();

      if (group === 'files') {
        const payload = getDragPayloadData();
        let fileIds: string[] = [];
        if (payload['application/x-workspace-file-ids']) {
          try {
            fileIds = JSON.parse(payload['application/x-workspace-file-ids']);
          } catch {
            fileIds = [];
          }
        }
        if (fileIds.length === 0 && e.dataTransfer) {
          const filesData = e.dataTransfer.getData('application/x-workspace-file-ids');
          if (filesData) {
            try {
              fileIds = JSON.parse(filesData);
            } catch {
              fileIds = [];
            }
          }
        }
        if (fileIds.length === 0) {
          fileIds = getDragIndices()
            .map(i => store.workspaceFiles[i]?.id)
            .filter((id): id is string => Boolean(id));
        }
        const activeId = store.activeWorkspaceFileId;
        if (!activeId) return;
        const targetFileIds = fileIds.filter(id => id !== activeId);
        if (targetFileIds.length > 0) {
          void actions.mergeWorkspaceFiles([activeId, ...targetFileIds], store.pageCount);
        }
      } else if (group === 'pages') {
        let indices = getDragIndices();
        if (indices.length === 0 && e.dataTransfer) {
          const pageData = e.dataTransfer.getData('application/x-drag-group-pages');
          if (pageData) {
            try {
              indices = JSON.parse(pageData);
            } catch {
              indices = [];
            }
          }
        }
        if (indices.length > 0) {
          void actions.reorderPages(indices, store.pageCount);
        }
      }
    }
  }
</script>

<div
  bind:this={stripEl}
  class="flex flex-col gap-1 py-1 min-h-full"
  ondragover={handleStripDragOver}
  ondragleave={handleStripDragLeave}
  ondrop={handleStripDrop}
  role="region"
  aria-label="Page thumbnail strip"
>
  {#if store.pageCount <= 30 || (featureFlags && !featureFlags.isEnabled('performance.virtual-rendering'))}
    {#each Array.from({ length: store.pageCount }, (_, i) => i) as pageIdx (pageIdx)}
      <PageThumbnail
        pageIndex={pageIdx}
        isActive={store.currentPageIndex === pageIdx}
      />
    {/each}
  {:else}
    {@const topSpacerHeight = visibleThumbnailRange.start * THUMBNAIL_ROW_HEIGHT}
    {@const bottomSpacerHeight = (store.pageCount - 1 - visibleThumbnailRange.end) * THUMBNAIL_ROW_HEIGHT}
    {#if topSpacerHeight > 0}
      <div style="height: {topSpacerHeight}px;" aria-hidden="true"></div>
    {/if}
    {#each Array.from({ length: Math.max(0, visibleThumbnailRange.end - visibleThumbnailRange.start + 1) }, (_, i) => visibleThumbnailRange.start + i) as pageIdx (pageIdx)}
      <PageThumbnail
        pageIndex={pageIdx}
        isActive={store.currentPageIndex === pageIdx}
      />
    {/each}
    {#if bottomSpacerHeight > 0}
      <div style="height: {bottomSpacerHeight}px;" aria-hidden="true"></div>
    {/if}
  {/if}
</div>
