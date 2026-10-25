<script lang="ts">
  import { onMount } from 'svelte';
  import TooltipProvider from '$lib/components/ui/tooltip/tooltip-provider.svelte';
  import { EditorStore, provideEditorStore } from './stores/editor.svelte';
  import { EditorActions, provideEditorActions } from './stores/editor-actions';
  import { CanvasStore, provideCanvasStore } from './stores/canvas.svelte';
  import { CanvasActions, provideCanvasActions } from './stores/canvas-actions';
  import { HistoryStore, provideHistoryStore } from './stores/history.svelte';
  import { PdfEditorService } from './services/pdf-editor';
  import { ElementRegistry, provideElementRegistry } from './core/element-registry';
  import { registerBuiltinElements } from './elements';
  import { ToolRegistry, provideToolRegistry } from './core/tool-registry';
  import { registerBuiltinTools } from './tools';
  import { PanelRegistry, providePanelRegistry } from './core/panel-registry';
  import { registerBuiltinPanels } from './panels/registry';
  import { ExportRegistry, provideExportRegistry } from './core/export-registry';
  import { registerBuiltinExporters } from './services/export';
  import { PluginManager, providePluginManager } from './core/plugin-manager';
  import { registerBuiltinPlugins } from './plugins';
  import { FeatureFlagStore, provideFeatureFlagStore } from './core/feature-flags';

  import EditorShell from './components/layout/EditorShell.svelte';
  import NavRail from './components/layout/NavRail.svelte';
  import LeftPanel from './components/layout/LeftPanel.svelte';
  import Canvas from './components/canvas/Canvas.svelte';
  import RightPanel from './components/layout/RightPanel.svelte';
  import SplitPagesDialog from './components/dialogs/SplitPagesDialog.svelte';
  import ExportImagesDialog from './components/dialogs/ExportImagesDialog.svelte';
  import CompressDocumentDialog from './components/dialogs/CompressDocumentDialog.svelte';
  import SanitizeDocumentDialog from './components/dialogs/SanitizeDocumentDialog.svelte';
  import ImpositionDialog from './components/dialogs/ImpositionDialog.svelte';
  import ToolMockupDialog from './components/dialogs/ToolMockupDialog.svelte';
  import EsignDialog from './components/dialogs/EsignDialog.svelte';
  import CertSignDialog from './components/dialogs/CertSignDialog.svelte';
  import ValidateSignatureDialog from './components/dialogs/ValidateSignatureDialog.svelte';
  import WebMcpConfirmDialog from './components/dialogs/WebMcpConfirmDialog.svelte';
  import OpenUrlDialog from './components/dialogs/OpenUrlDialog.svelte';
  import ConvertDocumentDialog from './components/dialogs/ConvertDocumentDialog.svelte';
  import OcrDialog from './components/dialogs/OcrDialog.svelte';
  import PageScaleDialog from './components/dialogs/PageScaleDialog.svelte';
  import PasswordPromptDialog from './components/dialogs/PasswordPromptDialog.svelte';
  import PermissionsDialog from './components/dialogs/PermissionsDialog.svelte';
  import QrBarcodeModal from './components/dialogs/QrBarcodeModal.svelte';
  import ComponentGalleryDialog from './components/dialogs/ComponentGalleryDialog.svelte';
  import AdjustColorsDialog from './components/dialogs/AdjustColorsDialog.svelte';
  import PageNumberingDialog from './components/dialogs/PageNumberingDialog.svelte';
  import { inspectFileInfo } from './utils/file-type-detector';
  import { WebMcpStore, provideWebMcpStore } from './stores/webmcp.svelte';
  import { PwaStore, providePwaStore } from './stores/pwa.svelte';
  import PwaNotification from './components/common/PwaNotification.svelte';
  import { WebMcpManager } from './core/webmcp/webmcp-manager';
  import {
    parseDocumentLoadRequest,
    listenToUrlChanges,
  } from './services/url-document-loader';

  import { setupKeyboardShortcuts } from './utils/keyboard-shortcuts';

  const store = new EditorStore();
  const historyStore = new HistoryStore();
  const canvasStore = new CanvasStore();
  const elementRegistry = new ElementRegistry();
  registerBuiltinElements(elementRegistry);

  const toolRegistry = new ToolRegistry();
  registerBuiltinTools(toolRegistry);

  const panelRegistry = new PanelRegistry();
  registerBuiltinPanels(panelRegistry);

  const exportRegistry = new ExportRegistry();
  registerBuiltinExporters(exportRegistry);

  const service = new PdfEditorService(store.workspaceFiles, elementRegistry);
  const actions = new EditorActions(store, service, historyStore, canvasStore, toolRegistry, exportRegistry);
  const canvasActions = new CanvasActions(canvasStore, actions, elementRegistry);
  actions.setCanvasActions(canvasActions);

  const pluginManager = new PluginManager(
    elementRegistry,
    toolRegistry,
    panelRegistry,
    exportRegistry,
    store,
    canvasStore,
    actions,
  );
  void registerBuiltinPlugins(pluginManager);

  const featureFlags = new FeatureFlagStore();
  actions.setFeatureFlags(featureFlags);

  const webMcpStore = new WebMcpStore();
  provideWebMcpStore(webMcpStore);

  const webMcpManager = new WebMcpManager(
    service,
    store,
    canvasStore,
    actions,
    historyStore,
    webMcpStore
  );

  provideEditorStore(store);
  provideHistoryStore(historyStore);
  provideEditorActions(actions);
  provideCanvasStore(canvasStore);
  provideCanvasActions(canvasActions);
  provideElementRegistry(elementRegistry);
  provideToolRegistry(toolRegistry);
  providePanelRegistry(panelRegistry);
  provideExportRegistry(exportRegistry);
  providePluginManager(pluginManager);
  provideFeatureFlagStore(featureFlags);

  const pwaStore = new PwaStore();
  providePwaStore(pwaStore);

  let fileInputEl: HTMLInputElement | null = $state(null);
  let mergeFileInputEl: HTMLInputElement | null = $state(null);
  let imageFileInputEl: HTMLInputElement | null = $state(null);
  let imageAsPageFileInputEl: HTMLInputElement | null = $state(null);
  let videoFileInputEl: HTMLInputElement | null = $state(null);
  let audioFileInputEl: HTMLInputElement | null = $state(null);
  let threeDFileInputEl: HTMLInputElement | null = $state(null);
  let attachmentFileInputEl: HTMLInputElement | null = $state(null);
  let mergeFilesInputEl: HTMLInputElement | null = $state(null);
  let quickConvertFileInputEl: HTMLInputElement | null = $state(null);

  onMount(() => {
    actions.fileInputEl = fileInputEl;
    actions.mergeFileInputEl = mergeFileInputEl;
    actions.imageFileInputEl = imageFileInputEl;
    actions.imageAsPageFileInputEl = imageAsPageFileInputEl;
    actions.videoFileInputEl = videoFileInputEl;
    actions.audioFileInputEl = audioFileInputEl;
    actions.threeDFileInputEl = threeDFileInputEl;
    actions.attachmentFileInputEl = attachmentFileInputEl;
    actions.mergeFilesInputEl = mergeFilesInputEl;
    actions.quickConvertFileInputEl = quickConvertFileInputEl;

    actions.setTool('select');
    actions.setPluginManager(pluginManager);

    const cleanupShortcuts = setupKeyboardShortcuts(store, actions, canvasStore);

    const cleanupUrl = listenToUrlChanges(async (req) => {
      if (req.kind === 'preset') {
        await actions.loadDemoDocument(req.presetId);
      } else if (req.kind === 'presets') {
        await actions.loadDemoDocuments(req.presetIds);
      } else if (req.kind === 'url') {
        await actions.loadDocumentFromUrl(req.url);
      }
      webMcpManager.rebuildSdg();
    });

    const unsubLoaded = pluginManager.on('document:loaded', () => {
      void webMcpManager.registerAllTools();
    });
    const unsubClosed = pluginManager.on('document:closed', () => {
      webMcpManager.unregisterAllTools();
    });

    // note: register webmcp tools immediately so agents discover them without delay
    void webMcpManager.initialize();
    void pwaStore.checkForUpdates();

    const currentUrlStr = typeof window !== 'undefined' ? window.location.href : '';
    const req = parseDocumentLoadRequest(currentUrlStr);
    if (req) {
      void actions.initializeEngine().then(async () => {
        if (req.kind === 'preset') {
          await actions.loadDemoDocument(req.presetId);
        } else if (req.kind === 'presets') {
          await actions.loadDemoDocuments(req.presetIds);
        } else if (req.kind === 'url') {
          await actions.loadDocumentFromUrl(req.url);
        }
        webMcpManager.rebuildSdg();
      });
    } else {
      // note: defer background wasm engine initialisation to idle time so initial paint and critical assets are not blocked
      const scheduleIdle = typeof window !== 'undefined' && 'requestIdleCallback' in window
        ? (cb: () => void) => (window as Window).requestIdleCallback(cb, { timeout: 1500 })
        : (cb: () => void) => setTimeout(cb, 1200);
      scheduleIdle(() => {
        void actions.initializeEngine();
      });
    }

    return () => {
      cleanupShortcuts();
      cleanupUrl();
      unsubLoaded();
      unsubClosed();
      webMcpManager.dispose();
      pwaStore.dispose();
    };
  });

  function handleFileSelected(e: Event): void {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      actions.loadDocumentsFromFiles(Array.from(target.files));
    }
    target.value = '';
  }

  function handleMergeFileSelected(e: Event): void {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      actions.mergePdfsFromFiles(Array.from(target.files), store.currentPageIndex + 1);
    }
    target.value = '';
  }

  function handleMediaImportSelected(e: Event): void {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const files = Array.from(target.files);
      for (const file of files) {
        const info = inspectFileInfo(file);
        const objectUrl = URL.createObjectURL(file);

        let defaultWidth = 200;
        let defaultHeight = 150;
        if (info.category === 'video') {
          defaultWidth = 280;
          defaultHeight = 180;
        } else if (info.category === 'audio') {
          defaultWidth = 240;
          defaultHeight = 60;
        } else if (info.category === '3d') {
          defaultWidth = 220;
          defaultHeight = 180;
        } else if (info.category === 'attachment') {
          defaultWidth = 180;
          defaultHeight = 48;
        }

        let centerX = 300;
        let centerY = 400;
        try {
          const dims = actions.service.document?.getPage(store.currentPageIndex)?.getDimensions();
          if (dims) {
            centerX = Math.max(0, (dims.widthPts - defaultWidth) / 2);
            centerY = Math.max(0, (dims.heightPts - defaultHeight) / 2);
          }
        } catch {
          // Fallback coordinates
        }

        if (info.category === 'image') {
          canvasActions.createElement('image', store.currentPageIndex, centerX, centerY, {
            src: objectUrl,
            width: defaultWidth,
            height: defaultHeight,
          });
        } else if (info.category === 'video') {
          canvasActions.createElement('video', store.currentPageIndex, centerX, centerY, {
            src: objectUrl,
            fileName: info.fileName,
            fileSize: info.fileSize,
            mimeType: info.mimeType,
            title: info.title,
            width: defaultWidth,
            height: defaultHeight,
          });
        } else if (info.category === 'audio') {
          canvasActions.createElement('audio', store.currentPageIndex, centerX, centerY, {
            src: objectUrl,
            fileName: info.fileName,
            fileSize: info.fileSize,
            mimeType: info.mimeType,
            title: info.title,
            width: defaultWidth,
            height: defaultHeight,
          });
        } else if (info.category === '3d') {
          canvasActions.createElement('3d', store.currentPageIndex, centerX, centerY, {
            src: objectUrl,
            fileName: info.fileName,
            fileSize: info.fileSize,
            mimeType: info.mimeType,
            modelFormat: info.modelFormat || 'u3d',
            title: info.title,
            width: defaultWidth,
            height: defaultHeight,
          });
        } else {
          canvasActions.createElement('attachment', store.currentPageIndex, centerX, centerY, {
            src: objectUrl,
            fileName: info.fileName,
            fileSize: info.fileSize,
            mimeType: info.mimeType,
            description: info.description,
            width: defaultWidth,
            height: defaultHeight,
          });
        }
      }
    }
    target.value = '';
  }

  function handleImageImportSelected(e: Event): void {
    handleMediaImportSelected(e);
  }

  function handleImageAsPageImportSelected(e: Event): void {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const files = Array.from(target.files);
      actions.importImagesFromFiles(files, store.currentPageIndex + 1);
    }
    target.value = '';
  }

  function handleMergeFilesSelected(e: Event): void {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      void actions.mergeAndLoadFiles(Array.from(target.files));
    }
    target.value = '';
  }

  function handleQuickConvertFilesSelected(e: Event): void {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      void actions.quickConvertFiles(Array.from(target.files));
    }
    target.value = '';
  }
