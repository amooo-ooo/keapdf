<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { ControlRow } from '$lib/components/ui/control-row/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
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
    <Dialog.Content class="sm:max-w-[440px]">
      <Dialog.Header class="pr-12">
        <Dialog.Title>
          <QrCode class="h-4 w-4" />
          Add QR Code or Barcode
        </Dialog.Title>
        <Dialog.Description>
          Generate ISO/IEC 18004 2D matrix QR codes or Code 128 barcodes from URLs and text links.
        </Dialog.Description>
      </Dialog.Header>

      <div class="dialog-body">
        <!-- note: symbology selector -->
        <div class="field-group">
          <Label class="field-label">Symbology Type</Label>
          <ButtonGroup variant="outline" size="sm" class="w-full h-8">
            <Button
              type="button"
              variant={symbology === 'qr-code' ? 'secondary' : 'outline'}
              class="flex-1 text-xs gap-1.5"
              onclick={() => { symbology = 'qr-code'; }}
            >
              <QrCode class="h-3.5 w-3.5" />
              <span>QR Code (2D)</span>
            </Button>
            <Button
              type="button"
              variant={symbology === 'code-128' ? 'secondary' : 'outline'}
              class="flex-1 text-xs gap-1.5"
              onclick={() => { symbology = 'code-128'; }}
            >
              <Barcode class="h-3.5 w-3.5" />
              <span>Barcode (1D)</span>
            </Button>
          </ButtonGroup>
        </div>

        <!-- note: payload / link input -->
        <div class="field-group">
          <div class="flex items-center justify-between">
            <Label for="barcode-payload" class="field-label flex items-center gap-1.5">
              <Link2 class="h-3.5 w-3.5" />
              Link or Text Payload
            </Label>
            <span class="text-[10px] text-muted-foreground font-sans">
              {payload.length} chars
            </span>
          </div>
          <Input
            id="barcode-payload"
            bind:value={payload}
            placeholder={symbology === 'qr-code' ? 'https://example.com' : 'CODE-12345'}
            class="field-input"
            autofocus
          />
        </div>

        <!-- note: styling options -->
        <div class="field-grid-2">
          <div class="field-group">
            <Label for="barcode-fg" class="field-label">Foreground Colour</Label>
            <div class="flex items-center gap-2">
              <ColorPicker
                variant="circle"
                value={fgColor}
                onValueChange={(val) => (fgColor = val)}
              />
              <Input
                id="barcode-fg"
                bind:value={fgColor}
                class="field-input flex-1"
              />
            </div>
          </div>
          <div class="field-group">
            <Label for="barcode-bg" class="field-label">Background Colour</Label>
            <div class="flex items-center gap-2">
              <ColorPicker
                variant="circle"
                value={bgColor}
                onValueChange={(val) => (bgColor = val)}
              />
              <Input
                id="barcode-bg"
                bind:value={bgColor}
                class="field-input flex-1"
              />
            </div>
          </div>
        </div>

        <!-- note: 1D barcode options -->
        {#if symbology === 'code-128'}
          <ControlRow label="Show Human-readable Text" for="include-text" size="sm">
            <Switch
              id="include-text"
              bind:checked={includeText}
            />
          </ControlRow>
        {/if}

        <!-- note: live vector preview box -->
        <div class="dialog-card items-center justify-center min-h-[150px]">
          <div class="p-2 bg-white rounded-[var(--radius-card-inner)] border border-border">
            {@html previewSvg}
          </div>
          <span class="text-[10px] text-muted-foreground mt-1">
            {symbology === 'qr-code' ? 'ISO/IEC 18004 Matrix' : 'ISO/IEC 15417 Code 128'}
          </span>
        </div>
      </div>

      <Dialog.Footer class="justify-between">
        <Badge variant="outline" class="text-[10px]">
          ISO/IEC Symbology
        </Badge>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" class="h-8 text-xs" onclick={handleClose}>
            Cancel
          </Button>
          <Button variant="secondary" size="sm" class="h-8 text-xs" onclick={handleAddToDocument}>
            <Plus class="h-3.5 w-3.5 mr-1" />
            Add to Document
          </Button>
        </div>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
