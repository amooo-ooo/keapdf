<script lang="ts">
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import PositionSizeSection from './element-properties/PositionSizeSection.svelte';
  import TextSection from './element-properties/TextSection.svelte';
  import ShapeSection from './element-properties/ShapeSection.svelte';
  import FormFieldSection from './element-properties/FormFieldSection.svelte';
  import ImageSection from './element-properties/ImageSection.svelte';
  import NoteSection from './element-properties/NoteSection.svelte';
  import TransformSection from './element-properties/TransformSection.svelte';
  import ActionsSection from './element-properties/ActionsSection.svelte';

  const canvasStore = useCanvasStore();
</script>

{#if canvasStore.selectedElement}
  <div class="flex flex-col w-full shrink-0">
    <PositionSizeSection />
    <TransformSection />
    <TextSection />
    <ShapeSection />
    <FormFieldSection />
    <ImageSection />
    <NoteSection />
    <ActionsSection />
  </div>
{/if}
