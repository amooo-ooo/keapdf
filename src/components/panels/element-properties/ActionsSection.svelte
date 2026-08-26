<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Copy, Trash2, Lock, Unlock } from 'lucide-svelte';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  function updateProp(propName: string, value: boolean): void {
    const selected = canvasStore.selectedElementId;
    if (selected) {
      canvasStore.updateElementProperties(selected, { [propName]: value });
    }
  }
</script>

{#if canvasStore.selectedElement}
  {@const element = canvasStore.selectedElement}
  <SidebarSection title="Actions" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="field-group">
      <Button variant="outline" class="btn-action" onclick={() => canvasActions.duplicateSelectedElement()}>
        <Copy class="h-3.5 w-3.5 mr-2" /> Duplicate
      </Button>
      <Button variant="outline" class="btn-action" onclick={() => updateProp('locked', !element.locked)}>
        {#if element.locked}
          <Unlock class="h-3.5 w-3.5 mr-2" /> Unlock
        {:else}
          <Lock class="h-3.5 w-3.5 mr-2" /> Lock
        {/if}
      </Button>
      <Button variant="outline" class="btn-action text-destructive hover:text-destructive hover:bg-destructive/10" onclick={() => canvasActions.deleteSelectedElement()}>
        <Trash2 class="h-3.5 w-3.5 mr-2" /> Delete Element
      </Button>
    </div>
  </SidebarSection>
{/if}
