<script lang="ts">
  import type { Component } from 'svelte';
  import { FileText, PanelLeftOpen, Globe, Files, FileType } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import { Separator } from '$lib/components/ui/separator';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import { usePanelRegistry } from '../../core/panel-registry';
  import type { LeftPanelMode } from '../../stores/types';
  import type { FeatureFlag } from '../../core/feature-flags';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();
  const panelRegistry = usePanelRegistry();

  const leftPanels = $derived(panelRegistry.getByPosition('left'));

  function isPanelEnabled(panelId: string): boolean {
    const flagMap: Record<string, FeatureFlag> = {
      workspace: 'workspace',
      components: 'components',
      annotate: 'annotations',
      imposition: 'imposition',
      tools: 'tools',
      settings: 'settings',
    };
    const flag = flagMap[panelId];
    return flag ? featureFlags.isEnabled(flag) : true;
  }

  const enabledLeftPanels = $derived(leftPanels.filter((panel) => isPanelEnabled(panel.id)));

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

<div class="h-full py-[4px] pl-[4px] {store.leftPanelCollapsed ? 'pr-[4px]' : ''}">
  <div class="w-[40px] h-full bg-card flex flex-col items-center py-1 gap-1 select-none {store.leftPanelCollapsed ? 'border rounded-xl shadow-sm' : 'border-y border-l border-r rounded-l-xl shadow-sm'}">
  <!-- Top App Brand Icon / Open File -->
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          variant="ghost"
          size="icon"
          class="w-8 h-8 text-primary hover:text-primary/90 hover:bg-primary/10"
          {...props}
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
      <DropdownMenu.Item class="text-xs" onclick={() => actions.triggerFileOpen(true)}>
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
      {#if featureFlags.isEnabled('workspace.compliance')}
      <DropdownMenu.Item class="text-xs" onclick={() => store.openUrlDialog()}>
        <Globe class="w-3 h-3 mr-2 text-primary" />
        Compliance Suites / URL...
      </DropdownMenu.Item>
      {/if}
      {#if featureFlags.isEnabled('merge')}
      <DropdownMenu.Item class="text-xs" onclick={() => actions.triggerMergeFiles()}>
        <Files class="w-3 h-3 mr-2 text-primary" />
        Merge Files...
      </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  <Separator class="w-[14px] h-[1px] bg-border shrink-0" />

  <!-- Dynamic Left Panels from PanelRegistry -->
  {#each enabledLeftPanels as panel (panel.id)}
    {@const IconComp = panel.icon as Component<{ class?: string }> | undefined}
    <Tooltip.Root>
      <Tooltip.Trigger>
        <Button
          variant="ghost"
          size="icon"
          class="w-8 h-8 {isTabActive(panel.id as LeftPanelMode) ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => selectTab(panel.id as LeftPanelMode)}
        >
          {#if IconComp}
            <IconComp class="w-4 h-4" />
          {/if}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side="right">{panel.label}</Tooltip.Content>
    </Tooltip.Root>
  {/each}

  <div class="flex-1"></div>

  {#if store.leftPanelCollapsed}
    <Tooltip.Root>
      <Tooltip.Trigger>
        <Button
          variant="ghost"
          size="icon"
          class="w-8 h-8 text-muted-foreground hover:text-foreground"
          onclick={() => { store.leftPanelCollapsed = false; }}
        >
          <PanelLeftOpen class="w-4 h-4" />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side="right">Expand Sidebar</Tooltip.Content>
    </Tooltip.Root>
  {/if}
  </div>
</div>
