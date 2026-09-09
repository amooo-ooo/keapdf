<script lang="ts">
  import { tick } from 'svelte';
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
    type CachedPageMetrics,
    calculatePageCenteringScroll,
    resolveTargetPageIndex,
    calculateOutOfBoundsScrollSpeeds,
    calculatePageLayoutDimensions,
    type PageLayoutBound,
    type PageLayoutDimensions,
    computePageVerticalOffsets,
    resolvePageIndexFromOffsets,
    type PageVerticalOffset,
  } from '../../utils/geometry';
  import PdfPageView from './PdfPageView.svelte';
  import PageOrganizerPanel from '../panels/PageOrganizerPanel.svelte';

  import { Button } from '$lib/components/ui/button/index.js';
  import { FileText, Globe, AlertCircle, Files, FileType } from 'lucide-svelte';
  import { documentConverter } from '../../services/conversion';
  import { useFeatureFlagStore } from '../../core/feature-flags';

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
        e.stopImmediatePropagation();
        e.stopPropagation();
        e.preventDefault();
        canvasActions.deleteSelectedElement();
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
  interface CachedPageLayout {
    pageIndex: number;
    offsetTop: number;
    offsetBottom: number;
  }
  let cachedPageLayouts: CachedPageLayout[] | null = null;
  let cachedTargetPageIndex: number | null = null;
  let cachedTargetLayerEl: HTMLElement | null = null;
  let dropRafId: number | null = null;
  let cachedDropPageMetrics: { pageIndex: number; metrics: CachedPageMetrics; pageEl: HTMLElement } | null = null;
  let latestDragClientX = 0;
  let latestDragClientY = 0;
  let latestDragTarget: HTMLElement | null = null;

  function initDragPageLayouts(): void {
    if (!viewportEl) return;
    const viewportRect = viewportEl.getBoundingClientRect();
    const currentScrollTop = viewportEl.scrollTop;
    const pageContainers = Array.from(viewportEl.querySelectorAll<HTMLElement>('[data-page-index]'));
    const layouts: CachedPageLayout[] = [];
    for (const container of pageContainers) {
      const attr = container.getAttribute('data-page-index');
      if (attr !== null) {
        const idx = parseInt(attr, 10);
        if (!isNaN(idx)) {
          const rect = container.getBoundingClientRect();
          const offsetTop = rect.top - viewportRect.top + currentScrollTop;
          const offsetBottom = rect.bottom - viewportRect.top + currentScrollTop;
          layouts.push({ pageIndex: idx, offsetTop, offsetBottom });
        }
      }
    }
    layouts.sort((a, b) => a.pageIndex - b.pageIndex);
    cachedPageLayouts = layouts;
  }

  function performDragMove(clientX: number, clientY: number): void {
    if (!canvasStore.dragState || canvasStore.dragState.mode !== 'move' || !viewportEl) return;
    const draggedElement = canvasStore.elements.find(el => el.id === canvasStore.dragState?.elementId);
    if (!draggedElement) return;

    // Resolve target page based on vertical pointer position and midpoint thresholds
    let targetPageIndex = draggedElement.pageIndex;
    if (store.pageCount > 1) {
      if (!cachedPageLayouts) {
        initDragPageLayouts();
      }
      if (cachedPageLayouts && cachedPageLayouts.length > 0) {
        const viewportRect = viewportEl.getBoundingClientRect();
        const currentScrollTop = viewportEl.scrollTop;
        const pageBounds: PageLayoutBound[] = cachedPageLayouts.map((c) => ({
          pageIndex: c.pageIndex,
          top: c.offsetTop - currentScrollTop + viewportRect.top,
          bottom: c.offsetBottom - currentScrollTop + viewportRect.top,
        }));
        targetPageIndex = resolveTargetPageIndex(clientY, pageBounds, draggedElement.pageIndex);
      }
    }

    if (targetPageIndex !== cachedTargetPageIndex || !cachedTargetLayerEl) {
      cachedTargetPageIndex = targetPageIndex;
      const targetPageSelector = `[data-page-index="${targetPageIndex}"]`;
      cachedTargetLayerEl = (
        viewportEl.querySelector(`${targetPageSelector} [data-canvas-layer]`) ??
        viewportEl.querySelector(`${targetPageSelector} [data-page-element]`)
      ) as HTMLElement | null;
    }

    if (cachedTargetLayerEl) {
      const targetPt = store.getPageTransform(targetPageIndex);
      canvasActions.updateDrag(clientX, clientY, cachedTargetLayerEl, store.zoom, targetPt, targetPageIndex);
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
        if (autoScrollSpeedY !== 0) {
          viewportEl.scrollTop += autoScrollSpeedY;
        }
        if (autoScrollSpeedX !== 0) {
          viewportEl.scrollLeft += autoScrollSpeedX;
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
    if (isPanning && viewportEl) {
      e.preventDefault();
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      viewportEl.scrollLeft = scrollStartX - dx;
      viewportEl.scrollTop = scrollStartY - dy;
    } else if (canvasStore.dragState && viewportEl) {
      const draggedElement = canvasStore.elements.find(el => el.id === canvasStore.dragState?.elementId);
      if (!draggedElement) return;

      if (canvasStore.dragState.mode === 'move') {
        lastDragClientX = e.clientX;
        lastDragClientY = e.clientY;
        updateAutoScroll(e.clientX, e.clientY);
        performDragMove(e.clientX, e.clientY);
      } else {
        const pageSelector = `[data-page-index="${draggedElement.pageIndex}"]`;
        const layerEl = (
          viewportEl.querySelector(`${pageSelector} [data-canvas-layer]`) ??
          viewportEl.querySelector(`${pageSelector} [data-page-element]`)
        ) as HTMLElement | null;
        if (!layerEl) return;

        const pt = store.getPageTransform(draggedElement.pageIndex);
        if (canvasStore.dragState.mode === 'resize') {
          canvasActions.updateResize(e.clientX, e.clientY, layerEl, store.zoom, e.shiftKey, pt);
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
      if (canvasStore.dragState.mode === 'move') {
        canvasActions.endDrag();
      } else if (canvasStore.dragState.mode === 'resize') {
        canvasActions.endResize();
      } else if (canvasStore.dragState.mode === 'rotate') {
        canvasActions.endRotate();
      }
    }
    cachedPageLayouts = null;
    cachedTargetPageIndex = null;
    cachedTargetLayerEl = null;
  }

  function handleWindowClick(e: MouseEvent): void {
    if (!canvasStore.selectedElement) return;

    const target = e.target as HTMLElement;

    if (
      target.closest('.editor-shell-right') || 
      target.closest('.editor-shell-left') || 
      target.closest('.editor-shell-nav') ||
      target.closest('[role="dialog"]') ||
      target.closest('[role="menu"]') ||
      target.closest('[role="listbox"]') ||
      target.closest('[data-radix-popper-content-wrapper]') ||
      target.closest('[data-bits-menu-content]') ||
      target.closest('[data-bits-select-content]') ||
      target.closest('[data-bits-popover-content]') ||
      target.closest('[data-bits-dialog-content]') ||
      target.closest('.toaster')
    ) {
      return;
    }

    if (!target.closest('.canvas-element-container') && !target.closest('.selection-overlay-container')) {
      canvasStore.selectElement(null);
    }
  }

  function handleWindowBlur(): void {
    stopAutoScroll();
    isSpaceDown = false;
    isPanning = false;
  }


  let scrollRafId: number | null = null;
  let isCentering = false;
  let cachedVerticalOffsets: PageVerticalOffset[] | null = null;
  let cachedFirstPageOffsetTop: number | null = null;

  function invalidatePageOffsetsCache(): void {
    cachedVerticalOffsets = null;
    cachedFirstPageOffsetTop = null;
  }

  function getPageVerticalOffsets(): PageVerticalOffset[] {
    if (cachedVerticalOffsets) return cachedVerticalOffsets;
    if (!viewportEl || store.pageCount === 0) return [];

    let currentY: number = cachedFirstPageOffsetTop !== null ? cachedFirstPageOffsetTop : 0;
    if (cachedFirstPageOffsetTop === null) {
      if (contentEl) {
        const firstChild = contentEl.querySelector('[data-page-index="0"]') as HTMLElement | null;
        currentY = firstChild ? firstChild.offsetTop : (viewportEl.clientHeight * 0.2);
      } else {
        currentY = viewportEl.clientHeight * 0.2;
      }
      cachedFirstPageOffsetTop = currentY;
    }

    const layouts: PageLayoutDimensions[] = [];
    for (let i = 0; i < store.pageCount; i++) {
      layouts.push(getPageLayout(i));
    }

    cachedVerticalOffsets = computePageVerticalOffsets(layouts, currentY);
    return cachedVerticalOffsets;
  }

  function resolvePageIndexAtScrollY(targetScrollY: number): number {
    if (!viewportEl || store.pageCount <= 1) return 0;
    const offsets = getPageVerticalOffsets();
    return resolvePageIndexFromOffsets(targetScrollY, offsets);
  }

  function computeCurrentPage(): void {
    if (!viewportEl || !store.isDocumentLoaded || store.pageCount === 0 || store.showOrganizerView || isCentering || store.isZooming) return;

    const viewportCenterScrollY = viewportEl.scrollTop + viewportEl.clientHeight / 2;
    const resolvedIndex = resolvePageIndexAtScrollY(viewportCenterScrollY);

    if (resolvedIndex !== store.currentPageIndex) {
      actions.setCurrentPageFromScroll(resolvedIndex);
    }
  }

  function handleScroll(): void {
    cachedDropPageMetrics = null;
    if (!viewportEl || !store.isDocumentLoaded || store.pageCount === 0 || store.showOrganizerView || isCentering || store.isZooming) return;
    if (scrollRafId !== null) return;

    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      computeCurrentPage();
    });
  }

  function centerPage(pageIndex: number = 0, behavior: ScrollBehavior = 'instant', options?: ScrollTargetOptions): void {
    if (!viewportEl || !contentEl || !store.isDocumentLoaded || store.pageCount === 0 || canvasStore.dragState) return;
    const pageEl = viewportEl.querySelector(`[data-page-index="${pageIndex}"]`) as HTMLElement | null;
    if (!pageEl) return;

    // Find the visible canvas opening between LeftPanel and RightPanel.
    // Falls back to viewportEl if .editor-shell-canvas is not present (e.g. in headless tests).
    const visibleContainer = (document.querySelector('.editor-shell-canvas') as HTMLElement | null) ?? viewportEl;

    const pageRect = pageEl.getBoundingClientRect();
    const visibleRect = visibleContainer.getBoundingClientRect();

    let targetScrollLeft: number;
    let targetScrollTop: number;

    // When elements have valid rendered dimensions, compute exact screen-space centering.
    if (pageRect.width > 0 && visibleRect.width > 0 && pageRect.height > 0 && visibleRect.height > 0) {
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

      if (targetScreenY !== null) {
        const visibleCenterY = visibleRect.top + visibleRect.height / 2;
        const deltaY = targetScreenY - visibleCenterY;
        targetScrollTop = Math.max(0, currentScrollTop + deltaY);
      } else if (pageRect.height <= visibleRect.height) {
        const pageCenterY = pageRect.top + pageRect.height / 2;
        const visibleCenterY = visibleRect.top + visibleRect.height / 2;
        const deltaY = pageCenterY - visibleCenterY;
        targetScrollTop = Math.max(0, currentScrollTop + deltaY);
      } else {
        const deltaY = pageRect.top - (visibleRect.top + 24);
        targetScrollTop = Math.max(0, currentScrollTop + deltaY);
      }
    } else {
      // Fallback for headless environments or unrendered layout boxes.
      const viewportRect = viewportEl.getBoundingClientRect();
      const visibleOffsetX = visibleRect.width > 0 && viewportRect.width > 0
        ? Math.max(0, visibleRect.left - viewportRect.left)
        : 0;
      const visibleOffsetY = visibleRect.height > 0 && viewportRect.height > 0
        ? Math.max(0, visibleRect.top - viewportRect.top)
        : 0;

      const scrollOffsets = calculatePageCenteringScroll({
        viewportWidth: viewportEl.clientWidth,
        viewportHeight: viewportEl.clientHeight,
        contentWidth: contentEl.scrollWidth,
        pageOffsetLeft: pageEl.offsetLeft,
        pageOffsetTop: pageEl.offsetTop,
        pageWidth: pageEl.offsetWidth,
        pageHeight: pageEl.offsetHeight,
        visibleOffsetX,
        visibleWidth: visibleContainer.clientWidth || viewportEl.clientWidth,
        visibleOffsetY,
        visibleHeight: visibleContainer.clientHeight || viewportEl.clientHeight,
      });
      targetScrollLeft = scrollOffsets.scrollLeft;
      targetScrollTop = scrollOffsets.scrollTop;
    }

    isCentering = true;
    viewportEl.scrollTo({
      left: Math.round(targetScrollLeft),
      top: Math.round(targetScrollTop),
      behavior,
    });

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        isCentering = false;
      });
    } else {
      isCentering = false;
    }
  }

  $effect(() => {
    actions.registerScrollCallback((idx, scrollOptions) => {
      centerPage(idx, scrollOptions?.behavior ?? 'smooth', scrollOptions);
    });
    return () => actions.registerScrollCallback(() => {});
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

    return () => observer.disconnect();
  });

  $effect(() => {
    void store.zoom;
    void store.pageCount;
    void store.renderVersion;
    invalidatePageOffsetsCache();
  });



  function handleWindowResize(): void {
    cachedDropPageMetrics = null;
    cachedPageLayouts = null;
    invalidatePageOffsetsCache();
    if (!store.isDocumentLoaded || !viewportEl || store.pageCount === 0 || store.showOrganizerView || canvasStore.dragState || store.isZooming) return;
    centerPage(store.currentPageIndex, 'instant');
  }

  let wheelRafId: number | null = null;
  let pendingWheelDy = 0;
  let lastWheelEvent: WheelEvent | null = null;

  function handleWheel(e: WheelEvent): void {
    if (e.ctrlKey) {
      e.preventDefault();
      if (!viewportEl) return;

      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 33;
      else if (e.deltaMode === 2) dy *= 100;

      pendingWheelDy += dy;
      lastWheelEvent = e;

      if (wheelRafId !== null) return;

      wheelRafId = requestAnimationFrame(async () => {
        wheelRafId = null;
        if (!lastWheelEvent || !viewportEl) return;

        const dyToApply = pendingWheelDy;
        pendingWheelDy = 0;
        const targetEvent = lastWheelEvent;
        lastWheelEvent = null;

        const currentZoom = store.zoom;
        const zoomFactor = Math.pow(2, -dyToApply / 140);
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, currentZoom * zoomFactor));

        if (newZoom === currentZoom) return;

        let anchorEl = document.elementFromPoint(targetEvent.clientX, targetEvent.clientY)?.closest('[data-page-index]') as HTMLElement | null;

        if (!anchorEl) {
          const pageEls = Array.from(viewportEl.querySelectorAll('[data-page-index]')) as HTMLElement[];
          let minDistance = Infinity;
          for (const el of pageEls) {
            const r = el.getBoundingClientRect();
            const cy = r.top + r.height / 2;
            const dist = Math.abs(cy - targetEvent.clientY);
            if (dist < minDistance) {
              minDistance = dist;
              anchorEl = el;
            }
          }
        }

        if (!anchorEl) return;

        const anchorIdx = anchorEl.getAttribute('data-page-index');
        const rect = anchorEl.getBoundingClientRect();
        const percentX = (targetEvent.clientX - rect.left) / rect.width;
        const percentY = (targetEvent.clientY - rect.top) / rect.height;

        invalidatePageOffsetsCache();
        actions.setZoom(newZoom);
        await tick();

        // Guard against component unmount during the tick.
        if (!viewportEl) return;

        const newAnchorEl = viewportEl.querySelector(`[data-page-index="${anchorIdx}"]`) as HTMLElement | null;
        if (newAnchorEl) {
          const newRect = newAnchorEl.getBoundingClientRect();
          const currentPointX = newRect.left + (newRect.width * percentX);
          const currentPointY = newRect.top + (newRect.height * percentY);

          viewportEl.scrollLeft += (currentPointX - targetEvent.clientX);
          viewportEl.scrollTop += (currentPointY - targetEvent.clientY);
        }
      });
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
      cachedDropPageMetrics = {
        pageIndex,
        pageEl,
        metrics: capturePageMetrics(pageEl),
      };
    }

    const pt = store.getPageTransform(pageIndex);
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

    previewX = Math.max(0, Math.min(maxW - w, previewX));
    previewY = Math.max(0, Math.min(maxH - h, previewY));

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
      current.kind === payload.kind
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
      const pt = store.getPageTransform(pageIndex);
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
          (files[0].type === 'application/pdf' ||
            files[0].name.toLowerCase().endsWith('.pdf') ||
            documentConverter.isConvertible(files[0].name, undefined, files[0].type))
        ) {
          actions.loadDocumentFromFile(files[0]);
        } else {
          actions.mergeAndLoadFiles(files);
        }
      } else if (
        files[0].type === 'application/pdf' ||
        files[0].name.toLowerCase().endsWith('.pdf') ||
        documentConverter.isConvertible(files[0].name, undefined, files[0].type)
      ) {
        actions.loadDocumentFromFile(files[0]);
      }
    }

    canvasStore.clearDropState();
  }

  function getPageLayout(pageIdx: number): PageLayoutDimensions {
    void store.renderVersion;
    void store.pageVersions[pageIdx];
    const dims = actions.service.document?.getPageDimensions(pageIdx) ?? { widthPts: 612, heightPts: 792 };
    const pageTransform = store.getPageTransform(pageIdx);
    return calculatePageLayoutDimensions({
      widthPts: dims.widthPts,
      heightPts: dims.heightPts,
      zoom: store.zoom,
      pageTransform: pageTransform,
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
      role="presentation"
    ></div>
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    bind:this={viewportEl}
    class="flex-1 min-h-0 w-full relative transition-colors no-scrollbars {store.showOrganizerView ? 'overflow-hidden' : 'overflow-auto bg-background'} {store.isDraggingOver ? 'bg-primary/10' : ''}"
    style="overflow-anchor: none;"
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    onwheel={handleWheel}
    onscroll={handleScroll}
    onpointerdown={handlePointerDown}
    onclick={(e) => {
      if (e.target === viewportEl) {
        actions.clearSelection(true);
      }
    }}
    role="region"
    aria-label="PDF Document Viewport"
  >
    {#if store.isDraggingOver}
      <div class="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none border-2 border-dashed border-primary">
        <div class="text-xl font-semibold text-primary">
          {store.isDocumentLoaded ? 'Drop PDF or convertible document here to open' : 'Drop PDF, Office, spreadsheet, or image files here to open or merge'}
        </div>
      </div>
    {/if}

    {#if !store.isDocumentLoaded}
      <div class="flex h-full w-full items-center justify-center">
        <div class="flex flex-col items-center justify-center gap-3 text-muted-foreground max-w-md text-center p-4">
          <FileText class="h-12 w-12 stroke-[1.5]" />
          <h2 class="text-lg font-semibold text-foreground">No Document Loaded</h2>
          <p class="text-xs text-muted-foreground">
            Open a local PDF file, convert office documents, spreadsheets, and markdown to PDF, merge multiple files, or choose from industry-standard compliance test suites.
          </p>

          {#if store.loadError}
            <div class="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2 text-xs text-destructive text-left w-full my-1">
              <AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
              <div class="flex-1 leading-relaxed">{store.loadError}</div>
            </div>
          {/if}

          <div class="flex flex-wrap items-center justify-center gap-2 mt-1">
            {#if featureFlags.isEnabled('workspace.open')}
            <Button size="sm" onclick={() => actions.triggerFileOpen()}>Open PDF File</Button>
            {/if}
            {#if featureFlags.isEnabled('conversion')}
            <Button variant="outline" size="sm" onclick={() => actions.openConvertDialog()} class="gap-1.5">
              <FileType class="w-3.5 h-3.5 text-primary" />
              Convert to PDF...
            </Button>
            {/if}
            {#if featureFlags.isEnabled('merge')}
            <Button variant="outline" size="sm" onclick={() => actions.triggerMergeFiles()} class="gap-1.5">
              <Files class="w-3.5 h-3.5 text-primary" />
              Merge Files...
            </Button>
            {/if}
            {#if featureFlags.isEnabled('workspace.compliance')}
            <Button variant="outline" size="sm" onclick={() => store.openUrlDialog()} class="gap-1.5">
              <Globe class="w-3.5 h-3.5 text-primary" />
              Compliance Suites / URL...
            </Button>
            {/if}
          </div>
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
        {#each Array.from({ length: store.pageCount }, (_, i) => i) as pageIdx (`${store.activeWorkspaceFileId ?? store.fileName}_${pageIdx}`)}
          {@const layout = getPageLayout(pageIdx)}
          <div
            data-page-index={pageIdx}
            class="flex items-center justify-center relative shrink-0 transition-none"
            style="width: {layout.width}px; height: {layout.height}px; margin-bottom: {layout.spacing}px;"
          >
            <PdfPageView
              pageIndex={pageIdx}
            />
          </div>
        {/each}
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
