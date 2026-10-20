<script lang="ts">
  import { untrack } from 'svelte';
  import type { EditableSpan, EditableTextSpan, EditableImageSpan, EditableShapeSpan, EditableFormFieldSpan, PageCharacter, HighlightRect, TextLine, TextWord, AnnotationItem, PageCropInfo, ColorRgba } from '../../core/types';
  import { CheckSquare, Circle, ChevronDown, PenTool, ScanText, Loader2 } from 'lucide-svelte';
  import { getUnifiedPageCharacters, findUnifiedCharacterAt, findClosestUnifiedCharacter, calculateUnifiedHighlightRects } from '../../services/pdf/unified-text-provider';
  import { ocrResultToSpans } from '../../services/ocr/ocr-span-converter';
  import { useEditorStore, getFileBuffer, setFileBuffer } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useSelection } from '../../stores/selection.svelte';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import { safeClone } from '../../utils/clone-utils';
  import type { Command } from '../../core/command';
  import { collectEraserCandidates, resolveUpperZCandidate, type LastErasedState } from '../../services/eraser/eraser-engine';
  import type { CanvasElement } from '../../stores/canvas-types';
  import { extractBaseFontFamily } from '../../services/pdf/font-charset-index';
  import { isBoldFontName, isItalicFontName } from '../../core/pdfium-helpers';
  import { getCssFontFamily } from '../../services/font-loader';
  import { sanitizePdfText, parseColor } from '../../services/pdf/utils';
  import { computeLineLayoutStyle, computeSpanFallbackLayoutStyle } from '../../services/pdf/text-layer-layout';
  import {
    formatScaledCssLetterSpacing,
    formatScaledCssWordSpacing,
    computeHalfLeadingTopOffsetPts,
    computeInterLineExtraGapPts,
    parseLetterSpacingToPoints,
  } from '../../core/typography-metrics';
  import CropOverlay from './CropOverlay.svelte';
  import DigitalSignaturePlacementOverlay from './DigitalSignaturePlacementOverlay.svelte';
  import {
    isInspectorControlTarget,
    setActiveEditorSelection,
    getActiveEditorSelection,
    getSelectionCharOffsets,
    setSelectionCharOffsets,
    resolveTextDecoration,
    UNICODE_LEADING_WS_REGEX,
    findBestMatchingOrigLine,
    resolveInlineKeyAction,
  } from '../../utils/text-range-utils';
  import { decomposeSpansIntoWordSpans } from '../../utils/selection-utils';
  import CanvasElementLayer from './CanvasElementLayer.svelte';
  import SelectionOverlay from './SelectionOverlay.svelte';
  import PdfFormLayer from './PdfFormLayer.svelte';
  import type { HandlePosition, PathElement } from '../../stores/canvas-types';
  import { SetPageTransformCommand, RotatePageCommand, AddElementCommand, CompoundCommand } from '../../commands';
  import { screenToPageCoords, doRectanglesIntersect } from '../../utils/geometry';
  import { useElementRegistry } from '../../core/element-registry';
  import { useToolRegistry } from '../../core/tool-registry';
  import { useWebMcpStore } from '../../stores/webmcp.svelte';
  import { useFeatureFlagStore, tryUseFeatureFlagStore } from '../../core/feature-flags';

  void [RotatePageCommand, CheckSquare, Circle, ChevronDown, PenTool];

  interface Props {
    pageIndex: number;
  }

  let { pageIndex }: Props = $props();

  const store = useEditorStore();
  const actions = useEditorActions();
  const selection = useSelection();
  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();
  const elementRegistry = useElementRegistry();
  const toolRegistry = useToolRegistry();
  const activeToolDef = $derived(toolRegistry.has(store.activeTool) ? toolRegistry.get(store.activeTool) : null);

  let webMcpStore: ReturnType<typeof useWebMcpStore> | null = null;
  try {
    webMcpStore = useWebMcpStore();
  } catch {
    // Context may not be present in isolated test runners
  }

  function resolveFeatureFlags(): ReturnType<typeof useFeatureFlagStore> | null {
    try {
      return useFeatureFlagStore();
    } catch {
      return null;
    }
  }
  const featureFlags = tryUseFeatureFlagStore() ?? resolveFeatureFlags();

  // Evaluates whether page-level optical character recognition capabilities are active
  const canRecognizePage = $derived(
    Boolean(
      featureFlags?.isEnabled('ocr') &&
      featureFlags?.isEnabled('ocr.recognize') &&
      featureFlags?.isEnabled('page-actions.ocr')
    )
  );

  const pageAgentHighlights = $derived(
    webMcpStore?.transientHighlights.filter((h) => h.pageIndex === pageIndex) || []
  );

  let canvasContainerEl: HTMLDivElement | null = $state(null);
  let containerWrapperEl: HTMLDivElement | null = $state(null);
  let editableSpans = $state.raw<EditableTextSpan[]>([]);
  let editableImageSpans = $state.raw<EditableImageSpan[]>([]);
  let editableShapeSpans = $state.raw<EditableShapeSpan[]>([]);
  let editableFormFieldSpans = $state.raw<EditableFormFieldSpan[]>([]);
  let pageCharacters = $state.raw<PageCharacter[]>([]);
  let isMarqueeActive = $state(false);
  let marqueeStart = $state<{ x: number; y: number } | null>(null);
  let marqueeCurrent = $state<{ x: number; y: number } | null>(null);
  let marqueeAdditive = $state(false);
  let justFinishedMarquee = $state(false);

  const marqueeRect = $derived.by(() => {
    if (!marqueeStart || !marqueeCurrent) return null;
    return {
      x: Math.min(marqueeStart.x, marqueeCurrent.x),
      y: Math.min(marqueeStart.y, marqueeCurrent.y),
      width: Math.abs(marqueeCurrent.x - marqueeStart.x),
      height: Math.abs(marqueeCurrent.y - marqueeStart.y),
    };
  });

  function sortByAreaDescending<T extends { width: number; height: number }>(items: T[]): T[] {
    return items.slice().sort((a, b) => (b.width * b.height) - (a.width * a.height));
  }

  const effectiveTextSpans = $derived.by(() => {
    if (store.selectMode === 'precise') {
      return decomposeSpansIntoWordSpans(editableSpans);
    }
    return editableSpans;
  });

  const allSpans = $derived([
    ...sortByAreaDescending<EditableSpan>([...editableImageSpans, ...editableShapeSpans]),
    ...effectiveTextSpans,
    ...editableFormFieldSpans,
  ]);

  function doesShapeOverlapTextLine(shape: EditableShapeSpan): boolean {
    const sRight = shape.left + shape.width;
    const sBottom = shape.top + shape.height;
    for (const tSpan of editableSpans) {
      if (
        tSpan.left >= sRight ||
        tSpan.left + tSpan.width <= shape.left ||
        tSpan.top >= sBottom ||
        tSpan.top + tSpan.height <= shape.top
      ) {
        continue;
      }
      if (tSpan.lines && tSpan.lines.length > 0) {
        for (const line of tSpan.lines) {
          if (line.left < sRight && line.right > shape.left && line.top < sBottom && line.bottom > shape.top) {
            return true;
          }
        }
      } else {
        return true;
      }
    }
    return false;
  }

  function getSpanZIndexClass(span: EditableSpan): string {
    if (store.selectedSpan?.id === span.id || (store.isSpanSelected ? store.isSpanSelected(span.id) : false)) return 'z-20';
    if (typeof span.zIndex === 'number') return `z-[${span.zIndex}]`;
    if (span.type === 'form-field') return 'z-[17]';
    if (store.activeTool === 'text' && span.type === 'text') return 'z-[16]';

    const isAnnot = 'pdfAnnotIndex' in span && typeof span.pdfAnnotIndex === 'number' && span.pdfAnnotIndex >= 0;
    const isHighlight =
      (span.type === 'shape' && span.isHighlight) ||
      ('annotSubtype' in span &&
        (span.annotSubtype === 'Highlight' ||
          span.annotSubtype === 'Underline' ||
          span.annotSubtype === 'Squiggly' ||
          span.annotSubtype === 'StrikeOut'));
    const isRedaction = 'annotSubtype' in span && span.annotSubtype === 'Redact';

    if (span.type === 'shape') {
      const isLargeBackground =
        widthPts > 0 && heightPts > 0 && (span.width * span.height) >= (widthPts * heightPts * 0.45);
      if (isLargeBackground) {
        return 'z-[1]';
      }
      if (isRedaction) {
        return 'z-[16]';
      }
      if (isHighlight || doesShapeOverlapTextLine(span)) {
        return 'z-[12]';
      }
      return 'z-[16]';
    }

    if (span.type === 'image') {
      const isFullPageScan =
        widthPts > 0 && heightPts > 0 && (span.width * span.height) >= (widthPts * heightPts * 0.5);
      return isFullPageScan ? 'z-[1]' : 'z-[16]';
    }

    if (isAnnot) {
      return 'z-[16]';
    }

    if (span.type === 'text') return 'z-[15]';
    return 'z-[1]';
  }

  function getInitialDimensions(): { widthPts: number; heightPts: number } {
    try {
      if (actions.service.document) {
        return actions.service.document.getPageDimensions(pageIndex);
      }
    } catch {
      // Document or page might not be available during isolated unit test runs
    }
    return { widthPts: 0, heightPts: 0 };
  }

  const initialDims = getInitialDimensions();
  let widthPts = $state(initialDims.widthPts);
  let heightPts = $state(initialDims.heightPts);
  // svelte-ignore state_referenced_locally
  let isVisible = $state(pageIndex === store.currentPageIndex);

  let cachedVersion = -1;
  let cachedPageVersion = -1;
  let hasExtracted = false;

  /** Cleanup function for any active window-level drag listeners on this page. */
  let activeDragCleanup: (() => void) | null = null;

  // Ensure dangling global listeners are removed if this component unmounts mid-drag.
  $effect(() => {
    return () => {
      if (activeDragCleanup) {
        activeDragCleanup();
        activeDragCleanup = null;
      }
    };
  });

  const visualScale = $derived(store.zoom);
  let renderScale = $state(store.zoom);
  let zoomTimeout: ReturnType<typeof setTimeout>;

  $effect(() => {
    const currentZoom = store.zoom;
    if (!store.isZooming) {
      clearTimeout(zoomTimeout);
      renderScale = currentZoom;
    } else {
      clearTimeout(zoomTimeout);
      zoomTimeout = setTimeout(() => {
        renderScale = currentZoom;
      }, 150);
    }

    return () => {
      clearTimeout(zoomTimeout);
    };
  });

  const showTextLayer = $derived((store.isReadOnly || store.selectMode === 'text') && !store.showOrganizerView && isVisible);
  const showOverlays = $derived(!store.isReadOnly && store.selectMode !== 'text' && !store.showOrganizerView && (store.activeTool === 'select' || store.activeTool === 'text' || store.activeTool === 'highlight' || store.activeTool === 'pen' || store.activeTool === 'redact' || store.activeTool === 'note' || store.activeTool === 'eraser') && isVisible);

  const unifiedCharacters = $derived(
    (store.activeTool === 'highlight' || store.activeTool === 'redact' || store.activeTool === 'pen') && isVisible
      ? getUnifiedPageCharacters(pageIndex, pageCharacters, canvasStore.getElementsByPage(pageIndex))
      : []
  );

  function populateInlineLines(node: HTMLElement, lines: TextLine[], span: EditableTextSpan): void {
    node.innerHTML = '';
    const isBulletSpan = Boolean(span.hasBulletPrefix && span.bulletWord);
    const firstLineTextLeft = isBulletSpan
      ? (lines[0].words && lines[0].words.length > 0
          ? lines[0].words[0].left
          : (span.bulletWord!.right + 6))
      : span.left;
    const bulletIndent = isBulletSpan ? Math.max(0, firstLineTextLeft - span.left) : 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const lineDiv = document.createElement('div');
      lineDiv.className = 'inline-edit-line';
      lineDiv.dataset.lineIdx = `${lineIdx}`;
      const lFontSize = line.fontSize || span.fontSize;
      lineDiv.dataset.fontSize = `${lFontSize}`;
      lineDiv.style.fontSize = `${lFontSize * renderScale}px`;
      lineDiv.style.textAlign = span.textAlign || 'left';
      lineDiv.style.whiteSpace = 'pre';
      const lFontFamily = line.fontFamily || span.fontFamily;
      const lRawFontFamily = line.rawFontFamily || span.rawFontFamily;
      const lMatchedFontFamily = line.matchedFontFamily || span.matchedFontFamily;
      if (lFontFamily) lineDiv.dataset.fontFamily = lFontFamily;
      if (lRawFontFamily) lineDiv.dataset.rawFontFamily = lRawFontFamily;
      if (lMatchedFontFamily) lineDiv.dataset.matchedFontFamily = lMatchedFontFamily;
      lineDiv.style.fontFamily = getCssFontFamily(lFontFamily || lRawFontFamily || lMatchedFontFamily, extractBaseFontFamily);
      const isLineBold = line.fontWeight
        ? line.fontWeight === 'bold'
        : isBoldFontName(lRawFontFamily || lFontFamily);
      const isLineItalic = line.fontStyle
        ? line.fontStyle === 'italic'
        : isItalicFontName(lRawFontFamily || lFontFamily);
      lineDiv.dataset.fontWeight = isLineBold ? 'bold' : 'normal';
      lineDiv.dataset.fontStyle = isLineItalic ? 'italic' : 'normal';
      lineDiv.style.fontWeight = isLineBold ? 'bold' : 'normal';
      lineDiv.style.fontStyle = isLineItalic ? 'italic' : 'normal';
      const lCol = line.color || span.color;
      if (lCol) {
        const alpha = lCol.a !== undefined ? (lCol.a <= 1 ? lCol.a : lCol.a / 255) : 1;
        lineDiv.style.color = `rgba(${lCol.r}, ${lCol.g}, ${lCol.b}, ${alpha})`;
      }
      const lineLh = line.lineHeight || span.lineHeight;
      if (lineLh) {
        lineDiv.dataset.lineHeight = `${lineLh}`;
        lineDiv.style.lineHeight = `${(lineLh * renderScale).toFixed(2)}px`;
        lineDiv.style.height = `${(lineLh * renderScale).toFixed(2)}px`;
      } else {
        lineDiv.style.lineHeight = '1.25';
      }
      if (lineIdx > 0) {
        const extraGapPts = computeInterLineExtraGapPts(lines[lineIdx - 1], line, span.lineHeight);
        if (Math.abs(extraGapPts) > 0.02) {
          lineDiv.dataset.marginTop = `${extraGapPts}`;
          lineDiv.style.marginTop = `${(extraGapPts * renderScale).toFixed(2)}px`;
        }
      }
      const lineLs = line.letterSpacing || span.letterSpacing;
      if (lineLs && lineLs !== 'normal') {
        lineDiv.dataset.letterSpacing = lineLs;
        lineDiv.style.letterSpacing = formatScaledCssLetterSpacing(lineLs, lFontSize, renderScale);
      } else {
        lineDiv.style.letterSpacing = 'normal';
      }
      const lineWs = line.wordSpacing ?? span.wordSpacing;
      if (lineWs !== undefined && Math.abs(lineWs) >= 0.05) {
        lineDiv.dataset.wordSpacing = `${lineWs}`;
        lineDiv.style.wordSpacing = formatScaledCssWordSpacing(lineWs, renderScale);
      } else {
        lineDiv.style.wordSpacing = 'normal';
      }

      // Render bullet prefix as a non-editable decorator on the first line (or any line with a bullet prefix)
      if (line.hasBulletPrefix && line.bulletWord) {
        const bulletSpan = document.createElement('span');
        bulletSpan.className = 'inline-bullet-decorator select-none';
        bulletSpan.contentEditable = 'false';
        bulletSpan.dataset.bulletDecorator = 'true';
        bulletSpan.style.userSelect = 'none';
        bulletSpan.style.pointerEvents = 'none';
        bulletSpan.style.display = 'inline-block';
        bulletSpan.style.lineHeight = '1';
        const bFs = line.bulletWord.fontSize || line.fontSize || span.fontSize;
        bulletSpan.dataset.fontSize = `${bFs}`;
        bulletSpan.style.fontSize = `${bFs * renderScale}px`;
        bulletSpan.style.fontFamily = getCssFontFamily(line.bulletWord.fontFamily || line.bulletWord.rawFontFamily || line.bulletWord.matchedFontFamily || line.fontFamily || line.rawFontFamily || line.matchedFontFamily || span.fontFamily || span.rawFontFamily || span.matchedFontFamily, extractBaseFontFamily);
        const isBold = line.bulletWord.fontWeight ? line.bulletWord.fontWeight === 'bold' : isBoldFontName(line.bulletWord.rawFontFamily || line.bulletWord.fontFamily);
        const isItalic = line.bulletWord.fontStyle ? line.bulletWord.fontStyle === 'italic' : isItalicFontName(line.bulletWord.rawFontFamily || line.bulletWord.fontFamily);
        bulletSpan.style.fontWeight = isBold ? 'bold' : 'normal';
        bulletSpan.style.fontStyle = isItalic ? 'italic' : 'normal';
        const bCol = line.bulletWord.color || line.color || span.color;
        if (bCol) {
          const alpha = bCol.a !== undefined ? (bCol.a <= 1 ? bCol.a : bCol.a / 255) : 1;
          bulletSpan.style.color = `rgba(${bCol.r}, ${bCol.g}, ${bCol.b}, ${alpha})`;
        }
        bulletSpan.textContent = line.bulletWord.text;

        // Preserve horizontal spacing between bullet and first word
        const gap = line.words && line.words.length > 0 ? Math.max(4, line.words[0].left - line.bulletWord.right) : 6;
        bulletSpan.dataset.marginRight = `${gap}`;
        bulletSpan.style.marginRight = `${(gap * renderScale).toFixed(2)}px`;

        lineDiv.appendChild(bulletSpan);
      } else if (isBulletSpan && lineIdx > 0 && bulletIndent > 0.5) {
        // Wrapped line inside a bullet list item: indent to align with text after bullet
        lineDiv.dataset.paddingLeft = `${bulletIndent}`;
        lineDiv.style.paddingLeft = `${(bulletIndent * renderScale).toFixed(2)}px`;
      } else if ((span.textAlign || 'left') === 'left') {
        const relativeIndent = Math.max(0, line.left - span.left);
        if (relativeIndent > 1.0) {
          lineDiv.dataset.paddingLeft = `${relativeIndent}`;
          lineDiv.style.paddingLeft = `${(relativeIndent * renderScale).toFixed(2)}px`;
        }
      }

      if (line.words && line.words.length > 0) {
        for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
          const word = line.words[wIdx];
          const isWordUnderline = Boolean(word.underline ?? line.underline ?? span.underline);
          const isWordStrike = Boolean(word.strikethrough ?? line.strikethrough ?? span.strikethrough);

          if (wIdx > 0) {
            const prev = line.words[wIdx - 1];
            const prevUnderline = Boolean(prev.underline ?? line.underline ?? span.underline);
            const prevStrike = Boolean(prev.strikethrough ?? line.strikethrough ?? span.strikethrough);
            const gap = word.left - prev.right;
            const hasSpaceBetween =
              word.hasPrecedingSpace !== undefined
                ? Boolean(word.hasPrecedingSpace)
                : gap >= Math.min(prev.fontSize, word.fontSize) * 0.18;
            if (hasSpaceBetween) {
              const sharedUnderline = prevUnderline && isWordUnderline;
              const sharedStrike = prevStrike && isWordStrike;
              if (sharedUnderline || sharedStrike) {
                const spaceSpan = document.createElement('span');
                spaceSpan.style.lineHeight = '1';
                spaceSpan.style.textDecoration = resolveTextDecoration(sharedUnderline, sharedStrike);
                spaceSpan.textContent = ' ';
                lineDiv.appendChild(spaceSpan);
              } else {
                lineDiv.appendChild(document.createTextNode(' '));
              }
            }
          }
          const wordSpan = document.createElement('span');
          wordSpan.dataset.wordIdx = `${wIdx}`;
          const wFs = word.fontSize || line.fontSize || span.fontSize;
          wordSpan.dataset.fontSize = `${wFs}`;
          const canonicalWordFont = word.fontFamily || line.fontFamily || span.fontFamily;
          if (canonicalWordFont) {
            wordSpan.dataset.fontFamily = canonicalWordFont;
          }
          const rawWordFont = word.rawFontFamily || line.rawFontFamily || span.rawFontFamily;
          if (rawWordFont) {
            wordSpan.dataset.rawFontFamily = rawWordFont;
          }
          const matchedWordFont = word.matchedFontFamily || line.matchedFontFamily || span.matchedFontFamily;
          if (matchedWordFont) {
            wordSpan.dataset.matchedFontFamily = matchedWordFont;
          }
          if (word.hasPrecedingSpace) {
            wordSpan.dataset.hasPrecedingSpace = 'true';
          }
          const wordLs = word.letterSpacing || line.letterSpacing || span.letterSpacing;
          if (wordLs && wordLs !== 'normal') {
            wordSpan.dataset.letterSpacing = wordLs;
            wordSpan.style.letterSpacing = formatScaledCssLetterSpacing(wordLs, wFs, renderScale);
          }
          wordSpan.style.fontSize = `${wFs * renderScale}px`;
          wordSpan.style.lineHeight = '1';
          wordSpan.style.fontFamily = getCssFontFamily(word.fontFamily || word.rawFontFamily || word.matchedFontFamily || line.fontFamily || line.rawFontFamily || line.matchedFontFamily || span.fontFamily || span.rawFontFamily || span.matchedFontFamily, extractBaseFontFamily);
          const isBold = word.fontWeight ? word.fontWeight === 'bold' : isBoldFontName(word.rawFontFamily || word.fontFamily || line.rawFontFamily);
          const isItalic = word.fontStyle ? word.fontStyle === 'italic' : isItalicFontName(word.rawFontFamily || word.fontFamily || line.rawFontFamily);
          wordSpan.dataset.fontWeight = isBold ? 'bold' : 'normal';
          wordSpan.dataset.fontStyle = isItalic ? 'italic' : 'normal';
          wordSpan.style.fontWeight = isBold ? 'bold' : 'normal';
          wordSpan.style.fontStyle = isItalic ? 'italic' : 'normal';
          if (word.color) {
            const col = word.color;
            const alpha = col.a !== undefined ? (col.a <= 1 ? col.a : col.a / 255) : 1;
            wordSpan.style.color = `rgba(${col.r}, ${col.g}, ${col.b}, ${alpha})`;
          }
          wordSpan.style.textDecoration = resolveTextDecoration(isWordUnderline, isWordStrike);
          wordSpan.style.backgroundColor = word.backgroundColor || 'transparent';
          wordSpan.textContent = word.text;
          lineDiv.appendChild(wordSpan);
        }
      } else {
        const isLineUnderline = Boolean(line.underline ?? span.underline);
        const isLineStrike = Boolean(line.strikethrough ?? span.strikethrough);
        if (isLineUnderline || isLineStrike) {
          const textSpan = document.createElement('span');
          textSpan.style.lineHeight = '1';
          textSpan.style.textDecoration = resolveTextDecoration(isLineUnderline, isLineStrike);
          textSpan.textContent = line.text;
          lineDiv.appendChild(textSpan);
        } else {
          lineDiv.appendChild(document.createTextNode(line.text));
        }
      }
      node.appendChild(lineDiv);
    }
  }

  let inlineEditorEl = $state<HTMLDivElement | null>(null);
  let isInternalInlineTyping = false;

  function handleInlineSelectionUpdate(target: HTMLElement): void {
    if (!store.inlineEdit) return;
    const offsets = getSelectionCharOffsets(target);
    if (offsets) {
      setActiveEditorSelection({
        mode: 'pdf',
        targetId: store.inlineEdit.span.id,
        start: offsets.start,
        end: offsets.end,
        text: offsets.text,
        container: target,
      });
    }
  }

  $effect(() => {
    const edit = store.inlineEdit;
    if (edit && edit.span.pageIndex === pageIndex && inlineEditorEl && !isSubmittingInlineEdit) {
      const styledLines = edit.styledLines;
      const _spanLineHeight = edit.span.lineHeight;
      const _spanLetterSpacing = edit.span.letterSpacing;
      void _spanLineHeight;
      void _spanLetterSpacing;
      const activeSel = getActiveEditorSelection();
      if (styledLines && styledLines.length > 0 && activeSel && activeSel.mode === 'pdf' && activeSel.targetId === edit.span.id) {
        if (!isInternalInlineTyping) {
          populateInlineLines(inlineEditorEl, styledLines, edit.span);
          setSelectionCharOffsets(inlineEditorEl, activeSel.start, activeSel.end);
          inlineEditorEl.focus({ preventScroll: true });
          handleInlineSelectionUpdate(inlineEditorEl);
        }
      }
    }
  });

  $effect(() => {
    const currentScale = renderScale;
    const currentAlign = store.inlineEdit?.span.textAlign || 'left';
    const currentSpanLh = store.inlineEdit?.span.lineHeight;
    const currentSpanLs = store.inlineEdit?.span.letterSpacing;
    const currentSpanWs = store.inlineEdit?.span.wordSpacing;
    if (inlineEditorEl && store.inlineEdit && store.inlineEdit.span.pageIndex === pageIndex) {
      const spanFs = store.inlineEdit.span.fontSize;
      inlineEditorEl.style.textAlign = currentAlign;
      inlineEditorEl.style.lineHeight = currentSpanLh ? `${(currentSpanLh * currentScale).toFixed(2)}px` : '1.25';
      inlineEditorEl.style.letterSpacing = formatScaledCssLetterSpacing(currentSpanLs, spanFs, currentScale);
      inlineEditorEl.style.wordSpacing = formatScaledCssWordSpacing(currentSpanWs, currentScale);
      const lineEls = inlineEditorEl.querySelectorAll<HTMLElement>('.inline-edit-line');
      const isBulletSpan = Boolean(store.inlineEdit.span.hasBulletPrefix && store.inlineEdit.span.bulletWord);
      lineEls.forEach((lEl, lIdx) => {
        lEl.style.textAlign = currentAlign;
        const lineFs = lEl.dataset.fontSize ? parseFloat(lEl.dataset.fontSize) : null;
        if (lineFs) {
          lEl.style.fontSize = `${lineFs * currentScale}px`;
        }
        const lineH = lEl.dataset.lineHeight ? parseFloat(lEl.dataset.lineHeight) : currentSpanLh;
        if (lineH) {
          lEl.style.lineHeight = `${(lineH * currentScale).toFixed(2)}px`;
          lEl.style.height = `${(lineH * currentScale).toFixed(2)}px`;
        }
        const mTop = lEl.dataset.marginTop ? parseFloat(lEl.dataset.marginTop) : 0;
        if (!isNaN(mTop) && Math.abs(mTop) > 0.02) {
          lEl.style.marginTop = `${(mTop * currentScale).toFixed(2)}px`;
        } else {
          lEl.style.marginTop = '0px';
        }
        const lineLs = lEl.dataset.letterSpacing || currentSpanLs;
        lEl.style.letterSpacing = formatScaledCssLetterSpacing(lineLs, lineFs || spanFs, currentScale);
        const lineWs = lEl.dataset.wordSpacing ? parseFloat(lEl.dataset.wordSpacing) : currentSpanWs;
        lEl.style.wordSpacing = formatScaledCssWordSpacing(lineWs, currentScale);
        const padLeft = lEl.dataset.paddingLeft ? parseFloat(lEl.dataset.paddingLeft) : null;
        if (padLeft && (currentAlign === 'left' || (isBulletSpan && lIdx > 0))) {
          lEl.style.paddingLeft = `${(padLeft * currentScale).toFixed(2)}px`;
        } else {
          lEl.style.paddingLeft = '0px';
        }
      });

      const spanEls = inlineEditorEl.querySelectorAll<HTMLElement>('span[data-font-size]');
      spanEls.forEach((sEl) => {
        const fs = parseFloat(sEl.dataset.fontSize!);
        if (!isNaN(fs) && fs > 0) {
          sEl.style.fontSize = `${fs * currentScale}px`;
        }
        if (sEl.dataset.letterSpacing) {
          sEl.style.letterSpacing = formatScaledCssLetterSpacing(sEl.dataset.letterSpacing, fs || spanFs, currentScale);
        }
        if (sEl.dataset.marginRight) {
          const mr = parseFloat(sEl.dataset.marginRight);
          if (!isNaN(mr)) {
            sEl.style.marginRight = `${(mr * currentScale).toFixed(2)}px`;
          }
        }
      });
    }
  });

  function focusInlineEditable(node: HTMLElement): { destroy(): void } {
    const span = store.inlineEdit?.span;
    const linesToRender = store.inlineEdit?.styledLines || span?.lines;
    if (span && linesToRender && linesToRender.length > 0) {
      populateInlineLines(node, linesToRender, span);
    } else {
      if (span?.hasBulletPrefix && span.bulletWord) {
        node.innerHTML = '';
        const bulletSpan = document.createElement('span');
        bulletSpan.className = 'inline-bullet-decorator select-none';
        bulletSpan.contentEditable = 'false';
        bulletSpan.dataset.bulletDecorator = 'true';
        bulletSpan.style.userSelect = 'none';
        bulletSpan.style.pointerEvents = 'none';
        bulletSpan.style.display = 'inline-block';
        bulletSpan.style.marginRight = '6px';
        bulletSpan.textContent = span.bulletWord.text;
        node.appendChild(bulletSpan);
        const textToEdit = store.inlineEdit?.textValue ?? (store.selectedSpan?.type === 'text' ? store.selectedSpan.text : '');
        node.appendChild(document.createTextNode(textToEdit));
      } else {
        const textToEdit = store.inlineEdit?.textValue ?? (store.selectedSpan?.type === 'text' ? store.selectedSpan.text : '');
        node.innerText = textToEdit;
      }
    }

    let isDestroyed = false;
    queueMicrotask(() => {
      if (isDestroyed) return;
      node.focus({ preventScroll: true });
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        const firstLine = node.querySelector('.inline-edit-line');
        if (firstLine) {
          // Select starting from first editable text node (skip non-editable bullet)
          let startNode: Node = firstLine;
          for (let i = 0; i < firstLine.childNodes.length; i++) {
            const child = firstLine.childNodes[i];
            if (child instanceof HTMLElement && child.getAttribute('contenteditable') === 'false') {
              continue;
            }
            startNode = child;
            break;
          }
          range.setStartBefore(startNode);
          range.setEndAfter(node.lastChild || node);
        } else {
          range.selectNodeContents(node);
        }
        sel.removeAllRanges();
        sel.addRange(range);
        const offsets = getSelectionCharOffsets(node);
        if (offsets && store.inlineEdit) {
          setActiveEditorSelection({
            mode: 'pdf',
            targetId: store.inlineEdit.span.id,
            start: offsets.start,
            end: offsets.end,
            text: offsets.text,
            container: node,
          });
        }
      }
    });

    return {
      destroy() {
        isDestroyed = true;
        if (typeof window !== 'undefined' && typeof window.getSelection === 'function') {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const anchor = sel.anchorNode;
            if (anchor && (anchor === node || node.contains(anchor))) {
              sel.removeAllRanges();
            }
          }
        }
        if (getActiveEditorSelection()?.targetId === span?.id) {
          setActiveEditorSelection(null);
        }
      },
    };
  }

  /**
   * Extracts structured line and styled segment data directly from the inline editor DOM node.
   * Excludes non-editable bullet decorators from editable text while preserving bullet metadata.
   *
   * @param node The contenteditable container element.
   * @param scale Current viewport visual scale.
   * @param span Original editable text span being edited.
   * @return Object containing sanitized plain text string and structured TextLine array.
   */
  function extractStyledLinesFromEditor(
    node: HTMLElement,
    _scale: number,
    span: EditableTextSpan
  ): { text: string; lines: TextLine[] } {
    const isBulletSpan = Boolean(span.hasBulletPrefix && span.bulletWord);
    const firstLineTextLeft = isBulletSpan
          ? (span.lines && span.lines.length > 0 && span.lines[0].words && span.lines[0].words.length > 0
          ? span.lines[0].words[0].left
          : (span.bulletWord!.right + 6))
      : span.left;

    // Collect child node arrays for each distinct line in the editor DOM
    const rawLineNodeGroups: Node[][] = [];
    const directChildren = Array.from(node.childNodes);
    const hasBlockChildren = directChildren.some(
      (c) => c instanceof HTMLElement && (c.tagName === 'DIV' || c.tagName === 'P')
    );

    if (hasBlockChildren) {
      directChildren.forEach((child) => {
        if (child instanceof HTMLElement && child.getAttribute('contenteditable') === 'false') {
          return;
        }
        if (child instanceof HTMLElement && (child.tagName === 'DIV' || child.tagName === 'P')) {
          const blockNodes = Array.from(child.childNodes);
          if (blockNodes.length === 1 && blockNodes[0].nodeName === 'BR') {
            rawLineNodeGroups.push([]);
          } else {
            let currentGroup: Node[] = [];
            for (let i = 0; i < blockNodes.length; i++) {
              const subChild = blockNodes[i];
              if (subChild.nodeName === 'BR') {
                rawLineNodeGroups.push(currentGroup);
                currentGroup = [];
              } else {
                currentGroup.push(subChild);
              }
            }
            if (currentGroup.length > 0 || blockNodes.length === 0) {
              rawLineNodeGroups.push(currentGroup);
            }
          }
        } else if (child.nodeName === 'BR') {
          rawLineNodeGroups.push([]);
        } else {
          if (rawLineNodeGroups.length === 0) {
            rawLineNodeGroups.push([child]);
          } else {
            rawLineNodeGroups[rawLineNodeGroups.length - 1].push(child);
          }
        }
      });
    } else {
      let currentGroup: Node[] = [];
      for (let i = 0; i < directChildren.length; i++) {
        const child = directChildren[i];
        if (child.nodeName === 'BR') {
          rawLineNodeGroups.push(currentGroup);
          currentGroup = [];
        } else {
          currentGroup.push(child);
        }
      }
      if (currentGroup.length > 0 || directChildren.length === 0) {
        rawLineNodeGroups.push(currentGroup);
      }
    }

    if (rawLineNodeGroups.length === 0) {
      return { text: '', lines: [] };
    }

    const lines: TextLine[] = [];
    const textPieces: string[] = [];
    let cumulativeTop = span.top;
    let cumulativeBaselineY = span.baselineY;
    let prevExtractedLineLh = span.lineHeight ?? span.fontSize * 1.25;

    rawLineNodeGroups.forEach((childNodes, lineIdx) => {
      let lineText = '';
      childNodes.forEach((child) => {
        if (child instanceof HTMLElement && child.getAttribute('contenteditable') === 'false') {
          return;
        }
        if (child.nodeName === 'BR') {
          return;
        }
        lineText += child.textContent || '';
      });
      lineText = sanitizePdfText(lineText).replace(/[\r\n]+/g, ' ').trim();
      textPieces.push(lineText);

      const parentLineEl =
        childNodes.length > 0 &&
        childNodes[0].parentElement instanceof HTMLElement &&
        childNodes[0].parentElement !== node
          ? childNodes[0].parentElement
          : null;
      const domLineIdx = parentLineEl?.dataset.lineIdx !== undefined
        ? parseInt(parentLineEl.dataset.lineIdx, 10)
        : NaN;

      const isSameLineCount = Boolean(span.lines && rawLineNodeGroups.length === span.lines.length);
      const origLine = isSameLineCount
        ? span.lines![lineIdx]
        : ((!isNaN(domLineIdx) && span.lines?.[domLineIdx]) ||
            findBestMatchingOrigLine(lineText, span.lines, lineIdx) ||
            span.lines?.[Math.min(lineIdx, (span.lines?.length || 1) - 1)]);

      const domLineLh = parentLineEl?.dataset.lineHeight ? parseFloat(parentLineEl.dataset.lineHeight) : undefined;
      const domLineLs = parentLineEl?.dataset.letterSpacing || undefined;
      const domLineWs = parentLineEl?.dataset.wordSpacing ? parseFloat(parentLineEl.dataset.wordSpacing) : undefined;
      const domMarginTop = parentLineEl?.dataset.marginTop ? parseFloat(parentLineEl.dataset.marginTop) : 0;
      const extraGapPts = !isNaN(domMarginTop) && Math.abs(domMarginTop) > 0.05 ? domMarginTop : 0;
      const lH = (domLineLh && !isNaN(domLineLh) ? domLineLh : undefined) ?? origLine?.lineHeight ?? span.lineHeight ?? (span.fontSize * 1.25);

      let lineTop: number;
      let lineBaselineY: number;
      if (isSameLineCount && origLine?.top !== undefined && origLine?.baselineY !== undefined) {
        lineTop = origLine.top;
        lineBaselineY = origLine.baselineY;
      } else if (lineIdx === 0) {
        lineTop = origLine?.top ?? span.top;
        lineBaselineY = origLine?.baselineY ?? span.baselineY;
      } else {
        const stepPts = 0.5 * prevExtractedLineLh + 0.5 * lH + extraGapPts;
        lineTop = cumulativeTop + stepPts;
        lineBaselineY = cumulativeBaselineY - stepPts;
      }
      const lineBottom = isSameLineCount && origLine?.bottom !== undefined ? origLine.bottom : lineTop + lH;
      cumulativeTop = lineTop;
      cumulativeBaselineY = lineBaselineY;
      prevExtractedLineLh = lH;

      const domLineFontFamily = parentLineEl?.dataset.fontFamily || undefined;
      const domLineRawFontFamily = parentLineEl?.dataset.rawFontFamily || undefined;
      const domLineMatchedFontFamily = parentLineEl?.dataset.matchedFontFamily || undefined;
      const domLineFontWeight = (parentLineEl?.dataset.fontWeight as 'bold' | 'normal' | undefined) || undefined;
      const domLineFontStyle = (parentLineEl?.dataset.fontStyle as 'italic' | 'normal' | undefined) || undefined;

      const words: TextWord[] = [];
      let pendingTextNodeSpace = false;

      childNodes.forEach((child) => {
        if (child instanceof HTMLElement && child.getAttribute('contenteditable') === 'false') {
          return;
        }
        if (child.nodeName === 'BR') {
          return;
        }
        if (child.nodeType === 3) {
          const rawTxt = child.textContent || '';
          if (/[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/.test(rawTxt)) {
            pendingTextNodeSpace = true;
          }
          const trimmed = rawTxt.trim();
          if (trimmed.length > 0) {
            const tokens = trimmed.split(/([\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+)/);
            const adjWord = words.length > 0 ? words[words.length - 1] : origLine?.words?.[0];
            const lineFs = adjWord?.fontSize ?? origLine?.fontSize ?? span.fontSize;
            const approxCharW = lineFs * 0.52;
            for (const token of tokens) {
              if (!token) continue;
              if (/^[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+$/.test(token)) {
                pendingTextNodeSpace = true;
                continue;
              }
              const cleanToken = sanitizePdfText(token);
              if (cleanToken.length === 0) continue;
              const prevWord = words.length > 0 ? words[words.length - 1] : null;
              const refWord = prevWord ?? origLine?.words?.[0];
              const hasPrecedingSpace = pendingTextNodeSpace || (words.length > 0);
              const spaceOffset = hasPrecedingSpace ? lineFs * 0.25 : 0;
              const wLeft = prevWord ? prevWord.right + spaceOffset : (isBulletSpan && lineIdx === 0 ? firstLineTextLeft : (origLine?.left ?? span.left));
              const wWidth = cleanToken.length * approxCharW;
              const fallbackWordLs = refWord?.letterSpacing ?? domLineLs ?? origLine?.letterSpacing ?? span.letterSpacing;
              words.push({
                text: cleanToken,
                left: wLeft,
                top: lineTop,
                right: wLeft + wWidth,
                bottom: lineBottom,
                width: wWidth,
                height: origLine?.height ?? lineFs,
                fontSize: lineFs,
                baselineY: lineBaselineY,
                charStartIndex: 0,
                charCount: cleanToken.length,
                fontFamily: refWord?.fontFamily ?? domLineFontFamily ?? origLine?.fontFamily ?? span.fontFamily,
                rawFontFamily: refWord?.rawFontFamily ?? domLineRawFontFamily ?? origLine?.rawFontFamily ?? span.rawFontFamily,
                matchedFontFamily: refWord?.matchedFontFamily ?? domLineMatchedFontFamily ?? origLine?.matchedFontFamily ?? span.matchedFontFamily,
                color: refWord?.color ?? origLine?.color ?? span.color,
                fontWeight: refWord?.fontWeight ?? domLineFontWeight ?? origLine?.fontWeight ?? span.fontWeight,
                fontStyle: refWord?.fontStyle ?? domLineFontStyle ?? origLine?.fontStyle ?? span.fontStyle,
                ...(fallbackWordLs ? { letterSpacing: fallbackWordLs, letterSpacingPts: parseLetterSpacingToPoints(fallbackWordLs, lineFs) } : {}),
                underline: (refWord?.underline ?? origLine?.underline ?? span.underline) ? true : undefined,
                strikethrough: (refWord?.strikethrough ?? origLine?.strikethrough ?? span.strikethrough) ? true : undefined,
                backgroundColor: refWord?.backgroundColor ?? origLine?.backgroundColor,
                hasPrecedingSpace,
              });
              pendingTextNodeSpace = false;
            }
          }
          return;
        }

        if (child instanceof HTMLElement) {
          const spanEl = child;
          const rawTextContent = spanEl.textContent || '';
          const isUnderline = spanEl.style.textDecoration.includes('underline') || spanEl.tagName === 'U';
          const isStrike = spanEl.style.textDecoration.includes('line-through') || spanEl.tagName === 'S' || spanEl.tagName === 'STRIKE';
          const nodeBg = spanEl.style.backgroundColor;
          const hasValidBg = Boolean(nodeBg && nodeBg !== 'transparent');
          const isCleared = nodeBg === 'transparent';

          let parsedColor: ColorRgba | undefined = undefined;
          if (spanEl.style.color) {
            try {
              const col = parseColor(spanEl.style.color);
              if (col) parsedColor = col;
            } catch {
              // keep existing
            }
          }

          const domFwAttr = spanEl.dataset.fontWeight as 'bold' | 'normal' | undefined;
          const domFsAttr = spanEl.dataset.fontStyle as 'italic' | 'normal' | undefined;
          const fw = spanEl.style.fontWeight === 'bold' || spanEl.style.fontWeight === '700' || spanEl.tagName === 'B' || spanEl.tagName === 'STRONG'
            ? 'bold'
            : (spanEl.style.fontWeight === 'normal' || spanEl.style.fontWeight === '400' ? 'normal' : domFwAttr);
          const fs = spanEl.style.fontStyle === 'italic' || spanEl.tagName === 'I' || spanEl.tagName === 'EM'
            ? 'italic'
            : (spanEl.style.fontStyle === 'normal' ? 'normal' : domFsAttr);

          const rawFSize = spanEl.dataset.fontSize ? parseFloat(spanEl.dataset.fontSize) : (origLine?.fontSize ?? span.fontSize);
          const fSize = !isNaN(rawFSize) && rawFSize > 0 ? rawFSize : (origLine?.fontSize ?? span.fontSize);
          const elementFontFamily = spanEl.dataset.fontFamily || undefined;
          const elementRawFontFamily = spanEl.dataset.rawFontFamily || undefined;
          const elementMatchedFontFamily = spanEl.dataset.matchedFontFamily || undefined;
          const elementLetterSpacing = spanEl.dataset.letterSpacing || undefined;
          const domWordIdx = spanEl.dataset.wordIdx !== undefined ? parseInt(spanEl.dataset.wordIdx, 10) : NaN;

          let hasPrecedingSpaceGlobal = pendingTextNodeSpace;
          if (!hasPrecedingSpaceGlobal) {
            let prevNode = spanEl.previousSibling;
            while (prevNode) {
              if (prevNode instanceof HTMLElement && prevNode.getAttribute('contenteditable') === 'false') {
                prevNode = prevNode.previousSibling;
                continue;
              }
              if (prevNode.nodeType === 3) {
                const txt = prevNode.textContent || '';
                if (/[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/.test(txt)) {
                  hasPrecedingSpaceGlobal = true;
                }
                break;
              }
              if (prevNode instanceof HTMLElement) {
                break;
              }
              prevNode = prevNode.previousSibling;
            }
          }
          if (!hasPrecedingSpaceGlobal && spanEl.dataset.hasPrecedingSpace === 'true') {
            hasPrecedingSpaceGlobal = true;
          }

          if (/[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]$/.test(rawTextContent)) {
            pendingTextNodeSpace = true;
          } else {
            pendingTextNodeSpace = false;
          }

          const tokens = rawTextContent.split(/([\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+)/);

          for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (!token) continue;
            if (/^[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+$/.test(token)) {
              hasPrecedingSpaceGlobal = true;
              continue;
            }
            const wordText = sanitizePdfText(token);
            if (wordText.length === 0) continue;

            const candidateWord = origLine?.words?.[words.length];
            const indexedWord = !isNaN(domWordIdx) ? origLine?.words?.[domWordIdx] : undefined;
            const origWord = !isNaN(domWordIdx)
              ? (indexedWord && indexedWord.text === wordText ? indexedWord : undefined)
              : (candidateWord && candidateWord.text === wordText
                  ? candidateWord
                  : origLine?.words?.find((w) => w.text === wordText));
            const styleRefWord = indexedWord ?? origWord ?? candidateWord ?? (words.length > 0 ? words[words.length - 1] : origLine?.words?.[0]);

            let hasPrecedingSpace = hasPrecedingSpaceGlobal;
            if (!hasPrecedingSpace && origWord && Boolean(origWord.hasPrecedingSpace)) {
              hasPrecedingSpace = true;
            }
            if (!hasPrecedingSpace && words.length > 0 && i === 0 && UNICODE_LEADING_WS_REGEX.test(rawTextContent)) {
              hasPrecedingSpace = true;
            }

            const bgCol = isCleared ? undefined : (hasValidBg ? nodeBg : styleRefWord?.backgroundColor);
            const finalColor = parsedColor ?? styleRefWord?.color ?? origLine?.color ?? span.color;
            const finalFw = fw ?? styleRefWord?.fontWeight ?? domLineFontWeight ?? origLine?.fontWeight ?? (span.fontWeight || 'normal');
            const finalFs = fs ?? styleRefWord?.fontStyle ?? domLineFontStyle ?? origLine?.fontStyle ?? (span.fontStyle || 'normal');
            const finalLs = elementLetterSpacing ?? styleRefWord?.letterSpacing ?? domLineLs ?? origLine?.letterSpacing ?? span.letterSpacing;

            const approxCharWidth = fSize * 0.52;
            const wordWidth = origWord?.width && origWord.width > 0 ? origWord.width : wordText.length * approxCharWidth;
            const prevWord = words.length > 0 ? words[words.length - 1] : null;
            const spaceOffset = hasPrecedingSpace ? fSize * 0.25 : 0;
            let wordLeft: number;
            if (origWord && (!prevWord || origWord.left >= prevWord.right - 0.5)) {
              wordLeft = origWord.left;
            } else if (prevWord) {
              wordLeft = prevWord.right + spaceOffset;
            } else {
              wordLeft = isBulletSpan && lineIdx === 0 ? firstLineTextLeft : (origLine?.left ?? span.left);
            }
            const wordRight = wordLeft + wordWidth;

            const resolvedWordFontFamily = elementFontFamily || styleRefWord?.fontFamily || domLineFontFamily || origLine?.fontFamily || span.fontFamily;
            const isExplicitFontOverride = Boolean(
              elementFontFamily &&
              styleRefWord?.fontFamily &&
              elementFontFamily !== styleRefWord.fontFamily
            );
            const resolvedWordRawFont = isExplicitFontOverride
              ? elementFontFamily
              : (elementRawFontFamily || styleRefWord?.rawFontFamily || domLineRawFontFamily || origLine?.rawFontFamily || elementFontFamily || span.rawFontFamily);
            const resolvedWordMatchedFont = isExplicitFontOverride
              ? elementFontFamily
              : (elementMatchedFontFamily || styleRefWord?.matchedFontFamily || domLineMatchedFontFamily || origLine?.matchedFontFamily || elementFontFamily || span.matchedFontFamily);

            words.push({
              text: wordText,
              left: wordLeft,
              top: isSameLineCount && origWord?.top !== undefined ? origWord.top : lineTop,
              right: wordRight,
              bottom: isSameLineCount && origWord?.bottom !== undefined ? origWord.bottom : lineBottom,
              width: wordWidth,
              height: origWord?.height ?? origLine?.height ?? fSize,
              fontSize: fSize,
              baselineY: isSameLineCount && origWord?.baselineY !== undefined ? origWord.baselineY : lineBaselineY,
              charStartIndex: 0,
              charCount: wordText.length,
              fontFamily: resolvedWordFontFamily,
              rawFontFamily: resolvedWordRawFont,
              matchedFontFamily: resolvedWordMatchedFont,
              color: finalColor,
              fontWeight: finalFw,
              fontStyle: finalFs,
              ...(finalLs ? { letterSpacing: finalLs, letterSpacingPts: parseLetterSpacingToPoints(finalLs, fSize) } : {}),
              underline: Boolean(isUnderline),
              strikethrough: Boolean(isStrike),
              backgroundColor: bgCol,
              hasPrecedingSpace,
            });
            hasPrecedingSpaceGlobal = false;
          }
        }
      });

      if (words.length === 0 && lineText.length > 0) {
        const rawTokens = lineText.split(/([\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+)/);
        let currentX = isBulletSpan && lineIdx === 0 ? firstLineTextLeft : (origLine?.left ?? span.left);
        let pendingSpace = false;
        const lineFs = origLine?.fontSize ?? span.fontSize;
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

          const refOrigWord = origLine?.words?.[Math.min(words.length, (origLine?.words?.length || 1) - 1)];
          const wW = cleanToken.length * approxCharW;
          const fallbackWordLs = refOrigWord?.letterSpacing ?? domLineLs ?? origLine?.letterSpacing ?? span.letterSpacing;
          words.push({
            text: cleanToken,
            left: currentX,
            top: lineTop,
            right: currentX + wW,
            bottom: lineBottom,
            width: wW,
            height: origLine?.height ?? lineFs,
            fontSize: refOrigWord?.fontSize ?? lineFs,
            baselineY: lineBaselineY,
            charStartIndex: 0,
            charCount: cleanToken.length,
            fontFamily: refOrigWord?.fontFamily ?? domLineFontFamily ?? origLine?.fontFamily ?? span.fontFamily,
            rawFontFamily: refOrigWord?.rawFontFamily ?? domLineRawFontFamily ?? origLine?.rawFontFamily ?? span.rawFontFamily,
            matchedFontFamily: refOrigWord?.matchedFontFamily ?? domLineMatchedFontFamily ?? origLine?.matchedFontFamily ?? span.matchedFontFamily,
            color: refOrigWord?.color ?? origLine?.color ?? span.color,
            fontWeight: refOrigWord?.fontWeight ?? domLineFontWeight ?? origLine?.fontWeight ?? span.fontWeight,
            fontStyle: refOrigWord?.fontStyle ?? domLineFontStyle ?? origLine?.fontStyle ?? span.fontStyle,
            ...(fallbackWordLs ? { letterSpacing: fallbackWordLs, letterSpacingPts: parseLetterSpacingToPoints(fallbackWordLs, lineFs) } : {}),
            underline: (refOrigWord?.underline ?? origLine?.underline ?? span.underline) ? true : undefined,
            strikethrough: (refOrigWord?.strikethrough ?? origLine?.strikethrough ?? span.strikethrough) ? true : undefined,
            backgroundColor: refOrigWord?.backgroundColor ?? origLine?.backgroundColor,
            hasPrecedingSpace,
          });

          currentX += wW;
          pendingSpace = false;
        }
      }

      const allWordsSameFs =
        words.length > 0 && words.every((w) => Math.abs(w.fontSize - words[0].fontSize) <= 0.2);
      const lineFontSize =
        words.length > 0
          ? (allWordsSameFs ? words[0].fontSize : (origLine?.fontSize ?? words[0].fontSize))
          : (origLine?.fontSize ?? span.fontSize);
      const allWordsSameFontFamily = words.length > 0 && Boolean(words[0].fontFamily) && words.every((w) => w.fontFamily === words[0].fontFamily);
      const lineFontFamily = allWordsSameFontFamily
        ? (words[0].fontFamily || words[0].rawFontFamily)
        : (domLineFontFamily ?? origLine?.fontFamily ?? span.fontFamily);
      const allWordsSameRawFont = words.length > 0 && Boolean(words[0].rawFontFamily) && words.every((w) => w.rawFontFamily === words[0].rawFontFamily);
      const lineRawFontFamily = allWordsSameRawFont ? words[0].rawFontFamily : (domLineRawFontFamily ?? origLine?.rawFontFamily ?? span.rawFontFamily);
      const lineMatchedFontFamily = allWordsSameRawFont ? (words[0].matchedFontFamily ?? domLineMatchedFontFamily ?? origLine?.matchedFontFamily ?? span.matchedFontFamily) : (domLineMatchedFontFamily ?? origLine?.matchedFontFamily ?? span.matchedFontFamily);
      const allWordsSameWeight = words.length > 0 && words.every((w) => (w.fontWeight || 'normal') === (words[0].fontWeight || 'normal'));
      const lineFontWeight = allWordsSameWeight && words.length > 0
        ? (words[0].fontWeight as string)
        : (domLineFontWeight ?? origLine?.fontWeight ?? span.fontWeight);
      const allWordsSameStyle = words.length > 0 && words.every((w) => (w.fontStyle || 'normal') === (words[0].fontStyle || 'normal'));
      const lineFontStyle = allWordsSameStyle && words.length > 0
        ? (words[0].fontStyle as string)
        : (domLineFontStyle ?? origLine?.fontStyle ?? span.fontStyle);
      const firstWordColor = words[0]?.color;
      const allWordsSameColor =
        words.length > 0 &&
        firstWordColor !== undefined &&
        words.every(
          (w) =>
            w.color !== undefined &&
            w.color.r === firstWordColor.r &&
            w.color.g === firstWordColor.g &&
            w.color.b === firstWordColor.b &&
            w.color.a === firstWordColor.a
        );
      const lineColor =
        words.length > 0
          ? (allWordsSameColor ? firstWordColor : (origLine?.color ?? firstWordColor ?? span.color))
          : (origLine?.color ?? span.color);

      const allWordsUnderline = words.length > 0 && words.every((w) => Boolean(w.underline));
      const anyWordUnderline = words.some((w) => Boolean(w.underline));
      const allWordsStrike = words.length > 0 && words.every((w) => Boolean(w.strikethrough));
      const anyWordStrike = words.some((w) => Boolean(w.strikethrough));
      const allWordsBg = words.length > 0 && words.every((w) => Boolean(w.backgroundColor) && w.backgroundColor === words[0].backgroundColor);
      const allWordsSameLs = words.length > 0 && words.every((w) => w.letterSpacing === words[0].letterSpacing);
      const lineUnderline = words.length > 0 ? (allWordsUnderline ? true : (anyWordUnderline ? undefined : false)) : (origLine?.underline ?? span.underline);
      const lineStrikethrough = words.length > 0 ? (allWordsStrike ? true : (anyWordStrike ? undefined : false)) : (origLine?.strikethrough ?? span.strikethrough);
      const lineBackgroundColor = words.length > 0 ? (allWordsBg ? words[0].backgroundColor : undefined) : (origLine?.backgroundColor ?? span.backgroundColor);
      const lineLetterSpacing =
        (allWordsSameLs && words[0]?.letterSpacing) ||
        domLineLs ||
        origLine?.letterSpacing ||
        span.letterSpacing;
      const lineWordSpacing =
        (domLineWs !== undefined && !isNaN(domLineWs) ? domLineWs : undefined) ??
        origLine?.wordSpacing ??
        span.wordSpacing;

      lines.push({
        text: lineText,
        left: origLine?.left ?? (isBulletSpan && lineIdx === 0 ? firstLineTextLeft : span.left),
        top: lineTop,
        right: origLine?.right ?? (span.left + span.width),
        bottom: lineBottom,
        width: origLine?.width ?? span.width,
        height: lH,
        fontSize: lineFontSize,
        baselineY: lineBaselineY,
        lineHeight: lH,
        ...(lineLetterSpacing ? { letterSpacing: lineLetterSpacing } : {}),
        ...(lineWordSpacing !== undefined ? { wordSpacing: lineWordSpacing } : {}),
        ...(origLine?.scaleX !== undefined ? { scaleX: origLine.scaleX } : (span.scaleX !== undefined ? { scaleX: span.scaleX } : {})),
        charStartIndex: 0,
        charCount: lineText.length,
        words: words.length > 0 ? words : [],
        fontFamily: lineFontFamily,
        rawFontFamily: lineRawFontFamily,
        matchedFontFamily: lineMatchedFontFamily,
        color: lineColor,
        fontWeight: lineFontWeight,
        fontStyle: lineFontStyle,
        underline: lineUnderline,
        strikethrough: lineStrikethrough,
        backgroundColor: lineBackgroundColor,
        hasBulletPrefix: origLine?.hasBulletPrefix ?? (lineIdx === 0 ? span.hasBulletPrefix : false),
        bulletWord: origLine?.bulletWord ?? (lineIdx === 0 ? span.bulletWord : undefined),
      });
    });

    return {
      text: textPieces.join('\n'),
      lines,
    };
  }



  $effect(() => {
    try {
      store.renderVersion;
      store.pageVersions[pageIndex];
      const dims = actions.service.document.getPageDimensions(pageIndex);
      widthPts = dims.widthPts;
      heightPts = dims.heightPts;
    } catch (err) {
      console.error(`Failed to get dimensions for page ${pageIndex}:`, err);
    }
  });

  $effect(() => {
    store.formFieldVersion;
    if (actions.service?.document) {
      const cached = actions.service.document.getCachedPageSpans(pageIndex);
      if (cached && cached.formFields) {
        editableFormFieldSpans = [...cached.formFields];
      } else if (actions.service.document.hasCachedAcroFormSpans?.()) {
        editableFormFieldSpans = sortByAreaDescending([
          ...actions.service.document.extractFormFieldSpans(pageIndex),
        ]);
      }
    }
  });

  $effect(() => {
    if (!containerWrapperEl) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        isVisible = entry.isIntersecting;
      },
      { rootMargin: '600px 0px' }
    );
    
    observer.observe(containerWrapperEl);
    return () => observer.disconnect();
  });

  function releaseCanvasContainer(container: HTMLElement | null): void {
    if (!container) return;
    const canvases = container.querySelectorAll('canvas');
    for (const c of canvases) {
      c.width = 0;
      c.height = 0;
    }
    container.innerHTML = '';
  }

  function extractOverlaySpansIfNeeded(): void {
    if (!showOverlays && !showTextLayer) {
      return;
    }
    const currentVer = store.renderVersion;
    const currentPgVer = store.pageVersions[pageIndex] || 0;
    const isTextAwareAnnotation = store.activeTool === 'highlight' || store.activeTool === 'redact' || store.activeTool === 'pen';
    if (
      hasExtracted &&
      cachedVersion === currentVer &&
      cachedPageVersion === currentPgVer &&
      (!isTextAwareAnnotation || pageCharacters.length > 0)
    ) {
      return;
    }
    try {
      const cached = actions.service.document?.getCachedPageSpans(pageIndex);
      if (cached) {
        editableSpans = cached.textSpans;
        editableImageSpans = cached.images;
        editableShapeSpans = cached.shapes;
        editableFormFieldSpans = [...cached.formFields];
        if (cached.pageCharacters) {
          pageCharacters = cached.pageCharacters;
        } else if (isTextAwareAnnotation) {
          pageCharacters = actions.service.document.getPage(pageIndex).extractCharacters();
          cached.pageCharacters = pageCharacters;
        }
        if (store.pageOcrResults.has(pageIndex)) {
          const hasOcrMerged = editableSpans.some((s) => s.isOcr || s.id.startsWith(`ocr-span-${pageIndex}`));
          if (!hasOcrMerged) {
            const ocrResult = store.pageOcrResults.get(pageIndex)!;
            const ocrData = ocrResultToSpans(ocrResult);
            editableSpans = sortByAreaDescending([...editableSpans, ...ocrData.textSpans]);
            pageCharacters = [...pageCharacters, ...ocrData.characters];
          }
        }
        const hasAcroCached = typeof actions.service.document?.hasCachedAcroFormSpans === 'function'
          ? actions.service.document.hasCachedAcroFormSpans()
          : true;
        if (!hasAcroCached) {
          actions.service.document.initAcroFormFieldSpans().then((map) => {
            const enriched = map.get(pageIndex);
            if (enriched && enriched.length > 0) {
              editableFormFieldSpans = sortByAreaDescending([...enriched]);
              const currentCached = actions.service.document?.getCachedPageSpans(pageIndex);
              if (currentCached) {
                currentCached.formFields = editableFormFieldSpans;
              }
            }
          }).catch(() => {});
        }
        cachedVersion = currentVer;
        cachedPageVersion = currentPgVer;
        hasExtracted = true;
        return;
      }

      const rawTextSpans = actions.service.document.getPage(pageIndex).extractTextSpans();
      let combinedTextSpans = [...rawTextSpans];
      let combinedCharacters = isTextAwareAnnotation
        ? actions.service.document.getPage(pageIndex).extractCharacters()
        : [];

      if (store.pageOcrResults.has(pageIndex)) {
        const ocrResult = store.pageOcrResults.get(pageIndex)!;
        const ocrData = ocrResultToSpans(ocrResult);
        const filteredOcrSpans = ocrData.textSpans.filter((ocrSpan) => {
          return !rawTextSpans.some(
            (raw) => Math.hypot(raw.left - ocrSpan.left, raw.top - ocrSpan.top) < 4.0 && raw.text.trim() === ocrSpan.text.trim()
          );
        });
        combinedTextSpans = [...combinedTextSpans, ...filteredOcrSpans];
        combinedCharacters = [...combinedCharacters, ...ocrData.characters];
      }

      editableSpans = sortByAreaDescending(combinedTextSpans);
      pageCharacters = combinedCharacters;
      if (store.selectedSpan?.type === 'text' && store.selectedSpan.pageIndex === pageIndex) {
        const sel = store.selectedSpan as EditableTextSpan;
        const matching = editableSpans.find(
          (s) => s.id === sel.id || (Math.abs(s.left - sel.left) < 5 && Math.abs(s.top - sel.top) < 5) || (Math.abs(s.top - sel.top) < 5 && s.text.trim() === sel.text.trim())
        );
        if (matching) {
          if (sel.backgroundColor !== undefined) matching.backgroundColor = sel.backgroundColor;
          if (sel.underline !== undefined) matching.underline = sel.underline;
          if (sel.strikethrough !== undefined) matching.strikethrough = sel.strikethrough;
          if (sel.textAlign !== undefined) matching.textAlign = sel.textAlign;
          if (sel.originalLeft !== undefined) matching.originalLeft = sel.originalLeft;
          if (sel.lines !== undefined) matching.lines = sel.lines;
        }
      }
      const objSpans = actions.service.document.getPage(pageIndex).extractObjects();
      editableImageSpans = sortByAreaDescending(objSpans.images);
      editableShapeSpans = sortByAreaDescending(objSpans.shapes);
      const rawFormFieldSpans = actions.service.document.getPage(pageIndex).extractFormFieldSpans();
      editableFormFieldSpans = sortByAreaDescending(rawFormFieldSpans);
      cachedVersion = currentVer;
      cachedPageVersion = currentPgVer;
      hasExtracted = true;

      actions.service.document?.setCachedPageSpans(pageIndex, {
        textSpans: editableSpans,
        pageCharacters: pageCharacters.length > 0 ? pageCharacters : undefined,
        images: editableImageSpans,
        shapes: editableShapeSpans,
        formFields: editableFormFieldSpans,
      });

      actions.service.document.initAcroFormFieldSpans().then((map) => {
        const enriched = map.get(pageIndex);
        if (enriched && enriched.length > 0) {
          editableFormFieldSpans = sortByAreaDescending([...enriched]);
          const currentCached = actions.service.document?.getCachedPageSpans(pageIndex);
          if (currentCached) {
            currentCached.formFields = editableFormFieldSpans;
          }
        }
      }).catch(() => {});
    } catch (err) {
      console.error(`Failed to extract overlay spans for page ${pageIndex}:`, err);
    }
  }

  let deferredSpanExtractRafId: number | null = null;

  function renderPageContent(): void {
    if (!canvasContainerEl) return;
    try {
      if (deferredSpanExtractRafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(deferredSpanExtractRafId);
        deferredSpanExtractRafId = null;
      }
      const existingCanvas = canvasContainerEl.querySelector('canvas') as HTMLCanvasElement | null;
      const renderResult = actions.service.document.getPage(pageIndex).render(renderScale, {
        targetCanvas: existingCanvas ?? undefined,
        transparentBackground: true,
      });
      if (!existingCanvas) {
        releaseCanvasContainer(canvasContainerEl);
        canvasContainerEl.appendChild(renderResult.canvas);
      }
      const hasCachedSpans = Boolean(actions.service.document?.getCachedPageSpans(pageIndex));
      if (!hasCachedSpans && cachedPageVersion !== -1 && typeof requestAnimationFrame === 'function') {
        editableSpans = [];
        editableImageSpans = [];
        editableShapeSpans = [];
        pageCharacters = [];
        deferredSpanExtractRafId = requestAnimationFrame(() => {
          deferredSpanExtractRafId = null;
          extractOverlaySpansIfNeeded();
        });
      } else {
        extractOverlaySpansIfNeeded();
      }
    } catch (err) {
      console.error(`Failed to render page ${pageIndex}:`, err);
    }
  }

  $effect(() => {
    renderScale;
    store.renderVersion;
    store.pageVersions[pageIndex];
    
    if (canvasContainerEl && isVisible) {
      renderPageContent();
    } else if (canvasContainerEl && !isVisible && !store.isZooming) {
      const currentIdx = untrack(() => store.currentPageIndex);
      if (Math.abs(pageIndex - currentIdx) > 1) {
        releaseCanvasContainer(canvasContainerEl);
      }
    }
  });

  $effect(() => {
    const isTextAwareAnnotation = store.activeTool === 'highlight' || store.activeTool === 'redact' || store.activeTool === 'pen';
    if ((showOverlays || showTextLayer) && isVisible) {
      if (isTextAwareAnnotation && pageCharacters.length === 0) {
        extractOverlaySpansIfNeeded();
      } else {
        extractOverlaySpansIfNeeded();
      }
    }
  });

  $effect(() => {
    return () => {
      releaseCanvasContainer(canvasContainerEl);
    };
  });

  // getCssFontFamily is now imported from font-loader.ts

  // Page transform and optimistic actions helpers

  const pageTransform = $derived(store.getPageTransform(pageIndex));
  const effectiveRotation = $derived(store.getEffectivePageRotation(pageIndex));
  const isOptimisticallyDeleted = $derived(store.isPageOptimisticallyDeleted(pageIndex));
  const effectivePageTransform = $derived({
    ...pageTransform,
    rotation: effectiveRotation,
  });

  /**
   * Convert pointer screen coordinates to page-point coordinates,
   * accounting for the page's visual rotation and scale transforms.
   */
  function pointerToPageCoords(e: PointerEvent): { x: number; y: number } {
    if (!containerWrapperEl) return { x: 0, y: 0 };
    return screenToPageCoords(e.clientX, e.clientY, containerWrapperEl, visualScale, effectivePageTransform);
  }

  // Page resize and rotate via SelectionOverlay handles

  function handlePageResizeStart(e: PointerEvent, handle: HandlePosition): void {
    e.stopPropagation();
    if (!containerWrapperEl) return;

    const originSx = pageTransform.scaleX;
    const originSy = pageTransform.scaleY;
    const originRot = pageTransform.rotation;
    const zoom = visualScale;
    const wPts = widthPts;
    const hPts = heightPts;

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const originVisualW = wPts * zoom * originSx;
    const originVisualH = hPts * zoom * originSy;
    const isCorner = handle.includes('-');

    const originTransform = { ...pageTransform };

    const onMove = (me: PointerEvent): void => {
      const rawDx = me.clientX - startClientX;
      const rawDy = me.clientY - startClientY;

      // Un-rotate screen deltas into page-local space
      const theta = originRot * (Math.PI / 180);
      const cos = Math.cos(-theta);
      const sin = Math.sin(-theta);
      const localDx = rawDx * cos - rawDy * sin;
      const localDy = rawDx * sin + rawDy * cos;

      let newSx = originSx;
      let newSy = originSy;

      if (isCorner) {
        // Corner: preserve aspect ratio via diagonal projection
        let proposedW = originVisualW;
        let proposedH = originVisualH;

        if (handle.includes('right')) proposedW = originVisualW + localDx;
        else if (handle.includes('left')) proposedW = originVisualW - localDx;

        if (handle.includes('bottom')) proposedH = originVisualH + localDy;
        else if (handle.includes('top')) proposedH = originVisualH - localDy;

        const dot = proposedW * originVisualW + proposedH * originVisualH;
        const magSq = originVisualW * originVisualW + originVisualH * originVisualH;
        const scale = Math.max(0.1, dot / magSq);

        newSx = originSx * scale;
        newSy = originSy * scale;
      } else {
        // Edge: scale a single dimension
        if (handle === 'right') {
          newSx = Math.max(0.1, originSx * (originVisualW + localDx) / originVisualW);
        } else if (handle === 'left') {
          newSx = Math.max(0.1, originSx * (originVisualW - localDx) / originVisualW);
        } else if (handle === 'bottom') {
          newSy = Math.max(0.1, originSy * (originVisualH + localDy) / originVisualH);
        } else if (handle === 'top') {
          newSy = Math.max(0.1, originSy * (originVisualH - localDy) / originVisualH);
        }
      }

      store.updatePageTransform(pageIndex, { scaleX: newSx, scaleY: newSy });
    };

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      activeDragCleanup = null;
      const currentTransform = store.getPageTransform(pageIndex);
      actions.pushCommand(
        new SetPageTransformCommand('Scale Page', pageIndex, originTransform, currentTransform)
      );
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    activeDragCleanup = onUp;
  }

  function handlePageRotateStart(e: PointerEvent): void {
    e.stopPropagation();
    if (!containerWrapperEl) return;

    const rect = containerWrapperEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const originRotation = pageTransform.rotation || 0;
    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);

    const onMove = (me: PointerEvent): void => {
      const currentAngle = Math.atan2(me.clientY - centerY, me.clientX - centerX);
      const deltaAngle = (currentAngle - startAngle) * (180 / Math.PI);
      let newRotation = (originRotation + deltaAngle) % 360;
      if (newRotation < 0) newRotation += 360;

      // Page rotation strictly snaps to 90 degree increments (0, 90, 180, 270)
      const snapped = (Math.round(newRotation / 90) * 90) % 360;
      store.updatePageTransform(pageIndex, { rotation: snapped });
    };

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      activeDragCleanup = null;

      const currentTransform = store.getPageTransform(pageIndex);
      const snapped = (Math.round((currentTransform.rotation || 0) / 90) * 90) % 360;
      const degreesDelta = ((snapped - originRotation) % 360 + 360) % 360;

      // Reset temporary visual CSS rotation back to 0
      store.updatePageTransform(pageIndex, { rotation: 0 });

      if (degreesDelta === 90 || degreesDelta === 180 || degreesDelta === 270) {
        void actions.rotatePage(pageIndex, degreesDelta);
      } else if (originRotation !== 0) {
        store.updatePageTransform(pageIndex, { rotation: originRotation });
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    activeDragCleanup = onUp;
  }

  /**
   * Handles pointerdown on the page background to initiate marquee selection.
   * Activated when the select tool is in standard select mode.
   */
  function handlePagePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (store.isReadOnly || !store.canSelectElements || store.isCropping) return;
    if (store.activeTool !== 'select' || store.selectMode !== 'select') return;
    if (featureFlags && !featureFlags.isEnabled('select-tool.marquee')) return;

    const target = e.target as HTMLElement | null;
    if (
      target?.closest('.canvas-element-container') ||
      target?.closest('.selection-overlay-container') ||
      target?.closest('.inline-editor-input') ||
      target?.closest('[contenteditable="true"]') ||
      target?.closest('[data-span-id]') ||
      target?.closest('.pdf-form-layer') ||
      target?.closest('.pdf-form-layer-container') ||
      target?.closest('.pdf-form-field-wrapper') ||
      target?.closest('[data-pdf-form-layer="true"]')
    ) {
      return;
    }

    const startCoords = pointerToPageCoords(e);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const isAdditive = Boolean(
      (e.ctrlKey || e.metaKey || e.shiftKey) &&
      (!featureFlags || featureFlags.isEnabled('select-tool.multiselect'))
    );
    const initialElementIds = isAdditive ? [...canvasStore.selectedElementIds] : [];
    const initialSpans = isAdditive ? [...store.selectedSpans] : [];

    let marqueeStarted = false;

    const onPointerMove = (me: PointerEvent) => {
      const dist = Math.hypot(me.clientX - startClientX, me.clientY - startClientY);
      if (!marqueeStarted) {
        if (dist < 4) return;
        marqueeStarted = true;
        isMarqueeActive = true;
        marqueeStart = startCoords;
        marqueeAdditive = isAdditive;
        if (!isAdditive) {
          canvasStore.selectElement(null);
          actions.clearSelection(true);
        }
      }

      if (!containerWrapperEl) return;
      const currentCoords = screenToPageCoords(me.clientX, me.clientY, containerWrapperEl, visualScale, effectivePageTransform);
      marqueeCurrent = currentCoords;

      const rect = {
        x: Math.min(startCoords.x, currentCoords.x),
        y: Math.min(startCoords.y, currentCoords.y),
        width: Math.abs(currentCoords.x - startCoords.x),
        height: Math.abs(currentCoords.y - startCoords.y),
      };

      const pageCanvasElements = canvasStore.getElementsByPage(pageIndex);
      const hitElementIds = pageCanvasElements
        .filter((el) => doRectanglesIntersect(
          { left: rect.x, top: rect.y, width: rect.width, height: rect.height },
          { left: el.x, top: el.y, width: el.width, height: el.height }
        ))
        .map((el) => el.id);

      const hitSpans = allSpans.filter((span) =>
        !store.hiddenSpanIds.has(span.id) &&
        doRectanglesIntersect(
          { left: rect.x, top: rect.y, width: rect.width, height: rect.height },
          { left: span.left, top: span.top, width: span.width, height: span.height }
        )
      );

      if (isAdditive) {
        const combinedElementIds = Array.from(new Set([...initialElementIds, ...hitElementIds]));
        canvasStore.selectedElementIds = combinedElementIds;
        const initialSpanIds = new Set(initialSpans.map((s) => s.id));
        const newSpans = hitSpans.filter((s) => !initialSpanIds.has(s.id));
        store.selectedSpans = [...initialSpans, ...newSpans];
      } else {
        canvasStore.selectedElementIds = hitElementIds;
        store.selectedSpans = hitSpans;
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      activeDragCleanup = null;

      if (marqueeStarted) {
        isMarqueeActive = false;
        marqueeStart = null;
        marqueeCurrent = null;
        justFinishedMarquee = true;
        setTimeout(() => {
          justFinishedMarquee = false;
        }, 50);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    activeDragCleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      isMarqueeActive = false;
      marqueeStart = null;
      marqueeCurrent = null;
      activeDragCleanup = null;
    };
  }

  function handleContainerClick(e: MouseEvent): void {
    if (justFinishedMarquee) return;
    if (canvasActions.consumeDragEnd()) return;
    if (store.isCropping) return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest('.canvas-element-container') ||
      target?.closest('.selection-overlay-container') ||
      target?.closest('.inline-editor-input') ||
      target?.closest('[contenteditable="true"]') ||
      target?.closest('.pdf-text-layer') ||
      target?.closest('[data-text-layer="true"]') ||
      target?.closest('.pdf-form-layer') ||
      target?.closest('.pdf-form-layer-container') ||
      target?.closest('.pdf-form-field-wrapper') ||
      target?.closest('[data-pdf-form-layer="true"]')
    ) {
      return;
    }
    actions.setCurrentPageFromScroll(pageIndex);
    actions.clearSelection(true);
    canvasStore.selectElement(null);
    if (!store.isReadOnly && store.canSelectElements) {
      selection.select(`page_${pageIndex}`, e.ctrlKey || e.metaKey, e.shiftKey);
    }
  }

  let isSubmittingInlineEdit = $state(false);

  function handleKeyDownInline(e: KeyboardEvent): void {
    const action = resolveInlineKeyAction(e);
    const target = e.currentTarget as HTMLElement;
    const span = store.inlineEdit?.span;

    if (action === 'submit') {
      e.preventDefault();
      if (isSubmittingInlineEdit) return;
      isSubmittingInlineEdit = true;
      const extracted = span ? extractStyledLinesFromEditor(target, renderScale, span) : undefined;
      actions.submitInlineEdit(extracted);
      setTimeout(() => { isSubmittingInlineEdit = false; }, 100);
    } else if (action === 'lineBreak') {
      e.stopPropagation();
      e.preventDefault();
      let inserted = false;
      try {
        inserted = document.execCommand('insertLineBreak');
      } catch {
        inserted = false;
      }
      if (!inserted) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const br = document.createElement('br');
          range.insertNode(br);
          range.setStartAfter(br);
          range.setEndAfter(br);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
      isInternalInlineTyping = true;
      const extracted = span ? extractStyledLinesFromEditor(target, renderScale, span) : undefined;
      actions.updateInlineText(extracted?.text || '', extracted?.lines);
      handleInlineSelectionUpdate(target);
      queueMicrotask(() => {
        isInternalInlineTyping = false;
      });
    } else if (action === 'cancel') {
      e.preventDefault();
      actions.cancelInlineEdit();
    }
  }

  let isDrawing = $state(false);
  let hasDragged = $state(false);
  let currentPathId = $state<string | null>(null);
  let isTextHighlightMode = $state(false);
  let isAreaRedactMode = $state(false);
  let areaStartX = $state(0);
  let areaStartY = $state(0);
  let startCharIndex = $state<number | null>(null);
  let currentCharIndex = $state<number | null>(null);
  let previewHighlightRects = $state<HighlightRect[]>([]);
  let hoveringChar = $state<PageCharacter | null>(null);

  let eraserLastErased = $state<LastErasedState | null>(null);
  let eraserCanvasCommands: Command[] = [];
  let eraserPendingPromises: Promise<void>[] = [];
  let eraserHadPdfMutations = false;
  let eraserPrevBuffer: ArrayBuffer | undefined = undefined;
  let eraserPrevElements: CanvasElement[] | undefined = undefined;
  let activeDrawingTool = $state<string | null>(null);

  function flushEraserStrokeCommit(): void {
    const pending = [...eraserPendingPromises];
    const cmds = [...eraserCanvasCommands];
    const hadPdf = eraserHadPdfMutations;
    const prevBuf = eraserPrevBuffer;
    const prevEls = eraserPrevElements;

    eraserLastErased = null;
    eraserCanvasCommands = [];
    eraserPendingPromises = [];
    eraserHadPdfMutations = false;
    eraserPrevBuffer = undefined;
    eraserPrevElements = undefined;

    if (pending.length > 0) {
      void Promise.all(pending).then(() => {
        actions.commitEraserStroke(pageIndex, cmds, hadPdf, prevBuf, prevEls);
      });
    } else {
      actions.commitEraserStroke(pageIndex, cmds, hadPdf, prevBuf, prevEls);
    }
  }

  function finalizeInterruptedDrawingGesture(): void {
    if (!isDrawing) return;
    const tool = activeDrawingTool || store.activeTool;

    if (tool === 'eraser') {
      isDrawing = false;
      activeDrawingTool = null;
      flushEraserStrokeCommit();
      return;
    }

    if ((tool === 'highlight' || tool === 'pen') && currentPathId) {
      const element = canvasStore.elements.find((el) => el.id === currentPathId) as PathElement | undefined;
      if (element && element.kind === 'path' && element.points.length <= 1 && element.width === 0 && element.height === 0) {
        canvasStore.removeElement(currentPathId);
      } else if (element && element.kind === 'path') {
        actions.pushCommand(
          new AddElementCommand(tool === 'highlight' ? 'Draw Highlight' : 'Draw Annotation', element, false)
        );
      }
    }

    isDrawing = false;
    activeDrawingTool = null;
    hasDragged = false;
    currentPathId = null;
    isTextHighlightMode = false;
    isAreaRedactMode = false;
    startCharIndex = null;
    currentCharIndex = null;
    previewHighlightRects = [];
  }

  $effect(() => {
    const currentTool = store.activeTool;
    const currentViewMode = store.viewMode;
    void currentViewMode;
    if (isDrawing && activeDrawingTool && currentTool !== activeDrawingTool) {
      finalizeInterruptedDrawingGesture();
    }
    if (isMarqueeActive && currentTool !== 'select' && activeDragCleanup) {
      activeDragCleanup();
    }
  });

  function performEraseAt(x: number, y: number, now: number): void {
    let nativeAnnots: AnnotationItem[] = [];
    let cropInfo: PageCropInfo | undefined = undefined;
    try {
      if (actions.service?.document) {
        const page = actions.service.document.getPage(pageIndex);
        nativeAnnots = page.getAnnotations();
        cropInfo = page.getCropInfo();
      }
    } catch {
      // Safe fallback
    }

    let candidates = collectEraserCandidates(
      pageIndex,
      { x, y },
      10,
      canvasStore.elements,
      editableShapeSpans,
      editableSpans,
      nativeAnnots,
      cropInfo
    );

    let toErase = resolveUpperZCandidate(
      candidates,
      eraserLastErased,
      now,
      { x, y },
      { waitDelayMs: 400, movementThreshold: 16 }
    );

    while (toErase) {
      const candidateToErase = toErase;
      const erasePromise = actions.eraseCandidate(candidateToErase).then((cmd) => {
        if (cmd) {
          eraserCanvasCommands.push(cmd);
        }
      });
      eraserPendingPromises.push(erasePromise);
      if (candidateToErase.source !== 'canvas') {
        eraserHadPdfMutations = true;
      }
      eraserLastErased = {
        elementId: candidateToErase.id,
        zIndex: candidateToErase.zIndex,
        zLevel: candidateToErase.zLevel,
        category: candidateToErase.category,
        point: { x, y },
        timestamp: now,
      };

      candidates = candidates.filter((c) => c.id !== candidateToErase.id);
      toErase = resolveUpperZCandidate(
        candidates,
        eraserLastErased,
        now,
        { x, y },
        { waitDelayMs: 400, movementThreshold: 16 }
      );
    }
  }

  function updateHover(e: PointerEvent): void {
    if ((store.activeTool !== 'highlight' && store.activeTool !== 'redact' && store.activeTool !== 'pen') || isDrawing || !containerWrapperEl) {
      hoveringChar = null;
      return;
    }
    const { x: px, y: py } = pointerToPageCoords(e);
    hoveringChar = findUnifiedCharacterAt(unifiedCharacters, px, py, 10, 8);
  }

  function handlePointerDownDrawing(e: PointerEvent): void {
    if (e.button !== 0 || store.isDraggingOver || store.isCropping) return;
    if (store.activeTool !== 'pen' && store.activeTool !== 'highlight' && store.activeTool !== 'redact' && store.activeTool !== 'note' && store.activeTool !== 'text' && store.activeTool !== 'eraser') return;

    e.preventDefault();
    e.stopPropagation();

    actions.setCurrentPageFromScroll(pageIndex);
    actions.clearSelection(true);

    const { x, y } = pointerToPageCoords(e);

    if (store.activeTool === 'eraser') {
      isDrawing = true;
      activeDrawingTool = 'eraser';
      eraserLastErased = null;
      eraserCanvasCommands = [];
      eraserPendingPromises = [];
      eraserHadPdfMutations = false;
      try {
        const fileId = store.activeWorkspaceFileId;
        const hasUnbaked = Boolean(actions.service?.document?.hasUnbakedModifications?.());
        const activeBuffer = !hasUnbaked && fileId ? getFileBuffer(fileId) : undefined;
        let fallbackBuffer: ArrayBuffer | undefined = undefined;
        if (!activeBuffer && actions.service?.document) {
          const raw = actions.service.document.save();
          fallbackBuffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
          if (fileId) {
            setFileBuffer(fileId, fallbackBuffer);
          }
        }
        eraserPrevBuffer = activeBuffer ?? fallbackBuffer;
      } catch {
        eraserPrevBuffer = undefined;
      }
      eraserPrevElements = safeClone(canvasStore.elements);

      performEraseAt(x, y, Date.now());
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (store.activeTool === 'text') {
      const def = elementRegistry.get('text');
      const newEl = def.create(canvasStore.generateId(), pageIndex, x, y, {
        text: 'Type something...',
        fontSize: 14,
        color: '#000000',
      });
      canvasStore.addElement(newEl);
      actions.pushCommand(new AddElementCommand('Add Text', newEl));
      if (store.canSelectElements !== false) {
        canvasStore.selectElement(newEl.id);
        canvasStore.editingElementId = newEl.id;
        actions.setTool('select');
      }
      return;
    }

    if (store.activeTool === 'note') {
      canvasActions.createElement('note', pageIndex, x, y, {
        label: 'Note',
        text: '',
        color: store.annotateColor || '#fef08a',
      });
      if (store.canSelectElements !== false) {
        actions.setTool('select');
      }
      return;
    }

    hasDragged = false;
    isDrawing = true;
    activeDrawingTool = store.activeTool;

    if (store.activeTool === 'redact') {
      const hitChar = findUnifiedCharacterAt(unifiedCharacters, x, y, 10, 8);
      if (hitChar) {
        isTextHighlightMode = true;
        isAreaRedactMode = false;
        startCharIndex = hitChar.charIndex;
        currentCharIndex = hitChar.charIndex;
        previewHighlightRects = calculateUnifiedHighlightRects(unifiedCharacters, hitChar.charIndex, hitChar.charIndex);
      } else {
        isTextHighlightMode = false;
        isAreaRedactMode = true;
        areaStartX = x;
        areaStartY = y;
        startCharIndex = null;
        currentCharIndex = null;
        previewHighlightRects = [{ x, y, width: 0, height: 0 }];
      }
    } else if (store.activeTool === 'highlight') {
      isAreaRedactMode = false;
      const hitChar = findUnifiedCharacterAt(unifiedCharacters, x, y, 10, 8);
      if (hitChar) {
        isTextHighlightMode = true;
        startCharIndex = hitChar.charIndex;
        currentCharIndex = hitChar.charIndex;
        previewHighlightRects = calculateUnifiedHighlightRects(unifiedCharacters, hitChar.charIndex, hitChar.charIndex);
      } else {
        isTextHighlightMode = false;
        startCharIndex = null;
        currentCharIndex = null;
        previewHighlightRects = [];
        currentPathId = canvasStore.generateId();

        const newPath: PathElement = {
          id: currentPathId,
          kind: 'path',
          pageIndex,
          x,
          y,
          width: 0,
          height: 0,
          rotation: 0,
          locked: false,
          visible: true,
          flipX: false,
          flipY: false,
          points: [{ x, y }],
          stroke: store.annotateColor,
          strokeWidth: 14,
          opacity: 0.4,
          isHighlight: true,
        };

        canvasStore.addElement(newPath);
      }
    } else if (store.activeTool === 'pen') {
      isAreaRedactMode = false;
      const hitChar = findUnifiedCharacterAt(unifiedCharacters, x, y, 10, 8);
      if (hitChar) {
        isTextHighlightMode = true;
        startCharIndex = hitChar.charIndex;
        currentCharIndex = hitChar.charIndex;
        previewHighlightRects = calculateUnifiedHighlightRects(unifiedCharacters, hitChar.charIndex, hitChar.charIndex);
      } else {
        isTextHighlightMode = false;
        startCharIndex = null;
        currentCharIndex = null;
        previewHighlightRects = [];
        currentPathId = canvasStore.generateId();

        const newPath: PathElement = {
          id: currentPathId,
          kind: 'path',
          pageIndex,
          x,
          y,
          width: 0,
          height: 0,
          rotation: 0,
          locked: false,
          visible: true,
          flipX: false,
          flipY: false,
          points: [{ x, y }],
          stroke: store.annotateColor,
          strokeWidth: store.annotateStrokeWidth,
          opacity: 1,
          isHighlight: false,
        };

        canvasStore.addElement(newPath);
      }
    } else {
      isAreaRedactMode = false;
      isTextHighlightMode = false;
      startCharIndex = null;
      currentCharIndex = null;
      previewHighlightRects = [];
      currentPathId = canvasStore.generateId();

      const newPath: PathElement = {
        id: currentPathId,
        kind: 'path',
        pageIndex,
        x,
        y,
        width: 0,
        height: 0,
        rotation: 0,
        locked: false,
        visible: true,
        flipX: false,
        flipY: false,
        points: [{ x, y }],
        stroke: store.annotateColor,
        strokeWidth: store.annotateStrokeWidth,
        opacity: 1,
        isHighlight: false,
      };

      canvasStore.addElement(newPath);
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMoveDrawing(e: PointerEvent): void {
    if (!isDrawing) {
      updateHover(e);
      return;
    }
    if (!containerWrapperEl) return;

    hasDragged = true;
    const { x: px, y: py } = pointerToPageCoords(e);

    if (store.activeTool === 'eraser') {
      if (isDrawing) {
        performEraseAt(px, py, Date.now());
      }
      return;
    }

    if (isTextHighlightMode && startCharIndex !== null) {
      const closest = findClosestUnifiedCharacter(unifiedCharacters, px, py, startCharIndex);
      if (closest) {
        currentCharIndex = closest.charIndex;
        previewHighlightRects = calculateUnifiedHighlightRects(unifiedCharacters, startCharIndex, currentCharIndex);
      }
    } else if (isAreaRedactMode && store.activeTool === 'redact') {
      const minX = Math.min(areaStartX, px);
      const minY = Math.min(areaStartY, py);
      const w = Math.abs(px - areaStartX);
      const h = Math.abs(py - areaStartY);
      previewHighlightRects = [{ x: minX, y: minY, width: w, height: h }];
    } else if (currentPathId) {
      const element = canvasStore.elements.find((el) => el.id === currentPathId) as PathElement | undefined;
      if (element && element.kind === 'path') {
        const newPoints = [...element.points, { x: px, y: py }];

        const minX = Math.min(...newPoints.map((p) => p.x));
        const maxX = Math.max(...newPoints.map((p) => p.x));
        const minY = Math.min(...newPoints.map((p) => p.y));
        const maxY = Math.max(...newPoints.map((p) => p.y));

        canvasStore.updateElement(currentPathId, {
          points: newPoints,
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        });
      }
    }
  }

  function handlePointerUpDrawing(e: PointerEvent): void {
    if (isDrawing) {
      if (store.activeTool === 'eraser') {
        isDrawing = false;
        activeDrawingTool = null;
        flushEraserStrokeCommit();
        try {
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        } catch (err) {}
        return;
      } else if (store.activeTool === 'redact') {
        if (isTextHighlightMode && startCharIndex !== null && currentCharIndex !== null && previewHighlightRects.length > 0) {
          if (hasDragged || startCharIndex !== currentCharIndex) {
            actions.redactTextRange(pageIndex, startCharIndex, currentCharIndex, previewHighlightRects, canvasStore);
          }
        } else if (isAreaRedactMode && previewHighlightRects.length > 0) {
          const rect = previewHighlightRects[0];
          if (rect && rect.width > 2 && rect.height > 2) {
            actions.redactArea(pageIndex, [rect], canvasStore);
          }
        }
      } else if (store.activeTool === 'highlight') {
        if (isTextHighlightMode && previewHighlightRects.length > 0) {
          if (hasDragged || (startCharIndex !== null && currentCharIndex !== null && startCharIndex !== currentCharIndex)) {
            const addedCommands: AddElementCommand[] = [];
            for (const rect of previewHighlightRects) {
              if (rect.width > 0 && rect.height > 0) {
                const def = elementRegistry.get('shape');
                const element = def.create(canvasStore.generateId(), pageIndex, rect.x, rect.y, {
                  width: rect.width,
                  height: rect.height,
                  fill: store.annotateColor,
                  stroke: store.annotateColor,
                  strokeWidth: 0,
                  opacity: 0.4,
                  isHighlight: true,
                });
                canvasStore.addElement(element);
                addedCommands.push(new AddElementCommand('Highlight Text', element, false));
              }
            }
            if (addedCommands.length === 1) {
              actions.pushCommand(addedCommands[0]);
            } else if (addedCommands.length > 1) {
              actions.pushCommand(new CompoundCommand('Highlight Text', addedCommands));
            }
          }
        } else if (!isTextHighlightMode && currentPathId) {
          const element = canvasStore.elements.find((el) => el.id === currentPathId) as PathElement | undefined;
          if (element && element.kind === 'path' && element.points.length <= 1 && element.width === 0 && element.height === 0) {
            canvasStore.removeElement(currentPathId);
          } else if (element && element.kind === 'path') {
            actions.pushCommand(new AddElementCommand('Draw Highlight', element, false));
          }
        }
      } else if (store.activeTool === 'pen') {
        if (isTextHighlightMode && previewHighlightRects.length > 0) {
          if (hasDragged || (startCharIndex !== null && currentCharIndex !== null && startCharIndex !== currentCharIndex)) {
            const addedCommands: AddElementCommand[] = [];
            for (const rect of previewHighlightRects) {
              if (rect.width > 0) {
                const strokeW = store.annotateStrokeWidth || 2;
                const lineY = rect.baselineY !== undefined
                  ? rect.baselineY + Math.max(1.5, strokeW * 0.5)
                  : rect.y + rect.height - strokeW * 0.5;
                const pathId = canvasStore.generateId();
                const pathEl: PathElement = {
                  id: pathId,
                  kind: 'path',
                  pageIndex,
                  x: rect.x,
                  y: lineY - strokeW * 0.5,
                  width: rect.width,
                  height: strokeW,
                  rotation: 0,
                  locked: false,
                  visible: true,
                  flipX: false,
                  flipY: false,
                  points: [
                    { x: rect.x, y: lineY },
                    { x: rect.x + rect.width, y: lineY },
                  ],
                  stroke: store.annotateColor,
                  strokeWidth: strokeW,
                  opacity: 1,
                  isHighlight: false,
                };
                canvasStore.addElement(pathEl);
                addedCommands.push(new AddElementCommand('Draw Underline', pathEl, false));
              }
            }
            if (addedCommands.length === 1) {
              actions.pushCommand(addedCommands[0]);
            } else if (addedCommands.length > 1) {
              actions.pushCommand(new CompoundCommand('Draw Underline', addedCommands));
            }
          }
        } else if (currentPathId) {
          const element = canvasStore.elements.find((el) => el.id === currentPathId) as PathElement | undefined;
          if (element && element.kind === 'path' && element.points.length <= 1 && element.width === 0 && element.height === 0) {
            canvasStore.removeElement(currentPathId);
          } else if (element && element.kind === 'path') {
            actions.pushCommand(new AddElementCommand('Draw Annotation', element, false));
          }
        }
      }

      isDrawing = false;
      activeDrawingTool = null;
      hasDragged = false;
      currentPathId = null;
      isTextHighlightMode = false;
      isAreaRedactMode = false;
      startCharIndex = null;
      currentCharIndex = null;
      previewHighlightRects = [];
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
  }

  function handleSpanPointerDown(e: PointerEvent, span: EditableSpan) {
    if (e.button !== 0) return;
    if (store.isReadOnly || !store.canSelectElements) return;
    const isSpanSelected = store.selectedSpan?.id === span.id || store.isSpanSelected(span.id);
    const canDragImmediately = span.type === 'image' || span.type === 'shape';
    if (store.selectedSpan?.id === span.id || canDragImmediately) {
      // note: primary selected span and immediate-drag spans are covered by isSpanSelected || canDragImmediately
    }
    if (isSpanSelected || canDragImmediately) {
        if (store.activeTool === 'text' && span.type === 'text') return;

        e.stopPropagation();
        const target = e.target as HTMLElement;
        const pageEl = target.closest('[data-page-element]') as HTMLElement || containerWrapperEl;
        
        const startX = e.clientX;
        const startY = e.clientY;
        const pointerId = e.pointerId;
        let latestX = startX;
        let latestY = startY;
        let pointerReleased = false;
        let isPromoting = false;

        const moveHandler = async (me: PointerEvent) => {
            if (me.pointerId !== pointerId) return;
            latestX = me.clientX;
            latestY = me.clientY;
            if (isPromoting) return;
            const dx = Math.abs(me.clientX - startX);
            const dy = Math.abs(me.clientY - startY);
            if (dx > 8 || dy > 8) {
                isPromoting = true;
                if (!store.canMoveElements) {
                    cleanup();
                    return;
                }
                if (span.type === 'text' || span.type === 'image' || span.type === 'shape' || span.type === 'form-field') {
                    const multiTransformEnabled =
                        !featureFlags ||
                        (featureFlags.isEnabled('select-tool.multiselect') &&
                         featureFlags.isEnabled('select-tool.multiselect.transform'));
                    const newId = isSpanSelected && multiTransformEnabled
                        ? (await actions.extractSelectedSpansToCanvas(span, canvasStore)).primaryElementId
                        : await actions.extractObjectToCanvas(span.type, span, canvasStore);
                    cleanup();
                    if (newId) {
                        // After extraction the element lives in CanvasElementLayer.
                        // Resolve that layer for coordinate consistency with updateDrag.
                        const canvasLayer = containerWrapperEl?.querySelector('[data-canvas-layer]') as HTMLElement | null;
                        const targetPageEl = canvasLayer ?? pageEl;
                        canvasActions.startDrag(newId, startX, startY, targetPageEl, visualScale, effectivePageTransform);
                        canvasActions.updateDrag(latestX, latestY, targetPageEl, visualScale, effectivePageTransform);
                        if (pointerReleased) {
                            canvasActions.endDrag();
                        }
                    }
                } else {
                    cleanup();
                }
            }
        };
        const upHandler = (ue: PointerEvent) => {
            if (ue.pointerId !== pointerId) return;
            pointerReleased = true;
            if (!isPromoting) {
                cleanup();
            }
        };
        
        const cleanup = () => {
            window.removeEventListener('pointermove', moveHandler);
            window.removeEventListener('pointerup', upHandler);
            window.removeEventListener('pointercancel', upHandler);
            activeDragCleanup = null;
        };

        window.addEventListener('pointermove', moveHandler);
        window.addEventListener('pointerup', upHandler);
        window.addEventListener('pointercancel', upHandler);
        activeDragCleanup = cleanup;
    }
  }

  /**
   * Calculates the DOM baseline position relative to the span container.
   *
   * PDFium stores baselineY in PDF coordinates (bottom-left origin).
   * We convert to DOM coordinates (top-left origin) using page height,
   * then subtract the span's top offset.
   *
   * @param spanTop The span's top in DOM coordinates.
   * @param lineTop The line's top in DOM coordinates.
   * @param fontSize Font size in points.
   * @param baselineY PDF originY baseline coordinate (bottom-up).
   * @return Relative top offset in DOM points.
   */
  function getLineBaselineTop(spanTop: number, lineTop: number, fontSize: number, baselineY?: number, domBaseline?: number): number {
    if (domBaseline !== undefined && domBaseline > 0) {
      const relTop = domBaseline - spanTop;
      if (relTop >= 0) {
        return relTop;
      }
    }
    if (baselineY !== undefined && baselineY > 0 && heightPts > 0) {
      const domBaselineCalc = heightPts - baselineY;
      const relTop = domBaselineCalc - spanTop;
      if (relTop >= 0) {
        return relTop;
      }
    }
    return (lineTop - spanTop) + fontSize * 0.85;
  }

  /**
   * Calculates the DOM baseline horizontal position relative to a vertical span container.
   *
   * @param spanLeft The span's left in DOM coordinates.
   * @param lineLeft The line's left in DOM coordinates.
   * @param fontSize Font size in points.
   * @param baselineX PDF originX baseline coordinate.
   * @param domBaseline Pre-calculated DOM baseline horizontal coordinate.
   * @return Relative left offset in DOM points.
   */
  function getVerticalLineBaselineLeft(spanLeft: number, lineLeft: number, fontSize: number, baselineX?: number, domBaseline?: number): number {
    if (domBaseline !== undefined && domBaseline > 0) {
      const relLeft = domBaseline - spanLeft;
      if (relLeft >= 0) {
        return relLeft;
      }
    }
    if (baselineX !== undefined && baselineX > 0) {
      const relLeft = baselineX - spanLeft;
      if (relLeft >= 0) {
        return relLeft;
      }
    }
    return (lineLeft - spanLeft) + fontSize * 0.15;
  }

  const isPageCropping = $derived(store.activeCrop !== null && store.activeCrop.pageIndex === pageIndex);

  const containerStyle = $derived.by(() => {
    let s = `transform: rotate(${effectiveRotation}deg) scale(${pageTransform.scaleX}, ${pageTransform.scaleY}); transform-origin: center;`;
    if (isOptimisticallyDeleted) {
      s += ' opacity: 0.3; pointer-events: none; transition: opacity 200ms cubic-bezier(0.16, 1, 0.3, 1), transform 200ms cubic-bezier(0.16, 1, 0.3, 1);';
    }
    return s;
  });

</script>

<div
  bind:this={containerWrapperEl}
  data-page-element="true"
  data-page-index={pageIndex}
  class="relative inline-block bg-transparent outline-none rounded-none p-0 my-0"
  style={containerStyle}
  onpointerdown={handlePagePointerDown}
  onclick={handleContainerClick}
  onkeydown={(e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') {
      actions.setCurrentPageFromScroll(pageIndex);
      actions.clearSelection(true);
      if (!store.isReadOnly && store.canSelectElements) {
        selection.select(`page_${pageIndex}`, e.ctrlKey || e.metaKey, e.shiftKey);
      }
    }
  }}
  role="button"
  tabindex="0"
  aria-label="PDF Page {pageIndex + 1}"
>
  <div
    class="relative bg-white border border-border/80 overflow-hidden rounded-none"
    style="width: {Math.round(widthPts * visualScale)}px; height: {Math.round(heightPts * visualScale)}px;"
  >
    <div 
      bind:this={canvasContainerEl} 
      class="relative z-10 pointer-events-none"
      style="transform-origin: top left; transform: scale({visualScale / renderScale}); will-change: transform;"
    ></div>

    {#each pageAgentHighlights as hl (hl.id)}
      <div
        class="pointer-events-none absolute inset-0 z-40 rounded border border-selection bg-selection/10 transition-opacity duration-1000 animate-pulse"
        aria-hidden="true"
      >
        <div class="absolute top-2 right-2 flex items-center gap-1.5 rounded bg-selection px-2 py-0.5 text-[11px] font-medium text-white">
          <span class="h-1.5 w-1.5 rounded-full bg-white animate-ping"></span>
          AI Edit: {hl.description}
        </div>
      </div>
    {/each}

    <!-- Text Selection Layer (Viewing Mode: Chrome / Firefox PDF viewer parity) -->
    {#if showTextLayer && !isPageCropping && (featureFlags ? featureFlags.isEnabled('view-mode.viewing.text-selection') : true)}
      <div
        class="pdf-text-layer absolute inset-0 pointer-events-auto select-text z-10 overflow-hidden leading-none"
        data-text-layer="true"
        data-page-index={pageIndex}
        role="presentation"
      >
        {#each editableSpans as span (span.id)}
          {@const spanFont = getCssFontFamily(span.rawFontFamily || span.matchedFontFamily || span.fontFamily, extractBaseFontFamily)}
          {#if span.lines && span.lines.length > 0}
            {#each span.lines as line}
              {@const lineFont = getCssFontFamily(line.rawFontFamily || line.matchedFontFamily || span.rawFontFamily || span.matchedFontFamily || span.fontFamily, extractBaseFontFamily)}
              {@const layout = computeLineLayoutStyle(line, visualScale, lineFont)}
              <span
                class="pdf-text-line absolute cursor-text whitespace-pre text-transparent select-text selection:bg-selection/30 selection:text-transparent"
                style={layout.styleString}
              >{line.text}</span>
            {/each}
          {:else}
            {@const layout = computeSpanFallbackLayoutStyle(span, visualScale, spanFont)}
            <span
              class="pdf-text-line absolute cursor-text whitespace-pre text-transparent select-text selection:bg-selection/30 selection:text-transparent"
              style={layout.styleString}
            >{span.text}</span>
          {/if}
        {/each}
      </div>
    {/if}

    <!-- Interactive AcroForm Layer in View Mode (Google Chromium PDFium parity) -->
    {#if store.isReadOnly && store.canEditValues && !store.showOrganizerView && isVisible && (featureFlags ? featureFlags.isEnabled('view-mode.viewing.form-values') : true)}
      <div
        class="pdf-form-layer-container absolute top-0 left-0 z-[15]"
        style="contain: strict; transform-origin: top left; transform: scale({visualScale / renderScale}); width: {Math.round(widthPts * renderScale)}px; height: {Math.round(heightPts * renderScale)}px; pointer-events: {store.isZooming ? 'none' : 'auto'};"
        data-page-element="true"
      >
        <PdfFormLayer
          {pageIndex}
          scale={renderScale}
          fields={editableFormFieldSpans}
          canEditValues={store.canEditValues}
          disabled={store.isZooming}
        />
      </div>
    {/if}

    {#if showOverlays && !isPageCropping}
      <div 
        class="editable-overlay-layer absolute inset-0 pointer-events-none" 
        style="{Math.abs(visualScale - renderScale) > 0.001 ? `transform-origin: top left; transform: scale(${visualScale / renderScale}); ` : ''}width: {Math.round(widthPts * renderScale)}px; height: {Math.round(heightPts * renderScale)}px;" 
        data-page-element="true"
      >
        {#if (featureFlags ? featureFlags.isEnabled('text-editing') : true) && store.inlineEdit && store.inlineEdit.span.pageIndex === pageIndex}
          {@const editSpan = store.inlineEdit.span}
          {@const nextRowColSpan = (!featureFlags || featureFlags.isEnabled('text-editing.table-aware-clustering'))
            ? allSpans
                .filter((s): s is EditableTextSpan => s.type === 'text' && s.id !== editSpan.id && Math.abs(s.baselineY - editSpan.baselineY) <= 4.0 && s.left > editSpan.left + editSpan.width + 6.0)
                .sort((a, b) => a.left - b.left)[0]
            : undefined}
          {@const inlineMaxWidthPts = nextRowColSpan
            ? Math.max(editSpan.width, nextRowColSpan.left - editSpan.left - 6.0)
            : Math.max(editSpan.width, widthPts - editSpan.left)}
          <div
            bind:this={inlineEditorEl}
            class="inline-editor-input absolute text-card-foreground z-50 outline-none select-text cursor-text {store.isZooming ? 'pointer-events-none' : 'pointer-events-auto'}"
            contenteditable="true"
            role="textbox"
            tabindex="0"
            aria-label="Inline text editor"
            aria-multiline="true"
            use:focusInlineEditable
            oninput={(e) => {
              isInternalInlineTyping = true;
              const target = e.currentTarget as HTMLDivElement;
              const extracted = extractStyledLinesFromEditor(target, renderScale, editSpan);
              actions.updateInlineText(extracted.text, extracted.lines);
              handleInlineSelectionUpdate(target);
              queueMicrotask(() => {
                isInternalInlineTyping = false;
              });
            }}
            onclick={(e) => { e.stopPropagation(); handleInlineSelectionUpdate(e.currentTarget as HTMLDivElement); }}
            onpointerdown={(e) => e.stopPropagation()}
            onpointerup={(e) => handleInlineSelectionUpdate(e.currentTarget as HTMLDivElement)}
            onmousedown={(e) => e.stopPropagation()}
            onmouseup={(e) => { e.stopPropagation(); handleInlineSelectionUpdate(e.currentTarget as HTMLDivElement); }}
            onkeyup={(e) => handleInlineSelectionUpdate(e.currentTarget as HTMLDivElement)}
            ondblclick={(e) => { e.stopPropagation(); handleInlineSelectionUpdate(e.currentTarget as HTMLDivElement); }}
            style="
              left: {(editSpan.left * renderScale).toFixed(2)}px;
              top: {((editSpan.top + computeHalfLeadingTopOffsetPts(editSpan.lines?.[0]?.fontSize || editSpan.fontSize, editSpan.lines?.[0]?.lineHeight || editSpan.lineHeight || (editSpan.lines?.[0]?.fontSize || editSpan.fontSize) * 1.25)) * renderScale).toFixed(2)}px;
              min-width: {(editSpan.width * renderScale).toFixed(2)}px;
              width: fit-content;
              max-width: {(inlineMaxWidthPts * renderScale).toFixed(2)}px;
              min-height: {(editSpan.height * renderScale).toFixed(2)}px;
              font-size: {(editSpan.fontSize * renderScale).toFixed(2)}px;
              font-family: {getCssFontFamily(editSpan.rawFontFamily || editSpan.matchedFontFamily || editSpan.fontFamily, extractBaseFontFamily)};
              font-weight: {(editSpan.fontWeight ? editSpan.fontWeight === 'bold' : isBoldFontName(editSpan.rawFontFamily || editSpan.fontFamily)) ? 'bold' : 'normal'};
              font-style: {(editSpan.fontStyle ? editSpan.fontStyle === 'italic' : isItalicFontName(editSpan.rawFontFamily || editSpan.fontFamily)) ? 'italic' : 'normal'};
              color: rgba({editSpan.color.r}, {editSpan.color.g}, {editSpan.color.b}, {editSpan.color.a / 255});
              line-height: {editSpan.lineHeight ? (editSpan.lineHeight * renderScale).toFixed(2) + 'px' : '1.25'};
              letter-spacing: {formatScaledCssLetterSpacing(editSpan.letterSpacing, editSpan.fontSize, renderScale)};
              word-spacing: {formatScaledCssWordSpacing(editSpan.wordSpacing, renderScale)};
              text-rendering: geometricPrecision;
              -webkit-font-smoothing: antialiased;
              box-sizing: border-box;
              background-color: {editSpan.backgroundColor || 'transparent'};
              text-align: {editSpan.textAlign || 'left'};
              padding: 0;
              margin: 0;
              white-space: pre-wrap;
              word-break: break-word;
            "
            onblur={(e) => {
              if (isInspectorControlTarget(e.relatedTarget)) {
                return;
              }
              if (isSubmittingInlineEdit) return;
              isSubmittingInlineEdit = true;
              const target = e.currentTarget as HTMLDivElement;
              const extracted = extractStyledLinesFromEditor(target, renderScale, editSpan);
              actions.submitInlineEdit(extracted);
              setTimeout(() => { isSubmittingInlineEdit = false; }, 100);
            }}
            onkeydown={handleKeyDownInline}
          ></div>
        {/if}

        {#each allSpans as span (span.id)}
          {#if store.inlineEdit?.spanId !== span.id && !store.hiddenSpanIds.has(span.id)}
            <div
              data-span-id={span.id}
              class="absolute {store.isZooming ? 'pointer-events-none' : 'pointer-events-auto'} cursor-pointer group {getSpanZIndexClass(span)}"
              style="
                left: {(span.left * renderScale).toFixed(2)}px;
                top: {(span.top * renderScale).toFixed(2)}px;
                width: {(span.width * renderScale).toFixed(2)}px;
                height: {(span.height * renderScale).toFixed(2)}px;
                {'rotation' in span && typeof span.rotation === 'number' && span.rotation !== 0 ? `transform: rotate(${span.rotation}deg); transform-origin: center;` : ''}
              "
              onclick={(e) => {
                e.stopPropagation();
                if (store.hiddenSpanIds.has(span.id)) return;
                actions.setCurrentPageFromScroll(pageIndex);
                const isMulti = Boolean(
                  (e.ctrlKey || e.metaKey || e.shiftKey) &&
                  (!featureFlags || featureFlags.isEnabled('select-tool.multiselect'))
                );
                if (isMulti) {
                  actions.toggleSpanSelection(span);
                } else {
                  selection.clear();
                  canvasStore.selectElement(null);
                  actions.selectSpan(span);
                }
              }}
              ondblclick={async (e) => {
                e.stopPropagation();
                if (span.type === 'form-field') {
                  if (!store.canEditValues) return;
                  if (featureFlags ? featureFlags.isEnabled('canvas-elements') : true) {
                    await actions.extractObjectToCanvas(span.type, span, canvasStore);
                  }
                  return;
                }
                if (store.isReadOnly || !store.canEditContent) return;
                if (span.type === 'text') {
                  if (featureFlags ? featureFlags.isEnabled('text-editing') : true) {
                    actions.setCurrentPageFromScroll(pageIndex);
                    actions.startInlineEdit(span as EditableTextSpan);
                  }
                } else {
                  if (featureFlags ? featureFlags.isEnabled('canvas-elements') : true) {
                    await actions.extractObjectToCanvas(span.type, span, canvasStore);
                  }
                }
              }}
              role="button"
              tabindex="0"
              aria-label="{span.type === 'text' ? `Text block: ${(span as EditableTextSpan).text}` : (span.type === 'form-field' ? `Form field: ${(span as EditableFormFieldSpan).fieldName || (span as EditableFormFieldSpan).fieldId}` : `${span.type === 'image' ? 'Image' : 'Shape'} block`)}"
              onpointerdown={(e) => handleSpanPointerDown(e, span)}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  e.preventDefault();
                  actions.clearSelection(true);
                  canvasStore.selectElement(null);
                  return;
                }
                if (span.type !== 'text' && e.key === ' ') {
                  e.stopPropagation();
                  canvasStore.selectElement(null);
                  actions.selectSpan(span);
                }
              }}
            >
              {#if span.type === 'text'}
                {@const textSpan = span as EditableTextSpan}
                {#if textSpan.isOcr}
                  <span
                    class="absolute inset-0 select-text text-transparent selection:bg-selection/30 selection:text-transparent cursor-text overflow-hidden whitespace-pre pointer-events-auto"
                    style="
                      font-size: {(textSpan.fontSize * renderScale).toFixed(1)}px;
                      line-height: 1;
                      height: 100%;
                      font-family: {textSpan.fontFamily || 'Helvetica'}, sans-serif;
                    "
                  >{textSpan.text}</span>
                {/if}
                {#if textSpan.isOcr}
                  {#if textSpan.backgroundColor}
                    <div
                      class="absolute inset-0 pointer-events-none rounded-[2px]"
                      style="background-color: {textSpan.backgroundColor}; mix-blend-mode: multiply;"
                    ></div>
                  {:else if textSpan.lines && textSpan.lines.length > 0}
                    {#each textSpan.lines as line}
                      {#if line.backgroundColor}
                        <div
                          class="absolute pointer-events-none rounded-[2px]"
                          style="
                            left: {Math.max(0, Math.round((line.left - span.left) * renderScale))}px;
                            top: {Math.max(0, Math.round((line.top - span.top) * renderScale))}px;
                            width: {Math.max(2, Math.round(line.width * renderScale))}px;
                            height: {Math.max(2, Math.round(line.height * renderScale))}px;
                            background-color: {line.backgroundColor};
                            mix-blend-mode: multiply;
                          "
                        ></div>
                      {/if}
                      {#if line.words}
                        {#each line.words as word}
                          {#if word.backgroundColor && !line.backgroundColor}
                            <div
                              class="absolute pointer-events-none rounded-[2px]"
                              style="
                                left: {Math.max(0, Math.round((word.left - span.left) * renderScale))}px;
                                top: {Math.max(0, Math.round((word.top - span.top) * renderScale))}px;
                                width: {Math.max(2, Math.round(word.width * renderScale))}px;
                                height: {Math.max(2, Math.round(word.height * renderScale))}px;
                                background-color: {word.backgroundColor};
                                mix-blend-mode: multiply;
                              "
                            ></div>
                          {/if}
                        {/each}
                      {/if}
                    {/each}
                  {/if}
                  {#if textSpan.lines && textSpan.lines.length > 0}
                    {#each textSpan.lines as line}
                      {@const isLineU = Boolean(line.underline || textSpan.underline)}
                      {@const isLineS = Boolean(line.strikethrough || textSpan.strikethrough)}
                      {@const lFs = line.fontSize || textSpan.fontSize}
                      {@const lineRelLeft = Math.max(0, Math.round((line.left - span.left) * renderScale))}
                      {@const lineW = Math.max(2, Math.round(line.width * renderScale))}
                      {@const uTop = Math.round((line.top - span.top + lFs * 0.94) * renderScale)}
                      {@const sTop = Math.round((line.top - span.top + lFs * 0.52) * renderScale)}

                      {#if isLineU}
                        <div
                          class="absolute pointer-events-none"
                          style="
                            left: {lineRelLeft}px;
                            top: {uTop}px;
                            width: {lineW}px;
                            height: {Math.max(1, Math.round(1.5 * renderScale))}px;
                            background-color: rgba({textSpan.color.r}, {textSpan.color.g}, {textSpan.color.b}, {textSpan.color.a / 255});
                          "
                        ></div>
                      {/if}

                      {#if isLineS}
                        <div
                          class="absolute pointer-events-none"
                          style="
                            left: {lineRelLeft}px;
                            top: {sTop}px;
                            width: {lineW}px;
                            height: {Math.max(1, Math.round(1.5 * renderScale))}px;
                            background-color: rgba({textSpan.color.r}, {textSpan.color.g}, {textSpan.color.b}, {textSpan.color.a / 255});
                          "
                        ></div>
                      {/if}

                      {#if line.words}
                        {#each line.words as word}
                          {@const wFs = word.fontSize || lFs}
                          {@const wRelLeft = Math.max(0, Math.round((word.left - span.left) * renderScale))}
                          {@const wW = Math.max(2, Math.round(word.width * renderScale))}
                          {@const wColor = word.color || textSpan.color}
                          {@const wUTop = Math.round((word.top - span.top + wFs * 0.94) * renderScale)}
                          {@const wSTop = Math.round((word.top - span.top + wFs * 0.52) * renderScale)}

                          {#if word.underline && !isLineU}
                            <div
                              class="absolute pointer-events-none"
                              style="
                                left: {wRelLeft}px;
                                top: {wUTop}px;
                                width: {wW}px;
                                height: {Math.max(1, Math.round(1.5 * renderScale))}px;
                                background-color: rgba({wColor.r}, {wColor.g}, {wColor.b}, {wColor.a / 255});
                              "
                            ></div>
                          {/if}
                          {#if word.strikethrough && !isLineS}
                            <div
                              class="absolute pointer-events-none"
                              style="
                                left: {wRelLeft}px;
                                top: {wSTop}px;
                                width: {wW}px;
                                height: {Math.max(1, Math.round(1.5 * renderScale))}px;
                                background-color: rgba({wColor.r}, {wColor.g}, {wColor.b}, {wColor.a / 255});
                              "
                            ></div>
                          {/if}
                        {/each}
                      {/if}
                    {/each}
                  {:else}
                    {#if textSpan.underline}
                      <div
                        class="absolute left-0 w-full pointer-events-none"
                        style="
                          bottom: 1px;
                          height: {Math.max(1, Math.round(1.5 * renderScale))}px;
                          background-color: rgba({textSpan.color.r}, {textSpan.color.g}, {textSpan.color.b}, {textSpan.color.a / 255});
                        "
                      ></div>
                    {/if}
                    {#if textSpan.strikethrough}
                      <div
                        class="absolute left-0 w-full pointer-events-none"
                        style="
                          top: 50%;
                          height: {Math.max(1, Math.round(1.5 * renderScale))}px;
                          background-color: rgba({textSpan.color.r}, {textSpan.color.g}, {textSpan.color.b}, {textSpan.color.a / 255});
                        "
                      ></div>
                    {/if}
                  {/if}
                {/if}
                {@const isVert = textSpan.isVertical || textSpan.rotation === 90 || textSpan.rotation === 270}
                {#if textSpan.lines && textSpan.lines.length > 0}
                  {#each textSpan.lines as line}
                    {#if isVert}
                      <div
                        class="absolute w-[1.5px] bg-selection pointer-events-none {store.selectedSpan?.id === span.id ? 'block' : 'hidden group-hover:block'}"
                        style="
                          left: {Math.round(getVerticalLineBaselineLeft(span.left, line.left, line.fontSize, line.baselineY, line.domBaseline) * renderScale)}px;
                          top: {Math.round((line.top - span.top) * renderScale)}px;
                          height: {Math.max(2, Math.round(line.height * renderScale))}px;
                          backface-visibility: hidden;
                          transform: translateZ(0);
                        "
                      ></div>
                    {:else}
                      <div
                        class="absolute h-[1.5px] bg-selection pointer-events-none {store.selectedSpan?.id === span.id ? 'block' : 'hidden group-hover:block'}"
                        style="
                          left: {Math.round((line.left - span.left) * renderScale)}px;
                          width: {Math.max(2, Math.round(line.width * renderScale))}px;
                          top: {Math.round(getLineBaselineTop(span.top, line.top, line.fontSize, line.baselineY, line.domBaseline) * renderScale)}px;
                          backface-visibility: hidden;
                          transform: translateZ(0);
                        "
                      ></div>
                    {/if}
                  {/each}
                {:else}
                  {#if isVert}
                    <div
                      class="absolute top-0 h-full w-[1.5px] bg-selection pointer-events-none {store.selectedSpan?.id === span.id ? 'block' : 'hidden group-hover:block'}"
                      style="
                        left: {Math.round(getVerticalLineBaselineLeft(span.left, span.left, (span as EditableTextSpan).fontSize, (span as EditableTextSpan).baselineY, (span as EditableTextSpan).domBaseline) * renderScale)}px;
                        backface-visibility: hidden;
                        transform: translateZ(0);
                      "
                    ></div>
                  {:else}
                    <div
                      class="absolute left-0 w-full h-[1.5px] bg-selection pointer-events-none {store.selectedSpan?.id === span.id ? 'block' : 'hidden group-hover:block'}"
                      style="
                        top: {Math.round(getLineBaselineTop(span.top, span.top, (span as EditableTextSpan).fontSize, (span as EditableTextSpan).baselineY, (span as EditableTextSpan).domBaseline) * renderScale)}px;
                        backface-visibility: hidden;
                        transform: translateZ(0);
                      "
                    ></div>
                  {/if}
                {/if}
              {:else if span.type === 'form-field'}
                {@const formSpan = span as EditableFormFieldSpan}
                <div
                  class="absolute inset-0 rounded-[3px] border border-selection bg-selection/10 hover:bg-selection/15 transition-colors pointer-events-none flex items-center px-1.5 text-[11px] font-sans text-foreground overflow-hidden select-none"
                  style="
                    {formSpan.backgroundColor ? `background-color: ${formSpan.backgroundColor};` : ''}
                    {formSpan.borderColor ? `border-color: ${formSpan.borderColor};` : ''}
                    {formSpan.borderWidth !== undefined ? `border-width: ${Math.max(1, Math.round(formSpan.borderWidth * renderScale))}px;` : ''}
                  "
                >
                  {#if formSpan.variant === 'checkbox'}
                    <CheckSquare class="w-3.5 h-3.5 mr-1 shrink-0 text-selection" />
                  {:else if formSpan.variant === 'radio'}
                    <Circle class="w-3.5 h-3.5 mr-1 shrink-0 text-selection" />
                  {:else if formSpan.variant === 'dropdown'}
                    <ChevronDown class="w-3.5 h-3.5 mr-1 shrink-0 text-selection" />
                  {:else if formSpan.variant === 'signature'}
                    <PenTool class="w-3 h-3 mr-1 shrink-0 text-selection" />
                  {:else}
                    <span class="w-1.5 h-1.5 rounded-full bg-selection mr-1 shrink-0"></span>
                  {/if}
                  <span class="truncate opacity-80 leading-none" title={String(formSpan.value !== undefined && formSpan.value !== '' ? formSpan.value : (formSpan.fieldName || formSpan.fieldId || ''))}>{formSpan.value !== undefined && formSpan.value !== '' ? formSpan.value : (formSpan.fieldName || formSpan.fieldId)}</span>
                  {#if formSpan.required}
                    <span class="text-destructive font-bold ml-0.5 select-none">*</span>
                  {/if}
                </div>
                <div
                  class="absolute top-0 right-0 bg-selection text-white text-[9px] px-1.5 py-0.5 rounded-bl-[3px] font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none select-none z-10 leading-none shadow-none"
                  style="{formSpan.borderColor ? `background-color: ${formSpan.borderColor};` : ''}"
                >
                  AcroForm
                </div>
              {:else if span.type === 'image' || span.type === 'shape'}
                <div class="absolute inset-0 ring-[1.5px] ring-inset ring-selection {store.selectedSpan?.id === span.id ? 'hidden' : 'hidden group-hover:block'} pointer-events-none"></div>
              {/if}
            </div>
          {/if}
        {/each}

        <!-- Span Selection Overlay (Kept visible during inline edit for consistent selection borders and white square handles) -->
        {#if store.selectedSpan?.pageIndex === pageIndex && !store.isReadOnly && store.canSelectElements}
          <div class="absolute inset-0 pointer-events-none z-20">
            {#each (store.selectedSpans.length > 0 ? store.selectedSpans.filter((s) => s.pageIndex === pageIndex) : [store.selectedSpan]) as selectedItem (selectedItem.id)}
              <SelectionOverlay 
                element={{ 
                  id: selectedItem.id, 
                  x: selectedItem.left, 
                  y: selectedItem.top, 
                  width: selectedItem.width, 
                  height: selectedItem.height, 
                  rotation: ('rotation' in selectedItem && typeof selectedItem.rotation === 'number' ? selectedItem.rotation : 0),
                  kind: 'type' in selectedItem && typeof selectedItem.type === 'string' ? selectedItem.type : undefined,
                  type: 'type' in selectedItem && typeof selectedItem.type === 'string' ? selectedItem.type : undefined,
                  variant: 'variant' in selectedItem && typeof selectedItem.variant === 'string' ? selectedItem.variant : undefined,
                }} 
                zoom={renderScale} 
                showRotateCursor={store.selectedSpans.length <= 1 && selectedItem.type !== 'text'} 
                onResizeStart={async (e, handle, _pageEl) => {
                  const type = selectedItem.type as 'text' | 'image' | 'shape' | 'form-field';
                  const multiTransformEnabled =
                    !featureFlags ||
                    (featureFlags.isEnabled('select-tool.multiselect') &&
                     featureFlags.isEnabled('select-tool.multiselect.transform'));
                  const newId = multiTransformEnabled
                    ? (await actions.extractSelectedSpansToCanvas(selectedItem, canvasStore)).primaryElementId
                    : await actions.extractObjectToCanvas(type, selectedItem as EditableTextSpan | EditableImageSpan | EditableShapeSpan | EditableFormFieldSpan, canvasStore);
                  if (newId) {
                    const canvasLayer = containerWrapperEl?.querySelector('[data-canvas-layer]') as HTMLElement | null;
                    canvasActions.startResize(newId, handle, e.clientX, e.clientY, canvasLayer ?? _pageEl, visualScale, effectivePageTransform);
                  }
                }}
                onAdjustStart={async (e, handle, _pageEl) => {
                  const type = selectedItem.type as 'text' | 'image' | 'shape' | 'form-field';
                  const multiTransformEnabled =
                    !featureFlags ||
                    (featureFlags.isEnabled('select-tool.multiselect') &&
                     featureFlags.isEnabled('select-tool.multiselect.transform'));
                  const newId = multiTransformEnabled
                    ? (await actions.extractSelectedSpansToCanvas(selectedItem, canvasStore)).primaryElementId
                    : await actions.extractObjectToCanvas(type, selectedItem as EditableTextSpan | EditableImageSpan | EditableShapeSpan | EditableFormFieldSpan, canvasStore);
                  if (newId) {
                    const canvasLayer = containerWrapperEl?.querySelector('[data-canvas-layer]') as HTMLElement | null;
                    canvasActions.startEndpointAdjust(newId, handle, e.clientX, e.clientY, canvasLayer ?? _pageEl, visualScale, effectivePageTransform);
                  }
                }}
                onRotateStart={async (e, _pageEl) => {
                  const type = selectedItem.type as 'text' | 'image' | 'shape' | 'form-field';
                  const multiTransformEnabled =
                    !featureFlags ||
                    (featureFlags.isEnabled('select-tool.multiselect') &&
                     featureFlags.isEnabled('select-tool.multiselect.transform'));
                  const newId = multiTransformEnabled
                    ? (await actions.extractSelectedSpansToCanvas(selectedItem, canvasStore)).primaryElementId
                    : await actions.extractObjectToCanvas(type, selectedItem as EditableTextSpan | EditableImageSpan | EditableShapeSpan | EditableFormFieldSpan, canvasStore);
                  if (newId) {
                    const canvasLayer = containerWrapperEl?.querySelector('[data-canvas-layer]') as HTMLElement | null;
                    canvasActions.startRotate(newId, e.clientX, e.clientY, canvasLayer ?? _pageEl, visualScale, effectivePageTransform);
                  }
                }}
              />
            {/each}
          </div>
        {:else if store.selectedSpans.some((s) => s.pageIndex === pageIndex) && !store.isReadOnly && store.canSelectElements}
          <div class="absolute inset-0 pointer-events-none z-20">
            {#each store.selectedSpans.filter((s) => s.pageIndex === pageIndex) as selectedItem (selectedItem.id)}
              <SelectionOverlay 
                element={{ 
                  id: selectedItem.id, 
                  x: selectedItem.left, 
                  y: selectedItem.top, 
                  width: selectedItem.width, 
                  height: selectedItem.height, 
                  rotation: ('rotation' in selectedItem && typeof selectedItem.rotation === 'number' ? selectedItem.rotation : 0),
                  kind: 'type' in selectedItem && typeof selectedItem.type === 'string' ? selectedItem.type : undefined,
                  type: 'type' in selectedItem && typeof selectedItem.type === 'string' ? selectedItem.type : undefined,
                  variant: 'variant' in selectedItem && typeof selectedItem.variant === 'string' ? selectedItem.variant : undefined,
                }} 
                zoom={renderScale} 
                showRotateCursor={store.selectedSpans.length <= 1 && selectedItem.type !== 'text'} 
                onResizeStart={async (e, handle, _pageEl) => {
                  const type = selectedItem.type as 'text' | 'image' | 'shape' | 'form-field';
                  const multiTransformEnabled =
                    !featureFlags ||
                    (featureFlags.isEnabled('select-tool.multiselect') &&
                     featureFlags.isEnabled('select-tool.multiselect.transform'));
                  const newId = multiTransformEnabled
                    ? (await actions.extractSelectedSpansToCanvas(selectedItem, canvasStore)).primaryElementId
                    : await actions.extractObjectToCanvas(type, selectedItem as EditableTextSpan | EditableImageSpan | EditableShapeSpan | EditableFormFieldSpan, canvasStore);
                  if (newId) {
                    const canvasLayer = containerWrapperEl?.querySelector('[data-canvas-layer]') as HTMLElement | null;
                    canvasActions.startResize(newId, handle, e.clientX, e.clientY, canvasLayer ?? _pageEl, visualScale, effectivePageTransform);
                  }
                }}
                onAdjustStart={async (e, handle, _pageEl) => {
                  const type = selectedItem.type as 'text' | 'image' | 'shape' | 'form-field';
                  const multiTransformEnabled =
                    !featureFlags ||
                    (featureFlags.isEnabled('select-tool.multiselect') &&
                     featureFlags.isEnabled('select-tool.multiselect.transform'));
                  const newId = multiTransformEnabled
                    ? (await actions.extractSelectedSpansToCanvas(selectedItem, canvasStore)).primaryElementId
                    : await actions.extractObjectToCanvas(type, selectedItem as EditableTextSpan | EditableImageSpan | EditableShapeSpan | EditableFormFieldSpan, canvasStore);
                  if (newId) {
                    const canvasLayer = containerWrapperEl?.querySelector('[data-canvas-layer]') as HTMLElement | null;
                    canvasActions.startEndpointAdjust(newId, handle, e.clientX, e.clientY, canvasLayer ?? _pageEl, visualScale, effectivePageTransform);
                  }
                }}
                onRotateStart={async (e, _pageEl) => {
                  const type = selectedItem.type as 'text' | 'image' | 'shape' | 'form-field';
                  const multiTransformEnabled =
                    !featureFlags ||
                    (featureFlags.isEnabled('select-tool.multiselect') &&
                     featureFlags.isEnabled('select-tool.multiselect.transform'));
                  const newId = multiTransformEnabled
                    ? (await actions.extractSelectedSpansToCanvas(selectedItem, canvasStore)).primaryElementId
                    : await actions.extractObjectToCanvas(type, selectedItem as EditableTextSpan | EditableImageSpan | EditableShapeSpan | EditableFormFieldSpan, canvasStore);
                  if (newId) {
                    const canvasLayer = containerWrapperEl?.querySelector('[data-canvas-layer]') as HTMLElement | null;
                    canvasActions.startRotate(newId, e.clientX, e.clientY, canvasLayer ?? _pageEl, visualScale, effectivePageTransform);
                  }
                }}
              />
            {/each}
          </div>
        {/if}

        <!-- Marquee Selection Rectangle Overlay -->
        {#if isMarqueeActive && marqueeRect}
          <div
            data-marquee-additive={marqueeAdditive}
            class="absolute border border-selection bg-selection/15 pointer-events-none rounded-[1px] z-[55]"
            style="
              left: {Math.round(marqueeRect.x * renderScale)}px;
              top: {Math.round(marqueeRect.y * renderScale)}px;
              width: {Math.round(marqueeRect.width * renderScale)}px;
              height: {Math.round(marqueeRect.height * renderScale)}px;
            "
          ></div>
        {/if}
      </div>
    {/if}

    <!-- Annotation & Drawing Tool Interactive Overlay (Topmost) -->
    {#if store.activeTool === 'pen' || store.activeTool === 'highlight' || store.activeTool === 'redact' || store.activeTool === 'note' || store.activeTool === 'eraser' || store.activeTool === 'text'}
      <div 
        class="absolute inset-0 z-[60] touch-none {store.activeTool === 'note' ? 'cursor-cell' : (store.activeTool === 'text' ? 'cursor-text' : (store.activeTool === 'eraser' ? 'cursor-crosshair' : ((store.activeTool === 'highlight' || store.activeTool === 'redact' || store.activeTool === 'pen') ? (hoveringChar || isTextHighlightMode ? 'cursor-text' : 'cursor-crosshair') : (activeToolDef?.cursor || 'cursor-crosshair'))))}"
        onpointerdown={handlePointerDownDrawing}
        onpointermove={handlePointerMoveDrawing}
        onpointerup={handlePointerUpDrawing}
        onpointercancel={handlePointerUpDrawing}
        onpointerleave={() => { if (!isDrawing) hoveringChar = null; }}
        role="presentation"
      ></div>
    {/if}

    <!-- Live Highlight & Redaction Drawing Preview Overlay -->
    {#if isDrawing && previewHighlightRects.length > 0}
      <div class="absolute inset-0 pointer-events-none z-[55]">
        {#each previewHighlightRects as rect}
          {#if store.activeTool === 'redact'}
            <div
              class="absolute pointer-events-none border border-destructive/80 rounded-[1px]"
              style="
                left: {(rect.x * visualScale).toFixed(2)}px;
                top: {(rect.y * visualScale).toFixed(2)}px;
                width: {(rect.width * visualScale).toFixed(2)}px;
                height: {(rect.height * visualScale).toFixed(2)}px;
                background-color: #000000;
                opacity: 0.8;
              "
            ></div>
          {:else if store.activeTool === 'highlight'}
            <div
              class="absolute pointer-events-none rounded-[1px]"
              style="
                left: {(rect.x * visualScale).toFixed(2)}px;
                top: {(rect.y * visualScale).toFixed(2)}px;
                width: {(rect.width * visualScale).toFixed(2)}px;
                height: {(rect.height * visualScale).toFixed(2)}px;
                background-color: {store.annotateColor};
                opacity: 0.4;
                mix-blend-mode: multiply;
              "
            ></div>
          {:else if store.activeTool === 'pen'}
            <div
              class="absolute pointer-events-none rounded-[1px]"
              style="
                left: {(rect.x * visualScale).toFixed(2)}px;
                top: {((rect.baselineY !== undefined ? rect.baselineY + 1 : rect.y + rect.height - store.annotateStrokeWidth) * visualScale).toFixed(2)}px;
                width: {(rect.width * visualScale).toFixed(2)}px;
                height: {Math.max(1.5, store.annotateStrokeWidth * visualScale).toFixed(2)}px;
                background-color: {store.annotateColor};
              "
            ></div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <!-- Canvas element overlay for user-added elements (positioned outside overflow-hidden for seamless cross-page dragging) -->
  {#if !store.showOrganizerView && (featureFlags ? featureFlags.isEnabled('canvas-elements') : true)}
    <CanvasElementLayer {pageIndex} zoom={visualScale} />
  {/if}

  <!-- Active Page Crop Overlay (outside overflow-hidden and after CanvasElementLayer so handles and floating action badge sit above all canvas elements) -->
  {#if isPageCropping && (featureFlags ? featureFlags.isEnabled('crop') : true)}
    <CropOverlay
      {pageIndex}
      containerEl={containerWrapperEl}
      {widthPts}
      {heightPts}
      {visualScale}
      {pageTransform}
    />
  {/if}

  <!-- Active Digital Signature Placement Overlay -->
  {#if store.pendingDigitalSignature !== null && store.pendingDigitalSignature.pageIndex === pageIndex && (featureFlags ? featureFlags.isEnabled('signatures.cert-sign.interactive-placement') : true)}
    <DigitalSignaturePlacementOverlay
      {pageIndex}
      containerEl={containerWrapperEl}
      {widthPts}
      {heightPts}
      {visualScale}
      {pageTransform}
    />
  {/if}

  {#if selection.isSelected(`page_${pageIndex}`) && !isPageCropping && !store.isReadOnly && store.canSelectElements}
    <div class="absolute inset-0 z-10 pointer-events-none">
      <SelectionOverlay 
        element={{ id: `page_${pageIndex}`, x: 0, y: 0, width: widthPts, height: heightPts, rotation: 0 }} 
        zoom={visualScale} 
        showRotateCursor={false}
        onResizeStart={(e, handle, _pageEl) => handlePageResizeStart(e, handle)}
        onRotateStart={(e, _pageEl) => handlePageRotateStart(e)}
      />
    </div>
  {/if}


  <!-- Scanned Document OCR Badge and Progress Indicator -->
  {#if canRecognizePage && store.scannedPages.has(pageIndex) && !store.pageOcrResults.has(pageIndex)}
    <div class="absolute top-2.5 right-2.5 z-30 pointer-events-auto">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium bg-card/95 hover:bg-card text-foreground border border-border/80 rounded-md backdrop-blur-sm transition-[color,background-color,border-color] hover:border-ring cursor-pointer"
        onclick={(e) => {
          e.stopPropagation();
          actions.runOcrOnPage(pageIndex);
        }}
        title="Scanned page detected. Click to recognize text for selection and editing."
      >
        <ScanText class="h-3.5 w-3.5" />
        <span>Recognize Text</span>
      </button>
    </div>
  {:else if canRecognizePage && store.isOcrRunning && store.ocrProgress?.pageIndex === pageIndex}
    <div class="absolute top-2.5 right-2.5 z-30 pointer-events-auto">
      <div class="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium bg-card/95 text-foreground border border-border/80 rounded-md backdrop-blur-sm">
        <Loader2 class="h-3.5 w-3.5 animate-spin" />
        <span>{store.ocrProgress.status || 'Recognizing text...'}</span>
      </div>
    </div>
  {/if}
</div>
