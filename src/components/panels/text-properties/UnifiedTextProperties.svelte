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
        const lH = origLine?.lineHeight ?? activePdfSpan.lineHeight ?? (activePdfSpan.fontSize * 1.25);
        const lTop = isSameCount && origLine?.top !== undefined ? origLine.top : activePdfSpan.top + idx * lH;
        const lBaseline = isSameCount && origLine?.baselineY !== undefined ? origLine.baselineY : activePdfSpan.baselineY - idx * lH;

        let words: TextWord[] = [];
        if (origLine?.words && origLine.text === newText) {
          words = origLine.words.map((w) => ({
            ...w,
            fontFamily: editFontFamily,
            fontWeight: editFontWeight,
            fontStyle: editFontStyle,
            color: hexToRgba(editColorHex),
            fontSize: validFontSize ?? w.fontSize,
          }));
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
            const candidateWord = origLine?.words?.find((w) => w.text === cleanToken);
            const wW = candidateWord?.width && candidateWord.width > 0 ? candidateWord.width : cleanToken.length * approxCharW;
            words.push({
              text: cleanToken,
              left: currentX,
              top: lTop,
              right: currentX + wW,
              bottom: lTop + lineFs,
              width: wW,
              height: lineFs,
              fontSize: lineFs,
              baselineY: lBaseline,
              charStartIndex: 0,
              charCount: cleanToken.length,
              fontFamily: editFontFamily,
              rawFontFamily: editFontFamily,
              color: hexToRgba(editColorHex),
              fontWeight: candidateWord?.fontWeight || editFontWeight,
              fontStyle: candidateWord?.fontStyle || editFontStyle,
              hasPrecedingSpace,
            });
            currentX += wW;
            pendingSpace = false;
          }
        }

        return {
          ...origLine,
          text: newText,
          left: origLine?.left ?? activePdfSpan.left,
          top: lTop,
          right: (origLine?.left ?? activePdfSpan.left) + activePdfSpan.width,
          bottom: lTop + lH,
          width: origLine?.width ?? activePdfSpan.width,
          height: lH,
          fontSize: validFontSize ?? origLine?.fontSize ?? activePdfSpan.fontSize,
          baselineY: lBaseline,
          lineHeight: lH,
          charStartIndex: 0,
          charCount: newText.length,
          fontFamily: editFontFamily,
          fontWeight: editFontWeight,
          fontStyle: editFontStyle,
          color: hexToRgba(editColorHex),
          words,
        };
      });
    }

    actions.applyTextMutation(
      {
        text: editText,
        fontSize: validFontSize,
        fontFamily: editFontFamily,
        fontWeight: editFontWeight,
        fontStyle: editFontStyle,
        underline: editUnderline,
        strikethrough: editStrikethrough,
        backgroundColor: targetBg,
        textAlign: editTextAlign,
        letterSpacing: editLetterSpacing || undefined,
        color: hexToRgba(editColorHex),
        lineHeight: !isNaN(parsedLineHeight) && parsedLineHeight > 0 ? parsedLineHeight : undefined,
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
      applyChanges();
    }
  }

  function handleVerticalAlignChange(val: string): void {
    if (val === 'top' || val === 'middle' || val === 'bottom') {
      editVerticalAlign = val;
      applyChanges();
    }
  }
</script>

