<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { getSavedSignatures } from '../../services/signature-storage';
  import SidebarSection from '../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import {
    Highlighter,
    EyeOff,
    Pencil,
    PenTool,
    StickyNote,
    ShieldCheck,
    Clock,
    Sliders,
    BookOpen,
    CheckCircle2,
    Users
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

  const savedCount = $derived(store.showEsignDialog || true ? getSavedSignatures().length : 0);

  function selectTool(tool: 'highlight' | 'pen' | 'redact' | 'signature' | 'note'): void {
    if (store.activeTool === tool) {
      store.activeTool = 'select';
    } else {
      store.activeTool = tool;
    }
  }

  function triggerTool(toolName: string): void {
    store.activeMockupTool = toolName;
  }
</script>

<div class="flex flex-col min-h-0 divide-y divide-border">
  <SidebarSection title="Annotate" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Draw or highlight passages on the page.</p>
    
    <div class="flex flex-col gap-2">
      <div class="grid grid-cols-2 gap-2">
        <Button
          variant={store.activeTool === 'highlight' ? 'default' : 'outline'}
          size="sm"
          class="justify-start text-xs h-8 px-2.5"
          onclick={() => selectTool('highlight')}
          disabled={!store.isDocumentLoaded}
        >
          <Highlighter class="h-3.5 w-3.5 mr-1.5 text-amber-500" /> Highlighter
        </Button>
        <Button
          variant={store.activeTool === 'pen' ? 'default' : 'outline'}
          size="sm"
          class="justify-start text-xs h-8 px-2.5"
          onclick={() => selectTool('pen')}
          disabled={!store.isDocumentLoaded}
        >
          <Pencil class="h-3.5 w-3.5 mr-1.5 text-primary" /> Pen
        </Button>
      </div>

      <div class="flex items-center gap-1.5 pt-1">
        <span class="text-[11px] text-muted-foreground mr-1">Color:</span>
        <button
          type="button"
          class="w-5 h-5 rounded-full bg-yellow-300 border border-yellow-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#fde047' ? 'ring-2 ring-primary' : ''}"
          onclick={() => { store.annotateColor = '#fde047'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen') selectTool('highlight'); }}
          title="Yellow"
        ></button>
        <button
          type="button"
          class="w-5 h-5 rounded-full bg-green-300 border border-green-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#86efac' ? 'ring-2 ring-primary' : ''}"
          onclick={() => { store.annotateColor = '#86efac'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen') selectTool('highlight'); }}
          title="Green"
        ></button>
        <button
          type="button"
          class="w-5 h-5 rounded-full bg-sky-300 border border-sky-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#7dd3fc' ? 'ring-2 ring-primary' : ''}"
          onclick={() => { store.annotateColor = '#7dd3fc'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen') selectTool('highlight'); }}
          title="Blue"
        ></button>
        <button
          type="button"
          class="w-5 h-5 rounded-full bg-pink-300 border border-pink-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#f472b6' ? 'ring-2 ring-primary' : ''}"
          onclick={() => { store.annotateColor = '#f472b6'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen') selectTool('highlight'); }}
          title="Pink"
        ></button>
        <button
          type="button"
          class="w-5 h-5 rounded-full bg-orange-300 border border-orange-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#fdba74' ? 'ring-2 ring-primary' : ''}"
          onclick={() => { store.annotateColor = '#fdba74'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen') selectTool('highlight'); }}
          title="Orange"
        ></button>
      </div>
    </div>
  </SidebarSection>

  <SidebarSection title="Redaction & Privacy" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Permanently obscure sensitive content or PII.</p>
    
    <div class="flex flex-col gap-2">
      <Button
        variant={store.activeTool === 'redact' ? 'default' : 'outline'}
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => selectTool('redact')}
        disabled={!store.isDocumentLoaded}
      >
        <EyeOff class="h-3.5 w-3.5 mr-2 text-destructive" /> Redact Area (Blackout)
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Sanitize Document')}
        disabled={!store.isDocumentLoaded}
      >
        <ShieldCheck class="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Sanitize Document
      </Button>
      
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Adjust Colors / Contrast / Invert')}
        disabled={!store.isDocumentLoaded}
      >
        <Sliders class="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Adjust Colors / Contrast
      </Button>
    </div>
  </SidebarSection>

  <SidebarSection title="Signatures & Verification" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Digital PKCS#12 certificates & signature validation.</p>
    
    <div class="grid grid-cols-2 gap-2">
      <Button
        variant="outline"
        size="sm"
        class="justify-start text-xs h-8 px-2.5 relative"
        onclick={() => actions.openEsignDialog('signatures')}
        disabled={!store.isDocumentLoaded}
      >
        <PenTool class="h-3.5 w-3.5 mr-1.5 text-primary" /> Add E-Sign
        {#if savedCount > 0}
          <span class="ml-auto bg-primary/10 text-primary text-[10px] font-semibold px-1 rounded">
            {savedCount}
          </span>
        {/if}
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="justify-start text-xs h-8 px-2.5"
        onclick={() => actions.openCertSignDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <ShieldCheck class="h-3.5 w-3.5 mr-1.5 text-primary" /> Cert Sign
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="justify-start text-xs h-8 px-2.5"
        onclick={() => actions.openValidateSignaturesDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <CheckCircle2 class="h-3.5 w-3.5 mr-1.5 text-emerald-500" /> Validate
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="justify-start text-xs h-8 px-2.5"
        onclick={() => triggerTool('Timestamp PDF')}
        disabled={!store.isDocumentLoaded}
      >
        <Clock class="h-3.5 w-3.5 mr-1.5 text-muted-foreground" /> Timestamp
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="col-span-2 justify-start text-xs h-8 px-2.5"
        onclick={() => triggerTool('Shared Signing')}
        disabled={!store.isDocumentLoaded}
      >
        <Users class="h-3.5 w-3.5 mr-2 text-primary" /> Shared Signing Workflow
      </Button>
    </div>
  </SidebarSection>

  <SidebarSection title="Notes & Review" borderBottom={false}>
    <p class="text-xs text-muted-foreground mb-2">Sticky note comments and reader viewing mode.</p>
    
    <div class="flex flex-col gap-2">
      <Button
        variant={store.activeTool === 'note' ? 'default' : 'outline'}
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => selectTool('note')}
        disabled={!store.isDocumentLoaded}
      >
        <StickyNote class="h-3.5 w-3.5 mr-2 text-amber-500" /> Sticky Note Comment
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Read View Mode')}
        disabled={!store.isDocumentLoaded}
      >
        <BookOpen class="h-3.5 w-3.5 mr-2 text-primary" /> Read View Mode
      </Button>
    </div>
  </SidebarSection>
</div>
