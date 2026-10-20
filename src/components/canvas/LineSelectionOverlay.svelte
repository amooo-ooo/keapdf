<script lang="ts">
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { getLineEndpoints } from '../../utils/line-geometry';
  import type { LineEndpointHandle } from '../../stores/canvas-types';

  interface Props {
    element: {
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation?: number;
      flipX?: boolean;
      flipY?: boolean;
    };
    zoom: number;
    onAdjustStart?: (e: PointerEvent, handle: LineEndpointHandle, pageEl: HTMLElement) => void;
  }

  let { element, zoom, onAdjustStart }: Props = $props();

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();
  const editorStore = useEditorStore();
  const editorActions = useEditorActions();

  const liveElement = $derived(
    canvasStore.elements.find((el) => el.id === element.id) ?? element
  );
  const endpoints = $derived(getLineEndpoints(liveElement));
  const startX = $derived(endpoints.start.x * zoom);
  const startY = $derived(endpoints.start.y * zoom);
  const endX = $derived(endpoints.end.x * zoom);
  const endY = $derived(endpoints.end.y * zoom);

  const isDragging = $derived(canvasStore.dragState?.mode === 'move');
  const pointerEventsClass = $derived(
    isDragging || !editorStore.canResizeElements || editorStore.isReadOnly
      ? 'pointer-events-none'
      : 'pointer-events-auto'
  );

  function handleHandlePointerDown(e: PointerEvent, handle: LineEndpointHandle): void {
    if (e.button !== 0 || !editorStore.canResizeElements || editorStore.isReadOnly) return;
    if (e.detail > 1) return;
    e.stopPropagation();
    const target = e.target as HTMLElement;
    const pageEl =
      (target.closest('[data-page-element]') as HTMLElement | null) ??
      (target.closest('[data-canvas-layer]') as HTMLElement | null);

    if (onAdjustStart) {
      onAdjustStart(e, handle, pageEl || target);
      return;
    }

    const selectedEl = canvasStore.elements.find((el) => el.id === element.id);
    const pageIndex = selectedEl?.pageIndex ?? 0;
    const pt = selectedEl ? editorStore.getPageTransform(pageIndex) : undefined;
    const resolvedPageEl =
      pageEl ??
      (document.querySelector(`[data-page-index="${pageIndex}"] [data-page-element]`) as HTMLElement | null) ??
      target;

    canvasActions.startEndpointAdjust(element.id, handle, e.clientX, e.clientY, resolvedPageEl, zoom, pt);
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!editorStore.canDeleteElements || editorStore.isReadOnly) return;
      e.preventDefault();
      e.stopPropagation();
      void editorActions.deleteSelected();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      editorActions.clearSelection(true);
      canvasStore.selectElement(null);
    }
  }
</script>

<div
  class="selection-overlay-container line-selection-overlay absolute inset-0 pointer-events-none overflow-visible"
  role="presentation"
>
  <svg class="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
    <line
      x1={startX}
      y1={startY}
      x2={endX}
      y2={endY}
      stroke="var(--selection)"
      stroke-width="1.5"
      stroke-dasharray="3 3"
      class="opacity-80"
    />
  </svg>

  <!-- Start terminal handle -->
  <div
    class="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center {pointerEventsClass} cursor-crosshair z-20 group"
    style="left: {startX}px; top: {startY}px;"
    onpointerdown={(e) => handleHandlePointerDown(e, 'start')}
    onkeydown={handleKeyDown}
    role="button"
    tabindex="0"
    aria-label="Adjust start point"
  >
    <div
      class="w-2 h-2 bg-white border border-selection shadow-xs pointer-events-none"
    ></div>
  </div>

  <!-- End terminal handle -->
  <div
    class="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center {pointerEventsClass} cursor-crosshair z-20 group"
    style="left: {endX}px; top: {endY}px;"
    onpointerdown={(e) => handleHandlePointerDown(e, 'end')}
    onkeydown={handleKeyDown}
    role="button"
    tabindex="0"
    aria-label="Adjust end point"
  >
    <div
      class="w-2 h-2 bg-white border border-selection shadow-xs pointer-events-none"
    ></div>
  </div>
</div>
