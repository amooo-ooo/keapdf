<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { downloadBlob, downloadBytes } from '../../utils/download-utils';
  import { createZipArchive } from '../../services/conversion/zip-utils';
  import { AlertCircle, Loader2 } from 'lucide-svelte';

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
      if (hasTransforms) {
        const transformedBytes = await actions.service.document.saveAsync(store.pageTransforms);
        const transformedBuffer = transformedBytes.buffer.slice(
          transformedBytes.byteOffset,
          transformedBytes.byteOffset + transformedBytes.byteLength
        ) as ArrayBuffer;
        actions.service.loadDocumentFromBuffer(transformedBuffer);
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
      actions.service.loadDocumentFromBuffer(originalBuffer);
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
  <Dialog.Content class="sm:max-w-[425px]">
    <Dialog.Header>
      <Dialog.Title>Export pages as images</Dialog.Title>
      <Dialog.Description>
        Select export range, file format, and resolution scale. Multi-page exports are downloaded as a zip archive.
      </Dialog.Description>
    </Dialog.Header>

    {#if errorMessage}
      <div class="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <AlertCircle class="h-4 w-4 shrink-0" />
        <span>{errorMessage}</span>
      </div>
    {/if}

    <div class="grid gap-4 py-4">
      <div class="grid grid-cols-4 items-center gap-4">
        <Label for="export-target" class="text-right">Target</Label>
        <div class="col-span-3">
          <Select.Root type="single" value={exportTarget} onValueChange={(val) => { if (val === 'current' || val === 'all') exportTarget = val; }}>
            <Select.Trigger id="export-target" class="w-full">
              {exportTarget === 'current' ? `Current Page (${store.currentPageIndex + 1})` : `All Pages (${store.pageCount})`}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="current" label={`Current Page (Page ${store.currentPageIndex + 1})`}>
                Current Page (Page {store.currentPageIndex + 1})
              </Select.Item>
              <Select.Item value="all" label={`All Pages (${store.pageCount} pages)`}>
                All Pages ({store.pageCount} pages)
              </Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
      </div>

      <div class="grid grid-cols-4 items-center gap-4">
        <Label for="export-format" class="text-right">Format</Label>
        <div class="col-span-3">
          <Select.Root type="single" value={exportFormat} onValueChange={(val) => { if (val === 'png' || val === 'jpeg') exportFormat = val; }}>
            <Select.Trigger id="export-format" class="w-full">
              {exportFormat === 'png' ? 'PNG (Lossless)' : 'JPEG (Compressed)'}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="png" label="PNG (Lossless)">PNG (Lossless)</Select.Item>
              <Select.Item value="jpeg" label="JPEG (Compressed)">JPEG (Compressed)</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
      </div>

      <div class="grid grid-cols-4 items-center gap-4">
        <Label for="export-scale" class="text-right">Resolution</Label>
        <div class="col-span-3">
          <Select.Root type="single" value={exportScale.toString()} onValueChange={(val) => { exportScale = parseFloat(val); }}>
            <Select.Trigger id="export-scale" class="w-full">
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
      <Button variant="outline" disabled={isExporting} onclick={onClose}>
        Cancel
      </Button>
      <Button disabled={isExporting} onclick={handleExportImages}>
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
