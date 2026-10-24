<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { ControlRow } from '$lib/components/ui/control-row/index.js';
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

  // Sanitisation flags state
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
      try {
        inspection = await actions.inspectDocumentForSanitization();
      } catch {
        // Non-fatal if re-inspection fails after successful sanitisation
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
  <Dialog.Content class="sm:max-w-[560px]">
    <!-- Header -->
    <Dialog.Header class="pr-12">
      <Dialog.Title>
        <ShieldCheck class="h-4 w-4" />
        Sanitise Document
      </Dialog.Title>
      <Dialog.Description>
        Permanently remove sensitive metadata, hidden code, and private data from "{store.fileName}".
      </Dialog.Description>
    </Dialog.Header>

    <!-- Main Scrollable Body -->
    <div class="dialog-body">
      <!-- Live Document Inspection Card -->
      <div class="dialog-card">
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
            <div class="flex flex-col bg-background/80 rounded-[var(--radius-card-inner)] p-1.5 border border-border/60">
              <span class="text-[10px] text-muted-foreground">Metadata</span>
              <span class="font-medium text-foreground">
                {inspection.metadataCount} {inspection.metadataCount === 1 ? 'entry' : 'entries'}
              </span>
            </div>

            <div class="flex flex-col bg-background/80 rounded-[var(--radius-card-inner)] p-1.5 border border-border/60">
              <span class="text-[10px] text-muted-foreground">Attachments</span>
              <span class="font-medium text-foreground">
                {inspection.attachmentCount} {inspection.attachmentCount === 1 ? 'file' : 'files'}
              </span>
            </div>

            <div class="flex flex-col bg-background/80 rounded-[var(--radius-card-inner)] p-1.5 border border-border/60">
              <span class="text-[10px] text-muted-foreground">Annotations</span>
              <span class="font-medium text-foreground">
                {inspection.annotationCount} {inspection.annotationCount === 1 ? 'item' : 'items'}
              </span>
            </div>

            <div class="flex flex-col bg-background/80 rounded-[var(--radius-card-inner)] p-1.5 border border-border/60">
              <span class="text-[10px] text-muted-foreground">Scripts / JS</span>
              <span class="font-medium {inspection.hasJavascript ? 'text-warning font-semibold' : 'text-foreground'}">
                {inspection.hasJavascript ? 'Detected' : 'None'}
              </span>
            </div>
          </div>
        {/if}
      </div>

      <!-- Presets Selection Bar -->
      <div class="field-group">
        <Label class="field-label">Sanitization Presets</Label>
        <ButtonGroup class="w-full h-8" variant="outline" size="sm">
          <Button
            type="button"
            variant={activePreset === 'maximum' ? 'secondary' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => applyPreset('maximum')}
          >
            Maximum Privacy
          </Button>

          <Button
            type="button"
            variant={activePreset === 'metadata_only' ? 'secondary' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => applyPreset('metadata_only')}
          >
            Metadata Only
          </Button>

          <Button
            type="button"
            variant={activePreset === 'clean_presentation' ? 'secondary' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => applyPreset('clean_presentation')}
          >
            Clean Presentation
          </Button>
        </ButtonGroup>
      </div>

      <!-- Granular Options List -->
      <div class="flex flex-col gap-3">
        <!-- Metadata and properties -->
        <div class="field-group">
          <span class="field-label">
            Metadata &amp; Document Properties
          </span>
          <div class="rounded-[var(--radius-card)] border border-border divide-y divide-border/60 bg-card overflow-hidden">
            <ControlRow
              label="Document Info Dictionary"
              description="Title, author, subject, keywords, creation & modification dates"
              variant="ghost"
              size="compact"
              class="px-2.5 py-2 rounded-none"
            >
              {#snippet icon()}<FileText class="h-3.5 w-3.5 text-muted-foreground" />{/snippet}
              <Switch
                checked={removeMetadata}
                onCheckedChange={(checked) => {
                  removeMetadata = checked;
                  handleCustomToggle();
                }}
                aria-label="Document Info Dictionary"
              />
            </ControlRow>

            <ControlRow
              label="XMP Metadata Stream"
              description="Embedded XML metadata packet in document catalog"
              variant="ghost"
              size="compact"
              class="px-2.5 py-2 rounded-none"
            >
              {#snippet icon()}<Sparkles class="h-3.5 w-3.5 text-muted-foreground" />{/snippet}
              <Switch
                checked={removeXmpMetadata}
                onCheckedChange={(checked) => {
                  removeXmpMetadata = checked;
                  handleCustomToggle();
                }}
                aria-label="XMP Metadata Stream"
              />
            </ControlRow>

            <ControlRow
              label="Private Application Data (PieceInfo)"
              description="Photoshop, Illustrator, and Acrobat proprietary edit streams"
              variant="ghost"
              size="compact"
              class="px-2.5 py-2 rounded-none"
            >
              {#snippet icon()}<Layers class="h-3.5 w-3.5 text-muted-foreground" />{/snippet}
              <Switch
                checked={removePieceInfo}
                onCheckedChange={(checked) => {
                  removePieceInfo = checked;
                  handleCustomToggle();
                }}
                aria-label="Private Application Data (PieceInfo)"
              />
            </ControlRow>
          </div>
        </div>

        <!-- Code and attachments -->
        <div class="field-group">
          <span class="field-label">
            Security, Code &amp; Files
          </span>
          <div class="rounded-[var(--radius-card)] border border-border divide-y divide-border/60 bg-card overflow-hidden">
            <ControlRow
              label="JavaScript &amp; Action Triggers"
              description="Document-level scripts, OpenAction, and page trigger hooks"
              variant="ghost"
              size="compact"
              class="px-2.5 py-2 rounded-none"
            >
              {#snippet icon()}<Code class="h-3.5 w-3.5 text-warning" />{/snippet}
              <Switch
                checked={removeJavascript}
                onCheckedChange={(checked) => {
                  removeJavascript = checked;
                  handleCustomToggle();
                }}
                aria-label="JavaScript and Action Triggers"
              />
            </ControlRow>

            <ControlRow
              label="Embedded File Attachments"
              description="Embedded file packages and Associated Files (/AF streams)"
              variant="ghost"
              size="compact"
              class="px-2.5 py-2 rounded-none"
            >
              {#snippet icon()}<Paperclip class="h-3.5 w-3.5 text-muted-foreground" />{/snippet}
              <Switch
                checked={removeAttachments}
                onCheckedChange={(checked) => {
                  removeAttachments = checked;
                  handleCustomToggle();
                }}
                aria-label="Embedded File Attachments"
              />
            </ControlRow>
          </div>
        </div>

        <!-- Interactive and content artifacts -->
        <div class="field-group">
          <span class="field-label">
            Interactive &amp; Content Artifacts
          </span>
          <div class="rounded-[var(--radius-card)] border border-border divide-y divide-border/60 bg-card overflow-hidden">
            <ControlRow
              label="Annotations, Highlights &amp; Comments"
              description="Visual highlights, ink markup, sticky notes, and stamps"
              variant="ghost"
              size="compact"
              class="px-2.5 py-2 rounded-none"
            >
              {#snippet icon()}<MessageSquare class="h-3.5 w-3.5 text-muted-foreground" />{/snippet}
              <Switch
                checked={removeAnnotations}
                onCheckedChange={(checked) => {
                  removeAnnotations = checked;
                  handleCustomToggle();
                }}
                aria-label="Annotations, Highlights and Comments"
              />
            </ControlRow>

            <ControlRow
              label="Hyperlinks &amp; Remote Actions"
              description="Web links, GoTo actions, and URI launch targets"
              variant="ghost"
              size="compact"
              class="px-2.5 py-2 rounded-none"
            >
              {#snippet icon()}<Link2 class="h-3.5 w-3.5 text-muted-foreground" />{/snippet}
              <Switch
                checked={removeLinks}
                onCheckedChange={(checked) => {
                  removeLinks = checked;
                  handleCustomToggle();
                }}
                aria-label="Hyperlinks and Remote Actions"
              />
            </ControlRow>

            <ControlRow
              label="Interactive Form Fields (AcroForms)"
              description="Form widgets, checkboxes, text fields, and radio buttons"
              variant="ghost"
              size="compact"
              class="px-2.5 py-2 rounded-none"
            >
              {#snippet icon()}<CheckSquare class="h-3.5 w-3.5 text-muted-foreground" />{/snippet}
              <Switch
                checked={removeFormFields}
                onCheckedChange={(checked) => {
                  removeFormFields = checked;
                  handleCustomToggle();
                }}
                aria-label="Interactive Form Fields (AcroForms)"
              />
            </ControlRow>

            <ControlRow
              label="Bookmarks &amp; Document Outline"
              description="Hierarchical table of contents and bookmark tree"
              variant="ghost"
              size="compact"
              class="px-2.5 py-2 rounded-none"
            >
              {#snippet icon()}<Bookmark class="h-3.5 w-3.5 text-muted-foreground" />{/snippet}
              <Switch
                checked={removeBookmarks}
                onCheckedChange={(checked) => {
                  removeBookmarks = checked;
                  handleCustomToggle();
                }}
                aria-label="Bookmarks and Document Outline"
              />
            </ControlRow>

            <ControlRow
              label="Page Thumbnails"
              description="Embedded raster thumbnail image streams in page dictionaries"
              variant="ghost"
              size="compact"
              class="px-2.5 py-2 rounded-none"
            >
              {#snippet icon()}<Image class="h-3.5 w-3.5 text-muted-foreground" />{/snippet}
              <Switch
                checked={removeThumbnails}
                onCheckedChange={(checked) => {
                  removeThumbnails = checked;
                  handleCustomToggle();
                }}
                aria-label="Page Thumbnails"
              />
            </ControlRow>
          </div>
        </div>
      </div>

      <!-- Success or Error Feedback State -->
      {#if summary}
        <div role="status" class="dialog-card">
          <div class="flex items-center gap-1.5 font-medium text-foreground">
            <CheckCircle2 class="h-4 w-4 shrink-0" />
            Document successfully sanitized!
          </div>
          <p class="text-[11px] text-muted-foreground">
            Purged: {summary.metadataCleared ? 'Metadata' : ''}{summary.xmpCleared ? ', XMP stream' : ''}{summary.attachmentsRemoved > 0 ? `, ${summary.attachmentsRemoved} attachments` : ''}{summary.javascriptActionsRemoved > 0 ? `, ${summary.javascriptActionsRemoved} script triggers` : ''}{summary.annotationsRemoved > 0 ? `, ${summary.annotationsRemoved} annotations` : ''}{summary.linksRemoved > 0 ? `, ${summary.linksRemoved} links` : ''}{summary.formFieldsRemoved > 0 ? `, ${summary.formFieldsRemoved} form fields` : ''}{summary.bookmarksRemoved ? ', Bookmarks' : ''}.
          </p>
        </div>
      {/if}

      {#if errorMessage}
        <div role="alert" class="dialog-error">
          {errorMessage}
        </div>
      {/if}
    </div>

    <!-- Footer Actions -->
    <Dialog.Footer class="justify-between">
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
          <PlusCircle class="h-3.5 w-3.5 mr-1" /> Save Copy
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
          variant="secondary"
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
