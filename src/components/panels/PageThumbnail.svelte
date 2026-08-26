<script lang="ts">
  import { useEditorActions } from '../../stores/editor-actions';
  import { useSelection } from '../../stores/selection.svelte';
  import PageThumbnailImage from '../common/PageThumbnailImage.svelte';
  import DraggableListItem from '../common/DraggableListItem.svelte';

  interface Props {
    pageIndex: number;
    isActive: boolean;
  }

  let { pageIndex, isActive }: Props = $props();

  const actions = useEditorActions();
  const selection = useSelection();
</script>

<DraggableListItem
  id={`page_${pageIndex}`}
  index={pageIndex}
  group="pages"
  class="group flex items-center gap-2.5 p-1.5 rounded-md cursor-pointer transition-colors text-xs [&>*]:pointer-events-none {selection.isSelected(`page_${pageIndex}`) ? 'bg-primary/10 text-foreground font-medium' : isActive ? 'bg-muted/60 text-foreground font-medium' : 'hover:bg-muted/60 text-foreground font-normal'}"
  getDragIndices={() => {
    const ids = Array.from(selection.selectedIds);
    return ids
      .filter(id => id.startsWith('page_'))
      .map(id => parseInt(id.replace('page_', ''), 10))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);
  }}
  onclick={(e) => {
    selection.select(
      `page_${pageIndex}`,
      e.ctrlKey || e.metaKey,
      e.shiftKey,
      (start, end) => {
        const startIdx = parseInt(start.split('_')[1], 10);
        const endIdx = parseInt(end.split('_')[1], 10);
        if (isNaN(startIdx) || isNaN(endIdx)) return [];
        const min = Math.min(startIdx, endIdx);
        const max = Math.max(startIdx, endIdx);
        const range = [];
        for (let i = min; i <= max; i++) {
          range.push(`page_${i}`);
        }
        return range;
      }
    );

    if (!e.ctrlKey && !e.shiftKey && !e.metaKey) {
      actions.goToPage(pageIndex);
    }
  }}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') actions.goToPage(pageIndex); }}
  onReorder={(from, to) => actions.reorderPages(from, to)}
  role="button"
  tabindex={0}
>
  <div class="w-7 h-8.5 flex items-center justify-center shrink-0">
    <PageThumbnailImage pageIndex={pageIndex} scale={0.25} class="max-w-full max-h-full w-auto h-auto object-contain rounded border border-border/50 bg-white shadow-2xs" />
  </div>

  <span class="truncate flex-1 text-xs">
    Page {pageIndex + 1}
  </span>
</DraggableListItem>
