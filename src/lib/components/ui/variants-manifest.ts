/**
 * Comprehensive component styling variants and size specification manifest.
 *
 * Provides type-safe definitions, metadata, and default configurations for all
 * primitive UI components in the design system, facilitating programmatic inspection,
 * DOM attribute reflection, and live front-end gallery rendering.
 */

export interface ComponentVariantEntry {
  readonly componentName: string;
  readonly description: string;
  readonly slotName: string;
  readonly recipeName?: string;
  readonly variants: readonly string[];
  readonly defaultVariant?: string;
  readonly sizes?: readonly string[];
  readonly defaultSize?: string;
  readonly extraProperties?: Readonly<Record<string, readonly string[]>>;
}

export const COMPONENT_VARIANTS_MANIFEST: readonly ComponentVariantEntry[] = [
  {
    componentName: 'Button',
    description: 'Interactive button with panel actions, drag affordances, and destructive variants',
    slotName: 'button',
    recipeName: 'buttonVariants',
    variants: [
      'default',
      'outline',
      'secondary',
      'ghost',
      'destructive',
      'panel',
      'panel-destructive',
      'link',
    ],
    defaultVariant: 'default',
    sizes: [
      'default',
      'compact',
      'xs',
      'sm',
      'lg',
      'icon',
      'icon-xs',
      'icon-sm',
      'icon-lg',
    ],
    defaultSize: 'default',
  },
  {
    componentName: 'Badge',
    description: 'Status, categorisation, and notification chip',
    slotName: 'badge',
    recipeName: 'badgeVariants',
    variants: [
      'default',
      'secondary',
      'destructive',
      'success',
      'warning',
      'info',
      'outline',
      'ghost',
      'link',
    ],
    defaultVariant: 'default',
  },
  {
    componentName: 'ControlRow',
    description: 'Inspector settings row with label, description, and slot container',
    slotName: 'control-row',
    recipeName: 'controlRowVariants',
    variants: ['default', 'ghost', 'card'],
    defaultVariant: 'default',
    sizes: ['default', 'sm', 'compact'],
    defaultSize: 'default',
  },
  {
    componentName: 'Toggle',
    description: 'Two-state toggle switch button',
    slotName: 'toggle',
    recipeName: 'toggleVariants',
    variants: ['default', 'outline'],
    defaultVariant: 'default',
    sizes: ['default', 'sm', 'lg'],
    defaultSize: 'default',
  },
  {
    componentName: 'ButtonGroup',
    description: 'Segmented layout container distributing variants and sizes to child buttons',
    slotName: 'button-group',
    recipeName: 'buttonGroupVariants',
    variants: ['default'],
    defaultVariant: 'default',
    extraProperties: {
      orientation: ['horizontal', 'vertical'],
      shape: ['default', 'pill'],
    },
  },
  {
    componentName: 'Input',
    description: 'Text and numeric field with prefix badge and precision stepper chevrons',
    slotName: 'input',
    variants: ['default'],
    sizes: ['default', 'compact'],
    defaultSize: 'default',
  },
  {
    componentName: 'Label',
    description: 'Form input and field group descriptor label',
    slotName: 'label',
    recipeName: 'labelVariants',
    variants: ['default'],
    sizes: ['default', 'compact'],
    defaultSize: 'default',
  },
  {
    componentName: 'TabsList',
    description: 'Navigation tab bar container with default and line indicators',
    slotName: 'tabs-list',
    recipeName: 'tabsListVariants',
    variants: ['default', 'line'],
    defaultVariant: 'default',
  },
  {
    componentName: 'DropdownMenuItem',
    description: 'Menu item with standard and destructive actions',
    slotName: 'dropdown-menu-item',
    variants: ['default', 'destructive'],
    defaultVariant: 'default',
  },
  {
    componentName: 'SelectTrigger',
    description: 'Select dropdown trigger anchor with compact and standard sizing',
    slotName: 'select-trigger',
    variants: ['default'],
    sizes: ['default', 'sm'],
    defaultSize: 'default',
  },
  {
    componentName: 'ColorPicker',
    description: 'Colour selection control with 2D saturation-value reticle, sliders, and presets',
    slotName: 'color-picker',
    variants: ['default', 'circle', 'pill'],
    defaultVariant: 'default',
  },
] as const;

/**
 * Retrieves the variant specification for a registered component.
 *
 * @param componentName The name of the UI component to resolve.
 * @returns The matching ComponentVariantEntry, or undefined if not found.
 */
export function getComponentVariantManifest(
  componentName: string
): ComponentVariantEntry | undefined {
  return COMPONENT_VARIANTS_MANIFEST.find(
    (item) => item.componentName.toLowerCase() === componentName.toLowerCase()
  );
}

/**
 * Returns all component variant specifications in the manifest.
 *
 * @returns Array of all registered component variant entries.
 */
export function getAllComponentVariantManifests(): readonly ComponentVariantEntry[] {
  return COMPONENT_VARIANTS_MANIFEST;
}
