<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Resizable from '$lib/components/ui/resizable';
  import FloatingPageIndicator from '../canvas/FloatingPageIndicator.svelte';
  import FloatingViewerHeader from '../canvas/FloatingViewerHeader.svelte';
  import ViewerTopBar from './ViewerTopBar.svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useFeatureFlagStore } from '../../core/feature-flags';

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
  const featureFlags = useFeatureFlagStore();

  // note: collapse left panel when document is unloaded on initial startup or when explicitly collapsed
  const isLeftPanelCollapsed = $derived(
    (!store.isDocumentLoaded && featureFlags.isEnabled('panels.collapse-empty')) ||
    store.leftPanelCollapsed
  );

  // note: collapse right panel when document is unloaded or when viewing mode is active with collapsed request
  const isRightPanelCollapsed = $derived(
    (!store.isDocumentLoaded && featureFlags.isEnabled('panels.collapse-empty')) ||
    (store.rightPanelCollapsed && featureFlags.isEnabled('view-mode.viewing.collapse-sidebar')) ||
    (store.viewMode === 'viewing' && store.rightPanelCollapsed)
  );
</script>

<div class="editor-shell bg-background text-foreground h-screen w-screen overflow-hidden">
  <Resizable.PaneGroup direction="horizontal" class="h-full w-full">
    <!-- note: left column with navigation rail attached directly to left panel -->
    <Resizable.Pane
      defaultSize={20}
      minSize={12}
      maxSize={35}
      class="editor-shell-left bg-card border-r border-border"
      style={isLeftPanelCollapsed ? 'flex: 0 0 auto !important; width: 40px !important; min-width: 40px !important; max-width: 40px !important;' : ''}
    >
      <div class="h-full w-full flex flex-row items-stretch select-none overflow-hidden bg-card">
        <aside class="editor-shell-nav shrink-0 h-full border-r border-border" aria-label="Navigation">
          {@render navRail?.()}
        </aside>
        <div class="flex-1 min-w-0 h-full overflow-hidden {isLeftPanelCollapsed ? 'hidden' : ''}">
          {@render leftPanel?.()}
        </div>
      </div>
    </Resizable.Pane>

    <Resizable.Handle
      disabled={isLeftPanelCollapsed}
      class="!cursor-col-resize after:w-4 pointer-events-auto !bg-transparent !border-0 z-20 {isLeftPanelCollapsed ? 'hidden' : ''}"
    />

    <!-- note: centre pdf viewer interface with vertical padding and border radius blending into panel background -->
    <Resizable.Pane defaultSize={58} minSize={30} class="editor-shell-canvas relative h-full min-w-0 bg-background">
      <!-- note: dynamic right padding on collapse {store.rightPanelCollapsed ? 'pr-2.5' : ''} -->
      <div class="h-full w-full min-w-0 min-h-0 overflow-hidden bg-background flex flex-col {isRightPanelCollapsed ? 'pr-2.5' : ''}">
        <ViewerTopBar />
        <main class="panel-container bg-background overflow-hidden relative flex-1 min-h-0 m-1.5 w-auto">
          {@render canvas?.()}
          <FloatingPageIndicator />
          <FloatingViewerHeader />
        </main>
      </div>
    </Resizable.Pane>

    <Resizable.Handle
      disabled={isRightPanelCollapsed}
      class="!cursor-col-resize after:w-4 pointer-events-auto !bg-transparent !border-0 z-20 {isRightPanelCollapsed ? 'hidden' : ''}"
    />

    <!-- note: right property inspector panel -->
    <Resizable.Pane
      defaultSize={22}
      minSize={16}
      maxSize={40}
      class="editor-shell-right bg-card border-l border-border {isRightPanelCollapsed ? 'pointer-events-none' : 'pointer-events-auto'}"
      style={isRightPanelCollapsed ? 'flex: 0 0 0px !important; width: 0px !important; min-width: 0px !important; max-width: 0px !important;' : ''}
    >
      <div class="h-full w-full overflow-hidden bg-card">
        {@render rightPanel?.()}
      </div>
    </Resizable.Pane>
  </Resizable.PaneGroup>
</div>
