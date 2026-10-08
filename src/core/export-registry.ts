/**
 * Extensible export format registry for document serialisation and downloads.
 *
 * Allows built-in export pipelines (PDF, flattened PDF, images) and community
 * plugins (e.g., Markdown, EPUB, JSON metadata) to register custom export
 * handlers.
 */

import { getContext, setContext } from 'svelte';
import type { PdfEditorService } from '../services/pdf-editor';
import type { EditorStore } from '../stores/editor.svelte';
import type { CanvasStore } from '../stores/canvas.svelte';
import type { EditorActions } from '../stores/editor-actions';
import type { CanvasElement } from '../stores/canvas-types';
import type { PageTransform } from '../stores/types';

const EXPORT_REGISTRY_KEY = Symbol('export-registry');

/** Execution context provided to export handlers. */
export interface ExportContext {
  /** Reactive editor state store. */
  editorStore: EditorStore;
  /** Reactive canvas elements store. */
  canvasStore: CanvasStore;
  /** Document mutation and download actions. */
  actions: EditorActions;
  /** PDF editor service facade. */
  service: PdfEditorService;
  /** Active canvas elements to bake or serialise. */
  canvasElements: CanvasElement[];
  /** Active page visual transforms. */
  pageTransforms: Record<number, PageTransform>;
}

/** Logical grouping category for organising export menu items. */
export type ExportCategory = 'pdf' | 'office' | 'data' | 'web' | 'image' | 'plugin';

/** Specification for an export format handler. */
export interface ExportDefinition {
  /** Unique format identifier (e.g., 'pdf', 'flattened-pdf', 'images', 'text'). */
  id: string;
  /** Display label shown in the Export dropdown menu. */
  label: string;
  /** Short description of the export format. */
  description?: string;
  /** File extension including the leading dot (e.g., '.pdf', '.png', '.zip', '.txt'). */
  extension: string;
  /** MIME type for the exported blob. */
  mimeType: string;
  /** Logical category for grouping in export menus. */
  category?: ExportCategory;
  /** Icon component reference for the export menu item. */
  icon?: unknown;
  /**
   * Executes the export operation. Can trigger a download directly or return
   * a Blob / Uint8Array for the caller to download.
   *
   * @param ctx The export context.
   * @return Promise resolving when export is complete.
   */
  export(ctx: ExportContext): Promise<void | Blob | Uint8Array>;
}

/** Submenu group metadata for cascading conversion categories in export dropdowns. */
export interface ExportSubmenuGroup {
  /** Category identifier. */
  category: 'office' | 'data' | 'web';
  /** Display title for the submenu trigger. */
  label: string;
  /** Enabled exporters belonging to this submenu. */
  items: ExportDefinition[];
}

/** Structured representation of enabled export items for dropdown rendering. */
export interface GroupedExportMenu {
  /** Top-level PDF export actions (PDF Document, Flattened PDF, Compress PDF...). */
  pdfItems: ExportDefinition[];
  /** Cascading submenus for document conversions (Microsoft Office, Spreadsheet / Data, Web & Text). */
  submenus: ExportSubmenuGroup[];
  /** Top-level image and custom plugin export actions. */
  trailingItems: ExportDefinition[];
}

/**
 * Resolves the right-aligned muted format extension label for an export item,
 * or null when the item opens an interactive configuration dialog that does not
 * require a file extension badge.
 *
 * @param exporter The export definition to inspect.
 * @return The formatted extension badge or null.
 */
export function getExportShortcutLabel(exporter: ExportDefinition): string | null {
  if (exporter.id === 'compress-pdf') {
    return null;
  }
  if (exporter.id === 'images') {
    return '.png / .jpg';
  }
  return exporter.extension || null;
}

/**
 * Organises a flat list of enabled exporters into top-level PDF actions,
 * cascading format conversion submenus, and trailing image/plugin actions.
 *
 * @param exporters The enabled export definitions to group.
 * @return Structured menu groups for dropdown rendering.
 */
export function groupExportersForMenu(exporters: ExportDefinition[]): GroupedExportMenu {
  const pdfItems = exporters.filter((exporter) => exporter.category === 'pdf');

  const officeItems = exporters.filter((exporter) => exporter.category === 'office');
  const dataItems = exporters.filter((exporter) => exporter.category === 'data');
  const webItems = exporters.filter((exporter) => exporter.category === 'web');

  const submenus: ExportSubmenuGroup[] = [];
  if (officeItems.length > 0) {
    submenus.push({ category: 'office', label: 'Microsoft Office', items: officeItems });
  }
  if (dataItems.length > 0) {
    submenus.push({ category: 'data', label: 'Spreadsheet / Data', items: dataItems });
  }
  if (webItems.length > 0) {
    submenus.push({ category: 'web', label: 'Web & Text', items: webItems });
  }

  const trailingItems = exporters.filter(
    (exporter) =>
      exporter.category === 'image' ||
      exporter.category === 'plugin' ||
      !exporter.category
  );

  return {
    pdfItems,
    submenus,
    trailingItems,
  };
}

/**
 * Registry managing available document export format handlers.
 */
export class ExportRegistry {
  private exporters = new Map<string, ExportDefinition>();
  private builtinIds = new Set<string>();

  /**
   * Registers a new export format definition.
   *
   * @param definition The export definition to register.
   */
  register(definition: ExportDefinition): void {
    if (this.exporters.has(definition.id)) {
      console.warn(`[ExportRegistry] Overwriting existing exporter "${definition.id}". This may cause issues if the original was a built-in.`);
    }
    this.exporters.set(definition.id, definition);
  }

  /**
   * Registers a built-in export format definition.
   *
   * @param definition The export definition to register.
   */
  registerBuiltin(definition: ExportDefinition): void {
    this.builtinIds.add(definition.id);
    this.exporters.set(definition.id, definition);
  }

  /**
   * Unregisters an export format definition by identifier.
   *
   * @param id The export identifier.
   */
  unregister(id: string): void {
    if (this.builtinIds.has(id)) {
      console.warn(`[ExportRegistry] Cannot unregister built-in exporter "${id}".`);
      return;
    }
    this.exporters.delete(id);
  }

  /**
   * Retrieves an export definition by identifier.
   *
   * @param id The export identifier.
   * @return The export definition, or undefined if not found.
   */
  get(id: string): ExportDefinition | undefined {
    return this.exporters.get(id);
  }

  /**
   * Checks whether an export format is registered.
   *
   * @param id The export identifier.
   * @return True if registered, false otherwise.
   */
  has(id: string): boolean {
    return this.exporters.has(id);
  }

  /**
   * Retrieves all registered export definitions.
   *
   * @return Array of all registered export definitions.
   */
  getAll(): ExportDefinition[] {
    return Array.from(this.exporters.values());
  }
}

/** Provide the export registry via Svelte context from a root component. */
export function provideExportRegistry(registry: ExportRegistry): void {
  setContext(EXPORT_REGISTRY_KEY, registry);
}

/** Retrieve the export registry from Svelte context in any child component. */
export function useExportRegistry(): ExportRegistry {
  const registry = getContext<ExportRegistry>(EXPORT_REGISTRY_KEY);
  if (!registry) {
    throw new Error('ExportRegistry not found in context');
  }
  return registry;
}
