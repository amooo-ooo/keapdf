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

	export type CarouselNextProps = WithElementRef<HTMLButtonAttributes> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		label?: string;
		nextLabel?: string;
		children?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		variant = "default",
		size = "sm",
		label = "Next",
		nextLabel,
		type = "button",
		disabled,
		children,
		onclick,
		...restProps
	}: CarouselNextProps = $props();

	const ctx = getCarouselCtx();
	const isDisabled = $derived(Boolean(disabled ?? (ctx ? !ctx.canGoNext : false)));
	const displayLabel = $derived(nextLabel ? `${label}: ${nextLabel}` : label);

	function handleClick(e: MouseEvent & { currentTarget: HTMLButtonElement }): void {
		ctx?.goNext();
		if (typeof onclick === "function") {
			onclick(e);
		}
	}
</script>

<button
	bind:this={ref}
	data-slot="carousel-next"
	data-variant={variant}
	data-size={size}
	{type}
	disabled={isDisabled}
	aria-label={restProps["aria-label"] ?? displayLabel}
	title={restProps.title ?? displayLabel}
	class={cn(buttonVariants({ variant, size }), "h-8", className)}
	{...restProps}
	onclick={handleClick}
>
	{#if children}
		{@render children()}
	{:else}
		<span class="truncate">{displayLabel}</span>
	{/if}
</button>
