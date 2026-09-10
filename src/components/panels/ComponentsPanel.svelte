<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import type {
    CanvasElementKind,
    ShapeVariant,
    FormFieldVariant,
    ElementDropPayload,
  } from '../../stores/canvas-types';
  import SidebarSection from '../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import {
    Type,
    ImagePlus,
    Image as ImageIcon,
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
    Paperclip,
    StickyNote,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const canvasActions = useCanvasActions();
  const canvasStore = useCanvasStore();
  const featureFlags = useFeatureFlagStore();

  const hasPageTransforms = $derived(
    Object.values(store.pageTransforms).some(
      (t) => t && (t.rotation !== 0 || t.scaleX !== 1 || t.scaleY !== 1)
    )
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
    if (!e.dataTransfer) return;

    canvasStore.activeDropPayload = payload;
    e.dataTransfer.setData('application/x-canvas-element', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.dropEffect = 'copy';

    // Create a compact custom drag image badge
    const label = payload.label || payload.text || payload.kind;
    const ghost = document.createElement('div');
    ghost.className =
      'fixed -top-96 -left-96 pointer-events-none z-[99999] px-2.5 py-1 rounded-md bg-background border border-primary/40 text-xs font-medium text-foreground flex items-center gap-1.5';
    ghost.innerText = label;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 20, 14);

    setTimeout(() => {
      if (ghost.parentNode) {
        ghost.parentNode.removeChild(ghost);
      }
    }, 0);
  }

  function handleDragEnd(): void {
    canvasStore.clearDropState();
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
      author?: string;
      color?: string;
      src?: string;
    }
  ): void {
    let centerX = 200;
    let centerY = 300;
    try {
      const dims = actions.service.document?.getPage(store.currentPageIndex)?.getDimensions();
      if (dims) {
        const w = options?.width ?? 150;
        const h = options?.height ?? 30;
        centerX = Math.max(0, (dims.widthPts - w) / 2);
        centerY = Math.max(0, (dims.heightPts - h) / 2);
      }
    } catch {
      // Fallback coordinates
    }
    canvasActions.createElement(kind, store.currentPageIndex, centerX, centerY, options);
  }
</script>

