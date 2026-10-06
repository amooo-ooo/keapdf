<script lang="ts">
	import { Checkbox as CheckboxPrimitive } from "bits-ui";
	import { Check as CheckIcon, Minus as MinusIcon } from "lucide-svelte";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import type { Snippet } from "svelte";

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		indeterminate = $bindable(false),
		class: className,
		children,
		...restProps
	}: WithoutChildrenOrChild<CheckboxPrimitive.RootProps> & {
		children?: Snippet;
	} = $props();
</script>

<CheckboxPrimitive.Root
	bind:ref
	bind:checked
	bind:indeterminate
	data-slot="checkbox"
	class={cn(
		"peer relative after:absolute after:-inset-1 bg-input focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 size-4 shrink-0 rounded-[4px] transition-[background-color] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-foreground data-[state=checked]:text-background data-[state=indeterminate]:bg-foreground data-[state=indeterminate]:text-background flex items-center justify-center",
		className
	)}
	{...restProps}
>
	{#snippet children({ checked, indeterminate })}
		{#if indeterminate}
			<MinusIcon class="size-3 stroke-[2.5]" />
		{:else if checked}
			<CheckIcon class="size-3 stroke-[2.5]" />
		{/if}
	{/snippet}
</CheckboxPrimitive.Root>
