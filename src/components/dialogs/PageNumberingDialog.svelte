<script lang="ts">
  import { untrack } from 'svelte';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useSelection } from '../../stores/selection.svelte';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { ControlRow } from '$lib/components/ui/control-row/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
  import {
    Hash,
    ListOrdered,
    Layers,
    RotateCcw,
    Check,
    Loader2,
    ChevronLeft,
    ChevronRight,
    Bold,
    Italic,
  } from 'lucide-svelte';
  import {
    getDefaultPageNumberingOptions,
    formatNumberingText,
    resolveTargetPageIndices,
    type NumberingMode,
    type NumberingPosition,
    type PageNumberFormat,
    type NumberingScope,
    type PageParityFilter,
    type PageNumberingOptions,
  } from '../../services/pdf/operations/page-numbering-ops';
  import { parsePageRangeStrict } from '../../utils/page-range';

  const store = useEditorStore();
  const actions = useEditorActions();
  const selection = useSelection();
  const featureFlags = useFeatureFlagStore();

  let activeMode = $state<NumberingMode>('page-numbers');
  let scope = $state<NumberingScope>('all');
  let customRange = $state('');
  let parity = $state<PageParityFilter>('all');
  let skipFirstPage = $state(false);
  let countSkippedPages = $state(false);

  let position = $state<NumberingPosition>('bottom-center');
  let marginHorizontalPts = $state(36);
  let marginVerticalPts = $state(28);

  let format = $state<PageNumberFormat>('page-x-of-y');
  let startNumber = $state(1);
  let customTemplate = $state('Page {page} of {total}');

  let batesPrefix = $state('BATES-');
  let batesSuffix = $state('');
  let batesDigits = $state(6);
  let batesStartNumber = $state(1);
  let batesIncrement = $state(1);
  let batesTemplate = $state('{bates}');

  let headerFooterTemplate = $state('{file} - Page {page} of {total}');

  let fontFamily = $state('Helvetica');
  let fontSize = $state(10);
  let fontWeight = $state<'normal' | 'bold'>('normal');
  let fontStyle = $state<'normal' | 'italic'>('normal');
  let color = $state('#000000');
  let opacity = $state(100);

  let previewPageIndex = $state(0);
  let isProcessing = $state(false);
  let errorMessage = $state<string | null>(null);

  const selectedPageIndices = $derived.by(() => {
    return Array.from(selection.selectedIds)
      .filter((id: string) => id.startsWith('page_'))
      .map((id: string) => parseInt(id.replace('page_', ''), 10));
  });

  const FORMAT_OPTIONS: ReadonlyArray<{ value: PageNumberFormat; label: string }> = [
    { value: 'number', label: '1, 2, 3 (Numeric)' },
    { value: 'page-x', label: 'Page 1, Page 2' },
    { value: 'page-x-of-y', label: 'Page 1 of N' },
    { value: 'x-slash-y', label: '1 / N' },
    { value: 'roman-lower', label: 'i, ii, iii (Roman Lower)' },
    { value: 'roman-upper', label: 'I, II, III (Roman Upper)' },
    { value: 'alpha-lower', label: 'a, b, c (Alpha Lower)' },
    { value: 'alpha-upper', label: 'A, B, C (Alpha Upper)' },
    { value: 'custom', label: 'Custom Template' },
  ];

  const FONT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'Helvetica', label: 'Helvetica / Inter (Sans)' },
    { value: 'Times-Roman', label: 'Times New Roman (Serif)' },
    { value: 'Courier', label: 'Courier (Monospace)' },
  ];

  const POSITION_GRID: ReadonlyArray<{ value: NumberingPosition; label: string }> = [
    { value: 'top-left', label: 'Top Left' },
    { value: 'top-center', label: 'Top Centre' },
    { value: 'top-right', label: 'Top Right' },
    { value: 'bottom-left', label: 'Bottom Left' },
    { value: 'bottom-center', label: 'Bottom Centre' },
    { value: 'bottom-right', label: 'Bottom Right' },
  ];

  const PAGE_TOKENS: ReadonlyArray<{ token: string; label: string }> = [
    { token: '{page}', label: '{page}' },
    { token: '{total}', label: '{total}' },
    { token: '{roman}', label: '{roman}' },
    { token: '{ROMAN}', label: '{ROMAN}' },
    { token: '{alpha}', label: '{alpha}' },
    { token: '{ALPHA}', label: '{ALPHA}' },
    { token: '{date}', label: '{date}' },
    { token: '{file}', label: '{file}' },
  ];

  const BATES_TOKENS: ReadonlyArray<{ token: string; label: string }> = [
    { token: '{bates}', label: '{bates}' },
    { token: '{page}', label: '{page}' },
    { token: '{total}', label: '{total}' },
    { token: '{date}', label: '{date}' },
    { token: '{file}', label: '{file}' },
  ];

  const currentOptions = $derived.by((): PageNumberingOptions => {
    return {
      mode: activeMode,
      scope,
      currentPageIndex: store.currentPageIndex,
      pageIndices:
        scope === 'current'
          ? [store.currentPageIndex]
          : scope === 'selected'
            ? selectedPageIndices
            : undefined,
      customRange: scope === 'custom' ? customRange : undefined,
      parity,
      skipFirstPage,
      countSkippedPages,
      position,
      marginX: marginHorizontalPts,
      marginY: marginVerticalPts,
      format,
      startPageNumber: Math.max(1, Math.trunc(Number(startNumber) || 1)),
      customTemplate,
      batesPrefix,
      batesSuffix,
      batesDigits: Math.max(1, Math.min(12, Math.trunc(Number(batesDigits) || 6))),
      batesStartNumber: Math.max(0, Math.trunc(Number(batesStartNumber) || 0)),
      batesIncrement: Math.max(1, Math.trunc(Number(batesIncrement) || 1)),
      batesTemplate,
      headerFooterText: headerFooterTemplate,
      fontFamily,
      fontSize,
      fontWeight,
      fontStyle,
      color,
      opacity,
    };
  });

  const targetPageResolution = $derived.by(() => {
    const totalPages = Math.max(1, store.pageCount);
    try {
      const indices = resolveTargetPageIndices(currentOptions, totalPages);
      return { indices, error: null };
    } catch (err) {
      return {
        indices: [] as number[],
        error: err instanceof Error ? err.message : 'Invalid page range specification',
      };
    }
  });

  const previewStampInfo = $derived.by(() => {
    const totalPages = Math.max(1, store.pageCount);
    const clampedPageIdx = Math.min(Math.max(0, previewPageIndex), totalPages - 1);
    const targetIndices = targetPageResolution.indices;
    const sequenceOrder = targetIndices.indexOf(clampedPageIdx);
    const isTargeted = sequenceOrder !== -1;

    if (!isTargeted) {
      return {
        isTargeted: false,
        text: '',
        pageIndex: clampedPageIdx,
      };
    }

    const effectiveSequenceIndex = countSkippedPages ? clampedPageIdx : sequenceOrder;
    const text = formatNumberingText(currentOptions, {
      pageIndex: clampedPageIdx,
      sequenceIndex: effectiveSequenceIndex,
      totalDocumentPages: totalPages,
      totalTargetPages: targetIndices.length,
      fileName: store.fileName || 'Document.pdf',
    });

    return {
      isTargeted: true,
      text,
      pageIndex: clampedPageIdx,
    };
  });

  const batesRangeSummary = $derived.by(() => {
    if (activeMode !== 'bates') return null;
    const count = targetPageResolution.indices.length;
    if (count === 0) return null;
    const firstLabel = formatNumberingText(currentOptions, {
      pageIndex: targetPageResolution.indices[0],
      sequenceIndex: 0,
      totalDocumentPages: Math.max(1, store.pageCount),
      totalTargetPages: count,
      fileName: store.fileName || 'Document.pdf',
    });
    const lastSeq = countSkippedPages
      ? targetPageResolution.indices[count - 1]
      : count - 1;
    const lastLabel = formatNumberingText(currentOptions, {
      pageIndex: targetPageResolution.indices[count - 1],
      sequenceIndex: lastSeq,
      totalDocumentPages: Math.max(1, store.pageCount),
      totalTargetPages: count,
      fileName: store.fileName || 'Document.pdf',
    });
    return { firstLabel, lastLabel, count };
  });

  function resetToDefaults(modeOverride?: NumberingMode): void {
    const targetMode = modeOverride ?? activeMode;
    const defaults = getDefaultPageNumberingOptions(targetMode);
    activeMode = defaults.mode;
    scope = selectedPageIndices.length > 1 ? 'selected' : 'all';
    customRange = `1-${Math.max(1, store.pageCount)}`;
    parity = defaults.parity;
    skipFirstPage = defaults.skipFirstPage;
    countSkippedPages = defaults.countSkippedPages;
    position = defaults.position;
    marginHorizontalPts = defaults.marginX;
    marginVerticalPts = defaults.marginY;
    format = defaults.format;
    startNumber = defaults.startPageNumber;
    customTemplate = defaults.customTemplate;
    batesPrefix = defaults.batesPrefix;
    batesSuffix = defaults.batesSuffix;
    batesDigits = defaults.batesDigits;
    batesStartNumber = defaults.batesStartNumber;
    batesIncrement = defaults.batesIncrement;
    batesTemplate = defaults.batesTemplate;
    headerFooterTemplate = defaults.headerFooterText;
    fontFamily = defaults.fontFamily;
    fontSize = defaults.fontSize;
    fontWeight = defaults.fontWeight;
    fontStyle = defaults.fontStyle;
    color = defaults.color;
    opacity = defaults.opacity;
    errorMessage = null;
  }

  function switchMode(nextMode: NumberingMode): void {
    activeMode = nextMode;
    if (nextMode === 'bates' && !position.startsWith('top-')) {
      position = 'top-right';
    } else if (nextMode === 'page-numbers' && position === 'top-right') {
      position = 'bottom-center';
    }
    errorMessage = null;
  }

  function appendToken(token: string): void {
    if (activeMode === 'page-numbers') {
      format = 'custom';
      customTemplate = `${customTemplate}${token}`;
    } else if (activeMode === 'bates') {
      batesTemplate = `${batesTemplate}${token}`;
    } else {
      headerFooterTemplate = `${headerFooterTemplate}${token}`;
    }
  }

  $effect(() => {
    if (store.showPageNumberingDialog) {
      untrack(() => {
        resetToDefaults(store.pageNumberingInitialMode);
        previewPageIndex = store.currentPageIndex;
      });
    }
  });

  function handleOpenChange(open: boolean): void {
    if (!open && !isProcessing) {
      actions.closePageNumberingDialog();
    }
  }

  function validateInputs(): boolean {
    errorMessage = null;
    if (scope === 'custom') {
      try {
        parsePageRangeStrict(customRange, store.pageCount);
      } catch (err) {
        errorMessage =
          err instanceof Error ? err.message : 'Invalid custom page range';
        return false;
      }
    }
    if (targetPageResolution.error) {
      errorMessage = targetPageResolution.error;
      return false;
    }
    if (targetPageResolution.indices.length === 0) {
      errorMessage = 'No target pages match the selected scope and filter criteria.';
      return false;
    }
    return true;
  }

  async function handleApply(): Promise<void> {
    if (!validateInputs()) return;
    isProcessing = true;
    errorMessage = null;
    try {
      await actions.applyPageNumbering(currentOptions);
      actions.closePageNumberingDialog();
    } catch (err) {
      errorMessage =
        err instanceof Error
          ? err.message
          : 'Failed to apply numbering to document.';
    } finally {
      isProcessing = false;
    }
  }

  function prevPreviewPage(): void {
    if (previewPageIndex > 0) {
      previewPageIndex -= 1;
    }
  }

  function nextPreviewPage(): void {
    if (previewPageIndex < Math.max(0, store.pageCount - 1)) {
      previewPageIndex += 1;
    }
  }
