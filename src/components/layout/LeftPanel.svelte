<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import type { OutlineNode } from '../../core/types';
  import PageThumbnailStrip from '../panels/PageThumbnailStrip.svelte';
  import ComponentsPanel from '../panels/ComponentsPanel.svelte';
  import AnnotatePanel from '../panels/AnnotatePanel.svelte';
  import ImpositionPanel from '../panels/ImpositionPanel.svelte';
  import ToolsPanel from '../panels/ToolsPanel.svelte';
  import SettingsPanel from '../panels/SettingsPanel.svelte';
  import PageThumbnailImage from '../common/PageThumbnailImage.svelte';
  import DraggableListItem from '../common/DraggableListItem.svelte';
  import { useSelection } from '../../stores/selection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import {
    ChevronDown,
    ChevronRight,
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

  const store = useEditorStore();
  const actions = useEditorActions();
  const selection = useSelection();

  let outline = $state<OutlineNode[]>([]);
  let expandedNodes = $state<Record<string, boolean>>({});

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

  function toggleNodeExpand(title: string, e: MouseEvent): void {
    e.stopPropagation();
    expandedNodes[title] = !expandedNodes[title];
  }

  let pagesRafId: number | null = null;
  let filesRafId: number | null = null;

  // --- Pages Divider (between Pages and Outline) ---
  function startPagesResize(e: PointerEvent): void {
    e.preventDefault();
    isDraggingPagesDivider = true;
    window.addEventListener('pointermove', handlePagesPointerMove);
    window.addEventListener('pointerup', stopPagesResize);
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
  }

  // --- Files Divider (between Files and Pages) ---
  function startFilesResize(e: PointerEvent): void {
    e.preventDefault();
    if (store.workspaceFiles.length === 0) return;
    isDraggingFilesDivider = true;
    window.addEventListener('pointermove', handleFilesPointerMove);
    window.addEventListener('pointerup', stopFilesResize);
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
  }
</script>

