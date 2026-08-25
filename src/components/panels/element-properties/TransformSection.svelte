<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { FlipHorizontal, FlipVertical, RotateCcw } from 'lucide-svelte';

  const canvasStore = useCanvasStore();

  function toggleFlip(axis: 'flipX' | 'flipY'): void {
    const selected = canvasStore.selectedElementId;
    const element = canvasStore.selectedElement;
    if (selected && element) {
      // @ts-ignore
      canvasStore.updateElementProperties(selected, { [axis]: !element[axis] });
    }
  }

  function resetRotation(): void {
    const selected = canvasStore.selectedElementId;
    if (selected) {
      canvasStore.updateElementProperties(selected, { rotation: 0 });
    }
  }
</script>

{#if canvasStore.selectedElement && (canvasStore.selectedElement.kind === 'shape' || canvasStore.selectedElement.kind === 'image')}
  <SidebarSection title="Transform" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="grid grid-cols-3 gap-2">
      <Button 
        variant="outline" 
        size="sm" 
        class="h-8 px-2 flex flex-col gap-1 {canvasStore.selectedElement.flipX ? 'bg-primary/10 border-primary' : ''}" 
        onclick={() => toggleFlip('flipX')}
        title="Flip Horizontal"
      >
        <FlipHorizontal class="h-4 w-4" />
      </Button>
      
      <Button 
        variant="outline" 
        size="sm" 
        class="h-8 px-2 flex flex-col gap-1 {canvasStore.selectedElement.flipY ? 'bg-primary/10 border-primary' : ''}" 
        onclick={() => toggleFlip('flipY')}
        title="Flip Vertical"
      >
        <FlipVertical class="h-4 w-4" />
      </Button>

      <Button 
        variant="outline" 
        size="sm" 
        class="h-8 px-2 flex flex-col gap-1" 
        onclick={resetRotation}
        title="Reset Rotation"
        disabled={canvasStore.selectedElement.rotation === 0}
      >
        <RotateCcw class="h-4 w-4" />
      </Button>
    </div>
  </SidebarSection>
{/if}
