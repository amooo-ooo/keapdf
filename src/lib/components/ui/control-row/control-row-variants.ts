import { type VariantProps, tv } from "tailwind-variants";

export const controlRowVariants = tv({
	base: "relative flex w-full items-center justify-between gap-2 rounded-2xl border border-border/50 bg-muted/40 px-3 py-1.5 transition-colors hover:bg-muted/60 select-none",
	variants: {
		size: {
			default: "min-h-9",
			sm: "min-h-8 px-2.5 py-1 text-xs",
			compact: "min-h-7 px-2 py-0.5 text-xs",
		},
		variant: {
			default: "",
			ghost: "border-transparent bg-transparent hover:bg-muted/30",
			card: "bg-card border-border shadow-2xs hover:bg-muted/20",
		},
	},
	defaultVariants: {
		size: "default",
		variant: "default",
	},
});

export type ControlRowSize = VariantProps<typeof controlRowVariants>["size"];
export type ControlRowVariant = VariantProps<typeof controlRowVariants>["variant"];