{#if activeCanvasElement || activePdfSpan}
  <div class="flex flex-col w-full shrink-0">
    <SidebarSection title="Typography" borderBottom={true} collapsible={true} defaultExpanded={true}>
      <div class="flex flex-col gap-2">
        <!-- Text Content -->
        <div class="flex flex-col gap-1">
          <Label class="field-label">Text Content</Label>
          <Textarea
            bind:value={editText}
            class="text-xs resize-y"
            onkeydown={(e) => {
              if (resolveInlineKeyAction(e) === 'submit') {
                e.preventDefault();
                applyChanges();
              }
            }}
            onblur={() => applyChanges()}
            placeholder="Paragraph text..."
            rows={3}
          />
        </div>

        <!-- Font Family -->
        <div class="flex flex-col gap-1 mt-0.5">
          <Label class="field-label">Font Family</Label>
          <Select.Root 
            type="single" 
            value={editFontFamily} 
            onValueChange={(val) => { 
              if (val) {
                editFontFamily = val; 
                applyChanges(); 
              }
            }}
          >
            <Select.Trigger class="h-8 text-xs w-full font-normal">
              {getDisplayFontName(editFontFamily, extractBaseFontFamily)}
            </Select.Trigger>
            <Select.Content>
              {#each fontSelectItems as item (item.value)}
                <Select.Item value={item.value} label={item.label}>
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
            <div class="flex items-center justify-between">
              <Label class="field-label">Size (pt)</Label>
              {#if hasMixedFontSize}
                <span class="text-[10px] text-muted-foreground font-medium">Mixed</span>
              {/if}
            </div>
            <Input 
              type="number" 
              bind:value={editFontSize} 
              onchange={() => applyChanges()}
              onkeydown={(e) => e.key === 'Enter' && applyChanges()}
              placeholder={hasMixedFontSize ? 'Mixed' : ''}
              class="h-8 text-xs w-full" 
              min="1"
              step="0.5"
            />
          </div>
        </div>

        <!-- Row 1: Formatting Controls & Line Height -->
        <div class="flex items-end gap-2 mt-0.5 w-full">
          <div class="flex flex-col gap-1 shrink-0">
            <Label class="field-label">Formatting</Label>
            <ButtonGroup variant="outline" size="sm" class="h-8">
              <Button
                variant={editFontWeight === 'bold' ? 'default' : 'outline'}
                size="sm"
                class="h-8 w-8 p-0"
                onclick={() => toggleFormatting('bold')}
                aria-label="Bold"
                aria-pressed={editFontWeight === 'bold'}
                title="Bold (Ctrl+B)"
              >
                <Bold class="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={editFontStyle === 'italic' ? 'default' : 'outline'}
                size="sm"
                class="h-8 w-8 p-0"
                onclick={() => toggleFormatting('italic')}
                aria-label="Italic"
                aria-pressed={editFontStyle === 'italic'}
                title="Italic (Ctrl+I)"
              >
                <Italic class="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={editUnderline ? 'default' : 'outline'}
                size="sm"
                class="h-8 w-8 p-0"
                onclick={() => toggleFormatting('underline')}
                aria-label="Underline"
                aria-pressed={editUnderline}
                title="Underline (Ctrl+U)"
              >
                <Underline class="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={editStrikethrough ? 'default' : 'outline'}
                size="sm"
                class="h-8 w-8 p-0"
                onclick={() => toggleFormatting('strikethrough')}
                aria-label="Strikethrough"
                aria-pressed={editStrikethrough}
                title="Strikethrough"
              >
                <Strikethrough class="h-3.5 w-3.5" />
              </Button>
            </ButtonGroup>
          </div>

          <div class="flex flex-col gap-1 flex-1 min-w-0">
            <Label class="field-label">Line Height (pt)</Label>
            <Input 
              type="text" 
              bind:value={editLineHeight}
              placeholder="Auto"
              onchange={() => applyChanges()}
              onkeydown={(e) => e.key === 'Enter' && applyChanges()}
              class="h-8 text-xs w-full" 
            />
          </div>
        </div>

        <!-- Row 2: Color & Highlight / Background -->
        <div class="grid grid-cols-2 gap-2 mt-0.5 w-full">
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

        <!-- Letter Spacing -->
        <div class="flex flex-col gap-1 mt-0.5 w-full">
          <Label class="field-label">Letter Spacing</Label>
          <Input 
            type="text" 
            bind:value={editLetterSpacing}
            onchange={() => applyChanges()}
            onkeydown={(e) => e.key === 'Enter' && applyChanges()}
            placeholder="0%"
            class="h-8 text-xs w-full" 
          />
        </div>

        <!-- Alignment -->
        <div class="flex flex-col gap-1 mt-0.5 mb-1 w-full">
          <Label class="field-label">Alignment</Label>
          <div class="grid grid-cols-2 gap-2 w-full">
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
{/if}
