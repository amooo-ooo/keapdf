<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import type { ImageElement } from '../../../stores/canvas-types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Select from '$lib/components/ui/select/index.js';

  const canvasStore = useCanvasStore();

  function updateProp(propName: string, value: string | number): void {
    const selected = canvasStore.selectedElementId;
    if (selected) {
      canvasStore.updateElementProperties(selected, { [propName]: value });
    }
  }
</script>

{#if canvasStore.selectedElement?.kind === 'image'}
  {@const imgEl = canvasStore.selectedElement as ImageElement}
  <SidebarSection title="Image Properties" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-2">
      <div class="field-group">
        <Label class="field-label">Object Fit</Label>
        <Select.Root type="single" value={imgEl.objectFit} onValueChange={(val) => { updateProp('objectFit', val); }}>
          <Select.Trigger class="field-input w-full capitalize">
            {imgEl.objectFit}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="contain" label="Contain">Contain</Select.Item>
            <Select.Item value="cover" label="Cover">Cover</Select.Item>
            <Select.Item value="fill" label="Fill">Fill</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>

      <div class="field-group mt-1">
        <div class="flex justify-between">
          <Label class="field-label">Opacity</Label>
          <span class="text-xs text-muted-foreground">{Math.round(imgEl.opacity * 100)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(imgEl.opacity * 100)}
          oninput={(e) => updateProp('opacity', parseInt((e.target as HTMLInputElement).value, 10) / 100)}
          class="w-full h-1.5 bg-muted rounded accent-primary"
        />
      </div>
    </div>
  </SidebarSection>
{/if}
