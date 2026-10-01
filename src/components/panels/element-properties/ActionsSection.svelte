<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useFeatureFlagStore } from '../../../core/feature-flags';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Copy, Trash2, Lock, Unlock } from 'lucide-svelte';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();
  const editorStore = useEditorStore();
  const featureFlags = useFeatureFlagStore();

  const isReadOnlyMode = $derived(editorStore.isReadOnly);

  function updateProp(propName: string, value: boolean): void {
    if (isReadOnlyMode) return;
    const selected = canvasStore.selectedElementId;
    if (selected) {
      canvasActions.updateElementProperties(selected, { [propName]: value });
    }
  }
</script>

{#if canvasStore.selectedElement}
  {@const element = canvasStore.selectedElement}
  <SidebarSection title="Actions" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="field-group">
      {#if featureFlags.isEnabled('canvas-elements.duplicate')}
      <Button variant="panel" disabled={isReadOnlyMode} onclick={() => canvasActions.duplicateSelectedElement()}>
        <Copy class="panel-icon-sm" /> Duplicate
      </Button>
      {/if}
      {#if featureFlags.isEnabled('canvas-elements.lock')}
      <Button variant="panel" disabled={isReadOnlyMode} onclick={() => updateProp('locked', !element.locked)}>
        {#if element.locked}
          <Unlock class="panel-icon-sm" /> Unlock
        {:else}
          <Lock class="panel-icon-sm" /> Lock
        {/if}
      </Button>
      {/if}
      {#if featureFlags.isEnabled('canvas-elements.delete')}
      <Button variant="panel-destructive" disabled={element.locked || isReadOnlyMode || !editorStore.canDeleteElements} onclick={() => canvasActions.deleteSelectedElement()}>
        <Trash2 class="panel-icon-sm" /> Delete Element
      </Button>
      {/if}
    </div>
  </SidebarSection>
{/if}
