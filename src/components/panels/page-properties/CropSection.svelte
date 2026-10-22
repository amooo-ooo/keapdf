<script lang="ts">
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { RotateCcw, Sparkles, Check, X } from 'lucide-svelte';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import {
    calculateCropMarginsFromDimensions,
    calculateMarginsFromBounds,
    convertFromPoints,
    convertToPoints,
    type PageCropMargins,
    type ContentBounds,
  } from '../../../services/pdf/operations/crop-ops';
  import type { CropUnit, CropScope } from '../../../stores/types';

  const store = useEditorStore();
  const actions = useEditorActions();
  const canvasStore = useCanvasStore();

  // Local state when not in active on-canvas crop mode
  let fallbackMargins = $state<PageCropMargins>({ top: 0, right: 0, bottom: 0, left: 0 });
  let fallbackUnit = $state<CropUnit>('pt');
  let fallbackScope = $state<CropScope>('current');

  const activeCrop = $derived(store.activeCrop);

  const activePageIndex = $derived(activeCrop ? activeCrop.pageIndex : store.currentPageIndex);
  const activeUnit = $derived(activeCrop ? activeCrop.unit : fallbackUnit);
  const activeScope = $derived(activeCrop ? activeCrop.scope : fallbackScope);
  const activeMargins = $derived(activeCrop ? activeCrop.margins : fallbackMargins);

  function getPageDimensions(): { widthPts: number; heightPts: number } {
    try {
      if (actions.service.document) {
        return actions.service.document.getPage(activePageIndex).getDimensions();
      }
    } catch {
      // Fallback
    }
    return { widthPts: 612, heightPts: 792 };
  }

  const pageDims = $derived.by(() => {
    // Track versions to re-calculate on document changes
    void store.renderVersion;
    void store.pageVersions[activePageIndex];
    return getPageDimensions();
  });

  const origWidth = $derived(
    Number(convertFromPoints(pageDims.widthPts, activeUnit).toFixed(activeUnit === 'pt' ? 0 : 2))
  );
  const origHeight = $derived(
    Number(convertFromPoints(pageDims.heightPts, activeUnit).toFixed(activeUnit === 'pt' ? 0 : 2))
  );

  const croppedWidth = $derived(
    Math.max(
      0,
      Number(
        convertFromPoints(
          pageDims.widthPts - activeMargins.left - activeMargins.right,
          activeUnit
        ).toFixed(activeUnit === 'pt' ? 0 : 2)
      )
    )
  );

  const croppedHeight = $derived(
    Math.max(
      0,
      Number(
        convertFromPoints(
          pageDims.heightPts - activeMargins.top - activeMargins.bottom,
          activeUnit
        ).toFixed(activeUnit === 'pt' ? 0 : 2)
      )
    )
  );

  function setUnit(unit: CropUnit): void {
    if (activeCrop) {
      actions.setCropUnit(unit);
    } else {
      fallbackUnit = unit;
    }
  }

  function setScope(scope: CropScope): void {
    if (activeCrop) {
      actions.setCropScope(scope);
    } else {
      fallbackScope = scope;
    }
  }

  function updateMargin(edge: keyof PageCropMargins, displayVal: number): void {
    const pointsVal = Math.max(0, convertToPoints(displayVal, activeUnit));
    if (activeCrop) {
      actions.updateCropMargins({ [edge]: pointsVal });
    } else {
      fallbackMargins = { ...fallbackMargins, [edge]: pointsVal };
    }
  }

  function handleInputChange(edge: keyof PageCropMargins, e: Event): void {
    const target = e.target as HTMLInputElement;
    const parsed = parseFloat(target.value);
    if (!Number.isNaN(parsed)) {
      updateMargin(edge, parsed);
    }
  }

  function handleMarginKeydown(edge: keyof PageCropMargins, e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      handleInputChange(edge, e);
    }
  }

  function applyPreset(marginPts: number): void {
    const nextMargins: PageCropMargins = {
      top: marginPts,
      right: marginPts,
      bottom: marginPts,
      left: marginPts,
    };
    if (activeCrop) {
      actions.updateCropMargins(nextMargins);
    } else {
      fallbackMargins = nextMargins;
    }
  }

  function handleAutoTrim(): void {
    try {
      if (!actions.service.document) return;
      const page = actions.service.document.getPage(activePageIndex);
      let bounds: ContentBounds | null = page.getContentBounds();

      // Incorporate canvas elements on this page if present
      const canvasElements = canvasStore.getElementsByPage(activePageIndex);
      for (const el of canvasElements) {
        if (!bounds) {
          bounds = {
            left: el.x,
            top: el.y,
            right: el.x + el.width,
            bottom: el.y + el.height,
          };
        } else {
          bounds.left = Math.min(bounds.left, el.x);
          bounds.top = Math.min(bounds.top, el.y);
          bounds.right = Math.max(bounds.right, el.x + el.width);
          bounds.bottom = Math.max(bounds.bottom, el.y + el.height);
        }
      }

      if (!bounds) return;

      const recommended = calculateMarginsFromBounds(bounds, pageDims, 18);
      if (activeCrop) {
        actions.updateCropMargins(recommended);
      } else {
        fallbackMargins = recommended;
      }
    } catch (err) {
      console.warn('Auto-trim content margin detection failed:', err);
    }
  }

  async function handleApplyCrop(): Promise<void> {
    await actions.cropPage(activePageIndex, activeMargins, activeScope);
  }

  async function handleResetCrop(): Promise<void> {
    await actions.resetPageCrop(activePageIndex, activeScope);
    fallbackMargins = { top: 0, right: 0, bottom: 0, left: 0 };
  }

  function handleCancelCrop(): void {
    actions.cancelCropMode();
  }

  function getDisplayMargin(edge: keyof PageCropMargins): number {
    const val = activeMargins[edge];
    return Number(convertFromPoints(val, activeUnit).toFixed(activeUnit === 'pt' ? 0 : 2));
  }

  function getInputStep(): string {
    switch (activeUnit) {
      case 'in':
        return '0.1';
      case 'mm':
        return '1';
      case 'pt':
      default:
        return '1';
    }
  }

  let widthInputEl = $state<HTMLInputElement | null>(null);

  function updateDimension(dim: 'width' | 'height', displayVal: number): void {
    const pointsVal = Math.max(10, convertToPoints(displayVal, activeUnit));
    const nextMargins = calculateCropMarginsFromDimensions(
      activeMargins,
      pageDims.widthPts,
      pageDims.heightPts,
      { [dim]: pointsVal },
      10,
    );
    if (activeCrop) {
      actions.updateCropMargins(nextMargins);
    } else {
      fallbackMargins = nextMargins;
    }
  }

  function handleDimensionChange(dim: 'width' | 'height', e: Event): void {
    const target = e.target as HTMLInputElement;
    const parsed = parseFloat(target.value);
    if (!Number.isNaN(parsed)) {
      updateDimension(dim, parsed);
    }
  }

  function handleDimensionKeydown(dim: 'width' | 'height', e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      handleDimensionChange(dim, e);
    }
  }
