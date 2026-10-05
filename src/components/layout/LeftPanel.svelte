<script lang="ts">
  import type { Component } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import type { OutlineNode } from '../../core/types';
  import { flattenOutlineTree, type OutlineItemFlat } from '../../services/pdf/operations/outline-tree';
  import PageThumbnailStrip from '../panels/PageThumbnailStrip.svelte';
  import PageThumbnailImage from '../common/PageThumbnailImage.svelte';
  import DraggableListItem, {
    getDragGroup,
    getDragIndices,
    getDragPayloadData,
    setDragOverState,
    clearDragOverState,
  } from '../common/DraggableListItem.svelte';
  import { formatPageRange } from '../../utils/page-range';
  import { useSelection } from '../../stores/selection.svelte';
  import { usePanelRegistry } from '../../core/panel-registry';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import { Button } from '$lib/components/ui/button/index.js';
  import {
    ChevronDown,
    Plus,
    Heading1,
    Heading2,
    Heading3,
    Heading4,
    Heading5,
    Heading6,
    Heading,
    PanelLeftClose,
    FileText,
  } from 'lucide-svelte';

  import { onDestroy } from 'svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const selection = useSelection();
  const panelRegistry = usePanelRegistry();
  const featureFlags = useFeatureFlagStore();

  onDestroy(() => {
    stopPagesResize();
    stopFilesResize();
  });

  const currentPanel = $derived(panelRegistry.get(store.leftPanelMode));

  let outline = $state<OutlineNode[]>([]);
  const flatOutline = $derived<OutlineItemFlat[]>(flattenOutlineTree(outline));

  // Split pane height percentages
  let filesPercent = $state(20);
  let pagesPercent = $state(45);
  let isDraggingPagesDivider = $state(false);
  let isDraggingFilesDivider = $state(false);
  let mainContainerEl: HTMLElement | null = $state(null);
  let filesContainerEl: HTMLElement | null = $state(null);

  $effect(() => {
    if (store.isDocumentLoaded) {
      void store.renderVersion;
      try {
        outline = actions.service.document.getOutline();
      } catch {
        outline = [];
      }
    } else {
      outline = [];
    }
  });

  let pagesRafId: number | null = null;
  let filesRafId: number | null = null;

  // Pages divider (between Pages and Outline)
  function startPagesResize(e: PointerEvent): void {
    e.preventDefault();
    isDraggingPagesDivider = true;
    window.addEventListener('pointermove', handlePagesPointerMove);
    window.addEventListener('pointerup', stopPagesResize);
    window.addEventListener('pointercancel', stopPagesResize);
  }

  function handlePagesPointerMove(e: PointerEvent): void {
    if (!isDraggingPagesDivider || !mainContainerEl) return;
    if (pagesRafId !== null) return;
    const clientY = e.clientY;
    pagesRafId = requestAnimationFrame(() => {
      pagesRafId = null;
      if (!isDraggingPagesDivider || !mainContainerEl) return;
      const rect = mainContainerEl.getBoundingClientRect();
      const offsetY = clientY - rect.top;
      
      let totalAbove = (offsetY / rect.height) * 100;
      
      if (store.workspaceFiles.length > 0) {
        totalAbove = Math.max(filesPercent + 10, Math.min(85, totalAbove));
        pagesPercent = totalAbove - filesPercent;
      } else {
        totalAbove = Math.max(15, Math.min(85, totalAbove));
        pagesPercent = totalAbove;
      }
    });
  }

  function stopPagesResize(): void {
    isDraggingPagesDivider = false;
    if (pagesRafId !== null) {
      cancelAnimationFrame(pagesRafId);
      pagesRafId = null;
    }
    window.removeEventListener('pointermove', handlePagesPointerMove);
    window.removeEventListener('pointerup', stopPagesResize);
    window.removeEventListener('pointercancel', stopPagesResize);
  }

  // Files divider (between Files and Pages)
  function startFilesResize(e: PointerEvent): void {
    e.preventDefault();
    if (store.workspaceFiles.length === 0) return;
    isDraggingFilesDivider = true;
    window.addEventListener('pointermove', handleFilesPointerMove);
    window.addEventListener('pointerup', stopFilesResize);
    window.addEventListener('pointercancel', stopFilesResize);
  }

  function handleFilesPointerMove(e: PointerEvent): void {
    if (!isDraggingFilesDivider || !mainContainerEl) return;
    if (filesRafId !== null) return;
    const clientY = e.clientY;
    filesRafId = requestAnimationFrame(() => {
      filesRafId = null;
      if (!isDraggingFilesDivider || !mainContainerEl) return;
      const rect = mainContainerEl.getBoundingClientRect();
      const offsetY = clientY - rect.top;
      
      const newFilesPercent = (offsetY / rect.height) * 100;
      const currentBottom = filesPercent + pagesPercent;
      
      const boundedFilesPercent = Math.max(10, Math.min(currentBottom - 10, newFilesPercent));
      
      filesPercent = boundedFilesPercent;
      pagesPercent = currentBottom - filesPercent;
    });
  }

  function stopFilesResize(): void {
    isDraggingFilesDivider = false;
    if (filesRafId !== null) {
      cancelAnimationFrame(filesRafId);
      filesRafId = null;
    }
    window.removeEventListener('pointermove', handleFilesPointerMove);
    window.removeEventListener('pointerup', stopFilesResize);
    window.removeEventListener('pointercancel', stopFilesResize);
  }

  function canDropPageInFiles(sourceGroup: string, indices: number[], payload: Record<string, string>): boolean {
    if (!store.canExtractPages || store.isReadOnly) return false;
    if (sourceGroup === 'pages') {
      const pageIndices = parseDroppedPageIndices(indices, payload);
      const count = pageIndices.length > 0 ? pageIndices.length : indices.length;
      return store.isDocumentLoaded && count > 0 && (store.isReadOnly || count < store.pageCount);
    }
    return false;
  }

  function parseDroppedPageIndices(indices: number[], payload: Record<string, string>): number[] {
    const rawPayload = payload['application/x-page-indices'] || payload['application/x-workspace-page-indices'];
    if (rawPayload) {
      try {
        const parsed = JSON.parse(rawPayload);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch {
        // Fallback to in-memory indices
      }
    }
    return indices;
  }

  async function handleExtractPagesToWorkspace(pageIndices: number[], targetIndex: number): Promise<void> {
    if (!store.canExtractPages || store.isReadOnly) return;
    const sortedIndices = Array.from(new Set(pageIndices)).sort((a, b) => a - b);
    if (sortedIndices.length === 0 || !store.isDocumentLoaded) return;
    if (!store.isReadOnly && sortedIndices.length >= store.pageCount) return;
    const rangeString = formatPageRange(sortedIndices);
    // Non-destructive page extraction in viewing mode preserves source document state
    const mode = store.isReadOnly ? 'extract' : 'split';
    await actions.extractPages(sortedIndices, mode, rangeString, {
      autoDownload: false,
      targetFileIndex: targetIndex,
    });
  }

  function handleDropFromGroupInFiles(sourceGroup: string, indices: number[], targetIndex: number, payload: Record<string, string>): void {
    if (store.isReadOnly) return;
    if (sourceGroup === 'pages') {
      const pageIndices = parseDroppedPageIndices(indices, payload);
      if (pageIndices.length > 0) {
        void handleExtractPagesToWorkspace(pageIndices, targetIndex);
      }
    }
  }

  function handleFilesContainerDragOver(e: DragEvent): void {
    if (store.isReadOnly) return;
    const group = getDragGroup();
    if (group !== 'pages' && group !== 'files') return;
    if (store.workspaceFiles.length === 0) return;

    if (group === 'pages') {
      if (!store.canExtractPages) return;
      const pageIndices = parseDroppedPageIndices(getDragIndices(), getDragPayloadData());
      const count = pageIndices.length > 0 ? pageIndices.length : getDragIndices().length;
      if (count === 0 || count >= store.pageCount) return;
    }

    if (filesContainerEl && filesContainerEl.children.length > 0) {
      const lastChild = filesContainerEl.children[filesContainerEl.children.length - 1] as HTMLElement;
      const lastRect = lastChild.getBoundingClientRect();
      if (e.clientY >= lastRect.bottom) {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = group === 'files' ? 'move' : 'copy';
        }
        const lastFile = store.workspaceFiles[store.workspaceFiles.length - 1];
        setDragOverState(`file_${lastFile.id}`, 'bottom');
      }
    }
  }

  function handleFilesContainerDragLeave(e: DragEvent): void {
    if (filesContainerEl && e.relatedTarget && filesContainerEl.contains(e.relatedTarget as Node)) {
      return;
    }
    clearDragOverState();
  }

  function handleFilesContainerDrop(e: DragEvent): void {
    if (store.isReadOnly) return;
    const group = getDragGroup();
    if (group !== 'pages' && group !== 'files') return;
    if (!filesContainerEl || store.workspaceFiles.length === 0) return;

    const lastChild = filesContainerEl.children[filesContainerEl.children.length - 1] as HTMLElement;
    const lastRect = lastChild.getBoundingClientRect();
    if (e.clientY >= lastRect.bottom) {
      e.preventDefault();
      clearDragOverState();

      if (group === 'pages') {
        const payload = getDragPayloadData();
        const pageIndices = parseDroppedPageIndices(getDragIndices(), payload);
        if (pageIndices.length > 0) {
          void handleExtractPagesToWorkspace(pageIndices, store.workspaceFiles.length);
        }
      } else if (group === 'files') {
        const indices = getDragIndices();
        if (indices.length > 0) {
          actions.reorderWorkspaceFiles(indices, store.workspaceFiles.length);
        }
      }
    }
  }
