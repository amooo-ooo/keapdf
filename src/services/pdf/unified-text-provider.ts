/**
 * Unified text character provider for annotation, highlight, and redaction tools.
 *
 * Harmonizes character layout metrics across raw PDF text streams (PageCharacter)
 * and interactive canvas text elements (TextElement), enabling character-level
 * hit-testing, text selection, highlighting, and redaction across all layers.
 */

import type { HighlightRect, PageCharacter } from '../../core/types';
import type { CanvasElement, TextElement, TextElementLine } from '../../stores/canvas-types';

/** Base negative offset index for synthetic canvas character IDs to prevent collision with PDFium indices. */
const SYNTHETIC_CHAR_INDEX_BASE = -1000000;

/** Average character width ratio relative to font size for layout approximation. */
const DEFAULT_CHAR_WIDTH_RATIO = 0.55;

/**
 * Estimates character advance width in points based on character glyph and font size.
 *
 * @param char The single character string.
 * @param fontSize Font size in PDF points.
 * @return Approximate horizontal width in points.
 */
function estimateCharWidth(char: string, fontSize: number): number {
  if (char === ' ') return fontSize * 0.28;
  if ('ijlI1|!.,:;\'`'.includes(char)) return fontSize * 0.28;
  if ('mwMW@%#&'.includes(char)) return fontSize * 0.85;
  if ('abcdeghknopqrstuvxyz023456789'.includes(char)) return fontSize * 0.52;
  if ('ABCDEFGHJKLMNOPQRSTUVXYZ'.includes(char)) return fontSize * 0.65;
  return fontSize * DEFAULT_CHAR_WIDTH_RATIO;
}

/**
 * Synthesizes PageCharacter records from a canvas TextElement.
 *
 * @param element The canvas text element.
 * @param _pageIndex Zero-based page index.
 * @param elementIndex Position index of the element for unique ID generation.
 * @return Array of synthesized PageCharacter objects.
 */
