<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  const canvasStore = useCanvasStore();

  function updateProp(propName: string, value: number): void {
    const selected = canvasStore.selectedElementId;
    if (selected) {
      canvasStore.updateElementProperties(selected, { [propName]: value });
    }
  }

  function handleNumberChange(e: Event, propName: string): void {
    const target = e.target as HTMLInputElement;
    updateProp(propName, parseFloat(target.value));
  }
</script>

{#if canvasStore.selectedElement}
  {@const element = canvasStore.selectedElement}
  <SidebarSection title="Position & Size" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="grid grid-cols-2 gap-2">
      <div class="field-group">
        <Label class="field-label">X (pt)</Label>
        <Input 
          type="number" 
          value={element.x} 
          oninput={(e) => handleNumberChange(e, 'x')}
          class="field-input" 
        />
      </div>
      <div class="field-group">
        <Label class="field-label">Y (pt)</Label>
        <Input 
          type="number" 
          value={element.y} 
          oninput={(e) => handleNumberChange(e, 'y')}
          class="field-input" 
        />
      </div>
      <div class="field-group">
        <Label class="field-label">Width (pt)</Label>
        <Input 
          type="number" 
          value={element.width} 
          oninput={(e) => handleNumberChange(e, 'width')}
          class="field-input" 
          min="1"
        />
      </div>
      <div class="field-group">
        <Label class="field-label">Height (pt)</Label>
        <Input 
          type="number" 
          value={element.height} 
          oninput={(e) => handleNumberChange(e, 'height')}
          class="field-input" 
          min="1"
        />
      </div>
      <div class="field-group col-span-2">
        <Label class="field-label">Rotation (°)</Label>
        <Input 
          type="number" 
          value={element.rotation} 
          oninput={(e) => handleNumberChange(e, 'rotation')}
          class="field-input" 
          min="0"
          max="360"
        />
      </div>
    </div>
  </SidebarSection>
{/if}
