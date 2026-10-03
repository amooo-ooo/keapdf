<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button, buttonVariants, type ButtonVariant, type ButtonSize } from '$lib/components/ui/button/index.js';
  import { Badge, badgeVariants, type BadgeVariant } from '$lib/components/ui/badge/index.js';
  import { ControlRow, controlRowVariants, type ControlRowVariant, type ControlRowSize } from '$lib/components/ui/control-row/index.js';
  import { Toggle, toggleVariants, type ToggleVariant, type ToggleSize } from '$lib/components/ui/toggle/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { COMPONENT_VARIANTS_MANIFEST, type ComponentVariantEntry } from '$lib/components/ui/variants-manifest.js';
  import {
    Palette,
    Copy,
    Check,
    Search,
    Sparkles,
    Sliders,
    Layers,
    Code2,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const featureFlags = useFeatureFlagStore();

  let selectedComponent = $state<string>('Button');
  let searchQuery = $state<string>('');
  let copiedSnippet = $state<boolean>(false);
  let copiedClasses = $state<boolean>(false);

  // Knobs for interactive testing
  let knobLabel = $state<string>('Sample Label');
  let knobButtonVariant = $state<ButtonVariant>('default');
  let knobButtonSize = $state<ButtonSize>('default');
  let knobBadgeVariant = $state<BadgeVariant>('default');
  let knobControlRowVariant = $state<ControlRowVariant>('default');
  let knobControlRowSize = $state<ControlRowSize>('default');
  let knobToggleVariant = $state<ToggleVariant>('default');
  let knobToggleSize = $state<ToggleSize>('default');
  let knobInputSize = $state<'default' | 'compact'>('default');
  let knobInputPrefix = $state<string>('X');
  let knobColorPickerVariant = $state<'default' | 'circle' | 'pill'>('default');
  let knobDisabled = $state<boolean>(false);
  let knobActive = $state<boolean>(false);
  let knobWithIcon = $state<boolean>(true);

  const filteredManifest = $derived(
    COMPONENT_VARIANTS_MANIFEST.filter((entry) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        entry.componentName.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.variants.some((v) => v.toLowerCase().includes(q))
      );
    })
  );

  const activeEntry = $derived<ComponentVariantEntry | undefined>(
    COMPONENT_VARIANTS_MANIFEST.find((e) => e.componentName === selectedComponent)
  );

  function handleOpenChange(open: boolean): void {
    if (!open) {
      store.closeComponentGalleryDialog();
    }
  }

  function copyToClipboard(text: string, isSnippet: boolean): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        if (isSnippet) {
          copiedSnippet = true;
          setTimeout(() => { copiedSnippet = false; }, 1800);
        } else {
          copiedClasses = true;
          setTimeout(() => { copiedClasses = false; }, 1800);
        }
      }).catch(() => {
        // Fallback or ignore
      });
    }
  }

  const generatedSnippet = $derived.by(() => {
    switch (selectedComponent) {
      case 'Button':
        return `<Button variant="${knobButtonVariant}" size="${knobButtonSize}"${knobDisabled ? ' disabled' : ''}${knobActive ? ' active' : ''}>${knobLabel}</Button>`;
      case 'Badge':
        return `<Badge variant="${knobBadgeVariant}">${knobLabel}</Badge>`;
      case 'ControlRow':
        return `<ControlRow label="${knobLabel}" variant="${knobControlRowVariant}" size="${knobControlRowSize}" />`;
      case 'Toggle':
        return `<Toggle variant="${knobToggleVariant}" size="${knobToggleSize}"${knobDisabled ? ' disabled' : ''}>${knobLabel}</Toggle>`;
      case 'Input':
        return `<Input size="${knobInputSize}" prefix="${knobInputPrefix}" placeholder="${knobLabel}" />`;
      case 'Label':
        return `<Label size="${knobInputSize}">${knobLabel}</Label>`;
      case 'ColorPicker':
        return `<ColorPicker variant="${knobColorPickerVariant}" value="#0D99FF" />`;
      default:
        return `<${selectedComponent} />`;
    }
  });

  const generatedClassNames = $derived.by(() => {
    switch (selectedComponent) {
      case 'Button':
        return buttonVariants({ variant: knobButtonVariant, size: knobButtonSize });
      case 'Badge':
        return badgeVariants({ variant: knobBadgeVariant });
      case 'ControlRow':
        return controlRowVariants({ variant: knobControlRowVariant, size: knobControlRowSize });
      case 'Toggle':
        return toggleVariants({ variant: knobToggleVariant, size: knobToggleSize });
      default:
        return 'Standard utility styling';
    }
  });
