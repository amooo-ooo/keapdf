<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { cardContentVariants, type CardSize } from "./card-variants.js";
	import { getCardCtx } from "./card-context.js";

	export type CardContentProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		size?: CardSize;
		children?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		size,
		children,
		...restProps
	}: CardContentProps = $props();

	const cardCtx = getCardCtx();
	const effectiveSize = $derived<CardSize>(size ?? cardCtx?.size ?? "default");
</script>

<div
	bind:this={ref}
	data-slot="card-content"
	data-size={effectiveSize}
	class={cn(cardContentVariants({ size: effectiveSize }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
