<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { FlipHorizontal, FlipVertical, RotateCcw } from 'lucide-svelte';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  function toggleFlip(axis: 'flipX' | 'flipY'): void {
    const selected = canvasStore.selectedElementId;
    const element = canvasStore.selectedElement;
    if (selected && element && 'flipX' in element && 'flipY' in element) {
      canvasActions.updateElementProperties(selected, { [axis]: !element[axis] });
    }
  }

  function resetRotation(): void {
    const selected = canvasStore.selectedElementId;
    if (selected) {
      canvasActions.updateElementProperties(selected, { rotation: 0 });
    }
  }
</script>

{#if canvasStore.selectedElement && (canvasStore.selectedElement.kind === 'shape' || canvasStore.selectedElement.kind === 'image' || canvasStore.selectedElement.kind === 'text')}
  <SidebarSection title="Transform" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <ButtonGroup variant="outline" size="sm" class="w-full">
      <Button 
        variant={canvasStore.selectedElement.flipX ? 'default' : 'outline'}
        class="flex-1 h-8 px-2" 
        onclick={() => toggleFlip('flipX')}
        title="Flip Horizontal"
      >
        <FlipHorizontal class="h-4 w-4" />
      </Button>
      
      <Button 
        variant={canvasStore.selectedElement.flipY ? 'default' : 'outline'}
        class="flex-1 h-8 px-2" 
        onclick={() => toggleFlip('flipY')}
        title="Flip Vertical"
      >
        <FlipVertical class="h-4 w-4" />
      </Button>

      <Button 
        class="flex-1 h-8 px-2" 
        onclick={resetRotation}
        title="Reset Rotation"
        disabled={canvasStore.selectedElement.rotation === 0}
      >
        <RotateCcw class="h-4 w-4" />
      </Button>
    </ButtonGroup>
  </SidebarSection>
{/if}
