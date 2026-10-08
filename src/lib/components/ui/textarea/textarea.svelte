<script lang="ts">
	import type { HTMLTextareaAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	type Props = WithElementRef<HTMLTextareaAttributes>;

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		"data-slot": dataSlot = "textarea",
		...restProps
	}: Props = $props();
</script>

<textarea
	bind:this={ref}
	bind:value
	data-slot={dataSlot}
	class={cn(
		"bg-input focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 flex min-h-16 w-full rounded-2xl px-2.5 py-2 text-sm font-sans transition-[color,box-shadow] duration-200 placeholder:text-muted-foreground focus-visible:ring-3 aria-invalid:ring-3 disabled:cursor-not-allowed disabled:opacity-50 outline-none",
		className
	)}
	{...restProps}
></textarea>
