/**
 * Built-in panel registrations for left and right sidebars.
 */

import { Layers, Shapes, Wrench, Settings } from 'lucide-svelte';
import type { PanelRegistry } from '../core/panel-registry';
import ComponentsPanel from '../components/panels/ComponentsPanel.svelte';
import ToolsPanel from '../components/panels/ToolsPanel.svelte';
import SettingsPanel from '../components/panels/SettingsPanel.svelte';

/**
 * Registers all built-in sidebar panels into the panel registry.
 *
 * @param registry The target panel registry instance.
 */
export function registerBuiltinPanels(registry: PanelRegistry): void {
  // note: left panels ordered as workspace, components, tools, settings
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
    id: 'tools',
    label: 'Tools',
    subtitle: 'OCR, optimisation, redaction & imposition',
    icon: Wrench,
    position: 'left',
    component: ToolsPanel,
    order: 30,
  });

  // Built-in Annotate tab on the left panel is consolidated into Tools and Settings.
  // registry.registerBuiltin({
  //   id: 'annotate',
  //   label: 'Annotate',
  //   subtitle: 'Markup, redact & draw',
  //   icon: Highlighter,
  //   position: 'left',
  //   component: AnnotatePanel,
  //   order: 35,
  // });

  registry.registerBuiltin({
    id: 'settings',
    label: 'Settings',
    subtitle: 'Document info, metadata & security',
    icon: Settings,
    position: 'left',
    component: SettingsPanel,
    order: 40,
  });

  // Right Panels
  // Built-in Properties tab on the right panel is temporarily commented out.
  // registry.registerBuiltin({
  //   id: 'properties',
  //   label: 'Properties',
  //   position: 'right',
  //   order: 10,
  // });

  // Built-in Organizer tab on the right panel is temporarily commented out.
  // registry.registerBuiltin({
  //   id: 'organizer',
  //   label: 'Organizer',
  //   position: 'right',
  //   order: 20,
  // });
}
