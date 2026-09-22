<script lang="ts" module>
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
	import { type VariantProps, tv } from "tailwind-variants";

	export const buttonVariants = tv({
		base: "focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-2xl border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-3 active:not-aria-[haspopup]:scale-[0.98] active:not-aria-[haspopup]:translate-y-px aria-invalid:ring-3 [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary/80",
				outline: "border-border bg-background text-foreground hover:bg-muted hover:text-foreground dark:hover:bg-input/30 aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:border-primary aria-pressed:hover:bg-primary/80 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:border-primary data-[active=true]:hover:bg-primary/80",
				secondary: "bg-secondary text-secondary-foreground aria-expanded:bg-secondary aria-expanded:text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-pressed:bg-primary aria-pressed:text-primary-foreground",
				ghost: "text-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/80 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:hover:bg-primary/80",
				destructive: "bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/20 text-destructive focus-visible:border-destructive/40 dark:hover:bg-destructive/30",
				panel: "w-full justify-start px-2 h-8 text-xs font-normal bg-panel hover:bg-muted hover:text-foreground dark:hover:bg-input/40 dark:bg-input/25 aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:border-primary aria-pressed:hover:bg-primary/80 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:border-primary data-[active=true]:hover:bg-primary/80 cursor-pointer [&[draggable=true]]:cursor-grab [&[draggable=true]:active]:cursor-grabbing",
				"panel-destructive": "w-full justify-start px-2 h-8 text-xs font-normal border-border bg-background hover:bg-destructive/10 text-destructive hover:text-destructive dark:bg-transparent",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
				compact: "h-8 gap-1 px-2 text-xs",
				xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-7 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
				lg: "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
				icon: "size-8",
				"icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-7",
				"icon-lg": "size-9",
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
		variant ?? (isPressed ? "default" : groupCtx?.variant ?? "default")
	);
	const effectiveSize = $derived(size ?? groupCtx?.size ?? "default");

	// note: align active and focus states in button groups with input surface styling
	const groupButtonActiveClasses = $derived(
		groupCtx && isPressed
			? "bg-input/50 text-foreground border-border hover:bg-input/70 aria-pressed:bg-input/50 aria-pressed:text-foreground aria-pressed:hover:bg-input/70 data-[active=true]:bg-input/50 data-[active=true]:text-foreground data-[active=true]:hover:bg-input/70"
			: undefined
	);
	const groupButtonFocusClasses = $derived(
		groupCtx ? "focus-visible:bg-input/50" : undefined
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
			className
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
			className
		)}
		{type}
		{disabled}
		{...restProps}
		onclick={handleButtonClick}
	>
		{@render children?.()}
	</button>
{/if}
