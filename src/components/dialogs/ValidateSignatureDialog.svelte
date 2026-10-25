<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import type { SignatureValidationResult } from '../../services/pdf/operations/signature-ops';
  import {
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Clock,
    ShieldCheck,
    RefreshCw,
    FileCheck,
    Lock,
    KeyRound,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

  let results = $state<SignatureValidationResult[]>([]);
  let isValidating = $state(false);

  async function runValidation(): Promise<void> {
    isValidating = true;
    try {
      results = await actions.validateActiveDocumentSignatures();
    } catch (err) {
      console.error('Failed to validate signatures:', err);
      results = [];
    } finally {
      isValidating = false;
    }
  }

  $effect(() => {
    if (store.showValidateSignaturesDialog) {
      untrack(() => {
        runValidation();
      });
    }
  });

  function handleClose(): void {
    store.showValidateSignaturesDialog = false;
  }
</script>

<Dialog.Root open={store.showValidateSignaturesDialog} onOpenChange={(open) => { if (!open) handleClose(); }}>
  <Dialog.Content class="sm:max-w-[600px]">
    <Dialog.Header class="pr-12">
      <div class="flex items-center justify-between">
        <Dialog.Title>
          <ShieldCheck class="h-4 w-4" />
          Digital Signature Verification (ISO 32000)
        </Dialog.Title>
        <Button size="sm" variant="outline" class="h-8 text-xs px-2.5" onclick={runValidation} disabled={isValidating}>
          <RefreshCw class="h-3 w-3 mr-1 {isValidating ? 'animate-spin' : ''}" />
          Refresh
        </Button>
      </div>
      <Dialog.Description>
        Cryptographic integrity checks and certificate validity analysis for embedded PDF signatures.
      </Dialog.Description>
    </Dialog.Header>

    <div class="dialog-body">
      {#if isValidating}
        <div class="py-12 flex flex-col items-center justify-center text-center space-y-2">
          <RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" />
          <p class="text-xs text-muted-foreground">Checking ByteRanges and verifying cryptographic signatures...</p>
        </div>
      {:else if results.length === 0}
        <div class="py-10 border border-dashed border-border rounded-[var(--radius-card)] text-center flex flex-col items-center justify-center gap-2">
          <FileCheck class="h-8 w-8 text-muted-foreground stroke-1" />
          <div class="text-xs font-semibold">No Digital Signatures Found</div>
          <p class="text-[11px] text-muted-foreground max-w-[340px]">
            This document does not contain any embedded PDF ISO 32000 digital signature dictionaries or AcroForm signature fields.
          </p>
          <Button size="sm" variant="outline" class="mt-2 h-8 text-xs" onclick={() => { handleClose(); actions.openCertSignDialog(); }}>
            <KeyRound class="h-3.5 w-3.5 mr-1.5" /> Add Digital Certificate Signature
          </Button>
        </div>
      {:else}
        <div class="flex items-center justify-between pb-1">
          <span class="text-xs font-medium text-muted-foreground">Found {results.length} Digital Signature{results.length > 1 ? 's' : ''}</span>
        </div>

        <div class="space-y-3">
          {#each results as sig (sig.signatureId)}
            <div class="border rounded-[var(--radius-card)] overflow-hidden bg-card transition-[border-color] duration-200 {sig.status === 'valid' ? 'border-border' : 'border-destructive/40'}">
              <div class="p-3 flex items-start justify-between border-b border-border/60 bg-card">
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-xs text-foreground">{sig.signerName}</span>
                    {#if sig.status === 'valid'}
                      <Badge variant="success" class="text-[10px] flex items-center gap-1">
                        <CheckCircle2 class="h-3 w-3" /> Valid &amp; Untampered
                      </Badge>
                    {:else if sig.status === 'tampered'}
                      <Badge variant="destructive" class="text-[10px] flex items-center gap-1">
                        <XCircle class="h-3 w-3" /> Altered after Signing
                      </Badge>
                    {:else if sig.status === 'expired'}
                      <Badge variant="warning" class="text-[10px] flex items-center gap-1">
                        <AlertTriangle class="h-3 w-3" /> Certificate Expired
                      </Badge>
                    {:else}
                      <Badge variant="destructive" class="text-[10px] flex items-center gap-1">
                        <XCircle class="h-3 w-3" /> Invalid Signature
                      </Badge>
                    {/if}

                    {#if sig.isCertificationSignature}
                      <Badge variant="outline" class="text-[10px] border-border font-sans">
                        Certified{sig.docMdpPermissionLevel ? ` (DocMDP P=${sig.docMdpPermissionLevel})` : ''}
                      </Badge>
                    {/if}

                    {#if sig.padesProfile === 'PAdES-B-LT'}
                      <Badge variant="info" class="text-[10px] font-sans">
                        PAdES B-LT (LTV)
                      </Badge>
                    {:else if sig.padesProfile === 'PAdES-B-T'}
                      <Badge variant="info" class="text-[10px] font-sans">
                        PAdES B-T (Timestamped)
                      </Badge>
                    {:else if sig.padesProfile === 'PAdES-B-B'}
                      <Badge variant="info" class="text-[10px] font-sans">
                        PAdES B-B (Baseline)
                      </Badge>
                    {:else}
                      <Badge variant="outline" class="text-[10px] text-muted-foreground border-border font-sans">
                        Legacy PKCS#7
                      </Badge>
                    {/if}
                  </div>
                  <div class="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Clock class="h-3 w-3" /> Signed: {sig.signingTimeFormatted}
                  </div>
                </div>

                <div class="text-[11px] font-sans text-muted-foreground">
                  {sig.subFilter}
                </div>
              </div>

              <div class="p-3 space-y-2 text-xs">
                {#if sig.reason}
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Reason:</span>
                    <span class="text-foreground">{sig.reason}</span>
                  </div>
                {/if}

                {#if sig.location}
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Location:</span>
                    <span class="text-foreground">{sig.location}</span>
                  </div>
                {/if}

                <!-- Standards & Cryptographic Verification Audit Matrix -->
                <div class="pt-2 border-t border-border/50 bg-card rounded p-2 text-[11px] space-y-1 font-sans">
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Digest Algorithm:</span>
                    <span class="text-foreground font-medium">{sig.digestAlgorithm}</span>
                  </div>
                  {#if sig.transformMethod}
                    <div class="flex justify-between">
                      <span class="text-muted-foreground">Transform Method:</span>
                      <span class="text-foreground font-medium">
                        {sig.transformMethod}{sig.docMdpPermissionLevel ? ` (Access Level P=${sig.docMdpPermissionLevel})` : ''}
                      </span>
                    </div>
                  {/if}
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">CAdES signingCertificateV2:</span>
                    <span class={sig.hasSigningCertificateV2 ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                      {sig.hasSigningCertificateV2 ? 'Bound (RFC 5035 ESSCertIDv2)' : 'Not Bound (Legacy)'}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">RFC 3161 Qualified Timestamp:</span>
                    <span class={sig.hasTimestampToken ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                      {sig.hasTimestampToken ? (sig.timestampTime ? `Present (${sig.timestampTime})` : 'Present') : 'None'}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Certificate Legitimacy:</span>
                    <span class={sig.hasIllegalTimeStampingUsage ? 'text-destructive font-semibold' : 'text-foreground'}>
                      {sig.hasIllegalTimeStampingUsage ? 'Illegal (timeStamping EKU Conflict)' : 'Legitimate Document Signer'}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Document Security Store (/DSS):</span>
                    <span class={sig.hasDss ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                      {sig.hasDss ? 'Present (Long Term Validation)' : 'Not Present'}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Certificate Chain Depth:</span>
                    <span>{sig.certificateChainLength} Certificate{sig.certificateChainLength > 1 ? 's' : ''}</span>
                  </div>
                </div>

                <!-- Swiss ESigA / ZertES Compliance Status Callout -->
                {#if sig.esigaCompliance.status === 'indeterminate'}
                  <div class="p-2 bg-warning/10 border border-warning/20 rounded text-[11px] text-warning space-y-1">
                    <div class="font-semibold flex items-center gap-1">
                      <AlertTriangle class="h-3 w-3 text-warning" />
                      ESigA / ZertES Status: Indeterminate
                    </div>
                    <ul class="list-disc list-inside space-y-0.5 text-[10px] text-warning/90">
                      {#each sig.esigaCompliance.reasons as reason}
                        <li>{reason}</li>
                      {/each}
                    </ul>
                  </div>
                {:else if sig.esigaCompliance.status === 'non_compliant'}
                  <div class="p-2 bg-destructive/10 border border-destructive/20 rounded text-[11px] text-destructive space-y-1">
                    <div class="font-semibold flex items-center gap-1">
                      <XCircle class="h-3 w-3" />
                      ESigA / ZertES Status: Non-Compliant
                    </div>
                    <ul class="list-disc list-inside space-y-0.5 text-[10px]">
                      {#each sig.esigaCompliance.reasons as reason}
                        <li>{reason}</li>
                      {/each}
                    </ul>
                  </div>
                {:else}
                  <div class="p-2 bg-card border border-border rounded text-[11px] text-foreground flex items-center gap-1.5 font-medium">
                    <CheckCircle2 class="h-3.5 w-3.5 shrink-0" />
                    Compliant with Swiss ESigA / ZertES and ETSI EN 319 142 PAdES requirements.
                  </div>
                {/if}

                <div class="pt-2 border-t border-border/50 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span class="text-muted-foreground block text-[10px]">Certificate Subject</span>
                    <span class="font-medium">{sig.certificateSubject.commonName}</span>
                    {#if sig.certificateSubject.organization}
                      <span class="text-muted-foreground block text-[10px]">{sig.certificateSubject.organization}</span>
                    {/if}
                  </div>

                  <div>
                    <span class="text-muted-foreground block text-[10px]">Certificate Issuer</span>
                    <span class="font-medium">{sig.certificateIssuer.commonName}</span>
                    {#if sig.isSelfSigned}
                      <span class="text-warning block text-[10px]">Self-Signed Root</span>
                    {/if}
                  </div>

                  <div>
                    <span class="text-muted-foreground block text-[10px]">Validity Range</span>
                    <span>{sig.validFrom} - {sig.validTo}</span>
                  </div>

                  <div>
                    <span class="text-muted-foreground block text-[10px]">Byte Range Coverage</span>
                    <span class="font-sans text-[10px] truncate block" title={sig.byteRange.join(', ')}>
                      [{sig.byteRange[0]}, {sig.byteRange[1]}, {sig.byteRange[2]}, {sig.byteRange[3]}]
                    </span>
                  </div>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <Dialog.Footer class="justify-between">
      <div class="text-[11px] text-muted-foreground flex items-center gap-1">
        <Lock class="h-3 w-3" /> Verified using detached PKCS#7 SHA-256 digests.
      </div>
      <Button variant="outline" size="sm" class="h-8 text-xs" onclick={handleClose}>
        Close
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
