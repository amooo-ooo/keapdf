<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { QrCode, Barcode, Link2, Plus } from 'lucide-svelte';
  import {
    generateQrCodeSvg,
    generateBarcodeSvg,
    type BarcodeSymbology,
  } from '../../utils/barcode-generator';

  const store = useEditorStore();
  const actions = useEditorActions();
  const canvasActions = useCanvasActions();

  let symbology = $state<BarcodeSymbology>('qr-code');
  let payload = $state('https://keapdf.com');
  let fgColor = $state('#000000');
  let bgColor = $state('#ffffff');
  let includeText = $state(true);

  const previewSvg = $derived.by(() => {
    const text = payload.trim() || 'https://keapdf.com';
    if (symbology === 'code-128') {
      return generateBarcodeSvg(text, {
        fgColor,
        bgColor,
        includeText,
        width: 220,
        height: 70,
      });
    } else {
      return generateQrCodeSvg(text, {
        fgColor,
        bgColor,
        width: 140,
        height: 140,
      });
    }
  });

  function handleClose(): void {
    store.showQrBarcodeModal = false;
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      handleClose();
    }
  }

  function handleAddToDocument(): void {
    let text = payload.trim() || 'https://keapdf.com';
    if (symbology === 'qr-code' && !text.includes('://') && !text.startsWith('mailto:') && !text.startsWith('tel:')) {
      if (text.includes('.') && !text.includes(' ')) {
        text = `https://${text}`;
      }
    }
    const isCode128 = symbology === 'code-128';
    const width = isCode128 ? 180 : 120;
    const height = isCode128 ? 60 : 120;

    let centerX = 200;
    let centerY = 300;
    try {
      const dims = actions.service.document?.getPage(store.currentPageIndex)?.getDimensions();
      if (dims) {
        centerX = Math.max(0, (dims.widthPts - width) / 2);
        centerY = Math.max(0, (dims.heightPts - height) / 2);
      }
    } catch {
      // Fallback coordinates
    }

    const svgContent =
      symbology === 'code-128'
        ? generateBarcodeSvg(text, { fgColor, bgColor, includeText, width, height })
        : generateQrCodeSvg(text, { fgColor, bgColor, width, height });

    canvasActions.createElement('barcode', store.currentPageIndex, centerX, centerY, {
      payload: text,
      symbology,
      fgColor,
      bgColor,
      includeText,
      svgContent,
      width,
      height,
    });

    handleClose();
  }
</script>

{#if store.showQrBarcodeModal}
  <Dialog.Root open={true} onOpenChange={handleOpenChange}>
    <Dialog.Content class="sm:max-w-[460px]">
      <Dialog.Header>
        <Dialog.Title class="flex items-center gap-2 text-base font-semibold">
          <QrCode class="h-4 w-4 text-primary" />
          Add QR Code or Barcode
        </Dialog.Title>
        <Dialog.Description class="text-xs text-muted-foreground">
          Generate ISO/IEC 18004 2D matrix QR codes or Code 128 barcodes from URLs and text links.
        </Dialog.Description>
      </Dialog.Header>

      <div class="space-y-4 py-2">
        <!-- Symbology selector pills -->
        <div class="grid grid-cols-2 gap-2 p-1 bg-muted rounded-lg">
          <button
            type="button"
            class="flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-xs font-medium transition-all {symbology === 'qr-code' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => { symbology = 'qr-code'; }}
          >
            <QrCode class="h-3.5 w-3.5" />
            <span>QR Code (2D)</span>
          </button>
          <button
            type="button"
            class="flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-xs font-medium transition-all {symbology === 'code-128' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => { symbology = 'code-128'; }}
          >
            <Barcode class="h-3.5 w-3.5" />
            <span>Barcode (1D)</span>
          </button>
        </div>

        <!-- Payload / Link input -->
        <div class="space-y-1.5">
          <Label for="barcode-payload" class="text-xs flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <Link2 class="h-3.5 w-3.5 text-primary" />
              Link or Text Payload
            </span>
            <span class="text-[10px] text-muted-foreground font-sans">
              {payload.length} chars
            </span>
          </Label>
          <Input
            id="barcode-payload"
            bind:value={payload}
            placeholder={symbology === 'qr-code' ? 'https://example.com' : 'CODE-12345'}
            class="h-8 text-xs font-sans"
            autofocus
          />
        </div>

        <!-- Styling options -->
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <Label for="barcode-fg" class="text-xs">Foreground Colour</Label>
            <div class="flex items-center gap-2">
              <input
                id="barcode-fg"
                type="color"
                bind:value={fgColor}
                class="w-8 h-8 rounded border border-input cursor-pointer bg-transparent"
              />
              <Input
                bind:value={fgColor}
                class="h-8 text-xs font-sans uppercase"
              />
            </div>
          </div>
          <div class="space-y-1.5">
            <Label for="barcode-bg" class="text-xs">Background Colour</Label>
            <div class="flex items-center gap-2">
              <input
                id="barcode-bg"
                type="color"
                bind:value={bgColor}
                class="w-8 h-8 rounded border border-input cursor-pointer bg-transparent"
              />
              <Input
                bind:value={bgColor}
                class="h-8 text-xs font-sans uppercase"
              />
            </div>
          </div>
        </div>

        <!-- 1D barcode options -->
        {#if symbology === 'code-128'}
          <div class="flex items-center justify-between p-2 rounded-md bg-muted/50 border border-border">
            <Label for="include-text" class="text-xs cursor-pointer">Show Human-readable Text</Label>
            <input
              id="include-text"
              type="checkbox"
              bind:checked={includeText}
              class="rounded border-input text-primary cursor-pointer"
            />
          </div>
        {/if}

        <!-- Live Vector Preview Box -->
        <div class="flex flex-col items-center justify-center p-4 bg-muted/40 rounded-lg border border-border min-h-[160px]">
          <div class="p-2 bg-white rounded shadow-xs border border-border">
            {@html previewSvg}
          </div>
          <span class="text-[10px] text-muted-foreground mt-2">
            {symbology === 'qr-code' ? 'ISO/IEC 18004 Matrix' : 'ISO/IEC 15417 Code 128'}
          </span>
        </div>
      </div>

      <Dialog.Footer class="flex items-center justify-between sm:justify-between">
        <Badge variant="outline" class="text-[10px]">
          ISO/IEC Symbology
        </Badge>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" class="h-8 text-xs" onclick={handleClose}>
            Cancel
          </Button>
          <Button size="sm" class="h-8 text-xs" onclick={handleAddToDocument}>
            <Plus class="h-3.5 w-3.5 mr-1" />
            Add to Document
          </Button>
        </div>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
