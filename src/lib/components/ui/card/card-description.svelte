<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { cardDescriptionVariants } from "./card-variants.js";

	export type CardDescriptionProps = WithElementRef<HTMLAttributes<HTMLParagraphElement>> & {
		children?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: CardDescriptionProps = $props();
</script>

<p
	bind:this={ref}
	data-slot="card-description"
	class={cn(cardDescriptionVariants(), className)}
	{...restProps}
>
	{@render children?.()}
</p>
