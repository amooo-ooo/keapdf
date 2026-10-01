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
    ShieldCheck,
    Hash,
    Layers,
    LayoutGrid,
    BookOpenCheck,
    Grid,
    Scissors,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  function triggerTool(toolName: string): void {
    store.activeMockupTool = toolName;
  }
</script>

<div class="panel-root">
  {#if featureFlags.isEnabled('ocr')}
  <SidebarSection title="OCR & Scan Processing" borderBottom={true}>
    <p class="panel-description">OCR text recognition & scanner image cleanup tools.</p>
    
    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('ocr.recognize')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => actions.openOcrDialog()}
        disabled={!store.isDocumentLoaded || store.isOcrRunning}
      >
        <ScanLine class="panel-icon-sm text-primary" /> Recognize Text (OCR)
      </Button>
      {/if}

      {#if featureFlags.isEnabled('ocr.detect-photos')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => triggerTool('Detect & Split Scanned Photos')}
        disabled={!store.isDocumentLoaded}
      >
        <Sparkles class="panel-icon-sm text-warning" /> Detect & Split Scanned Photos
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('outline') || featureFlags.isEnabled('compression') || featureFlags.isEnabled('sanitization')}
  <!-- note: document optimisation, automatic outline generation, and sanitisation tools -->
  <SidebarSection title="Document Optimisation" borderBottom={true}>
    <p class="panel-description">Optimise file size, generate structural outlines, and sanitise document metadata.</p>

    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('outline') && featureFlags.isEnabled('tools.outline')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => actions.generateAutomaticOutline()}
        disabled={!store.isDocumentLoaded}
      >
        <Sparkles class="panel-icon-sm text-primary" /> Auto-generate Outline
      </Button>
      {/if}

      {#if featureFlags.isEnabled('compression') && featureFlags.isEnabled('tools.compress')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => actions.openCompressDialog('recommended')}
        disabled={!store.isDocumentLoaded}
      >
        <FileDown class="panel-icon-sm text-primary" /> Compress PDF
      </Button>
      {/if}

      {#if featureFlags.isEnabled('sanitization') && featureFlags.isEnabled('tools.sanitize')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => actions.openSanitizeDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <ShieldCheck class="panel-icon-sm text-primary" /> Sanitise
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('page-numbers')}
  <SidebarSection title="Headers, Footers & Page Numbers" borderBottom={true}>
    <p class="panel-description">Insert dynamic page numbering and custom header/footer text.</p>

    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('page-numbers.numbers')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => triggerTool('Add Page Numbers')}
        disabled={!store.isDocumentLoaded}
      >
        <Hash class="panel-icon-sm text-primary" /> Add Page Numbers
      </Button>
      {/if}

      {#if featureFlags.isEnabled('page-numbers.header-footer')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => triggerTool('Header & Footer Text')}
        disabled={!store.isDocumentLoaded}
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
        <LayoutGrid class="panel-icon-sm text-primary" /> Multi-Page Layout (N-Up)
      </Button>
      {/if}

      {#if featureFlags.isEnabled('imposition.booklet')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => store.openImpositionDialog('booklet')}
        disabled={!store.isDocumentLoaded}
      >
        <BookOpenCheck class="panel-icon-sm text-success" /> Booklet (Saddle Stitch)
      </Button>
      {/if}

      {#if featureFlags.isEnabled('imposition.continuous')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => store.openImpositionDialog('single-page')}
        disabled={!store.isDocumentLoaded}
      >
        <Layers class="panel-icon-sm text-warning" /> Continuous / Single Page
      </Button>
      {/if}

      {#if featureFlags.isEnabled('imposition.posterize')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => store.openImpositionDialog('posterize')}
        disabled={!store.isDocumentLoaded}
      >
        <Grid class="panel-icon-sm text-primary" /> Posterize (Multi-Sheet Tile)
      </Button>
      {/if}

      {#if featureFlags.isEnabled('imposition.cut-stack')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => store.openImpositionDialog('cut-stack')}
        disabled={!store.isDocumentLoaded}
      >
        <Scissors class="panel-icon-sm text-destructive" /> Cut & Stack Imposition
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}
</div>

