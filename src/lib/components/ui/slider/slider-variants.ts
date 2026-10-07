import { type VariantProps, tv } from "tailwind-variants";

export const sliderVariants = tv({
	base: "data-vertical:min-h-40 relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:w-auto data-vertical:flex-col shrink-0",
	variants: {
		variant: {
			default: "",
			stepped: "",
			range: "",
			unit: "",
		},
		size: {
			default: "h-8 data-horizontal:h-8",
			sm: "h-8 data-horizontal:h-8",
			compact: "h-7 data-horizontal:h-7",
			lg: "h-9 data-horizontal:h-9",
		},
	},
	defaultVariants: {
		variant: "default",
		size: "default",
	},
});

export type SliderVariant = VariantProps<typeof sliderVariants>["variant"];
export type SliderSize = VariantProps<typeof sliderVariants>["size"];
