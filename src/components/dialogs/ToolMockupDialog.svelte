<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Wrench, CheckCircle2 } from 'lucide-svelte';

  const store = useEditorStore();

  let isApplied = $state(false);
  let sampleText = $state('CONFIDENTIAL');
  let opacity = $state(40);
  let qualityDpi = $state(150);

  function handleClose(): void {
    store.activeMockupTool = null;
    isApplied = false;
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      handleClose();
    }
  }

  function handleAction(): void {
    isApplied = true;
    setTimeout(() => {
      handleClose();
    }, 1200);
  }
</script>

{#if store.activeMockupTool}
  <Dialog.Root open={true} onOpenChange={handleOpenChange}>
    <Dialog.Content class="sm:max-w-[440px]">
      <Dialog.Header>
        <Dialog.Title class="flex items-center gap-2 text-base font-semibold">
          <Wrench class="h-4 w-4 text-primary" />
          {store.activeMockupTool}
        </Dialog.Title>
        <Dialog.Description class="text-xs text-muted-foreground">
          Configure Stirling PDF {store.activeMockupTool} processing options for this document.
        </Dialog.Description>
      </Dialog.Header>

      <div class="grid gap-3 py-3">
        {#if store.activeMockupTool.includes('Watermark')}
          <div class="grid gap-1.5">
            <Label for="wm-text" class="text-xs">Watermark Text</Label>
            <Input id="wm-text" bind:value={sampleText} class="h-8 text-xs" />
          </div>
          <div class="grid gap-1.5">
            <div class="flex justify-between text-xs">
              <Label class="text-xs">Opacity</Label>
              <span class="text-muted-foreground">{opacity}%</span>
            </div>
            <input type="range" min="10" max="100" bind:value={opacity} class="w-full h-1.5 bg-muted rounded" />
          </div>
        {:else if store.activeMockupTool.includes('Compress')}
          <div class="grid gap-1.5">
            <div class="flex justify-between text-xs">
              <Label class="text-xs">Target Quality (DPI)</Label>
              <span class="text-muted-foreground">{qualityDpi} DPI</span>
            </div>
            <input type="range" min="72" max="300" step="10" bind:value={qualityDpi} class="w-full h-1.5 bg-muted rounded" />
          </div>
        {:else if store.activeMockupTool.includes('OCR')}
          <div class="grid gap-1.5">
            <Label for="ocr-lang" class="text-xs">Primary Language</Label>
            <Input id="ocr-lang" value="English (eng)" readonly class="h-8 text-xs bg-muted/40" />
          </div>
          <p class="text-[11px] text-muted-foreground">Tesseract 5.0 OCR engine scan recognition preview.</p>
        {:else}
          <div class="grid gap-1.5">
            <Label for="mock-setting" class="text-xs">Configuration Options</Label>
            <Input id="mock-setting" placeholder="Default settings..." class="h-8 text-xs" />
          </div>
          <p class="text-[11px] text-muted-foreground">Stirling PDF high-performance engine tool processor preview.</p>
        {/if}

        {#if isApplied}
          <div class="rounded-md bg-emerald-500/10 border border-emerald-500/30 p-2.5 flex items-center gap-2 text-xs font-medium text-emerald-400">
            <CheckCircle2 class="h-4 w-4 shrink-0 text-emerald-400" />
            {store.activeMockupTool} operation completed successfully!
          </div>
        {/if}
      </div>

      <Dialog.Footer class="flex items-center justify-between sm:justify-between">
        <Badge variant="outline" class="text-[10px]">Stirling PDF Parity</Badge>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" class="h-8 text-xs" onclick={handleClose}>
            Cancel
          </Button>
          <Button size="sm" class="h-8 text-xs" onclick={handleAction} disabled={isApplied}>
            {isApplied ? 'Applied' : 'Run Tool'}
          </Button>
        </div>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
