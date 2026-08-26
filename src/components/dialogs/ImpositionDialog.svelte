<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
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
  import { parsePageRange } from '../../services/pdf/operations/imposition-ops';

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

  // -- Preview sheet navigation --
  let previewSheetIndex = $state(0);

  // -- N-Up state --
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

  // -- Booklet state --
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

  // -- Single Page state --
  let singleLayout = $state<SinglePageLayout>('vertical-strip');
  let singleGridCols = $state(3);
  let singleSpacingPts = $state(14);
  let singleMarginPts = $state(20);
  let singleDrawBorders = $state(true);
  let singleBgColor = $state('#ffffff');
  let singlePageRange = $state('');

  // -- Posterize state --
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

  // -- Cut & Stack state --
  let cutStackPreset = $state<'2x1' | '2x2'>('2x1');
  let cutStackSheetSize = $state<StandardSheetSize>('A4');
  let cutStackOrientation = $state<SheetOrientation>('auto');
  let cutStackMarginPts = $state(18);
  let cutStackGutterPts = $state(10);
  let cutStackDrawCutMarks = $state(true);
  let cutStackDrawBorders = $state(false);
  let cutStackPageRange = $state('');

  $effect(() => {
    activeMode = initialMode;
    previewSheetIndex = 0;
    errorMessage = '';
    posterPageIndex = store.currentPageIndex;
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
        <Badge variant="outline" class="text-[11px] font-mono font-medium px-2 py-0.5 border-primary/30 text-primary">
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
                ] as preset}
                  <button
                    type="button"
                    class="px-2 py-1.5 text-xs rounded border text-center transition-colors {nupPreset === preset.id ? 'bg-primary text-primary-foreground border-primary font-medium' : 'bg-muted/30 border-border hover:bg-muted text-muted-foreground hover:text-foreground'}"
                    onclick={() => { nupPreset = preset.id as any; previewSheetIndex = 0; }}
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

