<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { ControlRow } from '$lib/components/ui/control-row/index.js';
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
      untrack(() => {
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
      });
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

  const activePreset = $derived.by<'read-only' | 'fill-and-sign' | 'unrestricted' | 'custom'>(() => {
    if (
      canPrint &&
      canPrintHighQuality &&
      canCopy &&
      canModify &&
      canAnnotate &&
      canFillForms &&
      canExtractAccessibility &&
      canAssemble
    ) {
      return 'unrestricted';
    }
    if (
      canPrint &&
      canPrintHighQuality &&
      !canCopy &&
      !canModify &&
      !canAnnotate &&
      !canFillForms &&
      canExtractAccessibility &&
      !canAssemble
    ) {
      return 'read-only';
    }
    if (
      canPrint &&
      canPrintHighQuality &&
      !canCopy &&
      !canModify &&
      canAnnotate &&
      canFillForms &&
      canExtractAccessibility &&
      !canAssemble
    ) {
      return 'fill-and-sign';
    }
    return 'custom';
  });

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
  <Dialog.Content class="sm:max-w-[500px] font-sans">
    <Dialog.Header class="pr-12">
      <Dialog.Title>
        <Key class="h-4 w-4" />
        Granular Document Permissions
      </Dialog.Title>
      <Dialog.Description>
        Configure ISO 32000-1 access permissions and owner authentication restrictions.
      </Dialog.Description>
    </Dialog.Header>

    <div class="dialog-body">
      {#if errorMessage}
        <div role="alert" class="dialog-error">
          <AlertCircle class="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      {/if}

      <!-- note: presets and bitmask preview -->
      <div class="field-group pb-2 border-b border-border">
        <div class="flex items-center justify-between">
          <Label class="field-label">Security Presets</Label>
          <Badge variant="secondary" class="font-sans text-[10px] h-5">
            Mask: {hexMask}
          </Badge>
        </div>
        <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
          <Button
            type="button"
            variant={activePreset === 'read-only' ? 'secondary' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => applyPreset('read-only')}
          >
            Read Only
          </Button>
          <Button
            type="button"
            variant={activePreset === 'fill-and-sign' ? 'secondary' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => applyPreset('fill-and-sign')}
          >
            Fill &amp; Sign
          </Button>
          <Button
            type="button"
            variant={activePreset === 'unrestricted' ? 'secondary' : 'outline'}
            class="flex-1 text-xs"
            onclick={() => applyPreset('unrestricted')}
          >
            Unrestricted
          </Button>
        </ButtonGroup>
      </div>

      <!-- note: permission scope switches grouped into logical categories -->
      <div class="space-y-3">
        <div class="field-group">
          <span class="field-label">Printing &amp; Content Access</span>
          <div class="grid grid-cols-2 gap-2">
            <ControlRow label="Printing" description="Draft resolution output" variant="card" size="compact">
              <Switch id="perm-print" bind:checked={canPrint} />
            </ControlRow>

            <ControlRow label="High-Quality Print" description="Full vector output" variant="card" size="compact">
              <Switch id="perm-print-hq" bind:checked={canPrintHighQuality} disabled={!canPrint} />
            </ControlRow>

            <ControlRow label="Content Copying" description="Copy text and graphics" variant="card" size="compact">
              <Switch id="perm-copy" bind:checked={canCopy} />
            </ControlRow>

            <ControlRow label="Accessibility" description="Screen reader access" variant="card" size="compact">
              <Switch id="perm-accessibility" bind:checked={canExtractAccessibility} />
            </ControlRow>
          </div>
        </div>

        <div class="field-group">
          <span class="field-label">Modifications &amp; Interactive Forms</span>
          <div class="grid grid-cols-2 gap-2">
            <ControlRow label="Annotations" description="Comments and markups" variant="card" size="compact">
              <Switch id="perm-annotate" bind:checked={canAnnotate} />
            </ControlRow>

            <ControlRow label="Form Filling" description="Interactive fields" variant="card" size="compact">
              <Switch id="perm-forms" bind:checked={canFillForms} />
            </ControlRow>

            <ControlRow label="Page Assembly" description="Insert, rotate, delete" variant="card" size="compact">
              <Switch id="perm-assemble" bind:checked={canAssemble} />
            </ControlRow>

            <ControlRow label="Document Editing" description="Modify page content" variant="card" size="compact">
              <Switch id="perm-modify" bind:checked={canModify} />
            </ControlRow>
          </div>
        </div>
      </div>

      <!-- note: owner password configuration -->
      <div class="field-group border-t border-border pt-2.5">
        <div class="flex items-center justify-between">
          <Label for="permissions-owner-pwd" class="field-label">Owner Password *</Label>
          <span class="text-[10px] text-muted-foreground">Required to enforce permissions per ISO 32000</span>
        </div>
        <div class="relative">
          <Input
            id="permissions-owner-pwd"
            type={showPassword ? 'text' : 'password'}
            aria-invalid={Boolean(errorMessage)}
            placeholder="Set owner password to protect permissions..."
            bind:value={ownerPassword}
            class="field-input pr-8"
            disabled={isSaving}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground hover:text-foreground"
            onclick={() => (showPassword = !showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {#if showPassword}
              <EyeOff class="h-3.5 w-3.5" aria-hidden="true" />
            {:else}
              <Eye class="h-3.5 w-3.5" aria-hidden="true" />
            {/if}
          </Button>
        </div>
      </div>
    </div>

    <Dialog.Footer>
      <Button
        variant="outline"
        size="sm"
        class="h-8 text-xs"
        onclick={() => store.closePermissionsDialog()}
        disabled={isSaving}
      >
        Cancel
      </Button>
      <Button
        variant="secondary"
        size="sm"
        class="h-8 text-xs"
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
