import type { TextElement, TextElementLine, TextSegment } from '../stores/canvas-types';
import type { TextLine, TextWord } from '../core/types';

/**
 * Information about a selected range within a text container.
 */
export interface TextRangeSelection {
  start: number;
  end: number;
  text: string;
}

/**
 * Tracks the globally active text selection within inline editors.
 */
export interface ActiveEditorSelection {
  mode: 'canvas' | 'pdf';
  targetId: string;
  start: number;
  end: number;
  text: string;
  container: HTMLElement | null;
}

let currentActiveSelection: ActiveEditorSelection | null = null;

export function setActiveEditorSelection(sel: ActiveEditorSelection | null): void {
  currentActiveSelection = sel;
}

export function getActiveEditorSelection(): ActiveEditorSelection | null {
  return currentActiveSelection;
}

let isInteractingWithInspectorState = false;

/**
 * Flags whether the user is actively interacting with an inspector control
 * (such as opening the native OS color picker dialog) where relatedTarget may be null.
 */
export function setInspectorInteracting(active: boolean): void {
  isInteractingWithInspectorState = active;
}

export function isInspectorInteracting(): boolean {
  return isInteractingWithInspectorState;
}

/**
 * Determines whether an event target is located within the right inspector panel
 * or an associated dropdown / popup, indicating that text editing focus should be preserved.
 *
 * @param target The event target or relatedTarget to test.
 * @return True if the target belongs to the right panel or an associated popover.
 */
export function isInspectorControlTarget(target: EventTarget | null): boolean {
  if (isInteractingWithInspectorState) {
    return true;
  }
  if (
    !target ||
    typeof target !== 'object' ||
    !('closest' in target) ||
    typeof (target as { closest?: unknown }).closest !== 'function'
  ) {
    return false;
  }
  const el = target as { closest: (selector: string) => Element | null | boolean };
  return Boolean(
    el.closest('.editor-shell-right') ||
    el.closest('.panel-container') ||
    el.closest('[role="listbox"]') ||
    el.closest('[role="menu"]') ||
    el.closest('[role="dialog"]') ||
    el.closest('[data-bits-select-content]') ||
    el.closest('[data-bits-popover-content]') ||
    el.closest('[data-bits-menu-content]') ||
    el.closest('[data-radix-popper-content-wrapper]')
  );
}

function isLineBlockElement(node: Node): boolean {
  if (node.nodeName === 'BR') return true;
  if ('getAttribute' in node && typeof (node as Element).getAttribute === 'function') {
    const el = node as Element;
    if (el.tagName === 'DIV' || el.tagName === 'P') {
      return true;
    }
    const hasDataLineIndex =
      typeof el.hasAttribute === 'function'
        ? el.hasAttribute('data-line-index')
        : Boolean(el.getAttribute('data-line-index'));
    if (hasDataLineIndex) {
      return true;
    }
    const cls = el.getAttribute('class') || '';
    if (cls.includes('inline-edit-line')) {
      return true;
    }
  }
  return false;
}

/**
 * Computes character offset bounds [start, end] of the current DOM selection
 * relative to the plain text content of a contenteditable container.
 *
 * @param container The contenteditable container element.
 * @return TextRangeSelection if a valid selection exists inside container, null otherwise.
 */
