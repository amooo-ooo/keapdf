/**
 * Commands for OCR text replacement and text layer application.
 * Manages reversible mutations for editing scanned document text with full undo/redo parity.
 */

import type { Command, CommandContext } from '../core/command';
import type { EditableTextSpan, TextMutationOptions } from '../core/types';
import type { OcrPageResult, OcrLine, OcrWord } from '../services/ocr/ocr-types';
import { sampleBackgroundColor } from '../services/ocr/background-sampler';
import { OcrService } from '../services/ocr/ocr-service';

/**
 * Invertible command for replacing an OCR-recognized text span on a scanned PDF page.
 * Whites out original scanned bitmap glyphs with sampled paper background color
 * and renders crisp vector text on top.
 */
export class ReplaceOcrTextCommand implements Command<'replace-ocr-text'> {
  readonly type = 'replace-ocr-text' as const;
  private addedCount: number = 0;
  private removedOcrLine: OcrLine | null = null;
  private removedOcrLineIndex: number = -1;
  private removedOcrWords: OcrWord[] = [];

  constructor(
    readonly description: string,
    readonly pageIndex: number,
    readonly targetSpan: EditableTextSpan,
    readonly prevOptions: TextMutationOptions,
    readonly newOptions: TextMutationOptions,
    readonly sampledBgColor?: string,
    readonly timestamp: number = Date.now()
  ) {}

  execute(ctx: CommandContext): void {
    const doc = ctx.service.document;
    const page = doc.getPage(this.pageIndex);
    const countBefore = page.getObjectCount();

    const isDeletion = !this.newOptions.text || this.newOptions.text.trim().length === 0;
    const updatedFontSize = this.newOptions.fontSize ?? this.targetSpan.fontSize;
    const updatedFontFamily = this.newOptions.fontFamily ?? this.targetSpan.fontFamily ?? 'Helvetica';
    const updatedColor = this.newOptions.color ?? this.targetSpan.color ?? { r: 0, g: 0, b: 0, a: 255 };

    // 1. Resolve background whiteout color
    let bgColor = this.newOptions.backgroundColor || this.sampledBgColor;
    if (!bgColor) {
      try {
        const renderRes = page.render(1.0);
        const sampled = sampleBackgroundColor(renderRes.canvas, {
          left: this.targetSpan.left,
          top: this.targetSpan.top,
          width: this.targetSpan.width,
          height: this.targetSpan.height,
        });
        bgColor = sampled.hex;
      } catch {
        bgColor = '#ffffff';
      }
    }

    // 2. Draw solid background patch covering old scanned bitmap glyphs
    const patchLeft = Math.max(0, this.targetSpan.left - 1.5);
    const patchTop = Math.max(0, this.targetSpan.top - 1.0);
    const patchWidth = this.targetSpan.width + 3.0;
    const patchHeight = this.targetSpan.height + 2.0;

    page.drawRectangle({
      x: patchLeft,
      y: patchTop,
      width: patchWidth,
      height: patchHeight,
      fill: bgColor,
      strokeWidth: 0,
    });

    // 3. Draw new replacement vector text on top (if not deleted)
    if (!isDeletion && this.newOptions.text) {
      const cssColor = typeof updatedColor === 'string'
        ? updatedColor
        : `rgba(${updatedColor.r}, ${updatedColor.g}, ${updatedColor.b}, ${(updatedColor.a ?? 255) / 255})`;

      page.drawText({
        text: this.newOptions.text,
        fontSize: updatedFontSize,
        fontFamily: updatedFontFamily,
        x: this.targetSpan.left,
        y: this.targetSpan.top,
        color: cssColor,
      });
    }

    page.generateContent();
    const countAfter = page.getObjectCount();
    this.addedCount = Math.max(0, countAfter - countBefore);

    // 4. Synchronize pageOcrResults to prevent duplicate ghost spans
    const ocrResult = ctx.editorStore.pageOcrResults?.get(this.pageIndex);
    if (ocrResult) {
      const lineIdx = ocrResult.lines.findIndex((l) => {
        return Math.hypot(l.bbox.left - this.targetSpan.left, l.bbox.top - this.targetSpan.top) < 6.0 ||
               l.text.trim() === this.targetSpan.text.trim();
      });
      if (lineIdx !== -1) {
        this.removedOcrLine = ocrResult.lines[lineIdx];
        this.removedOcrLineIndex = lineIdx;
        ocrResult.lines.splice(lineIdx, 1);
        this.removedOcrWords = ocrResult.words.filter(
          (w) => Math.hypot(w.bbox.left - this.targetSpan.left, w.bbox.top - this.targetSpan.top) < 10.0
        );
        ocrResult.words = ocrResult.words.filter((w) => !this.removedOcrWords.includes(w));
      }
    }

    doc.invalidatePage(this.pageIndex);

    ctx.editorStore.incrementPageVersion(this.pageIndex);
    ctx.editorStore.incrementRenderVersion();

    // 5. Update cached spans: replace OCR span with new native text span
    this.updateCachedSpans(ctx, false);
  }

