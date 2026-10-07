<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import {
		provideSubmenuController,
		useMenuLevelContext,
	} from "./dropdown-menu-sub-context.js";

	const uid = $props.id();

	let {
		open = $bindable(false),
		onOpenChange,
		...restProps
	}: DropdownMenuPrimitive.SubProps = $props();

	const parentLevel = useMenuLevelContext();
	const subController = provideSubmenuController({
		id: uid,
		isOpen: () => open,
		setOpen: (nextOpen: boolean) => {
			if (open !== nextOpen) {
				open = nextOpen;
				onOpenChange?.(nextOpen);
			}
		},
		parentLevel,
	});

	function handleOpenChange(nextOpen: boolean): void {
		subController.handleOpenChange(nextOpen);
		onOpenChange?.(nextOpen);
	}

	$effect(() => {
		subController.handleOpenChange(open);
	});

	$effect(() => {
		return () => {
			subController.dispose();
		};
	});
</script>

<DropdownMenuPrimitive.Sub bind:open onOpenChange={handleOpenChange} {...restProps} />
