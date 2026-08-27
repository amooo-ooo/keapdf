<script lang="ts">
  import { onMount } from 'svelte';
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

  onMount(() => {
    if (store.showValidateSignaturesDialog) {
      runValidation();
    }
  });

  $effect(() => {
    if (store.showValidateSignaturesDialog) {
      runValidation();
    }
  });

  function handleClose(): void {
    store.showValidateSignaturesDialog = false;
  }
</script>

<Dialog.Root open={store.showValidateSignaturesDialog} onOpenChange={(open) => { if (!open) handleClose(); }}>
  <Dialog.Content class="sm:max-w-[620px] max-h-[85vh] flex flex-col p-0 overflow-hidden">
    <Dialog.Header class="px-6 pt-5 pb-3 border-b border-border bg-card">
      <div class="flex items-center justify-between">
        <Dialog.Title class="flex items-center gap-2 text-base font-semibold">
          <ShieldCheck class="h-4 w-4 text-primary" />
          Digital Signature Verification (ISO 32000)
        </Dialog.Title>
        <Button size="sm" variant="ghost" class="h-7 text-xs px-2" onclick={runValidation} disabled={isValidating}>
          <RefreshCw class="h-3 w-3 mr-1 {isValidating ? 'animate-spin' : ''}" />
          Refresh
        </Button>
      </div>
      <Dialog.Description class="text-xs text-muted-foreground">
        Cryptographic integrity checks and certificate validity analysis for embedded PDF signatures.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      {#if isValidating}
        <div class="py-12 flex flex-col items-center justify-center text-center space-y-2">
          <RefreshCw class="h-6 w-6 animate-spin text-primary" />
          <p class="text-xs text-muted-foreground">Checking ByteRanges and verifying cryptographic signatures...</p>
        </div>
      {:else if results.length === 0}
        <div class="py-10 border border-dashed border-border rounded-lg text-center flex flex-col items-center justify-center gap-2">
          <FileCheck class="h-8 w-8 text-muted-foreground stroke-1" />
          <div class="text-xs font-semibold">No Digital Signatures Found</div>
          <p class="text-[11px] text-muted-foreground max-w-[340px]">
            This document does not contain any embedded PDF ISO 32000 digital signature dictionaries or AcroForm signature fields.
          </p>
          <Button size="sm" variant="outline" class="mt-2 text-xs" onclick={() => { handleClose(); actions.openCertSignDialog(); }}>
            <KeyRound class="h-3.5 w-3.5 mr-1.5 text-primary" /> Add Digital Certificate Signature
          </Button>
        </div>
      {:else}
        <div class="flex items-center justify-between pb-1">
          <span class="text-xs font-medium text-muted-foreground">Found {results.length} Digital Signature{results.length > 1 ? 's' : ''}</span>
        </div>

        <div class="space-y-3">
          {#each results as sig (sig.signatureId)}
            <div class="border rounded-lg overflow-hidden bg-card transition-all {sig.status === 'valid' ? 'border-emerald-500/40 shadow-xs' : 'border-destructive/40'}">
              <div class="p-3.5 flex items-start justify-between border-b border-border/60 bg-muted/20">
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-xs text-foreground">{sig.signerName}</span>
                    {#if sig.status === 'valid'}
                      <Badge variant="outline" class="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30 flex items-center gap-1">
                        <CheckCircle2 class="h-3 w-3" /> Valid & Untampered
                      </Badge>
                    {:else if sig.status === 'tampered'}
                      <Badge variant="destructive" class="text-[10px] flex items-center gap-1">
                        <XCircle class="h-3 w-3" /> Altered after Signing
                      </Badge>
                    {:else if sig.status === 'expired'}
                      <Badge variant="outline" class="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/30 flex items-center gap-1">
                        <AlertTriangle class="h-3 w-3" /> Certificate Expired
                      </Badge>
                    {:else}
                      <Badge variant="destructive" class="text-[10px] flex items-center gap-1">
                        <XCircle class="h-3 w-3" /> Invalid Signature
                      </Badge>
                    {/if}
                  </div>
                  <div class="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Clock class="h-3 w-3" /> Signed: {sig.signingTimeFormatted}
                  </div>
                </div>

                <div class="text-[11px] font-mono text-muted-foreground">
                  {sig.subFilter}
                </div>
              </div>

              <div class="p-3.5 space-y-2 text-xs">
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
                      <span class="text-amber-600 dark:text-amber-400 block text-[10px]">Self-Signed Root</span>
                    {/if}
                  </div>

                  <div>
                    <span class="text-muted-foreground block text-[10px]">Validity Range</span>
                    <span>{sig.validFrom} - {sig.validTo}</span>
                  </div>

                  <div>
                    <span class="text-muted-foreground block text-[10px]">Byte Range Coverage</span>
                    <span class="font-mono text-[10px] truncate block" title={sig.byteRange.join(', ')}>
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

    <Dialog.Footer class="px-6 py-3 border-t border-border bg-card flex justify-between items-center">
      <div class="text-[11px] text-muted-foreground flex items-center gap-1">
        <Lock class="h-3 w-3 text-emerald-500" /> Verified using detached PKCS#7 SHA-256 digests.
      </div>
      <Button variant="outline" size="sm" class="text-xs" onclick={handleClose}>
        Close
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
