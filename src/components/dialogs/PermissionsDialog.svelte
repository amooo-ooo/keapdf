<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import {
    computePermissionBitmask,
    decodePermissionBitmask,
    type PdfPermissionFlags,
  } from '../../services/pdf/operations/security-ops';
  import {
    Key,
    Eye,
    EyeOff,
    AlertCircle,
    Loader2,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

  let canPrint = $state(true);
  let canPrintHighQuality = $state(true);
  let canCopy = $state(true);
  let canModify = $state(true);
  let canAnnotate = $state(true);
  let canFillForms = $state(true);
  let canExtractAccessibility = $state(true);
  let canAssemble = $state(true);

  let ownerPassword = $state('');
  let showPassword = $state(false);
  let errorMessage = $state<string | null>(null);
  let isSaving = $state(false);

  // Synchronise with current document permissions on open
  $effect(() => {
    if (store.showPermissionsDialog) {
      errorMessage = null;
      ownerPassword = '';
      showPassword = false;
      isSaving = false;

      if (store.isDocumentLoaded) {
        actions
          .getExtendedDocumentMetadata()
          .then((metadata) => {
            if (metadata && metadata.permissions !== undefined) {
              const decoded = decodePermissionBitmask(metadata.permissions);
              canPrint = decoded.canPrint;
              canPrintHighQuality = decoded.canPrintHighQuality;
              canCopy = decoded.canCopy;
              canModify = decoded.canModify;
              canAnnotate = decoded.canAnnotate;
              canFillForms = decoded.canFillForms;
              canExtractAccessibility = decoded.canExtractAccessibility;
              canAssemble = decoded.canAssemble;
            } else {
              applyPreset('unrestricted');
            }
          })
          .catch(() => {
            applyPreset('unrestricted');
          });
      } else {
        applyPreset('unrestricted');
      }
    }
  });

  const currentFlags = $derived<PdfPermissionFlags>({
    canPrint,
    canPrintHighQuality,
    canCopy,
    canModify,
    canAnnotate,
    canFillForms,
    canExtractAccessibility,
    canAssemble,
  });

  const computedBitmask = $derived(computePermissionBitmask(currentFlags));
  const hexMask = $derived(`0x${(computedBitmask >>> 0).toString(16).toUpperCase()}`);

  function applyPreset(preset: 'read-only' | 'fill-and-sign' | 'unrestricted'): void {
    if (preset === 'read-only') {
      canPrint = true;
      canPrintHighQuality = true;
      canCopy = false;
      canModify = false;
      canAnnotate = false;
      canFillForms = false;
      canExtractAccessibility = true;
      canAssemble = false;
    } else if (preset === 'fill-and-sign') {
      canPrint = true;
      canPrintHighQuality = true;
      canCopy = false;
      canModify = false;
      canAnnotate = true;
      canFillForms = true;
      canExtractAccessibility = true;
      canAssemble = false;
    } else {
      canPrint = true;
      canPrintHighQuality = true;
      canCopy = true;
      canModify = true;
      canAnnotate = true;
      canFillForms = true;
      canExtractAccessibility = true;
      canAssemble = true;
    }
  }

  async function handleApply(): Promise<void> {
    if (isSaving) return;
    errorMessage = null;

    if (!ownerPassword.trim()) {
      errorMessage = 'An owner password is required to enforce document permissions.';
      return;
    }

    isSaving = true;
    try {
      await actions.applyPermissions(currentFlags, ownerPassword.trim());
      store.closePermissionsDialog();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to apply document permissions.';
    } finally {
      isSaving = false;
    }
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      store.closePermissionsDialog();
    }
  }
</script>

