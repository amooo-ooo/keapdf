/**
 * Element registry for extensible canvas element types.
 *
 * Follows the tldraw ShapeUtil pattern: each element type is a self-contained
 * registration that defines its own creation, rendering, serialization, and
 * property editing. Adding a new element type requires a single file with a
 * single registry call -- zero core modifications.
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
import type { CanvasElementBase } from '../stores/canvas-types';
import type { PdfPage } from '../services/pdf/pdf-page';
import type { PdfDocument } from '../services/pdf/pdf-document';

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
 * Each definition encapsulates all behavior for a single element kind:
 * creation, rendering, property editing, and PDF serialization.
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
  readonly component: Component<ElementRenderProps<E>>;

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
   * Retrieve the definition for a given element kind.
   *
   * @param kind The element kind discriminant string.
   * @return The registered element definition.
   * @throws Error if no definition is registered for the given kind.
   */
  get<K extends string>(kind: K): ElementDefinition<K> {
    const def = this.definitions.get(kind);
    if (!def) {
      throw new Error(
        `No element definition registered for kind "${kind}". ` +
        `Available kinds: ${this.getRegisteredKinds().join(', ')}`
      );
    }
    return def as ElementDefinition<K>;
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
