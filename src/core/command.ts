/**
 * Core command architecture for invertible editor operations.
 *
 * Inspired by ProseMirror transactions and Figma's command pattern.
 * All document and canvas mutations are expressed as typed, invertible
 * Command objects that can be executed, undone, composed, and coalesced.
 */

import type { EditorStore } from '../stores/editor.svelte';
import type { CanvasStore } from '../stores/canvas.svelte';
import type { PdfEditorService } from '../services/pdf-editor';

/**
 * Execution context provided to commands during execution and undo.
 */
export interface CommandContext {
  /** The global editor state store. */
  editorStore: EditorStore;
  /** The canvas overlay element store. */
  canvasStore: CanvasStore;
  /** The PDF editor service managing PDFium engine and document facades. */
  service: PdfEditorService;
}

/**
 * A typed, invertible editor command.
 *
 * Each command represents an atomic mutation that knows how to apply itself
 * to the editor state (`execute`) and how to reverse itself (`undo`).
 *
 * @template T The string literal command type discriminant.
 */
export interface Command<T extends string = string> {
  /** Unique command type discriminant. */
  readonly type: T;

  /** Human-readable description displayed in undo/redo tooltips and history lists. */
  readonly description: string;

  /**
   * Applies the mutation to the editor state.
   *
   * @param ctx The command execution context.
   */
  execute(ctx: CommandContext): void | Promise<void>;

  /**
   * Inverts the mutation, restoring the state prior to execution.
   *
   * @param ctx The command execution context.
   */
  undo(ctx: CommandContext): void | Promise<void>;

  /**
   * Optional: attempts to coalesce this command with an immediately preceding command
   * of the same type. Used to merge rapid continuous updates (e.g. dragging an element
   * or adjusting a slider) into a single undo step.
   *
   * @param previous The previous command on top of the history stack.
   * @return The merged command if coalescence succeeded, or null if kept separate.
   */
  merge?(previous: Command): Command | null;

  /**
   * Optional cleanup hook called when the command is evicted or cleared from history.
   */
  dispose?(): void;
}

/**
 * Middleware function intercepting command execution.
 *
 * Can be used for logging, validation, profiling, and plugin hooks.
 */
export type CommandMiddleware = (
  command: Command,
  ctx: CommandContext,
  next: (cmd: Command) => Promise<void> | void
) => Promise<void> | void;

/**
 * Compound command that batches multiple atomic commands into a single transaction.
 *
 * Commands execute in forward order and are undone in reverse order.
 * This guarantees all-or-nothing atomicity for multi-step mutations (e.g.
 * extracting a text span hides the native span AND creates an overlay element).
 */
export class CompoundCommand implements Command<'compound'> {
  readonly type = 'compound' as const;

  constructor(
    readonly description: string,
    readonly commands: Command[],
  ) {}

  async execute(ctx: CommandContext): Promise<void> {
    for (let i = 0; i < this.commands.length; i++) {
      try {
        await this.commands[i].execute(ctx);
      } catch (err) {
        // Rollback previously executed commands
        for (let j = i - 1; j >= 0; j--) {
          try {
            await this.commands[j].undo(ctx);
          } catch (undoErr) {
            // Best-effort rollback, swallow errors
          }
        }
        throw err;
      }
    }
  }

  async undo(ctx: CommandContext): Promise<void> {
    // Undo in reverse order
    for (let i = this.commands.length - 1; i >= 0; i--) {
      try {
        await this.commands[i].undo(ctx);
      } catch (err) {
        // Rollback previously undone commands
        for (let j = i + 1; j < this.commands.length; j++) {
          try {
            await this.commands[j].execute(ctx);
          } catch (redoErr) {
            // Best-effort rollback, swallow errors
          }
        }
        throw err;
      }
    }
  }
}