<Dialog.Root open={store.showPermissionsDialog} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-lg font-sans">
    <Dialog.Header>
      <div class="flex items-center gap-2 mb-1">
        <div class="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <Key class="h-4 w-4" />
        </div>
        <div>
          <Dialog.Title class="text-base font-semibold">Granular Document Permissions</Dialog.Title>
          <Dialog.Description class="text-xs text-muted-foreground">
            Configure ISO 32000-1 access permissions and owner authentication restrictions.
          </Dialog.Description>
        </div>
      </div>
    </Dialog.Header>

    {#if errorMessage}
      <div class="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <AlertCircle class="h-4 w-4 shrink-0" />
        <span>{errorMessage}</span>
      </div>
    {/if}

    <!-- Presets and Bitmask Preview -->
    <div class="flex items-center justify-between border-b pb-3 pt-1">
      <div class="flex items-center gap-1.5">
        <span class="text-xs text-muted-foreground mr-1">Presets:</span>
        <Button
          variant="outline"
          size="sm"
          class="h-7 text-[11px] px-2"
          onclick={() => applyPreset('read-only')}
        >
          Read Only
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="h-7 text-[11px] px-2"
          onclick={() => applyPreset('fill-and-sign')}
        >
          Fill & Sign
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="h-7 text-[11px] px-2"
          onclick={() => applyPreset('unrestricted')}
        >
          Unrestricted
        </Button>
      </div>
      <Badge variant="secondary" class="font-sans text-[10px]">
        Mask: {hexMask}
      </Badge>
    </div>

    <!-- Permission Scope Switches -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2 max-h-64 overflow-y-auto pr-1">
      <div class="flex items-center justify-between rounded-lg border p-2.5">
        <div class="space-y-0.5 pr-2">
          <Label class="text-xs font-medium cursor-pointer" for="perm-print">Printing</Label>
          <p class="text-[10px] text-muted-foreground">Allow low-resolution draft printing</p>
        </div>
        <Switch id="perm-print" bind:checked={canPrint} />
      </div>

      <div class="flex items-center justify-between rounded-lg border p-2.5">
        <div class="space-y-0.5 pr-2">
          <Label class="text-xs font-medium cursor-pointer" for="perm-print-hq">High-Quality Print</Label>
          <p class="text-[10px] text-muted-foreground">Allow high-resolution document output</p>
        </div>
        <Switch id="perm-print-hq" bind:checked={canPrintHighQuality} disabled={!canPrint} />
      </div>

      <div class="flex items-center justify-between rounded-lg border p-2.5">
        <div class="space-y-0.5 pr-2">
          <Label class="text-xs font-medium cursor-pointer" for="perm-copy">Content Copying</Label>
          <p class="text-[10px] text-muted-foreground">Allow copying text and graphic assets</p>
        </div>
        <Switch id="perm-copy" bind:checked={canCopy} />
      </div>

      <div class="flex items-center justify-between rounded-lg border p-2.5">
        <div class="space-y-0.5 pr-2">
          <Label class="text-xs font-medium cursor-pointer" for="perm-accessibility">Accessibility</Label>
          <p class="text-[10px] text-muted-foreground">Allow screen readers text extraction</p>
        </div>
        <Switch id="perm-accessibility" bind:checked={canExtractAccessibility} />
      </div>

      <div class="flex items-center justify-between rounded-lg border p-2.5">
        <div class="space-y-0.5 pr-2">
          <Label class="text-xs font-medium cursor-pointer" for="perm-annotate">Annotations</Label>
          <p class="text-[10px] text-muted-foreground">Allow adding comments and markups</p>
        </div>
        <Switch id="perm-annotate" bind:checked={canAnnotate} />
      </div>

      <div class="flex items-center justify-between rounded-lg border p-2.5">
        <div class="space-y-0.5 pr-2">
          <Label class="text-xs font-medium cursor-pointer" for="perm-forms">Form Filling</Label>
          <p class="text-[10px] text-muted-foreground">Allow interactive form completion</p>
        </div>
        <Switch id="perm-forms" bind:checked={canFillForms} />
      </div>

      <div class="flex items-center justify-between rounded-lg border p-2.5">
        <div class="space-y-0.5 pr-2">
          <Label class="text-xs font-medium cursor-pointer" for="perm-assemble">Page Assembly</Label>
          <p class="text-[10px] text-muted-foreground">Allow page insertion and deletion</p>
        </div>
        <Switch id="perm-assemble" bind:checked={canAssemble} />
      </div>

      <div class="flex items-center justify-between rounded-lg border p-2.5">
        <div class="space-y-0.5 pr-2">
          <Label class="text-xs font-medium cursor-pointer" for="perm-modify">Document Editing</Label>
          <p class="text-[10px] text-muted-foreground">Allow structural page content alterations</p>
        </div>
        <Switch id="perm-modify" bind:checked={canModify} />
      </div>
    </div>

    <!-- Owner Password Configuration -->
    <div class="space-y-1.5 border-t pt-3">
      <div class="flex items-center justify-between">
        <Label for="permissions-owner-pwd" class="text-xs font-medium">Owner Password *</Label>
        <span class="text-[10px] text-muted-foreground">Required to enforce permissions per ISO 32000</span>
      </div>
      <div class="relative">
        <Input
          id="permissions-owner-pwd"
          type={showPassword ? 'text' : 'password'}
          placeholder="Set owner password to protect permissions..."
          bind:value={ownerPassword}
          class="h-9 pr-9 text-xs"
          disabled={isSaving}
        />
        <button
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
          onclick={() => (showPassword = !showPassword)}
          tabindex={-1}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {#if showPassword}
            <EyeOff class="h-3.5 w-3.5" />
          {:else}
            <Eye class="h-3.5 w-3.5" />
          {/if}
        </button>
      </div>
    </div>

    <Dialog.Footer class="gap-2 sm:gap-0 pt-2">
      <Button
        variant="outline"
        size="sm"
        class="text-xs"
        onclick={() => store.closePermissionsDialog()}
        disabled={isSaving}
      >
        Cancel
      </Button>
      <Button
        size="sm"
        class="text-xs"
        onclick={handleApply}
        disabled={!ownerPassword.trim() || isSaving}
      >
        {#if isSaving}
          <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" />
          Applying...
        {:else}
          Apply Permissions
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
