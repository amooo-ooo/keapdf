<script lang="ts">
  import type { DocumentMetadata } from '../../core/types';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
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
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

  let metadata = $state<DocumentMetadata | null>(null);
  let userPassword = $state('');
  let ownerPassword = $state('');
  let isEncrypted = $state(false);
  let showAllFields = $state(false);

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

  function handleApplySecurity(): void {
    if (!userPassword && !ownerPassword) return;
    isEncrypted = true;
    userPassword = '';
    ownerPassword = '';
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
                  <Badge variant="secondary" class="text-[8px] px-0.5 py-0 h-3 leading-none font-mono">
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
      <div class="text-xs text-muted-foreground italic flex items-center gap-1.5 mb-2">
        <Info class="h-3.5 w-3.5" /> No document loaded
      </div>
    {/if}

    <div class="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-7 px-2"
        onclick={() => actions.openDocumentInfoDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <FileText class="h-3 w-3 mr-1.5 text-primary" /> Get ALL Info on PDF
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-7 px-2"
        onclick={() => triggerTool('Edit Table of Contents')}
        disabled={!store.isDocumentLoaded}
      >
        <ListTree class="h-3 w-3 mr-1.5 text-muted-foreground" /> Edit Table of Contents
      </Button>

      <Button
        variant="default"
        size="sm"
        class="w-full justify-start text-xs h-7 px-2 font-medium"
        onclick={() => actions.openSanitizeDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <ShieldCheck class="h-3 w-3 mr-1.5 text-primary-foreground" /> Sanitise Document
      </Button>
    </div>
  </SidebarSection>

  <!-- Section 2: Password Protection & Security -->
  <SidebarSection title="Password Security & Access" borderBottom={true}>
    <p class="text-xs text-muted-foreground mb-2">Set or remove document passwords and permissions.</p>

    <div class="flex flex-col gap-2.5">
      <div class="flex flex-col gap-1">
        <Label for="user-password" class="text-xs text-muted-foreground">Document Open Password</Label>
        <Input
          id="user-password"
          type="password"
          placeholder="Enter user password..."
          bind:value={userPassword}
          class="h-8 text-xs"
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
        />
      </div>

      <Button
        variant="secondary"
        size="sm"
        class="w-full text-xs h-8"
        onclick={handleApplySecurity}
        disabled={!store.isDocumentLoaded || (!userPassword && !ownerPassword)}
      >
        <Lock class="h-3.5 w-3.5 mr-2 text-primary" /> Apply Password Security
      </Button>

      <div class="grid grid-cols-2 gap-2 mt-1">
        <Button
          variant="outline"
          size="sm"
          class="justify-start text-xs h-7 px-2"
          onclick={() => triggerTool('Unlock PDF Forms')}
          disabled={!store.isDocumentLoaded}
        >
          <Unlock class="h-3 w-3 mr-1.5 text-amber-500" /> Unlock Forms
        </Button>

        <Button
          variant="outline"
          size="sm"
          class="justify-start text-xs h-7 px-2"
          onclick={() => triggerTool('Change Permissions')}
          disabled={!store.isDocumentLoaded}
        >
          <FileKey class="h-3 w-3 mr-1.5 text-muted-foreground" /> Permissions
        </Button>
      </div>
    </div>
  </SidebarSection>

  <!-- Section 3: Repair & Developer Tools -->
  <SidebarSection title="Repair & Developer Info" borderBottom={false}>
    <p class="text-xs text-muted-foreground mb-2">Repair damaged PDFs or inspect embedded JavaScript.</p>

    <div class="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Repair Damaged PDF')}
        disabled={!store.isDocumentLoaded}
      >
        <Wrench class="h-3.5 w-3.5 mr-2 text-amber-500" /> Repair Damaged PDF
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start text-xs h-8"
        onclick={() => triggerTool('Show Embedded JavaScript')}
        disabled={!store.isDocumentLoaded}
      >
        <Code2 class="h-3.5 w-3.5 mr-2 text-primary" /> Show Embedded JavaScript
      </Button>

      <div class="flex items-center justify-between pt-1">
        <span class="text-xs text-muted-foreground">Encryption Standard</span>
        {#if isEncrypted}
          <Badge variant="default" class="text-[10px] bg-emerald-600">
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
</div>
