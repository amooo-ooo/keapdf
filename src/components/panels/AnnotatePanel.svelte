<script lang="ts">
  import { untrack } from 'svelte';
  import type { DocumentMetadata } from '../../core/types';
  import type { SignatureValidationResult } from '../../services/pdf/operations/signature-ops';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import { getSavedSignatures, getSavedDigitalSignatures } from '../../services/signature-storage';
  import SidebarSection from '../common/SidebarSection.svelte';
  import SecurityComplianceSection from '../dialogs/SecurityComplianceSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
  import {
    Highlighter,
    EyeOff,
    Pencil,
    PenTool,
    StickyNote,
    ShieldCheck,
    Clock,
    BookOpen,
    CheckCircle2,
    Users,
    Eraser,
    Lock,
    Unlock,
    FileKey,
    AlertCircle,
    Check,
    Loader2,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();
  let savedCount = $state(0);
  let savedCertCount = $state(0);

  let metadata = $state<DocumentMetadata | null>(null);
  let signatureResults = $state<SignatureValidationResult[]>([]);
  let isValidatingSignatures = $state(false);
  let userPassword = $state('');
  let ownerPassword = $state('');

  let isApplyingSecurity = $state(false);
  let isRemovingSecurity = $state(false);
  let isUnlockingForms = $state(false);
  let securityMessage = $state<string | null>(null);
  let securityError = $state<string | null>(null);

  const isDocumentEncrypted = $derived(metadata?.isEncrypted ?? false);

  let lastLoadedKey = '';
  let isFetchingSecurityData = false;
  let pendingSecurityRefresh = false;
  let pendingSignatureLoad = false;
  let isComponentMounted = true;

  $effect(() => {
    isComponentMounted = true;
    return () => {
      isComponentMounted = false;
    };
  });

  $effect(() => {
    // note: re-evaluate signature count when e-sign or cert-sign dialog opens or closes
    void store.showEsignDialog;
    void store.showCertSignDialog;
    savedCount = getSavedSignatures().length;
    savedCertCount = getSavedDigitalSignatures().length;
  });

  $effect(() => {
    const isLoaded = store.isDocumentLoaded;
    const fileId = store.activeWorkspaceFileId;
    const version = store.renderVersion;

    untrack(() => {
      if (!isLoaded) {
        lastLoadedKey = '';
        metadata = null;
        signatureResults = [];
        return;
      }

      const currentKey = `${fileId}:${version}`;
      if (currentKey === lastLoadedKey) {
        return;
      }
      lastLoadedKey = currentKey;

      void refreshSecurityAndSignatures();
    });
  });

  async function refreshSecurityAndSignatures(): Promise<void> {
    if (!store.isDocumentLoaded || !isComponentMounted) return;
    if (isFetchingSecurityData) {
      pendingSecurityRefresh = true;
      return;
    }
    isFetchingSecurityData = true;

    try {
      if (!metadata) {
        try {
          metadata = actions.service.document.getMetadata();
        } catch {
          metadata = null;
        }
      }

      try {
        const extended = await actions.getExtendedDocumentMetadata();
        if (isComponentMounted) {
          metadata = extended;
        }
      } catch {
        // note: retain synchronous metadata snapshot when extended retrieval fails
      }

      if (isComponentMounted) {
        await loadSignatures();
      }
    } finally {
      isFetchingSecurityData = false;
      if (pendingSecurityRefresh && isComponentMounted && store.isDocumentLoaded) {
        pendingSecurityRefresh = false;
        void refreshSecurityAndSignatures();
      }
    }
  }

  async function loadSignatures(): Promise<void> {
    if (!store.isDocumentLoaded || !isComponentMounted) return;
    if (isValidatingSignatures) {
      pendingSignatureLoad = true;
      return;
    }

    isValidatingSignatures = true;
    try {
      const results = await actions.validateActiveDocumentSignatures();
      if (isComponentMounted) {
        signatureResults = results;
      }
    } catch {
      if (isComponentMounted) {
        signatureResults = [];
      }
    } finally {
      if (isComponentMounted) {
        isValidatingSignatures = false;
        if (pendingSignatureLoad && store.isDocumentLoaded) {
          pendingSignatureLoad = false;
          void loadSignatures();
        }
      }
    }
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

  function selectTool(tool: 'highlight' | 'pen' | 'redact' | 'signature' | 'note' | 'eraser'): void {
    if (store.activeTool === tool) {
      actions.setTool('select');
    } else {
      actions.setTool(tool);
    }
  }

  // note: colour derive logic commented out while annotate section is commented out
  // const PRESET_ANNOTATE_COLORS = ['#fde047', '#86efac', '#7dd3fc', '#f472b6', '#fdba74'];
  // const isCustomAnnotateColor = $derived(!PRESET_ANNOTATE_COLORS.includes(store.annotateColor));

  // note: retain component references while annotate and notes & review sections are commented out
  void ButtonGroup;
  void ColorPicker;
  void Highlighter;
  void Pencil;
  void Eraser;
  void StickyNote;
  void BookOpen;

  function triggerTool(toolName: string): void {
    store.activeMockupTool = toolName;
  }
</script>

<div class="panel-root">
  <!-- note: annotate drawing and highlighting section commented out -->
  <!--
  {#if featureFlags.isEnabled('annotations')}
  <SidebarSection title="Annotate" borderBottom={true}>
    <p class="panel-description">Draw or highlight passages on the page. Hover over text to snap to lines.</p>
    
    <div class="panel-action-stack">
      <div class="panel-action-stack">
        {#if featureFlags.isEnabled('annotations.highlighter')}
        <Button
          variant="panel"
          class="w-full"
          active={store.activeTool === 'highlight'}
          onclick={() => selectTool('highlight')}
          disabled={!store.isDocumentLoaded}
        >
          <Highlighter class="panel-icon-sm text-warning" /> Highlighter
        </Button>
        {/if}
        {#if featureFlags.isEnabled('annotations.pen')}
        <Button
          variant="panel"
          class="w-full"
          active={store.activeTool === 'pen'}
          onclick={() => selectTool('pen')}
          disabled={!store.isDocumentLoaded}
        >
          <Pencil class="panel-icon-sm" /> Pen
        </Button>
        {/if}
        {#if featureFlags.isEnabled('annotations.eraser')}
        <Button
          variant="panel"
          class="w-full"
          active={store.activeTool === 'eraser'}
          onclick={() => selectTool('eraser')}
          disabled={!store.isDocumentLoaded}
        >
          <Eraser class="panel-icon-sm" /> Eraser
        </Button>
        {/if}
      </div>

      {#if featureFlags.isEnabled('annotations.colors')}
      <div class="flex items-center justify-between pt-1 w-full">
        <span class="text-[11px] text-muted-foreground">Color:</span>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="w-6 h-6 rounded-full bg-yellow-300 border border-yellow-400 focus-visible:ring-1 focus-visible:ring-ring {store.annotateColor === '#fde047' ? 'ring-2 ring-ring ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            onclick={() => { store.annotateColor = '#fde047'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen' && store.activeTool !== 'note') selectTool('highlight'); }}
            disabled={!store.isDocumentLoaded}
            title="Yellow"
            aria-label="Yellow"
          ></button>
          <button
            type="button"
            class="w-6 h-6 rounded-full bg-green-300 border border-green-400 focus-visible:ring-1 focus-visible:ring-ring {store.annotateColor === '#86efac' ? 'ring-2 ring-ring ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            onclick={() => { store.annotateColor = '#86efac'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen' && store.activeTool !== 'note') selectTool('highlight'); }}
            disabled={!store.isDocumentLoaded}
            title="Green"
            aria-label="Green"
          ></button>
          <button
            type="button"
            class="w-6 h-6 rounded-full bg-sky-300 border border-sky-400 focus-visible:ring-1 focus-visible:ring-ring {store.annotateColor === '#7dd3fc' ? 'ring-2 ring-ring ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            onclick={() => { store.annotateColor = '#7dd3fc'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen' && store.activeTool !== 'note') selectTool('highlight'); }}
            disabled={!store.isDocumentLoaded}
            title="Blue"
            aria-label="Blue"
          ></button>
          <button
            type="button"
            class="w-6 h-6 rounded-full bg-pink-300 border border-pink-400 focus-visible:ring-1 focus-visible:ring-ring {store.annotateColor === '#f472b6' ? 'ring-2 ring-ring ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            onclick={() => { store.annotateColor = '#f472b6'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen' && store.activeTool !== 'note') selectTool('highlight'); }}
            disabled={!store.isDocumentLoaded}
            title="Pink"
            aria-label="Pink"
          ></button>
          <button
            type="button"
            class="w-6 h-6 rounded-full bg-orange-300 border border-orange-400 focus-visible:ring-1 focus-visible:ring-ring {store.annotateColor === '#fdba74' ? 'ring-2 ring-ring ring-offset-1' : ''} cursor-pointer transition-transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            onclick={() => { store.annotateColor = '#fdba74'; if (store.activeTool !== 'highlight' && store.activeTool !== 'pen' && store.activeTool !== 'note') selectTool('highlight'); }}
            disabled={!store.isDocumentLoaded}
            title="Orange"
            aria-label="Orange"
          ></button>
          <ColorPicker
            variant="circle"
            value={store.annotateColor}
            disabled={!store.isDocumentLoaded}
            onValueChange={(val) => {
              store.annotateColor = val;
              if (store.activeTool !== 'highlight' && store.activeTool !== 'pen' && store.activeTool !== 'note') selectTool('highlight');
            }}
            label="Custom Color"
            class="size-6 {isCustomAnnotateColor ? 'ring-2 ring-ring ring-offset-1' : ''}"
          />
        </div>
      </div>

      <div class="flex items-center justify-between pt-1 w-full">
        <span class="text-[11px] text-muted-foreground">Stroke:</span>
        <ButtonGroup variant="outline" size="sm" class="h-7">
          <Button
            variant={store.annotateStrokeWidth === 1 ? 'default' : 'outline'}
            class="px-2 text-[11px] h-7"
            onclick={() => { store.annotateStrokeWidth = 1; }}
            disabled={!store.isDocumentLoaded}
          >1pt</Button>
          <Button
            variant={store.annotateStrokeWidth === 2 ? 'default' : 'outline'}
            class="px-2 text-[11px] h-7"
            onclick={() => { store.annotateStrokeWidth = 2; }}
            disabled={!store.isDocumentLoaded}
          >2pt</Button>
          <Button
            variant={store.annotateStrokeWidth === 4 ? 'default' : 'outline'}
            class="px-2 text-[11px] h-7"
            onclick={() => { store.annotateStrokeWidth = 4; }}
            disabled={!store.isDocumentLoaded}
          >4pt</Button>
          <Button
            variant={store.annotateStrokeWidth === 6 ? 'default' : 'outline'}
            class="px-2 text-[11px] h-7"
            onclick={() => { store.annotateStrokeWidth = 6; }}
            disabled={!store.isDocumentLoaded}
          >6pt</Button>
        </ButtonGroup>
      </div>
      {/if}
    </div>
  </SidebarSection>
  {/if}
  -->

  {#if featureFlags.isEnabled('redaction') || featureFlags.isEnabled('sanitization')}
  <SidebarSection title="Redaction & Sanitisation" borderBottom={true}>
    <p class="panel-description">Permanently obscure sensitive content and scrub hidden document data.</p>
    
    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('redaction') && featureFlags.isEnabled('redaction.area')}
      <Button
        variant="panel"
        class="w-full"
        active={store.activeTool === 'redact'}
        onclick={() => selectTool('redact')}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <EyeOff class="panel-icon-sm" /> Redact (Text & Area)
      </Button>
      {/if}

      {#if featureFlags.isEnabled('sanitization') || featureFlags.isEnabled('redaction.sanitize')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => actions.openSanitizeDialog()}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <ShieldCheck class="panel-icon-sm text-muted-foreground" /> Sanitise Document
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('security')}
  <!-- note: password protection and access permissions section -->
  <SidebarSection title="Password Security & Access" borderBottom={true}>
    <p class="panel-description">Set or remove document passwords and configure access permissions.</p>

    {#if securityMessage}
      <div role="status" class="panel-status-pill">
        <Check class="h-3 w-3 shrink-0" />
        <span>{securityMessage}</span>
      </div>
    {/if}

    {#if securityError}
      <div role="alert" class="panel-error-pill">
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
                <Lock class="h-3.5 w-3.5" /> Document Protected
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
              class="w-full text-xs h-7 justify-center text-foreground hover:text-foreground"
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
              <Lock class="h-3.5 w-3.5 mr-2" /> Apply Password Security
            {/if}
          </Button>
        {/if}
      {/if}

      <div class="panel-action-stack">
        {#if featureFlags.isEnabled('security.permissions')}
        <Button
          variant="panel"
          class="w-full"
          onclick={() => actions.openPermissionsDialog()}
          disabled={!store.isDocumentLoaded || store.isReadOnly}
        >
          <FileKey class="panel-icon-sm text-muted-foreground" /> Permissions
        </Button>
        {/if}

        {#if featureFlags.isEnabled('security.unlock-forms')}
        <Button
          variant="panel"
          class="w-full"
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
      </div>
    </div>
  </SidebarSection>
  {/if}

  {#if featureFlags.isEnabled('signatures') || featureFlags.isEnabled('security')}
  <!-- note: unified signatures, e-sign actions, and statutory compliance verification -->
  <SidebarSection title="Signatures & Verification" borderBottom={false}>
    <p class="panel-description">Digital PKCS#12 certificates, electronic signing, and statutory compliance verification.</p>
    
    {#if featureFlags.isEnabled('signatures')}
    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('signatures.esign')}
      <Button
        variant="panel"
        class="w-full relative"
        onclick={() => actions.openEsignDialog('signatures')}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <PenTool class="panel-icon-sm" /> Add E-Sign
        {#if savedCount > 0}
          <span class="ml-auto bg-secondary text-foreground text-[10px] font-semibold px-1 rounded border border-border">
            {savedCount}
          </span>
        {/if}
      </Button>
      {/if}

      {#if featureFlags.isEnabled('signatures.cert-sign')}
      <Button
        variant="panel"
        class="w-full relative"
        onclick={() => actions.openCertSignDialog()}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <ShieldCheck class="panel-icon-sm" /> Cert Sign
        {#if featureFlags.isEnabled('signatures.cert-sign.saved') && savedCertCount > 0}
          <span class="ml-auto bg-secondary text-foreground text-[10px] font-semibold px-1 rounded border border-border">
            {savedCertCount}
          </span>
        {/if}
      </Button>
      {/if}

      {#if featureFlags.isEnabled('signatures.validate')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => actions.openValidateSignaturesDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <CheckCircle2 class="panel-icon-sm" /> Validate
      </Button>
      {/if}

      {#if featureFlags.isEnabled('signatures.timestamp')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => triggerTool('Timestamp PDF')}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <Clock class="panel-icon-sm text-muted-foreground" /> Timestamp
      </Button>
      {/if}

      {#if featureFlags.isEnabled('signatures.shared')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => triggerTool('Shared Signing')}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <Users class="panel-icon-sm" /> Shared Signing Workflow
      </Button>
      {/if}
    </div>
    {/if}

    {#if featureFlags.isEnabled('security')}
    <SecurityComplianceSection
      {metadata}
      {signatureResults}
      {isValidatingSignatures}
      showEncryptionBanner={false}
      showHeader={false}
      onRefreshSignatures={loadSignatures}
      onOpenCertSign={() => actions.openCertSignDialog()}
      onOpenValidateDialog={() => actions.openValidateSignaturesDialog()}
    />
    {/if}
  </SidebarSection>
  {/if}

  <!-- note: notes and review section commented out -->
  <!--
  {#if featureFlags.isEnabled('annotations.note') || featureFlags.isEnabled('annotations.read-view')}
  <SidebarSection title="Notes & Review" borderBottom={false}>
    <p class="panel-description">Sticky note comments and reader viewing mode.</p>
    
    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('annotations.note')}
      <Button
        variant="panel"
        class="w-full"
        active={store.activeTool === 'note'}
        onclick={() => selectTool('note')}
        disabled={!store.isDocumentLoaded}
      >
        <StickyNote class="panel-icon-sm text-warning" /> Sticky Note Comment
      </Button>
      {/if}

      {#if featureFlags.isEnabled('annotations.read-view')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => triggerTool('Read View Mode')}
        disabled={!store.isDocumentLoaded}
      >
        <BookOpen class="panel-icon-sm" /> Read View Mode
      </Button>
      {/if}
    </div>
  </SidebarSection>
  {/if}
  -->
</div>
