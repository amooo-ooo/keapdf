/**
 * Element registry for extensible canvas element types.
 *
 * Follows the tldraw ShapeUtil pattern: each element type is a self-contained
 * registration that defines its own creation, rendering, serialisation, and
 * property editing. Adding a new element type requires a single file with a
 * single registry call with zero core modifications.
 *
 * @example
 * ```typescript
 * const registry = new ElementRegistry();
 * registry.register(textElementDef);
 * registry.register(shapeElementDef);
 *
 * // Plugin registers a custom type
 * registry.register(stampElementDef);
 *
 * // Consumers use registry lookups instead of switch statements
 * const def = registry.get('text');
 * const element = def.create(id, pageIndex, x, y);
 * ```
 */

import { getContext, setContext } from 'svelte';
import type { Component } from 'svelte';
import type {
  CanvasElement,
  CanvasElementBase,
  TextElement,
  ShapeElement,
  ImageElement,
  FormFieldElement,
  PathElement,
  NoteElement,
  VideoElement,
  AudioElement,
  ThreeDElement,
  AttachmentElement,
  BarcodeElement,
  ElementDropPayload,
} from '../stores/canvas-types';
import type { PdfPage } from '../services/pdf/pdf-page';
import type { PdfDocument } from '../services/pdf/pdf-document';

export type { CanvasElementBase };

/** Mapping of built-in element kinds to their concrete element types. */
export interface BuiltinElementMap {
  text: TextElement;
  shape: ShapeElement;
  image: ImageElement;
  'form-field': FormFieldElement;
  path: PathElement;
  note: NoteElement;
  video: VideoElement;
  audio: AudioElement;
  '3d': ThreeDElement;
  attachment: AttachmentElement;
  barcode: BarcodeElement;
}

const ELEMENT_REGISTRY_KEY = Symbol('element-registry');

/**
 * Context passed to the burn method for serializing elements to PDF.
 */
export interface BurnContext {
  /** The target PDF page facade. */
  page: PdfPage;
  /** The parent PDF document facade. */
  document: PdfDocument;
  /** Page width in PDF points. */
  pageWidth: number;
  /** Page height in PDF points. */
  pageHeight: number;
}

/**
 * Props passed to an element's canvas rendering component.
 */
export interface ElementRenderProps<E extends CanvasElementBase = CanvasElementBase> {
  /** The element data to render. */
  element: E;
  /** Current viewport zoom level. */
  zoom: number;
  /** Whether this element is currently selected. */
  selected: boolean;
  /** Whether this element is in inline-edit mode. */
  editing: boolean;
}

/**
 * Props passed to an element's property panel component.
 */
export interface ElementPanelProps<E extends CanvasElementBase = CanvasElementBase> {
  /** The element whose properties are being edited. */
  element: E;
}

/**
 * Registration for a canvas element type.
 *
 * Each definition encapsulates all behaviour for a single element kind:
 * creation, rendering, property editing, and PDF serialisation.
 * This enables open extension without modifying core switch statements.
 *
 * @template K The string literal kind discriminant.
 * @template E The concrete element interface extending CanvasElementBase.
 */
export interface ElementDefinition<
  K extends string = string,
  E extends CanvasElementBase & { kind: K } = CanvasElementBase & { kind: K },
> {
  /** Unique element kind discriminant (must match the element's `kind` field). */
  readonly kind: K;

  /** Human-readable display name for UI labels and palettes. */
  readonly label: string;

  /** Default dimensions when placing a new element (in PDF points). */
  readonly defaults: { width: number; height: number };

  /**
   * Create a new element instance with default properties.
   *
   * @param id Unique element identifier.
   * @param pageIndex Target page zero-based index.
   * @param x Left edge position in PDF points.
   * @param y Top edge position in PDF points.
   * @param overrides Optional property overrides.
   * @return The fully initialized element.
   */
  create(id: string, pageIndex: number, x: number, y: number, overrides?: Partial<E>): E;

  /**
   * Svelte component that renders this element on the canvas overlay.
   * Receives ElementRenderProps as $props().
   */
  readonly component?: Component<ElementRenderProps<E>> | null;

  /**
   * Svelte component for the right-panel property editor.
   * Receives ElementPanelProps as $props(). May be null if this element
   * has no editable properties.
   */
  readonly propertiesPanel: Component<ElementPanelProps<E>> | null;

  /**
   * Serialize this element into PDFium page objects for PDF export.
   *
   * @param element The element to serialize.
   * @param ctx The burn context with page/document handles.
   */
  burn(element: E, ctx: BurnContext): void | Promise<void>;

  /**
   * Test whether a point (in element-local coordinates) hits this element.
   * Used for click selection on non-rectangular elements (paths, circles).
   * If not provided, defaults to bounding-box hit testing.
   *
   * @param element The element to test.
   * @param point Point in element-local coordinates (0,0 = top-left of element).
   * @return True if the point is inside the element.
   */
  hitTest?(element: E, point: { x: number; y: number }): boolean;

  /**
   * Validate and normalize element properties after an update.
   * Called after every property change to enforce constraints
   * (e.g., minimum dimensions, clamped opacity).
   *
   * @param element The element to normalize.
   * @return The normalized element (may be the same reference if unchanged).
   */
  normalize?(element: E): E;
}

