<script lang="ts">
  import type { Component } from 'svelte';
  import { FileText, PanelLeftOpen, Globe, Files, FileType, Download, Palette } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import { usePanelRegistry } from '../../core/panel-registry';
  import { usePwaStore } from '../../stores/pwa.svelte';
  import type { LeftPanelMode } from '../../stores/types';
  import type { FeatureFlag } from '../../core/feature-flags';
  import { isTabAllowedInMode } from '../../core/document-mode';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();
  const panelRegistry = usePanelRegistry();
  const pwaStore = usePwaStore();

  const leftPanels = $derived(panelRegistry.getByPosition('left'));

  function isPanelEnabled(panelId: string): boolean {
    const flagMap: Record<string, FeatureFlag> = {
      workspace: 'workspace',
      components: 'components',
      annotate: 'annotations',
      tools: 'tools',
      settings: 'settings',
    };
    const flag = flagMap[panelId];
    return flag ? featureFlags.isEnabled(flag) : true;
  }

  const enabledLeftPanels = $derived(
    leftPanels.filter((panel) => isPanelEnabled(panel.id) && isTabAllowedInMode(store.viewMode, panel.id))
  );

  // note: automatically synchronise active tab back to workspace if panel is restricted by view mode
  $effect(() => {
    if (!isTabAllowedInMode(store.viewMode, store.leftPanelMode)) {
      store.leftPanelMode = 'workspace';
    }
  });

  function selectTab(mode: LeftPanelMode): void {
    if (store.leftPanelCollapsed) {
      store.leftPanelMode = mode;
      store.leftPanelCollapsed = false;
    } else if (store.leftPanelMode === mode) {
      store.leftPanelCollapsed = true;
    } else {
      store.leftPanelMode = mode;
    }
  }

  function isTabActive(mode: LeftPanelMode): boolean {
    return !store.leftPanelCollapsed && store.leftPanelMode === mode;
  }
</script>

<div class="w-[40px] h-full bg-card flex flex-col items-center py-1 gap-1 select-none shrink-0">
  <!-- note: application brand icon and workspace file actions menu -->
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <!-- note: alternative default pill styling:
             class="w-8 h-8 text-primary bg-primary/10 hover:text-primary/90 hover:bg-primary/10 dark:hover:bg-primary/10 aria-expanded:bg-primary/15"
        -->
        <Button
          {...props}
          variant="ghost"
          size="icon"
          aria-label="Kea PDF main menu"
          class="w-8 h-8 text-primary hover:text-primary/90 hover:bg-primary/10"
        >
          <FileText class="w-5 h-5 stroke-[2]" />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content side="right" class="w-48">
      {#if featureFlags.isEnabled('workspace.open')}
      <DropdownMenu.Item class="text-xs" onclick={() => actions.triggerFileOpen(false)}>
        Open File...
      </DropdownMenu.Item>
      {/if}
      {#if featureFlags.isEnabled('workspace.add')}
      <DropdownMenu.Item class="text-xs" disabled={store.isReadOnly} onclick={() => actions.triggerFileOpen(true)}>
        Add File to workspace...
      </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Separator />
      {#if featureFlags.isEnabled('conversion')}
      <DropdownMenu.Item class="text-xs" onclick={() => actions.openConvertDialog()}>
        <FileType class="w-3 h-3 mr-2 text-primary" />
        Convert to PDF...
      </DropdownMenu.Item>
      {/if}
      {#if featureFlags.isEnabled('workspace.compliance') && featureFlags.isEnabled('compliance')}
      <DropdownMenu.Item class="text-xs" onclick={() => store.openUrlDialog()}>
        <Globe class="w-3 h-3 mr-2 text-primary" />
        Compliance Suites / URL...
      </DropdownMenu.Item>
      {/if}
      {#if featureFlags.isEnabled('merge') && featureFlags.isEnabled('workspace.merge')}
      <DropdownMenu.Item class="text-xs" disabled={store.isReadOnly} onclick={() => actions.triggerMergeFiles()}>
        <Files class="w-3 h-3 mr-2 text-primary" />
        Merge Files...
      </DropdownMenu.Item>
      {/if}
      {#if featureFlags.isEnabled('components.gallery')}
      <DropdownMenu.Separator />
      <DropdownMenu.Item class="text-xs" onclick={() => store.openComponentGalleryDialog()}>
        <Palette class="w-3 h-3 mr-2 text-primary" />
        UI Component Gallery...
      </DropdownMenu.Item>
      {/if}
      {#if pwaStore?.canInstall}
      <DropdownMenu.Separator />
      <DropdownMenu.Item class="text-xs" onclick={() => pwaStore.promptInstall()}>
        <Download class="w-3 h-3 mr-2 text-primary" />
        Install Kea PDF App...
      </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  <!-- note: dynamic left sidebar panels from registry -->
  {#each enabledLeftPanels as panel (panel.id)}
    {@const IconComp = panel.icon as Component<{ class?: string }> | undefined}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <!-- note: alternative default pill styling:
               class="w-8 h-8 {isTabActive(panel.id as LeftPanelMode) ? 'bg-primary text-primary-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground hover:bg-primary/90 aria-pressed:hover:bg-primary/90' : 'bg-muted dark:bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted/50'}"
          -->
          <Button
            {...props}
            variant="ghost"
            size="icon"
            aria-label={panel.label}
            aria-pressed={isTabActive(panel.id as LeftPanelMode)}
            class="w-8 h-8 {isTabActive(panel.id as LeftPanelMode) ? 'bg-accent text-accent-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => selectTab(panel.id as LeftPanelMode)}
          >
            {#if IconComp}
              <IconComp class="w-4 h-4" />
            {/if}
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right">{panel.label}</Tooltip.Content>
    </Tooltip.Root>
  {/each}

  <div class="flex-1"></div>

  {#if store.leftPanelCollapsed}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            aria-label="Expand sidebar"
            class="w-8 h-8 text-muted-foreground hover:text-foreground"
            onclick={() => { store.leftPanelCollapsed = false; }}
          >
            <PanelLeftOpen class="w-4 h-4" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right">Expand Sidebar</Tooltip.Content>
    </Tooltip.Root>
  {/if}
</div>
