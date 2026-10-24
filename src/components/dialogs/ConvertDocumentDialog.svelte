<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { ControlRow } from '$lib/components/ui/control-row/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import type {
    DocumentConversionOptions,
    DocumentFormat,
    PageSizePreset,
    PageOrientation,
  } from '../../services/conversion';
  import { isConvertibleDocumentFile, detectDocumentFormat } from '../../utils/file-type-utils';
  import {
    FileText,
    FileSpreadsheet,
    Presentation,
    FileCode,
    Upload,
    Download,
    CheckCircle2,
    Loader2,
    SlidersHorizontal,
    AlertCircle,
    PlusCircle,
    Layers,
    Table,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  let selectedFile = $state<File | null>(null);
  let isConverting = $state(false);
  let isDraggingFile = $state(false);
  let conversionError = $state<string | null>(null);

  // Conversion options
  let pageSize = $state<PageSizePreset>('a4');
  let orientation = $state<PageOrientation>('portrait');
  let marginPreset = $state<'normal' | 'compact' | 'wide' | 'none'>('normal');
  let fontFamily = $state<'helvetica' | 'times' | 'courier'>('helvetica');
  let fontSize = $state(10.5);
  let includePageNumbers = $state(false);
  let includeGridlines = $state(true);
  let alternateRowShading = $state(true);

  // Derived detected format
  const detectedFormat = $derived.by<DocumentFormat>(() => {
    if (!selectedFile) return 'unknown';
    return detectDocumentFormat(selectedFile.name, selectedFile.type);
  });

  const isSpreadsheet = $derived(
    detectedFormat === 'xlsx' || detectedFormat === 'xls' || detectedFormat === 'csv' || detectedFormat === 'tsv'
  );
  const isPresentation = $derived(detectedFormat === 'pptx');
  const isTextOrCode = $derived(
    detectedFormat === 'markdown' || detectedFormat === 'text' || detectedFormat === 'code' || detectedFormat === 'json'
  );

  $effect(() => {
    if (store.showConvertDialog && store.convertInitialFile) {
      untrack(() => {
        selectedFile = store.convertInitialFile;
        conversionError = null;
      });
    }
  });

  function getFormatBadgeInfo(fmt: DocumentFormat): { label: string; color: string } {
    switch (fmt) {
      case 'docx':
        return { label: 'Word Document (DOCX)', color: 'bg-card text-foreground border-border' };
      case 'xlsx':
      case 'xls':
        return { label: 'Excel Workbook (XLSX)', color: 'bg-card text-foreground border-border' };
      case 'csv':
        return { label: 'Delimited Data (CSV)', color: 'bg-card text-foreground border-border' };
      case 'tsv':
        return { label: 'Tab Separated (TSV)', color: 'bg-card text-foreground border-border' };
      case 'pptx':
        return { label: 'PowerPoint Presentation (PPTX)', color: 'bg-card text-foreground border-border' };
      case 'markdown':
        return { label: 'Markdown Document (MD)', color: 'bg-card text-foreground border-border' };
      case 'text':
        return { label: 'Plain Text (TXT)', color: 'bg-card text-muted-foreground border-border' };
      case 'code':
      case 'json':
        return { label: 'Code / Data', color: 'bg-card text-foreground border-border' };
      default:
        return { label: 'Supported Document', color: 'bg-card text-foreground border-border' };
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, idx);
    return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  }

  function getMargins() {
    switch (marginPreset) {
      case 'compact':
        return { top: 28, right: 28, bottom: 28, left: 28 };
      case 'wide':
        return { top: 72, right: 72, bottom: 72, left: 72 };
      case 'none':
        return { top: 18, right: 18, bottom: 18, left: 18 };
      case 'normal':
      default:
        return { top: 36, right: 36, bottom: 36, left: 36 };
    }
  }

  function getEffectiveOptions(): DocumentConversionOptions {
    return {
      pageSize,
      orientation,
      margins: getMargins(),
      fontFamily,
      fontSize,
      includePageNumbers,
      includeGridlines,
      alternateRowShading,
      autoColumnWidths: true,
      smartNumericAlignment: true,
    };
  }

  function handleFileDrop(e: DragEvent): void {
    e.preventDefault();
    isDraggingFile = false;
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (isConvertibleDocumentFile(file, file.name)) {
        selectedFile = file;
        conversionError = null;
      } else {
        conversionError = `File "${file.name}" is not a recognized convertible document format.`;
      }
    }
  }

  function handleFileInputChange(e: Event): void {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const file = target.files[0];
      selectedFile = file;
      conversionError = null;
    }
    target.value = '';
  }

  async function handleConvertAndOpen(): Promise<void> {
    if (!selectedFile) return;
    isConverting = true;
    conversionError = null;

    try {
      await actions.convertAndLoadDocument(selectedFile, getEffectiveOptions());
      store.closeConvertDialog();
    } catch (err) {
      conversionError = err instanceof Error ? err.message : 'Conversion failed.';
    } finally {
      isConverting = false;
    }
  }

  async function handleConvertAndDownload(): Promise<void> {
    if (!selectedFile) return;
    isConverting = true;
    conversionError = null;

    try {
      const { documentConverter } = await import('../../services/conversion');
      const buffer = await selectedFile.arrayBuffer();
      const result = await documentConverter.convertDocument(
        { name: selectedFile.name, buffer, mimeType: selectedFile.type },
        getEffectiveOptions()
      );

      const blob = new Blob([result.buffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      store.closeConvertDialog();
    } catch (err) {
      conversionError = err instanceof Error ? err.message : 'Conversion failed.';
    } finally {
      isConverting = false;
    }
  }

  async function handleAddToWorkspace(): Promise<void> {
    if (!selectedFile) return;
    isConverting = true;
    conversionError = null;

    try {
      await actions.convertAndLoadDocument(selectedFile, getEffectiveOptions(), true);
      store.closeConvertDialog();
    } catch (err) {
      conversionError = err instanceof Error ? err.message : 'Adding file failed.';
    } finally {
      isConverting = false;
    }
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      store.closeConvertDialog();
      selectedFile = null;
      conversionError = null;
    } else {
      store.showConvertDialog = true;
    }
  }
</script>

<Dialog.Root open={store.showConvertDialog} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[540px]">
    <!-- Header -->
    <Dialog.Header class="pr-12">
      <Dialog.Title>
        <Layers class="w-4 h-4" />
        Convert Document to PDF
      </Dialog.Title>
      <Dialog.Description>
        Client-side vector conversion with full typography, table, and layout preservation.
      </Dialog.Description>
    </Dialog.Header>

    <!-- Body -->
    <div class="dialog-body">
      {#if conversionError}
        <div role="alert" class="dialog-error">
          <AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
          <div class="flex-1 leading-relaxed">{conversionError}</div>
        </div>
      {/if}

      <!-- Dropzone / Selected File Card -->
      {#if !selectedFile}
        <label
          class="border border-dashed rounded-[var(--radius-card)] p-6 flex flex-col items-center justify-center gap-2.5 cursor-pointer transition-colors {isDraggingFile ? 'border-ring bg-secondary/50' : 'border-border hover:border-ring/50 hover:bg-secondary/30'}"
          ondragover={(e) => { e.preventDefault(); isDraggingFile = true; }}
          ondragleave={() => { isDraggingFile = false; }}
          ondrop={handleFileDrop}
        >
          <input
            type="file"
            class="hidden"
            accept=".docx,.xlsx,.xls,.csv,.tsv,.pptx,.txt,.md,.markdown,.json,.xml,.html,.rtf,.yaml,.yml,.log"
            onchange={handleFileInputChange}
          />
          <div class="p-2.5 rounded-full bg-card text-foreground border border-border">
            <Upload class="w-5 h-5" />
          </div>
          <div class="text-center">
            <p class="text-xs font-medium text-foreground">
              Choose a document file or drag it here
            </p>
            <p class="text-[11px] text-muted-foreground mt-1">
              Supports Word (.docx), Excel (.xlsx), CSV, PowerPoint (.pptx), Markdown, Text &amp; Code
            </p>
          </div>
        </label>
      {:else}
        {@const badge = getFormatBadgeInfo(detectedFormat)}
        <div class="dialog-card flex-row items-center justify-between">
          <div class="flex items-center gap-3 min-w-0">
            <div class="p-2 rounded-[var(--radius-card-inner)] bg-secondary shrink-0 text-foreground">
              {#if isSpreadsheet}
                <FileSpreadsheet class="w-4 h-4" />
              {:else if isPresentation}
                <Presentation class="w-4 h-4 text-warning" />
              {:else if isTextOrCode}
                <FileCode class="w-4 h-4" />
              {:else}
                <FileText class="w-4 h-4 text-info" />
              {/if}
            </div>
            <div class="min-w-0">
              <p class="text-xs font-semibold text-foreground truncate" title={selectedFile.name}>{selectedFile.name}</p>
              <div class="flex items-center gap-2 mt-0.5">
                <Badge variant="outline" class="text-[10px] px-1.5 py-0 {badge.color}">
                  {badge.label}
                </Badge>
                <span class="text-[11px] text-muted-foreground">{formatBytes(selectedFile.size)}</span>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="h-8 text-xs shrink-0"
            onclick={() => { selectedFile = null; conversionError = null; }}
          >
            Change File
          </Button>
        </div>

        <!-- Format Specific Options -->
        <div class="space-y-3 pt-1">
          <div class="dialog-section-header">
            <span class="flex items-center gap-1.5">
              <SlidersHorizontal class="w-3.5 h-3.5 text-muted-foreground" />
              <span>Conversion Settings</span>
            </span>
          </div>

          <!-- Page Geometry Controls -->
          <div class="field-grid-2">
            <div class="field-group">
              <Label class="field-label">Page Size</Label>
              <Select.Root
                type="single"
                value={pageSize}
                onValueChange={(val) => { if (val) pageSize = val as PageSizePreset; }}
              >
                <Select.Trigger class="w-full h-8 text-xs">
                  {pageSize === "a4" ? "A4 Standard (210 x 297 mm)" : pageSize === "letter" ? "US Letter (8.5 x 11 in)" : pageSize === "legal" ? "US Legal (8.5 x 14 in)" : pageSize === "slide_16_9" ? "16:9 Widescreen Slide" : pageSize === "slide_4_3" ? "4:3 Standard Slide" : pageSize}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="a4" label="A4 Standard (210 x 297 mm)">A4 Standard (210 x 297 mm)</Select.Item>
                  <Select.Item value="letter" label="US Letter (8.5 x 11 in)">US Letter (8.5 x 11 in)</Select.Item>
                  <Select.Item value="legal" label="US Legal (8.5 x 14 in)">US Legal (8.5 x 14 in)</Select.Item>
                  <Select.Item value="slide_16_9" label="16:9 Widescreen Slide">16:9 Widescreen Slide</Select.Item>
                  <Select.Item value="slide_4_3" label="4:3 Standard Slide">4:3 Standard Slide</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>

            <div class="field-group">
              <Label class="field-label">Orientation</Label>
              <ButtonGroup variant="outline" size="sm" class="w-full h-8">
                <Button
                  type="button"
                  variant={orientation === 'auto' ? 'secondary' : 'outline'}
                  class="flex-1 text-xs"
                  onclick={() => (orientation = 'auto')}
                >
                  Auto
                </Button>
                <Button
                  type="button"
                  variant={orientation === 'portrait' ? 'secondary' : 'outline'}
                  class="flex-1 text-xs"
                  onclick={() => (orientation = 'portrait')}
                >
                  Portrait
                </Button>
                <Button
                  type="button"
                  variant={orientation === 'landscape' ? 'secondary' : 'outline'}
                  class="flex-1 text-xs"
                  onclick={() => (orientation = 'landscape')}
                >
                  Landscape
                </Button>
              </ButtonGroup>
            </div>
          </div>

          <div class="field-grid-2">
            <div class="field-group">
              <Label class="field-label">Page Margins</Label>
              <Select.Root
                type="single"
                value={marginPreset}
                onValueChange={(val) => { if (val) marginPreset = val as typeof marginPreset; }}
              >
                <Select.Trigger class="w-full h-8 text-xs">
                  {marginPreset === "normal" ? "Normal (0.50 in / 36 pt)" : marginPreset === "compact" ? "Compact (0.40 in / 28 pt)" : marginPreset === "wide" ? "Wide (1.00 in / 72 pt)" : "Minimum (0.25 in / 18 pt)"}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="normal" label="Normal (0.50 in / 36 pt)">Normal (0.50 in / 36 pt)</Select.Item>
                  <Select.Item value="compact" label="Compact (0.40 in / 28 pt)">Compact (0.40 in / 28 pt)</Select.Item>
                  <Select.Item value="wide" label="Wide (1.00 in / 72 pt)">Wide (1.00 in / 72 pt)</Select.Item>
                  <Select.Item value="none" label="Minimum (0.25 in / 18 pt)">Minimum (0.25 in / 18 pt)</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>

            <div class="field-group">
              <Label class="field-label">Font Family</Label>
              <Select.Root
                type="single"
                value={fontFamily}
                onValueChange={(val) => { if (val) fontFamily = val as typeof fontFamily; }}
              >
                <Select.Trigger class="w-full h-8 text-xs">
                  {fontFamily === "helvetica" ? "Helvetica (Clean Sans)" : fontFamily === "times" ? "Times New Roman (Serif)" : "Courier (Monospace)"}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="helvetica" label="Helvetica (Clean Sans)">Helvetica (Clean Sans)</Select.Item>
                  <Select.Item value="times" label="Times New Roman (Serif)">Times New Roman (Serif)</Select.Item>
                  <Select.Item value="courier" label="Courier (Monospace)">Courier (Monospace)</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          {#if isSpreadsheet}
            <!-- Spreadsheet Options -->
            <div class="dialog-card">
              <div class="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Table class="w-3.5 h-3.5" />
                <span>Spreadsheet Table Formatting</span>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <ControlRow label="Include cell gridlines" for="conv-gridlines" size="compact">
                  <Switch id="conv-gridlines" bind:checked={includeGridlines} />
                </ControlRow>
                <ControlRow label="Alternating row shading" for="conv-row-shading" size="compact">
                  <Switch id="conv-row-shading" bind:checked={alternateRowShading} />
                </ControlRow>
              </div>
            </div>
          {/if}

          {#if isTextOrCode}
            <!-- Typography & Font Size Slider -->
            <div class="field-group">
              <Label class="field-label">Base Font Size</Label>
              <Slider
                type="single"
                value={fontSize}
                min={8}
                max={16}
                step={0.5}
                unit=" pt"
                onValueChange={(val: number) => {
                  fontSize = val;
                }}
              />
            </div>
          {/if}

          {#if featureFlags.isEnabled('conversion.page-numbers')}
            <ControlRow label="Include running &quot;Page X of Y&quot; numbers" for="conv-page-numbers" size="sm">
              <Switch id="conv-page-numbers" bind:checked={includePageNumbers} />
            </ControlRow>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Footer Actions -->
    <Dialog.Footer class="justify-between">
      <Button
        variant="outline"
        size="sm"
        onclick={() => handleOpenChange(false)}
        class="h-8 text-xs"
        disabled={isConverting}
      >
        Cancel
      </Button>

      <div class="flex items-center gap-2">
        {#if selectedFile}
          {#if store.isDocumentLoaded}
            <Button
              variant="outline"
              size="sm"
              class="h-8 text-xs gap-1.5"
              onclick={handleAddToWorkspace}
              disabled={isConverting}
            >
              <PlusCircle class="w-3.5 h-3.5" />
              Add to Workspace
            </Button>
          {/if}

          <Button
            variant="outline"
            size="sm"
            class="h-8 text-xs gap-1.5"
            onclick={handleConvertAndDownload}
            disabled={isConverting}
          >
            <Download class="w-3.5 h-3.5" />
            Download PDF
          </Button>

          <Button
            variant="secondary"
            size="sm"
            class="h-8 text-xs gap-1.5"
            onclick={handleConvertAndOpen}
            disabled={isConverting}
          >
            {#if isConverting}
              <Loader2 class="w-3.5 h-3.5 animate-spin" />
              Converting...
            {:else}
              <CheckCircle2 class="w-3.5 h-3.5" />
              Convert &amp; Open
            {/if}
          </Button>
        {/if}
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
