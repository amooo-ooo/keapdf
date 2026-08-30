/**
 * Built-in panel registrations for left and right sidebars.
 */

import { Layers, Shapes, Highlighter, LayoutGrid, Wrench, Settings } from 'lucide-svelte';
import type { PanelRegistry } from '../core/panel-registry';
import ComponentsPanel from '../components/panels/ComponentsPanel.svelte';
import AnnotatePanel from '../components/panels/AnnotatePanel.svelte';
import ImpositionPanel from '../components/panels/ImpositionPanel.svelte';
import ToolsPanel from '../components/panels/ToolsPanel.svelte';
import SettingsPanel from '../components/panels/SettingsPanel.svelte';

/**
 * Registers all built-in sidebar panels into the panel registry.
 *
 * @param registry The target panel registry instance.
 */
export function registerBuiltinPanels(registry: PanelRegistry): void {
  // Left Panels
  registry.registerBuiltin({
    id: 'workspace',
    label: 'Workspace',
    icon: Layers,
    position: 'left',
    order: 10,
  });

  registry.registerBuiltin({
    id: 'components',
    label: 'Components',
    subtitle: 'Insert text, images & shapes',
    icon: Shapes,
    position: 'left',
    component: ComponentsPanel,
    order: 20,
  });

  registry.registerBuiltin({
    id: 'annotate',
    label: 'Annotate',
    subtitle: 'Markup, redact & draw',
    icon: Highlighter,
    position: 'left',
    component: AnnotatePanel,
    order: 30,
  });

  registry.registerBuiltin({
    id: 'imposition',
    label: 'Page Imposition',
    subtitle: 'N-Up, booklet & sheet layouts',
    icon: LayoutGrid,
    position: 'left',
    component: ImpositionPanel,
    order: 40,
  });

  registry.registerBuiltin({
    id: 'tools',
    label: 'Tools & OCR',
    subtitle: 'OCR, extract & page numbers',
    icon: Wrench,
    position: 'left',
    component: ToolsPanel,
    order: 50,
  });

  registry.registerBuiltin({
    id: 'settings',
    label: 'Settings',
    subtitle: 'Document security & info',
    icon: Settings,
    position: 'left',
    component: SettingsPanel,
    order: 60,
  });

  // Right Panels
  registry.registerBuiltin({
    id: 'properties',
    label: 'Properties',
    position: 'right',
    order: 10,
  });

  // Built-in Organizer tab on the right panel is temporarily commented out.
  // registry.registerBuiltin({
  //   id: 'organizer',
  //   label: 'Organizer',
  //   position: 'right',
  //   order: 20,
  // });
}
