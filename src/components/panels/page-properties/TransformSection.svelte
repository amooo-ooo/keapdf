<script lang="ts">
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../../core/feature-flags';
  import { RotateCw, Scaling } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { SetPageTransformCommand } from '../../../commands';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  const currentPageIdx = $derived(store.currentPageIndex);
  const pageTransform = $derived(store.getPageTransform(currentPageIdx));

  function getBaseDimensions(): { widthPts: number; heightPts: number } {
    try {
      if (actions.service.document) {
        return actions.service.document.getPage(currentPageIdx).getDimensions();
      }
    } catch {
      // fallback
    }
    return { widthPts: 612, heightPts: 792 };
  }

  const baseDims = $derived.by(() => {
    void store.renderVersion;
    void store.pageVersions[currentPageIdx];
    return getBaseDimensions();
  });

  const visualWidth = $derived(
    Math.round(baseDims.widthPts * (pageTransform.scaleX || 1) * 10) / 10
  );
  const visualHeight = $derived(
    Math.round(baseDims.heightPts * (pageTransform.scaleY || 1) * 10) / 10
  );
  function handleDimensionChange(prop: 'width' | 'height', e: Event): void {
    if (store.isReadOnly) return;
    const target = e.target as HTMLInputElement;
    const parsed = parseFloat(target.value);
    if (Number.isNaN(parsed) || parsed < 10) return;

    const originTransform = { ...pageTransform };
    let newSx = pageTransform.scaleX || 1;
    let newSy = pageTransform.scaleY || 1;

    if (prop === 'width' && baseDims.widthPts > 0) {
      newSx = parsed / baseDims.widthPts;
    } else if (prop === 'height' && baseDims.heightPts > 0) {
      newSy = parsed / baseDims.heightPts;
    }

    store.updatePageTransform(currentPageIdx, { scaleX: newSx, scaleY: newSy });
    actions.pushCommand(
      new SetPageTransformCommand('Scale Page', currentPageIdx, originTransform, { ...pageTransform, scaleX: newSx, scaleY: newSy })
    );
  }

  function handleKeydown(prop: 'width' | 'height', e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      handleDimensionChange(prop, e);
    }
  }
</script>

{#if store.isDocumentLoaded}
  <SidebarSection title="Page Transform" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-2.5">
      <!-- Dimensions Grid (Width & Height in points) -->
      {#if featureFlags.isEnabled('page-actions.scale')}
      <div class="grid grid-cols-2 gap-2">
        <div class="field-group">
          <Label class="field-label">Width (pt)</Label>
          <Input
            type="number"
            value={visualWidth}
            onchange={(e) => handleDimensionChange('width', e)}
            onkeydown={(e) => handleKeydown('width', e)}
            class="field-input text-xs font-sans"
            min="10"
            step="0.5"
            disabled={store.isCropping || store.isReadOnly}
            aria-label="Page Width"
          />
        </div>
        <div class="field-group">
          <Label class="field-label">Height (pt)</Label>
          <Input
            type="number"
            value={visualHeight}
            onchange={(e) => handleDimensionChange('height', e)}
            onkeydown={(e) => handleKeydown('height', e)}
            class="field-input text-xs font-sans"
            min="10"
            step="0.5"
            disabled={store.isCropping || store.isReadOnly}
            aria-label="Page Height"
          />
        </div>
      </div>
      {/if}

      <div class="grid grid-cols-2 gap-2">
        {#if featureFlags.isEnabled('page-actions.rotate')}
        <Button
          variant="panel"
          onclick={() => actions.rotatePage(store.currentPageIndex)}
          disabled={store.isCropping || store.isReadOnly}
        >
          <RotateCw class="h-3.5 w-3.5 mr-2" /> Rotate
        </Button>
        {/if}
        {#if featureFlags.isEnabled('page-actions.scale')}
        <Button
          variant="panel"
          onclick={() => actions.openPageScaleDialog()}
          disabled={store.isCropping || !store.isDocumentLoaded || store.isReadOnly}
        >
          <Scaling class="h-3.5 w-3.5 mr-2" /> Scale / Size
        </Button>
        {/if}
      </div>
    </div>
  </SidebarSection>
{/if}
