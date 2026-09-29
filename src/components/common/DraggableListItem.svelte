<script module lang="ts">
  let globalDragOverId = $state<string | null>(null);
  let globalDropPosition = $state<'top' | 'bottom'>('top');
  let globalDragGroup = $state<string | null>(null);
  let globalDragIndices = $state<number[]>([]);
  let globalDragPayload = $state<Record<string, string>>({});
  let lastDragEndTime = 0;

  export function getDragOverId(): string | null {
    return globalDragOverId;
  }

  export function getDropPosition(): 'top' | 'bottom' {
    return globalDropPosition;
  }

  export function getDragGroup(): string | null {
    return globalDragGroup;
  }

  export function getDragIndices(): number[] {
    return globalDragIndices;
  }

  export function getDragPayloadData(): Record<string, string> {
    return globalDragPayload;
  }

  export function setDragOverState(id: string | null, position: 'top' | 'bottom' = 'top'): void {
    globalDragOverId = id;
    globalDropPosition = position;
  }

  export function clearDragOverState(): void {
    globalDragOverId = null;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    id: string;
    index: number;
    group: string;
    acceptGroups?: string[];
    children: Snippet;
    getDragIndices?: () => number[];
    getDragPayload?: () => Record<string, string>;
    canDrop?: (sourceGroup: string, indices: number[], payload: Record<string, string>) => boolean;
    onReorder?: (fromIndices: number[], toIndex: number) => void;
    onDropFromGroup?: (sourceGroup: string, indices: number[], targetIndex: number, payload: Record<string, string>) => void;
    draggable?: boolean;
  }

  let {
    id,
    index,
    group,
    acceptGroups,
    children,
    getDragIndices,
    getDragPayload,
    canDrop,
    onReorder,
    onDropFromGroup,
    draggable = true,
    class: className,
    onclick,
    ondragstart,
    ondragover,
    ondragleave,
    ondrop,
    ondragend,
    ...rest
  }: Props = $props();

  let isDragTarget = $derived(
    globalDragOverId === id &&
    (globalDragGroup === group || (acceptGroups !== undefined && globalDragGroup !== null && acceptGroups.includes(globalDragGroup)))
  );
</script>

<div class="relative flex flex-col">
  {#if isDragTarget && globalDropPosition === 'top'}
    <div class="absolute -top-1 left-0 right-0 h-1 bg-primary z-10 rounded-full pointer-events-none"></div>
  {/if}

  <div
    draggable={draggable}
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
      if (!draggable) {
        e.preventDefault();
        return;
      }
      let indices = getDragIndices ? getDragIndices() : [index];
      
      // If the item being dragged is not in the selection, just drag this single item
      if (!indices.includes(index)) {
        indices = [index];
      }

      const payload = getDragPayload ? getDragPayload() : {};
      
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'all';
        e.dataTransfer.setData(`application/x-drag-group-${group}`, JSON.stringify(indices));
        e.dataTransfer.setData('application/x-drag-group', group);
        for (const [key, val] of Object.entries(payload)) {
          e.dataTransfer.setData(key, val);
        }
        globalDragGroup = group;
        globalDragIndices = indices;
        globalDragPayload = payload;
        
        if (indices.length > 1) {
          const ghost = document.createElement('div');
          ghost.className = 'bg-primary text-primary-foreground text-xs font-medium px-2.5 py-1.5 rounded-full z-50 absolute -top-[1000px] left-0 pointer-events-none whitespace-nowrap';
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
      const isAcceptedGroup =
        globalDragGroup === group ||
        (acceptGroups !== undefined && globalDragGroup !== null && acceptGroups.includes(globalDragGroup));
      if (!isAcceptedGroup || !globalDragGroup) return;

      if (canDrop && !canDrop(globalDragGroup, globalDragIndices, globalDragPayload)) {
        return;
      }

      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = globalDragGroup === group ? 'move' : 'copy';
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        globalDropPosition = y < rect.height / 2 ? 'top' : 'bottom';
        globalDragOverId = id;
      }
      ondragover?.(e);
    }}
    ondragleave={(e) => {
      if (e.currentTarget && (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
        return;
      }
      if (globalDragOverId === id) {
        globalDragOverId = null;
      }
      ondragleave?.(e);
    }}
    ondrop={(e) => {
      const sourceGroup =
        globalDragGroup ||
        (e.dataTransfer?.types.includes('application/x-drag-group')
          ? e.dataTransfer.getData('application/x-drag-group')
          : null);
      const isAcceptedGroup =
        sourceGroup === group ||
        (acceptGroups !== undefined && sourceGroup !== null && acceptGroups.includes(sourceGroup));
      if (!isAcceptedGroup || !sourceGroup) return;

      e.preventDefault();
      e.stopPropagation();
      const dropPos = globalDropPosition;
      let currentIndices = [...globalDragIndices];
      const currentPayload = { ...globalDragPayload };

      if (e.dataTransfer) {
        for (const type of e.dataTransfer.types) {
          if (!currentPayload[type]) {
            try {
              const val = e.dataTransfer.getData(type);
              if (val) currentPayload[type] = val;
            } catch {
              // Ignore dataTransfer access restrictions
            }
          }
        }
        if (currentIndices.length === 0) {
          const groupIndicesStr = e.dataTransfer.getData(`application/x-drag-group-${sourceGroup}`);
          if (groupIndicesStr) {
            try {
              const parsed = JSON.parse(groupIndicesStr);
              if (Array.isArray(parsed) && parsed.length > 0) {
                currentIndices = parsed;
              }
            } catch {
              // Ignore parse failure
            }
          }
        }
      }

      globalDragOverId = null;
      globalDragGroup = null;
      globalDragIndices = [];
      globalDragPayload = {};
      
      if (sourceGroup === group) {
        const draggedIndicesStr = e.dataTransfer?.getData(`application/x-drag-group-${group}`);
        let draggedIndices = currentIndices;
        if (draggedIndicesStr) {
          try {
            const parsed = JSON.parse(draggedIndicesStr);
            if (Array.isArray(parsed) && parsed.length > 0) {
              draggedIndices = parsed;
            }
          } catch {
            // Fallback to active in-memory indices
          }
        }
        if (draggedIndices.length > 0) {
          const originalTargetIndex = dropPos === 'bottom' ? index + 1 : index;
          
          // Adjust target index by subtracting the count of dragged items that
          // originally appeared before the target index, as they are removed from the same list
          const shift = draggedIndices.filter(i => i < originalTargetIndex).length;
          const targetIndex = originalTargetIndex - shift;
          
          // Optimisation: skip if dragging a single item back to its existing location
          if (draggedIndices.length === 1 && draggedIndices[0] === targetIndex) {
             return;
          }
          
          onReorder?.(draggedIndices, targetIndex);
        }
      } else {
        const originalTargetIndex = dropPos === 'bottom' ? index + 1 : index;
        onDropFromGroup?.(sourceGroup, currentIndices, originalTargetIndex, currentPayload);
      }
      ondrop?.(e);
    }}
    ondragend={(e) => {
      lastDragEndTime = Date.now();
      globalDragOverId = null;
      globalDragGroup = null;
      globalDragIndices = [];
      globalDragPayload = {};
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
