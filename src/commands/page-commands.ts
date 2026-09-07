/**
 * Commands for page transforms and document-level operations.
 */

import type { Command, CommandContext } from '../core/command';
import type { PageTransform } from '../stores/types';
import type { CanvasElement, PathElement, Point } from '../stores/canvas-types';
import { setFileBuffer } from '../stores/editor.svelte';
import { safeClone } from '../utils/clone-utils';

/**
 * Command to update the visual transform of a page.
 */
const COALESCE_WINDOW_MS = 1000;

export class SetPageTransformCommand implements Command<'set-page-transform'> {
  readonly type = 'set-page-transform' as const;

  constructor(
    readonly description: string,
    readonly pageIndex: number,
    readonly prevTransform: PageTransform | undefined,
    readonly newTransform: PageTransform,
    readonly timestamp: number = Date.now(),
  ) {}

  execute(ctx: CommandContext): void {
    ctx.editorStore.updatePageTransform(this.pageIndex, this.newTransform);
  }

  undo(ctx: CommandContext): void {
    if (this.prevTransform) {
      ctx.editorStore.updatePageTransform(this.pageIndex, this.prevTransform);
    } else {
      delete ctx.editorStore.pageTransforms[this.pageIndex];
    }
  }

  merge(previous: Command): Command | null {
    if (
      previous instanceof SetPageTransformCommand &&
      previous.pageIndex === this.pageIndex &&
      Math.abs(this.timestamp - previous.timestamp) < COALESCE_WINDOW_MS
    ) {
      return new SetPageTransformCommand(
        this.description,
        this.pageIndex,
        previous.prevTransform,
        this.newTransform,
        previous.timestamp,
      );
    }
    return null;
  }
}

import { transformPointForPageRotation } from '../utils/geometry';

/**
 * Command to permanently rotate a PDF page content stream in WASM.
 */
export class RotatePageCommand implements Command<'rotate-page'> {
  readonly type = 'rotate-page' as const;

  constructor(
    readonly description: string,
    readonly pageIndex: number,
    readonly degreesDelta: 90 | 180 | 270 = 90,
  ) {}

  execute(ctx: CommandContext): void {
    const pageDims = ctx.service.document.getPage(this.pageIndex).getDimensions();
    
    ctx.service.document.rotatePage(this.pageIndex, this.degreesDelta);
    
    if (ctx.editorStore.pageTransforms[this.pageIndex]) {
      const currentRotation = ctx.editorStore.pageTransforms[this.pageIndex].rotation || 0;
      if (currentRotation !== 0) {
        ctx.editorStore.pageTransforms[this.pageIndex].rotation = (currentRotation - this.degreesDelta + 360) % 360;
      }
    }

    if (ctx.canvasStore) {
      const elements = ctx.canvasStore.getElementsByPage(this.pageIndex);
      for (const el of elements) {
        if (el.kind === 'form-field') {
          const cx = el.x + el.width / 2;
          const cy = el.y + el.height / 2;
          const newCenter = transformPointForPageRotation(
            { x: cx, y: cy },
            this.degreesDelta,
            pageDims.widthPts,
            pageDims.heightPts
          );
          const updates: Partial<CanvasElement> = {
            x: Math.round((newCenter.x - el.width / 2) * 10) / 10,
            y: Math.round((newCenter.y - el.height / 2) * 10) / 10,
            width: el.width,
            height: el.height,
            rotation: (((el.rotation || 0) + this.degreesDelta) % 360 + 360) % 360,
          };
          ctx.canvasStore.updateElement(el.id, updates);
        } else {
          const cx = el.x + el.width / 2;
          const cy = el.y + el.height / 2;
          const newCenter = transformPointForPageRotation(
            { x: cx, y: cy },
            this.degreesDelta,
            pageDims.widthPts,
            pageDims.heightPts
          );
          const updates: Partial<CanvasElement> = {
            x: Math.round((newCenter.x - el.width / 2) * 10) / 10,
            y: Math.round((newCenter.y - el.height / 2) * 10) / 10,
            rotation: (((el.rotation || 0) + this.degreesDelta) % 360 + 360) % 360,
          };
          if (el.kind === 'path' && 'points' in el) {
            const pathEl = el as PathElement;
            (updates as Partial<PathElement>).points = pathEl.points.map((p: Point) =>
              transformPointForPageRotation(p, this.degreesDelta, pageDims.widthPts, pageDims.heightPts)
            );
          }
          ctx.canvasStore.updateElement(el.id, updates);
        }
      }
    }
    
    ctx.editorStore.incrementPageVersion(this.pageIndex);
    ctx.editorStore.incrementRenderVersion();
  }

