<script lang="ts">
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useElementRegistry } from '../../core/element-registry';
  import PositionSizeSection from './element-properties/PositionSizeSection.svelte';
  import TransformSection from './element-properties/TransformSection.svelte';
  import ActionsSection from './element-properties/ActionsSection.svelte';

  const canvasStore = useCanvasStore();
  const elementRegistry = useElementRegistry();

  const selectedElement = $derived(canvasStore.selectedElement);
  const elementDef = $derived(selectedElement ? elementRegistry.get(selectedElement.kind) : null);
</script>

{#if selectedElement}
  <div class="flex flex-col w-full shrink-0">
    <PositionSizeSection />
    <TransformSection />
    {#if elementDef?.propertiesPanel}
      {@const PanelComponent = elementDef.propertiesPanel}
      <PanelComponent element={selectedElement} />
    {/if}
    <ActionsSection />
  </div>
{/if}
