<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import type { ShapeElement } from '../../../stores/canvas-types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  const canvasStore = useCanvasStore();

  function updateProp(propName: string, value: string | number | boolean): void {
    const selected = canvasStore.selectedElementId;
    if (selected) {
      canvasStore.updateElementProperties(selected, { [propName]: value });
    }
  }

  function handleNumberChange(e: Event, propName: string): void {
    const target = e.target as HTMLInputElement;
    updateProp(propName, parseFloat(target.value));
  }

  function handleStringChange(e: Event, propName: string): void {
    const target = e.target as HTMLInputElement;
    updateProp(propName, target.value);
  }
</script>

{#if canvasStore.selectedElement?.kind === 'shape'}
  {@const shapeEl = canvasStore.selectedElement as ShapeElement}
  <SidebarSection title="Shape Properties" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-2">
      <div class="grid grid-cols-2 gap-2">
        <div class="field-group">
          <Label class="field-label">Fill</Label>
          <div class="flex items-center gap-1.5">
            <Input 
              type="color" 
              value={shapeEl.fill} 
              oninput={(e) => handleStringChange(e, 'fill')}
              class="h-8 w-10 p-0.5 cursor-pointer shrink-0" 
            />
          </div>
        </div>
        <div class="field-group">
          <Label class="field-label">Stroke</Label>
          <div class="flex items-center gap-1.5">
            <Input 
              type="color" 
              value={shapeEl.stroke} 
              oninput={(e) => handleStringChange(e, 'stroke')}
              class="h-8 w-10 p-0.5 cursor-pointer shrink-0" 
            />
          </div>
        </div>
      </div>

      <div class="field-group mt-1">
        <Label class="field-label">Stroke Width (pt)</Label>
        <Input 
          type="number" 
          value={shapeEl.strokeWidth} 
          oninput={(e) => handleNumberChange(e, 'strokeWidth')}
          class="field-input" 
          min="0"
        />
      </div>

      <div class="field-group mt-1">
        <div class="flex justify-between">
          <Label class="field-label">Opacity</Label>
          <span class="text-xs text-muted-foreground">{Math.round(shapeEl.opacity * 100)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(shapeEl.opacity * 100)}
          oninput={(e) => updateProp('opacity', parseInt((e.target as HTMLInputElement).value, 10) / 100)}
          class="w-full h-1.5 bg-muted rounded accent-primary"
        />
      </div>

      <div class="field-group mt-1 flex items-center justify-between pt-1">
        <Label class="field-label cursor-pointer text-xs" for="shape-highlight-toggle">Highlight Blend Mode</Label>
        <input
          id="shape-highlight-toggle"
          type="checkbox"
          checked={shapeEl.isHighlight || false}
          onchange={(e) => updateProp('isHighlight', (e.target as HTMLInputElement).checked)}
          class="rounded border-input text-primary focus:ring-primary h-4 w-4 cursor-pointer"
        />
      </div>
    </div>
  </SidebarSection>
{/if}