export function getSelectionCharOffsets(container: HTMLElement): TextRangeSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  let currentOffset = 0;
  let start = -1;
  let end = -1;

  function traverse(node: Node): boolean {
    if (
      (typeof HTMLElement !== 'undefined' && node instanceof HTMLElement && node.getAttribute('contenteditable') === 'false') ||
      ('getAttribute' in node && typeof (node as Element).getAttribute === 'function' && (node as Element).getAttribute('contenteditable') === 'false')
    ) {
      return false;
    }
    const isTextNode = (typeof Node !== 'undefined' && node.nodeType === Node.TEXT_NODE) || node.nodeType === 3;
    if (isTextNode) {
      const len = node.textContent?.length ?? 0;
      if (start === -1 && node === range.startContainer) {
        start = currentOffset + range.startOffset;
      }
      if (end === -1 && node === range.endContainer) {
        end = currentOffset + range.endOffset;
        return true;
      }
      currentOffset += len;
    } else {
      const isContainer = node === container;
      for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes[i];
        if (isContainer && i > 0 && isLineBlockElement(child)) {
          if (start === -1 && node === range.startContainer && i === range.startOffset) {
            start = currentOffset;
          }
          if (end === -1 && node === range.endContainer && i === range.endOffset) {
            end = currentOffset;
            return true;
          }
          currentOffset += 1;
        }
        if (start === -1 && node === range.startContainer && i === range.startOffset) {
          start = currentOffset;
        }
        if (end === -1 && node === range.endContainer && i === range.endOffset) {
          end = currentOffset;
          return true;
        }
        if (traverse(child)) {
          if (start !== -1 && end !== -1) return true;
        }
      }
      if (start === -1 && node === range.startContainer && range.startOffset >= node.childNodes.length) {
        start = currentOffset;
      }
      if (end === -1 && node === range.endContainer && range.endOffset >= node.childNodes.length) {
        end = currentOffset;
        return true;
      }
    }
    return false;
  }

  traverse(container);

  if (start !== -1 && end !== -1) {
    return {
      start,
      end,
      text: range.toString(),
    };
  }

  try {
    const preRange = range.cloneRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    const fallbackStart = preRange.toString().length;
    const fallbackEnd = fallbackStart + range.toString().length;
    return {
      start: fallbackStart,
      end: fallbackEnd,
      text: range.toString(),
    };
  } catch {
    return null;
  }
}

/**
 * Restores DOM selection within a contenteditable container to the given character offsets.
 *
 * @param container The contenteditable container element.
 * @param start Start character offset.
 * @param end End character offset.
 */
export function setSelectionCharOffsets(container: HTMLElement, start: number, end: number): void {
  const sel = window.getSelection();
  if (!sel) return;

  let currentOffset = 0;
  let startNode: Node | null = null;
  let startNodeOffset = 0;
  let endNode: Node | null = null;
  let endNodeOffset = 0;

  function traverse(node: Node): boolean {
    if (
      (typeof HTMLElement !== 'undefined' && node instanceof HTMLElement && node.getAttribute('contenteditable') === 'false') ||
      ('getAttribute' in node && typeof (node as Element).getAttribute === 'function' && (node as Element).getAttribute('contenteditable') === 'false')
    ) {
      return false;
    }
    const isTextNode = (typeof Node !== 'undefined' && node.nodeType === Node.TEXT_NODE) || node.nodeType === 3;
    if (isTextNode) {
      const len = node.textContent?.length ?? 0;
      if (!startNode && currentOffset + len >= start) {
        startNode = node;
        startNodeOffset = Math.max(0, start - currentOffset);
      }
      if (!endNode && currentOffset + len >= end) {
        endNode = node;
        endNodeOffset = Math.min(len, end - currentOffset);
        return true;
      }
      currentOffset += len;
    } else {
      const isContainer = node === container;
      for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes[i];
        if (isContainer && i > 0 && isLineBlockElement(child)) {
          currentOffset += 1;
        }
        if (child.nodeName === 'BR' || (child.childNodes.length === 0 && !isTextNode)) {
          if (!startNode && currentOffset >= start) {
            startNode = node;
            startNodeOffset = i;
          }
          if (!endNode && currentOffset >= end) {
            endNode = node;
            endNodeOffset = i;
            return true;
          }
        }
        if (traverse(child)) return true;
      }
    }
    return false;
  }

  traverse(container);

  if (!startNode) {
    startNode = container;
    startNodeOffset = container.childNodes.length;
  }
  if (!endNode) {
    endNode = startNode;
    endNodeOffset = startNodeOffset;
  }

  if (startNode && endNode) {
    try {
      const range = document.createRange();
      range.setStart(startNode, startNodeOffset);
      range.setEnd(endNode, endNodeOffset);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      // Best-effort selection restoration
    }
  }
}

/**
 * Compares two text segments to determine if their visual styling properties are identical.
 */