export function getCanvasTextCharacters(
  element: TextElement,
  _pageIndex: number,
  elementIndex: number = 0
): PageCharacter[] {
  const characters: PageCharacter[] = [];
  if (!element.visible || !element.text) return characters;

  const baseFontSize = element.fontSize || 12;
  const lineSpacing = element.lineHeight || baseFontSize * 1.25;

  let globalCharOffset = 0;

  if (element.lines && element.lines.length > 0) {
    let currentY = element.y;

    for (let lIdx = 0; lIdx < element.lines.length; lIdx++) {
      const line: TextElementLine = element.lines[lIdx];
      const lineFontSize = line.fontSize || baseFontSize;
      const effectiveLineHeight = line.lineHeight || lineSpacing;
      const lineText = line.text ?? (line.segments ? line.segments.map((s) => s.text).join('') : '');

      let lineTotalWidth = line.width || 0;
      const charWidths: number[] = [];

      if (line.segments && line.segments.length > 0) {
        for (const seg of line.segments) {
          const segFontSize = seg.fontSize || lineFontSize;
          for (let i = 0; i < seg.text.length; i++) {
            const w = estimateCharWidth(seg.text[i], segFontSize);
            charWidths.push(w);
            if (!line.width) lineTotalWidth += w;
          }
        }
      } else {
        for (let i = 0; i < lineText.length; i++) {
          const w = estimateCharWidth(lineText[i], lineFontSize);
          charWidths.push(w);
          if (!line.width) lineTotalWidth += w;
        }
      }

      let startX = element.x + (line.left !== undefined ? line.left : 0);
      if (element.textAlign === 'center') {
        startX = element.x + Math.max(0, (element.width - lineTotalWidth) / 2);
      } else if (element.textAlign === 'right') {
        startX = element.x + Math.max(0, element.width - lineTotalWidth);
      }

      let cursorX = startX;
      const lineTop = line.top !== undefined ? element.y + line.top : currentY;
      const lineBottom = lineTop + (line.height !== undefined ? line.height : effectiveLineHeight);
      const baselineY = line.baselineY !== undefined ? lineTop + line.baselineY : lineTop + lineFontSize * 0.82;

      let charCursor = 0;
      if (line.segments && line.segments.length > 0) {
        for (const seg of line.segments) {
          const segFontSize = seg.fontSize || lineFontSize;
          for (let cIdx = 0; cIdx < seg.text.length; cIdx++) {
            const char = seg.text[cIdx];
            const charWidth = charWidths[charCursor] || estimateCharWidth(char, segFontSize);
            const syntheticIndex = SYNTHETIC_CHAR_INDEX_BASE - (elementIndex * 100000 + globalCharOffset);

            characters.push({
              charIndex: syntheticIndex,
              unicode: char,
              fontSize: segFontSize,
              left: cursorX,
              top: lineTop,
              right: cursorX + charWidth,
              bottom: lineBottom,
              originX: cursorX,
              originY: baselineY,
              domLeft: cursorX,
              domTop: lineTop,
              domRight: cursorX + charWidth,
              domBottom: lineBottom,
              domBaseline: baselineY,
            });

            cursorX += charWidth;
            charCursor++;
            globalCharOffset++;
          }
        }
      } else {
        for (let cIdx = 0; cIdx < lineText.length; cIdx++) {
          const char = lineText[cIdx];
          const charWidth = charWidths[cIdx] || estimateCharWidth(char, lineFontSize);
          const syntheticIndex = SYNTHETIC_CHAR_INDEX_BASE - (elementIndex * 100000 + globalCharOffset);

          characters.push({
            charIndex: syntheticIndex,
            unicode: char,
            fontSize: lineFontSize,
            left: cursorX,
            top: lineTop,
            right: cursorX + charWidth,
            bottom: lineBottom,
            originX: cursorX,
            originY: baselineY,
            domLeft: cursorX,
            domTop: lineTop,
            domRight: cursorX + charWidth,
            domBottom: lineBottom,
            domBaseline: baselineY,
          });

          cursorX += charWidth;
          globalCharOffset++;
        }
      }

      currentY += effectiveLineHeight;
    }
  } else {
    // Single block of text fallback
    const rawLines = element.text.split(/\r?\n/);
    let currentY = element.y;

    for (const lineText of rawLines) {
      let lineTotalWidth = 0;
      const charWidths: number[] = [];
      for (let i = 0; i < lineText.length; i++) {
        const w = estimateCharWidth(lineText[i], baseFontSize);
        charWidths.push(w);
        lineTotalWidth += w;
      }

      let startX = element.x;
      if (element.textAlign === 'center') {
        startX = element.x + Math.max(0, (element.width - lineTotalWidth) / 2);
      } else if (element.textAlign === 'right') {
        startX = element.x + Math.max(0, element.width - lineTotalWidth);
      }

      let cursorX = startX;
      const lineTop = currentY;
      const lineBottom = currentY + lineSpacing;
      const baselineY = lineTop + baseFontSize * 0.82;

      for (let cIdx = 0; cIdx < lineText.length; cIdx++) {
        const char = lineText[cIdx];
        const charWidth = charWidths[cIdx];
        const syntheticIndex = SYNTHETIC_CHAR_INDEX_BASE - (elementIndex * 100000 + globalCharOffset);

        characters.push({
          charIndex: syntheticIndex,
          unicode: char,
          fontSize: baseFontSize,
          left: cursorX,
          top: lineTop,
          right: cursorX + charWidth,
          bottom: lineBottom,
          originX: cursorX,
          originY: baselineY,
          domLeft: cursorX,
          domTop: lineTop,
          domRight: cursorX + charWidth,
          domBottom: lineBottom,
          domBaseline: baselineY,
        });

        cursorX += charWidth;
        globalCharOffset++;
      }

      currentY += lineSpacing;
    }
  }

  return characters;
}

/**
 * Merges native PDF page characters and canvas text element characters into a unified list.
 *
 * @param pageIndex Zero-based page index.
 * @param rawCharacters Characters extracted directly from PDFium text stream.
 * @param canvasElements All canvas elements currently active on the page.
 * @return Combined array of PageCharacter objects across both layers.
 */
