<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button, buttonVariants, type ButtonVariant, type ButtonSize } from '$lib/components/ui/button/index.js';
  import { Badge, badgeVariants, type BadgeVariant } from '$lib/components/ui/badge/index.js';
  import { ControlRow, controlRowVariants, type ControlRowVariant, type ControlRowSize } from '$lib/components/ui/control-row/index.js';
  import { Toggle, toggleVariants, type ToggleVariant, type ToggleSize } from '$lib/components/ui/toggle/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { Slider, sliderVariants, type SliderVariant, type SliderSize } from '$lib/components/ui/slider/index.js';
  import { PropertyRow } from '$lib/components/ui/property-row/index.js';
  import { PropertyCard } from '$lib/components/ui/property-card/index.js';
  import { PropertySection } from '$lib/components/ui/property-section/index.js';
  import * as Carousel from '$lib/components/ui/carousel/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
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
  let knobSliderVariant = $state<SliderVariant>('default');
  let knobSliderSize = $state<SliderSize>('default');
  let knobSliderValue = $state<number>(64);
  let knobSliderRangeValue = $state<number[]>([25, 75]);
  let knobSliderUnit = $state<string>('%');
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
      case 'Slider':
        return knobSliderVariant === 'range'
          ? `<Slider type="multiple" variant="range" size="${knobSliderSize}" value={[${knobSliderRangeValue[0]}, ${knobSliderRangeValue[1]}]} min={0} max={100} unit="${knobSliderUnit}"${knobDisabled ? ' disabled' : ''} />`
          : `<Slider type="single" variant="${knobSliderVariant}" size="${knobSliderSize}" value={${knobSliderValue}} min={0} max={100} step={${knobSliderVariant === 'stepped' ? 10 : 1}} ticks={${knobSliderVariant === 'stepped'}} unit="${knobSliderUnit}"${knobDisabled ? ' disabled' : ''} />`;
      case 'Input':
        return `<Input size="${knobInputSize}" prefix="${knobInputPrefix}" placeholder="${knobLabel}" />`;
      case 'Label':
        return `<Label size="${knobInputSize}">${knobLabel}</Label>`;
      case 'ColorPicker':
        return `<ColorPicker variant="${knobColorPickerVariant}" value="#10B981" />`;
      case 'PropertyRow':
        return `<PropertyRow label="${knobLabel}"><span class="text-xs text-muted-foreground">Value</span></PropertyRow>`;
      case 'PropertyCard':
        return `<PropertyCard label="${knobLabel}" actionText="Edit" />`;
      case 'PropertySection':
        return `<PropertySection title="${knobLabel}"><PropertyRow label="Property" /></PropertySection>`;
      case 'Carousel':
        return `<Carousel.Root totalSlides={5} loop={true}><Carousel.Content><Carousel.Item index={0}>${knobLabel}</Carousel.Item></Carousel.Content><Carousel.Indicators /><Carousel.Previous /><Carousel.Next /></Carousel.Root>`;
      case 'Card':
        return `<Card.Root><Card.Header><Card.Title>${knobLabel}</Card.Title><Card.Actions><Button variant="outline" size="icon-xs" /></Card.Actions></Card.Header><Card.Content>Body content</Card.Content></Card.Root>`;
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
      case 'Slider':
        return sliderVariants({ variant: knobSliderVariant, size: knobSliderSize });
      case 'Carousel':
        return Carousel.carouselVariants({ variant: 'default', size: 'default' });
      case 'Card':
        return Card.cardVariants({ variant: 'default', size: 'default' });
      default:
        return 'Standard utility styling';
    }
  });
</script>

