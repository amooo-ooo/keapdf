<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../../core/feature-flags';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { FlipHorizontal, FlipVertical } from 'lucide-svelte';

  let { embedded = false }: { embedded?: boolean } = $props();

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();
  const editorStore = useEditorStore();
  const editorActions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  const isReadOnlyMode = $derived(editorStore.isReadOnly);
  const isLocked = $derived(Boolean(canvasStore.selectedElement?.locked));
  const canTransform = $derived(!isReadOnlyMode && !isLocked && editorStore.canRotateElements);

  const activeElement = $derived.by(() => {
    const el = canvasStore.selectedElement;
    if (el && (el.kind === 'shape' || el.kind === 'image' || el.kind === 'text')) {
      return el;
    }
    const span = editorStore.selectedSpan;
    if (span && (span.type === 'image' || span.type === 'shape' || span.type === 'text')) {
      return {
        id: span.id,
        kind: span.type,
        flipX: 'flipX' in span ? Boolean(span.flipX) : false,
        flipY: 'flipY' in span ? Boolean(span.flipY) : false,
        rotation: span.rotation || 0,
      };
    }
    return null;
  });

  async function toggleFlip(axis: 'flipX' | 'flipY'): Promise<void> {
    if (!canTransform) return;
    const currentVal = activeElement && axis in activeElement ? Boolean(activeElement[axis]) : false;
    const multiModifyEnabled =
      featureFlags.isEnabled('select-tool.multiselect') &&
      featureFlags.isEnabled('select-tool.multiselect.modify');
    let selected = canvasStore.selectedElementId;
    if (
      editorStore.selectedSpan &&
      (editorStore.selectedSpan.type === 'image' ||
        editorStore.selectedSpan.type === 'shape' ||
        editorStore.selectedSpan.type === 'text') &&
      (!selected || (multiModifyEnabled && editorStore.selectedSpans.length > 0))
    ) {
      const extracted = multiModifyEnabled
        ? (await editorActions.extractSelectedSpansToCanvas(editorStore.selectedSpan, canvasStore)).primaryElementId
        : await editorActions.extractObjectToCanvas(editorStore.selectedSpan.type, editorStore.selectedSpan, canvasStore);
      selected = extracted ?? canvasStore.selectedElementId;
    }
    if (selected) {
      if (multiModifyEnabled && canvasStore.selectedElementIds.length > 1) {
        canvasActions.updateSelectedElementsProperties({ [axis]: !currentVal });
      } else {
        canvasActions.updateElementProperties(selected, { [axis]: !currentVal });
        canvasStore.selectElement(selected);
      }
    }
  }

</script>

{#if activeElement}
  {#snippet transformControls()}
    <ButtonGroup variant="ghost" size="sm" class={embedded ? 'h-8 shrink-0' : 'h-8 w-full'}>
      <Button 
        variant={activeElement.flipX ? 'default' : 'ghost'}
        size={embedded ? 'icon-sm' : undefined}
        class={embedded ? undefined : 'flex-1 px-2'} 
        onclick={(e) => {
          e.stopPropagation();
          void toggleFlip('flipX');
        }}
        title="Flip Horizontal"
        aria-label="Flip Horizontal"
        disabled={!canTransform}
      >
        <FlipHorizontal class="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      
      <Button 
        variant={activeElement.flipY ? 'default' : 'ghost'}
        size={embedded ? 'icon-sm' : undefined}
        class={embedded ? undefined : 'flex-1 px-2'} 
        onclick={(e) => {
          e.stopPropagation();
          void toggleFlip('flipY');
        }}
        title="Flip Vertical"
        aria-label="Flip Vertical"
        disabled={!canTransform}
      >
        <FlipVertical class="h-3.5 w-3.5" aria-hidden="true" />
      </Button>

    </ButtonGroup>
  {/snippet}

  {#if embedded}
    {@render transformControls()}
  {:else}
    <SidebarSection title="Transform" borderBottom={true} collapsible={true} defaultExpanded={true}>
      {@render transformControls()}
    </SidebarSection>
  {/if}
{/if}
