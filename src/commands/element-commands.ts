/**
 * Concrete commands for mutating canvas overlay elements.
 *
 * Each command manages element lifecycle, geometric transformations,
 * and property updates with complete undo/redo invertibility and
 * automatic command coalescing for continuous user interactions.
 */

import type { Command, CommandContext } from '../core/command';
import type { CanvasElement, PathElement, Point, TextElementLine, TextSegment } from '../stores/canvas-types';
import { safeClone } from '../utils/clone-utils';

/**
 * Command to add a canvas element to the overlay layer.
 */
export class AddElementCommand implements Command<'add-element'> {
  readonly type = 'add-element' as const;

  constructor(
    readonly description: string,
    readonly element: CanvasElement,
    readonly selectOnExecute: boolean = true,
  ) {}

  execute(ctx: CommandContext): void {
    ctx.canvasStore.addElement(this.element);
    if (this.selectOnExecute) {
      ctx.canvasStore.selectElement(this.element.id);
    }
  }

  undo(ctx: CommandContext): void {
    ctx.canvasStore.removeElement(this.element.id);
    if (ctx.canvasStore.selectedElementId === this.element.id) {
      ctx.canvasStore.selectElement(null);
    }
  }
}

/**
 * Command to remove a canvas element from the overlay layer.
 */
export class RemoveElementCommand implements Command<'remove-element'> {
  readonly type = 'remove-element' as const;
  private removedElement: CanvasElement | null = null;
  private removedIndex: number = -1;
  private _wasUndone: boolean = false;

  constructor(
    readonly description: string,
    readonly elementId: string,
    elementSnapshot?: CanvasElement,
    removedIndex?: number,
  ) {
    if (elementSnapshot) {
      this.removedElement = safeClone(elementSnapshot);
    }
    if (typeof removedIndex === 'number') {
      this.removedIndex = removedIndex;
    }
  }

  execute(ctx: CommandContext): void {
    this._wasUndone = false;
    const el = ctx.canvasStore.getElementById(this.elementId);
    if (el) {
      this.removedElement = safeClone(el);
      const idx = ctx.canvasStore.elements.findIndex((e) => e.id === this.elementId);
      if (idx !== -1) {
        this.removedIndex = idx;
      }
    }
    ctx.canvasStore.removeElement(this.elementId);
    if (ctx.canvasStore.selectedElementId === this.elementId) {
      ctx.canvasStore.selectElement(null);
    }
  }

  undo(ctx: CommandContext): void {
    this._wasUndone = true;
    if (this.removedElement) {
      const restored = safeClone(this.removedElement);
      if (this.removedIndex >= 0 && this.removedIndex <= ctx.canvasStore.elements.length) {
        ctx.canvasStore.elements.splice(this.removedIndex, 0, restored);
      } else {
        ctx.canvasStore.addElement(restored);
      }
      ctx.canvasStore.selectElement(restored.id);
    }
  }

  dispose(): void {
    if (this._wasUndone) return;
    if (this.removedElement && 'src' in this.removedElement) {
      const src = (this.removedElement as { src?: string }).src;
      if (typeof src === 'string' && src.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(src);
        } catch {
          // Ignore revocation errors in headless/test environments
        }
      }
    }
    this.removedElement = null;
  }
}

const COALESCE_WINDOW_MS = 1000;

/**
 * Command to move an element to a new (x, y) position and/or transfer across pages.
 */
export class MoveElementCommand implements Command<'move-element'> {
  readonly type = 'move-element' as const;

  constructor(
    readonly description: string,
    readonly elementId: string,
    readonly prevX: number,
    readonly prevY: number,
    readonly newX: number,
    readonly newY: number,
    readonly timestamp: number = Date.now(),
    readonly prevPageIndex?: number,
    readonly newPageIndex?: number,
    readonly prevPoints?: Point[],
    readonly newPoints?: Point[],
  ) {}

  execute(ctx: CommandContext): void {
    const updates: Partial<CanvasElement> = { x: this.newX, y: this.newY };
    if (this.newPageIndex !== undefined) {
      updates.pageIndex = this.newPageIndex;
    }
    if (this.newPoints !== undefined) {
      (updates as Partial<PathElement>).points = JSON.parse(JSON.stringify(this.newPoints));
    }
    ctx.canvasStore.updateElement(this.elementId, updates);
  }

  undo(ctx: CommandContext): void {
    const updates: Partial<CanvasElement> = { x: this.prevX, y: this.prevY };
    if (this.prevPageIndex !== undefined) {
      updates.pageIndex = this.prevPageIndex;
    }
    if (this.prevPoints !== undefined) {
      (updates as Partial<PathElement>).points = JSON.parse(JSON.stringify(this.prevPoints));
    }
    ctx.canvasStore.updateElement(this.elementId, updates);
  }

