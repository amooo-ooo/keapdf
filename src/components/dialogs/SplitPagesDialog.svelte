<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { parsePageRangeStrict } from '../../utils/page-range';
  import { Loader2 } from 'lucide-svelte';

  interface Props {
    mode: 'split' | 'extract';
    onClose: () => void;
  }

  let { mode, onClose }: Props = $props();

  const store = useEditorStore();
  const actions = useEditorActions();

  let rangeInput = $state('');
  let autoDownload = $state(true);
  let errorMessage = $state('');
  let isProcessing = $state(false);

  let initialized = false;
  $effect(() => {
    if (!initialized && store.pageCount > 0) {
      untrack(() => {
        rangeInput = `1-${store.pageCount}`;
        initialized = true;
      });
    }
  });

  function handleSplit(): void {
    if (isProcessing) return;
    errorMessage = '';
    try {
      const targetIndices = parsePageRangeStrict(rangeInput, store.pageCount);
      if (targetIndices.length === 0) {
        errorMessage = 'Please specify at least one valid page.';
        return;
      }
      
      if (mode === 'split' && targetIndices.length === store.pageCount) {
        errorMessage = 'Cannot split all pages. At least one page must remain.';
        return;
      }

      isProcessing = true;
      actions.extractPages(targetIndices, mode, rangeInput, { autoDownload });

      onClose();
    } catch (err) {
      if (err instanceof Error) {
        errorMessage = err.message;
      } else {
        errorMessage = 'Failed to process document.';
      }
    } finally {
      isProcessing = false;
    }
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      onClose();
    }
  }
</script>

<Dialog.Root open={true} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[425px]">
    <Dialog.Header>
      <Dialog.Title>{mode === 'split' ? 'Split Pages' : 'Extract Pages'}</Dialog.Title>
      <Dialog.Description>
        Specify page numbers or page ranges to {mode === 'split' ? 'split and remove from the current document' : 'extract into a new PDF document'}.
      </Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-4 py-4">
      <div class="grid gap-2">
        <Label for="range-input">Page ranges (e.g. "1-3, 5, 7")</Label>
        <Input
          id="range-input"
          type="text"
          bind:value={rangeInput}
          placeholder="1-3, 5"
          disabled={isProcessing}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSplit();
            }
          }}
        />
      </div>

      <div class="flex items-center space-x-2">
        <Checkbox id="auto-download" bind:checked={autoDownload} />
        <Label for="auto-download" class="text-xs font-normal cursor-pointer">
          Download extracted PDF file immediately
        </Label>
      </div>

      {#if errorMessage}
        <div class="rounded bg-destructive/10 p-2 text-xs font-medium text-destructive">
          {errorMessage}
        </div>
      {/if}

      <div class="text-xs text-muted-foreground">
        Total pages available in document: {store.pageCount}
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" disabled={isProcessing} onclick={onClose}>
        Cancel
      </Button>
      <Button disabled={isProcessing} onclick={handleSplit}>
        {#if isProcessing}
          <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" />
          Processing...
        {:else}
          {mode === 'split' ? 'Split Pages' : 'Extract Pages'}
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
