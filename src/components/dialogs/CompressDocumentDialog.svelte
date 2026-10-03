<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import type {
    CompressionLevel,
    CompressOptions,
    CompressSummary,
    CompressionInspection,
  } from '../../core/types';
  import {
    FileDown,
    Sparkles,
    SlidersHorizontal,
    CheckCircle2,
    Loader2,
    RefreshCw,
    Download,
    PlusCircle,
    Layers,
    Image as ImageIcon,
    FileText,
    ShieldAlert,
    Zap,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

  let activePreset = $state<CompressionLevel>(store.compressInitialPreset || 'recommended');
  let isProcessing = $state(false);
  let isInspecting = $state(true);
  let inspection = $state<CompressionInspection | null>(null);
  let summary = $state<CompressSummary | null>(null);
  let errorMessage = $state<string | null>(null);

  // Custom compression settings
  let customQuality = $state(75);
  let customMaxDpi = $state<number>(150);
  let customUseObjectStreams = $state(true);
  let customRemoveThumbnails = $state(true);
  let customRemoveMetadata = $state(true);
  let customRemovePieceInfo = $state(true);
  let customRemoveAnnotations = $state(false);

  function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, idx);
    return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  }

  function getEffectiveOptions(): CompressOptions {
    if (activePreset === 'custom') {
      return {
        level: 'custom',
        imageQuality: customQuality / 100,
        maxDpi: customMaxDpi > 0 ? customMaxDpi : undefined,
        useObjectStreams: customUseObjectStreams,
        removeThumbnails: customRemoveThumbnails,
        removeMetadata: customRemoveMetadata,
        removePieceInfo: customRemovePieceInfo,
        removeAnnotations: customRemoveAnnotations,
      };
    }
    return { level: activePreset };
  }

  async function runInspection(): Promise<void> {
    isInspecting = true;
    errorMessage = null;
    try {
      inspection = await actions.inspectDocumentForCompression();
    } catch (err) {
      console.warn('Failed to inspect document for compression:', err);
      errorMessage = err instanceof Error ? err.message : 'Failed to inspect document for compression.';
    } finally {
      isInspecting = false;
    }
  }

  $effect(() => {
    if (store.showCompressDialog) {
      untrack(() => {
        if (store.compressInitialPreset) {
          activePreset = store.compressInitialPreset;
        }
        if (store.isDocumentLoaded) {
          summary = null;
          void runInspection();
        }
      });
    }
  });

  function handleClose(): void {
    actions.closeCompressDialog();
    summary = null;
    errorMessage = null;
    isProcessing = false;
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      handleClose();
    }
  }

  async function handleCompressInPlace(): Promise<void> {
    isProcessing = true;
    errorMessage = null;
    try {
      const result = await actions.compressCurrentDocument(getEffectiveOptions());
      summary = result;
      try {
        inspection = await actions.inspectDocumentForCompression();
      } catch {
        // Non-fatal if re-inspection fails after successful compression
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Compression failed.';
    } finally {
      isProcessing = false;
    }
  }

  async function handleCompressAndDownload(): Promise<void> {
    isProcessing = true;
    errorMessage = null;
    try {
      const result = await actions.compressAndDownload(getEffectiveOptions());
      summary = result;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Compression download failed.';
    } finally {
      isProcessing = false;
    }
  }

  async function handleCompressAsCopy(): Promise<void> {
    isProcessing = true;
    errorMessage = null;
    try {
      const result = await actions.compressAsNewWorkspaceFile(getEffectiveOptions());
      summary = result;
      handleClose();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Save as copy failed.';
    } finally {
      isProcessing = false;
    }
  }
</script>

<Dialog.Root open={store.showCompressDialog} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[580px] max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden font-sans">
      <!-- Header -->
      <Dialog.Header class="p-4 pb-3 border-b bg-card">
        <div class="flex items-center gap-2">
          <div class="p-1.5 rounded-md bg-primary/10 text-primary">
            <FileDown class="h-4 w-4" />
          </div>
          <div>
            <Dialog.Title class="text-sm font-semibold">Compress PDF</Dialog.Title>
            <Dialog.Description class="text-xs text-muted-foreground">
              Reduce file size with lossless structural packing, balanced lossy, or full-page flat rasterization.
            </Dialog.Description>
          </div>
        </div>
      </Dialog.Header>

      <!-- Main Body -->
      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4 text-xs">
        <!-- Live Inspection Stats Card -->
        <div class="rounded-lg border bg-muted/30 p-3 flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="font-medium text-foreground flex items-center gap-1.5">
              <Sparkles class="h-3.5 w-3.5 text-primary" />
              Document Analysis
            </span>
            {#if isInspecting}
              <span class="text-[11px] text-muted-foreground flex items-center gap-1">
                <Loader2 class="h-3 w-3 animate-spin" /> Analyzing PDF...
              </span>
            {:else if inspection}
              <Badge variant="outline" class="font-sans font-medium text-[11px]">
                {formatBytes(inspection.originalSizeBytes)} &bull; {inspection.pageCount} page{inspection.pageCount !== 1 ? 's' : ''}
              </Badge>
            {/if}
          </div>

          {#if inspection}
            <div class="grid grid-cols-3 gap-2 pt-1 border-t border-border/50 text-[11px]">
              <div class="flex items-center gap-1.5 text-muted-foreground">
                <ImageIcon class="h-3.5 w-3.5 text-info" />
                <span>{inspection.imageCount} image{inspection.imageCount !== 1 ? 's' : ''} ({formatBytes(inspection.totalImageBytes)})</span>
              </div>
              <div class="flex items-center gap-1.5 text-muted-foreground">
                <Layers class="h-3.5 w-3.5 text-warning" />
                <span>{inspection.thumbnailCount} thumbnail{inspection.thumbnailCount !== 1 ? 's' : ''}</span>
              </div>
              <div class="flex items-center gap-1.5 text-muted-foreground">
                <FileText class="h-3.5 w-3.5 text-success" />
                <span>{inspection.hasPieceInfo ? 'App Cache Present' : 'Clean App Cache'}</span>
              </div>
            </div>
          {/if}
        </div>

        <!-- Presets Grid -->
        <div class="flex flex-col gap-1.5">
          <Label class="text-xs font-semibold text-foreground">Compression Level</Label>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <!-- Recommended -->
            <button
              type="button"
              class="flex flex-col items-start p-2.5 rounded-lg border text-left transition-colors relative {activePreset === 'recommended' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:bg-muted/50'}"
              onclick={() => { activePreset = 'recommended'; }}
            >
              <div class="flex items-center justify-between w-full mb-1">
                <span class="font-medium text-xs text-foreground flex items-center gap-1">
                  <Zap class="h-3 w-3 text-warning" /> Balanced
                </span>
                <Badge variant="secondary" class="text-[9px] px-1 py-0 h-4">Best</Badge>
              </div>
              <p class="text-[11px] text-muted-foreground leading-snug">
                150 DPI JPEG, keeps text & vectors sharp.
              </p>
            </button>

            <!-- Lossless -->
            <button
              type="button"
              class="flex flex-col items-start p-2.5 rounded-lg border text-left transition-colors relative {activePreset === 'lossless' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:bg-muted/50'}"
              onclick={() => { activePreset = 'lossless'; }}
            >
              <div class="flex items-center justify-between w-full mb-1">
                <span class="font-medium text-xs text-foreground flex items-center gap-1">
                  <ShieldAlert class="h-3 w-3 text-success" /> Lossless
                </span>
              </div>
              <p class="text-[11px] text-muted-foreground leading-snug">
                100% visual fidelity, object streams packing.
              </p>
            </button>

            <!-- Strong -->
            <button
              type="button"
              class="flex flex-col items-start p-2.5 rounded-lg border text-left transition-colors relative {activePreset === 'strong' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:bg-muted/50'}"
              onclick={() => { activePreset = 'strong'; }}
            >
              <div class="flex items-center justify-between w-full mb-1">
                <span class="font-medium text-xs text-foreground flex items-center gap-1">
                  <FileDown class="h-3 w-3 text-info" /> Strong
                </span>
              </div>
              <p class="text-[11px] text-muted-foreground leading-snug">
                96 DPI, 50% JPEG, smallest structured size.
              </p>
            </button>

            <!-- Flat Image -->
            <button
              type="button"
              class="flex flex-col items-start p-2.5 rounded-lg border text-left transition-colors relative {activePreset === 'flat_image' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:bg-muted/50'}"
              onclick={() => { activePreset = 'flat_image'; }}
            >
              <div class="flex items-center justify-between w-full mb-1">
                <span class="font-medium text-xs text-foreground flex items-center gap-1">
                  <Layers class="h-3 w-3 text-primary" /> Flat Image
                </span>
              </div>
              <p class="text-[11px] text-muted-foreground leading-snug">
                Full page rasterization, removes vector bloat.
              </p>
            </button>
          </div>
        </div>

        <!-- Custom Mode Accordion / Panel -->
        <div class="border rounded-lg p-3 bg-card flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <button
              type="button"
              class="font-medium text-xs text-foreground flex items-center gap-1.5 hover:text-primary transition-colors text-left"
              onclick={() => { activePreset = 'custom'; }}
            >
              <SlidersHorizontal class="h-3.5 w-3.5 text-muted-foreground" />
              <span>Advanced Parameters {activePreset === 'custom' ? '(Active)' : ''}</span>
            </button>
            {#if activePreset === 'custom'}
              <Badge variant="default" class="text-[10px] px-1.5 py-0 h-4">Custom Active</Badge>
            {/if}
          </div>

          <div class="flex flex-col gap-3 pt-1 border-t border-border/50">
            <!-- JPEG Quality Slider -->
            <div class="flex flex-col gap-1.5">
              <div class="flex justify-between items-center text-[11px]">
                <span class="text-muted-foreground">JPEG Quality</span>
                <span class="font-sans font-medium text-foreground">{customQuality}%</span>
              </div>
              <Slider
                type="single"
                value={customQuality}
                min={10}
                max={100}
                step={5}
                onValueChange={(val) => {
                  customQuality = Array.isArray(val) ? val[0] : val;
                  activePreset = 'custom';
                }}
              />
            </div>

            <!-- Max DPI Selection -->
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-muted-foreground">Max Image Resolution</span>
              <ButtonGroup variant="outline" size="xs">
                {#each [72, 96, 150, 200, 300] as dpi}
                  <Button
                    variant={customMaxDpi === dpi ? 'default' : 'outline'}
                    size="xs"
                    class="h-6 px-2 text-[10px]"
                    onclick={() => { customMaxDpi = dpi; activePreset = 'custom'; }}
                  >
                    {dpi} DPI
                  </Button>
                {/each}
              </ButtonGroup>
            </div>

            <!-- Fine-Tuning Toggles -->
            <div class="grid grid-cols-2 gap-2 text-[11px] pt-1">
              <label class="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={customUseObjectStreams}
                  onCheckedChange={(checked) => {
                    customUseObjectStreams = checked;
                    activePreset = 'custom';
                  }}
                />
                <span class="text-muted-foreground">Object Streams Packing</span>
              </label>

              <label class="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={customRemoveThumbnails}
                  onCheckedChange={(checked) => {
                    customRemoveThumbnails = checked;
                    activePreset = 'custom';
                  }}
                />
                <span class="text-muted-foreground">Strip Embedded Thumbnails</span>
              </label>

              <label class="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={customRemoveMetadata}
                  onCheckedChange={(checked) => {
                    customRemoveMetadata = checked;
                    activePreset = 'custom';
                  }}
                />
                <span class="text-muted-foreground">Strip XMP & DocInfo</span>
              </label>

              <label class="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={customRemovePieceInfo}
                  onCheckedChange={(checked) => {
                    customRemovePieceInfo = checked;
                    activePreset = 'custom';
                  }}
                />
                <span class="text-muted-foreground">Strip App Cache (PieceInfo)</span>
              </label>
            </div>
          </div>
        </div>

        <!-- Success Summary Badge Card -->
        {#if summary}
          <div class="rounded-lg border border-success/30 bg-success/10 p-3 flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="font-medium text-success flex items-center gap-1.5">
                <CheckCircle2 class="h-4 w-4" />
                Compression Complete
              </span>
              <Badge variant="success" class="font-sans text-xs">
                -{summary.savingsPercentage}%
              </Badge>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-muted-foreground pt-1 border-t border-success/20 font-sans">
              <div>Original: <strong class="text-foreground">{formatBytes(summary.originalSizeBytes)}</strong></div>
              <div>Compressed: <strong class="text-foreground">{formatBytes(summary.compressedSizeBytes)}</strong></div>
              <div>Saved: <strong class="text-foreground">{formatBytes(summary.savingsBytes)}</strong></div>
              <div>Recompressed: <strong class="text-foreground">{summary.imagesCompressed} imgs</strong></div>
            </div>
          </div>
        {/if}

        <!-- Error Message -->
        {#if errorMessage}
          <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive text-xs">
            {errorMessage}
          </div>
        {/if}
      </div>

      <!-- Footer Actions -->
      <Dialog.Footer class="p-4 pt-3 border-t bg-card flex items-center justify-between sm:justify-between w-full">
        <Button variant="ghost" size="sm" onclick={handleClose} disabled={isProcessing}>
          Close
        </Button>

        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="text-xs"
            onclick={handleCompressAsCopy}
            disabled={isProcessing || !store.isDocumentLoaded}
          >
            {#if isProcessing}
              <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" />
            {:else}
              <PlusCircle class="h-3.5 w-3.5 mr-1.5" />
            {/if}
            Add to Workspace
          </Button>

          <Button
            variant="outline"
            size="sm"
            class="text-xs"
            onclick={handleCompressInPlace}
            disabled={isProcessing || !store.isDocumentLoaded}
          >
            {#if isProcessing}
              <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" />
            {:else}
              <RefreshCw class="h-3.5 w-3.5 mr-1.5" />
            {/if}
            Replace Active
          </Button>

          <Button
            variant="default"
            size="sm"
            class="text-xs font-medium"
            onclick={handleCompressAndDownload}
            disabled={isProcessing || !store.isDocumentLoaded}
          >
            {#if isProcessing}
              <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Compressing...
            {:else}
              <Download class="h-3.5 w-3.5 mr-1.5" />
              Download
            {/if}
          </Button>
        </div>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
