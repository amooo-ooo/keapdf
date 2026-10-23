<script lang="ts">
  import type { ColorRgba, EditableTextSpan, TextLine, TextWord } from '../../../core/types';
  import type { TextElement, TextElementLine, TextSegment } from '../../../stores/canvas-types';
  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import { useFeatureFlagStore } from '../../../core/feature-flags';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import OutlineSection from './OutlineSection.svelte';
  import { extractBaseFontFamily } from '../../../services/pdf/font-charset-index';
  import { mapStandardFontName, cleanSubsetPrefix, isBoldFontName, isItalicFontName } from '../../../core/pdfium-helpers';
  import { resolveCommercialFontAlias } from '../../../services/font-aliases';
  import { getDisplayFontName } from '../../../services/font-loader';
  import { sanitizePdfText } from '../../../services/pdf/utils';
  import {
    TEXT_STYLE_PRESETS,
    getPresetStyleProfile,
    detectMatchingTextPreset,
    type TextStylePresetId,
  } from '../../../services/pdf/operations/document-typography';
  import {
    getActiveEditorSelection,
    applyStyleToCanvasElement,
    applyStyleToPdfLines,
    getWordAtCharOffset,
    getSegmentAtCharOffset,
    getSegmentAtCharOffsetFromLines,
    setSelectionCharOffsets,
    setInspectorInteracting,
    findBestMatchingOrigLine,
    resolveInlineKeyAction,
  } from '../../../utils/text-range-utils';
  import { 
    AlignLeft,
    AlignCenter,
    AlignRight,
    AlignVerticalSpaceAround,
    AlignVerticalJustifyCenter,
    AlignVerticalSpaceBetween,
    Bold,
    Italic,
    Underline,
    Strikethrough
  } from 'lucide-svelte';

  interface Props {
    element?: TextElement | null;
  }

  let { element = null }: Props = $props();

  const store = useEditorStore();
  const actions = useEditorActions();
  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();
  const featureFlags = useFeatureFlagStore();
  void setInspectorInteracting;

  const isCanvasMode = $derived(Boolean(element || (canvasStore.selectedElement?.kind === 'text')));
  const activeCanvasElement = $derived(
    element || (canvasStore.selectedElement?.kind === 'text' ? (canvasStore.selectedElement as TextElement) : null)
  );
  const activePdfSpan = $derived(
    !isCanvasMode && store.selectedSpan?.type === 'text' ? (store.selectedSpan as EditableTextSpan) : null
  );

  let editText = $state('');
  let editFontSize = $state(12);
  let editFontFamily = $state('Helvetica');
  let editFontWeight = $state<'normal' | 'bold'>('normal');
  let editFontStyle = $state<'normal' | 'italic'>('normal');
  let editUnderline = $state(false);
  let editStrikethrough = $state(false);
  let editColorHex = $state('#000000');
  let editBackgroundColor = $state('');
  let editLineHeight = $state('');
  let editLetterSpacing = $state('');
  let editTextAlign = $state<'left' | 'center' | 'right'>('left');
  let editVerticalAlign = $state<'top' | 'middle' | 'bottom'>('top');
  let hasMixedFontSize = $state(false);

  const HIGHLIGHT_SWATCHES = [
    { label: 'Yellow', color: 'rgba(254, 240, 138, 0.6)', border: 'border-yellow-400', bg: 'bg-yellow-200/80' },
    { label: 'Green', color: 'rgba(187, 247, 208, 0.6)', border: 'border-green-400', bg: 'bg-green-200/80' },
    { label: 'Sky', color: 'rgba(186, 230, 253, 0.6)', border: 'border-sky-400', bg: 'bg-sky-200/80' },
    { label: 'Pink', color: 'rgba(251, 207, 232, 0.6)', border: 'border-pink-400', bg: 'bg-pink-200/80' },
  ];

  const STANDARD_FONTS = [
    { value: 'Helvetica', label: 'Inter (Sans-Serif)' },
    { value: 'Times-Roman', label: 'Times Roman (Serif)' },
    { value: 'Courier', label: 'Courier (Monospace)' },
    { value: 'Arial', label: 'Arial' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Roboto', label: 'Roboto' },
  ];

  function isInterHelveticaEquivalent(fontA: string, fontB: string): boolean {
    const normA = fontA.trim().toLowerCase();
    const normB = fontB.trim().toLowerCase();
    return (
      (normA === 'inter' && (normB === 'helvetica' || normB === 'inter (sans-serif)')) ||
      ((normA === 'helvetica' || normA === 'inter (sans-serif)') && normB === 'inter') ||
      (normA === 'helvetica' && normB === 'helvetica') ||
      (normA === 'inter' && normB === 'inter')
    );
  }

  function normalizeStandardBaseFamily(name: string): string {
    const cleaned = cleanSubsetPrefix(name);
    const trimmed = cleaned.trim();
    const lower = trimmed.toLowerCase();
    if (lower === 'helvetica-bold' || lower === 'helvetica-oblique' || lower === 'helvetica-boldoblique' || lower === 'helvetica') {
      return 'Helvetica';
    }
    if (lower === 'inter' || lower.startsWith('inter-')) {
      return 'Inter';
    }
    if (
      lower === 'times-roman' ||
      lower === 'times-bold' ||
      lower === 'times-italic' ||
      lower === 'times-bolditalic' ||
      lower === 'times' ||
      lower === 'times new roman' ||
      lower === 'timesnewroman' ||
      lower.startsWith('timesnewroman') ||
      lower.startsWith('times-roman')
    ) {
      return 'Times-Roman';
    }
    if (lower === 'courier' || lower === 'courier-bold' || lower === 'courier-oblique' || lower === 'courier-boldoblique' || lower === 'couriernew' || lower.startsWith('courier')) {
      return 'Courier';
    }
    if (lower === 'arial' || lower === 'arialmt' || lower.startsWith('arial-') || lower.startsWith('arialmt')) {
      return 'Arial';
    }
    if (lower === 'georgia' || lower.startsWith('georgia-')) {
      return 'Georgia';
    }
    if (lower === 'roboto' || lower.startsWith('roboto-')) {
      return 'Roboto';
    }
    const alias = resolveCommercialFontAlias(cleaned);
    if (alias) {
      return alias.canonicalName;
    }
    return trimmed;
  }

  function resolveInspectorFontFamily(fontFamily?: string, rawFontFamily?: string): string {
    const primary = fontFamily ? normalizeStandardBaseFamily(fontFamily) : '';
    if (primary && (!rawFontFamily || primary.toLowerCase() === normalizeStandardBaseFamily(rawFontFamily).toLowerCase() || primary !== 'Helvetica')) {
      return primary;
    }
    if (rawFontFamily) {
      const rawNorm = normalizeStandardBaseFamily(mapStandardFontName(rawFontFamily));
      if (rawNorm && rawNorm !== 'Helvetica') {
        return rawNorm;
      }
    }
    return primary || (rawFontFamily ? normalizeStandardBaseFamily(rawFontFamily) : 'Helvetica');
  }

  interface FontSelectItem {
    value: string;
    label: string;
    isDocumentFont: boolean;
    isLastDocumentFont?: boolean;
  }

  const fontSelectItems = $derived.by((): FontSelectItem[] => {
    const documentFonts: FontSelectItem[] = [];
    const otherFonts: FontSelectItem[] = [];

    // Collect native fonts discovered within the loaded document charset
    const docFonts = actions.getRelativelyCompleteDocumentFonts();
    for (const df of docFonts) {
      const normVal = resolveInspectorFontFamily(df.family);
      const displayLabel = `${df.displayName} (Document)`;
      const alreadyPresent = documentFonts.some(
        (it) => it.value.toLowerCase() === normVal.toLowerCase() || it.label.toLowerCase() === displayLabel.toLowerCase()
      );
      if (!alreadyPresent) {
        documentFonts.push({
          value: normVal,
          label: displayLabel,
          isDocumentFont: true,
        });
      }
    }

    // Inspect active selection font metadata and completeness
    const currentRaw = activePdfSpan?.rawFontFamily || activeCanvasElement?.rawFontFamily;
    const currentBase = activePdfSpan?.fontFamily || activeCanvasElement?.fontFamily;

    if (currentRaw || currentBase) {
      const targetRaw = currentRaw || currentBase || '';
      const unmaskedFamily = extractBaseFontFamily(targetRaw);
      const isComplete = actions.isFontRelativelyComplete(targetRaw);

      if (isComplete && unmaskedFamily) {
        const normVal = resolveInspectorFontFamily(unmaskedFamily, targetRaw);
        const displayName = getDisplayFontName(unmaskedFamily, extractBaseFontFamily);
        const displayLabel = `${displayName} (Document)`;
        const alreadyPresent = documentFonts.some(
          (it) => it.value.toLowerCase() === normVal.toLowerCase() || it.label.toLowerCase() === displayLabel.toLowerCase()
        );
        if (!alreadyPresent) {
          documentFonts.push({
            value: normVal,
            label: displayLabel,
            isDocumentFont: true,
          });
        }
      }
    }

    // Populate standard and custom font choices excluding already listed document fonts
    for (const std of STANDARD_FONTS) {
      const stdNorm = normalizeStandardBaseFamily(std.value).toLowerCase();
      const stdDisplay = getDisplayFontName(std.value, extractBaseFontFamily).toLowerCase();
      const existsInDocumentFonts = documentFonts.some((it) => {
        const itNorm = normalizeStandardBaseFamily(it.value).toLowerCase();
        const itDisplay = it.label.replace(/\s+\(Document\)$/i, '').toLowerCase();
        return (
          it.value.toLowerCase() === std.value.toLowerCase() ||
          itNorm === stdNorm ||
          itDisplay === stdDisplay ||
          isInterHelveticaEquivalent(itDisplay, stdDisplay) ||
          isInterHelveticaEquivalent(itDisplay, std.value) ||
          isInterHelveticaEquivalent(itNorm, stdNorm)
        );
      });

      if (!existsInDocumentFonts) {
        otherFonts.push({
          value: std.value,
          label: std.label,
          isDocumentFont: false,
        });
      }
    }

    // Ensure the active edited font family is represented
    if (editFontFamily) {
      const editNorm = normalizeStandardBaseFamily(editFontFamily).toLowerCase();
      const editDisplay = getDisplayFontName(editFontFamily, extractBaseFontFamily).toLowerCase();

      const existsInDoc = documentFonts.some((it) => {
        const itNorm = normalizeStandardBaseFamily(it.value).toLowerCase();
        const itDisplay = it.label.replace(/\s+\(Document\)$/i, '').toLowerCase();
        return (
          it.value.toLowerCase() === editFontFamily.toLowerCase() ||
          itNorm === editNorm ||
          itDisplay === editDisplay ||
          isInterHelveticaEquivalent(itDisplay, editDisplay) ||
          isInterHelveticaEquivalent(itNorm, editNorm)
        );
      });

      const existsInOther = otherFonts.some((it) => {
        const itNorm = normalizeStandardBaseFamily(it.value).toLowerCase();
        const itDisplay = it.label.replace(/\s+\([^)]+\)$/i, '').toLowerCase();
        return (
          it.value.toLowerCase() === editFontFamily.toLowerCase() ||
          itNorm === editNorm ||
          itDisplay === editDisplay ||
          isInterHelveticaEquivalent(itDisplay, editDisplay) ||
          isInterHelveticaEquivalent(itNorm, editNorm)
        );
      });

      if (!existsInDoc && !existsInOther) {
        if (activePdfSpan || activeCanvasElement?.originalSpan) {
          documentFonts.unshift({
            value: editFontFamily,
            label: `${getDisplayFontName(editFontFamily, extractBaseFontFamily)} (Document)`,
            isDocumentFont: true,
          });
        } else {
          otherFonts.unshift({
            value: editFontFamily,
            label: getDisplayFontName(editFontFamily, extractBaseFontFamily),
            isDocumentFont: false,
          });
        }
      }
    }

    // Flag the final document loaded font to receive a bottom border separator
    if (documentFonts.length > 0 && otherFonts.length > 0) {
      documentFonts[documentFonts.length - 1].isLastDocumentFont = true;
    }

    return [...documentFonts, ...otherFonts];
  });

  const selectedFontValue = $derived.by((): string => {
    if (!editFontFamily) return 'Helvetica';
    const directMatch = fontSelectItems.find((it) => it.value === editFontFamily);
    if (directMatch) return directMatch.value;
    const caseMatch = fontSelectItems.find((it) => it.value.toLowerCase() === editFontFamily.toLowerCase());
    if (caseMatch) return caseMatch.value;
    const normMatch = fontSelectItems.find(
      (it) => normalizeStandardBaseFamily(it.value).toLowerCase() === normalizeStandardBaseFamily(editFontFamily).toLowerCase()
    );
    if (normMatch) return normMatch.value;
    const equivMatch = fontSelectItems.find((it) => isInterHelveticaEquivalent(it.value, editFontFamily));
    if (equivMatch) return equivMatch.value;
    return editFontFamily;
  });

  $effect(() => {
    if (activeCanvasElement) {
      editText = activeCanvasElement.text ?? '';
      
      const distinctSizes = getDistinctCanvasSizes(activeCanvasElement);
      hasMixedFontSize = distinctSizes.length > 1;
      editFontSize = hasMixedFontSize ? NaN : Math.round((activeCanvasElement.fontSize || 12) * 10) / 10;

      editFontFamily = resolveInspectorFontFamily(activeCanvasElement.fontFamily, activeCanvasElement.rawFontFamily);
      editFontWeight = activeCanvasElement.fontWeight || 'normal';
      editFontStyle = activeCanvasElement.fontStyle || 'normal';
      editUnderline = Boolean(activeCanvasElement.underline);
      editStrikethrough = Boolean(activeCanvasElement.strikethrough);
      editColorHex = activeCanvasElement.color ? normalizeColorToHex(activeCanvasElement.color) : '#000000';
      editBackgroundColor = activeCanvasElement.backgroundColor || '';
      editLineHeight = activeCanvasElement.lineHeight ? `${Math.round(activeCanvasElement.lineHeight * 10) / 10}` : '';
      editLetterSpacing = activeCanvasElement.letterSpacing || '';
      editTextAlign = activeCanvasElement.textAlign || 'left';
      return;
    }

    if (activePdfSpan) {
      editText = activePdfSpan.text ?? '';

      const lines = activePdfSpan.lines;
      if (lines && lines.length > 1) {
        const sizes = new Set(lines.map((l) => Math.round((l.fontSize || activePdfSpan.fontSize) * 10) / 10));
        hasMixedFontSize = sizes.size > 1;
        editFontSize = hasMixedFontSize ? NaN : Math.round(activePdfSpan.fontSize * 10) / 10;
      } else {
        hasMixedFontSize = false;
        editFontSize = Math.round(activePdfSpan.fontSize * 10) / 10;
      }

      editFontFamily = resolveInspectorFontFamily(activePdfSpan.fontFamily, activePdfSpan.rawFontFamily);
      editLineHeight = activePdfSpan.lineHeight ? `${Math.round(activePdfSpan.lineHeight * 10) / 10}` : '';
      editLetterSpacing = activePdfSpan.letterSpacing || '';
      
      editFontWeight = activePdfSpan.fontWeight
        ? activePdfSpan.fontWeight === 'bold'
          ? 'bold'
          : 'normal'
        : isBoldFontName(activePdfSpan.rawFontFamily || activePdfSpan.fontFamily)
          ? 'bold'
          : 'normal';
      editFontStyle = activePdfSpan.fontStyle
        ? activePdfSpan.fontStyle === 'italic'
          ? 'italic'
          : 'normal'
        : isItalicFontName(activePdfSpan.rawFontFamily || activePdfSpan.fontFamily)
          ? 'italic'
          : 'normal';
      editUnderline = Boolean(activePdfSpan.underline);
      editStrikethrough = Boolean(activePdfSpan.strikethrough);
      editBackgroundColor = activePdfSpan.backgroundColor || '';
      editTextAlign = activePdfSpan.textAlign || 'left';

      const r = activePdfSpan.color.r.toString(16).padStart(2, '0');
      const g = activePdfSpan.color.g.toString(16).padStart(2, '0');
      const b = activePdfSpan.color.b.toString(16).padStart(2, '0');
      editColorHex = `#${r}${g}${b}`;
    }
  });

  function getDistinctCanvasSizes(textEl: TextElement): number[] {
    const sizes: number[] = [];
    if (textEl.fontSize) sizes.push(Math.round(textEl.fontSize * 10) / 10);
    if (textEl.lines) {
      for (const line of textEl.lines) {
        if (line.fontSize) sizes.push(Math.round(line.fontSize * 10) / 10);
        if (line.segments) {
          for (const seg of line.segments) {
            if (seg.fontSize) sizes.push(Math.round(seg.fontSize * 10) / 10);
          }
        }
      }
    }
    if (textEl.segments) {
      for (const seg of textEl.segments) {
        if (seg.fontSize) sizes.push(Math.round(seg.fontSize * 10) / 10);
      }
    }
    return Array.from(new Set(sizes));
  }

  function normalizeColorToHex(color: string): string {
    if (color.startsWith('#')) return color;
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgbaMatch) {
      const r = parseInt(rgbaMatch[1], 10).toString(16).padStart(2, '0');
      const g = parseInt(rgbaMatch[2], 10).toString(16).padStart(2, '0');
      const b = parseInt(rgbaMatch[3], 10).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
    return '#000000';
  }

  function hexToRgba(hex: string): ColorRgba {
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
    const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
    const b = parseInt(cleanHex.substring(4, 6), 16) || 0;
    return { r, g, b, a: 255 };
  }

  function syncInspectorFromActiveSelection(): void {
    const sel = getActiveEditorSelection();
    if (!sel) return;

    if (isCanvasMode && activeCanvasElement && sel.mode === 'canvas' && sel.targetId === activeCanvasElement.id) {
      let seg: TextSegment | null = null;
      if (activeCanvasElement.lines && activeCanvasElement.lines.length > 0) {
        seg = getSegmentAtCharOffsetFromLines(activeCanvasElement.lines, sel.start);
      }
      if (!seg) {
        const segments = activeCanvasElement.segments && activeCanvasElement.segments.length > 0
          ? activeCanvasElement.segments
          : (activeCanvasElement.lines ? activeCanvasElement.lines.flatMap((l) => l.segments || []) : []);
        seg = getSegmentAtCharOffset(segments, sel.start);
      }
      if (seg) {
        editFontWeight = seg.fontWeight || activeCanvasElement.fontWeight || 'normal';
        editFontStyle = seg.fontStyle || activeCanvasElement.fontStyle || 'normal';
        editUnderline = Boolean(seg.underline ?? activeCanvasElement.underline);
        editStrikethrough = Boolean(seg.strikethrough ?? activeCanvasElement.strikethrough);
        if (seg.color) {
          editColorHex = normalizeColorToHex(seg.color);
        }
        if (seg.backgroundColor !== undefined) {
          editBackgroundColor = seg.backgroundColor;
        } else {
          editBackgroundColor = activeCanvasElement.backgroundColor || '';
        }
        if (seg.fontSize) {
          editFontSize = Math.round(seg.fontSize * 10) / 10;
        }
        if (seg.fontFamily || seg.rawFontFamily) {
          editFontFamily = resolveInspectorFontFamily(seg.fontFamily, seg.rawFontFamily);
        }
        if (seg.letterSpacing !== undefined) {
          editLetterSpacing = seg.letterSpacing;
        } else {
          editLetterSpacing = activeCanvasElement.letterSpacing || '';
        }
      }
      return;
    }

    if (activePdfSpan && store.inlineEdit && store.inlineEdit.spanId === activePdfSpan.id && sel.mode === 'pdf' && sel.targetId === activePdfSpan.id) {
      const lines = store.inlineEdit.styledLines || activePdfSpan.lines || [];
      const word = getWordAtCharOffset(lines, sel.start);
      if (word) {
        editFontWeight = word.fontWeight
          ? word.fontWeight === 'bold'
            ? 'bold'
            : 'normal'
          : isBoldFontName(word.rawFontFamily || word.fontFamily)
            ? 'bold'
            : 'normal';
        editFontStyle = word.fontStyle
          ? word.fontStyle === 'italic'
            ? 'italic'
            : 'normal'
          : isItalicFontName(word.rawFontFamily || word.fontFamily)
            ? 'italic'
            : 'normal';
        editUnderline = Boolean(word.underline ?? activePdfSpan.underline);
        editStrikethrough = Boolean(word.strikethrough ?? activePdfSpan.strikethrough);
        if (word.color) {
          const r = word.color.r.toString(16).padStart(2, '0');
          const g = word.color.g.toString(16).padStart(2, '0');
          const b = word.color.b.toString(16).padStart(2, '0');
          editColorHex = `#${r}${g}${b}`;
        }
        if (word.backgroundColor !== undefined) {
          editBackgroundColor = word.backgroundColor;
        } else {
          editBackgroundColor = activePdfSpan.backgroundColor || '';
        }
        if (word.fontSize) {
          editFontSize = Math.round(word.fontSize * 10) / 10;
        }
        if (word.fontFamily || word.rawFontFamily) {
          editFontFamily = resolveInspectorFontFamily(word.fontFamily, word.rawFontFamily);
        }
        if (word.letterSpacing !== undefined) {
          editLetterSpacing = word.letterSpacing;
        } else {
          editLetterSpacing = activePdfSpan.letterSpacing || '';
        }
      }
    }
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    const onSelectionChange = () => {
      syncInspectorFromActiveSelection();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  });

  function applyChanges(partialStyle?: Partial<TextSegment>): void {
    const multiModifyEnabled =
      featureFlags.isEnabled('select-tool.multiselect') &&
      featureFlags.isEnabled('select-tool.multiselect.modify');
    if (activeCanvasElement) {
      applyCanvasChanges(partialStyle);
      if (multiModifyEnabled && !canvasStore.editingElementId && !store.inlineEdit && store.selectedSpans.length > 0) {
        applyMultiPdfSpanStyleChanges(partialStyle);
      }
      return;
    }
    if (activePdfSpan) {
      applyPdfChanges(partialStyle);
      if (multiModifyEnabled && !store.inlineEdit && store.selectedSpans.length > 1) {
        applyMultiPdfSpanStyleChanges(partialStyle, activePdfSpan.id);
      }
    }
  }

  function buildOtherCanvasTextStyleUpdates(targetEl: TextElement, partialStyle?: Partial<TextSegment>): Partial<TextElement> {
    const targetBg = partialStyle && 'backgroundColor' in partialStyle
      ? (partialStyle as Partial<TextSegment>).backgroundColor
      : (editBackgroundColor || undefined);
    const parsedLineHeight = parseFloat(editLineHeight);
    const hasExplicitLineHeight = !isNaN(parsedLineHeight) && parsedLineHeight > 0;
    const validFontSize = !isNaN(editFontSize) && editFontSize > 0 ? editFontSize : undefined;

    const otherUpdates: Partial<TextElement> = partialStyle ? {
      ...partialStyle,
      textAlign: editTextAlign,
      letterSpacing: editLetterSpacing || undefined,
    } : {
      fontFamily: editFontFamily,
      rawFontFamily: editFontFamily,
      fontWeight: editFontWeight,
      fontStyle: editFontStyle,
      underline: editUnderline,
      strikethrough: editStrikethrough,
      color: editColorHex,
      backgroundColor: targetBg,
      textAlign: editTextAlign,
      letterSpacing: editLetterSpacing || undefined,
    };

    if (hasExplicitLineHeight) {
      otherUpdates.lineHeight = parsedLineHeight;
    }

    if (validFontSize !== undefined && (!partialStyle || 'fontSize' in partialStyle)) {
      otherUpdates.fontSize = validFontSize;
    }

    const fontFamilyOverride = partialStyle?.fontFamily
      ? { fontFamily: partialStyle.fontFamily, rawFontFamily: partialStyle.fontFamily }
      : (!partialStyle ? { fontFamily: editFontFamily, rawFontFamily: editFontFamily } : {});

    if (targetEl.segments && targetEl.segments.length > 0) {
      otherUpdates.segments = targetEl.segments.map((s) => ({
        ...s,
        ...(partialStyle ?? {
          fontWeight: editFontWeight,
          fontStyle: editFontStyle,
          underline: editUnderline,
          strikethrough: editStrikethrough,
          color: editColorHex,
          backgroundColor: targetBg,
          letterSpacing: editLetterSpacing || undefined,
        }),
        ...(otherUpdates.fontSize !== undefined ? { fontSize: otherUpdates.fontSize } : {}),
        ...fontFamilyOverride,
      }));
    }

    if (targetEl.lines && targetEl.lines.length > 0) {
      const oldSize = targetEl.fontSize || otherUpdates.fontSize || 12;
      const scale = otherUpdates.fontSize !== undefined && oldSize > 0 ? otherUpdates.fontSize / oldSize : 1;
      otherUpdates.lines = targetEl.lines.map((l) => ({
        ...l,
        ...(otherUpdates.fontSize !== undefined ? { fontSize: otherUpdates.fontSize } : {}),
        ...(hasExplicitLineHeight ? { lineHeight: parsedLineHeight } : (otherUpdates.fontSize !== undefined && l.lineHeight ? { lineHeight: l.lineHeight * scale } : {})),
        ...(partialStyle?.underline !== undefined ? { underline: partialStyle.underline } : (!partialStyle ? { underline: editUnderline } : {})),
        ...(partialStyle?.strikethrough !== undefined ? { strikethrough: partialStyle.strikethrough } : (!partialStyle ? { strikethrough: editStrikethrough } : {})),
        ...(partialStyle?.letterSpacing !== undefined ? { letterSpacing: partialStyle.letterSpacing } : (!partialStyle ? { letterSpacing: editLetterSpacing || undefined } : {})),
        segments: (l.segments ?? []).map((s) => ({
          ...s,
          ...(partialStyle ?? {
            fontWeight: editFontWeight,
            fontStyle: editFontStyle,
            underline: editUnderline,
            strikethrough: editStrikethrough,
            color: editColorHex,
            backgroundColor: targetBg,
            letterSpacing: editLetterSpacing || undefined,
          }),
          ...(otherUpdates.fontSize !== undefined ? { fontSize: otherUpdates.fontSize } : {}),
          ...fontFamilyOverride,
        })),
      }));
    }

    return otherUpdates;
  }

  function applyMultiPdfSpanStyleChanges(partialStyle?: Partial<TextSegment>, excludeSpanId?: string): void {
    const targetSpans = store.selectedSpans.filter(
      (s): s is EditableTextSpan => s.type === 'text' && s.id !== excludeSpanId && !store.hiddenSpanIds.has(s.id)
    );
    if (targetSpans.length === 0) return;

    const targetBg = partialStyle && 'backgroundColor' in partialStyle
      ? (partialStyle as Partial<TextSegment>).backgroundColor
      : (editBackgroundColor || undefined);
    const parsedLineHeight = parseFloat(editLineHeight);
    const hasExplicitLineHeight = !isNaN(parsedLineHeight) && parsedLineHeight > 0;
    const validFontSize = !isNaN(editFontSize) && editFontSize > 0 ? editFontSize : undefined;

    for (const span of targetSpans) {
      const spanLines = span.lines?.map((origLine) => {
        const lineFs = partialStyle?.fontSize ?? (validFontSize ?? origLine.fontSize ?? span.fontSize);
        const lineLh = hasExplicitLineHeight && !partialStyle
          ? parsedLineHeight
          : (origLine.lineHeight ?? span.lineHeight ?? (lineFs * 1.25));
        const words = (origLine.words ?? []).map((w) => ({
          ...w,
          fontFamily: partialStyle?.fontFamily ?? (editFontFamily || w.fontFamily),
          rawFontFamily: partialStyle?.fontFamily ?? (editFontFamily || w.rawFontFamily),
          matchedFontFamily: partialStyle?.fontFamily ?? (editFontFamily || w.matchedFontFamily),
          fontWeight: partialStyle?.fontWeight ?? (!partialStyle ? editFontWeight : w.fontWeight),
          fontStyle: partialStyle?.fontStyle ?? (!partialStyle ? editFontStyle : w.fontStyle),
          color: partialStyle?.color !== undefined
            ? (typeof partialStyle.color === 'string' ? hexToRgba(partialStyle.color) : (partialStyle.color as unknown as ColorRgba))
            : (!partialStyle ? hexToRgba(editColorHex) : w.color),
          fontSize: partialStyle?.fontSize ?? (validFontSize !== undefined && (!partialStyle || 'fontSize' in partialStyle) ? validFontSize : w.fontSize),
          underline: partialStyle ? ('underline' in partialStyle ? partialStyle.underline : w.underline) : editUnderline,
          strikethrough: partialStyle ? ('strikethrough' in partialStyle ? partialStyle.strikethrough : w.strikethrough) : editStrikethrough,
          backgroundColor: partialStyle ? ('backgroundColor' in partialStyle ? partialStyle.backgroundColor : w.backgroundColor) : targetBg,
          letterSpacing: partialStyle ? ('letterSpacing' in partialStyle ? partialStyle.letterSpacing : w.letterSpacing) : (editLetterSpacing || w.letterSpacing),
        }));
        return {
          ...origLine,
          fontSize: lineFs,
          lineHeight: lineLh,
          fontFamily: partialStyle?.fontFamily ?? (editFontFamily || origLine.fontFamily),
          rawFontFamily: partialStyle?.fontFamily ?? (editFontFamily || origLine.rawFontFamily),
          matchedFontFamily: partialStyle?.fontFamily ?? (editFontFamily || origLine.matchedFontFamily),
          fontWeight: partialStyle?.fontWeight ?? (!partialStyle ? editFontWeight : origLine.fontWeight),
          fontStyle: partialStyle?.fontStyle ?? (!partialStyle ? editFontStyle : origLine.fontStyle),
          color: partialStyle?.color !== undefined
            ? (typeof partialStyle.color === 'string' ? hexToRgba(partialStyle.color) : (partialStyle.color as unknown as ColorRgba))
            : (!partialStyle ? hexToRgba(editColorHex) : origLine.color),
          words,
        };
      });

      actions.applyTextMutation(
        {
          text: span.text,
          fontSize: partialStyle ? (partialStyle.fontSize ?? span.fontSize) : (validFontSize ?? span.fontSize),
          fontFamily: partialStyle ? (partialStyle.fontFamily ?? span.fontFamily) : editFontFamily,
          rawFontFamily: partialStyle ? (partialStyle.fontFamily ?? span.rawFontFamily) : editFontFamily,
          fontWeight: partialStyle ? (partialStyle.fontWeight ?? span.fontWeight) : editFontWeight,
          fontStyle: partialStyle ? (partialStyle.fontStyle ?? span.fontStyle) : editFontStyle,
          underline: partialStyle ? ('underline' in partialStyle ? partialStyle.underline : span.underline) : editUnderline,
          strikethrough: partialStyle ? ('strikethrough' in partialStyle ? partialStyle.strikethrough : span.strikethrough) : editStrikethrough,
          backgroundColor: targetBg,
          textAlign: (partialStyle as { textAlign?: 'left' | 'center' | 'right' })?.textAlign ?? editTextAlign,
          letterSpacing: editLetterSpacing || undefined,
          wordSpacing: span.wordSpacing,
          scaleX: span.scaleX,
          color: partialStyle?.color !== undefined
            ? (typeof partialStyle.color === 'string' ? hexToRgba(partialStyle.color) : (partialStyle.color as unknown as ColorRgba))
            : (partialStyle ? span.color : hexToRgba(editColorHex)),
          lineHeight: hasExplicitLineHeight ? parsedLineHeight : undefined,
          lines: spanLines,
          reflowParagraph: Boolean(span.isParagraph || (span.lines && span.lines.length > 1)),
        },
        span,
      );
    }
  }

  function applyCanvasChanges(partialStyle?: Partial<TextSegment>): void {
    if (!activeCanvasElement) return;
    const id = activeCanvasElement.id;
    const sel = getActiveEditorSelection();
    const isEditing = canvasStore.editingElementId === id;
    const isAlignOnly = Boolean(partialStyle && Object.keys(partialStyle).length === 1 && 'textAlign' in partialStyle);
    const multiModifyEnabled =
      featureFlags.isEnabled('select-tool.multiselect') &&
      featureFlags.isEnabled('select-tool.multiselect.modify');

    if (isAlignOnly) {
      if (multiModifyEnabled && !isEditing && canvasStore.selectedElementIds.length > 1) {
        canvasActions.updateSelectedElementsProperties({ textAlign: editTextAlign }, { kind: 'text' });
      } else {
        canvasActions.updateElementProperties(id, {
          textAlign: editTextAlign,
        });
      }
      if (isEditing && sel?.container) {
        const c = sel.container;
        const s = sel.start;
        const e = sel.end;
        queueMicrotask(() => {
          c.focus();
          setSelectionCharOffsets(c, s, e);
        });
      }
      return;
    }

    if (isEditing && sel && sel.mode === 'canvas' && sel.targetId === id && sel.start < sel.end) {
      const styleToApply: Partial<TextSegment> & { lineHeight?: number } = partialStyle ? { ...partialStyle } : {
        fontFamily: editFontFamily,
        fontWeight: editFontWeight,
        fontStyle: editFontStyle,
        underline: editUnderline,
        strikethrough: editStrikethrough,
        color: editColorHex,
        backgroundColor: editBackgroundColor || undefined,
        letterSpacing: editLetterSpacing || undefined,
      };
      if (!partialStyle && !isNaN(editFontSize) && editFontSize > 0) {
        styleToApply.fontSize = editFontSize;
      }
      const parsedSelLh = parseFloat(editLineHeight);
      if (!partialStyle && !isNaN(parsedSelLh) && parsedSelLh > 0) {
        styleToApply.lineHeight = parsedSelLh;
      }

      const { lines, segments } = applyStyleToCanvasElement(
        activeCanvasElement,
        sel.start,
        sel.end,
        styleToApply
      );

      canvasActions.updateElementProperties(id, {
        lines,
        segments,
        textAlign: editTextAlign,
      });

      if (sel.container) {
        const c = sel.container;
        const s = sel.start;
        const e = sel.end;
        queueMicrotask(() => {
          c.focus();
          setSelectionCharOffsets(c, s, e);
        });
      }
      return;
    }

    const targetBg = partialStyle && 'backgroundColor' in partialStyle
      ? (partialStyle as Partial<TextSegment>).backgroundColor
      : (editBackgroundColor || undefined);

    const updates: Partial<TextElement> = partialStyle ? {
      ...partialStyle,
      textAlign: editTextAlign,
      letterSpacing: editLetterSpacing || undefined,
    } : {
      fontFamily: editFontFamily,
      rawFontFamily: editFontFamily,
      fontWeight: editFontWeight,
      fontStyle: editFontStyle,
      underline: editUnderline,
      strikethrough: editStrikethrough,
      color: editColorHex,
      backgroundColor: targetBg,
      textAlign: editTextAlign,
      letterSpacing: editLetterSpacing || undefined,
    };

    const parsedLineHeight = parseFloat(editLineHeight);
    const hasExplicitLineHeight = !isNaN(parsedLineHeight) && parsedLineHeight > 0;
    if (hasExplicitLineHeight) {
      updates.lineHeight = parsedLineHeight;
    }

    const validFontSize = !isNaN(editFontSize) && editFontSize > 0 ? editFontSize : undefined;
    if (validFontSize !== undefined && validFontSize !== activeCanvasElement.fontSize) {
      const oldSize = activeCanvasElement.fontSize || validFontSize;
      const scale = oldSize > 0 ? validFontSize / oldSize : 1;
      updates.fontSize = validFontSize;

      if (activeCanvasElement.lines && activeCanvasElement.lines.length > 0) {
        updates.lines = activeCanvasElement.lines.map((l) => ({
          ...l,
          fontSize: validFontSize,
          lineHeight: l.lineHeight ? l.lineHeight * scale : undefined,
          segments: (l.segments ?? []).map((s) => ({
            ...s,
            fontSize: validFontSize,
          })),
        }));
      }
      if (activeCanvasElement.segments && activeCanvasElement.segments.length > 0) {
        updates.segments = activeCanvasElement.segments.map((s) => ({
          ...s,
          fontSize: validFontSize,
        }));
      }
    }

    if (editText !== activeCanvasElement.text) {
      const textLines = editText.split(/\r?\n/);
      const updatedLines: TextElementLine[] = textLines.map((lineStr, idx) => {
        const originalLine = activeCanvasElement.lines && activeCanvasElement.lines[idx] ? activeCanvasElement.lines[idx] : undefined;
        const lineFontSize = updates.lines?.[idx]?.fontSize || updates.fontSize || originalLine?.fontSize || activeCanvasElement.fontSize;
        const lineLetterSpacing = editLetterSpacing || originalLine?.letterSpacing || activeCanvasElement.letterSpacing;
        let segments = originalLine?.segments && originalLine.segments.length > 0 ? originalLine.segments : undefined;

        if (segments && originalLine && originalLine.text !== lineStr) {
          const refSeg = segments[0];
          segments = [
            {
              text: lineStr,
              fontSize: refSeg?.fontSize || lineFontSize,
              fontFamily: refSeg?.fontFamily || editFontFamily,
              rawFontFamily: refSeg?.rawFontFamily || refSeg?.fontFamily || editFontFamily,
              color: refSeg?.color || editColorHex,
              fontWeight: refSeg?.fontWeight || editFontWeight,
              fontStyle: refSeg?.fontStyle || editFontStyle,
              underline: refSeg?.underline ?? editUnderline,
              strikethrough: refSeg?.strikethrough ?? editStrikethrough,
              backgroundColor: refSeg?.backgroundColor ?? targetBg,
              letterSpacing: refSeg?.letterSpacing ?? lineLetterSpacing,
              wordSpacing: refSeg?.wordSpacing ?? originalLine?.wordSpacing ?? activeCanvasElement.wordSpacing,
              charCount: lineStr.length,
            },
          ];
        } else if (!segments) {
          segments = [
            {
              text: lineStr,
              fontSize: lineFontSize,
              fontFamily: editFontFamily,
              rawFontFamily: editFontFamily,
              color: editColorHex,
              fontWeight: editFontWeight,
              fontStyle: editFontStyle,
              underline: editUnderline,
              strikethrough: editStrikethrough,
              backgroundColor: targetBg,
              letterSpacing: lineLetterSpacing,
              wordSpacing: originalLine?.wordSpacing ?? activeCanvasElement.wordSpacing,
              charCount: lineStr.length,
            },
          ];
        }

        return {
          ...originalLine,
          text: lineStr,
          fontSize: lineFontSize,
          lineHeight: hasExplicitLineHeight ? parsedLineHeight : originalLine?.lineHeight,
          letterSpacing: lineLetterSpacing,
          wordSpacing: originalLine?.wordSpacing ?? activeCanvasElement.wordSpacing,
          underline: originalLine?.underline ?? editUnderline,
          strikethrough: originalLine?.strikethrough ?? editStrikethrough,
          segments,
        };
      });

      updates.text = editText;
      updates.lines = updatedLines;
      updates.segments = updatedLines.flatMap((l) => l.segments ?? []);
    } else {
      const baseSegments = updates.segments ?? activeCanvasElement.segments;
      const baseLines = updates.lines ?? activeCanvasElement.lines;
      if (partialStyle) {
        const fontFamilyOverride = partialStyle.fontFamily
          ? { fontFamily: partialStyle.fontFamily, rawFontFamily: partialStyle.fontFamily }
          : {};
        if (baseSegments) {
          updates.segments = baseSegments.map((s) => ({
            ...s,
            ...partialStyle,
            ...fontFamilyOverride,
          }));
        }
        if (baseLines) {
          updates.lines = baseLines.map((l) => ({
            ...l,
            ...(partialStyle.fontSize !== undefined ? { fontSize: partialStyle.fontSize } : {}),
            ...(partialStyle.underline !== undefined ? { underline: partialStyle.underline } : {}),
            ...(partialStyle.strikethrough !== undefined ? { strikethrough: partialStyle.strikethrough } : {}),
            ...(partialStyle.letterSpacing !== undefined ? { letterSpacing: partialStyle.letterSpacing } : {}),
            segments: (l.segments ?? []).map((s) => ({
              ...s,
              ...partialStyle,
              ...fontFamilyOverride,
            })),
          }));
        }
      } else {
        if (baseSegments) {
          updates.segments = baseSegments.map((s) => ({
            ...s,
            fontFamily: editFontFamily,
            rawFontFamily: editFontFamily,
            fontWeight: editFontWeight,
            fontStyle: editFontStyle,
            underline: editUnderline,
            strikethrough: editStrikethrough,
            color: editColorHex,
            backgroundColor: targetBg,
            letterSpacing: editLetterSpacing || undefined,
          }));
        }
        if (baseLines) {
          updates.lines = baseLines.map((l) => ({
            ...l,
            ...(hasExplicitLineHeight ? { lineHeight: parsedLineHeight } : {}),
            letterSpacing: editLetterSpacing || undefined,
            underline: editUnderline,
            strikethrough: editStrikethrough,
            segments: (l.segments ?? []).map((s) => ({
              ...s,
              fontFamily: editFontFamily,
              rawFontFamily: editFontFamily,
              fontWeight: editFontWeight,
              fontStyle: editFontStyle,
              underline: editUnderline,
              strikethrough: editStrikethrough,
              color: editColorHex,
              backgroundColor: targetBg,
              letterSpacing: editLetterSpacing || undefined,
            })),
          }));
        }
      }
    }

    if (multiModifyEnabled && !isEditing && canvasStore.selectedElementIds.length > 1) {
      canvasActions.updateSelectedElementsProperties(
        (item) => (item.id === id ? (updates as Record<string, unknown>) : (buildOtherCanvasTextStyleUpdates(item as TextElement, partialStyle) as Record<string, unknown>)),
        { kind: 'text' },
      );
    } else {
      canvasActions.updateElementProperties(id, updates);
    }
  }

  function applyPdfChanges(partialStyle?: Partial<TextSegment | TextWord>): void {
    if (!activePdfSpan) return;

    // When currently inline-editing in PDF mode, update staged lines/words directly without destructive re-render
    if (store.inlineEdit && store.inlineEdit.spanId === activePdfSpan.id) {
      const sel = getActiveEditorSelection();
      if (partialStyle && 'textAlign' in partialStyle) {
        const alignVal = (partialStyle as { textAlign?: 'left' | 'center' | 'right' }).textAlign || editTextAlign;
        store.inlineEdit = {
          ...store.inlineEdit,
          span: {
            ...store.inlineEdit.span,
            textAlign: alignVal,
          },
        };
        if (store.selectedSpan?.type === 'text') {
          (store.selectedSpan as EditableTextSpan).textAlign = alignVal;
        }
        if (Object.keys(partialStyle).length === 1) {
          if (sel?.container) {
            const c = sel.container;
            const s = sel.start;
            const e = sel.end;
            queueMicrotask(() => {
              c.focus();
              setSelectionCharOffsets(c, s, e);
            });
          }
          return;
        }
      }

      const inlineParsedLh = parseFloat(editLineHeight);
      const hasInlineExplicitLh = !isNaN(inlineParsedLh) && inlineParsedLh > 0;
      const currentLines = store.inlineEdit.styledLines || activePdfSpan.lines || [];
      let styleToApply: Partial<TextWord> & { lineHeight?: number };
      if (partialStyle) {
        styleToApply = { ...(partialStyle as unknown as Partial<TextWord>) };
        if (typeof (partialStyle as unknown as { color?: unknown })?.color === 'string') {
          styleToApply.color = hexToRgba((partialStyle as unknown as { color: string }).color);
        }
      } else {
        styleToApply = {
          fontFamily: editFontFamily,
          rawFontFamily: editFontFamily,
          matchedFontFamily: editFontFamily,
          fontWeight: editFontWeight,
          fontStyle: editFontStyle,
          underline: editUnderline,
          strikethrough: editStrikethrough,
          color: hexToRgba(editColorHex),
          backgroundColor: editBackgroundColor || undefined,
          letterSpacing: editLetterSpacing || undefined,
          ...(hasInlineExplicitLh ? { lineHeight: inlineParsedLh } : {}),
        };
        if (!isNaN(editFontSize) && editFontSize > 0) {
          styleToApply.fontSize = editFontSize;
        }
        store.inlineEdit = {
          ...store.inlineEdit,
          span: {
            ...store.inlineEdit.span,
            letterSpacing: editLetterSpacing || undefined,
            ...(hasInlineExplicitLh ? { lineHeight: inlineParsedLh } : {}),
          },
        };
        if (store.selectedSpan?.type === 'text') {
          const selSpan = store.selectedSpan as EditableTextSpan;
          selSpan.letterSpacing = editLetterSpacing || undefined;
          if (hasInlineExplicitLh) {
            selSpan.lineHeight = inlineParsedLh;
          }
        }
      }

      const start = (sel && sel.mode === 'pdf' && sel.targetId === activePdfSpan.id && sel.start < sel.end)
        ? sel.start
        : 0;
      const end = (sel && sel.mode === 'pdf' && sel.targetId === activePdfSpan.id && sel.start < sel.end)
        ? sel.end
        : Infinity;

      const { updatedLines, updatedText } = applyStyleToPdfLines(
        currentLines,
        start,
        end,
        styleToApply
      );

      actions.updateInlineText(updatedText, updatedLines);

      if (sel?.container) {
        const c = sel.container;
        const s = sel.start;
        const e = sel.end;
        queueMicrotask(() => {
          c.focus();
          setSelectionCharOffsets(c, s, e);
        });
      }
      return;
    }

    const targetBg = partialStyle && 'backgroundColor' in partialStyle
      ? (partialStyle as Partial<TextSegment>).backgroundColor
      : (editBackgroundColor || undefined);

    const parsedLineHeight = parseFloat(editLineHeight);
    const hasExplicitLineHeight = !isNaN(parsedLineHeight) && parsedLineHeight > 0;
    const validFontSize = !isNaN(editFontSize) && editFontSize > 0 ? editFontSize : undefined;
    const isMultiLine = Boolean(
      activePdfSpan.isParagraph ||
      (activePdfSpan.lines && activePdfSpan.lines.length > 1) ||
      editText.includes('\n')
    );

    let updatedLines: TextLine[] | undefined = undefined;
    if (activePdfSpan.lines && activePdfSpan.lines.length > 0) {
      const splitTexts = editText.split(/\r?\n/);
      const isSameCount = splitTexts.length === activePdfSpan.lines.length;
      updatedLines = splitTexts.map((newText, idx) => {
        const origLine = isSameCount
          ? activePdfSpan.lines![idx]
          : (findBestMatchingOrigLine(newText, activePdfSpan.lines, idx) || activePdfSpan.lines![Math.min(idx, activePdfSpan.lines!.length - 1)]);
        const lH = hasExplicitLineHeight && !partialStyle
          ? parsedLineHeight
          : (origLine?.lineHeight ?? activePdfSpan.lineHeight ?? (activePdfSpan.fontSize * 1.25));
        const lTop = isSameCount && origLine?.top !== undefined && !hasExplicitLineHeight
          ? origLine.top
          : activePdfSpan.top + idx * lH;
        const lBaseline = isSameCount && origLine?.baselineY !== undefined && !hasExplicitLineHeight
          ? origLine.baselineY
          : activePdfSpan.baselineY - idx * lH;
        const lLetterSpacing = partialStyle
          ? (partialStyle.letterSpacing ?? origLine?.letterSpacing ?? activePdfSpan.letterSpacing)
          : (editLetterSpacing || origLine?.letterSpacing);

        let words: TextWord[] = [];
        if (origLine?.words && origLine.text === newText) {
          words = origLine.words.map((w) => {
            if (partialStyle) {
              const updatedWord: TextWord = {
                ...w,
                fontFamily: partialStyle.fontFamily ?? w.fontFamily,
                rawFontFamily: partialStyle.fontFamily ? partialStyle.fontFamily : w.rawFontFamily,
                matchedFontFamily: partialStyle.fontFamily ? partialStyle.fontFamily : w.matchedFontFamily,
                fontWeight: partialStyle.fontWeight ?? w.fontWeight,
                fontStyle: partialStyle.fontStyle ?? w.fontStyle,
                color: partialStyle.color !== undefined
                  ? (typeof partialStyle.color === 'string' ? hexToRgba(partialStyle.color) : (partialStyle.color as unknown as ColorRgba))
                  : w.color,
                fontSize: partialStyle.fontSize ?? (validFontSize !== undefined && 'fontSize' in partialStyle ? validFontSize : w.fontSize),
                underline: 'underline' in partialStyle ? partialStyle.underline : w.underline,
                strikethrough: 'strikethrough' in partialStyle ? partialStyle.strikethrough : w.strikethrough,
                backgroundColor: 'backgroundColor' in partialStyle ? partialStyle.backgroundColor : w.backgroundColor,
                letterSpacing: 'letterSpacing' in partialStyle ? partialStyle.letterSpacing : w.letterSpacing,
              };
              return updatedWord;
            }
            return {
              ...w,
              fontFamily: w.fontFamily || editFontFamily,
              rawFontFamily: w.rawFontFamily || w.fontFamily || editFontFamily,
              matchedFontFamily: w.matchedFontFamily || w.fontFamily || editFontFamily,
              fontWeight: w.fontWeight || editFontWeight,
              fontStyle: w.fontStyle || editFontStyle,
              color: w.color || hexToRgba(editColorHex),
              fontSize: validFontSize ?? w.fontSize,
              underline: w.underline ?? editUnderline,
              strikethrough: w.strikethrough ?? editStrikethrough,
              backgroundColor: w.backgroundColor ?? targetBg,
              letterSpacing: editLetterSpacing || w.letterSpacing,
            };
          });
        } else if (newText.trim().length > 0) {
          const rawTokens = newText.split(/([\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+)/);
          let currentX = origLine?.left ?? activePdfSpan.left;
          let pendingSpace = false;
          const lineFs = validFontSize ?? origLine?.fontSize ?? activePdfSpan.fontSize;
          const approxCharW = lineFs * 0.52;
          for (const token of rawTokens) {
            if (!token) continue;
            if (/^[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+$/.test(token)) {
              pendingSpace = true;
              continue;
            }
            const cleanToken = sanitizePdfText(token);
            if (cleanToken.length === 0) continue;
            const hasPrecedingSpace = pendingSpace || words.length > 0;
            if (hasPrecedingSpace) {
              currentX += lineFs * 0.25;
            }
            const candidateWord =
              origLine?.words?.find((w) => w.text === cleanToken) ??
              origLine?.words?.[Math.min(words.length, (origLine?.words?.length || 1) - 1)];
            const wW = candidateWord?.width && candidateWord.width > 0 && candidateWord.text === cleanToken
              ? candidateWord.width
              : cleanToken.length * approxCharW;
            words.push({
              text: cleanToken,
              left: currentX,
              top: lTop,
              right: currentX + wW,
              bottom: lTop + lineFs,
              width: wW,
              height: lineFs,
              fontSize: candidateWord?.fontSize ?? lineFs,
              baselineY: lBaseline,
              charStartIndex: 0,
              charCount: cleanToken.length,
              fontFamily: candidateWord?.fontFamily ?? origLine?.fontFamily ?? editFontFamily,
              rawFontFamily: candidateWord?.rawFontFamily ?? origLine?.rawFontFamily ?? editFontFamily,
              matchedFontFamily: candidateWord?.matchedFontFamily ?? origLine?.matchedFontFamily ?? editFontFamily,
              color: candidateWord?.color ?? origLine?.color ?? hexToRgba(editColorHex),
              fontWeight: candidateWord?.fontWeight || origLine?.fontWeight || editFontWeight,
              fontStyle: candidateWord?.fontStyle || origLine?.fontStyle || editFontStyle,
              underline: partialStyle ? ('underline' in partialStyle ? partialStyle.underline : candidateWord?.underline) : (candidateWord?.underline ?? editUnderline),
              strikethrough: partialStyle ? ('strikethrough' in partialStyle ? partialStyle.strikethrough : candidateWord?.strikethrough) : (candidateWord?.strikethrough ?? editStrikethrough),
              backgroundColor: partialStyle ? ('backgroundColor' in partialStyle ? partialStyle.backgroundColor : candidateWord?.backgroundColor) : (candidateWord?.backgroundColor ?? targetBg),
              letterSpacing: candidateWord?.letterSpacing ?? lLetterSpacing,
              hasPrecedingSpace,
            });
            currentX += wW;
            pendingSpace = false;
          }
        }

        const allWordsUnderline = words.length > 0 && words.every((w) => Boolean(w.underline));
        const anyWordUnderline = words.some((w) => Boolean(w.underline));
        const allWordsStrike = words.length > 0 && words.every((w) => Boolean(w.strikethrough));
        const anyWordStrike = words.some((w) => Boolean(w.strikethrough));
        const allWordsBg = words.length > 0 && words.every((w) => Boolean(w.backgroundColor) && w.backgroundColor === words[0].backgroundColor);

        return {
          ...origLine,
          text: newText,
          left: origLine?.left ?? activePdfSpan.left,
          top: lTop,
          right: (origLine?.left ?? activePdfSpan.left) + (origLine?.width ?? activePdfSpan.width),
          bottom: lTop + lH,
          width: origLine?.width ?? activePdfSpan.width,
          height: lH,
          fontSize: partialStyle?.fontSize ?? (validFontSize ?? origLine?.fontSize ?? activePdfSpan.fontSize),
          baselineY: lBaseline,
          lineHeight: lH,
          letterSpacing: lLetterSpacing,
          charStartIndex: 0,
          charCount: newText.length,
          fontFamily: partialStyle?.fontFamily ?? (origLine?.fontFamily ?? editFontFamily ?? activePdfSpan.fontFamily),
          rawFontFamily: partialStyle?.fontFamily ?? (origLine?.rawFontFamily ?? origLine?.fontFamily ?? editFontFamily ?? activePdfSpan.rawFontFamily),
          matchedFontFamily: partialStyle?.fontFamily ?? (origLine?.matchedFontFamily ?? origLine?.fontFamily ?? editFontFamily ?? activePdfSpan.matchedFontFamily),
          fontWeight: partialStyle?.fontWeight ?? (origLine?.fontWeight ?? editFontWeight ?? activePdfSpan.fontWeight),
          fontStyle: partialStyle?.fontStyle ?? (origLine?.fontStyle ?? editFontStyle ?? activePdfSpan.fontStyle),
          color: partialStyle?.color !== undefined
            ? (typeof partialStyle.color === 'string' ? hexToRgba(partialStyle.color) : (partialStyle.color as unknown as ColorRgba))
            : (origLine?.color ?? hexToRgba(editColorHex) ?? activePdfSpan.color),
          underline: words.length > 0 ? (allWordsUnderline ? true : (anyWordUnderline ? undefined : false)) : (partialStyle ? ('underline' in partialStyle ? partialStyle.underline : origLine?.underline) : editUnderline),
          strikethrough: words.length > 0 ? (allWordsStrike ? true : (anyWordStrike ? undefined : false)) : (partialStyle ? ('strikethrough' in partialStyle ? partialStyle.strikethrough : origLine?.strikethrough) : editStrikethrough),
          backgroundColor: words.length > 0 ? (allWordsBg ? words[0].backgroundColor : undefined) : targetBg,
          words,
        };
      });
    }

    actions.applyTextMutation(
      {
        text: editText,
        fontSize: partialStyle ? (partialStyle.fontSize ?? activePdfSpan.fontSize) : validFontSize,
        fontFamily: partialStyle ? (partialStyle.fontFamily ?? activePdfSpan.fontFamily) : editFontFamily,
        rawFontFamily: partialStyle ? (partialStyle.fontFamily ?? activePdfSpan.rawFontFamily) : editFontFamily,
        fontWeight: partialStyle ? (partialStyle.fontWeight ?? activePdfSpan.fontWeight) : editFontWeight,
        fontStyle: partialStyle ? (partialStyle.fontStyle ?? activePdfSpan.fontStyle) : editFontStyle,
        underline: partialStyle ? ('underline' in partialStyle ? partialStyle.underline : activePdfSpan.underline) : editUnderline,
        strikethrough: partialStyle ? ('strikethrough' in partialStyle ? partialStyle.strikethrough : activePdfSpan.strikethrough) : editStrikethrough,
        backgroundColor: targetBg,
        textAlign: (partialStyle as { textAlign?: 'left' | 'center' | 'right' })?.textAlign ?? editTextAlign,
        letterSpacing: editLetterSpacing || undefined,
        wordSpacing: activePdfSpan.wordSpacing,
        scaleX: activePdfSpan.scaleX,
        color: partialStyle?.color !== undefined
          ? (typeof partialStyle.color === 'string' ? hexToRgba(partialStyle.color) : (partialStyle.color as unknown as ColorRgba))
          : (partialStyle ? activePdfSpan.color : hexToRgba(editColorHex)),
        lineHeight: hasExplicitLineHeight ? parsedLineHeight : undefined,
        lines: updatedLines,
        reflowParagraph: isMultiLine,
      },
      activePdfSpan
    );
  }

  function toggleFormatting(type: 'bold' | 'italic' | 'underline' | 'strikethrough'): void {
    let partialStyle: Partial<TextSegment> = {};
    if (type === 'bold') {
      editFontWeight = editFontWeight === 'bold' ? 'normal' : 'bold';
      partialStyle = { fontWeight: editFontWeight };
    } else if (type === 'italic') {
      editFontStyle = editFontStyle === 'italic' ? 'normal' : 'italic';
      partialStyle = { fontStyle: editFontStyle };
    } else if (type === 'underline') {
      editUnderline = !editUnderline;
      partialStyle = { underline: editUnderline };
    } else if (type === 'strikethrough') {
      editStrikethrough = !editStrikethrough;
      partialStyle = { strikethrough: editStrikethrough };
    }
    applyChanges(partialStyle);
  }

  function handleWeightChange(val: string): void {
    editFontWeight = val === 'bold' ? 'bold' : 'normal';
    applyChanges({ fontWeight: editFontWeight });
  }

  function handleHorizontalAlignChange(val: string): void {
    if (val === 'left' || val === 'center' || val === 'right') {
      editTextAlign = val;
      applyChanges({ textAlign: val } as Partial<TextSegment>);
    }
  }

  const documentTypography = $derived.by(() => {
    void store.isDocumentLoaded;
    void store.activeWorkspaceFileId;
    void store.renderVersion;
    return actions.getDocumentTypography();
  });

  const activeTextPreset = $derived.by((): TextStylePresetId | 'custom' => {
    if (hasMixedFontSize) return 'custom';
    return detectMatchingTextPreset(
      {
        fontSize: editFontSize,
        fontWeight: editFontWeight,
        fontStyle: editFontStyle,
      },
      documentTypography
    );
  });

  const activeTextPresetLabel = $derived.by((): string => {
    if (activeTextPreset === 'custom') return 'Custom';
    const meta = TEXT_STYLE_PRESETS.find((p) => p.id === activeTextPreset);
    return meta ? meta.label : 'Custom';
  });

  function handleTextPresetChange(val: string): void {
    if (!val || val === 'custom') return;
    const presetId = val as TextStylePresetId;
    const style = getPresetStyleProfile(presetId, documentTypography);
    hasMixedFontSize = false;
    editFontSize = style.fontSize;
    editFontFamily = resolveInspectorFontFamily(style.fontFamily, style.rawFontFamily);
    editFontWeight = style.fontWeight;
    editFontStyle = style.fontStyle;
    editColorHex = normalizeColorToHex(style.color);
    if (style.lineHeight && style.lineHeight > 0) {
      editLineHeight = `${Math.round(style.lineHeight * 10) / 10}`;
    } else {
      editLineHeight = '';
    }
    applyChanges({
      fontSize: editFontSize,
      fontFamily: editFontFamily,
      rawFontFamily: style.rawFontFamily || editFontFamily,
      fontWeight: editFontWeight,
      fontStyle: editFontStyle,
      color: editColorHex,
    });
  }

  function handleVerticalAlignChange(val: string): void {
    if (val === 'top' || val === 'middle' || val === 'bottom') {
      editVerticalAlign = val;
      applyChanges();
    }
  }
</script>

{#if activeCanvasElement || activePdfSpan}
  <div class="flex flex-col w-full shrink-0 py-1">
    <SidebarSection title="Typography" borderBottom={true} collapsible={true} defaultExpanded={true}>
      <div class="flex flex-col gap-2">
        <!-- Text Content -->
        <div class="flex flex-col gap-1">
          <Label class="field-label">Text Content</Label>
          <Textarea
            aria-label="Text Content"
            bind:value={editText}
            class="text-xs resize-y"
            onkeydown={(e) => {
              if (resolveInlineKeyAction(e) === 'submit') {
                e.preventDefault();
                applyChanges();
              }
            }}
            onblur={() => {
              const origText = activeCanvasElement ? activeCanvasElement.text : (activePdfSpan?.text ?? '');
              if (editText !== origText) {
                applyChanges();
              }
            }}
            placeholder="Paragraph text..."
            rows={3}
          />
        </div>

        {#if featureFlags.isEnabled('text.presets')}
        <!-- Text Style Preset -->
        <div class="flex flex-col gap-1 mt-0.5">
          <Label class="field-label">Text Style</Label>
          <Select.Root
            type="single"
            value={activeTextPreset}
            onValueChange={handleTextPresetChange}
          >
            <Select.Trigger aria-label="Text Style" class="h-8 text-xs w-full font-normal">
              {activeTextPresetLabel}
            </Select.Trigger>
            <Select.Content>
              {#each TEXT_STYLE_PRESETS as preset (preset.id)}
                {@const presetStyle = getPresetStyleProfile(preset.id, documentTypography)}
                <Select.Item value={preset.id} label={preset.label}>
                  <span class="flex items-center justify-between w-full gap-2">
                    <span>{preset.label}</span>
                    <span class="text-[11px] text-muted-foreground">{presetStyle.fontSize}pt</span>
                  </span>
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        {/if}

        <!-- Font Family -->
        <div class="flex flex-col gap-1 mt-0.5">
          <Label class="field-label">Font Family</Label>
          <Select.Root 
            type="single" 
            value={selectedFontValue} 
            onValueChange={(val) => { 
              if (val) {
                editFontFamily = val; 
                applyChanges({ fontFamily: val }); 
              }
            }}
          >
            <Select.Trigger class="h-8 text-xs w-full font-normal">
              {getDisplayFontName(editFontFamily, extractBaseFontFamily)}
            </Select.Trigger>
            <Select.Content>
              {#each fontSelectItems as item (item.value)}
                <Select.Item 
                  value={item.value} 
                  label={item.label}
                  class={item.isLastDocumentFont ? "border-b border-border mb-1 pb-1.5 rounded-b-none" : ""}
                  data-document-font={item.isDocumentFont ? "true" : "false"}
                  data-last-document-font={item.isLastDocumentFont ? "true" : undefined}
                >
                  {item.label}
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        <!-- Weight & Size -->
        <div class="flex items-end gap-2 mt-0.5 w-full">
          <div class="flex flex-col gap-1 flex-1 min-w-0">
            <Label class="field-label">Weight</Label>
            <Select.Root 
              type="single" 
              value={editFontWeight} 
              onValueChange={handleWeightChange}
            >
              <Select.Trigger class="h-8 text-xs w-full font-normal">
                {editFontWeight === 'bold' ? 'Bold' : 'Regular'}
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="normal" label="Regular">Regular</Select.Item>
                <Select.Item value="bold" label="Bold">Bold</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>

          <div class="flex flex-col gap-1 w-[110px] shrink-0">
            <Label class="field-label">Size (pt)</Label>
            <Input 
              type="number" 
              aria-label="Font Size (pt)"
              bind:value={editFontSize} 
              onchange={() => applyChanges({ fontSize: editFontSize })}
              onkeydown={(e) => e.key === 'Enter' && applyChanges({ fontSize: editFontSize })}
              placeholder={hasMixedFontSize ? 'Mixed' : ''}
              class="h-8 text-xs w-full" 
              min="1"
              step="0.5"
            />
          </div>
        </div>

        <!-- Line Height & Letter Spacing -->
        <div class="grid grid-cols-2 gap-2 mt-0.5 w-full">
          <div class="flex flex-col gap-1 min-w-0">
            <Label class="field-label">Line Height (pt)</Label>
            <Input 
              type="text" 
              inputmode="decimal"
              aria-label="Line Height (pt)"
              bind:value={editLineHeight}
              placeholder="Auto"
              onchange={() => applyChanges({ lineHeight: !isNaN(parseFloat(editLineHeight)) && parseFloat(editLineHeight) > 0 ? parseFloat(editLineHeight) : undefined } as Partial<TextSegment>)}
              onkeydown={(e) => e.key === 'Enter' && applyChanges({ lineHeight: !isNaN(parseFloat(editLineHeight)) && parseFloat(editLineHeight) > 0 ? parseFloat(editLineHeight) : undefined } as Partial<TextSegment>)}
              class="h-8 text-xs w-full" 
            />
          </div>

          <div class="flex flex-col gap-1 min-w-0">
            <Label class="field-label">Letter Spacing</Label>
            <Input 
              type="text" 
              aria-label="Letter Spacing"
              bind:value={editLetterSpacing}
              onchange={() => applyChanges({ letterSpacing: editLetterSpacing || undefined })}
              onkeydown={(e) => e.key === 'Enter' && applyChanges({ letterSpacing: editLetterSpacing || undefined })}
              placeholder="0%"
              class="h-8 text-xs w-full" 
            />
          </div>
        </div>

        <!-- Formatting & Alignment Toolbar -->
        <div class="grid grid-cols-2 gap-2 w-full">
          <div class="flex flex-col gap-1 min-w-0">
            <Label class="field-label">Formatting</Label>
            <ButtonGroup variant="outline" size="sm" class="h-8 w-full flex">
              <Button
                variant={editFontWeight === 'bold' ? 'default' : 'outline'}
                size="sm"
                class="flex-1 h-8 p-0"
                onclick={() => toggleFormatting('bold')}
                aria-label="Bold"
                aria-pressed={editFontWeight === 'bold'}
                title="Bold (Ctrl+B)"
              >
                <Bold class="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant={editFontStyle === 'italic' ? 'default' : 'outline'}
                size="sm"
                class="flex-1 h-8 p-0"
                onclick={() => toggleFormatting('italic')}
                aria-label="Italic"
                aria-pressed={editFontStyle === 'italic'}
                title="Italic (Ctrl+I)"
              >
                <Italic class="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant={editUnderline ? 'default' : 'outline'}
                size="sm"
                class="flex-1 h-8 p-0"
                onclick={() => toggleFormatting('underline')}
                aria-label="Underline"
                aria-pressed={editUnderline}
                title="Underline (Ctrl+U)"
              >
                <Underline class="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant={editStrikethrough ? 'default' : 'outline'}
                size="sm"
                class="flex-1 h-8 p-0"
                onclick={() => toggleFormatting('strikethrough')}
                aria-label="Strikethrough"
                aria-pressed={editStrikethrough}
                title="Strikethrough"
              >
                <Strikethrough class="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </ButtonGroup>
          </div>

          <div class="flex flex-col gap-1 min-w-0">
            <Label class="field-label">Alignment</Label>
            <div class={featureFlags.isEnabled('text.vertical-align') ? 'grid grid-cols-2 gap-2 w-full' : 'w-full'}>
              <!-- Horizontal Alignment -->
              <ButtonGroup variant="outline" size="sm" class="h-8 w-full flex">
                <Button
                  variant={editTextAlign === 'left' ? 'default' : 'outline'}
                  size="sm"
                  class="flex-1 h-8 p-0"
                  onclick={() => handleHorizontalAlignChange('left')}
                  aria-label="Align Left"
                  aria-pressed={editTextAlign === 'left'}
                  title="Align Left"
                >
                  <AlignLeft class="h-3.5 w-3.5"/>
                </Button>
                <Button
                  variant={editTextAlign === 'center' ? 'default' : 'outline'}
                  size="sm"
                  class="flex-1 h-8 p-0"
                  onclick={() => handleHorizontalAlignChange('center')}
                  aria-label="Align Center"
                  aria-pressed={editTextAlign === 'center'}
                  title="Align Center"
                >
                  <AlignCenter class="h-3.5 w-3.5"/>
                </Button>
                <Button
                  variant={editTextAlign === 'right' ? 'default' : 'outline'}
                  size="sm"
                  class="flex-1 h-8 p-0"
                  onclick={() => handleHorizontalAlignChange('right')}
                  aria-label="Align Right"
                  aria-pressed={editTextAlign === 'right'}
                  title="Align Right"
                >
                  <AlignRight class="h-3.5 w-3.5"/>
                </Button>
              </ButtonGroup>

              {#if featureFlags.isEnabled('text.vertical-align')}
              <!-- Vertical Alignment -->
              <ButtonGroup variant="outline" size="sm" class="h-8 w-full flex">
                <Button
                  variant={editVerticalAlign === 'top' ? 'default' : 'outline'}
                  size="sm"
                  class="flex-1 h-8 p-0"
                  onclick={() => handleVerticalAlignChange('top')}
                  aria-label="Align Top"
                  aria-pressed={editVerticalAlign === 'top'}
                  title="Align Top"
                >
                  <AlignVerticalSpaceAround class="h-3.5 w-3.5"/>
                </Button>
                <Button
                  variant={editVerticalAlign === 'middle' ? 'default' : 'outline'}
                  size="sm"
                  class="flex-1 h-8 p-0"
                  onclick={() => handleVerticalAlignChange('middle')}
                  aria-label="Align Middle"
                  aria-pressed={editVerticalAlign === 'middle'}
                  title="Align Middle"
                >
                  <AlignVerticalJustifyCenter class="h-3.5 w-3.5"/>
                </Button>
                <Button
                  variant={editVerticalAlign === 'bottom' ? 'default' : 'outline'}
                  size="sm"
                  class="flex-1 h-8 p-0"
                  onclick={() => handleVerticalAlignChange('bottom')}
                  aria-label="Align Bottom"
                  aria-pressed={editVerticalAlign === 'bottom'}
                  title="Align Bottom"
                >
                  <AlignVerticalSpaceBetween class="h-3.5 w-3.5"/>
                </Button>
              </ButtonGroup>
              {/if}
            </div>
          </div>
        </div>

        <!-- Colour & Highlight / Background -->
        <div class="grid grid-cols-2 gap-2 mt-0.5 mb-1 w-full">
          <div class="flex flex-col gap-1">
            <Label class="field-label">Color</Label>
            <ColorPicker 
              value={editColorHex} 
              label="Text Color"
              onInteractingChange={(interacting) => setInspectorInteracting(interacting)}
              onValueChange={(val) => {
                editColorHex = val;
                applyChanges({ color: val });
              }}
            />
          </div>

          <div class="flex flex-col gap-1">
            <Label class="field-label">Highlight</Label>
            <ColorPicker 
              value={editBackgroundColor || 'none'} 
              label="Highlight Color"
              presets={HIGHLIGHT_SWATCHES}
              allowNone={true}
              noneValue=""
              onInteractingChange={(interacting) => setInspectorInteracting(interacting)}
              onValueChange={(val) => {
                editBackgroundColor = val || '';
                applyChanges({ backgroundColor: val ? val : undefined });
              }}
            />
          </div>
        </div>
      </div>
    </SidebarSection>

    {#if featureFlags.isEnabled('outline')}
    <OutlineSection
      activeText={editText}
      fontSize={editFontSize}
      isBold={editFontWeight === 'bold'}
      pageIndex={activePdfSpan?.pageIndex ?? activeCanvasElement?.pageIndex ?? store.currentPageIndex}
    />
    {/if}
  </div>
{:else}
  <div class="px-3 py-6 text-center text-xs text-muted-foreground">
    <p class="font-medium text-foreground mb-1">No text selected</p>
    <p class="text-pretty">Select a text span or text element on the page to edit its typography.</p>
  </div>
{/if}
