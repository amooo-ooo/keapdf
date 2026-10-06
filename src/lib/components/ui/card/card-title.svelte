<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { cardTitleVariants } from "./card-variants.js";

	export type CardTitleProps = WithElementRef<HTMLAttributes<HTMLSpanElement>> & {
		children?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: CardTitleProps = $props();
</script>

<span
	bind:this={ref}
	data-slot="card-title"
	class={cn(cardTitleVariants(), className)}
	{...restProps}
>
	{@render children?.()}
</span>
