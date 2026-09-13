<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import {
    documentConverter,
    type DocumentConversionOptions,
    type DocumentFormat,
    type PageSizePreset,
    type PageOrientation,
  } from '../../services/conversion';
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
  let includePageNumbers = $state(true);
  let includeGridlines = $state(true);
  let alternateRowShading = $state(true);

  // Derived detected format
  const detectedFormat = $derived.by<DocumentFormat>(() => {
    if (!selectedFile) return 'unknown';
    return documentConverter.detectFormat(selectedFile.name, undefined, selectedFile.type);
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
      selectedFile = store.convertInitialFile;
      conversionError = null;
    }
  });

  function getFormatBadgeInfo(fmt: DocumentFormat): { label: string; color: string } {
    switch (fmt) {
      case 'docx':
        return { label: 'Word Document (DOCX)', color: 'bg-info/10 text-info border-info/20' };
      case 'xlsx':
      case 'xls':
        return { label: 'Excel Workbook (XLSX)', color: 'bg-success/10 text-success border-success/20' };
      case 'csv':
        return { label: 'Delimited Data (CSV)', color: 'bg-success/10 text-success border-success/20' };
      case 'tsv':
        return { label: 'Tab Separated (TSV)', color: 'bg-success/10 text-success border-success/20' };
      case 'pptx':
        return { label: 'PowerPoint Presentation (PPTX)', color: 'bg-warning/10 text-warning border-warning/20' };
      case 'markdown':
        return { label: 'Markdown Document (MD)', color: 'bg-primary/10 text-primary border-primary/20' };
      case 'text':
        return { label: 'Plain Text (TXT)', color: 'bg-muted text-muted-foreground border-border' };
      case 'code':
      case 'json':
        return { label: 'Code / Data', color: 'bg-primary/10 text-primary border-primary/20' };
      default:
        return { label: 'Supported Document', color: 'bg-primary/10 text-primary border-primary/20' };
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
        return { top: 36, right: 36, bottom: 36, left: 36 };
      case 'wide':
        return { top: 72, right: 72, bottom: 72, left: 72 };
      case 'none':
        return { top: 18, right: 18, bottom: 18, left: 18 };
      case 'normal':
      default:
        return { top: 54, right: 54, bottom: 54, left: 54 };
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
    };
  }

  function handleFileDrop(e: DragEvent): void {
    e.preventDefault();
    isDraggingFile = false;
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (documentConverter.isConvertible(file.name)) {
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
      await actions.loadDocumentFromFile(selectedFile, true);
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
  <Dialog.Content class="max-w-xl p-0 gap-0 overflow-hidden bg-background border-border shadow-2xl rounded-xl">
    <!-- Header -->
    <div class="px-6 pt-6 pb-4 border-b border-border bg-muted/20">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="p-2 rounded-lg bg-primary/10 text-primary">
            <Layers class="w-5 h-5" />
          </div>
          <div>
            <Dialog.Title class="text-base font-semibold text-foreground">
              Convert Document to PDF
            </Dialog.Title>
            <Dialog.Description class="text-xs text-muted-foreground mt-0.5">
              Client-side vector conversion with full typography, table, and layout preservation.
            </Dialog.Description>
          </div>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div class="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
      {#if conversionError}
        <div class="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2 text-xs text-destructive">
          <AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
          <div class="flex-1 leading-relaxed">{conversionError}</div>
        </div>
      {/if}

      <!-- Dropzone / Selected File Card -->
      {#if !selectedFile}
        <label
          class="border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors {isDraggingFile ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'}"
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
          <div class="p-3 rounded-full bg-primary/10 text-primary">
            <Upload class="w-6 h-6" />
          </div>
          <div class="text-center">
            <p class="text-xs font-medium text-foreground">
              Choose a document file or drag it here
            </p>
            <p class="text-[11px] text-muted-foreground mt-1">
              Supports Word (.docx), Excel (.xlsx), CSV, PowerPoint (.pptx), Markdown, Text & Code
            </p>
          </div>
        </label>
      {:else}
        {@const badge = getFormatBadgeInfo(detectedFormat)}
        <div class="p-4 rounded-xl border border-border bg-card flex items-center justify-between">
          <div class="flex items-center gap-3 min-w-0">
            <div class="p-2.5 rounded-lg bg-muted shrink-0 text-foreground">
              {#if isSpreadsheet}
                <FileSpreadsheet class="w-5 h-5 text-success" />
              {:else if isPresentation}
                <Presentation class="w-5 h-5 text-warning" />
              {:else if isTextOrCode}
                <FileCode class="w-5 h-5 text-primary" />
              {:else}
                <FileText class="w-5 h-5 text-info" />
              {/if}
            </div>
            <div class="min-w-0">
              <p class="text-xs font-semibold text-foreground truncate">{selectedFile.name}</p>
              <div class="flex items-center gap-2 mt-1">
                <Badge variant="outline" class="text-[10px] px-1.5 py-0 {badge.color}">
                  {badge.label}
                </Badge>
                <span class="text-[11px] text-muted-foreground">{formatBytes(selectedFile.size)}</span>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="text-xs text-muted-foreground hover:text-foreground"
            onclick={() => { selectedFile = null; conversionError = null; }}
          >
            Change File
          </Button>
        </div>

        <!-- Format Specific Options -->
        <div class="space-y-4 pt-2">
          <div class="flex items-center gap-2 text-xs font-semibold text-foreground">
            <SlidersHorizontal class="w-3.5 h-3.5 text-primary" />
            <span>Conversion Settings</span>
          </div>

          <!-- Page Geometry Controls -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <Label class="text-[11px] text-muted-foreground">Page Size</Label>
              <Select.Root
                type="single"
                value={pageSize}
                onValueChange={(val) => { if (val) pageSize = val as PageSizePreset; }}
              >
                <Select.Trigger class="w-full mt-1.5 h-8 text-xs">
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

            <div>
              <Label class="text-[11px] text-muted-foreground">Orientation</Label>
              <Select.Root
                type="single"
                value={orientation}
                onValueChange={(val) => { if (val) orientation = val as PageOrientation; }}
              >
                <Select.Trigger class="w-full mt-1.5 h-8 text-xs">
                  {orientation === "auto" ? "Auto (Smart Match)" : orientation === "portrait" ? "Portrait" : "Landscape"}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="auto" label="Auto (Smart Match)">Auto (Smart Match)</Select.Item>
                  <Select.Item value="portrait" label="Portrait">Portrait</Select.Item>
                  <Select.Item value="landscape" label="Landscape">Landscape</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <Label class="text-[11px] text-muted-foreground">Page Margins</Label>
              <Select.Root
                type="single"
                value={marginPreset}
                onValueChange={(val) => { if (val) marginPreset = val as typeof marginPreset; }}
              >
                <Select.Trigger class="w-full mt-1.5 h-8 text-xs">
                  {marginPreset === "normal" ? "Normal (0.75 in / 54 pt)" : marginPreset === "compact" ? "Compact (0.50 in / 36 pt)" : marginPreset === "wide" ? "Wide (1.00 in / 72 pt)" : "Minimum (0.25 in / 18 pt)"}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="normal" label="Normal (0.75 in / 54 pt)">Normal (0.75 in / 54 pt)</Select.Item>
                  <Select.Item value="compact" label="Compact (0.50 in / 36 pt)">Compact (0.50 in / 36 pt)</Select.Item>
                  <Select.Item value="wide" label="Wide (1.00 in / 72 pt)">Wide (1.00 in / 72 pt)</Select.Item>
                  <Select.Item value="none" label="Minimum (0.25 in / 18 pt)">Minimum (0.25 in / 18 pt)</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>

            <div>
              <Label class="text-[11px] text-muted-foreground">Font Family</Label>
              <Select.Root
                type="single"
                value={fontFamily}
                onValueChange={(val) => { if (val) fontFamily = val as typeof fontFamily; }}
              >
                <Select.Trigger class="w-full mt-1.5 h-8 text-xs">
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
            <div class="p-3 rounded-lg bg-muted/40 border border-border space-y-2">
              <div class="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Table class="w-3.5 h-3.5 text-success" />
                <span>Spreadsheet Table Formatting</span>
              </div>
              <div class="flex items-center justify-between text-xs pt-1">
                <span class="text-muted-foreground">Include cell gridlines</span>
                <Checkbox bind:checked={includeGridlines} />
              </div>
              <div class="flex items-center justify-between text-xs">
                <span class="text-muted-foreground">Alternating row shading (zebra)</span>
                <Checkbox bind:checked={alternateRowShading} />
              </div>
            </div>
          {/if}

          {#if isTextOrCode}
            <!-- Typography & Font Size Slider -->
            <div class="space-y-2 pt-1">
              <div class="flex justify-between items-center text-xs">
                <span class="text-muted-foreground">Base Font Size</span>
                <span class="font-sans text-foreground">{fontSize} pt</span>
              </div>
              <Slider
                type="single"
                value={fontSize}
                min={8}
                max={16}
                step={0.5}
                onValueChange={(val: number) => {
                  fontSize = val;
                }}
              />
            </div>
          {/if}

          <div class="flex items-center justify-between text-xs pt-1">
            <span class="text-muted-foreground">Include running "Page X of Y" numbers</span>
            <Checkbox bind:checked={includePageNumbers} />
          </div>
        </div>
      {/if}
    </div>

    <!-- Footer Actions -->
    <Dialog.Footer class="px-6 py-4 border-t border-border bg-muted/20 flex flex-row items-center justify-between gap-2 sm:justify-between">
      <Button
        variant="ghost"
        size="sm"
        onclick={() => handleOpenChange(false)}
        class="text-xs"
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
              class="text-xs gap-1.5"
              onclick={handleAddToWorkspace}
              disabled={isConverting}
            >
              <PlusCircle class="w-3.5 h-3.5 text-primary" />
              Add to Workspace
            </Button>
          {/if}

          <Button
            variant="outline"
            size="sm"
            class="text-xs gap-1.5"
            onclick={handleConvertAndDownload}
            disabled={isConverting}
          >
            <Download class="w-3.5 h-3.5 text-primary" />
            Download PDF
          </Button>

          <Button
            size="sm"
            class="text-xs gap-1.5"
            onclick={handleConvertAndOpen}
            disabled={isConverting}
          >
            {#if isConverting}
              <Loader2 class="w-3.5 h-3.5 animate-spin" />
              Converting...
            {:else}
              <CheckCircle2 class="w-3.5 h-3.5" />
              Convert & Open
            {/if}
          </Button>
        {/if}
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