</script>

<Dialog.Root open={store.showPageNumberingDialog} onOpenChange={handleOpenChange}>
  <Dialog.Content class="sm:max-w-[740px] max-h-[90vh] flex flex-col overflow-hidden">
    <Dialog.Header class="pr-12">
      <Dialog.Title>
        {#if activeMode === 'bates'}
          <ListOrdered class="h-4 w-4 shrink-0" />
          Bates Numbering
        {:else if activeMode === 'header-footer'}
          <Layers class="h-4 w-4 shrink-0" />
          Header &amp; Footer Text
        {:else}
          <Hash class="h-4 w-4 shrink-0" />
          Page Numbering
        {/if}
      </Dialog.Title>
      <Dialog.Description>
        Stamp sequential page numbers, legal Bates identifiers, or running header and footer text directly onto document pages.
      </Dialog.Description>

      <!-- note: mode switcher tabs -->
      <ButtonGroup variant="outline" size="sm" class="w-full h-8 mt-2">
        {#if featureFlags.isEnabled('page-numbers.numbers')}
          <Button
            type="button"
            variant={activeMode === 'page-numbers' ? 'secondary' : 'outline'}
            size="sm"
            class="flex-1 h-8 text-xs gap-1.5"
            onclick={() => switchMode('page-numbers')}
            disabled={isProcessing}
          >
            <Hash class="h-3.5 w-3.5" />
            Page Numbers
          </Button>
        {/if}
        {#if featureFlags.isEnabled('page-numbers.bates')}
          <Button
            type="button"
            variant={activeMode === 'bates' ? 'secondary' : 'outline'}
            size="sm"
            class="flex-1 h-8 text-xs gap-1.5"
            onclick={() => switchMode('bates')}
            disabled={isProcessing}
          >
            <ListOrdered class="h-3.5 w-3.5" />
            Bates Numbering
          </Button>
        {/if}
        {#if featureFlags.isEnabled('page-numbers.header-footer')}
          <Button
            type="button"
            variant={activeMode === 'header-footer' ? 'secondary' : 'outline'}
            size="sm"
            class="flex-1 h-8 text-xs gap-1.5"
            onclick={() => switchMode('header-footer')}
            disabled={isProcessing}
          >
            <Layers class="h-3.5 w-3.5" />
            Header &amp; Footer
          </Button>
        {/if}
      </ButtonGroup>
    </Dialog.Header>

    <div class="dialog-body flex-1 overflow-y-auto">
      <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
        <!-- note: left configuration column -->
        <div class="md:col-span-7 space-y-4">
          {#if activeMode === 'page-numbers'}
            <!-- note: page numbering format settings -->
            <div class="dialog-section">
              <span class="dialog-section-title">Numbering Format</span>

              <div class="grid grid-cols-3 gap-2">
                <div class="col-span-2 field-group">
                  <Label class="field-label">Format Style</Label>
                  <Select.Root
                    type="single"
                    value={format}
                    onValueChange={(val) => {
                      if (val) format = val as PageNumberFormat;
                    }}
                  >
                    <Select.Trigger class="h-8 text-xs w-full">
                      {FORMAT_OPTIONS.find((opt) => opt.value === format)?.label ?? 'Page 1 of N'}
                    </Select.Trigger>
                    <Select.Content>
                      {#each FORMAT_OPTIONS as opt (opt.value)}
                        <Select.Item value={opt.value} label={opt.label}>
                          {opt.label}
                        </Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>

                <div class="field-group">
                  <Label for="page-num-start" class="field-label">Start Number</Label>
                  <Input
                    id="page-num-start"
                    type="number"
                    min={1}
                    max={999999}
                    bind:value={startNumber}
                    class="field-input"
                  />
                </div>
              </div>

              {#if format === 'custom'}
                <div class="field-group">
                  <Label for="page-num-custom-tpl" class="field-label">Custom Template</Label>
                  <Input
                    id="page-num-custom-tpl"
                    type="text"
                    bind:value={customTemplate}
                    placeholder="Page &#123;page&#125; of &#123;total&#125;"
                    class="field-input"
                  />
                  <div class="flex flex-wrap items-center gap-1 pt-1">
                    <span class="text-[11px] text-muted-foreground mr-1 whitespace-nowrap">Insert token:</span>
                    {#each PAGE_TOKENS as item (item.token)}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        class="h-8 px-2 text-xs"
                        onclick={() => appendToken(item.token)}
                      >
                        {item.label}
                      </Button>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {:else if activeMode === 'bates'}
            <!-- note: bates numbering sequence and affixes -->
            <div class="dialog-section">
              <span class="dialog-section-title">Bates Sequence &amp; Affixes</span>

              <div class="grid grid-cols-2 gap-2">
                <div class="field-group">
                  <Label for="bates-prefix" class="field-label">Prefix</Label>
                  <Input
                    id="bates-prefix"
                    type="text"
                    bind:value={batesPrefix}
                    placeholder="e.g. CASE-2026-"
                    class="field-input"
                  />
                </div>

                <div class="field-group">
                  <Label for="bates-suffix" class="field-label">Suffix</Label>
                  <Input
                    id="bates-suffix"
                    type="text"
                    bind:value={batesSuffix}
                    placeholder="e.g. -CONF"
                    class="field-input"
                  />
                </div>
              </div>

              <div class="grid grid-cols-3 gap-2">
                <div class="field-group">
                  <Label for="bates-start" class="field-label">Start Number</Label>
                  <Input
                    id="bates-start"
                    type="number"
                    min={0}
                    max={999999999}
                    bind:value={batesStartNumber}
                    class="field-input"
                  />
                </div>

