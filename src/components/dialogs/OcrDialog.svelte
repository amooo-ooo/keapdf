<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { ControlRow } from '$lib/components/ui/control-row/index.js';
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
    <Dialog.Content class="sm:max-w-[520px] font-sans">
      <!-- Header -->
      <Dialog.Header class="pr-12">
        <Dialog.Title>
          <ScanText class="h-4 w-4" />
          Recognize Text (OCR)
        </Dialog.Title>
        <Dialog.Description>
          Extract selectable and editable text from scanned pages directly in your browser.
        </Dialog.Description>
      </Dialog.Header>

      <!-- Main Body -->
      <div class="dialog-body">
        <!-- Detection Summary Banner -->
        <div class="dialog-card">
          <div class="flex items-center justify-between">
            <span class="font-medium text-foreground flex items-center gap-1.5">
              <Sparkles class="h-3.5 w-3.5" />
              Document Scan Detection
            </span>
            <Badge variant="outline" class="text-[11px] font-sans">
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
        <div class="field-group">
          <Label class="field-label">Target Scope</Label>
          <ButtonGroup variant="outline" size="sm" class="w-full h-8">
            <Button
              type="button"
              variant={selectedScope === 'current' ? 'secondary' : 'outline'}
              class="flex-1 text-xs gap-1.5"
              onclick={() => (selectedScope = 'current')}
              disabled={store.isOcrRunning}
            >
              <FileText class="h-3.5 w-3.5" />
              Current ({store.currentPageIndex + 1})
            </Button>

            <Button
              type="button"
              variant={selectedScope === 'scanned' ? 'secondary' : 'outline'}
              class="flex-1 text-xs gap-1.5"
              onclick={() => (selectedScope = 'scanned')}
              disabled={store.isOcrRunning || scannedCount === 0}
            >
              <ScanText class="h-3.5 w-3.5" />
              Scanned ({scannedCount})
            </Button>

            <Button
              type="button"
              variant={selectedScope === 'all' ? 'secondary' : 'outline'}
              class="flex-1 text-xs gap-1.5"
              onclick={() => (selectedScope = 'all')}
              disabled={store.isOcrRunning}
            >
              <Layers class="h-3.5 w-3.5" />
              All Pages ({store.pageCount})
            </Button>
          </ButtonGroup>
        </div>

        <!-- Language Selection -->
        <div class="field-group">
          <Label class="field-label flex items-center gap-1.5">
            <Globe class="h-3.5 w-3.5 text-muted-foreground" />
            Document Language
          </Label>
          <Select.Root
            type="single"
            value={selectedLanguage}
            onValueChange={(v) => { if (v) selectedLanguage = v; }}
            disabled={store.isOcrRunning}
          >
            <Select.Trigger class="w-full h-8 text-xs font-sans">
              {LANGUAGES.find((l) => l.code === selectedLanguage)?.name ?? selectedLanguage}
            </Select.Trigger>
            <Select.Content>
              {#each LANGUAGES as lang}
                <Select.Item value={lang.code} label={lang.name}>{lang.name}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        <!-- Options Toggle -->
        <ControlRow
          label="Embed Searchable Text Layer"
          description="Synthesizes invisible ISO 32000 text objects into the PDF stream, preserving original scans while allowing selection in standard PDF viewers."
          for="ocr-auto-embed"
          size="sm"
        >
          <Switch
            id="ocr-auto-embed"
            bind:checked={autoEmbedLayer}
            disabled={store.isOcrRunning}
          />
        </ControlRow>

        <!-- Live Progress Status -->
        {#if store.isOcrRunning && store.ocrProgress}
          <div class="dialog-card">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium text-foreground flex items-center gap-1.5">
                <Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                {store.ocrProgress.status || 'Recognizing glyphs...'}
              </span>
              <span class="font-sans text-[11px] text-muted-foreground">
                {Math.round(store.ocrProgress.progress * 100)}%
              </span>
            </div>
            <div class="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                class="h-full bg-foreground transition-[width] duration-200 ease-out rounded-full"
                style="width: {Math.max(5, Math.round(store.ocrProgress.progress * 100))}%"
              ></div>
            </div>
          </div>
        {:else if statusMessage}
          <div role="status" class="rounded-[var(--radius-card-inner)] border border-border bg-card p-2.5 flex items-center gap-2 text-xs text-foreground">
            <CheckCircle2 class="h-4 w-4 shrink-0 text-foreground" />
            <span>{statusMessage}</span>
          </div>
        {/if}

        {#if errorMessage}
          <div role="alert" class="dialog-error">
            <AlertCircle class="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <Dialog.Footer class="justify-between">
        <span class="text-[11px] text-muted-foreground">
          Targets {targetPages.length} page(s)
        </span>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="h-8 text-xs"
            onclick={() => actions.closeOcrDialog()}
            disabled={store.isOcrRunning}
          >
            Cancel
          </Button>
          <Button
            variant="secondary"
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
