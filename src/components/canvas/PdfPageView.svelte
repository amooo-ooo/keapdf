<script lang="ts">
  import { untrack } from 'svelte';
  import type { EditableSpan, EditableTextSpan, EditableImageSpan, EditableShapeSpan, EditableFormFieldSpan, PageCharacter, HighlightRect, TextLine, TextWord, AnnotationItem, PageCropInfo } from '../../core/types';
  import { CheckSquare, Circle, ChevronDown, PenTool, ScanText, Loader2 } from 'lucide-svelte';
  import { getUnifiedPageCharacters, findUnifiedCharacterAt, findClosestUnifiedCharacter, calculateUnifiedHighlightRects } from '../../services/pdf/unified-text-provider';
  import { OcrService } from '../../services/ocr';
  import { useEditorStore, getFileBuffer } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useSelection } from '../../stores/selection.svelte';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import { safeClone } from '../../utils/clone-utils';
  import type { Command } from '../../core/command';
  import { collectEraserCandidates, resolveUpperZCandidate, type LastErasedState } from '../../services/eraser/eraser-engine';
  import type { CanvasElement } from '../../stores/canvas-types';
  import { extractBaseFontFamily } from '../../services/pdf/font-charset-index';
  import { getCssFontFamily } from '../../services/font-loader';
  import { sanitizePdfText, parseColor } from '../../services/pdf/utils';
  import CropOverlay from './CropOverlay.svelte';
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
  import CanvasElementLayer from './CanvasElementLayer.svelte';
  import SelectionOverlay from './SelectionOverlay.svelte';
  import type { HandlePosition, PathElement } from '../../stores/canvas-types';
  import { SetPageTransformCommand, RotatePageCommand, AddElementCommand, CompoundCommand } from '../../commands';
  import { screenToPageCoords } from '../../utils/geometry';
  import { useElementRegistry } from '../../core/element-registry';
  import { useToolRegistry } from '../../core/tool-registry';
  import { useWebMcpStore } from '../../stores/webmcp.svelte';
  import { useFeatureFlagStore } from '../../core/feature-flags';

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
  const featureFlags = resolveFeatureFlags();

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

  function sortByAreaDescending<T extends { width: number; height: number }>(items: T[]): T[] {
    return items.slice().sort((a, b) => (b.width * b.height) - (a.width * a.height));
  }

  const allSpans = $derived([
    ...editableImageSpans,
    ...editableShapeSpans,
    ...editableSpans,
    ...editableFormFieldSpans,
  ]);

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
  let isVisible = $state(false);

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
    clearTimeout(zoomTimeout);
    zoomTimeout = setTimeout(() => {
      renderScale = currentZoom;
    }, 150);

    return () => {
      clearTimeout(zoomTimeout);
    };
  });

  const showOverlays = $derived(!store.showOrganizerView && (store.activeTool === 'select' || store.activeTool === 'text' || store.activeTool === 'highlight' || store.activeTool === 'pen' || store.activeTool === 'redact' || store.activeTool === 'note' || store.activeTool === 'eraser') && isVisible);

  const unifiedCharacters = $derived(
    (store.activeTool === 'highlight' || store.activeTool === 'redact') && isVisible
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
      const lFontSize = line.fontSize || span.fontSize;
      lineDiv.dataset.fontSize = `${lFontSize}`;
      lineDiv.style.fontSize = `${lFontSize * renderScale}px`;
      if (line.lineHeight) {
        lineDiv.dataset.lineHeight = `${line.lineHeight}`;
        lineDiv.style.lineHeight = `${(line.lineHeight * renderScale).toFixed(2)}px`;
      } else {
        lineDiv.style.lineHeight = '1.25';
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
        const bFs = line.bulletWord.fontSize || line.fontSize || span.fontSize;
        bulletSpan.dataset.fontSize = `${bFs}`;
        bulletSpan.style.fontSize = `${bFs * renderScale}px`;
        bulletSpan.style.fontFamily = getCssFontFamily(line.bulletWord.rawFontFamily || line.bulletWord.matchedFontFamily || line.rawFontFamily || line.matchedFontFamily || span.rawFontFamily || span.matchedFontFamily || span.fontFamily, extractBaseFontFamily);
        const isBold = (line.bulletWord.rawFontFamily || '').toLowerCase().includes('bold') || line.bulletWord.fontWeight === 'bold';
        const isItalic = (line.bulletWord.rawFontFamily || '').toLowerCase().includes('italic') || line.bulletWord.fontStyle === 'italic';
        if (isBold) bulletSpan.style.fontWeight = 'bold';
        if (isItalic) bulletSpan.style.fontStyle = 'italic';
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
      } else {
        const relativeIndent = Math.max(0, line.left - span.left);
        if (relativeIndent > 1.0) {
          lineDiv.dataset.paddingLeft = `${relativeIndent}`;
          lineDiv.style.paddingLeft = `${(relativeIndent * renderScale).toFixed(2)}px`;
        }
      }

      if (line.words && line.words.length > 0) {
        for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
          const word = line.words[wIdx];
          if (wIdx > 0) {
            const prev = line.words[wIdx - 1];
            const gap = word.left - prev.right;
            if (word.hasPrecedingSpace || gap >= Math.min(prev.fontSize, word.fontSize) * 0.12 || gap >= 0.5) {
              lineDiv.appendChild(document.createTextNode(' '));
            }
          }
          const wordSpan = document.createElement('span');
          const wFs = word.fontSize || line.fontSize || span.fontSize;
          wordSpan.dataset.fontSize = `${wFs}`;
          if (word.hasPrecedingSpace) {
            wordSpan.dataset.hasPrecedingSpace = 'true';
          }
          wordSpan.style.fontSize = `${wFs * renderScale}px`;
          wordSpan.style.fontFamily = getCssFontFamily(word.rawFontFamily || word.matchedFontFamily || line.rawFontFamily || line.matchedFontFamily || span.rawFontFamily || span.matchedFontFamily || span.fontFamily, extractBaseFontFamily);
          const isBold = (word.rawFontFamily || line.rawFontFamily || '').toLowerCase().includes('bold') || word.fontWeight === 'bold';
          const isItalic = (word.rawFontFamily || line.rawFontFamily || '').toLowerCase().includes('italic') || word.fontStyle === 'italic';
          if (isBold) wordSpan.style.fontWeight = 'bold';
          if (isItalic) wordSpan.style.fontStyle = 'italic';
          if (word.color) {
            const col = word.color;
            const alpha = col.a !== undefined ? (col.a <= 1 ? col.a : col.a / 255) : 1;
            wordSpan.style.color = `rgba(${col.r}, ${col.g}, ${col.b}, ${alpha})`;
          }
          if (word.underline || word.strikethrough) {
            wordSpan.style.textDecoration = resolveTextDecoration(word.underline, word.strikethrough);
          }
          if (word.backgroundColor) {
            wordSpan.style.backgroundColor = word.backgroundColor;
          }
          wordSpan.textContent = word.text;
          lineDiv.appendChild(wordSpan);
        }
      } else {
        lineDiv.appendChild(document.createTextNode(line.text));
      }
      node.appendChild(lineDiv);
    }
  }

  let inlineEditorEl = $state<HTMLDivElement | null>(null);

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
      const activeSel = getActiveEditorSelection();
      if (styledLines && styledLines.length > 0 && activeSel && activeSel.mode === 'pdf' && activeSel.targetId === edit.span.id) {
        if (document.activeElement !== inlineEditorEl && !inlineEditorEl.contains(document.activeElement)) {
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
    if (inlineEditorEl && store.inlineEdit && store.inlineEdit.span.pageIndex === pageIndex) {
      const lineEls = inlineEditorEl.querySelectorAll<HTMLElement>('.inline-edit-line');
      lineEls.forEach((lEl) => {
        const lineFs = lEl.dataset.fontSize ? parseFloat(lEl.dataset.fontSize) : null;
        if (lineFs) {
          lEl.style.fontSize = `${lineFs * currentScale}px`;
        }
        const lineH = lEl.dataset.lineHeight ? parseFloat(lEl.dataset.lineHeight) : null;
        if (lineH) {
          lEl.style.lineHeight = `${(lineH * currentScale).toFixed(2)}px`;
        }
        const padLeft = lEl.dataset.paddingLeft ? parseFloat(lEl.dataset.paddingLeft) : null;
        if (padLeft) {
          lEl.style.paddingLeft = `${(padLeft * currentScale).toFixed(2)}px`;
        }
      });

      const spanEls = inlineEditorEl.querySelectorAll<HTMLElement>('span[data-font-size]');
      spanEls.forEach((sEl) => {
        const fs = parseFloat(sEl.dataset.fontSize!);
        if (!isNaN(fs) && fs > 0) {
          sEl.style.fontSize = `${fs * currentScale}px`;
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

      const isSameLineCount = Boolean(span.lines && rawLineNodeGroups.length === span.lines.length);
      const origLine = isSameLineCount
        ? span.lines![lineIdx]
        : (findBestMatchingOrigLine(lineText, span.lines, lineIdx) || span.lines?.[Math.min(lineIdx, (span.lines?.length || 1) - 1)]);

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
            const lineFs = origLine?.fontSize ?? span.fontSize;
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
              const hasPrecedingSpace = pendingTextNodeSpace || (words.length > 0);
              const spaceOffset = hasPrecedingSpace ? lineFs * 0.25 : 0;
              const wLeft = prevWord ? prevWord.right + spaceOffset : (isBulletSpan && lineIdx === 0 ? firstLineTextLeft : (origLine?.left ?? span.left));
              const wWidth = cleanToken.length * approxCharW;
              words.push({
                text: cleanToken,
                left: wLeft,
                top: origLine?.top ?? span.top,
                right: wLeft + wWidth,
                bottom: origLine?.bottom ?? (span.top + span.height),
                width: wWidth,
                height: origLine?.height ?? lineFs,
                fontSize: lineFs,
                baselineY: origLine?.baselineY ?? span.baselineY,
                charStartIndex: 0,
                charCount: cleanToken.length,
                fontFamily: origLine?.fontFamily ?? span.fontFamily,
                rawFontFamily: origLine?.rawFontFamily ?? span.rawFontFamily,
                matchedFontFamily: origLine?.matchedFontFamily ?? span.matchedFontFamily,
                color: origLine?.color ?? span.color,
                fontWeight: origLine?.fontWeight ?? span.fontWeight,
                fontStyle: origLine?.fontStyle ?? span.fontStyle,
                hasPrecedingSpace,
              });
              pendingTextNodeSpace = false;
            }
          }
          return;
        }

        if (child instanceof HTMLSpanElement) {
          const spanEl = child;
          const wordText = sanitizePdfText(spanEl.textContent || '');
          if (wordText.length === 0) return;
          const rawFSize = spanEl.dataset.fontSize ? parseFloat(spanEl.dataset.fontSize) : (parseFloat(spanEl.style.fontSize) / scale);
          const fSize = !isNaN(rawFSize) && rawFSize > 0 ? rawFSize : (origLine?.fontSize ?? span.fontSize);
          const origWord = origLine?.words?.[wIdx];

          words.push({
            text: wordText,
            left: origWord?.left ?? (isBulletSpan ? firstLineTextLeft : span.left),
            top: origWord?.top ?? span.top,
            right: origWord?.right ?? (span.left + span.width),
            bottom: origWord?.bottom ?? (span.top + span.height),
            width: origWord?.width ?? 0,
            height: origWord?.height ?? fSize,
            fontSize: fSize,
            baselineY: origWord?.baselineY ?? span.baselineY,
            charStartIndex: 0,
            charCount: wordText.length,
            fontFamily: origWord?.fontFamily ?? span.fontFamily,
            rawFontFamily: origWord?.rawFontFamily ?? span.rawFontFamily,
            color: origWord?.color ?? span.color,
            fontWeight: origWord?.fontWeight ?? (spanEl.style.fontWeight === 'bold' ? 'bold' : 'normal'),
            fontStyle: origWord?.fontStyle ?? (spanEl.style.fontStyle === 'italic' ? 'italic' : 'normal'),
          });
        });
      }

      const lineFontSize = origLine?.fontSize ?? (words.length > 0 ? words[0].fontSize : span.fontSize);
      const lineLeft = isBulletSpan ? firstLineTextLeft : (origLine?.left ?? span.left);

      lines.push({
        text: lineText,
        left: lineLeft,
        top: origLine?.top ?? span.top,
        right: origLine?.right ?? (span.left + span.width),
        bottom: origLine?.bottom ?? (span.top + span.height),
        width: origLine?.width ?? span.width,
        height: origLine?.height ?? (span.lineHeight || span.fontSize * 1.25),
        fontSize: lineFontSize,
        baselineY: origLine?.baselineY ?? (span.baselineY - lineIdx * (span.lineHeight || span.fontSize * 1.25)),
        lineHeight: origLine?.lineHeight ?? span.lineHeight ?? (span.fontSize * 1.25),
        charStartIndex: 0,
        charCount: lineText.length,
        words: words.length > 0 ? words : (origLine?.words ?? []),
        fontFamily: origLine?.fontFamily ?? span.fontFamily,
        rawFontFamily: origLine?.rawFontFamily ?? span.rawFontFamily,
        color: origLine?.color ?? span.color,
        fontWeight: origLine?.fontWeight ?? span.fontWeight,
        fontStyle: origLine?.fontStyle ?? span.fontStyle,
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
      const dims = actions.service.document.getPage(pageIndex).getDimensions();
      widthPts = dims.widthPts;
      heightPts = dims.heightPts;
    } catch (err) {
      console.error(`Failed to get dimensions for page ${pageIndex}:`, err);
    }
  });

  $effect(() => {
    if (!containerWrapperEl) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        isVisible = entry.isIntersecting;
      },
      { rootMargin: '1500px 0px' }
    );
    
    observer.observe(containerWrapperEl);
    return () => observer.disconnect();
  });

  function extractOverlaySpansIfNeeded(): void {
    if (!showOverlays) {
      editableSpans = [];
      editableImageSpans = [];
      editableShapeSpans = [];
      pageCharacters = [];
      return;
    }
    const currentVer = store.renderVersion;
    const currentPgVer = store.pageVersions[pageIndex] || 0;
    if (
      cachedVersion === currentVer &&
      cachedPageVersion === currentPgVer &&
      (editableSpans.length > 0 || editableImageSpans.length > 0 || editableShapeSpans.length > 0 || pageCharacters.length > 0)
    ) {
      return;
    }
    try {
      editableSpans = actions.service.document.getPage(pageIndex).extractTextSpans();
      pageCharacters = actions.service.document.getPage(pageIndex).extractCharacters();
      const objSpans = actions.service.document.getPage(pageIndex).extractObjects();
      editableImageSpans = objSpans.images;
      editableShapeSpans = objSpans.shapes;
      cachedVersion = currentVer;
      cachedPageVersion = currentPgVer;
    } catch (err) {
      console.error(`Failed to extract overlay spans for page ${pageIndex}:`, err);
    }
  }

  function renderPageContent(): void {
    if (!canvasContainerEl) return;
    try {
      const renderResult = actions.service.document.getPage(pageIndex).render(renderScale);
      canvasContainerEl.innerHTML = '';
      canvasContainerEl.appendChild(renderResult.canvas);
      extractOverlaySpansIfNeeded();
    } catch (err) {
      console.error(`Failed to render page ${pageIndex}:`, err);
    }
  }

  $effect(() => {
    renderScale;
    showOverlays;
    store.renderVersion;
    store.pageVersions[pageIndex];
    
    if (canvasContainerEl && isVisible) {
      renderPageContent();
    } else if (canvasContainerEl && !isVisible) {
      canvasContainerEl.innerHTML = '';
      editableSpans = [];
      editableImageSpans = [];
      editableShapeSpans = [];
      pageCharacters = [];
    }
  });

  // getCssFontFamily is now imported from font-loader.ts

  // -- Page transform helpers --

  const pageTransform = $derived(store.getPageTransform(pageIndex));

  /**
   * Convert pointer screen coordinates to page-point coordinates,
   * accounting for the page's visual rotation and scale transforms.
   */
  function pointerToPageCoords(e: PointerEvent): { x: number; y: number } {
    if (!containerWrapperEl) return { x: 0, y: 0 };
    const { rotation, scaleX, scaleY } = pageTransform;

    const rect = containerWrapperEl.getBoundingClientRect();

    if (rotation === 0 && scaleX === 1 && scaleY === 1) {
      return {
        x: (e.clientX - rect.left) / visualScale,
        y: (e.clientY - rect.top) / visualScale,
      };
    }

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;

    const rad = -rotation * (Math.PI / 180);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const ux = dx * cos - dy * sin;
    const uy = dx * sin + dy * cos;

    const lx = ux / scaleX;
    const ly = uy / scaleY;

    const halfW = containerWrapperEl.offsetWidth / 2;
    const halfH = containerWrapperEl.offsetHeight / 2;

    return {
      x: (lx + halfW) / visualScale,
      y: (ly + halfH) / visualScale,
    };
  }

  // -- Page resize / rotate via SelectionOverlay handles --

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
      actions.recordSnapshot('Scale Page', false);
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
    const originRotation = pageTransform.rotation;
    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);

    const onMove = (me: PointerEvent): void => {
      const currentAngle = Math.atan2(me.clientY - centerY, me.clientX - centerX);
      const deltaAngle = (currentAngle - startAngle) * (180 / Math.PI);
      let newRotation = (originRotation + deltaAngle) % 360;
      if (newRotation < 0) newRotation += 360;

      if (me.shiftKey) {
        newRotation = Math.round(newRotation / 15) * 15;
      } else {
        const closest90 = Math.round(newRotation / 90) * 90;
        if (Math.abs(newRotation - closest90) < 6) {
          newRotation = closest90;
        }
      }
      newRotation = ((newRotation % 360) + 360) % 360;

      store.updatePageTransform(pageIndex, { rotation: Math.round(newRotation) });
    };

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      activeDragCleanup = null;
      actions.recordSnapshot('Rotate Page Transform', false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    activeDragCleanup = onUp;
  }

  function handleContainerClick(e: MouseEvent): void {
    actions.setCurrentPageFromScroll(pageIndex);
    actions.clearSelection(true);
    canvasStore.selectElement(null);
    selection.select(`page_${pageIndex}`, e.ctrlKey || e.metaKey, e.shiftKey);
  }

  function handleKeyDownInline(e: KeyboardEvent): void {
    const target = e.currentTarget as HTMLElement;
    const span = store.inlineEdit?.span;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const extracted = span ? extractStyledLinesFromEditor(target, visualScale, span) : undefined;
      actions.submitInlineEdit(extracted);
    } else if (e.key === 'Enter' && e.shiftKey) {
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
      if (span) {
        const extracted = extractStyledLinesFromEditor(target, visualScale, span);
        actions.updateInlineText(extracted.text, extracted.lines);
      } else {
        actions.updateInlineText(sanitizePdfText(target.innerText || target.textContent || ''));
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      actions.cancelInlineEdit();
    }
  }



  let isDrawing = $state(false);
  let currentPathId = $state<string | null>(null);
  let isTextHighlightMode = $state(false);
  let isAreaRedactMode = $state(false);
  let areaStartX = $state(0);
  let areaStartY = $state(0);
  let startCharIndex = $state<number | null>(null);
  let currentCharIndex = $state<number | null>(null);
  let previewHighlightRects = $state<HighlightRect[]>([]);
  let hoveringChar = $state<PageCharacter | null>(null);

  function updateHover(e: PointerEvent): void {
    if ((store.activeTool !== 'highlight' && store.activeTool !== 'redact') || isDrawing || !containerWrapperEl) {
      hoveringChar = null;
      return;
    }
    const { x: px, y: py } = pointerToPageCoords(e);
    hoveringChar = findUnifiedCharacterAt(unifiedCharacters, px, py, 10, 8);
  }

  function handlePointerDownDrawing(e: PointerEvent): void {
    if (e.button !== 0 || store.isDraggingOver) return;
    if (store.activeTool !== 'pen' && store.activeTool !== 'highlight' && store.activeTool !== 'redact' && store.activeTool !== 'note') return;

    e.preventDefault();
    e.stopPropagation();

    actions.setCurrentPageFromScroll(pageIndex);
    actions.clearSelection(true);

    const { x, y } = pointerToPageCoords(e);

    if (store.activeTool === 'note') {
      canvasActions.createElement('note', pageIndex, x, y, {
        label: 'Note',
        text: '',
        color: store.annotateColor || '#fef08a',
      });
      store.activeTool = 'select';
      return;
    }

    isDrawing = true;

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
        // Check if clicked directly on any canvas element on this page
        const pageElements = canvasStore.getElementsByPage(pageIndex);
        const hitElement = pageElements.slice().reverse().find((el) => {
          return el.visible && x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height;
        });

        if (hitElement) {
          if (hitElement.kind === 'text') {
            const elChars = getCanvasTextCharacters(hitElement, pageIndex);
            if (elChars.length > 0) {
              isTextHighlightMode = true;
              startCharIndex = elChars[0].charIndex;
              currentCharIndex = elChars[elChars.length - 1].charIndex;
              previewHighlightRects = calculateUnifiedHighlightRects(unifiedCharacters, startCharIndex, currentCharIndex);
            }
          } else {
            isTextHighlightMode = false;
            startCharIndex = null;
            currentCharIndex = null;
            previewHighlightRects = [{
              x: hitElement.x,
              y: hitElement.y,
              width: hitElement.width,
              height: hitElement.height,
            }];
          }
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

    const { x: px, y: py } = pointerToPageCoords(e);

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
      if (store.activeTool === 'redact') {
        if (isTextHighlightMode && startCharIndex !== null && currentCharIndex !== null && previewHighlightRects.length > 0) {
          actions.redactTextRange(pageIndex, startCharIndex, currentCharIndex, previewHighlightRects, canvasStore);
        } else if (isAreaRedactMode && previewHighlightRects.length > 0) {
          const rect = previewHighlightRects[0];
          if (rect && rect.width > 2 && rect.height > 2) {
            actions.redactArea(pageIndex, [rect], canvasStore);
          }
        }
      } else if (store.activeTool === 'highlight') {
        if (previewHighlightRects.length > 0) {
          let addedCount = 0;
          for (const rect of previewHighlightRects) {
            if (rect.width > 0 && rect.height > 0) {
              canvasStore.addElement({
                id: canvasStore.generateId(),
                kind: 'shape',
                variant: 'rectangle',
                pageIndex,
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                rotation: 0,
                locked: false,
                visible: true,
                flipX: false,
                flipY: false,
                fill: store.annotateColor,
                stroke: store.annotateColor,
                strokeWidth: 0,
                opacity: 0.4,
                isHighlight: true,
              });
              addedCount++;
            }
          }
          if (addedCount > 0) {
            actions.recordSnapshot('Highlight Text', false);
          }
        } else if (!isTextHighlightMode && currentPathId) {
          const element = canvasStore.elements.find((el) => el.id === currentPathId) as PathElement | undefined;
          if (element && element.kind === 'path' && element.points.length <= 1 && element.width === 0 && element.height === 0) {
            canvasStore.removeElement(currentPathId);
          } else if (element && element.kind === 'path') {
            actions.recordSnapshot('Draw Highlight', false);
          }
        }
      } else if (store.activeTool === 'pen') {
        if (currentPathId) {
          const element = canvasStore.elements.find((el) => el.id === currentPathId) as PathElement | undefined;
          if (element && element.kind === 'path' && element.points.length <= 1 && element.width === 0 && element.height === 0) {
            canvasStore.removeElement(currentPathId);
          } else if (element && element.kind === 'path') {
            actions.recordSnapshot('Draw Annotation', false);
          }
        }
      }

      isDrawing = false;
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
    if (store.selectedSpan?.id === span.id) {
        if (store.activeTool === 'text' && span.type === 'text') return;

        e.stopPropagation();
        const target = e.target as HTMLElement;
        const pageEl = target.closest('[data-page-element]') as HTMLElement || containerWrapperEl;
        
        const startX = e.clientX;
        const startY = e.clientY;
        const pointerId = e.pointerId;

        const moveHandler = (me: PointerEvent) => {
            if (me.pointerId !== pointerId) return;
            const dx = Math.abs(me.clientX - startX);
            const dy = Math.abs(me.clientY - startY);
            if (dx > 8 || dy > 8) {
                cleanup();
                const type = span.type as 'text' | 'image' | 'shape';
                const newId = actions.extractObjectToCanvas(type, span, canvasStore);
                if (newId) {
                    // After extraction the element lives in CanvasElementLayer.
                    // Resolve that layer for coordinate consistency with updateDrag.
                    const canvasLayer = containerWrapperEl?.querySelector('[data-canvas-layer]') as HTMLElement | null;
                    canvasActions.startDrag(newId, me.clientX, me.clientY, canvasLayer ?? pageEl, visualScale, pageTransform);
                }
            }
        };
        const upHandler = () => cleanup();
        
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
  function getLineBaselineTop(spanTop: number, lineTop: number, fontSize: number, baselineY?: number): number {
    if (baselineY !== undefined && baselineY > 0 && heightPts > 0) {
      const domBaseline = heightPts - baselineY;
      const relTop = domBaseline - spanTop;
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
   * @return Relative left offset in DOM points.
   */
  function getVerticalLineBaselineLeft(spanLeft: number, lineLeft: number, fontSize: number, baselineX?: number): number {
    if (baselineX !== undefined && baselineX > 0) {
      const relLeft = baselineX - spanLeft;
      if (relLeft >= 0) {
        return relLeft;
      }
    }
    return (lineLeft - spanLeft) + fontSize * 0.15;
  }

</script>

<div
  bind:this={containerWrapperEl}
  class="relative inline-block bg-transparent outline-none rounded-none p-0 my-0"
  style="transform: rotate({pageTransform.rotation}deg) scale({pageTransform.scaleX}, {pageTransform.scaleY}); transform-origin: center;"
  onclick={handleContainerClick}
  onkeydown={(e) => {
    if (e.key === 'Enter') {
      actions.setCurrentPageFromScroll(pageIndex);
      actions.clearSelection(true);
      selection.select(`page_${pageIndex}`, e.ctrlKey || e.metaKey, e.shiftKey);
    }
  }}
  role="button"
  tabindex="0"
  aria-label="PDF Page {pageIndex + 1}"
>
  <div
    class="relative bg-background overflow-hidden rounded-none"
    style="width: {Math.round(widthPts * visualScale)}px; height: {Math.round(heightPts * visualScale)}px; contain: layout style paint;"
  >
    <div 
      bind:this={canvasContainerEl} 
      style="transform-origin: top left; transform: scale({visualScale / renderScale});"
    ></div>

    {#if showOverlays}
      <div class="editable-overlay-layer" style="contain: strict;" data-page-element="true">
        {#if store.inlineEdit && store.inlineEdit.span.pageIndex === pageIndex}
          {@const editSpan = store.inlineEdit.span}
          <div
            class="inline-editor-input absolute bg-transparent text-card-foreground border border-primary z-50 outline-none select-text cursor-text"
            contenteditable="true"
            role="textbox"
            tabindex="0"
            aria-multiline="true"
            use:focusInlineEditable
            oninput={(e) => {
              const target = e.currentTarget as HTMLDivElement;
              const extracted = extractStyledLinesFromEditor(target, visualScale, editSpan);
              actions.updateInlineText(extracted.text, extracted.lines);
            }}
            onclick={(e) => e.stopPropagation()}
            onpointerdown={(e) => e.stopPropagation()}
            onmousedown={(e) => e.stopPropagation()}
            onmouseup={(e) => e.stopPropagation()}
            style="
              left: {(editSpan.left * visualScale - 1.5).toFixed(2)}px;
              top: {(editSpan.top * visualScale - 1.5).toFixed(2)}px;
              width: {Math.max(60, Math.min((editSpan.width + 16) * visualScale + 11, (widthPts - editSpan.left) * visualScale + 1.5)).toFixed(2)}px;
              max-width: {Math.max(60, (widthPts - editSpan.left) * visualScale + 1.5).toFixed(2)}px;
              min-height: {(editSpan.height * visualScale + 3).toFixed(2)}px;
              font-size: {(editSpan.fontSize * visualScale).toFixed(2)}px;
              font-family: {getCssFontFamily(editSpan.rawFontFamily, extractBaseFontFamily)};
              font-weight: {(editSpan.rawFontFamily || '').toLowerCase().includes('bold') || editSpan.fontWeight === 'bold' ? 'bold' : 'normal'};
              font-style: {((editSpan.rawFontFamily || '').toLowerCase().includes('italic') || (editSpan.rawFontFamily || '').toLowerCase().includes('oblique') || editSpan.fontStyle === 'italic') ? 'italic' : 'normal'};
              color: rgba({editSpan.color.r}, {editSpan.color.g}, {editSpan.color.b}, {editSpan.color.a / 255});
              line-height: {editSpan.lineHeight ? (editSpan.lineHeight * visualScale).toFixed(2) + 'px' : '1.25'};
              text-rendering: geometricPrecision;
              -webkit-font-smoothing: antialiased;
              box-sizing: border-box;
              background-color: transparent;
              padding: 0;
              margin: 0;
              white-space: pre-wrap;
              word-break: break-word;
            "
            onblur={(e) => {
              const target = e.currentTarget as HTMLDivElement;
              const extracted = extractStyledLinesFromEditor(target, visualScale, editSpan);
              actions.submitInlineEdit(extracted);
            }}
            onkeydown={handleKeyDownInline}
          ></div>
        {/if}

        {#each allSpans as span (span.id)}
          {#if store.inlineEdit?.spanId !== span.id && !store.hiddenSpanIds.has(span.id)}
            <div
              class="absolute pointer-events-auto cursor-pointer group {store.selectedSpan?.id === span.id ? 'z-20' : (span.type === 'text' ? 'z-[15]' : 'z-[1]')}"
              style="
                left: {(span.left * visualScale).toFixed(2)}px;
                top: {(span.top * visualScale).toFixed(2)}px;
                width: {(span.width * visualScale).toFixed(2)}px;
                height: {(span.height * visualScale).toFixed(2)}px;
              "
              onclick={(e) => {
                e.stopPropagation();
                actions.setCurrentPageFromScroll(pageIndex);
                selection.clear();
                canvasStore.selectElement(null);
                actions.selectSpan(span);
              }}
              ondblclick={(e) => {
                e.stopPropagation();
                if (span.type === 'text') {
                  actions.setCurrentPageFromScroll(pageIndex);
                  actions.startInlineEdit(span as EditableTextSpan);
                } else {
                  actions.extractObjectToCanvas(span.type, span, canvasStore);
                }
              }}
              role="button"
              tabindex="0"
              aria-label="{span.type === 'text' ? `Text block: ${(span as EditableTextSpan).text}` : `${span.type === 'image' ? 'Image' : 'Shape'} block`}"
              onpointerdown={(e) => handleSpanPointerDown(e, span)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || (span.type !== 'text' && e.key === ' ')) {
                  e.stopPropagation();
                  if (span.type === 'text') {
                    actions.setCurrentPageFromScroll(pageIndex);
                    actions.startInlineEdit(span as EditableTextSpan);
                  } else {
                    actions.extractObjectToCanvas(span.type, span, canvasStore);
                  }
                }
              }}
            >
              {#if span.type === 'text'}
                {@const isVert = (span as EditableTextSpan).isVertical || (span as EditableTextSpan).rotation === 90 || (span as EditableTextSpan).rotation === 270}
                {#if (span as EditableTextSpan).lines && (span as EditableTextSpan).lines!.length > 0}
                  {#each (span as EditableTextSpan).lines! as line}
                    {#if isVert}
                      <div
                        class="absolute w-[1.5px] bg-[#0D99FF] pointer-events-none {store.selectedSpan?.id === span.id ? 'block' : 'hidden group-hover:block'}"
                        style="
                          left: {Math.round(getVerticalLineBaselineLeft(span.left, line.left, line.fontSize, line.baselineY) * visualScale)}px;
                          top: {Math.round((line.top - span.top) * visualScale)}px;
                          height: {Math.max(2, Math.round(line.height * visualScale))}px;
                          backface-visibility: hidden;
                          transform: translateZ(0);
                        "
                      ></div>
                    {:else}
                      <div
                        class="absolute h-[1.5px] bg-[#0D99FF] pointer-events-none {store.selectedSpan?.id === span.id ? 'block' : 'hidden group-hover:block'}"
                        style="
                          left: {Math.round((line.left - span.left) * visualScale)}px;
                          width: {Math.max(2, Math.round(line.width * visualScale))}px;
                          top: {Math.round(getLineBaselineTop(span.top, line.top, line.fontSize, line.baselineY) * visualScale)}px;
                          backface-visibility: hidden;
                          transform: translateZ(0);
                        "
                      ></div>
                    {/if}
                  {/each}
                {:else}
                  {#if isVert}
                    <div
                      class="absolute top-0 h-full w-[1.5px] bg-[#0D99FF] pointer-events-none {store.selectedSpan?.id === span.id ? 'block' : 'hidden group-hover:block'}"
                      style="
                        left: {Math.round(getVerticalLineBaselineLeft(span.left, span.left, (span as EditableTextSpan).fontSize, (span as EditableTextSpan).baselineY) * visualScale)}px;
                        backface-visibility: hidden;
                        transform: translateZ(0);
                      "
                    ></div>
                  {:else}
                    <div
                      class="absolute left-0 w-full h-[1.5px] bg-[#0D99FF] pointer-events-none {store.selectedSpan?.id === span.id ? 'block' : 'hidden group-hover:block'}"
                      style="
                        top: {Math.round(getLineBaselineTop(span.top, span.top, (span as EditableTextSpan).fontSize, (span as EditableTextSpan).baselineY) * visualScale)}px;
                        backface-visibility: hidden;
                        transform: translateZ(0);
                      "
                    ></div>
                  {/if}
                {/if}
              {:else if span.type === 'image'}
                <div class="absolute inset-0 ring-[1.5px] ring-inset ring-[#0D99FF] {store.selectedSpan?.id === span.id ? 'hidden' : 'hidden group-hover:block'} pointer-events-none"></div>
              {/if}
            </div>
          {/if}
        {/each}

        <!-- Span Selection Overlay (Hidden during inline edit since textarea has its own border) -->
        {#if store.selectedSpan?.pageIndex === pageIndex && !store.inlineEdit}
          <div class="absolute inset-0 pointer-events-none z-20">
            <SelectionOverlay 
              element={{ 
                id: store.selectedSpan.id, 
                x: store.selectedSpan.left, 
                y: store.selectedSpan.top, 
                width: store.selectedSpan.width, 
                height: store.selectedSpan.height, 
                rotation: ('rotation' in store.selectedSpan && typeof store.selectedSpan.rotation === 'number' ? store.selectedSpan.rotation : 0)
              }} 
              zoom={visualScale} 
              onResizeStart={(e, handle, _pageEl) => {
                if (store.selectedSpan) {
                  const type = store.selectedSpan.type as 'text' | 'image' | 'shape';
                  const newId = actions.extractObjectToCanvas(type, store.selectedSpan as EditableTextSpan | EditableImageSpan | EditableShapeSpan, canvasStore);
                  if (newId) {
                    // After extraction the element lives in the CanvasElementLayer.
                    // Resolve that layer so startResize uses the same reference frame
                    // as subsequent updateResize calls from Canvas.svelte.
                    const canvasLayer = containerWrapperEl?.querySelector('[data-canvas-layer]') as HTMLElement | null;
                    canvasActions.startResize(newId, handle, e.clientX, e.clientY, canvasLayer ?? _pageEl, visualScale, pageTransform);
                  }
                }
              }}
              onRotateStart={(e, _pageEl) => {
                if (store.selectedSpan) {
                  const type = store.selectedSpan.type as 'text' | 'image' | 'shape';
                  const newId = actions.extractObjectToCanvas(type, store.selectedSpan as EditableTextSpan | EditableImageSpan | EditableShapeSpan, canvasStore);
                  if (newId) {
                    const canvasLayer = containerWrapperEl?.querySelector('[data-canvas-layer]') as HTMLElement | null;
                    canvasActions.startRotate(newId, e.clientX, e.clientY, canvasLayer ?? _pageEl, visualScale, pageTransform);
                  }
                }
              }}
            />
          </div>
        {/if}
      </div>
    {/if}

    <!-- Canvas element overlay for user-added elements -->
    {#if !store.showOrganizerView}
      <CanvasElementLayer {pageIndex} zoom={visualScale} />
    {/if}

    <!-- Annotation & Drawing Tool Interactive Overlay (Topmost) -->
    {#if store.activeTool === 'pen' || store.activeTool === 'highlight' || store.activeTool === 'redact' || store.activeTool === 'note'}
      <div 
        class="absolute inset-0 z-[60] touch-none {store.activeTool === 'note' ? 'cursor-cell' : ((store.activeTool === 'highlight' || store.activeTool === 'redact') ? (hoveringChar || isTextHighlightMode ? 'cursor-text' : 'cursor-crosshair') : 'cursor-crosshair')}"
        onpointerdown={handlePointerDownDrawing}
        onpointermove={handlePointerMoveDrawing}
        onpointerup={handlePointerUpDrawing}
        onpointercancel={handlePointerUpDrawing}
        role="presentation"
      ></div>
    {/if}

    <!-- Live Highlight & Redaction Drawing Preview Overlay -->
    {#if isDrawing && previewHighlightRects.length > 0}
      <div class="absolute inset-0 pointer-events-none z-[55]">
        {#each previewHighlightRects as rect}
          {#if store.activeTool === 'redact'}
            <div
              class="absolute pointer-events-none border border-red-500/80 rounded-[1px]"
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
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  {#if selection.isSelected(`page_${pageIndex}`)}
    <div class="absolute inset-0 z-10 pointer-events-none">
      <SelectionOverlay 
        element={{ id: `page_${pageIndex}`, x: 0, y: 0, width: widthPts, height: heightPts, rotation: 0 }} 
        zoom={visualScale} 
        onResizeStart={(e, handle, _pageEl) => handlePageResizeStart(e, handle)}
        onRotateStart={(e, _pageEl) => handlePageRotateStart(e)}
      />
    </div>
  {/if}
</div>