</script>

<aside
  aria-label="Workspace sidebar"
  class="h-full flex flex-col overflow-hidden select-none w-full bg-card"
  style={store.leftPanelCollapsed ? 'width: 0px; padding: 0;' : ''}
>
  {#if !store.leftPanelCollapsed}
    <div class="panel-container rounded-none border-0 shadow-none bg-card">
      <!-- Top Header: Document Title & Main Action -->
      <div class="panel-header">
      <div class="flex items-start justify-between">
        <div class="flex flex-col min-w-0 pr-1">
          {#if currentPanel && currentPanel.id !== 'workspace'}
            <span class="panel-title">{currentPanel.label}</span>
            {#if currentPanel.subtitle}
              <span class="panel-subtitle">{currentPanel.subtitle}</span>
            {/if}
          {:else}
            <button
              type="button"
              class="flex items-center gap-1 panel-title hover:text-primary truncate text-left group"
              title={store.fileName}
              onclick={() => {
                if (store.isDocumentLoaded && featureFlags.isEnabled('document-info')) {
                  store.showDocumentInfoDialog = true;
                }
              }}
            >
              <span class="truncate">{store.fileName}</span>
              <ChevronDown class="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0" />
            </button>
            <span class="panel-subtitle tabular-nums">
              {store.isDocumentLoaded ? `${store.pageCount} ${store.pageCount === 1 ? 'page' : 'pages'}` : 'PDF Document'}
            </span>
          {/if}
        </div>

        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
          onclick={() => {
            store.leftPanelCollapsed = true;
          }}
          title="Collapse Left Sidebar"
          aria-label="Collapse Left Sidebar"
        >
          <PanelLeftClose class="h-4 w-4" />
        </Button>
      </div>


    </div>

    <!-- Body Panel Container -->
    {#if currentPanel && currentPanel.component}
      {@const PanelComponent = currentPanel.component as Component}
      <div class="panel-content">
        <PanelComponent />
      </div>
    {:else}
      <!-- Resizable Split View Container (Files, Pages, Outline) -->
      <div
        bind:this={mainContainerEl}
        class="flex-1 flex flex-col min-h-0 overflow-hidden relative py-1"
      >
        {#if featureFlags.isEnabled('workspace.files') && store.workspaceFiles.length > 0}
          <!-- Files container -->
          <section
            class="sidebar-section min-h-0 shrink-0"
            style="height: {filesPercent}%;"
          >
            <div class="sidebar-section-header">
              <span class="sidebar-section-title">Files</span>
              {#if featureFlags.isEnabled('workspace.add') && (!store.isReadOnly || store.canMergeFiles)}
              <div class="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onclick={() => actions.triggerFileOpen(true)}
                  title="Add PDF to workspace"
                  aria-label="Add PDF to workspace"
                >
                  <Plus class="h-3.5 w-3.5" />
                </Button>
              </div>
              {/if}
            </div>
            
            <div
              bind:this={filesContainerEl}
              class="flex flex-col gap-0.5 px-2.5 pb-2.5 overflow-y-auto flex-1"
              ondragover={handleFilesContainerDragOver}
              ondragleave={handleFilesContainerDragLeave}
              ondrop={handleFilesContainerDrop}
              role="region"
              aria-label="Workspace files list"
            >
              {#each store.workspaceFiles as file, fileIndex}
                <DraggableListItem
                  id={`file_${file.id}`}
                  index={fileIndex}
                  group="files"
                  acceptGroups={['pages']}
                  canDrop={canDropPageInFiles}
                  onDropFromGroup={handleDropFromGroupInFiles}
                  class="group flex items-center gap-2.5 p-1.5 rounded-md cursor-pointer transition-colors text-left text-xs [&>*]:pointer-events-none {selection.isSelected(`file_${file.id}`) || store.activeWorkspaceFileId === file.id ? 'bg-primary/10 text-foreground font-medium' : 'hover:bg-muted/60 text-foreground font-normal'}"
                  getDragIndices={() => {
                    const ids = new Set(
                      Array.from(selection.selectedIds)
                        .filter(id => id.startsWith('file_'))
                        .map(id => id.replace('file_', ''))
                    );
                    const isSelected = ids.has(file.id);
                    if (!isSelected) {
                      return [fileIndex];
                    }
                    return store.workspaceFiles
                      .map((f, i) => (ids.has(f.id) ? i : -1))
                      .filter(i => i !== -1);
                  }}
                  getDragPayload={() => {
                    const ids = new Set(
                      Array.from(selection.selectedIds)
                        .filter(id => id.startsWith('file_'))
                        .map(id => id.replace('file_', ''))
                    );
                    const isSelected = ids.has(file.id);
                    const targetFiles = isSelected
                      ? store.workspaceFiles.filter(f => ids.has(f.id))
                      : [file];
                    return {
                      'application/x-workspace-file-ids': JSON.stringify(targetFiles.map(f => f.id)),
                    };
                  }}
                  onclick={(e) => {
                    const fileIds = store.workspaceFiles.map(f => `file_${f.id}`);
                    if (e.shiftKey && !selection.lastSelectedId && store.activeWorkspaceFileId) {
                      selection.lastSelectedId = `file_${store.activeWorkspaceFileId}`;
                      selection.selectedIds.add(`file_${store.activeWorkspaceFileId}`);
                    }
                    selection.select(
                      `file_${file.id}`,
                      e.ctrlKey || e.metaKey,
                      e.shiftKey,
                      (start, end) => {
                        const startIndex = fileIds.indexOf(start);
                        const endIndex = fileIds.indexOf(end);
                        if (startIndex === -1 || endIndex === -1) return [];
                        const min = Math.min(startIndex, endIndex);
                        const max = Math.max(startIndex, endIndex);
                        return fileIds.slice(min, max + 1);
                      }
                    );
                    
                    if (!e.ctrlKey && !e.shiftKey && !e.metaKey) {
                      actions.switchWorkspaceFile(file.id);
                    }
                  }}
                  onReorder={(from, to) => actions.reorderWorkspaceFiles(from, to)}
                >
                  <div class="w-7 h-8.5 flex items-center justify-center shrink-0">
                    {#if store.activeWorkspaceFileId === file.id && store.isDocumentLoaded}
                      <PageThumbnailImage pageIndex={0} scale={0.2} class="max-w-full max-h-full w-auto h-auto object-contain rounded border border-border/50 bg-white shadow-2xs" />
                    {:else if file.thumbnail}
                      <img src={file.thumbnail} alt={file.fileName} class="max-w-full max-h-full w-auto h-auto object-contain rounded border border-border/50 bg-white shadow-2xs" />
                    {:else}
                      <div class="w-6 h-7.5 bg-muted/40 rounded border border-border/40 flex items-center justify-center">
                        <FileText class="w-3.5 h-3.5 text-muted-foreground/70" />
                      </div>
                    {/if}
                  </div>
                  <span class="truncate flex-1 text-xs">{file.fileName}</span>
                </DraggableListItem>
              {/each}
            </div>
          </section>

          <!-- Resizable Horizontal Divider (Files <-> Pages) -->
          <div
            class="relative !cursor-row-resize shrink-0 z-10"
            onpointerdown={startFilesResize}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize Files and Pages panels"
          >
            <div class="absolute -top-2 -bottom-2 left-0 right-0 !cursor-row-resize"></div>
          </div>
        {/if}

        {#if featureFlags.isEnabled('workspace.pages')}
        <!-- Pages container -->
        <section
          class="sidebar-section min-h-0 shrink-0"
          style="height: {featureFlags.isEnabled('outline') ? pagesPercent : (store.workspaceFiles.length > 0 && featureFlags.isEnabled('workspace.files') ? 100 - filesPercent : 100)}%;"
        >
          <div class="sidebar-section-header">
            <span class="sidebar-section-title">Pages</span>
            {#if featureFlags.isEnabled('page-actions.add-blank')}
            <div class="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6 text-muted-foreground hover:text-foreground"
                disabled={!store.isDocumentLoaded || store.isReadOnly}
                onclick={() => actions.addBlankPage(store.currentPageIndex)}
                title="Add blank page"
                aria-label="Add blank page"
              >
                <Plus class="h-3.5 w-3.5" />
              </Button>
            </div>
            {/if}
          </div>

          <div class="flex-1 overflow-y-auto px-2.5 pb-2.5 relative">
            {#if store.isDocumentLoaded}
              <PageThumbnailStrip />
            {/if}
          </div>
        </section>

        {#if featureFlags.isEnabled('outline')}
        <!-- Resizable Horizontal Divider (Pages <-> Outline) -->
        <div
          class="relative !cursor-row-resize shrink-0 z-10"
          onpointerdown={startPagesResize}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize Pages and Outline panels"
        >
          <div class="absolute -top-2 -bottom-2 left-0 right-0 !cursor-row-resize"></div>
        </div>
        {/if}
        {/if}

        {#if featureFlags.isEnabled('outline')}
        <!-- Outline container -->
        <section
          class="sidebar-section min-h-0 flex-1"
          style="height: {store.workspaceFiles.length > 0 && featureFlags.isEnabled('workspace.files') ? 100 - filesPercent - pagesPercent : 100 - pagesPercent}%;"
        >
          <div class="sidebar-section-header">
            <span class="sidebar-section-title">Outline</span>
            <div class="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6 text-muted-foreground hover:text-foreground"
                disabled={!store.isDocumentLoaded || store.isReadOnly}
                onclick={() => actions.addTextToOutline()}
                title="Add current selection or page to outline"
                aria-label="Add text to outline"
              >
                <Plus class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto px-2.5 pb-2.5">
            {#if flatOutline.length > 0}
              <div class="flex flex-col gap-0.5">
                {#each flatOutline as item, itemIndex}
                  {@const isSelected = selection.isSelected(`outline_${item.title}_${itemIndex}`)}
                  <DraggableListItem
                    id={`outline_${item.title}_${itemIndex}`}
                    index={itemIndex}
                    group="outline"
                    class="group flex items-center gap-1.5 p-1.5 rounded-md cursor-pointer text-xs transition-colors {isSelected ? 'bg-primary/10 text-foreground font-medium' : 'hover:bg-muted/60 text-foreground font-normal'}"
                    style="padding-left: {(item.level - 1) * 12 + 6}px"
                    getDragIndices={() => {
                      const ids = Array.from(selection.selectedIds);
                      return ids
                        .filter(id => id.startsWith('outline_'))
                        .map(id => {
                          return flatOutline.findIndex((it, idx) => `outline_${it.title}_${idx}` === id);
                        })
                        .filter(idx => idx !== -1)
                        .sort((a, b) => a - b);
                    }}
                    onclick={(e) => {
                      const allIds = flatOutline.map((it, i) => `outline_${it.title}_${i}`);
                      selection.select(
                        `outline_${item.title}_${itemIndex}`,
                        e.ctrlKey || e.metaKey,
                        e.shiftKey,
                        (start, end) => {
                          const startIndex = allIds.indexOf(start);
                          const endIndex = allIds.indexOf(end);
                          if (startIndex === -1 || endIndex === -1) return [];
                          const min = Math.min(startIndex, endIndex);
                          const max = Math.max(startIndex, endIndex);
                          return allIds.slice(min, max + 1);
                        }
                      );

                      if (!e.ctrlKey && !e.shiftKey && !e.metaKey && item.pageIndex !== null && item.pageIndex !== undefined) {
                        actions.selectOutlineItem(item);
                      }
                    }}
                    onkeydown={(e) => {
                      if (e.key === 'Enter' && item.pageIndex !== null && item.pageIndex !== undefined) {
                        actions.selectOutlineItem(item);
                      }
                    }}
                    role="button"
                    tabindex={0}
                    onReorder={(from, to) => { if (!store.isReadOnly) actions.reorderOutline(from, to); }}
                  >
                    {#if item.level === 1}
                      <Heading1 class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {:else if item.level === 2}
                      <Heading2 class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {:else if item.level === 3}
                      <Heading3 class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {:else if item.level === 4}
                      <Heading4 class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {:else if item.level === 5}
                      <Heading5 class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {:else if item.level === 6}
                      <Heading6 class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {:else}
                      <Heading class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {/if}

                    <span class="truncate text-xs flex-1" title={item.title}>{item.title}</span>
                  </DraggableListItem>
                {/each}
              </div>
            {/if}
          </div>
        </section>
        {/if}
      </div>
    {/if}
    </div>
  {/if}
</aside>
