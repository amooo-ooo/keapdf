<script lang="ts">
  import type { PdfEditorService } from '../../services/pdf-editor';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useSelection } from '../../stores/selection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { ArrowUp, ArrowDown, Copy, Trash2, Plus, FilePlus2, ImagePlus } from 'lucide-svelte';
  import PageThumbnailImage from '../common/PageThumbnailImage.svelte';

  const editorStore = useEditorStore();
  const actions = useEditorActions();

  interface Props {
    pageCount: number;
    currentPageIndex: number;
    service: PdfEditorService;
    onRefresh: () => void;
    onSelectPage: (index: number) => void;
  }

  let { pageCount, currentPageIndex, service, onRefresh, onSelectPage }: Props = $props();

  let selectedIndices = $state<number[]>([]);
  let dragSourceIndex = $state<number | null>(null);
  let mergeFileInputEl: HTMLInputElement | null = $state(null);
  let imageFileInputEl: HTMLInputElement | null = $state(null);

  $effect(() => {
    void editorStore.renderVersion;
  });

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

  function handleRotateSelected(): void {
    const targets = selectedIndices.length > 0 ? selectedIndices : [currentPageIndex];
    for (const idx of targets) {
      service.document.getPage(idx).rotate(90);
      if (editorStore.pageTransforms[idx]) {
        editorStore.pageTransforms[idx].rotation = 0;
      }
      editorStore.incrementPageVersion(idx);
    }
    onRefresh();
  }

  function handleDeleteSelected(): void {
    const targets = (
      selectedIndices.length > 0 ? [...selectedIndices] : [currentPageIndex]
    ).sort((a, b) => b - a);

    if (targets.length >= pageCount) {
      return;
    }

    for (const idx of targets) {
      service.document.deletePage(idx);
    }
    selectedIndices = [];
    onRefresh();
  }

  function handleDuplicateSelected(): void {
    const targets = (
      selectedIndices.length > 0 ? [...selectedIndices] : [currentPageIndex]
    ).sort((a, b) => b - a);

    for (const idx of targets) {
      service.document.duplicatePage(idx);
    }
    onRefresh();
  }

  function handleAddBlankPage(): void {
    const targetIdx =
      selectedIndices.length > 0
        ? Math.max(...selectedIndices) + 1
        : currentPageIndex + 1;
    service.document.addBlankPage(targetIdx);
    onRefresh();
  }

  function handleMovePage(fromIndex: number, direction: 'up' | 'down'): void {
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= pageCount) return;
    service.document.reorderPages([fromIndex], toIndex);
    onRefresh();
  }

  function handleDragStart(index: number, e: DragEvent): void {
    dragSourceIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
    }
  }

  function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
  }

  function handleDrop(targetIndex: number, e: DragEvent): void {
    e.preventDefault();
    if (dragSourceIndex !== null && dragSourceIndex !== targetIndex) {
      service.document.reorderPages([dragSourceIndex], targetIndex);
      dragSourceIndex = null;
      onRefresh();
    }
  }

  function triggerMerge(): void {
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
    imageFileInputEl?.click();
  }

  function handleImageFileSelected(e: Event): void {
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
  accept=".pdf,application/pdf"
  onchange={handleMergeFileSelected}
  class="hidden"
/>

<input
  bind:this={imageFileInputEl}
  type="file"
  multiple
  accept="image/png,image/jpeg"
  onchange={handleImageFileSelected}
  class="hidden"
/>

<div class="flex flex-col h-full bg-background rounded-lg border shadow-xs overflow-hidden">
  <div class="flex items-center justify-between p-3 border-b bg-card">
    <div class="flex items-center gap-2">
      <span class="font-semibold text-sm">Page Organizer</span>
      <Badge variant="outline" class="text-xs">
        {pageCount} {pageCount === 1 ? 'page' : 'pages'}
      </Badge>
      {#if selectedIndices.length > 0}
        <Badge variant="secondary" class="text-xs">
          {selectedIndices.length} selected
        </Badge>
      {/if}
    </div>

    <div class="flex items-center gap-1.5 flex-wrap">
      <Button variant="outline" size="sm" onclick={handleAddBlankPage} title="Insert Blank Page">
        <Plus class="h-4 w-4 mr-1" /> Blank
      </Button>

      <Button variant="outline" size="sm" onclick={triggerMerge} title="Merge PDF file as new pages">
        <FilePlus2 class="h-4 w-4 mr-1" /> Merge PDF
      </Button>

      <Button variant="outline" size="sm" onclick={triggerImageImport} title="Import PNG/JPG as new page">
        <ImagePlus class="h-4 w-4 mr-1" /> Import Image
      </Button>

      <Button variant="outline" size="sm" onclick={handleDuplicateSelected} title="Duplicate Selected">
        <Copy class="h-4 w-4 mr-1" /> Duplicate
      </Button>

      <Button variant="outline" size="sm" onclick={handleRotateSelected} title="Rotate Selected 90 degrees">
        Rotate
      </Button>

      <Button
        variant="destructive"
        size="sm"
        disabled={pageCount <= 1}
        onclick={handleDeleteSelected}
        title="Delete Selected"
      >
        <Trash2 class="h-4 w-4 mr-1" /> Delete
      </Button>

      <div class="h-4 w-px bg-border mx-1"></div>

      <!-- Automation & Developer Tools -->
      <Button variant="secondary" size="sm" onclick={() => (editorStore.activeMockupTool = 'Automate Workflow')} title="Automate Workflow">
        Automate
      </Button>
      <Button variant="secondary" size="sm" onclick={() => (editorStore.activeMockupTool = 'Auto Rename PDF File')} title="Auto Rename PDF">
        Auto Rename
      </Button>
      <Button variant="ghost" size="sm" onclick={() => (editorStore.activeMockupTool = 'API Reference')} title="API Reference">
        API
      </Button>
      <Button variant="ghost" size="sm" onclick={() => (editorStore.activeMockupTool = 'Automated Folder Scanning')} title="Folder Scanning">
        Folder Scan
      </Button>
      <Button variant="ghost" size="sm" onclick={() => (editorStore.activeMockupTool = 'SSO Configuration Guide')} title="SSO Guide">
        SSO Guide
      </Button>
    </div>
  </div>

  <div class="flex-1 min-h-0 overflow-y-auto p-4">
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {#each Array.from({ length: pageCount }, (_, i) => i) as index (index)}
        {@const isSelected = selectedIndices.includes(index)}
        {@const isCurrent = currentPageIndex === index}

        <div
          class="group relative flex flex-col items-center p-2 rounded-lg border bg-card transition-all hover:shadow-md cursor-pointer select-none {isSelected ? 'ring-2 ring-primary border-primary bg-accent/20' : ''} {isCurrent && !isSelected ? 'border-primary/50' : ''}"
          onclick={(e) => toggleSelectPage(index, e)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSelectPage(index, e as unknown as MouseEvent); }}
          role="button"
          tabindex="0"
          draggable="true"
          ondragstart={(e) => handleDragStart(index, e)}
          ondragover={handleDragOver}
          ondrop={(e) => handleDrop(index, e)}
        >
          <div class="w-full aspect-[1/1.4] bg-muted rounded overflow-hidden flex items-center justify-center relative shadow-xs">
            <PageThumbnailImage pageIndex={index} scale={0.3} class="w-full h-full object-contain" />
          </div>

          <div class="flex items-center justify-between w-full mt-2 text-xs">
            <span class="font-medium text-muted-foreground">
              Page {index + 1}
            </span>

            <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6"
                disabled={index === 0}
                onclick={(e) => { e.stopPropagation(); handleMovePage(index, 'up'); }}
                title="Move Up"
              >
                <ArrowUp class="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6"
                disabled={index === pageCount - 1}
                onclick={(e) => { e.stopPropagation(); handleMovePage(index, 'down'); }}
                title="Move Down"
              >
                <ArrowDown class="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>