  undo(ctx: CommandContext): void {
    const doc = ctx.service.document;
    const page = doc.getPage(this.pageIndex);

    if (this.addedCount > 0) {
      const currentCount = page.getObjectCount();
      for (let i = 0; i < this.addedCount; i++) {
        page.removeObject(currentCount - 1 - i);
      }
      page.generateContent();
    }

    // Restore OCR line in pageOcrResults
    const ocrResult = ctx.editorStore.pageOcrResults?.get(this.pageIndex);
    if (ocrResult && this.removedOcrLine) {
      if (this.removedOcrLineIndex >= 0 && this.removedOcrLineIndex <= ocrResult.lines.length) {
        ocrResult.lines.splice(this.removedOcrLineIndex, 0, this.removedOcrLine);
      } else {
        ocrResult.lines.push(this.removedOcrLine);
      }
      if (this.removedOcrWords.length > 0) {
        ocrResult.words.push(...this.removedOcrWords);
      }
    }

    doc.invalidatePage(this.pageIndex);

    ctx.editorStore.incrementPageVersion(this.pageIndex);
    ctx.editorStore.incrementRenderVersion();

    this.updateCachedSpans(ctx, true);
  }

  private updateCachedSpans(ctx: CommandContext, isUndo: boolean): void {
    const cached = ctx.service.document.getCachedPageSpans(this.pageIndex);
    if (!cached) return;

    if (isUndo) {
      // Restore original OCR span
      const existingIdx = cached.textSpans.findIndex((s) => s.id === this.targetSpan.id);
      if (existingIdx !== -1) {
        cached.textSpans[existingIdx] = { ...this.targetSpan };
      } else {
        cached.textSpans.push({ ...this.targetSpan });
      }
    } else {
      // Mark as replaced native span
      const existingIdx = cached.textSpans.findIndex((s) => s.id === this.targetSpan.id);
      if (existingIdx !== -1) {
        cached.textSpans[existingIdx] = {
          ...this.targetSpan,
          text: this.newOptions.text ?? this.targetSpan.text,
          fontSize: this.newOptions.fontSize ?? this.targetSpan.fontSize,
          color: this.newOptions.color ?? this.targetSpan.color,
          isOcr: false, // Now native editable text
        };
      }
    }
  }
}

/**
 * Command for applying an OCR recognized text layer to a page.
 */
export class ApplyOcrLayerCommand implements Command<'apply-ocr-layer'> {
  readonly type = 'apply-ocr-layer' as const;
  private addedCount: number = 0;

  constructor(
    readonly description: string,
    readonly pageIndex: number,
    readonly ocrResult: OcrPageResult,
    readonly timestamp: number = Date.now()
  ) {}

  execute(ctx: CommandContext): void {
    const doc = ctx.service.document;
    const page = doc.getPage(this.pageIndex);
    const countBefore = page.getObjectCount();

    // Embed searchable invisible text layer into the PDF
    OcrService.getInstance().embedSearchableTextLayer(page, this.ocrResult);
    page.generateContent();

    const countAfter = page.getObjectCount();
    this.addedCount = Math.max(0, countAfter - countBefore);
    doc.invalidatePage(this.pageIndex);

    ctx.editorStore.incrementPageVersion(this.pageIndex);
    ctx.editorStore.incrementRenderVersion();
  }

  undo(ctx: CommandContext): void {
    const doc = ctx.service.document;
    const page = doc.getPage(this.pageIndex);

    if (this.addedCount > 0) {
      const currentCount = page.getObjectCount();
      for (let i = 0; i < this.addedCount; i++) {
        page.removeObject(currentCount - 1 - i);
      }
      page.generateContent();
    }

    doc.invalidatePage(this.pageIndex);

    ctx.editorStore.incrementPageVersion(this.pageIndex);
    ctx.editorStore.incrementRenderVersion();
  }
}
