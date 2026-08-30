<script lang="ts">
	import { Slider as SliderPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		orientation = "horizontal",
		ticks = false,
		tickCount = 5,
		class: className,
		...restProps
	}: WithoutChildrenOrChild<SliderPrimitive.RootProps> & {
		ticks?: boolean | number[];
		tickCount?: number;
	} = $props();

	const computedTicks = $derived.by(() => {
		if (!ticks) return [];
		if (Array.isArray(ticks)) return ticks;
		const count = tickCount ?? 5;
		if (count <= 1) return [0, 100];
		return Array.from({ length: count }, (_, i) => (i / (count - 1)) * 100);
	});
</script>

<!--
Discriminated Unions + Destructing (required for bindable) do not
get along, so we shut typescript up by casting `value` to `never`.
-->
<SliderPrimitive.Root
	bind:ref
	bind:value={value as never}
	data-slot="slider"
	{orientation}
	class={cn(
		"data-vertical:min-h-40 relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:w-auto data-vertical:flex-col",
		className
	)}
	{...restProps}
>
	{#snippet children({ thumbItems })}
		<span
			data-slot="slider-track"
			data-orientation={orientation}
			class={cn(
				"relative grow overflow-hidden rounded-full bg-muted data-horizontal:h-1.5 data-horizontal:w-full data-vertical:h-full data-vertical:w-1.5"
			)}
		>
			<SliderPrimitive.Range
				data-slot="slider-range"
				class={cn(
					"bg-primary absolute select-none rounded-full data-horizontal:h-full data-vertical:w-full"
				)}
			/>
			{#if computedTicks.length > 0}
				{#each computedTicks as pct}
					<span
						class="absolute top-1/2 -translate-y-1/2 size-1 rounded-full bg-foreground/25 pointer-events-none -translate-x-1/2"
						style="left: {pct}%;"
						aria-hidden="true"
					></span>
				{/each}
			{/if}
		</span>
		{#each thumbItems as thumb (thumb.index)}
			<SliderPrimitive.Thumb
				data-slot="slider-thumb"
				index={thumb.index}
				class="size-4 rounded-full border-2 border-primary bg-background shadow-xs ring-offset-background transition-[color,box-shadow,transform] hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-grab active:cursor-grabbing block shrink-0 select-none disabled:pointer-events-none disabled:opacity-50"
			/>
		{/each}
	{/snippet}
</SliderPrimitive.Root>
