<script lang="ts" module>
  import type { Component, ComponentType, Snippet } from 'svelte';
  import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
  import { cn, type WithoutChild } from '$lib/utils.js';
  import {
    dropdownButtonVariants,
    dropdownSplitRootVariants,
    dropdownSplitActionVariants,
    dropdownSplitTriggerVariants,
    DROPDOWN_BUTTON_FILL_CLASSES,
    DROPDOWN_BUTTON_DIVIDER_CLASSES,
    type DropdownButtonVariant,
    type DropdownButtonSize,
    type DropdownButtonFillColor,
  } from './dropdown-button-variants.js';

  export {
    dropdownButtonVariants,
    dropdownSplitRootVariants,
    dropdownSplitActionVariants,
    dropdownSplitTriggerVariants,
    DROPDOWN_BUTTON_FILL_CLASSES,
    DROPDOWN_BUTTON_DIVIDER_CLASSES,
    type DropdownButtonVariant,
    type DropdownButtonSize,
    type DropdownButtonFillColor,
  };

  export type DropdownButtonIcon =
    | Component<{ class?: string }>
    | ComponentType;

  export type DropdownButtonProps = WithoutChild<DropdownMenuPrimitive.TriggerProps> & {
    variant?: DropdownButtonVariant;
    size?: DropdownButtonSize;
    fillColor?: DropdownButtonFillColor;
    icon?: DropdownButtonIcon;
    iconClass?: string;
    iconSnippet?: Snippet;
    text?: string;
    label?: string;
    textSnippet?: Snippet;
    chevron?: boolean;
    chevronClass?: string;
    chevronSnippet?: Snippet;
    hasDivider?: boolean;
    asButton?: boolean;
    children?: Snippet;

    // Separated split variant properties
    split?: boolean;
    active?: boolean;
    onaction?: (e: MouseEvent) => void;
    actionClass?: string;
    actionAriaLabel?: string;
    chevronAriaLabel?: string;
    actionRef?: HTMLButtonElement | null;
    onChevronClick?: (e: MouseEvent) => void;
  };
</script>

<script lang="ts">
  import { ChevronDown } from 'lucide-svelte';
  import { tryUseFeatureFlagStore } from '../../../../core/feature-flags.js';

  let {
    ref = $bindable(null),
    class: className,
    variant = 'default',
    size = 'default',
    fillColor = 'secondary',
    icon,
    iconClass,
    iconSnippet,
    text,
    label,
    textSnippet,
    chevron = true,
    chevronClass,
    chevronSnippet,
    hasDivider,
    asButton = false,
    disabled = false,
    split = false,
    active = false,
    onaction,
    actionClass,
    actionAriaLabel,
    chevronAriaLabel,
    actionRef = $bindable(null),
    onChevronClick,
    children,
    ...restProps
  }: DropdownButtonProps = $props();

  const featureFlags = tryUseFeatureFlagStore();
  const isVariantsEnabled = $derived(
    featureFlags ? featureFlags.isEnabled('components.dropdown-button.variants') : true
  );
  const isSplitEnabled = $derived(
    featureFlags ? featureFlags.isEnabled('components.dropdown-button.split') : true
  );

  // note: resolve effective variant falling back to default when variants flag is disabled
  const effectiveVariant = $derived<DropdownButtonVariant>(
    isVariantsEnabled ? variant : 'default'
  );

  // note: detect whether separated split mode is active
  const isSplitMode = $derived<boolean>(
    isSplitEnabled && (effectiveVariant === 'split' || effectiveVariant === 'separated' || split === true)
  );

  // note: resolve divider presentation between button content and trailing chevron
  const effectiveHasDivider = $derived<boolean>(
    typeof hasDivider === 'boolean'
      ? hasDivider && isSplitEnabled
      : isSplitEnabled && (effectiveVariant === 'bordered' || effectiveVariant === 'filled-bordered')
  );

  const displayText = $derived(text ?? label);
  const IconComponent = $derived(icon);
  const isIconOnly = $derived(!displayText && !textSnippet && (Boolean(IconComponent) || Boolean(iconSnippet)));

  // note: resolve fill colour surface classes for filled variants
  const fillSurfaceClasses = $derived(
    effectiveVariant === 'filled' || effectiveVariant === 'filled-bordered'
      ? DROPDOWN_BUTTON_FILL_CLASSES[fillColor] ?? DROPDOWN_BUTTON_FILL_CLASSES.secondary
      : undefined
  );

  const dividerClass = $derived(
    effectiveVariant === 'filled' && fillColor === 'primary'
      ? 'bg-primary-foreground/25'
      : DROPDOWN_BUTTON_DIVIDER_CLASSES[effectiveVariant ?? 'default'] || 'bg-border'
  );

  // note: symmetric right padding on text content before vertical divider to match left padding
  const contentDividerPaddingClass = $derived(
    effectiveHasDivider && chevron
      ? size === 'lg'
        ? 'pr-2.5'
        : size === 'default'
          ? 'pr-2.5'
          : size === 'sm'
            ? 'pr-2'
            : 'pr-1.5'
      : undefined
  );

  const mergedClasses = $derived(
    cn(
      dropdownButtonVariants({ variant: effectiveVariant, size }),
      fillSurfaceClasses,
      className
    )
  );

  const splitRootClasses = $derived(
    cn(
      dropdownSplitRootVariants({ variant: effectiveVariant, size }),
      fillSurfaceClasses,
      className
    )
  );

  const splitActionClasses = $derived(
    cn(
      dropdownSplitActionVariants({ variant: effectiveVariant, size }),
      isIconOnly && (
        size === 'compact' ? 'w-7 px-0 justify-center' :
        size === 'sm' ? 'w-7 px-0 justify-center' :
        size === 'xs' ? 'w-6 px-0 justify-center' :
        size === 'lg' ? 'w-9 px-0 justify-center' :
        'w-8 px-0 justify-center'
      ),
      active && 'bg-secondary text-secondary-foreground font-semibold hover:bg-secondary/90 hover:text-secondary-foreground',
      actionClass
    )
  );

  const splitTriggerClasses = $derived(
    cn(
      dropdownSplitTriggerVariants({ variant: effectiveVariant, size }),
      chevronClass
    )
  );

  // note: separate click handler for primary action button in split mode
  function handleActionClick(e: MouseEvent): void {
    if (disabled) return;
    if (onaction) {
      onaction(e);
    } else if (typeof restProps.onclick === 'function') {
      (restProps.onclick as (e: MouseEvent) => void)(e);
    }
  }

  // note: isolate primary action click from trigger props in split mode
  const triggerRestProps = $derived.by(() => {
    if (!isSplitMode) return restProps;
    const { onclick: _actionClick, ...filtered } = restProps;
    return filtered;
  });