  undo(ctx: CommandContext): void {
    const reverseDelta = (360 - this.degreesDelta) as 90 | 180 | 270;
    const pageDims = ctx.service.document.getPage(this.pageIndex).getDimensions();
    
    ctx.service.document.rotatePage(this.pageIndex, reverseDelta);
    
    if (ctx.editorStore.pageTransforms[this.pageIndex]) {
      const currentRotation = ctx.editorStore.pageTransforms[this.pageIndex].rotation || 0;
      if (currentRotation !== 0) {
        ctx.editorStore.pageTransforms[this.pageIndex].rotation = (currentRotation + this.degreesDelta) % 360;
      }
    }

    if (ctx.canvasStore) {
      const elements = ctx.canvasStore.getElementsByPage(this.pageIndex);
      for (const el of elements) {
        if (el.kind === 'form-field') {
          const cx = el.x + el.width / 2;
          const cy = el.y + el.height / 2;
          const newCenter = transformPointForPageRotation(
            { x: cx, y: cy },
            reverseDelta,
            pageDims.widthPts,
            pageDims.heightPts
          );
          const updates: Partial<CanvasElement> = {
            x: Math.round((newCenter.x - el.width / 2) * 10) / 10,
            y: Math.round((newCenter.y - el.height / 2) * 10) / 10,
            width: el.width,
            height: el.height,
            rotation: (((el.rotation || 0) + reverseDelta) % 360 + 360) % 360,
          };
          ctx.canvasStore.updateElement(el.id, updates);
        } else {
          const cx = el.x + el.width / 2;
          const cy = el.y + el.height / 2;
          const newCenter = transformPointForPageRotation(
            { x: cx, y: cy },
            reverseDelta,
            pageDims.widthPts,
            pageDims.heightPts
          );
          const updates: Partial<CanvasElement> = {
            x: Math.round((newCenter.x - el.width / 2) * 10) / 10,
            y: Math.round((newCenter.y - el.height / 2) * 10) / 10,
            rotation: (((el.rotation || 0) + reverseDelta) % 360 + 360) % 360,
          };
          if (el.kind === 'path' && 'points' in el) {
            const pathEl = el as PathElement;
            (updates as Partial<PathElement>).points = pathEl.points.map((p: Point) =>
              transformPointForPageRotation(p, reverseDelta, pageDims.widthPts, pageDims.heightPts)
            );
          }
          ctx.canvasStore.updateElement(el.id, updates);
        }
      }
    }
    
    ctx.editorStore.incrementPageVersion(this.pageIndex);
    ctx.editorStore.incrementRenderVersion();
  }
}

/**
 * Command for destructive WASM mutations (e.g., delete page, duplicate page, rotate page, sanitize).
 *
 * Stores buffer references (not deep copies) for the previous and new document states.
 * When undoing, it restores the previous buffer and page index in the engine.
 */
export class MutateDocumentCommand implements Command<'mutate-document'> {
  readonly type = 'mutate-document' as const;

  constructor(
    readonly description: string,
    readonly fileId: string,
    readonly prevBuffer: ArrayBuffer,
    readonly newBuffer: ArrayBuffer,
    readonly prevPageIndex: number,
    readonly newPageIndex: number,
    readonly prevElements?: CanvasElement[],
    readonly newElements?: CanvasElement[],
    readonly prevTransforms?: Record<number, PageTransform>,
    readonly newTransforms?: Record<number, PageTransform>,
  ) {}

  execute(ctx: CommandContext): void {
    setFileBuffer(this.fileId, this.newBuffer);
    ctx.service.loadDocumentFromBuffer(this.newBuffer);
    ctx.editorStore.pageCount = ctx.service.document.getPageCount();
    ctx.editorStore.currentPageIndex = Math.min(
      this.newPageIndex,
      Math.max(0, ctx.editorStore.pageCount - 1),
    );
    if (this.newElements && ctx.canvasStore) {
      ctx.canvasStore.elements = safeClone(this.newElements);
    }
    if (this.newTransforms) {
      ctx.editorStore.pageTransforms = { ...this.newTransforms };
    }
    ctx.editorStore.incrementRenderVersion();
  }

  undo(ctx: CommandContext): void {
    setFileBuffer(this.fileId, this.prevBuffer);
    ctx.service.loadDocumentFromBuffer(this.prevBuffer);
    ctx.editorStore.pageCount = ctx.service.document.getPageCount();
    ctx.editorStore.currentPageIndex = Math.min(
      this.prevPageIndex,
      Math.max(0, ctx.editorStore.pageCount - 1),
    );
    if (this.prevElements && ctx.canvasStore) {
      ctx.canvasStore.elements = safeClone(this.prevElements);
    }
    if (this.prevTransforms) {
      ctx.editorStore.pageTransforms = { ...this.prevTransforms };
    }
    ctx.editorStore.incrementRenderVersion();
  }

  dispose(): void {
    const mutableThis = this as { prevBuffer: ArrayBuffer | null; newBuffer: ArrayBuffer | null };
    mutableThis.prevBuffer = null;
    mutableThis.newBuffer = null;
  }
}
