<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../../core/feature-flags';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import TransformSection from './TransformSection.svelte';
  import ArrangeSection from './ArrangeSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { RotateCcw, RotateCw } from 'lucide-svelte';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();
  const editorStore = useEditorStore();
  const editorActions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  const isReadOnlyMode = $derived(editorStore.isReadOnly);
  const isLocked = $derived(Boolean(canvasStore.selectedElement?.locked));
  const canMove = $derived(!isReadOnlyMode && !isLocked && editorStore.canMoveElements);
  const canResize = $derived(!isReadOnlyMode && !isLocked && editorStore.canResizeElements);
  const canRotate = $derived(!isReadOnlyMode && !isLocked && editorStore.canRotateElements);
  const isUnifiedGeometry = $derived(featureFlags.isEnabled('panels.unified-geometry'));

  const activeElement = $derived.by(() => {
    if (canvasStore.selectedElement) {
      return canvasStore.selectedElement;
    }
    const span = editorStore.selectedSpan;
    if (span && (span.type === 'image' || span.type === 'shape' || span.type === 'form-field' || span.type === 'text')) {
      return {
        id: span.id,
        x: span.left,
        y: span.top,
        width: span.width,
        height: span.height,
        rotation: span.rotation || 0,
      };
    }
    return null;
  });

  // note: ensure native text spans also render the unified section when arrange is active
  const hasArrangeTarget = $derived(
    isUnifiedGeometry &&
    featureFlags.isEnabled('canvas-elements.arrange') &&
    Boolean(canvasStore.selectedElement || canvasStore.selectedElementId || editorStore.selectedSpan)
  );

  async function updateProp(propName: string, value: number): Promise<void> {
    if (isReadOnlyMode || isLocked || Number.isNaN(value)) return;
    if ((propName === 'x' || propName === 'y') && !canMove) return;
    if ((propName === 'width' || propName === 'height') && !canResize) return;
    if (propName === 'rotation' && !canRotate) return;

    const multiModifyEnabled =
      featureFlags.isEnabled('select-tool.multiselect') &&
      featureFlags.isEnabled('select-tool.multiselect.modify');

    let selected = canvasStore.selectedElementId;
    if (
      editorStore.selectedSpan &&
      (editorStore.selectedSpan.type === 'image' ||
        editorStore.selectedSpan.type === 'shape' ||
        editorStore.selectedSpan.type === 'form-field' ||
        editorStore.selectedSpan.type === 'text') &&
      (!selected || (multiModifyEnabled && editorStore.selectedSpans.length > 0))
    ) {
      const extracted = multiModifyEnabled
        ? (await editorActions.extractSelectedSpansToCanvas(editorStore.selectedSpan, canvasStore)).primaryElementId
        : await editorActions.extractObjectToCanvas(editorStore.selectedSpan.type, editorStore.selectedSpan, canvasStore);
      selected = extracted ?? canvasStore.selectedElementId;
    }
    if (!selected) return;

    const el = canvasStore.getElementById(selected);
    if (!el || el.locked) return;

    if (multiModifyEnabled && canvasStore.selectedElementIds.length > 1) {
      if (propName === 'width' || propName === 'height') {
        canvasActions.resizeSelectedElementsToDimensions(
          propName === 'width' ? value : undefined,
          propName === 'height' ? value : undefined,
        );
        return;
      }

      canvasActions.updateSelectedElementsProperties((item) => {
        if ((propName === 'x' || propName === 'y') && item.kind === 'path' && 'points' in item && Array.isArray(item.points)) {
          const dx = propName === 'x' ? value - item.x : 0;
          const dy = propName === 'y' ? value - item.y : 0;
          return {
            [propName]: value,
            points: item.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
          };
        }
        return { [propName]: value };
      });
      return;
    }

    if ((propName === 'x' || propName === 'y') && el.kind === 'path' && 'points' in el && Array.isArray(el.points)) {
      const dx = propName === 'x' ? value - el.x : 0;
      const dy = propName === 'y' ? value - el.y : 0;
      const shiftedPoints = el.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      canvasActions.updateElementProperties(selected, { [propName]: value, points: shiftedPoints });
      canvasStore.selectElement(selected);
      return;
    }

    if (propName === 'width' || propName === 'height') {
      const targetWidth = propName === 'width' ? value : el.width;
      const targetHeight = propName === 'height' ? value : el.height;
      canvasActions.resizeElementToDimensions(selected, targetWidth, targetHeight);
      canvasStore.selectElement(selected);
      return;
    }

    canvasActions.updateElementProperties(selected, { [propName]: value });
    canvasStore.selectElement(selected);
  }

  function handleNumberChange(e: Event, propName: string, min?: number): void {
    if (isReadOnlyMode || isLocked) return;
    const target = e.target as HTMLInputElement;
    const parsed = parseFloat(target.value);
    if (Number.isNaN(parsed)) return;
    const val = min !== undefined ? Math.max(min, parsed) : parsed;
    void updateProp(propName, val);
  }

  function handleKeydown(e: KeyboardEvent, propName: string, min?: number): void {
    if (e.key === 'Enter') {
      handleNumberChange(e, propName, min);
    }
  }

  async function rotateStep(delta: number): Promise<void> {
    if (!canRotate) return;
    const element = activeElement;
    if (!element) return;
    const multiModifyEnabled =
      featureFlags.isEnabled('select-tool.multiselect') &&
      featureFlags.isEnabled('select-tool.multiselect.modify');
    if (multiModifyEnabled && (canvasStore.selectedElementIds.length > 1 || editorStore.selectedSpans.length > 1)) {
      if (editorStore.selectedSpans.length > 0) {
        await editorActions.extractSelectedSpansToCanvas(editorStore.selectedSpan ?? undefined, canvasStore);
      }
      canvasActions.updateSelectedElementsProperties((item) => ({
        rotation: ((Math.round(item.rotation || 0) + delta) % 360 + 360) % 360,
      }));
      return;
    }
    const current = Math.round(element.rotation || 0);
    const next = (current + delta + 360) % 360;
    await updateProp('rotation', next);
  }
