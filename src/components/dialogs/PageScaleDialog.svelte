<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useSelection } from '../../stores/selection.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import {
    Scaling,
    Maximize2,
    Crop,
    Check,
    Loader2,
  } from 'lucide-svelte';
  import {
    STANDARD_PAPER_SIZES,
    type PaperSizePreset,
    type ScaleUnit,
    type ScaleOrientation,
    type ScaleMode,
    type PadMarginsAlignment,
    type PageScaleScope,
    convertToPoints,
    convertFromPoints,
    resolvePaperDimensions,
  } from '../../services/pdf/operations/scale-ops';

  const store = useEditorStore();
  const actions = useEditorActions();
  const selection = useSelection();

  let mode = $state<ScaleMode>('proportional');
  let preset = $state<PaperSizePreset>('A4');
  let orientation = $state<ScaleOrientation>('portrait');
  let unit = $state<ScaleUnit>('pt');
  let alignment = $state<PadMarginsAlignment>('center');
  let scope = $state<PageScaleScope>('current');
  let constrainProportions = $state(true);
  let isApplying = $state(false);
  let errorMessage = $state('');

  let targetWidthInput = $state(595.3);
  let targetHeightInput = $state(841.9);

  const activePageIdx = $derived(store.currentPageIndex);
  const selectedPageIndices = $derived.by(() => {
    return Array.from(selection.selectedIds)
      .filter((id: string) => id.startsWith('page_'))
      .map((id: string) => parseInt(id.replace('page_', ''), 10));
  });
  const sourceDims = $derived.by(() => {
    if (!store.isDocumentLoaded) return { width: 595.28, height: 841.89 };
    const dims = actions.getPageDimensions(activePageIdx);
    return { width: dims.widthPts, height: dims.heightPts };
  });

  $effect(() => {
    if (preset !== 'custom') {
      const resolvedPts = resolvePaperDimensions(preset, orientation);
      untrack(() => {
        targetWidthInput = convertFromPoints(resolvedPts.width, unit);
        targetHeightInput = convertFromPoints(resolvedPts.height, unit);
      });
    }
  });

  $effect(() => {
    if (selectedPageIndices.length <= 1) {
      untrack(() => {
        if (scope === 'selected') {
          scope = 'current';
        }
      });
    }
  });

  function handleUnitChange(newUnit: ScaleUnit): void {
    if (newUnit === unit) return;
    const currentWPts = convertToPoints(targetWidthInput, unit);
    const currentHPts = convertToPoints(targetHeightInput, unit);
    unit = newUnit;
    targetWidthInput = convertFromPoints(currentWPts, newUnit);
    targetHeightInput = convertFromPoints(currentHPts, newUnit);
  }

  function handlePresetChange(newPreset: PaperSizePreset): void {
    preset = newPreset;
    if (newPreset !== 'custom') {
      const resolvedPts = resolvePaperDimensions(newPreset, orientation);
      targetWidthInput = convertFromPoints(resolvedPts.width, unit);
      targetHeightInput = convertFromPoints(resolvedPts.height, unit);
    }
  }

  function handleOrientationChange(newOrientation: ScaleOrientation): void {
    if (newOrientation === orientation) return;
    orientation = newOrientation;
    if (preset !== 'custom') {
      const resolvedPts = resolvePaperDimensions(preset, newOrientation);
      targetWidthInput = convertFromPoints(resolvedPts.width, unit);
      targetHeightInput = convertFromPoints(resolvedPts.height, unit);
    } else {
      // Swap width and height for custom size
      const temp = targetWidthInput;
      targetWidthInput = targetHeightInput;
      targetHeightInput = temp;
    }
  }

  const targetDimsPts = $derived.by(() => {
    if (preset === 'custom') {
      return {
        width: Math.max(10, convertToPoints(targetWidthInput, unit)),
        height: Math.max(10, convertToPoints(targetHeightInput, unit)),
      };
    }
    return resolvePaperDimensions(preset, orientation);
  });

  const scalePercentPreview = $derived.by(() => {
    if (sourceDims.width <= 0 || sourceDims.height <= 0) return { x: 100, y: 100 };
    if (constrainProportions && mode === 'proportional') {
      const s = Math.min(targetDimsPts.width / sourceDims.width, targetDimsPts.height / sourceDims.height);
      return { x: Math.round(s * 100), y: Math.round(s * 100) };
    }
    return {
      x: Math.round((targetDimsPts.width / sourceDims.width) * 100),
      y: Math.round((targetDimsPts.height / sourceDims.height) * 100),
    };
  });

  function handleOpenChange(open: boolean): void {
    errorMessage = '';
    if (!open) {
      actions.closePageScaleDialog();
    }
  }

  async function handleApply(): Promise<void> {
    if (isApplying) return;
    errorMessage = '';
    isApplying = true;
    try {
      await actions.scalePage(
        activePageIdx,
        {
          mode,
          targetDimensions: targetDimsPts,
          constrainProportions,
          alignment,
        },
        scope,
      );
      actions.closePageScaleDialog();
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Failed to resize page';
    } finally {
      isApplying = false;
    }
  }
