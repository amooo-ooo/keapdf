import type {
  SnapGuide,
  SnapOptions,
  SnapResult,
  SnapOrientation,
  SnapTargetKind,
  SnapCandidate,
  SnapMargins,
} from '../types/snapping-types';

export type {
  SnapGuide,
  SnapOptions,
  SnapResult,
  SnapOrientation,
  SnapTargetKind,
  SnapCandidate,
  SnapMargins,
};

/** Built-in canvas element kinds. */
export type BuiltinCanvasElementKind =
  | 'text'
  | 'image'
  | 'shape'
  | 'form-field'
  | 'path'
  | 'note'
  | 'video'
  | 'audio'
  | '3d'
  | 'attachment'
  | 'barcode';

/** Supported canvas element kinds, open to extension by plugins. */
export type CanvasElementKind = BuiltinCanvasElementKind | (string & {});

/** Shape sub-types for the shape element kind. */
export type ShapeVariant = 'rectangle' | 'circle' | 'line' | 'arrow';

/** Form field sub-types. */
export type FormFieldVariant = 'text-input' | 'checkbox' | 'radio' | 'dropdown' | 'signature' | 'attachment' | 'button';

/** Resize handle positions around an element bounding box. */
export type HandlePosition = 'top-left' | 'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left';

/** 2D point coordinate in PDF points. */
export interface Point {
  x: number;
  y: number;
}

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

import type { EditableTextSpan, EditableFormFieldSpan } from '../core/types';

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
  /** Background highlight color string (e.g. rgba). */
  backgroundColor?: string;
  /** Character index in the original text stream if extracted from PDF. */
  charStartIndex?: number;
  /** Character count in this segment. */
  charCount?: number;
  /** Whether segment has underline decoration. */
  underline?: boolean;
  /** Whether segment has strikethrough decoration. */
  strikethrough?: boolean;
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
  /** Whether line has underline decoration. */
  underline?: boolean;
  /** Whether line has strikethrough decoration. */
  strikethrough?: boolean;
  /** Background highlight color for the line. */
  backgroundColor?: string;
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
  underline?: boolean;
  strikethrough?: boolean;
  textAlign: 'left' | 'center' | 'right';
  lineHeight?: number;
  letterSpacing?: string;
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
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none' | 'inset' | 'underline';
  borderRadius?: number;
  textAlign?: 'left' | 'center' | 'right';
  required?: boolean;
  readOnly?: boolean;
  value?: string;
  options?: string[];
  /** Whether multi-line text input is enabled. */
  multiline?: boolean;
  /** Whether characters are masked as a password field. */
  password?: boolean;
  /** Maximum character limit. */
  maxLength?: number;
  /** Original native AcroForm field name if extracted or promoted from the document. */
  sourceFieldName?: string;
  /** Original native AcroForm field span if extracted or promoted from the document. */
  originalSpan?: EditableFormFieldSpan;
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

/** Video element conforming to ISO 32000-1 Clause 13.2 / 13.7 RichMedia. */
export interface VideoElement extends CanvasElementBase {
  kind: 'video';
  src: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  title?: string;
  poster?: string;
  autoplay?: boolean;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
}

/** Audio element conforming to ISO 32000-1 Clause 13.3 / 13.7 RichMedia. */
export interface AudioElement extends CanvasElementBase {
  kind: 'audio';
  src: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  title?: string;
  duration?: number;
  controls?: boolean;
}

/** 3D model element conforming to ISO 32000-1 Clause 13.6 interactive 3D annotations. */
export interface ThreeDElement extends CanvasElementBase {
  kind: '3d';
  src: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  modelFormat?: string;
  title?: string;
  viewName?: string;
}

/** File attachment element conforming to ISO 32000-2 Clause 14.13 Associated Files. */
export interface AttachmentElement extends CanvasElementBase {
  kind: 'attachment';
  src: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  description?: string;
  attachmentType?: string;
}

/** 2D QR code and 1D barcode element conforming to ISO/IEC 18004 and ISO/IEC 15417. */
export interface BarcodeElement extends CanvasElementBase {
  kind: 'barcode';
  payload: string;
  symbology: 'qr-code' | 'code-128';
  fgColor?: string;
  bgColor?: string;
  includeText?: boolean;
  svgContent?: string;
  dataUrl?: string;
}

/** Built-in discriminated union of standard canvas element types. */
export type BuiltinCanvasElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | FormFieldElement
  | PathElement
  | NoteElement
  | VideoElement
  | AudioElement
  | ThreeDElement
  | AttachmentElement
  | BarcodeElement;

/** Union of all canvas element types, open to custom plugin element extension. */
export type CanvasElement = BuiltinCanvasElement | (CanvasElementBase & { kind: string; [key: string]: unknown });

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
  originPageIndex?: number; // element page index at drag start
  grabOffsetX?: number; // pointer offset X from element.x in page points at drag start
  grabOffsetY?: number; // pointer offset Y from element.y in page points at drag start
  originPoints?: Point[]; // path points snapshot at drag start
  originRotation?: number; // element rotation at drag start (used for rotate mode)
  originFontSize?: number; // font size at drag start (used for scaling text)
  originLines?: TextElementLine[]; // lines snapshot at drag start
  originSegments?: TextSegment[]; // segments snapshot at drag start
  activeGuides?: SnapGuide[]; // active visual snapping guidelines
}

/** Active drag-and-drop ghost preview indicator on the canvas. */
export interface DropPreviewState {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: CanvasElementKind;
  label?: string;
  payload?: ElementDropPayload;
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
  width?: number;
  height?: number;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none' | 'inset' | 'underline';
  borderRadius?: number;
  textAlign?: 'left' | 'center' | 'right';
  placeholder?: string;
  value?: string;
  options?: string[];
  required?: boolean;
  readOnly?: boolean;
  src?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  title?: string;
  poster?: string;
  modelFormat?: string;
  payload?: string;
  symbology?: 'qr-code' | 'code-128';
  fgColor?: string;
  bgColor?: string;
  includeText?: boolean;
  svgContent?: string;
}

/** Default dimensions for newly created built-in elements (in PDF points). */
export const ELEMENT_DEFAULTS: Record<BuiltinCanvasElementKind, { width: number; height: number }> = {
  text: { width: 150, height: 30 },
  image: { width: 200, height: 150 },
  shape: { width: 100, height: 100 },
  'form-field': { width: 160, height: 28 },
  path: { width: 0, height: 0 },
  note: { width: 140, height: 100 },
  video: { width: 280, height: 180 },
  audio: { width: 240, height: 60 },
  '3d': { width: 220, height: 180 },
  attachment: { width: 180, height: 48 },
  barcode: { width: 120, height: 120 },
};
