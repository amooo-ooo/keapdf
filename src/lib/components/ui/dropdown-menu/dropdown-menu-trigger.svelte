<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import DropdownButton, { type DropdownButtonProps } from "../dropdown-button/dropdown-button.svelte";

	export type DropdownMenuTriggerProps = DropdownMenuPrimitive.TriggerProps & {
		variant?: DropdownButtonProps["variant"];
		size?: DropdownButtonProps["size"];
		fillColor?: DropdownButtonProps["fillColor"];
		icon?: DropdownButtonProps["icon"];
		iconClass?: string;
		text?: string;
		label?: string;
		chevron?: boolean;
		chevronClass?: string;
		hasDivider?: boolean;
		split?: boolean;
		active?: boolean;
		onaction?: (e: MouseEvent) => void;
		actionClass?: string;
		actionAriaLabel?: string;
		chevronAriaLabel?: string;
		actionRef?: HTMLButtonElement | null;
		onChevronClick?: (e: MouseEvent) => void;
	};

	let {
		ref = $bindable(null),
		variant,
		...restProps
	}: DropdownMenuTriggerProps = $props();
</script>

{#if variant !== undefined || restProps.text !== undefined || restProps.label !== undefined || restProps.icon !== undefined || restProps.split !== undefined}
	<DropdownButton bind:ref {variant} {...restProps} />
{:else}
	<DropdownMenuPrimitive.Trigger bind:ref data-slot="dropdown-menu-trigger" {...restProps} />
{/if}