export function getUnifiedPageCharacters(
  pageIndex: number,
  rawCharacters: PageCharacter[],
  canvasElements: CanvasElement[]
): PageCharacter[] {
  const pageCanvasTextElements = canvasElements.filter(
    (el): el is TextElement => el.kind === 'text' && el.pageIndex === pageIndex && el.visible
  );

  if (pageCanvasTextElements.length === 0) {
    return rawCharacters;
  }

  const canvasChars: PageCharacter[] = [];
  for (let idx = 0; idx < pageCanvasTextElements.length; idx++) {
    const elChars = getCanvasTextCharacters(pageCanvasTextElements[idx], pageIndex, idx);
    for (let c = 0; c < elChars.length; c++) {
      canvasChars.push(elChars[c]);
    }
  }

  return [...rawCharacters, ...canvasChars];
}

/**
 * Checks whether a character index belongs to a synthetic canvas text element.
 *
 * @param charIndex Character index to check.
 * @return True if the index is a synthetic canvas character ID.
 */
export function isSyntheticCanvasCharIndex(charIndex: number): boolean {
  return charIndex <= SYNTHETIC_CHAR_INDEX_BASE;
}

/**
 * Resolves the parent canvas TextElement and local character offset for a synthetic character index.
 *
 * @param charIndex The synthetic character index.
 * @param pageIndex Zero-based page index.
 * @param canvasElements Active canvas elements.
 * @return The matched TextElement and character offset, or null if not found.
 */
export function resolveCanvasTextChar(
  charIndex: number,
  pageIndex: number,
  canvasElements: CanvasElement[]
): { element: TextElement; charOffset: number } | null {
  if (!isSyntheticCanvasCharIndex(charIndex)) return null;

  const textElements = canvasElements.filter(
    (el): el is TextElement => el.kind === 'text' && el.pageIndex === pageIndex && el.visible
  );

  const rawDelta = SYNTHETIC_CHAR_INDEX_BASE - charIndex;
  const elementIndex = Math.floor(rawDelta / 100000);
  const charOffset = rawDelta % 100000;

  if (elementIndex >= 0 && elementIndex < textElements.length) {
    return {
      element: textElements[elementIndex],
      charOffset,
    };
  }

  return null;
}

/**
 * Spatial hit test to find a character across both raw PDF and canvas text layers.
 *
 * @param characters Combined unified page characters.
 * @param x Horizontal page coordinate in PDF points.
 * @param y Vertical page coordinate in PDF points.
 * @param toleranceX Horizontal tolerance padding in points.
 * @param toleranceY Vertical tolerance padding in points.
 * @return The matched PageCharacter or null.
 */
