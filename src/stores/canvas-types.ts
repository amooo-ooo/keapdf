/**
 * Type definitions for canvas-overlaid elements.
 * These represent user-added objects (text boxes, shapes, images, form fields)
 * that render on top of PDF pages and can be dragged, resized, and edited.
 */

/** Supported canvas element kinds. */
export type CanvasElementKind = 'text' | 'image' | 'shape' | 'form-field' | 'path' | 'note';

/** Shape sub-types for the shape element kind. */
export type ShapeVariant = 'rectangle' | 'circle' | 'line' | 'arrow';

/** Form field sub-types. */
export type FormFieldVariant = 'text-input' | 'checkbox' | 'radio' | 'dropdown' | 'signature' | 'attachment';

/** Resize handle positions around an element bounding box. */
export type HandlePosition = 'top-left' | 'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left';

/** Base properties shared by all canvas elements. */
export interface CanvasElementBase {
  id: string;
  kind: CanvasElementKind;
  pageIndex: number;
  x: number;       // left edge in PDF points
  y: number;       // top edge in PDF points
  width: number;   // in PDF points
  height: number;  // in PDF points
  rotation: number; // degrees
  locked: boolean;
  visible: boolean;
  flipX: boolean;
  flipY: boolean;
}

import type { EditableTextSpan } from '../core/types';

/** A styled segment or portion of text within a line or element. */
export interface TextSegment {
  /** Text content of this segment. */
  text: string;
  /** Font size in points. */
  fontSize?: number;
  /** Standard or detected font family name. */
  fontFamily?: string;
  /** Raw font family name from PDF stream (e.g. subset tag "ABCDEF+Arial-BoldMT"). */
  rawFontFamily?: string;
  /** Font weight. */
  fontWeight?: 'normal' | 'bold';
  /** Font style. */
  fontStyle?: 'normal' | 'italic';
  /** CSS color string (e.g. hex #000000 or rgba). */
  color?: string;
  /** Character index in the original text stream if extracted from PDF. */
  charStartIndex?: number;
  /** Character count in this segment. */
  charCount?: number;
  /** Width in PDF points. */
  width?: number;
  /** Height in PDF points. */
  height?: number;
  /** Left offset relative to element bounding box. */
  left?: number;
  /** Top offset relative to element bounding box. */
  top?: number;
  /** Baseline Y relative to element bounding box. */
  baselineY?: number;
}

/** A line of styled text segments with layout metrics. */
export interface TextElementLine {
  /** Styled segments within this line. */
  segments: TextSegment[];
  /** Line text content. */
  text?: string;
  /** Line height in points. */
  lineHeight?: number;
  /** Top offset relative to element bounding box. */
  top?: number;
  /** Left offset relative to element bounding box. */
  left?: number;
  /** Width of the line in points. */
  width?: number;
  /** Height of the line in points. */
  height?: number;
  /** Baseline Y relative to element bounding box. */
  baselineY?: number;
  /** Dominant font size for this line. */
  fontSize?: number;
}

/** Text box element. */
export interface TextElement extends CanvasElementBase {
  kind: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  rawFontFamily?: string;
  color: string;       // CSS hex or rgba color
  backgroundColor?: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textAlign: 'left' | 'center' | 'right';
  lineHeight?: number;
  lines?: TextElementLine[];
  segments?: TextSegment[];
  originalSpan?: EditableTextSpan;
}

/** Image element. */
export interface ImageElement extends CanvasElementBase {
  kind: 'image';
  src: string;         // data URL or blob URL
  objectFit: 'contain' | 'cover' | 'fill';
  opacity: number;     // 0-1
}

/** Shape element. */
export interface ShapeElement extends CanvasElementBase {
  kind: 'shape';
  variant: ShapeVariant;
  fill: string;        // CSS color
  stroke: string;      // CSS color
  strokeWidth: number;
  opacity: number;
  isHighlight?: boolean;
}

/** Form field placeholder element. */
export interface FormFieldElement extends CanvasElementBase {
  kind: 'form-field';
  variant: FormFieldVariant;
  label: string;
  placeholder: string;
}

/** Path element for freehand drawing and highlights. */
export interface PathElement extends CanvasElementBase {
  kind: 'path';
  points: { x: number; y: number }[];
  stroke: string;      // CSS color
  strokeWidth: number;
  opacity: number;     // 0-1
  isHighlight: boolean;
}

/** Sticky note comment element. */
export interface NoteElement extends CanvasElementBase {
  kind: 'note';
  author: string;
  text: string;
  color: string;       // CSS hex or rgba color
  isOpen: boolean;
}

/** Discriminated union of all canvas element types. */
export type CanvasElement = TextElement | ImageElement | ShapeElement | FormFieldElement | PathElement | NoteElement;

/** Active drag/resize interaction state. */
export interface DragState {
  elementId: string;
  mode: 'move' | 'resize' | 'rotate';
  handle: HandlePosition | null;  // null when mode is 'move' or 'rotate'
  startX: number;     // pointer start in page-point coords
  startY: number;
  originX: number;    // element origin at drag start
  originY: number;
  originWidth: number;
  originHeight: number;
  originRotation?: number; // element rotation at drag start (used for rotate mode)
  originFontSize?: number; // font size at drag start (used for scaling text)
  originLines?: TextElementLine[]; // lines snapshot at drag start
  originSegments?: TextSegment[]; // segments snapshot at drag start
}

/** Data transferred during a sidebar drag-to-canvas operation. */
export interface ElementDropPayload {
  kind: CanvasElementKind;
  variant?: ShapeVariant | FormFieldVariant;
  label?: string;
  text?: string;
  author?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontFamily?: string;
}

/** Default dimensions for newly created elements (in PDF points). */
export const ELEMENT_DEFAULTS: Record<CanvasElementKind, { width: number; height: number }> = {
  text: { width: 150, height: 30 },
  image: { width: 200, height: 150 },
  shape: { width: 100, height: 100 },
  'form-field': { width: 160, height: 28 },
  path: { width: 0, height: 0 },
  note: { width: 140, height: 100 },
};
