<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import type { AttachmentElement } from '../../../stores/canvas-types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Upload } from 'lucide-svelte';
  import { formatByteSize } from '../../../services/pdf/operations/metadata-ops';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  let fileInputRef: HTMLInputElement | null = $state(null);

  function updateProp<K extends keyof AttachmentElement>(propName: K, value: AttachmentElement[K]): void {
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
      const selected = canvasStore.selectedElementId;
      if (selected) {
        canvasActions.updateElementProperties(selected, {
          src: objectUrl,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'application/octet-stream',
          description: file.name,
        });
      }
    }
    target.value = '';
  }
</script>

{#if canvasStore.selectedElement?.kind === 'attachment'}
  {@const attEl = canvasStore.selectedElement as AttachmentElement}
  <SidebarSection title="Attachment Properties" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <input
      bind:this={fileInputRef}
      type="file"
      accept="*/*"
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
          <span>Replace Attached File...</span>
        </Button>
      </div>

      <div class="field-group">
        <Label class="field-label">File Name</Label>
        <Input
          type="text"
          value={attEl.fileName}
          oninput={(e) => updateProp('fileName', (e.target as HTMLInputElement).value)}
          placeholder="attachment.pdf"
          class="field-input"
        />
      </div>

      <div class="field-group">
        <Label class="field-label">Description / Note</Label>
        <Input
          type="text"
          value={attEl.description || ''}
          oninput={(e) => updateProp('description', (e.target as HTMLInputElement).value)}
          placeholder="Associated document"
          class="field-input"
        />
      </div>

      {#if attEl.fileName || attEl.fileSize}
        <div class="p-2 rounded bg-muted/40 border border-border text-[11px] flex flex-col gap-1">
          <div class="flex items-center justify-between text-muted-foreground">
            <span class="truncate">{attEl.fileName || 'Embedded File'}</span>
            {#if attEl.fileSize}
              <span class="text-[10px]">{formatByteSize(attEl.fileSize)}</span>
            {/if}
          </div>
          <span class="text-[9px] text-muted-foreground/80">ISO 32000-2 Clause 14.13 Associated Files (AF)</span>
        </div>
      {/if}
    </div>
  </SidebarSection>
{/if}
