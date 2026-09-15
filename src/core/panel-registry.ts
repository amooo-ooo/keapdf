/**
 * Extensible panel registry for left and right sidebar panels and views.
 *
 * Enables core features and plugins to register custom panels, tool strips,
 * properties inspectors, and auxiliary tabs into the editor layout.
 */

import { getContext, setContext } from 'svelte';

const PANEL_REGISTRY_KEY = Symbol('panel-registry');

/** Target sidebar dock position for a panel. */
export type PanelPosition = 'left' | 'right' | 'bottom';

/** Specification for a registered sidebar panel or tool tab. */
export interface PanelDefinition {
  /** Unique panel identifier (e.g., 'workspace', 'components', 'annotate', 'tools', 'settings'). */
  id: string;
  /** Primary label displayed in navigation rail tooltips and panel headers. */
  label: string;
  /** Explanatory subtitle displayed in panel headers. */
  subtitle?: string;
  /** Icon component reference for the navigation rail trigger button. */
  icon?: unknown;
  /** Docking position in the editor shell. */
  position: PanelPosition;
  /** Component to render inside the panel body. */
  component?: unknown;
  /** Sort order weight (ascending) for positioning in navigation lists. */
  order: number;
  /** Optional keyboard shortcut to toggle this panel. */
  shortcut?: string;
}

/**
 * Registry managing registered sidebar panels and providing lookup
 * by dock position and identifier.
 */
export class PanelRegistry {
  private panels = new Map<string, PanelDefinition>();
  private builtinIds = new Set<string>();

  /**
   * Registers a panel definition.
   *
   * @param panel The panel definition to register.
   */
  register(panel: PanelDefinition): void {
    if (this.panels.has(panel.id)) {
      console.warn(`[PanelRegistry] Overwriting existing panel "${panel.id}". This may cause issues if the original was a built-in.`);
    }
    this.panels.set(panel.id, panel);
  }

  /**
   * Registers a built-in panel definition.
   *
   * @param panel The panel definition to register.
   */
  registerBuiltin(panel: PanelDefinition): void {
    this.builtinIds.add(panel.id);
    this.panels.set(panel.id, panel);
  }

  /**
   * Unregisters a panel definition by its identifier.
   *
   * @param id The panel identifier.
   */
  unregister(id: string): void {
    if (this.builtinIds.has(id)) {
      console.warn(`[PanelRegistry] Cannot unregister built-in panel "${id}".`);
      return;
    }
    this.panels.delete(id);
  }

  /**
   * Retrieves a panel definition by identifier.
   *
   * @param id The panel identifier.
   * @return The panel definition, or undefined if not found.
   */
  get(id: string): PanelDefinition | undefined {
    return this.panels.get(id);
  }

  /**
   * Checks whether a panel identifier is registered.
   *
   * @param id The panel identifier.
   * @return True if registered, false otherwise.
   */
  has(id: string): boolean {
    return this.panels.has(id);
  }

  /**
   * Retrieves all panels docked at a specific screen position, sorted by order weight.
   *
   * @param position The dock position ('left', 'right', 'bottom').
   * @return Array of sorted panel definitions for that position.
   */
  getByPosition(position: PanelPosition): PanelDefinition[] {
    return Array.from(this.panels.values())
      .filter((p) => p.position === position)
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Retrieves all registered panel definitions.
   *
   * @return Array of all registered panel definitions.
   */
  getAll(): PanelDefinition[] {
    return Array.from(this.panels.values()).sort((a, b) => a.order - b.order);
  }
}

/** Provide the panel registry via Svelte context from a root component. */
export function providePanelRegistry(registry: PanelRegistry): void {
  setContext(PANEL_REGISTRY_KEY, registry);
}

/** Retrieve the panel registry from Svelte context in any child component. */
export function usePanelRegistry(): PanelRegistry {
  const registry = getContext<PanelRegistry>(PANEL_REGISTRY_KEY);
  if (!registry) {
    throw new Error('PanelRegistry not found in context');
  }
  return registry;
}
