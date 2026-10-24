<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { ControlRow } from '$lib/components/ui/control-row/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
  import {
    SIGNATURE_PLACEMENT_PRESETS,
    type SignaturePlacementPreset,
  } from '../../utils/signature-placement';
  import {
    getSavedSignatures,
    saveSignature,
    deleteSignature,
    setDefaultSignature,
    renderDrawnStrokesToDataUrl,
    renderTypedSignatureToDataUrl,
    processUploadedSignatureImage,
    composeSignatureAppearanceDataUrl,
    preloadSignatureFonts,
    type SavedSignature,
    type DrawPoint,
  } from '../../services/signature-storage';
  import {
    PenTool,
    Type,
    Upload,
    Trash2,
    Star,
    Eraser,
    Undo2,
    Plus,
    Sparkles,
    SlidersHorizontal,
    Loader2,
    ShieldCheck,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const canvasStore = useCanvasStore();

  let activeTab = $state<'signatures' | 'draw' | 'type' | 'upload'>('signatures');
  let savedSignatures = $state<SavedSignature[]>([]);
  let saveToCollection = $state(true);
  let signatureTitle = $state('My Signature');
  let isPlacing = $state(false);
  let placementPreset = $state<Exclude<SignaturePlacementPreset, 'custom'>>('bottom-right');
  let showFullNameUnderneath = $state(false);
  let signerFullName = $state('John Doe');

  // Drawing State
  let drawCanvasEl: HTMLCanvasElement | null = $state(null);
  let isDrawing = $state(false);
  let strokes = $state<DrawPoint[][]>([]);
  let penColor = $state('#000000');
  let strokeWidth = $state(2.5);

  // High-frequency non-reactive drawing state
  let activeStrokePoints: DrawPoint[] = [];
  let cachedCanvasRect: DOMRect | null = null;
  let rafPending = false;
  let activePointerId: number | null = null;

  const inkColorPresets = [
    { label: 'Black', color: '#000000' },
    { label: 'Dark Navy', color: '#1e3a8a' },
    { label: 'Royal Blue', color: '#2563eb' },
    { label: 'Dark Grey', color: '#374151' },
  ];

  // Type State
  let typedName = $state('John Doe');
  let typedColor = $state('#000000');
  let selectedFont = $state('Caveat');
  const availableFonts = [
    { name: 'Caveat', label: 'Casual Script' },
    { name: 'Dancing Script', label: 'Flowing Script' },
    { name: 'Pacifico', label: 'Bold Cursive' },
    { name: 'Alex Brush', label: 'Elegant Calligraphy' },
    { name: 'Great Vibes', label: 'Classic Formal' },
    { name: 'Allura', label: 'Slender Flourish' },
  ];

  // Upload State
  let uploadedDataUrl = $state<string | null>(null);
  let cleanedUploadDataUrl = $state<string | null>(null);
  let uploadAspectRatio = $state(3);
  let threshold = $state(220);
  let uploadColor = $state<string | undefined>(undefined);
  let isCleaning = $state(false);
  let fileInputRef: HTMLInputElement | null = $state(null);

  function refreshSavedList(): void {
    untrack(() => {
      savedSignatures = getSavedSignatures();
      if (savedSignatures.length === 0 && activeTab === 'signatures') {
        activeTab = 'draw';
      }
    });
  }

  function setupCanvasDimensions(explicitWidth?: number, explicitHeight?: number): void {
    if (!drawCanvasEl) return;

    let clientW = explicitWidth;
    let clientH = explicitHeight;

    if (clientW === undefined || clientH === undefined) {
      const rect = drawCanvasEl.getBoundingClientRect();
      clientW = rect.width;
      clientH = rect.height;
      cachedCanvasRect = rect;
    }

    if (clientW === 0 || clientH === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(clientW * dpr);
    const targetHeight = Math.round(clientH * dpr);

    if (
      Math.abs(drawCanvasEl.width - targetWidth) > 1 ||
      Math.abs(drawCanvasEl.height - targetHeight) > 1
    ) {
      drawCanvasEl.width = targetWidth;
      drawCanvasEl.height = targetHeight;
    }

    cachedCanvasRect = drawCanvasEl.getBoundingClientRect();
    redrawCanvas();
  }

  $effect(() => {
    return () => {
      cleanupPointerListeners();
      rafPending = false;
    };
  });

  $effect(() => {
    const canvas = drawCanvasEl;
    if (!canvas) {
      return undefined;
    }

    untrack(() => {
      setupCanvasDimensions();
    });

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const entry = entries[0];
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      if (width === 0 || height === 0) return;
      setupCanvasDimensions(width, height);
    });

    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  });

  $effect(() => {
    if (store.showEsignDialog) {
      untrack(() => {
        preloadSignatureFonts();
        refreshSavedList();
        if (store.esignInitialTab) {
          activeTab = store.esignInitialTab;
        }
        if (activeTab === 'draw') {
          requestAnimationFrame(() => setupCanvasDimensions());
        }
      });
    }
  });

  // Canvas Draw Logic
  function redrawCanvas(): void {
    if (!drawCanvasEl) return;
    const ctx = drawCanvasEl.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = cachedCanvasRect || drawCanvasEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = penColor;
    ctx.lineWidth = strokeWidth;

    const all = activeStrokePoints.length > 0 ? [...strokes, activeStrokePoints] : strokes;
    for (let s = 0; s < all.length; s++) {
      const stroke = all[s];
      if (stroke.length === 0) continue;
      if (stroke.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke[0].x, stroke[0].y, strokeWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = penColor;
        ctx.fill();
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length - 1; i++) {
        const xc = (stroke[i].x + stroke[i + 1].x) / 2;
        const yc = (stroke[i].y + stroke[i + 1].y) / 2;
        ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, xc, yc);
      }
      const last = stroke[stroke.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
  }

  function handleWindowPointerUp(e: PointerEvent): void {
    if (isDrawing) {
      handlePointerUp(e);
    }
  }

  function cleanupPointerListeners(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    }
    if (drawCanvasEl && activePointerId !== null) {
      try {
        if (drawCanvasEl.hasPointerCapture(activePointerId)) {
          drawCanvasEl.releasePointerCapture(activePointerId);
        }
      } catch {
        // Ignore release errors
      }
      activePointerId = null;
    }
  }

  function handlePointerDown(e: PointerEvent): void {
    if (!drawCanvasEl) return;
    try {
      drawCanvasEl.setPointerCapture(e.pointerId);
      activePointerId = e.pointerId;
    } catch {
      // Ignore capture errors
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', handleWindowPointerUp, { once: true });
      window.addEventListener('pointercancel', handleWindowPointerUp, { once: true });
    }

    cachedCanvasRect = drawCanvasEl.getBoundingClientRect();
    isDrawing = true;

    const x = e.clientX - cachedCanvasRect.left;
    const y = e.clientY - cachedCanvasRect.top;
    activeStrokePoints = [{ x, y, pressure: e.pressure }];
    redrawCanvas();
  }

  function handlePointerMove(e: PointerEvent): void {
    if (!isDrawing || !drawCanvasEl || !cachedCanvasRect) return;
    const x = e.clientX - cachedCanvasRect.left;
    const y = e.clientY - cachedCanvasRect.top;
    activeStrokePoints.push({ x, y, pressure: e.pressure });

    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (isDrawing) {
          redrawCanvas();
        }
      });
    }
  }

  function handlePointerUp(_e: PointerEvent): void {
    if (!isDrawing) return;
    isDrawing = false;
    rafPending = false;

    cleanupPointerListeners();

    if (activeStrokePoints.length > 0) {
      strokes = [...strokes, [...activeStrokePoints]];
      activeStrokePoints = [];
    }
    redrawCanvas();
  }

  function clearDraw(): void {
    strokes = [];
    activeStrokePoints = [];
    redrawCanvas();
  }

  function undoDraw(): void {
    if (strokes.length > 0) {
      strokes = strokes.slice(0, -1);
      redrawCanvas();
    }
  }

  async function placeWithOptionalFullName(sig: SavedSignature): Promise<void> {
    let targetSig = sig;
    if (showFullNameUnderneath) {
      const resolvedName = (
        signerFullName.trim() ||
        sig.text ||
        typedName.trim() ||
        sig.title ||
        'Authorized Signer'
      ).trim();
      const composed = await composeSignatureAppearanceDataUrl({
        graphicDataUrl: sig.dataUrl,
        signerName: resolvedName,
        showTextDetails: true,
        color: sig.color,
        fontFamily: sig.fontFamily,
      });
      if (composed.isComposite && composed.dataUrl) {
        targetSig = {
          ...sig,
          dataUrl: composed.dataUrl,
          aspectRatio: composed.aspectRatio,
        };
      }
    }
    actions.placeSignatureOnCanvas(
      targetSig,
      store.currentPageIndex,
      canvasStore,
      placementPreset
    );
  }

  // Place Actions
  async function handleUseSaved(sig: SavedSignature): Promise<void> {
    try {
      await placeWithOptionalFullName(sig);
    } catch (err) {
      console.error('Failed to place saved signature:', err);
    } finally {
      handleClose();
    }
  }

  function handleDeleteSaved(id: string, e: MouseEvent): void {
    e.stopPropagation();
    deleteSignature(id);
    refreshSavedList();
  }

  function handleSetDefault(id: string, e: MouseEvent): void {
    e.stopPropagation();
    setDefaultSignature(id);
    refreshSavedList();
  }

  async function handleApplyDrawn(): Promise<void> {
    if (strokes.length === 0 || isPlacing) return;
    isPlacing = true;

    try {
      const rect =
        cachedCanvasRect ||
        (drawCanvasEl ? drawCanvasEl.getBoundingClientRect() : { width: 600, height: 250 });
      const { dataUrl, aspectRatio } = renderDrawnStrokesToDataUrl(
        strokes,
        strokeWidth,
        penColor,
        rect.width,
        rect.height
      );

      let sigRecord: SavedSignature;
      if (saveToCollection) {
        sigRecord = saveSignature({
          title: signatureTitle.trim() || 'Drawn Signature',
          type: 'draw',
          dataUrl,
          color: penColor,
          isDefault: savedSignatures.length === 0,
          aspectRatio,
        });
        refreshSavedList();
      } else {
        sigRecord = {
          id: `temp_${Date.now()}`,
          title: signatureTitle.trim() || 'Drawn Signature',
          type: 'draw',
          dataUrl,
          color: penColor,
          createdAt: Date.now(),
          isDefault: false,
          aspectRatio,
        };
      }

      await placeWithOptionalFullName(sigRecord);
    } catch (err) {
      console.error('Failed to apply drawn signature:', err);
    } finally {
      isPlacing = false;
      handleClose();
    }
  }

  async function handleApplyTyped(): Promise<void> {
    if (!typedName.trim() || isPlacing) return;
    isPlacing = true;

    try {
      const { dataUrl, aspectRatio } = await renderTypedSignatureToDataUrl(
        typedName.trim(),
        selectedFont,
        typedColor
      );

      let sigRecord: SavedSignature;
      if (saveToCollection) {
        sigRecord = saveSignature({
          title: `${typedName.trim()} (${selectedFont})`,
          type: 'type',
          dataUrl,
          fontFamily: selectedFont,
          text: typedName.trim(),
          color: typedColor,
          isDefault: savedSignatures.length === 0,
          aspectRatio,
        });
        refreshSavedList();
      } else {
        sigRecord = {
          id: `temp_${Date.now()}`,
          title: `${typedName.trim()} (${selectedFont})`,
          type: 'type',
          dataUrl,
          fontFamily: selectedFont,
          text: typedName.trim(),
          color: typedColor,
          createdAt: Date.now(),
          isDefault: false,
          aspectRatio,
        };
      }

      await placeWithOptionalFullName(sigRecord);
    } catch (err) {
      console.error('Failed to apply typed signature:', err);
    } finally {
      isPlacing = false;
      handleClose();
    }
  }

  async function handleApplyUpload(): Promise<void> {
    const finalDataUrl = cleanedUploadDataUrl || uploadedDataUrl;
    if (!finalDataUrl || isPlacing) return;
    isPlacing = true;

    try {
      let sigRecord: SavedSignature;
      if (saveToCollection) {
        sigRecord = saveSignature({
          title: signatureTitle.trim() || 'Uploaded Signature',
          type: 'upload',
          dataUrl: finalDataUrl,
          color: uploadColor || '#000000',
          isDefault: savedSignatures.length === 0,
          aspectRatio: uploadAspectRatio,
        });
        refreshSavedList();
      } else {
        sigRecord = {
          id: `temp_${Date.now()}`,
          title: signatureTitle.trim() || 'Uploaded Signature',
          type: 'upload',
          dataUrl: finalDataUrl,
          color: uploadColor || '#000000',
          createdAt: Date.now(),
          isDefault: false,
          aspectRatio: uploadAspectRatio,
        };
      }

      await placeWithOptionalFullName(sigRecord);
    } catch (err) {
      console.error('Failed to apply uploaded signature:', err);
    } finally {
      isPlacing = false;
      handleClose();
    }
  }

  async function handleImageFile(file: File): Promise<void> {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const rawUrl = e.target?.result as string;
      uploadedDataUrl = rawUrl;
      await processUpload(rawUrl);
    };
    reader.readAsDataURL(file);
  }

  async function processUpload(srcUrl: string): Promise<void> {
    if (!srcUrl) return;
    isCleaning = true;
    try {
      const result = await processUploadedSignatureImage(srcUrl, threshold, uploadColor);
      cleanedUploadDataUrl = result.dataUrl;
      uploadAspectRatio = result.aspectRatio;
    } catch (err) {
      console.warn('Failed to process signature image transparency:', err);
      cleanedUploadDataUrl = srcUrl;
    } finally {
      isCleaning = false;
    }
  }

  function handleClose(): void {
    isDrawing = false;
    rafPending = false;
    activeStrokePoints = [];
    cleanupPointerListeners();
    store.showEsignDialog = false;
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      handleClose();
    }
  }
