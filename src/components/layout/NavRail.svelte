<script lang="ts">
  import { FileText, Layers, Shapes, Highlighter, LayoutGrid, Wrench, Settings, PanelLeftOpen } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import type { LeftPanelMode } from '../../stores/types';

  const store = useEditorStore();
  const actions = useEditorActions();

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
  <div class="w-[40px] h-full bg-card flex flex-col items-center py-2.5 gap-2 select-none {store.leftPanelCollapsed ? 'border rounded-xl shadow-sm' : 'border-y border-l border-r rounded-l-xl shadow-sm'}">
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
    <DropdownMenu.Content side="right">
      <DropdownMenu.Item onclick={() => actions.triggerFileOpen(false)}>
        Open PDF...
      </DropdownMenu.Item>
      <DropdownMenu.Item onclick={() => actions.triggerFileOpen(true)}>
        Add PDF to workspace...
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  <div class="w-[14px] h-[1px] bg-border my-1 shrink-0"></div>

  <!-- 1. Workspace Tab -->
  <Tooltip.Root>
    <Tooltip.Trigger>
      <Button
        variant="ghost"
        size="icon"
        class="w-8 h-8 {isTabActive('workspace') ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => selectTab('workspace')}
      >
        <Layers class="w-4 h-4" />
      </Button>
    </Tooltip.Trigger>
    <Tooltip.Content side="right">Workspace</Tooltip.Content>
  </Tooltip.Root>

  <!-- 2. Components Tab -->
  <Tooltip.Root>
    <Tooltip.Trigger>
      <Button
        variant="ghost"
        size="icon"
        class="w-8 h-8 {isTabActive('components') ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => selectTab('components')}
      >
        <Shapes class="w-4 h-4" />
      </Button>
    </Tooltip.Trigger>
    <Tooltip.Content side="right">Components</Tooltip.Content>
  </Tooltip.Root>

  <!-- 3. Annotate Tab -->
  <Tooltip.Root>
    <Tooltip.Trigger>
      <Button
        variant="ghost"
        size="icon"
        class="w-8 h-8 {isTabActive('annotate') ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => selectTab('annotate')}
      >
        <Highlighter class="w-4 h-4" />
      </Button>
    </Tooltip.Trigger>
    <Tooltip.Content side="right">Annotate</Tooltip.Content>
  </Tooltip.Root>

  <!-- 4. Imposition Tab -->
  <Tooltip.Root>
    <Tooltip.Trigger>
      <Button
        variant="ghost"
        size="icon"
        class="w-8 h-8 {isTabActive('imposition') ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => selectTab('imposition')}
      >
        <LayoutGrid class="w-4 h-4" />
      </Button>
    </Tooltip.Trigger>
    <Tooltip.Content side="right">Imposition</Tooltip.Content>
  </Tooltip.Root>

  <!-- 5. Tools & OCR Tab -->
  <Tooltip.Root>
    <Tooltip.Trigger>
      <Button
        variant="ghost"
        size="icon"
        class="w-8 h-8 {isTabActive('tools') ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => selectTab('tools')}
      >
        <Wrench class="w-4 h-4" />
      </Button>
    </Tooltip.Trigger>
    <Tooltip.Content side="right">Tools & OCR</Tooltip.Content>
  </Tooltip.Root>

  <!-- 6. Settings Tab -->
  <Tooltip.Root>
    <Tooltip.Trigger>
      <Button
        variant="ghost"
        size="icon"
        class="w-8 h-8 {isTabActive('settings') ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => selectTab('settings')}
      >
        <Settings class="w-4 h-4" />
      </Button>
    </Tooltip.Trigger>
    <Tooltip.Content side="right">Settings</Tooltip.Content>
  </Tooltip.Root>

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
