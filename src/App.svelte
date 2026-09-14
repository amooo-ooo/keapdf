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
  import DocumentInfoDialog from './components/dialogs/DocumentInfoDialog.svelte';
  import ToolMockupDialog from './components/dialogs/ToolMockupDialog.svelte';
  import EsignDialog from './components/dialogs/EsignDialog.svelte';
  import CertSignDialog from './components/dialogs/CertSignDialog.svelte';
  import ValidateSignatureDialog from './components/dialogs/ValidateSignatureDialog.svelte';
  import WebMcpConfirmDialog from './components/dialogs/WebMcpConfirmDialog.svelte';
  import OpenUrlDialog from './components/dialogs/OpenUrlDialog.svelte';
  import ConvertDocumentDialog from './components/dialogs/ConvertDocumentDialog.svelte';
  import OcrDialog from './components/dialogs/OcrDialog.svelte';
  import PageScaleDialog from './components/dialogs/PageScaleDialog.svelte';
  import { WebMcpStore, provideWebMcpStore } from './stores/webmcp.svelte';
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

  let fileInputEl: HTMLInputElement | null = $state(null);
  let mergeFileInputEl: HTMLInputElement | null = $state(null);
  let imageFileInputEl: HTMLInputElement | null = $state(null);
  let imageAsPageFileInputEl: HTMLInputElement | null = $state(null);
  let mergeFilesInputEl: HTMLInputElement | null = $state(null);

  onMount(() => {
    actions.fileInputEl = fileInputEl;
    actions.mergeFileInputEl = mergeFileInputEl;
    actions.imageFileInputEl = imageFileInputEl;
    actions.imageAsPageFileInputEl = imageAsPageFileInputEl;
    actions.mergeFilesInputEl = mergeFilesInputEl;

    actions.setTool('select');
    actions.setPluginManager(pluginManager);

    const cleanupShortcuts = setupKeyboardShortcuts(store, actions, canvasStore);

    const cleanupUrl = listenToUrlChanges(async (req) => {
      if (req.kind === 'preset') {
        await actions.loadDemoDocument(req.presetId);
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

    // Register all 54 tools immediately so agents can discover them without delay
    void webMcpManager.initialize();

    actions.initializeEngine().then(async () => {
      const currentUrlStr = typeof window !== 'undefined' ? window.location.href : '';
      const req = parseDocumentLoadRequest(currentUrlStr);
      if (req) {
        if (req.kind === 'preset') {
          await actions.loadDemoDocument(req.presetId);
        } else if (req.kind === 'url') {
          await actions.loadDocumentFromUrl(req.url);
        }
        webMcpManager.rebuildSdg();
      }
    });

    return () => {
      cleanupShortcuts();
      cleanupUrl();
      unsubLoaded();
      unsubClosed();
      webMcpManager.dispose();
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

  function handleImageImportSelected(e: Event): void {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const files = Array.from(target.files);
      for (const file of files) {
        const objectUrl = URL.createObjectURL(file);
        const centerX = 300;
        const centerY = 400;
        canvasActions.createElement('image', store.currentPageIndex, centerX, centerY, { src: objectUrl });
      }
    }
    target.value = '';
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
</script>

<input
  bind:this={fileInputEl}
  type="file"
  multiple
  accept=".pdf,application/pdf,image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.docx,.xlsx,.xls,.csv,.tsv,.pptx,.ppt,.txt,.md,.markdown,.json,.xml,.html,.rtf,.yaml,.yml,.log"
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
  accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg"
  onchange={handleImageImportSelected}
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

<TooltipProvider>
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

{#if featureFlags.isEnabled('split') && store.splitDialogMode !== null}
  <SplitPagesDialog mode={store.splitDialogMode} onClose={() => (store.splitDialogMode = null)} />
{/if}

{#if featureFlags.isEnabled('export-images') && store.showExportImagesDialog}
  <ExportImagesDialog onClose={() => (store.showExportImagesDialog = false)} />
{/if}

{#if featureFlags.isEnabled('sanitization')}
  <SanitizeDocumentDialog />
{/if}
{#if featureFlags.isEnabled('compression')}
  <CompressDocumentDialog />
{/if}
{#if featureFlags.isEnabled('ocr')}
  <OcrDialog />
{/if}

{#if featureFlags.isEnabled('imposition') && store.showImpositionDialog}
  <ImpositionDialog
    open={store.showImpositionDialog}
    onClose={() => (store.showImpositionDialog = false)}
    initialMode={store.impositionInitialMode}
  />
{/if}

{#if featureFlags.isEnabled('document-info')}
  <DocumentInfoDialog />
{/if}

<ToolMockupDialog />
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
{#if featureFlags.isEnabled('workspace.compliance')}
  <OpenUrlDialog />
{/if}
{#if featureFlags.isEnabled('conversion')}
  <ConvertDocumentDialog />
{/if}
{#if featureFlags.isEnabled('page-actions.scale')}
  <PageScaleDialog />
{/if}
