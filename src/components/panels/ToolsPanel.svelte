<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import SidebarSection from '../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import {
    ScanLine,
    Sparkles,
    FileOutput,
    Image,
    Trash2,
    FileX,
    Hash,
    Layers,
    ShieldCheck,
    LayoutGrid,
    BookOpenCheck,
    ArrowRight,
    FileDown,
    FileType,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  function triggerTool(toolName: string): void {
    store.activeMockupTool = toolName;
  }
</script>

<div class="flex flex-col min-h-0 divide-y divide-border">
  {#if featureFlags.isEnabled('conversion')}
  <SidebarSection title="Document Conversion" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Convert Office docs, spreadsheets, slides, and markdown to PDF.</p>
    <Button
      variant="default"
      size="sm"
      class="w-full justify-start text-xs h-8 font-medium"
      onclick={() => actions.openConvertDialog()}
    >
      <FileType class="h-3.5 w-3.5 mr-2 text-primary-foreground" /> Convert to PDF...
    </Button>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('ocr')}
  <SidebarSection title="OCR & Scan Processing" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">OCR text recognition & scanner image cleanup tools.</p>
    
    <div class="flex flex-col gap-2">
      {#if featureFlags.isEnabled('ocr.recognize')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => actions.openOcrDialog()}
        disabled={!store.isDocumentLoaded || store.isOcrRunning}
      >
        <ScanLine class="h-3.5 w-3.5 mr-2 text-primary" /> Recognize Text (OCR)
      </Button>
      {/if}

      {#if featureFlags.isEnabled('ocr.detect-photos')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Detect & Split Scanned Photos')}
        disabled={!store.isDocumentLoaded}
      >
        <Sparkles class="h-3.5 w-3.5 mr-2 text-warning" /> Detect & Split Scanned Photos
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('compression') || featureFlags.isEnabled('sanitization') || featureFlags.isEnabled('export-images') || featureFlags.isEnabled('extraction')}
  <SidebarSection title="Extraction & Sanitization" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Clean sensitive metadata, extract assets, and purge artifacts.</p>

    <div class="flex flex-col gap-2">
      <div class="grid grid-cols-2 gap-2">
        {#if featureFlags.isEnabled('compression')}
        <Button
          variant="default"
          size="sm"
          class="justify-start text-xs h-8 font-medium px-2.5"
          onclick={() => actions.openCompressDialog('recommended')}
          disabled={!store.isDocumentLoaded}
        >
          <FileDown class="h-3.5 w-3.5 mr-1.5 text-primary-foreground" /> Compress PDF
        </Button>
        {/if}

        {#if featureFlags.isEnabled('sanitization')}
        <Button
          variant="outline"
          size="sm"
          class="justify-start text-xs h-8 font-medium px-2.5"
          onclick={() => actions.openSanitizeDialog()}
          disabled={!store.isDocumentLoaded}
        >
          <ShieldCheck class="h-3.5 w-3.5 mr-1.5 text-primary" /> Sanitise
        </Button>
        {/if}
      </div>

      <div class="grid grid-cols-2 gap-2">
        {#if featureFlags.isEnabled('extraction.pages')}
        <Button
          variant="outline"
          size="sm"
          class="justify-start text-xs h-8 px-2.5"
          onclick={() => store.splitDialogMode = 'extract'}
          disabled={!store.isDocumentLoaded}
        >
          <FileOutput class="h-3.5 w-3.5 mr-1.5 text-muted-foreground" /> Extract Pages
        </Button>
        {/if}

        {#if featureFlags.isEnabled('export-images') || featureFlags.isEnabled('extraction.images')}
        <Button
          variant="outline"
          size="sm"
          class="justify-start text-xs h-8 px-2.5"
          onclick={() => store.showExportImagesDialog = true}
          disabled={!store.isDocumentLoaded}
        >
          <Image class="h-3.5 w-3.5 mr-1.5 text-muted-foreground" /> Extract Images
        </Button>
        {/if}

        {#if featureFlags.isEnabled('extraction.remove-blanks')}
        <Button
          variant="outline"
          size="sm"
          class="justify-start text-xs h-8 px-2.5"
          onclick={() => triggerTool('Remove Blank Pages')}
          disabled={!store.isDocumentLoaded}
        >
          <FileX class="h-3.5 w-3.5 mr-1.5 text-destructive" /> Remove Blanks
        </Button>
        {/if}

        {#if featureFlags.isEnabled('sanitization')}
        <Button
          variant="outline"
          size="sm"
          class="justify-start text-xs h-8 px-2.5"
          onclick={() => actions.openSanitizeDialog()}
          disabled={!store.isDocumentLoaded}
        >
          <Trash2 class="h-3.5 w-3.5 mr-1.5 text-destructive" /> Clear Annotations
        </Button>
        {/if}
      </div>
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('page-numbers')}
  <SidebarSection title="Headers, Footers & Page Numbers" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Insert dynamic page numbering and custom header/footer text.</p>

    <div class="flex flex-col gap-2">
      {#if featureFlags.isEnabled('page-numbers.numbers')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Add Page Numbers')}
        disabled={!store.isDocumentLoaded}
      >
        <Hash class="h-3.5 w-3.5 mr-2 text-primary" /> Add Page Numbers
      </Button>
      {/if}

      {#if featureFlags.isEnabled('page-numbers.header-footer')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Header & Footer Text')}
        disabled={!store.isDocumentLoaded}
      >
        <Layers class="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Header & Footer Text
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('imposition')}
  <SidebarSection title="Page Imposition & Layout" borderBottom={false}>
    <p class="text-xs text-muted-foreground mb-2">Impose pages for booklet printing, n-up sheets, or continuous canvas.</p>

    <div class="flex flex-col gap-2">
      {#if featureFlags.isEnabled('imposition.nup')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => store.openImpositionDialog('nup')}
        disabled={!store.isDocumentLoaded}
      >
        <LayoutGrid class="h-3.5 w-3.5 mr-2 text-primary" /> Multi-Page Layout (N-Up)
      </Button>
      {/if}

      {#if featureFlags.isEnabled('imposition.booklet')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => store.openImpositionDialog('booklet')}
        disabled={!store.isDocumentLoaded}
      >
        <BookOpenCheck class="h-3.5 w-3.5 mr-2 text-success" /> Booklet (Saddle Stitch)
      </Button>
      {/if}

      {#if featureFlags.isEnabled('imposition.panel')}
      <Button
        variant="ghost"
        size="sm"
        class="w-full justify-between text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
        onclick={() => { store.leftPanelMode = 'imposition'; }}
      >
        <span>Open full Imposition panel</span>
        <ArrowRight class="h-3 w-3 ml-1" />
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}
</div>

