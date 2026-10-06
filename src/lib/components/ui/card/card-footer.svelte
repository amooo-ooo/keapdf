<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { tryUseFeatureFlagStore } from "../../../../core/feature-flags.js";
	import { cardFooterVariants, type CardSize } from "./card-variants.js";
	import { getCardCtx } from "./card-context.js";

	export type CardFooterProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		divided?: boolean;
		size?: CardSize;
		children?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		divided = true,
		size,
		children,
		...restProps
	}: CardFooterProps = $props();

	const cardCtx = getCardCtx();
	const featureFlags = tryUseFeatureFlagStore();
	const effectiveSize = $derived<CardSize>(size ?? cardCtx?.size ?? "default");
	const footerEnabled = $derived(
		featureFlags ? featureFlags.isEnabled("components.card.footer") : true
	);
</script>

{#if footerEnabled}
	<div
		bind:this={ref}
		data-slot="card-footer"
		data-divided={divided}
		data-size={effectiveSize}
		class={cn(cardFooterVariants({ divided, size: effectiveSize }), className)}
		{...restProps}
	>
		{@render children?.()}
	</div>
{/if}
