<script lang="ts">
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import type { CanvasElement } from '../../stores/canvas-types';
  import { useSelection } from '../../stores/selection.svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useElementRegistry } from '../../core/element-registry';

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
    e.stopPropagation();
    if (isEditing) return;
    if (e.detail > 1) return;
    selection.clear();
    editorActions.clearSelection(true);
    canvasStore.selectElement(element.id);

    const containerEl = e.currentTarget as HTMLElement | null;
    containerEl?.focus?.({ preventScroll: true });

    const target = e.target as HTMLElement;
    const pageEl = target.closest('[data-page-element]') as HTMLElement;
    if (pageEl) {
      canvasActions.startDrag(element.id, e.clientX, e.clientY, pageEl, zoom, editorStore.getPageTransform(element.pageIndex));
    }
  }

  function handleClick(e: MouseEvent): void {
    e.stopPropagation();
    if (isEditing) return;
    selection.clear();
    editorActions.clearSelection(true);
    canvasStore.selectElement(element.id);

    const containerEl = e.currentTarget as HTMLElement | null;
    containerEl?.focus?.({ preventScroll: true });
  }

  function handleDblClick(e: MouseEvent): void {
    e.stopPropagation();
    if (element.kind === 'text' || element.kind === 'form-field') {
      canvasActions.endDrag();
      canvasActions.endResize();
      canvasStore.editingElementId = element.id;
    }
  }
</script>

<div
  data-element-id={element.id}
  class="canvas-element-container absolute flex {isDrawingOrAnnotating ? 'pointer-events-none' : 'pointer-events-auto'} {element.kind === 'text' || element.kind === 'note' || element.kind === 'path' ? 'items-start overflow-visible' : 'items-center justify-center overflow-hidden'} {isSelected ? 'canvas-element-selected' : ''}"
  style="
    left: {element.x * zoom}px;
    top: {element.y * zoom}px;
    width: {element.width * zoom}px;
    height: {element.height * zoom}px;
    transform: rotate({element.rotation}deg) scaleX({element.flipX ? -1 : 1}) scaleY({element.flipY ? -1 : 1});
    cursor: {element.locked ? 'var(--cursor-default, default)' : (isEditing ? 'var(--cursor-text, text)' : 'var(--cursor-move, move)')};
    opacity: {'opacity' in element && typeof element.opacity === 'number' ? element.opacity : 1};
  "
  onpointerdown={handlePointerDown}
  onclick={handleClick}
  ondblclick={handleDblClick}
  onkeydown={(e) => {
    if (!isEditing) {
      if (e.key === 'Enter') {
        e.stopPropagation();
        selection.clear();
        editorActions.clearSelection(true);
        canvasStore.selectElement(element.id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!element.locked) {
          e.stopPropagation();
          e.preventDefault();
          canvasActions.deleteElement(element.id);
        }
      }
    }
  }}
  role="button"
  tabindex="0"
>
  {#if elementDef?.component}
    {@const Component = elementDef.component}
    <Component {element} {zoom} selected={isSelected} editing={isEditing} />
  {/if}
</div>
