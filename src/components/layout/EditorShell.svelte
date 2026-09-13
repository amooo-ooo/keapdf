<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Resizable from '$lib/components/ui/resizable';
  import FloatingPageIndicator from '../canvas/FloatingPageIndicator.svelte';
  import { useEditorStore } from '../../stores/editor.svelte';

  interface Props {
    navRail?: Snippet;
    leftPanel?: Snippet;
    canvas?: Snippet;
    rightPanel?: Snippet;
  }

  let {
    navRail,
    leftPanel,
    canvas,
    rightPanel
  }: Props = $props();

  const store = useEditorStore();
</script>

<div class="editor-shell bg-background text-foreground">
  <aside class="editor-shell-nav">
    {@render navRail?.()}
  </aside>

  <main class="editor-shell-workspace relative w-full h-full">
    <div class="absolute inset-0 z-0">
      {@render canvas?.()}
    </div>
    
    <div class="absolute inset-0 z-10 pointer-events-none">
      <Resizable.PaneGroup direction="horizontal">
        <Resizable.Pane defaultSize={20} minSize={15} maxSize={30} class="editor-shell-left {store.leftPanelCollapsed ? 'pointer-events-none' : 'pointer-events-auto'}">
          {@render leftPanel?.()}
        </Resizable.Pane>
        <Resizable.Handle class="!cursor-col-resize after:w-3 pointer-events-auto !bg-transparent !border-0" />
        <Resizable.Pane defaultSize={60} minSize={30} class="editor-shell-canvas relative">
          <FloatingPageIndicator />
        </Resizable.Pane>
        <Resizable.Handle class="!cursor-col-resize after:w-3 pointer-events-auto !bg-transparent !border-0" />
        <Resizable.Pane defaultSize={22} minSize={16} maxSize={40} class="editor-shell-right {store.rightPanelCollapsed ? 'pointer-events-none' : 'pointer-events-auto'}">
          {@render rightPanel?.()}
        </Resizable.Pane>
      </Resizable.PaneGroup>
    </div>
  </main>
</div>
