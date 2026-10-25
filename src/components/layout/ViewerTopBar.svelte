<script lang="ts">
  import type { Component } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useHistoryStore } from '../../stores/history.svelte';
  import {
    useExportRegistry,
    groupExportersForMenu,
    getExportShortcutLabel,
    type ExportDefinition,
  } from '../../core/export-registry';
  import { useFeatureFlagStore, type FeatureFlag } from '../../core/feature-flags';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import * as Popover from '$lib/components/ui/popover/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { DropdownButton } from '$lib/components/ui/dropdown-button/index.js';
  import type { SelectMode } from '../../stores/types';
  import {
    Highlighter,
    Pencil,
    Eraser,
    StickyNote,
    Undo2,
    Redo2,
    Eye,
    MessageSquare,
    Check,
    MousePointer2,
    TextSelect,
    WholeWord,
    ChevronLeft,
    ChevronRight,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const canvasStore = useCanvasStore();
  const actions = useEditorActions();
  const historyStore = useHistoryStore();
  const exportRegistry = useExportRegistry();
  const featureFlags = useFeatureFlagStore();

  const exporters = $derived(exportRegistry.getAll());
  const enabledExporters = $derived(
    exporters.filter((exporter) => featureFlags.isEnabled(`export.${exporter.id}` as FeatureFlag))
  );
  const groupedExporters = $derived(groupExportersForMenu(enabledExporters));
  // note: collapse right panel when viewing mode is active with collapsed request or via feature flag
  const isRightPanelCollapsed = $derived(
    (store.rightPanelCollapsed && featureFlags.isEnabled('view-mode.viewing.collapse-sidebar')) ||
    (store.viewMode === 'viewing' && store.rightPanelCollapsed)
  );
  const showShiftedControls = $derived(
    (store.viewMode === 'viewing' || isRightPanelCollapsed) &&
      featureFlags.isEnabled('view-mode.viewing.toolbar-controls')
  );

  // note: selection tool state and synchronisation
  const currentSelectTool = $derived<SelectMode>(
    store.viewMode === 'viewing'
      ? 'text'
      : (store.selectMode === 'text' ? 'text' : (store.selectMode === 'precise' ? 'precise' : 'select'))
  );

  const isSelectToolActive = $derived(
    store.activeTool === 'select'
  );

  const activeSelectIcon = $derived(
    currentSelectTool === 'select'
      ? MousePointer2
      : currentSelectTool === 'text'
        ? TextSelect
        : WholeWord
  );

  const activeSelectAriaLabel = $derived(
    currentSelectTool === 'select'
      ? 'Select mode'
      : currentSelectTool === 'text'
        ? 'Text select mode'
        : 'Precise select mode'
  );

  const activeSelectTooltip = $derived(
    currentSelectTool === 'select'
      ? 'Select (V)'
      : currentSelectTool === 'text'
        ? 'Text Select'
        : 'Precise Select'
  );

  function selectSelectTool(mode: SelectMode): void {
    actions.setSelectMode(mode);
  }

  type AnnotationToolId = 'highlight' | 'pen' | 'eraser' | 'note';

  let lastAnnotateTool = $state<AnnotationToolId>('highlight');

  const canAnnotate = $derived(store.canAnnotate);
  const isSuggesting = $derived(store.isSuggestingMode);

  // note: synchronise last selected annotation tool with active store tool
  $effect(() => {
    if (
      store.activeTool === 'highlight' ||
      store.activeTool === 'pen' ||
      store.activeTool === 'eraser' ||
      store.activeTool === 'note'
    ) {
      lastAnnotateTool = store.activeTool;
    }
  });

  const currentAnnotateTool = $derived<AnnotationToolId>(
    isSuggesting && (lastAnnotateTool === 'pen' || lastAnnotateTool === 'eraser')
      ? 'highlight'
      : lastAnnotateTool
  );

  const isAnnotateToolActive = $derived(
    store.activeTool === 'highlight' ||
      store.activeTool === 'pen' ||
      store.activeTool === 'eraser' ||
      store.activeTool === 'note'
  );

  const activeAnnotateIcon = $derived(
    currentAnnotateTool === 'highlight'
      ? Highlighter
      : currentAnnotateTool === 'pen'
        ? Pencil
        : currentAnnotateTool === 'eraser'
          ? Eraser
          : StickyNote
  );

  const activeAnnotateIconClass = $derived(
    currentAnnotateTool === 'highlight' || currentAnnotateTool === 'note'
      ? 'text-warning'
      : undefined
  );

  const activeAnnotateAriaLabel = $derived(
    currentAnnotateTool === 'highlight'
      ? 'Highlighter'
      : currentAnnotateTool === 'pen'
        ? 'Pen tool'
        : currentAnnotateTool === 'eraser'
          ? 'Eraser tool'
          : 'Sticky note comment'
  );

  const activeAnnotateTooltip = $derived(
    currentAnnotateTool === 'highlight'
      ? 'Highlighter (Shift+H)'
      : currentAnnotateTool === 'pen'
        ? 'Pen (P)'
        : currentAnnotateTool === 'eraser'
          ? 'Eraser (E)'
          : 'Sticky Note (N)'
  );

  function selectTool(tool: AnnotationToolId): void {
    lastAnnotateTool = tool;
    if (store.activeTool === tool) {
      actions.setTool('select');
    } else {
      actions.setTool(tool);
    }
  }

  interface PresetColorOption {
    color: string;
    label: string;
    bg: string;
  }

  const PRESET_ANNOTATE_COLORS: readonly PresetColorOption[] = [
    { color: '#fde047', label: 'Yellow', bg: 'bg-yellow-300' },
    { color: '#86efac', label: 'Green', bg: 'bg-green-300' },
    { color: '#7dd3fc', label: 'Blue', bg: 'bg-sky-300' },
    { color: '#f472b6', label: 'Pink', bg: 'bg-pink-300' },
    { color: '#fdba74', label: 'Orange', bg: 'bg-orange-300' },
  ];
  const isCustomAnnotateColor = $derived(!PRESET_ANNOTATE_COLORS.some((p) => p.color === store.annotateColor));
  const otherPresetColors = $derived(
    PRESET_ANNOTATE_COLORS.filter((preset) => preset.color !== store.annotateColor)
  );

  let isColorDropdownOpen = $state(false);

  function applyColor(color: string): void {
    store.annotateColor = color;
    if (store.activeTool !== 'highlight' && store.activeTool !== 'pen' && store.activeTool !== 'note') {
      const targetTool: AnnotationToolId =
        currentAnnotateTool === 'pen' || currentAnnotateTool === 'note'
          ? currentAnnotateTool
          : 'highlight';
      selectTool(targetTool);
    }
  }

  function selectPresetColor(color: string): void {
    applyColor(color);
    isColorDropdownOpen = false;
  }

  // note: visual 1-based page indicator and quick-jump state
  const currentDisplayPage = $derived(
    store.isDocumentLoaded && store.pageCount > 0
      ? store.getVisualPageIndex(store.currentPageIndex) + 1
      : 0
  );

  let isEditingPageNumber = $state(false);
  let pageInputValue = $state('0');
  let lastActiveWorkspaceFileId = $state<string | null>(store.activeWorkspaceFileId);

  // note: reset editing state and synchronise page input upon workspace file switch
  $effect(() => {
    if (store.activeWorkspaceFileId !== lastActiveWorkspaceFileId) {
      lastActiveWorkspaceFileId = store.activeWorkspaceFileId;
      isEditingPageNumber = false;
      pageInputValue = String(currentDisplayPage);
    }
  });

  // note: synchronise text input with store page changes when not actively editing
  $effect(() => {
    const displayPage = currentDisplayPage;
    if (!isEditingPageNumber) {
      pageInputValue = String(displayPage);
    }
  });

  // note: dynamic digit length calculation matching current input length without horizontal padding
  const pageInputDigitCount = $derived(
    Math.max(pageInputValue.length, 1)
  );

  function handlePageInputFocus(e: FocusEvent): void {
    isEditingPageNumber = true;
    pageInputValue = String(currentDisplayPage);
    const target = e.currentTarget as HTMLInputElement | null;
    if (target && typeof target.select === 'function') {
      target.select();
    }
  }

  function handlePageInput(e: Event): void {
    const target = e.currentTarget as HTMLInputElement | null;
    if (!target) return;
    pageInputValue = target.value.replace(/[^0-9]/g, '');
  }

  function commitPageNumber(): void {
    if (!store.isDocumentLoaded || store.pageCount <= 0) {
      isEditingPageNumber = false;
      pageInputValue = '0';
      return;
    }
    const trimmed = pageInputValue.trim();
    const parsed = parseInt(trimmed, 10);
    if (!Number.isNaN(parsed)) {
      actions.goToPageNumber(parsed);
      const clamped = Math.max(1, Math.min(store.pageCount, parsed));
      pageInputValue = String(clamped);
    } else {
      pageInputValue = String(currentDisplayPage);
    }
    isEditingPageNumber = false;
  }

  function handlePageInputKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitPageNumber();
      const target = e.currentTarget as HTMLInputElement | null;
      target?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      isEditingPageNumber = false;
      pageInputValue = String(currentDisplayPage);
      const target = e.currentTarget as HTMLInputElement | null;
      target?.blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (store.isDocumentLoaded && store.pageCount > 0) {
        actions.goToPageNumber(currentDisplayPage + 1);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (store.isDocumentLoaded && store.pageCount > 0) {
        actions.goToPageNumber(currentDisplayPage - 1);
      }
    }
  }

  function handlePageInputBlur(): void {
    if (isEditingPageNumber) {
      commitPageNumber();
    }
  }
