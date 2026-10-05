<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import type {
    SanitizeOptions,
    SanitizeSummary,
    SanitizationInspection,
    SanitizePreset,
  } from '../../core/types';
  import {
    ShieldCheck,
    ShieldAlert,
    FileText,
    Paperclip,
    Code,
    MessageSquare,
    Link2,
    CheckSquare,
    Bookmark,
    Layers,
    Image,
    Sparkles,
    Download,
    PlusCircle,
    CheckCircle2,
    Loader2,
    RefreshCw,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

  let activePreset = $state<SanitizePreset>('maximum');
  let isProcessing = $state(false);
  let isInspecting = $state(true);
  let inspection = $state<SanitizationInspection | null>(null);
  let summary = $state<SanitizeSummary | null>(null);
  let errorMessage = $state<string | null>(null);

  // Sanitization flags state
  let removeMetadata = $state(true);
  let removeXmpMetadata = $state(true);
  let removeAttachments = $state(true);
  let removeJavascript = $state(true);
  let removeAnnotations = $state(true);
  let removeLinks = $state(true);
  let removeFormFields = $state(true);
  let removeBookmarks = $state(true);
  let removePieceInfo = $state(true);
  let removeThumbnails = $state(true);
  let removeStructTree = $state(true);

  function applyPreset(preset: SanitizePreset): void {
    activePreset = preset;
    if (preset === 'maximum') {
      removeMetadata = true;
      removeXmpMetadata = true;
      removeAttachments = true;
      removeJavascript = true;
      removeAnnotations = true;
      removeLinks = true;
      removeFormFields = true;
      removeBookmarks = true;
      removePieceInfo = true;
      removeThumbnails = true;
      removeStructTree = true;
    } else if (preset === 'metadata_only') {
      removeMetadata = true;
      removeXmpMetadata = true;
      removeAttachments = true;
      removeJavascript = true;
      removeAnnotations = false;
      removeLinks = false;
      removeFormFields = false;
      removeBookmarks = false;
      removePieceInfo = true;
      removeThumbnails = true;
      removeStructTree = false;
    } else if (preset === 'clean_presentation') {
      removeMetadata = true;
      removeXmpMetadata = true;
      removeAttachments = true;
      removeJavascript = true;
      removeAnnotations = true;
      removeLinks = true;
      removeFormFields = false;
      removeBookmarks = false;
      removePieceInfo = true;
      removeThumbnails = true;
      removeStructTree = false;
    }
  }

  function handleCustomToggle(): void {
    activePreset = 'custom';
  }

  function getCurrentOptions(): SanitizeOptions {
    return {
      removeMetadata,
      removeXmpMetadata,
      removeAttachments,
      removeJavascript,
      removeAnnotations,
      removeLinks,
      removeFormFields,
      removeBookmarks,
      removePieceInfo,
      removeThumbnails,
      removeStructTree,
    };
  }

  $effect(() => {
    if (store.showSanitizeDialog && store.isDocumentLoaded) {
      untrack(() => {
        isInspecting = true;
        summary = null;
        errorMessage = null;
        actions
          .inspectDocumentForSanitization()
          .then((res) => {
            inspection = res;
            isInspecting = false;
          })
          .catch((err) => {
            console.warn('Failed to inspect document for sanitization:', err);
            isInspecting = false;
          });
      });
    }
  });

  function handleClose(): void {
    actions.closeSanitizeDialog();
    summary = null;
    errorMessage = null;
    isProcessing = false;
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      handleClose();
    }
  }

  async function handleSanitizeInPlace(): Promise<void> {
    isProcessing = true;
    errorMessage = null;
    try {
      const result = await actions.sanitizeCurrentDocument(getCurrentOptions());
      summary = result;
      // Re-inspect updated document
      try {
        inspection = await actions.inspectDocumentForSanitization();
      } catch {
        // Non-fatal if re-inspection fails after successful sanitization
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Sanitization failed.';
    } finally {
      isProcessing = false;
    }
  }

  async function handleSanitizeAndDownload(): Promise<void> {
    isProcessing = true;
    errorMessage = null;
    try {
      const result = await actions.sanitizeAndDownload(getCurrentOptions());
      summary = result;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Export failed.';
    } finally {
      isProcessing = false;
    }
  }

  async function handleSanitizeAsCopy(): Promise<void> {
    isProcessing = true;
    errorMessage = null;
    try {
      const result = await actions.sanitizeAsNewWorkspaceFile(getCurrentOptions());
      summary = result;
      handleClose();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Save as copy failed.';
    } finally {
      isProcessing = false;
    }
  }
</script>

<Dialog.Root open={store.showSanitizeDialog} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[560px] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
    <!-- Header -->
      <Dialog.Header class="p-4 pb-3 border-b bg-card">
        <div class="flex items-center gap-2">
          <div class="p-1.5 rounded-md bg-primary/10 text-primary">
            <ShieldCheck class="h-4 w-4" />
          </div>
          <div>
            <Dialog.Title class="text-sm font-semibold">Sanitise Document</Dialog.Title>
            <Dialog.Description class="text-xs text-muted-foreground">
              Permanently remove sensitive metadata, hidden code, and private data from "{store.fileName}".
            </Dialog.Description>
          </div>
        </div>
      </Dialog.Header>

      <!-- Main Scrollable Body -->
      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4 text-xs">
        <!-- Live Document Inspection Card -->
        <div class="rounded-lg border bg-muted/30 p-3 flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="font-medium text-foreground flex items-center gap-1.5">
              <ShieldAlert class="h-3.5 w-3.5 text-warning" />
              Detected Elements in PDF
            </span>
            {#if isInspecting}
              <span class="text-[11px] text-muted-foreground flex items-center gap-1">
                <Loader2 class="h-3 w-3 animate-spin" /> Analyzing...
              </span>
            {:else}
              <Badge variant="outline" class="text-[10px] py-0 h-4">
                Inspection Ready
              </Badge>
            {/if}
          </div>

          {#if inspection}
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <div class="flex flex-col bg-background/80 rounded p-1.5 border border-border/40">
                <span class="text-[10px] text-muted-foreground">Metadata</span>
                <span class="font-medium text-foreground">
                  {inspection.metadataCount} {inspection.metadataCount === 1 ? 'entry' : 'entries'}
                </span>
              </div>

              <div class="flex flex-col bg-background/80 rounded p-1.5 border border-border/40">
                <span class="text-[10px] text-muted-foreground">Attachments</span>
                <span class="font-medium text-foreground">
                  {inspection.attachmentCount} {inspection.attachmentCount === 1 ? 'file' : 'files'}
                </span>
              </div>

              <div class="flex flex-col bg-background/80 rounded p-1.5 border border-border/40">
                <span class="text-[10px] text-muted-foreground">Annotations</span>
                <span class="font-medium text-foreground">
                  {inspection.annotationCount} {inspection.annotationCount === 1 ? 'item' : 'items'}
                </span>
              </div>

              <div class="flex flex-col bg-background/80 rounded p-1.5 border border-border/40">
                <span class="text-[10px] text-muted-foreground">Scripts / JS</span>
                <span class="font-medium {inspection.hasJavascript ? 'text-warning font-semibold' : 'text-foreground'}">
                  {inspection.hasJavascript ? 'Detected' : 'None'}
                </span>
              </div>
            </div>
          {/if}
        </div>

        <!-- Presets Selection Bar -->
        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-foreground">Sanitization Presets</span>
          <ButtonGroup class="grid grid-cols-3 w-full" variant="outline" size="sm">
            <Button
              type="button"
              variant={activePreset === 'maximum' ? 'default' : 'outline'}
              size="sm"
              class="text-xs py-1.5 h-auto font-normal"
              onclick={() => applyPreset('maximum')}
            >
              Maximum Privacy
            </Button>

            <Button
              type="button"
              variant={activePreset === 'metadata_only' ? 'default' : 'outline'}
              size="sm"
              class="text-xs py-1.5 h-auto font-normal"
              onclick={() => applyPreset('metadata_only')}
            >
              Metadata Only
            </Button>

            <Button
              type="button"
              variant={activePreset === 'clean_presentation' ? 'default' : 'outline'}
              size="sm"
              class="text-xs py-1.5 h-auto font-normal"
              onclick={() => applyPreset('clean_presentation')}
            >
              Clean Presentation
            </Button>
          </ButtonGroup>
        </div>

        <!-- Granular Options List -->
        <div class="flex flex-col gap-3">
          <!-- Metadata and properties -->
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Metadata & Document Properties
            </span>
            <div class="rounded-lg border divide-y divide-border/60 bg-card overflow-hidden">
              <label class="flex items-center justify-between p-2.5 hover:bg-muted/40 cursor-pointer">
                <div class="flex items-center gap-2.5">
                  <FileText class="h-4 w-4 text-primary shrink-0" />
                  <div class="flex flex-col">
                    <span class="font-medium text-foreground">Document Info Dictionary</span>
                    <span class="text-[11px] text-muted-foreground">Title, author, subject, keywords, creation & modification dates</span>
                  </div>
                </div>
                <Checkbox
                  checked={removeMetadata}
                  onCheckedChange={(checked) => {
                    removeMetadata = checked;
                    handleCustomToggle();
                  }}
                />
              </label>

              <label class="flex items-center justify-between p-2.5 hover:bg-muted/40 cursor-pointer">
                <div class="flex items-center gap-2.5">
                  <Sparkles class="h-4 w-4 text-primary shrink-0" />
                  <div class="flex flex-col">
                    <span class="font-medium text-foreground">XMP Metadata Stream</span>
                    <span class="text-[11px] text-muted-foreground">Embedded XML metadata packet in document catalog</span>
                  </div>
                </div>
                <Checkbox
                  checked={removeXmpMetadata}
                  onCheckedChange={(checked) => {
                    removeXmpMetadata = checked;
                    handleCustomToggle();
                  }}
                />
              </label>

              <label class="flex items-center justify-between p-2.5 hover:bg-muted/40 cursor-pointer">
                <div class="flex items-center gap-2.5">
                  <Layers class="h-4 w-4 text-muted-foreground shrink-0" />
                  <div class="flex flex-col">
                    <span class="font-medium text-foreground">Private Application Data (PieceInfo)</span>
                    <span class="text-[11px] text-muted-foreground">Photoshop, Illustrator, and Acrobat proprietary edit streams</span>
                  </div>
                </div>
                <Checkbox
                  checked={removePieceInfo}
                  onCheckedChange={(checked) => {
                    removePieceInfo = checked;
                    handleCustomToggle();
                  }}
                />
              </label>
            </div>
          </div>

          <!-- Code and attachments -->
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Security, Code & Files
            </span>
            <div class="rounded-lg border divide-y divide-border/60 bg-card overflow-hidden">
              <label class="flex items-center justify-between p-2.5 hover:bg-muted/40 cursor-pointer">
                <div class="flex items-center gap-2.5">
                  <Code class="h-4 w-4 text-warning shrink-0" />
                  <div class="flex flex-col">
                    <span class="font-medium text-foreground">JavaScript & Action Triggers</span>
                    <span class="text-[11px] text-muted-foreground">Document-level scripts, OpenAction, and page trigger hooks</span>
                  </div>
                </div>
                <Checkbox
                  checked={removeJavascript}
                  onCheckedChange={(checked) => {
                    removeJavascript = checked;
                    handleCustomToggle();
                  }}
                />
              </label>

              <label class="flex items-center justify-between p-2.5 hover:bg-muted/40 cursor-pointer">
                <div class="flex items-center gap-2.5">
                  <Paperclip class="h-4 w-4 text-primary shrink-0" />
                  <div class="flex flex-col">
                    <span class="font-medium text-foreground">Embedded File Attachments</span>
                    <span class="text-[11px] text-muted-foreground">Embedded file packages and Associated Files (/AF streams)</span>
                  </div>
                </div>
                <Checkbox
                  checked={removeAttachments}
                  onCheckedChange={(checked) => {
                    removeAttachments = checked;
                    handleCustomToggle();
                  }}
                />
              </label>
            </div>
          </div>

          <!-- Interactive and content artifacts -->
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Interactive & Content Artifacts
            </span>
            <div class="rounded-lg border divide-y divide-border/60 bg-card overflow-hidden">
              <label class="flex items-center justify-between p-2.5 hover:bg-muted/40 cursor-pointer">
                <div class="flex items-center gap-2.5">
                  <MessageSquare class="h-4 w-4 text-muted-foreground shrink-0" />
                  <div class="flex flex-col">
                    <span class="font-medium text-foreground">Annotations, Highlights & Comments</span>
                    <span class="text-[11px] text-muted-foreground">Visual highlights, ink markup, sticky notes, and stamps</span>
                  </div>
                </div>
                <Checkbox
                  checked={removeAnnotations}
                  onCheckedChange={(checked) => {
                    removeAnnotations = checked;
                    handleCustomToggle();
                  }}
                />
              </label>

              <label class="flex items-center justify-between p-2.5 hover:bg-muted/40 cursor-pointer">
                <div class="flex items-center gap-2.5">
                  <Link2 class="h-4 w-4 text-muted-foreground shrink-0" />
                  <div class="flex flex-col">
                    <span class="font-medium text-foreground">Hyperlinks & Remote Actions</span>
                    <span class="text-[11px] text-muted-foreground">Web links, GoTo actions, and URI launch targets</span>
                  </div>
                </div>
                <Checkbox
                  checked={removeLinks}
                  onCheckedChange={(checked) => {
                    removeLinks = checked;
                    handleCustomToggle();
                  }}
                />
              </label>

              <label class="flex items-center justify-between p-2.5 hover:bg-muted/40 cursor-pointer">
                <div class="flex items-center gap-2.5">
                  <CheckSquare class="h-4 w-4 text-muted-foreground shrink-0" />
                  <div class="flex flex-col">
                    <span class="font-medium text-foreground">Interactive Form Fields (AcroForms)</span>
                    <span class="text-[11px] text-muted-foreground">Form widgets, checkboxes, text fields, and radio buttons</span>
                  </div>
                </div>
                <Checkbox
                  checked={removeFormFields}
                  onCheckedChange={(checked) => {
                    removeFormFields = checked;
                    handleCustomToggle();
                  }}
                />
              </label>

              <label class="flex items-center justify-between p-2.5 hover:bg-muted/40 cursor-pointer">
                <div class="flex items-center gap-2.5">
                  <Bookmark class="h-4 w-4 text-muted-foreground shrink-0" />
                  <div class="flex flex-col">
                    <span class="font-medium text-foreground">Bookmarks & Document Outline</span>
                    <span class="text-[11px] text-muted-foreground">Hierarchical table of contents and bookmark tree</span>
                  </div>
                </div>
                <Checkbox
                  checked={removeBookmarks}
                  onCheckedChange={(checked) => {
                    removeBookmarks = checked;
                    handleCustomToggle();
                  }}
                />
              </label>

              <label class="flex items-center justify-between p-2.5 hover:bg-muted/40 cursor-pointer">
                <div class="flex items-center gap-2.5">
                  <Image class="h-4 w-4 text-muted-foreground shrink-0" />
                  <div class="flex flex-col">
                    <span class="font-medium text-foreground">Page Thumbnails</span>
                    <span class="text-[11px] text-muted-foreground">Embedded raster thumbnail image streams in page dictionaries</span>
                  </div>
                </div>
                <Checkbox
                  checked={removeThumbnails}
                  onCheckedChange={(checked) => {
                    removeThumbnails = checked;
                    handleCustomToggle();
                  }}
                />
              </label>
            </div>
          </div>
        </div>

        <!-- Success or Error Feedback State -->
        {#if summary}
          <div class="rounded-lg bg-success/10 border border-success/30 p-3 flex flex-col gap-1.5 text-xs text-success">
            <div class="flex items-center gap-1.5 font-medium">
              <CheckCircle2 class="h-4 w-4 shrink-0 text-success" />
              Document successfully sanitized!
            </div>
            <p class="text-[11px] text-success/90">
              Purged: {summary.metadataCleared ? 'Metadata' : ''}{summary.xmpCleared ? ', XMP stream' : ''}{summary.attachmentsRemoved > 0 ? `, ${summary.attachmentsRemoved} attachments` : ''}{summary.javascriptActionsRemoved > 0 ? `, ${summary.javascriptActionsRemoved} script triggers` : ''}{summary.annotationsRemoved > 0 ? `, ${summary.annotationsRemoved} annotations` : ''}{summary.linksRemoved > 0 ? `, ${summary.linksRemoved} links` : ''}{summary.formFieldsRemoved > 0 ? `, ${summary.formFieldsRemoved} form fields` : ''}{summary.bookmarksRemoved ? ', Bookmarks' : ''}.
            </p>
          </div>
        {/if}

        {#if errorMessage}
          <div class="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-xs font-medium text-destructive">
            {errorMessage}
          </div>
        {/if}
      </div>

      <!-- Footer Actions -->
      <Dialog.Footer class="p-3 border-t bg-card flex items-center justify-between sm:justify-between gap-2">
        <Button variant="outline" size="sm" class="h-8 text-xs" onclick={handleClose}>
          Cancel
        </Button>

        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="h-8 text-xs"
            onclick={handleSanitizeAsCopy}
            disabled={isProcessing || !store.isDocumentLoaded}
            title="Save sanitized PDF as a new copy in workspace"
          >
            <PlusCircle class="h-3.5 w-3.5 mr-1 text-primary" /> Save Copy
          </Button>

          <Button
            variant="outline"
            size="sm"
            class="h-8 text-xs"
            onclick={handleSanitizeAndDownload}
            disabled={isProcessing || !store.isDocumentLoaded}
            title="Download sanitized PDF file directly"
          >
            <Download class="h-3.5 w-3.5 mr-1" /> Export PDF
          </Button>

          <Button
            size="sm"
            class="h-8 text-xs"
            onclick={handleSanitizeInPlace}
            disabled={isProcessing || !store.isDocumentLoaded}
          >
            {#if isProcessing}
              <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" /> Sanitizing...
            {:else}
              <RefreshCw class="h-3.5 w-3.5 mr-1.5" /> Sanitize In-Place
            {/if}
          </Button>
        </div>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
