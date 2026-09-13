<script lang="ts">
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';

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

  let initialized = false;
  $effect(() => {
    if (!initialized || !rangeInput) {
      rangeInput = `1-${store.pageCount}`;
      initialized = true;
    }
  });

  function parsePageRanges(input: string, maxPages: number): number[] {
    const indices = new Set<number>();
    const parts = input.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      if (trimmed.includes('-')) {
        const [startStr, endStr] = trimmed.split('-');
        const start = parseInt(startStr.trim(), 10);
        const end = parseInt(endStr.trim(), 10);

        if (isNaN(start) || isNaN(end) || start < 1 || end > maxPages || start > end) {
          throw new Error(`Invalid range specification: "${trimmed}"`);
        }

        for (let i = start - 1; i <= end - 1; i++) {
          indices.add(i);
        }
      } else {
        const val = parseInt(trimmed, 10);
        if (isNaN(val) || val < 1 || val > maxPages) {
          throw new Error(`Invalid page number: "${trimmed}"`);
        }
        indices.add(val - 1);
      }
    }

    return Array.from(indices).sort((a, b) => a - b);
  }

  function handleSplit(): void {
    errorMessage = '';
    try {
      const targetIndices = parsePageRanges(rangeInput, store.pageCount);
      if (targetIndices.length === 0) {
        errorMessage = 'Please specify at least one valid page.';
        return;
      }
      
      if (mode === 'split' && targetIndices.length === store.pageCount) {
        errorMessage = 'Cannot split all pages. At least one page must remain.';
        return;
      }

      actions.extractPages(targetIndices, mode, rangeInput, { autoDownload });

      onClose();
    } catch (err) {
      if (err instanceof Error) {
        errorMessage = err.message;
      } else {
        errorMessage = 'Failed to process document.';
      }
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
      <Button variant="outline" onclick={onClose}>
        Cancel
      </Button>
      <Button onclick={handleSplit}>
        {mode === 'split' ? 'Split Pages' : 'Extract Pages'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
