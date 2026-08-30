/**
 * Plugin lifecycle and extension manager.
 *
 * Coordinates plugin registration, activation, sandboxed execution,
 * and automatic cleanup of registered elements, tools, panels, and exporters
 * on deactivation.
 */

import { getContext, setContext } from 'svelte';
import type { ElementRegistry } from './element-registry';
import type { ToolRegistry } from './tool-registry';
import type { PanelRegistry } from './panel-registry';
import type { ExportRegistry } from './export-registry';
import type { EditorStore } from '../stores/editor.svelte';
import type { CanvasStore } from '../stores/canvas.svelte';
import type { EditorActions } from '../stores/editor-actions';
import type { CanvasElement } from '../stores/canvas-types';
import type {
  PluginAPI,
  PluginDefinition,
  PluginEventType,
  PluginEventPayloads,
} from './plugin-api';
import type { EditorTool } from '../stores/types';

const PLUGIN_MANAGER_KEY = Symbol('plugin-manager');
const API_VERSION = '1.0.0';

/** State descriptor for a registered plugin. */
export interface PluginRecord {
  /** The plugin specification. */
  definition: PluginDefinition;
  /** Current lifecycle status. */
  status: 'active' | 'disabled' | 'error';
  /** Error message if plugin activation failed. */
  error?: string;
  /** Elements registered by this plugin. */
  registeredElementKinds: Set<string>;
  /** Tools registered by this plugin. */
  registeredToolIds: Set<string>;
  /** Panels registered by this plugin. */
  registeredPanelIds: Set<string>;
  /** Exporters registered by this plugin. */
  registeredExporterIds: Set<string>;
  /** Event unsubscribe callbacks created by this plugin. */
  eventUnsubscribes: Set<() => void>;
}

export class PluginManager {
  private plugins = new Map<string, PluginRecord>();
  private eventListeners = new Map<string, Set<(payload: unknown) => void>>();

  constructor(
    private elementRegistry: ElementRegistry,
    private toolRegistry: ToolRegistry,
    private panelRegistry: PanelRegistry,
    private exportRegistry: ExportRegistry,
    private editorStore: EditorStore,
    private canvasStore: CanvasStore,
    private editorActions: EditorActions,
  ) {}

  /**
   * Registers and immediately activates a plugin definition.
   *
   * @param definition The plugin definition.
   */
  async register(definition: PluginDefinition): Promise<void> {
    if (this.plugins.has(definition.id)) {
      throw new Error(`Plugin with ID "${definition.id}" is already registered.`);
    }

    const record: PluginRecord = {
      definition,
      status: 'disabled',
      registeredElementKinds: new Set(),
      registeredToolIds: new Set(),
      registeredPanelIds: new Set(),
      registeredExporterIds: new Set(),
      eventUnsubscribes: new Set(),
    };

    this.plugins.set(definition.id, record);
    await this.enable(definition.id);
  }

  /**
   * Unregisters and deactivates a plugin.
   *
   * @param id The plugin identifier.
   */
  async unregister(id: string): Promise<void> {
    const record = this.plugins.get(id);
    if (!record) return;

    if (record.status === 'active') {
      await this.disable(id);
    }

    this.plugins.delete(id);
  }

  /**
   * Enables and activates a registered plugin.
   *
   * @param id The plugin identifier.
   */
  async enable(id: string): Promise<void> {
    const record = this.plugins.get(id);
    if (!record || record.status === 'active') return;

    const api = this.createPluginAPI(record);

    try {
      await record.definition.activate(api);
      record.status = 'active';
      delete record.error;
    } catch (err) {
      console.error(`Failed to activate plugin "${id}":`, err);
      record.status = 'error';
      record.error = err instanceof Error ? err.message : String(err);
      this.cleanupRecordRegistrations(record);
    }
  }

  /**
   * Disables and deactivates an active plugin, tearing down all its registrations.
   *
   * @param id The plugin identifier.
   */
  async disable(id: string): Promise<void> {
    const record = this.plugins.get(id);
    if (!record || record.status !== 'active') return;

    try {
      if (typeof record.definition.deactivate === 'function') {
        await record.definition.deactivate();
      }
    } catch (err) {
      console.error(`Error during deactivation of plugin "${id}":`, err);
    } finally {
      this.cleanupRecordRegistrations(record);
      record.status = 'disabled';
    }
  }

  /**
   * Retrieves a plugin record by identifier.
   *
   * @param id The plugin identifier.
   * @return The plugin record or undefined.
   */
  getPlugin(id: string): PluginRecord | undefined {
    return this.plugins.get(id);
  }

