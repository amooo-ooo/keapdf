<script lang="ts">
  import type { TextElement, TextElementLine, TextSegment } from '../../stores/canvas-types';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import { getCssFontFamily } from '../../services/font-loader';
  import { sanitizePdfText } from '../../services/pdf/utils';
  import {
    computeHalfLeadingTopOffsetPts,
    computeInterLineExtraGapPts,
    formatScaledCssLetterSpacing,
    formatScaledCssWordSpacing,
  } from '../../core/typography-metrics';
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

  const halfLeadingTopOffsetPx = $derived(
    computeHalfLeadingTopOffsetPts(
      element.lines?.[0]?.fontSize || element.fontSize,
      element.lines?.[0]?.lineHeight || element.lineHeight || (element.lines?.[0]?.fontSize || element.fontSize) * 1.25
    ) * zoom
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
    node.style.textDecoration = (element.lines && element.lines.length > 0) || (element.segments && element.segments.length > 0) ? 'none' : resolveTextDecoration(element.underline, element.strikethrough);
    if (element.lines && element.lines.length > 0) {
      for (let lIdx = 0; lIdx < element.lines.length; lIdx++) {
        const line = element.lines[lIdx];
        const lineDiv = document.createElement('div');
        lineDiv.className = 'canvas-text-line';
        lineDiv.dataset.lineIndex = String(lIdx);
        const lFontSize = line.fontSize || element.fontSize;
        lineDiv.dataset.fontSize = `${lFontSize}`;
        const resolvedLineLh = line.lineHeight || element.lineHeight;
        if (resolvedLineLh) {
          lineDiv.dataset.lineHeight = `${resolvedLineLh}`;
        }
        if (lIdx > 0) {
          const extraGapPts = computeInterLineExtraGapPts(element.lines[lIdx - 1], line, element.lineHeight);
          if (Math.abs(extraGapPts) > 0.02) {
            lineDiv.dataset.marginTop = `${extraGapPts}`;
            lineDiv.style.marginTop = `${(extraGapPts * zoom).toFixed(2)}px`;
          }
        }
        if ((element.textAlign || 'left') === 'left' && line.left && line.left > 1.0) {
          lineDiv.dataset.paddingLeft = `${line.left}`;
          lineDiv.style.paddingLeft = `${(line.left * zoom).toFixed(2)}px`;
        }
        const resolvedLineLs = line.letterSpacing || element.letterSpacing;
        if (resolvedLineLs && resolvedLineLs !== 'normal') {
          lineDiv.dataset.letterSpacing = resolvedLineLs;
        }
        const resolvedLineWs = line.wordSpacing ?? element.wordSpacing;
        if (resolvedLineWs !== undefined && Math.abs(resolvedLineWs) >= 0.05) {
          lineDiv.dataset.wordSpacing = `${resolvedLineWs}`;
        }
        lineDiv.style.fontSize = `${lFontSize * zoom}px`;
        lineDiv.style.textAlign = element.textAlign;
        lineDiv.style.whiteSpace = 'pre';
        lineDiv.style.lineHeight = resolvedLineLh ? `${(resolvedLineLh * zoom).toFixed(2)}px` : '1.25';
        if (resolvedLineLh) {
          lineDiv.style.height = `${(resolvedLineLh * zoom).toFixed(2)}px`;
        }
        lineDiv.style.letterSpacing = formatScaledCssLetterSpacing(resolvedLineLs, lFontSize, zoom);
        lineDiv.style.wordSpacing = formatScaledCssWordSpacing(resolvedLineWs, zoom);
        lineDiv.style.textDecoration = (line.segments && line.segments.length > 0) ? 'none' : resolveTextDecoration(line.underline, line.strikethrough);

        if (line.segments && line.segments.length > 0) {
          for (let sIdx = 0; sIdx < line.segments.length; sIdx++) {
            const seg = line.segments[sIdx];
            const spanEl = document.createElement('span');
            spanEl.dataset.segmentIndex = String(sIdx);
            const sFontSize = seg.fontSize || line.fontSize || element.fontSize;
            spanEl.dataset.fontSize = `${sFontSize}`;
            if (seg.fontFamily || element.fontFamily) {
              spanEl.dataset.fontFamily = seg.fontFamily || element.fontFamily;
            }
            if (seg.rawFontFamily || element.rawFontFamily) {
              spanEl.dataset.rawFontFamily = seg.rawFontFamily || element.rawFontFamily;
            }
            const segLs = seg.letterSpacing || resolvedLineLs;
            if (segLs && segLs !== 'normal') {
              spanEl.dataset.letterSpacing = segLs;
            }
            const segWs = seg.wordSpacing ?? resolvedLineWs;
            if (segWs !== undefined && Math.abs(segWs) >= 0.05) {
              spanEl.dataset.wordSpacing = `${segWs}`;
            }
            spanEl.style.fontSize = `${sFontSize * zoom}px`;
            spanEl.style.fontFamily = getCssFontFamily(seg.rawFontFamily || seg.fontFamily || element.rawFontFamily || element.fontFamily);
            spanEl.style.color = seg.color || element.color;
            spanEl.style.fontWeight = seg.fontWeight || element.fontWeight;
            spanEl.style.fontStyle = seg.fontStyle || element.fontStyle;
            spanEl.style.textDecoration = resolveTextDecoration(seg.underline, seg.strikethrough);
            spanEl.style.backgroundColor = seg.backgroundColor || 'transparent';
            spanEl.style.letterSpacing = formatScaledCssLetterSpacing(segLs, sFontSize, zoom);
            spanEl.style.wordSpacing = formatScaledCssWordSpacing(segWs, zoom);
            spanEl.style.lineHeight = '1';
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
          if (element.fontFamily) {
            spanEl.dataset.fontFamily = element.fontFamily;
          }
          if (element.rawFontFamily) {
            spanEl.dataset.rawFontFamily = element.rawFontFamily;
          }
          if (resolvedLineLs && resolvedLineLs !== 'normal') {
            spanEl.dataset.letterSpacing = resolvedLineLs;
          }
          if (resolvedLineWs !== undefined && Math.abs(resolvedLineWs) >= 0.05) {
            spanEl.dataset.wordSpacing = `${resolvedLineWs}`;
          }
          spanEl.style.fontSize = `${lFontSize * zoom}px`;
          spanEl.style.fontFamily = getCssFontFamily(element.rawFontFamily || element.fontFamily);
          spanEl.style.color = element.color;
          spanEl.style.fontWeight = element.fontWeight;
          spanEl.style.fontStyle = element.fontStyle;
          spanEl.style.textDecoration = resolveTextDecoration(line.underline, line.strikethrough);
          spanEl.style.backgroundColor = element.backgroundColor || 'transparent';
          spanEl.style.letterSpacing = formatScaledCssLetterSpacing(resolvedLineLs, lFontSize, zoom);
          spanEl.style.wordSpacing = formatScaledCssWordSpacing(resolvedLineWs, zoom);
          spanEl.style.lineHeight = '1';
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
        const segLs = seg.letterSpacing || element.letterSpacing;
        if (segLs && segLs !== 'normal') {
          spanEl.dataset.letterSpacing = segLs;
        }
        const segWs = seg.wordSpacing ?? element.wordSpacing;
        if (segWs !== undefined && Math.abs(segWs) >= 0.05) {
          spanEl.dataset.wordSpacing = `${segWs}`;
        }
        spanEl.style.fontSize = `${sFontSize * zoom}px`;
        spanEl.style.fontFamily = getCssFontFamily(seg.fontFamily || seg.rawFontFamily || element.fontFamily || element.rawFontFamily);
        spanEl.style.color = seg.color || element.color;
        spanEl.style.fontWeight = seg.fontWeight || element.fontWeight;
        spanEl.style.fontStyle = seg.fontStyle || element.fontStyle;
        spanEl.style.textDecoration = resolveTextDecoration(seg.underline, seg.strikethrough);
        spanEl.style.backgroundColor = seg.backgroundColor || 'transparent';
        spanEl.style.letterSpacing = formatScaledCssLetterSpacing(segLs, sFontSize, zoom);
        spanEl.style.wordSpacing = formatScaledCssWordSpacing(segWs, zoom);
        spanEl.style.lineHeight = '1';
        spanEl.style.verticalAlign = 'baseline';
        spanEl.textContent = seg.text;
        node.appendChild(spanEl);
      }
    } else {
      const initialLines = (element.text || '').split(/\r?\n/);
      for (let lineIdx = 0; lineIdx < initialLines.length; lineIdx++) {
        const lineDiv = document.createElement('div');
        lineDiv.className = 'canvas-text-line';
        lineDiv.dataset.lineIndex = String(lineIdx);
        lineDiv.dataset.fontSize = `${element.fontSize}`;
        if (element.lineHeight) {
          lineDiv.dataset.lineHeight = `${element.lineHeight}`;
        }
        if (element.letterSpacing && element.letterSpacing !== 'normal') {
          lineDiv.dataset.letterSpacing = element.letterSpacing;
        }
        if (element.wordSpacing !== undefined && Math.abs(element.wordSpacing) >= 0.05) {
          lineDiv.dataset.wordSpacing = `${element.wordSpacing}`;
        }
        lineDiv.style.fontSize = `${element.fontSize * zoom}px`;
        lineDiv.style.lineHeight = element.lineHeight ? `${(element.lineHeight * zoom).toFixed(2)}px` : '1.25';
        if (element.lineHeight) {
          lineDiv.style.height = `${(element.lineHeight * zoom).toFixed(2)}px`;
        }
        lineDiv.style.letterSpacing = formatScaledCssLetterSpacing(element.letterSpacing, element.fontSize, zoom);
        lineDiv.style.wordSpacing = formatScaledCssWordSpacing(element.wordSpacing, zoom);

        const spanEl = document.createElement('span');
        spanEl.dataset.segmentIndex = '0';
        spanEl.dataset.fontSize = `${element.fontSize}`;
        if (element.letterSpacing && element.letterSpacing !== 'normal') {
          spanEl.dataset.letterSpacing = element.letterSpacing;
        }
        spanEl.style.fontSize = `${element.fontSize * zoom}px`;
        spanEl.style.fontFamily = getCssFontFamily(element.fontFamily || element.rawFontFamily);
        spanEl.style.color = element.color;
        spanEl.style.fontWeight = element.fontWeight;
        spanEl.style.fontStyle = element.fontStyle;
        spanEl.style.textDecoration = resolveTextDecoration(element.underline, element.strikethrough);
        spanEl.style.backgroundColor = element.backgroundColor || 'transparent';
        spanEl.style.letterSpacing = formatScaledCssLetterSpacing(element.letterSpacing, element.fontSize, zoom);
        spanEl.style.wordSpacing = formatScaledCssWordSpacing(element.wordSpacing, zoom);
        spanEl.style.lineHeight = '1';
        spanEl.style.verticalAlign = 'baseline';
        spanEl.textContent = initialLines[lineIdx];
        lineDiv.appendChild(spanEl);
        node.appendChild(lineDiv);
      }
    }
  }

  let isCommitting = false;

  // Ensure pending text content edits are committed when the element unmounts.
  $effect(() => {
    return () => {
      commitContent(true);
    };
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

      const isTextModified = fullText !== element.text;
      const firstLineFs = element.lines?.[0]?.fontSize || element.fontSize;
      const firstLineLh = element.lines?.[0]?.lineHeight || element.lineHeight || firstLineFs * 1.25;
      const leadingOverhangPts = Math.max(0, firstLineLh - firstLineFs);
      const measuredHeightPts = Math.max(0, editableEl.scrollHeight / zoom - leadingOverhangPts);
      const newHeight =
        isTextModified && measuredHeightPts > element.height + 1
          ? Math.round(measuredHeightPts * 100) / 100
          : element.height;
      const measuredWidthPts = editableEl.scrollWidth / zoom;
      const newWidth =
        isTextModified && measuredWidthPts > element.width + 1
          ? Math.round(measuredWidthPts * 100) / 100
          : element.width;

      const lineNodes = Array.from(editableEl.children).filter(
        (child): child is HTMLDivElement => child instanceof HTMLDivElement
      );
      if (lineNodes.length > 0) {
        const updatedLines: TextElementLine[] = [];
        const allSegments: TextSegment[] = [];
        const isSameLineCount = Boolean(element.lines && lineNodes.length === element.lines.length);
        let cumulativeTop = element.lines?.[0]?.top ?? 0;
        let cumulativeBaselineY = element.lines?.[0]?.baselineY;
        let prevLineLh = element.lines?.[0]?.lineHeight ?? element.lineHeight ?? element.fontSize * 1.25;

        for (let lIdx = 0; lIdx < lineNodes.length; lIdx++) {
          const lineNode = lineNodes[lIdx];
          const domLineIdx = lineNode.dataset.lineIndex !== undefined ? parseInt(lineNode.dataset.lineIndex, 10) : NaN;
          const origLine = isSameLineCount
            ? element.lines![lIdx]
            : ((!isNaN(domLineIdx) && element.lines?.[domLineIdx]) ||
                (element.lines && element.lines[lIdx] ? element.lines[lIdx] : undefined));
          const lineFontSize = origLine?.fontSize || element.fontSize;
          const lineText = sanitizePdfText(lineNode.innerText ?? lineNode.textContent ?? '');
          const domLineLh = lineNode.dataset.lineHeight ? parseFloat(lineNode.dataset.lineHeight) : undefined;
          const resolvedLineLh = (domLineLh && !isNaN(domLineLh) ? domLineLh : undefined) ?? origLine?.lineHeight ?? element.lineHeight;
          const resolvedLineLs = lineNode.dataset.letterSpacing || origLine?.letterSpacing || element.letterSpacing;
          const domLineWs = lineNode.dataset.wordSpacing ? parseFloat(lineNode.dataset.wordSpacing) : undefined;
          const resolvedLineWs = (domLineWs !== undefined && !isNaN(domLineWs) ? domLineWs : undefined) ?? origLine?.wordSpacing ?? element.wordSpacing;
          const domMarginTop = lineNode.dataset.marginTop ? parseFloat(lineNode.dataset.marginTop) : 0;
          const extraGapPts = !isNaN(domMarginTop) && Math.abs(domMarginTop) > 0.02 ? domMarginTop : 0;
          const effectiveLh = resolvedLineLh ?? lineFontSize * 1.25;

          let lineTop: number | undefined;
          let lineBaselineY: number | undefined;
          if (isSameLineCount && origLine?.top !== undefined) {
            lineTop = origLine.top;
            lineBaselineY = origLine.baselineY;
          } else if (lIdx === 0) {
            lineTop = origLine?.top ?? 0;
            lineBaselineY = origLine?.baselineY;
          } else {
            const stepPts = 0.5 * prevLineLh + 0.5 * effectiveLh + extraGapPts;
            lineTop = cumulativeTop + stepPts;
            lineBaselineY = cumulativeBaselineY !== undefined ? cumulativeBaselineY - stepPts : undefined;
          }
          if (lineTop !== undefined) cumulativeTop = lineTop;
          if (lineBaselineY !== undefined) cumulativeBaselineY = lineBaselineY;
          prevLineLh = effectiveLh;

          const lineSegments: TextSegment[] = [];
          for (let cIdx = 0; cIdx < lineNode.childNodes.length; cIdx++) {
            const childNode = lineNode.childNodes[cIdx];
            if (childNode instanceof HTMLElement) {
              const segNode = childNode;
              const segText = sanitizePdfText(segNode.innerText ?? segNode.textContent ?? '');
              if (!segText) continue;

              const origSegIdx = parseInt(segNode.dataset.segmentIndex || `${cIdx}`, 10);
              const origSeg = origLine?.segments?.[origSegIdx] ?? origLine?.segments?.[Math.min(lineSegments.length, (origLine?.segments?.length || 1) - 1)];

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
              const segLs = segNode.dataset.letterSpacing || origSeg?.letterSpacing || resolvedLineLs;
              const rawSegWs = segNode.dataset.wordSpacing ? parseFloat(segNode.dataset.wordSpacing) : NaN;
              const segWs = !isNaN(rawSegWs) ? rawSegWs : (origSeg?.wordSpacing ?? resolvedLineWs);
              const domSegFontFamily = segNode.dataset.fontFamily || undefined;
              const domSegRawFontFamily = segNode.dataset.rawFontFamily || undefined;

              const seg: TextSegment = {
                text: segText,
                fontSize: parsedFs,
                fontFamily: domSegFontFamily || origSeg?.fontFamily || element.fontFamily,
                rawFontFamily: domSegRawFontFamily || origSeg?.rawFontFamily || element.rawFontFamily,
                color: nodeColor || origSeg?.color || element.color,
                backgroundColor: segBg,
                fontWeight: nodeFw || origSeg?.fontWeight || element.fontWeight,
                fontStyle: nodeFs || origSeg?.fontStyle || element.fontStyle,
                ...(segLs ? { letterSpacing: segLs } : {}),
                ...(segWs !== undefined ? { wordSpacing: segWs } : {}),
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
                const adjSeg = lineSegments.length > 0
                  ? lineSegments[lineSegments.length - 1]
                  : origLine?.segments?.[0];
                const seg: TextSegment = {
                  text: cleanTxt,
                  fontSize: adjSeg?.fontSize || lineFontSize,
                  fontFamily: adjSeg?.fontFamily || element.fontFamily,
                  rawFontFamily: adjSeg?.rawFontFamily || element.rawFontFamily,
                  color: adjSeg?.color || element.color,
                  backgroundColor: adjSeg?.backgroundColor ?? (element.backgroundColor || undefined),
                  fontWeight: adjSeg?.fontWeight || element.fontWeight,
                  fontStyle: adjSeg?.fontStyle || element.fontStyle,
                  ...(resolvedLineLs ? { letterSpacing: resolvedLineLs } : {}),
                  ...(resolvedLineWs !== undefined ? { wordSpacing: resolvedLineWs } : {}),
                  underline: adjSeg?.underline ?? origLine?.underline ?? element.underline,
                  strikethrough: adjSeg?.strikethrough ?? origLine?.strikethrough ?? element.strikethrough,
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
              ...(resolvedLineLs ? { letterSpacing: resolvedLineLs } : {}),
              ...(resolvedLineWs !== undefined ? { wordSpacing: resolvedLineWs } : {}),
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
            lineHeight: resolvedLineLh,
            ...(lineTop !== undefined ? { top: lineTop } : {}),
            ...(origLine?.left !== undefined ? { left: origLine.left } : {}),
            ...(origLine?.width !== undefined ? { width: origLine.width } : {}),
            ...(origLine?.height !== undefined ? { height: origLine.height } : {}),
            ...(lineBaselineY !== undefined ? { baselineY: lineBaselineY } : {}),
            ...(resolvedLineLs ? { letterSpacing: resolvedLineLs } : {}),
            ...(resolvedLineWs !== undefined ? { wordSpacing: resolvedLineWs } : {}),
            ...(origLine?.scaleX !== undefined ? { scaleX: origLine.scaleX } : {}),
            segments: lineSegments,
          });
        }

        if (
          !element.lines &&
          !element.segments &&
          fullText === element.text &&
          newWidth === element.width &&
          newHeight === element.height
        ) {
          const hasCustomSegStyle = allSegments.some((s) =>
            (s.fontSize !== undefined && s.fontSize !== element.fontSize) ||
            (s.fontFamily && s.fontFamily !== element.fontFamily && s.fontFamily !== element.rawFontFamily) ||
            (s.color && s.color !== element.color) ||
            (s.backgroundColor || undefined) !== (element.backgroundColor || undefined) ||
            (s.fontWeight && s.fontWeight !== element.fontWeight) ||
            (s.fontStyle && s.fontStyle !== element.fontStyle) ||
            (s.letterSpacing || 'normal') !== (element.letterSpacing || 'normal') ||
            Boolean(s.underline) !== Boolean(element.underline) ||
            Boolean(s.strikethrough) !== Boolean(element.strikethrough)
          );
          if (!hasCustomSegStyle) {
            return;
          }
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
          const segLs = segNode.dataset.letterSpacing || origSeg?.letterSpacing || element.letterSpacing;
          const rawSegWs = segNode.dataset.wordSpacing ? parseFloat(segNode.dataset.wordSpacing) : NaN;
          const segWs = !isNaN(rawSegWs) ? rawSegWs : (origSeg?.wordSpacing ?? element.wordSpacing);

          const chosenFont = origSeg?.fontFamily || element.fontFamily;
          flatSegments.push({
            text: segText,
            fontSize: parsedFs,
            fontFamily: chosenFont,
            rawFontFamily: chosenFont,
            color: nodeColor || origSeg?.color || element.color,
            backgroundColor: segBg,
            fontWeight: nodeFw || origSeg?.fontWeight || element.fontWeight,
            fontStyle: nodeFs || origSeg?.fontStyle || element.fontStyle,
            ...(segLs ? { letterSpacing: segLs } : {}),
            ...(segWs !== undefined ? { wordSpacing: segWs } : {}),
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

      if (
        !element.lines &&
        !element.segments &&
        fullText === element.text &&
        newWidth === element.width &&
        newHeight === element.height
      ) {
        return;
      }

      const textLines = fullText.split(/\r?\n/);
      const updatedLines: TextElementLine[] = textLines.map((lineStr, idx) => {
        const originalLine = element.lines && element.lines[idx] ? element.lines[idx] : undefined;
        const lineFontSize = originalLine?.fontSize || element.fontSize;
        const lineUnderline = originalLine?.underline ?? element.underline;
        const lineStrike = originalLine?.strikethrough ?? element.strikethrough;
        const lineLs = originalLine?.letterSpacing ?? element.letterSpacing;
        const lineWs = originalLine?.wordSpacing ?? element.wordSpacing;
        return {
          text: lineStr,
          fontSize: lineFontSize,
          lineHeight: originalLine?.lineHeight ?? element.lineHeight,
          ...(lineLs ? { letterSpacing: lineLs } : {}),
          ...(lineWs !== undefined ? { wordSpacing: lineWs } : {}),
          underline: lineUnderline,
          strikethrough: lineStrike,
          segments: [{
            text: lineStr,
            fontSize: lineFontSize,
            fontFamily: element.fontFamily,
            rawFontFamily: element.rawFontFamily,
            color: element.color,
            backgroundColor: element.backgroundColor || undefined,
            fontWeight: element.fontWeight,
            fontStyle: element.fontStyle,
            ...(lineLs ? { letterSpacing: lineLs } : {}),
            ...(lineWs !== undefined ? { wordSpacing: lineWs } : {}),
            underline: lineUnderline,
            strikethrough: lineStrike,
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
    void element.textAlign;
    void element.lineHeight;
    void element.letterSpacing;
    void element.wordSpacing;
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
    const currentAlign = element.textAlign;
    const currentLh = element.lineHeight;
    const currentLs = element.letterSpacing;
    const currentWs = element.wordSpacing;
    if (editing && editableEl && !isCommitting) {
      editableEl.style.textAlign = currentAlign;
      editableEl.style.marginTop = `${halfLeadingTopOffsetPx.toFixed(2)}px`;
      editableEl.style.lineHeight = currentLh ? `${(currentLh * currentZoom).toFixed(2)}px` : '1.25';
      editableEl.style.letterSpacing = formatScaledCssLetterSpacing(currentLs, element.fontSize, currentZoom);
      editableEl.style.wordSpacing = formatScaledCssWordSpacing(currentWs, currentZoom);
      const lineEls = editableEl.querySelectorAll<HTMLElement>('.canvas-text-line');
      lineEls.forEach((lEl) => {
        lEl.style.textAlign = currentAlign;
        const lineFs = lEl.dataset.fontSize ? parseFloat(lEl.dataset.fontSize) : null;
        if (lineFs) {
          lEl.style.fontSize = `${lineFs * currentZoom}px`;
        }
        const lineH = lEl.dataset.lineHeight ? parseFloat(lEl.dataset.lineHeight) : currentLh;
        if (lineH) {
          lEl.style.lineHeight = `${(lineH * currentZoom).toFixed(2)}px`;
          lEl.style.height = `${(lineH * currentZoom).toFixed(2)}px`;
        }
        const mTop = lEl.dataset.marginTop ? parseFloat(lEl.dataset.marginTop) : 0;
        if (!isNaN(mTop) && Math.abs(mTop) > 0.02) {
          lEl.style.marginTop = `${(mTop * currentZoom).toFixed(2)}px`;
        } else {
          lEl.style.marginTop = '0px';
        }
        const pLeft = lEl.dataset.paddingLeft ? parseFloat(lEl.dataset.paddingLeft) : 0;
        if ((currentAlign || 'left') === 'left' && !isNaN(pLeft) && pLeft > 1.0) {
          lEl.style.paddingLeft = `${(pLeft * currentZoom).toFixed(2)}px`;
        } else {
          lEl.style.paddingLeft = '0px';
        }
        const lineLs = lEl.dataset.letterSpacing || currentLs;
        lEl.style.letterSpacing = formatScaledCssLetterSpacing(lineLs, lineFs || element.fontSize, currentZoom);
        const lineWs = lEl.dataset.wordSpacing ? parseFloat(lEl.dataset.wordSpacing) : currentWs;
        lEl.style.wordSpacing = formatScaledCssWordSpacing(lineWs, currentZoom);
      });

      const spanEls = editableEl.querySelectorAll<HTMLElement>('span[data-font-size]');
      spanEls.forEach((sEl) => {
        const fs = parseFloat(sEl.dataset.fontSize!);
        if (!isNaN(fs) && fs > 0) {
          sEl.style.fontSize = `${fs * currentZoom}px`;
        }
        const segLs = sEl.dataset.letterSpacing || currentLs;
        sEl.style.letterSpacing = formatScaledCssLetterSpacing(segLs, fs || element.fontSize, currentZoom);
        const segWs = sEl.dataset.wordSpacing ? parseFloat(sEl.dataset.wordSpacing) : currentWs;
        sEl.style.wordSpacing = formatScaledCssWordSpacing(segWs, currentZoom);
        sEl.style.lineHeight = '1';
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
        commitContent(false);
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
    aria-label="Text element editor"
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
      margin-top: {halfLeadingTopOffsetPx.toFixed(2)}px;
      line-height: {element.lineHeight ? `${(element.lineHeight * zoom).toFixed(2)}px` : '1.25'};
      font-size: {element.fontSize * zoom}px;
      font-family: {getCssFontFamily(element.rawFontFamily || element.fontFamily)};
      color: {element.color};
      font-weight: {element.fontWeight};
      font-style: {element.fontStyle};
      text-decoration: {hasSegments || (element.lines && element.lines.length > 0) ? 'none' : resolveTextDecoration(element.underline, element.strikethrough)};
      letter-spacing: {formatScaledCssLetterSpacing(element.letterSpacing, element.fontSize, zoom)};
      word-spacing: {formatScaledCssWordSpacing(element.wordSpacing, zoom)};
      text-rendering: geometricPrecision;
      -webkit-font-smoothing: antialiased;
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
      margin-top: {halfLeadingTopOffsetPx.toFixed(2)}px;
      line-height: {element.lineHeight ? `${(element.lineHeight * zoom).toFixed(2)}px` : '1.25'};
      font-size: {element.fontSize * zoom}px;
      font-family: {getCssFontFamily(element.rawFontFamily || element.fontFamily)};
      color: {element.color};
      background-color: {hasSegments ? 'transparent' : (element.backgroundColor || 'transparent')};
      font-weight: {element.fontWeight};
      font-style: {element.fontStyle};
      text-decoration: {hasSegments || (element.lines && element.lines.length > 0) ? 'none' : resolveTextDecoration(element.underline, element.strikethrough)};
      letter-spacing: {formatScaledCssLetterSpacing(element.letterSpacing, element.fontSize, zoom)};
      word-spacing: {formatScaledCssWordSpacing(element.wordSpacing, zoom)};
      text-rendering: geometricPrecision;
      -webkit-font-smoothing: antialiased;
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
            margin-top: {lineIdx > 0 ? `${(computeInterLineExtraGapPts(element.lines[lineIdx - 1], line, element.lineHeight) * zoom).toFixed(2)}px` : '0px'};
            padding-left: {(element.textAlign || 'left') === 'left' && line.left && line.left > 1.0 ? `${(line.left * zoom).toFixed(2)}px` : '0px'};
            line-height: {(line.lineHeight || element.lineHeight) ? `${((line.lineHeight || element.lineHeight)! * zoom).toFixed(2)}px` : '1.25'};
            {(line.lineHeight || element.lineHeight) ? `height: ${((line.lineHeight || element.lineHeight)! * zoom).toFixed(2)}px;` : ''}
            font-size: {(line.fontSize || element.fontSize) * zoom}px;
            text-decoration: {line.segments && line.segments.length > 0 ? 'none' : resolveTextDecoration(line.underline, line.strikethrough)};
            letter-spacing: {formatScaledCssLetterSpacing(line.letterSpacing || element.letterSpacing, line.fontSize || element.fontSize, zoom)};
            word-spacing: {formatScaledCssWordSpacing(line.wordSpacing ?? element.wordSpacing, zoom)};
          "
        >
          {#if line.segments && line.segments.length > 0}
            {#each line.segments as segment, segIdx}
              <span
                data-segment-index={segIdx}
                style="
                  font-size: {(segment.fontSize || line.fontSize || element.fontSize) * zoom}px;
                  font-family: {getCssFontFamily(segment.rawFontFamily || segment.fontFamily || element.rawFontFamily || element.fontFamily)};
                  color: {segment.color || element.color};
                  font-weight: {segment.fontWeight || element.fontWeight};
                  font-style: {segment.fontStyle || element.fontStyle};
                  text-decoration: {resolveTextDecoration(segment.underline, segment.strikethrough)};
                  background-color: {segment.backgroundColor || 'transparent'};
                  letter-spacing: {formatScaledCssLetterSpacing(segment.letterSpacing || line.letterSpacing || element.letterSpacing, segment.fontSize || line.fontSize || element.fontSize, zoom)};
                  word-spacing: {formatScaledCssWordSpacing(segment.wordSpacing ?? line.wordSpacing ?? element.wordSpacing, zoom)};
                  line-height: 1;
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
                font-family: {getCssFontFamily(element.rawFontFamily || element.fontFamily)};
                color: {element.color};
                font-weight: {element.fontWeight};
                font-style: {element.fontStyle};
                text-decoration: {resolveTextDecoration(line.underline, line.strikethrough)};
                background-color: {line.backgroundColor || element.backgroundColor || 'transparent'};
                letter-spacing: {formatScaledCssLetterSpacing(line.letterSpacing || element.letterSpacing, line.fontSize || element.fontSize, zoom)};
                word-spacing: {formatScaledCssWordSpacing(line.wordSpacing ?? element.wordSpacing, zoom)};
                line-height: 1;
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
          line-height: {element.lineHeight ? `${(element.lineHeight * zoom).toFixed(2)}px` : '1.25'};
          letter-spacing: {formatScaledCssLetterSpacing(element.letterSpacing, element.fontSize, zoom)};
          word-spacing: {formatScaledCssWordSpacing(element.wordSpacing, zoom)};
        "
      >
        {#each element.segments as segment, segIdx}
          <span
            data-segment-index={segIdx}
            style="
              font-size: {(segment.fontSize || element.fontSize) * zoom}px;
              font-family: {getCssFontFamily(segment.fontFamily || segment.rawFontFamily || element.fontFamily || element.rawFontFamily)};
              color: {segment.color || element.color};
              font-weight: {segment.fontWeight || element.fontWeight};
              font-style: {segment.fontStyle || element.fontStyle};
              text-decoration: {resolveTextDecoration(segment.underline, segment.strikethrough)};
              background-color: {segment.backgroundColor || 'transparent'};
              letter-spacing: {formatScaledCssLetterSpacing(segment.letterSpacing || element.letterSpacing, segment.fontSize || element.fontSize, zoom)};
              word-spacing: {formatScaledCssWordSpacing(segment.wordSpacing ?? element.wordSpacing, zoom)};
              line-height: 1;
              vertical-align: baseline;
            "
          >{segment.text}</span>
        {/each}
      </div>
    {:else}
      <span
        style="
          font-size: {element.fontSize * zoom}px;
          font-family: {getCssFontFamily(element.fontFamily || element.rawFontFamily)};
          color: {element.color};
          font-weight: {element.fontWeight};
          font-style: {element.fontStyle};
          text-decoration: {resolveTextDecoration(element.underline, element.strikethrough)};
          background-color: {element.backgroundColor || 'transparent'};
          letter-spacing: {formatScaledCssLetterSpacing(element.letterSpacing, element.fontSize, zoom)};
          word-spacing: {formatScaledCssWordSpacing(element.wordSpacing, zoom)};
          text-align: {element.textAlign};
          display: block;
          width: 100%;
          line-height: {element.lineHeight ? `${(element.lineHeight * zoom).toFixed(2)}px` : '1.25'};
        "
      >{element.text}</span>
    {/if}
  </div>
{/if}
