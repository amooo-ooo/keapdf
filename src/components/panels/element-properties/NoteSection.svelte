<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import type { NoteElement } from '../../../stores/canvas-types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  const noteColors = [
    { label: 'Yellow', color: '#fef08a' },
    { label: 'Green', color: '#bbf7d0' },
    { label: 'Blue', color: '#bae6fd' },
    { label: 'Pink', color: '#fbcfe8' },
    { label: 'Orange', color: '#fed7aa' },
    { label: 'Purple', color: '#e9d5ff' },
  ];

  function updateProp(propName: string, value: string | boolean): void {
    const selected = canvasStore.selectedElementId;
    if (selected && canvasStore.selectedElement?.kind === 'note') {
      if (canvasStore.selectedElementIds.length > 1) {
        canvasActions.updateSelectedElementsProperties({ [propName]: value }, { kind: 'note' });
      } else {
        canvasActions.updateElementProperties(selected, { [propName]: value });
      }
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
          aria-label="Author"
        />
      </div>

      <div class="field-group">
        <Label class="field-label">Note Color</Label>
        <ColorPicker
          value={noteEl.color}
          presets={noteColors}
          onValueChange={(c) => updateProp('color', c)}
        />
      </div>

      <div class="field-group">
        <Label class="field-label">Comment Content</Label>
        <Textarea
          value={noteEl.text}
          oninput={(e) => handleStringChange(e, 'text')}
          class="text-xs min-h-[72px] resize-y"
          placeholder="Type sticky note comment here..."
          rows={3}
          aria-label="Comment Text"
        />
      </div>
    </div>
  </SidebarSection>
{/if}
