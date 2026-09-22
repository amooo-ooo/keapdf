<script lang="ts">
  import type { Component } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useHistoryStore } from '../../stores/history.svelte';
  import TextPropertiesPanel from '../panels/TextPropertiesPanel.svelte';
  import PagePropertiesPanel from '../panels/PagePropertiesPanel.svelte';
  import ElementPropertiesPanel from '../panels/ElementPropertiesPanel.svelte';
  import { Download, ChevronDown, Undo2, Redo2 } from 'lucide-svelte';
  import { Button, ButtonGroup, buttonVariants } from '$lib/components/ui/button/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { cn } from '$lib/utils';
  import { useExportRegistry } from '../../core/export-registry';
  import { usePanelRegistry } from '../../core/panel-registry';
  import { useFeatureFlagStore, type FeatureFlag } from '../../core/feature-flags';

  const store = useEditorStore();
  const canvasStore = useCanvasStore();
  const historyStore = useHistoryStore();
  const actions = useEditorActions();
  const exportRegistry = useExportRegistry();
  const panelRegistry = usePanelRegistry();
  const featureFlags = useFeatureFlagStore();

  const exporters = $derived(exportRegistry.getAll());
  const rightPanels = $derived(panelRegistry.getByPosition('right'));

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
  class="h-full flex flex-col overflow-hidden select-none w-full p-[4px]"
  style={store.rightPanelCollapsed ? 'width: 0px; padding: 0;' : ''}
  aria-label="Properties and tools panel"
>
  {#if !store.rightPanelCollapsed}
    <div class="panel-container">
      <div class="panel-header-compact">
        <!-- note: undo and redo controls on left and export trigger on right -->
        <div class="flex items-center justify-between gap-2 w-full min-w-0">
          {#if featureFlags.isEnabled('history')}
          <ButtonGroup class="shrink-0">
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon"
                    aria-label="Undo"
                    class="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
                    disabled={!historyStore.canUndo}
                    onclick={() => actions.undo()}
                  >
                    <Undo2 class="w-3.5 h-3.5" />
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content side="bottom">
                <p class="text-xs font-medium">Undo {historyStore.undoDescription ? `(${historyStore.undoDescription})` : ''}</p>
                <p class="text-[10px] text-muted-foreground">Ctrl+Z</p>
              </Tooltip.Content>
            </Tooltip.Root>

            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon"
                    aria-label="Redo"
                    class="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
                    disabled={!historyStore.canRedo}
                    onclick={() => actions.redo()}
                  >
                    <Redo2 class="w-3.5 h-3.5" />
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content side="bottom">
                <p class="text-xs font-medium">Redo {historyStore.redoDescription ? `(${historyStore.redoDescription})` : ''}</p>
                <p class="text-[10px] text-muted-foreground">Ctrl+Shift+Z / Ctrl+Y</p>
              </Tooltip.Content>
            </Tooltip.Root>
          </ButtonGroup>
          {/if}

          {#if featureFlags.isEnabled('export')}
          <div class="flex items-center justify-end shrink-0">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger class={cn(buttonVariants({ variant: "default", size: "sm" }), "text-xs cursor-pointer shrink-0")} disabled={!store.isDocumentLoaded}>
                Export
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" class="w-48">
                {#each exporters as exporter (exporter.id)}
                  {#if featureFlags.isEnabled(`export.${exporter.id}` as FeatureFlag)}
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
                    {:else}
                      <Download class="w-3 h-3 mr-2" />
                    {/if}
                    {exporter.label}
                  </DropdownMenu.Item>
                  {/if}
                {/each}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
          {/if}
        </div>

        <!-- note: tab navigation on left and zoom menu on right -->
        <div class="flex items-center justify-between gap-1.5 w-full min-w-0">
          <Tabs.Root value={activeTab} onValueChange={handleTabChange} class="min-w-0 flex-1 overflow-hidden">
            <Tabs.List class="h-6.5 p-0 bg-transparent gap-1 text-xs flex items-center justify-start overflow-x-auto hide-scrollbar">
              {#each rightPanels as panel}
                <Tabs.Trigger
                  value={panel.id}
                  class="h-6 px-2 text-xs rounded-lg font-medium bg-transparent text-muted-foreground hover:text-foreground transition-none duration-0 data-[state=active]:bg-secondary data-[state=active]:text-foreground shrink-0"
                >
                  {panel.label}
                </Tabs.Trigger>
              {/each}
            </Tabs.List>
          </Tabs.Root>

          {#if featureFlags.isEnabled('zoom')}
          <div class="flex items-center justify-end shrink-0">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                class={cn(
                  buttonVariants({ variant: "ghost", size: "xs" }),
                  "w-[68px] h-6 px-1.5 text-xs font-medium text-muted-foreground hover:text-foreground flex items-center justify-between cursor-pointer select-none shrink-0"
                )}
                disabled={!store.isDocumentLoaded}
                aria-label="Zoom level"
              >
                <span>{store.isDocumentLoaded ? `${store.zoomPercent}%` : '100%'}</span>
                <ChevronDown class="w-3 h-3 ml-0.5 shrink-0" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" class="w-24 min-w-[80px]">
                <DropdownMenu.Item class="text-xs" onclick={() => actions.setZoom(0.5)}>50%</DropdownMenu.Item>
                <DropdownMenu.Item class="text-xs" onclick={() => actions.setZoom(0.75)}>75%</DropdownMenu.Item>
                <DropdownMenu.Item class="text-xs" onclick={() => actions.setZoom(1.0)}>100%</DropdownMenu.Item>
                <DropdownMenu.Item class="text-xs" onclick={() => actions.setZoom(1.25)}>125%</DropdownMenu.Item>
                <DropdownMenu.Item class="text-xs" onclick={() => actions.setZoom(1.5)}>150%</DropdownMenu.Item>
                <DropdownMenu.Item class="text-xs" onclick={() => actions.setZoom(2.0)}>200%</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
          {/if}
        </div>
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
            {#if store.hasSelection}
              <TextPropertiesPanel />
            {/if}
            {#if canvasStore.selectedElementId}
              <ElementPropertiesPanel />
            {/if}
            <PagePropertiesPanel />
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</aside>
