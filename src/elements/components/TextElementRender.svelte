<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { TextElement, TextElementLine, TextSegment } from '../../stores/canvas-types';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import { extractBaseFontFamily } from '../../services/pdf/font-charset-index';
  import { getCssFontFamily } from '../../services/font-loader';
  import { sanitizePdfText } from '../../services/pdf/utils';
  import type { ElementRenderProps } from '../../core/element-registry';
  import {
    isInspectorControlTarget,
    getSelectionCharOffsets,
    setActiveEditorSelection,
    getActiveEditorSelection,
    setSelectionCharOffsets,
    resolveInlineKeyAction,
  } from '../../utils/text-range-utils';

  let {
    element,
    zoom,
    selected: _selected,
    editing,
  }: ElementRenderProps<TextElement> = $props();

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  const hasSegments = $derived(
    Boolean((element.lines && element.lines.some(l => l.segments && l.segments.length > 0)) || (element.segments && element.segments.length > 0))
  );

  let editableEl = $state<HTMLDivElement | null>(null);

  function resolveTextDecoration(underline?: boolean, strikethrough?: boolean): string {
    const isUnderline = underline !== undefined ? underline : element.underline;
    const isStrike = strikethrough !== undefined ? strikethrough : element.strikethrough;
    if (isUnderline && isStrike) return 'underline line-through';
    if (isUnderline) return 'underline';
    if (isStrike) return 'line-through';
    return 'none';
  }

  function populateEditableContent(node: HTMLElement): void {
    node.innerHTML = '';
    if (element.lines && element.lines.length > 0) {
      for (let lIdx = 0; lIdx < element.lines.length; lIdx++) {
        const line = element.lines[lIdx];
        const lineDiv = document.createElement('div');
        lineDiv.className = 'canvas-text-line';
        lineDiv.dataset.lineIndex = String(lIdx);
        const lFontSize = line.fontSize || element.fontSize;
        lineDiv.dataset.fontSize = `${lFontSize}`;
        if (line.lineHeight || element.lineHeight) {
          lineDiv.dataset.lineHeight = `${line.lineHeight || element.lineHeight}`;
        }
        lineDiv.style.fontSize = `${lFontSize * zoom}px`;
        lineDiv.style.textAlign = element.textAlign;
        lineDiv.style.whiteSpace = 'pre';
        lineDiv.style.lineHeight = (line.lineHeight || element.lineHeight) ? `${((line.lineHeight || element.lineHeight)! * zoom).toFixed(2)}px` : '1.25';

        if (line.segments && line.segments.length > 0) {
          for (let sIdx = 0; sIdx < line.segments.length; sIdx++) {
            const seg = line.segments[sIdx];
            const spanEl = document.createElement('span');
            spanEl.dataset.segmentIndex = String(sIdx);
            const sFontSize = seg.fontSize || line.fontSize || element.fontSize;
            spanEl.dataset.fontSize = `${sFontSize}`;
            spanEl.style.fontSize = `${sFontSize * zoom}px`;
            spanEl.style.fontFamily = getCssFontFamily(seg.rawFontFamily || seg.fontFamily || element.fontFamily, extractBaseFontFamily);
            spanEl.style.color = seg.color || element.color;
            spanEl.style.fontWeight = seg.fontWeight || element.fontWeight;
            spanEl.style.fontStyle = seg.fontStyle || element.fontStyle;
            spanEl.style.textDecoration = resolveTextDecoration(seg.underline, seg.strikethrough);
            if (seg.backgroundColor) {
              spanEl.style.backgroundColor = seg.backgroundColor;
            }
            spanEl.style.letterSpacing = element.letterSpacing || 'normal';
            spanEl.style.verticalAlign = 'baseline';
            if (seg.width && seg.text.trim().length === 0) {
              spanEl.style.display = 'inline-block';
              spanEl.style.width = `${(seg.width * zoom).toFixed(2)}px`;
            }
            spanEl.textContent = seg.text;
            lineDiv.appendChild(spanEl);
          }
        } else {
          const spanEl = document.createElement('span');
          spanEl.dataset.segmentIndex = '0';
          spanEl.dataset.fontSize = `${lFontSize}`;
          spanEl.style.fontSize = `${lFontSize * zoom}px`;
          spanEl.style.fontFamily = getCssFontFamily(element.rawFontFamily || element.fontFamily, extractBaseFontFamily);
          spanEl.style.color = element.color;
          spanEl.style.fontWeight = element.fontWeight;
          spanEl.style.fontStyle = element.fontStyle;
          spanEl.style.textDecoration = resolveTextDecoration(line.underline, line.strikethrough);
          spanEl.style.letterSpacing = element.letterSpacing || 'normal';
          spanEl.style.verticalAlign = 'baseline';
          spanEl.textContent = line.text || '';
          lineDiv.appendChild(spanEl);
        }
        node.appendChild(lineDiv);
      }
    } else if (element.segments && element.segments.length > 0) {
      for (let sIdx = 0; sIdx < element.segments.length; sIdx++) {
        const seg = element.segments[sIdx];
        const spanEl = document.createElement('span');
        spanEl.dataset.segmentIndex = String(sIdx);
        const sFontSize = seg.fontSize || element.fontSize;
        spanEl.dataset.fontSize = `${sFontSize}`;
        spanEl.style.fontSize = `${sFontSize * zoom}px`;
        spanEl.style.fontFamily = getCssFontFamily(seg.rawFontFamily || seg.fontFamily || element.fontFamily, extractBaseFontFamily);
        spanEl.style.color = seg.color || element.color;
        spanEl.style.fontWeight = seg.fontWeight || element.fontWeight;
        spanEl.style.fontStyle = seg.fontStyle || element.fontStyle;
        spanEl.style.textDecoration = resolveTextDecoration(seg.underline, seg.strikethrough);
        if (seg.backgroundColor) {
          spanEl.style.backgroundColor = seg.backgroundColor;
        }
        spanEl.style.letterSpacing = element.letterSpacing || 'normal';
        spanEl.style.verticalAlign = 'baseline';
        spanEl.textContent = seg.text;
        node.appendChild(spanEl);
      }
    } else {
      node.innerText = element.text;
      node.style.textDecoration = resolveTextDecoration(element.underline, element.strikethrough);
      node.style.letterSpacing = element.letterSpacing || 'normal';
    }
  }

  let isCommitting = false;

  onDestroy(() => {
    commitContent(true);
  });

  function handleSelectionUpdate(): void {
    if (!editableEl) return;
    const offsets = getSelectionCharOffsets(editableEl);
    if (offsets) {
      setActiveEditorSelection({
        mode: 'canvas',
        targetId: element.id,
        start: offsets.start,
        end: offsets.end,
        text: offsets.text,
        container: editableEl,
      });
    }
  }

  function commitContent(exitEditing: boolean = true): void {
    if (isCommitting || !editableEl) return;
    isCommitting = true;
    try {
      const rawText = editableEl.innerText ?? editableEl.textContent ?? '';
      const fullText = sanitizePdfText(rawText);

      const measuredHeight = Math.ceil(editableEl.scrollHeight / zoom);
      const newHeight = measuredHeight > element.height ? measuredHeight : element.height;
      const measuredWidth = Math.ceil(editableEl.scrollWidth / zoom);
      const newWidth = measuredWidth > element.width ? measuredWidth : element.width;

      const lineNodes = Array.from(editableEl.children).filter(
        (child): child is HTMLDivElement => child instanceof HTMLDivElement
      );
      if (lineNodes.length > 0) {
        const updatedLines: TextElementLine[] = [];
        const allSegments: TextSegment[] = [];

        for (let lIdx = 0; lIdx < lineNodes.length; lIdx++) {
          const lineNode = lineNodes[lIdx];
          const origLine = element.lines && element.lines[lIdx] ? element.lines[lIdx] : undefined;
          const lineFontSize = origLine?.fontSize || element.fontSize;
          const lineText = sanitizePdfText(lineNode.innerText ?? lineNode.textContent ?? '');

          const lineSegments: TextSegment[] = [];
          for (let cIdx = 0; cIdx < lineNode.childNodes.length; cIdx++) {
            const childNode = lineNode.childNodes[cIdx];
            if (childNode instanceof HTMLElement) {
              const segNode = childNode;
              const segText = sanitizePdfText(segNode.innerText ?? segNode.textContent ?? '');
              if (!segText) continue;

              const origSegIdx = parseInt(segNode.dataset.segmentIndex || `${cIdx}`, 10);
              const origSeg = origLine?.segments?.[origSegIdx];

              const nodeBg = segNode.style.backgroundColor;
              const hasValidNodeBg = Boolean(nodeBg && nodeBg !== 'transparent' && nodeBg !== 'inherit');
              const isExplicitlyCleared = nodeBg === 'transparent';
              const segBg = isExplicitlyCleared
                ? undefined
                : (hasValidNodeBg ? nodeBg : (origSeg?.backgroundColor || undefined));

              const isUnderline = segNode.style.textDecoration.includes('underline') ? true : undefined;
              const isStrike = segNode.style.textDecoration.includes('line-through') ? true : undefined;

              const nodeFw = segNode.style.fontWeight === 'bold' || segNode.style.fontWeight === '700'
                ? 'bold'
                : (segNode.style.fontWeight === 'normal' || segNode.style.fontWeight === '400' ? 'normal' : undefined);
              const nodeFs = segNode.style.fontStyle === 'italic'
                ? 'italic'
                : (segNode.style.fontStyle === 'normal' ? 'normal' : undefined);
              const nodeColor = segNode.style.color && segNode.style.color !== '' ? segNode.style.color : undefined;
              const parsedFs = origSeg?.fontSize || lineFontSize;

              const seg: TextSegment = {
                text: segText,
                fontSize: parsedFs,
                fontFamily: origSeg?.fontFamily || element.fontFamily,
                rawFontFamily: origSeg?.rawFontFamily || element.rawFontFamily,
                color: nodeColor || origSeg?.color || element.color,
                backgroundColor: segBg,
                fontWeight: nodeFw || origSeg?.fontWeight || element.fontWeight,
                fontStyle: nodeFs || origSeg?.fontStyle || element.fontStyle,
                underline: isUnderline,
                strikethrough: isStrike,
                charCount: segText.length,
              };
              lineSegments.push(seg);
              allSegments.push(seg);
            } else if (childNode.nodeType === 3) {
              const rawTxt = childNode.textContent || '';
              const cleanTxt = sanitizePdfText(rawTxt);
              if (cleanTxt) {
                const seg: TextSegment = {
                  text: cleanTxt,
                  fontSize: lineFontSize,
                  fontFamily: element.fontFamily,
                  rawFontFamily: element.rawFontFamily,
                  color: element.color,
                  backgroundColor: element.backgroundColor || undefined,
                  fontWeight: element.fontWeight,
                  fontStyle: element.fontStyle,
                  underline: element.underline,
                  strikethrough: element.strikethrough,
                  charCount: cleanTxt.length,
                };
                lineSegments.push(seg);
                allSegments.push(seg);
              }
            }
          }

          if (lineSegments.length === 0) {
            const defaultSeg: TextSegment = {
              text: lineText,
              fontSize: lineFontSize,
              fontFamily: origLine?.segments?.[0]?.fontFamily || element.fontFamily,
              rawFontFamily: origLine?.segments?.[0]?.rawFontFamily || element.rawFontFamily,
              color: origLine?.segments?.[0]?.color || element.color,
              backgroundColor: origLine?.segments?.[0]?.backgroundColor || element.backgroundColor || undefined,
              fontWeight: origLine?.segments?.[0]?.fontWeight || element.fontWeight,
              fontStyle: origLine?.segments?.[0]?.fontStyle || element.fontStyle,
              underline: origLine?.segments?.[0]?.underline,
              strikethrough: origLine?.segments?.[0]?.strikethrough,
              charCount: lineText.length,
            };
            lineSegments.push(defaultSeg);
            allSegments.push(defaultSeg);
          }

          updatedLines.push({
            text: lineText,
            fontSize: lineFontSize,
            lineHeight: origLine?.lineHeight,
            segments: lineSegments,
          });
        }

        canvasActions.updateElementProperties(element.id, {
          text: fullText,
          lines: updatedLines,
          segments: allSegments,
          width: newWidth,
          height: newHeight,
        });
        return;
      }

      const flatSpans = Array.from(editableEl.querySelectorAll<HTMLSpanElement>('span[data-segment-index]'));
      if (flatSpans.length > 0) {
        const flatSegments: TextSegment[] = [];
        for (let sIdx = 0; sIdx < flatSpans.length; sIdx++) {
          const segNode = flatSpans[sIdx];
          const segText = sanitizePdfText(segNode.innerText ?? segNode.textContent ?? '');
          if (!segText) continue;
          const origSeg = element.segments?.[sIdx];
          const isUnderline = segNode.style.textDecoration.includes('underline') ? true : undefined;
          const isStrike = segNode.style.textDecoration.includes('line-through') ? true : undefined;
          const nodeBg = segNode.style.backgroundColor;
          const hasValidBg = Boolean(nodeBg && nodeBg !== 'transparent' && nodeBg !== 'inherit');
          const isCleared = nodeBg === 'transparent';
          const segBg = isCleared ? undefined : (hasValidBg ? nodeBg : (origSeg?.backgroundColor || undefined));

          const nodeFw = segNode.style.fontWeight === 'bold' || segNode.style.fontWeight === '700'
            ? 'bold'
            : (segNode.style.fontWeight === 'normal' || segNode.style.fontWeight === '400' ? 'normal' : undefined);
          const nodeFs = segNode.style.fontStyle === 'italic'
            ? 'italic'
            : (segNode.style.fontStyle === 'normal' ? 'normal' : undefined);
          const nodeColor = segNode.style.color && segNode.style.color !== '' ? segNode.style.color : undefined;
          const rawFs = segNode.dataset.fontSize ? parseFloat(segNode.dataset.fontSize) : 0;
          // Prefer live element font size when the inspector has updated it during editing
          const liveFs = element.fontSize || 0;
          const parsedFs = (liveFs > 0 && rawFs > 0 && Math.abs(liveFs - rawFs) > 0.1)
            ? liveFs
            : (rawFs > 0 ? rawFs : (origSeg?.fontSize || element.fontSize));

          flatSegments.push({
            text: segText,
            fontSize: parsedFs,
            fontFamily: origSeg?.fontFamily || element.fontFamily,
            rawFontFamily: origSeg?.rawFontFamily || element.rawFontFamily,
            color: nodeColor || origSeg?.color || element.color,
            backgroundColor: segBg,
            fontWeight: nodeFw || origSeg?.fontWeight || element.fontWeight,
            fontStyle: nodeFs || origSeg?.fontStyle || element.fontStyle,
            underline: isUnderline,
            strikethrough: isStrike,
            charCount: segText.length,
          });
        }

        canvasActions.updateElementProperties(element.id, {
          text: fullText,
          segments: flatSegments,
          width: newWidth,
          height: newHeight,
        });
        return;
      }

      const textLines = fullText.split(/\r?\n/);
      const updatedLines: TextElementLine[] = textLines.map((lineStr, idx) => {
        const originalLine = element.lines && element.lines[idx] ? element.lines[idx] : undefined;
        const lineFontSize = originalLine?.fontSize || element.fontSize;
        return {
          text: lineStr,
          fontSize: lineFontSize,
          lineHeight: originalLine?.lineHeight,
          segments: [{
            text: lineStr,
            fontSize: lineFontSize,
            fontFamily: element.fontFamily,
            rawFontFamily: element.rawFontFamily,
            color: element.color,
            backgroundColor: element.backgroundColor || undefined,
            fontWeight: element.fontWeight,
            fontStyle: element.fontStyle,
            charCount: lineStr.length,
          }],
        };
      });

      canvasActions.updateElementProperties(element.id, {
        text: fullText,
        lines: updatedLines,
        width: newWidth,
        height: newHeight,
      });
    } finally {
      if (exitEditing && canvasStore.editingElementId === element.id) {
        canvasStore.editingElementId = null;
      }
      isCommitting = false;
    }
  }

  function handleBlur(e: FocusEvent): void {
    if (isInspectorControlTarget(e.relatedTarget)) {
      // Keep editing state active when interacting with the right properties panel
      commitContent(false);
      return;
    }
    commitContent(true);
  }

  function handleEditKeyDown(e: KeyboardEvent): void {
    const action = resolveInlineKeyAction(e);
    if (action === 'submit') {
      e.stopPropagation();
      e.preventDefault();
      commitContent(true);
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
      handleSelectionUpdate();
    } else if (action === 'cancel') {
      e.stopPropagation();
      e.preventDefault();
      if (editableEl) {
        populateEditableContent(editableEl);
      }
      if (canvasStore.editingElementId === element.id) {
        canvasStore.editingElementId = null;
      }
    }
  }

  $effect(() => {
    void element.segments;
    void element.lines;
    void element.text;
    if (editing && editableEl && !isCommitting) {
      const activeSel = getActiveEditorSelection();
      if (activeSel && activeSel.mode === 'canvas' && activeSel.targetId === element.id) {
        populateEditableContent(editableEl);
        setSelectionCharOffsets(editableEl, activeSel.start, activeSel.end);
        
        const activeEl = document.activeElement;
        const isInPanel = activeEl && (
          activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.closest('[data-panel]') ||
          activeEl.closest('.right-panel')
        );
        if (!isInPanel) {
          editableEl.focus({ preventScroll: true });
        }
      }
    }
  });

  $effect(() => {
    const currentZoom = zoom;
    if (editing && editableEl && !isCommitting) {
      const lineEls = editableEl.querySelectorAll<HTMLElement>('.canvas-text-line');
      lineEls.forEach((lEl) => {
        const lineFs = lEl.dataset.fontSize ? parseFloat(lEl.dataset.fontSize) : null;
        if (lineFs) {
          lEl.style.fontSize = `${lineFs * currentZoom}px`;
        }
        const lineH = lEl.dataset.lineHeight ? parseFloat(lEl.dataset.lineHeight) : null;
        if (lineH) {
          lEl.style.lineHeight = `${(lineH * currentZoom).toFixed(2)}px`;
        }
      });

      const spanEls = editableEl.querySelectorAll<HTMLElement>('span[data-font-size]');
      spanEls.forEach((sEl) => {
        const fs = parseFloat(sEl.dataset.fontSize!);
        if (!isNaN(fs) && fs > 0) {
          sEl.style.fontSize = `${fs * currentZoom}px`;
        }
      });
    }
  });

  function focusContentEditable(node: HTMLElement) {
    populateEditableContent(node);
    const timer = setTimeout(() => {
      node.focus({ preventScroll: true });
      if (typeof window !== 'undefined' && typeof window.getSelection === 'function') {
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(node);
          selection.removeAllRanges();
          selection.addRange(range);
          handleSelectionUpdate();
        }
      }
    }, 10);

    return {
      destroy() {
        clearTimeout(timer);
        if (typeof window !== 'undefined' && typeof window.getSelection === 'function') {
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            const anchor = selection.anchorNode;
            if (anchor && (anchor === node || node.contains(anchor))) {
              selection.removeAllRanges();
            }
          }
        }
        if (getActiveEditorSelection()?.targetId === element.id) {
          setActiveEditorSelection(null);
        }
      },
    };
  }
