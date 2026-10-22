<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import type { ShapeElement, ShapeVariant } from '../../../stores/canvas-types';
  import type { EditableShapeSpan } from '../../../core/types';
  import SidebarSection from '../../common/SidebarSection.svelte';
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
    Spline,
  } from 'lucide-svelte';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();
  const editorStore = useEditorStore();
  const editorActions = useEditorActions();

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

  const activeShape = $derived.by(() => {
    if (canvasStore.selectedElement?.kind === 'shape') {
      return canvasStore.selectedElement as ShapeElement;
    }
    if (editorStore.selectedSpan?.type === 'shape') {
      const span = editorStore.selectedSpan as EditableShapeSpan;
      return {
        id: span.id,
        kind: 'shape' as const,
        variant: (span.variant || 'rectangle') as ShapeVariant,
        fill: span.fill || 'transparent',
        stroke: span.stroke || 'transparent',
        strokeWidth: span.strokeWidth ?? 0,
        opacity: span.opacity ?? 1,
        isHighlight: Boolean(span.isHighlight),
        svgPath: span.svgPath,
        viewBox: span.viewBox,
        baseWidth: span.baseWidth ?? span.width,
        baseHeight: span.baseHeight ?? span.height,
        fillMode: span.fillMode,
        fillRule: span.fillRule,
        strokeLineCap: span.strokeLineCap,
        strokeLineJoin: span.strokeLineJoin,
        originalSvgPath: span.svgPath,
      };
    }
    return null;
  });

  const isDisabled = $derived(
    editorStore.isReadOnly ||
    !editorStore.canEditElements ||
    Boolean(canvasStore.selectedElement?.locked)
  );

  async function updateProps(updates: Partial<ShapeElement>): Promise<void> {
    if (isDisabled) return;
    let selected = canvasStore.selectedElementId;
    if (editorStore.selectedSpan?.type === 'shape' && (!selected || editorStore.selectedSpans.length > 0)) {
      selected = (editorStore.selectedSpans.length > 1 || Boolean(selected))
        ? ((await editorActions.extractSelectedSpansToCanvas(editorStore.selectedSpan, canvasStore)).primaryElementId ?? canvasStore.selectedElementId)
        : ((await editorActions.extractObjectToCanvas('shape', editorStore.selectedSpan, canvasStore)) ?? null);
    }
    if (selected) {
      if (canvasStore.selectedElementIds.length > 1) {
        canvasActions.updateSelectedElementsProperties(updates as Record<string, unknown>, { kind: 'shape' });
      } else {
        canvasActions.updateElementProperties(selected, updates as Record<string, unknown>);
      }
    }
  }

  async function updateProp(propName: keyof ShapeElement, value: unknown): Promise<void> {
    await updateProps({ [propName]: value } as Partial<ShapeElement>);
  }
</script>

{#if activeShape}
  {@const shapeEl = activeShape}
  <SidebarSection title="Shape Properties" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-2">
      <!-- Shape Variant -->
      <div class="field-group-sm">
        <Label class="field-label">Shape Type</Label>
        <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
          <Button
            variant={activeShape.variant === 'rectangle' ? 'default' : 'outline'}
            size="sm"
            class="flex-1 p-0"
            onclick={() => void updateProp('variant', 'rectangle' as ShapeVariant)}
            title="Rectangle"
            aria-label="Rectangle"
            aria-pressed={activeShape.variant === 'rectangle'}
            disabled={isDisabled}
          >
            <Square class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={activeShape.variant === 'circle' ? 'default' : 'outline'}
            size="sm"
            class="flex-1 p-0"
            onclick={() => void updateProp('variant', 'circle' as ShapeVariant)}
            title="Circle"
            aria-label="Circle"
            aria-pressed={activeShape.variant === 'circle'}
            disabled={isDisabled}
          >
            <Circle class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={activeShape.variant === 'line' ? 'default' : 'outline'}
            size="sm"
            class="flex-1 p-0"
            onclick={() => void updateProp('variant', 'line' as ShapeVariant)}
            title="Line"
            aria-label="Line"
            aria-pressed={activeShape.variant === 'line'}
            disabled={isDisabled}
          >
            <Minus class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={activeShape.variant === 'arrow' ? 'default' : 'outline'}
            size="sm"
            class="flex-1 p-0"
            onclick={() => void updateProp('variant', 'arrow' as ShapeVariant)}
            title="Arrow"
            aria-label="Arrow"
            aria-pressed={activeShape.variant === 'arrow'}
            disabled={isDisabled}
          >
            <ArrowRight class="h-3.5 w-3.5" />
          </Button>
          {#if activeShape.variant === 'path' || activeShape.svgPath || activeShape.originalSvgPath}
            <Button
              variant={activeShape.variant === 'path' ? 'default' : 'outline'}
              size="sm"
              class="flex-1 p-0"
              onclick={() => void updateProp('variant', 'path' as ShapeVariant)}
              title="Path"
              aria-label="Path"
              aria-pressed={activeShape.variant === 'path'}
              disabled={isDisabled}
            >
              <Spline class="h-3.5 w-3.5" />
            </Button>
          {/if}
        </ButtonGroup>
      </div>
      <!-- Fill Colour & Presets -->
      {#if activeShape.variant !== 'line'}
        <div class="field-group-sm mt-0.5 w-full">
          <Label class="field-label">Fill</Label>
          <ColorPicker
            value={activeShape.fill || '#3b82f6'}
            presets={FILL_SWATCHES}
            allowNone={true}
            noneValue="transparent"
            onValueChange={(c) => void updateProp('fill', c)}
            onInteractingChange={setInspectorInteracting}
          />
        </div>
      {/if}

      <!-- Stroke Colour & Presets -->
      <div class="field-group-sm mt-0.5 w-full">
        <Label class="field-label">Stroke</Label>
        <ColorPicker
          value={activeShape.stroke || '#1e293b'}
          presets={STROKE_SWATCHES}
          allowNone={true}
          noneValue="transparent"
          onValueChange={(c) => {
            const updates: Partial<ShapeElement> = { stroke: c };
            if (c !== 'transparent' && activeShape.strokeWidth === 0) {
              updates.strokeWidth = 2;
            }
            void updateProps(updates);
          }}
          onInteractingChange={setInspectorInteracting}
        />
      </div>

      <!-- Stroke Width with Slider -->
      <div class="field-group mt-0.5 w-full">
        <Label class="field-label">Stroke Width</Label>
        <Slider
          type="single"
          value={activeShape.strokeWidth}
          min={0}
          max={48}
          step={0.5}
          unit="pt"
          onValueChange={(val: number) => void updateProp('strokeWidth', val)}
          class="w-full"
        />
      </div>

      <!-- Opacity with Slider -->
      <div class="field-group mt-0.5 w-full">
        <Label class="field-label">Opacity</Label>
        <Slider
          type="single"
          value={Math.round((activeShape.opacity ?? 1) * 100)}
          min={0}
          max={100}
          step={1}
          unit="%"
          onValueChange={(val: number) => void updateProp('opacity', val / 100)}
          class="w-full"
        />
      </div>

      <!-- Highlight Mode Capsule Switch Row -->
      {#if activeShape.variant === 'rectangle' || activeShape.isHighlight}
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
              onCheckedChange={(checked) => void updateProp('isHighlight', checked)}
              aria-label="Highlight Mode"
            />
          </ControlRow>
        </div>
      {/if}
    </div>
  </SidebarSection>
{/if}