</script>

{#if featureFlags.isEnabled('components.gallery')}
<Dialog.Root open={store.showComponentGalleryDialog} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[900px] max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden bg-background">
    <!-- Header -->
    <Dialog.Header class="p-4 pb-3 border-b bg-card">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2.5">
          <div class="p-2 rounded-xl bg-primary/10 text-primary">
            <Palette class="h-4 w-4" />
          </div>
          <div>
            <Dialog.Title class="text-sm font-semibold flex items-center gap-2">
              UI Component Variant Gallery
              <Badge variant="outline" class="text-[10px] h-4 py-0 font-normal">
                Live Inspector
              </Badge>
            </Dialog.Title>
            <Dialog.Description class="text-xs text-muted-foreground">
              Inspect primitive styling variants, sizes, and DOM attributes for backend theme editing.
            </Dialog.Description>
          </div>
        </div>

        <!-- Quick filter input -->
        <div class="w-48 relative">
          <Search class="h-3.5 w-3.5 absolute left-2.5 top-2 text-muted-foreground pointer-events-none" />
          <Input
            size="compact"
            class="pl-8 pr-2 text-xs"
            placeholder="Search variants..."
            bind:value={searchQuery}
          />
        </div>
      </div>
    </Dialog.Header>

    <!-- Main Body Container -->
    <div class="flex-1 overflow-hidden flex min-h-[460px]">
      <!-- Left sidebar: Component selection list -->
      <div class="w-52 border-r bg-muted/20 flex flex-col p-2 gap-1 overflow-y-auto shrink-0 select-none">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1">
          Components ({filteredManifest.length})
        </span>
        {#each filteredManifest as entry (entry.componentName)}
          <button
            type="button"
            class="w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {selectedComponent === entry.componentName ? 'bg-primary text-primary-foreground font-semibold shadow-xs' : 'text-foreground/80 hover:bg-muted hover:text-foreground'}"
            onclick={() => { selectedComponent = entry.componentName; }}
          >
            <span class="truncate">{entry.componentName}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded-md tabular-nums {selectedComponent === entry.componentName ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted-foreground/15 text-muted-foreground'}">
              {entry.variants.length}
            </span>
          </button>
        {/each}
      </div>

      <!-- Right main area: Matrix & Interactive Playground -->
      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-5 text-xs">
        {#if activeEntry}
          <!-- Component Overview Banner -->
          <div class="rounded-xl border bg-card p-3 flex flex-col gap-1.5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-sm text-foreground">{activeEntry.componentName}</span>
                <Badge variant="secondary" class="text-[10px] h-4">
                  slot: {activeEntry.slotName}
                </Badge>
                {#if activeEntry.recipeName}
                  <Badge variant="outline" class="text-[10px] h-4">
                    {activeEntry.recipeName}
                  </Badge>
                {/if}
              </div>
              <span class="text-[11px] text-muted-foreground">
                {activeEntry.variants.length} variant{activeEntry.variants.length === 1 ? '' : 's'}
                {#if activeEntry.sizes}
                  {', '}{activeEntry.sizes.length} size{activeEntry.sizes.length === 1 ? '' : 's'}
                {/if}
              </span>
            </div>
            <p class="text-xs text-muted-foreground leading-relaxed">
              {activeEntry.description}
            </p>
          </div>

          <!-- Section A: Matrix of All Variants -->
          <div class="flex flex-col gap-2.5">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-foreground text-xs flex items-center gap-1.5">
                <Layers class="h-3.5 w-3.5 text-primary" />
                Variant Matrix Showcase
              </span>
              <span class="text-[11px] text-muted-foreground">
                All variants rendered with default settings
              </span>
            </div>

            {#if selectedComponent === 'Button'}
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {#each activeEntry.variants as variantOption}
                  <div class="p-2.5 rounded-xl border bg-muted/15 flex flex-col gap-2">
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="font-medium text-foreground">{variantOption}</span>
                      <span class="text-[10px] text-muted-foreground">data-variant="{variantOption}"</span>
                    </div>
                    <div class="flex items-center gap-2 min-h-8">
                      <Button variant={variantOption as ButtonVariant} size="sm">
                        {#if knobWithIcon}
                          <Sparkles class="h-3.5 w-3.5" />
                        {/if}
                        {variantOption}
                      </Button>
                      <Button variant={variantOption as ButtonVariant} size="sm" disabled>
                        Disabled
                      </Button>
                    </div>
                  </div>
                {/each}
              </div>

              <!-- Button Sizes Matrix -->
              <div class="mt-2 flex flex-col gap-2">
                <span class="font-medium text-foreground text-xs">Button Sizes Hierarchy</span>
                <div class="p-3 rounded-xl border bg-muted/15 flex flex-wrap items-center gap-2">
                  {#each activeEntry.sizes || [] as sizeOption}
                    <Button variant="outline" size={sizeOption as ButtonSize}>
                      {#if sizeOption.startsWith('icon')}
                        <Sparkles class="h-3.5 w-3.5" />
                      {:else}
                        size: {sizeOption}
                      {/if}
                    </Button>
                  {/each}
                </div>
              </div>

            {:else if selectedComponent === 'Badge'}
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {#each activeEntry.variants as variantOption}
                  <div class="p-2.5 rounded-xl border bg-muted/15 flex flex-col gap-1.5">
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="font-medium text-foreground">{variantOption}</span>
                      <span class="text-[10px] text-muted-foreground">data-variant="{variantOption}"</span>
                    </div>
                    <div class="pt-0.5">
                      <Badge variant={variantOption as BadgeVariant}>
                        {variantOption}
                      </Badge>
                    </div>
                  </div>
                {/each}
              </div>

            {:else if selectedComponent === 'ControlRow'}
              <div class="flex flex-col gap-2">
                {#each activeEntry.variants as variantOption}
                  <div class="p-2 rounded-xl border bg-muted/15 flex flex-col gap-1.5">
                    <span class="text-[10px] text-muted-foreground">variant: "{variantOption}"</span>
                    <ControlRow
                      label="Control Row Setting"
                      description="Demonstrates {variantOption} styling variant with interactive switch"
                      variant={variantOption as ControlRowVariant}
                    >
                      {#snippet children()}
                        <Badge variant="outline" class="text-[10px]">Action</Badge>
                      {/snippet}
                    </ControlRow>
                  </div>
                {/each}
              </div>

            {:else if selectedComponent === 'Toggle'}
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {#each activeEntry.variants as variantOption}
                  <div class="p-2.5 rounded-xl border bg-muted/15 flex flex-col gap-2">
                    <span class="font-medium text-foreground">variant: "{variantOption}"</span>
                    <div class="flex items-center gap-2">
                      <Toggle variant={variantOption as ToggleVariant} size="sm">
                        Unpressed
                      </Toggle>
                      <Toggle variant={variantOption as ToggleVariant} size="sm" pressed={true}>
                        Pressed
                      </Toggle>
                    </div>
                  </div>
                {/each}
              </div>

            {:else if selectedComponent === 'ColorPicker'}
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {#each activeEntry.variants as variantOption}
                  <div class="p-2.5 rounded-xl border bg-muted/15 flex flex-col gap-2">
                    <span class="font-medium text-foreground">variant: "{variantOption}"</span>
                    <div class="pt-1">
                      <ColorPicker
                        variant={variantOption as 'default' | 'circle' | 'pill'}
                        value="#0D99FF"
                      />
                    </div>
                  </div>
                {/each}
              </div>

            {:else if selectedComponent === 'Input'}
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div class="p-2.5 rounded-xl border bg-muted/15 flex flex-col gap-2">
                  <span class="font-medium text-foreground">size: "default"</span>
                  <Input placeholder="Standard size field..." />
                  <Input prefix="X" placeholder="With coordinate badge..." />
                </div>
                <div class="p-2.5 rounded-xl border bg-muted/15 flex flex-col gap-2">
                  <span class="font-medium text-foreground">size: "compact"</span>
                  <Input size="compact" placeholder="Compact size field..." />
                  <Input size="compact" prefix="W" placeholder="With width badge..." />
                </div>
              </div>

            {:else}
              <div class="p-3 rounded-xl border bg-muted/20 text-muted-foreground text-center">
                Preview matrix for {selectedComponent}
              </div>
            {/if}
          </div>

          <!-- Section B: Interactive Playground / Knobs -->
          <div class="rounded-xl border bg-card p-4 flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-foreground text-xs flex items-center gap-1.5">
                <Sliders class="h-3.5 w-3.5 text-primary" />
                Interactive Knobs & Playground
              </span>
              <span class="text-[11px] text-muted-foreground">
                Tweak props to inspect generated classes and DOM output
              </span>
            </div>

            <!-- Knobs Toolbar -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              <div class="flex flex-col gap-1">
                <Label size="compact">Label Text</Label>
                <Input size="compact" bind:value={knobLabel} />
              </div>

              {#if selectedComponent === 'Button'}
                <div class="flex flex-col gap-1">
                  <Label size="compact">Variant</Label>
                  <select
                    class="h-7 text-xs rounded-xl border bg-input/50 px-2 outline-none"
                    bind:value={knobButtonVariant}
                  >
                    {#each activeEntry.variants as v}
                      <option value={v}>{v}</option>
                    {/each}
                  </select>
                </div>
                <div class="flex flex-col gap-1">
                  <Label size="compact">Size</Label>
                  <select
                    class="h-7 text-xs rounded-xl border bg-input/50 px-2 outline-none"
                    bind:value={knobButtonSize}
                  >
                    {#each activeEntry.sizes || [] as s}
                      <option value={s}>{s}</option>
                    {/each}
                  </select>
                </div>
              {/if}

              {#if selectedComponent === 'Badge'}
                <div class="flex flex-col gap-1">
                  <Label size="compact">Variant</Label>
                  <select
                    class="h-7 text-xs rounded-xl border bg-input/50 px-2 outline-none"
                    bind:value={knobBadgeVariant}
                  >
                    {#each activeEntry.variants as v}
                      <option value={v}>{v}</option>
                    {/each}
                  </select>
                </div>
              {/if}

              {#if selectedComponent === 'ControlRow'}
                <div class="flex flex-col gap-1">
                  <Label size="compact">Variant</Label>
                  <select
                    class="h-7 text-xs rounded-xl border bg-input/50 px-2 outline-none"
                    bind:value={knobControlRowVariant}
                  >
                    {#each activeEntry.variants as v}
                      <option value={v}>{v}</option>
                    {/each}
                  </select>
                </div>
                <div class="flex flex-col gap-1">
                  <Label size="compact">Size</Label>
                  <select
                    class="h-7 text-xs rounded-xl border bg-input/50 px-2 outline-none"
                    bind:value={knobControlRowSize}
                  >
                    {#each activeEntry.sizes || [] as s}
                      <option value={s}>{s}</option>
                    {/each}
                  </select>
                </div>
              {/if}

              <!-- States Toggles -->
              <div class="flex items-center gap-3 self-end pb-1">
                <label class="flex items-center gap-1.5 cursor-pointer text-xs">
                  <Checkbox bind:checked={knobDisabled} />
                  <span>Disabled</span>
                </label>
                {#if selectedComponent === 'Button'}
                  <label class="flex items-center gap-1.5 cursor-pointer text-xs">
                    <Checkbox bind:checked={knobActive} />
                    <span>Active</span>
                  </label>
                {/if}
              </div>
            </div>

            <!-- Live Playground Render View -->
            <div class="p-4 rounded-xl border border-dashed bg-muted/30 flex items-center justify-center min-h-[70px]">
              {#if selectedComponent === 'Button'}
                <Button
                  variant={knobButtonVariant}
                  size={knobButtonSize}
                  disabled={knobDisabled}
                  active={knobActive}
                >
                  {#if knobWithIcon}
                    <Sparkles class="h-3.5 w-3.5" />
                  {/if}
                  {knobLabel}
                </Button>
              {:else if selectedComponent === 'Badge'}
                <Badge variant={knobBadgeVariant}>
                  {knobLabel}
                </Badge>
              {:else if selectedComponent === 'ControlRow'}
                <div class="w-full max-w-md">
                  <ControlRow
                    label={knobLabel}
                    description="Interactive control row preview"
                    variant={knobControlRowVariant}
                    size={knobControlRowSize}
                  />
                </div>
              {:else if selectedComponent === 'Toggle'}
                <Toggle
                  variant={knobToggleVariant}
                  size={knobToggleSize}
                  disabled={knobDisabled}
                >
                  {knobLabel}
                </Toggle>
              {:else if selectedComponent === 'Input'}
                <div class="w-full max-w-sm">
                  <Input
                    size={knobInputSize}
                    prefix={knobInputPrefix}
                    placeholder={knobLabel}
                    disabled={knobDisabled}
                  />
                </div>
              {:else if selectedComponent === 'ColorPicker'}
                <div class="w-full max-w-xs">
                  <ColorPicker
                    variant={knobColorPickerVariant}
                    value="#0D99FF"
                    disabled={knobDisabled}
                  />
                </div>
              {/if}
            </div>

            <!-- DOM Inspector & Snippet Exporter -->
            <div class="flex flex-col gap-2 pt-1">
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                  <Code2 class="h-3.5 w-3.5 text-primary" />
                  Svelte 5 Snippet & Computed Classes
                </span>
                <div class="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="xs"
                    class="h-6 text-[11px] gap-1"
                    onclick={() => copyToClipboard(generatedClassNames, false)}
                  >
                    {#if copiedClasses}
                      <Check class="h-3 w-3 text-success" />
                      Copied Classes
                    {:else}
                      <Copy class="h-3 w-3" />
                      Copy Classes
                    {/if}
                  </Button>
                  <Button
                    variant="secondary"
                    size="xs"
                    class="h-6 text-[11px] gap-1"
                    onclick={() => copyToClipboard(generatedSnippet, true)}
                  >
                    {#if copiedSnippet}
                      <Check class="h-3 w-3 text-success" />
                      Copied Code
                    {:else}
                      <Copy class="h-3 w-3" />
                      Copy Svelte 5 Snippet
                    {/if}
                  </Button>
                </div>
              </div>

              <!-- Code Box -->
              <div class="p-2.5 rounded-lg bg-muted/60 border text-[11px] text-foreground/90 overflow-x-auto whitespace-pre">
                {generatedSnippet}
              </div>

              <div class="p-2 rounded-lg bg-muted/30 border text-[10px] text-muted-foreground overflow-x-auto leading-relaxed">
                <span class="font-semibold text-foreground/80">Tailwind Classes: </span>{generatedClassNames}
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Footer -->
    <Dialog.Footer class="p-3 border-t bg-card flex items-center justify-between">
      <span class="text-[11px] text-muted-foreground">
        HMR Active: Edits to <code class="text-foreground">src/styles/components/*.css</code> and recipes update instantly.
      </span>
      <Button
        variant="default"
        size="sm"
        onclick={() => store.closeComponentGalleryDialog()}
      >
        Close
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
{/if}
