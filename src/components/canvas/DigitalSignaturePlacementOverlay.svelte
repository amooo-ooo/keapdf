<script lang="ts">
  import { Check, X, Loader2, User } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import SelectionOverlay from './SelectionOverlay.svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import type { HandlePosition } from '../../stores/canvas-types';
  import type { PageTransform } from '../../stores/types';
  import { capturePageMetrics, screenToPageCoordsWithMetrics } from '../../utils/geometry';
  import {
    SIGNATURE_PLACEMENT_PRESETS,
    clampSignatureRectToPage,
    type SignaturePlacementPreset,
  } from '../../utils/signature-placement';

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
  const canvasStore = useCanvasStore();

  const isPlacingOnPage = $derived(
    store.pendingDigitalSignature !== null &&
      store.pendingDigitalSignature.pageIndex === pageIndex
  );
  const pending = $derived(isPlacingOnPage ? store.pendingDigitalSignature : null);

  const boxLeftPts = $derived(pending?.x ?? 0);
  const boxTopPts = $derived(pending?.y ?? 0);
  const boxWidthPts = $derived(pending?.width ?? 190);
  const boxHeightPts = $derived(pending?.height ?? 64);

  const boxLeftPx = $derived(boxLeftPts * visualScale);
  const boxTopPx = $derived(boxTopPts * visualScale);
  const boxWidthPx = $derived(boxWidthPts * visualScale);
  const boxHeightPx = $derived(boxHeightPts * visualScale);

  const activePresetLabel = $derived(
    SIGNATURE_PLACEMENT_PRESETS.find((p) => p.id === pending?.preset)?.label ?? 'Custom Position'
  );

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

  function resolvePageElement(fallbackTarget?: EventTarget | null): HTMLElement | null {
    if (containerEl) return containerEl;
    const el = fallbackTarget as HTMLElement | null;
    return (el?.closest('[data-page-element]') as HTMLElement | null) ?? el;
  }

  function handlePanStart(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (!store.pendingDigitalSignature || store.pendingDigitalSignature.pageIndex !== pageIndex) {
      return;
    }
    const pageEl = resolvePageElement(e.currentTarget);
    if (!pageEl) return;

    e.stopPropagation();
    e.preventDefault();

    const dragTarget = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    try {
      dragTarget.setPointerCapture(pointerId);
    } catch {
      // Ignore pointer capture errors in headless environments
    }

    const metrics = capturePageMetrics(pageEl);
    const startPt = screenToPageCoordsWithMetrics(
      e.clientX,
      e.clientY,
      metrics,
      visualScale,
      pageTransform
    );
    const initX = store.pendingDigitalSignature.x;
    const initY = store.pendingDigitalSignature.y;
    const initW = store.pendingDigitalSignature.width;
    const initH = store.pendingDigitalSignature.height;

    const onPointerMove = (me: PointerEvent): void => {
      const curPt = screenToPageCoordsWithMetrics(
        me.clientX,
        me.clientY,
        metrics,
        visualScale,
        pageTransform
      );
      const dx = curPt.x - startPt.x;
      const dy = curPt.y - startPt.y;

      const clamped = clampSignatureRectToPage(
        {
          x: initX + dx,
          y: initY + dy,
          width: initW,
          height: initH,
        },
        widthPts,
        heightPts
      );

      scheduleUpdate(() => {
        actions.updateDigitalSignaturePlacement(clamped, 'custom');
      });
    };

    const onPointerUp = (): void => {
      try {
        if (dragTarget.hasPointerCapture(pointerId)) {
          dragTarget.releasePointerCapture(pointerId);
        }
      } catch {
        // Ignore release errors
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

  function handleResizeStart(e: PointerEvent, handle: HandlePosition, fallbackPageEl?: HTMLElement): void {
    if (e.button !== 0) return;
    if (!store.pendingDigitalSignature || store.pendingDigitalSignature.pageIndex !== pageIndex) {
      return;
    }
    const pageEl = containerEl ?? fallbackPageEl ?? resolvePageElement(e.target);
    if (!pageEl) return;

    e.stopPropagation();
    e.preventDefault();

    const resizeTarget = e.target as HTMLElement;
    const pointerId = e.pointerId;
    try {
      resizeTarget?.setPointerCapture?.(pointerId);
    } catch {
      // Ignore pointer capture errors
    }

    const metrics = capturePageMetrics(pageEl);
    const startPt = screenToPageCoordsWithMetrics(
      e.clientX,
      e.clientY,
      metrics,
      visualScale,
      pageTransform
    );
    const initX = store.pendingDigitalSignature.x;
    const initY = store.pendingDigitalSignature.y;
    const initW = store.pendingDigitalSignature.width;
    const initH = store.pendingDigitalSignature.height;
    const minW = 72;
    const minH = 28;

    const onPointerMove = (me: PointerEvent): void => {
      const curPt = screenToPageCoordsWithMetrics(
        me.clientX,
        me.clientY,
        metrics,
        visualScale,
        pageTransform
      );
      const dx = curPt.x - startPt.x;
      const dy = curPt.y - startPt.y;

      let nextX = initX;
      let nextY = initY;
      let nextW = initW;
      let nextH = initH;

      if (handle.includes('left')) {
        const maxLeft = initX + initW - minW;
        nextX = Math.max(0, Math.min(maxLeft, initX + dx));
        nextW = initW + (initX - nextX);
      }
      if (handle.includes('right')) {
        nextW = Math.max(minW, Math.min(widthPts - initX, initW + dx));
      }
      if (handle.includes('top')) {
        const maxTop = initY + initH - minH;
        nextY = Math.max(0, Math.min(maxTop, initY + dy));
        nextH = initH + (initY - nextY);
      }
      if (handle.includes('bottom')) {
        nextH = Math.max(minH, Math.min(heightPts - initY, initH + dy));
      }

      const clamped = clampSignatureRectToPage(
        {
          x: nextX,
          y: nextY,
          width: nextW,
          height: nextH,
        },
        widthPts,
        heightPts
      );

      scheduleUpdate(() => {
        actions.updateDigitalSignaturePlacement(clamped, 'custom');
      });
    };

    const onPointerUp = (): void => {
      try {
        if (resizeTarget?.hasPointerCapture?.(pointerId)) {
          resizeTarget.releasePointerCapture(pointerId);
        }
      } catch {
        // Ignore release errors
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

  function handlePresetChange(value: string): void {
    const preset = value as Exclude<SignaturePlacementPreset, 'custom'>;
    if (SIGNATURE_PLACEMENT_PRESETS.some((p) => p.id === preset)) {
      actions.applyDigitalSignaturePreset(preset);
    }
  }
</script>

{#if isPlacingOnPage && pending}
  <div
    class="absolute inset-[1px] z-[105] pointer-events-none select-none overflow-visible"
    data-page-element="true"
  >
    <!-- Draggable Signature Element Container using standard canvas element primitive classes -->
    <div
      class="canvas-element-container canvas-element-selected absolute z-40 flex items-center justify-center overflow-hidden rounded-xs pointer-events-auto select-none"
      style="
        left: {boxLeftPx}px;
        top: {boxTopPx}px;
        width: {boxWidthPx}px;
        height: {boxHeightPx}px;
        cursor: var(--cursor-move, move);
      "
      onpointerdown={handlePanStart}
      ondblclick={(e) => {
        e.stopPropagation();
        void actions.confirmPendingDigitalSignature(canvasStore);
      }}
      role="region"
      aria-label="Digital signature placement box"
    >
      <!-- Live Signature Appearance Preview (Signature only OR Signature + Full Name underneath) -->
      <div class="w-full h-full flex flex-col items-center justify-center p-1 overflow-hidden pointer-events-none">
        {#if pending.graphicDataUrl}
          <img
            src={pending.graphicDataUrl}
            alt="Signature preview"
            class="max-w-full object-contain select-none img-subtle-outline {pending.showTextDetails ? 'max-h-[72%]' : 'max-h-[92%]'}"
            draggable="false"
          />
        {:else}
          <span
            class="font-serif italic text-foreground img-subtle-outline truncate max-w-full leading-tight"
            style="font-size: {Math.max(12, Math.min(28, boxHeightPx * (pending.showTextDetails ? 0.36 : 0.48)))}px;"
          >
            {pending.signerName}
          </span>
        {/if}
        {#if pending.showTextDetails && pending.signerName}
          <span
            class="font-sans text-foreground/90 img-subtle-outline truncate max-w-full leading-none mt-1"
            style="font-size: {Math.max(8, Math.min(13, boxHeightPx * 0.16))}px;"
          >
            {pending.signerName}
          </span>
        {/if}
      </div>
    </div>

    <!-- Standard Canvas SelectionOverlay Primitive with 8 Resize Handles -->
    <div class="absolute inset-0 pointer-events-none z-50">
      <SelectionOverlay
        element={{
          id: 'pending_digital_signature',
          x: boxLeftPts,
          y: boxTopPts,
          width: boxWidthPts,
          height: boxHeightPts,
          rotation: 0,
          kind: 'image',
        }}
        zoom={visualScale}
        variation="box"
        showRotateCursor={false}
        onResizeStart={(e, handle, pageEl) => handleResizeStart(e, handle, pageEl)}
      />
    </div>

    <!-- Floating Preset and Confirmation Bar matching CropOverlay Figma UI3 on-canvas toolbar -->
    <div
      class="absolute z-[60] bg-card/95 text-foreground backdrop-blur-md border border-border/80 rounded-2xl p-1.5 pointer-events-auto whitespace-nowrap flex items-center gap-1.5 select-none"
      style="
        left: {boxLeftPx + boxWidthPx / 2}px;
        top: {boxTopPx > 56 ? boxTopPx - 48 : boxTopPx + boxHeightPx + 10}px;
        transform: translateX(-50%);
      "
      onpointerdown={(e) => e.stopPropagation()}
      role="toolbar"
      tabindex="0"
      aria-label="Signature placement controls"
    >
      <Select.Root
        type="single"
        value={pending.preset === 'custom' ? '' : pending.preset}
        onValueChange={handlePresetChange}
      >
        <Select.Trigger variant="border" class="w-[136px] h-8 text-xs font-sans">
          <span class="truncate">{activePresetLabel}</span>
        </Select.Trigger>
        <Select.Content>
          {#each SIGNATURE_PLACEMENT_PRESETS as preset (preset.id)}
            <Select.Item value={preset.id} label={preset.label} class="text-xs font-sans" />
          {/each}
        </Select.Content>
      </Select.Root>

      <Button
        size="sm"
        variant={pending.showTextDetails ? 'secondary' : 'outline'}
        class="h-8 text-xs px-2.5 flex items-center gap-1.5"
        onclick={(e) => {
          e.stopPropagation();
          actions.updateDigitalSignaturePlacement(
            { showTextDetails: !pending.showTextDetails },
            pending.preset
          );
        }}
        title="Toggle signer full name underneath signature"
      >
        <User class="w-3.5 h-3.5" aria-hidden="true" />
        <span>{pending.showTextDetails ? 'Name shown' : 'Signature only'}</span>
      </Button>

      <Button
        size="sm"
        variant="default"
        class="h-8 text-xs px-3 flex items-center gap-1.5 font-medium"
        disabled={store.isSigningDocument}
        onclick={(e) => {
          e.stopPropagation();
          void actions.confirmPendingDigitalSignature(canvasStore);
        }}
      >
        {#if store.isSigningDocument}
          <Loader2 class="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Signing...
        {:else}
          <Check class="w-3.5 h-3.5" aria-hidden="true" /> Confirm &amp; Sign
        {/if}
      </Button>

      <Button
        size="sm"
        variant="outline"
        class="h-8 text-xs px-2.5 flex items-center gap-1 text-muted-foreground hover:text-foreground"
        disabled={store.isSigningDocument}
        onclick={(e) => {
          e.stopPropagation();
          actions.cancelPendingDigitalSignature();
        }}
      >
        <X class="w-3.5 h-3.5" aria-hidden="true" /> Cancel
      </Button>
    </div>
  </div>
{/if}
