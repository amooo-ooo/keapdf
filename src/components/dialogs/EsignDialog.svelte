<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import {
    getSavedSignatures,
    saveSignature,
    deleteSignature,
    setDefaultSignature,
    renderDrawnStrokesToDataUrl,
    renderTypedSignatureToDataUrl,
    processUploadedSignatureImage,
    preloadSignatureFonts,
    type SavedSignature,
    type DrawPoint,
  } from '../../services/signature-storage';
  import {
    PenTool,
    Type,
    Upload,
    Trash2,
    Check,
    Star,
    Eraser,
    Undo2,
    Plus,
    Sparkles,
    Sliders,
    Loader2,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const canvasStore = useCanvasStore();

  let activeTab = $state<'signatures' | 'draw' | 'type' | 'upload'>('signatures');
  let savedSignatures = $state<SavedSignature[]>([]);
  let saveToCollection = $state(true);
  let signatureTitle = $state('My Signature');
  let isPlacing = $state(false);

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

  const penColors = [
    { label: 'Black', value: '#000000' },
    { label: 'Dark Navy', value: '#1e3a8a' },
    { label: 'Royal Blue', value: '#2563eb' },
    { label: 'Dark Gray', value: '#374151' },
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
    savedSignatures = getSavedSignatures();
    if (savedSignatures.length === 0 && activeTab === 'signatures') {
      activeTab = 'draw';
    }
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

    if (Math.abs(drawCanvasEl.width - targetWidth) > 1 || Math.abs(drawCanvasEl.height - targetHeight) > 1) {
      drawCanvasEl.width = targetWidth;
      drawCanvasEl.height = targetHeight;
    }

    cachedCanvasRect = drawCanvasEl.getBoundingClientRect();
    redrawCanvas();
  }

  onMount(() => {
    preloadSignatureFonts();
    refreshSavedList();
    if (store.esignInitialTab) {
      activeTab = store.esignInitialTab;
    }
  });

  onDestroy(() => {
    cleanupPointerListeners();
    rafPending = false;
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
      } catch {}
      activePointerId = null;
    }
  }

  function handlePointerDown(e: PointerEvent): void {
    if (!drawCanvasEl) return;
    try {
      drawCanvasEl.setPointerCapture(e.pointerId);
      activePointerId = e.pointerId;
    } catch {}

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

  // Place Actions
  function handleUseSaved(sig: SavedSignature): void {
    try {
      actions.placeSignatureOnCanvas(sig, store.currentPageIndex, canvasStore);
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
      const rect = cachedCanvasRect || (drawCanvasEl ? drawCanvasEl.getBoundingClientRect() : { width: 600, height: 250 });
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

      actions.placeSignatureOnCanvas(sigRecord, store.currentPageIndex, canvasStore);
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

      actions.placeSignatureOnCanvas(sigRecord, store.currentPageIndex, canvasStore);
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

      actions.placeSignatureOnCanvas(sigRecord, store.currentPageIndex, canvasStore);
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
  <Dialog.Content class="sm:max-w-[620px] max-h-[90vh] flex flex-col p-0 overflow-hidden">
    <Dialog.Header class="px-6 pt-5 pb-3 border-b border-border bg-card">
      <div class="flex items-center justify-between pr-8">
        <Dialog.Title class="flex items-center gap-2 text-base font-semibold">
          <PenTool class="h-4 w-4 text-primary" />
          Add Electronic Signature (E-Sign)
        </Dialog.Title>
        {#if savedSignatures.length > 0}
          <Badge variant="secondary" class="text-xs">
            {savedSignatures.length} saved
          </Badge>
        {/if}
      </div>
      <Dialog.Description class="text-xs text-muted-foreground">
        Create, customize, and place persistent electronic signatures directly on your PDF pages.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex-1 overflow-y-auto px-6 py-4">
      <Tabs.Root value={activeTab} onValueChange={(val) => { activeTab = val as typeof activeTab; if (val === 'draw') requestAnimationFrame(() => setupCanvasDimensions()); }}>
        <Tabs.List class="grid grid-cols-4 mb-4">
          <Tabs.Trigger value="signatures" class="text-xs">
            My Signatures
          </Tabs.Trigger>
          <Tabs.Trigger value="draw" class="text-xs">
            <PenTool class="h-3.5 w-3.5 mr-1.5" /> Draw
          </Tabs.Trigger>
          <Tabs.Trigger value="type" class="text-xs">
            <Type class="h-3.5 w-3.5 mr-1.5" /> Type
          </Tabs.Trigger>
          <Tabs.Trigger value="upload" class="text-xs">
            <Upload class="h-3.5 w-3.5 mr-1.5" /> Upload
          </Tabs.Trigger>
        </Tabs.List>

        <!-- Tab 1: My Signatures -->
        <Tabs.Content value="signatures" class="space-y-4">
          {#if savedSignatures.length === 0}
            <div class="border border-dashed border-border rounded-lg p-8 text-center flex flex-col items-center justify-center gap-2">
              <PenTool class="h-8 w-8 text-muted-foreground stroke-1" />
              <p class="text-xs text-muted-foreground">You have no saved signatures yet.</p>
              <Button size="sm" variant="outline" class="mt-2 text-xs" onclick={() => (activeTab = 'draw')}>
                <Plus class="h-3.5 w-3.5 mr-1.5" /> Create New Signature
              </Button>
            </div>
          {:else}
            <div class="grid grid-cols-2 gap-3 max-h-[340px] overflow-y-auto pr-1">
              {#each savedSignatures as sig (sig.id)}
                <div
                  class="group relative border border-border hover:border-primary/60 bg-card rounded-lg p-3 flex flex-col justify-between transition-all cursor-pointer shadow-xs hover:shadow-md"
                  onclick={() => handleUseSaved(sig)}
                  onkeydown={(e) => { if (e.key === 'Enter') handleUseSaved(sig); }}
                  role="button"
                  tabindex="0"
                >
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-medium truncate max-w-[140px]">{sig.title}</span>
                    <div class="flex items-center gap-1">
                      {#if sig.isDefault}
                        <Badge variant="secondary" class="text-[10px] px-1.5 py-0 h-4 bg-primary/10 text-primary">
                          Default
                        </Badge>
                      {:else}
                        <button
                          type="button"
                          class="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-warning p-1 transition-opacity"
                          title="Set as default"
                          onclick={(e) => handleSetDefault(sig.id, e)}
                        >
                          <Star class="h-3.5 w-3.5" />
                        </button>
                      {/if}
                      <button
                        type="button"
                        class="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1 transition-opacity"
                        title="Delete signature"
                        onclick={(e) => handleDeleteSaved(sig.id, e)}
                      >
                        <Trash2 class="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div class="h-20 bg-muted/30 rounded border border-border/40 flex items-center justify-center p-2">
                    <img src={sig.dataUrl} alt={sig.title} class="max-h-full max-w-full object-contain" />
                  </div>

                  <div class="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span class="capitalize">{sig.type}</span>
                    <Button size="sm" variant="ghost" class="h-6 text-[11px] px-2 text-primary font-medium hover:bg-primary/10" onclick={(e) => { e.stopPropagation(); handleUseSaved(sig); }}>
                      Use on PDF
                    </Button>
                  </div>
                </div>
              {/each}
            </div>

            <div class="pt-2 flex justify-end">
              <Button size="sm" variant="outline" class="text-xs" onclick={() => (activeTab = 'draw')}>
                <Plus class="h-3.5 w-3.5 mr-1.5" /> Create Another Signature
              </Button>
            </div>
          {/if}
        </Tabs.Content>

        <!-- Tab 2: Draw -->
        <Tabs.Content value="draw" class="space-y-4">
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <Label class="text-xs font-medium">Draw your signature</Label>
              <div class="flex items-center gap-2">
                <Button size="sm" variant="ghost" class="h-7 text-xs px-2 text-muted-foreground" onclick={undoDraw} disabled={strokes.length === 0}>
                  <Undo2 class="h-3.5 w-3.5 mr-1" /> Undo
                </Button>
                <Button size="sm" variant="ghost" class="h-7 text-xs px-2 text-muted-foreground hover:text-destructive" onclick={clearDraw} disabled={strokes.length === 0 && !isDrawing}>
                  <Eraser class="h-3.5 w-3.5 mr-1" /> Clear
                </Button>
              </div>
            </div>

            <div class="relative w-full h-[180px] bg-card border-2 border-dashed border-border rounded-lg overflow-hidden touch-none">
              <canvas
                bind:this={drawCanvasEl}
                class="w-full h-full cursor-crosshair block"
                onpointerdown={handlePointerDown}
                onpointermove={handlePointerMove}
                onpointerup={handlePointerUp}
                onpointercancel={handlePointerUp}
              ></canvas>
              {#if strokes.length === 0 && !isDrawing}
                <div class="absolute inset-0 flex items-center justify-center pointer-events-none text-muted-foreground/40 text-sm select-none">
                  Sign here with mouse, trackpad, or stylus
                </div>
              {/if}
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4 pt-1">
            <div>
              <Label class="text-xs text-muted-foreground mb-1.5 block">Ink Color</Label>
              <div class="flex items-center gap-2">
                {#each penColors as c}
                  <button
                    type="button"
                    class="w-6 h-6 rounded-full border border-border flex items-center justify-center transition-all {penColor === c.value ? 'ring-2 ring-primary ring-offset-2' : ''}"
                    style="background-color: {c.value};"
                    onclick={() => { penColor = c.value; redrawCanvas(); }}
                    title={c.label}
                  >
                    {#if penColor === c.value}
                      <Check class="h-3 w-3 text-white" />
                    {/if}
                  </button>
                {/each}
              </div>
            </div>

            <div>
              <div class="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Stroke Width</span>
                <span>{strokeWidth}px</span>
              </div>
              <Slider
                type="single"
                min={1}
                max={5}
                step={0.5}
                value={strokeWidth}
                onValueChange={(val: number) => { strokeWidth = val; redrawCanvas(); }}
                class="w-full mt-1.5"
              />
            </div>
          </div>

          <div class="pt-2 border-t border-border flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Checkbox id="save-collection-draw" bind:checked={saveToCollection} />
              <Label for="save-collection-draw" class="text-xs cursor-pointer select-none font-normal">
                Save signature persistently for reuse
              </Label>
            </div>
            <Button size="sm" class="text-xs px-4" onclick={handleApplyDrawn} disabled={strokes.length === 0 || isPlacing}>
              {#if isPlacing}
                <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" /> Placing...
              {:else}
                Place on Document
              {/if}
            </Button>
          </div>
        </Tabs.Content>

        <!-- Tab 3: Type -->
        <Tabs.Content value="type" class="space-y-4">
          <div class="space-y-1.5">
            <Label for="type-name-input" class="text-xs font-medium">Your Name or Initials</Label>
            <Input id="type-name-input" bind:value={typedName} placeholder="Enter your full name..." class="h-9 text-sm" />
          </div>

          <div>
            <Label class="text-xs text-muted-foreground mb-2 block">Choose Handwriting Style</Label>
            <div class="grid grid-cols-2 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
              {#each availableFonts as f}
                <button
                  type="button"
                  class="border rounded-lg p-3 text-left transition-all flex flex-col justify-between {selectedFont === f.name ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50 bg-card'}"
                  onclick={() => (selectedFont = f.name)}
                >
                  <div class="text-[10px] text-muted-foreground mb-1">{f.label} ({f.name})</div>
                  <div
                    class="text-2xl truncate py-1"
                    style="font-family: '{f.name}', cursive; color: {typedColor};"
                  >
                    {typedName.trim() || 'Signature'}
                  </div>
                </button>
              {/each}
            </div>
          </div>

          <div class="pt-1 flex items-center gap-3">
            <Label class="text-xs text-muted-foreground">Ink Color:</Label>
            <div class="flex items-center gap-2">
              {#each penColors as c}
                <button
                  type="button"
                  class="w-5 h-5 rounded-full border border-border flex items-center justify-center transition-all {typedColor === c.value ? 'ring-2 ring-primary ring-offset-2' : ''}"
                  style="background-color: {c.value};"
                  onclick={() => (typedColor = c.value)}
                  title={c.label}
                >
                  {#if typedColor === c.value}
                    <Check class="h-2.5 w-2.5 text-white" />
                  {/if}
                </button>
              {/each}
            </div>
          </div>

          <div class="pt-2 border-t border-border flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Checkbox id="save-collection-type" bind:checked={saveToCollection} />
              <Label for="save-collection-type" class="text-xs cursor-pointer select-none font-normal">
                Save signature persistently for reuse
              </Label>
            </div>
            <Button size="sm" class="text-xs px-4" onclick={handleApplyTyped} disabled={!typedName.trim() || isPlacing}>
              {#if isPlacing}
                <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" /> Placing...
              {:else}
                Place on Document
              {/if}
            </Button>
          </div>
        </Tabs.Content>

        <!-- Tab 4: Upload -->
        <Tabs.Content value="upload" class="space-y-4">
          <input
            bind:this={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            class="hidden"
            onchange={(e) => {
              const input = e.target as HTMLInputElement;
              const file = input.files?.[0];
              if (file) handleImageFile(file);
              input.value = '';
            }}
          />

          {#if !uploadedDataUrl}
            <div
              class="border-2 border-dashed border-border hover:border-primary/60 rounded-lg p-8 text-center flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors"
              onclick={() => fileInputRef?.click()}
              onkeydown={(e) => { if (e.key === 'Enter') fileInputRef?.click(); }}
              role="button"
              tabindex="0"
            >
              <Upload class="h-8 w-8 text-muted-foreground stroke-1" />
              <div class="text-xs font-medium">Click to upload signature image</div>
              <p class="text-[11px] text-muted-foreground">PNG, JPG, or SVG with handwritten signature or company stamp</p>
            </div>
          {:else}
            <div class="space-y-3">
              <div class="relative h-[160px] bg-muted/30 border border-border rounded-lg flex items-center justify-center p-4">
                {#if isCleaning}
                  <div class="flex items-center gap-2 text-xs text-muted-foreground">
                    <Sparkles class="h-4 w-4 animate-spin text-primary" /> Processing image transparency...
                  </div>
                {:else}
                  <img src={cleanedUploadDataUrl || uploadedDataUrl} alt="Signature Preview" class="max-h-full max-w-full object-contain" />
                {/if}
              </div>

              <div class="space-y-2 bg-muted/20 p-3 rounded-lg border border-border">
                <div class="flex items-center justify-between text-xs">
                  <span class="flex items-center gap-1 text-muted-foreground font-medium">
                    <Sliders class="h-3.5 w-3.5" /> Background Cleanup Threshold
                  </span>
                  <span class="text-xs font-sans">{threshold}</span>
                </div>
                <Slider
                  type="single"
                  min={150}
                  max={255}
                  step={1}
                  value={threshold}
                  onValueChange={(val: number) => { threshold = val; if (uploadedDataUrl) processUpload(uploadedDataUrl); }}
                  class="w-full mt-1.5"
                />
                <p class="text-[10px] text-muted-foreground">
                  Adjust threshold to automatically remove paper background and make signature transparent.
                </p>
              </div>

              <div class="flex justify-end gap-2">
                <Button size="sm" variant="outline" class="text-xs" onclick={() => { uploadedDataUrl = null; cleanedUploadDataUrl = null; }}>
                  Choose Another Image
                </Button>
              </div>
            </div>
          {/if}

          <div class="pt-2 border-t border-border flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Checkbox id="save-collection-upload" bind:checked={saveToCollection} />
              <Label for="save-collection-upload" class="text-xs cursor-pointer select-none font-normal">
                Save signature persistently for reuse
              </Label>
            </div>
            <Button size="sm" class="text-xs px-4" onclick={handleApplyUpload} disabled={!uploadedDataUrl || isCleaning || isPlacing}>
              {#if isPlacing}
                <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" /> Placing...
              {:else}
                Place on Document
              {/if}
            </Button>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>

    <Dialog.Footer class="px-6 py-3 border-t border-border bg-card flex items-center justify-between">
      <div class="text-[11px] text-muted-foreground">
        Canvas elements can be moved, resized, and rotated anytime before baking into PDF.
      </div>
      <Dialog.Close>
        {#snippet child({ props })}
          <Button variant="outline" size="sm" class="text-xs" {...props} onclick={handleClose}>
            Close
          </Button>
        {/snippet}
      </Dialog.Close>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
