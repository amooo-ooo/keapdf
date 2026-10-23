<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import SidebarSection from '../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import {
    ScanLine,
    Sparkles,
    FileDown,
    SlidersHorizontal,
    EyeOff,
    ShieldCheck,
    Hash,
    ListOrdered,
    Layers,
    LayoutGrid,
    BookOpenCheck,
    Grid,
    Scissors,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  function selectTool(tool: 'redact'): void {
    if (store.activeTool === tool) {
      actions.setTool('select');
    } else {
      actions.setTool(tool);
    }
  }

  function triggerTool(toolName: string): void {
    store.activeMockupTool = toolName;
  }
</script>

<div class="panel-root">
  {#if featureFlags.isEnabled('ocr') || (featureFlags.isEnabled('redaction.colors') && featureFlags.isEnabled('tools.adjust-colors'))}
  <SidebarSection title="OCR & Scan Processing" borderBottom={true}>
    <p class="panel-description">OCR text recognition & scanner image cleanup tools.</p>
    
    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('ocr')}
        {#if featureFlags.isEnabled('ocr.recognize')}
        <Button
          variant="panel"
          class="w-full"
          onclick={() => actions.openOcrDialog()}
          disabled={!store.isDocumentLoaded || store.isOcrRunning}
        >
          <ScanLine class="panel-icon-sm" /> Recognize Text (OCR)
        </Button>
        {/if}
      {/if}

      {#if featureFlags.isEnabled('redaction.colors') && featureFlags.isEnabled('tools.adjust-colors')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => actions.openAdjustColorsDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <SlidersHorizontal class="panel-icon-sm text-muted-foreground" /> Adjust Colours & Contrast
      </Button>
      {/if}

      {#if featureFlags.isEnabled('ocr') && featureFlags.isEnabled('ocr.detect-photos')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => triggerTool('Detect & Split Scanned Photos')}
        disabled={!store.isDocumentLoaded}
      >
        <Sparkles class="panel-icon-sm" /> Detect & Split Scanned Photos
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('outline') || featureFlags.isEnabled('compression')}
  <!-- note: document optimisation and automatic structural outline generation tools -->
  <SidebarSection title="Document Optimisation" borderBottom={true}>
    <p class="panel-description">Optimise file size and generate structural document outlines.</p>

    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('compression') && featureFlags.isEnabled('tools.compress')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => actions.openCompressDialog('recommended')}
        disabled={!store.isDocumentLoaded}
      >
        <FileDown class="panel-icon-sm" /> Compress PDF
      </Button>
      {/if}

      {#if featureFlags.isEnabled('outline') && featureFlags.isEnabled('tools.outline')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => actions.generateAutomaticOutline()}
        disabled={!store.isDocumentLoaded}
      >
        <Sparkles class="panel-icon-sm" /> Auto-generate Outline
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('redaction')}
  <!-- note: redaction and document sanitisation tools -->
  <SidebarSection title="Redaction & Sanitisation" borderBottom={true}>
    <p class="panel-description">Permanently obscure sensitive content or strip hidden metadata and scripts.</p>

    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('redaction.area')}
      <Button
        variant="panel"
        class="w-full"
        active={store.activeTool === 'redact'}
        onclick={() => selectTool('redact')}
        disabled={!store.isDocumentLoaded}
      >
        <EyeOff class="panel-icon-sm" /> Redact (Text & Area)
      </Button>
      {/if}

      {#if featureFlags.isEnabled('sanitization') && featureFlags.isEnabled('redaction.sanitize')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => actions.openSanitizeDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <ShieldCheck class="panel-icon-sm text-muted-foreground" /> Sanitise Document
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('page-numbers')}
  <!-- note: page numbering, bates numbering, and running header/footer tools -->
  <SidebarSection title="Headers, Footers & Page Numbers" borderBottom={true}>
    <p class="panel-description">Insert dynamic page numbering, Bates numbering, and running header or footer text.</p>

    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('page-numbers.numbers')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => actions.openPageNumberingDialog('page-numbers')}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <Hash class="panel-icon-sm" /> Add Page Numbers
      </Button>
      {/if}

      {#if featureFlags.isEnabled('page-numbers.bates')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => actions.openPageNumberingDialog('bates')}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <ListOrdered class="panel-icon-sm" /> Bates Numbering
      </Button>
      {/if}

      {#if featureFlags.isEnabled('page-numbers.header-footer')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => actions.openPageNumberingDialog('header-footer')}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <Layers class="panel-icon-sm text-muted-foreground" /> Header & Footer Text
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('imposition')}
  <SidebarSection title="Page Imposition & Layout" borderBottom={false}>
    <p class="panel-description">Impose pages for booklet printing, n-up sheets, or continuous canvas.</p>

    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('imposition.nup')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => store.openImpositionDialog('nup')}
        disabled={!store.isDocumentLoaded}
      >
        <LayoutGrid class="panel-icon-sm" /> Multi-Page Layout (N-Up)
      </Button>
      {/if}

      {#if featureFlags.isEnabled('imposition.booklet')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => store.openImpositionDialog('booklet')}
        disabled={!store.isDocumentLoaded}
      >
        <BookOpenCheck class="panel-icon-sm" /> Booklet (Saddle Stitch)
      </Button>
      {/if}

      {#if featureFlags.isEnabled('imposition.continuous')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => store.openImpositionDialog('single-page')}
        disabled={!store.isDocumentLoaded}
      >
        <Layers class="panel-icon-sm" /> Continuous / Single Page
      </Button>
      {/if}

      {#if featureFlags.isEnabled('imposition.posterize')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => store.openImpositionDialog('posterize')}
        disabled={!store.isDocumentLoaded}
      >
        <Grid class="panel-icon-sm" /> Posterize (Multi-Sheet Tile)
      </Button>
      {/if}

      {#if featureFlags.isEnabled('imposition.cut-stack')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => store.openImpositionDialog('cut-stack')}
        disabled={!store.isDocumentLoaded}
      >
        <Scissors class="panel-icon-sm" /> Cut & Stack Imposition
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}
</div>