  /**
   * Retrieves all registered plugin records.
   *
   * @return Array of all plugin records.
   */
  getAllPlugins(): PluginRecord[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Broadcasts an editor lifecycle event to all subscribed listeners.
   *
   * @param event The event name.
   * @param payload The event payload data.
   */
  emit<E extends PluginEventType>(event: E, payload: PluginEventPayloads[E]): void {
    const listeners = this.eventListeners.get(event);
    if (!listeners) return;

    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error(`Error in event listener for "${event}":`, err);
      }
    }
  }

  /**
   * Subscribes to an editor lifecycle event.
   *
   * @param event The event name.
   * @param handler The event handler callback.
   * @return Unsubscribe function.
   */
  on<E extends PluginEventType>(
    event: E,
    handler: (payload: PluginEventPayloads[E]) => void
  ): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    const wrappedHandler = handler as (payload: unknown) => void;
    this.eventListeners.get(event)!.add(wrappedHandler);
    return () => {
      this.eventListeners.get(event)?.delete(wrappedHandler);
    };
  }

  /**
   * Creates a scoped PluginAPI instance for a given plugin record that tracks
   * all registrations for clean automatic rollback upon deactivation.
   */
  private createPluginAPI(record: PluginRecord): PluginAPI {
    const self = this;

    return {
      version: API_VERSION,

      elements: {
        register: (def) => {
          self.elementRegistry.register(def);
          record.registeredElementKinds.add(def.kind);
        },
        unregister: (kind) => {
          self.elementRegistry.unregister(kind);
          record.registeredElementKinds.delete(kind);
        },
      },

      canvas: {
        get elements(): CanvasElement[] {
          return self.canvasStore.elements;
        },
        selectElement: (id) => {
          self.canvasStore.selectElement(id);
        },
      },

      tools: {
        register: (def) => {
          self.toolRegistry.register(def);
          record.registeredToolIds.add(def.id);
        },
        unregister: (id) => {
          self.toolRegistry.unregister(id);
          record.registeredToolIds.delete(id);
        },
        setActive: (id) => {
          self.editorActions.setTool(id as EditorTool);
        },
      },

      panels: {
        register: (def) => {
          self.panelRegistry.register(def);
          record.registeredPanelIds.add(def.id);
        },
        unregister: (id) => {
          self.panelRegistry.unregister(id);
          record.registeredPanelIds.delete(id);
        },
      },

      exporters: {
        register: (def) => {
          self.exportRegistry.register(def);
          record.registeredExporterIds.add(def.id);
        },
        unregister: (id) => {
          self.exportRegistry.unregister(id);
          record.registeredExporterIds.delete(id);
        },
      },

      commands: {
        execute: async (command) => {
          await self.editorActions.executeCommand(command);
        },
      },

      document: {
        get isLoaded(): boolean {
          return self.editorStore.isDocumentLoaded;
        },
        get fileName(): string {
          return self.editorStore.fileName;
        },
        get pageCount(): number {
          return self.editorStore.pageCount;
        },
        get currentPageIndex(): number {
          return self.editorStore.currentPageIndex;
        },
        getPageDimensions: (pageIndex) => {
          if (!self.editorStore.isDocumentLoaded) return null;
          try {
            const page = self.editorActions.service.document.getPage(pageIndex);
            const dims = page.getDimensions();
            return {
              width: dims.widthPts,
              height: dims.heightPts,
            };
          } catch {
            return null;
          }
        },
      },

      events: {
        on: (event, handler) => {
          if (!self.eventListeners.has(event)) {
            self.eventListeners.set(event, new Set());
          }
          const wrappedHandler = handler as (payload: unknown) => void;
          self.eventListeners.get(event)!.add(wrappedHandler);

          const unsub = () => {
            self.eventListeners.get(event)?.delete(wrappedHandler);
            record.eventUnsubscribes.delete(unsub);
          };

          record.eventUnsubscribes.add(unsub);
          return unsub;
        },
        off: (event, handler) => {
          self.eventListeners.get(event)?.delete(handler as (payload: unknown) => void);
        },
      },
    };
  }

  /**
   * Cleans up all elements, tools, panels, exporters, and event listeners
   * registered by a plugin record.
   */
  private cleanupRecordRegistrations(record: PluginRecord): void {
    for (const kind of record.registeredElementKinds) {
      const elementsToRemove = this.canvasStore.elements.filter(e => e.kind === kind);
      for (const el of elementsToRemove) {
        this.canvasStore.removeElement(el.id);
      }
      this.elementRegistry.unregister(kind);
    }
    record.registeredElementKinds.clear();

    if (record.registeredToolIds.has(this.editorStore.activeTool)) {
      this.editorActions.setTool('select');
    }

    for (const toolId of record.registeredToolIds) {
      this.toolRegistry.unregister(toolId);
    }
    record.registeredToolIds.clear();

    if (record.registeredPanelIds.has(this.editorStore.leftPanelMode)) {
      this.editorStore.leftPanelMode = 'workspace';
    }

    for (const panelId of record.registeredPanelIds) {
      this.panelRegistry.unregister(panelId);
    }
    record.registeredPanelIds.clear();

    for (const exporterId of record.registeredExporterIds) {
      this.exportRegistry.unregister(exporterId);
    }
    record.registeredExporterIds.clear();

    for (const unsub of record.eventUnsubscribes) {
      unsub();
    }
    record.eventUnsubscribes.clear();
  }
}

/** Provide the plugin manager via Svelte context from a root component. */
export function providePluginManager(manager: PluginManager): void {
  setContext(PLUGIN_MANAGER_KEY, manager);
}

/** Retrieve the plugin manager from Svelte context in any child component. */
export function usePluginManager(): PluginManager {
  const manager = getContext<PluginManager>(PLUGIN_MANAGER_KEY);
  if (!manager) {
    throw new Error('PluginManager not found in context');
  }
  return manager;
}
