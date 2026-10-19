<script lang="ts">
  import { flushSync, tick, untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions, ZOOM_MIN, ZOOM_MAX, type ScrollTargetOptions } from '../../stores/editor-actions';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import {
    ELEMENT_DEFAULTS,
    type ElementDropPayload,
    type BuiltinCanvasElementKind
  } from '../../stores/canvas-types';
  import {
    screenToPageCoordsWithMetrics,
    capturePageMetrics,
    calculatePageCenteringScroll,
    calculateCenterPreservingScroll,
    calculateOutOfBoundsScrollSpeeds,
    calculatePageLayoutDimensions,
    calculateZoomScrollOffsets,
    calculatePageAnchorZoomScroll,
    calculateSmoothZoomFactor,
    computePageVerticalOffsets,
    resolvePageIndexFromOffsets,
  } from '../../utils/geometry';
  import type {
    CachedPageMetrics,
    PageLayoutDimensions,
    PageVerticalOffset,
  } from '../../utils/geometry';
  import { computeDragSnap, extractSnapCandidates } from '../../utils/snapping-engine';
  import PdfPageView from './PdfPageView.svelte';
  import EmptyStateFeatureCarousel from './EmptyStateFeatureCarousel.svelte';
  import PageOrganizerPanel from '../panels/PageOrganizerPanel.svelte';

  import { Button } from '$lib/components/ui/button/index.js';
  import { AlertCircle, FolderOpen } from 'lucide-svelte';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import { isPdfFile, isConvertibleDocumentFile } from '../../utils/file-type-utils';

  const store = useEditorStore();
  const actions = useEditorActions();
  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();
  const featureFlags = useFeatureFlagStore();

  let viewportEl: HTMLElement | null = $state(null);

  let isSpaceDown = $state(false);
  let isPanning = $state(false);
  let panStartX = 0;
  let panStartY = 0;
  let scrollStartX = 0;
  let scrollStartY = 0;
  
  let activePointerId: number | null = null;
  let activePointerTarget: Element | null = null;

  function handleKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const isTyping =
      target !== null &&
      (target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable ||
        Boolean(target.closest('[contenteditable="true"]')));

    if (isTyping || store.isInlineEditing) return;

    if ((e.code === 'Space' || e.key === ' ') && !e.repeat) {
      e.preventDefault();
      isSpaceDown = true;
    }

    if (canvasStore.selectedElement) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.isReadOnly || !store.canDeleteElements) return;
        e.stopImmediatePropagation();
        e.stopPropagation();
        e.preventDefault();
        void actions.deleteSelected();
      } else if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.stopPropagation();
        canvasStore.selectElement(null);
      }
    }
  }

  function handleKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space' || e.key === ' ') {
      isSpaceDown = false;
      // Note: We intentionally do NOT set isPanning = false here,
      // so the user can release Space mid-drag without cancelling the pan.
    }
  }

  function handlePointerDown(e: PointerEvent): void {
    const shouldPan = (store.activeTool === 'hand' && e.button === 0) || (isSpaceDown && e.button === 0) || e.button === 1;
    if (shouldPan) {
      e.preventDefault();
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      activePointerId = e.pointerId;
      activePointerTarget = e.target as Element;
      
      if (viewportEl) {
        scrollStartX = viewportEl.scrollLeft;
        scrollStartY = viewportEl.scrollTop;
      }
      
      try {
        if (activePointerTarget && typeof activePointerTarget.setPointerCapture === 'function') {
          activePointerTarget.setPointerCapture(e.pointerId);
        }
      } catch (err) {
        console.warn('Could not set pointer capture', err);
      }
    }
  }

  let autoScrollRafId: number | null = null;
  let autoScrollSpeedX = 0;
  let autoScrollSpeedY = 0;
  let lastDragClientX: number | null = null;
  let lastDragClientY: number | null = null;
  let cachedTargetPageIndex: number | null = null;
  let cachedTargetLayerEl: HTMLElement | null = null;
  let dropRafId: number | null = null;
  let cachedDropPageMetrics: {
    pageIndex: number;
    metrics: CachedPageMetrics;
    pageEl: HTMLElement;
    snapCandidates?: ReturnType<typeof extractSnapCandidates>;
  } | null = null;
  let latestDragClientX = 0;
  let latestDragClientY = 0;
  let latestDragTarget: HTMLElement | null = null;
  let dragJustEnded = false;
  let dragJustEndedTimer: ReturnType<typeof setTimeout> | null = null;

  function performDragMove(clientX: number, clientY: number, disabledSnap: boolean = false): void {
    if (!canvasStore.dragState || canvasStore.dragState.mode !== 'move' || !viewportEl) return;
    const draggedElement = canvasStore.getElementById(canvasStore.dragState.elementId);
    if (!draggedElement) return;

    // Resolve target page based on vertical pointer position and midpoint thresholds
    let targetPageIndex = draggedElement.pageIndex;
    if (store.pageCount > 1) {
      // Resolve target page via O(log N) binary search over cached vertical offsets
      const viewportRect = viewportEl.getBoundingClientRect();
      const targetScrollY = clientY - viewportRect.top + viewportEl.scrollTop;
      targetPageIndex = resolvePageIndexAtScrollY(targetScrollY);
    }

    if (targetPageIndex !== cachedTargetPageIndex || !cachedTargetLayerEl || !cachedTargetLayerEl.isConnected) {
      cachedTargetPageIndex = targetPageIndex;
      const targetPageSelector = `[data-page-index="${targetPageIndex}"]`;
      cachedTargetLayerEl = (
        viewportEl.querySelector(`${targetPageSelector} [data-canvas-layer]`) ??
        viewportEl.querySelector(`${targetPageSelector} [data-page-element]`)
      ) as HTMLElement | null;
    }

    if (cachedTargetLayerEl) {
      const targetPt = store.getPageTransform(targetPageIndex);
      canvasActions.updateDrag(clientX, clientY, cachedTargetLayerEl, store.zoom, targetPt, targetPageIndex, { disabledSnap });
    }
  }

  function updateAutoScroll(clientX: number, clientY: number): void {
    if (!viewportEl || !canvasStore.dragState || canvasStore.dragState.mode !== 'move') {
      stopAutoScroll();
      return;
    }

    const rect = viewportEl.getBoundingClientRect();
    const { speedX, speedY } = calculateOutOfBoundsScrollSpeeds(clientX, clientY, rect);

    autoScrollSpeedX = speedX;
    autoScrollSpeedY = speedY;

    if (speedX === 0 && speedY === 0) {
      stopAutoScroll();
      return;
    }

    if (autoScrollRafId === null) {
      startAutoScroll();
    }
  }

  function startAutoScroll(): void {
    if (autoScrollRafId !== null) return;
    const step = () => {
      if (viewportEl && (autoScrollSpeedX !== 0 || autoScrollSpeedY !== 0) && canvasStore.dragState) {
        const prevScrollTop = viewportEl.scrollTop;
        const prevScrollLeft = viewportEl.scrollLeft;
        if (autoScrollSpeedY !== 0) {
          viewportEl.scrollTop += autoScrollSpeedY;
        }
        if (autoScrollSpeedX !== 0) {
          viewportEl.scrollLeft += autoScrollSpeedX;
        }
        const actualDx = viewportEl.scrollLeft - prevScrollLeft;
        const actualDy = viewportEl.scrollTop - prevScrollTop;
        if (actualDx !== 0 || actualDy !== 0) {
          canvasActions.adjustCachedPageMetricsForScroll(actualDx, actualDy);
        }
        if (lastDragClientX !== null && lastDragClientY !== null && canvasStore.dragState.mode === 'move') {
          performDragMove(lastDragClientX, lastDragClientY);
        }
        autoScrollRafId = requestAnimationFrame(step);
      } else {
        stopAutoScroll();
      }
    };
    autoScrollRafId = requestAnimationFrame(step);
  }

  function stopAutoScroll(): void {
    if (autoScrollRafId !== null) {
      cancelAnimationFrame(autoScrollRafId);
      autoScrollRafId = null;
    }
    autoScrollSpeedX = 0;
    autoScrollSpeedY = 0;
  }

  function handlePointerMove(e: PointerEvent): void {
    if (viewportEl) {
      const rect = viewportEl.getBoundingClientRect();
      const inX = e.clientX >= rect.left && e.clientX <= rect.right;
      const inY = e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (inX && inY) {
        isPointerOverViewport = true;
        lastPointerViewportX = e.clientX - rect.left;
        lastPointerViewportY = e.clientY - rect.top;
      } else {
        isPointerOverViewport = false;
      }
    }

    if (isPanning && viewportEl) {
      e.preventDefault();
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      viewportEl.scrollLeft = scrollStartX - dx;
      viewportEl.scrollTop = scrollStartY - dy;
    } else if (canvasStore.dragState && viewportEl) {
      const draggedElement = canvasStore.getElementById(canvasStore.dragState.elementId);
      if (!draggedElement) return;

      if (canvasStore.dragState.mode === 'move') {
        lastDragClientX = e.clientX;
        lastDragClientY = e.clientY;
        const disabledSnap = e.ctrlKey || e.metaKey;
        updateAutoScroll(e.clientX, e.clientY);
        performDragMove(e.clientX, e.clientY, disabledSnap);
      } else {
        if (draggedElement.pageIndex !== cachedTargetPageIndex || !cachedTargetLayerEl || !cachedTargetLayerEl.isConnected) {
          cachedTargetPageIndex = draggedElement.pageIndex;
          const pageSelector = `[data-page-index="${draggedElement.pageIndex}"]`;
          cachedTargetLayerEl = (
            viewportEl.querySelector(`${pageSelector} [data-canvas-layer]`) ??
            viewportEl.querySelector(`${pageSelector} [data-page-element]`)
          ) as HTMLElement | null;
        }
        const layerEl = cachedTargetLayerEl;
        if (!layerEl) return;

        const pt = store.getPageTransform(draggedElement.pageIndex);
        if (canvasStore.dragState.mode === 'resize') {
          const disabledSnap = e.ctrlKey || e.metaKey;
          canvasActions.updateResize(e.clientX, e.clientY, layerEl, store.zoom, e.shiftKey, pt, { disabledSnap });
        } else if (canvasStore.dragState.mode === 'endpoint') {
          const disabledSnap = e.ctrlKey || e.metaKey;
          canvasActions.updateEndpointAdjust(e.clientX, e.clientY, layerEl, store.zoom, e.shiftKey, pt, { disabledSnap });
        } else if (canvasStore.dragState.mode === 'rotate') {
          canvasActions.updateRotate(e.clientX, e.clientY, layerEl, store.zoom, pt);
        }
      }
    }
  }

  function handlePointerUp(): void {
    stopAutoScroll();
    lastDragClientX = null;
    lastDragClientY = null;

    if (isPanning) {
      isPanning = false;
      try {
        if (activePointerTarget && activePointerId !== null && typeof activePointerTarget.releasePointerCapture === 'function') {
           if (activePointerTarget.hasPointerCapture(activePointerId)) {
             activePointerTarget.releasePointerCapture(activePointerId);
           }
        }
      } catch (err) {
        // ignore
      }
      activePointerId = null;
      activePointerTarget = null;
    }

    if (canvasStore.dragState) {
      dragJustEnded = true;
      if (dragJustEndedTimer !== null) {
        clearTimeout(dragJustEndedTimer);
      }
      dragJustEndedTimer = setTimeout(() => {
        dragJustEnded = false;
        dragJustEndedTimer = null;
      }, 100);

      if (canvasStore.dragState.mode === 'move') {
        canvasActions.endDrag();
      } else if (canvasStore.dragState.mode === 'resize') {
        canvasActions.endResize();
      } else if (canvasStore.dragState.mode === 'endpoint') {
        canvasActions.endEndpointAdjust();
      } else if (canvasStore.dragState.mode === 'rotate') {
        canvasActions.endRotate();
      }
    }
    cachedTargetPageIndex = null;
    cachedTargetLayerEl = null;
  }

  function handleWindowClick(e: MouseEvent): void {
    if (dragJustEnded || canvasActions.consumeDragEnd()) {
      dragJustEnded = false;
      return;
    }

    if (!canvasStore.selectedElement) return;

    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const isInside = (selector: string): boolean => {
      for (let i = 0; i < path.length; i++) {
        const node = path[i];
        if (node instanceof Element && node.matches(selector)) {
          return true;
        }
      }
      const target = e.target;
      if (target instanceof Element && target.closest(selector)) {
        return true;
      }
      return false;
    };

    if (
      isInside('.editor-shell-right') || 
      isInside('.editor-shell-left') || 
      isInside('.editor-shell-nav') ||
      isInside('[role="dialog"]') ||
      isInside('[role="menu"]') ||
      isInside('[role="listbox"]') ||
      isInside('[data-radix-popper-content-wrapper]') ||
      isInside('[data-bits-menu-content]') ||
      isInside('[data-bits-select-content]') ||
      isInside('[data-bits-popover-content]') ||
      isInside('[data-bits-dialog-content]') ||
      isInside('.pdf-form-layer') ||
      isInside('.pdf-form-field-wrapper') ||
      isInside('.toaster')
    ) {
      return;
    }

    if (
      !isInside('.canvas-element-container') &&
      !isInside('.selection-overlay-container') &&
      !isInside('.line-selection-overlay')
    ) {
      canvasStore.selectElement(null);
    }
  }

  function handleWindowBlur(): void {
    stopAutoScroll();
    isSpaceDown = false;
    isPanning = false;
    isPointerOverViewport = false;
    activeZoomAnchor = null;
  }


  let scrollRafId: number | null = null;
  let isCentering = false;
  let isZoomTransitioning = false;
  let cachedVerticalOffsets: PageVerticalOffset[] | null = null;
  let cachedOffsetsTargetZoom: number | null = null;
  let cachedFirstPageOffsetTop: number | null = null;

  let lastPointerViewportX: number | null = null;
  let lastPointerViewportY: number | null = null;
  let isPointerOverViewport = false;

  function handleViewportPointerEnter(e: PointerEvent): void {
    if (!viewportEl) return;
    isPointerOverViewport = true;
    const rect = viewportEl.getBoundingClientRect();
    lastPointerViewportX = e.clientX - rect.left;
    lastPointerViewportY = e.clientY - rect.top;
  }

  function handleViewportPointerLeave(): void {
    isPointerOverViewport = false;
  }

  function handleViewportPointerMove(e: PointerEvent): void {
    if (!viewportEl) return;
    isPointerOverViewport = true;
    const rect = viewportEl.getBoundingClientRect();
    lastPointerViewportX = e.clientX - rect.left;
    lastPointerViewportY = e.clientY - rect.top;
  }

  function invalidatePageOffsetsCache(): void {
    cachedVerticalOffsets = null;
    cachedOffsetsTargetZoom = null;
    cachedFirstPageOffsetTop = null;
  }

  let visiblePageRange = $state<{ min: number; max: number }>({ min: 0, max: 2 });
  const VIRTUAL_OVERSCAN = 2;

  function updateVisiblePageRange(explicitScrollTop?: number, explicitClientHeight?: number): void {
    if (!viewportEl || !store.isDocumentLoaded || store.pageCount === 0) return;
    if (!featureFlags.isEnabled('performance.virtual-rendering') || store.pageCount <= 10) {
      const targetMax = store.pageCount - 1;
      const curMin = untrack(() => visiblePageRange.min);
      const curMax = untrack(() => visiblePageRange.max);
      if (curMin !== 0 || curMax !== targetMax) {
        visiblePageRange = { min: 0, max: targetMax };
      }
      return;
    }

    const scrollTop = explicitScrollTop !== undefined ? explicitScrollTop : viewportEl.scrollTop;
    const clientHeight = explicitClientHeight !== undefined ? explicitClientHeight : viewportEl.clientHeight;
    if (clientHeight <= 0) {
      const cur = store.currentPageIndex;
      const newMin = Math.max(0, cur - VIRTUAL_OVERSCAN);
      const newMax = Math.min(store.pageCount - 1, cur + VIRTUAL_OVERSCAN);
      const curMin = untrack(() => visiblePageRange.min);
      const curMax = untrack(() => visiblePageRange.max);
      if (newMin !== curMin || newMax !== curMax) {
        visiblePageRange = { min: newMin, max: newMax };
      }
      return;
    }

    const minIdx = resolvePageIndexAtScrollY(scrollTop);
    const maxIdx = resolvePageIndexAtScrollY(scrollTop + clientHeight);

    const newMin = Math.max(0, Math.min(minIdx, maxIdx) - VIRTUAL_OVERSCAN);
    const newMax = Math.min(store.pageCount - 1, Math.max(minIdx, maxIdx) + VIRTUAL_OVERSCAN);

    const curMin = untrack(() => visiblePageRange.min);
    const curMax = untrack(() => visiblePageRange.max);
    if (newMin !== curMin || newMax !== curMax) {
      visiblePageRange = { min: newMin, max: newMax };
    }
  }

  function shouldMountPage(pageIdx: number): boolean {
    if (!featureFlags.isEnabled('performance.virtual-rendering') || store.pageCount <= 10) {
      return true;
    }

    if (store.currentPageIndex === pageIdx) {
      return true;
    }

    if (activeZoomAnchor && activeZoomAnchor.pageIndex === pageIdx) {
      return true;
    }

    if (store.activeCrop?.pageIndex === pageIdx) {
      return true;
    }
    if (store.inlineEdit?.span.pageIndex === pageIdx) {
      return true;
    }
    if (store.selectedSpan?.pageIndex === pageIdx) {
      return true;
    }

    if (canvasStore.activeDropPageIndex === pageIdx) {
      return true;
    }
    if (canvasStore.dragState) {
      const draggedEl = canvasStore.elements.find(el => el.id === canvasStore.dragState?.elementId);
      if (draggedEl && draggedEl.pageIndex === pageIdx) {
        return true;
      }
    }

    const visualSlot = store.getVisualPageIndex(pageIdx);
    return visualSlot >= visiblePageRange.min && visualSlot <= visiblePageRange.max;
  }

  // Spacer-based DOM virtualisation: compute heights for placeholder spacer divs
  // that replace unmounted pages above and below the visible window

  function computeTopSpacerHeight(): number {
    if (visiblePageRange.min <= 0) return 0;
    const offsets = getPageVerticalOffsets();
    if (offsets.length === 0) return 0;
    const firstVisibleOffset = offsets[visiblePageRange.min];
    if (!firstVisibleOffset) return 0;
    return firstVisibleOffset.top - offsets[0].top;
  }

  function computeBottomSpacerHeight(): number {
    const pageCount = store.pageCount;
    if (visiblePageRange.max >= pageCount - 1) return 0;
    const offsets = getPageVerticalOffsets();
    if (offsets.length === 0) return 0;
    const lastVisibleOffset = offsets[visiblePageRange.max];
    const lastPageOffset = offsets[pageCount - 1];
    if (!lastVisibleOffset || !lastPageOffset) return 0;
    return lastPageOffset.bottom - lastVisibleOffset.bottom;
  }

  let topSpacerHeight = $derived(computeTopSpacerHeight());
  let bottomSpacerHeight = $derived(computeBottomSpacerHeight());

  // Windowed page indices: only these pages produce DOM nodes inside the content container
  let windowedPageIndices = $derived.by(() => {
    const useWindowing = featureFlags.isEnabled('performance.virtual-rendering') && store.pageCount > 10;
    if (!useWindowing) {
      return store.effectivePageOrder;
    }
    const min = visiblePageRange.min;
    const max = visiblePageRange.max;
    const count = max - min + 1;
    const indices: number[] = new Array(count);
    for (let i = 0; i < count; i++) {
      indices[i] = store.getEffectivePageIndex(min + i);
    }
    return indices;
  });

  function getPageVerticalOffsets(targetZoom: number = store.zoom): PageVerticalOffset[] {
    if (cachedVerticalOffsets && cachedOffsetsTargetZoom === targetZoom) return cachedVerticalOffsets;
    if (!viewportEl || store.pageCount === 0) return [];

    let currentY: number = cachedFirstPageOffsetTop !== null ? cachedFirstPageOffsetTop : 0;
    if (cachedFirstPageOffsetTop === null) {
      // Arithmetic computation of the content container's 20vh top padding
      // mirrors py-[20vh] on the content wrapper without requiring page 0 in the DOM
      currentY = Math.round(viewportEl.clientHeight * 0.2);
      cachedFirstPageOffsetTop = currentY;
    }

    const pageCount = store.pageCount;
    if (featureFlags.isEnabled('performance.fast-dimensions') && pageCount > 50) {
      const hasCustomTransforms = Boolean(
        store.pageTransforms && Object.keys(store.pageTransforms).length > 0
      );
      if (!hasCustomTransforms && !store.optimisticPageOrder) {
        const firstDims = actions.service.document?.getPageDimensions(0) ?? { widthPts: 612, heightPts: 792 };
        const midDims = actions.service.document?.getPageDimensions(Math.floor(pageCount / 2)) ?? firstDims;
        const lastDims = actions.service.document?.getPageDimensions(pageCount - 1) ?? firstDims;
        const isUniform =
          firstDims.widthPts === midDims.widthPts &&
          firstDims.heightPts === midDims.heightPts &&
          firstDims.widthPts === lastDims.widthPts &&
          firstDims.heightPts === lastDims.heightPts;

        if (isUniform) {
          const firstLayout = getPageLayoutAtZoom(0, targetZoom);
          const offsets: PageVerticalOffset[] = new Array(pageCount);
          let currentTop = currentY;
          const height = firstLayout.height;
          const spacing = firstLayout.spacing;

          for (let i = 0; i < pageCount; i++) {
            const top = currentTop;
            const bottom = top + height;
            const isLast = i === pageCount - 1;
            const s = isLast ? 0 : spacing;
            const threshold = isLast ? bottom : bottom + s / 2;

            offsets[i] = {
              pageIndex: i,
              top,
              bottom,
              threshold,
            };

            currentTop = bottom + s;
          }
          cachedVerticalOffsets = offsets;
          cachedOffsetsTargetZoom = targetZoom;
          return offsets;
        }
      }
    }

    const layouts: PageLayoutDimensions[] = [];
    for (let i = 0; i < pageCount; i++) {
      layouts.push(getPageLayoutAtZoom(store.getEffectivePageIndex(i), targetZoom));
    }

    const offsets = computePageVerticalOffsets(layouts, currentY);
    cachedVerticalOffsets = offsets;
    cachedOffsetsTargetZoom = targetZoom;
    return offsets;
  }

  function resolvePageIndexAtScrollY(targetScrollY: number): number {
    if (!viewportEl || store.pageCount <= 1) return 0;
    const offsets = getPageVerticalOffsets();
    return resolvePageIndexFromOffsets(targetScrollY, offsets);
  }

  function computeCurrentPage(): void {
    if (!viewportEl || !store.isDocumentLoaded || store.pageCount === 0 || store.showOrganizerView || isCentering || store.isZooming || isZoomTransitioning) return;

    const viewportCenterScrollY = viewportEl.scrollTop + viewportEl.clientHeight / 2;
    const resolvedSlot = resolvePageIndexAtScrollY(viewportCenterScrollY);
    const resolvedIndex = store.getEffectivePageIndex(resolvedSlot);

    if (resolvedIndex !== store.currentPageIndex) {
      actions.setCurrentPageFromScroll(resolvedIndex);
    }
  }

  interface ActiveZoomAnchor {
    pageIndex: number;
    normX: number;
    normY: number;
    viewportX: number;
    viewportY: number;
    isCursorAnchor?: boolean;
  }

  let activeZoomAnchor: ActiveZoomAnchor | null = null;
  let zoomAnchorResetTimer: ReturnType<typeof setTimeout> | null = null;

  function getPageLayoutAtZoom(pageIdx: number, targetZoom: number): PageLayoutDimensions {
    const dims = actions.service.document?.getPageDimensions(pageIdx) ?? { widthPts: 612, heightPts: 792 };
    const pageTransform = store.getPageTransform(pageIdx);
    const effectiveRotation = store.getEffectivePageRotation(pageIdx);
    return calculatePageLayoutDimensions({
      widthPts: dims.widthPts,
      heightPts: dims.heightPts,
      zoom: targetZoom,
      pageTransform: {
        ...pageTransform,
        rotation: effectiveRotation,
      },
      isLastPage: pageIdx === store.pageCount - 1,
    });
  }

  function getPageTopOffsetAtZoom(pageIndex: number, targetZoom: number): number {
    if (!viewportEl) return 0;
    const initialTop = Math.round(viewportEl.clientHeight * 0.2);
    const visualSlot = store.getVisualPageIndex(pageIndex);
    if (visualSlot <= 0) return initialTop;

    const offsets = getPageVerticalOffsets(targetZoom);
    if (offsets && offsets[visualSlot]) {
      return offsets[visualSlot].top;
    }

    const pageCount = store.pageCount;
    const firstLayout = getPageLayoutAtZoom(0, targetZoom);
    if (featureFlags.isEnabled('performance.fast-dimensions') && pageCount > 50) {
      const hasCustomTransforms = Boolean(
        store.pageTransforms && Object.keys(store.pageTransforms).length > 0
      );
      if (!hasCustomTransforms && !store.optimisticPageOrder) {
        const firstDims = actions.service.document?.getPageDimensions(0) ?? { widthPts: 612, heightPts: 792 };
        const midDims = actions.service.document?.getPageDimensions(Math.floor(pageCount / 2)) ?? firstDims;
        const lastDims = actions.service.document?.getPageDimensions(pageCount - 1) ?? firstDims;
        const isUniform =
          firstDims.widthPts === midDims.widthPts &&
          firstDims.heightPts === midDims.heightPts &&
          firstDims.widthPts === lastDims.widthPts &&
          firstDims.heightPts === lastDims.heightPts;

        if (isUniform) {
          return initialTop + visualSlot * (firstLayout.height + firstLayout.spacing);
        }
      }
    }

    let top = initialTop;
    for (let slot = 0; slot < visualSlot; slot++) {
      const pIdx = store.getEffectivePageIndex(slot);
      const layout = getPageLayoutAtZoom(pIdx, targetZoom);
      top += layout.height + layout.spacing;
    }
    return top;
  }

  function captureActiveZoomAnchor(preferredViewportX?: number, preferredViewportY?: number, atZoom: number = store.zoom): ActiveZoomAnchor {
    if (!viewportEl) {
      return {
        pageIndex: store.currentPageIndex,
        normX: 0.5,
        normY: 0.5,
        viewportX: 0,
        viewportY: 0,
        isCursorAnchor: false,
      };
    }
    const viewportRect = viewportEl.getBoundingClientRect();
    const visibleContainer = (document.querySelector('.editor-shell-canvas') as HTMLElement | null) ?? viewportEl;
    const visibleRect = visibleContainer.getBoundingClientRect();

    const cursorViewportX = (isPointerOverViewport && lastPointerViewportX !== null)
      ? lastPointerViewportX
      : undefined;
    const cursorViewportY = (isPointerOverViewport && lastPointerViewportY !== null)
      ? lastPointerViewportY
      : undefined;

    const resolvedPreferredX = preferredViewportX !== undefined ? preferredViewportX : cursorViewportX;
    const resolvedPreferredY = preferredViewportY !== undefined ? preferredViewportY : cursorViewportY;
    const isCursorAnchor = resolvedPreferredX !== undefined && resolvedPreferredY !== undefined;

    const anchorViewportX = resolvedPreferredX !== undefined
      ? Math.max(0, Math.min(viewportRect.width, resolvedPreferredX))
      : (visibleRect.left + visibleRect.width / 2) - viewportRect.left;

    const anchorViewportY = resolvedPreferredY !== undefined
      ? Math.max(0, Math.min(viewportRect.height, resolvedPreferredY))
      : (visibleRect.top + visibleRect.height / 2) - viewportRect.top;

    const currentScrollY = viewportEl.scrollTop + anchorViewportY;
    const offsets = getPageVerticalOffsets(atZoom);
    const firstPageTop = offsets[0]?.top ?? Math.round(viewportEl.clientHeight * 0.2);

    let visualSlot = 0;
    let normY = 0.5;

    if (offsets.length > 0) {
      if (currentScrollY < firstPageTop) {
        visualSlot = 0;
        const firstPageH = (offsets[0]?.bottom ?? 0) - (offsets[0]?.top ?? 0);
        normY = firstPageH > 0 ? (currentScrollY - firstPageTop) / firstPageH : 0;
      } else {
        visualSlot = resolvePageIndexFromOffsets(currentScrollY, offsets);
        const pageOffset = offsets[visualSlot];
        if (pageOffset) {
          const pageH = pageOffset.bottom - pageOffset.top;
          normY = pageH > 0 ? (currentScrollY - pageOffset.top) / pageH : 0.5;
        }
      }
    }

    const pageIndex = store.getEffectivePageIndex(visualSlot);
    const layout = getPageLayoutAtZoom(pageIndex, atZoom);
    const paddingLeft = typeof window !== 'undefined'
      ? Math.round(window.innerWidth * 0.5)
      : Math.round(viewportEl.clientWidth / 2);
    const contentWidth = paddingLeft * 2 + layout.width;
    const pageLeft = Math.max(0, (contentWidth - layout.width) / 2);
    const currentScrollX = viewportEl.scrollLeft + anchorViewportX;
    const normX = layout.width > 0 ? (currentScrollX - pageLeft) / layout.width : 0.5;

    return {
      pageIndex,
      normX,
      normY,
      viewportX: anchorViewportX,
      viewportY: anchorViewportY,
      isCursorAnchor,
    };
  }

  function applyDiscreteZoomScroll(prevZoom: number, newZoom: number): void {
    if (!viewportEl || !store.isDocumentLoaded || store.pageCount === 0 || store.showOrganizerView) return;
    if (zoomAnchorResetTimer) {
      clearTimeout(zoomAnchorResetTimer);
      zoomAnchorResetTimer = null;
    }
    const viewportRect = viewportEl.getBoundingClientRect();
    const visibleContainer = (document.querySelector('.editor-shell-canvas') as HTMLElement | null) ?? viewportEl;
    const visibleRect = visibleContainer.getBoundingClientRect();
    const viewportClientHeight = viewportEl.clientHeight;

    const anchor = captureActiveZoomAnchor(undefined, undefined, prevZoom);
    activeZoomAnchor = anchor;
    const targetPageIndex = anchor.pageIndex;
    const visibleWidth = visibleContainer.clientWidth || viewportEl.clientWidth;
    const visibleOffsetX = Math.max(0, visibleRect.left - viewportRect.left);

    const paddingLeft = typeof window !== 'undefined'
      ? Math.round(window.innerWidth * 0.5)
      : Math.round(viewportEl.clientWidth / 2);

    const newLayout = getPageLayoutAtZoom(targetPageIndex, newZoom);
    const newPageTop = getPageTopOffsetAtZoom(targetPageIndex, newZoom);
    const newContentWidth = paddingLeft * 2 + newLayout.width;

    const calibratedOffsets = calculatePageAnchorZoomScroll({
      anchorViewportX: anchor.viewportX,
      anchorViewportY: anchor.viewportY,
      normX: anchor.normX,
      normY: anchor.normY,
      newPageTop,
      newPageLeft: Math.max(0, (newContentWidth - newLayout.width) / 2),
      newPageWidth: newLayout.width,
      newPageHeight: newLayout.height,
      visibleWidth,
      contentWidth: newContentWidth,
      visibleOffsetX,
      anchorToCursor: anchor.isCursorAnchor ?? false,
    });

    if (cachedOffsetsTargetZoom !== newZoom) {
      invalidatePageOffsetsCache();
    }
    isZoomTransitioning = true;
    try {
      flushSync(() => {
        // Synchronously flush layout updates before scroll assignment
      });

      viewportEl.scrollLeft = calibratedOffsets.scrollLeft;
      viewportEl.scrollTop = calibratedOffsets.scrollTop;
    } finally {
      isZoomTransitioning = false;
      activeZoomAnchor = null;
    }

    updateVisiblePageRange(calibratedOffsets.scrollTop, viewportClientHeight);
  }

  function handleScroll(): void {
    cachedDropPageMetrics = null;
    if (!viewportEl || !store.isDocumentLoaded || store.pageCount === 0 || store.showOrganizerView || isCentering || store.isZooming || isZoomTransitioning) return;
    activeZoomAnchor = null;
    if (scrollRafId !== null) return;

    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      computeCurrentPage();
      updateVisiblePageRange();
    });
  }

  function centerPage(pageIndex: number = 0, behavior: ScrollBehavior = 'instant', options?: ScrollTargetOptions): void {
    if (!viewportEl || !contentEl || !store.isDocumentLoaded || store.pageCount === 0 || canvasStore.dragState) return;
    if (pageIndex < 0 || pageIndex >= store.pageCount) return;

    // Find the visible canvas opening between LeftPanel and RightPanel.
    // Falls back to viewportEl if .editor-shell-canvas is not present (e.g. in headless tests).
    const visibleContainer = (document.querySelector('.editor-shell-canvas') as HTMLElement | null) ?? viewportEl;

    const pageEl = viewportEl.querySelector(`[data-page-index="${pageIndex}"]`) as HTMLElement | null;
    const pageRect = pageEl?.getBoundingClientRect();
    const visibleRect = visibleContainer.getBoundingClientRect();
    const viewportRect = viewportEl.getBoundingClientRect();

    let targetScrollLeft: number;
    let targetScrollTop: number;

    // When elements have valid rendered dimensions, compute exact screen-space centering.
    if (pageEl && pageRect && pageRect.width > 0 && visibleRect.width > 0 && pageRect.height > 0 && viewportRect.height > 0) {
      const currentScrollLeft = viewportEl.scrollLeft;
      const currentScrollTop = viewportEl.scrollTop;

      const pageCenterX = pageRect.left + pageRect.width / 2;
      const visibleCenterX = visibleRect.left + visibleRect.width / 2;
      const deltaX = pageCenterX - visibleCenterX;
      targetScrollLeft = Math.max(0, currentScrollLeft + deltaX);

      // Determine target vertical position on screen if specified
      let targetScreenY: number | null = null;
      if (options?.targetTop !== undefined) {
        let unscaledH = 792;
        try {
          unscaledH = actions.service.document.getPageDimensions(pageIndex).heightPts || 792;
        } catch {}
        const scaleFactor = pageRect.height / unscaledH;
        targetScreenY = pageRect.top + options.targetTop * scaleFactor;
      } else if (options?.destY !== undefined) {
        let unscaledH = 792;
        try {
          unscaledH = actions.service.document.getPageDimensions(pageIndex).heightPts || 792;
        } catch {}
        const scaleFactor = pageRect.height / unscaledH;
        const targetTop = Math.max(0, unscaledH - options.destY);
        targetScreenY = pageRect.top + targetTop * scaleFactor;
      }

      const visibleCenterY = viewportRect.top + viewportRect.height / 2;
      if (targetScreenY !== null) {
        const deltaY = targetScreenY - visibleCenterY;
        targetScrollTop = Math.max(0, currentScrollTop + deltaY);
      } else if (pageRect.height <= viewportRect.height) {
        const pageCenterY = pageRect.top + pageRect.height / 2;
        const deltaY = pageCenterY - visibleCenterY;
        targetScrollTop = Math.max(0, currentScrollTop + deltaY);
      } else {
        const deltaY = pageRect.top - (viewportRect.top + 24);
        targetScrollTop = Math.max(0, currentScrollTop + deltaY);
      }
    } else {
      // Fallback for unmounted (virtualised) pages or headless environments without DOM layout boxes
      const visualSlot = store.getVisualPageIndex(pageIndex);
      const offsets = getPageVerticalOffsets();
      const pageOffset = offsets[visualSlot];
      const layout = getPageLayout(pageIndex);
      const pageWidth = pageEl?.offsetWidth || layout.width;
      const pageHeight = pageEl?.offsetHeight || (pageOffset ? (pageOffset.bottom - pageOffset.top) : layout.height);
      const pageOffsetTop = pageEl?.offsetTop || (pageOffset ? pageOffset.top : 0);
      // Reuse existing viewportRect from outer function scope
      const visibleOffsetX = visibleRect.width > 0 && viewportRect.width > 0
        ? Math.max(0, visibleRect.left - viewportRect.left)
        : 0;
      const visibleOffsetY = visibleRect.height > 0 && viewportRect.height > 0
        ? Math.max(0, visibleRect.top - viewportRect.top)
        : 0;

      const pageOffsetLeft = pageEl?.offsetLeft || Math.max(0, (contentEl.scrollWidth - pageWidth) / 2);

      const scrollOffsets = calculatePageCenteringScroll({
        viewportWidth: viewportEl.clientWidth,
        viewportHeight: viewportEl.clientHeight,
        contentWidth: contentEl.scrollWidth,
        pageOffsetLeft,
        pageOffsetTop,
        pageWidth,
        pageHeight,
        visibleOffsetX,
        visibleWidth: visibleContainer.clientWidth || viewportEl.clientWidth,
        visibleOffsetY,
        visibleHeight: visibleContainer.clientHeight || viewportEl.clientHeight,
      });
      targetScrollLeft = scrollOffsets.scrollLeft;
      targetScrollTop = scrollOffsets.scrollTop;

      if (options?.targetTop !== undefined || options?.destY !== undefined) {
        let unscaledH = 792;
        try {
          unscaledH = actions.service.document.getPageDimensions(pageIndex).heightPts || 792;
        } catch {}
        const scaleFactor = pageHeight / unscaledH;
        const targetPt = options.targetTop !== undefined
          ? options.targetTop
          : Math.max(0, unscaledH - (options.destY ?? 0));
        const targetPixelY = pageOffsetTop + targetPt * scaleFactor;
        const visibleH = visibleContainer.clientHeight || viewportEl.clientHeight;
        const targetCenterY = visibleOffsetY + visibleH / 2;
        targetScrollTop = Math.max(0, targetPixelY - targetCenterY);
      }
    }

    const isPageUnmounted = !pageEl || !pageRect || pageRect.width === 0 || pageRect.height === 0;
    const effectiveBehavior = options?.behavior ?? (isPageUnmounted ? 'instant' : behavior);

    isCentering = true;
    viewportEl.scrollTo({
      left: Math.round(targetScrollLeft),
      top: Math.round(targetScrollTop),
      behavior: effectiveBehavior,
    });

    if (effectiveBehavior === 'instant' && viewportEl.scrollTop !== Math.round(targetScrollTop)) {
      viewportEl.scrollTop = Math.round(targetScrollTop);
      viewportEl.scrollLeft = Math.round(targetScrollLeft);
    }

    updateVisiblePageRange();

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        isCentering = false;
        updateVisiblePageRange();
      });
    } else {
      isCentering = false;
    }
  }

  /**
   * Captures the visual screen centre of a target page before layout changes,
   * returning a restoration closure to calibrate viewport scroll offsets after DOM updates.
   */
  function capturePageVisualCenter(pageIndex: number): (() => void) | null {
    if (!viewportEl || !contentEl) return null;
    const pageEl = viewportEl.querySelector(`[data-page-index="${pageIndex}"]`) as HTMLElement | null;
    if (!pageEl) return null;

    const rectBefore = pageEl.getBoundingClientRect();
    if (rectBefore.width <= 0 || rectBefore.height <= 0) return null;

    const centerBeforeX = rectBefore.left + rectBefore.width / 2;
    const centerBeforeY = rectBefore.top + rectBefore.height / 2;

    return () => {
      if (!viewportEl) return;
      const newRect = pageEl.getBoundingClientRect();
      if (newRect.width <= 0 || newRect.height <= 0) return;

      const centerAfterX = newRect.left + newRect.width / 2;
      const centerAfterY = newRect.top + newRect.height / 2;

      const scrollPos = calculateCenterPreservingScroll({
        currentScrollLeft: viewportEl.scrollLeft,
        currentScrollTop: viewportEl.scrollTop,
        preRotationCenter: { x: centerBeforeX, y: centerBeforeY },
        postRotationCenter: { x: centerAfterX, y: centerAfterY },
      });

      if (scrollPos.scrollLeft !== viewportEl.scrollLeft || scrollPos.scrollTop !== viewportEl.scrollTop) {
        isCentering = true;
        viewportEl.scrollLeft = scrollPos.scrollLeft;
        viewportEl.scrollTop = scrollPos.scrollTop;
        requestAnimationFrame(() => {
          isCentering = false;
        });
      }
    };
  }

  $effect(() => {
    actions.registerScrollCallback((idx, scrollOptions) => {
      centerPage(idx, scrollOptions?.behavior ?? 'smooth', scrollOptions);
    });
    actions.registerPageCenterPreserver((idx) => capturePageVisualCenter(idx));
    actions.registerZoomChangeCallback((prevZoom, newZoom) => {
      applyDiscreteZoomScroll(prevZoom, newZoom);
    });
    return () => {
      actions.registerScrollCallback(() => {});
      actions.registerPageCenterPreserver(() => null);
      actions.registerZoomChangeCallback(null);
    };
  });

  let lastCenteredDocKey = $state<string | null>(null);

  $effect(() => {
    if (!store.isDocumentLoaded || !viewportEl || store.showOrganizerView || store.pageCount === 0) {
      return;
    }

    const docKey = `${store.activeWorkspaceFileId ?? store.fileName}`;
    if (lastCenteredDocKey !== docKey) {
      lastCenteredDocKey = docKey;
      if (canvasStore.dragState || store.inlineEdit || canvasStore.editingElementId) return;
      void tick().then(() => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => {
            if (!canvasStore.dragState && !store.inlineEdit && !canvasStore.editingElementId) {
              centerPage(store.currentPageIndex, 'instant');
            }
          });
        } else {
          if (!canvasStore.dragState && !store.inlineEdit && !canvasStore.editingElementId) {
            centerPage(store.currentPageIndex, 'instant');
          }
        }
      });
    }
  });

  let contentEl: HTMLElement | null = $state(null);

  $effect(() => {
    if (!viewportEl) return;

    const visibleContainer = (document.querySelector('.editor-shell-canvas') as HTMLElement | null) ?? viewportEl;

    const observer = new ResizeObserver(() => {
      if (!isCentering && !canvasStore.dragState && store.isDocumentLoaded && store.pageCount > 0 && !store.showOrganizerView && !store.isZooming) {
        centerPage(store.currentPageIndex, 'instant');
      }
    });

    observer.observe(visibleContainer);

    return () => {
      observer.disconnect();
      if (wheelRafId !== null) {
        cancelAnimationFrame(wheelRafId);
        wheelRafId = null;
      }
      if (scrollRafId !== null) {
        cancelAnimationFrame(scrollRafId);
        scrollRafId = null;
      }
      if (zoomAnchorResetTimer) {
        clearTimeout(zoomAnchorResetTimer);
        zoomAnchorResetTimer = null;
      }
    };
  });

  $effect(() => {
    void store.currentPageIndex;
    if (!canvasStore.dragState) {
      cachedDropPageMetrics = null;
      cachedTargetPageIndex = null;
      cachedTargetLayerEl = null;
      canvasActions.clearInteractionCache();
    }
    untrack(() => updateVisiblePageRange());
  });

  $effect(() => {
    void store.zoom;
    void store.pageCount;
    void store.renderVersion;
    void store.optimisticRotations;
    void store.effectivePageOrder;
    cachedDropPageMetrics = null;
    cachedTargetPageIndex = null;
    cachedTargetLayerEl = null;
    canvasActions.clearInteractionCache();
    invalidatePageOffsetsCache();
    if (!isZoomTransitioning) {
      untrack(() => updateVisiblePageRange());
    }
  });


  function handleWindowResize(): void {
    activeZoomAnchor = null;
    cachedDropPageMetrics = null;
    cachedTargetPageIndex = null;
    cachedTargetLayerEl = null;
    canvasActions.clearInteractionCache();
    invalidatePageOffsetsCache();
    updateVisiblePageRange();
    if (!store.isDocumentLoaded || !viewportEl || store.pageCount === 0 || store.showOrganizerView || canvasStore.dragState || store.isZooming) return;
    centerPage(store.currentPageIndex, 'instant');
  }

  let wheelRafId: number | null = null;
  let pendingWheelDy = 0;
  let lastWheelEvent: WheelEvent | null = null;

  /**
   * Handles wheel zoom gestures using calibrated smooth zoom scaling,
   * zero-reflow focal point scroll offset calculation, and continuous
   * anchor tracking preventing scroll drift across zoom transitions.
   */
  function handleWheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (!viewportEl || !store.isDocumentLoaded || store.pageCount === 0) return;

      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 33;
      else if (e.deltaMode === 2) dy *= 100;

      pendingWheelDy += dy;
      lastWheelEvent = e;

      if (wheelRafId !== null) return;

      wheelRafId = requestAnimationFrame(() => {
        wheelRafId = null;
        if (!lastWheelEvent || !viewportEl) return;

        const dyToApply = pendingWheelDy;
        pendingWheelDy = 0;
        const targetEvent = lastWheelEvent;
        lastWheelEvent = null;

        const currentZoom = store.zoom;

        // Device-adaptive sensitivity: trackpads emit continuous fine deltas (< 40px or fractional) with ctrlKey,
        // while discrete mouse wheels emit notch deltas (typically >= 50px integer).
        const isTrackpadPinch = Boolean(targetEvent.ctrlKey && (!Number.isInteger(targetEvent.deltaY) || Math.abs(dyToApply) < 40));
        const sensitivityDivisor = isTrackpadPinch ? 180 : 420;
        const zoomFactor = Math.max(0.70, Math.min(1.45, calculateSmoothZoomFactor(dyToApply, sensitivityDivisor)));
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, currentZoom * zoomFactor));

        if (newZoom === currentZoom) return;

        // Batched layout read phase: query all geometric bounds up-front to eliminate interleaved layout thrashing
        const viewportRect = viewportEl.getBoundingClientRect();
        const viewportClientWidth = viewportEl.clientWidth;
        const viewportClientHeight = viewportEl.clientHeight;
        const viewportScrollLeft = viewportEl.scrollLeft;
        const viewportScrollTop = viewportEl.scrollTop;

        const visibleContainer = (document.querySelector('.editor-shell-canvas') as HTMLElement | null) ?? viewportEl;
        const visibleRect = visibleContainer.getBoundingClientRect();
        const visibleWidth = visibleContainer.clientWidth || viewportClientWidth;
        const visibleOffsetX = Math.max(0, visibleRect.left - viewportRect.left);

        const pointerViewportX = targetEvent.clientX - viewportRect.left;
        const pointerViewportY = targetEvent.clientY - viewportRect.top;

        const paddingLeft = typeof window !== 'undefined'
          ? Math.round(window.innerWidth * 0.5)
          : Math.round(viewportClientWidth / 2);
        const paddingTop = typeof window !== 'undefined'
          ? Math.round(window.innerHeight * 0.2)
          : Math.round(viewportClientHeight * 0.2);

        if (!activeZoomAnchor) {
          activeZoomAnchor = captureActiveZoomAnchor(pointerViewportX, pointerViewportY, currentZoom);
        } else {
          const dist = Math.hypot(
            pointerViewportX - activeZoomAnchor.viewportX,
            pointerViewportY - activeZoomAnchor.viewportY
          );
          if (dist > 8) {
            activeZoomAnchor = captureActiveZoomAnchor(pointerViewportX, pointerViewportY, currentZoom);
          }
        }

        if (zoomAnchorResetTimer) clearTimeout(zoomAnchorResetTimer);
        zoomAnchorResetTimer = setTimeout(() => {
          activeZoomAnchor = null;
          zoomAnchorResetTimer = null;
        }, 250);

        // Computation phase: pure geometric arithmetic without DOM mutations or forced reflows
        const newLayout = getPageLayoutAtZoom(activeZoomAnchor.pageIndex, newZoom);
        const newPageTop = getPageTopOffsetAtZoom(activeZoomAnchor.pageIndex, newZoom);
        const newContentWidth = paddingLeft * 2 + newLayout.width;

        const calibratedOffsets = calculatePageAnchorZoomScroll({
          anchorViewportX: activeZoomAnchor.viewportX,
          anchorViewportY: activeZoomAnchor.viewportY,
          normX: activeZoomAnchor.normX,
          normY: activeZoomAnchor.normY,
          newPageTop,
          newPageLeft: Math.max(0, (newContentWidth - newLayout.width) / 2),
          newPageWidth: newLayout.width,
          newPageHeight: newLayout.height,
          visibleWidth,
          contentWidth: newContentWidth,
          visibleOffsetX,
          anchorToCursor: true,
        });

        calculateZoomScrollOffsets({
          currentZoom,
          newZoom,
          scrollLeft: viewportScrollLeft,
          scrollTop: viewportScrollTop,
          pointerViewportX,
          pointerViewportY,
          paddingLeft,
          paddingTop,
        });

        // Retain precalculated newZoom offsets if already computed, avoiding redundant 200-page passes
        if (cachedOffsetsTargetZoom !== newZoom) {
          invalidatePageOffsetsCache();
        }

        // Batched write phase: apply store mutation, DOM transforms, and scroll coordinates in single pass
        isZoomTransitioning = true;
        try {
          flushSync(() => {
            actions.setZoom(newZoom, true);
          });

          viewportEl.scrollLeft = calibratedOffsets.scrollLeft;
          viewportEl.scrollTop = calibratedOffsets.scrollTop;
        } finally {
          isZoomTransitioning = false;
        }

        updateVisiblePageRange(calibratedOffsets.scrollTop, viewportClientHeight);
      });
    } else if (store.isZooming) {
      e.preventDefault();
    }
  }

  function cancelDropRaf(): void {
    if (dropRafId !== null) {
      cancelAnimationFrame(dropRafId);
      dropRafId = null;
    }
  }

  function resolveDropTargetPage(
    target: HTMLElement | null
  ): { pageIndex: number; pageEl: HTMLElement } | null {
    if (!viewportEl) return null;

    // Direct ancestor resolution via event target without forced layout reflow
    const pageWrapper = (target?.closest('[data-page-index]') ?? null) as HTMLElement | null;
    if (pageWrapper) {
      const pageIndexAttr = pageWrapper.getAttribute('data-page-index');
      if (pageIndexAttr !== null) {
        const pageIndex = parseInt(pageIndexAttr, 10);
        if (!isNaN(pageIndex)) {
          const pageEl = (pageWrapper.querySelector('[data-page-element]') ?? pageWrapper) as HTMLElement;
          return { pageIndex, pageEl };
        }
      }
    }

    return null;
  }

  function computeDropPreview(clientX: number, clientY: number, target: HTMLElement | null): void {
    const payload = canvasStore.activeDropPayload;
    if (!payload) {
      canvasStore.clearDropState();
      cachedDropPageMetrics = null;
      return;
    }

    const resolved = resolveDropTargetPage(target);
    if (!resolved) {
      canvasStore.dropPreview = null;
      canvasStore.activeDropPageIndex = null;
      return;
    }

    const { pageIndex, pageEl } = resolved;

    // Zero-DOM-reflow arithmetic conversion using cached page metrics
    if (!cachedDropPageMetrics || cachedDropPageMetrics.pageIndex !== pageIndex || cachedDropPageMetrics.pageEl !== pageEl) {
      const pdfSpans = actions.service.document?.getCachedPageSpans(pageIndex);
      cachedDropPageMetrics = {
        pageIndex,
        pageEl,
        metrics: capturePageMetrics(pageEl),
        snapCandidates: extractSnapCandidates(
          pageIndex,
          canvasStore.getElementsByPage(pageIndex),
          undefined,
          pdfSpans,
          store.hiddenSpanIds,
        ),
      };
    }

    const pt = {
      ...store.getPageTransform(pageIndex),
      rotation: store.getEffectivePageRotation(pageIndex),
    };
    const coords = screenToPageCoordsWithMetrics(clientX, clientY, cachedDropPageMetrics.metrics, store.zoom, pt);

    // Fast zero-WASM page dimensions resolution
    const dims = actions.service.document?.getPageDimensions(pageIndex);
    const maxW = dims?.widthPts ?? (cachedDropPageMetrics.metrics.rect.width / store.zoom);
    const maxH = dims?.heightPts ?? (cachedDropPageMetrics.metrics.rect.height / store.zoom);

    // Outlines should not appear until the element being dragged is on the page
    if (coords.x < 0 || coords.x > maxW || coords.y < 0 || coords.y > maxH) {
      canvasStore.dropPreview = null;
      canvasStore.activeDropPageIndex = null;
      return;
    }

    canvasStore.activeDropPageIndex = pageIndex;

    const defaultDims = ELEMENT_DEFAULTS[payload.kind as BuiltinCanvasElementKind] ?? { width: 150, height: 30 };
    const w = payload.width ?? defaultDims.width;
    const h = payload.height ?? defaultDims.height;

    let previewX = coords.x - w / 2;
    let previewY = coords.y - h / 2;

    const pageDims = { width: maxW, height: maxH };
    const candidates = cachedDropPageMetrics.snapCandidates ?? extractSnapCandidates(
      pageIndex,
      canvasStore.getElementsByPage(pageIndex),
      undefined,
      actions.service.document?.getCachedPageSpans(pageIndex),
      store.hiddenSpanIds,
    );

    const cropMargins = store.activeCrop?.pageIndex === pageIndex
      ? store.activeCrop?.margins
      : undefined;

    const snapResult = computeDragSnap(
      { x: previewX, y: previewY, width: w, height: h },
      candidates,
      pageDims,
      pageIndex,
      store.zoom,
      cropMargins,
    );

    previewX = Math.max(0, Math.min(maxW - w, snapResult.x));
    previewY = Math.max(0, Math.min(maxH - h, snapResult.y));
    canvasStore.activeSnapGuides = snapResult.guides;

    const roundedX = Math.round(previewX);
    const roundedY = Math.round(previewY);
    const current = canvasStore.dropPreview;

    if (
      current &&
      current.pageIndex === pageIndex &&
      current.x === roundedX &&
      current.y === roundedY &&
      current.width === w &&
      current.height === h &&
      current.kind === payload.kind &&
      current.payload === payload
    ) {
      return;
    }

    canvasStore.setDropPreview({
      pageIndex,
      x: roundedX,
      y: roundedY,
      width: w,
      height: h,
      kind: payload.kind,
      label: payload.label ?? payload.text ?? payload.kind,
      payload,
    });
  }

  function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    if (!e.dataTransfer) return;

    const hasElement = e.dataTransfer.types.includes('application/x-canvas-element');
    const hasFile = e.dataTransfer.types.includes('Files');

    if (hasFile && !hasElement) {
      store.isDraggingOver = true;
      canvasStore.dropPreview = null;
      canvasStore.activeDropPageIndex = null;
      return;
    }

    if (hasElement) {
      store.isDraggingOver = false;
      e.dataTransfer.dropEffect = 'copy';

      latestDragClientX = e.clientX;
      latestDragClientY = e.clientY;
      latestDragTarget = e.target as HTMLElement | null;

      if (dropRafId === null) {
        dropRafId = requestAnimationFrame(() => {
          dropRafId = null;
          computeDropPreview(latestDragClientX, latestDragClientY, latestDragTarget);
        });
      }
    }
  }

  function handleDragLeave(e: DragEvent): void {
    e.preventDefault();
    if (!e.relatedTarget || !viewportEl?.contains(e.relatedTarget as Node)) {
      cancelDropRaf();
      store.isDraggingOver = false;
      canvasStore.clearDropState();
      cachedDropPageMetrics = null;
    }
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    cancelDropRaf();
    store.isDraggingOver = false;

    const elementData = e.dataTransfer?.getData('application/x-canvas-element');
    const payload: ElementDropPayload | null = elementData
      ? (() => {
          try {
            return JSON.parse(elementData) as ElementDropPayload;
          } catch {
            return null;
          }
        })()
      : canvasStore.activeDropPayload;

    if (payload) {
      const resolved = resolveDropTargetPage(e.target as HTMLElement | null);
      if (!resolved) {
        canvasStore.clearDropState();
        cachedDropPageMetrics = null;
        return;
      }

      const { pageIndex, pageEl } = resolved;
      const dims = actions.service.document?.getPageDimensions(pageIndex);
      const pt = {
        ...store.getPageTransform(pageIndex),
        rotation: store.getEffectivePageRotation(pageIndex),
      };
      const metrics = capturePageMetrics(pageEl);
      const coords = screenToPageCoordsWithMetrics(e.clientX, e.clientY, metrics, store.zoom, pt);

      const maxW = dims?.widthPts ?? (metrics.rect.width / store.zoom);
      const maxH = dims?.heightPts ?? (metrics.rect.height / store.zoom);

      if (coords.x < 0 || coords.x > maxW || coords.y < 0 || coords.y > maxH) {
        canvasStore.clearDropState();
        cachedDropPageMetrics = null;
        return;
      }

      const defaultDims = ELEMENT_DEFAULTS[payload.kind as BuiltinCanvasElementKind] ?? { width: 150, height: 30 };
      const w = payload.width ?? defaultDims.width;
      const h = payload.height ?? defaultDims.height;

      let dropX = coords.x - w / 2;
      let dropY = coords.y - h / 2;

      if (canvasStore.dropPreview && canvasStore.dropPreview.pageIndex === pageIndex) {
        dropX = canvasStore.dropPreview.x;
        dropY = canvasStore.dropPreview.y;
      } else {
        dropX = Math.max(0, Math.min(maxW - w, dropX));
        dropY = Math.max(0, Math.min(maxH - h, dropY));
      }

      canvasActions.dropElement(payload, pageIndex, Math.round(dropX), Math.round(dropY));
      actions.setCurrentPageFromScroll(pageIndex);
      canvasStore.clearDropState();
      cachedDropPageMetrics = null;
      return;
    }

    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length > 0) {
      if (!store.isDocumentLoaded) {
        if (
          files.length === 1 &&
          (isPdfFile(files[0], files[0].name) || isConvertibleDocumentFile(files[0], files[0].name))
        ) {
          actions.loadDocumentFromFile(files[0]);
        } else {
          actions.mergeAndLoadFiles(files);
        }
      } else if (
        isPdfFile(files[0], files[0].name) || isConvertibleDocumentFile(files[0], files[0].name)
      ) {
        actions.loadDocumentFromFile(files[0]);
      }
    }

    canvasStore.clearDropState();
  }

  function getPageLayout(pageIdx: number): PageLayoutDimensions {
    void store.renderVersion;
    void store.pageVersions[pageIdx];
    void store.optimisticRotations[pageIdx];
    const dims = actions.service.document?.getPageDimensions(pageIdx) ?? { widthPts: 612, heightPts: 792 };
    const pageTransform = store.getPageTransform(pageIdx);
    void store.pendingRenderRotations[pageIdx];
    const effectiveRotation = store.getEffectivePageRotation(pageIdx);
    void effectiveRotation;
    const layoutRotation = store.getLayoutPageRotation(pageIdx);
    return calculatePageLayoutDimensions({
      widthPts: dims.widthPts,
      heightPts: dims.heightPts,
      zoom: store.zoom,
      pageTransform: {
        ...pageTransform,
        rotation: layoutRotation,
      },
      isLastPage: pageIdx === store.pageCount - 1,
    });
  }