</script>

<input
  bind:this={fileInputEl}
  type="file"
  multiple
  accept=".pdf,application/pdf,image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.docx,.xlsx,.xls,.csv,.tsv,.pptx,.ppt,.txt,.md,.markdown,.json,.xml,.html,.htm,.rtf,.yaml,.yml,.log"
  onchange={handleFileSelected}
  class="hidden"
/>

<input
  bind:this={mergeFileInputEl}
  type="file"
  multiple
  accept=".pdf,application/pdf,image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.docx,.xlsx,.xls,.csv,.tsv,.pptx,.ppt,.txt,.md,.markdown,.json,.xml,.html,.rtf,.yaml,.yml,.log"
  onchange={handleMergeFileSelected}
  class="hidden"
/>

<input
  bind:this={imageFileInputEl}
  type="file"
  multiple
  accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.ico,.tiff"
  onchange={handleImageImportSelected}
  class="hidden"
/>

<input
  bind:this={videoFileInputEl}
  type="file"
  multiple
  accept="video/*,.mp4,.webm,.mov,.mkv,.avi,.m4v"
  onchange={handleMediaImportSelected}
  class="hidden"
/>

<input
  bind:this={audioFileInputEl}
  type="file"
  multiple
  accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.wma"
  onchange={handleMediaImportSelected}
  class="hidden"
