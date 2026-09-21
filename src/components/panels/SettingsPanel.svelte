<script lang="ts">
  import type { DocumentMetadata } from '../../core/types';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../core/feature-flags';
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
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  let metadata = $state<DocumentMetadata | null>(null);
  let userPassword = $state('');
  let ownerPassword = $state('');
  let showAllFields = $state(false);

  let isApplyingSecurity = $state(false);
  let isRemovingSecurity = $state(false);
  let isUnlockingForms = $state(false);
  let securityMessage = $state<string | null>(null);
  let securityError = $state<string | null>(null);

  const isDocumentEncrypted = $derived(metadata?.isEncrypted ?? false);

  $effect(() => {
    if (store.isDocumentLoaded) {
      void store.renderVersion;
      try {
        metadata = actions.service.document.getMetadata();
      } catch {
        metadata = null;
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

<div class="flex flex-col min-h-0 divide-y divide-border">
  <!-- Section 1: Document Info & Metadata -->
  <SidebarSection title="Document Info & Metadata" borderBottom={true}>
    {#if metadata}
      <div class="flex flex-col gap-1.5 mb-2">
        <div class="grid grid-cols-[1fr_2fr] gap-x-2 gap-y-1.5 text-xs">
          <div class="text-muted-foreground truncate">Title</div>
          <div class="text-foreground truncate font-medium" title={metadata.title || '-'}>
            {metadata.title || '-'}
          </div>

          <div class="text-muted-foreground truncate">Author</div>
          <div class="text-foreground truncate" title={metadata.author || '-'}>
            {metadata.author || '-'}
          </div>

          <div class="text-muted-foreground truncate">Subject</div>
          <div class="text-foreground truncate" title={metadata.subject || '-'}>
            {metadata.subject || '-'}
          </div>

          <div class="text-muted-foreground truncate">Creator</div>
          <div class="text-foreground truncate" title={metadata.creator || '-'}>
            {metadata.creator || '-'}
          </div>

          <div class="text-muted-foreground truncate">Producer</div>
          <div class="text-foreground truncate" title={metadata.producer || '-'}>
            {metadata.producer || '-'}
          </div>

          {#if showAllFields}
            {#if metadata.keywords}
              <div class="text-muted-foreground truncate">Keywords</div>
              <div class="text-foreground truncate" title={metadata.keywords}>
                {metadata.keywords}
              </div>
            {/if}

            {#if metadata.creationDateFormatted}
              <div class="text-muted-foreground truncate">Created</div>
              <div class="text-foreground truncate" title={metadata.creationDateFormatted}>
                {metadata.creationDateFormatted}
              </div>
            {/if}

            {#if metadata.modDateFormatted}
              <div class="text-muted-foreground truncate">Modified</div>
              <div class="text-foreground truncate" title={metadata.modDateFormatted}>
                {metadata.modDateFormatted}
              </div>
            {/if}

            {#if metadata.trapped && metadata.trapped !== 'Unknown'}
              <div class="text-muted-foreground truncate">Trapped</div>
              <div class="text-foreground truncate">{metadata.trapped}</div>
            {/if}

            <!-- Dynamic Custom Metadata Fields -->
            {#if metadata.customMetadata && Object.keys(metadata.customMetadata).length > 0}
              {#each Object.entries(metadata.customMetadata) as [key, val]}
                <div class="text-muted-foreground truncate flex items-center gap-1">
                  <span class="truncate" title={key}>{key}</span>
                  <Badge variant="secondary" class="text-[8px] px-0.5 py-0 h-3 leading-none font-sans">
                    custom
                  </Badge>
                </div>
                <div class="text-foreground truncate" title={val}>{val}</div>
              {/each}
            {/if}
          {/if}
        </div>

        {#if metadata.allEntries && metadata.allEntries.length > 5}
          <button
            type="button"
            class="flex items-center gap-1 text-[11px] text-primary hover:underline self-start pt-0.5 cursor-pointer"
            onclick={() => (showAllFields = !showAllFields)}
          >
            {#if showAllFields}
              <ChevronDown class="h-3 w-3" /> Show fewer fields
            {:else}
              <ChevronRight class="h-3 w-3" /> Show all {metadata.allEntries.length} metadata fields
            {/if}
          </button>
        {/if}
      </div>
    {:else}
      <div class="text-xs text-muted-foreground flex items-center gap-1.5 mb-2">
        <Info class="h-3.5 w-3.5" /> No document loaded
      </div>
    {/if}

    <div class="flex flex-col gap-2">
      {#if featureFlags.isEnabled('document-info')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 px-2.5"
        onclick={() => actions.openDocumentInfoDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <FileText class="h-3.5 w-3.5 mr-2 text-primary" /> Get ALL Info on PDF
      </Button>
      {/if}

      {#if featureFlags.isEnabled('settings.toc')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8 px-2.5"
        onclick={() => triggerTool('Edit Table of Contents')}
        disabled={!store.isDocumentLoaded}
      >
        <ListTree class="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Edit Table of Contents
      </Button>
      {/if}

      {#if featureFlags.isEnabled('sanitization')}
      <Button
        variant="default"
        size="sm"
        class="w-full justify-start text-xs h-8 px-2.5 font-medium"
        onclick={() => actions.openSanitizeDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <ShieldCheck class="h-3.5 w-3.5 mr-2 text-primary-foreground" /> Sanitise Document
      </Button>
      {/if}
    </div>
  </SidebarSection>

  <!-- Section 2: Password Protection & Security -->
  {#if featureFlags.isEnabled('security')}
  <SidebarSection title="Password Security & Access" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Set or remove document passwords and permissions.</p>

    {#if securityMessage}
      <div class="mb-2 rounded-md bg-primary/10 px-2.5 py-1.5 text-[11px] text-primary flex items-center gap-1.5">
        <Check class="h-3 w-3 shrink-0" />
        <span>{securityMessage}</span>
      </div>
    {/if}

    {#if securityError}
      <div class="mb-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive flex items-center gap-1.5">
        <AlertCircle class="h-3 w-3 shrink-0" />
        <span>{securityError}</span>
      </div>
    {/if}

    <div class="flex flex-col gap-2.5">
      {#if featureFlags.isEnabled('security.password')}
        {#if isDocumentEncrypted}
          <div class="flex flex-col gap-2 rounded-lg border p-2.5 bg-muted/20">
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
              <div class="flex flex-col gap-1 pt-1">
                <Label for="owner-unlock-pwd" class="text-[11px] text-muted-foreground">Owner Password (to remove)</Label>
                <Input
                  id="owner-unlock-pwd"
                  type="password"
                  placeholder="Enter owner password..."
                  bind:value={ownerPassword}
                  class="h-7 text-xs"
                />
              </div>
            {/if}

            <Button
              variant="outline"
              size="sm"
              class="w-full text-xs h-7 justify-center text-destructive hover:text-destructive mt-1"
              onclick={handleRemoveSecurity}
              disabled={!store.isDocumentLoaded || isRemovingSecurity}
            >
              {#if isRemovingSecurity}
                <Loader2 class="h-3 w-3 mr-1.5 animate-spin" /> Removing Security...
              {:else}
                <Unlock class="h-3 w-3 mr-1.5" /> Remove Password Security
              {/if}
            </Button>
          </div>
        {:else}
          <div class="flex flex-col gap-1">
            <Label for="user-password" class="text-xs text-muted-foreground">Document Open Password</Label>
            <Input
              id="user-password"
              type="password"
              placeholder="Enter user password..."
              bind:value={userPassword}
              class="h-8 text-xs"
              disabled={isApplyingSecurity}
            />
          </div>

          <div class="flex flex-col gap-1">
            <Label for="owner-password" class="text-xs text-muted-foreground">Permissions / Owner Password</Label>
            <Input
              id="owner-password"
              type="password"
              placeholder="Enter owner password..."
              bind:value={ownerPassword}
              class="h-8 text-xs"
              disabled={isApplyingSecurity}
            />
          </div>

          <Button
            variant="secondary"
            size="sm"
            class="w-full text-xs h-8"
            onclick={handleApplySecurity}
            disabled={!store.isDocumentLoaded || (!userPassword && !ownerPassword) || isApplyingSecurity}
          >
            {#if isApplyingSecurity}
              <Loader2 class="h-3.5 w-3.5 mr-2 animate-spin" /> Encrypting...
            {:else}
              <Lock class="h-3.5 w-3.5 mr-2 text-primary" /> Apply Password Security
            {/if}
          </Button>
        {/if}
      {/if}

      <div class="flex flex-col gap-2 mt-1">
        {#if featureFlags.isEnabled('security.unlock-forms')}
        <Button
          variant="outline"
          size="sm"
          class="w-full justify-start text-xs h-8 px-2.5"
          onclick={handleUnlockForms}
          disabled={!store.isDocumentLoaded || isUnlockingForms}
        >
          {#if isUnlockingForms}
            <Loader2 class="h-3.5 w-3.5 mr-2 animate-spin text-warning" /> Unlocking...
          {:else}
            <Unlock class="h-3.5 w-3.5 mr-2 text-warning" /> Unlock Forms
          {/if}
        </Button>
        {/if}

        {#if featureFlags.isEnabled('security.permissions')}
        <Button
          variant="outline"
          size="sm"
          class="w-full justify-start text-xs h-8 px-2.5"
          onclick={() => actions.openPermissionsDialog()}
          disabled={!store.isDocumentLoaded}
        >
          <FileKey class="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Permissions
        </Button>
        {/if}
      </div>
    </div>
  </SidebarSection>
  {/if}

  <!-- Section 3: Repair & Developer Tools -->
  {#if featureFlags.isEnabled('tools')}
  <SidebarSection title="Repair & Developer Info" borderBottom={false}>
    <p class="text-xs text-muted-foreground mb-2">Repair damaged PDFs or inspect embedded JavaScript.</p>

    <div class="flex flex-col gap-2">
      {#if featureFlags.isEnabled('tools.repair')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Repair Damaged PDF')}
        disabled={!store.isDocumentLoaded}
      >
        <Wrench class="h-3.5 w-3.5 mr-2 text-warning" /> Repair Damaged PDF
      </Button>
      {/if}

      {#if featureFlags.isEnabled('tools.javascript')}
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Show Embedded JavaScript')}
        disabled={!store.isDocumentLoaded}
      >
        <Code2 class="h-3.5 w-3.5 mr-2 text-primary" /> Show Embedded JavaScript
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
