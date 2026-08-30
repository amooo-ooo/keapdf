/**
 * Core Plugin API specifications for third-party and built-in extensions.
 *
 * Defines the public extension surface allowing plugins to register custom
 * canvas element types, interactive tools, sidebar panels, export formats,
 * execute commands, inspect document state, and listen to editor events.
 */

import type { ElementDefinition, CanvasElementBase } from './element-registry';
import type { ToolDefinition } from './tool-registry';
import type { PanelDefinition } from './panel-registry';
import type { ExportDefinition } from './export-registry';
import type { Command } from './command';
import type { CanvasElement } from '../stores/canvas-types';

/** Supported plugin lifecycle events. */
export type PluginEventType =
  | 'document:loaded'
  | 'document:closed'
  | 'page:changed'
  | 'selection:changed'
  | 'tool:changed'
  | 'command:executed';

/** Event payload mapping for type-safe event subscriptions. */
export interface PluginEventPayloads {
  'document:loaded': { fileName: string; pageCount: number };
  'document:closed': void;
  'page:changed': { pageIndex: number };
  'selection:changed': { selectedElementId: string | null };
  'tool:changed': { toolId: string };
  'command:executed': { description: string };
}

/**
 * Public API surface exposed to plugins during activation.
 */
export interface PluginAPI {
  /** Current editor API specification version. */
  readonly version: string;

  /** Canvas element type registration interface. */
  readonly elements: {
    /** Registers a custom canvas element definition. */
    register<K extends string, T extends CanvasElementBase & { kind: K }>(
      def: ElementDefinition<K, T>,
    ): void;
    /** Unregisters a canvas element definition. */
    unregister(kind: string): void;
  };

  /** Canvas overlay interaction interface. */
  readonly canvas: {
    /** List of active overlay elements across all pages. */
    readonly elements: CanvasElement[];
    /** Selects or deselects a canvas element by ID. */
    selectElement(id: string | null): void;
  };

  /** Interactive canvas tool registration interface. */
  readonly tools: {
    /** Registers a custom canvas tool. */
    register(def: ToolDefinition): void;
    /** Unregisters a canvas tool. */
    unregister(id: string): void;
    /** Sets the active tool by ID. */
    setActive(id: string): void;
  };

  /** Sidebar panel and view registration interface. */
  readonly panels: {
    /** Registers a custom sidebar panel. */
    register(def: PanelDefinition): void;
    /** Unregisters a sidebar panel. */
    unregister(id: string): void;
  };

  /** Document export format registration interface. */
  readonly exporters: {
    /** Registers a custom document export handler. */
    register(def: ExportDefinition): void;
    /** Unregisters a document export handler. */
    unregister(id: string): void;
  };

  /** Editor command dispatcher interface. */
  readonly commands: {
    /** Executes a reversible command within the active editor transaction. */
    execute(command: Command): Promise<void>;
  };

  /** Read-only active document inspection interface. */
  readonly document: {
    /** Whether a PDF document is currently loaded in memory. */
    readonly isLoaded: boolean;
    /** Active document file name. */
    readonly fileName: string;
    /** Total page count in active document. */
    readonly pageCount: number;
    /** Currently active page index. */
    readonly currentPageIndex: number;
    /** Retrieves page dimensions in points for a given page. */
    getPageDimensions(pageIndex: number): { width: number; height: number } | null;
  };

  /** Event subscription interface for editor lifecycle events. */
  readonly events: {
    /**
     * Subscribes to an editor lifecycle event.
     *
     * @param event The target event name.
     * @param handler The callback function.
     * @return Unsubscribe function to cleanly remove listener.
     */
    on<E extends PluginEventType>(
      event: E,
      handler: (payload: PluginEventPayloads[E]) => void,
    ): () => void;

    /**
     * Unsubscribes from an editor lifecycle event.
     *
     * @param event The target event name.
     * @param handler The callback function to remove.
     */
    off<E extends PluginEventType>(
      event: E,
      handler: (payload: PluginEventPayloads[E]) => void,
    ): void;
  };
}

/** Specification and lifecycle contract for an editor plugin. */
export interface PluginDefinition {
  /** Globally unique reverse-domain plugin identifier (e.g., 'org.embedpdf.watermark'). */
  id: string;
  /** Human-readable plugin name. */
  name: string;
  /** SemVer version string (e.g., '1.0.0'). */
  version: string;
  /** Short description of plugin capabilities. */
  description?: string;
  /** Author name or organization. */
  author?: string;
  /**
   * Trust classification. Trusted plugins (true) execute in-process;
   * untrusted plugins execute inside a sandboxed worker boundary.
   */
  trusted?: boolean;

  /**
   * Activation hook invoked when the plugin is enabled.
   *
   * @param api The plugin API surface.
   */
  activate(api: PluginAPI): Promise<void> | void;

  /**
   * Deactivation hook invoked when the plugin is disabled or uninstalled.
   * Plugins should release any external resources or timers here.
   */
  deactivate?(): Promise<void> | void;
}