function areSegmentsStylisticallyEqual(a: TextSegment, b: TextSegment): boolean {
  return (
    a.fontSize === b.fontSize &&
    a.fontFamily === b.fontFamily &&
    a.rawFontFamily === b.rawFontFamily &&
    a.fontWeight === b.fontWeight &&
    a.fontStyle === b.fontStyle &&
    a.color === b.color &&
    a.backgroundColor === b.backgroundColor &&
    Boolean(a.underline) === Boolean(b.underline) &&
    Boolean(a.strikethrough) === Boolean(b.strikethrough)
  );
}

/**
 * Splits an array of styled segments at character range [start, end] and applies styleUpdate
 * exclusively to the overlapping character portions. Automatically coalesces adjacent
 * identical segments.
 *
 * @param segments Original array of text segments.
 * @param start Start character index (inclusive).
 * @param end End character index (exclusive).
 * @param styleUpdate Style properties to apply to the range.
 * @return New array of styled text segments.
 */
export function splitSegmentsAtRange(
  segments: TextSegment[],
  start: number,
  end: number,
  styleUpdate: Partial<TextSegment>
): TextSegment[] {
  if (start >= end || segments.length === 0) {
    return segments.map((s) => ({ ...s }));
  }

  const result: TextSegment[] = [];
  let currentOffset = 0;

  for (const seg of segments) {
    const segLen = seg.text.length;
    const segStart = currentOffset;
    const segEnd = currentOffset + segLen;

    // No overlap with [start, end]
    if (segEnd <= start || segStart >= end) {
      result.push({ ...seg });
      currentOffset = segEnd;
      continue;
    }

    const overlapStart = Math.max(segStart, start);
    const overlapEnd = Math.min(segEnd, end);

    // 1. Portion before overlap
    if (segStart < overlapStart) {
      const beforeText = seg.text.slice(0, overlapStart - segStart);
      if (beforeText.length > 0) {
        result.push({
          ...seg,
          text: beforeText,
          charCount: beforeText.length,
        });
      }
    }

    // 2. Overlapping portion with updated styling
    const styledText = seg.text.slice(overlapStart - segStart, overlapEnd - segStart);
    if (styledText.length > 0) {
      result.push({
        ...seg,
        ...styleUpdate,
        text: styledText,
        charCount: styledText.length,
      });
    }

    // 3. Portion after overlap
    if (segEnd > overlapEnd) {
      const afterText = seg.text.slice(overlapEnd - segStart);
      if (afterText.length > 0) {
        result.push({
          ...seg,
          text: afterText,
          charCount: afterText.length,
        });
      }
    }

    currentOffset = segEnd;
  }

  // Coalesce adjacent segments with identical styles
  return coalesceSegments(result);
}

/**
 * Coalesces adjacent segments that share identical visual styling.
 */
export function coalesceSegments(segments: TextSegment[]): TextSegment[] {
  if (segments.length <= 1) return segments;

  const merged: TextSegment[] = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const next = segments[i];
    if (areSegmentsStylisticallyEqual(current, next)) {
      current.text += next.text;
      current.charCount = (current.charCount || 0) + (next.charCount || next.text.length);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);

  return merged;
}

/**
 * Compares two TextWord tokens to determine if their visual styling properties are identical.
 */
function areWordsStylisticallyEqual(a: TextWord, b: TextWord): boolean {
  const colorA = a.color ? `${a.color.r},${a.color.g},${a.color.b},${a.color.a}` : '';
  const colorB = b.color ? `${b.color.r},${b.color.g},${b.color.b},${b.color.a}` : '';
  return (
    a.fontSize === b.fontSize &&
    a.fontFamily === b.fontFamily &&
    a.rawFontFamily === b.rawFontFamily &&
    a.matchedFontFamily === b.matchedFontFamily &&
    a.fontWeight === b.fontWeight &&
    a.fontStyle === b.fontStyle &&
    colorA === colorB &&
    a.backgroundColor === b.backgroundColor &&
    Boolean(a.underline) === Boolean(b.underline) &&
    Boolean(a.strikethrough) === Boolean(b.strikethrough)
  );
}

