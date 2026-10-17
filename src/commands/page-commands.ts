/**
 * Commands for page transforms and document-level operations.
 */

import type { Command, CommandContext } from '../core/command';
import type { PageTransform } from '../stores/types';
import type { CanvasElement, PathElement, Point } from '../stores/canvas-types';
import { setFileBuffer } from '../stores/editor.svelte';
import { safeClone } from '../utils/clone-utils';

/**
 * Stores a buffer for a workspace file and reloads it as the active document,
 * reusing the active password so encrypted documents reopen on undo and redo.
 *
 * @param ctx Command context.
 * @param fileId Workspace file owning the buffer.
 * @param buffer Document bytes to restore.
 */
function restoreActiveFileBuffer(ctx: CommandContext, fileId: string, buffer: ArrayBuffer): void {
  setFileBuffer(fileId, buffer);
  if (typeof ctx.service.reloadDocumentFromBuffer === 'function') {
    ctx.service.reloadDocumentFromBuffer(buffer);
  } else {
    ctx.service.loadDocumentFromBuffer(buffer);
  }
}

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
  private prevPageElements: CanvasElement[] | null = null;
  private pendingElementRotationDims: { widthPts: number; heightPts: number } | null = null;

  constructor(
    readonly description: string,
    readonly pageIndex: number,
    readonly degreesDelta: 90 | 180 | 270 = 90,
    public syncBufferOnExecute: boolean = true,
    public syncBufferOnUndo: boolean = true,
    public emitRenderOnExecute: boolean = true,
  ) {}

  /**
   * Restores full buffer synchronisation and render invalidation for subsequent redo executions.
   */
  enableFullExecutionSync(): void {
    this.syncBufferOnExecute = true;
    this.emitRenderOnExecute = true;
  }

  /**
   * Applies deferred canvas element coordinate rotation when a background-rotated page commits its bitmap.
   *
   * @param ctx Command execution context.
   */
  commitPendingElementRotation(ctx: CommandContext): void {
    if (!this.pendingElementRotationDims) return;
    const dims = this.pendingElementRotationDims;
    this.pendingElementRotationDims = null;
    this.applyElementRotation(ctx, dims);
  }

  private applySpanAndFormFieldRotation(
    ctx: CommandContext,
    pageDims: { widthPts: number; heightPts: number },
    delta: 90 | 180 | 270,
  ): void {
    if (Array.isArray(ctx.editorStore.selectedSpans) && ctx.editorStore.selectedSpans.length > 0) {
      let hasChanges = false;
      const nextSelectedSpans = ctx.editorStore.selectedSpans.map((span) => {
        if (span.pageIndex !== this.pageIndex) return span;
        hasChanges = true;
        const cx = span.left + span.width / 2;
        const cy = span.top + span.height / 2;
        const newCenter = transformPointForPageRotation(
          { x: cx, y: cy },
          delta,
          pageDims.widthPts,
          pageDims.heightPts,
        );
        return {
          ...span,
          left: Math.round((newCenter.x - span.width / 2) * 10) / 10,
          top: Math.round((newCenter.y - span.height / 2) * 10) / 10,
          width: span.width,
          height: span.height,
          rotation: (((span.rotation || 0) + delta) % 360 + 360) % 360,
        };
      });
      if (hasChanges) {
        ctx.editorStore.selectedSpans = nextSelectedSpans;
      }
    }

    if (ctx.editorStore.activeFormField?.pageIndex === this.pageIndex) {
      const af = ctx.editorStore.activeFormField;
      const cx = af.left + af.width / 2;
      const cy = af.top + af.height / 2;
      const newCenter = transformPointForPageRotation(
        { x: cx, y: cy },
        delta,
        pageDims.widthPts,
        pageDims.heightPts,
      );
      ctx.editorStore.activeFormField = {
        ...af,
        left: Math.round((newCenter.x - af.width / 2) * 10) / 10,
        top: Math.round((newCenter.y - af.height / 2) * 10) / 10,
        width: af.width,
        height: af.height,
        rotation: (((af.rotation || 0) + delta) % 360 + 360) % 360,
      };
    }

    if (typeof ctx.editorStore.incrementFormFieldVersion === 'function') {
      ctx.editorStore.incrementFormFieldVersion();
    }
  }

  private applyElementRotation(
    ctx: CommandContext,
    pageDims: { widthPts: number; heightPts: number },
  ): void {
    this.applySpanAndFormFieldRotation(ctx, pageDims, this.degreesDelta);
    if (!ctx.canvasStore) return;
    const elements = ctx.canvasStore.getElementsByPage(this.pageIndex);
    this.prevPageElements = safeClone(elements);
    for (const el of elements) {
      if (el.kind === 'form-field') {
        const cx = el.x + el.width / 2;
        const cy = el.y + el.height / 2;
        const newCenter = transformPointForPageRotation(
          { x: cx, y: cy },
          this.degreesDelta,
          pageDims.widthPts,
          pageDims.heightPts,
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
          pageDims.heightPts,
        );
        const updates: Partial<CanvasElement> = {
          x: Math.round((newCenter.x - el.width / 2) * 10) / 10,
          y: Math.round((newCenter.y - el.height / 2) * 10) / 10,
          rotation: (((el.rotation || 0) + this.degreesDelta) % 360 + 360) % 360,
        };
        if (el.kind === 'path' && 'points' in el) {
          const pathEl = el as PathElement;
          const rotatedPoints = pathEl.points.map((p: Point) => {
            const rp = transformPointForPageRotation(
              p,
              this.degreesDelta,
              pageDims.widthPts,
              pageDims.heightPts,
            );
            return {
              x: Math.round(rp.x * 10) / 10,
              y: Math.round(rp.y * 10) / 10,
            };
          });
          (updates as Partial<PathElement>).points = rotatedPoints;
          if (rotatedPoints.length > 0) {
            let minX = rotatedPoints[0].x;
            let maxX = rotatedPoints[0].x;
            let minY = rotatedPoints[0].y;
            let maxY = rotatedPoints[0].y;
            for (let i = 1; i < rotatedPoints.length; i++) {
              if (rotatedPoints[i].x < minX) minX = rotatedPoints[i].x;
              if (rotatedPoints[i].x > maxX) maxX = rotatedPoints[i].x;
              if (rotatedPoints[i].y < minY) minY = rotatedPoints[i].y;
              if (rotatedPoints[i].y > maxY) maxY = rotatedPoints[i].y;
            }
            updates.x = minX;
            updates.y = minY;
            updates.width = Math.max(1, Math.round((maxX - minX) * 10) / 10);
            updates.height = Math.max(1, Math.round((maxY - minY) * 10) / 10);
          }
          updates.rotation = el.rotation || 0;
        }
        ctx.canvasStore.updateElement(el.id, updates);
      }
    }
  }

  /**
   * Synchronises the active workspace file buffer with the current WASM document state.
   *
   * @param ctx Command execution context.
   */
  syncDocumentBuffer(ctx: CommandContext): void {
    const fileId = ctx.editorStore.activeWorkspaceFileId;
    if (fileId) {
      const savedBytes = ctx.service.document.save();
      const newBuffer = savedBytes.buffer.slice(
        savedBytes.byteOffset,
        savedBytes.byteOffset + savedBytes.byteLength,
      ) as ArrayBuffer;
      setFileBuffer(fileId, newBuffer);
    }
  }

  execute(ctx: CommandContext): void {
    const pageDims = ctx.service.document.getPage(this.pageIndex).getDimensions();

    ctx.service.document.rotatePage(this.pageIndex, this.degreesDelta);

    // Atomically reconcile pending optimistic rotation before Svelte reactive version increment
    if (typeof ctx.editorStore?.subtractOptimisticRotation === 'function') {
      ctx.editorStore.subtractOptimisticRotation(this.pageIndex, this.degreesDelta);
    }

    if (ctx.editorStore.pageTransforms[this.pageIndex]) {
      const currentRotation = ctx.editorStore.pageTransforms[this.pageIndex].rotation || 0;
      if (currentRotation !== 0) {
        ctx.editorStore.pageTransforms[this.pageIndex].rotation =
          (currentRotation - this.degreesDelta + 360) % 360;
      }
    }

    if (this.emitRenderOnExecute) {
      if (typeof ctx.editorStore?.clearPendingRenderRotation === 'function') {
        ctx.editorStore.clearPendingRenderRotation(this.pageIndex);
      }
      this.pendingElementRotationDims = null;
      this.applyElementRotation(ctx, pageDims);
    } else {
      if (typeof ctx.editorStore?.addPendingRenderRotation === 'function') {
        ctx.editorStore.addPendingRenderRotation(this.pageIndex, this.degreesDelta);
      }
      this.pendingElementRotationDims = pageDims;
    }

    if (this.syncBufferOnExecute) {
      this.syncDocumentBuffer(ctx);
    }

    if (this.emitRenderOnExecute) {
      ctx.editorStore.incrementPageVersion(this.pageIndex);
      ctx.editorStore.incrementRenderVersion();
    }
  }

  undo(ctx: CommandContext): void {
    const reverseDelta = (360 - this.degreesDelta) as 90 | 180 | 270;
    const pageDims = ctx.service.document.getPage(this.pageIndex).getDimensions();

    ctx.service.document.rotatePage(this.pageIndex, reverseDelta);

    if (typeof ctx.editorStore?.clearPendingRenderRotation === 'function') {
      ctx.editorStore.clearPendingRenderRotation(this.pageIndex);
    }
    this.pendingElementRotationDims = null;
    
    if (ctx.editorStore.pageTransforms[this.pageIndex]) {
      const currentRotation = ctx.editorStore.pageTransforms[this.pageIndex].rotation || 0;
      if (currentRotation !== 0) {
        ctx.editorStore.pageTransforms[this.pageIndex].rotation = (currentRotation + this.degreesDelta) % 360;
      }
    }

    this.applySpanAndFormFieldRotation(ctx, pageDims, reverseDelta);

    if (ctx.canvasStore) {
      if (this.prevPageElements) {
        for (const prevEl of this.prevPageElements) {
          ctx.canvasStore.updateElement(prevEl.id, safeClone(prevEl));
        }
      } else {
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
              const rotatedPoints = pathEl.points.map((p: Point) => {
                const rp = transformPointForPageRotation(p, reverseDelta, pageDims.widthPts, pageDims.heightPts);
                return {
                  x: Math.round(rp.x * 10) / 10,
                  y: Math.round(rp.y * 10) / 10,
                };
              });
              (updates as Partial<PathElement>).points = rotatedPoints;
              if (rotatedPoints.length > 0) {
                let minX = rotatedPoints[0].x;
                let maxX = rotatedPoints[0].x;
                let minY = rotatedPoints[0].y;
                let maxY = rotatedPoints[0].y;
                for (let i = 1; i < rotatedPoints.length; i++) {
                  if (rotatedPoints[i].x < minX) minX = rotatedPoints[i].x;
                  if (rotatedPoints[i].x > maxX) maxX = rotatedPoints[i].x;
                  if (rotatedPoints[i].y < minY) minY = rotatedPoints[i].y;
                  if (rotatedPoints[i].y > maxY) maxY = rotatedPoints[i].y;
                }
                updates.x = minX;
                updates.y = minY;
                updates.width = Math.max(1, Math.round((maxX - minX) * 10) / 10);
                updates.height = Math.max(1, Math.round((maxY - minY) * 10) / 10);
              }
              updates.rotation = el.rotation || 0;
            }
            ctx.canvasStore.updateElement(el.id, updates);
          }
        }
      }
    }
    
    if (this.syncBufferOnUndo) {
      this.syncDocumentBuffer(ctx);
    }

    ctx.editorStore.incrementPageVersion(this.pageIndex);
    ctx.editorStore.incrementRenderVersion();
  }
}

