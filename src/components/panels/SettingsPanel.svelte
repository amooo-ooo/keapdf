<script lang="ts">
  import type { DocumentMetadata, DocumentMetadataUpdate } from '../../core/types';
  import { useEditorStore, getFileBuffer } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import { formatByteSize } from '../../services/pdf/operations/metadata-ops';
  import SidebarSection from '../common/SidebarSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import {
    Lock,
    ShieldCheck,
    FileKey,
    Info,
    Wrench,
    Code2,
    Unlock,
    FileText,
    ListTree,
    ChevronDown,
    ChevronRight,
    AlertCircle,
    Check,
    Loader2,
    Palette,
    Eye,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  type EditableStandardField = 'title' | 'author' | 'subject' | 'creator' | 'producer' | 'keywords';

  let metadata = $state<DocumentMetadata | null>(null);
  let userPassword = $state('');
  let ownerPassword = $state('');
  let showAllFields = $state(false);

  let editingKey = $state<string | null>(null);
  let editingInitialValue = '';

  let isApplyingSecurity = $state(false);
  let isRemovingSecurity = $state(false);
  let isUnlockingForms = $state(false);
  let securityMessage = $state<string | null>(null);
  let securityError = $state<string | null>(null);

  const isDocumentEncrypted = $derived(metadata?.isEncrypted ?? false);

  const documentSizeBytes = $derived.by(() => {
    if (!store.isDocumentLoaded) return undefined;
    if (metadata?.sizeBytes && metadata.sizeBytes > 0) {
      return metadata.sizeBytes;
    }
    const buffer = store.activeWorkspaceFileId
      ? getFileBuffer(store.activeWorkspaceFileId)
      : undefined;
    if (buffer && buffer.byteLength > 0) {
      return buffer.byteLength;
    }
    const file = store.workspaceFiles.find(
      (f) => f.id === store.activeWorkspaceFileId
    );
    return file?.sizeBytes;
  });

  const formattedDocumentSize = $derived.by(() => {
    if (!store.isDocumentLoaded) return '-';
    if (documentSizeBytes !== undefined) {
      return formatByteSize(documentSizeBytes);
    }
    if (metadata?.sizeFormatted && metadata.sizeFormatted !== '-') {
      return metadata.sizeFormatted;
    }
    return '-';
  });

  $effect(() => {
    if (store.isDocumentLoaded) {
      void store.renderVersion;
      if (!metadata) {
        try {
          metadata = actions.service.document.getMetadata();
        } catch {
          metadata = null;
        }
      }
      actions
        .getExtendedDocumentMetadata()
        .then((meta) => {
          metadata = meta;
        })
        .catch(() => {
          // Fallback
        });
    } else {
      metadata = null;
    }
  });

  function getStandardFieldValue(field: EditableStandardField): string {
    if (!metadata) return '';
    return metadata[field] || '';
  }

  function handleFocus(field: EditableStandardField, event: FocusEvent): void {
    if (store.isReadOnly) {
      (event.currentTarget as HTMLElement).blur();
      return;
    }
    const el = event.currentTarget as HTMLElement;
    editingKey = field;
    editingInitialValue = getStandardFieldValue(field);
    if (el.textContent?.trim() === '-') {
      el.textContent = '';
    }
  }

  async function handleBlur(field: EditableStandardField, event: FocusEvent): Promise<void> {
    const el = event.currentTarget as HTMLElement;
    const value = el.textContent?.trim() ?? '';
    const initial = editingInitialValue;
    editingKey = null;

    if (!value) {
      el.textContent = '-';
    }

    if (value !== initial) {
      await saveStandardField(field, value);
    }
  }

  async function saveStandardField(field: EditableStandardField, value: string): Promise<void> {
    if (!metadata || store.isReadOnly) return;
    const updates: DocumentMetadataUpdate = {
      [field]: value,
    };
    metadata[field] = value;

    try {
      await actions.updateDocumentMetadata(updates);
      metadata = await actions.getExtendedDocumentMetadata();
    } catch (err) {
      console.error(`Failed to update metadata field ${field}:`, err);
      metadata = await actions.getExtendedDocumentMetadata().catch(() => metadata);
    }
  }

  function handleCustomFocus(key: string, event: FocusEvent): void {
    if (store.isReadOnly) {
      (event.currentTarget as HTMLElement).blur();
      return;
    }
    const el = event.currentTarget as HTMLElement;
    editingKey = `custom:${key}`;
    editingInitialValue = metadata?.customMetadata?.[key] ?? '';
    if (el.textContent?.trim() === '-') {
      el.textContent = '';
    }
  }

  async function handleCustomBlur(key: string, event: FocusEvent): Promise<void> {
    const el = event.currentTarget as HTMLElement;
    const value = el.textContent?.trim() ?? '';
    const initial = editingInitialValue;
    editingKey = null;

    if (!value) {
      el.textContent = '-';
    }

    if (value !== initial) {
      await saveCustomField(key, value);
    }
  }

  async function saveCustomField(key: string, value: string): Promise<void> {
    if (!metadata || store.isReadOnly) return;
    const customMetadata: Record<string, string> = {
      ...(metadata.customMetadata || {}),
      [key]: value,
    };
    if (metadata.customMetadata) {
      metadata.customMetadata[key] = value;
    }

    try {
      await actions.updateDocumentMetadata({ customMetadata });
      metadata = await actions.getExtendedDocumentMetadata();
    } catch (err) {
      console.error(`Failed to update custom metadata field ${key}:`, err);
      metadata = await actions.getExtendedDocumentMetadata().catch(() => metadata);
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (store.isReadOnly) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      (event.currentTarget as HTMLElement).blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      const el = event.currentTarget as HTMLElement;
      el.textContent = editingInitialValue || '-';
      el.blur();
    }
  }

  function handlePaste(event: ClipboardEvent): void {
    if (store.isReadOnly) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const cleanText = text.replace(/[\r\n]+/g, ' ').trim();
    document.execCommand('insertText', false, cleanText);
  }

  async function handleApplySecurity(): Promise<void> {
    if (!userPassword && !ownerPassword) return;
    isApplyingSecurity = true;
    securityMessage = null;
    securityError = null;
    try {
      await actions.applyPasswordSecurity(userPassword, ownerPassword);
      userPassword = '';
      ownerPassword = '';
      securityMessage = 'Password protection successfully applied.';
      metadata = actions.service.document.getMetadata();
    } catch (err) {
      securityError = err instanceof Error ? err.message : 'Failed to apply password security.';
    } finally {
      isApplyingSecurity = false;
    }
  }

  async function handleRemoveSecurity(): Promise<void> {
    isRemovingSecurity = true;
    securityMessage = null;
    securityError = null;
    try {
      await actions.removePasswordSecurity(ownerPassword || undefined);
      ownerPassword = '';
      securityMessage = 'Document security removed successfully.';
      metadata = actions.service.document.getMetadata();
    } catch (err) {
      securityError = err instanceof Error ? err.message : 'Failed to remove security.';
    } finally {
      isRemovingSecurity = false;
    }
  }

  async function handleUnlockForms(): Promise<void> {
    isUnlockingForms = true;
    securityMessage = null;
    securityError = null;
    try {
      const res = await actions.unlockForms();
      if (res.fieldsUnlockedCount > 0 || res.annotationsUnlockedCount > 0) {
        securityMessage = `Unlocked ${res.fieldsUnlockedCount} form fields (${res.annotationsUnlockedCount} widgets).`;
      } else {
        securityMessage = 'All form fields are already editable.';
      }
    } catch (err) {
      securityError = err instanceof Error ? err.message : 'Failed to unlock form fields.';
    } finally {
      isUnlockingForms = false;
    }
  }

  function triggerTool(toolName: string): void {
    store.activeMockupTool = toolName;
  }