/**
 * Splits an array of TextWord items on an inline PDF line at character range [start, end]
 * and applies styleUpdate exclusively to the overlapping character portions.
 *
 * @param words Original array of TextWord objects on the line.
 * @param start Start character index within the line text (inclusive).
 * @param end End character index within the line text (exclusive).
 * @param styleUpdate Style properties to apply to the range.
 * @return New array of styled TextWord items.
 */
export function splitWordsAtRange(
  words: TextWord[],
  start: number,
  end: number,
  styleUpdate: Partial<TextWord>
): TextWord[] {
  if (start >= end || words.length === 0) {
    return words.map((w) => ({ ...w }));
  }

  const result: TextWord[] = [];
  let currentOffset = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.hasPrecedingSpace && i > 0) {
      currentOffset += 1;
    }
    const wordLen = word.text.length;
    const wordStart = currentOffset;
    const wordEnd = currentOffset + wordLen;

    if (wordEnd <= start || wordStart >= end) {
      result.push({ ...word });
      currentOffset = wordEnd;
      continue;
    }

    const overlapStart = Math.max(wordStart, start);
    const overlapEnd = Math.min(wordEnd, end);

    const totalLen = Math.max(1, wordLen);
    const charW = (word.width && word.width > 0 ? word.width : word.fontSize * 0.52 * totalLen) / totalLen;

    // 1. Portion before overlap
    if (wordStart < overlapStart) {
      const beforeText = word.text.slice(0, overlapStart - wordStart);
      if (beforeText.length > 0) {
        const bW = beforeText.length * charW;
        result.push({
          ...word,
          text: beforeText,
          charCount: beforeText.length,
          hasPrecedingSpace: word.hasPrecedingSpace,
          left: word.left,
          width: bW,
          right: word.left + bW,
        });
      }
    }

    // 2. Overlapping portion with updated styling
    const styledText = word.text.slice(overlapStart - wordStart, overlapEnd - wordStart);
    if (styledText.length > 0) {
      const sLeft = word.left + (overlapStart - wordStart) * charW;
      const sW = styledText.length * charW;
      result.push({
        ...word,
        ...styleUpdate,
        text: styledText,
        charCount: styledText.length,
        hasPrecedingSpace: wordStart === overlapStart ? word.hasPrecedingSpace : false,
        left: sLeft,
        width: sW,
        right: sLeft + sW,
      });
    }

    // 3. Portion after overlap
    if (wordEnd > overlapEnd) {
      const afterText = word.text.slice(overlapEnd - wordStart);
      if (afterText.length > 0) {
        const aLeft = word.left + (overlapEnd - wordStart) * charW;
        const aW = afterText.length * charW;
        result.push({
          ...word,
          text: afterText,
          charCount: afterText.length,
          hasPrecedingSpace: false,
          left: aLeft,
          width: aW,
          right: aLeft + aW,
        });
      }
    }

    currentOffset = wordEnd;
  }

  return coalesceWords(result);
}

