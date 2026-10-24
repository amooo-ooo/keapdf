<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { downloadBlob, downloadBytes } from '../../utils/download-utils';
  import { createZipArchive } from '../../services/conversion/zip-utils';
  import { AlertCircle, Image, Loader2 } from 'lucide-svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();
  
  const store = useEditorStore();
  const actions = useEditorActions();

  let exportFormat = $state<'png' | 'jpeg'>('png');
  let exportTarget = $state<'current' | 'all'>('current');
  let exportScale = $state(2.0);
  let isExporting = $state(false);
  let errorMessage = $state<string | null>(null);

  async function handleExportImages(): Promise<void> {
    isExporting = true;
    errorMessage = null;

    const savedFormValues = new Map(actions.service.document.getModifiedFormFieldValues());
    const originalBytes = actions.service.document.save();
    const originalBuffer = originalBytes.buffer.slice(
      originalBytes.byteOffset,
      originalBytes.byteOffset + originalBytes.byteLength
    ) as ArrayBuffer;

    try {
      if (actions.canvasStore && actions.canvasStore.elements.length > 0) {
        await actions.service.burnElementsToDocument(actions.canvasStore.elements);
      }

      const hasTransforms = Object.values(store.pageTransforms).some(
        t => t && (t.rotation !== 0 || t.scaleX !== 1 || t.scaleY !== 1)
      );
      if (hasTransforms || savedFormValues.size > 0) {
        const transformedBytes = await actions.service.document.saveAsync(store.pageTransforms);
        const transformedBuffer = transformedBytes.buffer.slice(
          transformedBytes.byteOffset,
          transformedBytes.byteOffset + transformedBytes.byteLength
        ) as ArrayBuffer;
        actions.service.reloadDocumentFromBuffer(transformedBuffer);
      }

      const baseName = store.fileName.replace(/\.[^/.]+$/, '');
      const indicesToExport =
        exportTarget === 'current'
          ? [store.currentPageIndex]
          : Array.from({ length: store.pageCount }, (_, i) => i);

      if (indicesToExport.length > 1) {
        const zipFiles: Record<string, Uint8Array> = {};
        for (const idx of indicesToExport) {
          const blob = await actions.service.document.getPage(idx).exportAsBlob(exportFormat, exportScale);
          const buffer = await blob.arrayBuffer();
          zipFiles[`${baseName}_page_${idx + 1}.${exportFormat}`] = new Uint8Array(buffer);
        }
        const zipBytes = await createZipArchive(zipFiles);
        downloadBytes(zipBytes, `${baseName}_images.zip`, 'application/zip');
      } else if (indicesToExport.length === 1) {
        const idx = indicesToExport[0];
        const blob = await actions.service.document.getPage(idx).exportAsBlob(exportFormat, exportScale);
        downloadBlob(blob, `${baseName}_page_${idx + 1}.${exportFormat}`);
      }

      onClose();
    } catch (err) {
      console.error('Failed to export images:', err);
      errorMessage = err instanceof Error ? err.message : 'Failed to export images.';
    } finally {
      actions.service.reloadDocumentFromBuffer(originalBuffer);
      if (savedFormValues.size > 0) {
        actions.service.document.setAllFormFieldValues(savedFormValues);
      }
      actions.refreshDocument();
      isExporting = false;
    }
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      onClose();
    }
  }
</script>

<Dialog.Root open={true} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[440px]">
    <Dialog.Header class="pr-12">
      <Dialog.Title>
        <Image class="h-4 w-4" />
        Export pages as images
      </Dialog.Title>
      <Dialog.Description>
        Select export range, file format, and resolution scale. Multi-page exports are downloaded as a zip archive.
      </Dialog.Description>
    </Dialog.Header>

    <div class="dialog-body">
      {#if errorMessage}
        <div role="alert" class="dialog-error">
          <AlertCircle class="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      {/if}

      <div class="field-group">
        <Label class="field-label">Target Scope</Label>
        <ButtonGroup variant="outline" size="sm" class="w-full h-8">
          <Button
            type="button"
            variant={exportTarget === 'current' ? 'secondary' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => (exportTarget = 'current')}
          >
            Current Page ({store.currentPageIndex + 1})
          </Button>
          <Button
            type="button"
            variant={exportTarget === 'all' ? 'secondary' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => (exportTarget = 'all')}
          >
            All Pages ({store.pageCount})
          </Button>
        </ButtonGroup>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div class="field-group">
          <Label class="field-label">Image Format</Label>
          <ButtonGroup variant="outline" size="sm" class="w-full h-8">
            <Button
              type="button"
              variant={exportFormat === 'png' ? 'secondary' : 'outline'}
              class="flex-1 text-xs"
              onclick={() => (exportFormat = 'png')}
            >
              PNG
            </Button>
            <Button
              type="button"
              variant={exportFormat === 'jpeg' ? 'secondary' : 'outline'}
              class="flex-1 text-xs"
              onclick={() => (exportFormat = 'jpeg')}
            >
              JPEG
            </Button>
          </ButtonGroup>
        </div>

        <div class="field-group">
          <Label for="export-scale" class="field-label">Resolution Scale</Label>
          <Select.Root type="single" value={exportScale.toString()} onValueChange={(val) => { if (val) exportScale = parseFloat(val); }}>
            <Select.Trigger id="export-scale" class="w-full h-8 text-xs">
              {exportScale === 1.0 ? '1.0x Standard' : exportScale === 1.5 ? '1.5x Medium' : exportScale === 2.0 ? '2.0x High DPI' : '3.0x Ultra HD'}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="1" label="1.0x Standard">1.0x Standard</Select.Item>
              <Select.Item value="1.5" label="1.5x Medium">1.5x Medium</Select.Item>
              <Select.Item value="2" label="2.0x High DPI">2.0x High DPI</Select.Item>
              <Select.Item value="3" label="3.0x Ultra HD">3.0x Ultra HD</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" size="sm" class="h-8 text-xs" disabled={isExporting} onclick={onClose}>
        Cancel
      </Button>
      <Button variant="secondary" size="sm" class="h-8 text-xs" disabled={isExporting} onclick={handleExportImages}>
        {#if isExporting}
          <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" />
          Exporting...
        {:else}
          Export Images
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
