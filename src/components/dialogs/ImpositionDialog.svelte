<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
  import {
    LayoutGrid,
    BookOpenCheck,
    Layers,
    Grid,
    Scissors,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Download,
    FilePlus,
    RefreshCw
  } from 'lucide-svelte';
  import type {
    ImpositionConfig,
    StandardSheetSize,
    SheetOrientation,
    PageFlowDirection,
    BookletBindingSide,
    BookletOutputMode,
    SinglePageLayout
  } from '../../services/pdf/operations/types';
  import { parsePageRange } from '../../utils/page-range';

  interface Props {
    open?: boolean;
    onClose: () => void;
    initialMode?: 'nup' | 'booklet' | 'single-page' | 'posterize' | 'cut-stack';
  }

  let { open = true, onClose, initialMode = 'nup' }: Props = $props();

  const store = useEditorStore();
  const actions = useEditorActions();
  const canvasStore = useCanvasStore();

  type ModeType = 'nup' | 'booklet' | 'single-page' | 'posterize' | 'cut-stack';
  let activeMode = $state<ModeType>('nup');
  let destination = $state<'replace' | 'workspace' | 'download'>('workspace');
  let isProcessing = $state(false);
  let errorMessage = $state('');

  // Preview sheet navigation
  let previewSheetIndex = $state(0);

  // N-Up state
  let nupPreset = $state<'2x1' | '1x2' | '2x2' | '2x3' | '3x2' | '2x4' | '4x2' | '3x3' | '4x4' | 'custom'>('2x2');
  let nupCustomCols = $state(2);
  let nupCustomRows = $state(2);
  let nupSheetSize = $state<StandardSheetSize>('A4');
  let nupOrientation = $state<SheetOrientation>('auto');
  let nupPageFlow = $state<PageFlowDirection>('horizontal');
  let nupMarginPts = $state(18);
  let nupGutterPts = $state(10);
  let nupDrawBorders = $state(true);
  let nupDrawCutMarks = $state(true);
  let nupAutoRotate = $state(true);
  let nupPageRange = $state('');

  // Booklet state
  let bookletBinding = $state<BookletBindingSide>('left');
  let bookletSheetSize = $state<StandardSheetSize>('source-2x');
  let bookletOrientation = $state<SheetOrientation>('landscape');
  let bookletOutputMode = $state<BookletOutputMode>('duplex');
  let bookletAutoPad = $state(true);
  let bookletDrawFoldLine = $state(true);
  let bookletDrawBorders = $state(false);
  let bookletMarginPts = $state(18);
  let bookletGutterPts = $state(12);
  let bookletPageRange = $state('');

  // Single Page state
  let singleLayout = $state<SinglePageLayout>('vertical-strip');
  let singleGridCols = $state(3);
  let singleSpacingPts = $state(14);
  let singleMarginPts = $state(20);
  let singleDrawBorders = $state(true);
  let singleBgColor = $state('#ffffff');
  let singlePageRange = $state('');

  // Posterize state
  let posterSheetSize = $state<StandardSheetSize>('A4');
  let posterOrientation = $state<SheetOrientation>('portrait');
  let posterModeType = $state<'scale' | 'grid'>('scale');
  let posterScalePercent = $state(200);
  let posterGridCols = $state(2);
  let posterGridRows = $state(2);
  let posterOverlapPts = $state(20);
  let posterMarginPts = $state(20);
  let posterDrawCutGuides = $state(true);
  let posterDrawLabels = $state(true);
  let posterPageIndex = $state(0);

  // Cut & Stack state
  let cutStackPreset = $state<'2x1' | '2x2'>('2x1');
  let cutStackSheetSize = $state<StandardSheetSize>('A4');
  let cutStackOrientation = $state<SheetOrientation>('auto');
  let cutStackMarginPts = $state(18);
  let cutStackGutterPts = $state(10);
  let cutStackDrawCutMarks = $state(true);
  let cutStackDrawBorders = $state(false);
  let cutStackPageRange = $state('');

  $effect(() => {
    if (open) {
      untrack(() => {
        activeMode = initialMode;
        previewSheetIndex = 0;
        errorMessage = '';
        posterPageIndex = store.currentPageIndex;
      });
    }
  });

  // Calculate N-Up Grid
  let effectiveNupGrid = $derived.by(() => {
    switch (nupPreset) {
      case '2x1': return { cols: 2, rows: 1 };
      case '1x2': return { cols: 1, rows: 2 };
      case '2x2': return { cols: 2, rows: 2 };
      case '2x3': return { cols: 2, rows: 3 };
      case '3x2': return { cols: 3, rows: 2 };
      case '2x4': return { cols: 2, rows: 4 };
      case '4x2': return { cols: 4, rows: 2 };
      case '3x3': return { cols: 3, rows: 3 };
      case '4x4': return { cols: 4, rows: 4 };
      default: return { cols: Math.max(1, nupCustomCols), rows: Math.max(1, nupCustomRows) };
    }
  });

  // Calculate selected page counts per mode
  let targetPagesCount = $derived.by(() => {
    const total = store.pageCount || 1;
    let range = '';
    if (activeMode === 'nup') range = nupPageRange;
    else if (activeMode === 'booklet') range = bookletPageRange;
    else if (activeMode === 'single-page') range = singlePageRange;
    else if (activeMode === 'cut-stack') range = cutStackPageRange;
    return parsePageRange(range, total).length;
  });

  // Calculate output sheet count
  let totalOutputSheets = $derived.by(() => {
    const N = targetPagesCount;
    if (activeMode === 'nup') {
      const perSheet = effectiveNupGrid.cols * effectiveNupGrid.rows;
      return Math.max(1, Math.ceil(N / perSheet));
    }
    if (activeMode === 'booklet') {
      const padded = bookletAutoPad ? Math.ceil(N / 4) * 4 : N;
      const physicalSheets = Math.ceil(padded / 4);
      return bookletOutputMode === 'duplex' ? physicalSheets * 2 : physicalSheets * 2;
    }
    if (activeMode === 'single-page') {
      return 1;
    }
    if (activeMode === 'posterize') {
      if (posterModeType === 'grid') {
        return posterGridCols * posterGridRows;
      }
      const scale = posterScalePercent / 100;
      const cols = Math.max(1, Math.ceil(scale));
      const rows = Math.max(1, Math.ceil(scale));
      return cols * rows;
    }
    if (activeMode === 'cut-stack') {
      const perSheet = cutStackPreset === '2x1' ? 2 : 4;
      return Math.max(1, Math.ceil(N / perSheet));
    }
    return 1;
  });

  // Get preview data for the current active preview sheet
  let previewData = $derived.by(() => {
    const currentSheet = Math.min(previewSheetIndex, totalOutputSheets - 1);
    const totalSrc = targetPagesCount;

    if (activeMode === 'nup') {
      const { cols, rows } = effectiveNupGrid;
      const perSheet = cols * rows;
      const cells: { col: number; row: number; pageNumber: number | null }[] = [];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let cellIndex = 0;
          if (nupPageFlow === 'vertical') {
            cellIndex = c * rows + r;
          } else if (nupPageFlow === 'horizontal-rtl') {
            cellIndex = r * cols + (cols - 1 - c);
          } else {
            cellIndex = r * cols + c;
          }

          const pageIdx = currentSheet * perSheet + cellIndex;
          cells.push({
            col: c,
            row: r,
            pageNumber: pageIdx < totalSrc ? pageIdx + 1 : null
          });
        }
      }

      return {
        type: 'grid' as const,
        cols,
        rows,
        cells,
        sheetNum: currentSheet + 1,
        totalSheets: totalOutputSheets
      };
    }

    if (activeMode === 'booklet') {
      const physicalSheetCount = Math.ceil((bookletAutoPad ? Math.ceil(totalSrc / 4) * 4 : totalSrc) / 4);
      const T = physicalSheetCount * 4;
      const isBackSide = currentSheet % 2 === 1;
      const physicalIndex = Math.floor(currentSheet / 2) + 1;

      let leftNum: number | null = null;
      let rightNum: number | null = null;

      if (!isBackSide) {
        // Front
        const l = T - 2 * (physicalIndex - 1);
        const r = 2 * physicalIndex - 1;
        leftNum = l <= totalSrc ? l : (bookletAutoPad ? 0 : null);
        rightNum = r <= totalSrc ? r : (bookletAutoPad ? 0 : null);
        if (bookletBinding === 'right') {
          const t = leftNum; leftNum = rightNum; rightNum = t;
        }
      } else {
        // Back
        const l = 2 * physicalIndex;
        const r = T - (2 * physicalIndex - 1);
        leftNum = l <= totalSrc ? l : (bookletAutoPad ? 0 : null);
        rightNum = r <= totalSrc ? r : (bookletAutoPad ? 0 : null);
        if (bookletBinding === 'right') {
          const t = leftNum; leftNum = rightNum; rightNum = t;
        }
      }

      return {
        type: 'booklet' as const,
        side: isBackSide ? 'Back' : 'Front',
        sheetNum: currentSheet + 1,
        physicalNum: physicalIndex,
        totalSheets: totalOutputSheets,
        leftPage: leftNum,
        rightPage: rightNum
      };
    }

    if (activeMode === 'single-page') {
      return {
        type: 'single' as const,
        layout: singleLayout,
        pageCount: totalSrc,
        sheetNum: 1,
        totalSheets: 1
      };
    }

    if (activeMode === 'posterize') {
      const cols = posterModeType === 'grid' ? posterGridCols : Math.max(1, Math.ceil(posterScalePercent / 100));
      const rows = posterModeType === 'grid' ? posterGridRows : Math.max(1, Math.ceil(posterScalePercent / 100));
      const row = Math.floor(currentSheet / cols);
      const col = currentSheet % cols;

      return {
        type: 'poster' as const,
        cols,
        rows,
        currentRow: row + 1,
        currentCol: col + 1,
        sheetNum: currentSheet + 1,
        totalSheets: totalOutputSheets
      };
    }

    if (activeMode === 'cut-stack') {
      const cols = cutStackPreset === '2x1' ? 2 : 2;
      const rows = cutStackPreset === '2x1' ? 1 : 2;
      const perSheet = cols * rows;
      const K = Math.ceil(totalSrc / perSheet);

      const cells: { col: number; row: number; pageNumber: number | null }[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cellIdx = r * cols + c;
          const pageIdx = currentSheet + cellIdx * K;
          cells.push({
            col: c,
            row: r,
            pageNumber: pageIdx < totalSrc ? pageIdx + 1 : null
          });
        }
      }

      return {
        type: 'grid' as const,
        cols,
        rows,
        cells,
        sheetNum: currentSheet + 1,
        totalSheets: totalOutputSheets
      };
    }

    return null;
  });

  function buildConfig(): ImpositionConfig {
    if (activeMode === 'nup') {
      return {
        type: 'nup',
        grid: effectiveNupGrid,
        sheetSize: nupSheetSize,
        orientation: nupOrientation,
        pageFlow: nupPageFlow,
        marginPts: nupMarginPts,
        gutterPts: nupGutterPts,
        drawPageBorders: nupDrawBorders,
        drawCutMarks: nupDrawCutMarks,
        autoRotateSubpages: nupAutoRotate,
        pageRange: nupPageRange
      };
    }

    if (activeMode === 'booklet') {
      return {
        type: 'booklet',
        bindingSide: bookletBinding,
        sheetSize: bookletSheetSize,
        orientation: bookletOrientation,
        outputMode: bookletOutputMode,
        autoPad: bookletAutoPad,
        drawFoldLine: bookletDrawFoldLine,
        drawPageBorders: bookletDrawBorders,
        gutterPts: bookletGutterPts,
        marginPts: bookletMarginPts,
        pageRange: bookletPageRange
      };
    }

    if (activeMode === 'single-page') {
      return {
        type: 'single-page',
        layout: singleLayout,
        gridCols: singleGridCols,
        spacingPts: singleSpacingPts,
        marginPts: singleMarginPts,
        drawPageBorders: singleDrawBorders,
        backgroundColor: singleBgColor,
        pageRange: singlePageRange
      };
    }

    if (activeMode === 'posterize') {
      return {
        type: 'posterize',
        sheetSize: posterSheetSize,
        orientation: posterOrientation,
        tileScale: posterModeType === 'scale' ? posterScalePercent / 100 : undefined,
        tileGrid: posterModeType === 'grid' ? { cols: posterGridCols, rows: posterGridRows } : undefined,
        overlapPts: posterOverlapPts,
        marginPts: posterMarginPts,
        drawCutGuides: posterDrawCutGuides,
        drawSheetNumbers: posterDrawLabels,
        sourcePageIndex: posterPageIndex
      };
    }

    // 'cut-stack'
    return {
      type: 'cut-stack',
      grid: cutStackPreset === '2x1' ? { cols: 2, rows: 1 } : { cols: 2, rows: 2 },
      sheetSize: cutStackSheetSize,
      orientation: cutStackOrientation,
      marginPts: cutStackMarginPts,
      gutterPts: cutStackGutterPts,
      drawCutMarks: cutStackDrawCutMarks,
      drawPageBorders: cutStackDrawBorders,
      pageRange: cutStackPageRange
    };
  }

  async function handleApply(): Promise<void> {
    errorMessage = '';
    isProcessing = true;

    try {
      const config = buildConfig();
      await actions.applyImposition(config, destination, canvasStore);
      onClose();
    } catch (err) {
      console.error('Imposition error:', err);
      errorMessage = err instanceof Error ? err.message : 'Failed to apply imposition layout.';
    } finally {
      isProcessing = false;
    }
  }

  function handleOpenChange(isOpen: boolean): void {
    if (!isOpen) {
      onClose();
    }
  }
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[820px] max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden bg-background border border-border shadow-2xl">
    <!-- Header -->
    <div class="px-6 pt-5 pb-4 border-b border-border bg-muted/20">
      <div class="flex items-center justify-between">
        <div>
          <Dialog.Title class="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
            <LayoutGrid class="h-4 w-4 text-primary" />
            Page Imposition & Layout
          </Dialog.Title>
          <Dialog.Description class="text-xs text-muted-foreground mt-0.5">
            Rearrange, group, scale, and impose pages for booklet printing, n-up sheets, continuous rolls, or posters.
          </Dialog.Description>
        </div>
        <Badge variant="outline" class="text-[11px] font-sans font-medium px-2 py-0.5 border-primary/30 text-primary">
          {store.pageCount} Pages Loaded
        </Badge>
      </div>

      <!-- Mode Selector Tabs -->
      <div class="flex items-center gap-1.5 mt-4 p-1 bg-muted/60 rounded-lg border border-border/60 overflow-x-auto">
        <button
          type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0 {activeMode === 'nup' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => { activeMode = 'nup'; previewSheetIndex = 0; }}
        >
          <LayoutGrid class="h-3.5 w-3.5" />
          Multi-Page (N-Up)
        </button>

        <button
          type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0 {activeMode === 'booklet' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => { activeMode = 'booklet'; previewSheetIndex = 0; }}
        >
          <BookOpenCheck class="h-3.5 w-3.5" />
          Booklet
        </button>

        <button
          type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0 {activeMode === 'single-page' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => { activeMode = 'single-page'; previewSheetIndex = 0; }}
        >
          <Layers class="h-3.5 w-3.5" />
          Single Page
        </button>

        <button
          type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0 {activeMode === 'posterize' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => { activeMode = 'posterize'; previewSheetIndex = 0; }}
        >
          <Grid class="h-3.5 w-3.5" />
          Posterize / Tile
        </button>

        <button
          type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0 {activeMode === 'cut-stack' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => { activeMode = 'cut-stack'; previewSheetIndex = 0; }}
        >
          <Scissors class="h-3.5 w-3.5" />
          Cut & Stack
        </button>
      </div>
    </div>

    <!-- Body (2 columns: Controls + Live Preview) -->
    <div class="grid grid-cols-1 md:grid-cols-12 min-h-[380px] max-h-[58vh] overflow-y-auto">
      <!-- Left Config Controls -->
      <div class="md:col-span-7 p-6 flex flex-col gap-4 border-r border-border overflow-y-auto">
        <!-- N-UP MODE CONTROLS -->
        {#if activeMode === 'nup'}
          <div class="flex flex-col gap-3.5">
            <div class="grid gap-1.5">
              <Label class="text-xs font-medium">Grid Preset (Pages per Sheet)</Label>
              <div class="grid grid-cols-4 gap-1.5">
                {#each [
                  { id: '2x1', label: '2-Up (2x1)' },
                  { id: '1x2', label: '2-Up (1x2)' },
                  { id: '2x2', label: '4-Up (2x2)' },
                  { id: '2x3', label: '6-Up (2x3)' },
                  { id: '3x2', label: '6-Up (3x2)' },
                  { id: '2x4', label: '8-Up (2x4)' },
                  { id: '3x3', label: '9-Up (3x3)' },
                  { id: 'custom', label: 'Custom Grid' }
                ] as const as preset}
                  <button
                    type="button"
                    class="px-2 py-1.5 text-xs rounded border text-center transition-colors {nupPreset === preset.id ? 'bg-primary text-primary-foreground border-primary font-medium' : 'bg-muted/30 border-border hover:bg-muted text-muted-foreground hover:text-foreground'}"
                    onclick={() => { nupPreset = preset.id; previewSheetIndex = 0; }}
                  >
                    {preset.label}
                  </button>
                {/each}
              </div>
            </div>

            {#if nupPreset === 'custom'}
              <div class="grid grid-cols-2 gap-3 p-2.5 rounded-md bg-muted/30 border border-border">
                <div class="grid gap-1">
                  <Label class="text-[11px]">Columns</Label>
                  <Input type="number" min="1" max="10" bind:value={nupCustomCols} class="h-7 text-xs" />
                </div>
                <div class="grid gap-1">
                  <Label class="text-[11px]">Rows</Label>
                  <Input type="number" min="1" max="10" bind:value={nupCustomRows} class="h-7 text-xs" />
                </div>
              </div>
            {/if}

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <Label class="text-xs">Sheet Size</Label>
                <select
                  bind:value={nupSheetSize}
                  class="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="A4">A4 (210 x 297 mm)</option>
                  <option value="Letter">US Letter (8.5 x 11 in)</option>
                  <option value="A3">A3 (297 x 420 mm)</option>
                  <option value="A5">A5 (148 x 210 mm)</option>
                  <option value="Legal">US Legal (8.5 x 14 in)</option>
                  <option value="Tabloid">Tabloid / Ledger (11 x 17 in)</option>
                  <option value="source">Match Source Page Size</option>
                </select>
              </div>

              <div class="grid gap-1.5">
                <Label class="text-xs">Orientation</Label>
                <select
                  bind:value={nupOrientation}
                  class="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="auto">Auto (Best Fit)</option>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <Label class="text-xs">Page Flow Ordering</Label>
                <select
                  bind:value={nupPageFlow}
                  class="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="horizontal">Left-to-Right (Rows)</option>
                  <option value="vertical">Top-to-Bottom (Columns)</option>
                  <option value="horizontal-rtl">Right-to-Left (RTL)</option>
                </select>
              </div>

              <div class="grid gap-1.5">
                <Label class="text-xs">Page Range</Label>
                <Input
                  type="text"
                  placeholder="All (e.g. 1-8, 10)"
                  bind:value={nupPageRange}
                  class="h-8 text-xs"
                />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <div class="flex justify-between text-xs">
                  <Label class="text-xs">Outer Margin</Label>
                  <span class="text-muted-foreground">{nupMarginPts} pt</span>
                </div>
                <Slider
                  type="single"
                  min={0}
                  max={60}
                  step={1}
                  value={nupMarginPts}
                  onValueChange={(val: number) => { nupMarginPts = val; }}
                  class="w-full mt-1.5"
                />
              </div>

              <div class="grid gap-1.5">
                <div class="flex justify-between text-xs">
                  <Label class="text-xs">Cell Gutter</Label>
                  <span class="text-muted-foreground">{nupGutterPts} pt</span>
                </div>
                <Slider
                  type="single"
                  min={0}
                  max={40}
                  step={1}
                  value={nupGutterPts}
                  onValueChange={(val: number) => { nupGutterPts = val; }}
                  class="w-full mt-1.5"
                />
              </div>
            </div>

            <div class="flex flex-wrap gap-4 pt-1">
              <label class="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox bind:checked={nupDrawBorders} />
                <span>Draw Page Borders</span>
              </label>

              <label class="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox bind:checked={nupDrawCutMarks} />
                <span>Draw Cut Guides</span>
              </label>

              <label class="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox bind:checked={nupAutoRotate} />
                <span>Auto-rotate Subpages</span>
              </label>
            </div>
          </div>

        <!-- BOOKLET MODE CONTROLS -->
        {:else if activeMode === 'booklet'}
          <div class="flex flex-col gap-3.5">
            <div class="p-3 rounded-lg bg-primary/5 border border-primary/15 text-xs text-muted-foreground">
              <p class="font-medium text-foreground">Saddle-Stitch 2-Up Booklet Imposition</p>
              Pairs and reorders pages into folded 4-page spreads. When printed double-sided and folded in half along the spine, pages are in exact sequential reading order.
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <Label class="text-xs">Binding Edge</Label>
                <select
                  bind:value={bookletBinding}
                  class="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="left">Left Edge (LTR Standard)</option>
                  <option value="right">Right Edge (RTL / Manga)</option>
                </select>
              </div>

              <div class="grid gap-1.5">
                <Label class="text-xs">Sheet Size</Label>
                <select
                  bind:value={bookletSheetSize}
                  class="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="source-2x">2x Source Page (Fit Width)</option>
                  <option value="A4">A4 (for A5 booklet)</option>
                  <option value="Letter">Letter (for Half-Letter booklet)</option>
                  <option value="A3">A3 (for A4 booklet)</option>
                </select>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <Label class="text-xs">Output Sequence</Label>
                <select
                  bind:value={bookletOutputMode}
                  class="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="duplex">Duplex Interleaved (Front 1, Back 1...)</option>
                  <option value="front-then-back">Fronts First, Then Backs (Manual Duplex)</option>
                </select>
              </div>

              <div class="grid gap-1.5">
                <Label class="text-xs">Page Range</Label>
                <Input
                  type="text"
                  placeholder="All (e.g. 1-16)"
                  bind:value={bookletPageRange}
                  class="h-8 text-xs"
                />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <div class="flex justify-between text-xs">
                  <Label class="text-xs">Outer Margin</Label>
                  <span class="text-muted-foreground">{bookletMarginPts} pt</span>
                </div>
                <Slider
                  type="single"
                  min={0}
                  max={50}
                  step={1}
                  value={bookletMarginPts}
                  onValueChange={(val: number) => { bookletMarginPts = val; }}
                  class="w-full mt-1.5"
                />
              </div>

              <div class="grid gap-1.5">
                <div class="flex justify-between text-xs">
                  <Label class="text-xs">Spine Gutter</Label>
                  <span class="text-muted-foreground">{bookletGutterPts} pt</span>
                </div>
                <Slider
                  type="single"
                  min={0}
                  max={40}
                  step={1}
                  value={bookletGutterPts}
                  onValueChange={(val: number) => { bookletGutterPts = val; }}
                  class="w-full mt-1.5"
                />
              </div>
            </div>

            <div class="flex flex-wrap gap-4 pt-1">
              <label class="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox bind:checked={bookletAutoPad} />
                <span>Auto-pad with blanks to multiple of 4</span>
              </label>

              <label class="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox bind:checked={bookletDrawFoldLine} />
                <span>Draw Center Spine Fold Guide</span>
              </label>

              <label class="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox bind:checked={bookletDrawBorders} />
                <span>Draw Page Borders</span>
              </label>
            </div>
          </div>

        <!-- SINGLE LARGE PAGE CONTROLS -->
        {:else if activeMode === 'single-page'}
          <div class="flex flex-col gap-3.5">
            <div class="grid gap-1.5">
              <Label class="text-xs font-medium">Continuous Layout Style</Label>
              <div class="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  class="p-2.5 text-xs rounded-md border text-center transition-colors {singleLayout === 'vertical-strip' ? 'bg-primary text-primary-foreground border-primary font-medium' : 'bg-muted/30 border-border hover:bg-muted text-muted-foreground hover:text-foreground'}"
                  onclick={() => { singleLayout = 'vertical-strip'; }}
                >
                  Vertical Roll (Webtoon)
                </button>
                <button
                  type="button"
                  class="p-2.5 text-xs rounded-md border text-center transition-colors {singleLayout === 'horizontal-strip' ? 'bg-primary text-primary-foreground border-primary font-medium' : 'bg-muted/30 border-border hover:bg-muted text-muted-foreground hover:text-foreground'}"
                  onclick={() => { singleLayout = 'horizontal-strip'; }}
                >
                  Horizontal Strip (Panorama)
                </button>
                <button
                  type="button"
                  class="p-2.5 text-xs rounded-md border text-center transition-colors {singleLayout === 'grid' ? 'bg-primary text-primary-foreground border-primary font-medium' : 'bg-muted/30 border-border hover:bg-muted text-muted-foreground hover:text-foreground'}"
                  onclick={() => { singleLayout = 'grid'; }}
                >
                  Single Giant Canvas Grid
                </button>
              </div>
            </div>

            {#if singleLayout === 'grid'}
              <div class="grid gap-1.5">
                <Label class="text-xs">Grid Columns</Label>
                <Input type="number" min="1" max="10" bind:value={singleGridCols} class="h-8 text-xs max-w-[140px]" />
              </div>
            {/if}

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <div class="flex justify-between text-xs">
                  <Label class="text-xs">Inter-Page Spacing</Label>
                  <span class="text-muted-foreground">{singleSpacingPts} pt</span>
                </div>
                <Slider
                  type="single"
                  min={0}
                  max={60}
                  step={1}
                  value={singleSpacingPts}
                  onValueChange={(val: number) => { singleSpacingPts = val; }}
                  class="w-full mt-1.5"
                />
              </div>

              <div class="grid gap-1.5">
                <div class="flex justify-between text-xs">
                  <Label class="text-xs">Outer Margin</Label>
                  <span class="text-muted-foreground">{singleMarginPts} pt</span>
                </div>
                <Slider
                  type="single"
                  min={0}
                  max={60}
                  step={1}
                  value={singleMarginPts}
                  onValueChange={(val: number) => { singleMarginPts = val; }}
                  class="w-full mt-1.5"
                />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <Label class="text-xs">Background Color</Label>
                <div class="flex items-center gap-2">
                  <ColorPicker
                    value={singleBgColor}
                    onValueChange={(val) => { singleBgColor = val; }}
                    label="Background Color"
                  />
                  <Input type="text" bind:value={singleBgColor} class="h-8 text-xs font-sans" />
                </div>
              </div>

              <div class="grid gap-1.5">
                <Label class="text-xs">Page Range</Label>
                <Input
                  type="text"
                  placeholder="All pages (e.g. 1-10)"
                  bind:value={singlePageRange}
                  class="h-8 text-xs"
                />
              </div>
            </div>

            <div class="pt-1">
              <label class="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox bind:checked={singleDrawBorders} />
                <span>Draw Page Borders</span>
              </label>
            </div>
          </div>

        <!-- POSTERIZE / TILE CONTROLS -->
        {:else if activeMode === 'posterize'}
          <div class="flex flex-col gap-3.5">
            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <Label class="text-xs">Target Sheet Size</Label>
                <select
                  bind:value={posterSheetSize}
                  class="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="A4">A4 Sheet</option>
                  <option value="Letter">US Letter Sheet</option>
                  <option value="A3">A3 Sheet</option>
                </select>
              </div>

              <div class="grid gap-1.5">
                <Label class="text-xs">Sheet Orientation</Label>
                <select
                  bind:value={posterOrientation}
                  class="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>
            </div>

            <div class="grid gap-1.5">
              <Label class="text-xs font-medium">Tiling Method</Label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  class="p-2 text-xs rounded border text-center transition-colors {posterModeType === 'scale' ? 'bg-primary text-primary-foreground border-primary font-medium' : 'bg-muted/30 border-border text-muted-foreground'}"
                  onclick={() => { posterModeType = 'scale'; }}
                >
                  Scale Poster ({posterScalePercent}%)
                </button>
                <button
                  type="button"
                  class="p-2 text-xs rounded border text-center transition-colors {posterModeType === 'grid' ? 'bg-primary text-primary-foreground border-primary font-medium' : 'bg-muted/30 border-border text-muted-foreground'}"
                  onclick={() => { posterModeType = 'grid'; }}
                >
                  Fixed Sheet Grid ({posterGridCols}x{posterGridRows})
                </button>
              </div>
            </div>

            {#if posterModeType === 'scale'}
              <div class="grid gap-1.5">
                <div class="flex justify-between text-xs">
                  <Label class="text-xs">Poster Scaling Factor</Label>
                  <span class="font-medium text-foreground">{posterScalePercent}%</span>
                </div>
                <Slider
                  type="single"
                  min={120}
                  max={600}
                  step={20}
                  value={posterScalePercent}
                  onValueChange={(val: number) => { posterScalePercent = val; }}
                  class="w-full mt-1.5"
                />
              </div>
            {:else}
              <div class="grid grid-cols-2 gap-3 p-2.5 rounded-md bg-muted/30 border border-border">
                <div class="grid gap-1">
                  <Label class="text-[11px]">Sheet Columns</Label>
                  <Input type="number" min="1" max="10" bind:value={posterGridCols} class="h-7 text-xs" />
                </div>
                <div class="grid gap-1">
                  <Label class="text-[11px]">Sheet Rows</Label>
                  <Input type="number" min="1" max="10" bind:value={posterGridRows} class="h-7 text-xs" />
                </div>
              </div>
            {/if}

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <div class="flex justify-between text-xs">
                  <Label class="text-xs">Overlap Margin (for taping)</Label>
                  <span class="text-muted-foreground">{posterOverlapPts} pt</span>
                </div>
                <Slider
                  type="single"
                  min={0}
                  max={50}
                  step={1}
                  value={posterOverlapPts}
                  onValueChange={(val: number) => { posterOverlapPts = val; }}
                  class="w-full mt-1.5"
                />
              </div>

              <div class="grid gap-1.5">
                <div class="flex justify-between text-xs">
                  <Label class="text-xs">Sheet Margin</Label>
                  <span class="text-muted-foreground">{posterMarginPts} pt</span>
                </div>
                <Slider
                  type="single"
                  min={0}
                  max={50}
                  step={1}
                  value={posterMarginPts}
                  onValueChange={(val: number) => { posterMarginPts = val; }}
                  class="w-full mt-1.5"
                />
              </div>
            </div>

            <div class="flex flex-wrap gap-4 pt-1">
              <label class="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox bind:checked={posterDrawCutGuides} />
                <span>Draw Alignment & Cut Marks</span>
              </label>

              <label class="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox bind:checked={posterDrawLabels} />
                <span>Print Tile Sheet Coordinates</span>
              </label>
            </div>
          </div>

        <!-- CUT & STACK CONTROLS -->
        {:else if activeMode === 'cut-stack'}
          <div class="flex flex-col gap-3.5">
            <div class="p-3 rounded-lg bg-primary/5 border border-primary/15 text-xs text-muted-foreground">
              <p class="font-medium text-foreground">Cut-and-Stack Imposition</p>
              Arranges pages in stacked blocks across sheets so that when printed and chopped straight through the middle with a guillotine, the physical stacks naturally assemble in sequential order without hand sorting.
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <Label class="text-xs">Stack Layout</Label>
                <select
                  bind:value={cutStackPreset}
                  class="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="2x1">2-Up Cut & Stack (Left/Right Stacks)</option>
                  <option value="2x2">4-Up Cut & Stack (4 Quadrant Stacks)</option>
                </select>
              </div>

              <div class="grid gap-1.5">
                <Label class="text-xs">Sheet Size</Label>
                <select
                  bind:value={cutStackSheetSize}
                  class="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="A4">A4 Sheet</option>
                  <option value="Letter">US Letter</option>
                  <option value="A3">A3 Sheet</option>
                  <option value="source">Match Source Page Size</option>
                </select>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <Label class="text-xs">Orientation</Label>
                <select
                  bind:value={cutStackOrientation}
                  class="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="auto">Auto (Best Fit)</option>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>

              <div class="grid gap-1.5">
                <Label class="text-xs">Page Range</Label>
                <Input
                  type="text"
                  placeholder="All pages"
                  bind:value={cutStackPageRange}
                  class="h-8 text-xs"
                />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <div class="flex justify-between text-xs">
                  <Label class="text-xs">Outer Margin</Label>
                  <span class="text-muted-foreground">{cutStackMarginPts} pt</span>
                </div>
                <Slider
                  type="single"
                  min={0}
                  max={50}
                  step={1}
                  value={cutStackMarginPts}
                  onValueChange={(val: number) => { cutStackMarginPts = val; }}
                  class="w-full mt-1.5"
                />
              </div>

              <div class="grid gap-1.5">
                <div class="flex justify-between text-xs">
                  <Label class="text-xs">Stack Gutter</Label>
                  <span class="text-muted-foreground">{cutStackGutterPts} pt</span>
                </div>
                <Slider
                  type="single"
                  min={0}
                  max={40}
                  step={1}
                  value={cutStackGutterPts}
                  onValueChange={(val: number) => { cutStackGutterPts = val; }}
                  class="w-full mt-1.5"
                />
              </div>
            </div>

            <div class="flex flex-wrap gap-4 pt-1">
              <label class="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox bind:checked={cutStackDrawCutMarks} />
                <span>Draw Chop Cut Lines</span>
              </label>

              <label class="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox bind:checked={cutStackDrawBorders} />
                <span>Draw Page Borders</span>
              </label>
            </div>
          </div>
        {/if}
      </div>

      <!-- Right Column: Interactive Live Sheet Layout Preview -->
      <div class="md:col-span-5 p-6 bg-muted/10 flex flex-col justify-between items-center gap-4 overflow-y-auto">
        <div class="w-full flex items-center justify-between">
          <span class="text-xs font-semibold text-foreground uppercase tracking-wider">Sheet Layout Preview</span>
          <span class="text-[11px] text-muted-foreground font-sans">
            Sheet {previewSheetIndex + 1} of {totalOutputSheets}
          </span>
        </div>

        <!-- SVG Preview Schematic Canvas -->
        <div class="w-full aspect-[4/3] max-w-[280px] bg-background border border-border/80 rounded-lg shadow-inner flex items-center justify-center p-3 relative overflow-hidden">
          {#if previewData}
            {#if previewData.type === 'grid'}
              <div
                class="w-full h-full border border-dashed border-border/70 rounded grid gap-1 p-1.5 bg-muted/20"
                style="grid-template-columns: repeat({previewData.cols}, 1fr); grid-template-rows: repeat({previewData.rows}, 1fr);"
              >
                {#each previewData.cells as cell}
                  <div class="border border-border/80 rounded bg-background flex flex-col items-center justify-center shadow-2xs relative group">
                    {#if cell.pageNumber}
                      <span class="text-xs font-semibold text-primary">p.{cell.pageNumber}</span>
                      <span class="text-[9px] text-muted-foreground">Source</span>
                    {:else}
                      <span class="text-[10px] text-muted-foreground/50 italic">Blank</span>
                    {/if}
                  </div>
                {/each}
              </div>

            {:else if previewData.type === 'booklet'}
              <div class="w-full h-full border border-border/80 rounded flex relative bg-muted/20">
                <!-- Spine center line -->
                <div class="absolute inset-y-0 left-1/2 w-0 border-l border-dashed border-destructive/60 z-10"></div>

                <!-- Left Slot -->
                <div class="w-1/2 h-full p-1.5 border-r border-border flex flex-col items-center justify-center bg-background">
                  {#if previewData.leftPage !== null}
                    {#if previewData.leftPage > 0}
                      <span class="text-xs font-semibold text-primary">p.{previewData.leftPage}</span>
                      <span class="text-[9px] text-muted-foreground">Left Page</span>
                    {:else}
                      <span class="text-[10px] text-muted-foreground/60 italic">Blank</span>
                    {/if}
                  {:else}
                    <span class="text-[10px] text-muted-foreground/40 italic">Empty</span>
                  {/if}
                </div>

                <!-- Right Slot -->
                <div class="w-1/2 h-full p-1.5 flex flex-col items-center justify-center bg-background">
                  {#if previewData.rightPage !== null}
                    {#if previewData.rightPage > 0}
                      <span class="text-xs font-semibold text-primary">p.{previewData.rightPage}</span>
                      <span class="text-[9px] text-muted-foreground">Right Page</span>
                    {:else}
                      <span class="text-[10px] text-muted-foreground/60 italic">Blank</span>
                    {/if}
                  {:else}
                    <span class="text-[10px] text-muted-foreground/40 italic">Empty</span>
                  {/if}
                </div>
              </div>

            {:else if previewData.type === 'single'}
              <div class="w-full h-full border border-border/80 rounded flex flex-col items-center justify-center p-2 bg-muted/20">
                <div class="w-full max-w-[120px] py-3 bg-background border border-border rounded flex flex-col items-center gap-1 shadow-2xs">
                  <Layers class="h-5 w-5 text-primary" />
                  <span class="text-[11px] font-semibold text-foreground">{previewData.pageCount} Pages</span>
                  <span class="text-[9px] text-muted-foreground capitalize">{previewData.layout.replace('-', ' ')}</span>
                </div>
              </div>

            {:else if previewData.type === 'poster'}
              <div class="w-full h-full border border-border/80 rounded flex flex-col items-center justify-center p-2 bg-muted/20 relative">
                <div class="w-3/4 h-3/4 bg-background border-2 border-primary/60 border-dashed rounded flex flex-col items-center justify-center shadow-sm">
                  <span class="text-xs font-semibold text-primary">Tile {previewData.sheetNum}</span>
                  <span class="text-[10px] text-muted-foreground">Row {previewData.currentRow}, Col {previewData.currentCol}</span>
                </div>
              </div>
            {/if}
          {/if}
        </div>

        <!-- Sheet Pagination controls -->
        <div class="w-full flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            class="h-7 px-2 text-xs"
            disabled={previewSheetIndex <= 0}
            onclick={() => { previewSheetIndex = Math.max(0, previewSheetIndex - 1); }}
          >
            <ChevronLeft class="h-3.5 w-3.5 mr-0.5" /> Prev
          </Button>

          <span class="text-[11px] text-muted-foreground">
            {targetPagesCount} source &rarr; {totalOutputSheets} sheet{totalOutputSheets === 1 ? '' : 's'}
          </span>

          <Button
            variant="outline"
            size="sm"
            class="h-7 px-2 text-xs"
            disabled={previewSheetIndex >= totalOutputSheets - 1}
            onclick={() => { previewSheetIndex = Math.min(totalOutputSheets - 1, previewSheetIndex + 1); }}
          >
            Next <ChevronRight class="h-3.5 w-3.5 ml-0.5" />
          </Button>
        </div>
      </div>
    </div>

    <!-- Error message banner if any -->
    {#if errorMessage}
      <div class="px-6 py-2 bg-destructive/10 border-t border-destructive/20 text-xs font-medium text-destructive">
        {errorMessage}
      </div>
    {/if}

    <!-- Footer with Destination Selector & Action Buttons -->
    <div class="px-6 py-3.5 border-t border-border bg-muted/30 flex flex-col sm:flex-row items-center justify-between gap-3">
      <!-- Destination Selector -->
      <div class="flex items-center gap-2 w-full sm:w-auto">
        <Label class="text-xs text-muted-foreground whitespace-nowrap">Output Destination:</Label>
        <select
          bind:value={destination}
          class="flex h-8 rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="workspace">Add to Workspace as New PDF</option>
          <option value="replace">Replace Active Document</option>
          <option value="download">Download PDF File Directly</option>
        </select>
      </div>

      <!-- Action Buttons -->
      <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
        <Button variant="outline" size="sm" class="h-8 text-xs" onclick={onClose} disabled={isProcessing}>
          Cancel
        </Button>

        <Button size="sm" class="h-8 text-xs min-w-[130px]" onclick={handleApply} disabled={isProcessing || !store.isDocumentLoaded}>
          {#if isProcessing}
            <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" /> Imposing...
          {:else if destination === 'download'}
            <Download class="h-3.5 w-3.5 mr-1.5" /> Download Imposed
          {:else if destination === 'replace'}
            <RefreshCw class="h-3.5 w-3.5 mr-1.5" /> Replace Document
          {:else}
            <FilePlus class="h-3.5 w-3.5 mr-1.5" /> Create Imposed PDF
          {/if}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
