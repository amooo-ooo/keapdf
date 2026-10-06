import { getContext, setContext } from "svelte";
import { type VariantProps, tv } from "tailwind-variants";
import type { ButtonVariant, ButtonSize } from "$lib/components/ui/button/index.js";

export const buttonGroupVariants = tv({
	base: "group/button-group inline-flex w-fit items-center bg-background border border-border rounded-2xl p-1",
	variants: {
		orientation: {
			horizontal: "flex-row gap-1",
			vertical: "flex-col items-stretch gap-1 !h-auto",
		},
		variant: {
			default: "",
			outline: "",
			secondary: "",
			ghost: "!bg-transparent !border-transparent !p-0 gap-0.5",
			panel: "",
			tile: "",
			link: "",
		},
		attached: {
			true: "",
			false: "!p-0 !border-transparent !bg-transparent !h-auto gap-1",
		},
		shape: {
			default: "",
			pill: "!rounded-full [&>[data-slot=button]]:!rounded-full [&>button]:!rounded-full",
		},
		size: {
			default: "h-8",
			compact: "h-8",
			sm: "h-8",
			xs: "h-6",
			lg: "h-9",
			icon: "h-8",
			"icon-xs": "h-6",
			"icon-sm": "h-8",
			"icon-lg": "h-9",
		},
	},
	compoundVariants: [
		{
			orientation: "horizontal",
			attached: true,
			class:
				"shrink-0 [&>[data-slot=button]]:rounded-xl [&>[data-slot=button]]:border-0 [&>[data-slot=button]]:!h-full [&>[data-slot=button]]:self-stretch [&>[data-slot=button]]:py-0 [&>[data-slot=button]]:focus-visible:z-10 [&>[data-slot=button]:hover]:z-10 [&>[data-slot=button][aria-pressed=true]]:z-10 [&>[data-slot=button][data-active=true]]:z-10 [&>button]:rounded-xl [&>button]:border-0 [&>button]:!h-full [&>button]:self-stretch [&>button]:py-0 [&>button]:focus-visible:z-10 [&>button:hover]:z-10 [&>button[aria-pressed=true]]:z-10 [&>button[data-active=true]]:z-10 [&>[data-slot=button][aria-pressed=true]]:bg-secondary [&>[data-slot=button][aria-pressed=true]]:text-foreground [&>[data-slot=button][data-active=true]]:bg-secondary [&>[data-slot=button][data-active=true]]:text-foreground [&>[data-slot=button]:focus-visible]:bg-secondary [&>button[aria-pressed=true]]:bg-secondary [&>button[aria-pressed=true]]:text-foreground [&>button[data-active=true]]:bg-secondary [&>button[data-active=true]]:text-foreground [&>button:focus-visible]:bg-secondary",
		},
		{
			orientation: "vertical",
			attached: true,
			class:
				"[&>[data-slot=button]]:rounded-xl [&>[data-slot=button]]:border-0 [&>[data-slot=button]]:!w-full [&>[data-slot=button]]:px-0 [&>[data-slot=button]]:focus-visible:z-10 [&>[data-slot=button]:hover]:z-10 [&>[data-slot=button][aria-pressed=true]]:z-10 [&>[data-slot=button][data-active=true]]:z-10 [&>button]:rounded-xl [&>button]:border-0 [&>button]:!w-full [&>button]:px-0 [&>button]:focus-visible:z-10 [&>button:hover]:z-10 [&>button[aria-pressed=true]]:z-10 [&>button[data-active=true]]:z-10 [&>[data-slot=button][aria-pressed=true]]:bg-secondary [&>[data-slot=button][aria-pressed=true]]:text-foreground [&>[data-slot=button][data-active=true]]:bg-secondary [&>[data-slot=button][data-active=true]]:text-foreground [&>[data-slot=button]:focus-visible]:bg-secondary [&>button[aria-pressed=true]]:bg-secondary [&>button[aria-pressed=true]]:text-foreground [&>button[data-active=true]]:bg-secondary [&>button[data-active=true]]:text-foreground [&>button:focus-visible]:bg-secondary",
		},
	],
	defaultVariants: {
		variant: "default",
		orientation: "horizontal",
		attached: true,
		shape: "default",
		size: "default",
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