<div class="flex flex-col min-h-0 divide-y divide-border">
  {#if featureFlags.isEnabled('components')}
  <!-- Section 1: Text and Content -->
  <SidebarSection title="Text & Content" borderBottom={true}>
    <div class="flex flex-col gap-1.5">
      <p class="text-[11px] text-muted-foreground px-0.5 mb-1">
        Click to place at center or drag directly onto any page.
      </p>

      {#if featureFlags.isEnabled('components.text')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('text', { text: 'Type here', fontSize: 14, width: 150, height: 30 })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'text',
            text: 'Type here',
            fontSize: 14,
            width: 150,
            height: 30,
            label: 'Text Box',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <Type class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Add Text Box</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.heading')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('text', {
            text: 'Heading',
            fontSize: 22,
            fontWeight: 'bold',
            width: 200,
            height: 36,
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'text',
            text: 'Heading',
            fontSize: 22,
            fontWeight: 'bold',
            width: 200,
            height: 36,
            label: 'Heading',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <Heading class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Heading</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.body-text')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('text', {
            text: 'Body text paragraph',
            fontSize: 12,
            width: 180,
            height: 28,
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'text',
            text: 'Body text paragraph',
            fontSize: 12,
            width: 180,
            height: 28,
            label: 'Body Text',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <FileText class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Body Text</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.note')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('note', {
            text: '',
            width: 140,
            height: 100,
            color: '#FFEB3B',
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'note',
            text: '',
            width: 140,
            height: 100,
            color: '#FFEB3B',
            label: 'Sticky Note',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <StickyNote class="h-3.5 w-3.5 mr-2 text-warning shrink-0" />
        <span class="truncate">Sticky Note</span>
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('forms')}
  <!-- Section 2: Interactive Form Fields -->
  <SidebarSection title="Interactive Form Fields" borderBottom={true}>
    <div class="flex flex-col gap-1.5">
      {#if featureFlags.isEnabled('components.forms.text-input')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('form-field', {
            variant: 'text-input',
            width: 160,
            height: 28,
            label: 'Text Input',
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'form-field',
            variant: 'text-input',
            width: 160,
            height: 28,
            label: 'Text Input',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <FormInput class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Text Input</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.forms.checkbox')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('form-field', {
            variant: 'checkbox',
            width: 140,
            height: 28,
            label: 'Checkbox',
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'form-field',
            variant: 'checkbox',
            width: 140,
            height: 28,
            label: 'Checkbox',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <CheckSquare class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Checkbox</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.forms.radio')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('form-field', {
            variant: 'radio',
            width: 140,
            height: 28,
            label: 'Radio Button',
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'form-field',
            variant: 'radio',
            width: 140,
            height: 28,
            label: 'Radio Button',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <CircleDot class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Radio Button</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.forms.dropdown')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('form-field', {
            variant: 'dropdown',
            width: 160,
            height: 28,
            label: 'Dropdown',
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'form-field',
            variant: 'dropdown',
            width: 160,
            height: 28,
            label: 'Dropdown',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <ListFilter class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Dropdown</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.forms.signature')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('form-field', {
            variant: 'signature',
            width: 160,
            height: 36,
            label: 'Sign Field',
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'form-field',
            variant: 'signature',
            width: 160,
            height: 36,
            label: 'Sign Field',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <PenTool class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Sign Field</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.forms.attachment')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('form-field', {
            variant: 'attachment',
            width: 160,
            height: 36,
            label: 'Attachment',
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'form-field',
            variant: 'attachment',
            width: 160,
            height: 36,
            label: 'Attachment',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <Paperclip class="h-3.5 w-3.5 mr-2 text-muted-foreground shrink-0" />
        <span class="truncate">Attachment</span>
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('components.media')}
  <!-- Section 3: Images and Media -->
  <SidebarSection title="Images & Media" borderBottom={true}>
    <div class="flex flex-col gap-1.5">
      {#if featureFlags.isEnabled('components.media.image-import')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={handleImportImage}
        disabled={!store.isDocumentLoaded}
      >
        <ImagePlus class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Import PNG / JPG Image...</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.media.image-placeholder')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('image', {
            src: '',
            width: 200,
            height: 150,
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'image',
            src: '',
            width: 200,
            height: 150,
            label: 'Image Element',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <ImageIcon class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Image Placeholder</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.media.stamp')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Add Stamp to PDF')}
        disabled={!store.isDocumentLoaded}
      >
        <Stamp class="h-3.5 w-3.5 mr-2 text-warning shrink-0" />
        <span class="truncate">Add Stamp to PDF</span>
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('components.shapes')}
  <!-- Section 4: Shapes and Vectors -->
  <SidebarSection title="Shapes & Vectors" borderBottom={true}>
    <div class="flex flex-col gap-1.5">
      {#if featureFlags.isEnabled('components.shapes.rectangle')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('shape', {
            variant: 'rectangle',
            width: 100,
            height: 100,
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'shape',
            variant: 'rectangle',
            width: 100,
            height: 100,
            label: 'Rectangle',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <Square class="h-3.5 w-3.5 mr-2 text-muted-foreground shrink-0" />
        <span class="truncate">Rectangle</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.shapes.circle')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('shape', {
            variant: 'circle',
            width: 100,
            height: 100,
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'shape',
            variant: 'circle',
            width: 100,
            height: 100,
            label: 'Circle',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <Circle class="h-3.5 w-3.5 mr-2 text-muted-foreground shrink-0" />
        <span class="truncate">Circle</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.shapes.line')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('shape', {
            variant: 'line',
            width: 120,
            height: 20,
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'shape',
            variant: 'line',
            width: 120,
            height: 20,
            label: 'Line',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <Minus class="h-3.5 w-3.5 mr-2 text-muted-foreground shrink-0" />
        <span class="truncate">Line</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.shapes.arrow')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 cursor-grab active:cursor-grabbing"
        onclick={() =>
          placeAtCenter('shape', {
            variant: 'arrow',
            width: 120,
            height: 24,
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'shape',
            variant: 'arrow',
            width: 120,
            height: 24,
            label: 'Arrow',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <ArrowRight class="h-3.5 w-3.5 mr-2 text-muted-foreground shrink-0" />
        <span class="truncate">Arrow</span>
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('components.watermark')}
  <!-- Section 5: Watermarks and Overlays -->
  <SidebarSection title="Watermarks & Overlays" borderBottom={false}>
    <div class="flex flex-col gap-1.5">
      {#if featureFlags.isEnabled('components.watermark.add')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Add Watermark')}
        disabled={!store.isDocumentLoaded}
      >
        <Type class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Add Watermark</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.watermark.overlay')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Overlay PDFs')}
        disabled={!store.isDocumentLoaded}
      >
        <Layers class="h-3.5 w-3.5 mr-2 text-muted-foreground shrink-0" />
        <span class="truncate">Overlay PDFs</span>
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('components.apply')}
  <!-- Section 6: Apply to PDF -->
  <div class="p-3 mt-auto">
    <Button
      variant="default"
      size="sm"
      class="w-full text-xs shadow-xs"
      onclick={handleApplyComponents}
      disabled={!store.isDocumentLoaded ||
        (canvasStore.elements.length === 0 && !hasPageTransforms)}
    >
      <Layers class="h-4 w-4 mr-2" />
      Apply Components to PDF
    </Button>
    <p class="text-[10px] text-muted-foreground text-center mt-2 px-1">
      Burns added components and page transforms into the PDF document natively.
    </p>
  </div>
  {/if}
</div>