export const UNICODE_TRAILING_WS_REGEX = /[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]$/;
export const UNICODE_LEADING_WS_REGEX = /^[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/;

/**
 * Coalesces adjacent words that share identical visual styling.
 */
export function coalesceWords(words: TextWord[]): TextWord[] {
  if (words.length <= 1) return words;

  const merged: TextWord[] = [];
  let current = { ...words[0] };

  for (let i = 1; i < words.length; i++) {
    const next = words[i];
    if (areWordsStylisticallyEqual(current, next)) {
      const gap = next.left - current.right;
      const endsWithWs = UNICODE_TRAILING_WS_REGEX.test(current.text);
      const startsWithWs = UNICODE_LEADING_WS_REGEX.test(next.text);
      const hasSpace = Boolean(next.hasPrecedingSpace) || gap >= Math.min(current.fontSize, next.fontSize) * 0.12 || gap >= 0.5;
      const space = (!endsWithWs && !startsWithWs && hasSpace) ? ' ' : '';
      current.text += space + next.text;
      current.charCount = (current.charCount || 0) + space.length + (next.charCount || next.text.length);
      current.width += (space ? Math.min(current.fontSize, next.fontSize) * 0.25 : 0) + next.width;
      current.right = next.right;
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);

  return merged;
}

/**
 * Maps underline and strikethrough boolean states to standard CSS text-decoration string.
 */
export function resolveTextDecoration(underline?: boolean, strikethrough?: boolean): string {
  if (underline && strikethrough) return 'underline line-through';
  if (underline) return 'underline';
  if (strikethrough) return 'line-through';
  return 'none';
}

/**
 * Applies a partial style update to a TextElement across the specified character range [start, end].
 * Handles both multi-line elements with nested segments and single-block segment arrays.
 */
export function applyStyleToCanvasElement(
  element: TextElement,
  start: number,
  end: number,
  styleUpdate: Partial<TextSegment>
): { lines: TextElementLine[]; segments: TextSegment[] } {
  const lines = element.lines && element.lines.length > 0 ? element.lines : undefined;
  if (!lines) {
    const baseSegments: TextSegment[] = element.segments && element.segments.length > 0
      ? element.segments
      : [{
          text: element.text || '',
          fontSize: element.fontSize,
          fontFamily: element.fontFamily,
          rawFontFamily: element.rawFontFamily,
          color: element.color,
          fontWeight: element.fontWeight,
          fontStyle: element.fontStyle,
          underline: element.underline,
          strikethrough: element.strikethrough,
          backgroundColor: element.backgroundColor,
          charCount: (element.text || '').length,
        }];
    const updatedSegments = splitSegmentsAtRange(baseSegments, start, end, styleUpdate);
    const updatedLines: TextElementLine[] = [{
      text: element.text || '',
      fontSize: element.fontSize,
      segments: updatedSegments,
    }];
    return { lines: updatedLines, segments: updatedSegments };
  }

  const updatedLines: TextElementLine[] = [];
  const allSegments: TextSegment[] = [];
  let currentOffset = 0;

  for (let lIdx = 0; lIdx < lines.length; lIdx++) {
    if (lIdx > 0) {
      currentOffset += 1;
    }
    const line = lines[lIdx];
    const lineText = line.text ?? '';
    const lineSegments: TextSegment[] = line.segments && line.segments.length > 0
      ? line.segments
      : [{
          text: lineText,
          fontSize: line.fontSize || element.fontSize,
          fontFamily: element.fontFamily,
          color: element.color,
          fontWeight: element.fontWeight,
          fontStyle: element.fontStyle,
          underline: line.underline ?? element.underline,
          strikethrough: line.strikethrough ?? element.strikethrough,
          backgroundColor: element.backgroundColor,
          charCount: lineText.length,
        }];

    const lineTextLen = lineSegments.reduce((sum, s) => sum + s.text.length, 0);
    const lineStart = currentOffset;
    const lineEnd = currentOffset + lineTextLen;

    if (lineEnd <= start || lineStart >= end) {
      updatedLines.push({ ...line, segments: lineSegments.map((s) => ({ ...s })) });
      allSegments.push(...lineSegments.map((s) => ({ ...s })));
    } else {
      const relStart = Math.max(0, start - lineStart);
      const relEnd = Math.min(lineTextLen, end - lineStart);
      const newSegments = splitSegmentsAtRange(lineSegments, relStart, relEnd, styleUpdate);
      updatedLines.push({
        ...line,
        segments: newSegments,
      });
      allSegments.push(...newSegments);
    }
    currentOffset = lineEnd;
  }

  return { lines: updatedLines, segments: allSegments };
}

/**
 * Applies a partial style update to an array of TextLine items on an inline PDF page
 * across the specified character range [start, end].
 */
export function applyStyleToPdfLines(
  lines: TextLine[],
  start: number,
  end: number,
  styleUpdate: Partial<TextWord>
): { updatedLines: TextLine[]; updatedText: string } {
  if (start >= end || lines.length === 0) {
    return {
      updatedLines: lines.map((l) => ({ ...l, words: l.words?.map((w) => ({ ...w })) })),
      updatedText: lines.map((l) => l.text).join('\n'),
    };
  }

  const updatedLines: TextLine[] = [];
  let currentOffset = 0;

  for (let lIdx = 0; lIdx < lines.length; lIdx++) {
    if (lIdx > 0) {
      currentOffset += 1;
    }
    const line = lines[lIdx];
    const words = line.words && line.words.length > 0 ? line.words : [];

    if (words.length === 0) {
      const lineLen = line.text.length;
      const lineStart = currentOffset;
      const lineEnd = currentOffset + lineLen;

      if (lineEnd <= start || lineStart >= end) {
        updatedLines.push({ ...line });
      } else {
        const relStart = Math.max(0, start - lineStart);
        const relEnd = Math.min(lineLen, end - lineStart);
        const dummyWord: TextWord = {
          text: line.text,
          left: line.left,
          top: line.top,
          right: line.right,
          bottom: line.bottom,
          width: line.width,
          height: line.height,
          fontSize: line.fontSize,
          baselineY: line.baselineY,
          charStartIndex: 0,
          charCount: line.text.length,
          fontFamily: line.fontFamily,
          rawFontFamily: line.rawFontFamily,
          matchedFontFamily: line.matchedFontFamily,
          color: line.color,
          fontWeight: line.fontWeight,
          fontStyle: line.fontStyle,
        };
        const newWords = splitWordsAtRange([dummyWord], relStart, relEnd, styleUpdate);
        updatedLines.push({
          ...line,
          words: newWords,
        });
      }
      currentOffset = lineEnd;
      continue;
    }

    const lineWords: TextWord[] = [];

    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const word = words[wIdx];
      let hasPrecedingSpace = false;
      if (wIdx > 0) {
        const prev = words[wIdx - 1];
        const gap = word.left - prev.right;
        const endsWithWs = UNICODE_TRAILING_WS_REGEX.test(prev.text);
        const startsWithWs = UNICODE_LEADING_WS_REGEX.test(word.text);
        hasPrecedingSpace = !endsWithWs && !startsWithWs && (Boolean(word.hasPrecedingSpace) || gap >= Math.min(prev.fontSize, word.fontSize) * 0.12 || gap >= 0.5);
      }
      if (hasPrecedingSpace) {
        currentOffset += 1;
      }

      const wordLen = word.text.length;
      const wordStart = currentOffset;
      const wordEnd = currentOffset + wordLen;

      const wordWithSpace: TextWord = {
        ...word,
        hasPrecedingSpace: hasPrecedingSpace || Boolean(word.hasPrecedingSpace),
      };

      if (wordEnd <= start || wordStart >= end) {
        lineWords.push(wordWithSpace);
      } else {
        const relStart = Math.max(0, start - wordStart);
        const relEnd = Math.min(wordLen, end - wordStart);
        const split = splitWordsAtRange([wordWithSpace], relStart, relEnd, styleUpdate);
        lineWords.push(...split);
      }

      currentOffset = wordEnd;
    }

    const coalesced = coalesceWords(lineWords);
    const lineText = coalesced.map((w, idx) => {
      if (idx === 0) return w.text;
      const prev = coalesced[idx - 1];
      const gap = w.left - prev.right;
      const endsWithWs = UNICODE_TRAILING_WS_REGEX.test(prev.text);
      const startsWithWs = UNICODE_LEADING_WS_REGEX.test(w.text);
      const space = (!endsWithWs && !startsWithWs && (w.hasPrecedingSpace || gap >= Math.min(prev.fontSize, w.fontSize) * 0.12 || gap >= 0.5)) ? ' ' : '';
      return `${space}${w.text}`;
    }).join('');

    updatedLines.push({
      ...line,
      text: lineText,
      words: coalesced,
    });
  }

  const updatedText = updatedLines.map((l) => l.text).join('\n');
  return { updatedLines, updatedText };
}

/**
 * Finds the TextWord token located at the specified character offset within structured lines.
 */
export function getWordAtCharOffset(lines: TextLine[], charOffset: number): TextWord | null {
  let currentOffset = 0;
  for (let lIdx = 0; lIdx < lines.length; lIdx++) {
    if (lIdx > 0) {
      currentOffset += 1;
    }
    const line = lines[lIdx];
    const words = line.words && line.words.length > 0 ? line.words : [];
    if (words.length === 0) {
      const lineLen = line.text.length;
      if (charOffset >= currentOffset && charOffset < currentOffset + lineLen) {
        return null;
      }
      currentOffset += lineLen;
      continue;
    }
    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const word = words[wIdx];
      if (wIdx > 0) {
        const prev = words[wIdx - 1];
        const gap = word.left - prev.right;
        const endsWithWs = UNICODE_TRAILING_WS_REGEX.test(prev.text);
        const startsWithWs = UNICODE_LEADING_WS_REGEX.test(word.text);
        if (!endsWithWs && !startsWithWs && (word.hasPrecedingSpace || gap >= Math.min(prev.fontSize, word.fontSize) * 0.12 || gap >= 0.5)) {
          currentOffset += 1;
        }
      }
      const wordLen = word.text.length;
      if (charOffset >= currentOffset && charOffset < currentOffset + wordLen) {
        return word;
      }
      currentOffset += wordLen;
    }
  }
  return null;
}

