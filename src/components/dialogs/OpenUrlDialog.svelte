<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import {
    getDemoPresetMetadataList,
    type DemoDocumentMetadata,
  } from '../../services/demo-documents/registry';
  import {
    validatePdfUrlSecurity,
  } from '../../services/url-document-loader';
  import {
    Globe,
    AlertCircle,
    CheckCircle2,
    ExternalLink,
    Loader2,
    Shield,
    Type,
    Shapes,
    BookOpen,
    Stamp,
    Layers,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

  let activeTab = $state('compliance');
  let urlInput = $state('');
  let validationError = $state<string | null>(null);

  const presets = getDemoPresetMetadataList();

  $effect(() => {
    if (store.showOpenUrlDialog && store.openUrlDialogInitialUrl) {
      urlInput = store.openUrlDialogInitialUrl;
      activeTab = 'url';
    }
  });

  function getCategoryIcon(category: string) {
    switch (category) {
      case 'forms':
        return CheckCircle2;
      case 'typography':
        return Type;
      case 'vector':
        return Shapes;
      case 'multipage':
        return BookOpen;
      case 'security':
        return Shield;
      case 'annotations':
        return Stamp;
      default:
        return Layers;
    }
  }

  async function handleLoadPreset(preset: DemoDocumentMetadata): Promise<void> {
    validationError = null;
    await actions.loadDemoDocument(preset.id);
    if (!store.loadError) {
      store.showOpenUrlDialog = false;
    }
  }

  async function handleLoadUrl(): Promise<void> {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      validationError = 'Please enter a valid PDF URL.';
      return;
    }

    const security = validatePdfUrlSecurity(trimmed);
    if (!security.isValid) {
      validationError = security.reason ?? 'Invalid or disallowed URL scheme.';
      return;
    }

    validationError = null;
    await actions.loadDocumentFromUrl(trimmed);
    if (!store.loadError) {
      store.showOpenUrlDialog = false;
    }
  }

  function handleOpenChange(open: boolean): void {
    store.showOpenUrlDialog = open;
    if (!open) {
      validationError = null;
      store.loadError = null;
    }
  }
</script>

