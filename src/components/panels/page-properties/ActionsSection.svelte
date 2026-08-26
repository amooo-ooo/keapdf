<script lang="ts">
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import { Plus, Copy, Trash2, FilePlus2, ImagePlus, FileCheck, Scissors, FileImage } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import SidebarSection from '../../common/SidebarSection.svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

</script>

<SidebarSection title="Actions" borderBottom={false} collapsible={true} defaultExpanded={true}>
  <div class="field-group">
    <Button variant="outline" class="btn-action" onclick={() => actions.duplicatePage(store.currentPageIndex)} disabled={!store.isDocumentLoaded}>
      <Copy class="h-3.5 w-3.5 mr-2" /> Duplicate Page
    </Button>
    <Button variant="outline" class="btn-action" onclick={() => actions.addBlankPage(store.currentPageIndex)} disabled={!store.isDocumentLoaded}>
      <Plus class="h-3.5 w-3.5 mr-2" /> Add Blank Page
    </Button>
    <Button variant="outline" class="btn-action text-destructive hover:text-destructive hover:bg-destructive/10" onclick={() => actions.deletePage(store.currentPageIndex)} disabled={!store.isDocumentLoaded || store.pageCount <= 1}>
      <Trash2 class="h-3.5 w-3.5 mr-2" /> Delete Page
    </Button>
    <Button variant="outline" class="btn-action" onclick={() => actions.triggerMergeUpload()} disabled={!store.isDocumentLoaded}>
      <FilePlus2 class="h-3.5 w-3.5 mr-2" /> Merge PDF
    </Button>
    <Button variant="outline" class="btn-action" onclick={() => actions.triggerImageImportAsPage()} disabled={!store.isDocumentLoaded}>
      <ImagePlus class="h-3.5 w-3.5 mr-2" /> Import Image
    </Button>
    <Button variant="outline" class="btn-action" onclick={() => actions.flattenPage(store.currentPageIndex)} disabled={!store.isDocumentLoaded}>
      <FileCheck class="h-3.5 w-3.5 mr-2" /> Flatten Page
    </Button>
    <Button variant="outline" class="btn-action" onclick={() => actions.rasterizePage(store.currentPageIndex)} disabled={!store.isDocumentLoaded}>
      <FileImage class="h-3.5 w-3.5 mr-2" /> Rasterize Page
    </Button>
    <Button variant="outline" class="btn-action" onclick={() => { store.splitDialogMode = 'extract'; }} disabled={!store.isDocumentLoaded}>
      <Copy class="h-3.5 w-3.5 mr-2" /> Extract Pages
    </Button>
    <Button variant="outline" class="btn-action text-destructive hover:text-destructive hover:bg-destructive/10" onclick={() => { store.splitDialogMode = 'split'; }} disabled={!store.isDocumentLoaded}>
      <Scissors class="h-3.5 w-3.5 mr-2" /> Split Pages
    </Button>
  </div>
</SidebarSection>
