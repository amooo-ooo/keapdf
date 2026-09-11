<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import { useFeatureFlagStore } from '../../../core/feature-flags';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Copy, Trash2, Lock, Unlock } from 'lucide-svelte';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();
  const featureFlags = useFeatureFlagStore();

  function updateProp(propName: string, value: boolean): void {
    const selected = canvasStore.selectedElementId;
    if (selected) {
      canvasActions.updateElementProperties(selected, { [propName]: value });
    }
  }
</script>

{#if canvasStore.selectedElement}
  {@const element = canvasStore.selectedElement}
  <SidebarSection title="Actions" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <ButtonGroup orientation="vertical" variant="outline" class="w-full">
      {#if featureFlags.isEnabled('canvas-elements.duplicate')}
      <Button variant="panel-action" onclick={() => canvasActions.duplicateSelectedElement()}>
        <Copy class="h-3.5 w-3.5 mr-2" /> Duplicate
      </Button>
      {/if}
      {#if featureFlags.isEnabled('canvas-elements.lock')}
      <Button variant="panel-action" onclick={() => updateProp('locked', !element.locked)}>
        {#if element.locked}
          <Unlock class="h-3.5 w-3.5 mr-2" /> Unlock
        {:else}
          <Lock class="h-3.5 w-3.5 mr-2" /> Lock
        {/if}
      </Button>
      {/if}
      {#if featureFlags.isEnabled('canvas-elements.delete')}
      <Button variant="panel-action" class="text-destructive hover:text-destructive hover:bg-destructive/10" disabled={element.locked} onclick={() => canvasActions.deleteSelectedElement()}>
        <Trash2 class="h-3.5 w-3.5 mr-2" /> Delete Element
      </Button>
      {/if}
    </ButtonGroup>
  </SidebarSection>
{/if}
