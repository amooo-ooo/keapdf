/**
 * Commands for managing native PDF text and object span visibility.
 *
 * Used when user replaces or extracts text/images directly from the underlying PDF.
 */

import type { Command, CommandContext } from '../core/command';

/**
 * Command to hide a native PDF span (e.g. when replacing or extracting it to canvas).
 */
export class HideSpanCommand implements Command<'hide-span'> {
  readonly type = 'hide-span' as const;

  constructor(
    readonly description: string,
    readonly spanId: string,
  ) {}

  execute(ctx: CommandContext): void {
    ctx.editorStore.hiddenSpanIds.add(this.spanId);
  }

  undo(ctx: CommandContext): void {
    ctx.editorStore.hiddenSpanIds.delete(this.spanId);
  }
}

/**
 * Command to unhide a previously hidden native PDF span.
 */
export class ShowSpanCommand implements Command<'show-span'> {
  readonly type = 'show-span' as const;

  constructor(
    readonly description: string,
    readonly spanId: string,
  ) {}

  execute(ctx: CommandContext): void {
    ctx.editorStore.hiddenSpanIds.delete(this.spanId);
  }

  undo(ctx: CommandContext): void {
    ctx.editorStore.hiddenSpanIds.add(this.spanId);
  }
}

/**
 * Command to mark a native AcroForm field for removal upon PDF export.
 */
export class RemoveAcroFormFieldCommand implements Command<'remove-acro-form-field'> {
  readonly type = 'remove-acro-form-field' as const;
  readonly description: string;
  readonly fieldName: string;

  constructor(arg1: string, arg2?: string) {
    if (arg2 !== undefined) {
      this.description = arg1;
      this.fieldName = arg2;
    } else {
      this.description = `Remove AcroForm field ${arg1}`;
      this.fieldName = arg1;
    }
  }

  execute(ctx: CommandContext): void {
    if (this.fieldName) {
      ctx.service.document.markAcroFormFieldRemoved(this.fieldName);
    }
  }

  undo(ctx: CommandContext): void {
    if (this.fieldName) {
      ctx.service.document.unmarkAcroFormFieldRemoved(this.fieldName);
    }
  }
}
