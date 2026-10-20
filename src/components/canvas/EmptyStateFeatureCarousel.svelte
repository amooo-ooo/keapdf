<script lang="ts">
  import * as Carousel from '$lib/components/ui/carousel/index.js';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import {
    DEFAULT_EMPTY_STATE_FEATURES,
    resolveNextFeatureSlide,
    type EmptyStateFeatureSlide,
  } from './empty-state-features';

  export interface EmptyStateFeatureCarouselProps {
    slides?: readonly EmptyStateFeatureSlide[];
    initialIndex?: number;
    autoplayIntervalMs?: number;
  }

  let {
    slides = DEFAULT_EMPTY_STATE_FEATURES,
    initialIndex = 0,
    autoplayIntervalMs = 0,
  }: EmptyStateFeatureCarouselProps = $props();

  const featureFlags = useFeatureFlagStore();

  // svelte-ignore state_referenced_locally
  let activeIndex = $state<number>(initialIndex);

  const nextSlide = $derived(resolveNextFeatureSlide(slides, activeIndex));
  const slideLabels = $derived(slides.map((slide) => slide.shortTitle));
</script>

<div
  class="w-full md:w-[64%] relative min-h-[260px] md:min-h-full overflow-hidden bg-card border-t md:border-t-0 md:border-l border-border flex flex-col"
  data-slot="empty-state-feature-carousel"
>
  <Carousel.Root
    bind:activeIndex
    totalSlides={slides.length}
    loop={true}
    {autoplayIntervalMs}
    aria-label="KeaPDF Feature Showcase"
    class="w-full flex-1 flex flex-col justify-between min-h-0"
  >
    <Carousel.Content class="w-full flex-1 flex flex-col min-h-0">
      {#each slides as slide, idx (slide.id)}
        <Carousel.Item index={idx} label={slide.title} class="flex-1 min-h-0">
          <!-- note: top hero preview image area matching Figma Config showcase anatomy -->
          <div
            class="relative flex-1 min-h-[160px] w-full overflow-hidden bg-muted/20 {featureFlags.isEnabled('ui.subtle-image-outline') ? 'img-subtle-outline' : ''}"
          >
            <img
              src={slide.imageSrc}
              alt={slide.imageAlt}
              class="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
              loading="eager"
            />
          </div>

          <!-- note: bottom feature copy region matching left-column p-2 sm:p-4 and space-y-1.5 rhythm -->
          <div class="flex flex-col justify-start space-y-1.5 px-2 pt-2 sm:px-4 sm:pt-4 pb-2 bg-card border-t border-border/60 text-left shrink-0 min-h-[120px] md:min-h-[132px]">
            <h2
              class="text-sm font-semibold tracking-tight text-foreground text-balance truncate"
              title={slide.title}
            >
              {slide.title}
            </h2>
            <p class="text-xs text-muted-foreground leading-relaxed text-pretty">
              {slide.description}
            </p>
          </div>
        </Carousel.Item>
      {/each}
    </Carousel.Content>

    <!-- note: footer bar with interactive step dots and Figma-style Next button matching p-2 sm:p-4 outer inset -->
    {#if featureFlags.isEnabled('components.carousel.indicators') || featureFlags.isEnabled('components.carousel.controls')}
      <div class="flex items-center justify-between gap-1.5 px-2 pb-2 sm:px-4 sm:pb-4 pt-2 bg-card shrink-0">
        {#if featureFlags.isEnabled('components.carousel.indicators')}
          <Carousel.Indicators labels={slideLabels} />
        {:else}
          <div></div>
        {/if}

        {#if featureFlags.isEnabled('components.carousel.controls')}
          <div class="flex items-center gap-1.5 ml-auto">
            <Carousel.Previous
              variant="outline"
              size="sm"
              class="h-8 px-3 text-xs font-medium"
            />
            <Carousel.Next
              variant="default"
              size="sm"
              nextLabel={nextSlide.shortTitle}
              class="h-8 px-3 text-xs font-medium"
            />
          </div>
        {/if}
      </div>
    {/if}
  </Carousel.Root>
</div>
