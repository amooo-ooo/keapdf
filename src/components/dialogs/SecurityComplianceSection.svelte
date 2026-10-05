<script lang="ts">
  import type { DocumentMetadata } from '../../core/types';
  import type {
    SignatureValidationResult,
  } from '../../services/pdf/operations/signature-ops';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
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

  interface Props {
    metadata: DocumentMetadata | null;
    signatureResults: SignatureValidationResult[];
    isValidatingSignatures: boolean;
    onRefreshSignatures: () => void | Promise<void>;
    onOpenCertSign: () => void;
    onOpenValidateDialog: () => void;
  }

  let {
    metadata,
    signatureResults,
    isValidatingSignatures,
    onRefreshSignatures,
    onOpenCertSign,
    onOpenValidateDialog,
  }: Props = $props();

  let selectedSigIndex = $state(0);
  let isTechDetailsOpen = $state(false);

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

<div class="space-y-4">
  <!-- Document encryption and access restrictions -->
  <div class="border border-border rounded-lg p-4 bg-muted/20 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div
        class="w-9 h-9 rounded-full {metadata?.isEncrypted
          ? 'bg-success/10 text-success'
          : 'bg-primary/10 text-primary'} flex items-center justify-center"
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

  <!-- High-level metrics for signatures and attachments -->
  <div class="grid grid-cols-2 gap-3">
    <div class="border border-border rounded-lg p-3 bg-card flex items-center gap-2.5">
      <ShieldCheck class="h-4 w-4 text-primary shrink-0" />
      <div class="flex flex-col min-w-0">
        <span class="text-[11px] text-muted-foreground">Digital Signatures</span>
        <span class="text-xs font-semibold text-foreground">
          {signatureResults.length || metadata?.signaturesCount || 0} signature{(signatureResults.length || metadata?.signaturesCount || 0) === 1 ? '' : 's'}
        </span>
      </div>
    </div>

    <div class="border border-border rounded-lg p-3 bg-card flex items-center gap-2.5">
      <Paperclip class="h-4 w-4 text-muted-foreground shrink-0" />
      <div class="flex flex-col min-w-0">
        <span class="text-[11px] text-muted-foreground">Embedded Attachments</span>
        <span class="text-xs font-semibold text-foreground">
          {metadata?.attachmentsCount || 0} file{(metadata?.attachmentsCount || 0) === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  </div>

  <!-- Digital signatures and standards compliance -->
  <div class="border border-border rounded-lg p-4 bg-card space-y-3.5">
    <div class="flex items-center justify-between pb-1 border-b border-border/60">
      <div class="flex items-center gap-2">
        <ShieldCheck class="h-4 w-4 text-primary" />
        <div>
          <h4 class="text-xs font-semibold text-foreground">
            Digital Signature & Standards Compliance
          </h4>
          <p class="text-[10px] text-muted-foreground">
            Evaluated according to Swiss Federal Act on Electronic Signatures (ZertES / ESigA, SR 943.03) and ETSI EN 319 142.
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 text-xs px-2"
        onclick={() => onRefreshSignatures()}
        disabled={isValidatingSignatures}
      >
        <RefreshCw class="h-3 w-3 mr-1 {isValidatingSignatures ? 'animate-spin' : ''}" />
        Refresh
      </Button>
    </div>

    {#if isValidatingSignatures}
      <div class="py-6 flex flex-col items-center justify-center text-center space-y-1.5">
        <RefreshCw class="h-5 w-5 animate-spin text-primary" />
        <span class="text-xs font-medium text-foreground">Verifying Cryptographic Signatures...</span>
        <span class="text-[10px] text-muted-foreground">
          Auditing byte ranges, certificate trust chains, and ESigA compliance rules.
        </span>
      </div>
    {:else if signatureResults.length === 0}
      <div class="py-6 border border-dashed border-border rounded-lg text-center flex flex-col items-center justify-center gap-2 bg-muted/10">
        <FileCheck class="h-7 w-7 text-muted-foreground stroke-1" />
        <div class="text-xs font-semibold text-foreground">No Digital Signatures Found</div>
        <p class="text-[11px] text-muted-foreground max-w-[340px]">
          This document does not contain cryptographic ISO 32000 digital signatures or AcroForm signature fields.
        </p>
        <Button size="sm" variant="outline" class="mt-1 text-xs h-7" onclick={onOpenCertSign}>
          <KeyRound class="h-3.5 w-3.5 mr-1.5 text-primary" /> Add Digital Certificate Signature
        </Button>
      </div>
    {:else if activeSignature}
      <!-- Multiple signatures selector tabs -->
      {#if signatureResults.length > 1}
        <div class="flex items-center gap-1.5 overflow-x-auto pb-1">
          {#each signatureResults as sig, idx}
            <button
              type="button"
              class="text-[11px] px-2.5 py-1 rounded-md border font-medium transition-colors {selectedSigIndex === idx
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted/70'}"
              onclick={() => (selectedSigIndex = idx)}
            >
              Sig #{idx + 1}: {sig.signerName}
            </button>
          {/each}
        </div>
      {/if}

      <!-- Signature Overview Header Card -->
      <div class="border rounded-lg p-3 bg-muted/20 space-y-2">
        <div class="flex items-start justify-between gap-2">
          <div class="space-y-0.5">
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

              {#if activeSignature.hasDss}
                <Badge variant="success" class="text-[10px]">
                  LTV Enabled (/DSS)
                </Badge>
              {/if}
            </div>

            <div class="text-[11px] text-muted-foreground flex items-center gap-1">
              <Clock class="h-3 w-3" /> Signed: {activeSignature.signingTimeFormatted}
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            class="h-7 text-xs px-2 text-primary"
            onclick={onOpenValidateDialog}
            title="Open comprehensive verification modal"
          >
            <ExternalLink class="h-3.5 w-3.5 mr-1" /> Inspector
          </Button>
        </div>
      </div>

      <!-- Statutory industry standard compliance pillars -->
      <div class="space-y-2">
        <span class="text-[11px] font-semibold text-foreground uppercase tracking-wider block">
          Statutory Verification Checks (Swiss ZertES / ESigA & ETSI)
        </span>

        <div class="space-y-2">
          {#each activeSignature.esigaCompliance.checks as check (check.id)}
            <div
              class="border rounded-lg p-3 flex items-start gap-2.5 transition-colors {check.status === 'valid'
                ? 'border-success/30 bg-success/5'
                : check.status === 'indeterminate'
                  ? 'border-warning/30 bg-warning/5'
                  : 'border-destructive/30 bg-destructive/5'}"
            >
              <div class="shrink-0 mt-0.5">
                {#if check.status === 'valid'}
                  <CheckCircle2 class="h-4 w-4 text-success" />
                {:else if check.status === 'indeterminate'}
                  <AlertCircle class="h-4 w-4 text-warning" />
                {:else}
                  <XCircle class="h-4 w-4 text-destructive" />
                {/if}
              </div>

              <div class="space-y-0.5 min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-medium text-foreground">
                    {check.title}
                  </span>
                  <span
                    class="text-[10px] font-medium uppercase {check.status === 'valid'
                      ? 'text-success'
                      : check.status === 'indeterminate'
                        ? 'text-warning'
                        : 'text-destructive'}"
                  >
                    {check.status}
                  </span>
                </div>

                <p class="text-xs text-foreground/90 font-normal leading-snug">
                  {check.message}
                </p>

                {#if check.technicalDetails}
                  <p class="text-[11px] text-muted-foreground pt-0.5 leading-tight">
                    {check.technicalDetails}
                  </p>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>

      <!-- Expandable Technical Specifications Drawer -->
      <div class="border border-border/80 rounded-lg overflow-hidden bg-card text-xs">
        <button
          type="button"
          class="w-full px-3 py-2 bg-muted/20 hover:bg-muted/30 flex items-center justify-between text-left font-medium text-muted-foreground"
          onclick={() => (isTechDetailsOpen = !isTechDetailsOpen)}
        >
          <span class="text-[11px]">Technical Cryptographic Details & Certificate Chain</span>
          {#if isTechDetailsOpen}
            <ChevronDown class="h-3.5 w-3.5" />
          {:else}
            <ChevronRight class="h-3.5 w-3.5" />
          {/if}
        </button>

        {#if isTechDetailsOpen}
          <div class="p-3 border-t border-border/60 space-y-2 text-[11px]">
            <div class="grid grid-cols-[130px_1fr] gap-x-2 gap-y-1">
              <span class="text-muted-foreground">Subject CN:</span>
              <span class="text-foreground font-medium">{activeSignature.certificateSubject.commonName}</span>

              {#if activeSignature.certificateSubject.organization}
                <span class="text-muted-foreground">Organization:</span>
                <span class="text-foreground">{activeSignature.certificateSubject.organization}</span>
              {/if}

              <span class="text-muted-foreground">Issuer:</span>
              <span class="text-foreground">{activeSignature.certificateIssuer.commonName}</span>

              <span class="text-muted-foreground">Serial Number:</span>
              <span class="text-foreground font-sans text-[10px] break-all">{activeSignature.serialNumber}</span>

              <span class="text-muted-foreground">Validity Window:</span>
              <span class="text-foreground">{activeSignature.validFrom} - {activeSignature.validTo}</span>

              <span class="text-muted-foreground">SubFilter / Type:</span>
              <span class="text-foreground font-sans text-[10px]">
                {activeSignature.subFilter} ({activeSignature.filter})
              </span>

              <span class="text-muted-foreground">ByteRange:</span>
              <span class="text-foreground font-sans text-[10px]">
                [{activeSignature.byteRange.join(', ')}]
              </span>

              <span class="text-muted-foreground">SigningCertV2:</span>
              <span class="text-foreground">
                {activeSignature.hasSigningCertificateV2 ? 'RFC 5035 Bound (SHA-256)' : 'Legacy PKCS#7 (Unbound)'}
              </span>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Decoded permission bitflags -->
  <div class="border border-border rounded-lg p-3.5 bg-card flex flex-col gap-2">
    <div class="flex items-center justify-between">
      <span class="text-xs font-semibold text-foreground">Standard Permission Flags</span>
      <span class="text-[10px] text-muted-foreground font-sans">
        Raw Mask: 0x{(metadata?.permissions ?? 0).toString(16).toUpperCase()}
      </span>
    </div>

    <div class="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
      <div class="flex items-center gap-2">
        {#if permissions.canPrint}
          <Check class="h-3.5 w-3.5 text-success" />
        {:else}
          <X class="h-3.5 w-3.5 text-destructive" />
        {/if}
        <span>Printing Content</span>
      </div>

      <div class="flex items-center gap-2">
        {#if permissions.canCopy}
          <Check class="h-3.5 w-3.5 text-success" />
        {:else}
          <X class="h-3.5 w-3.5 text-destructive" />
        {/if}
        <span>Copying Text & Graphics</span>
      </div>

      <div class="flex items-center gap-2">
        {#if permissions.canModify}
          <Check class="h-3.5 w-3.5 text-success" />
        {:else}
          <X class="h-3.5 w-3.5 text-destructive" />
        {/if}
        <span>Modifying Document</span>
      </div>

      <div class="flex items-center gap-2">
        {#if permissions.canFillForms}
          <Check class="h-3.5 w-3.5 text-success" />
        {:else}
          <X class="h-3.5 w-3.5 text-destructive" />
        {/if}
        <span>Form Field Completion</span>
      </div>

      <div class="flex items-center gap-2">
        {#if permissions.canAnnotate}
          <Check class="h-3.5 w-3.5 text-success" />
        {:else}
          <X class="h-3.5 w-3.5 text-destructive" />
        {/if}
        <span>Adding Comments & Notes</span>
      </div>

      <div class="flex items-center gap-2">
        {#if permissions.canAccessAccessibility}
          <Check class="h-3.5 w-3.5 text-success" />
        {:else}
          <X class="h-3.5 w-3.5 text-destructive" />
        {/if}
        <span>Screen Reader Access</span>
      </div>
    </div>
  </div>
</div>
