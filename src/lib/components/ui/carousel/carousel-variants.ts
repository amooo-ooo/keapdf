import { type VariantProps, tv } from "tailwind-variants";

/**
 * Styling recipe for the Carousel root primitive container.
 */
export const carouselVariants = tv({
	base: "group/carousel relative flex w-full overflow-hidden select-none outline-none font-sans",
	variants: {
		variant: {
			default: "bg-card text-card-foreground",
			card: "bg-card text-card-foreground border border-border rounded-2xl",
			ghost: "bg-transparent text-foreground border border-transparent",
		},
		size: {
			default: "",
			sm: "text-xs",
			compact: "text-xs",
			lg: "",
		},
		orientation: {
			horizontal: "flex-col",
			vertical: "flex-row",
		},
	},
	defaultVariants: {
		variant: "default",
		size: "default",
		orientation: "horizontal",
	},
});

export type CarouselVariant = VariantProps<typeof carouselVariants>["variant"];
export type CarouselSize = VariantProps<typeof carouselVariants>["size"];
export type CarouselOrientation = NonNullable<
	VariantProps<typeof carouselVariants>["orientation"]
>;

/**
 * Normalises a target slide index within the valid range of slides.
 *
 * @param index Target slide index to normalise.
 * @param totalSlides Total number of slides in the carousel.
 * @param loop Whether navigation wraps around at boundaries.
 * @return Normalised zero-based slide index.
 */
export function clampSlideIndex(
	index: number,
	totalSlides: number,
	loop: boolean = true
): number {
	if (totalSlides <= 0) {
		return 0;
	}
	if (loop) {
		return ((index % totalSlides) + totalSlides) % totalSlides;
	}
	return Math.max(0, Math.min(totalSlides - 1, index));
}

/**
 * Computes the next slide index from the current active slide.
 *
 * @param currentIndex Current zero-based slide index.
 * @param totalSlides Total number of slides in the carousel.
 * @param loop Whether navigation wraps around from the last slide to the first.
 * @return Resolved next slide index.
 */
export function resolveNextSlideIndex(
	currentIndex: number,
	totalSlides: number,
	loop: boolean = true
): number {
	return clampSlideIndex(currentIndex + 1, totalSlides, loop);
}

/**
 * Computes the previous slide index from the current active slide.
 *
 * @param currentIndex Current zero-based slide index.
 * @param totalSlides Total number of slides in the carousel.
 * @param loop Whether navigation wraps around from the first slide to the last.
 * @return Resolved previous slide index.
 */
export function resolvePreviousSlideIndex(
	currentIndex: number,
	totalSlides: number,
	loop: boolean = true
): number {
	return clampSlideIndex(currentIndex - 1, totalSlides, loop);
}

/**
 * Determines whether backward navigation is available from the current slide.
 *
 * @param currentIndex Current zero-based slide index.
 * @param totalSlides Total number of slides in the carousel.
 * @param loop Whether navigation wraps around at boundaries.
 * @return True if backward navigation can occur.
 */
export function canNavigatePrevious(
	currentIndex: number,
	totalSlides: number,
	loop: boolean = true
): boolean {
	if (totalSlides <= 1) {
		return false;
	}
	return loop || currentIndex > 0;
}

/**
 * Determines whether forward navigation is available from the current slide.
 *
 * @param currentIndex Current zero-based slide index.
 * @param totalSlides Total number of slides in the carousel.
 * @param loop Whether navigation wraps around at boundaries.
 * @return True if forward navigation can occur.
 */
export function canNavigateNext(
	currentIndex: number,
	totalSlides: number,
	loop: boolean = true
): boolean {
	if (totalSlides <= 1) {
		return false;
	}
	return loop || currentIndex < totalSlides - 1;
}
