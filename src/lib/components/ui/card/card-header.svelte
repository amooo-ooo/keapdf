<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { tryUseFeatureFlagStore } from "../../../../core/feature-flags.js";
	import {
		cardActionsVariants,
		cardHeaderVariants,
		cardTitleVariants,
		type CardSize,
	} from "./card-variants.js";
	import { getCardCtx } from "./card-context.js";

	export type CardHeaderProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		title?: string;
		divided?: boolean;
		size?: CardSize;
		actions?: Snippet;
		children?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		title,
		divided = true,
		size,
		actions,
		children,
		...restProps
	}: CardHeaderProps = $props();

	const cardCtx = getCardCtx();
	const featureFlags = tryUseFeatureFlagStore();
	const effectiveSize = $derived<CardSize>(size ?? cardCtx?.size ?? "default");
	const headerEnabled = $derived(
		featureFlags ? featureFlags.isEnabled("components.card.header") : true
	);
	const actionsEnabled = $derived(
		featureFlags ? featureFlags.isEnabled("components.card.actions") : true
	);
</script>

{#if headerEnabled}
	<div
		bind:this={ref}
		data-slot="card-header"
		data-divided={divided}
		data-size={effectiveSize}
		class={cn(cardHeaderVariants({ divided, size: effectiveSize }), className)}
		{...restProps}
	>
		{#if title}
			<span data-slot="card-title" class={cardTitleVariants()} title={title}>
				{title}
			</span>
		{/if}
		{@render children?.()}
		{#if actions && actionsEnabled}
			<div data-slot="card-actions" class={cardActionsVariants()}>
				{@render actions()}
			</div>
		{/if}
	</div>
{/if}
