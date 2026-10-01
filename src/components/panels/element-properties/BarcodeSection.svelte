<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import type { BarcodeElement } from '../../../stores/canvas-types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { QrCode, Barcode } from 'lucide-svelte';
  import type { BarcodeSymbology } from '../../../utils/barcode-generator';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  function updateProp<K extends keyof BarcodeElement>(propName: K, value: BarcodeElement[K]): void {
    const selected = canvasStore.selectedElementId;
    if (selected) {
      canvasActions.updateElementProperties(selected, { [propName]: value });
    }
  }

  function handleSymbologyChange(symbology: BarcodeSymbology): void {
    const selected = canvasStore.selectedElementId;
    if (selected && canvasStore.selectedElement?.kind === 'barcode') {
      const isCode128 = symbology === 'code-128';
      const width = isCode128 ? 180 : 120;
      const height = isCode128 ? 60 : 120;
      canvasActions.updateElementProperties(selected, {
        symbology,
        width,
        height,
      });
    }
  }
</script>

{#if canvasStore.selectedElement?.kind === 'barcode'}
  {@const bcEl = canvasStore.selectedElement as BarcodeElement}
  <SidebarSection title="QR & Barcode Properties" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-2.5">
      <!-- Symbology toggle pills -->
      <div class="grid grid-cols-2 gap-1 p-0.5 bg-muted rounded-md text-[11px]">
        <button
          type="button"
          class="flex items-center justify-center gap-1.5 py-1 px-2 rounded font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {bcEl.symbology === 'qr-code' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => handleSymbologyChange('qr-code')}
        >
          <QrCode class="h-3 w-3" aria-hidden="true" />
          <span>QR (2D)</span>
        </button>
        <button
          type="button"
          class="flex items-center justify-center gap-1.5 py-1 px-2 rounded font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {bcEl.symbology === 'code-128' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => handleSymbologyChange('code-128')}
        >
          <Barcode class="h-3 w-3" aria-hidden="true" />
          <span>Code 128 (1D)</span>
        </button>
      </div>

      <div class="field-group">
        <div class="field-header-row">
          <Label class="field-label">Payload / URL</Label>
          <span class="text-[10px] text-muted-foreground tabular-nums">{bcEl.payload.length} ch</span>
        </div>
        <Input
          type="text"
          value={bcEl.payload}
          oninput={(e) => updateProp('payload', (e.target as HTMLInputElement).value)}
          placeholder={bcEl.symbology === 'qr-code' ? 'https://example.com' : 'CODE-12345'}
          class="field-input text-[11px]"
        />
      </div>

      <div class="field-grid-2">
        <div class="field-group">
          <Label class="field-label">Foreground</Label>
          <div class="flex items-center gap-1.5">
            <input
              type="color"
              value={bcEl.fgColor || '#000000'}
              oninput={(e) => updateProp('fgColor', (e.target as HTMLInputElement).value)}
              class="w-7 h-7 rounded border border-input cursor-pointer bg-transparent"
            />
            <Input
              type="text"
              value={bcEl.fgColor || '#000000'}
              oninput={(e) => updateProp('fgColor', (e.target as HTMLInputElement).value)}
              class="h-7 text-[11px] uppercase"
            />
          </div>
        </div>

        <div class="field-group">
          <Label class="field-label">Background</Label>
          <div class="flex items-center gap-1.5">
            <input
              type="color"
              value={bcEl.bgColor || '#ffffff'}
              oninput={(e) => updateProp('bgColor', (e.target as HTMLInputElement).value)}
              class="w-7 h-7 rounded border border-input cursor-pointer bg-transparent"
            />
            <Input
              type="text"
              value={bcEl.bgColor || '#ffffff'}
              oninput={(e) => updateProp('bgColor', (e.target as HTMLInputElement).value)}
              class="h-7 text-[11px] uppercase"
            />
          </div>
        </div>
      </div>

      {#if bcEl.symbology === 'code-128'}
        <div class="field-header-row pt-1">
          <Label class="field-label">Show Text Label</Label>
          <Switch
            checked={bcEl.includeText !== false}
            onCheckedChange={(checked) => updateProp('includeText', checked)}
          />
        </div>
      {/if}

      <div class="p-2 rounded bg-muted/40 border border-border text-[10px] text-muted-foreground flex items-center justify-between">
        <span>{bcEl.symbology === 'qr-code' ? 'ISO/IEC 18004 QR Matrix' : 'ISO/IEC 15417 Code 128'}</span>
        {#if /^https?:\/\//i.test(bcEl.payload)}
          <span class="text-primary font-medium">Clickable PDF Link</span>
        {/if}
      </div>
    </div>
  </SidebarSection>
{/if}
