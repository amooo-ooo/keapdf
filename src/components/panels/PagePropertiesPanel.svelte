<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import TransformSection from './page-properties/TransformSection.svelte';
  import CropSection from './page-properties/CropSection.svelte';
  import ActionsSection from './page-properties/ActionsSection.svelte';
  import DocumentSection from './page-properties/DocumentSection.svelte';

  const store = useEditorStore();
</script>

<div class="flex flex-col w-full shrink-0">
  {#if store.isDocumentLoaded}
    <TransformSection />
  {/if}
  {#if store.isCropping}
    <CropSection />
  {/if}
  <ActionsSection />
  <DocumentSection />
</div>
