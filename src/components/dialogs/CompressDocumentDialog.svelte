<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { ControlRow } from '$lib/components/ui/control-row/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import type {
    CompressionLevel,
    CompressOptions,
    CompressSummary,
    CompressionInspection,
  } from '../../core/types';
  import {
    estimatePdfCompression,
    estimateAllPresets,
  } from '../../services/pdf/operations/compress-estimate';
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

  function resolveFeatureFlags() {
    try {
      return useFeatureFlagStore();
    } catch {
      return null;
    }
  }

  const featureFlags = resolveFeatureFlags();
  const canShowEstimate = $derived(
    !featureFlags || featureFlags.isEnabled('compression.estimate')
  );

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

  const currentEstimate = $derived(
    inspection && canShowEstimate ? estimatePdfCompression(inspection, getEffectiveOptions()) : null
  );
  const presetEstimates = $derived(
    inspection && canShowEstimate ? estimateAllPresets(inspection) : null
  );

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
  <Dialog.Content class="sm:max-w-[580px] font-sans">
    <!-- Header -->
    <Dialog.Header class="pr-12">
      <Dialog.Title>
        <FileDown class="h-4 w-4" />
        Compress PDF
      </Dialog.Title>
      <Dialog.Description>
        Reduce file size with lossless structural packing, balanced lossy, or full-page flat rasterisation.
      </Dialog.Description>
    </Dialog.Header>

    <!-- Main Body -->
    <div class="dialog-body">
      <!-- Live Inspection Stats Card -->
      <div class="dialog-card">
        <div class="flex items-center justify-between">
          <span class="font-medium text-foreground flex items-center gap-1.5">
            <Sparkles class="h-3.5 w-3.5" />
            Document Analysis
          </span>
          {#if isInspecting}
            <span class="text-[11px] text-muted-foreground flex items-center gap-1">
              <Loader2 class="h-3 w-3 animate-spin" /> Analysing PDF...
            </span>
          {:else if inspection}
            <Badge variant="outline" class="font-sans font-medium text-[11px]">
              {formatBytes(inspection.originalSizeBytes)} &bull; {inspection.pageCount} page{inspection.pageCount !== 1 ? 's' : ''}
            </Badge>
          {/if}
        </div>

        {#if inspection}
          <div class="grid grid-cols-3 gap-2 pt-1.5 border-t border-border/50 text-[11px]">
            <div class="flex items-center gap-1.5 text-muted-foreground">
              <ImageIcon class="h-3.5 w-3.5 text-info" />
              <span><span>{inspection.imageCount}</span> image{inspection.imageCount !== 1 ? 's' : ''} (<span>{formatBytes(inspection.totalImageBytes)}</span>)</span>
            </div>
            <div class="flex items-center gap-1.5 text-muted-foreground">
              <Layers class="h-3.5 w-3.5 text-warning" />
              <span><span>{inspection.thumbnailCount}</span> thumbnail{inspection.thumbnailCount !== 1 ? 's' : ''}</span>
            </div>
            <div class="flex items-center gap-1.5 text-muted-foreground">
              <FileText class="h-3.5 w-3.5" />
              <span>{inspection.hasPieceInfo ? 'App Cache Present' : 'Clean App Cache'}</span>
            </div>
          </div>
        {/if}
      </div>

      <!-- Presets Grid -->
      <div class="field-group">
        <Label class="field-label">Compression Level</Label>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <!-- Recommended -->
          <button
            type="button"
            class="flex flex-col items-start p-2.5 rounded-[var(--radius-card)] border text-left transition-colors relative {activePreset === 'recommended' ? 'border-foreground/40 bg-card ring-1 ring-ring' : 'border-border bg-card hover:bg-muted/50'}"
            onclick={() => { activePreset = 'recommended'; }}
          >
            <div class="flex items-center justify-between w-full mb-1">
              <span class="font-medium text-xs text-foreground flex items-center gap-1">
                <Zap class="h-3 w-3 text-warning" /> Balanced
              </span>
              <Badge variant="secondary" class="text-[9px] px-1 py-0 h-4">Best</Badge>
            </div>
            <p class="text-[11px] text-muted-foreground leading-snug">
              150 DPI JPEG, keeps text &amp; vectors sharp.
            </p>
            {#if presetEstimates?.recommended}
              <div class="mt-1.5 text-[10px] text-muted-foreground">
                ~{formatBytes(presetEstimates.recommended.estimatedSizeBytes)} (-{presetEstimates.recommended.estimatedSavingsPercentage}%)
              </div>
            {/if}
          </button>

          <!-- Lossless -->
          <button
            type="button"
            class="flex flex-col items-start p-2.5 rounded-[var(--radius-card)] border text-left transition-colors relative {activePreset === 'lossless' ? 'border-foreground/40 bg-card ring-1 ring-ring' : 'border-border bg-card hover:bg-muted/50'}"
            onclick={() => { activePreset = 'lossless'; }}
          >
            <div class="flex items-center justify-between w-full mb-1">
              <span class="font-medium text-xs text-foreground flex items-center gap-1">
                <ShieldAlert class="h-3 w-3" /> Lossless
              </span>
            </div>
            <p class="text-[11px] text-muted-foreground leading-snug">
              100% visual fidelity, object streams packing.
            </p>
            {#if presetEstimates?.lossless}
              <div class="mt-1.5 text-[10px] text-muted-foreground">
                ~{formatBytes(presetEstimates.lossless.estimatedSizeBytes)} (-{presetEstimates.lossless.estimatedSavingsPercentage}%)
              </div>
            {/if}
          </button>

          <!-- Strong -->
          <button
            type="button"
            class="flex flex-col items-start p-2.5 rounded-[var(--radius-card)] border text-left transition-colors relative {activePreset === 'strong' ? 'border-foreground/40 bg-card ring-1 ring-ring' : 'border-border bg-card hover:bg-muted/50'}"
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
            {#if presetEstimates?.strong}
              <div class="mt-1.5 text-[10px] text-muted-foreground">
                ~{formatBytes(presetEstimates.strong.estimatedSizeBytes)} (-{presetEstimates.strong.estimatedSavingsPercentage}%)
              </div>
            {/if}
          </button>

          <!-- Flat Image -->
          <button
            type="button"
            class="flex flex-col items-start p-2.5 rounded-[var(--radius-card)] border text-left transition-colors relative {activePreset === 'flat_image' ? 'border-foreground/40 bg-card ring-1 ring-ring' : 'border-border bg-card hover:bg-muted/50'}"
            onclick={() => { activePreset = 'flat_image'; }}
          >
            <div class="flex items-center justify-between w-full mb-1">
              <span class="font-medium text-xs text-foreground flex items-center gap-1">
                <Layers class="h-3 w-3 text-muted-foreground" /> Flat Image
              </span>
            </div>
            <p class="text-[11px] text-muted-foreground leading-snug">
              Full page rasterisation, removes vector bloat.
            </p>
            {#if presetEstimates?.flat_image}
              <div class="mt-1.5 text-[10px] text-muted-foreground">
                ~{formatBytes(presetEstimates.flat_image.estimatedSizeBytes)} (-{presetEstimates.flat_image.estimatedSavingsPercentage}%)
              </div>
            {/if}
          </button>
        </div>
      </div>

      <!-- Custom Mode Accordion / Panel -->
      <div class="dialog-card">
        <div class="flex items-center justify-between">
          <button
            type="button"
            class="font-medium text-xs text-foreground flex items-center gap-1.5 hover:text-foreground transition-colors text-left"
            onclick={() => { activePreset = 'custom'; }}
          >
            <SlidersHorizontal class="h-3.5 w-3.5 text-muted-foreground" />
            <span>Advanced Parameters {activePreset === 'custom' ? '(Active)' : ''}</span>
          </button>
          {#if activePreset === 'custom'}
            <Badge variant="secondary" class="text-[10px] px-1.5 py-0 h-4">Custom Active</Badge>
          {/if}
        </div>

        <div class="flex flex-col gap-3 pt-2 border-t border-border/50">
          <!-- JPEG Quality Slider -->
          <div class="field-group">
            <Label class="field-label">JPEG Quality</Label>
            <Slider
              type="single"
              value={customQuality}
              min={10}
              max={100}
              step={5}
              unit="%"
              onValueChange={(val) => {
                customQuality = Array.isArray(val) ? val[0] : val;
                activePreset = 'custom';
              }}
            />
          </div>

          <!-- Max DPI Selection -->
          <div class="field-group">
            <Label class="field-label">Max Image Resolution</Label>
            <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
              {#each [72, 96, 150, 200, 300] as dpi}
                <Button
                  type="button"
                  variant={customMaxDpi === dpi ? 'secondary' : 'outline'}
                  class="flex-1 text-xs"
                  onclick={() => { customMaxDpi = dpi; activePreset = 'custom'; }}
                >
                  {dpi} DPI
                </Button>
              {/each}
            </ButtonGroup>
          </div>

          <!-- Fine-Tuning Toggles -->
          <div class="grid grid-cols-2 gap-1.5 pt-0.5">
            <ControlRow label="Object Streams Packing" variant="card" size="compact">
              <Switch
                checked={customUseObjectStreams}
                onCheckedChange={(checked) => {
                  customUseObjectStreams = checked;
                  activePreset = 'custom';
                }}
                aria-label="Object Streams Packing"
              />
            </ControlRow>

            <ControlRow label="Strip Thumbnails" variant="card" size="compact">
              <Switch
                checked={customRemoveThumbnails}
                onCheckedChange={(checked) => {
                  customRemoveThumbnails = checked;
                  activePreset = 'custom';
                }}
                aria-label="Strip Embedded Thumbnails"
              />
            </ControlRow>

            <ControlRow label="Strip XMP &amp; DocInfo" variant="card" size="compact">
              <Switch
                checked={customRemoveMetadata}
                onCheckedChange={(checked) => {
                  customRemoveMetadata = checked;
                  activePreset = 'custom';
                }}
                aria-label="Strip XMP and DocInfo"
              />
            </ControlRow>

            <ControlRow label="Strip App Cache" variant="card" size="compact">
              <Switch
                checked={customRemovePieceInfo}
                onCheckedChange={(checked) => {
                  customRemovePieceInfo = checked;
                  activePreset = 'custom';
                }}
                aria-label="Strip App Cache (PieceInfo)"
              />
            </ControlRow>
          </div>
        </div>
      </div>

      <!-- Estimated Result Preview Card -->
      {#if canShowEstimate && currentEstimate && inspection && !summary}
        <div class="dialog-card">
          <div class="flex items-center justify-between">
            <span class="font-medium text-foreground flex items-center gap-1.5">
              <Zap class="h-3.5 w-3.5 text-muted-foreground" />
              Estimated Result
            </span>
            <Badge variant="secondary" class="font-sans text-xs">
              ~{formatBytes(currentEstimate.estimatedSizeBytes)}
              <span class="text-muted-foreground ml-1">(-{currentEstimate.estimatedSavingsPercentage}%)</span>
            </Badge>
          </div>

          <div class="grid grid-cols-3 gap-2 pt-1.5 border-t border-border/50 text-[11px] text-muted-foreground font-sans">
            <div>Current: <strong class="text-foreground">{formatBytes(inspection.originalSizeBytes)}</strong></div>
            <div>Estimated: <strong class="text-foreground">~{formatBytes(currentEstimate.estimatedSizeBytes)}</strong></div>
            <div>Savings: <strong class="text-foreground">~{formatBytes(currentEstimate.estimatedSavingsBytes)}</strong></div>
          </div>

          {#if currentEstimate.isMonotonicallyClamped && currentEstimate.estimatedSavingsBytes === 0}
            <p class="text-[11px] text-muted-foreground leading-snug">
              Document is already optimised. Monotonic safeguard preserves original size.
            </p>
          {:else if activePreset === 'lossless'}
            <p class="text-[11px] text-muted-foreground leading-snug">
              Lossless packing with object streams. Preserves 100% visual fidelity and font definitions.
            </p>
          {:else if activePreset === 'recommended'}
            <p class="text-[11px] text-muted-foreground leading-snug">
              Balanced 150 DPI JPEG downsampling. Text, vector drawings, and fonts remain sharp.
            </p>
          {:else if activePreset === 'strong'}
            <p class="text-[11px] text-muted-foreground leading-snug">
              Aggressive 96 DPI JPEG downsampling for compact email distribution and fast transfer.
            </p>
          {:else if activePreset === 'flat_image'}
            <p class="text-[11px] text-muted-foreground leading-snug">
              Full page rasterisation into JPEG images, discarding vector layers and embedded font bloat.
            </p>
          {:else}
            <p class="text-[11px] text-muted-foreground leading-snug">
              Custom parameters applied with selective stream packing and resolution limits.
            </p>
          {/if}
        </div>
      {/if}

      <!-- Success Summary Badge Card -->
      {#if summary}
        <div role="status" class="dialog-card">
          <div class="flex items-center justify-between">
            <span class="font-medium text-foreground flex items-center gap-1.5">
              <CheckCircle2 class="h-4 w-4" />
              Compression Complete
            </span>
            <Badge variant="secondary" class="font-sans text-xs">
              -{summary.savingsPercentage}%
            </Badge>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-muted-foreground pt-1.5 border-t border-border font-sans">
            <div>Original: <strong class="text-foreground">{formatBytes(summary.originalSizeBytes)}</strong></div>
            <div>Compressed: <strong class="text-foreground">{formatBytes(summary.compressedSizeBytes)}</strong></div>
            <div>Saved: <strong class="text-foreground">{formatBytes(summary.savingsBytes)}</strong></div>
            <div>Recompressed: <strong class="text-foreground">{summary.imagesCompressed} imgs</strong></div>
          </div>
        </div>
      {/if}

      <!-- Error Message -->
      {#if errorMessage}
        <div role="alert" class="dialog-error">
          {errorMessage}
        </div>
      {/if}
    </div>

    <!-- Footer Actions -->
    <Dialog.Footer class="justify-between">
      <Button variant="outline" size="sm" class="h-8 text-xs" onclick={handleClose} disabled={isProcessing}>
        Close
      </Button>

      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          class="h-8 text-xs"
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
          class="h-8 text-xs"
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
          variant="secondary"
          size="sm"
          class="h-8 text-xs font-medium"
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
