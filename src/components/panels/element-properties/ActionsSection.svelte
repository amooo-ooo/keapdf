<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../../core/feature-flags';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Copy, Trash2, Lock, Unlock } from 'lucide-svelte';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();
  const editorStore = useEditorStore();
  const editorActions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  const isReadOnlyMode = $derived(editorStore.isReadOnly);

  const activeElement = $derived.by(() => {
    if (canvasStore.selectedElement) {
      return canvasStore.selectedElement;
    }
    const span = editorStore.selectedSpan;
    if (span && (span.type === 'image' || span.type === 'shape' || span.type === 'form-field' || span.type === 'text')) {
      return {
        id: span.id,
        locked: false,
      };
    }
    return null;
  });

  async function updateProp(propName: string, value: boolean): Promise<void> {
    if (isReadOnlyMode) return;
    const multiModifyEnabled =
      featureFlags.isEnabled('select-tool.multiselect') &&
      featureFlags.isEnabled('select-tool.multiselect.modify');
    let selected = canvasStore.selectedElementId;
    if (
      editorStore.selectedSpan &&
      (editorStore.selectedSpan.type === 'image' ||
        editorStore.selectedSpan.type === 'shape' ||
        editorStore.selectedSpan.type === 'form-field' ||
        editorStore.selectedSpan.type === 'text') &&
      (!selected || (multiModifyEnabled && editorStore.selectedSpans.length > 0))
    ) {
      const extracted = multiModifyEnabled
        ? (await editorActions.extractSelectedSpansToCanvas(editorStore.selectedSpan, canvasStore)).primaryElementId
        : await editorActions.extractObjectToCanvas(editorStore.selectedSpan.type, editorStore.selectedSpan, canvasStore);
      selected = extracted ?? canvasStore.selectedElementId;
    }
    if (selected) {
      if (multiModifyEnabled && canvasStore.selectedElementIds.length > 1) {
        canvasActions.updateSelectedElementsProperties({ [propName]: value }, { includeLocked: true });
      } else {
        canvasActions.updateElementProperties(selected, { [propName]: value });
      }
    }
  }

  async function handleDuplicate(): Promise<void> {
    if (isReadOnlyMode || !editorStore.canDuplicateElements) return;
    const multiModifyEnabled =
      featureFlags.isEnabled('select-tool.multiselect') &&
      featureFlags.isEnabled('select-tool.multiselect.modify');
    if (
      editorStore.selectedSpan &&
      (editorStore.selectedSpan.type === 'image' ||
        editorStore.selectedSpan.type === 'shape' ||
        editorStore.selectedSpan.type === 'form-field' ||
        editorStore.selectedSpan.type === 'text') &&
      (!canvasStore.selectedElementId || (multiModifyEnabled && editorStore.selectedSpans.length > 0))
    ) {
      if (multiModifyEnabled) {
        await editorActions.extractSelectedSpansToCanvas(editorStore.selectedSpan, canvasStore);
      } else {
        await editorActions.extractObjectToCanvas(editorStore.selectedSpan.type, editorStore.selectedSpan, canvasStore);
      }
    }
    canvasActions.duplicateSelectedElement();
  }

  function handleDelete(): void {
    if (isReadOnlyMode || !editorStore.canDeleteElements) return;
    if (canvasStore.selectedElementId) {
      canvasActions.deleteSelectedElement();
    } else {
      void editorActions.deleteSelectedSpan();
    }
  }
</script>

{#if activeElement}
  {@const element = activeElement}
  <SidebarSection title="Actions" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="field-group">
      {#if featureFlags.isEnabled('canvas-elements.duplicate')}
      <Button variant="panel" disabled={isReadOnlyMode || !editorStore.canDuplicateElements} onclick={() => void handleDuplicate()}>
        <Copy class="panel-icon-sm" /> Duplicate
      </Button>
      {/if}
      {#if featureFlags.isEnabled('canvas-elements.lock')}
      <Button variant="panel" disabled={isReadOnlyMode} onclick={() => void updateProp('locked', !element.locked)}>
        {#if element.locked}
          <Unlock class="panel-icon-sm" /> Unlock
        {:else}
          <Lock class="panel-icon-sm" /> Lock
        {/if}
      </Button>
      {/if}
      {#if featureFlags.isEnabled('canvas-elements.delete')}
      <Button variant="panel" disabled={element.locked || isReadOnlyMode || !editorStore.canDeleteElements} onclick={handleDelete}>
        <Trash2 class="panel-icon-sm" /> Delete Element
      </Button>
      {/if}
    </div>
  </SidebarSection>
{/if}
