<script lang="ts">
  import type { Component } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import TextPropertiesPanel from '../panels/TextPropertiesPanel.svelte';
  import PagePropertiesPanel from '../panels/PagePropertiesPanel.svelte';
  import ElementPropertiesPanel from '../panels/ElementPropertiesPanel.svelte';
  import ShapeSection from '../panels/element-properties/ShapeSection.svelte';
  import ImageSection from '../panels/element-properties/ImageSection.svelte';
  import PositionSizeSection from '../panels/element-properties/PositionSizeSection.svelte';
  import TransformSection from '../panels/element-properties/TransformSection.svelte';
  import ArrangeSection from '../panels/element-properties/ArrangeSection.svelte';
  import ActionsSection from '../panels/element-properties/ActionsSection.svelte';
  import FormFieldSection from '../panels/element-properties/FormFieldSection.svelte';
  import FormFieldRulesSection from '../panels/element-properties/FormFieldRulesSection.svelte';
  import { Pencil, Eye, MessageSquare, Check } from 'lucide-svelte';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { DropdownButton } from '$lib/components/ui/dropdown-button/index.js';
  import {
    useExportRegistry,
    groupExportersForMenu,
    getExportShortcutLabel,
    type ExportDefinition,
  } from '../../core/export-registry';
  import { usePanelRegistry } from '../../core/panel-registry';
  import { useFeatureFlagStore, type FeatureFlag } from '../../core/feature-flags';

  const store = useEditorStore();
  const canvasStore = useCanvasStore();
  const actions = useEditorActions();
  const exportRegistry = useExportRegistry();
  const panelRegistry = usePanelRegistry();
  const featureFlags = useFeatureFlagStore();

  const exporters = $derived(exportRegistry.getAll());
  const enabledExporters = $derived(
    exporters.filter((exporter) => featureFlags.isEnabled(`export.${exporter.id}` as FeatureFlag))
  );
  const groupedExporters = $derived(groupExportersForMenu(enabledExporters));
  const rightPanels = $derived(panelRegistry.getByPosition('right'));
  // note: collapse right panel when document is unloaded or when viewing mode is active with collapsed request
  const isPanelCollapsed = $derived(
    (!store.isDocumentLoaded && featureFlags.isEnabled('panels.collapse-empty')) ||
    (store.rightPanelCollapsed && featureFlags.isEnabled('view-mode.viewing.collapse-sidebar')) ||
    (store.viewMode === 'viewing' && store.rightPanelCollapsed)
  );

  // note: resolve whether an interactive canvas element or native PDF span is selected
  const hasActiveObjectSelection = $derived(
    !store.isReadOnly &&
    store.canSelectElements &&
    (Boolean(canvasStore.selectedElementId) || store.hasSelection)
  );

  // note: suppress read-only form field rules summary when full editable form field inspector is active
  const isEditingFormField = $derived(
    !store.isReadOnly &&
    store.canSelectElements &&
    (store.selectedSpan?.type === 'form-field' || canvasStore.selectedElement?.kind === 'form-field')
  );

  let activeTab = $state('properties');

  // note: synchronise active tab with organiser view when organiser tab is active in panel registry
  $effect(() => {
    if (store.showOrganizerView) {
      activeTab = 'organizer';
    } else if (activeTab === 'organizer') {
      activeTab = 'properties';
    }
  });

  function handleTabChange(value: string): void {
    activeTab = value;
    store.showOrganizerView = value === 'organizer';
  }
</script>

<aside 
  class="h-full flex flex-col overflow-hidden select-none w-full bg-card"
  style={isPanelCollapsed ? 'width: 0px; padding: 0;' : ''}
  aria-label="Properties and tools panel"
