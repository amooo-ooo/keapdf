<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import type { BarcodeElement } from '../../../stores/canvas-types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
  import { QrCode, Barcode } from 'lucide-svelte';
  import type { BarcodeSymbology } from '../../../utils/barcode-generator';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  function updateProp<K extends keyof BarcodeElement>(propName: K, value: BarcodeElement[K]): void {
    const selected = canvasStore.selectedElementId;
    if (selected) {
      if (canvasStore.selectedElementIds.length > 1) {
        canvasActions.updateSelectedElementsProperties({ [propName]: value }, { kind: 'barcode' });
      } else {
        canvasActions.updateElementProperties(selected, { [propName]: value });
      }
    }
  }

  function handleSymbologyChange(symbology: BarcodeSymbology): void {
    const selected = canvasStore.selectedElementId;
    if (selected && canvasStore.selectedElement?.kind === 'barcode') {
      const isCode128 = symbology === 'code-128';
      const width = isCode128 ? 180 : 120;
      const height = isCode128 ? 60 : 120;
      const updates = {
        symbology,
        width,
        height,
      };
      if (canvasStore.selectedElementIds.length > 1) {
        canvasActions.updateSelectedElementsProperties(updates, { kind: 'barcode' });
      } else {
        canvasActions.updateElementProperties(selected, updates);
      }
    }
  }
</script>

{#if canvasStore.selectedElement?.kind === 'barcode'}
  {@const bcEl = canvasStore.selectedElement as BarcodeElement}
  <SidebarSection title="QR & Barcode Properties" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-2.5">
      <!-- Symbology toggle group -->
      <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
        <Button
          variant={bcEl.symbology === 'qr-code' ? 'default' : 'outline'}
          size="sm"
          class="flex-1 text-xs gap-1.5"
          onclick={() => handleSymbologyChange('qr-code')}
          aria-pressed={bcEl.symbology === 'qr-code'}
        >
          <QrCode class="h-3.5 w-3.5" aria-hidden="true" />
          <span>QR (2D)</span>
        </Button>
        <Button
          variant={bcEl.symbology === 'code-128' ? 'default' : 'outline'}
          size="sm"
          class="flex-1 text-xs gap-1.5"
          onclick={() => handleSymbologyChange('code-128')}
          aria-pressed={bcEl.symbology === 'code-128'}
        >
          <Barcode class="h-3.5 w-3.5" aria-hidden="true" />
          <span>Code 128 (1D)</span>
        </Button>
      </ButtonGroup>

      <div class="field-group">
        <Label class="field-label">Payload / URL</Label>
        <Input
          type="text"
          value={bcEl.payload}
          oninput={(e) => updateProp('payload', (e.target as HTMLInputElement).value)}
          placeholder={bcEl.symbology === 'qr-code' ? 'https://example.com' : 'CODE-12345'}
          class="field-input text-[11px]"
          aria-label="Payload Data"
        />
      </div>

      <div class="field-grid-2">
        <div class="field-group">
          <Label class="field-label">Foreground</Label>
          <div class="flex items-center gap-1.5">
            <ColorPicker
              variant="circle"
              value={bcEl.fgColor || '#000000'}
              onValueChange={(val) => updateProp('fgColor', val)}
            />
            <Input
              type="text"
              value={bcEl.fgColor || '#000000'}
              oninput={(e) => updateProp('fgColor', (e.target as HTMLInputElement).value)}
              class="field-input text-[11px] uppercase"
              aria-label="Foreground Colour Hex"
            />
          </div>
        </div>

        <div class="field-group">
          <Label class="field-label">Background</Label>
          <div class="flex items-center gap-1.5">
            <ColorPicker
              variant="circle"
              value={bcEl.bgColor || '#ffffff'}
              onValueChange={(val) => updateProp('bgColor', val)}
            />
            <Input
              type="text"
              value={bcEl.bgColor || '#ffffff'}
              oninput={(e) => updateProp('bgColor', (e.target as HTMLInputElement).value)}
              class="field-input text-[11px] uppercase"
              aria-label="Background Colour Hex"
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
            aria-label="Show Text Label"
          />
        </div>
      {/if}
    </div>
  </SidebarSection>
{/if}
