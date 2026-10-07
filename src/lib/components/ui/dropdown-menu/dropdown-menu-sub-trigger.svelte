<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { ChevronRight as ChevronRightIcon } from "lucide-svelte";
	import { cn } from "$lib/utils.js";
	import {
		useMenuLevelContext,
		useSubmenuController,
	} from "./dropdown-menu-sub-context.js";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		disabled,
		children,
		onclick,
		onpointerenter,
		onpointerleave,
		...restProps
	}: DropdownMenuPrimitive.SubTriggerProps & {
		inset?: boolean;
	} = $props();

	const subController = useSubmenuController();
	const menuLevel = useMenuLevelContext();
	let hoverTimer: ReturnType<typeof setTimeout> | null = null;

	function clearHoverTimer(): void {
		if (hoverTimer !== null) {
			clearTimeout(hoverTimer);
			hoverTimer = null;
		}
	}

	$effect(() => {
		return () => {
			clearHoverTimer();
		};
	});

	function handlePointerEnter(
		e: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		onpointerenter?.(e);
		if (e.defaultPrevented || disabled || e.pointerType === "touch") return;
		clearHoverTimer();
		const targetEl = ref ?? e.currentTarget;
		hoverTimer = setTimeout(() => {
			hoverTimer = null;
			if (disabled) return;
			targetEl?.focus({ preventScroll: true });
			if (subController) {
				subController.open();
			} else {
				menuLevel?.closeAllSubs();
			}
		}, 100);
	}

	function handlePointerLeave(
		e: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		clearHoverTimer();
		onpointerleave?.(e);
	}

	function handleClick(
		e: MouseEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		clearHoverTimer();
		onclick?.(e);
		if (e.defaultPrevented || disabled) return;
		const targetEl = ref ?? e.currentTarget;
		targetEl?.focus({ preventScroll: true });
		subController?.open();
	}
</script>

<DropdownMenuPrimitive.SubTrigger
	bind:ref
	data-slot="dropdown-menu-sub-trigger"
	data-inset={inset}
	{disabled}
	onclick={handleClick}
	onpointerenter={handlePointerEnter}
	onpointerleave={handlePointerLeave}
	class={cn(
		"data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:ps-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-']):not([class*='w-'])]:size-3.5 [&_svg.mr-2]:mr-0",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<ChevronRightIcon class="ms-auto size-3.5" />
</DropdownMenuPrimitive.SubTrigger>