/**
 * Central registry for canvas element type definitions.
 *
 * Consumers look up element definitions by kind string instead of
 * using switch/if-else chains. Plugins extend the editor by registering
 * new element types at startup.
 */
export class ElementRegistry {
  private definitions = new Map<string, ElementDefinition>();

  /**
   * Register an element type definition.
   *
   * @param definition The element type to register.
   * @throws Error if a definition with the same kind is already registered.
   */
  register<K extends string, E extends CanvasElementBase & { kind: K }>(
    definition: ElementDefinition<K, E>,
  ): void {
    if (this.definitions.has(definition.kind)) {
      throw new Error(
        `Element kind "${definition.kind}" is already registered. ` +
        `Each element type must have a unique kind discriminant.`
      );
    }
    this.definitions.set(definition.kind, definition as unknown as ElementDefinition);
  }

  /**
   * Unregister an element type definition.
   *
   * @param kind The element kind discriminant string.
   */
  unregister(kind: string): void {
    this.definitions.delete(kind);
  }

  /**
   * Retrieve the definition for a given element kind.
   *
   * @param kind The element kind discriminant string.
   * @return The registered element definition.
   * @throws Error if no definition is registered for the given kind.
   */
  get(kind: 'text'): ElementDefinition<'text', TextElement>;
  get(kind: 'shape'): ElementDefinition<'shape', ShapeElement>;
  get(kind: 'image'): ElementDefinition<'image', ImageElement>;
  get(kind: 'form-field'): ElementDefinition<'form-field', FormFieldElement>;
  get(kind: 'path'): ElementDefinition<'path', PathElement>;
  get(kind: 'note'): ElementDefinition<'note', NoteElement>;
  get(kind: 'video'): ElementDefinition<'video', VideoElement>;
  get(kind: 'audio'): ElementDefinition<'audio', AudioElement>;
  get(kind: '3d'): ElementDefinition<'3d', ThreeDElement>;
  get(kind: 'attachment'): ElementDefinition<'attachment', AttachmentElement>;
  get(kind: 'barcode'): ElementDefinition<'barcode', BarcodeElement>;
  get<
    K extends string = string,
    E extends CanvasElementBase & { kind: K } = CanvasElementBase & { kind: K },
  >(kind: K): ElementDefinition<K, E>;
  get<
    K extends string = string,
    E extends CanvasElementBase & { kind: K } = CanvasElementBase & { kind: K },
  >(kind: string): ElementDefinition<K, E> {
    const def = this.definitions.get(kind);
    if (!def) {
      throw new Error(
        `No element definition registered for kind "${kind}". ` +
        `Available kinds: ${this.getRegisteredKinds().join(', ')}`
      );
    }
    return def as unknown as ElementDefinition<K, E>;
  }

  /**
   * Retrieve the definition for a given element kind safely.
   *
   * @param kind The element kind discriminant string.
   * @return The registered element definition or undefined.
   */
  tryGet<
    K extends string = string,
    E extends CanvasElementBase & { kind: K } = CanvasElementBase & { kind: K },
  >(kind: string): ElementDefinition<K, E> | undefined {
    return this.definitions.get(kind) as unknown as ElementDefinition<K, E> | undefined;
  }

  /**
   * Check whether a definition exists for the given kind.
   *
   * @param kind The element kind discriminant string.
   * @return True if a definition is registered.
   */
  has(kind: string): boolean {
    return this.definitions.has(kind);
  }

  /**
   * Return all registered element kind strings.
   *
   * @return Array of registered kind discriminants.
   */
  getRegisteredKinds(): string[] {
    return Array.from(this.definitions.keys());
  }

  /**
   * Return all registered element definitions.
   *
   * @return Array of all registered definitions.
   */
  getAll(): ElementDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * Return the default dimensions for a given element kind.
   *
   * @param kind The element kind discriminant string.
   * @return The default width and height in PDF points.
   */
  getDefaults(kind: string): { width: number; height: number } {
    return this.get(kind).defaults;
  }

  /**
   * Constructs a canvas element from an ElementDropPayload using registered definitions.
   *
   * @param payload Drag payload describing the element to create.
   * @param pageIndex Zero-based target page index.
   * @param x Horizontal coordinate in PDF points.
   * @param y Vertical coordinate in PDF points.
   * @param id Unique element identifier.
   * @param overrides Optional dimension or property overrides.
   * @return Fully initialised CanvasElement instance.
   */
  createElementFromPayload(
    payload: ElementDropPayload,
    pageIndex: number,
    x: number,
    y: number,
    id?: string,
    overrides?: { width?: number; height?: number }
  ): CanvasElement {
    return createElementFromPayload(this, payload, pageIndex, x, y, id, overrides);
  }
}

