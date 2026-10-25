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

  let timeoutId: ReturnType<typeof setTimeout>;

  $effect(() => {
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
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
      <Dialog.Header class="pr-12">
        <Dialog.Title>
          <Wrench class="h-4 w-4" />
          {store.activeMockupTool}
        </Dialog.Title>
        <Dialog.Description>
          Configure Stirling PDF {store.activeMockupTool} processing options for this document.
        </Dialog.Description>
      </Dialog.Header>

      <div class="dialog-body">
        {#if store.activeMockupTool.includes('Watermark')}
          <div class="field-group">
            <Label for="wm-text" class="field-label">Watermark Text</Label>
            <Input id="wm-text" bind:value={sampleText} class="field-input" />
          </div>
          <div class="field-group">
            <Label class="field-label">Opacity</Label>
            <Slider
              type="single"
              min={10}
              max={100}
              step={1}
              unit="%"
              value={opacity}
              onValueChange={(val: number) => { opacity = val; }}
              class="w-full"
            />
          </div>
        {:else if store.activeMockupTool.includes('Compress')}
          <div class="field-group">
            <Label class="field-label">Target Quality (DPI)</Label>
            <Slider
              type="single"
              min={72}
              max={300}
              step={10}
              unit=" DPI"
              value={qualityDpi}
              onValueChange={(val: number) => { qualityDpi = val; }}
              class="w-full"
            />
          </div>
        {:else if store.activeMockupTool.includes('OCR')}
          <div class="field-group">
            <Label for="ocr-lang" class="field-label">Primary Language</Label>
            <Input id="ocr-lang" value="English (eng)" readonly class="field-input bg-muted/40" />
          </div>
          <p class="text-[11px] text-muted-foreground">Tesseract 5.0 OCR engine scan recognition preview.</p>
        {:else if store.activeMockupTool.includes('Video')}
          <div class="field-group">
            <Label for="video-src" class="field-label">Video Source (MP4, MOV, WebM or URL)</Label>
            <Input id="video-src" placeholder="https://example.com/video.mp4 or local media file..." class="field-input" />
          </div>
          <p class="text-[11px] text-muted-foreground">ISO 32000-1 Clause 13.2 and 13.7 RichMedia video rendition stream.</p>
        {:else if store.activeMockupTool.includes('Audio')}
          <div class="field-group">
            <Label for="audio-src" class="field-label">Audio Source (MP3, WAV, AAC or URL)</Label>
            <Input id="audio-src" placeholder="https://example.com/audio.mp3 or local sound file..." class="field-input" />
          </div>
          <p class="text-[11px] text-muted-foreground">ISO 32000-1 Clause 13.3 and 13.7 RichMedia sound clip object.</p>
        {:else if store.activeMockupTool.includes('3D')}
          <div class="field-group">
            <Label for="model-src" class="field-label">3D Artwork Model (U3D, PRC)</Label>
            <Input id="model-src" placeholder="Select .u3d or .prc model file..." class="field-input" />
          </div>
          <p class="text-[11px] text-muted-foreground">ISO 32000-1 Clause 13.6 interactive 3D stream and annotation view.</p>
        {:else if store.activeMockupTool.includes('Attach') || store.activeMockupTool.includes('Attachment')}
          <div class="field-group">
            <Label for="attach-file" class="field-label">File Attachment / Associated File</Label>
            <Input id="attach-file" placeholder="Select file to embed in document..." class="field-input" />
          </div>
          <p class="text-[11px] text-muted-foreground">ISO 32000-2 Clause 14.13 Associated Files (AF) and EmbeddedFiles stream.</p>
        {:else if store.activeMockupTool.includes('Barcode') || store.activeMockupTool.includes('QR Code')}
          <div class="field-group">
            <Label for="qr-data" class="field-label">Barcode / QR Code Payload</Label>
            <Input id="qr-data" placeholder="Text, URL, or data payload..." class="field-input" />
          </div>
          <p class="text-[11px] text-muted-foreground">ISO/IEC 18004 2D matrix symbology document interchange standard.</p>
        {:else if store.activeMockupTool.includes('Stamp')}
          <div class="field-group">
            <Label for="stamp-title" class="field-label">Stamp Text / Label</Label>
            <Input id="stamp-title" placeholder="APPROVED, CONFIDENTIAL, DRAFT..." class="field-input" />
          </div>
          <p class="text-[11px] text-muted-foreground">ISO 32000-1 Clause 12.5.6.12 rubber stamp annotation appearance.</p>
        {:else}
          <div class="field-group">
            <Label for="mock-setting" class="field-label">Configuration Options</Label>
            <Input id="mock-setting" placeholder="Default settings..." class="field-input" />
          </div>
          <p class="text-[11px] text-muted-foreground">Stirling PDF high-performance engine tool processor preview.</p>
        {/if}

        {#if isApplied}
          <div class="rounded-[var(--radius-card-inner)] bg-card border border-border p-2.5 flex items-center gap-2 text-xs text-foreground">
            <CheckCircle2 class="h-4 w-4 shrink-0" />
            {store.activeMockupTool} operation completed successfully!
          </div>
        {/if}
      </div>

      <Dialog.Footer class="justify-between">
        <Badge variant="outline" class="text-[10px]">Stirling PDF Parity</Badge>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" class="h-8 text-xs" onclick={handleClose}>
            Cancel
          </Button>
          <Button variant="secondary" size="sm" class="h-8 text-xs" onclick={handleAction} disabled={isApplied}>
            {isApplied ? 'Applied' : 'Run Tool'}
          </Button>
        </div>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
