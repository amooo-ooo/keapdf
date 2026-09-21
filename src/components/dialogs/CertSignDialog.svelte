<script lang="ts">
  import { onMount } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { downloadBytes } from '../../utils/download-utils';
  import {
    createSelfSignedCertificate,
    parsePkcs12,
    type DigitalIdentity,
    type SignPdfOptions,
  } from '../../services/pdf/operations/signature-ops';
  import { getSavedSignatures, type SavedSignature } from '../../services/signature-storage';
  import {
    ShieldCheck,
    KeyRound,
    FileSignature,
    CheckCircle2,
    Download,
    Eye,
    EyeOff,
    Upload,
    Sparkles,
    AlertCircle,
    Lock,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const canvasStore = useCanvasStore();

  let activeTab = $state<'cert' | 'details' | 'appearance' | 'sign'>('cert');
  let certMode = $state<'generate' | 'import'>('generate');

  // Certificate generation inputs
  let commonName = $state('Jane Smith');
  let organization = $state('Acme Corporation');
  let organizationalUnit = $state('Legal & Compliance');
  let email = $state('jane.smith@example.com');
  let country = $state('US');
  let certPassword = $state('Password123!');
  let keySize = $state<2048 | 4096>(2048);
  let validityYears = $state(2);

  // Certificate import inputs
  let importedP12File: File | null = $state(null);
  let importPassword = $state('');
  let importError = $state<string | null>(null);

  // Active identity
  let activeIdentity = $state<DigitalIdentity | null>(null);
  let isGenerating = $state(false);

  // Signature metadata
  let reason = $state('I am approving this document');
  let location = $state('Auckland, New Zealand');
  let contactInfo = $state('jane.smith@example.com');
  const reasonPresets = [
    'I am approving this document',
    'I have reviewed and agree to the terms in this document',
    'I am the author of this document',
    'I certify the integrity and authenticity of this document',
  ];

  // Visual appearance
  let isVisibleSignature = $state(true);
  let targetPageIndex = $state(0);
  let placementPosition = $state<'bottom-right' | 'bottom-left' | 'center'>('bottom-right');
  let savedSignatures = $state<SavedSignature[]>([]);
  let selectedGraphicSigId = $state<string | null>(null);
  let showTextDetails = $state(true);

  // Standards and PAdES Configuration
  let subFilter = $state<'ETSI.CAdES.detached' | 'adbe.pkcs7.detached'>('ETSI.CAdES.detached');
  let enableTimestamp = $state(false);
  let tsaUrl = $state('https://freetsa.org/tsr');
  let embedDss = $state(true);

  // Status
  let isSigning = $state(false);
  let signSuccess = $state(false);
  let signedPdfBytes = $state<Uint8Array | null>(null);
  let signError = $state<string | null>(null);

  onMount(() => {
    savedSignatures = getSavedSignatures();
    const def = savedSignatures.find((s) => s.isDefault);
    if (def) selectedGraphicSigId = def.id;
    else if (savedSignatures.length > 0) selectedGraphicSigId = savedSignatures[0].id;
    targetPageIndex = store.currentPageIndex;
  });

  $effect(() => {
    if (store.showCertSignDialog) {
      savedSignatures = getSavedSignatures();
      targetPageIndex = store.currentPageIndex;
      signSuccess = false;
      signedPdfBytes = null;
      signError = null;
    }
  });

  async function handleGenerateCertificate(): Promise<void> {
    if (!commonName.trim()) return;
    isGenerating = true;
    try {
      const id = await createSelfSignedCertificate({
        commonName: commonName.trim(),
        organization: organization.trim() || undefined,
        organizationalUnit: organizationalUnit.trim() || undefined,
        email: email.trim() || undefined,
        country: country.trim() || undefined,
        password: certPassword,
        keySize,
        validityYears,
      });
      activeIdentity = id;
      activeTab = 'details';
    } catch (err) {
      console.error('Failed to generate digital identity:', err);
      signError = 'Failed to generate RSA certificate keys.';
    } finally {
      isGenerating = false;
    }
  }

  async function handleImportP12(): Promise<void> {
    if (!importedP12File) return;
    importError = null;
    try {
      const buffer = await importedP12File.arrayBuffer();
      const id = parsePkcs12(buffer, importPassword);
      activeIdentity = id;
      activeTab = 'details';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid PKCS#12 file or incorrect password.';
      importError = message;
    }
  }

  function handleExportP12(): void {
    if (!activeIdentity || !activeIdentity.p12Bytes) return;
    const cleanName = activeIdentity.subject.commonName.replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadBytes(activeIdentity.p12Bytes, `${cleanName}_digital_id.p12`, 'application/x-pkcs12');
  }

  async function handleExecuteSign(downloadOnly = false): Promise<void> {
    if (!activeIdentity) return;
    isSigning = true;
    signError = null;

    try {
      let graphicUrl: string | undefined = undefined;
      if (selectedGraphicSigId) {
        const found = savedSignatures.find((s) => s.id === selectedGraphicSigId);
        if (found) graphicUrl = found.dataUrl;
      }

      let visualOptions = undefined;
      if (isVisibleSignature) {
        let vx = 350;
        let vy = 60;
        const vw = 200;
        const vh = 65;

        try {
          const dims = actions.service.document.getPage(targetPageIndex).getDimensions();
          if (placementPosition === 'bottom-right') {
            vx = Math.max(20, dims.widthPts - vw - 36);
            vy = 36;
          } else if (placementPosition === 'bottom-left') {
            vx = 36;
            vy = 36;
          } else {
            vx = Math.max(20, (dims.widthPts - vw) / 2);
            vy = Math.max(20, (dims.heightPts - vh) / 2);
          }
        } catch {}

        visualOptions = {
          pageIndex: targetPageIndex,
          x: vx,
          y: vy,
          width: vw,
          height: vh,
          graphicDataUrl: graphicUrl,
          showTextDetails,
        };
      }

      const signOptions: SignPdfOptions = {
        identity: activeIdentity,
        signerName: activeIdentity.subject.commonName,
        reason: reason.trim() || undefined,
        location: location.trim() || undefined,
        contactInfo: contactInfo.trim() || undefined,
        signingTime: new Date(),
        visual: visualOptions,
        subFilter,
        tsaUrl: enableTimestamp && tsaUrl.trim() ? tsaUrl.trim() : undefined,
        embedDss,
      };

      const resultBytes = await actions.signActiveDocument(signOptions, canvasStore);
      signedPdfBytes = resultBytes;
      signSuccess = true;

      if (downloadOnly) {
        const outName = store.fileName.replace(/\.pdf$/i, '') + '_signed.pdf';
        downloadBytes(resultBytes, outName, 'application/pdf');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown signing failure.';
      console.error('Digital signing failed:', err);
      signError = `Digital signing failed: ${message}`;
    } finally {
      isSigning = false;
    }
  }

  function handleClose(): void {
    store.showCertSignDialog = false;
  }
</script>

<Dialog.Root open={store.showCertSignDialog} onOpenChange={(open) => { if (!open) handleClose(); }}>
  <Dialog.Content class="sm:max-w-[660px] max-h-[90vh] flex flex-col p-0 overflow-hidden">
    <Dialog.Header class="px-6 pt-5 pb-3 border-b border-border bg-card">
      <div class="flex items-center justify-between">
        <Dialog.Title class="flex items-center gap-2 text-base font-semibold">
          <ShieldCheck class="h-4 w-4 text-primary" />
          Sign with Digital Certificate (ISO 32000)
        </Dialog.Title>
        <Badge variant="outline" class="text-[10px] bg-primary/5 text-primary border-primary/20">
          PDF ISO 32000-1 / RFC 5652
        </Badge>
      </div>
      <Dialog.Description class="text-xs text-muted-foreground">
        Apply cryptographic detached PKCS#7 digital signatures with X.509 certificates and tamper protection.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex-1 overflow-y-auto px-6 py-4">
      {#if signSuccess}
        <div class="py-6 flex flex-col items-center justify-center text-center space-y-4">
          <div class="w-12 h-12 rounded-full bg-success/10 text-success flex items-center justify-center border border-success/30">
            <CheckCircle2 class="h-6 w-6" />
          </div>
          <div class="space-y-1">
            <h3 class="text-base font-semibold text-foreground">Document Digitally Signed Successfully</h3>
            <p class="text-xs text-muted-foreground max-w-[420px]">
              The document has been securely sealed with cryptographic PKCS#7 detached signature conforming to ISO 32000-1.
            </p>
          </div>

          <div class="w-full max-w-[460px] bg-muted/30 border border-border rounded-lg p-3 text-left space-y-1.5 text-xs">
            <div class="flex justify-between">
              <span class="text-muted-foreground">Signer:</span>
              <span class="font-medium">{activeIdentity?.subject.commonName}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">Reason:</span>
              <span>{reason || 'Approval'}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">SubFilter:</span>
              <span class="font-sans text-[11px]">{subFilter}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">PAdES Profile:</span>
              <span class="font-sans text-[11px] font-medium text-primary">
                {embedDss ? 'PAdES-B-LT (LTV)' : enableTimestamp ? 'PAdES-B-T (Timestamped)' : subFilter === 'ETSI.CAdES.detached' ? 'PAdES-B-B (Baseline)' : 'Legacy Adobe PKCS#7'}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">Digest:</span>
              <span class="font-sans text-[11px]">SHA-256</span>
            </div>
          </div>

          <div class="flex items-center gap-3 pt-2">
            {#if signedPdfBytes}
              <Button
                size="sm"
                class="text-xs"
                onclick={() => {
                  const outName = store.fileName.replace(/\.pdf$/i, '') + '_signed.pdf';
                  downloadBytes(signedPdfBytes!, outName, 'application/pdf');
                }}
              >
                <Download class="h-3.5 w-3.5 mr-1.5" /> Download Signed PDF
              </Button>
            {/if}
            <Button size="sm" variant="outline" class="text-xs" onclick={handleClose}>
              Done & View in Editor
            </Button>
          </div>
        </div>
      {:else}
        <Tabs.Root value={activeTab} onValueChange={(val) => (activeTab = val as typeof activeTab)}>
          <Tabs.List class="grid grid-cols-4 mb-4">
            <Tabs.Trigger value="cert" class="text-xs">
              <KeyRound class="h-3.5 w-3.5 mr-1" /> 1. Digital ID
            </Tabs.Trigger>
            <Tabs.Trigger value="details" class="text-xs" disabled={!activeIdentity}>
              <FileSignature class="h-3.5 w-3.5 mr-1" /> 2. Details
            </Tabs.Trigger>
            <Tabs.Trigger value="appearance" class="text-xs" disabled={!activeIdentity}>
              <Eye class="h-3.5 w-3.5 mr-1" /> 3. Visual
            </Tabs.Trigger>
            <Tabs.Trigger value="sign" class="text-xs" disabled={!activeIdentity}>
              <ShieldCheck class="h-3.5 w-3.5 mr-1" /> 4. Sign
            </Tabs.Trigger>
          </Tabs.List>

          <!-- Step 1: Digital ID & Certificate -->
          <Tabs.Content value="cert" class="space-y-4">
            <div class="flex gap-2 p-1 bg-muted/40 rounded-lg border border-border">
              <button
                type="button"
                class="flex-1 py-1.5 text-xs font-medium rounded-md transition-all {certMode === 'generate' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"
                onclick={() => (certMode = 'generate')}
              >
                Create New Digital ID
              </button>
              <button
                type="button"
                class="flex-1 py-1.5 text-xs font-medium rounded-md transition-all {certMode === 'import' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"
                onclick={() => (certMode = 'import')}
              >
                Upload .p12 / .pfx File
              </button>
            </div>

            {#if certMode === 'generate'}
              <div class="grid grid-cols-2 gap-3">
                <div class="col-span-2 space-y-1">
                  <Label for="cn-input" class="text-xs font-medium">Signer Full Name (Common Name) *</Label>
                  <Input id="cn-input" bind:value={commonName} placeholder="e.g. Jane Smith" class="h-8 text-xs" />
                </div>

                <div class="space-y-1">
                  <Label for="org-input" class="text-xs font-medium">Organization / Company</Label>
                  <Input id="org-input" bind:value={organization} placeholder="e.g. Acme Corp" class="h-8 text-xs" />
                </div>

                <div class="space-y-1">
                  <Label for="ou-input" class="text-xs font-medium">Department / Unit</Label>
                  <Input id="ou-input" bind:value={organizationalUnit} placeholder="e.g. Legal" class="h-8 text-xs" />
                </div>

                <div class="space-y-1">
                  <Label for="email-input" class="text-xs font-medium">Email Address</Label>
                  <Input id="email-input" type="email" bind:value={email} placeholder="signer@example.com" class="h-8 text-xs" />
                </div>

                <div class="space-y-1">
                  <Label for="country-input" class="text-xs font-medium">Country Code (2-letter)</Label>
                  <Input id="country-input" bind:value={country} maxlength={2} placeholder="US" class="h-8 text-xs uppercase" />
                </div>

                <div class="space-y-1">
                  <Label for="pwd-input" class="text-xs font-medium">Certificate Password *</Label>
                  <Input id="pwd-input" type="password" bind:value={certPassword} placeholder="Enter password to protect key" class="h-8 text-xs" />
                </div>

                <div class="space-y-1">
                  <Label class="text-xs font-medium">RSA Key Modulus</Label>
                  <Select.Root
                    type="single"
                    value={keySize.toString()}
                    onValueChange={(val) => { if (val === '2048' || val === '4096') keySize = parseInt(val, 10) as 2048 | 4096; }}
                  >
                    <Select.Trigger class="w-full h-8 text-xs">
                      {keySize === 2048 ? 'RSA 2048-bit (Standard)' : 'RSA 4096-bit (High Security)'}
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="2048" label="RSA 2048-bit (Standard)">RSA 2048-bit (Standard)</Select.Item>
                      <Select.Item value="4096" label="RSA 4096-bit (High Security)">RSA 4096-bit (High Security)</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </div>
              </div>

              <div class="pt-3 border-t border-border flex items-center justify-between">
                <div class="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Lock class="h-3 w-3 text-success" /> Keys are generated client-side inside your browser
                </div>
                <Button size="sm" class="text-xs" onclick={handleGenerateCertificate} disabled={!commonName.trim() || !certPassword || isGenerating}>
                  {#if isGenerating}
                    <Sparkles class="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating Keys...
                  {:else}
                    Generate & Proceed
                  {/if}
                </Button>
              </div>
            {:else}
              <div class="space-y-3">
                <div class="border-2 border-dashed border-border rounded-lg p-6 text-center space-y-2">
                  <Upload class="h-6 w-6 text-muted-foreground mx-auto stroke-1" />
                  <div class="text-xs font-medium">Select PKCS#12 (.p12 / .pfx) Certificate File</div>
                  <input
                    type="file"
                    accept=".p12,.pfx,application/x-pkcs12"
                    onchange={(e) => {
                      importedP12File = (e.target as HTMLInputElement).files?.[0] || null;
                    }}
                    class="text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:bg-primary file:text-primary-foreground"
                  />
                </div>

                <div class="space-y-1">
                  <Label for="import-pwd" class="text-xs font-medium">Certificate Password</Label>
                  <Input id="import-pwd" type="password" bind:value={importPassword} placeholder="Enter password to unlock private key" class="h-8 text-xs" />
                </div>

                {#if importError}
                  <div class="text-xs text-destructive flex items-center gap-1.5 p-2 bg-destructive/10 rounded border border-destructive/20">
                    <AlertCircle class="h-3.5 w-3.5 shrink-0" /> {importError}
                  </div>
                {/if}

                <div class="pt-2 border-t border-border flex justify-end">
                  <Button size="sm" class="text-xs" onclick={handleImportP12} disabled={!importedP12File}>
                    Unlock & Proceed
                  </Button>
                </div>
              </div>
            {/if}
          </Tabs.Content>

          <!-- Step 2: Signature Metadata -->
          <Tabs.Content value="details" class="space-y-4">
            {#if activeIdentity}
              <div class="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1 text-xs">
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-primary flex items-center gap-1.5">
                    <ShieldCheck class="h-4 w-4 text-primary" />
                    Digital Identity Ready: {activeIdentity.subject.commonName}
                  </span>
                  <Button size="sm" variant="ghost" class="h-6 text-[11px] px-2 text-primary" onclick={handleExportP12}>
                    <Download class="h-3 w-3 mr-1" /> Export .p12
                  </Button>
                </div>
                <div class="text-[11px] text-muted-foreground">
                  Valid from {activeIdentity.validFrom.toLocaleDateString()} to {activeIdentity.validTo.toLocaleDateString()}
                </div>
              </div>
            {/if}

            <div class="space-y-3">
              <div class="space-y-1">
                <Label class="text-xs font-medium">Signing Reason</Label>
                <Select.Root
                  type="single"
                  value={reason}
                  onValueChange={(val) => { if (val) reason = val; }}
                >
                  <Select.Trigger class="w-full h-8 text-xs mb-1.5">
                    {reason || "Select a signing reason..."}
                  </Select.Trigger>
                  <Select.Content>
                    {#each reasonPresets as preset}
                      <Select.Item value={preset} label={preset}>{preset}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
                <Input bind:value={reason} placeholder="Or enter custom signing reason..." class="h-8 text-xs" />
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1">
                  <Label for="loc-input" class="text-xs font-medium">Signing Location</Label>
                  <Input id="loc-input" bind:value={location} placeholder="e.g. City, Country" class="h-8 text-xs" />
                </div>

                <div class="space-y-1">
                  <Label for="contact-input" class="text-xs font-medium">Signer Contact Info</Label>
                  <Input id="contact-input" bind:value={contactInfo} placeholder="Email or Phone" class="h-8 text-xs" />
                </div>
              </div>

              <!-- Standards and Security Configuration -->
              <div class="space-y-3 pt-2 border-t border-border">
                <div class="space-y-1">
                  <div class="flex items-center justify-between">
                    <Label class="text-xs font-medium">Signature Standard and SubFilter</Label>
                    <Badge variant="outline" class="text-[10px] bg-primary/5 text-primary border-primary/20">
                      ETSI EN 319 142
                    </Badge>
                  </div>
                  <Select.Root
                    type="single"
                    value={subFilter}
                    onValueChange={(val) => { if (val === 'ETSI.CAdES.detached' || val === 'adbe.pkcs7.detached') subFilter = val; }}
                  >
                    <Select.Trigger class="w-full h-8 text-xs">
                      {subFilter === 'ETSI.CAdES.detached' ? 'PAdES Baseline (ETSI.CAdES.detached) - Recommended' : 'Adobe Legacy (adbe.pkcs7.detached)'}
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="ETSI.CAdES.detached" label="PAdES Baseline (ETSI.CAdES.detached) - Recommended">
                        PAdES Baseline (ETSI.CAdES.detached) - Recommended
                      </Select.Item>
                      <Select.Item value="adbe.pkcs7.detached" label="Adobe Legacy (adbe.pkcs7.detached)">
                        Adobe Legacy (adbe.pkcs7.detached)
                      </Select.Item>
                    </Select.Content>
                  </Select.Root>
                  <p class="text-[10px] text-muted-foreground">
                    PAdES embeds CAdES signingCertificateV2 (RFC 5035) cryptographically binding certificate hashes.
                  </p>
                </div>

                <div class="space-y-2 p-2.5 bg-muted/20 border border-border rounded-lg text-xs">
                  <div class="flex items-center justify-between">
                    <div>
                      <span class="font-medium block text-xs">RFC 3161 Qualified Timestamp (PAdES B-T)</span>
                      <span class="text-[10px] text-muted-foreground">Applies authentic cryptographic time from a Time Stamping Authority.</span>
                    </div>
                    <Checkbox bind:checked={enableTimestamp} />
                  </div>

                  {#if enableTimestamp}
                    <div class="space-y-1 pt-1">
                      <Label for="tsa-url" class="text-[11px] font-medium">TSA Server URL</Label>
                      <Input id="tsa-url" bind:value={tsaUrl} placeholder="https://freetsa.org/tsr" class="h-7 text-xs font-sans" />
                    </div>
                  {/if}
                </div>

                <div class="flex items-center justify-between p-2.5 bg-muted/20 border border-border rounded-lg text-xs">
                  <div>
                    <span class="font-medium block text-xs">Long-Term Validation Store (/DSS)</span>
                    <span class="text-[10px] text-muted-foreground">Embeds Document Security Store dictionaries for PAdES B-LT compliance.</span>
                  </div>
                  <Checkbox bind:checked={embedDss} />
                </div>
              </div>
            </div>

            <div class="pt-3 border-t border-border flex justify-between">
              <Button size="sm" variant="outline" class="text-xs" onclick={() => (activeTab = 'cert')}>
                Back
              </Button>
              <Button size="sm" class="text-xs" onclick={() => (activeTab = 'appearance')}>
                Next: Visual Options
              </Button>
            </div>
          </Tabs.Content>

          <!-- Step 3: Visual Appearance -->
          <Tabs.Content value="appearance" class="space-y-4">
            <div class="flex items-center justify-between p-3 bg-muted/20 border border-border rounded-lg">
              <div>
                <div class="text-xs font-semibold">Render Visual Signature on Document</div>
                <div class="text-[11px] text-muted-foreground">Places an Adobe-style signature seal badge on the target page.</div>
              </div>
              <Switch bind:checked={isVisibleSignature} aria-label="Render Visual Signature on Document" />
            </div>

            {#if isVisibleSignature}
              <div class="space-y-3">
                <div class="grid grid-cols-2 gap-3">
                  <div class="space-y-1">
                    <Label class="text-xs font-medium">Target Page</Label>
                    <Select.Root
                      type="single"
                      value={targetPageIndex.toString()}
                      onValueChange={(val) => { if (val) targetPageIndex = parseInt(val, 10); }}
                    >
                      <Select.Trigger class="w-full h-8 text-xs">
                        Page {targetPageIndex + 1}
                      </Select.Trigger>
                      <Select.Content>
                        {#each Array.from({ length: store.pageCount }, (_, i) => i) as pIdx}
                          <Select.Item value={pIdx.toString()} label="Page {pIdx + 1}">
                            Page {pIdx + 1}
                          </Select.Item>
                        {/each}
                      </Select.Content>
                    </Select.Root>
                  </div>

                  <div class="space-y-1">
                    <Label class="text-xs font-medium">Placement Position</Label>
                    <Select.Root
                      type="single"
                      value={placementPosition}
                      onValueChange={(val) => { if (val === 'bottom-right' || val === 'bottom-left' || val === 'center') placementPosition = val; }}
                    >
                      <Select.Trigger class="w-full h-8 text-xs">
                        {placementPosition === 'bottom-right' ? 'Bottom Right of Page' : placementPosition === 'bottom-left' ? 'Bottom Left of Page' : 'Center of Page'}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="bottom-right" label="Bottom Right of Page">Bottom Right of Page</Select.Item>
                        <Select.Item value="bottom-left" label="Bottom Left of Page">Bottom Left of Page</Select.Item>
                        <Select.Item value="center" label="Center of Page">Center of Page</Select.Item>
                      </Select.Content>
                    </Select.Root>
                  </div>
                </div>

                {#if savedSignatures.length > 0}
                  <div class="space-y-1.5">
                    <Label class="text-xs font-medium">Include Handwritten Signature Artwork (Optional)</Label>
                    <div class="grid grid-cols-3 gap-2 max-h-[100px] overflow-y-auto">
                      <button
                        type="button"
                        class="border rounded p-2 text-center text-xs flex items-center justify-center {selectedGraphicSigId === null ? 'border-primary bg-primary/5 font-medium' : 'border-border'}"
                        onclick={() => (selectedGraphicSigId = null)}
                      >
                        Text Only Seal
                      </button>
                      {#each savedSignatures as s}
                        <button
                          type="button"
                          class="border rounded p-1 flex items-center justify-center h-12 bg-card {selectedGraphicSigId === s.id ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-border'}"
                          onclick={() => (selectedGraphicSigId = s.id)}
                        >
                          <img src={s.dataUrl} alt={s.title} class="max-h-full max-w-full object-contain" />
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}

                <!-- Live Preview of Visual Signature -->
                <div class="space-y-1 pt-1">
                  <Label class="text-xs text-muted-foreground">Live Signature Appearance Preview</Label>
                  <div class="h-20 bg-sky-50/50 dark:bg-slate-900 border border-blue-400/80 rounded p-2.5 flex items-center gap-3">
                    {#if selectedGraphicSigId}
                      {@const chosen = savedSignatures.find((s) => s.id === selectedGraphicSigId)}
                      {#if chosen}
                        <div class="w-24 h-full flex items-center justify-center shrink-0 border-r border-blue-200 dark:border-blue-900 pr-2">
                          <img src={chosen.dataUrl} alt="Signature" class="max-h-full max-w-full object-contain" />
                        </div>
                      {/if}
                    {/if}
                    <div class="flex-1 text-[11px] leading-tight space-y-0.5 text-slate-800 dark:text-slate-200">
                      <div class="text-[10px] text-muted-foreground">Digitally signed by:</div>
                      <div class="font-bold text-slate-900 dark:text-slate-100">{activeIdentity?.subject.commonName || 'Signer Name'}</div>
                      <div class="text-[10px] text-muted-foreground truncate">Date: {new Date().toLocaleDateString()} | Reason: {reason || 'Approved'}</div>
                      {#if location}
                        <div class="text-[10px] text-muted-foreground truncate">Location: {location}</div>
                      {/if}
                    </div>
                  </div>
                </div>
              </div>
            {:else}
              <div class="p-6 text-center text-xs text-muted-foreground bg-muted/20 rounded-lg border border-border">
                <EyeOff class="h-6 w-6 mx-auto mb-2 opacity-50" />
                The digital signature will be embedded in the PDF dictionary stream and AcroForm structure without modifying the visible appearance of the page.
              </div>
            {/if}

            <div class="pt-3 border-t border-border flex justify-between">
              <Button size="sm" variant="outline" class="text-xs" onclick={() => (activeTab = 'details')}>
                Back
              </Button>
              <Button size="sm" class="text-xs" onclick={() => (activeTab = 'sign')}>
                Next: Review & Sign
              </Button>
            </div>
          </Tabs.Content>

          <!-- Step 4: Review & Sign -->
          <Tabs.Content value="sign" class="space-y-4">
            <div class="bg-card border border-border rounded-lg p-4 space-y-3 text-xs">
              <div class="font-semibold text-foreground flex items-center gap-1.5 pb-2 border-b border-border">
                <ShieldCheck class="h-4 w-4 text-success" />
                ISO 32000 Signature Summary
              </div>

              <div class="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span class="text-muted-foreground">Signer:</span>
                  <div class="font-medium">{activeIdentity?.subject.commonName}</div>
                </div>
                <div>
                  <span class="text-muted-foreground">Organization:</span>
                  <div>{activeIdentity?.subject.organization || 'None'}</div>
                </div>
                <div>
                  <span class="text-muted-foreground">Digest Algorithm:</span>
                  <div class="font-sans">SHA-256</div>
                </div>
                <div>
                  <span class="text-muted-foreground">Signature Standard:</span>
                  <div class="font-sans font-medium">{subFilter}</div>
                </div>
                <div>
                  <span class="text-muted-foreground">PAdES Profile:</span>
                  <div class="font-sans font-medium text-primary">
                    {embedDss ? 'PAdES-B-LT (LTV)' : enableTimestamp ? 'PAdES-B-T' : subFilter === 'ETSI.CAdES.detached' ? 'PAdES-B-B' : 'Legacy Adobe'}
                  </div>
                </div>
                <div>
                  <span class="text-muted-foreground">Timestamping:</span>
                  <div>{enableTimestamp ? 'RFC 3161 TSA Token' : 'Local Declared Time'}</div>
                </div>
                <div>
                  <span class="text-muted-foreground">Certificate Chain:</span>
                  <div>{activeIdentity?.certificateChain?.length || 1} Certificate(s)</div>
                </div>
                <div>
                  <span class="text-muted-foreground">Visual Badge:</span>
                  <div>{isVisibleSignature ? `Visible on Page ${targetPageIndex + 1}` : 'Invisible (Stream only)'}</div>
                </div>
                <div>
                  <span class="text-muted-foreground">Reason:</span>
                  <div class="truncate">{reason || 'Approval'}</div>
                </div>
              </div>
            </div>

            {#if signError}
              <div class="text-xs text-destructive flex items-center gap-1.5 p-2.5 bg-destructive/10 rounded border border-destructive/20">
                <AlertCircle class="h-4 w-4 shrink-0" /> {signError}
              </div>
            {/if}

            <div class="pt-3 border-t border-border flex items-center justify-between">
              <Button size="sm" variant="outline" class="text-xs" onclick={() => (activeTab = 'appearance')}>
                Back
              </Button>
              <div class="flex items-center gap-2">
                <Button size="sm" variant="outline" class="text-xs" onclick={() => handleExecuteSign(true)} disabled={isSigning}>
                  <Download class="h-3.5 w-3.5 mr-1" /> Sign & Download
                </Button>
                <Button size="sm" class="text-xs bg-success hover:bg-success/90 text-success-foreground" onclick={() => handleExecuteSign(false)} disabled={isSigning}>
                  {#if isSigning}
                    <Sparkles class="h-3.5 w-3.5 mr-1.5 animate-spin" /> Signing PDF...
                  {:else}
                    <ShieldCheck class="h-3.5 w-3.5 mr-1.5" /> Sign & Apply to Document
                  {/if}
                </Button>
              </div>
            </div>
          </Tabs.Content>
        </Tabs.Root>
      {/if}
    </div>

    <Dialog.Footer class="px-6 py-3 border-t border-border bg-card flex justify-between items-center">
      <div class="text-[11px] text-muted-foreground">
        Complies with Adobe PPKLite & ISO 32000 specifications.
      </div>
      <Button variant="outline" size="sm" class="text-xs" onclick={handleClose}>
        Cancel
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
