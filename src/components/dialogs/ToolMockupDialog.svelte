<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { Wrench, CheckCircle2 } from 'lucide-svelte';

  const store = useEditorStore();

  let isApplied = $state(false);
  let sampleText = $state('CONFIDENTIAL');
  let opacity = $state(40);
  let qualityDpi = $state(150);

  import { onDestroy } from 'svelte';
  let timeoutId: ReturnType<typeof setTimeout>;

  onDestroy(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });

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
    timeoutId = setTimeout(() => {
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
            <Slider
              type="single"
              min={10}
              max={100}
              step={1}
              value={opacity}
              onValueChange={(val: number) => { opacity = val; }}
              class="w-full mt-1.5"
            />
          </div>
        {:else if store.activeMockupTool.includes('Compress')}
          <div class="grid gap-1.5">
            <div class="flex justify-between text-xs">
              <Label class="text-xs">Target Quality (DPI)</Label>
              <span class="text-muted-foreground">{qualityDpi} DPI</span>
            </div>
            <Slider
              type="single"
              min={72}
              max={300}
              step={10}
              value={qualityDpi}
              onValueChange={(val: number) => { qualityDpi = val; }}
              class="w-full mt-1.5"
            />
          </div>
        {:else if store.activeMockupTool.includes('OCR')}
          <div class="grid gap-1.5">
            <Label for="ocr-lang" class="text-xs">Primary Language</Label>
            <Input id="ocr-lang" value="English (eng)" readonly class="h-8 text-xs bg-muted/40" />
          </div>
          <p class="text-[11px] text-muted-foreground">Tesseract 5.0 OCR engine scan recognition preview.</p>
        {:else if store.activeMockupTool.includes('Video')}
          <div class="grid gap-1.5">
            <Label for="video-src" class="text-xs">Video Source (MP4, MOV, WebM or URL)</Label>
            <Input id="video-src" placeholder="https://example.com/video.mp4 or local media file..." class="h-8 text-xs" />
          </div>
          <p class="text-[11px] text-muted-foreground">ISO 32000-1 Clause 13.2 and 13.7 RichMedia video rendition stream.</p>
        {:else if store.activeMockupTool.includes('Audio')}
          <div class="grid gap-1.5">
            <Label for="audio-src" class="text-xs">Audio Source (MP3, WAV, AAC or URL)</Label>
            <Input id="audio-src" placeholder="https://example.com/audio.mp3 or local sound file..." class="h-8 text-xs" />
          </div>
          <p class="text-[11px] text-muted-foreground">ISO 32000-1 Clause 13.3 and 13.7 RichMedia sound clip object.</p>
        {:else if store.activeMockupTool.includes('3D')}
          <div class="grid gap-1.5">
            <Label for="model-src" class="text-xs">3D Artwork Model (U3D, PRC)</Label>
            <Input id="model-src" placeholder="Select .u3d or .prc model file..." class="h-8 text-xs" />
          </div>
          <p class="text-[11px] text-muted-foreground">ISO 32000-1 Clause 13.6 interactive 3D stream and annotation view.</p>
        {:else if store.activeMockupTool.includes('Attach') || store.activeMockupTool.includes('Attachment')}
          <div class="grid gap-1.5">
            <Label for="attach-file" class="text-xs">File Attachment / Associated File</Label>
            <Input id="attach-file" placeholder="Select file to embed in document..." class="h-8 text-xs" />
          </div>
          <p class="text-[11px] text-muted-foreground">ISO 32000-2 Clause 14.13 Associated Files (AF) and EmbeddedFiles stream.</p>
        {:else if store.activeMockupTool.includes('Barcode') || store.activeMockupTool.includes('QR Code')}
          <div class="grid gap-1.5">
            <Label for="qr-data" class="text-xs">Barcode / QR Code Payload</Label>
            <Input id="qr-data" placeholder="Text, URL, or data payload..." class="h-8 text-xs" />
          </div>
          <p class="text-[11px] text-muted-foreground">ISO/IEC 18004 2D matrix symbology document interchange standard.</p>
        {:else if store.activeMockupTool.includes('Stamp')}
          <div class="grid gap-1.5">
            <Label for="stamp-title" class="text-xs">Stamp Text / Label</Label>
            <Input id="stamp-title" placeholder="APPROVED, CONFIDENTIAL, DRAFT..." class="h-8 text-xs" />
          </div>
          <p class="text-[11px] text-muted-foreground">ISO 32000-1 Clause 12.5.6.12 rubber stamp annotation appearance.</p>
        {:else}
          <div class="grid gap-1.5">
            <Label for="mock-setting" class="text-xs">Configuration Options</Label>
            <Input id="mock-setting" placeholder="Default settings..." class="h-8 text-xs" />
          </div>
          <p class="text-[11px] text-muted-foreground">Stirling PDF high-performance engine tool processor preview.</p>
        {/if}

        {#if isApplied}
          <div class="rounded-md bg-success/10 border border-success/30 p-2.5 flex items-center gap-2 text-xs font-medium text-success">
            <CheckCircle2 class="h-4 w-4 shrink-0 text-success" />
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
