<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { getCarouselCtx } from "./carousel-context.js";

	export type CarouselContentProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		children?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: CarouselContentProps = $props();

	const ctx = getCarouselCtx();
	const orientation = $derived(ctx?.orientation ?? "horizontal");
</script>

<div
	bind:this={ref}
	data-slot="carousel-content"
	data-orientation={orientation}
	aria-live="polite"
	class={cn("relative flex w-full flex-1 min-h-0 overflow-hidden", className)}
	{...restProps}
>
	{@render children?.()}
</div>
