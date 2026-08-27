<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useHistoryStore } from '../../stores/history.svelte';
  import TextPropertiesPanel from '../panels/TextPropertiesPanel.svelte';
  import PagePropertiesPanel from '../panels/PagePropertiesPanel.svelte';
  import ElementPropertiesPanel from '../panels/ElementPropertiesPanel.svelte';
  import { Download, Image, ChevronDown, Undo2, Redo2 } from 'lucide-svelte';
  import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { cn } from '$lib/utils';

  const store = useEditorStore();
  const canvasStore = useCanvasStore();
  const historyStore = useHistoryStore();
  const actions = useEditorActions();

  let activeTab = $state('properties');

  $effect(() => {
    activeTab = store.showOrganizerView ? 'organizer' : 'properties';
  });

  function handleTabChange(value: string): void {
    activeTab = value;
    store.showOrganizerView = value === 'organizer';
  }
</script>

<aside 
  class="h-full flex flex-col overflow-hidden select-none w-full p-[4px]"
  style={store.rightPanelCollapsed ? 'width: 0px; padding: 0;' : ''}
>
  {#if !store.rightPanelCollapsed}
    <div class="panel-container">
      <div class="panel-header-compact">
        <!-- Row 1: Undo/Redo left, Export right -->
        <div class="flex items-center gap-0.5">
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
                  disabled={!historyStore.canUndo}
                  onclick={() => actions.undo()}
                  {...props}
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
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
                  disabled={!historyStore.canRedo}
                  onclick={() => actions.redo()}
                  {...props}
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
        </div>
        <div class="flex justify-end">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger class={cn(buttonVariants({ variant: "default", size: "sm" }), "text-xs cursor-pointer")} disabled={!store.isDocumentLoaded}>
              Export
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" class="w-48">
              <DropdownMenu.Item class="text-xs" onclick={() => actions.exportPdf(canvasStore)}>
                <Download class="w-3 h-3 mr-2" />
                Save PDF
              </DropdownMenu.Item>
              <DropdownMenu.Item class="text-xs" onclick={() => { store.showExportImagesDialog = true; }}>
                <Image class="w-3 h-3 mr-2" />
                Export Images
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>

        <!-- Row 2: Tabs left, Zoom right -->
        <Tabs.Root value={activeTab} onValueChange={handleTabChange} class="items-start w-full">
          <Tabs.List class="h-6.5 p-0 bg-transparent gap-1 text-xs flex items-center justify-start">
            <Tabs.Trigger
              value="properties"
              class="h-6 px-2 text-xs rounded-lg font-medium bg-transparent text-muted-foreground hover:text-foreground transition-none duration-0 data-[state=active]:bg-secondary data-[state=active]:text-foreground"
            >
              Properties
            </Tabs.Trigger>
            <Tabs.Trigger
              value="organizer"
              class="h-6 px-2 text-xs rounded-lg font-medium bg-transparent text-muted-foreground hover:text-foreground transition-none duration-0 data-[state=active]:bg-secondary data-[state=active]:text-foreground"
            >
              Organizer
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>

        <div class="flex justify-end">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger class="w-[70px] h-6 px-2 text-xs rounded-lg font-medium text-muted-foreground hover:text-foreground flex items-center justify-between cursor-pointer select-none" disabled={!store.isDocumentLoaded}>
              <span>{store.isDocumentLoaded ? `${store.zoomPercent}%` : '100%'}</span>
              <ChevronDown class="w-3 h-3" />
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
      </div>
      
      <div class="panel-content">
        {#if store.showOrganizerView}
          <div class="p-3 text-xs text-muted-foreground italic">
            Page Organizer is active in the main workspace view.
          </div>
        {:else}
          {#if store.hasSelection}
            <TextPropertiesPanel />
          {/if}
          {#if canvasStore.selectedElementId}
            <ElementPropertiesPanel />
          {/if}
          <PagePropertiesPanel />
        {/if}
      </div>
    </div>
  {/if}
</aside>
