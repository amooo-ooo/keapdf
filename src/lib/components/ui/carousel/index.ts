import Root, { type CarouselRootProps } from "./carousel.svelte";
import Content, { type CarouselContentProps } from "./carousel-content.svelte";
import Item, { type CarouselItemProps } from "./carousel-item.svelte";
import Indicators, { type CarouselIndicatorsProps } from "./carousel-indicators.svelte";
import Previous, { type CarouselPreviousProps } from "./carousel-previous.svelte";
import Next, { type CarouselNextProps } from "./carousel-next.svelte";
import {
	carouselVariants,
	clampSlideIndex,
	resolveNextSlideIndex,
	resolvePreviousSlideIndex,
	canNavigatePrevious,
	canNavigateNext,
	type CarouselVariant,
	type CarouselSize,
	type CarouselOrientation,
} from "./carousel-variants.js";
import {
	getCarouselCtx,
	setCarouselCtx,
	type CarouselContext,
} from "./carousel-context.js";

export {
	Root,
	Content,
	Item,
	Indicators,
	Previous,
	Next,
	Root as Carousel,
	Content as CarouselContent,
	Item as CarouselItem,
	Indicators as CarouselIndicators,
	Previous as CarouselPrevious,
	Next as CarouselNext,
	carouselVariants,
	clampSlideIndex,
	resolveNextSlideIndex,
	resolvePreviousSlideIndex,
	canNavigatePrevious,
	canNavigateNext,
	getCarouselCtx,
	setCarouselCtx,
	type CarouselRootProps,
	type CarouselContentProps,
	type CarouselItemProps,
	type CarouselIndicatorsProps,
	type CarouselPreviousProps,
	type CarouselNextProps,
	type CarouselVariant,
	type CarouselSize,
	type CarouselOrientation,
	type CarouselContext,
};
