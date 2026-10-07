/**
 * Styling recipe and type definitions for dropdown button trigger primitives.
 *
 * Provides tailwind-variants recipes for unified and separated split variants
 * alongside standard control sizing and background fill colour mappings.
 */

import { tv, type VariantProps } from 'tailwind-variants';

export const dropdownButtonVariants = tv({
  base: 'group/dropdown-button inline-flex items-center justify-between rounded-2xl text-xs font-medium font-sans outline-none select-none transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:border-ring aria-invalid:ring-destructive/20 disabled:pointer-events-none disabled:opacity-50 cursor-pointer shrink-0 whitespace-nowrap',
  variants: {
    variant: {
      default:
        'border border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground',
      bordered:
        'border border-border bg-background text-foreground hover:bg-muted/50 hover:text-foreground aria-expanded:bg-muted/60 aria-expanded:text-foreground data-[state=open]:bg-muted/60 data-[state=open]:text-foreground shadow-xs',
      filled:
        'border border-transparent bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)] data-[state=open]:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)]',
      'filled-bordered':
        'border border-transparent bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)] data-[state=open]:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)]',
      split:
        'border border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground',
      separated:
        'border border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground',
    },
    size: {
      default: 'h-8 pl-3.5 pr-1.5 gap-1',
      sm: 'h-7 pl-3 pr-1.5 gap-1',
      compact: 'h-7 pl-2.5 pr-1 gap-1',
      xs: 'h-6 pl-2 pr-1 gap-0.5 text-[11px]',
      lg: 'h-9 pl-4 pr-2 gap-1.5 text-sm',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export const dropdownSplitRootVariants = tv({
  base: 'group/dropdown-split inline-flex items-center gap-0 rounded-2xl select-none outline-none transition-[color,background-color,border-color,box-shadow] duration-150 ease-out shrink-0 p-0 box-border',
  variants: {
    variant: {
      default: 'border border-transparent bg-transparent text-muted-foreground',
      bordered: 'border border-border bg-background text-foreground shadow-xs',
      filled: 'border border-transparent bg-secondary text-secondary-foreground',
      'filled-bordered': 'border border-border/70 bg-secondary text-secondary-foreground',
      split: 'border border-transparent bg-transparent text-muted-foreground',
      separated: 'border border-transparent bg-transparent text-muted-foreground',
    },
    size: {
      default: 'h-8',
      sm: 'h-7',
      compact: 'h-7',
      xs: 'h-6',
      lg: 'h-9',
    },
  },
  defaultVariants: {
    variant: 'split',
    size: 'default',
  },
});

export const dropdownSplitActionVariants = tv({
  base: 'inline-flex items-center justify-center font-medium font-sans outline-none select-none transition-colors duration-150 ease-out focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer shrink-0 whitespace-nowrap h-full rounded-2xl',
  variants: {
    variant: {
      default: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80',
      bordered: 'bg-transparent text-foreground hover:bg-muted/50 hover:text-foreground active:bg-muted/70',
      filled: 'bg-transparent text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] active:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)]',
      'filled-bordered': 'bg-transparent text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] active:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)]',
      split: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80',
      separated: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80',
    },
    size: {
      default: 'px-2.5 text-xs gap-1.5',
      sm: 'px-2 text-xs gap-1.5',
      compact: 'px-1.5 text-xs gap-1',
      xs: 'px-1.5 text-[11px] gap-1',
      lg: 'px-3 text-sm gap-2',
    },
  },
  defaultVariants: {
    variant: 'split',
    size: 'default',
  },
});

export const dropdownSplitTriggerVariants = tv({
  base: 'inline-flex items-center justify-center font-sans outline-none select-none transition-colors duration-150 ease-out focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer shrink-0 h-full rounded-2xl',
  variants: {
    variant: {
      default: 'bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground active:bg-muted/80 data-[state=open]:bg-muted data-[state=open]:text-foreground',
      bordered: 'bg-transparent text-foreground hover:bg-muted/50 hover:text-foreground active:bg-muted/70 data-[state=open]:bg-muted/60 data-[state=open]:text-foreground',
      filled: 'bg-transparent text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] active:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)] data-[state=open]:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)]',
      'filled-bordered': 'bg-transparent text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] active:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)] data-[state=open]:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)]',
      split: 'bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground active:bg-muted/80 data-[state=open]:bg-muted data-[state=open]:text-foreground',
      separated: 'bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground active:bg-muted/80 data-[state=open]:bg-muted data-[state=open]:text-foreground',
    },
    size: {
      default: 'w-5 px-0.5',
      sm: 'w-4.5 px-0.5',
      compact: 'w-4 px-0.5',
      xs: 'w-4 px-0.5',
      lg: 'w-6 px-1',
    },
  },
  defaultVariants: {
    variant: 'split',
    size: 'default',
  },
});

export type DropdownButtonVariant = VariantProps<typeof dropdownButtonVariants>['variant'];
export type DropdownButtonSize = VariantProps<typeof dropdownButtonVariants>['size'];
export type DropdownButtonFillColor = 'secondary' | 'accent' | 'muted' | 'background' | 'primary';

export const DROPDOWN_BUTTON_FILL_CLASSES: Record<DropdownButtonFillColor, string> = {
  secondary:
    'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)] data-[state=open]:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)]',
  accent:
    'bg-accent text-accent-foreground hover:bg-accent/80 aria-expanded:bg-accent/90 data-[state=open]:bg-accent/90',
  muted:
    'bg-muted text-foreground hover:bg-muted/80 aria-expanded:bg-muted data-[state=open]:bg-muted',
  background:
    'bg-background text-foreground hover:bg-muted aria-expanded:bg-muted data-[state=open]:bg-muted',
  primary:
    'bg-primary text-primary-foreground hover:bg-primary/90 aria-expanded:bg-primary/90 data-[state=open]:bg-primary/90',
};

export const DROPDOWN_BUTTON_DIVIDER_CLASSES: Record<NonNullable<DropdownButtonVariant>, string> = {
  default: '',
  bordered: 'bg-border',
  filled: '',
  'filled-bordered': 'bg-background',
  split: '',
  separated: '',
};
