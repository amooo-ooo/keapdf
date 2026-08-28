export interface DragCallbacks {
  onDragStart?: (startX: number, startY: number) => void;
  onDragMove?: (currentX: number, currentY: number, deltaX: number, deltaY: number) => void;
  onDragEnd?: (endX: number, endY: number) => void;
}

export interface DragHandlers {
  handlePointerDown: (e: PointerEvent) => void;
  readonly isDragging: boolean;
}

/**
 * Creates pointer-event-based drag handlers.
 * Uses pointer capture for reliable cross-element dragging.
 * All coordinates are raw client coordinates - callers are responsible
 * for converting to their desired coordinate space.
 */
export function useDrag(callbacks: DragCallbacks): DragHandlers {
  let dragging: boolean = $state(false);
  let startX: number = 0;
  let startY: number = 0;

  function handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const target = e.currentTarget as HTMLElement | null;
    if (!target) return;

    target.setPointerCapture(e.pointerId);
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;

    if (callbacks.onDragStart) {
      callbacks.onDragStart(startX, startY);
    }

    function handlePointerMove(moveEvent: PointerEvent): void {
      if (!dragging) return;
      
      const currentX = moveEvent.clientX;
      const currentY = moveEvent.clientY;
      const deltaX = currentX - startX;
      const deltaY = currentY - startY;

      if (callbacks.onDragMove) {
        callbacks.onDragMove(currentX, currentY, deltaX, deltaY);
      }
    }

    function handlePointerUp(upEvent: PointerEvent): void {
      if (!target) return;
      target.releasePointerCapture(upEvent.pointerId);
      dragging = false;

      if (callbacks.onDragEnd) {
        callbacks.onDragEnd(upEvent.clientX, upEvent.clientY);
      }

      target.removeEventListener('pointermove', handlePointerMove);
      target.removeEventListener('pointerup', handlePointerUp);
      target.removeEventListener('pointercancel', handlePointerUp);
    }

    target.addEventListener('pointermove', handlePointerMove);
    target.addEventListener('pointerup', handlePointerUp);
    target.addEventListener('pointercancel', handlePointerUp);
  }

  return {
    handlePointerDown,
    get isDragging(): boolean {
      return dragging;
    }
  };
}
