<script module lang="ts">
  let globalDragOverId = $state<string | null>(null);
  let globalDropPosition = $state<'top' | 'bottom'>('top');
  let globalDragGroup = $state<string | null>(null);
  let lastDragEndTime = 0;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    id: string;
    index: number;
    group: string;
    children: Snippet;
    getDragIndices?: () => number[];
    onReorder?: (fromIndices: number[], toIndex: number) => void;
  }

  let { id, index, group, children, getDragIndices, onReorder, class: className, onclick, ondragstart, ondragover, ondragleave, ondrop, ondragend, ...rest }: Props = $props();

  let isDragTarget = $derived(globalDragOverId === id && globalDragGroup === group);
</script>

<div class="relative flex flex-col">
  {#if isDragTarget && globalDropPosition === 'top'}
    <div class="absolute -top-1 left-0 right-0 h-1 bg-primary z-10 rounded-full pointer-events-none"></div>
  {/if}

  <div
    draggable="true"
    class={className}
    onclick={(e) => {
      // Suppress click events that fire immediately after a drag finishes
      // to prevent losing selection focus when dropping items.
      if (Date.now() - lastDragEndTime < 200) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      onclick?.(e);
    }}
    ondragstart={(e) => {
      let indices = getDragIndices ? getDragIndices() : [index];
      
      // If the item being dragged is not in the selection, just drag this single item
      if (!indices.includes(index)) {
        indices = [index];
      }
      
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(`application/x-drag-group-${group}`, JSON.stringify(indices));
        globalDragGroup = group;
        
        if (indices.length > 1) {
          const ghost = document.createElement('div');
          ghost.className = 'bg-primary text-primary-foreground text-xs font-medium px-2.5 py-1.5 rounded-full shadow-md z-50 absolute -top-[1000px] left-0 pointer-events-none whitespace-nowrap';
          ghost.textContent = `${indices.length} items`;
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, 15, 15);
          
          setTimeout(() => {
            if (document.body.contains(ghost)) {
              document.body.removeChild(ghost);
            }
          }, 100);
        }
      }
      ondragstart?.(e);
    }}
    ondragover={(e) => {
      if (globalDragGroup !== group) return;
      e.preventDefault();
      if (e.dataTransfer?.types.includes(`application/x-drag-group-${group}`)) {
        e.dataTransfer.dropEffect = 'move';
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        globalDropPosition = y < rect.height / 2 ? 'top' : 'bottom';
        globalDragOverId = id;
      }
      ondragover?.(e);
    }}
    ondragleave={(e) => {
      if (globalDragOverId === id) {
        globalDragOverId = null;
      }
      ondragleave?.(e);
    }}
    ondrop={(e) => {
      if (globalDragGroup !== group) return;
      e.preventDefault();
      const dropPos = globalDropPosition;
      globalDragOverId = null;
      globalDragGroup = null;
      
      const draggedIndicesStr = e.dataTransfer?.getData(`application/x-drag-group-${group}`);
      if (draggedIndicesStr) {
        try {
          const draggedIndices: number[] = JSON.parse(draggedIndicesStr);
          if (Array.isArray(draggedIndices) && draggedIndices.length > 0) {
            const originalTargetIndex = dropPos === 'bottom' ? index + 1 : index;
            
            // Adjust target index by subtracting the number of dragged items that 
            // originally appeared BEFORE the target index, since they will be removed.
            const shift = draggedIndices.filter(i => i < originalTargetIndex).length;
            const targetIndex = originalTargetIndex - shift;
            
            // Optimization: skip if dragging a single item exactly back to its own spot
            if (draggedIndices.length === 1 && draggedIndices[0] === targetIndex) {
               return;
            }
            
            onReorder?.(draggedIndices, targetIndex);
          }
        } catch (err) {
          console.error('Failed to parse drag data', err);
        }
      }
      ondrop?.(e);
    }}
    ondragend={(e) => {
      lastDragEndTime = Date.now();
      ondragend?.(e);
    }}
    {...rest}
  >
    {@render children()}
  </div>

  {#if isDragTarget && globalDropPosition === 'bottom'}
    <div class="absolute -bottom-1 left-0 right-0 h-1 bg-primary z-10 rounded-full pointer-events-none"></div>
  {/if}
</div>