export function findUnifiedCharacterAt(
  characters: PageCharacter[],
  x: number,
  y: number,
  toleranceX: number = 8,
  toleranceY: number = 6
): PageCharacter | null {
  if (characters.length === 0) return null;

  let bestMatch: PageCharacter | null = null;
  let minDistanceSq = Infinity;

  // 1. Direct hit with bounding box + tolerance
  for (let i = 0; i < characters.length; i++) {
    const c = characters[i];
    const inX = x >= c.domLeft - toleranceX && x <= c.domRight + toleranceX;
    const inY = y >= c.domTop - toleranceY && y <= c.domBottom + toleranceY;

    if (inX && inY) {
      const centerX = (c.domLeft + c.domRight) / 2;
      const centerY = (c.domTop + c.domBottom) / 2;
      const distSq = (x - centerX) ** 2 + (y - centerY) ** 2;
      if (distSq < minDistanceSq) {
        minDistanceSq = distSq;
        bestMatch = c;
      }
    }
  }

  if (bestMatch) return bestMatch;

  // 2. Line-level fallback: if pointer is vertically within a line's range, find closest character horizontally
  for (let i = 0; i < characters.length; i++) {
    const c = characters[i];
    const inY = y >= c.domTop - toleranceY && y <= c.domBottom + toleranceY;
    if (inY) {
      const dx = x < c.domLeft ? c.domLeft - x : x > c.domRight ? x - c.domRight : 0;
      if (dx < toleranceX * 3) {
        const distSq = dx * dx;
        if (distSq < minDistanceSq) {
          minDistanceSq = distSq;
          bestMatch = c;
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Finds the closest character during drag selection across both raw PDF and canvas text layers.
 *
 * @param characters Combined unified page characters.
 * @param x Horizontal page coordinate in PDF points.
 * @param y Vertical page coordinate in PDF points.
 * @param referenceCharIndex Optional starting charIndex to restrict search to the same element or layer.
 * @return The closest PageCharacter or null.
 */
export function findClosestUnifiedCharacter(
  characters: PageCharacter[],
  x: number,
  y: number,
  referenceCharIndex?: number | null
): PageCharacter | null {
  if (characters.length === 0) return null;

  let candidates = characters;
  if (referenceCharIndex !== undefined && referenceCharIndex !== null) {
    if (isSyntheticCanvasCharIndex(referenceCharIndex)) {
      // Stay within the same synthetic canvas text element
      const rawDelta = SYNTHETIC_CHAR_INDEX_BASE - referenceCharIndex;
      const targetElementIndex = Math.floor(rawDelta / 100000);
      const minIndex = SYNTHETIC_CHAR_INDEX_BASE - (targetElementIndex * 100000 + 99999);
      const maxIndex = SYNTHETIC_CHAR_INDEX_BASE - (targetElementIndex * 100000);
      candidates = characters.filter((c) => c.charIndex >= minIndex && c.charIndex <= maxIndex);
    } else {
      // Stay within raw PDF text characters
      candidates = characters.filter((c) => c.charIndex >= 0);
    }
  }

  if (candidates.length === 0) candidates = characters;

  let closestChar: PageCharacter | null = null;
  let minDistanceSq = Infinity;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const dx = x < c.domLeft ? c.domLeft - x : x > c.domRight ? x - c.domRight : 0;
    const dy = y < c.domTop ? c.domTop - y : y > c.domBottom ? y - c.domBottom : 0;
    const distSq = dx * dx + dy * dy;

    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
      closestChar = c;
    }
  }

  return closestChar;
}

/**
 * Calculates highlight rectangles for a character range across both PDF and canvas text layers.
 *
 * @param characters Combined unified page characters.
 * @param startIndex Starting character index.
 * @param endIndex Ending character index.
 * @return Array of computed bounding boxes for the highlighted span.
 */
export function calculateUnifiedHighlightRects(
  characters: PageCharacter[],
  startIndex: number,
  endIndex: number
): HighlightRect[] {
  if (characters.length === 0) return [];

  const minIndex = Math.min(startIndex, endIndex);
  const maxIndex = Math.max(startIndex, endIndex);

  let selectedChars: PageCharacter[];
  if (isSyntheticCanvasCharIndex(startIndex) || isSyntheticCanvasCharIndex(endIndex)) {
    selectedChars = characters.filter(
      (c) => isSyntheticCanvasCharIndex(c.charIndex) && c.charIndex >= minIndex && c.charIndex <= maxIndex
    );
  } else {
    selectedChars = characters.filter(
      (c) => c.charIndex >= 0 && c.charIndex >= minIndex && c.charIndex <= maxIndex
    );
  }

  if (selectedChars.length === 0) return [];

  // Group characters by line based on vertical overlap
  const lines: PageCharacter[][] = [];
  for (const char of selectedChars) {
    let placed = false;
    for (const line of lines) {
      const rep = line[0];
      const lineCenterY = (rep.domTop + rep.domBottom) / 2;
      const charCenterY = (char.domTop + char.domBottom) / 2;
      const threshold = Math.max(rep.fontSize, char.fontSize) * 0.75;

      if (Math.abs(lineCenterY - charCenterY) < threshold) {
        line.push(char);
        placed = true;
        break;
      }
    }

    if (!placed) {
      lines.push([char]);
    }
  }

  const rects: HighlightRect[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let maxFontSize = 0;
    let sumBaseline = 0;

    for (const char of line) {
      minX = Math.min(minX, char.domLeft);
      maxX = Math.max(maxX, char.domRight);
      minY = Math.min(minY, char.domTop);
      maxY = Math.max(maxY, char.domBottom);
      maxFontSize = Math.max(maxFontSize, char.fontSize);
      sumBaseline += char.domBaseline;
    }

    const avgBaseline = sumBaseline / line.length;
    const top = Math.max(0, avgBaseline - maxFontSize * 0.85);
    const height = Math.max(maxFontSize * 1.15, maxY - minY);
    const width = Math.max(0, maxX - minX);

    if (width > 0 && height > 0) {
      rects.push({
        x: minX,
        y: top,
        width,
        height,
      });
    }
  }

  return rects;
}
