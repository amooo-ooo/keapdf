/**
 * Extensible tool registry for the PDF editor canvas and viewport interactions.
 *
 * Implements a state-machine pattern where each editing tool defines its
 * own lifecycle hooks, pointer event handlers, keyboard shortcuts, and
 * active cursor styles.
 */

import { getContext, setContext } from 'svelte';
import type { EditorStore } from '../stores/editor.svelte';
import type { CanvasStore } from '../stores/canvas.svelte';
import type { EditorActions } from '../stores/editor-actions';
import type { CanvasActions } from '../stores/canvas-actions';

const TOOL_REGISTRY_KEY = Symbol('tool-registry');

/** Execution context provided to tool lifecycle and interaction handlers. */
export interface ToolContext {
  /** Reactive editor state store. */
  editorStore: EditorStore;
  /** Reactive canvas elements store. */
  canvasStore: CanvasStore;
  /** Document and workspace action dispatcher. */
  actions: EditorActions;
  /** Canvas element mutation dispatcher. */
  canvasActions: CanvasActions;
  /** Target page index for page-specific pointer events. */
  pageIndex?: number;
  /** Target page DOM element container. */
  containerEl?: HTMLElement;
}

/** Specification and event hooks for an interactive editor tool. */
export interface ToolDefinition {
  /** Unique tool identifier (e.g., 'select', 'hand', 'text', 'highlight'). */
  id: string;
  /** Human-readable label displayed in tooltips and menus. */
  label: string;
  /** Icon component reference or SVG identifier. */
  icon?: unknown;
  /** Default CSS cursor style for the canvas when this tool is active. */
  cursor?: string;
  /** Primary single-key keyboard shortcut (e.g., 'v', 'h', 't'). */
  shortcut?: string;
  /** Lifecycle hook invoked when the tool becomes the active tool. */
  onActivate?(ctx: ToolContext): void;
  /** Lifecycle hook invoked when another tool is selected. */
  onDeactivate?(ctx: ToolContext): void;
  /** Pointer down event handler. Return true to mark event as handled. */
  onPointerDown?(e: PointerEvent, ctx: ToolContext): void | boolean;
  /** Pointer move event handler. Return true to mark event as handled. */
  onPointerMove?(e: PointerEvent, ctx: ToolContext): void | boolean;
  /** Pointer up event handler. Return true to mark event as handled. */
  onPointerUp?(e: PointerEvent, ctx: ToolContext): void | boolean;
  /** Key down event handler for tool-specific keyboard interactions. */
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): void | boolean;
}

/**
 * Registry managing available canvas tools and dispatching pointer events
 * to the active tool definition.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private builtinIds = new Set<string>();

  /**
   * Registers a new tool definition.
   *
   * @param tool The tool definition to register.
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.id)) {
      console.warn(`[ToolRegistry] Overwriting existing tool "${tool.id}". This may cause issues if the original was a built-in.`);
    }
    this.tools.set(tool.id, tool);
  }

  /**
   * Registers a built-in tool definition.
   *
   * @param tool The tool definition to register.
   */
  registerBuiltin(tool: ToolDefinition): void {
    this.builtinIds.add(tool.id);
    this.tools.set(tool.id, tool);
  }

  /**
   * Unregisters a tool definition by its identifier.
   *
   * @param id The tool identifier.
   */
  unregister(id: string): void {
    if (this.builtinIds.has(id)) {
      console.warn(`[ToolRegistry] Cannot unregister built-in tool "${id}".`);
      return;
    }
    this.tools.delete(id);
  }

  /**
   * Retrieves a tool definition by identifier.
   *
   * @param id The tool identifier.
   * @return The registered tool definition, or undefined if not found.
   */
  get(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  /**
   * Checks whether a tool identifier is registered.
   *
   * @param id The tool identifier.
   * @return True if registered, false otherwise.
   */
  has(id: string): boolean {
    return this.tools.has(id);
  }

  /**
   * Retrieves all registered tool definitions in insertion order.
   *
   * @return Array of all registered tool definitions.
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }
}

/** Provide the tool registry via Svelte context from a root component. */
export function provideToolRegistry(registry: ToolRegistry): void {
  setContext(TOOL_REGISTRY_KEY, registry);
}

/** Retrieve the tool registry from Svelte context in any child component. */
export function useToolRegistry(): ToolRegistry {
  const registry = getContext<ToolRegistry>(TOOL_REGISTRY_KEY);
  if (!registry) {
    throw new Error('ToolRegistry not found in context');
  }
  return registry;
}
