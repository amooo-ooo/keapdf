<script lang="ts">
  import type { PdfEditorService } from '../../services/pdf-editor';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useSelection } from '../../stores/selection.svelte';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';
  import { ArrowUp, ArrowDown, Copy, Trash2, Plus, FilePlus2, ImagePlus } from 'lucide-svelte';
  import PageThumbnailImage from '../common/PageThumbnailImage.svelte';

  import { CompoundCommand, RotatePageCommand } from '../../commands';

  const editorStore = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  interface Props {
    pageCount: number;
    currentPageIndex: number;
    service?: PdfEditorService;
    onRefresh: () => void;
    onSelectPage: (index: number) => void;
  }

  let { pageCount, currentPageIndex, onRefresh, onSelectPage }: Props = $props();

  let selectedIndices = $state<number[]>([]);
  let dragSourceIndex = $state<number | null>(null);
  let mergeFileInputEl: HTMLInputElement | null = $state(null);
  let imageFileInputEl: HTMLInputElement | null = $state(null);


  function toggleSelectPage(index: number, e: MouseEvent): void {
    if (e.ctrlKey || e.metaKey) {
      if (selectedIndices.includes(index)) {
        selectedIndices = selectedIndices.filter((i) => i !== index);
      } else {
        selectedIndices = [...selectedIndices, index];
      }
    } else {
      selectedIndices = [index];
    }
    onSelectPage(index);
  }

  async function handleRotateSelected(): Promise<void> {
    if (editorStore.isReadOnly) return;
    const targets = selectedIndices.length > 0 ? selectedIndices : [currentPageIndex];
    if (targets.length === 1) {
      actions.rotatePage(targets[0]);
    } else {
      const commands = targets.map((idx) => new RotatePageCommand('Rotate Page', idx, 90));
      await actions.executeCommand(new CompoundCommand('Rotate Pages', commands));
    }
    onRefresh();
  }

  async function handleDeleteSelected(): Promise<void> {
    if (editorStore.isReadOnly) return;
    const targets = (
      selectedIndices.length > 0 ? [...selectedIndices] : [currentPageIndex]
    ).sort((a, b) => b - a);

    if (targets.length >= pageCount) {
      return;
    }

    if (targets.length === 1) {
      await actions.deletePage(targets[0]);
    } else {
      await actions.executeDocumentMutation('Delete Pages', targets[targets.length - 1], () => {
        for (const idx of targets) {
          actions.service.document.deletePage(idx);
        }
        editorStore.pageCount = actions.service.document.getPageCount();
        editorStore.currentPageIndex = Math.max(0, Math.min(editorStore.currentPageIndex, editorStore.pageCount - 1));
      });
    }
    selectedIndices = [];
    onRefresh();
  }

  async function handleDuplicateSelected(): Promise<void> {
    if (editorStore.isReadOnly) return;
    const targets = (
      selectedIndices.length > 0 ? [...selectedIndices] : [currentPageIndex]
    ).sort((a, b) => b - a);

    await actions.duplicatePage(targets);
    onRefresh();
  }

  async function handleAddBlankPage(): Promise<void> {
    if (editorStore.isReadOnly) return;
    const targetIdx =
      selectedIndices.length > 0
        ? Math.max(...selectedIndices)
        : currentPageIndex;
    await actions.addBlankPage(targetIdx);
    onRefresh();
  }

  async function handleMovePage(fromIndex: number, direction: 'up' | 'down'): Promise<void> {
    if (editorStore.isReadOnly || !editorStore.canReorderPages) return;
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= pageCount) return;
    await actions.reorderPages([fromIndex], toIndex);
    onRefresh();
  }

  function handleDragStart(index: number, e: DragEvent): void {
    if (editorStore.isReadOnly || !editorStore.canReorderPages) {
      e.preventDefault();
      return;
    }
    dragSourceIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
    }
  }

  function handleDragOver(e: DragEvent): void {
    if (editorStore.isReadOnly || !editorStore.canReorderPages) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
  }

  async function handleDrop(targetIndex: number, e: DragEvent): Promise<void> {
    e.preventDefault();
    if (editorStore.isReadOnly || !editorStore.canReorderPages) return;
    if (dragSourceIndex !== null && dragSourceIndex !== targetIndex) {
      await actions.reorderPages([dragSourceIndex], targetIndex);
      dragSourceIndex = null;
      onRefresh();
    }
  }

  function triggerMerge(): void {
    if (editorStore.isReadOnly || !editorStore.canMergeFiles) return;
    const selection = useSelection();
    let fileIds = Array.from(selection.selectedIds).filter((id: string) => id.startsWith('file_'));
    
    // Visually, the active file is always selected. Include it if there are other selections.
    const activeFileIdStr = `file_${editorStore.activeWorkspaceFileId}`;
    if (fileIds.length > 0 && !fileIds.includes(activeFileIdStr)) {
      fileIds = [activeFileIdStr, ...fileIds];
    }
    
    if (fileIds.length > 1) {
      const targetIndex =
        selectedIndices.length > 0
          ? Math.max(...selectedIndices) + 1
          : currentPageIndex + 1;
      actions.mergeWorkspaceFiles(fileIds.map((id: string) => id.replace('file_', '')), targetIndex);
      return;
    }
    mergeFileInputEl?.click();
  }

  function handleMergeFileSelected(e: Event): void {
    if (editorStore.isReadOnly || !editorStore.canMergeFiles) return;
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const files = Array.from(target.files);
      const targetIndex =
        selectedIndices.length > 0
          ? Math.max(...selectedIndices) + 1
          : currentPageIndex + 1;

      actions.mergePdfsFromFiles(files, targetIndex).then(() => {
        onRefresh();
      });
    }
    target.value = '';
  }

  function triggerImageImport(): void {
    if (editorStore.isReadOnly) return;
    imageFileInputEl?.click();
  }

  function handleImageFileSelected(e: Event): void {
    if (editorStore.isReadOnly) return;
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const files = Array.from(target.files);
      const targetIndex =
        selectedIndices.length > 0
          ? Math.max(...selectedIndices) + 1
          : currentPageIndex + 1;

      actions.importImagesFromFiles(files, targetIndex).then(() => {
        onRefresh();
      });
    }
    target.value = '';
  }