/>

<input
  bind:this={threeDFileInputEl}
  type="file"
  multiple
  accept=".u3d,.prc,.obj,.stl,.gltf,.glb,.3ds,.dae,model/*"
  onchange={handleMediaImportSelected}
  class="hidden"
/>

<input
  bind:this={attachmentFileInputEl}
  type="file"
  multiple
  accept="*/*"
  onchange={handleMediaImportSelected}
  class="hidden"
/>

<input
  bind:this={imageAsPageFileInputEl}
  type="file"
  multiple
  accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg"
  onchange={handleImageAsPageImportSelected}
  class="hidden"
/>

<input
  bind:this={mergeFilesInputEl}
  type="file"
  multiple
  accept=".pdf,application/pdf,image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.docx,.xlsx,.xls,.csv,.tsv,.pptx,.ppt,.txt,.md,.markdown,.json,.xml,.html,.rtf,.yaml,.yml,.log"
  onchange={handleMergeFilesSelected}
  class="hidden"
/>

<input
  bind:this={quickConvertFileInputEl}
  type="file"
  multiple
  accept=".pdf,application/pdf,image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.docx,.xlsx,.xls,.csv,.tsv,.pptx,.ppt,.txt,.md,.markdown,.json,.xml,.html,.rtf,.yaml,.yml,.log"
  onchange={handleQuickConvertFilesSelected}
  class="hidden"
