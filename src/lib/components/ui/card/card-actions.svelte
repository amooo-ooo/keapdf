<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { tryUseFeatureFlagStore } from "../../../../core/feature-flags.js";
	import { cardActionsVariants } from "./card-variants.js";

	export type CardActionsProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		children?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: CardActionsProps = $props();

	const featureFlags = tryUseFeatureFlagStore();
	const actionsEnabled = $derived(
		featureFlags ? featureFlags.isEnabled("components.card.actions") : true
	);
</script>

{#if actionsEnabled}
	<div
		bind:this={ref}
		data-slot="card-actions"
		class={cn(cardActionsVariants(), className)}
		{...restProps}
	>
		{@render children?.()}
	</div>
{/if}
