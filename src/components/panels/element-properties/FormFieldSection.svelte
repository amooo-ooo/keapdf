<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import type { FormFieldElement } from '../../../stores/canvas-types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  const canvasStore = useCanvasStore();

  function updateProp(propName: string, value: string): void {
    const selected = canvasStore.selectedElementId;
    if (selected) {
      canvasStore.updateElementProperties(selected, { [propName]: value });
    }
  }

  function handleStringChange(e: Event, propName: string): void {
    const target = e.target as HTMLInputElement;
    updateProp(propName, target.value);
  }
</script>

{#if canvasStore.selectedElement?.kind === 'form-field'}
  {@const formEl = canvasStore.selectedElement as FormFieldElement}
  <SidebarSection title="Form Field Properties" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-2">
      <div class="field-group">
        <Label class="field-label">Label</Label>
        <Input 
          type="text" 
          value={formEl.label} 
          oninput={(e) => handleStringChange(e, 'label')}
          class="field-input" 
        />
      </div>
      <div class="field-group">
        <Label class="field-label">Placeholder</Label>
        <Input 
          type="text" 
          value={formEl.placeholder} 
          oninput={(e) => handleStringChange(e, 'placeholder')}
          class="field-input" 
        />
      </div>
    </div>
  </SidebarSection>
{/if}
