<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { ControlRow } from '$lib/components/ui/control-row/index.js';
  import { parsePageRangeStrict } from '../../utils/page-range';
  import { Loader2, Scissors } from 'lucide-svelte';

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
  <Dialog.Content class="sm:max-w-[420px]">
    <Dialog.Header class="pr-12">
      <Dialog.Title>
        <Scissors class="h-4 w-4" />
        {mode === 'split' ? 'Split Pages' : 'Extract Pages'}
      </Dialog.Title>
      <Dialog.Description>
        Specify page numbers or page ranges to {mode === 'split' ? 'split and remove from the current document' : 'extract into a new PDF document'}.
      </Dialog.Description>
    </Dialog.Header>

    <div class="dialog-body">
      <div class="field-group">
        <Label for="range-input" class="field-label">Page ranges (e.g. "1-3, 5, 7")</Label>
        <Input
          id="range-input"
          type="text"
          aria-invalid={Boolean(errorMessage)}
          bind:value={rangeInput}
          placeholder="1-3, 5"
          disabled={isProcessing}
          class="field-input"
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSplit();
            }
          }}
        />
      </div>

      <ControlRow label="Download extracted PDF file immediately" for="auto-download" size="sm">
        <Checkbox id="auto-download" bind:checked={autoDownload} />
      </ControlRow>

      {#if errorMessage}
        <div role="alert" class="dialog-error">
          {errorMessage}
        </div>
      {/if}

      <div class="text-[11px] text-muted-foreground">
        Total pages available in document: {store.pageCount}
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" size="sm" class="h-8 text-xs" disabled={isProcessing} onclick={onClose}>
        Cancel
      </Button>
      <Button variant="secondary" size="sm" class="h-8 text-xs" disabled={isProcessing} onclick={handleSplit}>
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
