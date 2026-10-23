<script lang="ts">
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../../core/feature-flags';
  import {
    FilePlus2,
    ImagePlus,
    Scissors,
    ScanText,
    FileDown,
    Image,
    Copy,
  } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import SidebarSection from '../../common/SidebarSection.svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();
</script>

<SidebarSection title="Document Actions" borderBottom={false} collapsible={true} defaultExpanded={true}>
  <div class="field-group">

    {#if featureFlags.isEnabled('ocr') && featureFlags.isEnabled('page-actions.ocr')}
    <Button
      variant="panel"
      onclick={() => actions.openOcrDialog()}
      disabled={!store.isDocumentLoaded || store.isCropping || store.isOcrRunning || store.isReadOnly}
    >
      <ScanText class="panel-icon-sm" /> Recognize Text (OCR)
    </Button>
    {/if}

    {#if featureFlags.isEnabled('merge') && featureFlags.isEnabled('page-actions.merge')}
    <Button
      variant="panel"
      onclick={() => actions.triggerMergeUpload()}
      disabled={!store.isDocumentLoaded || store.isCropping || store.isReadOnly || !store.canMergeFiles}
    >
      <FilePlus2 class="panel-icon-sm" /> Merge Files
    </Button>
    {/if}

    {#if featureFlags.isEnabled('page-actions.import-image')}
    <Button
      variant="panel"
      onclick={() => actions.triggerImageImportAsPage()}
      disabled={!store.isDocumentLoaded || store.isCropping || store.isReadOnly}
    >
      <ImagePlus class="panel-icon-sm" /> Import Image
    </Button>
    {/if}

    {#if featureFlags.isEnabled('compression') && featureFlags.isEnabled('page-actions.compress')}
    <Button
      variant="panel"
      onclick={() => actions.openCompressDialog('recommended')}
      disabled={!store.isDocumentLoaded || store.isCropping || store.isReadOnly}
    >
      <FileDown class="panel-icon-sm" /> Compress PDF
    </Button>
    {/if}

    {#if (featureFlags.isEnabled('export-images') || featureFlags.isEnabled('extraction.images')) && featureFlags.isEnabled('page-actions.extract-images')}
    <Button
      variant="panel"
      onclick={() => { store.showExportImagesDialog = true; }}
      disabled={!store.isDocumentLoaded || store.isCropping || store.isReadOnly || !store.canExtractImages}
    >
      <Image class="panel-icon-sm" /> Extract Images
    </Button>
    {/if}

    {#if featureFlags.isEnabled('split')}
    {#if featureFlags.isEnabled('page-actions.extract')}
    <Button
      variant="panel"
      onclick={() => { store.splitDialogMode = 'extract'; }}
      disabled={!store.isDocumentLoaded || store.isCropping || store.isReadOnly || !store.canExtractPages}
    >
      <Copy class="panel-icon-sm" /> Extract Pages
    </Button>
    {/if}

    {#if featureFlags.isEnabled('page-actions.split')}
    <Button
      variant="panel"
      onclick={() => { store.splitDialogMode = 'split'; }}
      disabled={!store.isDocumentLoaded || store.isCropping || store.isReadOnly}
    >
      <Scissors class="panel-icon-sm" /> Split Pages
    </Button>
    {/if}
    {/if}
  </div>
</SidebarSection>
