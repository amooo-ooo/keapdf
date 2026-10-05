<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import {
    Highlighter,
    Pencil,
    Eraser,
    StickyNote,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  function selectTool(tool: 'highlight' | 'pen' | 'eraser' | 'note'): void {
    if (store.activeTool === tool) {
      actions.setTool('select');
    } else {
      actions.setTool(tool);
    }
  }

  const PRESET_ANNOTATE_COLORS = ['#fde047', '#86efac', '#7dd3fc', '#f472b6', '#fdba74'];
  const isCustomAnnotateColor = $derived(!PRESET_ANNOTATE_COLORS.includes(store.annotateColor));

  const canAnnotate = $derived(store.canAnnotate && !store.isReadOnly);
  const isSuggesting = $derived(store.isSuggestingMode);

  function applyColor(color: string): void {
    store.annotateColor = color;
    if (store.activeTool !== 'highlight' && store.activeTool !== 'pen' && store.activeTool !== 'note') {
      selectTool('highlight');
    }
  }
</script>

{#if featureFlags.isEnabled('annotations')}
<header
  role="toolbar"
  aria-label="Annotation toolbar"
  class="viewer-topbar flex items-center justify-between h-7 px-2.5 shrink-0 select-none min-w-0"
>
  <!-- note: essential annotation markup tools -->
  <div class="flex items-center gap-1 shrink-0">
    {#if featureFlags.isEnabled('annotations.highlighter')}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            class="h-7 w-7 {store.activeTool === 'highlight' ? 'bg-accent text-accent-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => selectTool('highlight')}
            disabled={!store.isDocumentLoaded || !canAnnotate}
            aria-label="Highlighter"
            aria-pressed={store.activeTool === 'highlight'}
          >
            <Highlighter class="w-3.5 h-3.5 text-warning" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">Highlighter (Shift+H)</Tooltip.Content>
    </Tooltip.Root>
    {/if}

    {#if featureFlags.isEnabled('annotations.pen')}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            class="h-7 w-7 {store.activeTool === 'pen' ? 'bg-accent text-accent-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => selectTool('pen')}
            disabled={!store.isDocumentLoaded || !canAnnotate || isSuggesting}
            aria-label="Pen tool"
            aria-pressed={store.activeTool === 'pen'}
          >
            <Pencil class="w-3.5 h-3.5 text-primary" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">Pen (P)</Tooltip.Content>
    </Tooltip.Root>
    {/if}

    {#if featureFlags.isEnabled('annotations.eraser')}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            class="h-7 w-7 {store.activeTool === 'eraser' ? 'bg-accent text-accent-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => selectTool('eraser')}
            disabled={!store.isDocumentLoaded || !canAnnotate || isSuggesting}
            aria-label="Eraser tool"
            aria-pressed={store.activeTool === 'eraser'}
          >
            <Eraser class="w-3.5 h-3.5 text-destructive" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">Eraser (E)</Tooltip.Content>
    </Tooltip.Root>
    {/if}

    {#if featureFlags.isEnabled('annotations.note')}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            class="h-7 w-7 {store.activeTool === 'note' ? 'bg-accent text-accent-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => selectTool('note')}
            disabled={!store.isDocumentLoaded || !canAnnotate}
            aria-label="Sticky note comment"
            aria-pressed={store.activeTool === 'note'}
          >
            <StickyNote class="w-3.5 h-3.5 text-warning" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">Sticky Note (N)</Tooltip.Content>
    </Tooltip.Root>
    {/if}
  </div>

  <!-- note: colour palette presets and stroke width controls -->
  {#if featureFlags.isEnabled('annotations.colors')}
  <div class="flex items-center gap-2 shrink-0">
    <div class="flex items-center gap-1.5">
      <button
        type="button"
        class="w-4.5 h-4.5 rounded-full bg-yellow-300 border border-yellow-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#fde047' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        onclick={() => applyColor('#fde047')}
        disabled={!store.isDocumentLoaded || !canAnnotate}
        title="Yellow"
        aria-label="Yellow"
        aria-pressed={store.annotateColor === '#fde047'}
      ></button>
      <button
        type="button"
        class="w-4.5 h-4.5 rounded-full bg-green-300 border border-green-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#86efac' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        onclick={() => applyColor('#86efac')}
        disabled={!store.isDocumentLoaded || !canAnnotate}
        title="Green"
        aria-label="Green"
        aria-pressed={store.annotateColor === '#86efac'}
      ></button>
      <button
        type="button"
        class="w-4.5 h-4.5 rounded-full bg-sky-300 border border-sky-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#7dd3fc' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        onclick={() => applyColor('#7dd3fc')}
        disabled={!store.isDocumentLoaded || !canAnnotate}
        title="Blue"
        aria-label="Blue"
        aria-pressed={store.annotateColor === '#7dd3fc'}
      ></button>
      <button
        type="button"
        class="w-4.5 h-4.5 rounded-full bg-pink-300 border border-pink-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#f472b6' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        onclick={() => applyColor('#f472b6')}
        disabled={!store.isDocumentLoaded || !canAnnotate}
        title="Pink"
        aria-label="Pink"
        aria-pressed={store.annotateColor === '#f472b6'}
      ></button>
      <button
        type="button"
        class="w-4.5 h-4.5 rounded-full bg-orange-300 border border-orange-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#fdba74' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        onclick={() => applyColor('#fdba74')}
        disabled={!store.isDocumentLoaded || !canAnnotate}
        title="Orange"
        aria-label="Orange"
        aria-pressed={store.annotateColor === '#fdba74'}
      ></button>
      <ColorPicker
        variant="circle"
        value={store.annotateColor}
        disabled={!store.isDocumentLoaded || !canAnnotate}
        onValueChange={applyColor}
        label="Custom Colour"
        class="size-4.5 {isCustomAnnotateColor ? 'ring-2 ring-primary ring-offset-1' : ''}"
      />
    </div>

    <!-- note: stroke width buttons when pen tool is active -->
    {#if store.activeTool === 'pen'}
      <div class="h-3.5 w-px bg-border/60 mx-0.5 shrink-0" role="separator" aria-orientation="vertical"></div>
      <ButtonGroup variant="outline" size="sm" class="h-6" aria-label="Stroke width">
        <Button
          variant={store.annotateStrokeWidth === 1 ? 'default' : 'outline'}
          class="px-1.5 text-[10px] h-6"
          onclick={() => { store.annotateStrokeWidth = 1; }}
          disabled={!store.isDocumentLoaded || !canAnnotate}
          aria-label="1 point stroke width"
          aria-pressed={store.annotateStrokeWidth === 1}
        >1pt</Button>
        <Button
          variant={store.annotateStrokeWidth === 2 ? 'default' : 'outline'}
          class="px-1.5 text-[10px] h-6"
          onclick={() => { store.annotateStrokeWidth = 2; }}
          disabled={!store.isDocumentLoaded || !canAnnotate}
          aria-label="2 point stroke width"
          aria-pressed={store.annotateStrokeWidth === 2}
        >2pt</Button>
        <Button
          variant={store.annotateStrokeWidth === 4 ? 'default' : 'outline'}
          class="px-1.5 text-[10px] h-6"
          onclick={() => { store.annotateStrokeWidth = 4; }}
          disabled={!store.isDocumentLoaded || !canAnnotate}
          aria-label="4 point stroke width"
          aria-pressed={store.annotateStrokeWidth === 4}
        >4pt</Button>
        <Button
          variant={store.annotateStrokeWidth === 6 ? 'default' : 'outline'}
          class="px-1.5 text-[10px] h-6"
          onclick={() => { store.annotateStrokeWidth = 6; }}
          disabled={!store.isDocumentLoaded || !canAnnotate}
          aria-label="6 point stroke width"
          aria-pressed={store.annotateStrokeWidth === 6}
        >6pt</Button>
      </ButtonGroup>
    {/if}
  </div>
  {/if}
</header>
{/if}