</script>

<Dialog.Root open={store.showEsignDialog} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[600px] max-h-[90vh] flex flex-col overflow-hidden font-sans">
    <Dialog.Header class="pr-12">
      <div class="flex items-center justify-between gap-2">
        <Dialog.Title>
          <PenTool class="h-4 w-4 text-muted-foreground shrink-0" />
          Add Electronic Signature (E-Sign)
        </Dialog.Title>
        {#if savedSignatures.length > 0}
          <Badge variant="secondary" class="text-[10px] h-5 px-2 shrink-0">
            {savedSignatures.length} saved
          </Badge>
        {/if}
      </div>
      <Dialog.Description>
        Create, customise, and place persistent electronic signatures directly on your PDF pages.
      </Dialog.Description>
    </Dialog.Header>

    <div class="dialog-body">
      <Tabs.Root
        value={activeTab}
        onValueChange={(val) => {
          activeTab = val as typeof activeTab;
          if (val === 'draw') requestAnimationFrame(() => setupCanvasDimensions());
        }}
      >
        <Tabs.List class="grid w-full grid-cols-4 h-8">
          <Tabs.Trigger value="signatures" class="text-xs gap-1.5">
            My Signatures
          </Tabs.Trigger>
          <Tabs.Trigger value="draw" class="text-xs gap-1.5">
            <PenTool class="h-3.5 w-3.5" /> Draw
          </Tabs.Trigger>
          <Tabs.Trigger value="type" class="text-xs gap-1.5">
            <Type class="h-3.5 w-3.5" /> Type
          </Tabs.Trigger>
          <Tabs.Trigger value="upload" class="text-xs gap-1.5">
            <Upload class="h-3.5 w-3.5" /> Upload
          </Tabs.Trigger>
        </Tabs.List>

        <!-- note: saved signatures list -->
        <Tabs.Content value="signatures" class="flex flex-col gap-3 mt-3 outline-none">
          {#if savedSignatures.length === 0}
            <div class="border border-dashed border-border rounded-[var(--radius-card)] bg-card p-8 text-center flex flex-col items-center justify-center gap-2">
              <PenTool class="h-8 w-8 text-muted-foreground stroke-1" />
              <p class="text-xs text-muted-foreground">You have no saved signatures yet.</p>
              <Button size="sm" variant="outline" class="mt-2 h-8 text-xs" onclick={() => (activeTab = 'draw')}>
                <Plus class="h-3.5 w-3.5 mr-1.5" /> Create New Signature
              </Button>
            </div>
          {:else}
            <div class="grid grid-cols-2 gap-2.5 max-h-[300px] overflow-y-auto pr-1">
              {#each savedSignatures as sig (sig.id)}
                <div
                  class="group relative dialog-card justify-between hover:border-ring transition-[border-color,background-color]"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-medium text-foreground truncate max-w-[140px]" title={sig.title}>{sig.title}</span>
                    <div class="flex items-center gap-1">
                      {#if sig.isDefault}
                        <Badge variant="secondary" class="text-[10px] px-1.5 py-0 h-4">
                          Default
                        </Badge>
                      {:else}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-warning transition-opacity"
                          title="Set as default"
                          aria-label="Set as default signature"
                          onclick={(e) => handleSetDefault(sig.id, e)}
                        >
                          <Star class="h-3.5 w-3.5" />
                        </Button>
                      {/if}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                        title="Delete signature"
                        aria-label="Delete signature"
                        onclick={(e) => handleDeleteSaved(sig.id, e)}
                      >
                        <Trash2 class="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label={`Use saved signature ${sig.title}`}
                    class="h-20 w-full bg-background/60 bg-transparency-grid rounded-[var(--radius-card-inner)] border border-border/60 flex items-center justify-center p-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onclick={() => handleUseSaved(sig)}
                  >
                    <img src={sig.dataUrl} alt={sig.title} class="max-h-full max-w-full object-contain img-subtle-outline" />
                  </button>

                  <div class="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span class="capitalize">{sig.type}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      class="h-8 text-xs px-2.5"
                      onclick={(e) => {
                        e.stopPropagation();
                        void handleUseSaved(sig);
                      }}
                    >
                      Use on PDF
                    </Button>
                  </div>
                </div>
              {/each}
            </div>

            <div class="pt-1 flex justify-end">
              <Button size="sm" variant="outline" class="h-8 text-xs" onclick={() => (activeTab = 'draw')}>
                <Plus class="h-3.5 w-3.5 mr-1.5" /> Create Another Signature
              </Button>
            </div>
          {/if}
        </Tabs.Content>

        <!-- note: draw signature canvas -->
        <Tabs.Content value="draw" class="flex flex-col gap-3 mt-3 outline-none">
          <div class="dialog-card">
            <div class="flex items-center justify-between">
              <Label class="field-label">Draw your signature</Label>
              <div class="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-8 text-xs px-2 text-muted-foreground hover:text-foreground"
                  onclick={undoDraw}
                  disabled={strokes.length === 0}
                >
                  <Undo2 class="h-3.5 w-3.5 mr-1" /> Undo
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-8 text-xs px-2 text-muted-foreground hover:text-foreground"
                  onclick={clearDraw}
                  disabled={strokes.length === 0 && !isDrawing}
                >
                  <Eraser class="h-3.5 w-3.5 mr-1" /> Clear
                </Button>
              </div>
            </div>

            <div class="relative w-full h-[160px] bg-background/60 bg-transparency-grid border border-dashed border-border rounded-[var(--radius-card-inner)] overflow-hidden touch-none">
              <canvas
                bind:this={drawCanvasEl}
                class="w-full h-full cursor-crosshair block img-subtle-outline"
                onpointerdown={handlePointerDown}
                onpointermove={handlePointerMove}
                onpointerup={handlePointerUp}
                onpointercancel={handlePointerUp}
              ></canvas>
              {#if strokes.length === 0 && !isDrawing}
                <div class="absolute inset-0 flex items-center justify-center pointer-events-none text-muted-foreground/50 text-xs select-none">
                  Sign here with mouse, trackpad, or stylus
                </div>
              {/if}
            </div>

            <div class="field-grid-2">
              <div class="field-group">
                <Label class="field-label">Ink Colour</Label>
                <ColorPicker
                  bind:value={penColor}
                  presets={inkColorPresets}
                  label="Ink Colour"
                  bordered={true}
                  onValueChange={(col) => {
                    penColor = col;
                    redrawCanvas();
                  }}
                />
              </div>

              <div class="field-group">
                <Label class="field-label">Stroke Width</Label>
                <Slider
                  type="single"
                  min={1}
                  max={5}
                  step={0.5}
                  unit="px"
                  value={strokeWidth}
                  onValueChange={(val: number) => {
                    strokeWidth = val;
                    redrawCanvas();
                  }}
                  class="w-full"
                />
              </div>
            </div>
          </div>

          <div class="pt-1 flex items-center justify-between gap-3">
            <div class="flex-1">
              <ControlRow label="Save signature persistently for reuse" for="save-collection-draw" size="sm">
                <Switch id="save-collection-draw" bind:checked={saveToCollection} />
              </ControlRow>
            </div>
            <Button
              variant="secondary"
              size="sm"
              class="h-8 text-xs px-4 shrink-0"
              onclick={handleApplyDrawn}
              disabled={strokes.length === 0 || isPlacing}
            >
              {#if isPlacing}
                <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" /> Placing...
              {:else}
                Place on Document
              {/if}
            </Button>
          </div>
        </Tabs.Content>

        <!-- note: type signature typography -->
        <Tabs.Content value="type" class="flex flex-col gap-3 mt-3 outline-none">
          <div class="dialog-card">
            <div class="field-grid-2">
              <div class="field-group">
                <Label for="type-name-input" class="field-label">Your Name or Initials</Label>
                <Input
                  id="type-name-input"
                  bind:value={typedName}
                  placeholder="Enter your full name..."
                  class="field-input"
                />
              </div>

              <div class="field-group">
                <Label class="field-label">Ink Colour</Label>
                <ColorPicker
                  bind:value={typedColor}
                  presets={inkColorPresets}
                  label="Ink Colour"
                  bordered={true}
                />
              </div>
            </div>

            <div class="field-group">
              <Label class="field-label">Choose Handwriting Style</Label>
              <div class="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-1">
                {#each availableFonts as f (f.name)}
                  <button
                    type="button"
                    class="border rounded-[var(--radius-card-inner)] p-2.5 text-left transition-colors flex flex-col justify-between cursor-pointer {selectedFont === f.name ? 'border-foreground/40 ring-1 ring-ring bg-secondary/40' : 'border-border hover:border-ring bg-background/50'}"
                    onclick={() => (selectedFont = f.name)}
                  >
                    <div class="text-[10px] text-muted-foreground mb-1">{f.label} ({f.name})</div>
                    <div
                      class="text-2xl truncate py-0.5 img-subtle-outline"
                      style="font-family: '{f.name}', cursive; color: {typedColor};"
                    >
                      {typedName.trim() || 'Signature'}
                    </div>
                  </button>
                {/each}
              </div>
            </div>
          </div>

          <div class="pt-1 flex items-center justify-between gap-3">
            <div class="flex-1">
              <ControlRow label="Save signature persistently for reuse" for="save-collection-type" size="sm">
                <Switch id="save-collection-type" bind:checked={saveToCollection} />
              </ControlRow>
            </div>
            <Button
              variant="secondary"
              size="sm"
              class="h-8 text-xs px-4 shrink-0"
              onclick={handleApplyTyped}
              disabled={!typedName.trim() || isPlacing}
            >
              {#if isPlacing}
                <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" /> Placing...
              {:else}
                Place on Document
              {/if}
            </Button>
          </div>
        </Tabs.Content>

        <!-- note: upload signature artwork -->
        <Tabs.Content value="upload" class="flex flex-col gap-3 mt-3 outline-none">
          <input
            bind:this={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            class="hidden"
            onchange={(e) => {
              const input = e.target as HTMLInputElement;
              const file = input.files?.[0];
              if (file) void handleImageFile(file);
              input.value = '';
            }}
          />

          {#if !uploadedDataUrl}
            <div
              class="border border-dashed border-border hover:border-ring rounded-[var(--radius-card)] bg-card p-8 text-center flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors"
              onclick={() => fileInputRef?.click()}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef?.click();
                }
              }}
              role="button"
              tabindex="0"
            >
              <Upload class="h-8 w-8 text-muted-foreground stroke-1" />
              <div class="text-xs font-medium text-foreground">Click to upload signature image</div>
              <p class="text-[11px] text-muted-foreground">
                PNG, JPG, or SVG with handwritten signature or company stamp
              </p>
            </div>
          {:else}
            <div class="dialog-card">
              <div class="relative h-[140px] bg-background/60 bg-transparency-grid border border-border rounded-[var(--radius-card-inner)] flex items-center justify-center p-4">
                {#if isCleaning}
                  <div class="flex items-center gap-2 text-xs text-muted-foreground">
                    <Sparkles class="h-4 w-4 animate-spin" /> Processing image transparency...
                  </div>
                {:else}
                  <img
                    src={cleanedUploadDataUrl || uploadedDataUrl}
                    alt="Signature Preview"
                    class="max-h-full max-w-full object-contain img-subtle-outline"
                  />
                {/if}
              </div>

              <div class="field-group">
                <Label class="field-label flex items-center gap-1">
                  <SlidersHorizontal class="h-3.5 w-3.5" /> Background Cleanup Threshold
                </Label>
                <Slider
                  type="single"
                  min={150}
                  max={255}
                  step={1}
                  unit=""
                  value={threshold}
                  onValueChange={(val: number) => {
                    threshold = val;
                    if (uploadedDataUrl) void processUpload(uploadedDataUrl);
                  }}
                  class="w-full"
                />
                <span class="field-hint">
                  Adjust threshold to automatically remove paper background and make signature transparent.
                </span>
              </div>

              <div class="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  class="h-8 text-xs"
                  onclick={() => {
                    uploadedDataUrl = null;
                    cleanedUploadDataUrl = null;
                  }}
                >
                  Choose Another Image
                </Button>
              </div>
            </div>
          {/if}

          <div class="pt-1 flex items-center justify-between gap-3">
            <div class="flex-1">
              <ControlRow label="Save signature persistently for reuse" for="save-collection-upload" size="sm">
                <Switch id="save-collection-upload" bind:checked={saveToCollection} />
              </ControlRow>
            </div>
            <Button
              variant="secondary"
              size="sm"
              class="h-8 text-xs px-4 shrink-0"
              onclick={handleApplyUpload}
              disabled={!uploadedDataUrl || isCleaning || isPlacing}
            >
              {#if isPlacing}
                <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" /> Placing...
              {:else}
                Place on Document
              {/if}
            </Button>
          </div>
        </Tabs.Content>
      </Tabs.Root>

      <div class="dialog-card">
        <ControlRow
          label="Show Full Name Underneath Signature"
          description="Composite signer full name centered beneath the signature graphic"
          for="esign-show-full-name"
          variant="ghost"
          size="compact"
          class="px-0"
        >
          <Switch id="esign-show-full-name" bind:checked={showFullNameUnderneath} />
        </ControlRow>
        {#if showFullNameUnderneath}
          <div class="field-group pt-1 border-t border-border/60">
            <Label for="esign-full-name-input" class="field-label">Full Name Displayed Underneath</Label>
            <Input
              id="esign-full-name-input"
              bind:value={signerFullName}
              placeholder="e.g. Jane Doe"
              class="field-input"
            />
          </div>
        {/if}
      </div>
    </div>

    <Dialog.Footer class="justify-between">
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-muted-foreground">Placement Preset:</span>
        <Select.Root
          type="single"
          value={placementPreset}
          onValueChange={(val) => {
            if (
              val === 'bottom-right' ||
              val === 'bottom-left' ||
              val === 'center' ||
              val === 'top-right' ||
              val === 'top-left'
            ) {
              placementPreset = val;
            }
          }}
        >
          <Select.Trigger variant="border" class="w-[140px] h-8 text-xs font-sans">
            {SIGNATURE_PLACEMENT_PRESETS.find((p) => p.id === placementPreset)?.label ?? 'Bottom Right'}
          </Select.Trigger>
          <Select.Content>
            {#each SIGNATURE_PLACEMENT_PRESETS as preset (preset.id)}
              <Select.Item value={preset.id} label={preset.label}>
                {preset.label}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-8 text-xs"
          onclick={() => {
            handleClose();
            actions.openCertSignDialog();
          }}
        >
          <ShieldCheck class="h-3.5 w-3.5 mr-1" /> Sign with Certificate
        </Button>
        <Dialog.Close>
          {#snippet child({ props })}
            <Button variant="outline" size="sm" class="h-8 text-xs" {...props} onclick={handleClose}>
              Close
            </Button>
          {/snippet}
        </Dialog.Close>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
