<script lang="ts" module>
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
	import { type VariantProps, tv } from "tailwind-variants";

	export const buttonVariants = tv({
		base: "focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-2xl border border-transparent bg-clip-padding text-sm font-medium font-sans focus-visible:ring-3 aria-invalid:ring-3 [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap truncate min-w-0 transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary/80 border border-primary",
				outline: "border-border bg-background text-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:border-border data-[active=true]:bg-muted data-[active=true]:text-foreground data-[active=true]:border-border",
				secondary: "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground aria-pressed:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)] aria-pressed:text-secondary-foreground data-[active=true]:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)] data-[active=true]:text-secondary-foreground",
				ghost: "text-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-secondary aria-pressed:text-secondary-foreground data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground",
				panel: "w-full justify-start px-2 h-8 text-xs font-normal border border-border bg-panel hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:border-border data-[active=true]:bg-muted data-[active=true]:text-foreground data-[active=true]:border-border cursor-pointer [&[draggable=true]]:cursor-grab [&[draggable=true]:active]:cursor-grabbing",
				tile: "flex flex-col items-start justify-between h-auto min-h-[72px] p-3 text-left font-medium bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] border border-transparent whitespace-normal",
				"inline-text": "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground aria-pressed:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)] aria-pressed:text-secondary-foreground data-[active=true]:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_10%)] data-[active=true]:text-secondary-foreground [&_svg]:hidden !pl-3",
				link: "text-foreground underline-offset-4 hover:underline",
			},
			size: {
				default: "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 has-[svg:first-child:not(:last-child)]:pl-2.5 has-[svg:last-child:not(:first-child)]:pr-2.5 has-[>svg:first-child:not(:last-child)]:pl-2.5 has-[>svg:last-child:not(:first-child)]:pr-2.5",
				compact: "h-8 gap-1 px-2 text-xs has-[svg:first-child:not(:last-child)]:pl-1.5 has-[svg:last-child:not(:first-child)]:pr-1.5 has-[>svg:first-child:not(:last-child)]:pl-1.5 has-[>svg:last-child:not(:first-child)]:pr-1.5",
				xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 has-[svg:first-child:not(:last-child)]:pl-2 has-[svg:last-child:not(:first-child)]:pr-2 has-[>svg:first-child:not(:last-child)]:pl-2 has-[>svg:last-child:not(:first-child)]:pr-2 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-7 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 has-[svg:first-child:not(:last-child)]:pl-2.5 has-[svg:last-child:not(:first-child)]:pr-2.5 has-[>svg:first-child:not(:last-child)]:pl-2.5 has-[>svg:last-child:not(:first-child)]:pr-2.5",
				lg: "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 has-[svg:first-child:not(:last-child)]:pl-3 has-[svg:last-child:not(:first-child)]:pr-3 has-[>svg:first-child:not(:last-child)]:pl-3 has-[>svg:last-child:not(:first-child)]:pr-3",
				icon: "size-8 w-8",
				"icon-xs": "size-6 w-6 [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-7 w-7",
				"icon-lg": "size-9 w-9",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
	export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
			active?: boolean;
			value?: string | number;
		};
</script>

<script lang="ts">
	import { getButtonGroupCtx } from "$lib/components/ui/button-group/button-group-context.js";

	let {
		class: className,
		variant,
		size,
		active,
		value,
		ref = $bindable(null),
		href = undefined,
		type = "button",
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();

	const groupCtx = getButtonGroupCtx();
	const isValueMatch = $derived(
		groupCtx?.value !== undefined && value !== undefined
			? Array.isArray(groupCtx.value)
				? groupCtx.value.includes(value as never)
				: groupCtx.value === value
			: false
	);
	const isPressed = $derived(
		Boolean(
			active ??
				(isValueMatch ||
					(groupCtx && variant === "default") ||
					restProps["aria-pressed"] === true ||
					restProps["aria-pressed"] === "true")
		)
	);
	const ariaPressed = $derived(
		isPressed
			? ("true" as const)
			: restProps["aria-pressed"] === true || restProps["aria-pressed"] === "true"
				? ("true" as const)
				: restProps["aria-pressed"] === "mixed"
					? ("mixed" as const)
					: restProps["aria-pressed"] === false || restProps["aria-pressed"] === "false"
						? ("false" as const)
						: undefined
	);
	const effectiveVariant = $derived(
		groupCtx
			? isPressed
				? "secondary"
				: "ghost"
			: variant ?? (isPressed ? "secondary" : "default")
	);
	const effectiveSize = $derived(size ?? groupCtx?.size ?? "default");

	// note: align active and focus states in button groups with input surface styling
	const groupButtonActiveClasses = $derived(
		groupCtx && isPressed
			? "bg-secondary text-foreground border-transparent shadow-none hover:bg-secondary aria-pressed:bg-secondary aria-pressed:text-foreground data-[active=true]:bg-secondary data-[active=true]:bg-secondary data-[active=true]:text-foreground rounded-xl"
			: groupCtx
				? "bg-transparent text-muted-foreground border-transparent hover:bg-muted/50 hover:text-foreground rounded-xl"
				: undefined
	);
	const groupButtonFocusClasses = $derived(
		groupCtx ? "focus-visible:ring-1 focus-visible:ring-ring/50" : undefined
	);
	const groupButtonSizingClasses = $derived(
		groupCtx && groupCtx.attached !== false
			? groupCtx.orientation === "vertical"
				? "!w-full px-0"
				: "h-full !h-full self-stretch py-0"
			: undefined
	);

	function handleButtonClick(e: MouseEvent & { currentTarget: HTMLButtonElement }): void {
		if (groupCtx?.onValueChange && value !== undefined) {
			groupCtx.onValueChange(value);
		}
		if (typeof restProps.onclick === "function") {
			(restProps.onclick as (e: MouseEvent) => void)(e);
		}
	}

	function handleAnchorClick(e: MouseEvent & { currentTarget: HTMLAnchorElement }): void {
		if (disabled) {
			e.preventDefault();
			return;
		}
		if (groupCtx?.onValueChange && value !== undefined) {
			groupCtx.onValueChange(value);
		}
		if (typeof restProps.onclick === "function") {
			(restProps.onclick as (e: MouseEvent) => void)(e);
		}
	}
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		data-variant={effectiveVariant}
		data-size={effectiveSize}
		data-active={isPressed ? "true" : undefined}
		aria-pressed={ariaPressed}
		class={cn(
			buttonVariants({ variant: effectiveVariant, size: effectiveSize }),
			groupButtonActiveClasses,
			groupButtonFocusClasses,
			className,
			groupButtonSizingClasses
		)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? "link" : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
		onclick={handleAnchorClick}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		data-variant={effectiveVariant}
		data-size={effectiveSize}
		data-active={isPressed ? "true" : undefined}
		aria-pressed={ariaPressed}
		class={cn(
			buttonVariants({ variant: effectiveVariant, size: effectiveSize }),
			groupButtonActiveClasses,
			groupButtonFocusClasses,
			className,
			groupButtonSizingClasses
		)}
		{type}
		{disabled}
		{...restProps}
		onclick={handleButtonClick}
	>
		{@render children?.()}
	</button>
{/if}
