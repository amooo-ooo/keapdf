<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import type { ThreeDElement } from '../../../stores/canvas-types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Upload } from 'lucide-svelte';
  import { formatByteSize } from '../../../services/pdf/operations/metadata-ops';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  let fileInputRef: HTMLInputElement | null = $state(null);

  function updateProp<K extends keyof ThreeDElement>(propName: K, value: ThreeDElement[K]): void {
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
      const objectUrl = URL.createObjectURL(file);
      const ext = file.name.split('.').pop()?.toLowerCase();
      let modelFormat: ThreeDElement['modelFormat'] = 'u3d';
      if (ext === 'prc') modelFormat = 'prc';
      else if (ext === 'obj') modelFormat = 'obj';
      else if (ext === 'gltf' || ext === 'glb') modelFormat = 'gltf';
      else if (ext === 'stl') modelFormat = 'stl';

      const selected = canvasStore.selectedElementId;
      if (selected) {
        canvasActions.updateElementProperties(selected, {
          src: objectUrl,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'model/u3d',
          modelFormat,
          title: file.name.replace(/\.[^/.]+$/, ''),
        });
      }
    }
    target.value = '';
  }
</script>

{#if canvasStore.selectedElement?.kind === '3d'}
  {@const threeDEl = canvasStore.selectedElement as ThreeDElement}
  <SidebarSection title="3D Model Properties" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <input
      bind:this={fileInputRef}
      type="file"
      accept=".u3d,.prc,.obj,.stl,.gltf,.glb,model/*"
      class="hidden"
      onchange={handleFileChange}
    />

    <div class="flex flex-col gap-2.5">
      <div class="field-group">
        <Button
          variant="panel"
          onclick={handleReplaceClick}
        >
          <Upload class="panel-icon-sm" />
          <span>Replace 3D Model...</span>
        </Button>
      </div>

      <div class="field-group">
        <Label class="field-label">Artwork Title</Label>
        <Input
          type="text"
          value={threeDEl.title}
          oninput={(e) => updateProp('title', (e.target as HTMLInputElement).value)}
          placeholder="3D Artwork"
          class="field-input"
          aria-label="Model File Name"
        />
      </div>

      <div class="field-group">
        <Label class="field-label">3D Format</Label>
        <Select.Root
          type="single"
          value={threeDEl.modelFormat || 'u3d'}
          onValueChange={(val) => updateProp('modelFormat', val as ThreeDElement['modelFormat'])}
        >
          <Select.Trigger class="field-input w-full uppercase">
            {threeDEl.modelFormat || 'u3d'}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="u3d" label="U3D (ISO 32000-1 Clause 13.6)">U3D</Select.Item>
            <Select.Item value="prc" label="PRC (ISO 14739-1 / 32000-2)">PRC</Select.Item>
            <Select.Item value="gltf" label="glTF / GLB">glTF</Select.Item>
            <Select.Item value="obj" label="Wavefront OBJ">OBJ</Select.Item>
            <Select.Item value="stl" label="Stereolithography STL">STL</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>

      <div class="field-group">
        <Label class="field-label">Initial View Name</Label>
        <Input
          type="text"
          value={threeDEl.viewName || 'Default View'}
          oninput={(e) => updateProp('viewName', (e.target as HTMLInputElement).value)}
          placeholder="Default View"
          class="field-input"
          aria-label="Initial View Name"
        />
      </div>

      {#if threeDEl.fileName || threeDEl.fileSize}
        <div class="p-2.5 rounded-md border border-border bg-card text-xs flex flex-col gap-1">
          <div class="flex items-center justify-between text-muted-foreground">
            <span class="truncate" title={threeDEl.fileName || 'Embedded 3D Model'}>{threeDEl.fileName || 'Embedded 3D Model'}</span>
            {#if threeDEl.fileSize}
              <span>{formatByteSize(threeDEl.fileSize)}</span>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </SidebarSection>
{/if}
