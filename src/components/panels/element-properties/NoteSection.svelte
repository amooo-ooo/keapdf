<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import type { NoteElement } from '../../../stores/canvas-types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Trash2 } from 'lucide-svelte';

  const canvasStore = useCanvasStore();

  const noteColors = [
    { name: 'Yellow', value: '#fef08a' },
    { name: 'Green', value: '#bbf7d0' },
    { name: 'Blue', value: '#bae6fd' },
    { name: 'Pink', value: '#fbcfe8' },
    { name: 'Orange', value: '#fed7aa' },
    { name: 'Purple', value: '#e9d5ff' },
  ];

  function updateProp(propName: string, value: string | boolean): void {
    const selected = canvasStore.selectedElementId;
    if (selected && canvasStore.selectedElement?.kind === 'note') {
      canvasStore.updateElement(selected, { [propName]: value });
    }
  }

  function handleStringChange(e: Event, propName: string): void {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    updateProp(propName, target.value);
  }
</script>

{#if canvasStore.selectedElement?.kind === 'note'}
  {@const noteEl = canvasStore.selectedElement as NoteElement}
  <SidebarSection title="Sticky Note" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-2.5">
      <div class="field-group">
        <Label class="field-label">Author / Title</Label>
        <Input
          type="text"
          value={noteEl.author}
          oninput={(e) => handleStringChange(e, 'author')}
          class="field-input text-xs"
          placeholder="Author name..."
        />
      </div>

      <div class="field-group">
        <Label class="field-label">Note Color</Label>
        <div class="flex items-center gap-1.5 pt-0.5">
          {#each noteColors as col}
            <button
              type="button"
              class="w-5 h-5 rounded-full border border-black/20 focus:ring-1 focus:ring-primary {noteEl.color === col.value ? 'ring-2 ring-primary scale-110' : 'hover:scale-105'} transition-transform"
              style="background-color: {col.value};"
              onclick={() => updateProp('color', col.value)}
              title={col.name}
            ></button>
          {/each}
          <Input
            type="color"
            value={noteEl.color}
            oninput={(e) => handleStringChange(e, 'color')}
            class="w-6 h-6 p-0 border border-border rounded cursor-pointer shrink-0 ml-1"
            title="Custom color"
          />
        </div>
      </div>

      <div class="field-group">
        <Label class="field-label">Comment Content</Label>
        <textarea
          value={noteEl.text}
          oninput={(e) => handleStringChange(e, 'text')}
          class="flex min-h-[72px] w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-xs shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
          placeholder="Type sticky note comment here..."
          rows="3"
        ></textarea>
      </div>

      <div class="pt-1 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          class="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
          onclick={() => canvasStore.removeElement(noteEl.id)}
        >
          <Trash2 class="h-3.5 w-3.5 mr-1" /> Delete Note
        </Button>
      </div>
    </div>
  </SidebarSection>
{/if}
