<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import type { ShapeElement, ShapeVariant } from '../../../stores/canvas-types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { ControlRow } from '$lib/components/ui/control-row/index.js';
  import { setInspectorInteracting } from '../../../utils/text-range-utils';
  import {
    Square,
    Circle,
    Minus,
    ArrowRight,
    Highlighter,
  } from 'lucide-svelte';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  const FILL_SWATCHES = [
    { label: 'Blue', color: '#3b82f6', bg: 'bg-blue-500', border: 'border-blue-600' },
    { label: 'Green', color: '#10b981', bg: 'bg-emerald-500', border: 'border-emerald-600' },
    { label: 'Amber', color: '#f59e0b', bg: 'bg-amber-500', border: 'border-amber-600' },
    { label: 'Red', color: '#ef4444', bg: 'bg-red-500', border: 'border-red-600' },
    { label: 'Purple', color: '#8b5cf6', bg: 'bg-purple-500', border: 'border-purple-600' },
  ];

  const STROKE_SWATCHES = [
    { label: 'Blue', color: '#3b82f6', bg: 'bg-blue-500', border: 'border-blue-600' },
    { label: 'Dark', color: '#1e293b', bg: 'bg-slate-800', border: 'border-slate-900' },
    { label: 'Green', color: '#10b981', bg: 'bg-emerald-500', border: 'border-emerald-600' },
    { label: 'Red', color: '#ef4444', bg: 'bg-red-500', border: 'border-red-600' },
    { label: 'Purple', color: '#8b5cf6', bg: 'bg-purple-500', border: 'border-purple-600' },
  ];

  function updateProp(propName: keyof ShapeElement, value: unknown): void {
    const selected = canvasStore.selectedElementId;
    if (selected) {
      canvasActions.updateElementProperties(selected, { [propName]: value });
    }
  }

  function handleNumberChange(e: Event, propName: keyof ShapeElement): void {
    const target = e.target as HTMLInputElement;
    const parsed = parseFloat(target.value);
    if (!Number.isNaN(parsed)) {
      updateProp(propName, parsed);
    }
  }
</script>

