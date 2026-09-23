<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const labelVariants = tv({
		base: "flex items-center gap-2 font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
		variants: {
			size: {
				default: "text-sm leading-none",
				compact: "text-[11px] leading-none text-muted-foreground",
			},
		},
		defaultVariants: {
			size: "default",
		},
	});

	export type LabelSize = VariantProps<typeof labelVariants>["size"];
</script>

<script lang="ts">
	import { Label as LabelPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		size = "default",
		...restProps
	}: LabelPrimitive.RootProps & {
		size?: LabelSize;
	} = $props();
</script>

<LabelPrimitive.Root
	bind:ref
	data-slot="label"
	data-size={size}
	class={cn(labelVariants({ size }), className)}
	{...restProps}
/>
