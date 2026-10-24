<script lang="ts">
  import type { DocumentMetadata } from '../../core/types';
  import type {
    SignatureValidationResult,
  } from '../../services/pdf/operations/signature-ops';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import {
    CheckCircle2,
    AlertCircle,
    XCircle,
    ShieldCheck,
    Lock,
    Unlock,
    KeyRound,
    RefreshCw,
    ExternalLink,
    ChevronDown,
    ChevronRight,
    Paperclip,
    Clock,
    FileCheck,
    Check,
    X,
  } from 'lucide-svelte';

  // Retain Paperclip reference while attachment metric is commented out
  void Paperclip;

  interface Props {
    metadata: DocumentMetadata | null;
    signatureResults: SignatureValidationResult[];
    isValidatingSignatures: boolean;
    showEncryptionBanner?: boolean;
    showHeader?: boolean;
    onRefreshSignatures: () => void | Promise<void>;
    onOpenCertSign: () => void;
    onOpenValidateDialog: () => void;
  }

  let {
    metadata,
    signatureResults,
    isValidatingSignatures,
    showEncryptionBanner = true,
    showHeader = true,
    onRefreshSignatures,
    onOpenCertSign,
    onOpenValidateDialog,
  }: Props = $props();

  let selectedSigIndex = $state<number>(0);
  let lastSignatureCount = 0;
  let checkExpandedOverrides = $state<Record<string, boolean>>({});

  $effect(() => {
    const count = signatureResults.length;
    if (count !== lastSignatureCount) {
      lastSignatureCount = count;
      selectedSigIndex = count > 0 ? count - 1 : 0;
    }
  });

  function isCheckExpanded(checkId: string, status: string, sigId = ''): boolean {
    const key = `${sigId}:${checkId}`;
    if (key in checkExpandedOverrides) {
      return checkExpandedOverrides[key];
    }
    return status !== 'valid';
  }

  function toggleCheck(checkId: string, status: string, sigId = ''): void {
    const key = `${sigId}:${checkId}`;
    const current = isCheckExpanded(checkId, status, sigId);
    checkExpandedOverrides[key] = !current;
  }

  // Clamp selected signature index if results length changes
  let activeSignature = $derived.by(() => {
    if (signatureResults.length === 0) return null;
    const idx = Math.min(selectedSigIndex, signatureResults.length - 1);
    return signatureResults[idx] || null;
  });

  // Decode standard PDF permissions bitmask
  let permissions = $derived.by(() => {
    const p = metadata?.permissions ?? 0xffffffff;
    return {
      canPrint: Boolean(p & 0x0004),
      canModify: Boolean(p & 0x0008),
      canCopy: Boolean(p & 0x0010),
      canAnnotate: Boolean(p & 0x0020),
      canFillForms: Boolean(p & 0x0100),
      canAccessAccessibility: Boolean(p & 0x0200),
      canAssemble: Boolean(p & 0x0400),
      canPrintHighQuality: Boolean(p & 0x0800),
    };
  });
</script>

