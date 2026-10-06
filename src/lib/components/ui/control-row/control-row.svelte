<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import {
		controlRowVariants,
		type ControlRowSize,
		type ControlRowVariant,
	} from "./control-row-variants.js";

	export type ControlRowProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		label?: string;
		description?: string;
		for?: string;
		divider?: boolean;
		size?: ControlRowSize;
		variant?: ControlRowVariant;
		children?: Snippet;
		labelSnippet?: Snippet;
		icon?: Snippet;
	};

	let {
		ref = $bindable(null),
		class: className,
		label,
		description,
		for: htmlFor,
		divider = false,
		size = "default",
		variant = "default",
		children,
		labelSnippet,
		icon,
		...restProps
	}: ControlRowProps = $props();
</script>

<div
	bind:this={ref}
	data-slot="control-row"
	data-variant={variant}
	data-size={size}
	class={cn(controlRowVariants({ size, variant }), className)}
	{...restProps}
>
	<div class="flex items-center gap-2 min-w-0">
		{#if icon}
			{@render icon()}
		{/if}
		{#if labelSnippet}
			{@render labelSnippet()}
		{:else if label}
			<div class="flex flex-col min-w-0">
				{#if htmlFor}
					<label for={htmlFor} title={label} class="text-xs font-medium text-foreground/90 truncate leading-tight cursor-pointer">
						{label}
					</label>
				{:else}
					<span title={label} class="text-xs font-medium text-foreground/90 truncate leading-tight">
						{label}
					</span>
				{/if}
				{#if description}
					<span title={description} class="text-xs text-muted-foreground truncate leading-tight mt-0.5">
						{description}
					</span>
				{/if}
			</div>
		{/if}

		{#if divider}
			<div class="h-3.5 w-px bg-border/80 shrink-0" aria-hidden="true"></div>
		{/if}
	</div>

	<div class="flex items-center gap-2 shrink-0">
		{@render children?.()}
	</div>
</div>
