<script lang="ts">
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { ChevronUp, ChevronDown } from "lucide-svelte";

	type InputType = Exclude<HTMLInputTypeAttribute, "file">;

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, "type" | "size"> &
			({ type: "file"; files?: FileList } | { type?: InputType; files?: undefined })
	> & {
		size?: "default" | "compact";
		prefix?: string;
	};

	let {
		ref = $bindable(null),
		value = $bindable(),
		type,
		size = "default",
		prefix,
		files = $bindable(),
		class: className,
		"data-slot": dataSlot = "input",
		...restProps
	}: Props = $props();

	function handleStepUp(e: MouseEvent) {
		e.preventDefault();
		if (!(ref instanceof HTMLInputElement)) return;
		try {
			ref.stepUp();
		} catch {
			const step = parseFloat(ref.step) || 1;
			const currentVal = parseFloat(ref.value) || 0;
			ref.value = String(currentVal + step);
		}
		value = ref.value;
		ref.dispatchEvent(new Event("input", { bubbles: true }));
		ref.dispatchEvent(new Event("change", { bubbles: true }));
	}

	function handleStepDown(e: MouseEvent) {
		e.preventDefault();
		if (!(ref instanceof HTMLInputElement)) return;
		try {
			ref.stepDown();
		} catch {
			const step = parseFloat(ref.step) || 1;
			const currentVal = parseFloat(ref.value) || 0;
			ref.value = String(currentVal - step);
		}
		value = ref.value;
		ref.dispatchEvent(new Event("input", { bubbles: true }));
		ref.dispatchEvent(new Event("change", { bubbles: true }));
	}
</script>

{#if type === "file"}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		data-size={size}
		class={cn(
			"bg-input/50 focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-8 rounded-2xl border border-border/80 dark:border-transparent py-1 transition-[color,box-shadow] duration-200 file:h-6 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
			size === "compact" ? "px-2 text-xs" : "px-2.5 text-sm",
			className
		)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else if type === "number"}
	<div class="relative flex items-center w-full group/number-input">
		{#if prefix}
			<span class="absolute left-2.5 z-10 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none pointer-events-none flex items-center gap-1.5">
				<span>{prefix}</span>
				<span class="h-3 w-px bg-border/80 select-none" aria-hidden="true"></span>
			</span>
		{/if}
		<input
			bind:this={ref}
			data-slot={dataSlot}
			data-size={size}
			class={cn(
				"bg-input/50 focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-8 rounded-2xl border border-border/80 dark:border-transparent py-1 transition-[color,box-shadow] duration-200 file:h-6 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 pr-6 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
				size === "compact" ? "px-2 text-xs" : "px-2.5 text-sm",
				prefix ? (prefix.length > 2 ? "pl-11" : "pl-8") : "",
				className
			)}
			type="number"
			bind:value
			{...restProps}
		/>
		<div
			class="absolute right-1 top-1 bottom-1 flex flex-col justify-center w-3.5 pointer-events-auto opacity-50 group-hover/number-input:opacity-100 group-focus-within/number-input:opacity-100 transition-opacity select-none"
		>
			<button
				type="button"
				tabindex="-1"
				aria-label="Increment"
				class="h-1/2 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-xs transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-40"
				disabled={Boolean(restProps.disabled)}
				onmousedown={handleStepUp}
			>
				<ChevronUp class="size-2.5 stroke-[2.5]" />
			</button>
			<button
				type="button"
				tabindex="-1"
				aria-label="Decrement"
				class="h-1/2 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-xs transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-40"
				disabled={Boolean(restProps.disabled)}
				onmousedown={handleStepDown}
			>
				<ChevronDown class="size-2.5 stroke-[2.5]" />
			</button>
		</div>
	</div>
{:else}
	{#if prefix}
		<div class="relative flex items-center w-full">
			<span class="absolute left-2.5 z-10 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none pointer-events-none flex items-center gap-1.5">
				<span>{prefix}</span>
				<span class="h-3 w-px bg-border/80 select-none" aria-hidden="true"></span>
			</span>
			<input
				bind:this={ref}
				data-slot={dataSlot}
				data-size={size}
				class={cn(
					"bg-input/50 focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-8 rounded-2xl border border-border/80 dark:border-transparent py-1 transition-[color,box-shadow] duration-200 file:h-6 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
					size === "compact" ? "px-2 text-xs" : "px-2.5 text-sm",
					prefix.length > 2 ? "pl-11" : "pl-8",
					className
				)}
				{type}
				bind:value
				{...restProps}
			/>
		</div>
	{:else}
		<input
			bind:this={ref}
			data-slot={dataSlot}
			data-size={size}
			class={cn(
				"bg-input/50 focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-8 rounded-2xl border border-border/80 dark:border-transparent py-1 transition-[color,box-shadow] duration-200 file:h-6 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
				size === "compact" ? "px-2 text-xs" : "px-2.5 text-sm",
				className
			)}
			{type}
			bind:value
			{...restProps}
		/>
	{/if}
{/if}