/>

<TooltipProvider>
  <a
    href="#main-canvas-viewport"
    class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:ring-2 focus:ring-ring focus:outline-none"
  >
    Skip to main content
  </a>
  <EditorShell>
    {#snippet navRail()}
      <NavRail />
    {/snippet}

    {#snippet leftPanel()}
      <LeftPanel />
    {/snippet}

    {#snippet canvas()}
      <Canvas />
    {/snippet}

    {#snippet rightPanel()}
      <RightPanel />
    {/snippet}
  </EditorShell>
</TooltipProvider>

{#if (featureFlags.isEnabled('split') || featureFlags.isEnabled('extraction.pages')) && store.splitDialogMode !== null}
  <SplitPagesDialog mode={store.splitDialogMode} onClose={() => (store.splitDialogMode = null)} />
{/if}

{#if (featureFlags.isEnabled('export-images') || featureFlags.isEnabled('export.images') || featureFlags.isEnabled('extraction.images') || featureFlags.isEnabled('page-actions.extract-images')) && store.showExportImagesDialog}
  <ExportImagesDialog onClose={() => (store.showExportImagesDialog = false)} />
{/if}

{#if featureFlags.isEnabled('sanitization') || featureFlags.isEnabled('redaction.sanitize') || featureFlags.isEnabled('page-actions.sanitize')}
  <SanitizeDocumentDialog />
{/if}
{#if featureFlags.isEnabled('compression') || featureFlags.isEnabled('page-actions.compress')}
  <CompressDocumentDialog />
{/if}
{#if featureFlags.isEnabled('ocr')}
  <OcrDialog />
{/if}
{#if featureFlags.isEnabled('redaction.colors')}
  <AdjustColorsDialog />
{/if}
{#if featureFlags.isEnabled('page-numbers')}
  <PageNumberingDialog />
{/if}

{#if featureFlags.isEnabled('imposition') && store.showImpositionDialog}
  <ImpositionDialog
    open={store.showImpositionDialog}
    onClose={() => (store.showImpositionDialog = false)}
    initialMode={store.impositionInitialMode}
  />
{/if}

<ToolMockupDialog />
{#if featureFlags.isEnabled('components.gallery')}
  <ComponentGalleryDialog />
{/if}
{#if featureFlags.isEnabled('components.media.barcode')}
  <QrBarcodeModal />
{/if}
{#if featureFlags.isEnabled('signatures.esign')}
  <EsignDialog />
{/if}
{#if featureFlags.isEnabled('signatures.cert-sign')}
  <CertSignDialog />
{/if}
{#if featureFlags.isEnabled('signatures.validate')}
  <ValidateSignatureDialog />
{/if}
{#if featureFlags.isEnabled('webmcp')}
  <WebMcpConfirmDialog />
{/if}
{#if featureFlags.isEnabled('workspace.compliance') && featureFlags.isEnabled('compliance')}
  <OpenUrlDialog />
{/if}
{#if featureFlags.isEnabled('conversion')}
  <ConvertDocumentDialog />
{/if}
{#if featureFlags.isEnabled('page-actions.scale')}
  <PageScaleDialog />
{/if}
<PasswordPromptDialog />
{#if featureFlags.isEnabled('security.permissions')}
  <PermissionsDialog />
{/if}

<PwaNotification />