</script>

<SidebarSection title="Crop Page" borderBottom={true} collapsible={true} defaultExpanded={true}>
  {#if store.isDocumentLoaded}
    <div class="flex flex-col gap-2.5">
      <!-- Dimensions Status Banner -->
      <div class="rounded-xl border border-border/80 bg-muted/40 p-2.5 text-xs flex flex-col gap-1.5">
        <div class="flex items-center justify-between font-medium">
          <span class="text-muted-foreground">Original:</span>
          <span class="font-sans">{origWidth} x {origHeight} {activeUnit}</span>
        </div>
        <div class="flex items-center justify-between font-medium">
          <span class="text-muted-foreground">Cropped:</span>
          <span class="font-sans">{croppedWidth} x {croppedHeight} {activeUnit}</span>
        </div>
      </div>

      <!-- Crop Size Grid (Direct Width & Height) -->
      <div class="field-group">
        <Label class="field-label">Crop Size ({activeUnit})</Label>
        <div class="grid grid-cols-2 gap-2">
          <div class="field-group">
            <Label class="field-label">Width</Label>
            <Input
              bind:ref={widthInputEl}
              type="number"
              value={croppedWidth}
              min="1"
              step={getInputStep()}
              onchange={(e) => handleDimensionChange('width', e)}
              onkeydown={(e) => handleDimensionKeydown('width', e)}
              class="field-input font-sans"
              aria-label="Crop Width"
            />
          </div>
          <div class="field-group">
            <Label class="field-label">Height</Label>
            <Input
              type="number"
              value={croppedHeight}
              min="1"
              step={getInputStep()}
              onchange={(e) => handleDimensionChange('height', e)}
              onkeydown={(e) => handleDimensionKeydown('height', e)}
              class="field-input font-sans"
              aria-label="Crop Height"
            />
          </div>
        </div>
      </div>

      <!-- Unit Selector -->
      <div class="field-group">
        <Label class="field-label">Unit</Label>
        <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
          <Button
            variant={activeUnit === 'pt' ? 'default' : 'outline'}
            size="sm"
            class="flex-1 h-8 text-xs font-normal"
            onclick={() => setUnit('pt')}
          >
            pt
          </Button>
          <Button
            variant={activeUnit === 'in' ? 'default' : 'outline'}
            size="sm"
            class="flex-1 h-8 text-xs font-normal"
            onclick={() => setUnit('in')}
          >
            in
          </Button>
          <Button
            variant={activeUnit === 'mm' ? 'default' : 'outline'}
            size="sm"
            class="flex-1 h-8 text-xs font-normal"
            onclick={() => setUnit('mm')}
          >
            mm
          </Button>
        </ButtonGroup>
      </div>

      <!-- Margins Grid -->
      <div class="field-group">
        <Label class="field-label">Margins ({activeUnit})</Label>
        <div class="grid grid-cols-2 gap-2">
          <div class="field-group">
            <Label class="field-label">Top</Label>
            <Input
              type="number"
              value={getDisplayMargin('top')}
              min="0"
              step={getInputStep()}
              onchange={(e) => handleInputChange('top', e)}
              onkeydown={(e) => handleMarginKeydown('top', e)}
              class="field-input"
              aria-label="Crop Top"
            />
          </div>
          <div class="field-group">
            <Label class="field-label">Bottom</Label>
            <Input
              type="number"
              value={getDisplayMargin('bottom')}
              min="0"
              step={getInputStep()}
              onchange={(e) => handleInputChange('bottom', e)}
              onkeydown={(e) => handleMarginKeydown('bottom', e)}
              class="field-input"
              aria-label="Crop Bottom"
            />
          </div>
          <div class="field-group">
            <Label class="field-label">Left</Label>
            <Input
              type="number"
              value={getDisplayMargin('left')}
              min="0"
              step={getInputStep()}
              onchange={(e) => handleInputChange('left', e)}
              onkeydown={(e) => handleMarginKeydown('left', e)}
              class="field-input"
              aria-label="Crop Left"
            />
          </div>
          <div class="field-group">
            <Label class="field-label">Right</Label>
            <Input
              type="number"
              value={getDisplayMargin('right')}
              min="0"
              step={getInputStep()}
              onchange={(e) => handleInputChange('right', e)}
              onkeydown={(e) => handleMarginKeydown('right', e)}
              class="field-input"
              aria-label="Crop Right"
            />
          </div>
        </div>
      </div>

      <!-- Presets -->
      <div class="field-group">
        <Label class="field-label">Presets</Label>
        <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
          <Button
            variant="outline"
            class="flex-1 h-8 text-xs"
            onclick={handleAutoTrim}
            title="Auto-Trim Page Content"
          >
            <Sparkles class="w-3.5 h-3.5 mr-1" /> Auto
          </Button>
          <Button
            variant="outline"
            class="flex-1 h-8 text-xs"
            onclick={() => applyPreset(18)}
          >
            0.25"
          </Button>
          <Button
            variant="outline"
            class="flex-1 h-8 text-xs"
            onclick={() => applyPreset(36)}
          >
            0.5"
          </Button>
          <Button
            variant="outline"
            class="flex-1 h-8 text-xs"
            onclick={() => applyPreset(72)}
          >
            1.0"
          </Button>
          <Button
            variant="outline"
            class="flex-1 h-8 text-xs text-muted-foreground hover:text-foreground"
            onclick={() => applyPreset(0)}
          >
            None
          </Button>
        </ButtonGroup>
      </div>

      <!-- Scope Selector -->
      {#if store.pageCount > 1}
        <div class="field-group">
          <Label class="field-label">Apply Scope</Label>
          <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
            <Button
              variant={activeScope === 'current' ? 'default' : 'outline'}
              size="sm"
              class="flex-1 h-8 text-xs font-normal"
              onclick={() => setScope('current')}
            >
              Current
            </Button>
            <Button
              variant={activeScope === 'all' ? 'default' : 'outline'}
              size="sm"
              class="flex-1 h-8 text-xs font-normal"
              onclick={() => setScope('all')}
            >
              All
            </Button>
            <Button
              variant={activeScope === 'selected' ? 'default' : 'outline'}
              size="sm"
              class="flex-1 h-8 text-xs font-normal"
              onclick={() => setScope('selected')}
            >
              Selected
            </Button>
          </ButtonGroup>
        </div>
      {/if}

      <!-- Action Buttons -->
      <div class="flex flex-col gap-2 pt-1">
        <div class="flex items-center gap-2">
          <Button
            variant="secondary"
            class="flex-1 h-8 text-xs font-medium"
            onclick={handleApplyCrop}
          >
            <Check class="w-3.5 h-3.5 mr-1.5" /> Apply Crop
          </Button>
          <Button
            variant="outline"
            class="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            onclick={handleCancelCrop}
          >
            <X class="w-3.5 h-3.5 mr-1" /> Cancel
          </Button>
        </div>

        <Button
          variant="outline"
          class="w-full h-8 text-xs text-muted-foreground hover:text-foreground"
          onclick={handleResetCrop}
        >
          <RotateCcw class="w-3.5 h-3.5 mr-1.5" /> Reset to MediaBox
        </Button>
      </div>
    </div>
  {/if}
</SidebarSection>
