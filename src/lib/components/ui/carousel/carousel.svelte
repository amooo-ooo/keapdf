<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { tryUseFeatureFlagStore } from "../../../../core/feature-flags.js";
	import {
		canNavigateNext,
		canNavigatePrevious,
		carouselVariants,
		clampSlideIndex,
		resolveNextSlideIndex,
		resolvePreviousSlideIndex,
		type CarouselOrientation,
		type CarouselSize,
		type CarouselVariant,
	} from "./carousel-variants.js";
	import { setCarouselCtx } from "./carousel-context.js";

	export type CarouselRootProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		activeIndex?: number;
		totalSlides?: number;
		loop?: boolean;
		orientation?: CarouselOrientation;
		variant?: CarouselVariant;
		size?: CarouselSize;
		autoplayIntervalMs?: number;
		onSlideChange?: (index: number) => void;
		children?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		activeIndex = $bindable(0),
		totalSlides = 1,
		loop = true,
		orientation = "horizontal",
		variant = "default",
		size = "default",
		autoplayIntervalMs = 0,
		onSlideChange,
		children,
		...restProps
	}: CarouselRootProps = $props();

	const featureFlags = tryUseFeatureFlagStore();

	let isPaused = $state(false);

	const canGoPrevious = $derived(canNavigatePrevious(activeIndex, totalSlides, loop));
	const canGoNext = $derived(canNavigateNext(activeIndex, totalSlides, loop));

	function goToSlide(targetIndex: number): void {
		const nextIdx = clampSlideIndex(targetIndex, totalSlides, loop);
		if (nextIdx !== activeIndex) {
			activeIndex = nextIdx;
			onSlideChange?.(nextIdx);
		}
	}

	function goNext(): void {
		if (!canGoNext) return;
		goToSlide(resolveNextSlideIndex(activeIndex, totalSlides, loop));
	}

	function goPrevious(): void {
		if (!canGoPrevious) return;
		goToSlide(resolvePreviousSlideIndex(activeIndex, totalSlides, loop));
	}

	function handleKeyDown(e: KeyboardEvent): void {
		if (orientation === "horizontal") {
			if (e.key === "ArrowLeft") {
				e.preventDefault();
				goPrevious();
			} else if (e.key === "ArrowRight") {
				e.preventDefault();
				goNext();
			}
		} else {
			if (e.key === "ArrowUp") {
				e.preventDefault();
				goPrevious();
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				goNext();
			}
		}

		if (e.key === "Home") {
			e.preventDefault();
			goToSlide(0);
		} else if (e.key === "End" && totalSlides > 0) {
			e.preventDefault();
			goToSlide(totalSlides - 1);
		}

		if (typeof restProps.onkeydown === "function") {
			(restProps.onkeydown as (evt: KeyboardEvent) => void)(e);
		}
	}

	// note: optional autoplay timer gated by components.carousel.autoplay flag
	$effect(() => {
		const autoplayAllowed =
			featureFlags ? featureFlags.isEnabled("components.carousel.autoplay") : true;
		if (!autoplayAllowed || autoplayIntervalMs <= 0 || totalSlides <= 1 || isPaused) {
			return;
		}
		const timer = setInterval(() => {
			goNext();
		}, autoplayIntervalMs);

		return () => {
			clearInterval(timer);
		};
	});

	setCarouselCtx({
		get activeIndex() {
			return activeIndex;
		},
		get totalSlides() {
			return totalSlides;
		},
		get loop() {
			return loop;
		},
		get orientation() {
			return orientation;
		},
		get variant() {
			return variant;
		},
		get size() {
			return size;
		},
		get canGoPrevious() {
			return canGoPrevious;
		},
		get canGoNext() {
			return canGoNext;
		},
		goToSlide,
		goNext,
		goPrevious,
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={ref}
	role="region"
	aria-roledescription="carousel"
	tabindex="0"
	data-slot="carousel"
	data-variant={variant}
	data-size={size}
	data-orientation={orientation}
	data-active-index={activeIndex}
	class={cn(carouselVariants({ variant, size, orientation }), className)}
	onpointerenter={() => {
		isPaused = true;
	}}
	onpointerleave={() => {
		isPaused = false;
	}}
	onfocusin={() => {
		isPaused = true;
	}}
	onfocusout={() => {
		isPaused = false;
	}}
	{...restProps}
	onkeydown={handleKeyDown}
>
	{@render children?.()}
</div>
