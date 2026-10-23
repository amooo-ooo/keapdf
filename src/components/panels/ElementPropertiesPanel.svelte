<script lang="ts">
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useElementRegistry } from '../../core/element-registry';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import PositionSizeSection from './element-properties/PositionSizeSection.svelte';
  import TransformSection from './element-properties/TransformSection.svelte';
  import ArrangeSection from './element-properties/ArrangeSection.svelte';
  import ActionsSection from './element-properties/ActionsSection.svelte';

  const canvasStore = useCanvasStore();
  const elementRegistry = useElementRegistry();
  const featureFlags = useFeatureFlagStore();

  const selectedElement = $derived(canvasStore.selectedElement);
  const elementDef = $derived(selectedElement ? elementRegistry.get(selectedElement.kind) : null);
</script>

{#if selectedElement}
  <div class="flex flex-col w-full shrink-0 py-1">
    <PositionSizeSection />
    {#if !featureFlags.isEnabled('panels.unified-geometry')}
      <TransformSection />
      <ArrangeSection />
    {/if}
    {#if elementDef?.propertiesPanel}
      {@const PanelComponent = elementDef.propertiesPanel}
      <PanelComponent element={selectedElement} />
    {/if}
    <ActionsSection />
  </div>
{:else}
  <div class="px-3 py-6 text-center text-xs text-muted-foreground">
    <p class="font-medium text-foreground mb-1">No element selected</p>
    <p class="text-pretty">Select an element on the page to inspect and adjust its properties.</p>
  </div>
{/if}
