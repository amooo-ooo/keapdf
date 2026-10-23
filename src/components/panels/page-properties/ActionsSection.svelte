<script lang="ts">
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../../core/feature-flags';
  import { Plus, Copy, Trash2, FileCheck, FileImage, Crop, Check, X } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import SidebarSection from '../../common/SidebarSection.svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  function handleApplyCrop(): void {
    if (store.activeCrop) {
      actions.cropPage(store.activeCrop.pageIndex, store.activeCrop.margins, store.activeCrop.scope);
    }
  }
</script>

<SidebarSection title="Page Actions" borderBottom={true} collapsible={true} defaultExpanded={true}>
  <div class="field-group">
    {#if featureFlags.isEnabled('page-actions.add-blank')}
    <Button
      variant="panel"
      onclick={() => actions.addBlankPage(store.currentPageIndex)}
      disabled={!store.isDocumentLoaded || store.isCropping || store.isReadOnly}
    >
      <Plus class="panel-icon-sm" /> Add Blank Page
    </Button>
    {/if}

    {#if featureFlags.isEnabled('page-actions.duplicate')}
    <Button
      variant="panel"
      onclick={() => actions.duplicatePage(store.currentPageIndex)}
      disabled={!store.isDocumentLoaded || store.isCropping || store.isReadOnly}
    >
      <Copy class="panel-icon-sm" /> Duplicate Page
    </Button>
    {/if}

    {#if featureFlags.isEnabled('crop') && featureFlags.isEnabled('page-actions.crop')}
    {#if !store.isCropping}
      <Button
        variant="panel"
        onclick={() => actions.startCropMode(store.currentPageIndex)}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <Crop class="panel-icon-sm" /> Crop Page
      </Button>
    {:else}
      <Button
        variant="panel"
        class="w-full justify-start px-2 h-8 text-xs font-normal"
        onclick={handleApplyCrop}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <Check class="panel-icon-sm" /> Apply Crop
      </Button>
      <Button
        variant="panel"
        class="text-muted-foreground hover:text-foreground"
        onclick={() => actions.cancelCropMode()}
        disabled={!store.isDocumentLoaded}
      >
        <X class="panel-icon-sm" /> Cancel Crop
      </Button>
    {/if}
    {/if}

    {#if featureFlags.isEnabled('flatten') && featureFlags.isEnabled('page-actions.flatten')}
    <Button
      variant="panel"
      onclick={() => actions.flattenPage(store.currentPageIndex)}
      disabled={!store.isDocumentLoaded || store.isCropping || store.isReadOnly}
    >
      <FileCheck class="panel-icon-sm" /> Flatten Page
    </Button>
    {/if}

    {#if featureFlags.isEnabled('rasterize') && featureFlags.isEnabled('page-actions.rasterize')}
    <Button
      variant="panel"
      onclick={() => actions.rasterizePage(store.currentPageIndex)}
      disabled={!store.isDocumentLoaded || store.isCropping || store.isReadOnly}
    >
      <FileImage class="panel-icon-sm" /> Rasterize Page
    </Button>
    {/if}

    {#if featureFlags.isEnabled('page-actions.delete')}
    <Button
      variant="panel"
      onclick={() => actions.deletePage(store.currentPageIndex)}
      disabled={!store.isDocumentLoaded || store.pageCount <= 1 || store.isCropping || store.isReadOnly}
    >
      <Trash2 class="panel-icon-sm" /> Delete Page
    </Button>
    {/if}
  </div>
</SidebarSection>