</script>

<div class="panel-root">
  <!-- Document info and metadata -->
  <SidebarSection title="Document Info & Metadata" borderBottom={true}>
    {#if store.isReadOnly}
      <div class="panel-metric-banner mb-2 flex items-center justify-between py-1.5 px-2 bg-muted/40 rounded-md border border-border/50 text-[11px] text-muted-foreground">
        <div class="flex items-center gap-1.5">
          <Eye class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span>Viewing Mode (Read-only)</span>
        </div>
        <span class="panel-status-pill">Read-only</span>
      </div>
    {/if}
    {#if metadata}
      <div class="panel-metric-banner mb-2">
        <div class="panel-key-value-grid">
          <div class="panel-key-label">Title</div>
          <div
            class="panel-value-text cursor-text outline-none select-text"
            contenteditable="plaintext-only"
            role="textbox"
            aria-label="Title"
            tabindex={0}
            spellcheck={false}
            title={editingKey === 'title' ? '' : (metadata.title || '-')}
            onfocus={(e) => handleFocus('title', e)}
            onblur={(e) => handleBlur('title', e)}
            onkeydown={handleKeydown}
            onpaste={handlePaste}
          >
            {metadata.title || '-'}
          </div>

          <div class="panel-key-label">Author</div>
          <div
            class="panel-value-text cursor-text outline-none select-text"
            contenteditable="plaintext-only"
            role="textbox"
            aria-label="Author"
            tabindex={0}
            spellcheck={false}
            title={editingKey === 'author' ? '' : (metadata.author || '-')}
            onfocus={(e) => handleFocus('author', e)}
            onblur={(e) => handleBlur('author', e)}
            onkeydown={handleKeydown}
            onpaste={handlePaste}
          >
            {metadata.author || '-'}
          </div>

          <div class="panel-key-label">Size</div>
          <div class="panel-value-text" title={formattedDocumentSize}>
            {formattedDocumentSize}
          </div>

          <div class="panel-key-label">Subject</div>
          <div
            class="panel-value-text cursor-text outline-none select-text"
            contenteditable="plaintext-only"
            role="textbox"
            aria-label="Subject"
            tabindex={0}
            spellcheck={false}
            title={editingKey === 'subject' ? '' : (metadata.subject || '-')}
            onfocus={(e) => handleFocus('subject', e)}
            onblur={(e) => handleBlur('subject', e)}
            onkeydown={handleKeydown}
            onpaste={handlePaste}
          >
            {metadata.subject || '-'}
          </div>

          <div class="panel-key-label">Creator</div>
          <div
            class="panel-value-text cursor-text outline-none select-text"
            contenteditable="plaintext-only"
            role="textbox"
            aria-label="Creator"
            tabindex={0}
            spellcheck={false}
            title={editingKey === 'creator' ? '' : (metadata.creator || '-')}
            onfocus={(e) => handleFocus('creator', e)}
            onblur={(e) => handleBlur('creator', e)}
            onkeydown={handleKeydown}
            onpaste={handlePaste}
          >
            {metadata.creator || '-'}
          </div>

          <div class="panel-key-label">Producer</div>
          <div
            class="panel-value-text cursor-text outline-none select-text"
            contenteditable="plaintext-only"
            role="textbox"
            aria-label="Producer"
            tabindex={0}
            spellcheck={false}
            title={editingKey === 'producer' ? '' : (metadata.producer || '-')}
            onfocus={(e) => handleFocus('producer', e)}
            onblur={(e) => handleBlur('producer', e)}
            onkeydown={handleKeydown}
            onpaste={handlePaste}
          >
            {metadata.producer || '-'}
          </div>

          {#if showAllFields}
            <div class="panel-key-label">Keywords</div>
            <div
              class="panel-value-text cursor-text outline-none select-text"
              contenteditable="plaintext-only"
              role="textbox"
              aria-label="Keywords"
              tabindex={0}
              spellcheck={false}
              title={editingKey === 'keywords' ? '' : (metadata.keywords || '-')}
              onfocus={(e) => handleFocus('keywords', e)}
              onblur={(e) => handleBlur('keywords', e)}
              onkeydown={handleKeydown}
              onpaste={handlePaste}
            >
              {metadata.keywords || '-'}
            </div>

            {#if metadata.creationDateFormatted}
              <div class="panel-key-label">Created</div>
              <div class="panel-value-text" title={metadata.creationDateFormatted}>
                {metadata.creationDateFormatted}
              </div>
            {/if}

            {#if metadata.modDateFormatted}
              <div class="panel-key-label">Modified</div>
              <div class="panel-value-text" title={metadata.modDateFormatted}>
                {metadata.modDateFormatted}
              </div>
            {/if}

            {#if metadata.trapped && metadata.trapped !== 'Unknown'}
              <div class="panel-key-label">Trapped</div>
              <div class="panel-value-text">{metadata.trapped}</div>
            {/if}

            <!-- Dynamic Custom Metadata Fields -->
            {#if metadata.customMetadata && Object.keys(metadata.customMetadata).length > 0}
              {#each Object.entries(metadata.customMetadata) as [key, val] (key)}
                <div class="panel-key-label flex items-center gap-1">
                  <span class="truncate" title={key}>{key}</span>
                  <Badge variant="secondary" class="text-[8px] px-0.5 py-0 h-3 leading-none font-sans">
                    custom
                  </Badge>
                </div>
                <div
                  class="panel-value-text cursor-text outline-none select-text"
                  contenteditable="plaintext-only"
                  role="textbox"
                  aria-label={key}
                  tabindex={0}
                  spellcheck={false}
                  title={editingKey === `custom:${key}` ? '' : (val || '-')}
                  onfocus={(e) => handleCustomFocus(key, e)}
                  onblur={(e) => handleCustomBlur(key, e)}
                  onkeydown={handleKeydown}
                  onpaste={handlePaste}
                >
                  {val || '-'}
                </div>
              {/each}
            {/if}
          {/if}
        </div>

        {#if metadata.allEntries && metadata.allEntries.length > 5}
          <button
            type="button"
            class="panel-action-link-primary flex items-center gap-1 self-start pt-0.5 rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={showAllFields}
            onclick={() => (showAllFields = !showAllFields)}
          >
            {#if showAllFields}
              <ChevronDown class="h-3 w-3" aria-hidden="true" /> Show fewer fields
            {:else}
              <ChevronRight class="h-3 w-3" aria-hidden="true" /> Show all {metadata.allEntries.length} metadata fields
            {/if}
          </button>
        {/if}
      </div>
    {:else}
      <div class="text-xs text-muted-foreground flex items-center gap-1.5 mb-2">
        <Info class="h-3.5 w-3.5" /> No document loaded
      </div>
    {/if}

    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('document-info')}
      <Button
        variant="panel"
        onclick={() => actions.openDocumentInfoDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <FileText class="panel-icon-sm text-primary" /> Get ALL Info on PDF
      </Button>
      {/if}

      {#if featureFlags.isEnabled('settings.toc')}
      <Button
        variant="panel"
        onclick={() => triggerTool('Edit Table of Contents')}
        disabled={!store.isDocumentLoaded}
      >
        <ListTree class="panel-icon-sm text-muted-foreground" /> Edit Table of Contents
      </Button>
      {/if}

      {#if featureFlags.isEnabled('sanitization')}
      <Button
        variant="panel"
        onclick={() => actions.openSanitizeDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <ShieldCheck class="panel-icon-sm text-primary" /> Sanitise Document
      </Button>
      {/if}
    </div>
  </SidebarSection>


  <!-- Password protection and security -->
  {#if featureFlags.isEnabled('security')}
  <SidebarSection title="Password Security & Access" borderBottom={true}>
    <p class="panel-description">Set or remove document passwords and permissions.</p>

    {#if securityMessage}
      <div class="mb-2 panel-status-pill">
        <Check class="h-3 w-3 shrink-0" />
        <span>{securityMessage}</span>
      </div>
    {/if}

    {#if securityError}
      <div class="mb-2 panel-error-pill">
        <AlertCircle class="h-3 w-3 shrink-0" />
        <span>{securityError}</span>
      </div>
    {/if}

    <div class="flex flex-col gap-2.5">
      {#if featureFlags.isEnabled('security.password')}
        {#if isDocumentEncrypted}
          <div class="panel-card-inset">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Lock class="h-3.5 w-3.5 text-primary" /> Document Protected
              </div>
              <Badge variant="default" class="text-[10px]">Encrypted</Badge>
            </div>
            <p class="text-[11px] text-muted-foreground">
              This document has active password protection and access controls.
            </p>

            {#if !store.isOwnerUnlocked}
              <div class="field-group-sm pt-1">
                <Label for="owner-unlock-pwd" class="field-label">Owner Password (to remove)</Label>
                <Input
                  id="owner-unlock-pwd"
                  type="password"
                  placeholder="Enter owner password..."
                  bind:value={ownerPassword}
                  class="field-input"
                />
              </div>
            {/if}

            <Button
              variant="outline"
              size="sm"
              class="w-full text-xs h-7 justify-center text-destructive hover:text-destructive mt-1"
              onclick={handleRemoveSecurity}
              disabled={!store.isDocumentLoaded || isRemovingSecurity || store.isReadOnly}
            >
              {#if isRemovingSecurity}
                <Loader2 class="h-3 w-3 mr-1.5 animate-spin" /> Removing Security...
              {:else}
                <Unlock class="h-3 w-3 mr-1.5" /> Remove Password Security
              {/if}
            </Button>
          </div>
        {:else}
          <div class="field-group-sm">
            <Label for="user-password" class="field-label">Document Open Password</Label>
            <Input
              id="user-password"
              type="password"
              placeholder="Enter user password..."
              bind:value={userPassword}
              class="field-input"
              disabled={isApplyingSecurity || store.isReadOnly}
            />
          </div>

          <div class="field-group-sm">
            <Label for="owner-password" class="field-label">Permissions / Owner Password</Label>
            <Input
              id="owner-password"
              type="password"
              placeholder="Enter owner password..."
              bind:value={ownerPassword}
              class="field-input"
              disabled={isApplyingSecurity || store.isReadOnly}
            />
          </div>

          <Button
            variant="secondary"
            size="sm"
            class="w-full text-xs h-8"
            onclick={handleApplySecurity}
            disabled={!store.isDocumentLoaded || (!userPassword && !ownerPassword) || isApplyingSecurity || store.isReadOnly}
          >
            {#if isApplyingSecurity}
              <Loader2 class="h-3.5 w-3.5 mr-2 animate-spin" /> Encrypting...
            {:else}
              <Lock class="h-3.5 w-3.5 mr-2 text-primary" /> Apply Password Security
            {/if}
          </Button>
        {/if}
      {/if}

      <div class="panel-action-stack mt-1">
        {#if featureFlags.isEnabled('security.unlock-forms')}
        <Button
          variant="panel"
          onclick={handleUnlockForms}
          disabled={!store.isDocumentLoaded || isUnlockingForms || store.isReadOnly}
        >
          {#if isUnlockingForms}
            <Loader2 class="panel-icon-sm animate-spin text-warning" /> Unlocking...
          {:else}
            <Unlock class="panel-icon-sm text-warning" /> Unlock Forms
          {/if}
        </Button>
        {/if}

        {#if featureFlags.isEnabled('security.permissions')}
        <Button
          variant="panel"
          onclick={() => actions.openPermissionsDialog()}
          disabled={!store.isDocumentLoaded || store.isReadOnly}
        >
          <FileKey class="panel-icon-sm text-muted-foreground" /> Permissions
        </Button>
        {/if}
      </div>
    </div>
  </SidebarSection>
  {/if}

  <!-- Repair and developer tools -->
  {#if featureFlags.isEnabled('tools')}
  <SidebarSection title="Repair & Developer Info" borderBottom={false}>
    <p class="panel-description">Repair damaged PDFs or inspect embedded JavaScript.</p>

    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('tools.repair')}
      <Button
        variant="panel"
        onclick={() => triggerTool('Repair Damaged PDF')}
        disabled={!store.isDocumentLoaded}
      >
        <Wrench class="panel-icon-sm text-warning" /> Repair Damaged PDF
      </Button>
      {/if}

      {#if featureFlags.isEnabled('tools.javascript')}
      <Button
        variant="panel"
        onclick={() => triggerTool('Show Embedded JavaScript')}
        disabled={!store.isDocumentLoaded}
      >
        <Code2 class="panel-icon-sm text-primary" /> Show Embedded JavaScript
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.gallery')}
      <Button
        variant="panel"
        onclick={() => store.openComponentGalleryDialog()}
      >
        <Palette class="panel-icon-sm text-primary" /> UI Component Gallery
      </Button>
      {/if}

      <div class="flex items-center justify-between pt-1">
        <span class="text-xs text-muted-foreground">Encryption Standard</span>
        {#if isDocumentEncrypted}
          <Badge variant="default" class="text-[10px]">
            <ShieldCheck class="h-3 w-3 mr-1" /> Encrypted
          </Badge>
        {:else}
          <Badge variant="outline" class="text-[10px]">
            <FileKey class="h-3 w-3 mr-1" /> Standard
          </Badge>
        {/if}
      </div>
    </div>
  </SidebarSection>
  {/if}
</div>

