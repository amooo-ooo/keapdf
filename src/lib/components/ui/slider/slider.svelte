<script lang="ts" module>
	import { Slider as SliderPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import {
		sliderVariants,
		type SliderSize,
		type SliderVariant,
	} from "./slider-variants.js";

	export { sliderVariants, type SliderSize, type SliderVariant };

	export type SliderRootProps = WithoutChildrenOrChild<SliderPrimitive.RootProps> & {
		variant?: SliderVariant;
		size?: SliderSize;
		ticks?: boolean | number[];
		tickCount?: number;
		min?: number;
		max?: number;
		step?: number;
		unit?: string;
		showValue?: boolean;
		formatValue?: (val: number) => string;
	};
</script>

<script lang="ts">
	import { tryUseFeatureFlagStore } from "../../../../core/feature-flags.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		orientation = "horizontal",
		variant = "default",
		size = "default",
		ticks,
		tickCount,
		min = 0,
		max = 100,
		step,
		unit = "",
		showValue = true,
		formatValue,
		class: className,
		...restProps
	}: SliderRootProps = $props();

	let trackWidth = $state(0);

	const featureFlags = tryUseFeatureFlagStore();
	const isValueDisplayEnabled = $derived(
		featureFlags ? featureFlags.isEnabled("components.slider.value") : true
	);
	const isUnitsEnabled = $derived(
		featureFlags ? featureFlags.isEnabled("components.slider.units") : true
	);
	const isStepsEnabled = $derived(
		featureFlags ? featureFlags.isEnabled("components.slider.steps") : true
	);

	// note: resolve effective step so SliderPrimitive.Root snaps to explicit ticks or step increments
	const effectiveStep = $derived.by((): number | number[] => {
		if (Array.isArray(ticks) && ticks.length > 0) {
			const minVal = min ?? 0;
			const maxVal = max ?? 100;
			return Array.from(new Set([minVal, ...ticks, maxVal])).sort((a, b) => a - b);
		}
		if (typeof step === "number" && step > 0) {
			return step;
		}
		if ((variant === "stepped" || ticks === true) && typeof tickCount === "number" && tickCount > 0) {
			const range = (max ?? 100) - (min ?? 0);
			if (range > 0) {
				return range / (tickCount + 1);
			}
		}
		return 1;
	});

	const hasExplicitSteps = $derived(
		step !== undefined || variant === "stepped" || ticks === true || Array.isArray(ticks)
	);

	// note: determine whether step dots should be displayed based on limited step count and track width ratio
	const MAX_LIMITED_STEPS = 10;
	const MIN_PX_PER_STEP = 20;

	function canShowStepDots(totalTickItems: number): boolean {
		if (!isStepsEnabled || ticks === false || !hasExplicitSteps) {
			return false;
		}
		const stepsCount = totalTickItems - 1;
		if (stepsCount < 2 || stepsCount > MAX_LIMITED_STEPS) {
			return false;
		}
		const effectiveWidth = trackWidth > 0 ? trackWidth : 200;
		const pxPerStep = effectiveWidth / stepsCount;
		return pxPerStep >= MIN_PX_PER_STEP;
	}

	const effectiveVariant = $derived<NonNullable<SliderVariant>>(
		variant !== "default"
			? (variant ?? "default")
			: Array.isArray(value)
				? "range"
				: ticks
					? "stepped"
					: unit
						? "unit"
						: "default"
	);

	function formatSingleNumber(num: number): string {
		if (formatValue) {
			return formatValue(num);
		}
		const stepVal = typeof effectiveStep === "number" ? effectiveStep : (step ?? 1);
		const decimals =
			stepVal < 1 && String(stepVal).includes(".")
				? String(stepVal).split(".")[1]?.length ?? 1
				: 0;
		const rounded = decimals > 0 ? Number(num.toFixed(decimals)) : Math.round(num);
		const suffix = isUnitsEnabled && unit ? unit : "";
		return `${rounded}${suffix}`;
	}

	const formattedDisplayValue = $derived.by((): string => {
		if (value === undefined || value === null) {
			return formatSingleNumber(min ?? 0);
		}
		if (Array.isArray(value)) {
			if (value.length === 0) return formatSingleNumber(min ?? 0);
			if (value.length === 1) return formatSingleNumber(value[0]);
			return value.map((v) => formatSingleNumber(v)).join(" - ");
		}
		if (typeof value === "number" && !Number.isNaN(value)) {
			return formatSingleNumber(value);
		}
		return formatSingleNumber(min ?? 0);
	});
</script>

<SliderPrimitive.Root
	bind:ref
	bind:value={value as never}
	data-slot="slider"
	data-variant={effectiveVariant}
	data-size={size}
	data-horizontal={orientation === "horizontal" ? "" : undefined}
	data-vertical={orientation === "vertical" ? "" : undefined}
	{orientation}
	{min}
	{max}
	step={effectiveStep as number}
	class={cn(sliderVariants({ variant: effectiveVariant, size }), className)}
	{...restProps}
>
	{#snippet children({ thumbItems, tickItems })}
		<span
			bind:clientWidth={trackWidth}
			data-slot="slider-track"
			data-orientation={orientation}
			data-horizontal={orientation === "horizontal" ? "" : undefined}
			data-vertical={orientation === "vertical" ? "" : undefined}
			class={cn(
				"relative grow overflow-hidden rounded-2xl border border-border bg-background data-horizontal:h-8 data-horizontal:w-full data-vertical:h-full data-vertical:w-8 h-full w-full"
			)}
		>
			<SliderPrimitive.Range
				data-slot="slider-range"
				data-horizontal={orientation === "horizontal" ? "" : undefined}
				data-vertical={orientation === "vertical" ? "" : undefined}
				class={cn(
					"bg-secondary absolute select-none rounded-2xl data-horizontal:h-full data-horizontal:left-0 data-vertical:w-full data-vertical:bottom-0 h-full -mr-2 z-10"
				)}
			/>
			{#if canShowStepDots(tickItems.length)}
				{#each tickItems.slice(1, -1) as tick (tick.index)}
					<SliderPrimitive.Tick
						data-slot="slider-tick"
						index={tick.index}
						class="inset-y-0 my-auto size-1 rounded-full bg-foreground/25 pointer-events-none z-0 transition-opacity data-[bounded]:opacity-0"
					/>
				{/each}
			{/if}
			{#if showValue && isValueDisplayEnabled && orientation === "horizontal"}
				<span
					data-slot="slider-value"
					class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 z-20 text-left text-xs font-medium text-foreground/80 font-sans select-none"
					aria-hidden="true"
				>
					{formattedDisplayValue}
				</span>
			{/if}
		</span>
		{#each thumbItems as thumb (thumb.index)}
			<SliderPrimitive.Thumb
				data-slot="slider-thumb"
				index={thumb.index}
				class="top-0 h-full w-4 flex items-center justify-center outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm cursor-grab active:cursor-grabbing shrink-0 select-none disabled:pointer-events-none disabled:opacity-50 z-20"
			>
				<span
					class="w-[2px] h-3.5 rounded-full bg-foreground/60 transition-colors pointer-events-none"
					aria-hidden="true"
				></span>
			</SliderPrimitive.Thumb>
		{/each}
	{/snippet}
</SliderPrimitive.Root>
