<script lang="ts">
  import type { NoteElement } from '../../stores/canvas-types';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import type { ElementRenderProps } from '../../core/element-registry';
  import { StickyNote, X } from 'lucide-svelte';

  let {
    element,
  }: ElementRenderProps<NoteElement> = $props();

  const canvasActions = useCanvasActions();

  let localText = $state('');
  let isEditing = $state(false);
  $effect.pre(() => {
    if (!isEditing) localText = element.text ?? '';
  });
</script>

<div
  class="w-full h-full rounded shadow-md border flex flex-col overflow-hidden text-xs select-none"
  style="background-color: {element.color || '#fef08a'}; border-color: rgba(0,0,0,0.15);"
>
  <div class="flex items-center justify-between px-2 py-1 bg-black/5 border-b border-black/10 cursor-move">
    <div class="flex items-center gap-1 font-semibold text-[11px] text-foreground/80 truncate">
      <StickyNote class="w-3.5 h-3.5 text-amber-600 shrink-0" />
      <span>{element.author || 'Note'}</span>
    </div>
    <button
      type="button"
      class="h-4 w-4 rounded hover:bg-black/10 flex items-center justify-center text-foreground/60 hover:text-foreground cursor-pointer"
      onclick={(e) => {
        e.stopPropagation();
        canvasActions.deleteElement(element.id);
      }}
      title="Delete Note"
      aria-label="Delete Note"
    >
      <X class="w-3 h-3" />
    </button>
  </div>
  <div class="flex-1 p-1.5 flex flex-col min-h-0">
    <textarea
      bind:value={localText}
      onfocus={() => { isEditing = true; }}
      onblur={() => {
        isEditing = false;
        canvasActions.updateElementProperties(element.id, { text: localText });
      }}
      onpointerdown={(e) => e.stopPropagation()}
      onclick={(e) => e.stopPropagation()}
      placeholder="Write a comment..."
      class="w-full h-full bg-transparent resize-none outline-none text-[11px] text-foreground placeholder:text-foreground/40 leading-relaxed"
    ></textarea>
  </div>
</div>
