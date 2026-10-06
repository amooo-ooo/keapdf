<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import {
		cardVariants,
		type CardSize,
		type CardVariant,
	} from "./card-variants.js";
	import { setCardCtx } from "./card-context.js";

	export type CardRootProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		variant?: CardVariant;
		size?: CardSize;
		selected?: boolean;
		children?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		variant = "default",
		size = "default",
		selected = false,
		children,
		...restProps
	}: CardRootProps = $props();

	setCardCtx({
		get variant() {
			return variant;
		},
		get size() {
			return size;
		},
		get selected() {
			return selected;
		},
	});
</script>

<div
	bind:this={ref}
	data-slot="card"
	data-variant={variant}
	data-size={size}
	data-selected={selected}
	class={cn(cardVariants({ variant, size, selected }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
