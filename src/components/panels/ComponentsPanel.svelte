<script lang="ts">
  import { onDestroy } from 'svelte';
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
    RectangleHorizontal,
    Video,
    Volume2,
    Box,
    QrCode,
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

  function handleEmbedVideo(): void {
    actions.triggerVideoImport();
  }

  function handleEmbedAudio(): void {
    actions.triggerAudioImport();
  }

  function handleEmbed3D(): void {
    actions.trigger3DImport();
  }

  function handleAttachFile(): void {
    actions.triggerAttachmentImport();
  }

  function handleAddQrBarcode(): void {
    actions.openQrBarcodeModal();
  }

  function triggerTool(toolName: string): void {
    store.activeMockupTool = toolName;
  }

  let activeDragBadge: HTMLDivElement | null = null;
  let activeDragOverHandler: ((e: DragEvent) => void) | null = null;
  let transparentDragImage: HTMLImageElement | null = null;

  function getTransparentDragImage(): HTMLImageElement | null {
    if (!transparentDragImage && typeof document !== 'undefined') {
      transparentDragImage = new Image();
      transparentDragImage.src =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    }
    return transparentDragImage;
  }

  function cleanupDragBadge(): void {
    if (activeDragBadge) {
      if (activeDragBadge.parentNode) {
        activeDragBadge.parentNode.removeChild(activeDragBadge);
      }
      activeDragBadge = null;
    }
    if (activeDragOverHandler && typeof window !== 'undefined') {
      window.removeEventListener('dragover', activeDragOverHandler);
      activeDragOverHandler = null;
    }
  }

  $effect(() => {
    // Hide draggable badge when preview component is active on the page
    if (activeDragBadge) {
      if (canvasStore.dropPreview) {
        activeDragBadge.style.display = 'none';
      } else {
        activeDragBadge.style.display = 'flex';
      }
    }
  });

  onDestroy(() => {
    cleanupDragBadge();
  });

  function handleDragStart(e: DragEvent, payload: ElementDropPayload): void {
    if (!e.dataTransfer) return;

    canvasStore.activeDropPayload = payload;
    e.dataTransfer.setData('application/x-canvas-element', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.dropEffect = 'copy';

    // Suppress browser default drag snapshot using transparent image
    if (typeof document !== 'undefined' && e.dataTransfer.setDragImage) {
      const transparentImg = getTransparentDragImage();
      if (transparentImg) {
        try {
          e.dataTransfer.setDragImage(transparentImg, 0, 0);
        } catch {
          // Ignore environments that do not support custom drag images
        }
      }
    }

    // Create floating drag badge following cursor outside the page
    if (typeof document !== 'undefined' && document.body) {
      cleanupDragBadge();

      const label = payload.label || payload.text || payload.kind;
      activeDragBadge = document.createElement('div');
      activeDragBadge.className =
        'fixed pointer-events-none z-[99999] px-2.5 py-1 rounded-md bg-background border border-primary/40 text-xs font-medium text-foreground flex items-center gap-1.5 transition-none select-none';
      activeDragBadge.innerText = label;
      activeDragBadge.style.left = `${e.clientX + 14}px`;
      activeDragBadge.style.top = `${e.clientY + 14}px`;
      document.body.appendChild(activeDragBadge);

      activeDragOverHandler = (dragEvent: DragEvent) => {
        if (!activeDragBadge) return;
        activeDragBadge.style.left = `${dragEvent.clientX + 14}px`;
        activeDragBadge.style.top = `${dragEvent.clientY + 14}px`;
        if (canvasStore.dropPreview) {
          activeDragBadge.style.display = 'none';
        } else {
          activeDragBadge.style.display = 'flex';
        }
      };

      window.addEventListener('dragover', activeDragOverHandler, { passive: true });
      window.addEventListener('dragend', cleanupDragBadge, { once: true });
      window.addEventListener('drop', cleanupDragBadge, { once: true });
    }
  }

  function handleDragEnd(): void {
    cleanupDragBadge();
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
      placeholder?: string;
      value?: string;
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

<div class="panel-root">
  {#if featureFlags.isEnabled('components')}
  <!-- Text and content elements -->
  <SidebarSection title="Text & Content" borderBottom={true}>
    <div class="panel-action-stack-sm">
      {#if featureFlags.isEnabled('components.text')}
      <Button
        variant="panel"
        class="w-full"
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
        variant="panel"
        class="w-full"
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
        variant="panel"
        class="w-full"
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

    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('forms')}
  <!-- Interactive form fields -->
  <SidebarSection title="Interactive Form Fields" borderBottom={true}>
    <div class="panel-action-stack-sm">
      {#if featureFlags.isEnabled('components.forms.text-input')}
      <Button
        variant="panel"
        class="w-full"
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
        variant="panel"
        class="w-full"
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
        variant="panel"
        class="w-full"
        onclick={() =>
          placeAtCenter('form-field', {
            variant: 'radio',
            width: 140,
            height: 28,
            label: 'Option 1',
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'form-field',
            variant: 'radio',
            width: 140,
            height: 28,
            label: 'Option 1',
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
        variant="panel"
        class="w-full"
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
        variant="panel"
        class="w-full"
        onclick={() =>
          placeAtCenter('form-field', {
            variant: 'signature',
            width: 160,
            height: 36,
            label: 'Signature',
            placeholder: 'Sign here',
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'form-field',
            variant: 'signature',
            width: 160,
            height: 36,
            label: 'Signature',
            placeholder: 'Sign here',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <PenTool class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Sign Field</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.forms.button')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() =>
          placeAtCenter('form-field', {
            variant: 'button',
            width: 120,
            height: 30,
            label: 'Button',
          })}
        draggable={store.isDocumentLoaded}
        ondragstart={(e) =>
          handleDragStart(e, {
            kind: 'form-field',
            variant: 'button',
            width: 120,
            height: 30,
            label: 'Button',
          })}
        ondragend={handleDragEnd}
        disabled={!store.isDocumentLoaded}
      >
        <RectangleHorizontal class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Pushbutton</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.forms.attachment')}
      <Button
        variant="panel"
        class="w-full"
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

  {#if featureFlags.isEnabled('components.shapes')}
  <!-- Shapes and vectors -->
  <SidebarSection title="Shapes & Vectors" borderBottom={true}>
    <div class="panel-action-stack-sm">
      {#if featureFlags.isEnabled('components.shapes.rectangle')}
      <Button
        variant="panel"
        class="w-full"
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
        variant="panel"
        class="w-full"
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
        variant="panel"
        class="w-full"
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
        variant="panel"
        class="w-full"
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

  {#if featureFlags.isEnabled('components.media')}
  <!-- Images and media -->
  <SidebarSection title="Images & Media" borderBottom={true}>
    <div class="panel-action-stack-sm">
      {#if featureFlags.isEnabled('components.media.image-import')}
      <Button
        variant="panel"
        class="w-full"
        onclick={handleImportImage}
        disabled={!store.isDocumentLoaded}
      >
        <ImagePlus class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Import Image</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.media.image-placeholder')}
      <Button
        variant="panel"
        class="w-full"
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

      {#if featureFlags.isEnabled('components.media.video')}
      <Button
        variant="panel"
        class="w-full"
        onclick={handleEmbedVideo}
        disabled={!store.isDocumentLoaded}
      >
        <Video class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Embed Video</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.media.audio')}
      <Button
        variant="panel"
        class="w-full"
        onclick={handleEmbedAudio}
        disabled={!store.isDocumentLoaded}
      >
        <Volume2 class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Embed Audio</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.media.3d')}
      <Button
        variant="panel"
        class="w-full"
        onclick={handleEmbed3D}
        disabled={!store.isDocumentLoaded}
      >
        <Box class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Embed 3D</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.media.attachment')}
      <Button
        variant="panel"
        class="w-full"
        onclick={handleAttachFile}
        disabled={!store.isDocumentLoaded}
      >
        <Paperclip class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Attach File</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.media.barcode')}
      <Button
        variant="panel"
        class="w-full"
        onclick={handleAddQrBarcode}
        disabled={!store.isDocumentLoaded}
      >
        <QrCode class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Add QR Code or Barcode</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.media.stamp')}
      <Button
        variant="panel"
        class="w-full"
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

  {#if featureFlags.isEnabled('components.watermark')}
  <!-- Watermarks and overlays -->
  <SidebarSection title="Watermarks & Overlays" borderBottom={false}>
    <div class="panel-action-stack-sm">
      {#if featureFlags.isEnabled('components.watermark.add')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => triggerTool('Add Watermark')}
        disabled={!store.isDocumentLoaded}
      >
        <Type class="h-3.5 w-3.5 mr-2 text-primary shrink-0" />
        <span class="truncate">Add Watermark</span>
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.watermark.overlay')}
      <Button
        variant="panel"
        class="w-full"
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
  <!-- Apply components to document -->
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
