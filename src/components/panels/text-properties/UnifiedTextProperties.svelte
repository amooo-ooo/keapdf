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
  import { getDisplayFontName } from '../../../services/font-loader';
  import { sanitizePdfText } from '../../../services/pdf/utils';
  import {
    getActiveEditorSelection,
    applyStyleToCanvasElement,
    applyStyleToPdfLines,
    getWordAtCharOffset,
    getSegmentAtCharOffset,
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

  const fontSelectItems = $derived.by(() => {
    const items = [...STANDARD_FONTS];
    if (editFontFamily && !items.some((item) => item.value === editFontFamily)) {
      items.unshift({
        value: editFontFamily,
        label: getDisplayFontName(editFontFamily, extractBaseFontFamily),
      });
    }
    return items;
  });

  $effect(() => {
    if (activeCanvasElement) {
      editText = activeCanvasElement.text ?? '';
      
      const distinctSizes = getDistinctCanvasSizes(activeCanvasElement);
      hasMixedFontSize = distinctSizes.length > 1;
      editFontSize = hasMixedFontSize ? NaN : Math.round((activeCanvasElement.fontSize || 12) * 10) / 10;

      editFontFamily = activeCanvasElement.rawFontFamily || activeCanvasElement.fontFamily || 'Helvetica';
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

      editFontFamily = activePdfSpan.rawFontFamily || activePdfSpan.fontFamily || 'Helvetica';
      editLineHeight = activePdfSpan.lineHeight ? `${Math.round(activePdfSpan.lineHeight * 10) / 10}` : '';
      editLetterSpacing = activePdfSpan.letterSpacing || '';
      
      const rawLower = (activePdfSpan.rawFontFamily || activePdfSpan.fontFamily || '').toLowerCase();
      editFontWeight = (activePdfSpan.fontWeight === 'bold' || rawLower.includes('bold')) ? 'bold' : 'normal';
      editFontStyle = (activePdfSpan.fontStyle === 'italic' || rawLower.includes('italic') || rawLower.includes('oblique')) ? 'italic' : 'normal';
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
      const segments = activeCanvasElement.segments && activeCanvasElement.segments.length > 0
        ? activeCanvasElement.segments
        : (activeCanvasElement.lines ? activeCanvasElement.lines.flatMap((l) => l.segments || []) : []);
      const seg = getSegmentAtCharOffset(segments, sel.start);
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
        if (seg.fontFamily) {
          editFontFamily = seg.rawFontFamily || seg.fontFamily;
        }
      }
      return;
    }

    if (activePdfSpan && store.inlineEdit && store.inlineEdit.spanId === activePdfSpan.id && sel.mode === 'pdf' && sel.targetId === activePdfSpan.id) {
      const lines = store.inlineEdit.styledLines || activePdfSpan.lines || [];
      const word = getWordAtCharOffset(lines, sel.start);
      if (word) {
        const rawLower = (word.rawFontFamily || word.fontFamily || '').toLowerCase();
        editFontWeight = (word.fontWeight === 'bold' || rawLower.includes('bold')) ? 'bold' : 'normal';
        editFontStyle = (word.fontStyle === 'italic' || rawLower.includes('italic') || rawLower.includes('oblique')) ? 'italic' : 'normal';
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
        if (word.fontFamily) {
          editFontFamily = word.rawFontFamily || word.fontFamily;
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
    if (activeCanvasElement) {
      applyCanvasChanges(partialStyle);
      return;
    }
    if (activePdfSpan) {
      applyPdfChanges(partialStyle);
    }
  }

  function applyCanvasChanges(partialStyle?: Partial<TextSegment>): void {
    if (!activeCanvasElement) return;
    const id = activeCanvasElement.id;
    const sel = getActiveEditorSelection();
    const isEditing = canvasStore.editingElementId === id;

    if (isEditing && sel && sel.mode === 'canvas' && sel.targetId === id && sel.start < sel.end) {
      const styleToApply: Partial<TextSegment> = partialStyle ? { ...partialStyle } : {
        fontFamily: editFontFamily,
        fontWeight: editFontWeight,
        fontStyle: editFontStyle,
        underline: editUnderline,
        strikethrough: editStrikethrough,
        color: editColorHex,
        backgroundColor: editBackgroundColor || undefined,
      };
      if (!partialStyle && !isNaN(editFontSize) && editFontSize > 0) {
        styleToApply.fontSize = editFontSize;
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

    const updates: Partial<TextElement> = {
      fontFamily: editFontFamily,
      rawFontFamily: undefined,
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
    if (!isNaN(parsedLineHeight) && parsedLineHeight > 0) {
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
          fontSize: Math.max(1, Math.round((l.fontSize || oldSize) * scale * 10) / 10),
          lineHeight: l.lineHeight ? l.lineHeight * scale : undefined,
          segments: (l.segments ?? []).map((s) => ({
            ...s,
            fontSize: Math.max(1, Math.round((s.fontSize || l.fontSize || oldSize) * scale * 10) / 10),
          })),
        }));
      }
      if (activeCanvasElement.segments && activeCanvasElement.segments.length > 0) {
        updates.segments = activeCanvasElement.segments.map((s) => ({
          ...s,
          fontSize: Math.max(1, Math.round((s.fontSize || oldSize) * scale * 10) / 10),
        }));
      }
    }

    if (editText !== activeCanvasElement.text) {
      const textLines = editText.split(/\r?\n/);
      const updatedLines: TextElementLine[] = textLines.map((lineStr, idx) => {
        const originalLine = activeCanvasElement.lines && activeCanvasElement.lines[idx] ? activeCanvasElement.lines[idx] : undefined;
        const lineFontSize = originalLine?.fontSize || updates.fontSize || activeCanvasElement.fontSize;
        let segments = originalLine?.segments && originalLine.segments.length > 0 ? originalLine.segments : undefined;

        if (segments && originalLine && originalLine.text !== lineStr) {
          segments = [
            {
              text: lineStr,
              fontSize: segments[0]?.fontSize || lineFontSize,
              fontFamily: editFontFamily,
              color: editColorHex,
              fontWeight: editFontWeight,
              fontStyle: editFontStyle,
              underline: editUnderline,
              strikethrough: editStrikethrough,
              charCount: lineStr.length,
            },
          ];
        } else if (!segments) {
          segments = [
            {
              text: lineStr,
              fontSize: lineFontSize,
              fontFamily: editFontFamily,
              color: editColorHex,
              fontWeight: editFontWeight,
              fontStyle: editFontStyle,
              underline: editUnderline,
              strikethrough: editStrikethrough,
              charCount: lineStr.length,
            },
          ];
        }

        return {
          text: lineStr,
          fontSize: lineFontSize,
          lineHeight: originalLine?.lineHeight,
          underline: editUnderline,
          strikethrough: editStrikethrough,
          segments,
        };
      });

      updates.text = editText;
      updates.lines = updatedLines;
      updates.segments = updatedLines.flatMap((l) => l.segments ?? []);
    } else {
      if (activeCanvasElement.segments) {
        updates.segments = activeCanvasElement.segments.map((s) => ({
          ...s,
          fontFamily: editFontFamily,
          rawFontFamily: undefined,
          fontWeight: editFontWeight,
          fontStyle: editFontStyle,
          underline: editUnderline,
          strikethrough: editStrikethrough,
          color: editColorHex,
          backgroundColor: targetBg,
        }));
      }
      if (activeCanvasElement.lines) {
        updates.lines = activeCanvasElement.lines.map((l) => ({
          ...l,
          underline: editUnderline,
          strikethrough: editStrikethrough,
          segments: (l.segments ?? []).map((s) => ({
            ...s,
            fontFamily: editFontFamily,
            rawFontFamily: undefined,
            fontWeight: editFontWeight,
            fontStyle: editFontStyle,
            underline: editUnderline,
            strikethrough: editStrikethrough,
            color: editColorHex,
            backgroundColor: targetBg,
          })),
        }));
      }
    }

    canvasActions.updateElementProperties(id, updates);
  }

  function applyPdfChanges(partialStyle?: Partial<TextSegment | TextWord>): void {
    if (!activePdfSpan) return;

    // When currently inline-editing in PDF mode, update staged lines/words directly without destructive re-render
    if (store.inlineEdit && store.inlineEdit.spanId === activePdfSpan.id) {
      const sel = getActiveEditorSelection();
      const currentLines = store.inlineEdit.styledLines || activePdfSpan.lines || [];
      let styleToApply: Partial<TextWord>;
      if (partialStyle) {
        styleToApply = { ...(partialStyle as unknown as Partial<TextWord>) };
        if (typeof (partialStyle as unknown as { color?: unknown })?.color === 'string') {
          styleToApply.color = hexToRgba((partialStyle as unknown as { color: string }).color);
        }
      } else {
        styleToApply = {
          fontFamily: editFontFamily,
          fontWeight: editFontWeight,
          fontStyle: editFontStyle,
          underline: editUnderline,
          strikethrough: editStrikethrough,
          color: hexToRgba(editColorHex),
          backgroundColor: editBackgroundColor || undefined,
        };
        if (!isNaN(editFontSize) && editFontSize > 0) {
          styleToApply.fontSize = editFontSize;
        }
      }

