/**
 * Unified Element Model and Capability Feature Flags.
 *
 * Provides a standardized adapter interface across raw PDFium elements
 * (EditableSpan) and interactive canvas overlay elements (CanvasElement).
 * Exposes feature flags (ElementCapabilities) to dynamically determine
 * supported editor operations.
 */

import type { EditableSpan } from './types';
import type { CanvasElement, TextElement, ImageElement, ShapeElement, FormFieldElement, PathElement, NoteElement } from '../stores/canvas-types';

/** High-level kind of an element regardless of layer. */
export type ElementKind = 'text' | 'image' | 'shape' | 'form-field' | 'path' | 'note';

/** Origin of the element. */
export type ElementSource = 'canvas' | 'pdf-native';

/**
 * Capability feature flags defining what operations an element supports.
 */
export interface ElementCapabilities {
  /** Element can be selected on the canvas. */
  canSelect: boolean;
  /** Element can be dragged or moved across the page. */
  canMove: boolean;
  /** Element has resize handles and can be scaled. */
  canResize: boolean;
  /** Element has rotation handle and can be rotated. */
  canRotate: boolean;
  /** Element supports inline or modal text editing. */
  canEditText: boolean;
  /** Element text content supports character/word/line highlighting. */
  canHighlight: boolean;
  /** Element can be redacted (via text redaction or area purge). */
  canRedact: boolean;
  /** Element can be removed / deleted from the page. */
  canDelete: boolean;
  /** Element supports typography styling (fontSize, fontFamily, color, etc.). */
  canStyleTypography: boolean;
  /** Element supports stroke and fill color styling. */
  canStyleFillStroke: boolean;
  /** Element supports opacity adjustment. */
  canAdjustOpacity: boolean;
  /** Element can be serialized/baked into PDF stream output. */
  canExportToPdf: boolean;
}

/**
 * Unified element wrapper presenting a uniform interface for all editor elements.
 */
export interface UnifiedElement {
  /** Unique element identifier. */
  id: string;
  /** Normalized element kind. */
  kind: ElementKind;
  /** Layer source of the element. */
  source: ElementSource;
  /** Zero-based page index. */
  pageIndex: number;
  /** Left coordinate in PDF points. */
  x: number;
  /** Top coordinate in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Rotation angle in degrees [0, 360). */
  rotation: number;
  /** Whether the element is locked against modifications. */
  locked: boolean;
  /** Whether the element is visible on the canvas. */
  visible: boolean;
  /** Capability flags for this element. */
  capabilities: ElementCapabilities;
  /** Reference to original underlying element object. */
  raw: CanvasElement | EditableSpan;
}

/** Type guard to check if an object is a CanvasElement. */
export function isCanvasElement(el: unknown): el is CanvasElement {
  if (!el || typeof el !== 'object') return false;
  return 'kind' in el && typeof (el as { kind: unknown }).kind === 'string';
}

/** Type guard to check if an object is an EditableSpan. */
export function isEditableSpan(el: unknown): el is EditableSpan {
  if (!el || typeof el !== 'object') return false;
  return 'type' in el && typeof (el as { type: unknown }).type === 'string';
}

/** Type guard for TextElement. */
export function isTextElement(el: CanvasElement): el is TextElement {
  return el.kind === 'text';
}

/** Type guard for ImageElement. */
export function isImageElement(el: CanvasElement): el is ImageElement {
  return el.kind === 'image';
}

/** Type guard for ShapeElement. */
export function isShapeElement(el: CanvasElement): el is ShapeElement {
  return el.kind === 'shape';
}

/** Type guard for FormFieldElement. */
export function isFormFieldElement(el: CanvasElement): el is FormFieldElement {
  return el.kind === 'form-field';
}

/** Type guard for PathElement. */
export function isPathElement(el: CanvasElement): el is PathElement {
  return el.kind === 'path';
}

/** Type guard for NoteElement. */
export function isNoteElement(el: CanvasElement): el is NoteElement {
  return el.kind === 'note';
}

/**
 * Resolves capability feature flags for any canvas element or raw PDF span.
 *
 * @param element The canvas element, editable span, or unified element.
 * @return The resolved capabilities feature flags.
 */
