/**
 * Invertible commands for native PDF text editing, positioning, and deletion.
 *
 * Each command manages text modifications with complete undo/redo invertibility
 * and automatic coalescing for rapid continuous property adjustments.
 */

import type { Command, CommandContext } from '../core/command';
import type { EditableTextSpan, TextMutationOptions } from '../core/types';

/**
 * Command to replace or modify a native PDF text span with new content and formatting.
 */
const COALESCE_WINDOW_MS = 1000;

export class ReplaceTextCommand implements Command<'replace-text'> {
  readonly type = 'replace-text' as const;

  constructor(
    readonly description: string,
    readonly pageIndex: number,
    readonly targetSpan: EditableTextSpan,
    readonly prevOptions: TextMutationOptions,
    readonly newOptions: TextMutationOptions,
    readonly timestamp: number = Date.now(),
  ) {}

  execute(ctx: CommandContext): void {
    ctx.service.document.replaceTextSpan(this.pageIndex, this.targetSpan, this.newOptions);
    ctx.editorStore.incrementPageVersion(this.pageIndex);
    this.updateSelection(ctx, this.newOptions);
  }

  undo(ctx: CommandContext): void {
    ctx.service.document.replaceTextSpan(this.pageIndex, this.targetSpan, this.prevOptions);
    ctx.editorStore.incrementPageVersion(this.pageIndex);
    this.updateSelection(ctx, this.prevOptions);
  }

  private updateSelection(ctx: CommandContext, options: TextMutationOptions): void {
    try {
      const updatedSpans = ctx.service.document.extractTextSpans(this.pageIndex);
      const targetLeft = options.left !== undefined ? options.left : this.targetSpan.left;
      let matchingSpan = updatedSpans.find((s) => s.id === this.targetSpan.id);
      if (!matchingSpan) {
        let minDistance = Infinity;
        for (const s of updatedSpans) {
          const dist = Math.hypot(s.left - targetLeft, s.top - this.targetSpan.top);
          if (dist <= 8.0 && dist < minDistance) {
            minDistance = dist;
            matchingSpan = s;
          }
        }
      }
      if (matchingSpan) {
        if (options.underline !== undefined) matchingSpan.underline = options.underline;
        if (options.strikethrough !== undefined) matchingSpan.strikethrough = options.strikethrough;
        if (options.backgroundColor !== undefined) matchingSpan.backgroundColor = options.backgroundColor;
        if (options.letterSpacing !== undefined) matchingSpan.letterSpacing = options.letterSpacing;
        if (options.textAlign !== undefined) matchingSpan.textAlign = options.textAlign;
        ctx.editorStore.selectedSpan = matchingSpan;
      }
    } catch {
      // Best-effort selection update
    }
  }

  merge(previous: Command): Command | null {
    if (
      previous instanceof ReplaceTextCommand &&
      previous.pageIndex === this.pageIndex &&
      previous.targetSpan.id === this.targetSpan.id &&
      Math.abs(this.timestamp - previous.timestamp) < COALESCE_WINDOW_MS
    ) {
      return new ReplaceTextCommand(
        this.description,
        this.pageIndex,
        this.targetSpan,
        previous.prevOptions,
        this.newOptions,
        previous.timestamp,
      );
    }
    return null;
  }
}

/**
 * Command to reposition a native PDF text span on the page.
 */
export class PositionTextCommand implements Command<'position-text'> {
  readonly type = 'position-text' as const;

  constructor(
    readonly description: string,
    readonly pageIndex: number,
    readonly targetSpan: EditableTextSpan,
    readonly prevLeft: number,
    readonly prevTop: number,
    readonly newLeft: number,
    readonly newTop: number,
    readonly timestamp: number = Date.now(),
  ) {}

  execute(ctx: CommandContext): void {
    ctx.service.document.positionTextSpan(this.pageIndex, this.targetSpan, this.newLeft, this.newTop);
    ctx.editorStore.incrementPageVersion(this.pageIndex);
  }

  undo(ctx: CommandContext): void {
    ctx.service.document.positionTextSpan(this.pageIndex, this.targetSpan, this.prevLeft, this.prevTop);
    ctx.editorStore.incrementPageVersion(this.pageIndex);
  }

  merge(previous: Command): Command | null {
    if (
      previous instanceof PositionTextCommand &&
      previous.pageIndex === this.pageIndex &&
      previous.targetSpan.id === this.targetSpan.id &&
      Math.abs(this.timestamp - previous.timestamp) < COALESCE_WINDOW_MS
    ) {
      return new PositionTextCommand(
        this.description,
        this.pageIndex,
        this.targetSpan,
        previous.prevLeft,
        previous.prevTop,
        this.newLeft,
        this.newTop,
        previous.timestamp,
      );
    }
    return null;
  }
}

/**
 * Command to delete a native PDF text span.
 */
export class DeleteTextCommand implements Command<'delete-text'> {
  readonly type = 'delete-text' as const;

  constructor(
    readonly description: string,
    readonly pageIndex: number,
    readonly targetSpan: EditableTextSpan,
  ) {}

  execute(ctx: CommandContext): void {
    ctx.service.document.deleteTextSpan(this.pageIndex, this.targetSpan);
    if (ctx.editorStore.selectedSpan?.id === this.targetSpan.id) {
      ctx.editorStore.clearSelection();
    }
    ctx.editorStore.incrementPageVersion(this.pageIndex);
  }

  undo(ctx: CommandContext): void {
    ctx.service.document.replaceTextSpan(this.pageIndex, this.targetSpan, {
      text: this.targetSpan.text,
      fontSize: this.targetSpan.fontSize,
      fontFamily: this.targetSpan.fontFamily,
      color: this.targetSpan.color,
      lineHeight: this.targetSpan.lineHeight,
      fontWeight: this.targetSpan.fontWeight,
      fontStyle: this.targetSpan.fontStyle,
      left: this.targetSpan.left,
      top: this.targetSpan.top,
      lines: this.targetSpan.lines,
      reflowParagraph: true,
    });
    ctx.editorStore.incrementPageVersion(this.pageIndex);
  }
}
