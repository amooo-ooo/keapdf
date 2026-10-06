<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { getCarouselCtx } from "./carousel-context.js";

	export type CarouselItemProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		index: number;
		label?: string;
		children?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		index,
		label,
		children,
		...restProps
	}: CarouselItemProps = $props();

	const ctx = getCarouselCtx();
	const isActive = $derived(ctx ? ctx.activeIndex === index : index === 0);
	const totalSlides = $derived(ctx?.totalSlides ?? 1);
</script>

{#if isActive}
	<div
		bind:this={ref}
		role="group"
		aria-roledescription="slide"
		aria-label={label ?? `Slide ${index + 1} of ${totalSlides}`}
		aria-hidden={!isActive}
		data-slot="carousel-item"
		data-index={index}
		data-active={isActive ? "true" : "false"}
		class={cn(
			"w-full flex-1 min-h-0 flex flex-col justify-between transition-opacity duration-150 ease-out opacity-100 relative z-10",
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</div>
{/if}
