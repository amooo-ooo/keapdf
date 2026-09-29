<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import { useEditorStore } from '../../../stores/editor.svelte';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { RotateCcw, RotateCw } from 'lucide-svelte';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();
  const editorStore = useEditorStore();

  const isReadOnlyMode = $derived(editorStore.isReadOnly);

  function updateProp(propName: string, value: number): void {
    if (isReadOnlyMode) return;
    const selected = canvasStore.selectedElementId;
    if (selected && !Number.isNaN(value)) {
      canvasActions.updateElementProperties(selected, { [propName]: value });
    }
  }

  function handleNumberChange(e: Event, propName: string, min?: number): void {
    if (isReadOnlyMode) return;
    const target = e.target as HTMLInputElement;
    const parsed = parseFloat(target.value);
    if (Number.isNaN(parsed)) return;
    const val = min !== undefined ? Math.max(min, parsed) : parsed;
    updateProp(propName, val);
  }

  function handleKeydown(e: KeyboardEvent, propName: string, min?: number): void {
    if (e.key === 'Enter') {
      handleNumberChange(e, propName, min);
    }
  }

  function rotateStep(delta: number): void {
    if (isReadOnlyMode) return;
    const element = canvasStore.selectedElement;
    if (!element) return;
    const current = Math.round(element.rotation || 0);
    const next = (current + delta + 360) % 360;
    updateProp('rotation', next);
  }
</script>

{#if canvasStore.selectedElement}
  {@const element = canvasStore.selectedElement}
  <SidebarSection title="Position & Size" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-2">
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
            disabled={isReadOnlyMode}
          />
          <Input 
            type="number" 
            prefix="Y"
            value={Math.round(element.y * 10) / 10} 
            onchange={(e) => handleNumberChange(e, 'y')}
            onkeydown={(e) => handleKeydown(e, 'y')}
            class="field-input" 
            step="0.5"
            disabled={isReadOnlyMode}
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
            disabled={isReadOnlyMode}
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
            disabled={isReadOnlyMode}
          />
        </div>
      </div>
      <div class="field-group col-span-2">
        <div class="flex items-center justify-between">
          <Label class="field-label">Rotation (°)</Label>
          {#if Math.round(element.rotation || 0) !== 0 && !isReadOnlyMode}
            <button
              type="button"
              class="text-[10px] text-muted-foreground hover:text-foreground hover:underline cursor-pointer rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onclick={() => updateProp('rotation', 0)}
              aria-label="Reset rotation to 0 degrees"
            >
              Reset (0°)
            </button>
          {/if}
        </div>
        <div class="flex items-center gap-1.5">
          <Input 
            type="number" 
            value={Math.round(element.rotation || 0)} 
            onchange={(e) => handleNumberChange(e, 'rotation')}
            onkeydown={(e) => handleKeydown(e, 'rotation')}
            class="field-input text-xs flex-1 min-w-0" 
            min="0"
            max="360"
            step="1"
            disabled={isReadOnlyMode}
          />
          <ButtonGroup variant="outline" size="sm" class="shrink-0">
            <Button 
              size="icon-sm" 
              onclick={() => rotateStep(-90)}
              title="Rotate 90° Counter-Clockwise"
              aria-label="Rotate 90° Counter-Clockwise"
              disabled={isReadOnlyMode}
            >
              <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button 
              size="icon-sm" 
              onclick={() => rotateStep(90)}
              title="Rotate 90° Clockwise"
              aria-label="Rotate 90° Clockwise"
              disabled={isReadOnlyMode}
            >
              <RotateCw class="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </ButtonGroup>
        </div>
      </div>
    </div>
  </SidebarSection>
{/if}