</script>

{#if featureFlags.isEnabled('select-tool') || featureFlags.isEnabled('annotations') || featureFlags.isEnabled('history') || featureFlags.isEnabled('page-navigation') || featureFlags.isEnabled('zoom') || featureFlags.isEnabled('view-mode') || featureFlags.isEnabled('export')}
<header
  role="toolbar"
  aria-label="Annotation toolbar"
  class="viewer-topbar flex items-center justify-between h-10 px-1.5 py-1.5 shrink-0 select-none min-w-0 border-b border-border box-border bg-background"
>
  <!-- note: left zone with selection and annotation tools -->
  <div data-toolbar-zone="left" class="flex items-center gap-1.5 flex-1 min-w-0">

    <!-- note: selection and annotation tool dropdown group with zero inter-tool spacing -->
    <div class="flex items-center gap-0 shrink-0">
      <!-- note: selection tools in separated split dropdown button on the most left -->
      {#if featureFlags.isEnabled('select-tool')}
      <div class="flex items-center shrink-0">
        <DropdownMenu.Root>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <div {...props} class="inline-flex items-center shrink-0">
                  <DropdownButton
                    variant="split"
                    size="sm"
                    icon={activeSelectIcon}
                    active={isSelectToolActive}
                    disabled={!store.isDocumentLoaded}
                    actionAriaLabel={activeSelectAriaLabel}
                    chevronAriaLabel="Selection tools"
                    onaction={() => selectSelectTool(currentSelectTool)}
                  />
                </div>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">{activeSelectTooltip}</Tooltip.Content>
          </Tooltip.Root>

          <DropdownMenu.Content align="start" class="w-52">
            {#if featureFlags.isEnabled('select-tool.cluster')}
            <DropdownMenu.Item
              class="flex items-center justify-between gap-2 text-xs cursor-pointer"
              disabled={!store.isDocumentLoaded}
              onclick={() => selectSelectTool('select')}
            >
              <div class="flex items-center gap-2">
                <MousePointer2 class="w-3.5 h-3.5 shrink-0" />
                <div class="flex flex-col">
                  <span class="font-medium text-foreground">Select (V)</span>
                  <span class="text-[10px] text-muted-foreground leading-tight">Select clusters and objects</span>
                </div>
              </div>
              {#if currentSelectTool === 'select'}
                <Check class="w-3 h-3 text-foreground shrink-0" />
              {/if}
            </DropdownMenu.Item>
            {/if}

            {#if featureFlags.isEnabled('select-tool.text')}
            <DropdownMenu.Item
              class="flex items-center justify-between gap-2 text-xs cursor-pointer"
              disabled={!store.isDocumentLoaded}
              onclick={() => selectSelectTool('text')}
            >
              <div class="flex items-center gap-2">
                <TextSelect class="w-3.5 h-3.5 shrink-0" />
                <div class="flex flex-col">
                  <span class="font-medium text-foreground">Text Select</span>
                  <span class="text-[10px] text-muted-foreground leading-tight">Select text as in view mode</span>
                </div>
              </div>
              {#if currentSelectTool === 'text'}
                <Check class="w-3 h-3 text-foreground shrink-0" />
              {/if}
            </DropdownMenu.Item>
            {/if}

            {#if featureFlags.isEnabled('select-tool.precise')}
            <DropdownMenu.Item
              class="flex items-center justify-between gap-2 text-xs cursor-pointer"
              disabled={!store.isDocumentLoaded}
              onclick={() => selectSelectTool('precise')}
            >
              <div class="flex items-center gap-2">
                <WholeWord class="w-3.5 h-3.5 shrink-0" />
                <div class="flex flex-col">
                  <span class="font-medium text-foreground">Precise Select</span>
                  <span class="text-[10px] text-muted-foreground leading-tight">Select single words</span>
                </div>
              </div>
              {#if currentSelectTool === 'precise'}
                <Check class="w-3 h-3 text-foreground shrink-0" />
              {/if}
            </DropdownMenu.Item>
            {/if}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
      {/if}

      <!-- note: essential annotation markup tools in separated split dropdown button -->
      {#if featureFlags.isEnabled('annotations')}
      {#if featureFlags.isEnabled('annotations.highlighter') || featureFlags.isEnabled('annotations.pen') || featureFlags.isEnabled('annotations.eraser') || featureFlags.isEnabled('annotations.note')}
      <div class="flex items-center shrink-0">
        <DropdownMenu.Root>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <div {...props} class="inline-flex items-center shrink-0">
                  <DropdownButton
                    variant="split"
                    size="sm"
                    icon={activeAnnotateIcon}
                    iconClass={activeAnnotateIconClass}
                    active={isAnnotateToolActive}
                    disabled={!store.isDocumentLoaded || !canAnnotate}
                    actionAriaLabel={activeAnnotateAriaLabel}
                    chevronAriaLabel="Annotation tools"
                    onaction={() => selectTool(currentAnnotateTool)}
                  />
                </div>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">{activeAnnotateTooltip}</Tooltip.Content>
          </Tooltip.Root>

        <DropdownMenu.Content align="start" class="w-48">
          {#if featureFlags.isEnabled('annotations.highlighter')}
          <DropdownMenu.Item
            class="flex items-center justify-between gap-2 text-xs cursor-pointer"
            disabled={!store.isDocumentLoaded || !canAnnotate}
            onclick={() => selectTool('highlight')}
          >
            <div class="flex items-center gap-2">
              <Highlighter class="w-3.5 h-3.5 text-warning shrink-0" />
              <span>Highlighter (Shift+H)</span>
            </div>
            {#if currentAnnotateTool === 'highlight'}
              <Check class="w-3 h-3 text-foreground shrink-0" />
            {/if}
          </DropdownMenu.Item>
          {/if}

          {#if featureFlags.isEnabled('annotations.pen')}
          <DropdownMenu.Item
            class="flex items-center justify-between gap-2 text-xs cursor-pointer"
            disabled={!store.isDocumentLoaded || !canAnnotate || isSuggesting}
            onclick={() => selectTool('pen')}
          >
            <div class="flex items-center gap-2">
              <Pencil class="w-3.5 h-3.5 shrink-0" />
              <span>Pen (P)</span>
            </div>
            {#if currentAnnotateTool === 'pen'}
              <Check class="w-3 h-3 text-foreground shrink-0" />
            {/if}
          </DropdownMenu.Item>
          {/if}

          {#if featureFlags.isEnabled('annotations.eraser')}
          <DropdownMenu.Item
            class="flex items-center justify-between gap-2 text-xs cursor-pointer"
            disabled={!store.isDocumentLoaded || !canAnnotate || isSuggesting}
            onclick={() => selectTool('eraser')}
          >
            <div class="flex items-center gap-2">
              <Eraser class="w-3.5 h-3.5 shrink-0" />
              <span>Eraser (E)</span>
            </div>
            {#if currentAnnotateTool === 'eraser'}
              <Check class="w-3 h-3 text-foreground shrink-0" />
            {/if}
          </DropdownMenu.Item>
          {/if}

          {#if featureFlags.isEnabled('annotations.note')}
          <DropdownMenu.Item
            class="flex items-center justify-between gap-2 text-xs cursor-pointer"
            disabled={!store.isDocumentLoaded || !canAnnotate}
            onclick={() => selectTool('note')}
          >
            <div class="flex items-center gap-2">
              <StickyNote class="w-3.5 h-3.5 text-warning shrink-0" />
              <span>Sticky Note (N)</span>
            </div>
            {#if currentAnnotateTool === 'note'}
              <Check class="w-3 h-3 text-foreground shrink-0" />
            {/if}
          </DropdownMenu.Item>
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
    {/if}
    {/if}
  </div>

    <!-- note: colour palette dropdown and stroke width controls -->
    {#if featureFlags.isEnabled('annotations')}
    {#if featureFlags.isEnabled('annotations.colors')}
    <div class="flex items-center gap-2 shrink-0">
      <Popover.Root bind:open={isColorDropdownOpen}>
        <Popover.Trigger
          type="button"
          class="size-4.5 w-4.5 h-4.5 p-0 shrink-0 rounded-full relative after:absolute after:-inset-1 cursor-pointer transition-colors duration-150 ease-out disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          style="background-color: {store.annotateColor};"
          disabled={!store.isDocumentLoaded || !canAnnotate}
          title="Annotation colour"
          aria-label="Annotation colour options"
        ></Popover.Trigger>

        <Popover.Content
          align="start"
          sideOffset={4}
          class="flex flex-row items-center gap-1.5 p-1.5 rounded-xl border border-border bg-popover select-none w-auto min-w-0 z-50"
        >
          {#each otherPresetColors as preset (preset.color)}
            <button
              type="button"
              class="size-4.5 w-4.5 h-4.5 p-0 shrink-0 rounded-full relative after:absolute after:-inset-1 cursor-pointer transition-colors duration-150 ease-out disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 {preset.bg}"
              onclick={() => selectPresetColor(preset.color)}
              disabled={!store.isDocumentLoaded || !canAnnotate}
              title={preset.label}
              aria-label={preset.label}
            ></button>
          {/each}
          <ColorPicker
            variant="circle"
            showPlus={true}
            value={store.annotateColor}
            disabled={!store.isDocumentLoaded || !canAnnotate}
            onValueChange={applyColor}
            label="Custom Colour"
            class="size-4.5 w-4.5 h-4.5 p-0 shrink-0 rounded-full relative after:absolute after:-inset-1 border-0 transition-colors duration-150 ease-out {isCustomAnnotateColor ? 'ring-2 ring-ring ring-offset-1' : ''}"
          />
        </Popover.Content>
      </Popover.Root>

      <!-- note: stroke width dropdown when pen tool is active matching zoom dropdown architecture -->
      {#if store.activeTool === 'pen'}
        <DropdownMenu.Root>
          <DropdownButton
            variant="default"
            size="compact"
            class="text-muted-foreground hover:text-foreground"
            disabled={!store.isDocumentLoaded || !canAnnotate}
            aria-label="Pen stroke width"
          >
            <span>{store.annotateStrokeWidth}pt</span>
          </DropdownButton>
          <DropdownMenu.Content align="start" class="w-20 min-w-[70px]">
            <DropdownMenu.Item class="text-xs cursor-pointer flex items-center justify-between" onclick={() => { store.annotateStrokeWidth = 1; }}>
              <span>1pt</span>
              {#if store.annotateStrokeWidth === 1}
                <Check class="w-3 h-3 text-foreground shrink-0" />
              {/if}
            </DropdownMenu.Item>
            <DropdownMenu.Item class="text-xs cursor-pointer flex items-center justify-between" onclick={() => { store.annotateStrokeWidth = 2; }}>
              <span>2pt</span>
              {#if store.annotateStrokeWidth === 2}
                <Check class="w-3 h-3 text-foreground shrink-0" />
              {/if}
            </DropdownMenu.Item>
            <DropdownMenu.Item class="text-xs cursor-pointer flex items-center justify-between" onclick={() => { store.annotateStrokeWidth = 4; }}>
              <span>4pt</span>
              {#if store.annotateStrokeWidth === 4}
                <Check class="w-3 h-3 text-foreground shrink-0" />
              {/if}
            </DropdownMenu.Item>
            <DropdownMenu.Item class="text-xs cursor-pointer flex items-center justify-between" onclick={() => { store.annotateStrokeWidth = 6; }}>
              <span>6pt</span>
              {#if store.annotateStrokeWidth === 6}
                <Check class="w-3 h-3 text-foreground shrink-0" />
              {/if}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
    </div>
    {/if}
    {/if}
  </div>

  <!-- note: centre zone with centred page navigation and previous/next arrows -->
  <div data-toolbar-zone="centre" class="flex items-center justify-center shrink-0">
    {#if featureFlags.isEnabled('page-navigation')}
    <div class="flex items-center gap-0.5 text-xs font-medium text-muted-foreground shrink-0" aria-label="Page navigation">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon"
              aria-label="Previous page"
              class="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
              disabled={!store.isDocumentLoaded || !store.canGoPrev}
              onclick={() => actions.goToPrevPage()}
            >
              <ChevronLeft class="w-3.5 h-3.5" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="bottom">Previous page</Tooltip.Content>
      </Tooltip.Root>

      <div class="flex items-center gap-0 text-xs font-medium text-foreground shrink-0">
        <Input
          type="text"
          inputmode="numeric"
          size="compact"
          value={pageInputValue}
          disabled={!store.isDocumentLoaded || store.pageCount === 0}
          aria-label="Current page number"
          class="h-7 px-0 py-0 text-center text-xs font-medium rounded-none bg-transparent text-foreground shrink-0"
          style="width: {pageInputDigitCount}ch;"
          onfocus={handlePageInputFocus}
          oninput={handlePageInput}
          onkeydown={handlePageInputKeydown}
          onblur={handlePageInputBlur}
        />
        <span class="text-xs font-medium text-foreground select-none"><span class="px-0.5">/</span>{store.isDocumentLoaded ? store.pageCount : 0}</span>
      </div>

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon"
              aria-label="Next page"
              class="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
              disabled={!store.isDocumentLoaded || !store.canGoNext}
              onclick={() => actions.goToNextPage()}
            >
              <ChevronRight class="w-3.5 h-3.5" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="bottom">Next page</Tooltip.Content>
      </Tooltip.Root>
    </div>
    {/if}
  </div>

  <!-- note: right zone with zoom and shifted controls -->
  <div data-toolbar-zone="right" class="flex items-center justify-end gap-1.5 flex-1 min-w-0">
    {#if featureFlags.isEnabled('zoom')}
    <DropdownMenu.Root>
      <DropdownButton
        variant="default"
        size="compact"
        class="text-muted-foreground hover:text-foreground"
        disabled={!store.isDocumentLoaded}
        aria-label="Zoom level"
      >
        <span>{store.isDocumentLoaded ? `${store.zoomPercent}%` : '100%'}</span>
      </DropdownButton>
      <DropdownMenu.Content align="end" class="w-24 min-w-[80px]">
        <DropdownMenu.Item class="text-xs" onclick={() => actions.setZoom(0.5)}>50%</DropdownMenu.Item>
        <DropdownMenu.Item class="text-xs" onclick={() => actions.setZoom(0.75)}>75%</DropdownMenu.Item>
        <DropdownMenu.Item class="text-xs" onclick={() => actions.setZoom(1.0)}>100%</DropdownMenu.Item>
        <DropdownMenu.Item class="text-xs" onclick={() => actions.setZoom(1.25)}>125%</DropdownMenu.Item>
        <DropdownMenu.Item class="text-xs" onclick={() => actions.setZoom(1.5)}>150%</DropdownMenu.Item>
        <DropdownMenu.Item class="text-xs" onclick={() => actions.setZoom(2.0)}>200%</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    {/if}

    {#if featureFlags.isEnabled('annotations.eraser')}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            class="h-7 w-7 {store.activeTool === 'eraser' ? 'bg-accent text-accent-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => selectTool('eraser')}
            disabled={!store.isDocumentLoaded || !canAnnotate || isSuggesting}
            aria-label="Eraser tool"
            aria-pressed={store.activeTool === 'eraser'}
          >
            <Eraser class="w-3.5 h-3.5 text-destructive" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">Eraser (E)</Tooltip.Content>
    </Tooltip.Root>
    {/if}

    {#if featureFlags.isEnabled('annotations.note')}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            class="h-7 w-7 {store.activeTool === 'note' ? 'bg-accent text-accent-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => selectTool('note')}
            disabled={!store.isDocumentLoaded || !canAnnotate}
            aria-label="Sticky note comment"
            aria-pressed={store.activeTool === 'note'}
          >
            <StickyNote class="w-3.5 h-3.5 text-warning" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">Sticky Note (N)</Tooltip.Content>
    </Tooltip.Root>
    {/if}
  </div>

  <!-- note: colour palette presets and stroke width controls -->
  {#if featureFlags.isEnabled('annotations.colors')}
  <div class="flex items-center gap-2 shrink-0">
    <div class="flex items-center gap-1.5">
      <button
        type="button"
        class="w-4.5 h-4.5 rounded-full bg-yellow-300 border border-yellow-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#fde047' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        onclick={() => applyColor('#fde047')}
        disabled={!store.isDocumentLoaded || !canAnnotate}
        title="Yellow"
        aria-label="Yellow"
        aria-pressed={store.annotateColor === '#fde047'}
      ></button>
      <button
        type="button"
        class="w-4.5 h-4.5 rounded-full bg-green-300 border border-green-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#86efac' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        onclick={() => applyColor('#86efac')}
        disabled={!store.isDocumentLoaded || !canAnnotate}
        title="Green"
        aria-label="Green"
        aria-pressed={store.annotateColor === '#86efac'}
      ></button>
      <button
        type="button"
        class="w-4.5 h-4.5 rounded-full bg-sky-300 border border-sky-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#7dd3fc' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        onclick={() => applyColor('#7dd3fc')}
        disabled={!store.isDocumentLoaded || !canAnnotate}
        title="Blue"
        aria-label="Blue"
        aria-pressed={store.annotateColor === '#7dd3fc'}
      ></button>
      <button
        type="button"
        class="w-4.5 h-4.5 rounded-full bg-pink-300 border border-pink-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#f472b6' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        onclick={() => applyColor('#f472b6')}
        disabled={!store.isDocumentLoaded || !canAnnotate}
        title="Pink"
        aria-label="Pink"
        aria-pressed={store.annotateColor === '#f472b6'}
      ></button>
      <button
        type="button"
        class="w-4.5 h-4.5 rounded-full bg-orange-300 border border-orange-400 focus:ring-1 focus:ring-primary {store.annotateColor === '#fdba74' ? 'ring-2 ring-primary ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        onclick={() => applyColor('#fdba74')}
        disabled={!store.isDocumentLoaded || !canAnnotate}
        title="Orange"
        aria-label="Orange"
        aria-pressed={store.annotateColor === '#fdba74'}
      ></button>
      <ColorPicker
        variant="circle"
        value={store.annotateColor}
        disabled={!store.isDocumentLoaded || !canAnnotate}
        onValueChange={applyColor}
        label="Custom Colour"
        class="size-4.5 {isCustomAnnotateColor ? 'ring-2 ring-primary ring-offset-1' : ''}"
      />
    </div>

    <!-- note: stroke width buttons when pen tool is active -->
    {#if store.activeTool === 'pen'}
      <div class="h-3.5 w-px bg-border/60 mx-0.5 shrink-0" role="separator" aria-orientation="vertical"></div>
      <ButtonGroup variant="outline" size="sm" class="h-6" aria-label="Stroke width">
        <Button
          variant={store.annotateStrokeWidth === 1 ? 'default' : 'outline'}
          class="px-1.5 text-[10px] h-6"
          onclick={() => { store.annotateStrokeWidth = 1; }}
          disabled={!store.isDocumentLoaded || !canAnnotate}
          aria-label="1 point stroke width"
          aria-pressed={store.annotateStrokeWidth === 1}
        >1pt</Button>
        <Button
          variant={store.annotateStrokeWidth === 2 ? 'default' : 'outline'}
          class="px-1.5 text-[10px] h-6"
          onclick={() => { store.annotateStrokeWidth = 2; }}
          disabled={!store.isDocumentLoaded || !canAnnotate}
          aria-label="2 point stroke width"
          aria-pressed={store.annotateStrokeWidth === 2}
        >2pt</Button>
        <Button
          variant={store.annotateStrokeWidth === 4 ? 'default' : 'outline'}
          class="px-1.5 text-[10px] h-6"
          onclick={() => { store.annotateStrokeWidth = 4; }}
          disabled={!store.isDocumentLoaded || !canAnnotate}
          aria-label="4 point stroke width"
          aria-pressed={store.annotateStrokeWidth === 4}
        >4pt</Button>
        <Button
          variant={store.annotateStrokeWidth === 6 ? 'default' : 'outline'}
          class="px-1.5 text-[10px] h-6"
          onclick={() => { store.annotateStrokeWidth = 6; }}
          disabled={!store.isDocumentLoaded || !canAnnotate}
          aria-label="6 point stroke width"
          aria-pressed={store.annotateStrokeWidth === 6}
        >6pt</Button>
      </ButtonGroup>
    {/if}
  </div>
  {/if}
</header>
{/if}
