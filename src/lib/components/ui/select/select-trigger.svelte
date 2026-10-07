<script lang="ts" module>
	import { Select as SelectPrimitive } from "bits-ui";
	import { cn, type WithoutChild } from "$lib/utils.js";

	export type SelectTriggerVariant = "default" | "border" | "borderful";

	export type SelectTriggerProps = WithoutChild<SelectPrimitive.TriggerProps> & {
		size?: "sm" | "default";
		variant?: SelectTriggerVariant;
	};
</script>

<script lang="ts">
	import { ChevronDown as ChevronDownIcon } from "lucide-svelte";

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = "default",
		variant = "default",
		...restProps
	}: SelectTriggerProps = $props();

	const isBorderVariant = $derived(
		variant === "border" ||
			variant === "borderful" ||
			(Boolean(className?.includes("border")) &&
				!className?.includes("border-0") &&
				!className?.includes("border-transparent"))
	);

	const surfaceClasses = $derived(
		isBorderVariant
			? "bg-background border border-border text-foreground"
			: "bg-input border-0"
	);
</script>

<SelectPrimitive.Trigger
	bind:ref
	data-slot="select-trigger"
	data-size={size}
	data-variant={isBorderVariant ? "border" : "default"}
	class={cn(
		"data-placeholder:text-muted-foreground focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 gap-1.5 rounded-2xl px-3 py-2 transition-[color,box-shadow] duration-200 focus-visible:ring-3 aria-invalid:ring-3 data-[size=default]:h-8 data-[size=sm]:h-7 *:data-[slot=select-value]:flex *:data-[slot=select-value]:gap-1.5 [&_svg:not([class*='size-'])]:size-3.5 flex w-fit items-center justify-between whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center [&_svg]:pointer-events-none [&_svg]:shrink-0 text-xs font-normal font-sans",
		surfaceClasses,
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<ChevronDownIcon class="text-muted-foreground size-3.5 pointer-events-none" />
</SelectPrimitive.Trigger>
