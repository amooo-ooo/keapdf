<script lang="ts">
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../../core/feature-flags';
  import { Plus, Copy, Trash2, FilePlus2, ImagePlus, FileCheck, Scissors, FileImage, Crop, Check, X, Sparkles, ScanText } from 'lucide-svelte';
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

<SidebarSection title="Actions" borderBottom={false} collapsible={true} defaultExpanded={true}>
  <div class="field-group">
    {#if featureFlags.isEnabled('crop') && featureFlags.isEnabled('page-actions.crop')}
    {#if !store.isCropping}
      <Button
        variant="panel-action"
        onclick={() => actions.startCropMode(store.currentPageIndex)}
        disabled={!store.isDocumentLoaded}
      >
        <Crop class="h-3.5 w-3.5 mr-2 text-primary" /> Crop Page
      </Button>
    {:else}
      <Button
        variant="default"
        class="w-full justify-start px-2.5 h-8 text-xs font-medium"
        onclick={handleApplyCrop}
        disabled={!store.isDocumentLoaded}
      >
        <Check class="h-3.5 w-3.5 mr-2" /> Apply Crop
      </Button>
      <Button
        variant="panel-action"
        class="text-muted-foreground hover:text-foreground"
        onclick={() => actions.cancelCropMode()}
        disabled={!store.isDocumentLoaded}
      >
        <X class="h-3.5 w-3.5 mr-2" /> Cancel Crop
      </Button>
    {/if}
    {/if}

    {#if featureFlags.isEnabled('page-actions.duplicate')}
    <Button
      variant="panel-action"
      onclick={() => actions.duplicatePage(store.currentPageIndex)}
      disabled={!store.isDocumentLoaded || store.isCropping}
    >
      <Copy class="h-3.5 w-3.5 mr-2" /> Duplicate Page
    </Button>
    {/if}

    {#if featureFlags.isEnabled('page-actions.add-blank')}
    <Button
      variant="panel-action"
      onclick={() => actions.addBlankPage(store.currentPageIndex)}
      disabled={!store.isDocumentLoaded || store.isCropping}
    >
      <Plus class="h-3.5 w-3.5 mr-2" /> Add Blank Page
    </Button>
    {/if}

    {#if featureFlags.isEnabled('page-actions.delete')}
    <Button
      variant="panel-action"
      class="text-destructive hover:text-destructive hover:bg-destructive/10"
      onclick={() => actions.deletePage(store.currentPageIndex)}
      disabled={!store.isDocumentLoaded || store.pageCount <= 1 || store.isCropping}
    >
      <Trash2 class="h-3.5 w-3.5 mr-2" /> Delete Page
    </Button>
    {/if}

    {#if featureFlags.isEnabled('outline') && featureFlags.isEnabled('page-actions.outline')}
    <Button
      variant="panel-action"
      onclick={() => actions.generateAutomaticOutline()}
      disabled={!store.isDocumentLoaded || store.isCropping}
    >
      <Sparkles class="h-3.5 w-3.5 mr-2 text-primary" /> Auto-generate Outline
    </Button>
    {/if}

    {#if featureFlags.isEnabled('ocr') && featureFlags.isEnabled('page-actions.ocr')}
    <Button
      variant="panel-action"
      onclick={() => actions.openOcrDialog()}
      disabled={!store.isDocumentLoaded || store.isCropping || store.isOcrRunning}
    >
      <ScanText class="h-3.5 w-3.5 mr-2 text-primary" /> Recognize Text (OCR)
    </Button>
    {/if}

    {#if featureFlags.isEnabled('merge') && featureFlags.isEnabled('page-actions.merge')}
    <Button
      variant="panel-action"
      onclick={() => actions.triggerMergeUpload()}
      disabled={!store.isDocumentLoaded || store.isCropping}
    >
      <FilePlus2 class="h-3.5 w-3.5 mr-2" /> Merge Files
    </Button>
    {/if}

    {#if featureFlags.isEnabled('page-actions.import-image')}
    <Button
      variant="panel-action"
      onclick={() => actions.triggerImageImportAsPage()}
      disabled={!store.isDocumentLoaded || store.isCropping}
    >
      <ImagePlus class="h-3.5 w-3.5 mr-2" /> Import Image
    </Button>
    {/if}

    {#if featureFlags.isEnabled('flatten') && featureFlags.isEnabled('page-actions.flatten')}
    <Button
      variant="panel-action"
      onclick={() => actions.flattenPage(store.currentPageIndex)}
      disabled={!store.isDocumentLoaded || store.isCropping}
    >
      <FileCheck class="h-3.5 w-3.5 mr-2" /> Flatten Page
    </Button>
    {/if}

    {#if featureFlags.isEnabled('rasterize') && featureFlags.isEnabled('page-actions.rasterize')}
    <Button
      variant="panel-action"
      onclick={() => actions.rasterizePage(store.currentPageIndex)}
      disabled={!store.isDocumentLoaded || store.isCropping}
    >
      <FileImage class="h-3.5 w-3.5 mr-2" /> Rasterize Page
    </Button>
    {/if}

    {#if featureFlags.isEnabled('split')}
    {#if featureFlags.isEnabled('page-actions.extract')}
    <Button
      variant="panel-action"
      onclick={() => { store.splitDialogMode = 'extract'; }}
      disabled={!store.isDocumentLoaded || store.isCropping}
    >
      <Copy class="h-3.5 w-3.5 mr-2" /> Extract Pages
    </Button>
    {/if}

    {#if featureFlags.isEnabled('page-actions.split')}
    <Button
      variant="panel-action"
      class="text-destructive hover:text-destructive hover:bg-destructive/10"
      onclick={() => { store.splitDialogMode = 'split'; }}
      disabled={!store.isDocumentLoaded || store.isCropping}
    >
      <Scissors class="h-3.5 w-3.5 mr-2" /> Split Pages
    </Button>
    {/if}
    {/if}
  </div>
</SidebarSection>