</script>

{#if editing}
  <div
    bind:this={editableEl}
    contenteditable="true"
    role="textbox"
    tabindex="0"
    aria-multiline="true"
    onblur={handleBlur}
    onkeydown={handleEditKeyDown}
    onpointerdown={(e) => e.stopPropagation()}
    onmousedown={(e) => e.stopPropagation()}
    onmouseup={(e) => { e.stopPropagation(); handleSelectionUpdate(); }}
    onpointerup={handleSelectionUpdate}
    onkeyup={handleSelectionUpdate}
    oninput={handleSelectionUpdate}
    onclick={(e) => { e.stopPropagation(); handleSelectionUpdate(); }}
    ondblclick={(e) => { e.stopPropagation(); handleSelectionUpdate(); }}
    class="w-full flex flex-col outline-none select-text cursor-text box-border"
    style="
      text-align: {element.textAlign};
      line-height: {element.lineHeight ? `${(element.lineHeight * zoom).toFixed(2)}px` : '1.25'};
      font-size: {element.fontSize * zoom}px;
      font-family: {getCssFontFamily(element.rawFontFamily || element.fontFamily, extractBaseFontFamily)};
      color: {element.color};
      font-weight: {element.fontWeight};
      font-style: {element.fontStyle};
      text-decoration: {resolveTextDecoration(element.underline, element.strikethrough)};
      letter-spacing: {element.letterSpacing || 'normal'};
      white-space: pre-wrap;
      word-break: break-word;
    "
    use:focusContentEditable
  ></div>
{:else}
  <div
    class="w-full flex flex-col pointer-events-none select-none"
    style="
      text-align: {element.textAlign};
      line-height: {element.lineHeight ? `${(element.lineHeight * zoom).toFixed(2)}px` : '1.25'};
      font-size: {element.fontSize * zoom}px;
      font-family: {getCssFontFamily(element.rawFontFamily || element.fontFamily, extractBaseFontFamily)};
      color: {element.color};
      background-color: {hasSegments ? 'transparent' : (element.backgroundColor || 'transparent')};
      font-weight: {element.fontWeight};
      font-style: {element.fontStyle};
      text-decoration: {resolveTextDecoration(element.underline, element.strikethrough)};
      letter-spacing: {element.letterSpacing || 'normal'};
      white-space: pre-wrap;
      word-break: break-word;
    "
  >
    {#if element.lines && element.lines.length > 0}
      {#each element.lines as line, lineIdx}
        <div
          class="canvas-text-line"
          data-line-index={lineIdx}
          style="
            display: block;
            white-space: pre;
            text-align: {element.textAlign};
            line-height: {(line.lineHeight || element.lineHeight) ? `${((line.lineHeight || element.lineHeight)! * zoom).toFixed(2)}px` : '1.25'};
            font-size: {(line.fontSize || element.fontSize) * zoom}px;
            text-decoration: {resolveTextDecoration(line.underline, line.strikethrough)};
            letter-spacing: {element.letterSpacing || 'normal'};
          "
        >
          {#if line.segments && line.segments.length > 0}
            {#each line.segments as segment, segIdx}
              <span
                data-segment-index={segIdx}
                style="
                  font-size: {(segment.fontSize || line.fontSize || element.fontSize) * zoom}px;
                  font-family: {getCssFontFamily(segment.rawFontFamily || segment.fontFamily || element.fontFamily, extractBaseFontFamily)};
                  color: {segment.color || element.color};
                  font-weight: {segment.fontWeight || element.fontWeight};
                  font-style: {segment.fontStyle || element.fontStyle};
                  text-decoration: {resolveTextDecoration(segment.underline, segment.strikethrough)};
                  background-color: {segment.backgroundColor || 'transparent'};
                  vertical-align: baseline;
                  {segment.width && segment.text.trim().length === 0 ? `display: inline-block; width: ${(segment.width * zoom).toFixed(2)}px;` : ''}
                "
              >{segment.text}</span>
            {/each}
          {:else}
            <span
              data-segment-index="0"
              style="
                font-size: {(line.fontSize || element.fontSize) * zoom}px;
                font-family: {getCssFontFamily(element.rawFontFamily || element.fontFamily, extractBaseFontFamily)};
                color: {element.color};
                font-weight: {element.fontWeight};
                font-style: {element.fontStyle};
                text-decoration: {resolveTextDecoration(line.underline, line.strikethrough)};
                background-color: {line.backgroundColor || element.backgroundColor || 'transparent'};
                vertical-align: baseline;
              "
            >{line.text || ''}</span>
          {/if}
        </div>
      {/each}
    {:else if element.segments && element.segments.length > 0}
      <div
        class="w-full"
        style="
          text-align: {element.textAlign};
          line-height: {element.lineHeight ? (element.lineHeight / element.fontSize) : 1.25};
          letter-spacing: {element.letterSpacing || 'normal'};
        "
      >
        {#each element.segments as segment, segIdx}
          <span
            data-segment-index={segIdx}
            style="
              font-size: {(segment.fontSize || element.fontSize) * zoom}px;
              font-family: {getCssFontFamily(segment.rawFontFamily || segment.fontFamily || element.fontFamily, extractBaseFontFamily)};
              color: {segment.color || element.color};
              font-weight: {segment.fontWeight || element.fontWeight};
              font-style: {segment.fontStyle || element.fontStyle};
              text-decoration: {resolveTextDecoration(segment.underline, segment.strikethrough)};
              background-color: {segment.backgroundColor || 'transparent'};
              vertical-align: baseline;
            "
          >{segment.text}</span>
        {/each}
      </div>
    {:else}
      <span
        style="
          font-size: {element.fontSize * zoom}px;
          font-family: {getCssFontFamily(element.rawFontFamily || element.fontFamily, extractBaseFontFamily)};
          color: {element.color};
          font-weight: {element.fontWeight};
          font-style: {element.fontStyle};
          text-decoration: {resolveTextDecoration(element.underline, element.strikethrough)};
          background-color: {element.backgroundColor || 'transparent'};
          letter-spacing: {element.letterSpacing || 'normal'};
          text-align: {element.textAlign};
          display: inline-block;
          line-height: {element.lineHeight ? (element.lineHeight / element.fontSize) : 1.25};
        "
      >{element.text}</span>
    {/if}
  </div>
{/if}
