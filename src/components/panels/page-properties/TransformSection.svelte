<script lang="ts">
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import { RotateCw, Crop, Scaling } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import SidebarSection from '../../common/SidebarSection.svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

  function triggerTool(toolName: string): void {
    store.activeMockupTool = toolName;
  }
</script>

<SidebarSection title="Transform" borderBottom={true} collapsible={true} defaultExpanded={true}>
  {#if store.isDocumentLoaded}
    <div class="field-group">
      <Button variant="outline" class="btn-action" onclick={() => actions.rotatePage(store.currentPageIndex)}>
        <RotateCw class="h-3.5 w-3.5 mr-2" /> Rotate
      </Button>
      <Button variant="outline" class="btn-action" onclick={() => triggerTool('Adjust Page Size / Scale')}>
        <Scaling class="h-3.5 w-3.5 mr-2" /> Scale / Size
      </Button>
      <Button variant="outline" class="btn-action" onclick={() => triggerTool('Crop Page')}>
        <Crop class="h-3.5 w-3.5 mr-2" /> Crop Page
      </Button>
    </div>
  {:else}
    <div class="text-xs text-muted-foreground italic">No document loaded</div>
  {/if}
</SidebarSection>