</script>

{#if isSplitMode}
  <div
    role="group"
    data-slot="dropdown-split-button"
    data-variant={effectiveVariant}
    data-size={size}
    data-fill-color={effectiveVariant === 'filled' || effectiveVariant === 'filled-bordered' ? fillColor : undefined}
    data-active={active ? 'true' : undefined}
    class={splitRootClasses}
  >
    <button
      bind:this={actionRef}
      type="button"
      data-slot="dropdown-button-action"
      data-active={active ? 'true' : undefined}
      aria-pressed={active}
      aria-label={actionAriaLabel ?? (typeof restProps['aria-label'] === 'string' ? restProps['aria-label'] : displayText)}
      title={displayText}
      class={splitActionClasses}
      {disabled}
      onclick={handleActionClick}
    >
      {#if iconSnippet}
        {@render iconSnippet()}
      {:else if IconComponent}
        <IconComponent class={cn('size-4 w-4 h-4 shrink-0', iconClass)} />
      {/if}
      {#if textSnippet}
        {@render textSnippet()}
      {:else if displayText !== undefined}
        <span class="truncate">{displayText}</span>
      {/if}
      {@render children?.()}
    </button>

    {#if effectiveHasDivider && chevron}
      <span
        data-slot="dropdown-button-divider"
        class={cn(
          'w-px shrink-0 pointer-events-none',
          effectiveVariant === 'filled-bordered' ? 'h-[calc(100%+2px)] -my-px' : 'self-stretch my-1',
          dividerClass || 'bg-border'
        )}
        aria-hidden="true"
      ></span>
    {/if}

    {#if chevron}
      {#if asButton}
        <button
          bind:this={ref}
          type="button"
          data-slot="dropdown-button-trigger"
          aria-label={chevronAriaLabel ?? (displayText ? `${displayText} options` : 'More options')}
          class={splitTriggerClasses}
          {disabled}
          onclick={onChevronClick}
        >
          {#if chevronSnippet}
            {@render chevronSnippet()}
          {:else}
            <ChevronDown
              class="size-3 w-3 h-3 shrink-0 opacity-70 group-hover/dropdown-split:opacity-100 transition-opacity duration-150 ease-out pointer-events-none"
              aria-hidden="true"
            />
          {/if}
        </button>
      {:else}
        <DropdownMenuPrimitive.Trigger
          bind:ref
          data-slot="dropdown-button-trigger"
          aria-label={chevronAriaLabel ?? (displayText ? `${displayText} options` : 'More options')}
          class={splitTriggerClasses}
          {disabled}
          onclick={onChevronClick}
          {...triggerRestProps}
        >
          {#if chevronSnippet}
            {@render chevronSnippet()}
          {:else}
            <ChevronDown
              class="size-3 w-3 h-3 shrink-0 opacity-70 group-hover/dropdown-split:opacity-100 transition-opacity duration-150 ease-out pointer-events-none"
              aria-hidden="true"
            />
          {/if}
        </DropdownMenuPrimitive.Trigger>
      {/if}
    {/if}
  </div>
{:else if asButton}
  <button
    bind:this={ref}
    type="button"
    data-slot="dropdown-button"
    data-variant={effectiveVariant}
    data-size={size}
    data-fill-color={effectiveVariant === 'filled' || effectiveVariant === 'filled-bordered' ? fillColor : undefined}
    data-has-divider={effectiveHasDivider ? 'true' : undefined}
    title={displayText}
    class={mergedClasses}
    {disabled}
    {...restProps}
  >
    <span class={cn('flex items-center min-w-0 gap-1.5', contentDividerPaddingClass)}>
      {#if iconSnippet}
        {@render iconSnippet()}
      {:else if IconComponent}
        <IconComponent class={cn('size-3.5 w-3.5 h-3.5 shrink-0', iconClass)} />
      {/if}
      {#if textSnippet}
        {@render textSnippet()}
      {:else if displayText !== undefined}
        <span class="truncate">{displayText}</span>
      {/if}
      {@render children?.()}
    </span>

    {#if effectiveHasDivider && chevron}
      <span
        data-slot="dropdown-button-divider"
        class={cn(
          'w-px shrink-0 pointer-events-none',
          effectiveVariant === 'filled-bordered' ? 'h-[calc(100%+2px)] -my-px' : 'self-stretch my-1',
          dividerClass
        )}
        aria-hidden="true"
      ></span>
    {/if}

    {#if chevron}
      {#if chevronSnippet}
        {@render chevronSnippet()}
      {:else}
        <ChevronDown
          class={cn(
            'size-3 w-3 h-3 shrink-0 opacity-70 group-hover/dropdown-button:opacity-100 transition-opacity duration-150 ease-out pointer-events-none',
            effectiveHasDivider && 'ml-0.5',
            chevronClass
          )}
          aria-hidden="true"
        />
      {/if}
    {/if}
  </button>
{:else}
  <DropdownMenuPrimitive.Trigger
    bind:ref
    data-slot="dropdown-button"
    data-variant={effectiveVariant}
    data-size={size}
    data-fill-color={effectiveVariant === 'filled' || effectiveVariant === 'filled-bordered' ? fillColor : undefined}
    data-has-divider={effectiveHasDivider ? 'true' : undefined}
    title={displayText}
    class={mergedClasses}
    {disabled}
    {...restProps}
  >
    <span class={cn('flex items-center min-w-0 gap-1.5', contentDividerPaddingClass)}>
      {#if iconSnippet}
        {@render iconSnippet()}
      {:else if IconComponent}
        <IconComponent class={cn('size-3.5 w-3.5 h-3.5 shrink-0', iconClass)} />
      {/if}
      {#if textSnippet}
        {@render textSnippet()}
      {:else if displayText !== undefined}
        <span class="truncate">{displayText}</span>
      {/if}
      {@render children?.()}
    </span>

    {#if effectiveHasDivider && chevron}
      <span
        data-slot="dropdown-button-divider"
        class={cn(
          'w-px shrink-0 pointer-events-none',
          effectiveVariant === 'filled-bordered' ? 'h-[calc(100%+2px)] -my-px' : 'self-stretch my-1',
          dividerClass
        )}
        aria-hidden="true"
      ></span>
    {/if}

    {#if chevron}
      {#if chevronSnippet}
        {@render chevronSnippet()}
      {:else}
        <ChevronDown
          class={cn(
            'size-3 w-3 h-3 shrink-0 opacity-70 group-hover/dropdown-button:opacity-100 transition-opacity duration-150 ease-out pointer-events-none',
            effectiveHasDivider && 'ml-0.5',
            chevronClass
          )}
          aria-hidden="true"
        />
      {/if}
    {/if}
  </DropdownMenuPrimitive.Trigger>
{/if}
