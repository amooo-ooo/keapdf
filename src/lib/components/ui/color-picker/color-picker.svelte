<script lang="ts">
	import { Pipette, X } from "lucide-svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Popover from "$lib/components/ui/popover/index.js";
	import { cn } from "$lib/utils.js";
	import {
		normalizeToHex,
		hsvToRgb,
		rgbToHex,
		parseColorString,
		type ColorPresetItem,
	} from "./color-utils.js";

	interface EyeDropperInstance {
		open(): Promise<{ sRGBHex: string }>;
	}

	interface Props {
		value?: string;
		presets?: (ColorPresetItem | string)[];
		allowNone?: boolean;
		noneValue?: string;
		label?: string;
		disabled?: boolean;
		variant?: "default" | "circle" | "pill";
		class?: string;
		onValueChange?: (color: string) => void;
		onInteractingChange?: (isInteracting: boolean) => void;
	}

	let {
		value = $bindable("#000000"),
		presets = [],
		allowNone = false,
		noneValue = "transparent",
		label = "Color",
		disabled = false,
		variant = "default",
		class: className,
		onValueChange,
		onInteractingChange,
	}: Props = $props();

	let isOpen = $state(false);

	let currentH = $state(0);
	let currentS = $state(1);
	let currentV = $state(1);
	let currentA = $state(1);
	let isNone = $state(false);
	let hexInputText = $state("#000000");
	let opacityPercent = $state(100);

	$effect(() => {
		const parsed = parseColorString(value);
		isNone = parsed.isNone;
		if (!parsed.isNone) {
			currentH = parsed.h;
			currentS = parsed.s;
			currentV = parsed.v;
			currentA = parsed.a;
			const rgb = hsvToRgb(parsed.h, parsed.s, parsed.v);
			hexInputText = rgbToHex(rgb.r, rgb.g, rgb.b);
			opacityPercent = Math.round(parsed.a * 100);
		}
	});

	const currentRgb = $derived(hsvToRgb(currentH, currentS, currentV));
	const currentHex = $derived(rgbToHex(currentRgb.r, currentRgb.g, currentRgb.b));
	const displayColor = $derived(
		isNone ? "transparent" : `rgba(${currentRgb.r}, ${currentRgb.g}, ${currentRgb.b}, ${currentA})`
	);
	const hexDisplay = $derived(isNone ? "None" : currentHex);

	const normalizedPresets = $derived(
		presets.map((p) => {
			if (typeof p === "string") {
				return { label: p, color: p };
			}
			return p;
		})
	);

	function emitColorChange() {
		if (isNone) {
			value = noneValue;
			onValueChange?.(noneValue);
			return;
		}
		let out: string;
		if (currentA < 1) {
			out = `rgba(${currentRgb.r}, ${currentRgb.g}, ${currentRgb.b}, ${Number(currentA.toFixed(2))})`;
		} else {
			out = currentHex;
		}
		value = out;
		onValueChange?.(out);
	}

	function handle2DPointerDown(e: PointerEvent) {
		const target = e.currentTarget as HTMLElement;
		target.setPointerCapture(e.pointerId);
		onInteractingChange?.(true);

		function updateFromPoint(clientX: number, clientY: number) {
			const rect = target.getBoundingClientRect();
			const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
			const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
			currentS = x;
			currentV = 1 - y;
			isNone = false;
			hexInputText = currentHex;
			emitColorChange();
		}

		updateFromPoint(e.clientX, e.clientY);

		function onPointerMove(me: PointerEvent) {
			updateFromPoint(me.clientX, me.clientY);
		}

		function onPointerUp(ue: PointerEvent) {
			target.releasePointerCapture(ue.pointerId);
			target.removeEventListener("pointermove", onPointerMove);
			target.removeEventListener("pointerup", onPointerUp);
			target.removeEventListener("pointercancel", onPointerUp);
			onInteractingChange?.(false);
		}

		target.addEventListener("pointermove", onPointerMove);
		target.addEventListener("pointerup", onPointerUp);
		target.addEventListener("pointercancel", onPointerUp);
	}

	function handleHuePointerDown(e: PointerEvent) {
		const target = e.currentTarget as HTMLElement;
		target.setPointerCapture(e.pointerId);
		onInteractingChange?.(true);

		function updateHue(clientX: number) {
			const rect = target.getBoundingClientRect();
			const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
			currentH = Math.round(x * 360);
			isNone = false;
			hexInputText = currentHex;
			emitColorChange();
		}

		updateHue(e.clientX);

		function onPointerMove(me: PointerEvent) {
			updateHue(me.clientX);
		}

		function onPointerUp(ue: PointerEvent) {
			target.releasePointerCapture(ue.pointerId);
			target.removeEventListener("pointermove", onPointerMove);
			target.removeEventListener("pointerup", onPointerUp);
			target.removeEventListener("pointercancel", onPointerUp);
			onInteractingChange?.(false);
		}

		target.addEventListener("pointermove", onPointerMove);
		target.addEventListener("pointerup", onPointerUp);
		target.addEventListener("pointercancel", onPointerUp);
	}

	function handleAlphaPointerDown(e: PointerEvent) {
		const target = e.currentTarget as HTMLElement;
		target.setPointerCapture(e.pointerId);
		onInteractingChange?.(true);

		function updateAlpha(clientX: number) {
			const rect = target.getBoundingClientRect();
			const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
			currentA = Number(x.toFixed(2));
			opacityPercent = Math.round(currentA * 100);
			isNone = false;
			emitColorChange();
		}

		updateAlpha(e.clientX);

		function onPointerMove(me: PointerEvent) {
			updateAlpha(me.clientX);
		}

		function onPointerUp(ue: PointerEvent) {
			target.releasePointerCapture(ue.pointerId);
			target.removeEventListener("pointermove", onPointerMove);
			target.removeEventListener("pointerup", onPointerUp);
			target.removeEventListener("pointercancel", onPointerUp);
			onInteractingChange?.(false);
		}

		target.addEventListener("pointermove", onPointerMove);
		target.addEventListener("pointerup", onPointerUp);
		target.addEventListener("pointercancel", onPointerUp);
	}

	async function handleEyeDropper() {
		try {
			if ("EyeDropper" in window) {
				onInteractingChange?.(true);
				const EyeDropperClass = (
					window as unknown as { EyeDropper: new () => EyeDropperInstance }
				).EyeDropper;
				const eyeDropper = new EyeDropperClass();
				const result = await eyeDropper.open();
				if (result?.sRGBHex) {
					const parsed = parseColorString(result.sRGBHex);
					currentH = parsed.h;
					currentS = parsed.s;
					currentV = parsed.v;
					currentA = 1;
					isNone = false;
					hexInputText = result.sRGBHex.toUpperCase();
					opacityPercent = 100;
					emitColorChange();
				}
			}
		} catch {
			// User canceled or EyeDropper rejected
		} finally {
			onInteractingChange?.(false);
		}
	}

	function handleHexInput(e: Event) {
		const target = e.target as HTMLInputElement;
		const val = target.value.trim();
		if (/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(val)) {
			const formatted = val.startsWith("#") ? val : `#${val}`;
			const parsed = parseColorString(formatted);
			currentH = parsed.h;
			currentS = parsed.s;
			currentV = parsed.v;
			if (formatted.length === 9) {
				currentA = parsed.a;
				opacityPercent = Math.round(parsed.a * 100);
			}
			isNone = false;
			emitColorChange();
		}
	}

	function handleHexBlur() {
		hexInputText = currentHex;
	}

	function handleOpacityInput(e: Event) {
		const target = e.target as HTMLInputElement;
		let num = parseInt(target.value, 10);
		if (isNaN(num)) num = 100;
		num = Math.max(0, Math.min(100, num));
		opacityPercent = num;
		currentA = num / 100;
		isNone = false;
		emitColorChange();
	}

	function selectPreset(presetColor: string) {
		const parsed = parseColorString(presetColor);
		if (parsed.isNone) {
			selectNone();
			return;
		}
		currentH = parsed.h;
		currentS = parsed.s;
		currentV = parsed.v;
		currentA = parsed.a;
		isNone = false;
		hexInputText = currentHex;
		opacityPercent = Math.round(currentA * 100);
		emitColorChange();
	}

	function selectNone() {
		isNone = true;
		currentA = 0;
		opacityPercent = 0;
		emitColorChange();
	}
