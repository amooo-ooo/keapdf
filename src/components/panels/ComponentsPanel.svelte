<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import type { CanvasElementKind, ShapeVariant, FormFieldVariant, ElementDropPayload } from '../../stores/canvas-types';
  import SidebarSection from '../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import {
    Type,
    ImagePlus,
    Square,
    Circle,
    Minus,
    ArrowRight,
    Heading,
    FileText,
    FormInput,
    CheckSquare,
    CircleDot,
    ListFilter,
    PenTool,
    Stamp,
    Layers,
    Paperclip
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const canvasActions = useCanvasActions();
  const canvasStore = useCanvasStore();

  const hasPageTransforms = $derived(
    Object.values(store.pageTransforms).some(t => t && (t.rotation !== 0 || t.scaleX !== 1 || t.scaleY !== 1))
  );

  function handleApplyComponents(): void {
    if (canvasStore.elements.length > 0 || hasPageTransforms) {
      actions.applyCanvasComponentsToPdf(canvasStore.elements, () => {
        canvasStore.elements = [];
      });
    }
  }

  function handleImportImage(): void {
    actions.triggerImageImport();
  }

  function triggerTool(toolName: string): void {
    store.activeMockupTool = toolName;
  }

  function handleDragStart(e: DragEvent, payload: ElementDropPayload): void {
    if (e.dataTransfer) {
      e.dataTransfer.setData('application/x-canvas-element', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  function placeAtCenter(
    kind: CanvasElementKind,
    options?: {
      variant?: ShapeVariant | FormFieldVariant;
      label?: string;
      text?: string;
      fontSize?: number;
      fontWeight?: 'normal' | 'bold';
      fontFamily?: string;
      width?: number;
      height?: number;
    }
  ): void {
    // Assuming typical letter page center in points
    const centerX = 300;
    const centerY = 400;
    canvasActions.createElement(kind, store.currentPageIndex, centerX, centerY, options);
  }
</script>

<div class="flex flex-col min-h-0 divide-y divide-border">
  <!-- Section 1: Text & Content -->
  <SidebarSection title="Text & Content" borderBottom={true}>
    <div class="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => placeAtCenter('text', { text: 'Type here', fontSize: 14, width: 150, height: 30 })}
        draggable="true"
        ondragstart={(e) => handleDragStart(e, { kind: 'text', text: 'Type here', fontSize: 14 })}
        disabled={!store.isDocumentLoaded}
      >
        <Type class="h-3.5 w-3.5 mr-2 text-primary" /> Add Text Box
      </Button>
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => placeAtCenter('text', { text: 'Heading', fontSize: 22, fontWeight: 'bold', width: 200, height: 36 })}
        draggable="true"
        ondragstart={(e) => handleDragStart(e, { kind: 'text', text: 'Heading', fontSize: 22, fontWeight: 'bold' })}
        disabled={!store.isDocumentLoaded}
      >
        <Heading class="h-3.5 w-3.5 mr-2 text-primary" /> Heading
      </Button>
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => placeAtCenter('text', { text: 'Body text paragraph', fontSize: 12, width: 180, height: 28 })}
        draggable="true"
        ondragstart={(e) => handleDragStart(e, { kind: 'text', text: 'Body text paragraph', fontSize: 12 })}
        disabled={!store.isDocumentLoaded}
      >
        <FileText class="h-3.5 w-3.5 mr-2 text-primary" /> Body Text
      </Button>
    </div>
  </SidebarSection>

  <!-- Section 2: Interactive Form Fields -->
  <SidebarSection title="Interactive Form Fields" borderBottom={true}>
    <div class="flex flex-col gap-2">
      <Button variant="outline" size="sm" class="w-full justify-start text-xs h-8" onclick={() => placeAtCenter('form-field', { variant: 'text-input' })} draggable="true" ondragstart={(e) => handleDragStart(e, { kind: 'form-field', variant: 'text-input' })} disabled={!store.isDocumentLoaded}>
        <FormInput class="h-3.5 w-3.5 mr-2 text-primary" /> Text Input
      </Button>
      <Button variant="outline" size="sm" class="w-full justify-start text-xs h-8" onclick={() => placeAtCenter('form-field', { variant: 'checkbox' })} draggable="true" ondragstart={(e) => handleDragStart(e, { kind: 'form-field', variant: 'checkbox' })} disabled={!store.isDocumentLoaded}>
        <CheckSquare class="h-3.5 w-3.5 mr-2 text-primary" /> Checkbox
      </Button>
      <Button variant="outline" size="sm" class="w-full justify-start text-xs h-8" onclick={() => placeAtCenter('form-field', { variant: 'radio' })} draggable="true" ondragstart={(e) => handleDragStart(e, { kind: 'form-field', variant: 'radio' })} disabled={!store.isDocumentLoaded}>
        <CircleDot class="h-3.5 w-3.5 mr-2 text-primary" /> Radio Button
      </Button>
      <Button variant="outline" size="sm" class="w-full justify-start text-xs h-8" onclick={() => placeAtCenter('form-field', { variant: 'dropdown' })} draggable="true" ondragstart={(e) => handleDragStart(e, { kind: 'form-field', variant: 'dropdown' })} disabled={!store.isDocumentLoaded}>
        <ListFilter class="h-3.5 w-3.5 mr-2 text-primary" /> Dropdown
      </Button>
      <Button variant="outline" size="sm" class="w-full justify-start text-xs h-8" onclick={() => placeAtCenter('form-field', { variant: 'signature' })} draggable="true" ondragstart={(e) => handleDragStart(e, { kind: 'form-field', variant: 'signature' })} disabled={!store.isDocumentLoaded}>
        <PenTool class="h-3.5 w-3.5 mr-2 text-primary" /> Sign Field
      </Button>
      <Button variant="outline" size="sm" class="w-full justify-start text-xs h-8" onclick={() => placeAtCenter('form-field', { variant: 'attachment' })} draggable="true" ondragstart={(e) => handleDragStart(e, { kind: 'form-field', variant: 'attachment' })} disabled={!store.isDocumentLoaded}>
        <Paperclip class="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Attachment
      </Button>
    </div>
  </SidebarSection>

  <!-- Section 3: Images & Media -->
  <SidebarSection title="Images & Media" borderBottom={true}>
    <div class="flex flex-col gap-2">
      <Button variant="outline" size="sm" class="w-full justify-start text-xs h-8" onclick={handleImportImage} disabled={!store.isDocumentLoaded}>
        <ImagePlus class="h-3.5 w-3.5 mr-2 text-primary" /> Import PNG / JPG Image...
      </Button>

      <Button variant="outline" size="sm" class="w-full justify-start text-xs h-8" onclick={() => triggerTool('Add Stamp to PDF')} disabled={!store.isDocumentLoaded}>
        <Stamp class="h-3.5 w-3.5 mr-2 text-amber-500" /> Add Stamp to PDF
      </Button>
    </div>
  </SidebarSection>

  <!-- Section 4: Shapes & Vectors -->
  <SidebarSection title="Shapes & Vectors" borderBottom={true}>
    <div class="flex flex-col gap-2">
      <Button variant="outline" size="sm" class="w-full justify-start text-xs h-8" onclick={() => placeAtCenter('shape', { variant: 'rectangle' })} draggable="true" ondragstart={(e) => handleDragStart(e, { kind: 'shape', variant: 'rectangle' })} disabled={!store.isDocumentLoaded}>
        <Square class="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Rectangle
      </Button>
      <Button variant="outline" size="sm" class="w-full justify-start text-xs h-8" onclick={() => placeAtCenter('shape', { variant: 'circle' })} draggable="true" ondragstart={(e) => handleDragStart(e, { kind: 'shape', variant: 'circle' })} disabled={!store.isDocumentLoaded}>
        <Circle class="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Circle
      </Button>
      <Button variant="outline" size="sm" class="w-full justify-start text-xs h-8" onclick={() => placeAtCenter('shape', { variant: 'line' })} draggable="true" ondragstart={(e) => handleDragStart(e, { kind: 'shape', variant: 'line' })} disabled={!store.isDocumentLoaded}>
        <Minus class="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Line
      </Button>
      <Button variant="outline" size="sm" class="w-full justify-start text-xs h-8" onclick={() => placeAtCenter('shape', { variant: 'arrow' })} draggable="true" ondragstart={(e) => handleDragStart(e, { kind: 'shape', variant: 'arrow' })} disabled={!store.isDocumentLoaded}>
        <ArrowRight class="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Arrow
      </Button>
    </div>
  </SidebarSection>

  <!-- Section 5: Watermarks & Overlays -->
  <SidebarSection title="Watermarks & Overlays" borderBottom={false}>
    <div class="flex flex-col gap-2">
      <Button variant="outline" size="sm" class="w-full justify-start text-xs h-8" onclick={() => triggerTool('Add Watermark')} disabled={!store.isDocumentLoaded}>
        <Type class="h-3.5 w-3.5 mr-2 text-primary" /> Add Watermark
      </Button>
      <Button variant="outline" size="sm" class="w-full justify-start text-xs h-8" onclick={() => triggerTool('Overlay PDFs')} disabled={!store.isDocumentLoaded}>
        <Layers class="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Overlay PDFs
      </Button>
    </div>
  </SidebarSection>

  <!-- Section 6: Apply to PDF -->
  <div class="p-3 mt-auto">
    <Button 
      variant="default" 
      size="sm" 
      class="w-full text-xs shadow-sm" 
      onclick={handleApplyComponents} 
      disabled={!store.isDocumentLoaded || (canvasStore.elements.length === 0 && !hasPageTransforms)}
    >
      <Layers class="h-4 w-4 mr-2" />
      Apply Components to PDF
    </Button>
    <p class="text-[10px] text-muted-foreground text-center mt-2 px-1">
      Burns added components and page transforms into the PDF document natively.
    </p>
  </div>
</div>
