import { getContext, setContext } from "svelte";
import { type VariantProps, tv } from "tailwind-variants";
import type { ButtonVariant, ButtonSize } from "$lib/components/ui/button/index.js";

export const buttonGroupVariants = tv({
	base: "group/button-group inline-flex w-fit items-center",
	variants: {
		orientation: {
			horizontal: "flex-row",
			vertical: "flex-col items-stretch",
		},
		attached: {
			true: "",
			false: "gap-1",
		},
		shape: {
			default: "",
			pill: "!rounded-full [&>[data-slot=button]:first-child]:!rounded-l-full [&>[data-slot=button]:last-child]:!rounded-r-full [&>[data-slot=button]:only-child]:!rounded-full [&>button:first-child]:!rounded-l-full [&>button:last-child]:!rounded-r-full [&>button:only-child]:!rounded-full",
		},
	},
	compoundVariants: [
		{
			orientation: "horizontal",
			attached: true,
			class:
				"rounded-2xl [&>[data-slot=button]]:rounded-none [&>[data-slot=button]:first-child]:rounded-l-2xl [&>[data-slot=button]:last-child]:rounded-r-2xl [&>[data-slot=button]:only-child]:rounded-2xl [&>[data-slot=button]:not(:first-child)]:-ml-px [&>[data-slot=button]]:focus-visible:z-10 [&>[data-slot=button]:hover]:z-10 [&>[data-slot=button][aria-pressed=true]]:z-10 [&>[data-slot=button][data-active=true]]:z-10 [&>button]:rounded-none [&>button:first-child]:rounded-l-2xl [&>button:last-child]:rounded-r-2xl [&>button:only-child]:rounded-2xl [&>button:not(:first-child)]:-ml-px [&>button]:focus-visible:z-10 [&>button:hover]:z-10 [&>button[aria-pressed=true]]:z-10 [&>button[data-active=true]]:z-10 [&>[data-slot=button][aria-pressed=true]]:bg-input/50 [&>[data-slot=button][aria-pressed=true]]:text-foreground [&>[data-slot=button][data-active=true]]:bg-input/50 [&>[data-slot=button][data-active=true]]:text-foreground [&>[data-slot=button]:focus-visible]:bg-input/50 [&>button[aria-pressed=true]]:bg-input/50 [&>button[aria-pressed=true]]:text-foreground [&>button[data-active=true]]:bg-input/50 [&>button[data-active=true]]:text-foreground [&>button:focus-visible]:bg-input/50",
		},
		{
			orientation: "vertical",
			attached: true,
			class:
				"rounded-2xl [&>[data-slot=button]]:rounded-none [&>[data-slot=button]:first-child]:rounded-t-2xl [&>[data-slot=button]:last-child]:rounded-b-2xl [&>[data-slot=button]:only-child]:rounded-2xl [&>[data-slot=button]:not(:first-child)]:-mt-px [&>[data-slot=button]]:focus-visible:z-10 [&>[data-slot=button]:hover]:z-10 [&>[data-slot=button][aria-pressed=true]]:z-10 [&>[data-slot=button][data-active=true]]:z-10 [&>button]:rounded-none [&>button:first-child]:rounded-t-2xl [&>button:last-child]:rounded-b-2xl [&>button:only-child]:rounded-2xl [&>button:not(:first-child)]:-mt-px [&>button]:focus-visible:z-10 [&>button:hover]:z-10 [&>button[aria-pressed=true]]:z-10 [&>button[data-active=true]]:z-10 [&>[data-slot=button][aria-pressed=true]]:bg-input/50 [&>[data-slot=button][aria-pressed=true]]:text-foreground [&>[data-slot=button][data-active=true]]:bg-input/50 [&>[data-slot=button][data-active=true]]:text-foreground [&>[data-slot=button]:focus-visible]:bg-input/50 [&>button[aria-pressed=true]]:bg-input/50 [&>button[aria-pressed=true]]:text-foreground [&>button[data-active=true]]:bg-input/50 [&>button[data-active=true]]:text-foreground [&>button:focus-visible]:bg-input/50",
		},
	],
	defaultVariants: {
		orientation: "horizontal",
		attached: true,
		shape: "default",
	},
});

export type ButtonGroupVariantProps = VariantProps<typeof buttonGroupVariants>;

export type ButtonGroupValue = string | number | (string | number)[];

export interface ButtonGroupContext {
	variant?: ButtonVariant;
	size?: ButtonSize;
	orientation?: "horizontal" | "vertical";
	attached?: boolean;
	value?: ButtonGroupValue;
	onValueChange?: (val: string | number) => void;
}

const BUTTON_GROUP_KEY = Symbol("BUTTON_GROUP");

export function setButtonGroupCtx(ctx: ButtonGroupContext): void {
	setContext(BUTTON_GROUP_KEY, ctx);
}

export function getButtonGroupCtx(): ButtonGroupContext | undefined {
	return getContext<ButtonGroupContext>(BUTTON_GROUP_KEY);
}
