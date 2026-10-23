<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import type { ImageElement } from '../../../stores/canvas-types';
  import type { EditableImageSpan } from '../../../core/types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { ImageUp } from 'lucide-svelte';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();
  const editorStore = useEditorStore();
  const editorActions = useEditorActions();

  let fileInputRef: HTMLInputElement | null = $state(null);

  const activeImage = $derived.by(() => {
    if (canvasStore.selectedElement?.kind === 'image') {
      return canvasStore.selectedElement as ImageElement;
    }
    if (editorStore.selectedSpan?.type === 'image') {
      const span = editorStore.selectedSpan as EditableImageSpan;
      return {
        id: span.id,
        kind: 'image' as const,
        src: span.src,
        objectFit: 'fill' as const,
        opacity: 1,
      };
    }
    return null;
  });

  const isDisabled = $derived(
    editorStore.isReadOnly ||
    !editorStore.canEditElements ||
    Boolean(canvasStore.selectedElement?.locked)
  );

  async function updateProp(propName: string, value: string | number): Promise<void> {
    if (isDisabled) return;
    let selected = canvasStore.selectedElementId;
    if (editorStore.selectedSpan?.type === 'image' && (!selected || editorStore.selectedSpans.length > 0)) {
      selected = (editorStore.selectedSpans.length > 1 || Boolean(selected))
        ? ((await editorActions.extractSelectedSpansToCanvas(editorStore.selectedSpan, canvasStore)).primaryElementId ?? canvasStore.selectedElementId)
        : ((await editorActions.extractObjectToCanvas('image', editorStore.selectedSpan, canvasStore)) ?? null);
    }
    if (selected) {
      if (canvasStore.selectedElementIds.length > 1) {
        canvasActions.updateSelectedElementsProperties({ [propName]: value }, { kind: 'image' });
      } else {
        canvasActions.updateElementProperties(selected, { [propName]: value });
      }
    }
  }

  function handleReplaceClick(): void {
    if (isDisabled) return;
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
          void updateProp('src', dataUrl);
        }
      };
      reader.readAsDataURL(file);
    }
    target.value = '';
  }
</script>

{#if activeImage}
  {@const imgEl = activeImage}
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
          variant="panel"
          onclick={handleReplaceClick}
          disabled={isDisabled}
        >
          <ImageUp class="panel-icon-sm" />
          <span>Replace Image...</span>
        </Button>
      </div>

      <div class="field-group">
        <Label class="field-label">Object Fit</Label>
        <Select.Root type="single" value={imgEl.objectFit} onValueChange={(val) => { void updateProp('objectFit', val); }}>
          <Select.Trigger class="field-input w-full capitalize" disabled={isDisabled}>
            {imgEl.objectFit}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="contain" label="Contain">Contain</Select.Item>
            <Select.Item value="cover" label="Cover">Cover</Select.Item>
            <Select.Item value="fill" label="Fill">Fill</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>

      <div class="field-group mt-0.5">
        <Label class="field-label">Opacity</Label>
        <Slider
          type="single"
          value={Math.round(imgEl.opacity * 100)}
          min={0}
          max={100}
          step={1}
          unit="%"
          onValueChange={(val: number) => void updateProp('opacity', val / 100)}
          class="w-full"
        />
      </div>
    </div>
  </SidebarSection>
{/if}