<Dialog.Root open={store.showOpenUrlDialog} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[700px] max-h-[85vh] flex flex-col p-6 gap-4">
    <Dialog.Header class="gap-1.5 shrink-0">
      <Dialog.Title class="text-lg font-semibold flex items-center gap-2">
        <Globe class="w-5 h-5 text-primary" />
        Open Document & Compliance Test Suite
      </Dialog.Title>
      <Dialog.Description class="text-xs text-muted-foreground">
        Load industry-standard PDF compliance test suites or fetch any public open-source PDF document from a URL.
      </Dialog.Description>
    </Dialog.Header>

    {#if store.loadError || validationError}
      <div class="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2 text-xs text-destructive shrink-0">
        <AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
        <div class="flex-1 leading-relaxed">
          {validationError || store.loadError}
        </div>
      </div>
    {/if}

    <Tabs.Root bind:value={activeTab} class="flex-1 flex flex-col min-h-0">
      <Tabs.List class="grid grid-cols-2 mb-3 shrink-0">
        <Tabs.Trigger value="compliance" class="text-xs font-medium flex items-center gap-1.5">
          <Shield class="w-3.5 h-3.5" />
          Industry Compliance Suites ({presets.length})
        </Tabs.Trigger>
        <Tabs.Trigger value="url" class="text-xs font-medium flex items-center gap-1.5">
          <Globe class="w-3.5 h-3.5" />
          Open from Remote URL
        </Tabs.Trigger>
      </Tabs.List>

      <!-- TAB 1: Compliance Presets -->
      <Tabs.Content value="compliance" class="flex-1 overflow-y-auto pr-1 space-y-2.5 outline-none">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {#each presets as preset (preset.id)}
            {@const Icon = getCategoryIcon(preset.category)}
            <div class="p-3.5 border rounded-lg hover:border-primary/50 hover:bg-muted/30 transition-all flex flex-col justify-between gap-2.5 bg-card">
              <div class="space-y-1.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-medium text-xs text-foreground flex items-center gap-1.5 truncate">
                    <Icon class="w-3.5 h-3.5 text-primary shrink-0" />
                    {preset.title}
                  </span>
                  <Badge variant="outline" class="text-[10px] px-1.5 py-0 h-4 shrink-0 font-sans">
                    {preset.badge}
                  </Badge>
                </div>
                <div class="text-[10px] text-muted-foreground font-sans truncate">
                  {preset.origin}
                </div>
                <p class="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                  {preset.description}
                </p>
                <div class="flex flex-wrap gap-1 pt-1">
                  {#each preset.expectedCapabilities.slice(0, 3) as cap}
                    <span class="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                      {cap}
                    </span>
                  {/each}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                class="w-full text-xs h-7 mt-1"
                disabled={store.isLoadingDocument}
                onclick={() => handleLoadPreset(preset)}
              >
                {#if store.isLoadingDocument}
                  <Loader2 class="w-3.5 h-3.5 animate-spin mr-1.5" />
                  Loading...
                {:else}
                  Load {preset.title}
                {/if}
              </Button>
            </div>
          {/each}
        </div>
      </Tabs.Content>

      <!-- TAB 2: Custom URL Input -->
      <Tabs.Content value="url" class="flex-1 flex flex-col gap-4 outline-none pt-1">
        <div class="space-y-2">
          <Label for="pdf-url-input" class="text-xs font-medium">Public PDF Document URL</Label>
          <div class="flex gap-2">
            <Input
              id="pdf-url-input"
              type="url"
              placeholder="https://example.com/document.pdf"
              bind:value={urlInput}
              class="text-xs h-9"
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  handleLoadUrl();
                }
              }}
            />
            <Button
              size="sm"
              class="h-9 px-4 shrink-0 text-xs"
              disabled={store.isLoadingDocument || !urlInput.trim()}
              onclick={handleLoadUrl}
            >
              {#if store.isLoadingDocument}
                <Loader2 class="w-3.5 h-3.5 animate-spin mr-1.5" />
                Fetching...
              {:else}
                Open URL
              {/if}
            </Button>
          </div>
          <p class="text-[11px] text-muted-foreground">
            Target URL must directly return a valid PDF byte stream (%PDF-) with permissive CORS headers.
          </p>
        </div>

        <div class="border rounded-lg p-3 bg-muted/20 space-y-2">
          <div class="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <ExternalLink class="w-3.5 h-3.5 text-primary" />
            Curated Industry Benchmark Documents
          </div>
          <p class="text-[11px] text-muted-foreground">
            Click any real-world benchmark document from Mozilla PDF.js or pdf-lib test suites below:
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <button
              type="button"
              class="w-full text-left p-2 rounded border bg-card hover:bg-muted/50 transition-colors flex items-center justify-between text-xs"
              onclick={() => {
                urlInput = 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/160F-2019.pdf';
              }}
            >
              <span class="font-sans text-[11px] truncate mr-2">160F-2019.pdf</span>
              <Badge variant="secondary" class="text-[10px] h-4 shrink-0">AcroForms</Badge>
            </button>
            <button
              type="button"
              class="w-full text-left p-2 rounded border bg-card hover:bg-muted/50 transition-colors flex items-center justify-between text-xs"
              onclick={() => {
                urlInput = 'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf';
              }}
            >
              <span class="font-sans text-[11px] truncate mr-2">tracemonkey-pldi-09.pdf</span>
              <Badge variant="secondary" class="text-[10px] h-4 shrink-0">14 Pages</Badge>
            </button>
            <button
              type="button"
              class="w-full text-left p-2 rounded border bg-card hover:bg-muted/50 transition-colors flex items-center justify-between text-xs"
              onclick={() => {
                urlInput = 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/alphatrans.pdf';
              }}
            >
              <span class="font-sans text-[11px] truncate mr-2">alphatrans.pdf</span>
              <Badge variant="secondary" class="text-[10px] h-4 shrink-0">Vectors</Badge>
            </button>
            <button
              type="button"
              class="w-full text-left p-2 rounded border bg-card hover:bg-muted/50 transition-colors flex items-center justify-between text-xs"
              onclick={() => {
                urlInput = 'https://raw.githubusercontent.com/Hopding/pdf-lib/master/assets/pdfs/with_signature.pdf';
              }}
            >
              <span class="font-sans text-[11px] truncate mr-2">with_signature.pdf</span>
              <Badge variant="secondary" class="text-[10px] h-4 shrink-0">Signed</Badge>
            </button>
            <button
              type="button"
              class="w-full text-left p-2 rounded border bg-card hover:bg-muted/50 transition-colors flex items-center justify-between text-xs"
              onclick={() => {
                urlInput = 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/comments.pdf';
              }}
            >
              <span class="font-sans text-[11px] truncate mr-2">comments.pdf</span>
              <Badge variant="secondary" class="text-[10px] h-4 shrink-0">Annotations</Badge>
            </button>
            <button
              type="button"
              class="w-full text-left p-2 rounded border bg-card hover:bg-muted/50 transition-colors flex items-center justify-between text-xs"
              onclick={() => {
                urlInput = 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/freeculture.pdf';
              }}
            >
              <span class="font-sans text-[11px] truncate mr-2">freeculture.pdf</span>
              <Badge variant="secondary" class="text-[10px] h-4 shrink-0">270+ Pages</Badge>
            </button>
          </div>
        </div>
      </Tabs.Content>
    </Tabs.Root>

    <Dialog.Footer class="shrink-0 pt-2 border-t flex justify-between sm:justify-between items-center">
      <div class="text-[11px] text-muted-foreground">
        {#if store.isLoadingDocument}
          <span class="flex items-center gap-1 text-primary">
            <Loader2 class="w-3 h-3 animate-spin" />
            {store.loadingProgress || 'Processing document...'}
          </span>
        {:else}
          Tip: Pass ?demo=&lt;id&gt; or ?url=&lt;pdf_url&gt; in your browser URL bar.
        {/if}
      </div>
      <Button
        variant="ghost"
        size="sm"
        class="text-xs h-8"
        onclick={() => (store.showOpenUrlDialog = false)}
      >
        Close
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
