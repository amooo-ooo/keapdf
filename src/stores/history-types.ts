/**
 * Type definitions for the PDF editor history and undo/redo system.
 */

import type { CanvasElement } from './canvas-types';
import type { PageTransform } from './types';

/**
 * Immutable snapshot representing a discrete state in the editor history.
 */
export interface HistorySnapshot {
  /** Unique snapshot identifier. */
  readonly id: string;
  /** Human-readable description of the action that produced this snapshot. */
  readonly description: string;
  /** Epoch timestamp in milliseconds when the snapshot was recorded. */
  readonly timestamp: number;
  /** Unique identifier of the workspace file this snapshot belongs to. */
  readonly fileId: string;
  /** File name at the time of the snapshot. */
  readonly fileName: string;
  /** Zero-based active page index. */
  readonly pageIndex: number;
  /** Document binary payload. Shared by reference when PDF structure is unchanged. */
  readonly documentBuffer: ArrayBuffer;
  /** Deep clone of canvas overlay elements. */
  readonly canvasElements: CanvasElement[];
  /** Visual page transforms (rotations, scales). */
  readonly pageTransforms: Record<number, PageTransform>;
  /** Set of hidden span IDs for active inline edits or extracted objects. */
  readonly hiddenSpanIds: string[];
  /** Currently selected canvas element ID, or null. */
  readonly selectedElementId: string | null;
}

/**
 * History stacks for a single workspace file.
 */
export interface FileHistoryState {
  /** Stack of past snapshots for undo. */
  past: HistorySnapshot[];
  /** Current active snapshot. */
  present: HistorySnapshot | null;
  /** Stack of future snapshots for redo. */
  future: HistorySnapshot[];
}

/**
 * Options for recording a history snapshot.
 */
export interface SnapshotOptions {
  /** Whether to force serialization of the underlying PDFium document. */
  forcePdfSave?: boolean;
  /** Optional key for coalescing consecutive rapid mutations. */
  coalesceKey?: string;
}
