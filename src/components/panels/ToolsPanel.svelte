<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
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
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

  function triggerTool(toolName: string): void {
    store.activeMockupTool = toolName;
  }
</script>

<div class="flex flex-col min-h-0 divide-y divide-border">
  <SidebarSection title="OCR & Scan Processing" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">OCR text recognition & scanner image cleanup tools.</p>
    
    <div class="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('OCR / Cleanup Scans')}
        disabled={!store.isDocumentLoaded}
      >
        <ScanLine class="h-3.5 w-3.5 mr-2 text-primary" /> OCR / Cleanup Scans
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Detect & Split Scanned Photos')}
        disabled={!store.isDocumentLoaded}
      >
        <Sparkles class="h-3.5 w-3.5 mr-2 text-amber-500" /> Detect & Split Scanned Photos
      </Button>
    </div>
  </SidebarSection>

  <SidebarSection title="Extraction & Sanitization" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Clean sensitive metadata, extract assets, and purge artifacts.</p>

    <div class="flex flex-col gap-2">
      <Button
        variant="default"
        size="sm"
        class="w-full justify-start text-xs h-8 font-medium"
        onclick={() => actions.openSanitizeDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <ShieldCheck class="h-3.5 w-3.5 mr-2 text-primary-foreground" /> Sanitise Document
      </Button>

      <div class="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          class="justify-start text-xs h-8 px-2.5"
          onclick={() => triggerTool('Extract Pages')}
          disabled={!store.isDocumentLoaded}
        >
          <FileOutput class="h-3.5 w-3.5 mr-1.5 text-muted-foreground" /> Extract Pages
        </Button>

        <Button
          variant="outline"
          size="sm"
          class="justify-start text-xs h-8 px-2.5"
          onclick={() => triggerTool('Extract Images')}
          disabled={!store.isDocumentLoaded}
        >
          <Image class="h-3.5 w-3.5 mr-1.5 text-muted-foreground" /> Extract Images
        </Button>

        <Button
          variant="outline"
          size="sm"
          class="justify-start text-xs h-8 px-2.5"
          onclick={() => triggerTool('Remove Blank Pages')}
          disabled={!store.isDocumentLoaded}
        >
          <FileX class="h-3.5 w-3.5 mr-1.5 text-destructive" /> Remove Blanks
        </Button>

        <Button
          variant="outline"
          size="sm"
          class="justify-start text-xs h-8 px-2.5"
          onclick={() => actions.openSanitizeDialog()}
          disabled={!store.isDocumentLoaded}
        >
          <Trash2 class="h-3.5 w-3.5 mr-1.5 text-destructive" /> Clear Annotations
        </Button>
      </div>
    </div>
  </SidebarSection>

  <SidebarSection title="Headers, Footers & Page Numbers" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Insert dynamic page numbering and custom header/footer text.</p>

    <div class="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Add Page Numbers')}
        disabled={!store.isDocumentLoaded}
      >
        <Hash class="h-3.5 w-3.5 mr-2 text-primary" /> Add Page Numbers
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Header & Footer Text')}
        disabled={!store.isDocumentLoaded}
      >
        <Layers class="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Header & Footer Text
      </Button>
    </div>
  </SidebarSection>

  <SidebarSection title="Page Imposition & Layout" borderBottom={false}>
    <p class="text-xs text-muted-foreground mb-2">Impose pages for booklet printing, n-up sheets, or continuous canvas.</p>

    <div class="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => store.openImpositionDialog('nup')}
        disabled={!store.isDocumentLoaded}
      >
        <LayoutGrid class="h-3.5 w-3.5 mr-2 text-primary" /> Multi-Page Layout (N-Up)
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => store.openImpositionDialog('booklet')}
        disabled={!store.isDocumentLoaded}
      >
        <BookOpenCheck class="h-3.5 w-3.5 mr-2 text-emerald-500" /> Booklet (Saddle Stitch)
      </Button>

      <Button
        variant="ghost"
        size="sm"
        class="w-full justify-between text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
        onclick={() => { store.leftPanelMode = 'imposition'; }}
      >
        <span>Open full Imposition panel</span>
        <ArrowRight class="h-3 w-3 ml-1" />
      </Button>
    </div>
  </SidebarSection>
</div>

