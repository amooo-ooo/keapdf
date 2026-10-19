<script lang="ts">
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import type { CanvasElement } from '../../stores/canvas-types';
  import { useSelection } from '../../stores/selection.svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useElementRegistry } from '../../core/element-registry';

  import { tryUseFeatureFlagStore } from '../../core/feature-flags';

  interface Props {
    element: CanvasElement;
    zoom: number;
    isSelected: boolean;
  }

  let { element, zoom, isSelected }: Props = $props();

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();
  const selection = useSelection();
  const editorStore = useEditorStore();
  const editorActions = useEditorActions();
  const elementRegistry = useElementRegistry();
  const featureFlags = tryUseFeatureFlagStore();

  const isEditing = $derived(canvasStore.editingElementId === element.id);
  const elementDef = $derived(elementRegistry.get(element.kind));
  const isDrawingOrAnnotating = $derived(
    editorStore.activeTool === 'highlight' ||
    editorStore.activeTool === 'redact' ||
    editorStore.activeTool === 'pen' ||
    editorStore.activeTool === 'eraser'
  );

  function handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (editorStore.isReadOnly || !editorStore.canSelectElements) return;
    e.stopPropagation();
    if (isEditing) return;
    if (e.detail > 1) return;

    const isMulti = (e.ctrlKey || e.metaKey || e.shiftKey) && (featureFlags ? featureFlags.isEnabled('select-tool.multiselect') : true);
    if (isMulti) {
      canvasStore.toggleElement(element.id);
    } else {
      if (!canvasStore.isSelected(element.id)) {
        selection.clear();
        editorActions.clearSelection(true, false);
        canvasStore.selectElement(element.id);
      }
    }

    const containerEl = e.currentTarget as HTMLElement | null;
    containerEl?.focus?.({ preventScroll: true });

    const target = e.target as HTMLElement;
    const pageEl = target.closest('[data-page-element]') as HTMLElement;
    if (pageEl && editorStore.canMoveElements && !editorStore.isReadOnly) {
      if (canvasStore.isSelected(element.id)) {
        canvasActions.startDrag(element.id, e.clientX, e.clientY, pageEl, zoom, editorStore.getPageTransform(element.pageIndex));
      }
    }
  }

  function handleClick(e: MouseEvent): void {
    if (editorStore.isReadOnly || !editorStore.canSelectElements) return;
    e.stopPropagation();
    if (isEditing) return;
    if (canvasActions.consumeDragEnd()) {
      return;
    }
    const isMulti = (e.ctrlKey || e.metaKey || e.shiftKey) && (featureFlags ? featureFlags.isEnabled('select-tool.multiselect') : true);
    if (isMulti) {
      return;
    }
    if (!canvasStore.isSelected(element.id) || canvasStore.selectedElementIds.length > 1 || editorStore.selectedSpans.length > 0) {
      selection.clear();
      editorActions.clearSelection(true, false);
      canvasStore.selectElement(element.id);
    }

    const containerEl = e.currentTarget as HTMLElement | null;
    containerEl?.focus?.({ preventScroll: true });
  }

  function handleDblClick(e: MouseEvent): void {
    e.stopPropagation();
    if (element.kind === 'form-field') {
      if (!editorStore.canEditValues) return;
      canvasActions.endDrag();
      canvasActions.endResize();
      canvasStore.editingElementId = element.id;
    } else if (element.kind === 'text') {
      if (editorStore.isReadOnly || !editorStore.canEditContent) return;
      canvasActions.endDrag();
      canvasActions.endResize();
      canvasStore.editingElementId = element.id;
    }
  }

  const pointerEventsClass = $derived(
    isDrawingOrAnnotating ||
    editorStore.selectMode === 'text' ||
    (editorStore.isReadOnly && !editorStore.canSelectElements && !(element.kind === 'form-field' && editorStore.canEditValues))
      ? 'pointer-events-none'
      : 'pointer-events-auto'
  );
</script>

<div
  data-element-id={element.id}
  class="canvas-element-container absolute z-40 flex {pointerEventsClass} {element.kind === 'text' || element.kind === 'note' || element.kind === 'path' || (element.kind === 'shape' && (element.variant === 'path' || element.variant === 'line' || element.variant === 'arrow' || Boolean(element.svgPath))) ? 'items-start overflow-visible' : 'items-center justify-center overflow-hidden'} {isSelected ? 'canvas-element-selected' : ''}"
  style="
    left: {element.x * zoom}px;
    top: {element.y * zoom}px;
    width: {element.width * zoom}px;
    height: {element.height * zoom}px;
    transform: rotate({element.rotation}deg) scaleX({element.flipX ? -1 : 1}) scaleY({element.flipY ? -1 : 1});
    cursor: {element.locked || !editorStore.canMoveElements || editorStore.isReadOnly ? 'var(--cursor-default, default)' : (isEditing ? 'var(--cursor-text, text)' : 'var(--cursor-move, move)')};
    opacity: {'opacity' in element && typeof element.opacity === 'number' ? element.opacity : 1};
    {(element.kind === 'shape' || element.kind === 'path') && element.isHighlight ? 'mix-blend-mode: multiply;' : ''}
    {typeof element.zIndex === 'number' ? `z-index: ${element.zIndex};` : ''}
  "
  onpointerdown={handlePointerDown}
  onclick={handleClick}
  ondblclick={handleDblClick}
  onkeydown={(e) => {
    if (!isEditing) {
      if (e.key === 'Enter') {
        if (editorStore.isReadOnly || !editorStore.canSelectElements) return;
        e.stopPropagation();
        e.preventDefault();
        selection.clear();
        editorActions.clearSelection(true);
        canvasStore.selectElement(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!element.locked && editorStore.canDeleteElements && !editorStore.isReadOnly) {
          e.stopPropagation();
          e.preventDefault();
          canvasActions.deleteSelectedElement();
        }
      }
    }
  }}
  role="button"
  tabindex="0"
  aria-label={`${element.kind} element`}
>
  {#if elementDef?.component}
    {@const Component = elementDef.component}
    <Component {element} {zoom} selected={isSelected} editing={isEditing} />
  {/if}
</div>
