<script lang="ts">
  import type { Component } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import {
    useExportRegistry,
    groupExportersForMenu,
    getExportShortcutLabel,
    type ExportDefinition,
  } from '../../core/export-registry';
  import { useFeatureFlagStore, type FeatureFlag } from '../../core/feature-flags';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { DropdownButton } from '$lib/components/ui/dropdown-button/index.js';
  import { Pencil, Eye, MessageSquare, Check } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const canvasStore = useCanvasStore();
  const exportRegistry = useExportRegistry();
  const featureFlags = useFeatureFlagStore();

  const exporters = $derived(exportRegistry.getAll());
  const enabledExporters = $derived(
    exporters.filter((exporter) => featureFlags.isEnabled(`export.${exporter.id}` as FeatureFlag))
  );
  const groupedExporters = $derived(groupExportersForMenu(enabledExporters));
</script>

{#if store.isDocumentLoaded && store.rightPanelCollapsed && featureFlags.isEnabled('view-mode.viewing.collapse-sidebar')}
  <aside
    aria-label="Floating viewer actions"
    class="floating-viewer-header absolute top-3 right-3 z-30 hidden items-center gap-1.5 p-1 rounded-xl bg-background/90 backdrop-blur-md border border-border pointer-events-auto select-none"
  >
    {#if featureFlags.isEnabled('zoom')}
      <DropdownMenu.Root>
        <DropdownButton
          variant="default"
          size="compact"
          class="text-muted-foreground hover:text-foreground"
          aria-label="Zoom level"
        >
          <span>{store.zoomPercent}%</span>
        </DropdownButton>
        <DropdownMenu.Content align="end" class="w-24 min-w-[80px]">
          <DropdownMenu.Item class="text-xs cursor-pointer" onclick={() => actions.setZoom(0.5)}>50%</DropdownMenu.Item>
          <DropdownMenu.Item class="text-xs cursor-pointer" onclick={() => actions.setZoom(0.75)}>75%</DropdownMenu.Item>
          <DropdownMenu.Item class="text-xs cursor-pointer" onclick={() => actions.setZoom(1.0)}>100%</DropdownMenu.Item>
          <DropdownMenu.Item class="text-xs cursor-pointer" onclick={() => actions.setZoom(1.25)}>125%</DropdownMenu.Item>
          <DropdownMenu.Item class="text-xs cursor-pointer" onclick={() => actions.setZoom(1.5)}>150%</DropdownMenu.Item>
          <DropdownMenu.Item class="text-xs cursor-pointer" onclick={() => actions.setZoom(2.0)}>200%</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}

    {#if featureFlags.isEnabled('view-mode')}
      <DropdownMenu.Root>
        <DropdownButton
          variant="default"
          size="sm"
          class="text-muted-foreground hover:text-foreground"
          aria-label="Viewing mode"
          icon={store.viewMode === 'editing' ? Pencil : store.viewMode === 'viewing' ? Eye : MessageSquare}
          iconClass={store.viewMode === 'suggesting' ? 'text-warning' : 'text-muted-foreground'}
          text={store.viewMode === 'editing' ? 'Editing' : store.viewMode === 'viewing' ? 'View' : 'Suggesting'}
        />
        <DropdownMenu.Content align="end" class="w-52">
          <DropdownMenu.Item
            class="text-xs flex items-start gap-2 py-1.5 cursor-pointer"
            onclick={() => store.setViewMode('editing')}
          >
            <Pencil class="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div class="flex flex-col flex-1 min-w-0">
              <div class="flex items-center justify-between w-full">
                <span class="font-medium text-foreground">Editing</span>
                {#if store.viewMode === 'editing'}
                  <Check class="w-3 h-3 text-foreground shrink-0" />
                {/if}
              </div>
              <span class="text-[11px] text-muted-foreground leading-snug">Edit document directly</span>
            </div>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="text-xs flex items-start gap-2 py-1.5 cursor-pointer"
            onclick={() => store.setViewMode('suggesting')}
          >
            <MessageSquare class="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
            <div class="flex flex-col flex-1 min-w-0">
              <div class="flex items-center justify-between w-full">
                <span class="font-medium text-foreground">Suggesting</span>
                {#if store.viewMode === 'suggesting'}
                  <Check class="w-3 h-3 text-foreground shrink-0" />
                {/if}
              </div>
              <span class="text-[11px] text-muted-foreground leading-snug">Edits become suggestions</span>
            </div>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="text-xs flex items-start gap-2 py-1.5 cursor-pointer"
            onclick={() => store.setViewMode('viewing')}
          >
            <Eye class="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div class="flex flex-col flex-1 min-w-0">
              <div class="flex items-center justify-between w-full">
                <span class="font-medium text-foreground">View</span>
                {#if store.viewMode === 'viewing'}
                  <Check class="w-3 h-3 text-foreground shrink-0" />
                {/if}
              </div>
              <span class="text-[11px] text-muted-foreground leading-snug">Read-only view without changes</span>
            </div>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}

    {#if featureFlags.isEnabled('export')}
      {#snippet floatingExportMenuItem(exporter: ExportDefinition)}
        <DropdownMenu.Item
          class="text-xs cursor-pointer"
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
          text="Export"
        />
        <DropdownMenu.Content align="end" class="w-48">
          {#each groupedExporters.pdfItems as exporter (exporter.id)}
            {@render floatingExportMenuItem(exporter)}
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
                  {@render floatingExportMenuItem(exporter)}
                {/each}
              </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
          {/each}

          {#if (groupedExporters.pdfItems.length > 0 || groupedExporters.submenus.length > 0) && groupedExporters.trailingItems.length > 0}
            <DropdownMenu.Separator />
          {/if}

          {#each groupedExporters.trailingItems as exporter (exporter.id)}
            {@render floatingExportMenuItem(exporter)}
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}

    <!--
    {#if featureFlags.isEnabled('view-mode.viewing.collapse-sidebar')}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            aria-label="Expand properties panel"
            class="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
            onclick={() => { store.rightPanelCollapsed = false; }}
          >
            <PanelRightOpen class="w-3.5 h-3.5" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">Expand Panel</Tooltip.Content>
    </Tooltip.Root>
    {/if}
    -->
  </aside>
{/if}