/**
 * Finds the TextSegment located at the specified character offset within a segment array.
 */
export function getSegmentAtCharOffset(segments: TextSegment[], charOffset: number): TextSegment | null {
  let currentOffset = 0;
  for (const seg of segments) {
    const segLen = seg.text.length;
    if (charOffset >= currentOffset && charOffset < currentOffset + segLen) {
      return seg;
    }
    currentOffset += segLen;
  }
  return null;
}

/**
 * Resolves the original TextLine whose text content or word tokens best match the candidate text.
 * Used during paragraph reflow and line re-wrapping when line counts change to preserve
 * accurate typographic attributes (font family, weight, style, color, line height).
 *
 * @param text The candidate line text.
 * @param origLines The available original lines.
 * @param lineIndexHint Optional hint index to break score ties.
 * @return The closest matching original TextLine, or fallback line.
 */
export function findBestMatchingOrigLine(
  text: string,
  origLines?: TextLine[],
  lineIndexHint?: number
): TextLine | undefined {
  if (!origLines || origLines.length === 0) return undefined;
  const clampedHint = lineIndexHint !== undefined
    ? Math.max(0, Math.min(lineIndexHint, origLines.length - 1))
    : 0;

  if (!text || text.trim().length === 0) {
    return origLines[clampedHint];
  }

  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return origLines[clampedHint];
  }

  let bestLine: TextLine | undefined = undefined;
  let maxScore = 0;

  for (let idx = 0; idx < origLines.length; idx++) {
    const line = origLines[idx];
    let score = 0;
    const lineTextLower = (line.text || '').toLowerCase();
    for (const w of words) {
      if (lineTextLower.includes(w)) {
        score += w.length;
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestLine = line;
    }
  }

  return bestLine || origLines[clampedHint];
}

/**
 * Action type resolved from an inline editor keyboard event.
 */
export type InlineKeyAction = 'submit' | 'lineBreak' | 'cancel' | null;

/**
 * Resolves the appropriate action for keyboard interactions during inline text editing.
 * Pressing Enter saves the edit, while Shift+Enter creates new lines.
 * Pressing Escape cancels the edit session.
 *
 * @param e Keyboard event or event descriptor containing key and modifier states.
 * @return Resolved inline key action, or null if unhandled.
 */
export function resolveInlineKeyAction(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey'> & Partial<Pick<KeyboardEvent, 'isComposing' | 'keyCode'>>
): InlineKeyAction {
  if (e.isComposing || e.keyCode === 229) {
    return null;
  }
  if (e.key === 'Enter') {
    return e.shiftKey ? 'lineBreak' : 'submit';
  }
  if (e.key === 'Escape') {
    return 'cancel';
  }
  return null;
}

