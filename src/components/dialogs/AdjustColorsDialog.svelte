<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useSelection } from '../../stores/selection.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { ControlRow } from '$lib/components/ui/control-row/index.js';
  import {
    SlidersHorizontal,
    RotateCcw,
    Check,
    Download,
    Copy,
    Loader2,
    Eye,
  } from 'lucide-svelte';
  import {
    getPresetColorAdjustments,
    generateCssFilterString,
    type ColorAdjustmentOptions,
    type ColorAdjustmentPreset,
    type ColorAdjustmentScope,
  } from '../../services/pdf/operations/color-adjustment-ops';
  import { parsePageRangeStrict } from '../../utils/page-range';

  const store = useEditorStore();
  const actions = useEditorActions();
  const selection = useSelection();

  let activePreset = $state<ColorAdjustmentPreset>('default');
  let brightness = $state(0);
  let contrast = $state(0);
  let saturation = $state(0);
  let sepia = $state(0);
  let hueRotate = $state(0);
  let invert = $state(false);
  let grayscale = $state(false);
  let enableBinarize = $state(false);
  let binarizeThreshold = $state(128);

  let scope = $state<ColorAdjustmentScope>('current');
  let customRange = $state('');
  let isProcessing = $state(false);
  let errorMessage = $state<string | null>(null);
  let successMessage = $state<string | null>(null);

  let previewCanvasEl: HTMLCanvasElement | null = $state(null);
  let isRenderingPreview = $state(false);

  const selectedPageIndices = $derived.by(() => {
    return Array.from(selection.selectedIds)
      .filter((id: string) => id.startsWith('page_'))
      .map((id: string) => parseInt(id.replace('page_', ''), 10));
  });

  const currentOptions = $derived.by<ColorAdjustmentOptions>(() => {
    return {
      brightness,
      contrast,
      invert,
      grayscale,
      sepia,
      hueRotate,
      saturation,
      binarizeThreshold: enableBinarize ? binarizeThreshold : 0,
      scope,
      currentPageIndex: store.currentPageIndex,
      pageIndices:
        scope === 'current'
          ? [store.currentPageIndex]
          : scope === 'selected'
            ? selectedPageIndices
            : undefined,
      customRange: scope === 'custom' ? customRange : undefined,
      dpi: 150,
    };
  });

  const previewCssFilter = $derived.by(() => {
    return generateCssFilterString(currentOptions);
  });

  function applyPreset(preset: ColorAdjustmentPreset): void {
    activePreset = preset;
    const settings = getPresetColorAdjustments(preset);
    if (settings.brightness !== undefined) brightness = settings.brightness;
    if (settings.contrast !== undefined) contrast = settings.contrast;
    if (settings.invert !== undefined) invert = settings.invert;
    if (settings.grayscale !== undefined) grayscale = settings.grayscale;
    if (settings.sepia !== undefined) sepia = settings.sepia;
    if (settings.hueRotate !== undefined) hueRotate = settings.hueRotate;
    if (settings.saturation !== undefined) saturation = settings.saturation;
    if (settings.binarizeThreshold !== undefined) {
      enableBinarize = settings.binarizeThreshold > 0;
      binarizeThreshold = settings.binarizeThreshold || 128;
    }
  }

  function handleReset(): void {
    applyPreset('default');
    errorMessage = null;
    successMessage = null;
  }

  function handleClose(): void {
    actions.closeAdjustColorsDialog();
    errorMessage = null;
    successMessage = null;
    isProcessing = false;
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      handleClose();
    }
  }

  function renderPreviewPage(): void {
    if (!previewCanvasEl || !store.isDocumentLoaded) return;
    try {
      isRenderingPreview = true;
      const pageIdx = store.currentPageIndex;
      const page = actions.service.document?.getPage(pageIdx);
      if (!page) return;

      const rendered = page.render(0.5, {
        targetCanvas: previewCanvasEl,
        applyDpr: false,
      });
      void rendered;
    } catch (err) {
      console.warn('Failed to render colour adjustment preview:', err);
    } finally {
      isRenderingPreview = false;
    }
  }

  $effect(() => {
    if (store.showAdjustColorsDialog && store.isDocumentLoaded) {
      untrack(() => {
        errorMessage = null;
        successMessage = null;
        if (selectedPageIndices.length > 1) {
          scope = 'selected';
        } else {
          scope = 'current';
        }
        setTimeout(() => {
          renderPreviewPage();
        }, 50);
      });
    }
  });

  function validateTargetScope(): boolean {
    if (scope === 'custom') {
      if (!customRange || customRange.trim().length === 0) {
        errorMessage = 'Please specify at least one valid page number or range.';
        return false;
      }
      try {
        const indices = parsePageRangeStrict(customRange, store.pageCount);
        if (indices.length === 0) {
          errorMessage = 'Please specify at least one valid page number or range.';
          return false;
        }
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : 'Invalid page range specification.';
        return false;
      }
    }
    return true;
  }

  async function handleApplyInPlace(): Promise<void> {
    if (!validateTargetScope()) return;
    isProcessing = true;
    errorMessage = null;
    successMessage = null;

    try {
      const res = await actions.adjustDocumentColors(currentOptions);
      successMessage = `Successfully adjusted colours across ${res.affectedPages.length} page(s).`;
      setTimeout(() => {
        handleClose();
      }, 1100);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to apply colour adjustments.';
    } finally {
      isProcessing = false;
    }
  }

  async function handleDownload(): Promise<void> {
    if (!validateTargetScope()) return;
    isProcessing = true;
    errorMessage = null;
    successMessage = null;

    try {
      await actions.adjustColorsAndDownload(currentOptions);
      successMessage = 'Document exported and download initiated successfully.';
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to export document.';
    } finally {
      isProcessing = false;
    }
  }

  async function handleSaveCopy(): Promise<void> {
    if (!validateTargetScope()) return;
    isProcessing = true;
    errorMessage = null;
    successMessage = null;

    try {
      await actions.adjustColorsAsNewWorkspaceFile(currentOptions);
      successMessage = 'Saved as new document copy in workspace.';
      setTimeout(() => {
        handleClose();
      }, 900);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to save copy in workspace.';
    } finally {
      isProcessing = false;
    }
  }