{#if canvasStore.selectedElement?.kind === 'shape'}
  {@const shapeEl = canvasStore.selectedElement as ShapeElement}
  <SidebarSection title="Shape Properties" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-2">
      <!-- Shape Variant -->
      <div class="field-group-sm">
        <Label class="field-label">Shape Type</Label>
        <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
          <Button
            variant={shapeEl.variant === 'rectangle' ? 'default' : 'outline'}
            size="sm"
            class="flex-1 h-8 p-0"
            onclick={() => updateProp('variant', 'rectangle' as ShapeVariant)}
            title="Rectangle"
            aria-label="Rectangle"
            aria-pressed={shapeEl.variant === 'rectangle'}
          >
            <Square class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={shapeEl.variant === 'circle' ? 'default' : 'outline'}
            size="sm"
            class="flex-1 h-8 p-0"
            onclick={() => updateProp('variant', 'circle' as ShapeVariant)}
            title="Circle"
            aria-label="Circle"
            aria-pressed={shapeEl.variant === 'circle'}
          >
            <Circle class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={shapeEl.variant === 'line' ? 'default' : 'outline'}
            size="sm"
            class="flex-1 h-8 p-0"
            onclick={() => updateProp('variant', 'line' as ShapeVariant)}
            title="Line"
            aria-label="Line"
            aria-pressed={shapeEl.variant === 'line'}
          >
            <Minus class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={shapeEl.variant === 'arrow' ? 'default' : 'outline'}
            size="sm"
            class="flex-1 h-8 p-0"
            onclick={() => updateProp('variant', 'arrow' as ShapeVariant)}
            title="Arrow"
            aria-label="Arrow"
            aria-pressed={shapeEl.variant === 'arrow'}
          >
            <ArrowRight class="h-3.5 w-3.5" />
          </Button>
        </ButtonGroup>
      </div>

      <!-- Fill Color & Presets -->
      <div class="field-group-sm mt-0.5 w-full">
        <Label class="field-label">Fill</Label>
        <ColorPicker
          value={shapeEl.fill || '#3b82f6'}
          presets={FILL_SWATCHES}
          allowNone={true}
          noneValue="transparent"
          onValueChange={(c) => updateProp('fill', c)}
          onInteractingChange={setInspectorInteracting}
        />
      </div>

      <!-- Stroke Color & Presets -->
      <div class="field-group-sm mt-0.5 w-full">
        <Label class="field-label">Stroke</Label>
        <ColorPicker
          value={shapeEl.stroke || '#1e293b'}
          presets={STROKE_SWATCHES}
          allowNone={true}
          noneValue="transparent"
          onValueChange={(c) => {
            updateProp('stroke', c);
            if (c !== 'transparent' && shapeEl.strokeWidth === 0) updateProp('strokeWidth', 2);
          }}
          onInteractingChange={setInspectorInteracting}
        />
      </div>

      <!-- Stroke Width -->
      <div class="field-group-sm mt-0.5 w-full">
        <div class="field-header-row">
          <Label class="field-label">Stroke Width (pt)</Label>
          <span class="panel-slider-value">{shapeEl.strokeWidth} pt</span>
        </div>
        <div class="flex items-center gap-2">
          <Input
            type="number"
            value={shapeEl.strokeWidth}
            oninput={(e) => handleNumberChange(e, 'strokeWidth')}
            class="field-input flex-1"
            min="0"
            max="48"
            step="0.5"
          />
          <ButtonGroup variant="outline" size="sm" class="h-8 shrink-0">
            <Button
              variant={shapeEl.strokeWidth === 1 ? 'default' : 'outline'}
              size="sm"
              class="h-8 px-2 text-xs tabular-nums"
              onclick={() => updateProp('strokeWidth', 1)}
              aria-pressed={shapeEl.strokeWidth === 1}
            >1</Button>
            <Button
              variant={shapeEl.strokeWidth === 2 ? 'default' : 'outline'}
              size="sm"
              class="h-8 px-2 text-xs tabular-nums"
              onclick={() => updateProp('strokeWidth', 2)}
              aria-pressed={shapeEl.strokeWidth === 2}
            >2</Button>
            <Button
              variant={shapeEl.strokeWidth === 4 ? 'default' : 'outline'}
              size="sm"
              class="h-8 px-2 text-xs tabular-nums"
              onclick={() => updateProp('strokeWidth', 4)}
              aria-pressed={shapeEl.strokeWidth === 4}
            >4</Button>
          </ButtonGroup>
        </div>
      </div>

      <!-- Opacity with Slider -->
      <div class="field-group mt-0.5 w-full">
        <div class="field-header-row">
          <Label class="field-label">Opacity</Label>
          <span class="panel-slider-value">{Math.round((shapeEl.opacity ?? 1) * 100)}%</span>
        </div>
        <Slider
          type="single"
          value={Math.round((shapeEl.opacity ?? 1) * 100)}
          min={0}
          max={100}
          step={1}
          ticks={true}
          tickCount={5}
          onValueChange={(val: number) => updateProp('opacity', val / 100)}
          class="w-full"
        />
      </div>

      <!-- Highlight Mode Capsule Switch Row -->
      {#if shapeEl.variant === 'rectangle'}
        <div class="mt-1 w-full">
          <ControlRow label="Highlight Mode" size="sm">
            {#snippet labelSnippet()}
              <div class="flex items-center gap-1.5 min-w-0">
                <Highlighter class="h-3.5 w-3.5 text-warning shrink-0" />
                <span class="text-xs font-medium text-foreground/90 truncate">Highlight Mode</span>
              </div>
            {/snippet}
            <Switch
              checked={Boolean(shapeEl.isHighlight)}
              onCheckedChange={(checked) => updateProp('isHighlight', checked)}
              aria-label="Highlight Mode"
            />
          </ControlRow>
        </div>
      {/if}
    </div>
  </SidebarSection>
{/if}
