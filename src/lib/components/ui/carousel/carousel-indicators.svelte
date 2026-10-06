<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { getCarouselCtx } from "./carousel-context.js";

	export type CarouselIndicatorsProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		labels?: readonly string[];
	};

	let {
		ref = $bindable(null),
		class: className,
		labels,
		...restProps
	}: CarouselIndicatorsProps = $props();

	const ctx = getCarouselCtx();
	const totalSlides = $derived(ctx?.totalSlides ?? 0);
	const activeIndex = $derived(ctx?.activeIndex ?? 0);
	const indices = $derived(Array.from({ length: totalSlides }, (_, idx) => idx));
</script>

{#if totalSlides > 1}
	<div
		bind:this={ref}
		role="tablist"
		aria-label="Slide navigation"
		data-slot="carousel-indicators"
		class={cn("inline-flex items-center gap-0.5", className)}
		{...restProps}
	>
		{#each indices as idx (idx)}
			{@const isActive = idx === activeIndex}
			{@const stepLabel = labels?.[idx] ? `Go to slide ${idx + 1}: ${labels[idx]}` : `Go to slide ${idx + 1}`}
			<button
				type="button"
				role="tab"
				aria-selected={isActive}
				aria-label={stepLabel}
				title={labels?.[idx] ?? `Slide ${idx + 1}`}
				data-slot="carousel-indicator"
				data-index={idx}
				data-active={isActive ? "true" : "false"}
				class="relative inline-flex min-h-6 items-center justify-center px-0.5 py-2 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
				onclick={() => ctx?.goToSlide(idx)}
			>
				<span
					class={cn(
						"h-1.5 rounded-full transition-[width,background-color] duration-150 ease-out",
						isActive
							? "w-4 bg-foreground"
							: "w-1.5 bg-muted-foreground/35 hover:bg-muted-foreground/60"
					)}
				></span>
			</button>
		{/each}
	</div>
{/if}
