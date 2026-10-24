<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Lock, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

  let password = $state('');
  let showPassword = $state(false);
  let isSubmitting = $state(false);

  $effect(() => {
    if (store.showPasswordPromptDialog) {
      untrack(() => {
        password = '';
        showPassword = false;
        isSubmitting = false;
      });
    }
  });

  async function handleSubmit(): Promise<void> {
    if (!password || isSubmitting) return;
    isSubmitting = true;
    try {
      await actions.submitDocumentPassword(password);
    } finally {
      isSubmitting = false;
    }
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      actions.cancelPasswordPrompt();
    }
  }
</script>

<Dialog.Root open={store.showPasswordPromptDialog} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[400px] font-sans">
    <Dialog.Header class="pr-12">
      <Dialog.Title>
        <Lock class="h-4 w-4" />
        Password Protected Document
      </Dialog.Title>
      <Dialog.Description>
        This PDF is encrypted. Enter the document password to open it.
      </Dialog.Description>
    </Dialog.Header>

    <div class="dialog-body">
      {#if store.pendingPasswordFileName}
        <div class="rounded-[var(--radius-card-inner)] bg-muted/40 border border-border px-3 py-2 text-xs font-medium text-foreground truncate" title={store.pendingPasswordFileName}>
          {store.pendingPasswordFileName}
        </div>
      {/if}

      {#if store.passwordPromptError}
        <div role="alert" class="dialog-error">
          <AlertCircle class="h-4 w-4 shrink-0" />
          <span>{store.passwordPromptError}</span>
        </div>
      {/if}

      <div class="field-group">
        <Label for="doc-password" class="field-label">Document Password</Label>
        <div class="relative">
          <Input
            id="doc-password"
            type={showPassword ? 'text' : 'password'}
            aria-invalid={Boolean(store.passwordPromptError)}
            placeholder="Enter password..."
            bind:value={password}
            onkeydown={handleKeyDown}
            class="field-input pr-8"
            disabled={isSubmitting}
            autofocus
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
        onclick={() => actions.cancelPasswordPrompt()}
        disabled={isSubmitting}
      >
        Cancel
      </Button>
      <Button
        variant="secondary"
        size="sm"
        class="h-8 text-xs"
        onclick={handleSubmit}
        disabled={!password || isSubmitting}
      >
        {#if isSubmitting}
          <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" />
          Decrypting...
        {:else}
          Unlock Document
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
