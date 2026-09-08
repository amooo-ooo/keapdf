/**
 * Reactive state store for command-based undo and redo history management.
 *
 * Implements the Command Pattern with invertible operations, automatic
 * command coalescing (for continuous slider adjustments, drags, and typing),
 * and per-workspace-file history isolation.
 */

import { getContext, setContext } from 'svelte';
import type { Command, CommandContext, CommandMiddleware } from '../core/command';
import type { FileCommandHistory } from './history-types';

const HISTORY_STORE_KEY = Symbol('history-store');
const MAX_HISTORY_DEPTH = 50;

export class HistoryStore {
  /** Map of workspace file ID to its command history stacks. Kept non-reactive to avoid deep proxying 50 command payloads. */
  commandHistoryMap: Record<string, FileCommandHistory> = {};

  /** Version counter to trigger reactive updates for undo/redo availability getters. */
  historyVersion = $state(0);

  /** Active file ID reference tracked for convenience getters. */
  activeFileId = $state<string | null>(null);

  /** Mutex to prevent concurrent undo/redo/execute executions corrupting the stack. */
  private _isExecuting = $state(false);

  /** Active debounce timer for coalescing continuous property adjustments. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDebouncedCommand: { command: Command; fileId: string } | null = null;

  // Derived getters

  /** Current file command history state. */
  get activeCommandState(): FileCommandHistory | null {
    void this.historyVersion;
    const targetId = this.activeFileId ?? (Object.keys(this.commandHistoryMap).length === 1 ? Object.keys(this.commandHistoryMap)[0] : null);
    if (!targetId) return null;
    return this.commandHistoryMap[targetId] ?? null;
  }

  /** Whether undo is currently available for the active document. */
  get canUndo(): boolean {
    const cmdState = this.activeCommandState;
    return Boolean(cmdState && cmdState.past.length > 0);
  }

  /** Whether redo is currently available for the active document. */
  get canRedo(): boolean {
    const cmdState = this.activeCommandState;
    return Boolean(cmdState && cmdState.future.length > 0);
  }

  /** Description of the action that will be undone. */
  get undoDescription(): string | null {
    const cmdState = this.activeCommandState;
    if (!cmdState || cmdState.past.length === 0) return null;
    return cmdState.past[cmdState.past.length - 1].description;
  }

  /** Description of the action that will be redone. */
  get redoDescription(): string | null {
    const cmdState = this.activeCommandState;
    if (!cmdState || cmdState.future.length === 0) return null;
    return cmdState.future[cmdState.future.length - 1].description;
  }

  /** Number of available undo operations. */
  get undoCount(): number {
    return this.activeCommandState?.past.length ?? 0;
  }

  /** Number of available redo operations. */
  get redoCount(): number {
    return this.activeCommandState?.future.length ?? 0;
  }

  // Command execution and history

  /**
   * Initializes history tracking for a newly loaded workspace file.
   *
   * @param fileId The workspace file identifier.
   */
  initFile(fileId: string): void {
    this.flushDebounced();
    this.commandHistoryMap[fileId] = {
      past: [],
      future: [],
    };
    this.activeFileId = fileId;
    this.historyVersion++;
  }

  /**
   * Sets the active file ID.
   *
   * @param fileId The workspace file identifier.
   */
  setActiveFileId(fileId: string | null): void {
    this.flushDebounced();
    this.activeFileId = fileId;
    if (fileId && !this.commandHistoryMap[fileId]) {
      this.commandHistoryMap[fileId] = {
        past: [],
        future: [],
      };
    }
    this.historyVersion++;
  }

  /**
   * Executes a command and pushes it onto the history stack.
   * Clears the redo future stack and enforces maximum history depth.
   *
   * @param command The command to execute.
   * @param ctx The command context.
   * @param explicitFileId Optional explicit file ID.
   */
  /** Registered middleware pipeline for command interceptors. */
  private middlewares: CommandMiddleware[] = [];

  /**
   * Registers a middleware interceptor in the command execution pipeline.
   *
   * @param middleware The middleware function to register.
   * @return Unsubscribe function.
   */
  use(middleware: CommandMiddleware): () => void {
    this.middlewares.push(middleware);
    return () => {
      const idx = this.middlewares.indexOf(middleware);
      if (idx !== -1) {
        this.middlewares.splice(idx, 1);
      }
    };
  }

  /**
   * Executes a command and pushes it onto the history stack.
   * Clears the redo future stack and enforces maximum history depth.
   * Runs the command through any registered command middleware.
   *
   * @param command The command to execute.
   * @param ctx The command context.
   * @param explicitFileId Optional explicit file ID.
   */
  async executeCommand(
    command: Command,
    ctx: CommandContext,
    explicitFileId?: string,
  ): Promise<void> {
    if (this._isExecuting) {
      console.warn('[HistoryStore] Command dropped due to concurrent execution:', (command as any).label || command.type);
      return;
    }
    this._isExecuting = true;

    try {
      this.flushDebounced();

      let finalCmd: Command | null = null;
      // Run command through middleware pipeline before execution
      const runMiddleware = async (index: number, cmd: Command): Promise<void> => {
        if (index < this.middlewares.length) {
          await this.middlewares[index](cmd, ctx, (nextCmd) => runMiddleware(index + 1, nextCmd));
        } else {
          finalCmd = cmd;
          await cmd.execute(ctx);
        }
      };

      await runMiddleware(0, command);
      if (finalCmd) {
        this.pushCommand(finalCmd, explicitFileId);
      }
    } finally {
      this._isExecuting = false;
    }
  }

