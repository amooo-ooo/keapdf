<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../../core/feature-flags';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { BringToFront, SendToBack, ArrowUp, ArrowDown } from 'lucide-svelte';

  let { embedded = false }: { embedded?: boolean } = $props();

  const canvasStore = useCanvasStore();
  const editorStore = useEditorStore();
  const editorActions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  const isReadOnlyMode = $derived(editorStore.isReadOnly);

  const activeElement = $derived.by(() => {
    if (canvasStore.selectedElement) {
      return canvasStore.selectedElement;
    }
    if (canvasStore.selectedElementId) {
      return {
        id: canvasStore.selectedElementId,
        kind: 'canvas-element',
      };
    }
    const span = editorStore.selectedSpan;
    if (span) {
      return {
        id: span.id,
        kind: span.type,
      };
    }
    return null;
  });

  const isCanvasElement = $derived(Boolean(canvasStore.selectedElement));
  const orderMetrics = $derived(
    canvasStore.selectedElement
      ? canvasStore.getElementOrder(canvasStore.selectedElement.id)
      : { isAtTop: false, isAtBottom: false, isBehindPdf: false, index: -1, total: 0 }
  );

  const isTopDisabled = $derived(isReadOnlyMode || (isCanvasElement && orderMetrics.isAtTop));
  const isBottomDisabled = $derived(isReadOnlyMode || (isCanvasElement && orderMetrics.isAtBottom));

  async function handleReorder(direction: 'front' | 'back' | 'forward' | 'backward'): Promise<void> {
    if (isReadOnlyMode) return;
    await editorActions.reorderSelected(direction);
  }
</script>

{#if activeElement && featureFlags.isEnabled('canvas-elements.arrange')}
  {#snippet arrangeControls()}
    <ButtonGroup variant="ghost" size="sm" class="h-8 w-full">
      <Button
        variant="ghost"
        class="flex-1 px-2"
        onclick={() => void handleReorder('front')}
        title="Bring to Front (Ctrl+Shift+])"
        aria-label="Bring to Front"
        disabled={isTopDisabled}
      >
        <BringToFront class="h-4 w-4" aria-hidden="true" />
      </Button>

      <Button
        variant="ghost"
        class="flex-1 px-2"
        onclick={() => void handleReorder('forward')}
        title="Bring Forward (Ctrl+])"
        aria-label="Bring Forward"
        disabled={isTopDisabled}
      >
        <ArrowUp class="h-4 w-4" aria-hidden="true" />
      </Button>

      <Button
        variant="ghost"
        class="flex-1 px-2"
        onclick={() => void handleReorder('backward')}
        title="Send Backward (Ctrl+[)"
        aria-label="Send Backward"
        disabled={isBottomDisabled}
      >
        <ArrowDown class="h-4 w-4" aria-hidden="true" />
      </Button>

      <Button
        variant="ghost"
        class="flex-1 px-2"
        onclick={() => void handleReorder('back')}
        title="Send to Back (Ctrl+Shift+[)"
        aria-label="Send to Back"
        disabled={isBottomDisabled}
      >
        <SendToBack class="h-4 w-4" aria-hidden="true" />
      </Button>
    </ButtonGroup>
  {/snippet}

  {#if embedded}
    <div class="field-group">
      <Label class="field-label">Arrange</Label>
      {@render arrangeControls()}
    </div>
  {:else}
    <SidebarSection title="Arrange" borderBottom={true} collapsible={true} defaultExpanded={true}>
      {@render arrangeControls()}
    </SidebarSection>
  {/if}
{/if}
