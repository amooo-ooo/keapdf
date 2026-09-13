<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import {
    ScanText,
    Sparkles,
    Loader2,
    CheckCircle2,
    Layers,
    FileText,
    Globe,
    AlertCircle,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

  type OcrScope = 'current' | 'scanned' | 'all';

  let selectedScope = $state<OcrScope>('current');
  let selectedLanguage = $state('eng');
  let autoEmbedLayer = $state(true);
  let statusMessage = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);
  let completedCount = $state(0);

  const LANGUAGES = [
    { code: 'eng', name: 'English' },
    { code: 'spa', name: 'Spanish' },
    { code: 'fra', name: 'French' },
    { code: 'deu', name: 'German' },
    { code: 'ita', name: 'Italian' },
    { code: 'por', name: 'Portuguese' },
    { code: 'nld', name: 'Dutch' },
    { code: 'chi_sim', name: 'Chinese (Simplified)' },
    { code: 'jpn', name: 'Japanese' },
  ];

  const scannedCount = $derived(store.scannedPages.size);
  const targetPages = $derived.by(() => {
    if (!store.isDocumentLoaded) return [];
    if (selectedScope === 'current') {
      return [store.currentPageIndex];
    }
    if (selectedScope === 'scanned') {
      return Array.from(store.scannedPages).sort((a, b) => a - b);
    }
    return Array.from({ length: store.pageCount }, (_, i) => i);
  });

  function handleOpenChange(open: boolean): void {
    if (!open && !store.isOcrRunning) {
      actions.closeOcrDialog();
      statusMessage = null;
      errorMessage = null;
      completedCount = 0;
    }
  }

  async function handleStartOcr(): Promise<void> {
    if (!store.isDocumentLoaded || targetPages.length === 0 || store.isOcrRunning) return;

    errorMessage = null;
    statusMessage = 'Starting OCR text recognition...';
    completedCount = 0;

    try {
      for (let i = 0; i < targetPages.length; i++) {
        const pageIdx = targetPages[i];
        statusMessage = `Processing page ${pageIdx + 1} of ${store.pageCount} (${i + 1}/${targetPages.length})...`;
        const res = await actions.runOcrOnPage(pageIdx, {
          language: selectedLanguage,
          autoEmbed: autoEmbedLayer,
        });
        if (res) {
          completedCount += 1;
        }
      }

      statusMessage = `Successfully recognized text on ${completedCount} page(s).`;
      setTimeout(() => {
        if (!store.isOcrRunning) {
          actions.closeOcrDialog();
        }
      }, 1200);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'OCR recognition encountered an error.';
    }
  }
</script>

