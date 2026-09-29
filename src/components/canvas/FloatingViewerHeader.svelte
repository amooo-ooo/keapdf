<script lang="ts">
  import type { Component } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useExportRegistry } from '../../core/export-registry';
  import { useFeatureFlagStore, type FeatureFlag } from '../../core/feature-flags';
  import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { Download, ChevronDown, Pencil, Eye, MessageSquare, Check, PanelRightOpen } from 'lucide-svelte';
  import { cn } from '$lib/utils';

  const store = useEditorStore();
  const actions = useEditorActions();
  const canvasStore = useCanvasStore();
  const exportRegistry = useExportRegistry();
  const featureFlags = useFeatureFlagStore();

  const exporters = $derived(exportRegistry.getAll());
</script>

{#if store.isDocumentLoaded && store.rightPanelCollapsed && featureFlags.isEnabled('view-mode.viewing.collapse-sidebar')}
  <aside
    aria-label="Floating viewer actions"
    class="floating-viewer-header absolute top-3 right-3 z-30 flex items-center gap-1.5 p-1 rounded-xl bg-background/90 backdrop-blur-md border border-border shadow-sm pointer-events-auto select-none"
  >
    {#if featureFlags.isEnabled('zoom')}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "w-[68px] h-7 px-1.5 text-xs font-medium text-muted-foreground hover:text-foreground flex items-center justify-between cursor-pointer select-none shrink-0"
          )}
          aria-label="Zoom level"
        >
          <span class="tabular-nums">{store.zoomPercent}%</span>
          <ChevronDown class="w-3 h-3 ml-0.5 shrink-0" aria-hidden="true" />
        </DropdownMenu.Trigger>
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
        <DropdownMenu.Trigger
          class={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground flex items-center justify-between gap-1.5 cursor-pointer select-none shrink-0 min-w-[76px]"
          )}
          aria-label="Viewing mode"
        >
          <span class="flex items-center gap-1.5">
            {#if store.viewMode === 'editing'}
              <Pencil class="w-3 h-3 text-primary shrink-0" />
              <span>Editing</span>
            {:else if store.viewMode === 'viewing'}
              <Eye class="w-3 h-3 text-muted-foreground shrink-0" />
              <span>View</span>
            {:else}
              <MessageSquare class="w-3 h-3 text-amber-500 shrink-0" />
              <span>Suggesting</span>
            {/if}
          </span>
          <ChevronDown class="w-3 h-3 ml-0.5 shrink-0 opacity-70" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-52">
          <DropdownMenu.Item
            class="text-xs flex items-start gap-2 py-1.5 cursor-pointer"
            onclick={() => store.setViewMode('editing')}
          >
            <Pencil class="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
            <div class="flex flex-col flex-1 min-w-0">
              <div class="flex items-center justify-between w-full">
                <span class="font-medium text-foreground">Editing</span>
                {#if store.viewMode === 'editing'}
                  <Check class="w-3 h-3 text-primary shrink-0" />
                {/if}
              </div>
              <span class="text-[11px] text-muted-foreground leading-snug">Edit document directly</span>
            </div>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="text-xs flex items-start gap-2 py-1.5 cursor-pointer"
            onclick={() => store.setViewMode('suggesting')}
          >
            <MessageSquare class="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
            <div class="flex flex-col flex-1 min-w-0">
              <div class="flex items-center justify-between w-full">
                <span class="font-medium text-foreground">Suggesting</span>
                {#if store.viewMode === 'suggesting'}
                  <Check class="w-3 h-3 text-primary shrink-0" />
                {/if}
              </div>
              <span class="text-[11px] text-muted-foreground leading-snug">Edits become suggestions</span>
            </div>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="text-xs flex items-start gap-2 py-1.5 cursor-pointer"
            onclick={() => store.setViewMode('viewing', featureFlags.isEnabled('view-mode.viewing.collapse-sidebar'))}
          >
            <Eye class="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div class="flex flex-col flex-1 min-w-0">
              <div class="flex items-center justify-between w-full">
                <span class="font-medium text-foreground">View</span>
                {#if store.viewMode === 'viewing'}
                  <Check class="w-3 h-3 text-primary shrink-0" />
                {/if}
              </div>
              <span class="text-[11px] text-muted-foreground leading-snug">Read-only view without changes</span>
            </div>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}

    {#if featureFlags.isEnabled('export')}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class={cn(buttonVariants({ variant: "default", size: "sm" }), "text-xs cursor-pointer shrink-0 h-7 px-2.5")}
          aria-label="Export document"
        >
          Export
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-48">
          {#each exporters as exporter (exporter.id)}
            {#if featureFlags.isEnabled(`export.${exporter.id}` as FeatureFlag)}
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
                {:else}
                  <Download class="w-3 h-3 mr-2" />
                {/if}
                {exporter.label}
              </DropdownMenu.Item>
            {/if}
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}

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
  </aside>
{/if}
