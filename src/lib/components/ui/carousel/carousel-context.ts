import { getContext, setContext } from "svelte";
import type {
	CarouselOrientation,
	CarouselSize,
	CarouselVariant,
} from "./carousel-variants.js";

/**
 * Shared state and navigation actions distributed by the Carousel root component.
 */
export interface CarouselContext {
	readonly activeIndex: number;
	readonly totalSlides: number;
	readonly loop: boolean;
	readonly orientation: CarouselOrientation;
	readonly variant: CarouselVariant;
	readonly size: CarouselSize;
	readonly canGoPrevious: boolean;
	readonly canGoNext: boolean;
	goToSlide: (index: number) => void;
	goNext: () => void;
	goPrevious: () => void;
}

const CAROUSEL_CONTEXT_KEY = Symbol("CAROUSEL_CONTEXT");

/**
 * Registers the Carousel context for descendant sub-components.
 *
 * @param ctx Carousel context object.
 */
export function setCarouselCtx(ctx: CarouselContext): void {
	setContext(CAROUSEL_CONTEXT_KEY, ctx);
}

/**
 * Retrieves the active Carousel context from an ancestor Carousel root.
 *
 * @return Carousel context or undefined when called outside a Carousel root.
 */
export function getCarouselCtx(): CarouselContext | undefined {
	return getContext<CarouselContext | undefined>(CAROUSEL_CONTEXT_KEY);
}