</script>

{#if activeElement || hasArrangeTarget}
  <SidebarSection
    title={isUnifiedGeometry ? 'Position & Layout' : 'Position & Size'}
    borderBottom={true}
    collapsible={true}
    defaultExpanded={true}
  >
    <div class="flex flex-col gap-2">
      {#if activeElement}
        {@const element = activeElement}
        <div class="field-group">
          <Label class="field-label">Position (pt)</Label>
          <div class="grid grid-cols-2 gap-1.5">
            <Input 
              type="number" 
              prefix="X"
              value={Math.round(element.x * 10) / 10} 
              onchange={(e) => handleNumberChange(e, 'x')}
              onkeydown={(e) => handleKeydown(e, 'x')}
              class="field-input" 
              step="0.5"
              disabled={!canMove}
              aria-label="X position"
            />
            <Input 
              type="number" 
              prefix="Y"
              value={Math.round(element.y * 10) / 10} 
              onchange={(e) => handleNumberChange(e, 'y')}
              onkeydown={(e) => handleKeydown(e, 'y')}
              class="field-input" 
              step="0.5"
              disabled={!canMove}
              aria-label="Y position"
            />
          </div>
        </div>
        <div class="field-group">
          <Label class="field-label">Size (pt)</Label>
          <div class="grid grid-cols-2 gap-1.5">
            <Input 
              type="number" 
              prefix="W"
              value={Math.round(element.width * 10) / 10} 
              onchange={(e) => handleNumberChange(e, 'width', 1)}
              onkeydown={(e) => handleKeydown(e, 'width', 1)}
              class="field-input" 
              min="1"
              step="0.5"
              disabled={!canResize}
              aria-label="Width"
            />
            <Input 
              type="number" 
              prefix="H"
              value={Math.round(element.height * 10) / 10} 
              onchange={(e) => handleNumberChange(e, 'height', 1)}
              onkeydown={(e) => handleKeydown(e, 'height', 1)}
              class="field-input" 
              min="1"
              step="0.5"
              disabled={!canResize}
              aria-label="Height"
            />
          </div>
        </div>
        <div class="field-group col-span-2">
          <Label class="field-label">Rotation (°)</Label>
          <div class="flex items-center gap-1">
            <Input 
              type="number" 
              value={Math.round(element.rotation || 0)} 
              onchange={(e) => handleNumberChange(e, 'rotation')}
              onkeydown={(e) => handleKeydown(e, 'rotation')}
              class="field-input text-xs flex-1 min-w-0" 
              min="0"
              max="360"
              step="1"
              disabled={!canRotate}
              aria-label="Rotation degrees"
            />
            <ButtonGroup variant="ghost" size="sm" class="h-8 shrink-0">
              <Button 
                variant="ghost"
                size="icon-sm" 
                onclick={(e) => {
                  e.stopPropagation();
                  rotateStep(-90);
                }}
                title="Rotate 90° Counter-Clockwise"
                aria-label="Rotate 90° Counter-Clockwise"
                disabled={!canRotate}
              >
                <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button 
                variant="ghost"
                size="icon-sm" 
                onclick={(e) => {
                  e.stopPropagation();
                  rotateStep(90);
                }}
                title="Rotate 90° Clockwise"
                aria-label="Rotate 90° Clockwise"
                disabled={!canRotate}
              >
                <RotateCw class="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </ButtonGroup>
            {#if isUnifiedGeometry}
              <TransformSection embedded={true} />
            {/if}
          </div>
        </div>
      {/if}

      {#if isUnifiedGeometry}
        <ArrangeSection embedded={true} />
      {/if}
    </div>
  </SidebarSection>
{/if}
