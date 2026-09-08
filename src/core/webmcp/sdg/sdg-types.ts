/**
 * Semantic Document Graph (SDG) type definitions.
 *
 * Implements the addressable, stable document representation defined
 * in Section 4 of webmcp-pdf-editor-spec.md.
 */

/**
 * Node types recognized by the Semantic Document Graph.
 */
export type SdgNodeType =
  | 'heading'
  | 'paragraph'
  | 'list_item'
  | 'table'
  | 'table_cell'
  | 'figure'
  | 'form_field';

/**
 * Provenance origin of an SDG node.
 */
export type SdgProvenance = 'tagged' | 'synthesised';

/**
 * Sub-block text run with uniform font styling.
 */
export interface SdgRun {
  /** Stable identifier, namespaced under parent block (e.g. run_0042_0). */
  id: string;
  /** Exact text of the run. */
  text: string;
  /** Embedded font name or normalized equivalent. */
  font: string;
  /** Font size in points. */
  size: number;
  /** Whether the text is bold. */
  bold?: boolean;
  /** Whether the text is italic. */
  italic?: boolean;
  /** Hex RGB color string (e.g. #112233). */
  color?: string;
}

/**
 * Bounding box coordinates in PDF user-space points [x0, y0, x1, y1].
 */
export type SdgBoundingBox = [number, number, number, number];

/**
 * Core node in the Semantic Document Graph.
 */
export interface SdgNode {
  /** Stable session identifier. Never reassigned across mutations. */
  id: string;
  /** Semantic content type. */
  type: SdgNodeType;
  /** Heading level (1-6). Present only if type is heading. */
  level?: number;
  /** Zero-indexed page number where this node resides. */
  page: number;
  /** Bounding box in PDF user-space units [x0, y0, x1, y1]. */
  bbox: SdgBoundingBox;
  /** Normalised text content. Empty for non-text container nodes like table. */
  text: string;
  /** Ordered sub-block spans of uniform formatting. */
  runs?: SdgRun[];
  /** Identifier of containing parent node, or null for root-level blocks. */
  parentId: string | null;
  /** Ordered list of child node identifiers. */
  childIds: string[];
  /** Provenance indicating if derived from PDF tags or synthesised heuristically. */
  provenance: SdgProvenance;
  /** Confidence score between 0.0 and 1.0 (always 1.0 for tagged). */
  confidence: number;
  /** Reading order confidence score between 0.0 and 1.0. */
  readingOrderConfidence?: number;

  /** Table row count (present only if type is table). */
  rows?: number;
  /** Table column count (present only if type is table). */
  cols?: number;
  /** Matrix of cell identifiers mapped by [row][col] (table only). */
  cellIds?: string[][];

  /** Optional form field kind if type is form_field. */
  fieldKind?: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'signature';
}

/**
 * Concise node representation returned by read tools when detail is 'concise'.
 */
export interface SdgConciseNode {
  id: string;
  type: SdgNodeType;
  level?: number;
  page: number;
  text: string;
}

/**
 * Complete Semantic Document Graph structure.
 */
export interface SemanticDocumentGraph {
  /** Document-wide map of all nodes by stable ID. */
  nodes: Map<string, SdgNode>;
  /** Ordered array of top-level node IDs in logical reading order. */
  rootIds: string[];
  /** Overall document structure source: tagged, synthesised, or mixed. */
  structureSource: 'tagged' | 'synthesised' | 'mixed';
  /** Total page count indexed in graph. */
  pageCount: number;
  /** Timestamp when the graph was generated or updated. */
  generatedAt: number;
}