</script>

<Dialog.Root open={store.showPageScaleDialog} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[480px]">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2 text-base font-semibold">
        <Scaling class="h-4 w-4 text-primary" />
        Scale and Resize Pages
      </Dialog.Title>
      <Dialog.Description class="text-xs text-muted-foreground">
        Adjust page dimensions, paper format presets, and content geometry.
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4 py-2 text-xs">
      <!-- Mode Selection -->
      <div class="space-y-1.5">
        <Label class="text-xs font-medium">Resize Mode</Label>
        <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
          <Button
            type="button"
            variant={mode === 'proportional' ? 'default' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => (mode = 'proportional')}
          >
            <Maximize2 class="h-3.5 w-3.5 mr-1.5" />
            Scale Content
          </Button>
          <Button
            type="button"
            variant={mode === 'pad-margins' ? 'default' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => (mode = 'pad-margins')}
          >
            <Crop class="h-3.5 w-3.5 mr-1.5" />
            Pad Margins
          </Button>
        </ButtonGroup>
      </div>

      <!-- Paper Size Presets -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <Label class="text-xs font-medium">Paper Format Preset</Label>
          <!-- Unit Selector -->
          <ButtonGroup variant="outline" size="xs" class="h-6">
            <Button
              type="button"
              variant={unit === 'pt' ? 'default' : 'outline'}
              class="px-2 text-[10px]"
              onclick={() => handleUnitChange('pt')}
            >
              pt
            </Button>
            <Button
              type="button"
              variant={unit === 'mm' ? 'default' : 'outline'}
              class="px-2 text-[10px]"
              onclick={() => handleUnitChange('mm')}
            >
              mm
            </Button>
            <Button
              type="button"
              variant={unit === 'in' ? 'default' : 'outline'}
              class="px-2 text-[10px]"
              onclick={() => handleUnitChange('in')}
            >
              in
            </Button>
          </ButtonGroup>
        </div>

        <div class="grid grid-cols-3 gap-1.5">
          {#each Object.entries(STANDARD_PAPER_SIZES) as [key, spec]}
            <button
              type="button"
              class="flex flex-col items-center justify-center p-2 rounded-md border text-center cursor-pointer transition-colors {preset === key ? 'border-primary bg-primary/10 font-medium' : 'border-border hover:bg-muted/50'}"
              onclick={() => handlePresetChange(key as PaperSizePreset)}
            >
              <span class="text-xs">{key}</span>
              <span class="text-[10px] text-muted-foreground">{spec.label.split('(')[1]?.replace(')', '')}</span>
            </button>
          {/each}
          <button
            type="button"
            class="flex flex-col items-center justify-center p-2 rounded-md border text-center cursor-pointer transition-colors {preset === 'custom' ? 'border-primary bg-primary/10 font-medium' : 'border-border hover:bg-muted/50'}"
            onclick={() => handlePresetChange('custom')}
          >
            <span class="text-xs">Custom</span>
            <span class="text-[10px] text-muted-foreground">User defined</span>
          </button>
        </div>
      </div>

      <!-- Orientation and Custom Dimensions Grid -->
      <div class="grid grid-cols-2 gap-3 items-end">
        <div class="space-y-1.5">
          <Label class="text-xs font-medium">Orientation</Label>
          <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
            <Button
              type="button"
              variant={orientation === 'portrait' ? 'default' : 'outline'}
              class="flex-1 text-xs"
              onclick={() => handleOrientationChange('portrait')}
            >
              Portrait
            </Button>
            <Button
              type="button"
              variant={orientation === 'landscape' ? 'default' : 'outline'}
              class="flex-1 text-xs"
              onclick={() => handleOrientationChange('landscape')}
            >
              Landscape
            </Button>
          </ButtonGroup>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div class="space-y-1">
            <Label class="text-[11px] text-muted-foreground">Width ({unit})</Label>
            <Input
              type="number"
              bind:value={targetWidthInput}
              min="10"
              step="0.1"
              disabled={preset !== 'custom'}
              class="h-8 text-xs font-sans"
            />
          </div>
          <div class="space-y-1">
            <Label class="text-[11px] text-muted-foreground">Height ({unit})</Label>
            <Input
              type="number"
              bind:value={targetHeightInput}
              min="10"
              step="0.1"
              disabled={preset !== 'custom'}
              class="h-8 text-xs font-sans"
            />
          </div>
        </div>
      </div>

      <!-- Mode-Specific Controls -->
      {#if mode === 'proportional'}
        <div class="flex items-center space-x-2 pt-1">
          <Checkbox
            id="constrain-proportions"
            bind:checked={constrainProportions}
          />
          <Label for="constrain-proportions" class="text-xs cursor-pointer">
            Constrain proportions (maintain aspect ratio and center content)
          </Label>
        </div>
      {:else}
        <div class="space-y-1.5 pt-1">
          <Label class="text-xs font-medium">Content Alignment</Label>
          <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
            <Button
              type="button"
              variant={alignment === 'top-left' ? 'default' : 'outline'}
              class="flex-1 text-xs"
              onclick={() => (alignment = 'top-left')}
            >
              Top-Left
            </Button>
            <Button
              type="button"
              variant={alignment === 'center' ? 'default' : 'outline'}
              class="flex-1 text-xs"
              onclick={() => (alignment = 'center')}
            >
              Center
            </Button>
            <Button
              type="button"
              variant={alignment === 'bottom-center' ? 'default' : 'outline'}
              class="flex-1 text-xs"
              onclick={() => (alignment = 'bottom-center')}
            >
              Bottom-Center
            </Button>
          </ButtonGroup>
        </div>
      {/if}

      <!-- Scope Selection -->
      <div class="space-y-1.5 pt-1">
        <Label class="text-xs font-medium">Apply To</Label>
        <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
          <Button
            type="button"
            variant={scope === 'current' ? 'default' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => (scope = 'current')}
          >
            Current Page ({activePageIdx + 1})
          </Button>
          <Button
            type="button"
            variant={scope === 'all' ? 'default' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => (scope = 'all')}
          >
            All Pages ({store.pageCount})
          </Button>
          {#if selectedPageIndices.length > 1}
            <Button
              type="button"
              variant={scope === 'selected' ? 'default' : 'outline'}
              class="flex-1 text-xs"
              onclick={() => (scope = 'selected')}
            >
              Selected ({selectedPageIndices.length})
            </Button>
          {/if}
        </ButtonGroup>
      </div>

      <!-- Geometry Preview Summary Badge -->
      <div class="rounded-md bg-muted/50 p-2.5 space-y-1 border border-border/50">
        <div class="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Current Size:</span>
          <span class="font-sans text-foreground">
            {Math.round(sourceDims.width * 10) / 10} x {Math.round(sourceDims.height * 10) / 10} pt
          </span>
        </div>
        <div class="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Target Size:</span>
          <span class="font-sans font-medium text-foreground">
            {Math.round(targetDimsPts.width * 10) / 10} x {Math.round(targetDimsPts.height * 10) / 10} pt
          </span>
        </div>
        {#if mode === 'proportional'}
          <div class="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Content Scale:</span>
            <span class="font-sans text-primary">
              {scalePercentPreview.x}% x {scalePercentPreview.y}%
            </span>
          </div>
        {/if}
      </div>

      {#if errorMessage}
        <div class="text-xs text-destructive bg-destructive/10 p-2 rounded-md">
          {errorMessage}
        </div>
      {/if}
    </div>

    <Dialog.Footer class="pt-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onclick={() => actions.closePageScaleDialog()}
        disabled={isApplying}
      >
        Cancel
      </Button>
      <Button
        type="button"
        variant="default"
        size="sm"
        onclick={handleApply}
        disabled={isApplying || !store.isDocumentLoaded}
      >
        {#if isApplying}
          <Loader2 class="h-3.5 w-3.5 animate-spin mr-1.5" />
          Applying...
        {:else}
          <Check class="h-3.5 w-3.5 mr-1.5" />
          Apply Scale
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