/**
 * Constructs a canvas element from an ElementDropPayload.
 *
 * Maps payload properties to definition overrides so preview instances
 * and dropped canvas elements maintain identical styling and dimensions.
 *
 * @param registry Element registry containing registered definitions.
 * @param payload Drag payload describing the element to create.
 * @param pageIndex Zero-based target page index.
 * @param x Horizontal coordinate in PDF points.
 * @param y Vertical coordinate in PDF points.
 * @param id Unique element identifier.
 * @param overrides Optional dimension or property overrides.
 * @return Fully initialised CanvasElement instance.
 */
export function createElementFromPayload(
  registry: ElementRegistry,
  payload: ElementDropPayload,
  pageIndex: number,
  x: number,
  y: number,
  id: string = 'preview-element',
  overrides?: { width?: number; height?: number }
): CanvasElement {
  if (!registry.has(payload.kind)) {
    throw new Error(`Unsupported canvas element kind: ${payload.kind}`);
  }
  const def = registry.get(payload.kind);
  const elementOverrides: Record<string, unknown> = {};

  if (payload.width != null) elementOverrides.width = payload.width;
  if (payload.height != null) elementOverrides.height = payload.height;
  if (overrides?.width != null) elementOverrides.width = overrides.width;
  if (overrides?.height != null) elementOverrides.height = overrides.height;

  if (payload.variant != null) {
    elementOverrides.variant = payload.variant;
  } else if (payload.kind === 'shape' && payload.label) {
    const l = payload.label.toLowerCase();
    if (l === 'circle' || l === 'rectangle' || l === 'line' || l === 'arrow') {
      elementOverrides.variant = l;
    }
  }

  if (payload.src != null) elementOverrides.src = payload.src;

  if (payload.text != null) {
    elementOverrides.text = payload.text;
  } else if (payload.kind === 'text' && payload.label) {
    elementOverrides.text = payload.label;
  }

  if (payload.author != null) elementOverrides.author = payload.author;
  if (payload.color != null) elementOverrides.color = payload.color;
  if (payload.fontSize != null) elementOverrides.fontSize = payload.fontSize;
  if (payload.fontWeight != null) elementOverrides.fontWeight = payload.fontWeight;
  if (payload.fontFamily != null) elementOverrides.fontFamily = payload.fontFamily;
  if (payload.label != null) elementOverrides.label = payload.label;
  if (payload.backgroundColor != null) elementOverrides.backgroundColor = payload.backgroundColor;
  if (payload.borderColor != null) elementOverrides.borderColor = payload.borderColor;
  if (payload.borderWidth != null) elementOverrides.borderWidth = payload.borderWidth;
  if (payload.borderStyle != null) elementOverrides.borderStyle = payload.borderStyle;
  if (payload.borderRadius != null) elementOverrides.borderRadius = payload.borderRadius;
  if (payload.textAlign != null) elementOverrides.textAlign = payload.textAlign;
  if (payload.placeholder != null) elementOverrides.placeholder = payload.placeholder;
  if (payload.value != null) elementOverrides.value = payload.value;
  if (payload.options != null) elementOverrides.options = payload.options;
  if (payload.required != null) elementOverrides.required = payload.required;
  if (payload.readOnly != null) elementOverrides.readOnly = payload.readOnly;
  if (payload.fileName != null) elementOverrides.fileName = payload.fileName;
  if (payload.fileSize != null) elementOverrides.fileSize = payload.fileSize;
  if (payload.mimeType != null) elementOverrides.mimeType = payload.mimeType;
  if (payload.title != null) elementOverrides.title = payload.title;
  if (payload.poster != null) elementOverrides.poster = payload.poster;
  if (payload.modelFormat != null) elementOverrides.modelFormat = payload.modelFormat;
  if (payload.payload != null) elementOverrides.payload = payload.payload;
  if (payload.symbology != null) elementOverrides.symbology = payload.symbology;
  if (payload.fgColor != null) elementOverrides.fgColor = payload.fgColor;
  if (payload.bgColor != null) elementOverrides.bgColor = payload.bgColor;
  if (payload.includeText != null) elementOverrides.includeText = payload.includeText;
  if (payload.svgContent != null) elementOverrides.svgContent = payload.svgContent;

  return def.create(id, pageIndex, x, y, elementOverrides) as CanvasElement;
}

/**
 * Provide the element registry via Svelte context from a root component.
 *
 * @param registry The ElementRegistry instance to provide.
 */
export function provideElementRegistry(registry: ElementRegistry): void {
  setContext(ELEMENT_REGISTRY_KEY, registry);
}

/**
 * Retrieve the element registry from Svelte context in any child component.
 *
 * @return The ElementRegistry instance.
 * @throws Error if the registry is not found in context.
 */
export function useElementRegistry(): ElementRegistry {
  const registry = getContext<ElementRegistry>(ELEMENT_REGISTRY_KEY);
  if (!registry) {
    throw new Error('ElementRegistry not found in context. Ensure provideElementRegistry() is called in a parent component.');
  }
  return registry;
}

/**
 * Safely retrieve the element registry from Svelte context without throwing.
 *
 * @return The ElementRegistry instance, or null if not found in context.
 */
export function tryUseElementRegistry(): ElementRegistry | null {
  return getContext<ElementRegistry>(ELEMENT_REGISTRY_KEY) ?? null;
}
