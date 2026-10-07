<script lang="ts">
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import DropdownMenuPortal from "./dropdown-menu-portal.svelte";
	import {
		disengageAncestorSubContentIntent,
		isTargetInsideSubContent,
		provideMenuLevelContext,
		useSubmenuController,
	} from "./dropdown-menu-sub-context.js";
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		sideOffset = 2,
		portalProps,
		class: className,
		onInteractOutside,
		onpointerenter,
		...restProps
	}: DropdownMenuPrimitive.SubContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DropdownMenuPortal>>;
	} = $props();

	const parentSub = useSubmenuController();
	const menuLevel = provideMenuLevelContext(parentSub);

	$effect(() => {
		return () => {
			menuLevel.dispose();
		};
	});

	function handleInteractOutside(e: PointerEvent): void {
		onInteractOutside?.(e);
		if (e.defaultPrevented) return;
		if (isTargetInsideSubContent(e.target)) {
			e.preventDefault();
		}
	}

	function handlePointerEnter(
		e: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		onpointerenter?.(e);
		if (e.defaultPrevented) return;
		disengageAncestorSubContentIntent(
			ref ?? e.currentTarget,
			e.pointerType || "mouse",
			e.clientX,
			e.clientY
		);
	}
</script>

<DropdownMenuPortal {...portalProps}>
	<DropdownMenuPrimitive.SubContent
		bind:ref
		data-slot="dropdown-menu-sub-content"
		{sideOffset}
		onInteractOutside={handleInteractOutside}
		onpointerenter={handlePointerEnter}
		class={cn(
			"bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-end-2 data-[side=right]:slide-in-from-start-2 data-[side=top]:slide-in-from-bottom-2 duration-150 ease-out z-50 max-h-(--bits-dropdown-menu-content-available-height) min-w-[8rem] will-change-transform origin-(--bits-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 outline-none",
			className
		)}
		{...restProps}
	/>
</DropdownMenuPortal>
