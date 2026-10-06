import { type VariantProps, tv } from "tailwind-variants";

/**
 * Styling recipe for the composable Card root container.
 */
export const cardVariants = tv({
	base: "group/card relative flex flex-col border border-border rounded-2xl bg-card text-card-foreground overflow-hidden font-sans",
	variants: {
		variant: {
			default: "border-border bg-card",
			interactive:
				"border-border bg-card transition-[border-color,background-color] hover:border-ring",
			dashed: "border-dashed border-border bg-card",
			ghost: "border-transparent bg-transparent",
		},
		size: {
			default: "px-2",
			sm: "px-2",
			compact: "px-1.5",
			lg: "px-3",
		},
		selected: {
			true: "border-foreground/40 ring-1 ring-ring",
			false: "",
		},
	},
	defaultVariants: {
		variant: "default",
		size: "default",
		selected: false,
	},
});

/**
 * Styling recipe for the Card header slot with optional full-bleed bottom border.
 */
export const cardHeaderVariants = tv({
	base: "-mx-3 pl-3 pr-2 py-1 flex items-center justify-between gap-2",
	variants: {
		divided: {
			true: "border-b border-border",
			false: "",
		},
		size: {
			default: "py-1",
			sm: "py-1",
			compact: "py-0.5",
			lg: "py-1.5",
		},
	},
	defaultVariants: {
		divided: true,
		size: "default",
	},
});

/**
 * Styling recipe for the Card title element.
 */
export const cardTitleVariants = tv({
	base: "sidebar-section-title text-xs leading-snug font-semibold text-foreground flex items-center gap-1.5 min-w-0",
});

/**
 * Styling recipe for the Card description element.
 */
export const cardDescriptionVariants = tv({
	base: "text-[11px] text-muted-foreground leading-normal",
});

/**
 * Styling recipe for the Card actions slot.
 */
export const cardActionsVariants = tv({
	base: "flex items-center gap-1 shrink-0",
});

/**
 * Styling recipe for the Card body content slot.
 */
export const cardContentVariants = tv({
	base: "py-2 flex flex-col gap-1",
	variants: {
		size: {
			default: "py-2",
			sm: "py-1.5",
			compact: "py-1",
			lg: "py-2.5",
		},
	},
	defaultVariants: {
		size: "default",
	},
});

/**
 * Styling recipe for the Card footer slot with optional full-bleed top border.
 */
export const cardFooterVariants = tv({
	base: "-mx-3 pl-3 pr-2 py-1.5 flex items-center justify-between gap-2",
	variants: {
		divided: {
			true: "border-t border-border",
			false: "",
		},
		size: {
			default: "py-1.5",
			sm: "py-1",
			compact: "py-1",
			lg: "py-2",
		},
	},
	defaultVariants: {
		divided: true,
		size: "default",
	},
});

export type CardVariant = NonNullable<VariantProps<typeof cardVariants>["variant"]>;
export type CardSize = NonNullable<VariantProps<typeof cardVariants>["size"]>;