<div class="flex flex-col gap-3">
  {#if showEncryptionBanner}
  <!-- Document encryption and access restrictions -->
  <div class="border border-border rounded-2xl p-4 bg-card flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div
        class="w-9 h-9 rounded-full bg-card text-foreground border border-border flex items-center justify-center"
      >
        {#if metadata?.isEncrypted}
          <Lock class="h-4 w-4" />
        {:else}
          <Unlock class="h-4 w-4" />
        {/if}
      </div>
      <div>
        <h4 class="text-xs font-semibold text-foreground">
          {metadata?.isEncrypted ? 'Encrypted / Password Protected' : 'Standard Document Security'}
        </h4>
        <p class="text-[11px] text-muted-foreground">
          {metadata?.isEncrypted
            ? 'This document enforces user and owner access restrictions.'
            : 'No password encryption is required to read or inspect content.'}
        </p>
      </div>
    </div>
    <Badge variant={metadata?.isEncrypted ? 'default' : 'outline'} class="text-[10px]">
      {metadata?.isEncrypted ? 'Protected' : 'Unrestricted'}
    </Badge>
  </div>
  {/if}

  <!-- High-level metrics for signatures and attachments commented out temporarily -->
  <!--
  <div class="grid grid-cols-2 gap-2">
    <div class="border border-border rounded-2xl p-2.5 bg-card flex items-center gap-2 min-w-0">
      <ShieldCheck class="h-4 w-4 shrink-0 text-muted-foreground" />
      <div class="flex flex-col min-w-0">
        <span class="text-[11px] text-muted-foreground truncate">Signatures</span>
        <span class="text-xs font-semibold text-foreground truncate">
          {signatureResults.length || metadata?.signaturesCount || 0} {(signatureResults.length || metadata?.signaturesCount || 0) === 1 ? 'signature' : 'signatures'}
        </span>
      </div>
    </div>

    <div class="border border-border rounded-2xl p-2.5 bg-card flex items-center gap-2 min-w-0">
      <Paperclip class="h-4 w-4 text-muted-foreground shrink-0" />
      <div class="flex flex-col min-w-0">
        <span class="text-[11px] text-muted-foreground truncate">Attachments</span>
        <span class="text-xs font-semibold text-foreground truncate">
          {metadata?.attachmentsCount || 0} {(metadata?.attachmentsCount || 0) === 1 ? 'file' : 'files'}
        </span>
      </div>
    </div>
  </div>
  -->

  {#snippet signatureContent()}
    {#if isValidatingSignatures}
      <div class="py-6 px-3 flex flex-col items-center justify-center text-center space-y-1.5 {showHeader ? '' : 'border border-border rounded-2xl bg-card'}">
        <RefreshCw class="h-5 w-5 animate-spin text-muted-foreground" />
        <span class="text-xs font-medium text-foreground">Verifying Cryptographic Signatures...</span>
        <span class="text-[10px] text-muted-foreground">
          Auditing byte ranges, certificate trust chains, and ESigA compliance rules.
        </span>
      </div>
    {:else if signatureResults.length === 0}
      <div class="flex flex-col gap-2">
        <div class="p-3.5 border border-dashed border-border rounded-2xl text-center flex flex-col items-center justify-center gap-2 bg-card">
          <FileCheck class="h-6 w-6 text-muted-foreground stroke-1" />
          <div class="text-xs font-semibold text-foreground">No Digital Signatures Found</div>
          <p class="text-[11px] text-muted-foreground leading-normal max-w-[280px]">
            This document does not contain cryptographic ISO 32000 digital signatures or AcroForm signature fields.
          </p>
        </div>
        <Button size="sm" variant="outline" class="w-full text-xs h-8 justify-center" onclick={onOpenCertSign}>
          <KeyRound class="h-3.5 w-3.5 mr-1.5" /> Add Digital Certificate Signature
        </Button>
      </div>
    {:else if activeSignature}
      <!-- Multiple signatures selector dropdown -->
      {#if signatureResults.length > 1}
        <div class="w-full">
          <Select.Root
            type="single"
            value={String(selectedSigIndex)}
            onValueChange={(val: string) => {
              if (val !== undefined && val !== '') {
                selectedSigIndex = parseInt(val, 10);
              }
            }}
          >
            <Select.Trigger
              variant="border"
              class="w-full text-xs font-sans h-8 justify-between"
              aria-label="Select digital signature"
            >
              <span class="truncate" title={activeSignature.signerName}>
                {activeSignature.signerName}
              </span>
            </Select.Trigger>
            <Select.Content>
              {#each signatureResults as sig, idx}
                <Select.Item value={String(idx)} label={sig.signerName}>
                  <span class="truncate" title={sig.signerName}>
                    {sig.signerName}
                  </span>
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      {/if}

      <!-- Signature overview header card -->
      <Card.Root>
        <Card.Header>
          <Card.Title>
            Signature
          </Card.Title>

          <Card.Actions>
            <Button
              variant="outline"
              size="icon-xs"
              class="shrink-0 text-muted-foreground hover:text-foreground"
              onclick={onOpenValidateDialog}
              aria-label="Inspect signature"
              title="Open comprehensive verification modal"
            >
              <ExternalLink class="h-3 w-3" />
            </Button>
          </Card.Actions>
        </Card.Header>

        <Card.Content>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-semibold text-foreground">
              {activeSignature.signerName}
            </span>

            {#if activeSignature.esigaCompliance.status === 'compliant'}
              <Badge variant="success" class="text-[10px] flex items-center gap-1">
                <CheckCircle2 class="h-3 w-3" /> ESigA Compliant ({activeSignature.esigaCompliance.qualificationLevel})
              </Badge>
            {:else if activeSignature.esigaCompliance.status === 'indeterminate'}
              <Badge
                variant="warning"
                class="text-[10px] flex items-center gap-1"
              >
                <AlertCircle class="h-3 w-3" /> ESigA: Indeterminate
              </Badge>
            {:else}
              <Badge variant="destructive" class="text-[10px] flex items-center gap-1">
                <XCircle class="h-3 w-3" /> ESigA: Non-Compliant
              </Badge>
            {/if}

            <Badge variant="outline" class="text-[10px] font-sans">
              {activeSignature.padesProfile}
            </Badge>

            {#if activeSignature.isCertificationSignature}
              <Badge variant="outline" class="text-[10px] font-sans">
                Certified{activeSignature.docMdpPermissionLevel ? ` (DocMDP P=${activeSignature.docMdpPermissionLevel})` : ''}
              </Badge>
            {/if}

            {#if activeSignature.hasDss}
              <Badge variant="success" class="text-[10px]">
                LTV Enabled (/DSS)
              </Badge>
            {/if}
          </div>

          <div class="text-[11px] text-muted-foreground flex items-center gap-1">
            <Clock class="h-3 w-3" /> Signed: {activeSignature.signingTimeFormatted}
          </div>
        </Card.Content>
      </Card.Root>

      <!-- Statutory industry standard compliance pillars -->
      <div class="flex flex-col gap-2">
        <div class={showHeader ? "sidebar-section-header h-auto min-h-9 py-1 px-0" : "sidebar-section-header h-auto min-h-9 py-1 -mx-3"}>
          <span class="sidebar-section-title leading-snug">
            Statutory Verification Checks (Swiss ZertES / ESigA & ETSI)
          </span>
        </div>

        <div class="border border-border rounded-2xl overflow-hidden bg-card divide-y divide-border">
          {#each activeSignature.esigaCompliance.checks as check (check.id)}
            {@const isCheckOpen = isCheckExpanded(check.id, check.status, activeSignature.signatureId)}
            <div
              class="transition-colors {check.status === 'valid'
                ? 'bg-card'
                : check.status === 'indeterminate'
                  ? 'bg-warning/5'
                  : 'bg-destructive/5'}"
            >
              <button
                type="button"
                class="w-full px-3 py-2.5 flex items-center justify-between gap-2.5 text-left hover:bg-muted/30 transition-colors"
                aria-expanded={isCheckOpen}
                onclick={() => toggleCheck(check.id, check.status, activeSignature.signatureId)}
              >
                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                  <div class="shrink-0">
                    {#if check.status === 'valid'}
                      <CheckCircle2 class="h-4 w-4" />
                    {:else if check.status === 'indeterminate'}
                      <AlertCircle class="h-4 w-4 text-warning" />
                    {:else}
                      <XCircle class="h-4 w-4 text-destructive" />
                    {/if}
                  </div>
                  <span class="text-xs font-medium text-foreground leading-snug">
                    {check.title}
                  </span>
                </div>

                {#if isCheckOpen}
                  <ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {:else}
                  <ChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {/if}
              </button>

              {#if isCheckOpen}
                <div class="px-3 pb-3 pt-2 border-t border-border/60 space-y-1">
                  <p class="text-xs text-foreground/90 font-normal leading-snug">
                    {check.message}
                  </p>

                  {#if check.technicalDetails}
                    <p class="text-xs text-muted-foreground pt-0.5 leading-tight">
                      {check.technicalDetails}
                    </p>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <!-- Technical cryptographic details and certificate chain -->
      <div class="flex flex-col gap-2">
        <div class={showHeader ? "sidebar-section-header h-auto min-h-9 py-1 px-0" : "sidebar-section-header h-auto min-h-9 py-1 -mx-3"}>
          <span class="sidebar-section-title leading-snug">
            Technical Cryptographic Details & Certificate Chain
          </span>
        </div>

        <div class="panel-key-value-grid">
          <div class="panel-key-label">Subject CN</div>
          <div class="panel-value-text truncate" title={activeSignature.certificateSubject.commonName}>
            {activeSignature.certificateSubject.commonName}
          </div>

          {#if activeSignature.certificateSubject.organization}
            <div class="panel-key-label">Organisation</div>
            <div class="panel-value-text truncate" title={activeSignature.certificateSubject.organization}>
              {activeSignature.certificateSubject.organization}
            </div>
          {/if}

          <div class="panel-key-label">Issuer</div>
          <div class="panel-value-text truncate" title={activeSignature.certificateIssuer.commonName}>
            {activeSignature.certificateIssuer.commonName}
          </div>

          <div class="panel-key-label">Serial Number</div>
          <div class="panel-value-text truncate" title={activeSignature.serialNumber}>
            {activeSignature.serialNumber}
          </div>

          <div class="panel-key-label">Validity Window</div>
          <div class="panel-value-text truncate" title={`${activeSignature.validFrom} - ${activeSignature.validTo}`}>
            {activeSignature.validFrom} - {activeSignature.validTo}
          </div>

          <div class="panel-key-label">Digest Algorithm</div>
          <div class="panel-value-text truncate" title={activeSignature.digestAlgorithm}>
            {activeSignature.digestAlgorithm}
          </div>

          <div class="panel-key-label">SubFilter / Type</div>
          <div class="panel-value-text truncate" title={`${activeSignature.subFilter} (${activeSignature.filter})`}>
            {activeSignature.subFilter} ({activeSignature.filter})
          </div>

          {#if activeSignature.transformMethod}
            <div class="panel-key-label">Transform Method</div>
            <div
              class="panel-value-text truncate"
              title={`${activeSignature.transformMethod}${activeSignature.docMdpPermissionLevel ? ` (P=${activeSignature.docMdpPermissionLevel})` : ''}`}
            >
              {activeSignature.transformMethod}{activeSignature.docMdpPermissionLevel ? ` (P=${activeSignature.docMdpPermissionLevel})` : ''}
            </div>
          {/if}

          <div class="panel-key-label">ByteRange</div>
          <div class="panel-value-text truncate" title={`[${activeSignature.byteRange.join(', ')}]`}>
            [{activeSignature.byteRange.join(', ')}]
          </div>

          <div class="panel-key-label">SigningCertV2</div>
          <div
            class="panel-value-text truncate"
            title={activeSignature.hasSigningCertificateV2 ? 'RFC 5035 Bound (SHA-256)' : 'Legacy PKCS#7 (Unbound)'}
          >
            {activeSignature.hasSigningCertificateV2 ? 'RFC 5035 Bound (SHA-256)' : 'Legacy PKCS#7 (Unbound)'}
          </div>
        </div>
      </div>
    {/if}
  {/snippet}

  {#if showHeader}
  <!-- Digital signatures and standards compliance -->
  <div class="border border-border rounded-2xl p-3.5 bg-card flex flex-col gap-3">
    <div class="space-y-1.5 pb-2.5 border-b border-border/60">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <ShieldCheck class="h-3.5 w-3.5 shrink-0 text-foreground" />
          <h4 class="text-xs font-semibold text-foreground leading-snug" title="Digital Signature & Standards Compliance">
            Digital Signature & Standards Compliance
          </h4>
        </div>
        <Button
          variant="outline"
          size="icon-xs"
          class="shrink-0 text-muted-foreground hover:text-foreground"
          onclick={() => onRefreshSignatures()}
          disabled={isValidatingSignatures}
          aria-label="Refresh signatures"
          title="Refresh signatures"
        >
          <RefreshCw class="h-3 w-3 {isValidatingSignatures ? 'animate-spin' : ''}" />
        </Button>
      </div>
      <p class="text-[10px] text-muted-foreground leading-normal">
        Evaluated according to Swiss Federal Act on Electronic Signatures (ZertES / ESigA, SR 943.03) and ETSI EN 319 142.
      </p>
    </div>

    {@render signatureContent()}
  </div>
  {:else}
  <!-- Digital signatures and standards compliance content -->
  <div class="flex flex-col gap-3">
    {@render signatureContent()}
  </div>
  {/if}

  <!-- Decoded permission bitflags -->
  <div class="panel-metric-banner -mx-3 px-3 border-t border-border pt-2.5">
    <span class="text-xs font-semibold text-foreground">Standard Permission Flags</span>
    <div class="flex flex-col gap-1.5 text-xs">
      <div class="flex items-center gap-1.5 {permissions.canPrint ? 'text-muted-foreground' : 'text-muted-foreground/60'}">
        {#if permissions.canPrint}
          <Check class="h-3 w-3 shrink-0 text-muted-foreground opacity-75" />
        {:else}
          <X class="h-3 w-3 shrink-0 text-muted-foreground/60 opacity-40" />
        {/if}
        <span>Printing Content</span>
      </div>
      <div class="flex items-center gap-1.5 {permissions.canCopy ? 'text-muted-foreground' : 'text-muted-foreground/60'}">
        {#if permissions.canCopy}
          <Check class="h-3 w-3 shrink-0 text-muted-foreground opacity-75" />
        {:else}
          <X class="h-3 w-3 shrink-0 text-muted-foreground/60 opacity-40" />
        {/if}
        <span>Copying Text & Graphics</span>
      </div>
      <div class="flex items-center gap-1.5 {permissions.canModify ? 'text-muted-foreground' : 'text-muted-foreground/60'}">
        {#if permissions.canModify}
          <Check class="h-3 w-3 shrink-0 text-muted-foreground opacity-75" />
        {:else}
          <X class="h-3 w-3 shrink-0 text-muted-foreground/60 opacity-40" />
        {/if}
        <span>Modifying Document</span>
      </div>
      <div class="flex items-center gap-1.5 {permissions.canFillForms ? 'text-muted-foreground' : 'text-muted-foreground/60'}">
        {#if permissions.canFillForms}
          <Check class="h-3 w-3 shrink-0 text-muted-foreground opacity-75" />
        {:else}
          <X class="h-3 w-3 shrink-0 text-muted-foreground/60 opacity-40" />
        {/if}
        <span>Form Field Completion</span>
      </div>
      <div class="flex items-center gap-1.5 {permissions.canAnnotate ? 'text-muted-foreground' : 'text-muted-foreground/60'}">
        {#if permissions.canAnnotate}
          <Check class="h-3 w-3 shrink-0 text-muted-foreground opacity-75" />
        {:else}
          <X class="h-3 w-3 shrink-0 text-muted-foreground/60 opacity-40" />
        {/if}
        <span>Adding Comments & Notes</span>
      </div>
      <div class="flex items-center gap-1.5 {permissions.canAccessAccessibility ? 'text-muted-foreground' : 'text-muted-foreground/60'}">
        {#if permissions.canAccessAccessibility}
          <Check class="h-3 w-3 shrink-0 text-muted-foreground opacity-75" />
        {:else}
          <X class="h-3 w-3 shrink-0 text-muted-foreground/60 opacity-40" />
        {/if}
        <span>Screen Reader Access</span>
      </div>
    </div>
  </div>
</div>