{#snippet outlineNode(node: OutlineNode, depth: number)}
  {@const hasChildren = Boolean(node.children && node.children.length > 0)}
  {@const isExpanded = expandedNodes[node.title] ?? true}

  <div class="flex flex-col">
    <div
      class="flex items-center gap-1.5 p-1.5 rounded-md cursor-pointer text-xs transition-colors {selection.isSelected(`outline_${node.title}`) ? 'bg-primary/10 text-foreground font-medium' : 'hover:bg-muted/60 text-foreground font-normal'}"
      style="margin-left: {depth * 12}px"
      onclick={(e) => {
        const flatNodes: string[] = [];
        const flatten = (nodes: OutlineNode[]) => {
          for (const n of nodes) {
            flatNodes.push(`outline_${n.title}`);
            if (n.children) flatten(n.children);
          }
        };
        flatten(outline);
        
        selection.select(
          `outline_${node.title}`,
          e.ctrlKey || e.metaKey,
          e.shiftKey,
          (start, end) => {
            const startIndex = flatNodes.indexOf(start);
            const endIndex = flatNodes.indexOf(end);
            if (startIndex === -1 || endIndex === -1) return [];
            const min = Math.min(startIndex, endIndex);
            const max = Math.max(startIndex, endIndex);
            return flatNodes.slice(min, max + 1);
          }
        );

        if (!e.ctrlKey && !e.shiftKey && !e.metaKey && node.pageIndex !== null) {
            actions.goToPage(node.pageIndex);
        }
      }}
      role="button"
      tabindex="0"
      onkeydown={(e) => {
        if (e.key === 'Enter' && node.pageIndex !== null) actions.goToPage(node.pageIndex);
      }}
    >
      {#if hasChildren}
        <button
          type="button"
          class="p-0.5 hover:bg-muted rounded"
          onclick={(e) => toggleNodeExpand(node.title, e)}
        >
          {#if isExpanded}
            <ChevronDown class="h-3 w-3 text-muted-foreground shrink-0" />
          {:else}
            <ChevronRight class="h-3 w-3 text-muted-foreground shrink-0" />
          {/if}
        </button>
      {:else if depth > 0}
        <span class="w-3 shrink-0"></span>
      {/if}

      {#if depth === 0}
        <Heading1 class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      {:else if depth === 1}
        <Heading2 class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      {:else if depth === 2}
        <Heading3 class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      {:else if depth === 3}
        <Heading4 class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      {:else if depth === 4}
        <Heading5 class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      {:else if depth === 5}
        <Heading6 class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      {:else}
        <Heading class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      {/if}

      <span class="truncate text-xs font-normal">{node.title}</span>
    </div>

    {#if hasChildren && isExpanded}
      {#each node.children as child}
        {@render outlineNode(child, depth + 1)}
      {/each}
    {/if}
  </div>
{/snippet}

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
          {#if store.leftPanelMode === 'components'}
            <span class="panel-title">Components</span>
            <span class="panel-subtitle">Insert text, images & shapes</span>
          {:else if store.leftPanelMode === 'annotate'}
            <span class="panel-title">Annotate</span>
            <span class="panel-subtitle">Markup, redact & draw</span>
          {:else if store.leftPanelMode === 'imposition'}
            <span class="panel-title">Page Imposition</span>
            <span class="panel-subtitle">N-Up, booklet & sheet layouts</span>
          {:else if store.leftPanelMode === 'tools'}
            <span class="panel-title">Tools & OCR</span>
            <span class="panel-subtitle">OCR, extract & page numbers</span>
          {:else if store.leftPanelMode === 'settings'}
            <span class="panel-title">Settings</span>
            <span class="panel-subtitle">Document security & info</span>
          {:else}
            <button
              type="button"
              class="flex items-center gap-1 panel-title hover:text-primary truncate text-left group"
              title={store.fileName}
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
        >
          <PanelLeftClose class="h-4 w-4" />
        </Button>
      </div>


    </div>

    <!-- Body Panel Container -->
    {#if store.leftPanelMode === 'components'}
      <div class="panel-content">
        <ComponentsPanel />
      </div>
    {:else if store.leftPanelMode === 'annotate'}
      <div class="panel-content">
        <AnnotatePanel />
      </div>
    {:else if store.leftPanelMode === 'imposition'}
      <div class="panel-content">
        <ImpositionPanel />
      </div>
    {:else if store.leftPanelMode === 'tools'}
      <div class="panel-content">
        <ToolsPanel />
      </div>
    {:else if store.leftPanelMode === 'settings'}
      <div class="panel-content">
        <SettingsPanel />
      </div>
    {:else}
      <!-- Resizable Split View Container (Files, Pages, Outline) -->
      <div
        bind:this={mainContainerEl}
        class="flex-1 flex flex-col min-h-0 overflow-hidden relative"
      >
        {#if store.workspaceFiles.length > 0}
          <!-- Section 0: Files (Independent Scrollable Container) -->
          <div
            class="flex flex-col min-h-0 shrink-0 py-1.5 gap-1.5 overflow-hidden"
            style="height: {filesPercent}%;"
          >
            <div class="sidebar-section-header">
              <span class="sidebar-section-title">Files</span>
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6 text-muted-foreground hover:text-foreground"
                onclick={() => actions.triggerFileOpen(true)}
                title="Add PDF to workspace"
              >
                <Plus class="h-3.5 w-3.5" />
              </Button>
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

        <!-- Section 1: Pages (Independent Scrollable Container) -->
        <div
          class="flex flex-col min-h-0 shrink-0 py-1.5 gap-1.5 overflow-hidden"
          style="height: {pagesPercent}%;"
        >
          <div class="sidebar-section-header">
            <span class="sidebar-section-title">Pages</span>
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6 text-muted-foreground hover:text-foreground"
              disabled={!store.isDocumentLoaded}
              onclick={() => actions.addBlankPage(store.currentPageIndex)}
              title="Add blank page"
            >
              <Plus class="h-3.5 w-3.5" />
            </Button>
          </div>

          <div class="flex-1 overflow-y-auto px-1.5 relative">
            {#if store.isDocumentLoaded}
              <PageThumbnailStrip />
            {:else}
              <div class="text-xs text-muted-foreground p-3 text-center">No document open.</div>
            {/if}
          </div>
        </div>

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

        <!-- Section 2: Outline (Independent Scrollable Container) -->
        <div
          class="flex flex-col min-h-0 flex-1 py-1.5 gap-1.5 overflow-hidden"
          style="height: {store.workspaceFiles.length > 0 ? 100 - filesPercent - pagesPercent : 100 - pagesPercent}%;"
        >
          <div class="sidebar-section-header">
            <span class="sidebar-section-title">Outline</span>
          </div>

          <div class="flex-1 overflow-y-auto px-1.5">
            {#if outline.length === 0}
              <div class="text-xs text-muted-foreground px-1 py-2 text-left italic">
                No outline in document.
              </div>
            {:else}
              <div class="flex flex-col gap-0.5">
                {#each outline as node}
                  {@render outlineNode(node, 0)}
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}
    </div>
  {/if}
</aside>
