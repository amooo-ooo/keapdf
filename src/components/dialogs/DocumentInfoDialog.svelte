<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import type { DocumentMetadata, MetadataEntry, DocumentMetadataUpdate } from '../../core/types';
  import {
    FileText,
    ShieldAlert,
    Copy,
    Check,
    Trash2,
    Save,
    Search,
    Download,
    Tag,
    RefreshCw,
  } from 'lucide-svelte';
  import SecurityComplianceSection from './SecurityComplianceSection.svelte';
  import type { SignatureValidationResult } from '../../services/pdf/operations/signature-ops';

  const store = useEditorStore();
  const actions = useEditorActions();

  let activeTab = $state('metadata');
  let metadata = $state<DocumentMetadata | null>(null);
  let signatureResults = $state<SignatureValidationResult[]>([]);
  let isValidatingSignatures = $state(false);
  let isLoading = $state(false);
  let searchQuery = $state('');
  let filterCategory = $state<'all' | 'standard' | 'custom'>('all');
  let copiedKey = $state<string | null>(null);

  // Editing state
  let isEditing = $state(false);
  let editForm = $state<{
    title: string;
    author: string;
    subject: string;
    keywords: string;
    creator: string;
    producer: string;
    customFields: Array<{ key: string; value: string }>;
  }>({
    title: '',
    author: '',
    subject: '',
    keywords: '',
    creator: '',
    producer: '',
    customFields: [],
  });

  let isSaving = $state(false);
  let saveSuccess = $state(false);
  let errorMessage = $state<string | null>(null);

  // Load extended metadata whenever dialog opens or document changes
  $effect(() => {
    if (store.showDocumentInfoDialog && store.isDocumentLoaded) {
      untrack(() => {
        loadMetadata();
        loadSignatures();
      });
    }
  });

  async function loadMetadata(): Promise<void> {
    isLoading = true;
    errorMessage = null;
    try {
      metadata = await actions.getExtendedDocumentMetadata();
      syncEditForm();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to load document metadata.';
    } finally {
      isLoading = false;
    }
  }

  async function loadSignatures(): Promise<void> {
    if (!store.isDocumentLoaded) return;
    isValidatingSignatures = true;
    try {
      signatureResults = await actions.validateActiveDocumentSignatures();
    } catch (err) {
      console.warn('Failed to load signature compliance details:', err);
      signatureResults = [];
    } finally {
      isValidatingSignatures = false;
    }
  }

  function syncEditForm(): void {
    if (!metadata) return;
    const customList: Array<{ key: string; value: string }> = [];
    if (metadata.customMetadata) {
      for (const [k, v] of Object.entries(metadata.customMetadata)) {
        customList.push({ key: k, value: v });
      }
    }

    editForm = {
      title: metadata.title || '',
      author: metadata.author || '',
      subject: metadata.subject || '',
      keywords: metadata.keywords || '',
      creator: metadata.creator || '',
      producer: metadata.producer || '',
      customFields: customList,
    };
  }

  function handleClose(): void {
    actions.closeDocumentInfoDialog();
    isEditing = false;
    saveSuccess = false;
    errorMessage = null;
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      handleClose();
    }
  }

  async function copyToClipboard(text: string, keyIdentifier: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copiedKey = keyIdentifier;
      setTimeout(() => {
        if (copiedKey === keyIdentifier) copiedKey = null;
      }, 1800);
    } catch {
      // Fallback
    }
  }

  function removeCustomField(index: number): void {
    editForm.customFields.splice(index, 1);
  }

  async function handleSaveMetadata(): Promise<void> {
    isSaving = true;
    errorMessage = null;
    try {
      const customDict: Record<string, string> = {};
      for (const f of editForm.customFields) {
        if (f.key.trim()) {
          customDict[f.key.trim()] = f.value.trim();
        }
      }

      // Detect removed custom keys
      const initialKeys = metadata?.customMetadata ? Object.keys(metadata.customMetadata) : [];
      const currentKeys = new Set(editForm.customFields.map((f) => f.key.trim()));
      const removeKeys = initialKeys.filter((k) => !currentKeys.has(k));

      const updates: DocumentMetadataUpdate = {
        title: editForm.title,
        author: editForm.author,
        subject: editForm.subject,
        keywords: editForm.keywords,
        creator: editForm.creator,
        producer: editForm.producer,
        customMetadata: customDict,
        removeKeys: removeKeys.length > 0 ? removeKeys : undefined,
      };

      await actions.updateDocumentMetadata(updates);
      metadata = await actions.getExtendedDocumentMetadata();
      syncEditForm();
      isEditing = false;
      saveSuccess = true;
      setTimeout(() => {
        saveSuccess = false;
      }, 2500);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to save metadata updates.';
    } finally {
      isSaving = false;
    }
  }

  function exportMetadataAsJson(): void {
    if (!metadata) return;
    const jsonStr = JSON.stringify(metadata, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${store.fileName.replace(/\.pdf$/i, '')}_metadata.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Filtered entries computed state
  let filteredEntries = $derived.by(() => {
    if (!metadata || !metadata.allEntries) return [];
    const q = searchQuery.toLowerCase().trim();

    return metadata.allEntries.filter((entry: MetadataEntry) => {
      if (filterCategory === 'standard' && !entry.isStandard) return false;
      if (filterCategory === 'custom' && entry.isStandard) return false;
      if (!q) return true;
      return (
        entry.key.toLowerCase().includes(q) ||
        entry.value.toLowerCase().includes(q) ||
        (entry.formattedValue && entry.formattedValue.toLowerCase().includes(q))
      );
    });
  });
</script>

<Dialog.Root open={store.showDocumentInfoDialog} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[680px] max-h-[88vh] flex flex-col p-0 overflow-hidden">
    <!-- Header -->
    <div class="px-6 pt-5 pb-3 border-b border-border bg-card pr-12">
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <FileText class="h-4 w-4" />
            </div>
            <div>
              <Dialog.Title class="text-sm font-semibold tracking-tight text-foreground">
                Document Info & Metadata
              </Dialog.Title>
              <Dialog.Description class="text-xs text-muted-foreground">
                Detailed metadata dictionary, custom properties, and technical specifications.
              </Dialog.Description>
            </div>
          </div>
          <div class="flex items-center gap-1.5">
            {#if isLoading}
              <RefreshCw class="h-3 w-3 animate-spin text-muted-foreground mr-1" />
            {/if}
            <Badge variant="outline" class="text-[10px] uppercase font-sans">
              PDF {metadata?.pdfVersion || '1.4'}
            </Badge>
          </div>
        </div>
      </div>

      <!-- Body / Tabs -->
      <div class="flex-1 flex flex-col min-h-0 overflow-hidden">
        <Tabs.Root value={activeTab} onValueChange={(v) => (activeTab = v)} class="flex-1 flex flex-col min-h-0">
          <div class="px-6 border-b border-border bg-muted/20">
            <Tabs.List class="h-9 p-0 bg-transparent gap-4">
              <Tabs.Trigger
                value="metadata"
                class="h-9 px-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs font-medium"
              >
                Metadata Fields ({metadata?.allEntries?.length || 0})
              </Tabs.Trigger>
              <Tabs.Trigger
                value="overview"
                class="h-9 px-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs font-medium"
              >
                Overview & Metrics
              </Tabs.Trigger>
              <Tabs.Trigger
                value="security"
                class="h-9 px-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs font-medium"
              >
                Security & Access
              </Tabs.Trigger>
              <Tabs.Trigger
                value="raw"
                class="h-9 px-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs font-medium"
              >
                Raw & XMP
              </Tabs.Trigger>
            </Tabs.List>
          </div>

          <!-- Dynamic metadata fields -->
          <Tabs.Content value="metadata" class="flex-1 flex flex-col min-h-0 p-6 overflow-hidden gap-3.5 m-0">
            {#if isEditing}
              <!-- Edit Metadata Mode -->
              <div class="flex-1 flex flex-col gap-3 overflow-y-auto pr-1">
                <div class="grid grid-cols-2 gap-3">
                  <div class="flex flex-col gap-1">
                    <Label for="edit-title" class="text-xs">Title</Label>
                    <Input id="edit-title" bind:value={editForm.title} placeholder="Document title..." class="h-7 text-xs" />
                  </div>
                  <div class="flex flex-col gap-1">
                    <Label for="edit-author" class="text-xs">Author</Label>
                    <Input id="edit-author" bind:value={editForm.author} placeholder="Author name..." class="h-7 text-xs" />
                  </div>
                  <div class="flex flex-col gap-1">
                    <Label for="edit-subject" class="text-xs">Subject</Label>
                    <Input id="edit-subject" bind:value={editForm.subject} placeholder="Document subject..." class="h-7 text-xs" />
                  </div>
                  <div class="flex flex-col gap-1">
                    <Label for="edit-keywords" class="text-xs">Keywords</Label>
                    <Input id="edit-keywords" bind:value={editForm.keywords} placeholder="Keywords (comma-separated)..." class="h-7 text-xs" />
                  </div>
                  <div class="flex flex-col gap-1">
                    <Label for="edit-creator" class="text-xs">Creator Application</Label>
                    <Input id="edit-creator" bind:value={editForm.creator} placeholder="Creating software..." class="h-7 text-xs" />
                  </div>
                  <div class="flex flex-col gap-1">
                    <Label for="edit-producer" class="text-xs">PDF Producer</Label>
                    <Input id="edit-producer" bind:value={editForm.producer} placeholder="PDF generator..." class="h-7 text-xs" />
                  </div>
                </div>

                <!-- Custom Fields Management -->
                {#if editForm.customFields.length > 0}
                  <div class="border-t border-border pt-3 mt-1 flex flex-col gap-2">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-medium text-foreground">Custom Metadata Properties</span>
                      <span class="text-[11px] text-muted-foreground">{editForm.customFields.length} custom tags</span>
                    </div>

                    <div class="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
                      {#each editForm.customFields as field, idx}
                        <div class="flex items-center gap-2">
                          <Input
                            bind:value={field.key}
                            placeholder="Key..."
                            class="h-7 text-xs w-1/3 font-sans"
                          />
                          <Input
                            bind:value={field.value}
                            placeholder="Value..."
                            class="h-7 text-xs flex-1"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            class="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                            onclick={() => removeCustomField(idx)}
                            aria-label="Remove metadata tag"
                          >
                            <Trash2 class="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            {:else}
              <!-- View Dynamic Metadata List -->
              <div class="flex items-center justify-between gap-2 shrink-0">
                <div class="relative flex-1">
                  <Search class="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    bind:value={searchQuery}
                    placeholder="Search metadata keys & values..."
                    class="h-7 text-xs pl-8"
                  />
                </div>
                <div class="flex items-center gap-1 bg-muted/40 p-0.5 rounded-md">
                  <button
                    type="button"
                    class="px-2 py-0.5 text-[11px] rounded transition-colors {filterCategory === 'all' ? 'bg-background text-foreground shadow-2xs font-medium' : 'text-muted-foreground hover:text-foreground'}"
                    onclick={() => (filterCategory = 'all')}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    class="px-2 py-0.5 text-[11px] rounded transition-colors {filterCategory === 'standard' ? 'bg-background text-foreground shadow-2xs font-medium' : 'text-muted-foreground hover:text-foreground'}"
                    onclick={() => (filterCategory = 'standard')}
                  >
                    Standard
                  </button>
                  <button
                    type="button"
                    class="px-2 py-0.5 text-[11px] rounded transition-colors {filterCategory === 'custom' ? 'bg-background text-foreground shadow-2xs font-medium' : 'text-muted-foreground hover:text-foreground'}"
                    onclick={() => (filterCategory = 'custom')}
                  >
                    Custom ({Object.keys(metadata?.customMetadata || {}).length})
                  </button>
                </div>
              </div>

              <!-- List of discovered entries -->
              <div class="flex-1 min-h-0 overflow-y-auto rounded-md border border-border divide-y divide-border/60 bg-muted/10">
                {#if filteredEntries.length > 0}
                  {#each filteredEntries as entry}
                    <div class="flex items-center justify-between p-2.5 hover:bg-muted/40 transition-colors text-xs gap-3 group">
                      <div class="flex flex-col min-w-[130px] max-w-[180px] shrink-0">
                        <div class="flex items-center gap-1.5">
                          <span class="font-medium text-foreground truncate" title={entry.key}>
                            {entry.key}
                          </span>
                          {#if !entry.isStandard}
                            <Badge variant="secondary" class="text-[9px] px-1 py-0 h-4 font-sans">
                              custom
                            </Badge>
                          {/if}
                        </div>
                        <span class="text-[10px] text-muted-foreground font-sans truncate">{entry.rawKey}</span>
                      </div>

                      <div class="flex-1 min-w-0 flex flex-col justify-center">
                        <span class="text-foreground truncate select-all" title={entry.value}>
                          {entry.formattedValue || entry.value}
                        </span>
                        {#if entry.formattedValue && entry.formattedValue !== entry.value}
                          <span class="text-[10px] text-muted-foreground truncate select-all font-sans">
                            raw: {entry.value}
                          </span>
                        {/if}
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-6 w-6 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onclick={() => copyToClipboard(entry.value, entry.key)}
                        title={`Copy ${entry.key}`}
                        aria-label={`Copy ${entry.key}`}
                      >
                        {#if copiedKey === entry.key}
                          <Check class="h-3 w-3 text-success" />
                        {:else}
                          <Copy class="h-3 w-3" />
                        {/if}
                      </Button>
                    </div>
                  {/each}
                {:else}
                  <div class="p-8 text-center text-xs text-muted-foreground italic flex flex-col items-center gap-1">
                    <Tag class="h-6 w-6 text-muted-foreground/40 mb-1" />
                    <span>No metadata properties match your search.</span>
                  </div>
                {/if}
              </div>
            {/if}
          </Tabs.Content>

          <!-- Overview and technical metrics -->
          <Tabs.Content value="overview" class="flex-1 min-h-0 p-6 overflow-y-auto space-y-4 m-0">
            <div class="grid grid-cols-2 gap-3">
              <div class="border border-border rounded-lg p-3 bg-muted/20 flex flex-col gap-1">
                <span class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">File Name</span>
                <span class="text-xs font-semibold text-foreground truncate" title={store.fileName}>
                  {store.fileName}
                </span>
              </div>
              <div class="border border-border rounded-lg p-3 bg-muted/20 flex flex-col gap-1">
                <span class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">File Size</span>
                <span class="text-xs font-semibold text-foreground">
                  {metadata?.sizeFormatted || '-'} ({metadata?.sizeBytes?.toLocaleString() || 0} bytes)
                </span>
              </div>
              <div class="border border-border rounded-lg p-3 bg-muted/20 flex flex-col gap-1">
                <span class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Page Count</span>
                <span class="text-xs font-semibold text-foreground">
                  {metadata?.pageCount || store.pageCount} pages
                </span>
              </div>
              <div class="border border-border rounded-lg p-3 bg-muted/20 flex flex-col gap-1">
                <span class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">PDF Specification</span>
                <span class="text-xs font-semibold text-foreground">
                  Version {metadata?.pdfVersion || '1.4'}
                </span>
              </div>
            </div>

            <div class="border border-border rounded-lg p-3.5 bg-card flex flex-col gap-2.5">
              <span class="text-xs font-semibold text-foreground">Timestamps & Pre-press Status</span>
              <div class="grid grid-cols-[120px_1fr] gap-x-2 gap-y-1.5 text-xs">
                <span class="text-muted-foreground">Creation Date:</span>
                <span class="text-foreground">{metadata?.creationDateFormatted || '-'}</span>

                <span class="text-muted-foreground">Modified Date:</span>
                <span class="text-foreground">{metadata?.modDateFormatted || '-'}</span>

                <span class="text-muted-foreground">Trapped State:</span>
                <span class="text-foreground">
                  {#if metadata?.trapped === 'True'}
                    <Badge variant="success" class="text-[10px]">Trapped (True)</Badge>
                  {:else if metadata?.trapped === 'False'}
                    <Badge variant="outline" class="text-[10px]">Untrapped (False)</Badge>
                  {:else}
                    <span class="text-muted-foreground">Unknown / Not Set</span>
                  {/if}
                </span>

                <span class="text-muted-foreground">XMP Stream:</span>
                <span class="text-foreground">
                  {metadata?.hasXmp ? 'Embedded XMP XML Packet Present' : 'No separate XMP stream'}
                </span>
              </div>
            </div>

            {#if metadata?.keywordsArray && metadata.keywordsArray.length > 0}
              <div class="border border-border rounded-lg p-3.5 bg-card flex flex-col gap-2">
                <span class="text-xs font-semibold text-foreground">Keywords & Tags</span>
                <div class="flex flex-wrap gap-1.5">
                  {#each metadata.keywordsArray as tag}
                    <Badge variant="secondary" class="text-[11px] px-2 py-0.5">
                      {tag}
                    </Badge>
                  {/each}
                </div>
              </div>
            {/if}
          </Tabs.Content>

          <!-- Security and access -->
          <Tabs.Content value="security" class="flex-1 min-h-0 p-6 overflow-y-auto space-y-4 m-0">
            <SecurityComplianceSection
              {metadata}
              {signatureResults}
              {isValidatingSignatures}
              onRefreshSignatures={loadSignatures}
              onOpenCertSign={() => {
                handleClose();
                actions.openCertSignDialog();
              }}
              onOpenValidateDialog={() => {
                actions.openValidateSignaturesDialog();
              }}
            />
          </Tabs.Content>

          <!-- Raw JSON and XMP stream -->
          <Tabs.Content value="raw" class="flex-1 flex flex-col min-h-0 p-6 overflow-hidden gap-3 m-0">
            <div class="flex items-center justify-between">
              <span class="text-xs text-muted-foreground font-medium">Raw Info Dictionary & XMP Stream</span>
              <div class="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  class="h-7 text-xs px-2.5"
                  onclick={() => copyToClipboard(JSON.stringify(metadata, null, 2), 'raw_json')}
                >
                  {#if copiedKey === 'raw_json'}
                    <Check class="h-3 w-3 mr-1.5 text-success" /> Copied JSON
                  {:else}
                    <Copy class="h-3 w-3 mr-1.5" /> Copy JSON
                  {/if}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="h-7 text-xs px-2.5"
                  onclick={exportMetadataAsJson}
                >
                  <Download class="h-3 w-3 mr-1.5" /> Export JSON
                </Button>
              </div>
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto rounded-md bg-muted/40 p-3 text-[11px] font-sans text-foreground border border-border select-all">
              {#if metadata?.xmpString}
                <div class="mb-3 pb-3 border-b border-border">
                  <span class="text-success font-semibold block mb-1">XMP Metadata XML Packet:</span>
                  <pre class="whitespace-pre-wrap break-all text-[10px] text-muted-foreground">{metadata.xmpString}</pre>
                </div>
              {/if}
              <span class="text-info font-semibold block mb-1">Normalized Metadata Dictionary:</span>
              <pre class="whitespace-pre-wrap">{JSON.stringify(metadata, null, 2)}</pre>
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </div>

      <!-- Feedback / Error messages -->
      {#if saveSuccess}
        <div class="px-6 py-2 bg-success/10 border-t border-success/30 flex items-center gap-2 text-xs font-medium text-success">
          <Check class="h-4 w-4 shrink-0 text-success" />
          Document metadata successfully updated and saved!
        </div>
      {/if}

      {#if errorMessage}
        <div class="px-6 py-2 bg-destructive/10 border-t border-destructive/30 flex items-center gap-2 text-xs font-medium text-destructive">
          <ShieldAlert class="h-4 w-4 shrink-0 text-destructive" />
          {errorMessage}
        </div>
      {/if}

      <!-- Footer -->
      <div class="px-6 py-3 border-t border-border bg-card flex items-center justify-between">
        <div class="flex items-center gap-2">
          {#if !isEditing}
            <Button
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              onclick={() => {
                syncEditForm();
                isEditing = true;
              }}
            >
              <Tag class="h-3 w-3 mr-1.5" /> Edit Metadata
            </Button>
          {:else}
            <Button
              variant="ghost"
              size="sm"
              class="h-8 text-xs text-muted-foreground"
              onclick={() => (isEditing = false)}
              disabled={isSaving}
            >
              Cancel Edit
            </Button>
          {/if}
        </div>

        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" class="h-8 text-xs" onclick={handleClose}>
            Close
          </Button>

          {#if isEditing}
            <Button
              size="sm"
              class="h-8 text-xs font-medium"
              onclick={handleSaveMetadata}
              disabled={isSaving}
            >
              {#if isSaving}
                <RefreshCw class="h-3 w-3 mr-1.5 animate-spin" /> Saving...
              {:else}
                <Save class="h-3 w-3 mr-1.5" /> Save Changes
              {/if}
            </Button>
          {/if}
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Root>
