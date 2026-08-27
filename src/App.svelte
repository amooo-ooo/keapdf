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

  import EditorShell from './components/layout/EditorShell.svelte';
  import NavRail from './components/layout/NavRail.svelte';
  import LeftPanel from './components/layout/LeftPanel.svelte';
  import Canvas from './components/canvas/Canvas.svelte';
  import RightPanel from './components/layout/RightPanel.svelte';
  import SplitPagesDialog from './components/dialogs/SplitPagesDialog.svelte';
  import ExportImagesDialog from './components/dialogs/ExportImagesDialog.svelte';
  import SanitizeDocumentDialog from './components/dialogs/SanitizeDocumentDialog.svelte';
  import ImpositionDialog from './components/dialogs/ImpositionDialog.svelte';
  import DocumentInfoDialog from './components/dialogs/DocumentInfoDialog.svelte';
  import ToolMockupDialog from './components/dialogs/ToolMockupDialog.svelte';
  import EsignDialog from './components/dialogs/EsignDialog.svelte';
  import CertSignDialog from './components/dialogs/CertSignDialog.svelte';
  import ValidateSignatureDialog from './components/dialogs/ValidateSignatureDialog.svelte';

  import { setupKeyboardShortcuts } from './utils/keyboard-shortcuts';

  const store = new EditorStore();
  const historyStore = new HistoryStore();
  const service = new PdfEditorService(store.workspaceFiles);
  const canvasStore = new CanvasStore();
  const elementRegistry = new ElementRegistry();
  registerBuiltinElements(elementRegistry);
  const actions = new EditorActions(store, service, historyStore, canvasStore);
  const canvasActions = new CanvasActions(canvasStore, actions, elementRegistry);

  provideEditorStore(store);
  provideHistoryStore(historyStore);
  provideEditorActions(actions);
  provideCanvasStore(canvasStore);
  provideCanvasActions(canvasActions);
  provideElementRegistry(elementRegistry);

  let fileInputEl: HTMLInputElement | null = $state(null);
  let mergeFileInputEl: HTMLInputElement | null = $state(null);
  let imageFileInputEl: HTMLInputElement | null = $state(null);
  let imageAsPageFileInputEl: HTMLInputElement | null = $state(null);

  onMount(() => {
    actions.fileInputEl = fileInputEl;
    actions.mergeFileInputEl = mergeFileInputEl;
    actions.imageFileInputEl = imageFileInputEl;
    actions.imageAsPageFileInputEl = imageAsPageFileInputEl;

    const cleanupShortcuts = setupKeyboardShortcuts(store, actions, canvasStore);

    actions.initializeEngine().then(() => {
      actions.loadSampleDocument();
    });

    return cleanupShortcuts;
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
</script>

<input
  bind:this={fileInputEl}
  type="file"
  multiple
  accept=".pdf,application/pdf"
  onchange={handleFileSelected}
  class="hidden"
/>

<input
  bind:this={mergeFileInputEl}
  type="file"
  multiple
  accept=".pdf,application/pdf"
  onchange={handleMergeFileSelected}
  class="hidden"
/>

<input
  bind:this={imageFileInputEl}
  type="file"
  multiple
  accept="image/png,image/jpeg"
  onchange={handleImageImportSelected}
  class="hidden"
/>

<input
  bind:this={imageAsPageFileInputEl}
  type="file"
  multiple
  accept="image/png,image/jpeg"
  onchange={handleImageAsPageImportSelected}
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

{#if store.splitDialogMode !== null}
  <SplitPagesDialog mode={store.splitDialogMode} onClose={() => (store.splitDialogMode = null)} />
{/if}

{#if store.showExportImagesDialog}
  <ExportImagesDialog onClose={() => (store.showExportImagesDialog = false)} />
{/if}

<SanitizeDocumentDialog />

{#if store.showImpositionDialog}
  <ImpositionDialog
    open={store.showImpositionDialog}
    onClose={() => (store.showImpositionDialog = false)}
    initialMode={store.impositionInitialMode}
  />
{/if}

<DocumentInfoDialog />

<ToolMockupDialog />
<EsignDialog />
<CertSignDialog />
<ValidateSignatureDialog />
