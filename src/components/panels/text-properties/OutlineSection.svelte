<script lang="ts">
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { BookmarkPlus, Trash2, RefreshCw } from 'lucide-svelte';
  import {
    inferOutlineLevel,
    flattenOutlineTree,
    type OutlineItemFlat,
  } from '../../../services/pdf/operations/outline-tree';
  import type { OutlineNode } from '../../../core/types';

  interface Props {
    activeText?: string;
    fontSize?: number;
    isBold?: boolean;
    pageIndex?: number;
  }

  let {
    activeText = '',
    fontSize = 12,
    isBold = false,
    pageIndex = undefined,
  }: Props = $props();

  const store = useEditorStore();
  const actions = useEditorActions();

  let outlineTitle = $state('');
  let manualLevel = $state<number | null>(null);
  let isApplying = $state(false);
  let originalMatchedTitle = $state<string | null>(null);
  let lastActiveText = $state<string | null>(null);

  const targetPageIndex = $derived(
    pageIndex ?? store.currentPageIndex
  );

  // Dynamically compute the auto level from text and typography metrics
  const autoLevel = $derived.by(() => {
    return inferOutlineLevel({
      text: outlineTitle || activeText || '',
      fontSize: !isNaN(fontSize) && fontSize > 0 ? fontSize : 12,
      isBold,
    });
  });

  const effectiveLevel = $derived(
    manualLevel ?? autoLevel
  );

  // Retrieve current document outline reactively
  const currentOutline = $derived.by<OutlineNode[]>(() => {
    if (!store.isDocumentLoaded) return [];
    void store.renderVersion;
    try {
      return actions.service.document.getOutline();
    } catch {
      return [];
    }
  });

  const flatOutline = $derived<OutlineItemFlat[]>(
    flattenOutlineTree(currentOutline)
  );

  // Sync title and existing level whenever active text selection changes
  $effect(() => {
    const currentActive = (activeText || '').trim();
    if (currentActive && currentActive !== lastActiveText) {
      lastActiveText = currentActive;
      outlineTitle = currentActive;

      const match = flatOutline.find(
        (item) => item.title.trim() === currentActive && (item.pageIndex === null || item.pageIndex === targetPageIndex)
      );
      if (match) {
        originalMatchedTitle = match.title;
        manualLevel = match.level;
      } else {
        originalMatchedTitle = null;
        manualLevel = null;
      }
    }
  });

  // Check if an outline entry matching the active title or selection exists
  const existingItem = $derived<OutlineItemFlat | undefined>(
    flatOutline.find((item) => {
      if (originalMatchedTitle && item.title.trim() === originalMatchedTitle.trim() && (item.pageIndex === null || item.pageIndex === targetPageIndex)) {
        return true;
      }
      const titleMatch = item.title.trim() === outlineTitle.trim() || item.title.trim() === (activeText || '').trim();
      return titleMatch && (item.pageIndex === null || item.pageIndex === targetPageIndex);
    })
  );

  const isInOutline = $derived(Boolean(existingItem));

  async function handleAddToOutline(): Promise<void> {
    if (!outlineTitle.trim() || isApplying) return;
    isApplying = true;
    try {
      await actions.addTextToOutline({
        title: outlineTitle.trim(),
        pageIndex: targetPageIndex,
        level: effectiveLevel,
      });
      originalMatchedTitle = outlineTitle.trim();
    } finally {
      isApplying = false;
    }
  }

  async function handleUpdateOutline(): Promise<void> {
    if (!outlineTitle.trim() || isApplying || !existingItem) return;
    isApplying = true;
    try {
      await actions.addTextToOutline({
        title: outlineTitle.trim(),
        pageIndex: targetPageIndex,
        level: effectiveLevel,
        oldTitle: existingItem.title,
      });
      originalMatchedTitle = outlineTitle.trim();
    } finally {
      isApplying = false;
    }
  }

  async function handleRemoveFromOutline(): Promise<void> {
    if (isApplying || !existingItem) return;
    isApplying = true;
    try {
      await actions.removeOutlineItem(existingItem.title, targetPageIndex);
      originalMatchedTitle = null;
    } finally {
      isApplying = false;
    }
  }
</script>

<SidebarSection title="Document Outline" borderBottom={true} collapsible={true} defaultExpanded={true}>
  <div class="grid grid-cols-[1fr_auto] gap-x-1 gap-y-1">
    <!-- Outline Title with inline action icon buttons -->
    <div class="col-span-2">
      <Label for="outline-title-input" class="field-label">Outline Title</Label>
    </div>
    <div class="min-w-0">
      <Input
        id="outline-title-input"
        type="text"
        bind:value={outlineTitle}
        placeholder="Bookmark title..."
        class="h-8 text-xs w-full min-w-0"
      />
    </div>
    <ButtonGroup variant="ghost" size="sm" class="h-8 shrink-0">
      {#if isInOutline}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={isApplying || !outlineTitle.trim()}
          onclick={handleUpdateOutline}
          title="Update Heading"
          aria-label="Update Heading"
        >
          <RefreshCw class="h-3.5 w-3.5 {isApplying ? 'animate-spin' : ''}" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={isApplying}
          onclick={handleRemoveFromOutline}
          title="Remove from Outline"
          aria-label="Remove from Outline"
        >
          <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      {:else}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={isApplying || !outlineTitle.trim()}
          onclick={handleAddToOutline}
          title="Add to Document Outline"
          aria-label="Add to Document Outline"
        >
          {#if isApplying}
            <RefreshCw class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {:else}
            <BookmarkPlus class="h-3.5 w-3.5" aria-hidden="true" />
          {/if}
        </Button>
      {/if}
    </ButtonGroup>

    <!-- Hierarchy Level Selection -->
    <div class="col-span-2 mt-1">
      <Label class="field-label">Heading Level</Label>
    </div>
    <div class="min-w-0">
      <Select.Root
        type="single"
        value={String(effectiveLevel)}
        onValueChange={(val) => {
          if (!val) return;
          manualLevel = parseInt(val, 10);
        }}
      >
        <Select.Trigger class="h-8 text-xs w-full font-normal">
          Heading {effectiveLevel}
        </Select.Trigger>
        <Select.Content>
          {#each [1, 2, 3, 4, 5, 6] as lvl}
            <Select.Item value={String(lvl)} label={`Heading ${lvl}`}>
              Heading {lvl}
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div></div>
  </div>
</SidebarSection>
