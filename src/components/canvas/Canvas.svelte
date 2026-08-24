<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import type { ElementDropPayload } from '../../stores/canvas-types';
  import { screenToPageCoords } from '../../utils/geometry';
  import PdfPageView from './PdfPageView.svelte';
  import PageOrganizerPanel from '../panels/PageOrganizerPanel.svelte';

  import { Button } from '$lib/components/ui/button/index.js';
  import { FileText } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  let viewportEl: HTMLElement | null = $state(null);

  let isSpaceDown = $state(false);
  let isPanning = $state(false);
  let panStartX = $state(0);
  let panStartY = $state(0);
  let scrollStartX = $state(0);
  let scrollStartY = $state(0);
  
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
        canvasActions.deleteSelectedElement();
      } else if (e.key === 'Escape') {
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
    if ((isSpaceDown && e.button === 0) || e.button === 1) { // Space+Left or Middle click
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

      // Prefer the dedicated canvas layer for coordinate conversion.
      // Falls back to any page element layer for backward compatibility.
      const pageSelector = `[data-page-index="${draggedElement.pageIndex}"]`;
      const layerEl = (
        viewportEl.querySelector(`${pageSelector} [data-canvas-layer]`) ??
        viewportEl.querySelector(`${pageSelector} [data-page-element]`)
      ) as HTMLElement | null;
      if (!layerEl) return;

      const pt = store.getPageTransform(draggedElement.pageIndex);

      if (canvasStore.dragState.mode === 'move') {
        canvasActions.updateDrag(e.clientX, e.clientY, layerEl, store.zoom, pt);
      } else if (canvasStore.dragState.mode === 'resize') {
        canvasActions.updateResize(e.clientX, e.clientY, layerEl, store.zoom, e.shiftKey, pt);
      } else if (canvasStore.dragState.mode === 'rotate') {
        canvasActions.updateRotate(e.clientX, e.clientY, layerEl, store.zoom, pt);
      }
    }
  }

  function handlePointerUp(): void {
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
    isSpaceDown = false;
    isPanning = false;
  }

  let scrollRafId: number | null = null;

  function handleScroll(): void {
    if (!viewportEl || !store.isDocumentLoaded || store.pageCount === 0 || store.showOrganizerView) return;
    if (scrollRafId !== null) return;

    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      computeCurrentPage();
    });
  }

  function computeCurrentPage(): void {
    if (!viewportEl || !store.isDocumentLoaded || store.pageCount === 0 || store.showOrganizerView) return;

    const viewportRect = viewportEl.getBoundingClientRect();
    const viewportCenterY = viewportRect.top + viewportRect.height / 2;

    let closestPage = store.currentPageIndex;
    let minDistance = Infinity;

    const pageEls = viewportEl.querySelectorAll('[data-page-index]');
    const centers: {idx: number, y: number}[] = [];
    
    for (let i = 0; i < pageEls.length; i++) {
      const pageEl = pageEls[i] as HTMLElement;
      const idxAttr = pageEl.getAttribute('data-page-index');
      if (idxAttr === null) continue;
      const idx = parseInt(idxAttr, 10);
      
      const pageRect = pageEl.getBoundingClientRect();
      const pageCenter = pageRect.top + pageRect.height / 2;
      centers.push({ idx, y: pageCenter });

      const distance = Math.abs(viewportCenterY - pageCenter);
      if (distance < minDistance) {
        minDistance = distance;
        closestPage = idx;
      }
    }

    if (closestPage !== store.currentPageIndex) {
      actions.setCurrentPageFromScroll(closestPage);
    }

    centers.sort((a, b) => a.idx - b.idx);
    
    let frac = closestPage;
    for (let i = 0; i < centers.length - 1; i++) {
       const c1 = centers[i];
       const c2 = centers[i+1];
       if (viewportCenterY >= c1.y && viewportCenterY <= c2.y) {
          const ratio = (viewportCenterY - c1.y) / (c2.y - c1.y);
          frac = c1.idx + ratio;
          break;
       }
    }
    
    if (centers.length > 0) {
      if (viewportCenterY < centers[0].y) {
         frac = centers[0].idx;
      } else if (viewportCenterY > centers[centers.length - 1].y) {
         frac = centers[centers.length - 1].idx;
      }
    }
    store.scrollFraction = frac;
  }

  $effect(() => {
    actions.registerScrollCallback((idx) => {
      if (!viewportEl) return;
      const el = viewportEl.querySelector(`[data-page-index="${idx}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'center' });
    });
    return () => actions.registerScrollCallback(() => {});
  });

  let contentEl: HTMLElement | null = $state(null);

  $effect(() => {
    if (!contentEl || !viewportEl) return;
    
    let previousWidth = 0;
    let previousHeight = 0;
    let lastZoom = untrack(() => store.zoom);
    
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const newWidth = entry.contentRect.width;
        const newHeight = entry.contentRect.height;
        const currentZoom = untrack(() => store.zoom);
        
        if (previousWidth > 0 && previousHeight > 0) {
          if (lastZoom === currentZoom) {
            const deltaW = newWidth - previousWidth;
            const deltaH = newHeight - previousHeight;
            viewportEl!.scrollLeft += deltaW / 2;
            viewportEl!.scrollTop += deltaH / 2;
          }
        }
        
        previousWidth = newWidth;
        previousHeight = newHeight;
        lastZoom = currentZoom;
      }
    });
    
    observer.observe(contentEl);
    return () => observer.disconnect();
  });

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
        const newZoom = Math.max(0.25, Math.min(5.0, currentZoom * zoomFactor));
        
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

        actions.setZoom(newZoom);
        await tick();

        // Guard against component unmount during the tick.
        if (!viewportEl) return;

        const newAnchorEl = viewportEl.querySelector(`[data-page-index="${anchorIdx}"]`) as HTMLElement;
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

  function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer) {
      const hasElement = e.dataTransfer.types.includes('application/x-canvas-element');
      const hasFile = e.dataTransfer.types.includes('Files');
      if (hasElement || hasFile) {
        store.isDraggingOver = true;
      }
    }
  }

  function handleDragLeave(e: DragEvent): void {
    e.preventDefault();
    store.isDraggingOver = false;
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    store.isDraggingOver = false;

    const elementData = e.dataTransfer?.getData('application/x-canvas-element');
    if (elementData) {
      try {
        const payload: ElementDropPayload = JSON.parse(elementData);
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const pageEl = target?.closest('[data-page-element]') as HTMLElement | null;
        const pageWrapper = target?.closest('[data-page-index]') as HTMLElement | null;

        if (pageEl && pageWrapper) {
          const pageIndexAttr = pageWrapper.getAttribute('data-page-index');
          const pageIndex = pageIndexAttr !== null ? parseInt(pageIndexAttr, 10) : store.currentPageIndex;
          const pt = store.getPageTransform(pageIndex);
          const coords = screenToPageCoords(e.clientX, e.clientY, pageEl, store.zoom, pt);
          canvasActions.dropElement(payload, pageIndex, coords.x, coords.y);
        } else {
          canvasActions.dropElement(payload, store.currentPageIndex, 200, 300);
        }
      } catch (err) {
        console.error('Failed to parse element drop data:', err);
      }
      return;
    }

    const file = e.dataTransfer?.files[0];
    if (file && file.type === 'application/pdf') {
      actions.loadDocumentFromFile(file);
    }
  }
</script>

<svelte:window 
  onkeydown={handleKeyDown} 
  onkeyup={handleKeyUp} 
  onpointermove={handlePointerMove} 
  onpointerup={handlePointerUp}
  onclick={handleWindowClick}
  onblur={handleWindowBlur}
/>

<div class="h-full w-full flex flex-col min-h-0 overflow-hidden relative {isPanning ? 'panning-active' : (isSpaceDown ? 'space-down' : '')}">
  {#if isSpaceDown || isPanning}
    <div 
      class="absolute inset-0 z-[9999]"
      onpointerdown={handlePointerDown}
      oncontextmenu={(e) => { e.preventDefault(); }}
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
        <div class="text-xl font-semibold text-primary">Drop PDF file here to open</div>
      </div>
    {/if}

    {#if !store.isDocumentLoaded}
      <div class="flex h-full w-full items-center justify-center">
        <div class="flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <FileText class="h-12 w-12 stroke-[1.5]" />
          <h2 class="text-lg font-semibold text-foreground">No Document Loaded</h2>
          <p class="text-xs text-muted-foreground">Drag and drop a PDF file here or open one to start editing.</p>
          <Button size="sm" onclick={() => actions.triggerFileOpen()}>Open PDF File</Button>
        </div>
      </div>
    {:else if store.showOrganizerView}
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
        class="flex flex-col items-center py-[20vh] px-[50vw] gap-8 min-h-full min-w-max"
        onclick={(e) => {
          if (e.target === e.currentTarget) {
            actions.clearSelection(true);
          }
        }}
        role="presentation"
      >
        {#each Array.from({ length: store.pageCount }, (_, i) => i) as pageIdx (pageIdx)}
          <div data-page-index={pageIdx}>
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