</script>

<svelte:window 
  onkeydown={handleKeyDown} 
  onkeyup={handleKeyUp} 
  onpointermove={handlePointerMove} 
  onpointerup={handlePointerUp}
  onclick={handleWindowClick}
  onblur={handleWindowBlur}
  onresize={handleWindowResize}
  ondragend={() => {
    cancelDropRaf();
    canvasStore.clearDropState();
    cachedDropPageMetrics = null;
  }}
/>

<div class="h-full w-full flex flex-col min-h-0 overflow-hidden relative {isPanning ? 'panning-active' : (isSpaceDown || store.activeTool === 'hand' ? 'space-down' : '')}">
  {#if isSpaceDown || isPanning || store.activeTool === 'hand'}
    <div 
      class="absolute inset-0 z-[9999]"
      onpointerdown={handlePointerDown}
      oncontextmenu={(e) => { e.preventDefault(); }}
      onwheel={handleWheel}
      onpointerenter={handleViewportPointerEnter}
      onpointerleave={handleViewportPointerLeave}
      onpointermove={handleViewportPointerMove}
      role="presentation"
    ></div>
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    bind:this={viewportEl}
    id="main-canvas-viewport"
    class="flex-1 min-h-0 w-full relative transition-colors no-scrollbars {store.showOrganizerView ? 'overflow-hidden' : 'overflow-auto bg-background'} {store.isDraggingOver ? 'bg-secondary/40' : ''}"
    style="overflow-anchor: none;"
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    onwheel={handleWheel}
    onscroll={handleScroll}
    onpointerdown={handlePointerDown}
    onpointerenter={handleViewportPointerEnter}
    onpointerleave={handleViewportPointerLeave}
    onpointermove={handleViewportPointerMove}
    onclick={(e) => {
      if (e.target === viewportEl) {
        actions.clearSelection(true);
      }
    }}
    role="region"
    aria-label="PDF Document Viewport"
    tabindex="0"
  >
    {#if store.isDraggingOver}
      <div class="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none border border-dashed border-ring">
        <div class="text-xl font-semibold text-foreground">
          {store.isDocumentLoaded ? 'Drop PDF or convertible document here to open' : 'Drop PDF, Office, spreadsheet, or image files here to open or merge'}
        </div>
      </div>
    {/if}

    {#if !store.isDocumentLoaded}
      <div class="flex h-full w-full items-center justify-center p-4 md:p-6">
        <div class="w-full max-w-3xl rounded-2xl border border-border bg-card overflow-hidden shadow-xs flex flex-col md:flex-row items-stretch min-h-[480px] md:min-h-[500px]">
          <!-- Left side: logo, title, description, and options -->
          <div class="w-full md:w-[36%] flex flex-col justify-between p-2 sm:p-4 text-left">
            <div class="flex flex-col gap-4">
              <!-- Top left temporary logo affordance -->
              <div class="flex items-center gap-2.5">
                <img src="/vite.svg" alt="Vite Logo" class="h-8 w-8 shrink-0 select-none" />
              </div>

              <!-- Main title and single sentence description -->
              <div class="space-y-1.5">
                <h1 class="text-2xl font-bold tracking-tight text-foreground">KeaPDF</h1>
                <p class="text-xs text-muted-foreground leading-relaxed">
                  Edit, annotate, convert, and sign PDF documents entirely in your browser with private client-side processing.
                </p>
              </div>

              {#if store.loadError}
                <div role="alert" class="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2 text-xs text-destructive text-left w-full my-1">
                  <AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
                  <div class="flex-1 leading-relaxed">{store.loadError}</div>
                </div>
              {/if}
            </div>

            <!-- Empty state document action options -->
            <div class="flex flex-col items-stretch gap-1.5 mt-2 w-full text-foreground">
              {#if featureFlags.isEnabled('workspace.open')}
              <Button
                variant="tile"
                onclick={() => actions.triggerFileOpen()}
                class="w-full"
              >
                <FolderOpen class="w-4 h-4 text-foreground shrink-0" />
                <span class="font-medium text-sm leading-none">Open File(s)</span>
              </Button>
              {/if}
              {#if featureFlags.isEnabled('conversion') && featureFlags.isEnabled('workspace.convert') && featureFlags.isEnabled('workspace.quick-convert')}
              <Button
                variant="inline-text"
                size="sm"
                onclick={() => actions.triggerQuickConvert()}
                class="w-full justify-start font-medium"
              >
                <span>Convert to PDF</span>
              </Button>
              {/if}
              {#if featureFlags.isEnabled('merge') && featureFlags.isEnabled('workspace.merge')}
              <Button
                variant="inline-text"
                size="sm"
                onclick={() => actions.triggerMergeFiles()}
                class="w-full justify-start font-medium"
              >
                <span>Merge Files</span>
              </Button>
              {/if}
              {#if featureFlags.isEnabled('workspace.compliance') && featureFlags.isEnabled('compliance')}
              <Button
                variant="inline-text"
                size="sm"
                onclick={() => store.openUrlDialog()}
                class="w-full justify-start font-medium"
              >
                <span>Compliance Suites/URL</span>
              </Button>
              {/if}
            </div>
          </div>

          <!-- note: right side feature showcase carousel with static cover image fallback -->
          {#if featureFlags.isEnabled('workspace.feature-carousel') && featureFlags.isEnabled('components.carousel')}
            <EmptyStateFeatureCarousel />
          {:else}
            <div class="w-full md:w-[64%] relative min-h-[260px] md:min-h-full overflow-hidden bg-muted/20">
              <img
                src="/cover.jpg"
                alt="KeaPDF Cover"
                class="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
                loading="eager"
              />
            </div>
          {/if}
        </div>
      </div>
    {:else if featureFlags.isEnabled('organizer') && store.showOrganizerView}
      <div class="h-full w-full p-4 min-h-0 flex flex-col overflow-hidden bg-muted/40">
        <PageOrganizerPanel
          pageCount={store.pageCount}
          currentPageIndex={store.currentPageIndex}
          service={actions.service}
          onRefresh={() => actions.refreshDocument()}
          onSelectPage={(idx) => actions.goToPage(idx)}
        />
      </div>
    {:else}
      <div 
        bind:this={contentEl}
        class="flex flex-col items-center py-[20vh] px-[50vw] min-h-full min-w-max"
        onclick={(e) => {
          if (e.target === e.currentTarget) {
            actions.clearSelection(true);
          }
        }}
        role="presentation"
      >
        {#if topSpacerHeight > 0}
          <div aria-hidden="true" style="height: {topSpacerHeight}px; width: 1px; shrink: 0;"></div>
        {/if}
        {#each windowedPageIndices as pageIdx (`${store.activeWorkspaceFileId ?? store.fileName}_${pageIdx}`)}
          {@const layout = getPageLayout(pageIdx)}
          <div
            data-page-index={pageIdx}
            class="flex items-center justify-center relative shrink-0 transition-none"
            style="width: {layout.width}px; height: {layout.height}px; margin-bottom: {layout.spacing}px;"
          >
            {#if shouldMountPage(pageIdx)}
              <PdfPageView
                pageIndex={pageIdx}
              />
            {:else}
              <div
                data-page-element="true"
                data-page-index={pageIdx}
                class="relative inline-block bg-transparent outline-none rounded-none p-0 my-0 cursor-pointer"
                onclick={() => {
                  actions.setCurrentPageFromScroll(pageIdx);
                  actions.goToPage(pageIdx);
                }}
                role="button"
                tabindex="0"
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    actions.setCurrentPageFromScroll(pageIdx);
                    actions.goToPage(pageIdx);
                  }
                }}
                aria-label="PDF Page {pageIdx + 1}"
              >
                <div
                  class="relative bg-white border border-border/80 overflow-hidden rounded-none flex items-center justify-center"
                  style="width: {layout.width}px; height: {layout.height}px;"
                >
                  <span class="text-xs text-muted-foreground/30 font-sans select-none">
                    Page {pageIdx + 1}
                  </span>
                </div>
              </div>
            {/if}
          </div>
        {/each}
        {#if bottomSpacerHeight > 0}
          <div aria-hidden="true" style="height: {bottomSpacerHeight}px; width: 1px; shrink: 0;"></div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .no-scrollbars {
    -ms-overflow-style: none !important;
    scrollbar-width: none !important;
  }
  .no-scrollbars::-webkit-scrollbar {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }
  :global(.panning-active), :global(.panning-active) * {
    cursor: grabbing !important;
  }
  :global(.space-down), :global(.space-down) * {
    cursor: grab !important;
  }
</style>
