<script lang="ts">
	import { cn } from "$lib/utils.js";
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { useMenuLevelContext } from "./dropdown-menu-sub-context.js";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		disabled,
		variant = "default",
		onfocus,
		onpointerenter,
		onpointerleave,
		...restProps
	}: DropdownMenuPrimitive.ItemProps & {
		inset?: boolean;
		variant?: "default" | "destructive";
	} = $props();

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

	function handleFocus(
		e: FocusEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		clearHoverTimer();
		onfocus?.(e);
		if (e.defaultPrevented || disabled) return;
		menuLevel?.closeAllSubs();
	}

	function handlePointerEnter(
		e: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		onpointerenter?.(e);
		if (e.defaultPrevented || disabled || e.pointerType === "touch") return;
		clearHoverTimer();
		if (!menuLevel?.hasOpenSub()) return;
		const targetEl = ref ?? e.currentTarget;
		hoverTimer = setTimeout(() => {
			hoverTimer = null;
			if (disabled) return;
			targetEl?.focus({ preventScroll: true });
			menuLevel?.closeAllSubs();
		}, 100);
	}

	function handlePointerLeave(
		e: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		clearHoverTimer();
		onpointerleave?.(e);
	}
</script>

<DropdownMenuPrimitive.Item
	bind:ref
	data-slot="dropdown-menu-item"
	data-inset={inset}
	data-variant={variant}
	{disabled}
	onfocus={handleFocus}
	onpointerenter={handlePointerEnter}
	onpointerleave={handlePointerLeave}
	class={cn(
		"data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[variant=destructive]:text-foreground data-[variant=destructive]:data-highlighted:bg-destructive/10 dark:data-[variant=destructive]:data-highlighted:bg-destructive/20 data-[variant=destructive]:data-highlighted:text-foreground data-[variant=destructive]:*:[svg]:!text-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:ps-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-']):not([class*='w-'])]:size-3.5 [&_svg.mr-2]:mr-0",
		className
	)}
	{...restProps}
/>