</script>

<input
  bind:this={mergeFileInputEl}
  type="file"
  multiple
  accept=".pdf,application/pdf,image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg"
  onchange={handleMergeFileSelected}
  class="hidden"
/>

<input
  bind:this={imageFileInputEl}
  type="file"
  multiple
  accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg"
  onchange={handleImageFileSelected}
  class="hidden"
/>

<div class="flex flex-col h-full bg-background rounded-lg border shadow-xs overflow-hidden">
  <div class="flex items-center justify-between p-3 border-b bg-card">
    <div class="flex items-center gap-2">
      <span class="font-semibold text-sm">Page Organizer</span>
      <Badge variant="outline" class="text-xs tabular-nums">
        {pageCount} {pageCount === 1 ? 'page' : 'pages'}
      </Badge>
      {#if selectedIndices.length > 0}
        <Badge variant="secondary" class="text-xs tabular-nums">
          {selectedIndices.length} selected
        </Badge>
      {/if}
    </div>

    <div class="flex items-center gap-1.5 flex-wrap">
      {#if featureFlags.isEnabled('page-actions.add-blank')}
      <Button variant="outline" size="sm" onclick={handleAddBlankPage} title="Insert Blank Page" disabled={!editorStore.isDocumentLoaded || editorStore.isReadOnly}>
        <Plus class="h-4 w-4 mr-1" /> Blank
      </Button>
      {/if}

      {#if featureFlags.isEnabled('merge') && featureFlags.isEnabled('page-actions.merge')}
      <Button variant="outline" size="sm" onclick={triggerMerge} title="Merge PDF files or images as new pages" disabled={!editorStore.isDocumentLoaded || editorStore.isReadOnly || !editorStore.canMergeFiles}>
        <FilePlus2 class="h-4 w-4 mr-1" /> Merge Files
      </Button>
      {/if}

      {#if featureFlags.isEnabled('page-actions.import-image')}
      <Button variant="outline" size="sm" onclick={triggerImageImport} title="Import image as new page" disabled={!editorStore.isDocumentLoaded || editorStore.isReadOnly}>
        <ImagePlus class="h-4 w-4 mr-1" /> Import Image
      </Button>
      {/if}

      {#if featureFlags.isEnabled('page-actions.duplicate')}
      <Button variant="outline" size="sm" onclick={handleDuplicateSelected} title="Duplicate Selected" disabled={!editorStore.isDocumentLoaded || editorStore.isReadOnly || selectedIndices.length === 0}>
        <Copy class="h-4 w-4 mr-1" /> Duplicate
      </Button>
      {/if}

      {#if featureFlags.isEnabled('page-actions.rotate')}
      <Button variant="outline" size="sm" onclick={handleRotateSelected} title="Rotate Selected 90 degrees" disabled={!editorStore.isDocumentLoaded || editorStore.isReadOnly || selectedIndices.length === 0}>
        Rotate
      </Button>
      {/if}

      {#if featureFlags.isEnabled('page-actions.delete')}
      <Button
        variant="destructive"
        size="sm"
        disabled={pageCount <= 1 || editorStore.isReadOnly || selectedIndices.length === 0}
        onclick={handleDeleteSelected}
        title="Delete Selected"
      >
        <Trash2 class="h-4 w-4 mr-1" /> Delete
      </Button>
      {/if}

      {#if featureFlags.isEnabled('tools')}
      <Separator orientation="vertical" class="h-4 mx-1" />

      <!-- Automation & Developer Tools -->
      {#if featureFlags.isEnabled('tools.automate')}
      <Button variant="secondary" size="sm" onclick={() => (editorStore.activeMockupTool = 'Automate Workflow')} title="Automate Workflow">
        Automate
      </Button>
      {/if}
      {#if featureFlags.isEnabled('tools.auto-rename')}
      <Button variant="secondary" size="sm" onclick={() => (editorStore.activeMockupTool = 'Auto Rename PDF File')} title="Auto Rename PDF">
        Auto Rename
      </Button>
      {/if}
      {#if featureFlags.isEnabled('tools.api')}
      <Button variant="ghost" size="sm" onclick={() => (editorStore.activeMockupTool = 'API Reference')} title="API Reference">
        API
      </Button>
      {/if}
      {#if featureFlags.isEnabled('tools.folder-scan')}
      <Button variant="ghost" size="sm" onclick={() => (editorStore.activeMockupTool = 'Automated Folder Scanning')} title="Folder Scanning">
        Folder Scan
      </Button>
      {/if}
      {#if featureFlags.isEnabled('tools.sso-guide')}
      <Button variant="ghost" size="sm" onclick={() => (editorStore.activeMockupTool = 'SSO Configuration Guide')} title="SSO Guide">
        SSO Guide
      </Button>
      {/if}
      {/if}
    </div>
  </div>

  <div class="flex-1 min-h-0 overflow-y-auto p-4">
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {#each Array.from({ length: pageCount }, (_, i) => i) as index (index)}
        {@const isSelected = selectedIndices.includes(index)}
        {@const isCurrent = currentPageIndex === index}

        <div
          class="group relative flex flex-col items-center p-2 rounded-lg border bg-card transition-[box-shadow,border-color,background-color] duration-150 hover:shadow-elevation-2 cursor-pointer select-none {isSelected ? 'ring-2 ring-primary border-primary bg-accent/20' : ''} {isCurrent && !isSelected ? 'border-primary/50' : ''}"
          onclick={(e) => toggleSelectPage(index, e)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSelectPage(index, e as unknown as MouseEvent); }}
          role="button"
          tabindex="0"
          draggable={featureFlags.isEnabled('page-actions.reorder') && !editorStore.isReadOnly && editorStore.canReorderPages}
          ondragstart={(e) => handleDragStart(index, e)}
          ondragover={handleDragOver}
          ondrop={(e) => handleDrop(index, e)}
        >
          <div class="w-full aspect-[1/1.4] bg-muted rounded overflow-hidden flex items-center justify-center relative shadow-xs">
            <PageThumbnailImage pageIndex={index} scale={0.3} class="w-full h-full object-contain" />
          </div>

          <div class="flex items-center justify-between w-full mt-2 text-xs">
            <span class="font-medium text-muted-foreground tabular-nums">
              Page {index + 1}
            </span>

            {#if featureFlags.isEnabled('page-actions.reorder')}
            <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6"
                disabled={index === 0 || editorStore.isReadOnly || !editorStore.canReorderPages}
                onclick={(e) => { e.stopPropagation(); handleMovePage(index, 'up'); }}
                title="Move Up"
                aria-label="Move page up"
              >
                <ArrowUp class="h-3 w-3" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6"
                disabled={index === pageCount - 1 || editorStore.isReadOnly || !editorStore.canReorderPages}
                onclick={(e) => { e.stopPropagation(); handleMovePage(index, 'down'); }}
                title="Move Down"
                aria-label="Move page down"
              >
                <ArrowDown class="h-3 w-3" aria-hidden="true" />
              </Button>
            </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>