</script>

<Popover.Root
	bind:open={isOpen}
	onOpenChange={(open) => {
		onInteractingChange?.(open);
	}}
>
	{#if variant === "circle"}
		<Popover.Trigger
			{disabled}
			aria-label={label}
			title={label}
			class={cn(
				"size-7 rounded-full p-0.5 border border-border/80 shadow-2xs hover:scale-105 active:scale-95 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer overflow-hidden relative bg-card shrink-0",
				className
			)}
		>
			<div class="size-full rounded-full overflow-hidden relative border border-border/40">
				{#if isNone}
					<div class="size-full bg-transparency-grid relative">
						<div class="absolute inset-0 flex items-center justify-center">
							<div class="w-full h-[1.5px] bg-red-500/80 -rotate-45"></div>
						</div>
					</div>
				{:else}
					<div class="size-full bg-transparency-grid relative">
						<div class="size-full" style="background-color: {displayColor};"></div>
					</div>
				{/if}
			</div>
		</Popover.Trigger>
	{:else}
		<Popover.Trigger
			{disabled}
			aria-label={label}
			title={label}
			class={cn(
				variant === "pill"
					? "h-8 px-2.5 flex items-center justify-between gap-2 rounded-full border border-border bg-card shadow-xs transition-colors hover:bg-muted/40 hover:border-border/90 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-left cursor-pointer"
					: "h-8 px-2 flex items-center justify-between gap-2 rounded-xl border border-border bg-card shadow-xs transition-colors hover:bg-muted/40 hover:border-border/90 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-left cursor-pointer",
				className
			)}
		>
			<div class="flex items-center gap-2 min-w-0">
				<div
					class={cn(
						"size-4.5 border border-border/80 shadow-2xs relative shrink-0 overflow-hidden bg-card",
						variant === "pill" ? "rounded-full" : "rounded-md"
					)}
				>
					{#if isNone}
						<div class="size-full bg-transparency-grid relative">
							<div class="absolute inset-0 flex items-center justify-center">
								<div class="w-full h-[1.5px] bg-red-500/80 -rotate-45"></div>
							</div>
						</div>
					{:else}
						<div class="size-full bg-transparency-grid relative">
							<div class="size-full" style="background-color: {displayColor};"></div>
						</div>
					{/if}
				</div>
				<span class="text-xs font-sans font-medium text-foreground truncate uppercase">
					{isNone ? "None" : hexDisplay}
				</span>
			</div>
			{#if !isNone}
				<span class="text-[10px] text-muted-foreground font-sans shrink-0">
					{Math.round(currentA * 100)}%
				</span>
			{/if}
		</Popover.Trigger>
	{/if}

	<Popover.Content
		align="start"
		sideOffset={6}
		class="w-[250px] p-3 flex flex-col gap-3 rounded-2xl border border-border bg-card shadow-2xl z-50 select-none"
	>
		<!-- Header -->
		<div class="flex items-center justify-between pb-0.5">
			<span class="text-xs font-medium text-foreground">{label}</span>
			<Popover.Close
				class="rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
			>
				<X class="size-3.5" />
			</Popover.Close>
		</div>

		<!-- 2D Saturation / Value Canvas -->
		<div
			class="relative w-full h-[140px] rounded-xl overflow-hidden cursor-crosshair touch-none select-none border border-border/60"
			style="background-color: hsl({currentH}, 100%, 50%);"
			onpointerdown={handle2DPointerDown}
			role="presentation"
		>
			<div class="absolute inset-0 bg-gradient-to-r from-white to-transparent pointer-events-none"></div>
			<div class="absolute inset-0 bg-gradient-to-t from-black to-transparent pointer-events-none"></div>

			<!-- Reticle Crosshair Lines -->
			<div
				class="absolute top-0 bottom-0 w-[1px] bg-white/40 pointer-events-none -translate-x-1/2"
				style="left: {currentS * 100}%;"
			></div>
			<div
				class="absolute left-0 right-0 h-[1px] bg-white/40 pointer-events-none -translate-y-1/2"
				style="top: {(1 - currentV) * 100}%;"
			></div>

			<!-- Draggable Circular Thumb -->
			<div
				class="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md pointer-events-none"
				style="left: {currentS * 100}%; top: {(1 - currentV) * 100}%; background-color: {currentHex};"
			></div>
		</div>

		<!-- Sliders & Eyedropper -->
		<div class="flex items-center gap-2.5">
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="size-8 p-0 shrink-0 rounded-xl"
				onclick={handleEyeDropper}
				title="Pick color from screen"
			>
				<Pipette class="size-3.5" />
			</Button>

			<div class="flex-1 flex flex-col gap-2">
				<!-- Rainbow Hue Slider -->
				<div
					class="relative h-2.5 w-full rounded-full cursor-pointer touch-none select-none"
					style="background: linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%);"
					onpointerdown={handleHuePointerDown}
					role="presentation"
				>
					<div
						class="size-3.5 -translate-x-1/2 -translate-y-1/2 absolute top-1/2 rounded-full border-2 border-white shadow-md pointer-events-none"
						style="left: {(currentH / 360) * 100}%; background-color: hsl({currentH}, 100%, 50%);"
					></div>
				</div>

				<!-- Alpha Opacity Slider -->
				<div
					class="relative h-2.5 w-full rounded-full cursor-pointer touch-none select-none bg-transparency-grid overflow-hidden"
					onpointerdown={handleAlphaPointerDown}
					role="presentation"
				>
					<div
						class="absolute inset-0 rounded-full"
						style="background: linear-gradient(to right, transparent, {currentHex});"
					></div>
					<div
						class="size-3.5 -translate-x-1/2 -translate-y-1/2 absolute top-1/2 rounded-full border-2 border-white shadow-md pointer-events-none"
						style="left: {currentA * 100}%; background-color: {currentHex};"
					></div>
				</div>
			</div>
		</div>

		<!-- Numeric Value Inputs Row -->
		<div class="flex items-center gap-1.5">
			<span class="text-[10px] text-muted-foreground font-sans font-medium uppercase px-1.5 py-1 bg-muted/60 rounded-md shrink-0">
				HEX
			</span>
			<input
				type="text"
				bind:value={hexInputText}
				oninput={handleHexInput}
				onblur={handleHexBlur}
				class="h-7 px-2 text-xs font-sans uppercase flex-1 min-w-0 rounded-lg border border-border bg-input/40 outline-none focus:border-ring"
			/>
			<div class="flex items-center gap-0.5 bg-input/40 border border-border rounded-lg px-1.5 h-7 shrink-0 w-15">
				<input
					type="number"
					min="0"
					max="100"
					bind:value={opacityPercent}
					oninput={handleOpacityInput}
					class="w-full text-xs font-sans bg-transparent outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
				/>
				<span class="text-[10px] text-muted-foreground font-sans">%</span>
			</div>
		</div>

		<!-- Presets & None Toggle -->
		{#if normalizedPresets.length > 0 || allowNone}
			<div class="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/60">
				{#if allowNone}
					<button
						type="button"
						class={cn(
							"size-6 rounded-lg border border-border/80 cursor-pointer transition-transform hover:scale-105 relative overflow-hidden bg-card",
							isNone ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
						)}
						onclick={selectNone}
						title="None / Transparent"
					>
						<div class="size-full bg-transparency-grid relative">
							<div class="absolute inset-0 flex items-center justify-center">
								<div class="w-full h-[1.5px] bg-red-500/80 -rotate-45"></div>
							</div>
						</div>
					</button>
				{/if}
				{#each normalizedPresets as preset (preset.color)}
					{@const isSelected = !isNone && normalizeToHex(value) === normalizeToHex(preset.color)}
					<button
						type="button"
						class={cn(
							"size-6 rounded-lg border border-border/60 cursor-pointer transition-transform hover:scale-105 relative overflow-hidden",
							isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
						)}
						style="background-color: {preset.color};"
						onclick={() => selectPreset(preset.color)}
						title={preset.label}
					></button>
				{/each}
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>
