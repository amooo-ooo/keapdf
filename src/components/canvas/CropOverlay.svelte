<script lang="ts">
  import { Check, X } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import type { PageTransform } from '../../stores/types';
  import { capturePageMetrics, screenToPageCoordsWithMetrics } from '../../utils/geometry';
  import { calculateDragCropMargins, calculateClickCropMargins } from '../../services/pdf/operations/crop-ops';

  type CropHandle = 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

  interface Props {
    pageIndex: number;
    containerEl: HTMLElement | null;
    widthPts: number;
    heightPts: number;
    visualScale: number;
    pageTransform: PageTransform;
  }

  let {
    pageIndex,
    containerEl,
    widthPts,
    heightPts,
    visualScale,
    pageTransform,
  }: Props = $props();

  const store = useEditorStore();
  const actions = useEditorActions();

  const isPageCropping = $derived(store.activeCrop !== null && store.activeCrop.pageIndex === pageIndex);
  const activeCropMargins = $derived(isPageCropping && store.activeCrop ? store.activeCrop.margins : null);

  const cropLeftPts = $derived(activeCropMargins?.left ?? 0);
  const cropTopPts = $derived(activeCropMargins?.top ?? 0);
  const cropRightMarginPts = $derived(activeCropMargins?.right ?? 0);
  const cropBottomMarginPts = $derived(activeCropMargins?.bottom ?? 0);
  const cropWidthPts = $derived(Math.max(10, widthPts - cropLeftPts - cropRightMarginPts));
  const cropHeightPts = $derived(Math.max(10, heightPts - cropTopPts - cropBottomMarginPts));

  const cropLeftPx = $derived(cropLeftPts * visualScale);
  const cropTopPx = $derived(cropTopPts * visualScale);
  const cropWidthPx = $derived(cropWidthPts * visualScale);
  const cropHeightPx = $derived(cropHeightPts * visualScale);
  const pageWidthPx = $derived(widthPts * visualScale);
  const pageHeightPx = $derived(heightPts * visualScale);

  let activeDragCleanup: (() => void) | null = null;
  let rafId: number | null = null;
  let pendingUpdate: (() => void) | null = null;

  function scheduleUpdate(updateFn: () => void): void {
    pendingUpdate = updateFn;
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (pendingUpdate) {
          const fn = pendingUpdate;
          pendingUpdate = null;
          fn();
        }
      });
    }
  }

  function flushPendingUpdate(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (pendingUpdate) {
      const fn = pendingUpdate;
      pendingUpdate = null;
      fn();
    }
  }

  function cancelPendingUpdate(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pendingUpdate = null;
  }

  $effect(() => {
    return () => {
      if (activeDragCleanup) {
        activeDragCleanup();
        activeDragCleanup = null;
      }
      cancelPendingUpdate();
    };
  });

  function handleCropFreeDragStart(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (!store.activeCrop || store.activeCrop.pageIndex !== pageIndex || !containerEl) return;
    e.stopPropagation();
    e.preventDefault();

    const target = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // ignore
    }

    const metrics = capturePageMetrics(containerEl);
    const startPt = screenToPageCoordsWithMetrics(e.clientX, e.clientY, metrics, visualScale, pageTransform);
    let hasMoved = false;

    const onPointerMove = (me: PointerEvent): void => {
      const curPt = screenToPageCoordsWithMetrics(me.clientX, me.clientY, metrics, visualScale, pageTransform);
      if (Math.hypot(curPt.x - startPt.x, curPt.y - startPt.y) > 3) {
        hasMoved = true;
      }
      scheduleUpdate(() => {
        const newMargins = calculateDragCropMargins(startPt, curPt, widthPts, heightPts, 10);
        actions.updateCropMargins(newMargins);
      });
    };

    const onPointerUp = (ue?: PointerEvent): void => {
      try {
        if (target.hasPointerCapture(pointerId)) {
          target.releasePointerCapture(pointerId);
        }
      } catch {
        // ignore
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      activeDragCleanup = null;

      flushPendingUpdate();

      if (!hasMoved) {
        const clickPt = ue
          ? screenToPageCoordsWithMetrics(ue.clientX, ue.clientY, metrics, visualScale, pageTransform)
          : startPt;
        const clickMargins = calculateClickCropMargins(clickPt, widthPts, heightPts, {
          width: widthPts * 0.75,
          height: heightPts * 0.75,
        });
        actions.updateCropMargins(clickMargins);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    activeDragCleanup = () => onPointerUp();
  }

  function handleCropPanStart(e: PointerEvent): void {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.getAttribute('role') === 'button' || target.closest('[role="button"]')) return;
    if (!store.activeCrop || store.activeCrop.pageIndex !== pageIndex || !containerEl) return;

    const initMargins = { ...store.activeCrop.margins };
    const isFullPage = initMargins.top === 0 && initMargins.right === 0 && initMargins.bottom === 0 && initMargins.left === 0;
    if (isFullPage) {
      handleCropFreeDragStart(e);
      return;
    }

    e.stopPropagation();
    e.preventDefault();

    const dragTarget = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    try {
      dragTarget.setPointerCapture(pointerId);
    } catch {
      // ignore
    }

    const metrics = capturePageMetrics(containerEl);
    const startPt = screenToPageCoordsWithMetrics(e.clientX, e.clientY, metrics, visualScale, pageTransform);
    const cropW = widthPts - initMargins.left - initMargins.right;
    const cropH = heightPts - initMargins.top - initMargins.bottom;

    const onPointerMove = (me: PointerEvent): void => {
      const curPt = screenToPageCoordsWithMetrics(me.clientX, me.clientY, metrics, visualScale, pageTransform);
      const dx = curPt.x - startPt.x;
      const dy = curPt.y - startPt.y;

      let proposedLeft = initMargins.left + dx;
      let proposedTop = initMargins.top + dy;

      proposedLeft = Math.max(0, Math.min(widthPts - cropW, proposedLeft));
      proposedTop = Math.max(0, Math.min(heightPts - cropH, proposedTop));

      scheduleUpdate(() => {
        actions.updateCropMargins({
          left: Math.round(proposedLeft * 10) / 10,
          top: Math.round(proposedTop * 10) / 10,
          right: Math.round((widthPts - proposedLeft - cropW) * 10) / 10,
          bottom: Math.round((heightPts - proposedTop - cropH) * 10) / 10,
        });
      });
    };

    const onPointerUp = (): void => {
      try {
        if (dragTarget.hasPointerCapture(pointerId)) {
          dragTarget.releasePointerCapture(pointerId);
        }
      } catch {
        // ignore
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      activeDragCleanup = null;

      flushPendingUpdate();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    activeDragCleanup = onPointerUp;
  }

  function handleCropResizeStart(e: PointerEvent, handle: CropHandle): void {
    if (e.button !== 0) return;
    if (!store.activeCrop || store.activeCrop.pageIndex !== pageIndex || !containerEl) return;
    e.stopPropagation();
    e.preventDefault();

    const resizeTarget = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    try {
      resizeTarget.setPointerCapture(pointerId);
    } catch {
      // ignore
    }

    const metrics = capturePageMetrics(containerEl);
    const startPt = screenToPageCoordsWithMetrics(e.clientX, e.clientY, metrics, visualScale, pageTransform);
    const initMargins = { ...store.activeCrop.margins };
    const minDim = 10;

    const onPointerMove = (me: PointerEvent): void => {
      const curPt = screenToPageCoordsWithMetrics(me.clientX, me.clientY, metrics, visualScale, pageTransform);
      const dx = curPt.x - startPt.x;
      const dy = curPt.y - startPt.y;

      let newTop = initMargins.top;
      let newBottom = initMargins.bottom;
      let newLeft = initMargins.left;
      let newRight = initMargins.right;

      if (handle.includes('top')) {
        newTop = Math.max(0, Math.min(heightPts - initMargins.bottom - minDim, initMargins.top + dy));
      }
      if (handle.includes('bottom')) {
        newBottom = Math.max(0, Math.min(heightPts - initMargins.top - minDim, initMargins.bottom - dy));
      }
      if (handle.includes('left')) {
        newLeft = Math.max(0, Math.min(widthPts - initMargins.right - minDim, initMargins.left + dx));
      }
      if (handle.includes('right')) {
        newRight = Math.max(0, Math.min(widthPts - initMargins.left - minDim, initMargins.right - dx));
      }

      scheduleUpdate(() => {
        actions.updateCropMargins({
          top: Math.round(newTop * 10) / 10,
          bottom: Math.round(newBottom * 10) / 10,
          left: Math.round(newLeft * 10) / 10,
          right: Math.round((newRight) * 10) / 10,
        });
      });
    };

    const onPointerUp = (): void => {
      try {
        if (resizeTarget.hasPointerCapture(pointerId)) {
          resizeTarget.releasePointerCapture(pointerId);
        }
      } catch {
        // ignore
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      activeDragCleanup = null;

      flushPendingUpdate();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    activeDragCleanup = onPointerUp;
  }
</script>

{#if isPageCropping && activeCropMargins}
  <div
    class="absolute inset-0 z-[100] pointer-events-auto select-none overflow-visible"
    style="width: {pageWidthPx}px; height: {pageHeightPx}px;"
  >
    <!-- Darkened shrouds covering uncropped page margins with darker outline on excluded sections (no drop shadow) -->
    <!-- Top shroud -->
    {#if cropTopPx > 0}
      <div
        class="absolute bg-black/50 border-b border-black/60 cursor-crosshair"
        style="top: 0; left: 0; width: 100%; height: {cropTopPx}px;"
        onpointerdown={handleCropFreeDragStart}
        role="region"
        aria-label="Uncropped top margin"
      ></div>
    {/if}
    <!-- Bottom shroud -->
    {#if pageHeightPx - cropTopPx - cropHeightPx > 0}
      <div
        class="absolute bg-black/50 border-t border-black/60 cursor-crosshair"
        style="top: {cropTopPx + cropHeightPx}px; left: 0; width: 100%; height: {pageHeightPx - cropTopPx - cropHeightPx}px;"
        onpointerdown={handleCropFreeDragStart}
        role="region"
        aria-label="Uncropped bottom margin"
      ></div>
    {/if}
    <!-- Left shroud -->
    {#if cropLeftPx > 0}
      <div
        class="absolute bg-black/50 border-r border-black/60 cursor-crosshair"
        style="top: {cropTopPx}px; left: 0; width: {cropLeftPx}px; height: {cropHeightPx}px;"
        onpointerdown={handleCropFreeDragStart}
        role="region"
        aria-label="Uncropped left margin"
      ></div>
    {/if}
    <!-- Right shroud -->
    {#if pageWidthPx - cropLeftPx - cropWidthPx > 0}
      <div
        class="absolute bg-black/50 border-l border-black/60 cursor-crosshair"
        style="top: {cropTopPx}px; left: {cropLeftPx + cropWidthPx}px; width: {pageWidthPx - cropLeftPx - cropWidthPx}px; height: {cropHeightPx}px;"
        onpointerdown={handleCropFreeDragStart}
        role="region"
        aria-label="Uncropped right margin"
      ></div>
    {/if}

    <!-- Draggable Crop Window Box (Figma/Canva style) -->
    <div
      class="absolute border-[1.5px] border-selection cursor-move pointer-events-auto select-none"
      style="left: {cropLeftPx}px; top: {cropTopPx}px; width: {cropWidthPx}px; height: {cropHeightPx}px;"
      onpointerdown={handleCropPanStart}
      ondblclick={(e) => {
        e.stopPropagation();
        if (store.activeCrop) {
          actions.cropPage(store.activeCrop.pageIndex, store.activeCrop.margins, store.activeCrop.scope);
        }
      }}
      role="region"
      aria-label="Crop window"
    >
      <!-- Rule-of-thirds grid guides -->
      <div class="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 opacity-40">
        <div class="border-r border-b border-selection/40"></div>
        <div class="border-r border-b border-selection/40"></div>
        <div class="border-b border-selection/40"></div>
        <div class="border-r border-b border-selection/40"></div>
        <div class="border-r border-b border-selection/40"></div>
        <div class="border-b border-selection/40"></div>
        <div class="border-r border-b border-selection/40"></div>
        <div class="border-r border-b border-selection/40"></div>
        <div></div>
      </div>

      <!-- Floating Dimension and Action Badge -->
      <div
        class="absolute {cropTopPx > 42 ? '-top-10' : 'top-2.5'} left-1/2 -translate-x-1/2 bg-card/95 text-foreground backdrop-blur-md border border-border/80 rounded-2xl px-2 py-1 pointer-events-auto whitespace-nowrap flex items-center gap-2 z-50 select-none"
      >
        <span class="text-[11px] font-sans px-2.5 py-1 font-medium text-muted-foreground">
          {Math.round(cropWidthPts)} × {Math.round(cropHeightPts)} pt
        </span>
        <Button
          size="sm"
          variant="default"
          class="h-6 text-[11px] px-2.5 rounded-xl flex items-center gap-1 font-medium"
          onclick={(e) => {
            e.stopPropagation();
            if (store.activeCrop) {
              actions.cropPage(store.activeCrop.pageIndex, store.activeCrop.margins, store.activeCrop.scope);
            }
          }}
        >
          <Check class="w-3 h-3" aria-hidden="true" /> Apply
        </Button>
        <Button
          size="sm"
          variant="outline"
          class="h-6 text-[11px] px-2 rounded-xl flex items-center gap-1 text-muted-foreground hover:text-foreground"
          onclick={(e) => {
            e.stopPropagation();
            actions.cancelCropMode();
          }}
        >
          <X class="w-3 h-3" aria-hidden="true" /> Cancel
        </Button>
      </div>

      <!-- 4 Corner Handles (Figma style solid white with selection border, no drop shadow) -->
      <div
        class="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-selection rounded-[1px] cursor-nwse-resize z-40 pointer-events-auto"
        onpointerdown={(e) => handleCropResizeStart(e, 'top-left')}
        role="button"
        tabindex="0"
        aria-label="Resize crop top-left"
      ></div>
      <div
        class="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-selection rounded-[1px] cursor-nesw-resize z-40 pointer-events-auto"
        onpointerdown={(e) => handleCropResizeStart(e, 'top-right')}
        role="button"
        tabindex="0"
        aria-label="Resize crop top-right"
      ></div>
      <div
        class="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-selection rounded-[1px] cursor-nesw-resize z-40 pointer-events-auto"
        onpointerdown={(e) => handleCropResizeStart(e, 'bottom-left')}
        role="button"
        tabindex="0"
        aria-label="Resize crop bottom-left"
      ></div>
      <div
        class="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-selection rounded-[1px] cursor-nwse-resize z-40 pointer-events-auto"
        onpointerdown={(e) => handleCropResizeStart(e, 'bottom-right')}
        role="button"
        tabindex="0"
        aria-label="Resize crop bottom-right"
      ></div>

      <!-- 4 Edge Handles (Figma / Canva style pill bars) -->
      <div
        class="absolute -top-1 left-4 right-4 h-2 cursor-ns-resize z-30 flex items-center justify-center pointer-events-auto"
        onpointerdown={(e) => handleCropResizeStart(e, 'top')}
        role="button"
        tabindex="0"
        aria-label="Resize crop top"
      >
        <div class="w-7 h-1.5 bg-white border border-selection rounded-full"></div>
      </div>
      <div
        class="absolute -bottom-1 left-4 right-4 h-2 cursor-ns-resize z-30 flex items-center justify-center pointer-events-auto"
        onpointerdown={(e) => handleCropResizeStart(e, 'bottom')}
        role="button"
        tabindex="0"
        aria-label="Resize crop bottom"
      >
        <div class="w-7 h-1.5 bg-white border border-selection rounded-full"></div>
      </div>
      <div
        class="absolute top-4 bottom-4 -left-1 w-2 cursor-ew-resize z-30 flex items-center justify-center pointer-events-auto"
        onpointerdown={(e) => handleCropResizeStart(e, 'left')}
        role="button"
        tabindex="0"
        aria-label="Resize crop left"
      >
        <div class="h-7 w-1.5 bg-white border border-selection rounded-full"></div>
      </div>
      <div
        class="absolute top-4 bottom-4 -right-1 w-2 cursor-ew-resize z-30 flex items-center justify-center pointer-events-auto"
        onpointerdown={(e) => handleCropResizeStart(e, 'right')}
        role="button"
        tabindex="0"
        aria-label="Resize crop right"
      >
        <div class="h-7 w-1.5 bg-white border border-selection rounded-full"></div>
      </div>
    </div>
  </div>
{/if}
