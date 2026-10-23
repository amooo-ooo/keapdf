<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { ControlRow } from '$lib/components/ui/control-row/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
  import { downloadBytes } from '../../utils/download-utils';
  import {
    SIGNATURE_PLACEMENT_PRESETS,
    resolveSignaturePresetRect,
    canvasSignatureRectToPdfRect,
    type SignaturePlacementPreset,
  } from '../../utils/signature-placement';
  import type {
    DigitalIdentity,
    SignPdfOptions,
  } from '../../services/pdf/operations/signature-ops';
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
    getSavedDigitalSignatures,
    getDefaultDigitalSignature,
    saveDigitalSignature,
    deleteDigitalSignature,
    setDefaultDigitalSignature,
    reconstructDigitalIdentity,
    hydrateDigitalSignaturesFromOfflineCache,
    type SavedDigitalSignature,
    type SavedDigitalSignatureConfig,
    type DigitalSignaturePlacement,
  } from '../../services/digital-signature-storage';
  import {
    ShieldCheck,
    KeyRound,
    FileSignature,
    CheckCircle2,
    Download,
    Eye,
    EyeOff,
    Upload,
    Sparkles,
    AlertCircle,
    Lock,
    Star,
    Trash2,
    Plus,
    PenTool,
    Type,
    Eraser,
    Undo2,
    SlidersHorizontal,
    Move,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const canvasStore = useCanvasStore();
  const featureFlags = useFeatureFlagStore();

  let activeTab = $state<'cert' | 'details' | 'appearance' | 'sign'>('cert');
  let certMode = $state<'saved' | 'generate' | 'import'>('generate');

  // Saved digital signatures state
  let savedDigitalSignatures = $state<SavedDigitalSignature[]>([]);
  let selectedSavedDigitalSigId = $state<string | null>(null);
  let saveDigitalSignatureForReuse = $state(true);

  // Certificate generation inputs
  let commonName = $state('Jane Smith');
  let organization = $state('Acme Corporation');
  let organizationalUnit = $state('Legal & Compliance');
  let email = $state('jane.smith@example.com');
  let country = $state('CH');
  let certPassword = $state('Password123!');
  let keySize = $state<2048 | 4096>(2048);
  let validityYears = $state(2);

  // Certificate import inputs
  let importedP12File: File | null = $state(null);
  let importPassword = $state('');
  let importError = $state<string | null>(null);
  let p12FileInputEl: HTMLInputElement | null = $state(null);

  // Active cryptographic identity
  let activeIdentity = $state<DigitalIdentity | null>(null);
  let isGenerating = $state(false);

  // Signature metadata
  let reason = $state('I am approving this document');
  let location = $state('Zurich, Switzerland');
  let contactInfo = $state('jane.smith@example.com');
  const reasonPresets = [
    'I am approving this document',
    'I have reviewed and agree to the terms in this document',
    'I am the author of this document',
    'I certify the integrity and authenticity of this document',
  ];

  // Visual appearance and placement
  let isVisibleSignature = $state(true);
  let targetPageIndex = $state(0);
  let placementPosition = $state<Exclude<SignaturePlacementPreset, 'custom'>>('bottom-right');
  let savedSignatures = $state<SavedSignature[]>([]);
  let selectedGraphicSigId = $state<string | null>(null);
  let showTextDetails = $state(true);

  // Signature graphic creation state (Saved, Draw, Type, Upload)
  let sigSourceMode = $state<'saved' | 'draw' | 'type' | 'upload'>('saved');
  let saveGraphicToCollection = $state(true);
  let typedSignatureText = $state('Jane Smith');
  let selectedFont = $state('Caveat');
  let inkColor = $state('#000000');
  let strokeWidth = $state(2.5);
  const signatureFonts = [
    { name: 'Caveat', label: 'Casual Script' },
    { name: 'Dancing Script', label: 'Flowing Script' },
    { name: 'Pacifico', label: 'Bold Cursive' },
    { name: 'Alex Brush', label: 'Elegant Calligraphy' },
    { name: 'Great Vibes', label: 'Classic Formal' },
    { name: 'Allura', label: 'Slender Flourish' },
  ];
  const inkColorPresets = [
    { label: 'Black', color: '#000000' },
    { label: 'Dark Navy', color: '#1e3a8a' },
    { label: 'Royal Blue', color: '#2563eb' },
    { label: 'Dark Grey', color: '#374151' },
  ];

  // Draw pad state
  let drawCanvasEl: HTMLCanvasElement | null = $state(null);
  let isDrawingStroke = $state(false);
  let strokes = $state<DrawPoint[][]>([]);
  let activeStrokePoints: DrawPoint[] = [];
  let cachedCanvasRect: DOMRect | null = null;
  let activePointerId: number | null = null;

  // Upload graphic state
  let rawUploadedGraphicUrl = $state<string | null>(null);
  let uploadedGraphicDataUrl = $state<string | null>(null);
  let uploadedAspectRatio = $state(3);
  let uploadThreshold = $state(220);
  let isCleaningUpload = $state(false);
  let graphicFileInputEl: HTMLInputElement | null = $state(null);

  // Standards and PAdES configuration (enabled by default for full statutory compliance)
  let subFilter = $state<'ETSI.CAdES.detached' | 'adbe.pkcs7.detached'>('ETSI.CAdES.detached');
  let enableTimestamp = $state(true);
  let tsaUrl = $state('');
  let embedDss = $state(true);

  // Execution status
  let isSigning = $state(false);
  let signSuccess = $state(false);
  let signedPdfBytes = $state<Uint8Array | null>(null);
  let signError = $state<string | null>(null);

  const effectiveSignerName = $derived(
    (activeIdentity?.subject.commonName || commonName || typedSignatureText || 'Signer').trim() ||
      'Signer'
  );

  let typedPreviewDataUrl = $state<string | undefined>(undefined);

  $effect(() => {
    const textToRender = (typedSignatureText.trim() || effectiveSignerName).trim();
    const font = selectedFont;
    const color = inkColor;
    if (sigSourceMode === 'type' && textToRender) {
      let cancelled = false;
      void renderTypedSignatureToDataUrl(textToRender, font, color).then((rendered) => {
        if (!cancelled) {
          typedPreviewDataUrl = rendered.dataUrl;
        }
      });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  });

  const previewGraphicDataUrl = $derived.by(() => {
    if (sigSourceMode === 'saved') {
      if (selectedGraphicSigId === null) return undefined;
      const found = savedSignatures.find((s) => s.id === selectedGraphicSigId);
      return found?.dataUrl;
    }
    if (sigSourceMode === 'upload' && uploadedGraphicDataUrl) {
      return uploadedGraphicDataUrl;
    }
    if (sigSourceMode === 'draw' && strokes.length > 0) {
      const rendered = renderDrawnStrokesToDataUrl(strokes, strokeWidth, inkColor);
      if (rendered) return rendered.dataUrl;
    }
    if (sigSourceMode === 'type' && typedPreviewDataUrl) {
      return typedPreviewDataUrl;
    }
    if (selectedGraphicSigId) {
      const found = savedSignatures.find((s) => s.id === selectedGraphicSigId);
      if (found) return found.dataUrl;
    }
    return undefined;
  });

  function buildCurrentSignatureConfig(): SavedDigitalSignatureConfig {
    return {
      reason: reason.trim() || 'I am approving this document',
      location: location.trim(),
      contactInfo: contactInfo.trim(),
      subFilter,
      enableTimestamp,
      tsaUrl: tsaUrl.trim(),
      embedDss,
      isVisibleSignature,
      placementPosition: placementPosition as DigitalSignaturePlacement,
      selectedGraphicSigId,
      showTextDetails,
    };
  }

  function applySavedDigitalSignatureState(record: SavedDigitalSignature): void {
    const restored = reconstructDigitalIdentity(record);
    activeIdentity = restored;
    selectedSavedDigitalSigId = record.id;
    commonName = restored.subject.commonName || commonName;
    typedSignatureText = restored.subject.commonName || typedSignatureText;
    organization = restored.subject.organization || organization;
    organizationalUnit = restored.subject.organizationalUnit || organizationalUnit;
    email = restored.subject.email || email;
    country = restored.subject.country || country;
    reason = record.config.reason;
    location = record.config.location;
    contactInfo = record.config.contactInfo;
    subFilter = record.config.subFilter || 'ETSI.CAdES.detached';
    embedDss = record.config.embedDss ?? true;
    enableTimestamp = embedDss ? true : Boolean(record.config.enableTimestamp);
    tsaUrl = record.config.tsaUrl === 'https://freetsa.org/tsr' ? '' : (record.config.tsaUrl || '');
    isVisibleSignature = record.config.isVisibleSignature;
    if (
      record.config.placementPosition === 'bottom-right' ||
      record.config.placementPosition === 'bottom-left' ||
      record.config.placementPosition === 'center' ||
      record.config.placementPosition === 'top-right' ||
      record.config.placementPosition === 'top-left'
    ) {
      placementPosition = record.config.placementPosition;
    }
    if (
      record.config.selectedGraphicSigId === null ||
      savedSignatures.some((s) => s.id === record.config.selectedGraphicSigId)
    ) {
      selectedGraphicSigId = record.config.selectedGraphicSigId;
    }
    showTextDetails = record.config.showTextDetails;
  }

  function refreshSavedDigitalSignatures(applyDefaultMode = false): void {
    savedDigitalSignatures = getSavedDigitalSignatures();
    if (featureFlags.isEnabled('signatures.cert-sign.saved') && savedDigitalSignatures.length > 0) {
      if (applyDefaultMode) {
        certMode = 'saved';
        const def = getDefaultDigitalSignature();
        if (def) {
          try {
            applySavedDigitalSignatureState(def);
          } catch (err) {
            console.warn('Failed to restore default digital signature:', err);
          }
        }
      }
    } else if (certMode === 'saved') {
      certMode = 'generate';
    }
  }

  function persistCurrentDigitalSignatureIfEnabled(identity: DigitalIdentity): void {
    if (!featureFlags.isEnabled('signatures.cert-sign.saved') || !saveDigitalSignatureForReuse) {
      return;
    }
    const saved = saveDigitalSignature({
      id: selectedSavedDigitalSigId ?? undefined,
      identity,
      config: buildCurrentSignatureConfig(),
      isDefault: true,
    });
    savedDigitalSignatures = getSavedDigitalSignatures();
    selectedSavedDigitalSigId = saved.id;
    certMode = 'saved';
  }

  async function handleLoadSavedAsIs(
    record: SavedDigitalSignature,
    signImmediately = false
  ): Promise<void> {
    signError = null;
    try {
      applySavedDigitalSignatureState(record);
      if (signImmediately) {
        activeTab = 'sign';
        await handleExecuteSign(false);
      } else {
        activeTab = 'sign';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load saved digital signature.';
      signError = message;
    }
  }

  function handleSetDefaultDigitalSig(id: string, e: MouseEvent): void {
    e.stopPropagation();
    setDefaultDigitalSignature(id);
    refreshSavedDigitalSignatures(false);
  }

  function handleDeleteDigitalSig(id: string, e: MouseEvent): void {
    e.stopPropagation();
    deleteDigitalSignature(id);
    if (selectedSavedDigitalSigId === id) {
      selectedSavedDigitalSigId = null;
      activeIdentity = null;
    }
    refreshSavedDigitalSignatures(true);
  }

  function handleDeleteGraphicSig(id: string, e: MouseEvent): void {
    e.stopPropagation();
    deleteSignature(id);
    savedSignatures = getSavedSignatures();
    if (selectedGraphicSigId === id) {
      selectedGraphicSigId = savedSignatures[0]?.id ?? null;
    }
  }

  function handleSetDefaultGraphicSig(id: string, e: MouseEvent): void {
    e.stopPropagation();
    setDefaultSignature(id);
    savedSignatures = getSavedSignatures();
    selectedGraphicSigId = id;
  }

  function setupDrawCanvas(): void {
    if (!drawCanvasEl) return;
    const rect = drawCanvasEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    drawCanvasEl.width = Math.round(rect.width * dpr);
    drawCanvasEl.height = Math.round(rect.height * dpr);
    cachedCanvasRect = rect;
    redrawSignaturePad();
  }

  function redrawSignaturePad(): void {
    if (!drawCanvasEl) return;
    const ctx = drawCanvasEl.getContext('2d');
    if (!ctx) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const rect = cachedCanvasRect || drawCanvasEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = strokeWidth;

    const allStrokes = activeStrokePoints.length > 0 ? [...strokes, activeStrokePoints] : strokes;
    for (const stroke of allStrokes) {
      if (stroke.length === 0) continue;
      if (stroke.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke[0].x, stroke[0].y, strokeWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = inkColor;
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

  function handlePadPointerDown(e: PointerEvent): void {
    if (!drawCanvasEl) return;
    try {
      drawCanvasEl.setPointerCapture(e.pointerId);
      activePointerId = e.pointerId;
    } catch {
      // Ignore pointer capture errors
    }
    cachedCanvasRect = drawCanvasEl.getBoundingClientRect();
    isDrawingStroke = true;
    activeStrokePoints = [
      {
        x: e.clientX - cachedCanvasRect.left,
        y: e.clientY - cachedCanvasRect.top,
      },
    ];
    redrawSignaturePad();
  }

  function handlePadPointerMove(e: PointerEvent): void {
    if (!isDrawingStroke || !drawCanvasEl) return;
    const rect = cachedCanvasRect || drawCanvasEl.getBoundingClientRect();
    activeStrokePoints.push({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    redrawSignaturePad();
  }

  function handlePadPointerUp(): void {
    if (!isDrawingStroke) return;
    isDrawingStroke = false;
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
    if (activeStrokePoints.length > 0) {
      strokes = [...strokes, [...activeStrokePoints]];
      activeStrokePoints = [];
    }
    redrawSignaturePad();
  }

  async function processGraphicUpload(rawUrl: string): Promise<void> {
    if (!rawUrl) return;
    isCleaningUpload = true;
    try {
      const cleaned = await processUploadedSignatureImage(rawUrl, uploadThreshold, inkColor);
      uploadedGraphicDataUrl = cleaned.dataUrl;
      uploadedAspectRatio = cleaned.aspectRatio;
    } catch {
      uploadedGraphicDataUrl = rawUrl;
    } finally {
      isCleaningUpload = false;
    }
  }

  async function handleGraphicUpload(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const rawUrl = reader.result as string;
      rawUploadedGraphicUrl = rawUrl;
      await processGraphicUpload(rawUrl);
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  $effect(() => {
    if (activeTab === 'appearance' && sigSourceMode === 'draw' && drawCanvasEl) {
      requestAnimationFrame(() => setupDrawCanvas());
    }
  });

  $effect(() => {
    if (store.showCertSignDialog) {
      untrack(() => {
        preloadSignatureFonts();
        savedSignatures = getSavedSignatures();
        if (savedSignatures.length > 0) {
          const def = savedSignatures.find((s) => s.isDefault) ?? savedSignatures[0];
          selectedGraphicSigId = def.id;
          sigSourceMode = 'saved';
        } else {
          selectedGraphicSigId = null;
          sigSourceMode = 'type';
        }
        targetPageIndex = store.currentPageIndex;
        signSuccess = false;
        signedPdfBytes = null;
        signError = null;

        refreshSavedDigitalSignatures(true);
        if (
          featureFlags.isEnabled('signatures.cert-sign.saved') &&
          savedDigitalSignatures.length > 0
        ) {
          activeTab = 'cert';
        } else {
          activeTab = 'cert';
          if (featureFlags.isEnabled('signatures.cert-sign.saved')) {
            void hydrateDigitalSignaturesFromOfflineCache().then((hydrated) => {
              if (hydrated.length > 0 && savedDigitalSignatures.length === 0) {
                refreshSavedDigitalSignatures(true);
              }
            });
          }
        }
      });
    }
  });

  async function ensureActiveIdentity(): Promise<DigitalIdentity | null> {
    if (
      activeIdentity &&
      certMode === 'saved' &&
      selectedSavedDigitalSigId !== null
    ) {
      return activeIdentity;
    }
    if (
      activeIdentity &&
      certMode === 'generate' &&
      activeIdentity.subject.commonName === commonName.trim()
    ) {
      return activeIdentity;
    }
    if (certMode === 'import') {
      if (activeIdentity) return activeIdentity;
      if (importedP12File) {
        await handleImportP12();
        return activeIdentity;
      }
      signError = 'Please select and unlock a PKCS#12 (.p12 / .pfx) certificate file.';
      return null;
    }

    const targetName = commonName.trim() || 'Authorized Signer';
    isGenerating = true;
    try {
      const { createSelfSignedCertificate } = await import(
        '../../services/pdf/operations/signature-ops'
      );
      const id = await createSelfSignedCertificate({
        commonName: targetName,
        organization: organization.trim() || undefined,
        organizationalUnit: organizationalUnit.trim() || undefined,
        email: email.trim() || undefined,
        country: country.trim() || 'CH',
        password: certPassword || 'Password123!',
        keySize,
        validityYears,
      });
      activeIdentity = id;
      typedSignatureText = id.subject.commonName || typedSignatureText;
      if (!contactInfo.trim() && email.trim()) {
        contactInfo = email.trim();
      }
      persistCurrentDigitalSignatureIfEnabled(id);
      return id;
    } catch (err) {
      console.error('Failed to generate digital identity:', err);
      signError = 'Failed to generate RSA certificate keys.';
      return null;
    } finally {
      isGenerating = false;
    }
  }

  async function handleGenerateCertificate(): Promise<void> {
    const id = await ensureActiveIdentity();
    if (id) {
      activeTab = 'details';
    }
  }

  async function handleImportP12(): Promise<void> {
    if (!importedP12File) return;
    importError = null;
    try {
      const { parsePkcs12 } = await import('../../services/pdf/operations/signature-ops');
      const buffer = await importedP12File.arrayBuffer();
      const id = parsePkcs12(buffer, importPassword);
      selectedSavedDigitalSigId = null;
      activeIdentity = id;
      commonName = id.subject.commonName || commonName;
      typedSignatureText = id.subject.commonName || typedSignatureText;
      persistCurrentDigitalSignatureIfEnabled(id);
      activeTab = 'details';
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Invalid PKCS#12 file or incorrect password.';
      importError = message;
    }
  }

  function handleExportP12(): void {
    if (!activeIdentity || !activeIdentity.p12Bytes) return;
    const cleanName = activeIdentity.subject.commonName.replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadBytes(activeIdentity.p12Bytes, `${cleanName}_digital_id.p12`, 'application/x-pkcs12');
  }

  async function resolveAndPersistGraphicDataUrl(): Promise<string | undefined> {
    if (sigSourceMode === 'saved') {
      if (selectedGraphicSigId === null) return undefined;
      const found = savedSignatures.find((s) => s.id === selectedGraphicSigId);
      return found?.dataUrl;
    }
    if (sigSourceMode === 'draw' && strokes.length > 0) {
      const rendered = renderDrawnStrokesToDataUrl(strokes, strokeWidth, inkColor);
      if (rendered) {
        if (saveGraphicToCollection) {
          const saved = saveSignature({
            title: `${effectiveSignerName} (Drawn)`,
            type: 'draw',
            dataUrl: rendered.dataUrl,
            color: inkColor,
            aspectRatio: rendered.aspectRatio,
            isDefault: savedSignatures.length === 0,
          });
          savedSignatures = getSavedSignatures();
          selectedGraphicSigId = saved.id;
        }
        return rendered.dataUrl;
      }
    }
    if (sigSourceMode === 'upload' && uploadedGraphicDataUrl) {
      if (saveGraphicToCollection) {
        const saved = saveSignature({
          title: `${effectiveSignerName} (Uploaded)`,
          type: 'upload',
          dataUrl: uploadedGraphicDataUrl,
          color: inkColor,
          aspectRatio: uploadedAspectRatio,
          isDefault: savedSignatures.length === 0,
        });
        savedSignatures = getSavedSignatures();
        selectedGraphicSigId = saved.id;
      }
      return uploadedGraphicDataUrl;
    }
    if (sigSourceMode === 'type') {
      const textToRender = (typedSignatureText.trim() || effectiveSignerName).trim();
      const rendered = await renderTypedSignatureToDataUrl(
        textToRender,
        selectedFont,
        inkColor
      );
      if (rendered) {
        if (saveGraphicToCollection) {
          const saved = saveSignature({
            title: `${textToRender} (${selectedFont})`,
            type: 'type',
            dataUrl: rendered.dataUrl,
            fontFamily: selectedFont,
            text: textToRender,
            color: inkColor,
            aspectRatio: rendered.aspectRatio,
            isDefault: savedSignatures.length === 0,
          });
          savedSignatures = getSavedSignatures();
          selectedGraphicSigId = saved.id;
        }
        return rendered.dataUrl;
      }
    }
    return previewGraphicDataUrl;
  }

  function resolveTargetPageDimensions(pageIdx: number): { widthPts: number; heightPts: number } {
    try {
      if (actions.service.document && store.isDocumentLoaded) {
        return actions.service.document.getPage(pageIdx).getDimensions();
      }
    } catch {
      // Fallback to standard Letter dimensions
    }
    return { widthPts: 612, heightPts: 792 };
  }

  async function handleStartInteractivePlacement(): Promise<void> {
    signError = null;
    const identity = await ensureActiveIdentity();
    if (!identity) return;

    const graphicUrl = await resolveAndPersistGraphicDataUrl();
    const dims = resolveTargetPageDimensions(targetPageIndex);
    const presetRect = resolveSignaturePresetRect(
      placementPosition,
      dims.widthPts,
      dims.heightPts
    );

    actions.startDigitalSignaturePlacement({
      pageIndex: targetPageIndex,
      x: presetRect.x,
      y: presetRect.y,
      width: presetRect.width,
      height: presetRect.height,
      preset: placementPosition,
      graphicDataUrl: graphicUrl,
      showTextDetails,
      signerName: identity.subject.commonName || effectiveSignerName,
      signOptions: {
        identity,
        signerName: identity.subject.commonName || effectiveSignerName,
        reason: reason.trim() || undefined,
        location: location.trim() || undefined,
        contactInfo: contactInfo.trim() || undefined,
        signingTime: new Date(),
        subFilter,
        enableTimestamp,
        tsaUrl: enableTimestamp && tsaUrl.trim() ? tsaUrl.trim() : undefined,
        embedDss,
      },
      onSigned: () => {
        persistCurrentDigitalSignatureIfEnabled(identity);
      },
    });
  }

  async function handleExecuteSign(downloadOnly = false): Promise<void> {
    signError = null;
    const identity = await ensureActiveIdentity();
    if (!identity) return;

    isSigning = true;
    try {
      const graphicUrl = await resolveAndPersistGraphicDataUrl();

      let visualOptions = undefined;
      if (isVisibleSignature) {
        const dims = resolveTargetPageDimensions(targetPageIndex);
        const canvasRect = resolveSignaturePresetRect(
          placementPosition,
          dims.widthPts,
          dims.heightPts
        );
        const pdfRect = canvasSignatureRectToPdfRect(canvasRect, dims.heightPts);

        visualOptions = {
          pageIndex: targetPageIndex,
          x: pdfRect.x,
          y: pdfRect.y,
          width: pdfRect.width,
          height: pdfRect.height,
          graphicDataUrl: graphicUrl,
          showTextDetails,
        };
      }

      const signOptions: SignPdfOptions = {
        identity: activeIdentity,
        signerName: activeIdentity.subject.commonName,
        reason: reason.trim() || undefined,
        location: location.trim() || undefined,
        contactInfo: contactInfo.trim() || undefined,
        signingTime: new Date(),
        visual: visualOptions,
        subFilter,
        tsaUrl: enableTimestamp && tsaUrl.trim() ? tsaUrl.trim() : undefined,
        embedDss,
      };

      const resultBytes = await actions.signActiveDocument(signOptions, canvasStore);
      signedPdfBytes = resultBytes;
      signSuccess = true;

      if (downloadOnly) {
        const outName = store.fileName.replace(/\.pdf$/i, '') + '_signed.pdf';
        downloadBytes(resultBytes, outName, 'application/pdf');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown signing failure.';
      console.error('Digital signing failed:', err);
      signError = `Digital signing failed: ${message}`;
    } finally {
      isSigning = false;
    }
  }

  function handleClose(): void {
    store.showCertSignDialog = false;
  }
</script>

<Dialog.Root open={store.showCertSignDialog} onOpenChange={(open) => { if (!open) handleClose(); }}>
  <Dialog.Content class="sm:max-w-[660px] max-h-[90vh] flex flex-col p-0 overflow-hidden">
    <Dialog.Header class="px-6 pt-5 pb-3 border-b border-border bg-card pr-12">
      <div class="flex items-center justify-between">
        <Dialog.Title class="flex items-center gap-2 text-base font-semibold">
          <ShieldCheck class="h-4 w-4 text-primary" />
          Sign with Digital Certificate (ISO 32000)
        </Dialog.Title>
        <Badge variant="outline" class="text-[10px] bg-primary/5 text-primary border-primary/20">
          PDF ISO 32000-1 / RFC 5652
        </Badge>
      </div>
      <Dialog.Description class="text-xs text-muted-foreground">
        Apply cryptographic detached PKCS#7 digital signatures with X.509 certificates and tamper protection.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex-1 overflow-y-auto px-6 py-4">
      {#if signSuccess}
        <div class="py-6 flex flex-col items-center justify-center text-center space-y-4">
          <div class="w-12 h-12 rounded-full bg-success/10 text-success flex items-center justify-center border border-success/30">
            <CheckCircle2 class="h-6 w-6" />
          </div>
          <div class="space-y-1">
            <h3 class="text-base font-semibold text-foreground">Document Digitally Signed Successfully</h3>
            <p class="text-xs text-muted-foreground max-w-[420px]">
              The document has been securely sealed with cryptographic PKCS#7 detached signature conforming to ISO 32000-1.
            </p>
          </div>

          <div class="w-full max-w-[460px] bg-muted/30 border border-border rounded-lg p-3 text-left space-y-1.5 text-xs">
            <div class="flex justify-between">
              <span class="text-muted-foreground">Signer:</span>
              <span class="font-medium">{activeIdentity?.subject.commonName}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">Reason:</span>
              <span>{reason || 'Approval'}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">SubFilter:</span>
              <span class="font-sans text-[11px]">{subFilter}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">PAdES Profile:</span>
              <span class="font-sans text-[11px] font-medium text-primary">
                {embedDss ? 'PAdES-B-LT (LTV)' : enableTimestamp ? 'PAdES-B-T (Timestamped)' : subFilter === 'ETSI.CAdES.detached' ? 'PAdES-B-B (Baseline)' : 'Legacy Adobe PKCS#7'}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">Digest:</span>
              <span class="font-sans text-[11px]">SHA-256</span>
            </div>
          </div>

          <div class="flex items-center gap-3 pt-2">
            {#if signedPdfBytes}
              <Button
                size="sm"
                class="text-xs"
                onclick={() => {
                  const outName = store.fileName.replace(/\.pdf$/i, '') + '_signed.pdf';
                  downloadBytes(signedPdfBytes!, outName, 'application/pdf');
                }}
              >
                <Download class="h-3.5 w-3.5 mr-1.5" /> Download Signed PDF
              </Button>
            {/if}
            <Button size="sm" variant="outline" class="text-xs" onclick={handleClose}>
              Done & View in Editor
            </Button>
          </div>
        </div>
      {:else}
        <Tabs.Root value={activeTab} onValueChange={(val) => (activeTab = val as typeof activeTab)}>
          <Tabs.List class="grid grid-cols-4 mb-4">
            <Tabs.Trigger value="cert" class="text-xs">
              <KeyRound class="h-3.5 w-3.5 mr-1" /> 1. Digital ID
            </Tabs.Trigger>
            <Tabs.Trigger value="details" class="text-xs" disabled={!activeIdentity}>
              <FileSignature class="h-3.5 w-3.5 mr-1" /> 2. Details
            </Tabs.Trigger>
            <Tabs.Trigger value="appearance" class="text-xs" disabled={!activeIdentity}>
              <Eye class="h-3.5 w-3.5 mr-1" /> 3. Visual
            </Tabs.Trigger>
            <Tabs.Trigger value="sign" class="text-xs" disabled={!activeIdentity}>
              <ShieldCheck class="h-3.5 w-3.5 mr-1" /> 4. Sign
            </Tabs.Trigger>
          </Tabs.List>

          <!-- Digital ID and certificate selection -->
          <Tabs.Content value="cert" class="space-y-4">
            <div class="flex gap-2 p-1 bg-muted/40 rounded-lg border border-border">
              <button
                type="button"
                class="flex-1 py-1.5 text-xs font-medium rounded-md transition-all {certMode === 'generate' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"
                onclick={() => (certMode = 'generate')}
              >
                Create New Digital ID
              </button>
              <button
                type="button"
                class="flex-1 py-1.5 text-xs font-medium rounded-md transition-all {certMode === 'import' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"
                onclick={() => (certMode = 'import')}
              >
                Upload .p12 / .pfx File
              </button>
            </div>

            {#if certMode === 'generate'}
              <div class="grid grid-cols-2 gap-3">
                <div class="col-span-2 space-y-1">
                  <Label for="cn-input" class="text-xs font-medium">Signer Full Name (Common Name) *</Label>
                  <Input id="cn-input" bind:value={commonName} placeholder="e.g. Jane Smith" class="h-8 text-xs" />
                </div>

                <div class="space-y-1">
                  <Label for="org-input" class="text-xs font-medium">Organization / Company</Label>
                  <Input id="org-input" bind:value={organization} placeholder="e.g. Acme Corp" class="h-8 text-xs" />
                </div>

                <div class="space-y-1">
                  <Label for="ou-input" class="text-xs font-medium">Department / Unit</Label>
                  <Input id="ou-input" bind:value={organizationalUnit} placeholder="e.g. Legal" class="h-8 text-xs" />
                </div>

                <div class="space-y-1">
                  <Label for="email-input" class="text-xs font-medium">Email Address</Label>
                  <Input id="email-input" type="email" bind:value={email} placeholder="signer@example.com" class="h-8 text-xs" />
                </div>

                <div class="space-y-1">
                  <Label for="country-input" class="text-xs font-medium">Country Code (2-letter)</Label>
                  <Input id="country-input" bind:value={country} maxlength={2} placeholder="US" class="h-8 text-xs uppercase" />
                </div>

                <div class="space-y-1">
                  <Label for="pwd-input" class="text-xs font-medium">Certificate Password *</Label>
                  <Input id="pwd-input" type="password" bind:value={certPassword} placeholder="Enter password to protect key" class="h-8 text-xs" />
                </div>

                <div class="space-y-1">
                  <Label class="text-xs font-medium">RSA Key Modulus</Label>
                  <Select.Root
                    type="single"
                    value={keySize.toString()}
                    onValueChange={(val) => { if (val === '2048' || val === '4096') keySize = parseInt(val, 10) as 2048 | 4096; }}
                  >
                    <Select.Trigger class="w-full h-8 text-xs">
                      {keySize === 2048 ? 'RSA 2048-bit (Standard)' : 'RSA 4096-bit (High Security)'}
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="2048" label="RSA 2048-bit (Standard)">RSA 2048-bit (Standard)</Select.Item>
                      <Select.Item value="4096" label="RSA 4096-bit (High Security)">RSA 4096-bit (High Security)</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </div>
              </div>

              <div class="pt-3 border-t border-border flex items-center justify-between">
                <div class="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Lock class="h-3 w-3 text-success" /> Keys are generated client-side inside your browser
                </div>
                <Button size="sm" class="text-xs" onclick={handleGenerateCertificate} disabled={!commonName.trim() || !certPassword || isGenerating}>
                  {#if isGenerating}
                    <Sparkles class="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating Keys...
                  {:else}
                    Generate & Proceed
                  {/if}
                </Button>
              </div>
            {:else}
              <div class="space-y-3">
                <div class="border-2 border-dashed border-border rounded-lg p-6 text-center space-y-2">
                  <Upload class="h-6 w-6 text-muted-foreground mx-auto stroke-1" />
                  <div class="text-xs font-medium">Select PKCS#12 (.p12 / .pfx) Certificate File</div>
                  <input
                    type="file"
                    accept=".p12,.pfx,application/x-pkcs12"
                    onchange={(e) => {
                      importedP12File = (e.target as HTMLInputElement).files?.[0] || null;
                    }}
                    class="text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:bg-primary file:text-primary-foreground"
                  />
                </div>

                <div class="space-y-1">
                  <Label for="import-pwd" class="text-xs font-medium">Certificate Password</Label>
                  <Input id="import-pwd" type="password" bind:value={importPassword} placeholder="Enter password to unlock private key" class="h-8 text-xs" />
                </div>

                {#if importError}
                  <div class="text-xs text-destructive flex items-center gap-1.5 p-2 bg-destructive/10 rounded border border-destructive/20">
                    <AlertCircle class="h-3.5 w-3.5 shrink-0" /> {importError}
                  </div>
                {/if}

                <div class="pt-2 border-t border-border flex justify-end">
                  <Button size="sm" class="text-xs" onclick={handleImportP12} disabled={!importedP12File}>
                    Unlock & Proceed
                  </Button>
                </div>
              </div>
            {/if}
          </Tabs.Content>

          <!-- Signature metadata and reasons -->
          <Tabs.Content value="details" class="space-y-4">
            {#if activeIdentity}
              <div class="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1 text-xs">
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-primary flex items-center gap-1.5">
                    <ShieldCheck class="h-4 w-4 text-primary" />
                    Digital Identity Ready: {activeIdentity.subject.commonName}
                  </span>
                  <Button size="sm" variant="ghost" class="h-6 text-[11px] px-2 text-primary" onclick={handleExportP12}>
                    <Download class="h-3 w-3 mr-1" /> Export .p12
                  </Button>
                </div>
                <div class="text-[11px] text-muted-foreground">
                  Valid from {activeIdentity.validFrom.toLocaleDateString()} to {activeIdentity.validTo.toLocaleDateString()}
                </div>
              </div>
            {/if}

            <div class="space-y-3">
              <div class="space-y-1">
                <Label class="text-xs font-medium">Signing Reason</Label>
                <Select.Root
                  type="single"
                  value={reason}
                  onValueChange={(val) => { if (val) reason = val; }}
                >
                  <Select.Trigger class="w-full h-8 text-xs mb-1.5">
                    {reason || "Select a signing reason..."}
                  </Select.Trigger>
                  <Select.Content>
                    {#each reasonPresets as preset}
                      <Select.Item value={preset} label={preset}>{preset}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
                <Input bind:value={reason} placeholder="Or enter custom signing reason..." class="h-8 text-xs" />
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1">
                  <Label for="loc-input" class="text-xs font-medium">Signing Location</Label>
                  <Input id="loc-input" bind:value={location} placeholder="e.g. City, Country" class="h-8 text-xs" />
                </div>

                <div class="space-y-1">
                  <Label for="contact-input" class="text-xs font-medium">Signer Contact Info</Label>
                  <Input id="contact-input" bind:value={contactInfo} placeholder="Email or Phone" class="h-8 text-xs" />
                </div>
              </div>

              <!-- Standards and Security Configuration -->
              <div class="space-y-3 pt-2 border-t border-border">
                <div class="space-y-1">
                  <div class="flex items-center justify-between">
                    <Label class="text-xs font-medium">Signature Standard and SubFilter</Label>
                    <Badge variant="outline" class="text-[10px] bg-primary/5 text-primary border-primary/20">
                      ETSI EN 319 142
                    </Badge>
                  </div>
                  <Select.Root
                    type="single"
                    value={subFilter}
                    onValueChange={(val) => { if (val === 'ETSI.CAdES.detached' || val === 'adbe.pkcs7.detached') subFilter = val; }}
                  >
                    <Select.Trigger class="w-full h-8 text-xs">
                      {subFilter === 'ETSI.CAdES.detached' ? 'PAdES Baseline (ETSI.CAdES.detached) - Recommended' : 'Adobe Legacy (adbe.pkcs7.detached)'}
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="ETSI.CAdES.detached" label="PAdES Baseline (ETSI.CAdES.detached) - Recommended">
                        PAdES Baseline (ETSI.CAdES.detached) - Recommended
                      </Select.Item>
                      <Select.Item value="adbe.pkcs7.detached" label="Adobe Legacy (adbe.pkcs7.detached)">
                        Adobe Legacy (adbe.pkcs7.detached)
                      </Select.Item>
                    </Select.Content>
                  </Select.Root>
                  <p class="text-[10px] text-muted-foreground">
                    PAdES embeds CAdES signingCertificateV2 (RFC 5035) cryptographically binding certificate hashes.
                  </p>
                </div>

                <div class="space-y-2 p-2.5 bg-muted/20 border border-border rounded-lg text-xs">
                  <div class="flex items-center justify-between">
                    <div>
                      <span class="font-medium block text-xs">RFC 3161 Qualified Timestamp (PAdES B-T)</span>
                      <span class="text-[10px] text-muted-foreground">Applies authentic cryptographic time from a Time Stamping Authority.</span>
                    </div>
                    <Checkbox bind:checked={enableTimestamp} />
                  </div>

                  {#if enableTimestamp}
                    <div class="space-y-1 pt-1">
                      <Label for="tsa-url" class="text-[11px] font-medium">TSA Server URL</Label>
                      <Input id="tsa-url" bind:value={tsaUrl} placeholder="https://freetsa.org/tsr" class="h-7 text-xs font-sans" />
                    </div>
                  {/if}
                </div>

                <div class="flex items-center justify-between p-2.5 bg-muted/20 border border-border rounded-lg text-xs">
                  <div>
                    <span class="font-medium block text-xs">Long-Term Validation Store (/DSS)</span>
                    <span class="text-[10px] text-muted-foreground">Embeds Document Security Store dictionaries for PAdES B-LT compliance.</span>
                  </div>
                  <Checkbox bind:checked={embedDss} />
                </div>
              </div>
            </div>

            <div class="pt-3 border-t border-border flex justify-between">
              <Button size="sm" variant="outline" class="text-xs" onclick={() => (activeTab = 'cert')}>
                Back
              </Button>
              <Button size="sm" class="text-xs" onclick={() => (activeTab = 'appearance')}>
                Next: Visual Options
              </Button>
            </div>
          </Tabs.Content>

          <!-- Visual appearance and placement -->
          <Tabs.Content value="appearance" class="space-y-4">
            <div class="flex items-center justify-between p-3 bg-muted/20 border border-border rounded-lg">
              <div>
                <div class="text-xs font-semibold">Render Visual Signature on Document</div>
                <div class="text-[11px] text-muted-foreground">Places an Adobe-style signature seal badge on the target page.</div>
              </div>
              <Switch bind:checked={isVisibleSignature} aria-label="Render Visual Signature on Document" />
            </div>

            {#if isVisibleSignature}
              <div class="space-y-3">
                <div class="grid grid-cols-2 gap-3">
                  <div class="space-y-1">
                    <Label class="text-xs font-medium">Target Page</Label>
                    <Select.Root
                      type="single"
                      value={targetPageIndex.toString()}
                      onValueChange={(val) => { if (val) targetPageIndex = parseInt(val, 10); }}
                    >
                      <Select.Trigger class="w-full h-8 text-xs">
                        Page {targetPageIndex + 1}
                      </Select.Trigger>
                      <Select.Content>
                        {#each Array.from({ length: store.pageCount }, (_, i) => i) as pIdx}
                          <Select.Item value={pIdx.toString()} label="Page {pIdx + 1}">
                            Page {pIdx + 1}
                          </Select.Item>
                        {/each}
                      </Select.Content>
                    </Select.Root>
                  </div>

                  <div class="space-y-1">
                    <Label class="text-xs font-medium">Placement Position</Label>
                    <Select.Root
                      type="single"
                      value={placementPosition}
                      onValueChange={(val) => { if (val === 'bottom-right' || val === 'bottom-left' || val === 'center') placementPosition = val; }}
                    >
                      <Select.Trigger class="w-full h-8 text-xs">
                        {placementPosition === 'bottom-right' ? 'Bottom Right of Page' : placementPosition === 'bottom-left' ? 'Bottom Left of Page' : 'Center of Page'}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="bottom-right" label="Bottom Right of Page">Bottom Right of Page</Select.Item>
                        <Select.Item value="bottom-left" label="Bottom Left of Page">Bottom Left of Page</Select.Item>
                        <Select.Item value="center" label="Center of Page">Center of Page</Select.Item>
                      </Select.Content>
                    </Select.Root>
                  </div>
                </div>

                <div class="flex items-center justify-between p-2.5 bg-muted/20 border border-border rounded-lg">
                  <div>
                    <div class="text-xs font-semibold">Include Signer Metadata Text</div>
                    <div class="text-[11px] text-muted-foreground">Renders common name, signature date, and signing reason beside artwork.</div>
                  </div>
                  <Switch bind:checked={showTextDetails} aria-label="Include Signer Metadata Text" />
                </div>

                {#if savedSignatures.length > 0}
                  <div class="space-y-1.5">
                    <Label class="text-xs font-medium">Include Handwritten Signature Artwork (Optional)</Label>
                    <div class="grid grid-cols-3 gap-2 max-h-[100px] overflow-y-auto">
                      <button
                        type="button"
                        class="border rounded p-2 text-center text-xs flex items-center justify-center {selectedGraphicSigId === null ? 'border-primary bg-primary/5 font-medium' : 'border-border'}"
                        onclick={() => (selectedGraphicSigId = null)}
                      >
                        Text Only Seal
                      </button>
                      {#each savedSignatures as s}
                        <button
                          type="button"
                          class="border rounded p-1 flex items-center justify-center h-12 bg-card {selectedGraphicSigId === s.id ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-border'}"
                          onclick={() => (selectedGraphicSigId = s.id)}
                        >
                          <img src={s.dataUrl} alt={s.title} class="max-h-full max-w-full object-contain" />
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}

                <!-- Live Preview of Visual Signature -->
                <div class="space-y-1 pt-1">
                  <Label class="text-xs text-muted-foreground">Live Signature Appearance Preview</Label>
                  <div class="h-20 bg-sky-50/50 dark:bg-slate-900 border border-blue-400/80 rounded p-2.5 flex items-center gap-3">
                    {#if selectedGraphicSigId}
                      {@const chosen = savedSignatures.find((s) => s.id === selectedGraphicSigId)}
                      {#if chosen}
                        <div class="w-24 h-full flex items-center justify-center shrink-0 border-r border-blue-200 dark:border-blue-900 pr-2">
                          <img src={chosen.dataUrl} alt="Signature" class="max-h-full max-w-full object-contain" />
                        </div>
                      {/if}
                    {/if}
                    {#if showTextDetails}
                      <div class="flex-1 text-[11px] leading-tight space-y-0.5 text-slate-800 dark:text-slate-200">
                        <div class="text-[10px] text-muted-foreground">Digitally signed by:</div>
                        <div class="font-bold text-slate-900 dark:text-slate-100">{activeIdentity?.subject.commonName || 'Signer Name'}</div>
                        <div class="text-[10px] text-muted-foreground truncate">Date: {new Date().toLocaleDateString()} | Reason: {reason || 'Approved'}</div>
                        {#if location}
                          <div class="text-[10px] text-muted-foreground truncate">Location: {location}</div>
                        {/if}
                      </div>
                    {:else if !selectedGraphicSigId}
                      <div class="flex-1 text-[11px] text-muted-foreground italic">
                        Enable metadata text or select a graphic signature to display on page.
                      </div>
                    {/if}
                  </div>
                </div>
              </div>
            {:else}
              <div class="p-6 text-center text-xs text-muted-foreground bg-muted/20 rounded-lg border border-border">
                <EyeOff class="h-6 w-6 mx-auto mb-2 opacity-50" />
                The digital signature will be embedded in the PDF dictionary stream and AcroForm structure without modifying the visible appearance of the page.
              </div>
            {/if}

            <div class="pt-3 border-t border-border flex justify-between">
              <Button size="sm" variant="outline" class="text-xs" onclick={() => (activeTab = 'details')}>
                Back
              </Button>
              <Button size="sm" class="text-xs" onclick={() => (activeTab = 'sign')}>
                Next: Review & Sign
              </Button>
            </div>
          </Tabs.Content>

          <!-- Review and sign summary -->
          <Tabs.Content value="sign" class="space-y-4">
            <div class="bg-card border border-border rounded-lg p-4 space-y-3 text-xs">
              <div class="font-semibold text-foreground flex items-center gap-1.5 pb-2 border-b border-border">
                <ShieldCheck class="h-4 w-4 text-success" />
                ISO 32000 Signature Summary
              </div>

              <div class="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span class="text-muted-foreground">Signer:</span>
                  <div class="font-medium">{activeIdentity?.subject.commonName}</div>
                </div>
                <div>
                  <span class="text-muted-foreground">Organization:</span>
                  <div>{activeIdentity?.subject.organization || 'None'}</div>
                </div>
                <div>
                  <span class="text-muted-foreground">Digest Algorithm:</span>
                  <div class="font-sans">SHA-256</div>
                </div>
                <div>
                  <span class="text-muted-foreground">Signature Standard:</span>
                  <div class="font-sans font-medium">{subFilter}</div>
                </div>
                <div>
                  <span class="text-muted-foreground">PAdES Profile:</span>
                  <div class="font-sans font-medium text-primary">
                    {embedDss ? 'PAdES-B-LT (LTV)' : enableTimestamp ? 'PAdES-B-T' : subFilter === 'ETSI.CAdES.detached' ? 'PAdES-B-B' : 'Legacy Adobe'}
                  </div>
                </div>
                <div>
                  <span class="text-muted-foreground">Timestamping:</span>
                  <div>{enableTimestamp ? 'RFC 3161 TSA Token' : 'Local Declared Time'}</div>
                </div>
                <div>
                  <span class="text-muted-foreground">Certificate Chain:</span>
                  <div>{activeIdentity?.certificateChain?.length || 1} Certificate(s)</div>
                </div>
                <div>
                  <span class="text-muted-foreground">Visual Badge:</span>
                  <div>{isVisibleSignature ? `Visible on Page ${targetPageIndex + 1}` : 'Invisible (Stream only)'}</div>
                </div>
                <div>
                  <span class="text-muted-foreground">Reason:</span>
                  <div class="truncate">{reason || 'Approval'}</div>
                </div>
              </div>
            </div>

            {#if signError}
              <div class="text-xs text-destructive flex items-center gap-1.5 p-2.5 bg-destructive/10 rounded border border-destructive/20">
                <AlertCircle class="h-4 w-4 shrink-0" /> {signError}
              </div>
            {/if}

            <div class="pt-3 border-t border-border flex items-center justify-between">
              <Button size="sm" variant="outline" class="text-xs" onclick={() => (activeTab = 'appearance')}>
                Back
              </Button>
              <div class="flex items-center gap-2">
                <Button size="sm" variant="outline" class="text-xs" onclick={() => handleExecuteSign(true)} disabled={isSigning}>
                  <Download class="h-3.5 w-3.5 mr-1" /> Sign & Download
                </Button>
                <Button size="sm" class="text-xs bg-success hover:bg-success/90 text-success-foreground" onclick={() => handleExecuteSign(false)} disabled={isSigning}>
                  {#if isSigning}
                    <Sparkles class="h-3.5 w-3.5 mr-1.5 animate-spin" /> Signing PDF...
                  {:else}
                    <ShieldCheck class="h-3.5 w-3.5 mr-1.5" /> Sign & Apply to Document
                  {/if}
                </Button>
              </div>
            </div>
          </Tabs.Content>
        </Tabs.Root>
      {/if}
    </div>

    <Dialog.Footer class="px-6 py-3 border-t border-border bg-card flex justify-between items-center">
      <div class="text-[11px] text-muted-foreground">
        Complies with Adobe PPKLite & ISO 32000 specifications.
      </div>
      <Button variant="outline" size="sm" class="text-xs" onclick={handleClose}>
        Cancel
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