</script>

<Dialog.Root open={store.showAdjustColorsDialog} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[580px]">
    <Dialog.Header class="pr-12">
      <Dialog.Title>
        <SlidersHorizontal class="h-4 w-4" />
        Adjust Colours &amp; Contrast
      </Dialog.Title>
      <Dialog.Description>
        Fine-tune brightness, contrast, colour inversion, and tonal filters across document pages.
      </Dialog.Description>
    </Dialog.Header>

    <div class="dialog-body">
      <!-- note: live preview container -->
      <div class="dialog-card items-center">
        <div class="flex items-center justify-between w-full text-[11px] text-muted-foreground">
          <div class="flex items-center gap-1.5 font-medium text-foreground">
            <Eye class="h-3.5 w-3.5 text-muted-foreground" />
            <span>Page {store.currentPageIndex + 1} Preview</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            class="h-6 text-[11px] gap-1 px-2 text-muted-foreground hover:text-foreground"
            onclick={handleReset}
            disabled={isProcessing}
          >
            <RotateCcw class="h-3 w-3" />
            Reset
          </Button>
        </div>

        <div class="relative w-full flex items-center justify-center min-h-[160px] max-h-[200px] overflow-hidden rounded-[var(--radius-card-inner)] bg-secondary/50 p-2 border border-border/60">
          {#if isRenderingPreview}
            <div class="absolute inset-0 flex items-center justify-center bg-card/60 backdrop-blur-xs z-10">
              <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          {/if}
          <canvas
            bind:this={previewCanvasEl}
            class="max-h-[180px] max-w-full object-contain border border-border/60 transition-[filter] duration-75"
            style="filter: {previewCssFilter};"
          ></canvas>
        </div>
      </div>

      <!-- note: quick preset selection -->
      <div class="field-group">
        <Label class="field-label">Quick Presets</Label>
        <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
          <Button
            type="button"
            variant={activePreset === 'default' ? 'secondary' : 'outline'}
            class="flex-1 text-xs px-2"
            onclick={() => applyPreset('default')}
            disabled={isProcessing}
          >
            Default
          </Button>
          <Button
            type="button"
            variant={activePreset === 'high_contrast' ? 'secondary' : 'outline'}
            class="flex-1 text-xs px-2"
            onclick={() => applyPreset('high_contrast')}
            disabled={isProcessing}
          >
            High Contrast
          </Button>
          <Button
            type="button"
            variant={activePreset === 'invert' ? 'secondary' : 'outline'}
            class="flex-1 text-xs px-2"
            onclick={() => applyPreset('invert')}
            disabled={isProcessing}
          >
            Invert / Dark
          </Button>
          <Button
            type="button"
            variant={activePreset === 'grayscale' ? 'secondary' : 'outline'}
            class="flex-1 text-xs px-2"
            onclick={() => applyPreset('grayscale')}
            disabled={isProcessing}
          >
            Greyscale
          </Button>
          <Button
            type="button"
            variant={activePreset === 'sepia' ? 'secondary' : 'outline'}
            class="flex-1 text-xs px-2"
            onclick={() => applyPreset('sepia')}
            disabled={isProcessing}
          >
            Warm Sepia
          </Button>
          <Button
            type="button"
            variant={activePreset === 'binarize' ? 'secondary' : 'outline'}
            class="flex-1 text-xs px-2"
            onclick={() => applyPreset('binarize')}
            disabled={isProcessing}
          >
            Scanned Text
          </Button>
        </ButtonGroup>
      </div>

      <!-- note: brightness and contrast sliders -->
      <div class="field-grid-2">
        <div class="field-group">
          <Label for="brightness-slider" class="field-label">Brightness</Label>
          <Slider
            id="brightness-slider"
            type="single"
            min={-100}
            max={100}
            step={1}
            unit="%"
            formatValue={(val) => `${val > 0 ? `+${val}` : val}%`}
            value={brightness}
            onValueChange={(val: number) => {
              brightness = val;
              activePreset = 'default';
            }}
            disabled={isProcessing}
            class="w-full"
          />
        </div>

        <div class="field-group">
          <Label for="contrast-slider" class="field-label">Contrast</Label>
          <Slider
            id="contrast-slider"
            type="single"
            min={-100}
            max={100}
            step={1}
            unit="%"
            formatValue={(val) => `${val > 0 ? `+${val}` : val}%`}
            value={contrast}
            onValueChange={(val: number) => {
              contrast = val;
              activePreset = 'default';
            }}
            disabled={isProcessing}
            class="w-full"
          />
        </div>
      </div>

      <!-- note: tonal sliders for saturation and sepia -->
      <div class="field-grid-2">
        <div class="field-group">
          <Label for="saturation-slider" class="field-label">Saturation</Label>
          <Slider
            id="saturation-slider"
            type="single"
            min={-100}
            max={100}
            step={1}
            unit="%"
            formatValue={(val) => `${val > 0 ? `+${val}` : val}%`}
            value={saturation}
            onValueChange={(val: number) => {
              saturation = val;
              activePreset = 'default';
            }}
            disabled={isProcessing || grayscale || enableBinarize}
            class="w-full"
          />
        </div>

        <div class="field-group">
          <Label for="sepia-slider" class="field-label">Sepia Tone</Label>
          <Slider
            id="sepia-slider"
            type="single"
            min={0}
            max={100}
            step={1}
            unit="%"
            value={sepia}
            onValueChange={(val: number) => {
              sepia = val;
              activePreset = 'default';
            }}
            disabled={isProcessing || grayscale || enableBinarize}
            class="w-full"
          />
        </div>
      </div>

      <!-- note: feature toggles -->
      <div class="field-grid-2">
        <ControlRow label="Invert Colours" for="toggle-invert" size="sm">
          <Switch
            id="toggle-invert"
            bind:checked={invert}
            disabled={isProcessing}
            onCheckedChange={() => { activePreset = 'default'; }}
          />
        </ControlRow>

        <ControlRow label="Monochrome Greyscale" for="toggle-grayscale" size="sm">
          <Switch
            id="toggle-grayscale"
            bind:checked={grayscale}
            disabled={isProcessing}
            onCheckedChange={() => { activePreset = 'default'; }}
          />
        </ControlRow>
      </div>

      <!-- note: scanned text binarisation -->
      <div class="dialog-card">
        <ControlRow label="Scanned Document Binarisation" for="toggle-binarize" variant="ghost" size="compact">
          <Switch
            id="toggle-binarize"
            bind:checked={enableBinarize}
            disabled={isProcessing}
            onCheckedChange={() => { activePreset = 'default'; }}
          />
        </ControlRow>

        {#if enableBinarize}
          <div class="field-group pt-2 border-t border-border">
            <Label class="field-label">Threshold</Label>
            <Slider
              type="single"
              min={10}
              max={245}
              step={1}
              unit=""
              value={binarizeThreshold}
              onValueChange={(val: number) => {
                binarizeThreshold = val;
                activePreset = 'default';
              }}
              disabled={isProcessing}
              class="w-full"
            />
          </div>
        {/if}
      </div>

      <!-- note: scope selection -->
      <div class="field-group">
        <Label class="field-label">Apply Scope</Label>
        <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
          <Button
            type="button"
            variant={scope === 'current' ? 'secondary' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => (scope = 'current')}
            disabled={isProcessing}
          >
            Current Page ({store.currentPageIndex + 1})
          </Button>
          <Button
            type="button"
            variant={scope === 'all' ? 'secondary' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => (scope = 'all')}
            disabled={isProcessing}
          >
            All Pages ({store.pageCount})
          </Button>
          {#if selectedPageIndices.length > 1}
            <Button
              type="button"
              variant={scope === 'selected' ? 'secondary' : 'outline'}
              class="flex-1 text-xs"
              onclick={() => (scope = 'selected')}
              disabled={isProcessing}
            >
              Selected ({selectedPageIndices.length})
            </Button>
          {/if}
          <Button
            type="button"
            variant={scope === 'custom' ? 'secondary' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => (scope = 'custom')}
            disabled={isProcessing}
          >
            Custom Range
          </Button>
        </ButtonGroup>

        {#if scope === 'custom'}
          <div class="pt-1">
            <Input
              id="custom-range-input"
              aria-label="Custom page range"
              aria-invalid={Boolean(errorMessage)}
              placeholder="e.g. 1-3, 5, 8-10"
              bind:value={customRange}
              class="field-input"
              disabled={isProcessing}
            />
          </div>
        {/if}
      </div>

      <!-- note: feedback banners -->
      {#if errorMessage}
        <div role="alert" class="dialog-error">
          {errorMessage}
        </div>
      {/if}

      {#if successMessage}
        <div role="status" class="rounded-[var(--radius-card-inner)] bg-card border border-border text-foreground text-xs px-3 py-2 flex items-center gap-2">
          <Check class="h-4 w-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      {/if}
    </div>

    <Dialog.Footer class="justify-between">
      <Badge variant="outline" class="text-[10px]">Stirling PDF Parity</Badge>
      <div class="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-8 text-xs"
          onclick={handleClose}
          disabled={isProcessing}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-8 text-xs"
          onclick={handleDownload}
          disabled={isProcessing || !store.isDocumentLoaded}
        >
          <Download class="h-3.5 w-3.5 mr-1.5" />
          Download
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-8 text-xs"
          onclick={handleSaveCopy}
          disabled={isProcessing || !store.isDocumentLoaded}
        >
          <Copy class="h-3.5 w-3.5 mr-1.5" />
          Save Copy
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          class="h-8 text-xs"
          onclick={handleApplyInPlace}
          disabled={isProcessing || !store.isDocumentLoaded}
        >
          {#if isProcessing}
            <Loader2 class="h-3.5 w-3.5 animate-spin mr-1.5" />
            Applying...
          {:else}
            <Check class="h-3.5 w-3.5 mr-1.5" />
            Apply to Document
          {/if}
        </Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
