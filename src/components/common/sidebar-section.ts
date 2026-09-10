/**
 * SidebarSection styling variants and helper utilities.
 *
 * Provides typed class variants for section headers ensuring consistent
 * layout across sidebar panels without background hover mutations.
 */

import { type VariantProps, tv } from "tailwind-variants";

export const sidebarSectionHeaderVariants = tv({
  base: 'sidebar-section-header select-none',
  variants: {
    collapsible: {
      true: 'cursor-pointer',
      false: '',
    },
  },
  defaultVariants: {
    collapsible: false,
  },
});

export type SidebarSectionHeaderVariantProps = VariantProps<typeof sidebarSectionHeaderVariants>;