export function getElementCapabilities(element: CanvasElement | EditableSpan | UnifiedElement): ElementCapabilities {
  if ('capabilities' in element && element.capabilities) {
    return element.capabilities;
  }

  if (isCanvasElement(element)) {
    switch (element.kind) {
      case 'text':
        return {
          canSelect: true,
          canMove: !element.locked,
          canResize: !element.locked,
          canRotate: !element.locked,
          canEditText: !element.locked,
          canHighlight: true,
          canRedact: true,
          canDelete: !element.locked,
          canStyleTypography: true,
          canStyleFillStroke: false,
          canAdjustOpacity: false,
          canExportToPdf: true,
        };
      case 'shape':
        return {
          canSelect: true,
          canMove: !element.locked,
          canResize: !element.locked,
          canRotate: !element.locked,
          canEditText: false,
          canHighlight: false,
          canRedact: true,
          canDelete: !element.locked,
          canStyleTypography: false,
          canStyleFillStroke: true,
          canAdjustOpacity: true,
          canExportToPdf: true,
        };
      case 'image':
        return {
          canSelect: true,
          canMove: !element.locked,
          canResize: !element.locked,
          canRotate: !element.locked,
          canEditText: false,
          canHighlight: false,
          canRedact: true,
          canDelete: !element.locked,
          canStyleTypography: false,
          canStyleFillStroke: false,
          canAdjustOpacity: true,
          canExportToPdf: true,
        };
      case 'form-field':
        return {
          canSelect: true,
          canMove: !element.locked,
          canResize: !element.locked,
          canRotate: !element.locked,
          canEditText: false,
          canHighlight: false,
          canRedact: true,
          canDelete: !element.locked,
          canStyleTypography: false,
          canStyleFillStroke: false,
          canAdjustOpacity: false,
          canExportToPdf: true,
        };
      case 'path':
        return {
          canSelect: true,
          canMove: !element.locked,
          canResize: !element.locked,
          canRotate: !element.locked,
          canEditText: false,
          canHighlight: false,
          canRedact: true,
          canDelete: !element.locked,
          canStyleTypography: false,
          canStyleFillStroke: true,
          canAdjustOpacity: true,
          canExportToPdf: true,
        };
      case 'note':
        return {
          canSelect: true,
          canMove: !element.locked,
          canResize: false,
          canRotate: false,
          canEditText: !element.locked,
          canHighlight: false,
          canRedact: true,
          canDelete: !element.locked,
          canStyleTypography: false,
          canStyleFillStroke: true,
          canAdjustOpacity: true,
          canExportToPdf: true,
        };
    }
  }

  if (isEditableSpan(element)) {
    switch (element.type) {
      case 'text':
        return {
          canSelect: true,
          canMove: true,
          canResize: true,
          canRotate: true,
          canEditText: true,
          canHighlight: true,
          canRedact: true,
          canDelete: true,
          canStyleTypography: true,
          canStyleFillStroke: false,
          canAdjustOpacity: false,
          canExportToPdf: true,
        };
      case 'image':
        return {
          canSelect: true,
          canMove: true,
          canResize: true,
          canRotate: true,
          canEditText: false,
          canHighlight: false,
          canRedact: true,
          canDelete: true,
          canStyleTypography: false,
          canStyleFillStroke: false,
          canAdjustOpacity: true,
          canExportToPdf: true,
        };
      case 'shape':
        return {
          canSelect: true,
          canMove: true,
          canResize: true,
          canRotate: true,
          canEditText: false,
          canHighlight: false,
          canRedact: true,
          canDelete: true,
          canStyleTypography: false,
          canStyleFillStroke: true,
          canAdjustOpacity: true,
          canExportToPdf: true,
        };
    }
  }

  return {
    canSelect: true,
    canMove: false,
    canResize: false,
    canRotate: false,
    canEditText: false,
    canHighlight: false,
    canRedact: false,
    canDelete: false,
    canStyleTypography: false,
    canStyleFillStroke: false,
    canAdjustOpacity: false,
    canExportToPdf: false,
  };
}

/**
 * Converts a CanvasElement or EditableSpan into a standard UnifiedElement representation.
 *
 * @param element The canvas element or editable span.
 * @return The unified element instance.
 */
export function toUnifiedElement(element: CanvasElement | EditableSpan): UnifiedElement {
  if (isCanvasElement(element)) {
    return {
      id: element.id,
      kind: element.kind,
      source: 'canvas',
      pageIndex: element.pageIndex,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation ?? 0,
      locked: element.locked ?? false,
      visible: element.visible ?? true,
      capabilities: getElementCapabilities(element),
      raw: element,
    };
  }

  const span = element as EditableSpan;
  const rotation = 'rotation' in span && typeof span.rotation === 'number' ? span.rotation : 0;

  return {
    id: span.id,
    kind: span.type,
    source: 'pdf-native',
    pageIndex: span.pageIndex,
    x: span.left,
    y: span.top,
    width: span.width,
    height: span.height,
    rotation,
    locked: false,
    visible: true,
    capabilities: getElementCapabilities(span),
    raw: span,
  };
}
