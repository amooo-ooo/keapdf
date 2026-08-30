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
        if (traverse(child)) return true;
      }
    }
    return false;
  }

  traverse(container);

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