{#if featureFlags.isEnabled('components.gallery')}
<Dialog.Root open={store.showComponentGalleryDialog} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[900px]">
    <!-- note: header -->
    <Dialog.Header class="pr-12">
      <div class="flex items-center justify-between gap-3">
        <div>
          <Dialog.Title>
            <Palette class="h-4 w-4 text-muted-foreground shrink-0" />
            UI Component Variant Gallery
            <Badge variant="outline" class="text-[10px] h-4 py-0 font-normal">
              Live Inspector
            </Badge>
          </Dialog.Title>
          <Dialog.Description>
            Inspect primitive styling variants, sizes, and DOM attributes for backend theme editing.
          </Dialog.Description>
        </div>

        <!-- note: quick filter input -->
        <div class="w-48 relative shrink-0">
          <Search class="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
          <Input
            class="field-input pl-8 pr-2"
            placeholder="Search variants..."
            bind:value={searchQuery}
          />
        </div>
      </div>
    </Dialog.Header>

    <!-- Main Body Container -->
    <div class="flex-1 overflow-hidden flex min-h-[460px]">
      <!-- Left sidebar: Component selection list -->
      <div class="w-52 border-r border-border bg-card flex flex-col p-2 gap-1 overflow-y-auto shrink-0 select-none">
        <span class="text-[10px] font-semibold text-muted-foreground px-2 py-1">
          Components ({filteredManifest.length})
        </span>
        {#each filteredManifest as entry (entry.componentName)}
          <button
            type="button"
            class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {selectedComponent === entry.componentName ? 'bg-secondary text-secondary-foreground font-semibold' : 'text-foreground/80 hover:bg-muted hover:text-foreground'}"
            onclick={() => { selectedComponent = entry.componentName; }}
          >
            <span class="truncate" title={entry.componentName}>{entry.componentName}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded-md {selectedComponent === entry.componentName ? 'bg-muted-foreground/15 text-foreground' : 'bg-muted-foreground/15 text-muted-foreground'}">
              {entry.variants.length}
            </span>
          </button>
        {/each}
      </div>

      <!-- Right main area: Matrix & Interactive Playground -->
      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-5 text-xs">
        {#if activeEntry}
          <!-- Component Overview Banner -->
          <div class="rounded-lg border bg-card p-3 flex flex-col gap-1.5">
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

          <!-- Matrix of all variants -->
          <div class="flex flex-col gap-2.5">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-foreground text-xs flex items-center gap-1.5">
                <Layers class="h-3.5 w-3.5" />
                Variant Matrix Showcase
              </span>
              <span class="text-[11px] text-muted-foreground">
                All variants rendered with default settings
              </span>
            </div>

            {#if selectedComponent === 'Button'}
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {#each activeEntry.variants as variantOption}
                  <div class="p-2.5 rounded-lg border border-border bg-card flex flex-col gap-2">
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
                <div class="p-3 rounded-lg border border-border bg-card flex flex-wrap items-center gap-2">
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
                  <div class="p-2.5 rounded-lg border border-border bg-card flex flex-col gap-1.5">
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
                  <div class="p-2 rounded-lg border border-border bg-card flex flex-col gap-1.5">
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
                  <div class="p-2.5 rounded-lg border border-border bg-card flex flex-col gap-2">
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

            {:else if selectedComponent === 'Slider'}
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div class="p-2.5 rounded-lg border border-border bg-card flex flex-col gap-2">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="font-medium text-foreground">default</span>
                    <span class="text-[10px] text-muted-foreground">data-variant="default"</span>
                  </div>
                  <Slider type="single" value={64} min={0} max={100} unit="%" />
                </div>
                <div class="p-2.5 rounded-lg border border-border bg-card flex flex-col gap-2">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="font-medium text-foreground">stepped</span>
                    <span class="text-[10px] text-muted-foreground">data-variant="stepped"</span>
                  </div>
                  <Slider type="single" variant="stepped" value={60} min={0} max={100} step={20} ticks={true} unit="%" />
                </div>
                <div class="p-2.5 rounded-lg border border-border bg-card flex flex-col gap-2">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="font-medium text-foreground">range</span>
                    <span class="text-[10px] text-muted-foreground">data-variant="range"</span>
                  </div>
                  <Slider type="multiple" variant="range" value={[20, 80]} min={0} max={100} step={5} unit="%" />
                </div>
                <div class="p-2.5 rounded-lg border border-border bg-card flex flex-col gap-2">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="font-medium text-foreground">unit</span>
                    <span class="text-[10px] text-muted-foreground">data-variant="unit"</span>
                  </div>
                  <Slider type="single" variant="unit" value={150} min={72} max={300} step={10} unit=" DPI" />
                </div>
              </div>

            {:else if selectedComponent === 'ColorPicker'}
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {#each activeEntry.variants as variantOption}
                  <div class="p-2.5 rounded-lg border border-border bg-card flex flex-col gap-2">
                    <span class="font-medium text-foreground">variant: "{variantOption}"</span>
                    <div class="pt-1">
                      <ColorPicker
                        variant={variantOption as 'default' | 'circle' | 'pill'}
                        value="#10B981"
                      />
                    </div>
                  </div>
                {/each}
              </div>

            {:else if selectedComponent === 'Input'}
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div class="p-2.5 rounded-lg border border-border bg-card flex flex-col gap-2">
                  <span class="font-medium text-foreground">size: "default"</span>
                  <Input placeholder="Standard size field..." />
                  <Input prefix="X" placeholder="With coordinate badge..." />
                </div>
                <div class="p-2.5 rounded-lg border border-border bg-card flex flex-col gap-2">
                  <span class="font-medium text-foreground">size: "compact"</span>
                  <Input size="compact" placeholder="Compact size field..." />
                  <Input size="compact" prefix="W" placeholder="With width badge..." />
                </div>
              </div>

            {:else if selectedComponent === 'PropertyRow'}
              <div class="flex flex-col gap-2 p-3 rounded-md border border-border bg-card">
                <PropertyRow label="Direction">
                  <Badge variant="outline">Horizontal</Badge>
                </PropertyRow>
                <PropertyRow label="Alignment">
                  <Badge variant="outline">Center</Badge>
                </PropertyRow>
                <PropertyRow label="Padding">
                  <span class="text-xs text-muted-foreground">Top & Bottom</span>
                </PropertyRow>
              </div>

            {:else if selectedComponent === 'PropertyCard'}
              <div class="flex flex-col gap-2 p-3 rounded-md border border-border bg-card">
                <PropertyCard label="Spacing" actionText="Edit" />
                <PropertyCard label="Color Schemes" actionText="Edit" />
              </div>

            {:else if selectedComponent === 'PropertySection'}
              <div class="flex flex-col rounded-md border border-border bg-card overflow-hidden">
                <PropertySection title="Layout">
                  <PropertyRow label="Direction">
                    <span class="text-xs text-muted-foreground">Standard</span>
                  </PropertyRow>
                  <PropertyRow label="Alignment">
                    <span class="text-xs text-muted-foreground">Center</span>
                  </PropertyRow>
                </PropertySection>
              </div>

            {:else if selectedComponent === 'Carousel'}
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {#each activeEntry.variants as variantOption}
                  <div class="p-2.5 rounded-lg border border-border bg-card flex flex-col gap-2">
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="font-medium text-foreground">{variantOption}</span>
                      <span class="text-[10px] text-muted-foreground">data-variant="{variantOption}"</span>
                    </div>
                    <Carousel.Root
                      variant={variantOption as Carousel.CarouselVariant}
                      totalSlides={3}
                      loop={true}
                      class="p-2.5 gap-2"
                    >
                      <Carousel.Content>
                        <Carousel.Item index={0}>
                          <span class="text-xs font-medium text-foreground">Reorder, merge and split</span>
                        </Carousel.Item>
                        <Carousel.Item index={1}>
                          <span class="text-xs font-medium text-foreground">Inline text editing</span>
                        </Carousel.Item>
                        <Carousel.Item index={2}>
                          <span class="text-xs font-medium text-foreground">Annotate and redact</span>
                        </Carousel.Item>
                      </Carousel.Content>
                      <div class="flex items-center justify-between gap-2 pt-1">
                        <Carousel.Indicators />
                        <Carousel.Next size="sm" label="Next" />
                      </div>
                    </Carousel.Root>
                  </div>
                {/each}
              </div>

            {:else if selectedComponent === 'Card'}
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {#each activeEntry.variants as variantOption}
                  <div class="p-2.5 rounded-lg border border-border bg-card flex flex-col gap-2">
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="font-medium text-foreground">{variantOption}</span>
                      <span class="text-[10px] text-muted-foreground">data-variant="{variantOption}"</span>
                    </div>
                    <Card.Root variant={variantOption as Card.CardVariant}>
                      <Card.Header>
                        <Card.Title>Signature</Card.Title>
                        <Card.Actions>
                          <Badge variant="outline" class="text-[10px]">PAdES-B-B</Badge>
                        </Card.Actions>
                      </Card.Header>
                      <Card.Content>
                        <span class="text-xs font-semibold text-foreground">Signer Identity</span>
                        <span class="text-[11px] text-muted-foreground">LTV Enabled (/DSS)</span>
                      </Card.Content>
                    </Card.Root>
                  </div>
                {/each}
              </div>

            {:else}
              <div class="p-3 rounded-lg border border-border bg-card text-muted-foreground text-center">
                Preview matrix for {selectedComponent}
              </div>
            {/if}
          </div>

          <!-- note: interactive playground and knobs -->
          <div class="rounded-lg border bg-card p-4 flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-foreground text-xs flex items-center gap-1.5">
                <Sliders class="h-3.5 w-3.5" />
                Interactive Knobs & Playground
              </span>
              <span class="text-[11px] text-muted-foreground">
                Tweak props to inspect generated classes and DOM output
              </span>
            </div>

            <!-- note: knobs toolbar -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <div class="field-group">
                <Label class="field-label">Label Text</Label>
                <Input class="field-input" bind:value={knobLabel} />
              </div>

              {#if selectedComponent === 'Button'}
                <div class="field-group">
                  <Label class="field-label">Variant</Label>
                  <Select.Root
                    type="single"
                    value={knobButtonVariant}
                    onValueChange={(v) => { if (v) knobButtonVariant = v as ButtonVariant; }}
                  >
                    <Select.Trigger class="w-full h-8 text-xs font-sans">
                      {knobButtonVariant}
                    </Select.Trigger>
                    <Select.Content>
                      {#each activeEntry.variants as v}
                        <Select.Item value={v} label={v}>{v}</Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
                <div class="field-group">
                  <Label class="field-label">Size</Label>
                  <Select.Root
                    type="single"
                    value={knobButtonSize}
                    onValueChange={(v) => { if (v) knobButtonSize = v as ButtonSize; }}
                  >
                    <Select.Trigger class="w-full h-8 text-xs font-sans">
                      {knobButtonSize}
                    </Select.Trigger>
                    <Select.Content>
                      {#each activeEntry.sizes || [] as s}
                        <Select.Item value={s} label={s}>{s}</Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
              {/if}

              {#if selectedComponent === 'Badge'}
                <div class="field-group">
                  <Label class="field-label">Variant</Label>
                  <Select.Root
                    type="single"
                    value={knobBadgeVariant}
                    onValueChange={(v) => { if (v) knobBadgeVariant = v as BadgeVariant; }}
                  >
                    <Select.Trigger class="w-full h-8 text-xs font-sans">
                      {knobBadgeVariant}
                    </Select.Trigger>
                    <Select.Content>
                      {#each activeEntry.variants as v}
                        <Select.Item value={v} label={v}>{v}</Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
              {/if}

              {#if selectedComponent === 'ControlRow'}
                <div class="field-group">
                  <Label class="field-label">Variant</Label>
                  <Select.Root
                    type="single"
                    value={knobControlRowVariant}
                    onValueChange={(v) => { if (v) knobControlRowVariant = v as ControlRowVariant; }}
                  >
                    <Select.Trigger class="w-full h-8 text-xs font-sans">
                      {knobControlRowVariant}
                    </Select.Trigger>
                    <Select.Content>
                      {#each activeEntry.variants as v}
                        <Select.Item value={v} label={v}>{v}</Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
                <div class="field-group">
                  <Label class="field-label">Size</Label>
                  <Select.Root
                    type="single"
                    value={knobControlRowSize}
                    onValueChange={(v) => { if (v) knobControlRowSize = v as ControlRowSize; }}
                  >
                    <Select.Trigger class="w-full h-8 text-xs font-sans">
                      {knobControlRowSize}
                    </Select.Trigger>
                    <Select.Content>
                      {#each activeEntry.sizes || [] as s}
                        <Select.Item value={s} label={s}>{s}</Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
              {/if}

              {#if selectedComponent === 'Slider'}
                <div class="field-group">
                  <Label class="field-label">Variant</Label>
                  <Select.Root
                    type="single"
                    value={knobSliderVariant}
                    onValueChange={(v) => { if (v) knobSliderVariant = v as SliderVariant; }}
                  >
                    <Select.Trigger class="w-full h-8 text-xs font-sans">
                      {knobSliderVariant}
                    </Select.Trigger>
                    <Select.Content>
                      {#each activeEntry.variants as v}
                        <Select.Item value={v} label={v}>{v}</Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
                <div class="field-group">
                  <Label class="field-label">Size</Label>
                  <Select.Root
                    type="single"
                    value={knobSliderSize}
                    onValueChange={(v) => { if (v) knobSliderSize = v as SliderSize; }}
                  >
                    <Select.Trigger class="w-full h-8 text-xs font-sans">
                      {knobSliderSize}
                    </Select.Trigger>
                    <Select.Content>
                      {#each activeEntry.sizes || [] as s}
                        <Select.Item value={s} label={s}>{s}</Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
              {/if}

              <!-- note: states toggles -->
              <div class="flex items-center gap-3 self-end">
                <ControlRow label="Disabled" for="knob-disabled" size="compact">
                  <Switch id="knob-disabled" bind:checked={knobDisabled} />
                </ControlRow>
                {#if selectedComponent === 'Button'}
                  <ControlRow label="Active" for="knob-active" size="compact">
                    <Switch id="knob-active" bind:checked={knobActive} />
                  </ControlRow>
                {/if}
              </div>
            </div>

            <!-- note: live playground render view -->
            <div class="p-4 rounded-md border border-dashed border-border bg-card flex items-center justify-center min-h-[70px]">
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
              {:else if selectedComponent === 'Slider'}
                <div class="w-full max-w-sm">
                  {#if knobSliderVariant === 'range'}
                    <Slider
                      type="multiple"
                      variant="range"
                      size={knobSliderSize}
                      bind:value={knobSliderRangeValue}
                      min={0}
                      max={100}
                      step={5}
                      unit={knobSliderUnit}
                      disabled={knobDisabled}
                    />
                  {:else}
                    <Slider
                      type="single"
                      variant={knobSliderVariant}
                      size={knobSliderSize}
                      bind:value={knobSliderValue}
                      min={0}
                      max={100}
                      step={knobSliderVariant === 'stepped' ? 10 : 1}
                      ticks={knobSliderVariant === 'stepped'}
                      unit={knobSliderUnit}
                      disabled={knobDisabled}
                    />
                  {/if}
                </div>
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
                    value="#10B981"
                    disabled={knobDisabled}
                  />
                </div>
              {:else if selectedComponent === 'PropertyRow'}
                <div class="w-full max-w-md bg-card p-2 rounded-md border border-border">
                  <PropertyRow label={knobLabel} description="Two-column inspector property">
                    <span class="text-xs text-muted-foreground">Standard</span>
                  </PropertyRow>
                </div>
              {:else if selectedComponent === 'PropertyCard'}
                <div class="w-full max-w-md">
                  <PropertyCard label={knobLabel} actionText="Edit" />
                </div>
              {:else if selectedComponent === 'PropertySection'}
                <div class="w-full max-w-md bg-card rounded-md border border-border overflow-hidden">
                  <PropertySection title={knobLabel}>
                    <PropertyRow label="Property">
                      <span class="text-xs text-muted-foreground">Value</span>
                    </PropertyRow>
                  </PropertySection>
                </div>
              {:else if selectedComponent === 'Card'}
                <div class="w-full max-w-md">
                  <Card.Root>
                    <Card.Header>
                      <Card.Title>{knobLabel}</Card.Title>
                      <Card.Actions>
                        <Badge variant="secondary" class="text-[10px]">Default</Badge>
                      </Card.Actions>
                    </Card.Header>
                    <Card.Content>
                      <span class="text-xs text-muted-foreground">Composable card content slot</span>
                    </Card.Content>
                  </Card.Root>
                </div>
              {/if}
            </div>

            <!-- note: dom inspector and snippet exporter -->
            <div class="flex flex-col gap-2 pt-1">
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                  <Code2 class="h-3.5 w-3.5" />
                  Svelte 5 Snippet & Computed Classes
                </span>
                <div class="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-8 text-[11px] gap-1"
                    onclick={() => copyToClipboard(generatedClassNames, false)}
                  >
                    {#if copiedClasses}
                      <Check class="h-3 w-3" />
                      Copied Classes
                    {:else}
                      <Copy class="h-3 w-3" />
                      Copy Classes
                    {/if}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    class="h-8 text-[11px] gap-1"
                    onclick={() => copyToClipboard(generatedSnippet, true)}
                  >
                    {#if copiedSnippet}
                      <Check class="h-3 w-3" />
                      Copied Code
                    {:else}
                      <Copy class="h-3 w-3" />
                      Copy Svelte 5 Snippet
                    {/if}
                  </Button>
                </div>
              </div>

              <!-- note: code box -->
              <div class="p-2.5 rounded-lg border border-border bg-card text-[11px] text-foreground/90 overflow-x-auto whitespace-pre">
                {generatedSnippet}
              </div>

              <div class="p-2 rounded-lg border border-border bg-card text-[10px] text-muted-foreground overflow-x-auto leading-relaxed">
                <span class="font-semibold text-foreground/80">Tailwind Classes: </span>{generatedClassNames}
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- note: footer -->
    <Dialog.Footer class="justify-between">
      <span class="text-[11px] text-muted-foreground">
        HMR Active: Edits to <code class="text-foreground">src/styles/components/*.css</code> and recipes update instantly.
      </span>
      <Button
        variant="secondary"
        size="sm"
        class="h-8 text-xs"
        onclick={() => store.closeComponentGalleryDialog()}
      >
        Close
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
{/if}