{#if store.showOcrDialog}
  <Dialog.Root open={true} onOpenChange={handleOpenChange}>
    <Dialog.Content class="sm:max-w-[540px] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden font-sans">
      <!-- Header -->
      <Dialog.Header class="p-4 pb-3 border-b bg-card">
        <div class="flex items-center gap-2.5">
          <div class="p-2 rounded-md bg-primary/10 text-primary">
            <ScanText class="h-4 w-4" />
          </div>
          <div>
            <Dialog.Title class="text-sm font-semibold">Recognize Text (OCR)</Dialog.Title>
            <Dialog.Description class="text-xs text-muted-foreground">
              Extract selectable and editable text from scanned pages directly in your browser.
            </Dialog.Description>
          </div>
        </div>
      </Dialog.Header>

      <!-- Main Body -->
      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4 text-xs">
        <!-- Detection Summary Banner -->
        <div class="rounded-lg border bg-muted/30 p-3 flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="font-medium text-foreground flex items-center gap-1.5">
              <Sparkles class="h-3.5 w-3.5 text-primary" />
              Document Scan Detection
            </span>
            <Badge variant="outline" class="text-[11px] font-sans tabular-nums">
              {scannedCount} / {store.pageCount} scanned
            </Badge>
          </div>
          <p class="text-[11px] text-muted-foreground leading-relaxed">
            {#if scannedCount > 0}
              Found {scannedCount} image-only page(s) without native vector text. Recognizing text will enable full text selection, search, highlighting, and inline editing.
            {:else}
              All pages contain native text. OCR can still be run on specific pages to enhance character extraction.
            {/if}
          </p>
        </div>

        <!-- Scope Selection -->
        <div class="flex flex-col gap-1.5">
          <Label class="text-xs font-semibold text-foreground">Target Scope</Label>
          <div class="grid grid-cols-3 gap-2">
            <button
              type="button"
              class="flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all cursor-pointer {selectedScope === 'current' ? 'border-primary bg-primary/5 text-primary font-medium shadow-xs' : 'border-border bg-card hover:bg-muted/40 text-muted-foreground'}"
              onclick={() => (selectedScope = 'current')}
              disabled={store.isOcrRunning}
            >
              <FileText class="h-4 w-4 mb-1" />
              <span class="text-xs">Current Page</span>
              <span class="text-[10px] opacity-75">Page {store.currentPageIndex + 1}</span>
            </button>

            <button
              type="button"
              class="flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all cursor-pointer {selectedScope === 'scanned' ? 'border-primary bg-primary/5 text-primary font-medium shadow-xs' : 'border-border bg-card hover:bg-muted/40 text-muted-foreground'}"
              onclick={() => (selectedScope = 'scanned')}
              disabled={store.isOcrRunning || scannedCount === 0}
            >
              <ScanText class="h-4 w-4 mb-1" />
              <span class="text-xs">Scanned Only</span>
              <span class="text-[10px] opacity-75">{scannedCount} page(s)</span>
            </button>

            <button
              type="button"
              class="flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all cursor-pointer {selectedScope === 'all' ? 'border-primary bg-primary/5 text-primary font-medium shadow-xs' : 'border-border bg-card hover:bg-muted/40 text-muted-foreground'}"
              onclick={() => (selectedScope = 'all')}
              disabled={store.isOcrRunning}
            >
              <Layers class="h-4 w-4 mb-1" />
              <span class="text-xs">Entire Document</span>
              <span class="text-[10px] opacity-75">{store.pageCount} page(s)</span>
            </button>
          </div>
        </div>

        <!-- Language Selection -->
        <div class="flex flex-col gap-1.5">
          <Label class="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Globe class="h-3.5 w-3.5 text-muted-foreground" />
            Document Language
          </Label>
          <select
            bind:value={selectedLanguage}
            disabled={store.isOcrRunning}
            class="w-full h-8 px-2.5 text-xs bg-card border border-input rounded-md focus:outline-hidden focus:ring-1 focus:ring-ring text-foreground"
          >
            {#each LANGUAGES as lang}
              <option value={lang.code}>{lang.name}</option>
            {/each}
          </select>
        </div>

        <!-- Options Checkbox -->
        <div class="flex flex-col gap-2 pt-1 border-t">
          <label class="flex items-start gap-2 cursor-pointer select-none">
            <Checkbox
              checked={autoEmbedLayer}
              onCheckedChange={(v) => (autoEmbedLayer = Boolean(v))}
              disabled={store.isOcrRunning}
              class="mt-0.5"
            />
            <div class="flex flex-col">
              <span class="text-xs font-medium text-foreground">Embed Searchable Text Layer</span>
              <span class="text-[11px] text-muted-foreground">
                Synthesizes invisible ISO 32000 text objects into the PDF stream, preserving original scans while allowing selection in standard PDF viewers.
              </span>
            </div>
          </label>
        </div>

        <!-- Live Progress Status -->
        {#if store.isOcrRunning && store.ocrProgress}
          <div class="rounded-lg border bg-primary/5 p-3 flex flex-col gap-2">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium text-primary flex items-center gap-1.5">
                <Loader2 class="h-3.5 w-3.5 animate-spin" />
                {store.ocrProgress.status || 'Recognizing glyphs...'}
              </span>
              <span class="font-sans tabular-nums text-[11px] text-primary">
                {Math.round(store.ocrProgress.progress * 100)}%
              </span>
            </div>
            <div class="w-full h-1.5 bg-primary/20 rounded-full overflow-hidden">
              <div
                class="h-full bg-primary transition-all duration-200 ease-out rounded-full"
                style="width: {Math.max(5, Math.round(store.ocrProgress.progress * 100))}%"
              ></div>
            </div>
          </div>
        {:else if statusMessage}
          <div class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 class="h-4 w-4 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        {/if}

        {#if errorMessage}
          <div class="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 flex items-center gap-2 text-xs text-destructive">
            <AlertCircle class="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <Dialog.Footer class="p-3 px-4 border-t bg-card flex items-center justify-between gap-2">
        <span class="text-[11px] text-muted-foreground">
          Targets {targetPages.length} page(s)
        </span>
        <div class="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            class="h-8 text-xs"
            onclick={() => actions.closeOcrDialog()}
            disabled={store.isOcrRunning}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            class="h-8 text-xs font-medium gap-1.5"
            onclick={handleStartOcr}
            disabled={store.isOcrRunning || targetPages.length === 0}
          >
            {#if store.isOcrRunning}
              <Loader2 class="h-3.5 w-3.5 animate-spin" />
              Recognizing...
            {:else}
              <ScanText class="h-3.5 w-3.5" />
              Recognize Text
            {/if}
          </Button>
        </div>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
