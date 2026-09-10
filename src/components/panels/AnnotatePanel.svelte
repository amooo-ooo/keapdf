<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import { getSavedSignatures } from '../../services/signature-storage';
  import SidebarSection from '../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
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
    Users,
    Eraser
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();
  let savedCount = $state(0);

  $effect(() => {
    // Re-evaluate signature count when dialog opens or closes
    void store.showEsignDialog;
    savedCount = getSavedSignatures().length;
  });
  function selectTool(tool: 'highlight' | 'pen' | 'redact' | 'signature' | 'note' | 'eraser'): void {
    if (store.activeTool === tool) {
      actions.setTool('select');
    } else {
      actions.setTool(tool);
    }
  }

  const PRESET_ANNOTATE_COLORS = ['#fde047', '#86efac', '#7dd3fc', '#f472b6', '#fdba74'];
  const isCustomAnnotateColor = $derived(!PRESET_ANNOTATE_COLORS.includes(store.annotateColor));

  function triggerTool(toolName: string): void {
    store.activeMockupTool = toolName;
  }
</script>

<div class="flex flex-col min-h-0 divide-y divide-border">
  {#if featureFlags.isEnabled('annotations')}
  <SidebarSection title="Annotate" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Draw or highlight passages on the page.</p>
    
    <div class="flex flex-col gap-2">
      <div class="grid grid-cols-2 gap-2">
        {#if featureFlags.isEnabled('annotations.highlighter')}
        <Button
          variant={store.activeTool === 'highlight' ? 'default' : 'outline'}
          size="sm"
          class="justify-start text-xs h-8 px-2.5"
          onclick={() => selectTool('highlight')}
          disabled={!store.isDocumentLoaded}
        >
          <Highlighter class="h-3.5 w-3.5 mr-1.5 text-warning" /> Highlighter
        </Button>
        {/if}
        {#if featureFlags.isEnabled('annotations.pen')}
        <Button
          variant={store.activeTool === 'pen' ? 'default' : 'outline'}
          size="sm"
          class="justify-start text-xs h-8 px-2.5"
          onclick={() => selectTool('pen')}
          disabled={!store.isDocumentLoaded}
        >
          <Pencil class="h-3.5 w-3.5 mr-1.5 text-primary" /> Pen
        </Button>
        {/if}
        {#if featureFlags.isEnabled('annotations.eraser')}
        <Button
          variant={store.activeTool === 'eraser' ? 'default' : 'outline'}
          size="sm"
          class="col-span-2 justify-start text-xs h-8 px-2.5"
          onclick={() => selectTool('eraser')}
          disabled={!store.isDocumentLoaded}
        >
          <Eraser class="h-3.5 w-3.5 mr-1.5 text-destructive" /> Eraser
        </Button>
        {/if}
      </div>

      {#if featureFlags.isEnabled('annotations.colors')}
      <div class="flex items-center justify-between pt-1 w-full">
        <span class="text-[11px] text-muted-foreground">Color:</span>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="w-5 h-5 rounded-full bg-yellow-300 border border-yellow-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#fde047' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            onclick={() => { store.annotateColor = '#fde047'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen' && store.activeTool !== 'note') selectTool('highlight'); }}
            disabled={!store.isDocumentLoaded}
            title="Yellow"
            aria-label="Yellow"
          ></button>
          <button
            type="button"
            class="w-5 h-5 rounded-full bg-green-300 border border-green-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#86efac' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            onclick={() => { store.annotateColor = '#86efac'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen' && store.activeTool !== 'note') selectTool('highlight'); }}
            disabled={!store.isDocumentLoaded}
            title="Green"
            aria-label="Green"
          ></button>
          <button
            type="button"
            class="w-5 h-5 rounded-full bg-sky-300 border border-sky-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#7dd3fc' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            onclick={() => { store.annotateColor = '#7dd3fc'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen' && store.activeTool !== 'note') selectTool('highlight'); }}
            disabled={!store.isDocumentLoaded}
            title="Blue"
            aria-label="Blue"
          ></button>
          <button
            type="button"
            class="w-5 h-5 rounded-full bg-pink-300 border border-pink-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#f472b6' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            onclick={() => { store.annotateColor = '#f472b6'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen' && store.activeTool !== 'note') selectTool('highlight'); }}
            disabled={!store.isDocumentLoaded}
            title="Pink"
            aria-label="Pink"
          ></button>
          <button
            type="button"
            class="w-5 h-5 rounded-full bg-orange-300 border border-orange-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#fdba74' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            onclick={() => { store.annotateColor = '#fdba74'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen' && store.activeTool !== 'note') selectTool('highlight'); }}
            disabled={!store.isDocumentLoaded}
            title="Orange"
            aria-label="Orange"
          ></button>
          <ColorPicker
            variant="circle"
            value={store.annotateColor}
            disabled={!store.isDocumentLoaded}
            onValueChange={(val) => {
              store.annotateColor = val;
              if (store.activeTool !== 'highlight' && store.activeTool !== 'pen' && store.activeTool !== 'note') selectTool('highlight');
            }}
            label="Custom Color"
            class="size-5 {isCustomAnnotateColor ? 'ring-2 ring-primary ring-offset-1' : ''}"
          />
        </div>
      </div>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('redaction')}
  <SidebarSection title="Redaction & Privacy" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Permanently obscure sensitive content or PII.</p>
    
    <div class="flex flex-col gap-2">
      {#if featureFlags.isEnabled('redaction.area')}
      <Button
        variant={store.activeTool === 'redact' ? 'default' : 'outline'}
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => selectTool('redact')}
        disabled={!store.isDocumentLoaded}
      >
        <EyeOff class="h-3.5 w-3.5 mr-2 text-destructive" /> Redact Area (Blackout)
      </Button>
      {/if}

      {#if featureFlags.isEnabled('sanitization') || featureFlags.isEnabled('redaction.sanitize')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => actions.openSanitizeDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <ShieldCheck class="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Sanitize Document
      </Button>
      {/if}
      
      {#if featureFlags.isEnabled('redaction.colors')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Adjust Colors / Contrast / Invert')}
        disabled={!store.isDocumentLoaded}
      >
        <Sliders class="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Adjust Colors / Contrast
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('signatures')}
  <SidebarSection title="Signatures & Verification" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Digital PKCS#12 certificates & signature validation.</p>
    
    <div class="grid grid-cols-2 gap-2">
      {#if featureFlags.isEnabled('signatures.esign')}
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
      {/if}

      {#if featureFlags.isEnabled('signatures.cert-sign')}
      <Button
        variant="outline"
        size="sm"
        class="justify-start text-xs h-8 px-2.5"
        onclick={() => actions.openCertSignDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <ShieldCheck class="h-3.5 w-3.5 mr-1.5 text-primary" /> Cert Sign
      </Button>
      {/if}

      {#if featureFlags.isEnabled('signatures.validate')}
      <Button
        variant="outline"
        size="sm"
        class="justify-start text-xs h-8 px-2.5"
        onclick={() => actions.openValidateSignaturesDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <CheckCircle2 class="h-3.5 w-3.5 mr-1.5 text-success" /> Validate
      </Button>
      {/if}

      {#if featureFlags.isEnabled('signatures.timestamp')}
      <Button
        variant="outline"
        size="sm"
        class="justify-start text-xs h-8 px-2.5"
        onclick={() => triggerTool('Timestamp PDF')}
        disabled={!store.isDocumentLoaded}
      >
        <Clock class="h-3.5 w-3.5 mr-1.5 text-muted-foreground" /> Timestamp
      </Button>
      {/if}

      {#if featureFlags.isEnabled('signatures.shared')}
      <Button
        variant="outline"
        size="sm"
        class="col-span-2 justify-start text-xs h-8 px-2.5"
        onclick={() => triggerTool('Shared Signing')}
        disabled={!store.isDocumentLoaded}
      >
        <Users class="h-3.5 w-3.5 mr-2 text-primary" /> Shared Signing Workflow
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('annotations.note') || featureFlags.isEnabled('annotations.read-view')}
  <SidebarSection title="Notes & Review" borderBottom={false}>
    <p class="text-xs text-muted-foreground mb-2">Sticky note comments and reader viewing mode.</p>
    
    <div class="flex flex-col gap-2">
      {#if featureFlags.isEnabled('annotations.note')}
      <Button
        variant={store.activeTool === 'note' ? 'default' : 'outline'}
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => selectTool('note')}
        disabled={!store.isDocumentLoaded}
      >
        <StickyNote class="h-3.5 w-3.5 mr-2 text-warning" /> Sticky Note Comment
      </Button>
      {/if}

      {#if featureFlags.isEnabled('annotations.read-view')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Read View Mode')}
        disabled={!store.isDocumentLoaded}
      >
        <BookOpen class="h-3.5 w-3.5 mr-2 text-primary" /> Read View Mode
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}
</div>