/**
 * Command for destructive WASM mutations (e.g., delete page, duplicate page, rotate page, sanitise).
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
    readonly prevFormFieldValues?: Record<string, string | boolean>,
    readonly newFormFieldValues?: Record<string, string | boolean>,
  ) {}

  execute(ctx: CommandContext): void {
    restoreActiveFileBuffer(ctx, this.fileId, this.newBuffer);
    if (this.newFormFieldValues && typeof ctx.service.document.setAllFormFieldValues === 'function') {
      ctx.service.document.setAllFormFieldValues(this.newFormFieldValues);
    }
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
    restoreActiveFileBuffer(ctx, this.fileId, this.prevBuffer);
    if (this.prevFormFieldValues && typeof ctx.service.document.setAllFormFieldValues === 'function') {
      ctx.service.document.setAllFormFieldValues(this.prevFormFieldValues);
    }
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

/**
 * Command for unlocking AcroForm fields and widget annotations with full undo/redo parity.
 */
export class UnlockFormsCommand implements Command<'unlock-forms'> {
  readonly type = 'unlock-forms' as const;

  constructor(
    readonly description: string,
    readonly fileId: string,
    readonly prevBuffer: ArrayBuffer,
    readonly newBuffer: ArrayBuffer,
    readonly fieldsUnlockedCount: number,
    readonly annotationsUnlockedCount: number,
  ) {}

  execute(ctx: CommandContext): void {
    restoreActiveFileBuffer(ctx, this.fileId, this.newBuffer);
    ctx.editorStore.pageCount = ctx.service.document.getPageCount();
    ctx.editorStore.incrementRenderVersion();
  }

  undo(ctx: CommandContext): void {
    restoreActiveFileBuffer(ctx, this.fileId, this.prevBuffer);
    ctx.editorStore.pageCount = ctx.service.document.getPageCount();
    ctx.editorStore.incrementRenderVersion();
  }

  dispose(): void {
    const mutableThis = this as { prevBuffer: ArrayBuffer | null; newBuffer: ArrayBuffer | null };
    mutableThis.prevBuffer = null;
    mutableThis.newBuffer = null;
  }
}