>
  {#if !isPanelCollapsed}
    <div class="panel-container rounded-none border-0 shadow-none bg-card">
      <div class="panel-header-compact">
        <!-- note: mode, export and collapse triggers in top header row -->
        <div class="flex items-center justify-end gap-1.5 w-full min-w-0">
          <div class="flex items-center justify-end gap-1.5 shrink-0">
            {#if featureFlags.isEnabled('view-mode')}
            <DropdownMenu.Root>
              <DropdownButton
                variant="default"
                size="sm"
                class="text-muted-foreground hover:text-foreground"
                disabled={!store.isDocumentLoaded}
                aria-label="Viewing mode"
                text={store.viewMode === 'editing' ? 'Editing' : store.viewMode === 'viewing' ? 'View' : 'Suggesting'}
              />
              <DropdownMenu.Content align="end" class="w-52">
                <DropdownMenu.Item
                  class="flex flex-col items-start gap-0.5 py-1.5 cursor-pointer"
                  onclick={() => store.setViewMode('editing')}
                >
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <Pencil class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span class="font-medium text-foreground text-xs">Editing</span>
                    </div>
                    {#if store.viewMode === 'editing'}
                      <Check class="w-3.5 h-3.5 text-foreground shrink-0" />
                    {/if}
                  </div>
                  <span class="text-xs text-muted-foreground leading-snug">Edit document directly</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  class="flex flex-col items-start gap-0.5 py-1.5 cursor-pointer"
                  onclick={() => store.setViewMode('suggesting')}
                >
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <MessageSquare class="w-3.5 h-3.5 text-warning shrink-0" />
                      <span class="font-medium text-foreground text-xs">Suggesting</span>
                    </div>
                    {#if store.viewMode === 'suggesting'}
                      <Check class="w-3.5 h-3.5 text-foreground shrink-0" />
                    {/if}
                  </div>
                  <span class="text-xs text-muted-foreground leading-snug">Edits become suggestions</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  class="flex flex-col items-start gap-0.5 py-1.5 cursor-pointer"
                  onclick={() => store.setViewMode('viewing')}
                >
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <Eye class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span class="font-medium text-foreground text-xs">View</span>
                    </div>
                    {#if store.viewMode === 'viewing'}
                      <Check class="w-3.5 h-3.5 text-foreground shrink-0" />
                    {/if}
                  </div>
                  <span class="text-xs text-muted-foreground leading-snug">Read-only view without changes</span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
            {/if}

            {#if featureFlags.isEnabled('export')}
            {#snippet exportMenuItem(exporter: ExportDefinition)}
                  <DropdownMenu.Item
                    class="text-xs"
                    onclick={() => exporter.export({
                      editorStore: store,
                      canvasStore,
                      actions,
                      service: actions.service,
                      canvasElements: canvasStore.elements,
                      pageTransforms: store.pageTransforms,
                    })}
                  >
                    {#if exporter.icon}
                      {@const IconComp = exporter.icon as Component<{ class?: string }>}
                      <IconComp class="w-3 h-3 mr-2" />
                    {/if}
                    <span>{exporter.label}</span>
                    {#if getExportShortcutLabel(exporter)}
                      <DropdownMenu.Shortcut class="tracking-normal">{getExportShortcutLabel(exporter)}</DropdownMenu.Shortcut>
                    {/if}
                  </DropdownMenu.Item>
            {/snippet}
            <DropdownMenu.Root>
              <DropdownButton
                variant="filled-bordered"
                fillColor="primary"
                size="sm"
                aria-label="Export document"
                disabled={!store.isDocumentLoaded}
                text="Export"
              />
              <DropdownMenu.Content align="end" class="w-48">
                {#each groupedExporters.pdfItems as exporter (exporter.id)}
                  {@render exportMenuItem(exporter)}
                {/each}

                {#if groupedExporters.pdfItems.length > 0 && groupedExporters.submenus.length > 0}
                  <DropdownMenu.Separator />
                {/if}

                {#each groupedExporters.submenus as submenu (submenu.category)}
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger class="text-xs">
                      <span>{submenu.label}</span>
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.SubContent class="w-48">
                      {#each submenu.items as exporter (exporter.id)}
                        {@render exportMenuItem(exporter)}
                      {/each}
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Sub>
                {/each}

                {#if (groupedExporters.pdfItems.length > 0 || groupedExporters.submenus.length > 0) && groupedExporters.trailingItems.length > 0}
                  <DropdownMenu.Separator />
                {/if}

                {#each groupedExporters.trailingItems as exporter (exporter.id)}
                  {@render exportMenuItem(exporter)}
                {/each}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
            {/if}

            <!-- note: right panel collapse button commented out -->
            <!--
            {#if featureFlags.isEnabled('view-mode.viewing.collapse-sidebar')}
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon"
                    aria-label="Collapse panel"
                    class="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                    onclick={() => { store.rightPanelCollapsed = true; }}
                  >
                    <PanelRightClose class="w-3.5 h-3.5" />
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content side="bottom">Collapse Panel</Tooltip.Content>
            </Tooltip.Root>
            {/if}
            -->
          </div>
        </div>

        <!-- note: properties tab button commented out -->
        <!--
        <div class="flex items-center justify-between gap-1.5 w-full min-w-0">
          <Tabs.Root value={activeTab} onValueChange={handleTabChange} class="min-w-0 flex-1 overflow-hidden">
            <Tabs.List class="h-6.5 p-0 bg-transparent gap-1 text-xs flex items-center justify-start overflow-x-auto hide-scrollbar">
              <Tabs.Trigger
                value="properties"
                class="h-6 px-2 text-xs rounded-lg font-medium bg-transparent text-muted-foreground hover:text-foreground transition-none duration-0 data-[state=active]:bg-secondary data-[state=active]:text-foreground shrink-0"
              >
                Properties
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
        </div>
        -->
        {#if rightPanels.filter((p) => p.id !== 'properties').length > 0}
        <div class="flex items-center justify-between gap-1.5 w-full min-w-0">
          <Tabs.Root value={activeTab} onValueChange={handleTabChange} class="min-w-0 flex-1 overflow-hidden">
            <Tabs.List class="h-6.5 p-0 bg-transparent gap-1 text-xs flex items-center justify-start overflow-x-auto hide-scrollbar">
              {#each rightPanels.filter((p) => p.id !== 'properties') as panel}
                <Tabs.Trigger
                  value={panel.id}
                  class="h-6 px-2 text-xs rounded-lg font-medium bg-transparent text-muted-foreground hover:text-foreground transition-none duration-0 data-[state=active]:bg-secondary data-[state=active]:text-foreground shrink-0"
                >
                  {panel.label}
                </Tabs.Trigger>
              {/each}
            </Tabs.List>
          </Tabs.Root>
        </div>
        {/if}
      </div>
      
      <div class="panel-content">
        {#if store.showOrganizerView}
          <div class="p-3 text-xs text-muted-foreground">
            Page Organizer is active in the main workspace view.
          </div>
        {:else}
          {@const customRightPanel = rightPanels.find((p) => p.id === activeTab && p.component)}
          {#if customRightPanel?.component}
            {@const PanelComp = customRightPanel.component as Component}
            <PanelComp />
          {:else}
            {#if store.activeFormField && !isEditingFormField}
              <FormFieldRulesSection />
            {/if}
            {#if store.hasSelection && !canvasStore.selectedElementId && !store.isReadOnly && store.canSelectElements}
              <div class="flex flex-col w-full shrink-0 py-1">
                <PositionSizeSection />
                {#if !featureFlags.isEnabled('panels.unified-geometry')}
                  <TransformSection />
                  <ArrangeSection />
                {/if}
                {#if store.selectedSpan?.type === 'shape'}
                  <ShapeSection />
                  <ActionsSection />
                {:else if store.selectedSpan?.type === 'image'}
                  <ImageSection />
                  <ActionsSection />
                {:else if store.selectedSpan?.type === 'form-field'}
                  <FormFieldSection />
                  <ActionsSection />
                {:else}
                  <TextPropertiesPanel />
                  <ActionsSection />
                {/if}
              </div>
            {/if}
            {#if canvasStore.selectedElementId && !store.isReadOnly && store.canSelectElements}
              <ElementPropertiesPanel />
            {/if}
            {#if store.isCropping || !featureFlags.isEnabled('panels.contextual-selection') || (!hasActiveObjectSelection && !store.activeFormField)}
              <PagePropertiesPanel />
            {/if}
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</aside>
