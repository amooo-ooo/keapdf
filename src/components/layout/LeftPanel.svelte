<script lang="ts">
  import type { Component } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import type { OutlineNode } from '../../core/types';
  import { flattenOutlineTree, type OutlineItemFlat } from '../../services/pdf/operations/outline-ops';
  import PageThumbnailStrip from '../panels/PageThumbnailStrip.svelte';
  import PageThumbnailImage from '../common/PageThumbnailImage.svelte';
  import DraggableListItem from '../common/DraggableListItem.svelte';
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
</script>

<aside
  class="h-full flex flex-col overflow-hidden select-none w-full py-[4px] pr-[4px]"
  style={store.leftPanelCollapsed ? 'width: 0px; padding: 0;' : ''}
>
  {#if !store.leftPanelCollapsed}
    <div class="panel-container rounded-l-none border-l-0">
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
                if (store.isDocumentLoaded) store.showDocumentInfoDialog = true;
              }}
            >
              <span class="truncate">{store.fileName}</span>
              <ChevronDown class="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0" />
            </button>
            <span class="panel-subtitle">
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
        class="flex-1 flex flex-col min-h-0 overflow-hidden relative"
      >
        {#if featureFlags.isEnabled('workspace.files') && store.workspaceFiles.length > 0}
          <!-- Section 0: Files (Independent Scrollable Container) -->
          <div
            class="flex flex-col min-h-0 shrink-0 py-1.5 gap-1.5 overflow-hidden"
            style="height: {filesPercent}%;"
          >
            <div class="sidebar-section-header">
              <span class="sidebar-section-title">Files</span>
              {#if featureFlags.isEnabled('workspace.add')}
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
              {/if}
            </div>
            
            <div class="flex flex-col gap-0.5 px-1.5 py-1 pb-2 overflow-y-auto flex-1">
              {#each store.workspaceFiles as file, fileIndex}
                <DraggableListItem
                  id={`file_${file.id}`}
                  index={fileIndex}
                  group="files"
                  class="group flex items-center gap-2.5 p-1.5 rounded-md cursor-pointer transition-colors text-left text-xs [&>*]:pointer-events-none {selection.isSelected(`file_${file.id}`) || store.activeWorkspaceFileId === file.id ? 'bg-primary/10 text-foreground font-medium' : 'hover:bg-muted/60 text-foreground font-normal'}"
                  getDragIndices={() => {
                    const ids = Array.from(selection.selectedIds);
                    return ids
                      .filter(id => id.startsWith('file_'))
                      .map(id => {
                         const fileId = id.replace('file_', '');
                         return store.workspaceFiles.findIndex(f => f.id === fileId);
                      })
                      .filter(idx => idx !== -1)
                      .sort((a, b) => a - b);
                  }}
                  onclick={(e) => {
                    const fileIds = store.workspaceFiles.map(f => `file_${f.id}`);
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
          </div>

          <!-- Resizable Horizontal Divider (Files <-> Pages) -->
          <div
            class="relative border-b border-border !cursor-row-resize shrink-0 z-10"
            onpointerdown={startFilesResize}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize Files and Pages panels"
          >
            <div class="absolute -top-1.5 -bottom-1.5 left-0 right-0 !cursor-row-resize"></div>
          </div>
        {/if}

        {#if featureFlags.isEnabled('workspace.pages')}
        <!-- Section 1: Pages (Independent Scrollable Container) -->
        <div
          class="flex flex-col min-h-0 shrink-0 py-1.5 gap-1.5 overflow-hidden"
          style="height: {featureFlags.isEnabled('outline') ? pagesPercent : (store.workspaceFiles.length > 0 && featureFlags.isEnabled('workspace.files') ? 100 - filesPercent : 100)}%;"
        >
          <div class="sidebar-section-header">
            <span class="sidebar-section-title">Pages</span>
            {#if featureFlags.isEnabled('page-actions.add-blank')}
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6 text-muted-foreground hover:text-foreground"
              disabled={!store.isDocumentLoaded}
              onclick={() => actions.addBlankPage(store.currentPageIndex)}
              title="Add blank page"
              aria-label="Add blank page"
            >
              <Plus class="h-3.5 w-3.5" />
            </Button>
            {/if}
          </div>

          <div class="flex-1 overflow-y-auto px-1.5 relative">
            {#if store.isDocumentLoaded}
              <PageThumbnailStrip />
            {:else}
              <div class="text-xs text-muted-foreground p-3 text-center">No document open.</div>
            {/if}
          </div>
        </div>

        {#if featureFlags.isEnabled('outline')}
        <!-- Resizable Horizontal Divider (Pages <-> Outline) -->
        <div
          class="relative border-b border-border !cursor-row-resize shrink-0 z-10"
          onpointerdown={startPagesResize}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize Pages and Outline panels"
        >
          <div class="absolute -top-1.5 -bottom-1.5 left-0 right-0 !cursor-row-resize"></div>
        </div>
        {/if}
        {/if}

        {#if featureFlags.isEnabled('outline')}
        <!-- Section 2: Outline (Independent Scrollable Container) -->
        <div
          class="flex flex-col min-h-0 flex-1 py-1.5 gap-1.5 overflow-hidden"
          style="height: {store.workspaceFiles.length > 0 && featureFlags.isEnabled('workspace.files') ? 100 - filesPercent - pagesPercent : 100 - pagesPercent}%;"
        >
          <div class="sidebar-section-header">
            <span class="sidebar-section-title">Outline</span>
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6 text-muted-foreground hover:text-foreground"
              disabled={!store.isDocumentLoaded}
              onclick={() => actions.addTextToOutline()}
              title="Add current selection or page to outline"
              aria-label="Add text to outline"
            >
              <Plus class="h-3.5 w-3.5" />
            </Button>
          </div>

          <div class="flex-1 overflow-y-auto px-1.5">
            {#if flatOutline.length === 0}
              <div class="text-xs text-muted-foreground px-1 py-2 text-left">
                No outline in document.
              </div>
            {:else}
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
                    onReorder={(from, to) => actions.reorderOutline(from, to)}
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
        </div>
        {/if}
      </div>
    {/if}
    </div>
  {/if}
</aside>
