<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import SidebarSection from '../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import {
    LayoutGrid,
    BookOpenCheck,
    Layers,
    Grid,
    Scissors,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const featureFlags = useFeatureFlagStore();

  function openImposition(mode: 'nup' | 'booklet' | 'single-page' | 'posterize' | 'cut-stack'): void {
    store.openImpositionDialog(mode);
  }
</script>

<div class="flex flex-col min-h-0 divide-y divide-border">
  <!-- Section 1: Multi-Page & Booklets -->
  {#if featureFlags.isEnabled('imposition.nup') || featureFlags.isEnabled('imposition.booklet')}
  <SidebarSection title="Multi-Page & Booklets" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Impose multiple document pages onto printed press sheets.</p>

    <div class="flex flex-col gap-2">
      {#if featureFlags.isEnabled('imposition.nup')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => openImposition('nup')}
        disabled={!store.isDocumentLoaded}
      >
        <LayoutGrid class="h-3.5 w-3.5 mr-2 text-primary" /> Multi-Page Layout (N-Up)
      </Button>
      {/if}

      {#if featureFlags.isEnabled('imposition.booklet')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => openImposition('booklet')}
        disabled={!store.isDocumentLoaded}
      >
        <BookOpenCheck class="h-3.5 w-3.5 mr-2 text-success" /> Booklet (Saddle Stitch)
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  <!-- Section 2: Large Format & Continuous Canvas -->
  {#if featureFlags.isEnabled('imposition.continuous') || featureFlags.isEnabled('imposition.posterize')}
  <SidebarSection title="Continuous & Posterize" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Merge into one continuous roll or split large pages across tiles.</p>

    <div class="flex flex-col gap-2">
      {#if featureFlags.isEnabled('imposition.continuous')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => openImposition('single-page')}
        disabled={!store.isDocumentLoaded}
      >
        <Layers class="h-3.5 w-3.5 mr-2 text-warning" /> Continuous / Single Page
      </Button>
      {/if}

      {#if featureFlags.isEnabled('imposition.posterize')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => openImposition('posterize')}
        disabled={!store.isDocumentLoaded}
      >
        <Grid class="h-3.5 w-3.5 mr-2 text-primary" /> Posterize (Multi-Sheet Tile)
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  <!-- Section 3: Commercial & Production Layout -->
  {#if featureFlags.isEnabled('imposition.cut-stack')}
  <SidebarSection title="Production & Stacking" borderBottom={false}>
    <p class="text-xs text-muted-foreground mb-2">High-volume guillotine cutting and collation arrangements.</p>

    <div class="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => openImposition('cut-stack')}
        disabled={!store.isDocumentLoaded}
      >
        <Scissors class="h-3.5 w-3.5 mr-2 text-destructive" /> Cut & Stack Imposition
      </Button>
    </div>
  </SidebarSection>
  {/if}
</div>
