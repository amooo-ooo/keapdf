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
  <Dialog.Content class="sm:max-w-md font-sans">
    <Dialog.Header>
      <div class="flex items-center gap-2 mb-1">
        <div class="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <Lock class="h-4 w-4" />
        </div>
        <div>
          <Dialog.Title class="text-base font-semibold">Password Protected Document</Dialog.Title>
          <Dialog.Description class="text-xs text-muted-foreground">
            This PDF is encrypted. Enter the document password to open it.
          </Dialog.Description>
        </div>
      </div>
    </Dialog.Header>

    {#if store.pendingPasswordFileName}
      <div class="rounded-md bg-muted/50 px-3 py-2 text-xs font-medium text-foreground truncate">
        {store.pendingPasswordFileName}
      </div>
    {/if}

    {#if store.passwordPromptError}
      <div class="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <AlertCircle class="h-4 w-4 shrink-0" />
        <span>{store.passwordPromptError}</span>
      </div>
    {/if}

    <div class="space-y-2 py-2">
      <Label for="doc-password" class="text-xs font-medium">Document Password</Label>
      <div class="relative">
        <Input
          id="doc-password"
          type={showPassword ? 'text' : 'password'}
          placeholder="Enter password..."
          bind:value={password}
          onkeydown={handleKeyDown}
          class="h-9 pr-9 text-xs"
          disabled={isSubmitting}
          autofocus
        />
        <button
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onclick={() => (showPassword = !showPassword)}
          tabindex={0}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {#if showPassword}
            <EyeOff class="h-3.5 w-3.5" aria-hidden="true" />
          {:else}
            <Eye class="h-3.5 w-3.5" aria-hidden="true" />
          {/if}
        </button>
      </div>
    </div>

    <Dialog.Footer class="gap-2 sm:gap-0">
      <Button
        variant="outline"
        size="sm"
        class="text-xs"
        onclick={() => actions.cancelPasswordPrompt()}
        disabled={isSubmitting}
      >
        Cancel
      </Button>
      <Button
        size="sm"
        class="text-xs"
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
