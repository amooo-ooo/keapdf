/**
 * Reactive state store for undo and redo history management.
 *
 * Tracks discrete immutable snapshots of document state and canvas overlays
 * partitioned per workspace file.
 */

import { getContext, setContext } from 'svelte';
import type { FileHistoryState, HistorySnapshot } from './history-types';

const HISTORY_STORE_KEY = Symbol('history-store');
const MAX_HISTORY_DEPTH = 50;

export class HistoryStore {
  /** Map of workspace file ID to its history stack state. */
  historyMap = $state<Record<string, FileHistoryState>>({});

  /** Active file ID reference tracked for convenience getters. */
  activeFileId = $state<string | null>(null);

  /** Active debounce timer for coalescing continuous property adjustments. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDebouncedCapture: (() => HistorySnapshot) | null = null;

  // -- Derived getters --

  /** Current file history state. */
  get activeState(): FileHistoryState | null {
    if (!this.activeFileId) return null;
    return this.historyMap[this.activeFileId] ?? null;
  }

  /** Whether undo is currently available for the active document. */
  get canUndo(): boolean {
    const state = this.activeState;
    return Boolean(state && state.past.length > 0);
  }

  /** Whether redo is currently available for the active document. */
  get canRedo(): boolean {
    const state = this.activeState;
    return Boolean(state && state.future.length > 0);
  }

  /** Description of the action that will be undone. */
  get undoDescription(): string | null {
    const state = this.activeState;
    if (!state || state.past.length === 0) return null;
    return state.present?.description ?? state.past[state.past.length - 1].description;
  }

  /** Description of the action that will be redone. */
  get redoDescription(): string | null {
    const state = this.activeState;
    if (!state || state.future.length === 0) return null;
    return state.future[state.future.length - 1].description;
  }

  /** Number of available undo operations. */
  get undoCount(): number {
    return this.activeState?.past.length ?? 0;
  }

  /** Number of available redo operations. */
  get redoCount(): number {
    return this.activeState?.future.length ?? 0;
  }

  // -- Lifecycle and mutations --

  /**
   * Initializes history tracking for a newly loaded workspace file.
   *
   * @param fileId The workspace file identifier.
   * @param initialSnapshot The baseline snapshot representing the initial file state.
   */
  initFile(fileId: string, initialSnapshot: HistorySnapshot): void {
    this.flushDebounced();
    this.historyMap[fileId] = {
      past: [],
      present: initialSnapshot,
      future: [],
    };
    this.activeFileId = fileId;
  }

  /**
   * Sets the active file ID.
   *
   * @param fileId The workspace file identifier.
   */
  setActiveFileId(fileId: string | null): void {
    this.flushDebounced();
    this.activeFileId = fileId;
  }

  /**
   * Pushes a new snapshot onto the history stack of the active file.
   * Clears the redo future stack and enforces maximum history depth.
   *
   * @param snapshot The newly captured immutable history snapshot.
   */
  pushSnapshot(snapshot: HistorySnapshot): void {
    this.flushDebounced();
    const fileId = snapshot.fileId;
    let state = this.historyMap[fileId];

    if (!state) {
      this.historyMap[fileId] = {
        past: [],
        present: snapshot,
        future: [],
      };
      return;
    }

    if (state.present) {
      state.past.push(state.present);
      if (state.past.length > MAX_HISTORY_DEPTH) {
        state.past.shift();
      }
    }

    state.present = snapshot;
    state.future = [];
  }

  /**
   * Queues a debounced snapshot capture to coalesce rapid consecutive changes.
   *
   * @param captureFn Function that produces the snapshot when flushed.
   * @param delayMs Debounce delay in milliseconds. Defaults to 300ms.
   */
  recordDebounced(captureFn: () => HistorySnapshot, delayMs: number = 300): void {
    // Capture the snapshot eagerly so intermediate states are not lost if a
    // synchronous mutation triggers flushDebounced before the timer fires.
    const snapshot = captureFn();
    this.pendingDebouncedCapture = () => snapshot;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.flushDebounced();
    }, delayMs);
  }

  /**
   * Flushes any pending debounced snapshot immediately.
   */
  flushDebounced(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingDebouncedCapture !== null) {
      const fn = this.pendingDebouncedCapture;
      this.pendingDebouncedCapture = null;
      const snapshot = fn();
      this.pushSnapshot(snapshot);
    }
  }

  /**
   * Performs an undo operation for the given file ID.
   * Moves the present snapshot to future and pops the last past snapshot into present.
   *
   * @param fileId Target file identifier. Defaults to activeFileId.
   * @return The target snapshot to restore, or null if undo cannot be performed.
   */
  undo(fileId?: string): HistorySnapshot | null {
    this.flushDebounced();
    const targetFileId = fileId ?? this.activeFileId;
    if (!targetFileId) return null;

    const state = this.historyMap[targetFileId];
    if (!state || state.past.length === 0) return null;

    const previousSnapshot = state.past.pop()!;
    if (state.present) {
      state.future.push(state.present);
    }
    state.present = previousSnapshot;

    return previousSnapshot;
  }

  /**
   * Performs a redo operation for the given file ID.
   * Moves the present snapshot to past and pops the last future snapshot into present.
   *
   * @param fileId Target file identifier. Defaults to activeFileId.
   * @return The target snapshot to restore, or null if redo cannot be performed.
   */
  redo(fileId?: string): HistorySnapshot | null {
    this.flushDebounced();
    const targetFileId = fileId ?? this.activeFileId;
    if (!targetFileId) return null;

    const state = this.historyMap[targetFileId];
    if (!state || state.future.length === 0) return null;

    const nextSnapshot = state.future.pop()!;
    if (state.present) {
      state.past.push(state.present);
    }
    state.present = nextSnapshot;

    return nextSnapshot;
  }

  /**
   * Clears history for a specific workspace file.
   *
   * @param fileId The workspace file identifier to clear.
   */
  clearForFile(fileId: string): void {
    this.flushDebounced();
    delete this.historyMap[fileId];
  }

  /**
   * Clears all history state across all workspace files.
   */
  clearAll(): void {
    this.flushDebounced();
    this.historyMap = {};
    this.activeFileId = null;
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
