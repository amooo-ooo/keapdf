<script lang="ts">
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { BookmarkPlus, BookmarkCheck, Trash2, RefreshCw } from 'lucide-svelte';
  import {
    inferOutlineLevel,
    flattenOutlineTree,
    type OutlineItemFlat,
  } from '../../../services/pdf/operations/outline-ops';
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
  <div class="flex flex-col gap-2">
    <!-- Outline Title -->
    <div class="flex flex-col gap-1">
      <Label for="outline-title-input" class="field-label">Outline Title</Label>
      <Input
        id="outline-title-input"
        type="text"
        bind:value={outlineTitle}
        placeholder="Bookmark title..."
        class="h-8 text-xs w-full"
      />
    </div>

    <!-- Target Page Display -->
    <div class="flex items-center justify-between text-xs py-0.5">
      <span class="text-muted-foreground">Target Page</span>
      <span class="font-sans font-medium text-foreground">
        Page {targetPageIndex + 1}
      </span>
    </div>

    <!-- Hierarchy Level Selection -->
    <div class="flex flex-col gap-1 mt-0.5">
      <Label class="field-label">Heading Level</Label>

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

    <!-- Status & Action Buttons -->
    <div class="flex flex-col gap-1.5 pt-1">
      {#if isInOutline}
        <div class="flex items-center gap-1.5 text-xs text-primary font-medium py-1 px-2 rounded-md bg-primary/10">
          <BookmarkCheck class="h-3.5 w-3.5 shrink-0" />
          <span class="truncate">In Outline (Heading {existingItem?.level})</span>
        </div>

        <div class="flex items-center gap-1.5 w-full">
          <Button
            variant="outline"
            size="sm"
            class="flex-1 h-8 text-xs justify-start px-2.5 font-normal"
            disabled={isApplying || !outlineTitle.trim()}
            onclick={handleUpdateOutline}
          >
            {#if isApplying}
              <RefreshCw class="h-3.5 w-3.5 mr-1.5 animate-spin" /> Updating...
            {:else}
              <RefreshCw class="h-3.5 w-3.5 mr-1.5" /> Update Heading
            {/if}
          </Button>

          <Button
            variant="outline"
            size="sm"
            class="h-8 px-2.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
            disabled={isApplying}
            onclick={handleRemoveFromOutline}
            title="Remove from Outline"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </Button>
        </div>
      {:else}
        <Button
          variant="outline"
          size="sm"
          class="w-full h-8 text-xs font-medium justify-start px-2.5"
          disabled={isApplying || !outlineTitle.trim()}
          onclick={handleAddToOutline}
        >
          {#if isApplying}
            <RefreshCw class="h-3.5 w-3.5 mr-1.5 animate-spin" /> Adding...
          {:else}
            <BookmarkPlus class="h-3.5 w-3.5 mr-1.5" /> Add to Document Outline
          {/if}
        </Button>
      {/if}
    </div>
  </div>
</SidebarSection>
