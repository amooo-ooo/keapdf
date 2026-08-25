<script lang="ts">
  import type { EditableSpan, EditableTextSpan, EditableImageSpan, EditableShapeSpan, PageCharacter, HighlightRect, TextLine, TextWord } from '../../core/types';
  import { getUnifiedPageCharacters, findUnifiedCharacterAt, findClosestUnifiedCharacter, calculateUnifiedHighlightRects, getCanvasTextCharacters } from '../../services/pdf/unified-text-provider';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useSelection } from '../../stores/selection.svelte';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import { extractBaseFontFamily } from '../../services/pdf/font-charset-index';
  import { getCssFontFamily } from '../../services/font-loader';
  import { sanitizePdfText } from '../../services/pdf/utils';
  import CanvasElementLayer from './CanvasElementLayer.svelte';
  import SelectionOverlay from './SelectionOverlay.svelte';
  import type { HandlePosition, PathElement } from '../../stores/canvas-types';

  interface Props {
    pageIndex: number;
  }

  let { pageIndex }: Props = $props();

  const store = useEditorStore();
  const actions = useEditorActions();
  const selection = useSelection();
  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  let canvasContainerEl: HTMLDivElement | null = $state(null);
  let containerWrapperEl: HTMLDivElement | null = $state(null);
  let editableSpans = $state<EditableTextSpan[]>([]);
  let editableImageSpans = $state<EditableImageSpan[]>([]);
  let editableShapeSpans = $state<EditableShapeSpan[]>([]);
  let pageCharacters = $state<PageCharacter[]>([]);

  const allSpans = $derived(
    [
      // 1. Background images (largest to smallest)
      ...[...editableImageSpans].sort((a, b) => (b.width * b.height) - (a.width * a.height)),
      // 2. Vector shapes and paths (largest to smallest)
      ...[...editableShapeSpans].sort((a, b) => (b.width * b.height) - (a.width * a.height)),
      // 3. Text spans always on top so shapes never block text selection
      ...[...editableSpans].sort((a, b) => (b.width * b.height) - (a.width * a.height)),
    ]
  );

  let widthPts = $state(0);
  let heightPts = $state(0);
  let isVisible = $state(false);

  let cachedVersion = -1;
  let cachedPageVersion = -1;

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

  const showOverlays = $derived(!store.showOrganizerView && (store.activeTool === 'select' || store.activeTool === 'text' || store.activeTool === 'highlight' || store.activeTool === 'pen' || store.activeTool === 'redact' || store.activeTool === 'note') && isVisible);

  const unifiedCharacters = $derived(
    getUnifiedPageCharacters(pageIndex, pageCharacters, canvasStore.getElementsByPage(pageIndex))
  );

  function focusInlineEditable(node: HTMLElement): void {
    const span = store.inlineEdit?.span;
    if (span && span.lines && span.lines.length > 0) {
      node.innerHTML = '';
      const isBulletSpan = Boolean(span.hasBulletPrefix && span.bulletWord);
      const firstLineTextLeft = isBulletSpan
        ? (span.lines[0].words && span.lines[0].words.length > 0
            ? span.lines[0].words[0].left
            : (span.bulletWord!.right + 6))
        : span.left;
      const bulletIndent = isBulletSpan ? Math.max(0, firstLineTextLeft - span.left) : 0;

      for (let lineIdx = 0; lineIdx < span.lines.length; lineIdx++) {
        const line = span.lines[lineIdx];
        const lineDiv = document.createElement('div');
        lineDiv.className = 'inline-edit-line';
        lineDiv.style.fontSize = `${(line.fontSize || span.fontSize) * visualScale}px`;
        lineDiv.style.lineHeight = line.lineHeight ? `${(line.lineHeight * visualScale).toFixed(2)}px` : '1.25';

        // Render bullet prefix as a non-editable decorator on the first line (or any line with a bullet prefix)
        if (line.hasBulletPrefix && line.bulletWord) {
          const bulletSpan = document.createElement('span');
          bulletSpan.className = 'inline-bullet-decorator select-none';
          bulletSpan.contentEditable = 'false';
          bulletSpan.dataset.bulletDecorator = 'true';
          bulletSpan.style.userSelect = 'none';
          bulletSpan.style.pointerEvents = 'none';
          bulletSpan.style.display = 'inline-block';
          bulletSpan.style.fontSize = `${(line.bulletWord.fontSize || line.fontSize || span.fontSize) * visualScale}px`;
          bulletSpan.style.fontFamily = getCssFontFamily(line.bulletWord.rawFontFamily || line.rawFontFamily || span.rawFontFamily, extractBaseFontFamily);
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
          bulletSpan.style.marginRight = `${(gap * visualScale).toFixed(2)}px`;

          lineDiv.appendChild(bulletSpan);
        } else if (isBulletSpan && lineIdx > 0 && bulletIndent > 0.5) {
          // Wrapped line inside a bullet list item: indent to align with text after bullet
          lineDiv.style.paddingLeft = `${(bulletIndent * visualScale).toFixed(2)}px`;
        }

        if (line.words && line.words.length > 0) {
          for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
            const word = line.words[wIdx];
            if (wIdx > 0) {
              const prev = line.words[wIdx - 1];
              const gap = word.left - prev.right;
              if (gap >= Math.min(prev.fontSize, word.fontSize) * 0.18) {
                lineDiv.appendChild(document.createTextNode(' '));
              }
            }
            const wordSpan = document.createElement('span');
            wordSpan.dataset.fontSize = `${word.fontSize || line.fontSize || span.fontSize}`;
            wordSpan.style.fontSize = `${(word.fontSize || line.fontSize || span.fontSize) * visualScale}px`;
            wordSpan.style.fontFamily = getCssFontFamily(word.rawFontFamily || line.rawFontFamily || span.rawFontFamily, extractBaseFontFamily);
            const isBold = (word.rawFontFamily || line.rawFontFamily || '').toLowerCase().includes('bold') || word.fontWeight === 'bold';
            const isItalic = (word.rawFontFamily || line.rawFontFamily || '').toLowerCase().includes('italic') || word.fontStyle === 'italic';
            if (isBold) wordSpan.style.fontWeight = 'bold';
            if (isItalic) wordSpan.style.fontStyle = 'italic';
            if (word.color) {
              const col = word.color;
              const alpha = col.a !== undefined ? (col.a <= 1 ? col.a : col.a / 255) : 1;
              wordSpan.style.color = `rgba(${col.r}, ${col.g}, ${col.b}, ${alpha})`;
            }
            wordSpan.textContent = word.text;
            lineDiv.appendChild(wordSpan);
          }
        } else {
          lineDiv.appendChild(document.createTextNode(line.text));
        }
        node.appendChild(lineDiv);
      }
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

    queueMicrotask(() => {
      node.focus();
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
      }
    });
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
    scale: number,
    span: EditableTextSpan
  ): { text: string; lines: TextLine[] } {
    const isBulletSpan = Boolean(span.hasBulletPrefix && span.bulletWord);
    const firstLineTextLeft = isBulletSpan
      ? (span.lines && span.lines.length > 0 && span.lines[0].words && span.lines[0].words.length > 0
          ? span.lines[0].words[0].left
          : (span.bulletWord!.right + 6))
      : span.left;

    const lineDivs = node.querySelectorAll('.inline-edit-line');
    if (lineDivs.length === 0) {
      let rawText = '';
      node.childNodes.forEach((child) => {
        if (child instanceof HTMLElement && child.getAttribute('contenteditable') === 'false') {
          return;
        }
        rawText += child.textContent || '';
      });
      rawText = sanitizePdfText(rawText);
      const splitLines = rawText.split(/\r?\n/);
      const lines: TextLine[] = splitLines.map((lineStr, idx) => {
        const origLine = span.lines?.[idx];
        const lineLeft = isBulletSpan ? firstLineTextLeft : span.left;
        return {
          text: lineStr,
          left: origLine?.left ?? lineLeft,
          top: origLine?.top ?? (span.top + idx * (span.lineHeight || span.fontSize * 1.25)),
          right: origLine?.right ?? (span.left + span.width),
          bottom: origLine?.bottom ?? (span.top + (idx + 1) * (span.lineHeight || span.fontSize * 1.25)),
          width: origLine?.width ?? span.width,
          height: origLine?.height ?? (span.lineHeight || span.fontSize * 1.25),
          fontSize: origLine?.fontSize ?? span.fontSize,
          baselineY: origLine?.baselineY ?? (span.baselineY - idx * (span.lineHeight || span.fontSize * 1.25)),
          lineHeight: origLine?.lineHeight ?? span.lineHeight ?? (span.fontSize * 1.25),
          charStartIndex: 0,
          charCount: lineStr.length,
          words: origLine?.words ?? [],
          fontFamily: origLine?.fontFamily ?? span.fontFamily,
          rawFontFamily: origLine?.rawFontFamily ?? span.rawFontFamily,
          color: origLine?.color ?? span.color,
          fontWeight: origLine?.fontWeight ?? span.fontWeight,
          fontStyle: origLine?.fontStyle ?? span.fontStyle,
          hasBulletPrefix: origLine?.hasBulletPrefix ?? (idx === 0 ? span.hasBulletPrefix : false),
          bulletWord: origLine?.bulletWord ?? (idx === 0 ? span.bulletWord : undefined),
        };
      });
      return { text: rawText, lines };
    }

    const lines: TextLine[] = [];
    const textPieces: string[] = [];

    lineDivs.forEach((lineDiv, lineIdx) => {
      const origLine = span.lines?.[lineIdx];
      const spanElements = lineDiv.querySelectorAll<HTMLSpanElement>('span:not([contenteditable="false"])');
      
      let lineText = '';
      lineDiv.childNodes.forEach((child) => {
        if (child instanceof HTMLElement && child.getAttribute('contenteditable') === 'false') {
          return;
        }
        lineText += child.textContent || '';
      });
      lineText = sanitizePdfText(lineText);
      textPieces.push(lineText);

      const words: TextWord[] = [];
      if (spanElements.length > 0) {
        spanElements.forEach((spanEl, wIdx) => {
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

