<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import type { ImageElement } from '../../../stores/canvas-types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { ImageUp } from 'lucide-svelte';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  let fileInputRef: HTMLInputElement | null = $state(null);

  function updateProp(propName: string, value: string | number): void {
    const selected = canvasStore.selectedElementId;
    if (selected) {
      canvasActions.updateElementProperties(selected, { [propName]: value });
    }
  }

  function handleReplaceClick(): void {
    fileInputRef?.click();
  }

  function handleFileChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (): void => {
        const dataUrl = reader.result;
        if (typeof dataUrl === 'string') {
          updateProp('src', dataUrl);
        }
      };
      reader.readAsDataURL(file);
    }
    target.value = '';
  }
</script>

{#if canvasStore.selectedElement?.kind === 'image'}
  {@const imgEl = canvasStore.selectedElement as ImageElement}
  <SidebarSection title="Image Properties" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <input
      bind:this={fileInputRef}
      type="file"
      accept="image/*"
      class="hidden"
      onchange={handleFileChange}
    />

    <div class="flex flex-col gap-2">
      <div class="field-group">
        <Button
          variant="outline"
          size="sm"
          class="w-full justify-start text-xs h-8"
          onclick={handleReplaceClick}
        >
          <ImageUp class="h-3.5 w-3.5 mr-2 shrink-0" />
          <span>Replace Image...</span>
        </Button>
      </div>

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
        <Slider
          type="single"
          value={Math.round(imgEl.opacity * 100)}
          min={0}
          max={100}
          step={1}
          onValueChange={(val: number) => updateProp('opacity', val / 100)}
          class="w-full mt-1.5"
        />
      </div>
    </div>
  </SidebarSection>
{/if}
