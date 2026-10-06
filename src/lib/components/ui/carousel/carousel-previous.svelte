<script lang="ts">
	import type { HTMLButtonAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import {
		buttonVariants,
		type ButtonSize,
		type ButtonVariant,
	} from "$lib/components/ui/button/index.js";
	import { getCarouselCtx } from "./carousel-context.js";

	export type CarouselPreviousProps = WithElementRef<HTMLButtonAttributes> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		label?: string;
		children?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		variant = "outline",
		size = "sm",
		label = "Previous",
		type = "button",
		disabled,
		children,
		onclick,
		...restProps
	}: CarouselPreviousProps = $props();

	const ctx = getCarouselCtx();
	const isDisabled = $derived(Boolean(disabled ?? (ctx ? !ctx.canGoPrevious : false)));

	function handleClick(e: MouseEvent & { currentTarget: HTMLButtonElement }): void {
		ctx?.goPrevious();
		if (typeof onclick === "function") {
			onclick(e);
		}
	}
</script>

<button
	bind:this={ref}
	data-slot="carousel-previous"
	data-variant={variant}
	data-size={size}
	{type}
	disabled={isDisabled}
	aria-label={restProps["aria-label"] ?? label}
	title={restProps.title ?? label}
	class={cn(buttonVariants({ variant, size }), "h-8", className)}
	{...restProps}
	onclick={handleClick}
>
	{#if children}
		{@render children()}
	{:else}
		<span>{label}</span>
	{/if}
</button>
