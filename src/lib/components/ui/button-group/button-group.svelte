<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { ButtonVariant, ButtonSize } from "$lib/components/ui/button/index.js";
	import {
		buttonGroupVariants,
		type ButtonGroupVariantProps,
		type ButtonGroupValue,
		setButtonGroupCtx,
	} from "./button-group-context.js";

	type Props = WithElementRef<HTMLAttributes<HTMLDivElement>> &
		ButtonGroupVariantProps & {
			variant?: ButtonVariant;
			size?: ButtonSize;
			value?: ButtonGroupValue;
			onValueChange?: (val: string | number) => void;
		};

	let {
		ref = $bindable(null),
		class: className,
		orientation = "horizontal",
		attached = true,
		shape = "default",
		variant,
		size,
		value,
		onValueChange,
		children,
		...restProps
	}: Props = $props();

	setButtonGroupCtx({
		get variant() {
			return variant;
		},
		get size() {
			return size;
		},
		get orientation() {
			return orientation;
		},
		get attached() {
			return attached;
		},
		get value() {
			return value;
		},
		get onValueChange() {
			return onValueChange;
		},
	});
</script>

<div
	bind:this={ref}
	role="group"
	data-slot="button-group"
	data-orientation={orientation}
	data-attached={attached ? "" : undefined}
	data-shape={shape}
	class={cn(buttonGroupVariants({ orientation, attached, shape }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