  merge(previous: Command): Command | null {
    if (
      previous instanceof MoveElementCommand &&
      previous.elementId === this.elementId &&
      Math.abs(this.timestamp - previous.timestamp) < COALESCE_WINDOW_MS
    ) {
      // Coalesce: keep original start position/page from previous, use new end position/page from this
      return new MoveElementCommand(
        this.description,
        this.elementId,
        previous.prevX,
        previous.prevY,
        this.newX,
        this.newY,
        previous.timestamp,
        previous.prevPageIndex,
        this.newPageIndex !== undefined ? this.newPageIndex : previous.newPageIndex,
        previous.prevPoints,
        this.newPoints !== undefined ? this.newPoints : previous.newPoints,
      );
    }
    return null;
  }
}

/**
 * Command to resize an element.
 */
export class ResizeElementCommand implements Command<'resize-element'> {
  readonly type = 'resize-element' as const;

  constructor(
    readonly description: string,
    readonly elementId: string,
    readonly prevBounds: { x: number; y: number; width: number; height: number; fontSize?: number },
    readonly newBounds: { x: number; y: number; width: number; height: number; fontSize?: number },
    readonly timestamp: number = Date.now(),
    readonly prevLines?: TextElementLine[],
    readonly newLines?: TextElementLine[],
    readonly prevSegments?: TextSegment[],
    readonly newSegments?: TextSegment[],
  ) {}

  execute(ctx: CommandContext): void {
    ctx.canvasStore.updateElementBounds(
      this.elementId,
      this.newBounds.x,
      this.newBounds.y,
      this.newBounds.width,
      this.newBounds.height,
      this.newBounds.fontSize,
    );
    if (this.newLines || this.newSegments) {
      ctx.canvasStore.updateElement(this.elementId, { lines: this.newLines, segments: this.newSegments });
    }
  }

  undo(ctx: CommandContext): void {
    ctx.canvasStore.updateElementBounds(
      this.elementId,
      this.prevBounds.x,
      this.prevBounds.y,
      this.prevBounds.width,
      this.prevBounds.height,
      this.prevBounds.fontSize,
    );
    if (this.prevLines || this.prevSegments) {
      ctx.canvasStore.updateElement(this.elementId, { lines: this.prevLines, segments: this.prevSegments });
    }
  }

  merge(previous: Command): Command | null {
    if (
      previous instanceof ResizeElementCommand &&
      previous.elementId === this.elementId &&
      Math.abs(this.timestamp - previous.timestamp) < COALESCE_WINDOW_MS
    ) {
      return new ResizeElementCommand(
        this.description,
        this.elementId,
        previous.prevBounds,
        this.newBounds,
        previous.timestamp,
        previous.prevLines,
        this.newLines,
        previous.prevSegments,
        this.newSegments,
      );
    }
    return null;
  }
}

/**
 * Command to rotate an element.
 */
export class RotateElementCommand implements Command<'rotate-element'> {
  readonly type = 'rotate-element' as const;

  constructor(
    readonly description: string,
    readonly elementId: string,
    readonly prevRotation: number,
    readonly newRotation: number,
    readonly timestamp: number = Date.now(),
  ) {}

  execute(ctx: CommandContext): void {
    ctx.canvasStore.updateElementRotation(this.elementId, this.newRotation);
  }

  undo(ctx: CommandContext): void {
    ctx.canvasStore.updateElementRotation(this.elementId, this.prevRotation);
  }

  merge(previous: Command): Command | null {
    if (
      previous instanceof RotateElementCommand &&
      previous.elementId === this.elementId &&
      Math.abs(this.timestamp - previous.timestamp) < COALESCE_WINDOW_MS
    ) {
      return new RotateElementCommand(
        this.description,
        this.elementId,
        previous.prevRotation,
        this.newRotation,
        previous.timestamp,
      );
    }
    return null;
  }
}

/**
 * Command to update arbitrary properties on an element.
 */
export class UpdateElementPropertyCommand implements Command<'update-element-property'> {
  readonly type = 'update-element-property' as const;

  constructor(
    readonly description: string,
    readonly elementId: string,
    readonly prevProperties: Record<string, unknown>,
    readonly newProperties: Record<string, unknown>,
    readonly timestamp: number = Date.now(),
  ) {}

  execute(ctx: CommandContext): void {
    ctx.canvasStore.updateElementProperties(
      this.elementId,
      this.newProperties,
    );
  }

  undo(ctx: CommandContext): void {
    ctx.canvasStore.updateElementProperties(
      this.elementId,
      this.prevProperties,
    );
  }

  merge(previous: Command): Command | null {
    if (
      previous instanceof UpdateElementPropertyCommand &&
      previous.elementId === this.elementId &&
      Math.abs(this.timestamp - previous.timestamp) < COALESCE_WINDOW_MS
    ) {
      // Coalesce updates: preserve earliest previous values, overwrite with newest
      return new UpdateElementPropertyCommand(
        this.description,
        this.elementId,
        { ...this.prevProperties, ...previous.prevProperties },
        { ...previous.newProperties, ...this.newProperties },
        previous.timestamp,
      );
    }
    return null;
  }
}
