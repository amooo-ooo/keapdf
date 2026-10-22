<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useSelection } from '../../stores/selection.svelte';
  import PageThumbnailImage from '../common/PageThumbnailImage.svelte';
  import DraggableListItem from '../common/DraggableListItem.svelte';

  interface Props {
    pageIndex: number;
    displayIndex?: number;
    isActive: boolean;
    onDropFiles?: (fileIds: string[], targetIndex: number) => void;
  }

  let { pageIndex, displayIndex, isActive, onDropFiles }: Props = $props();

  const store = useEditorStore();
  const actions = useEditorActions();
  const selection = useSelection();

  const optRotation = $derived((store.getOptimisticRotation(pageIndex) + store.getPendingRenderRotation(pageIndex)) % 360);
  const isOptimisticallyDeleted = $derived(store.isPageOptimisticallyDeleted(pageIndex));

  function canDropGroup(sourceGroup: string, indices: number[], payload: Record<string, string>): boolean {
    if (sourceGroup === 'pages') {
      return store.canReorderPages && !store.isReadOnly;
    }
    if (sourceGroup === 'files') {
      if (!store.canMergeFiles || store.isReadOnly) return false;
      let fileIds: string[] = [];
      if (payload['application/x-workspace-file-ids']) {
        try {
          fileIds = JSON.parse(payload['application/x-workspace-file-ids']);
        } catch {
          fileIds = [];
        }
      }
      if (fileIds.length === 0) {
        fileIds = indices
          .map(i => store.workspaceFiles[i]?.id)
          .filter((id): id is string => Boolean(id));
      }
      return fileIds.some(id => id !== store.activeWorkspaceFileId);
    }
    return false;
  }

  function handleDropFromGroup(sourceGroup: string, indices: number[], targetIndex: number, payload: Record<string, string>): void {
    if (store.isReadOnly || !store.canMergeFiles) return;
    if (sourceGroup === 'files') {
      let fileIds: string[] = [];
      if (payload['application/x-workspace-file-ids']) {
        try {
          fileIds = JSON.parse(payload['application/x-workspace-file-ids']);
        } catch {
          fileIds = [];
        }
      }
      if (fileIds.length === 0) {
        fileIds = indices
          .map(i => store.workspaceFiles[i]?.id)
          .filter((id): id is string => Boolean(id));
      }
      const activeId = store.activeWorkspaceFileId;
      if (!activeId) return;
      const targetFileIds = fileIds.filter(id => id !== activeId);
      if (targetFileIds.length > 0) {
        if (onDropFiles) {
          onDropFiles(targetFileIds, targetIndex);
        } else {
          void actions.mergeWorkspaceFiles([activeId, ...targetFileIds], targetIndex);
        }
      }
    }
  }

  function selectPage(ctrlKey: boolean, shiftKey: boolean): void {
    if (shiftKey && !selection.lastSelectedId && store.currentPageIndex >= 0) {
      selection.lastSelectedId = `page_${store.currentPageIndex}`;
      selection.selectedIds.add(`page_${store.currentPageIndex}`);
    }

    selection.select(
      `page_${pageIndex}`,
      ctrlKey,
      shiftKey,
      (start, end) => {
        const startIdx = parseInt(start.split('_')[1], 10);
        const endIdx = parseInt(end.split('_')[1], 10);
        if (isNaN(startIdx) || isNaN(endIdx)) return [];
        const min = Math.min(startIdx, endIdx);
        const max = Math.max(startIdx, endIdx);
        const range: string[] = [];
        for (let i = min; i <= max; i++) {
          range.push(`page_${i}`);
        }
        return range;
      }
    );
  }

  function handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const isSelected = selection.isSelected(`page_${pageIndex}`);
    if (e.shiftKey || e.ctrlKey || e.metaKey || !isSelected) {
      selectPage(e.ctrlKey || e.metaKey, e.shiftKey);
    }
  }

  function handleClick(e: MouseEvent): void {
    if (!e.ctrlKey && !e.shiftKey && !e.metaKey) {
      selectPage(false, false);
      actions.goToPage(pageIndex);
    }
  }
</script>

<DraggableListItem
  id={`page_${pageIndex}`}
  index={displayIndex !== undefined ? displayIndex : pageIndex}
  group="pages"
  acceptGroups={['files']}
  canDrop={canDropGroup}
  onDropFromGroup={handleDropFromGroup}
  draggable={store.canReorderPages && !store.isReadOnly}
  class="group flex items-center gap-2.5 p-1.5 rounded-md cursor-pointer transition-[max-height,margin,padding,opacity,transform,background-color] duration-200 text-xs [&>*]:pointer-events-none outline-none focus-visible:ring-1.5 focus-visible:ring-ring {selection.isSelected(`page_${pageIndex}`) ? 'bg-secondary text-foreground font-medium' : isActive ? 'bg-muted/60 text-foreground font-medium' : 'hover:bg-muted/60 text-foreground font-normal'} {isOptimisticallyDeleted ? 'opacity-30 pointer-events-none max-h-0 -my-1 py-0 scale-95 overflow-hidden transition-[max-height,margin,padding,opacity,transform,background-color] duration-200' : 'max-h-12 opacity-100 transition-[max-height,margin,padding,opacity,transform,background-color] duration-200'}"
  getDragIndices={() => {
    const ids = Array.from(selection.selectedIds);
    const selected = ids
      .filter(id => id.startsWith('page_'))
      .map(id => parseInt(id.replace('page_', ''), 10))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);
    return selected.includes(pageIndex) ? selected : [pageIndex];
  }}
  getDragPayload={() => {
    const ids = Array.from(selection.selectedIds);
    let selected = ids
      .filter(id => id.startsWith('page_'))
      .map(id => parseInt(id.replace('page_', ''), 10))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);
    if (!selected.includes(pageIndex)) {
      selected = [pageIndex];
    }
    return {
      'application/x-page-indices': JSON.stringify(selected),
      'application/x-workspace-page-indices': JSON.stringify(selected),
      'application/x-page-source-file-id': store.activeWorkspaceFileId || '',
    };
  }}
  onpointerdown={handlePointerDown}
  onclick={handleClick}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') actions.goToPage(pageIndex); }}
  onReorder={(from, to) => { if (store.canReorderPages && !store.isReadOnly) actions.reorderPages(from, to); }}
  role="button"
  tabindex={0}
>
  <div 
    class="w-7 h-8.5 flex items-center justify-center shrink-0"
    style={optRotation !== 0 ? `transform: rotate(${optRotation}deg);` : undefined}
  >
    <PageThumbnailImage pageIndex={pageIndex} scale={0.25} class="max-w-full max-h-full w-auto h-auto object-contain rounded border border-border/50 bg-white" />
  </div>

  <span class="truncate flex-1 text-xs" title={`Page ${(displayIndex !== undefined ? displayIndex : pageIndex) + 1}`}>
    Page {(displayIndex !== undefined ? displayIndex : pageIndex) + 1}
  </span>
</DraggableListItem>