  /**
   * Pushes an already-executed command onto the past history stack.
   * Attempts to merge with the previous command if possible.
   *
   * @param command The command to record.
   * @param explicitFileId Optional explicit file ID.
   */
  pushCommand(command: Command, explicitFileId?: string): void {
    const fileId = explicitFileId ?? this.activeFileId ?? 'default-file';
    let state = this.commandHistoryMap[fileId];

    if (!state) {
      state = { past: [], future: [] };
      this.commandHistoryMap[fileId] = state;
    }

    // Attempt coalescing with previous command
    if (state.past.length > 0 && typeof command.merge === 'function') {
      const prev = state.past[state.past.length - 1];
      const merged = command.merge(prev);
      if (merged) {
        state.past[state.past.length - 1] = merged;
        state.future = [];
        this.historyVersion++;
        return;
      }
    }

    state.past.push(command);
    if (state.past.length > MAX_HISTORY_DEPTH) {
      const evicted = state.past.shift();
      evicted?.dispose?.();
    }
    for (const fCmd of state.future) {
      fCmd.dispose?.();
    }
    state.future = [];
    this.historyVersion++;
  }

  /**
   * Queues a debounced command push to coalesce rapid consecutive changes.
   * Merges with existing pending commands to ensure initial state is preserved.
   *
   * @param command The command to record.
   * @param delayMs Debounce delay in milliseconds. Defaults to 300ms.
   * @param explicitFileId Optional target file ID.
   */
  recordDebouncedCommand(command: Command, delayMs: number = 300, explicitFileId?: string): void {
    const fileId = explicitFileId ?? this.activeFileId ?? 'default-file';
    if (this.pendingDebouncedCommand && this.pendingDebouncedCommand.fileId === fileId) {
      const merged = command.merge?.(this.pendingDebouncedCommand.command);
      if (merged) {
        this.pendingDebouncedCommand = { command: merged, fileId };
      } else {
        this.flushDebounced();
        this.pendingDebouncedCommand = { command, fileId };
      }
    } else {
      this.flushDebounced();
      this.pendingDebouncedCommand = { command, fileId };
    }

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.flushDebounced();
    }, delayMs);
  }

  /**
   * Flushes any pending debounced commands immediately.
   */
  flushDebounced(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingDebouncedCommand !== null) {
      const { command, fileId } = this.pendingDebouncedCommand;
      this.pendingDebouncedCommand = null;
      this.pushCommand(command, fileId);
    }
  }

  /**
   * Undoes the most recent command for the given file ID.
   *
   * @param ctx The command context.
   * @param fileId Target file identifier. Defaults to activeFileId.
   * @return Promise resolving to true if undo was applied.
   */
  async undoCommand(ctx: CommandContext, fileId?: string): Promise<boolean> {
    if (this._isExecuting) return false;
    this._isExecuting = true;

    try {
      this.flushDebounced();
      const targetFileId = fileId ?? this.activeFileId;
      if (!targetFileId) return false;

      const state = this.commandHistoryMap[targetFileId];
      if (!state || state.past.length === 0) return false;

      const cmd = state.past.pop()!;
      try {
        await cmd.undo(ctx);
        state.future.push(cmd);
        if (state.future.length > MAX_HISTORY_DEPTH) {
          state.future.shift();
        }
        this.historyVersion++;
        return true;
      } catch (err) {
        console.error(`Failed to undo command "${cmd.description}":`, err);
        state.past.push(cmd);
        return false;
      }
    } finally {
      this._isExecuting = false;
    }
  }

  /**
   * Redoes the next command for the given file ID.
   *
   * @param ctx The command context.
   * @param fileId Target file identifier. Defaults to activeFileId.
   * @return Promise resolving to true if redo was applied.
   */
  async redoCommand(ctx: CommandContext, fileId?: string): Promise<boolean> {
    if (this._isExecuting) return false;
    this._isExecuting = true;

    try {
      this.flushDebounced();
      const targetFileId = fileId ?? this.activeFileId;
      if (!targetFileId) return false;

      const state = this.commandHistoryMap[targetFileId];
      if (!state || state.future.length === 0) return false;

      const cmd = state.future.pop()!;
      try {
        await cmd.execute(ctx);
        state.past.push(cmd);
        this.historyVersion++;
        return true;
      } catch (err) {
        console.error(`Failed to redo command "${cmd.description}":`, err);
        state.future.push(cmd);
        return false;
      }
    } finally {
      this._isExecuting = false;
    }
  }

  /**
   * Clears command history for a specific workspace file.
   *
   * @param fileId Target workspace file identifier.
   */
  clearForFile(fileId: string): void {
    this.flushDebounced();
    const state = this.commandHistoryMap[fileId];
    if (state) {
      for (const cmd of state.past) cmd.dispose?.();
      for (const cmd of state.future) cmd.dispose?.();
      delete this.commandHistoryMap[fileId];
      this.historyVersion++;
    }
  }

  /**
   * Alias for clearForFile.
   *
   * @param fileId Target workspace file identifier.
   */
  clearFile(fileId: string): void {
    this.clearForFile(fileId);
  }

  /**
   * Clears all command history across all workspace files.
   */
  clearAll(): void {
    this.flushDebounced();
    for (const state of Object.values(this.commandHistoryMap)) {
      for (const cmd of state.past) cmd.dispose?.();
      for (const cmd of state.future) cmd.dispose?.();
    }
    this.commandHistoryMap = {};
    this.activeFileId = null;
    this.historyVersion++;
  }
}

/** Provide the history store via Svelte context from a root component. */
export function provideHistoryStore(store: HistoryStore): void {
  setContext(HISTORY_STORE_KEY, store);
}

/** Retrieve the history store from Svelte context in any child component. */
export function useHistoryStore(): HistoryStore {
  const store = getContext<HistoryStore>(HISTORY_STORE_KEY);
  if (!store) {
    throw new Error('HistoryStore not found in context');
  }
  return store;
}
