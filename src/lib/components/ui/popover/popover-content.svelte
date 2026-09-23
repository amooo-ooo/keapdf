<script lang="ts">
	import { Popover as PopoverPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		align = "center",
		children,
		...restProps
	}: PopoverPrimitive.ContentProps = $props();
</script>

<PopoverPrimitive.Content
	bind:ref
	data-slot="popover-content"
	data-bits-popover-content=""
	{sideOffset}
	{align}
	class={cn(
		"bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 rounded-2xl border border-border p-3 shadow-elevation-2 outline-none origin-(--bits-popover-content-transform-origin)",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</PopoverPrimitive.Content>
