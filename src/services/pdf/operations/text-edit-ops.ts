import type { PdfiumEngine } from '../../../core/pdfium-engine';
import { FontCharsetIndex, extractBaseFontFamily } from '../font-charset-index';
import { isColorEqual, parseColor, isControlOrUnidentified, isZeroWidthOrInvisible } from '../utils';
import type { ColorRgba, EditableTextSpan, TextMutationOptions, StandardFontName, PageCharacter, HighlightRect, TextWord, TextLine, PdfMatrix } from '../../../core/types';
import {
  encodeUtf16Le,
  setPageObjectMatrix,
  translationMatrix,
  mapStandardFontName,
  calculateTextWidth,
  removeTextObjectsInBounds,
  removeTextObjectsInRects,
  setTextObjectInBounds,
  findTextObjectIndicesForSpan,
  findPageFontHandle,
  removeTextObjectsByIndex,
  setTextObjectByIndex,
  getPageObjectMatrix,
  getPageCropInfo,
  pdfBoxToDomBounds,
  pdfToDomCoords,
} from '../../../core/pdfium-helpers';

import { detectParagraphs, normalizeAngleDeg, getCardinalRotation, isVerticalRotation } from './paragraph-detector';
import { reflowAndReplaceParagraph, wrapTextToWidth } from './paragraph-reflow';

/**
 * Analyses the text stream of a page to group characters into semantic multi-line paragraphs and blocks.
 * Uses deterministic multi-pass spatial analysis (baselines, font sizes, leading, column overlap).
 * @param engine The PDFium engine instance.
 * @param pageIndex The zero-based index of the page.
 * @param pageHandle The active page handle.
 * @returns An array of clustered, editable paragraph text spans.
 */
export function extractEditableSpans(
  engine: PdfiumEngine,
  pageIndex: number,
  pageHandle: number
): EditableTextSpan[] {
  return detectParagraphs(engine, pageIndex, pageHandle);
}

/**
 * Temporarily hides a text span by replacing its string with a space.
 * Uses centre-containment matching to identify only the span's own
 * objects, preserving neighbouring text in crowded layouts.
 */
export function hideTextSpan(
  engine: PdfiumEngine,
  pageHandle: number,
  targetSpan: EditableTextSpan
): void {
  const mod = engine.getModule();
  const targetLines: Array<{
    left: number;
    baselineY: number;
    width: number;
    fontSize: number;
    hasBulletPrefix?: boolean;
    bulletWord?: TextWord;
  }> = targetSpan.lines && targetSpan.lines.length > 0
    ? targetSpan.lines
    : [{
        left: targetSpan.left,
        baselineY: targetSpan.baselineY,
        width: targetSpan.width,
        fontSize: targetSpan.fontSize,
        hasBulletPrefix: targetSpan.hasBulletPrefix,
        bulletWord: targetSpan.bulletWord,
      }];

  let modified = false;
  for (const line of targetLines) {
    const objectIndices = findTextObjectIndicesForSpan(
      engine, mod, pageHandle,
      line.left, line.baselineY, line.width, line.fontSize
    );

    if (objectIndices.length === 0) {
      const didSet = setTextObjectInBounds(
        engine, mod, pageHandle,
        line.left, line.baselineY, line.width, line.fontSize, ' '
      );
      if (didSet) {
        modified = true;
      }
    } else {
      for (const idx of objectIndices) {
        if (setTextObjectByIndex(engine, mod, pageHandle, idx, ' ')) {
          modified = true;
        }
      }
    }
  }

  if (modified) {
    mod.FPDFPage_GenerateContent(pageHandle);
  }
}

/**
 * Replaces or mutates a specific text block on the page.
 *
 * Uses centre-containment matching to identify the exact page objects
 * backing the target span, preventing collateral damage to neighbouring
 * text. Falls back to spatial matching only when precise matching fails.
 *
 * When a FontCharsetIndex is provided, uses the document-wide character
 * set for O(1) font availability checks instead of per-edit page extraction.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @param pageIndex The zero-based index of the page.
 * @param pageHandle The active page handle.
 * @param targetSpan The original text span data.
 * @param options The new text value and formatting options.
 * @param charsetIndex Optional document-wide font charset index.
 */
export function replaceTextSpan(
  engine: PdfiumEngine,
  docHandle: number,
  pageIndex: number,
  pageHandle: number,
  targetSpan: EditableTextSpan,
  options: TextMutationOptions,
  charsetIndex?: FontCharsetIndex
): void {
  const rawFontName = options.fontFamily || targetSpan.fontFamily || 'Helvetica';
  const updatedFontSize = options.fontSize !== undefined ? options.fontSize : targetSpan.fontSize;
  const standardFontName: StandardFontName = mapStandardFontName(
    rawFontName,
    options.fontWeight || targetSpan.fontWeight,
    options.fontStyle || targetSpan.fontStyle
  );
  const updatedText = options.text !== undefined ? options.text : targetSpan.text;
  const isDeletion = updatedText.trim().length === 0;

  const isExplicitMultiLine =
    (targetSpan.lines && targetSpan.lines.length > 1) ||
    (options.text !== undefined && options.text.includes('\n')) ||
    Boolean(targetSpan.hasBulletPrefix && targetSpan.bulletWord);

  // Test if single line text wraps into multiple lines when fitted to column/page width
  let isWrappedMultiLine = false;
  if (!isExplicitMultiLine && !isDeletion) {
    const mod = engine.getModule();
    const pageWidth = mod.FPDF_GetPageWidthF(pageHandle);
    const maxAvailableWidth = Math.max(targetSpan.width, Math.min(pageWidth - targetSpan.left - 36, 500));
    const testLines = wrapTextToWidth(updatedText, targetSpan.width, updatedFontSize, standardFontName);
    if (testLines.length > 1 && calculateTextWidth(updatedText, updatedFontSize, standardFontName) > maxAvailableWidth) {
      isWrappedMultiLine = true;
    }
  }

  // If targetSpan is a multi-line paragraph, newlines were added, or text wraps, use paragraph reflow engine.
  // Single-line text edits without line breaks use the precise single-line replacement path.
  const shouldReflow =
    isExplicitMultiLine ||
    isWrappedMultiLine ||
    (options.reflowParagraph === true &&
      Boolean(targetSpan.isParagraph || (targetSpan.lines && targetSpan.lines.length > 1) || (options.text !== undefined && options.text.includes('\n'))));

  if (shouldReflow) {
    reflowAndReplaceParagraph(engine, docHandle, pageIndex, pageHandle, targetSpan, options, charsetIndex);
    return;
  }

  const mod = engine.getModule();
  const updatedColor: ColorRgba = options.color || targetSpan.color;
  const targetLeft = options.left !== undefined ? options.left : targetSpan.left;

  const calculatedNewWidth = isDeletion
    ? 0
    : calculateTextWidth(updatedText, updatedFontSize, standardFontName);

  // Identify the exact page objects that back this span
  const targetObjectIndices = findTextObjectIndicesForSpan(
    engine, mod, pageHandle,
    targetSpan.left, targetSpan.baselineY, targetSpan.width, targetSpan.fontSize
  );

  let fontHandle = 0;

  try {
    const heightPts = mod.FPDF_GetPageHeightF(pageHandle);

    // Find subsequent spans for potential reflow before any mutation
    const pageSpans = extractEditableSpans(engine, pageIndex, pageHandle);
    const lineSubsequentSpans = pageSpans
      .filter(
        (s) =>
          s.id !== targetSpan.id &&
          Math.abs(s.baselineY - targetSpan.baselineY) < 6.0 &&
          s.left > targetSpan.left + 5.0
      )
      .sort((a, b) => a.left - b.left);

    const deltaX = calculatedNewWidth - targetSpan.width;
    const needsReflow = Math.abs(deltaX) > 0.5 && lineSubsequentSpans.length > 0;

    // In-place edit path (preserves original embedded font subset)
    // Only safe if font is unchanged and no trailing spans on the line need shifting
    const isOnlyTextChanged = 
      (options.fontSize === undefined || Math.abs(options.fontSize - targetSpan.fontSize) < 0.1) &&
      (options.fontFamily === undefined ||
        options.fontFamily === targetSpan.fontFamily ||
        extractBaseFontFamily(options.fontFamily) === extractBaseFontFamily(targetSpan.rawFontFamily)) &&
      (options.color === undefined || isColorEqual(options.color, targetSpan.color)) &&
      (!options.fontWeight || options.fontWeight === (targetSpan.fontWeight || 'normal')) &&
      (!options.fontStyle || options.fontStyle === (targetSpan.fontStyle || 'normal'));

    if (!isDeletion && isOnlyTextChanged && !needsReflow && targetObjectIndices.length > 0) {
      let charsAvailable = false;

      if (charsetIndex) {
        charsAvailable = charsetIndex.hasAllChars(updatedText, targetSpan.rawFontFamily, targetSpan.text);
      } else {
        const nonWs = Array.from(updatedText).filter((c) => c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r');
        charsAvailable = nonWs.every((char) => targetSpan.text.includes(char));
      }

      if (charsAvailable && !options.backgroundColor) {
        // targetObjectIndices are already sorted geometrically (left-to-right)
        const canEditInPlace = setTextObjectByIndex(
          engine, mod, pageHandle, targetObjectIndices[0], updatedText
        );

        if (canEditInPlace) {
          // Blank remaining owning objects only (not neighbours)
          for (let k = 1; k < targetObjectIndices.length; k++) {
            setTextObjectByIndex(engine, mod, pageHandle, targetObjectIndices[k], ' ');
          }
          mod.FPDFPage_GenerateContent(pageHandle);
          return;
        }
      }
    }

    // Fallback: remove owning objects and recreate with standard font

    // Collect ALL object indices to remove in one pass (target + reflowed)
    const allIndicesToRemove = new Set<number>();
    for (const idx of targetObjectIndices) {
      allIndicesToRemove.add(idx);
    }

    // Do not remove lineSubsequentSpans; they will be shifted in place.

    // Remove all targeted objects in a single batch
    if (allIndicesToRemove.size > 0) {
      removeTextObjectsByIndex(mod, pageHandle, Array.from(allIndicesToRemove));
    } else {
      // Fallback: spatial removal when precise matching found nothing
      removeTextObjectsInBounds(
        engine, mod, pageHandle,
        targetSpan.left, targetSpan.baselineY,
        targetSpan.width, updatedFontSize
      );
    }

    const cropInfo = getPageCropInfo(engine, mod, pageHandle);
    const pdfTargetLeft = targetLeft + cropInfo.cropLeft;

    // Compute adjusted baseline for the replacement object
    let targetBaselineY = targetSpan.baselineY;
    if (options.top !== undefined) {
      targetBaselineY = heightPts - options.top - updatedFontSize * 0.15 + cropInfo.cropBottom;
    } else if (updatedFontSize !== targetSpan.fontSize) {
      const sizeDiff = updatedFontSize - targetSpan.fontSize;
      targetBaselineY = Math.max(0, targetSpan.baselineY - sizeDiff * 0.1);
    }

    // Insert the replacement text object
    let insertedObjHandle: number | null = null;
    if (!isDeletion) {
      if (options.backgroundColor) {
        const bgCol = parseColor(options.backgroundColor);
        if (bgCol.a > 0) {
          const rectW = calculatedNewWidth || targetSpan.width;
          const rectH = updatedFontSize * 1.25;
          const rectBottom = Math.max(0, targetBaselineY - updatedFontSize * 0.25);
          const bgRect = mod.FPDFPageObj_CreateNewRect(pdfTargetLeft, rectBottom, rectW, rectH);
          if (bgRect) {
            mod.FPDFPageObj_SetFillColor(bgRect, bgCol.r, bgCol.g, bgCol.b, bgCol.a);
            mod.FPDFPath_SetDrawMode(bgRect, 1, false);
            mod.FPDFPage_InsertObject(pageHandle, bgRect);
          }
        }
      }

      fontHandle = mod.FPDFText_LoadStandardFont(docHandle, standardFontName);
      if (!fontHandle) fontHandle = mod.FPDFText_LoadStandardFont(docHandle, 'Helvetica');

      const textBuf = encodeUtf16Le(engine, updatedText);

      try {
        const textObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, fontHandle, updatedFontSize);
        if (textObjHandle) {
          mod.FPDFText_SetText(textObjHandle, textBuf.ptr);
          mod.FPDFPageObj_SetFillColor(textObjHandle, updatedColor.r, updatedColor.g, updatedColor.b, updatedColor.a);
          
          setPageObjectMatrix(engine, mod, textObjHandle, translationMatrix(pdfTargetLeft, targetBaselineY));
          mod.FPDFPage_InsertObject(pageHandle, textObjHandle);
          insertedObjHandle = textObjHandle;
        }
      } finally {
        textBuf.dispose();
      }
    }

    // Shift subsequent spans horizontally (in-place)
    if (needsReflow) {
      const handlesToShift = new Set<number>();
      for (const subSpan of lineSubsequentSpans) {
        const subIndices = findTextObjectIndicesForSpan(
          engine, mod, pageHandle,
          subSpan.left, subSpan.baselineY, subSpan.width, subSpan.fontSize
        );
        for (const idx of subIndices) {
          const objHandle = mod.FPDFPage_GetObject(pageHandle, idx);
          if (objHandle && objHandle !== insertedObjHandle) {
            handlesToShift.add(objHandle);
          }
        }
      }

      for (const objHandle of handlesToShift) {
        const currentMatrix = getPageObjectMatrix(engine, mod, objHandle);
        if (currentMatrix) {
          currentMatrix.e += deltaX;
          setPageObjectMatrix(engine, mod, objHandle, currentMatrix);
        }
      }
    }

    mod.FPDFPage_GenerateContent(pageHandle);
  } finally {
    // Standard fonts should not be closed
  }
}



/**
 * Completely remove an identified text span from the page content stream.
 * Uses centre-containment matching to identify only the span's own objects,
 * preventing collateral removal of neighbouring text in crowded regions.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @param pageIndex The zero-based index of the page.
 * @param pageHandle The active page handle.
 * @param targetSpan The exact dimensions and location of the text to destroy.
 */
export function deleteTextSpan(
  engine: PdfiumEngine,
  docHandle: number,
  pageIndex: number,
  pageHandle: number,
  targetSpan: EditableTextSpan
): void {
  // When deleting a paragraph, reflow with empty string to automatically shift downstream lines up
  if (targetSpan.isParagraph || (targetSpan.lines && targetSpan.lines.length > 0)) {
    reflowAndReplaceParagraph(engine, docHandle, pageIndex, pageHandle, targetSpan, { text: '' });
    return;
  }

  const mod = engine.getModule();
  const objectIndices = findTextObjectIndicesForSpan(
    engine,
    mod,
    pageHandle,
    targetSpan.left,
    targetSpan.baselineY,
    targetSpan.width,
    targetSpan.fontSize
  );

  if (objectIndices.length > 0) {
    removeTextObjectsByIndex(mod, pageHandle, objectIndices);
  } else {
    removeTextObjectsInBounds(
      engine,
      mod,
      pageHandle,
      targetSpan.left,
      targetSpan.baselineY,
      targetSpan.width,
      targetSpan.fontSize
    );
  }
  mod.FPDFPage_GenerateContent(pageHandle);
}

/**
 * Update a text span with a new transformation matrix and text value.
 * Used for retaining original font subset when burning canvas edits.
 * Targets only the span's backing text objects to avoid affecting surrounding text.
 *
 * @param engine The PDFium engine instance.
 * @param pageHandle The active page handle.
 * @param targetSpan The exact dimensions and location of the target text span.
 * @param newText The updated text content.
 * @param matrix The new transformation matrix.
 * @return True if at least one object was updated.
 */
export function updateTextSpanTransform(
  engine: PdfiumEngine,
  pageHandle: number,
  targetSpan: EditableTextSpan,
  newText: string,
  matrix: PdfMatrix
): boolean {
  const mod = engine.getModule();
  const objectIndices = findTextObjectIndicesForSpan(
    engine,
    mod,
    pageHandle,
    targetSpan.left,
    targetSpan.baselineY,
    targetSpan.width,
    targetSpan.fontSize
  );

  if (objectIndices.length === 0) {
    const didSet = setTextObjectInBounds(
      engine,
      mod,
      pageHandle,
      targetSpan.left,
      targetSpan.baselineY,
      targetSpan.width,
      targetSpan.fontSize,
      newText,
      matrix
    );
    if (didSet) {
      mod.FPDFPage_GenerateContent(pageHandle);
    }
    return didSet;
  }

  const didSet = setTextObjectByIndex(
    engine,
    mod,
    pageHandle,
    objectIndices[0],
    newText,
    matrix
  );

  if (didSet) {
    for (let k = 1; k < objectIndices.length; k++) {
      setTextObjectByIndex(engine, mod, pageHandle, objectIndices[k], ' ');
    }
    mod.FPDFPage_GenerateContent(pageHandle);
  }
  return didSet;
}

/**
 * Extracts all individual character metrics and bounding boxes from a page.
 *
 * @param engine The PDFium engine instance.
 * @param pageIndex Zero-based page index.
 * @param pageHandle The active page handle.
 * @return An array of PageCharacter objects representing all glyphs on the page.
 */
export function extractPageCharacters(
  engine: PdfiumEngine,
  _pageIndex: number,
  pageHandle: number
): PageCharacter[] {
  const mod = engine.getModule();
  const characters: PageCharacter[] = [];

  let textPageHandle = 0;
  try {
    textPageHandle = mod.FPDFText_LoadPage(pageHandle);
    if (!textPageHandle) return [];

    const totalChars = mod.FPDFText_CountChars(textPageHandle);
    if (totalChars <= 0) return [];

    const heightPts = mod.FPDF_GetPageHeightF(pageHandle);
    const cropInfo = getPageCropInfo(engine, mod, pageHandle);

    const leftPtr = engine.allocateMemory(8);
    const topPtr = engine.allocateMemory(8);
    const rightPtr = engine.allocateMemory(8);
    const bottomPtr = engine.allocateMemory(8);
    const xPtr = engine.allocateMemory(8);
    const yPtr = engine.allocateMemory(8);

    try {
      for (let i = 0; i < totalChars; i++) {
        const charCode = mod.FPDFText_GetUnicode(textPageHandle, i);
        if (charCode === 0 || isControlOrUnidentified(charCode)) continue;

        const charStr = String.fromCodePoint(charCode);
        const fontSize = mod.FPDFText_GetFontSize(textPageHandle, i) || 12;

        mod.FPDFText_GetCharBox(textPageHandle, i, leftPtr, rightPtr, bottomPtr, topPtr);
        mod.FPDFText_GetCharOrigin(textPageHandle, i, xPtr, yPtr);

        const angleRad =
          typeof mod.FPDFText_GetCharAngle === 'function'
            ? mod.FPDFText_GetCharAngle(textPageHandle, i)
            : 0;
        const angleDeg = normalizeAngleDeg(angleRad);
        const rotation = getCardinalRotation(angleDeg);
        const isVertical = isVerticalRotation(rotation);

        const heapF64 = mod.pdfium.HEAPF64;
        const left = heapF64[leftPtr >> 3] || 0;
        const top = heapF64[topPtr >> 3] || 0;
        let right = heapF64[rightPtr >> 3] || 0;
        const bottom = heapF64[bottomPtr >> 3] || 0;
        const originX = heapF64[xPtr >> 3] || 0;
        const originY = heapF64[yPtr >> 3] || 0;

        const isNewline = charStr === '\n' || charStr === '\r';
        if (isNewline) continue;

        if (right <= left) {
          if (isZeroWidthOrInvisible(charCode)) {
            right = left;
          } else {
            right = left + fontSize * 0.28;
          }
        }

        let domTop: number;
        let domBottom: number;
        let domLeft: number;
        let domRight: number;
        let domBaseline: number;

        if (cropInfo.rotation !== 0) {
          const bounds = pdfBoxToDomBounds(left, bottom, right, top, cropInfo);
          const origin = pdfToDomCoords(originX, originY, cropInfo);
          domLeft = bounds.left;
          domRight = bounds.right;
          domTop = bounds.top;
          domBottom = bounds.bottom;
          domBaseline = origin.y;
        } else if (isVertical) {
          domTop = Math.max(0, heightPts - (Math.max(top, bottom) - cropInfo.cropBottom));
          domBottom = Math.max(0, heightPts - (Math.min(top, bottom) - cropInfo.cropBottom));
          domLeft = Math.min(left, right) - cropInfo.cropLeft;
          domRight = Math.max(left, right) - cropInfo.cropLeft;
          domBaseline = originX - cropInfo.cropLeft;
        } else {
          domBaseline = heightPts - (originY - cropInfo.cropBottom);
          domLeft = Math.min(left, right) - cropInfo.cropLeft;
          domRight = Math.max(left, right) - cropInfo.cropLeft;
          domTop = Math.max(0, heightPts - (Math.max(top, bottom) - cropInfo.cropBottom));
          domBottom = Math.max(0, heightPts - (Math.min(top, bottom) - cropInfo.cropBottom));

          if (domBottom <= domTop) {
            domTop = Math.max(0, domBaseline - fontSize * 0.85);
            domBottom = domBaseline + fontSize * 0.25;
          }
        }

        characters.push({
          charIndex: i,
          unicode: charStr,
          fontSize,
          left,
          top,
          right,
          bottom,
          originX,
          originY,
          domLeft,
          domTop,
          domRight,
          domBottom,
          domBaseline,
          angle: angleDeg,
          rotation,
          isVertical,
          orientation: isVertical ? 'vertical' : 'horizontal',
        });
      }
    } finally {
      engine.freeMemory(leftPtr);
      engine.freeMemory(topPtr);
      engine.freeMemory(rightPtr);
      engine.freeMemory(bottomPtr);
      engine.freeMemory(xPtr);
      engine.freeMemory(yPtr);
    }
  } finally {
    if (textPageHandle) {
      mod.FPDFText_ClosePage(textPageHandle);
    }
  }

  return characters;
}

/**
 * Computes bounding rectangles for highlighting a range of characters.
 * Groups characters by text line and returns rectangular regions.
 *
 * @param characters The array of all page characters.
 * @param startIndex The starting character index (inclusive).
 * @param endIndex The ending character index (inclusive).
 * @return An array of HighlightRect objects, one for each line in the range.
 */
export function calculateHighlightRects(
  characters: PageCharacter[],
  startIndex: number,
  endIndex: number
): HighlightRect[] {
  if (characters.length === 0) return [];

  const minIndex = Math.min(startIndex, endIndex);
  const maxIndex = Math.max(startIndex, endIndex);

  // Filter characters in the range
  const selectedChars = characters.filter(
    (c) => c.charIndex >= minIndex && c.charIndex <= maxIndex
  );

  if (selectedChars.length === 0) return [];

  // Group characters by line and orientation
  const lines: PageCharacter[][] = [];
  let currentLine: PageCharacter[] = [];

  for (let i = 0; i < selectedChars.length; i++) {
    const char = selectedChars[i];
    if (currentLine.length === 0) {
      currentLine.push(char);
      continue;
    }

    const prevChar = currentLine[currentLine.length - 1];
    const isRotChanged = char.rotation !== prevChar.rotation || char.isVertical !== prevChar.isVertical;

    if (isRotChanged) {
      lines.push(currentLine);
      currentLine = [char];
      continue;
    }

    if (char.isVertical) {
      const xDiff = Math.abs(char.domLeft - prevChar.domLeft);
      const verticalGap = Math.abs(char.domTop - prevChar.domBottom);

      if (xDiff > 4.0 || verticalGap > char.fontSize * 1.5) {
        lines.push(currentLine);
        currentLine = [char];
      } else {
        currentLine.push(char);
      }
    } else {
      const baselineDiff = Math.abs(char.domBaseline - prevChar.domBaseline);
      const topDiff = Math.abs(char.domTop - prevChar.domTop);

      if (baselineDiff > 4.0 || topDiff > 6.0) {
        lines.push(currentLine);
        currentLine = [char];
      } else {
        currentLine.push(char);
      }
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  // Create bounding box for each line
  const rects: HighlightRect[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;

    const firstChar = line[0];
    const isVert = firstChar.isVertical || firstChar.rotation === 90 || firstChar.rotation === 270;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let maxFontSize = 0;
    let sumBaseline = 0;

    for (const c of line) {
      if (c.domLeft < minX) minX = c.domLeft;
      if (c.domRight > maxX) maxX = c.domRight;
      if (c.domTop < minY) minY = c.domTop;
      if (c.domBottom > maxY) maxY = c.domBottom;
      if (c.fontSize > maxFontSize) maxFontSize = c.fontSize;
      sumBaseline += c.domBaseline;
    }

    if (isVert) {
      const width = Math.max(maxFontSize * 1.15, maxX - minX);
      const height = Math.max(0, maxY - minY);
      if (width > 0 && height > 0) {
        rects.push({
          x: minX,
          y: minY,
          width,
          height,
        });
      }
    } else {
      const avgBaseline = sumBaseline / line.length;
      const top = Math.max(0, avgBaseline - maxFontSize * 0.85);
      const height = maxFontSize * 1.15;
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
  }

  return rects;
}

/**
 * Finds a character at or near the given DOM page coordinates.
 *
 * @param characters The array of all page characters.
 * @param x Horizontal page coordinate.
 * @param y Vertical page coordinate.
 * @param toleranceX Horizontal tolerance padding.
 * @param toleranceY Vertical tolerance padding.
 * @return The matched PageCharacter or null if no character is near.
 */
export function findCharacterAt(
  characters: PageCharacter[],
  x: number,
  y: number,
  toleranceX: number = 4,
  toleranceY: number = 4
): PageCharacter | null {
  if (characters.length === 0) return null;

  let bestMatch: PageCharacter | null = null;
  let minDistanceSq = Infinity;

  for (const c of characters) {
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

  return bestMatch;
}

/**
 * Finds the character closest to the given coordinates during drag selection.
 * First selects the closest text line, then finds the closest character on that line.
 *
 * @param characters The array of all page characters.
 * @param x Horizontal page coordinate.
 * @param y Vertical page coordinate.
 * @return The closest PageCharacter or null if characters list is empty.
 */
export function findClosestCharacter(
  characters: PageCharacter[],
  x: number,
  y: number
): PageCharacter | null {
  if (characters.length === 0) return null;

  let closestChar: PageCharacter | null = null;
  let minDistanceSq = Infinity;

  for (const c of characters) {
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
 * Completely wipes or removes images and vector paths that fall within or intersect the specified DOM rectangles.
 * Fully enclosed objects are permanently deleted from the page content stream.
 * Partially covered images have their pixel data in the intersecting region wiped with solid black.
 *
 * @param engine The PDFium engine instance.
 * @param pageHandle Handle to the active page.
 * @param rects Array of bounding rectangles in DOM coordinates.
 * @returns True if any objects or bitmaps were modified.
 */
export function wipeImagesInRects(
  engine: PdfiumEngine,
  pageHandle: number,
  rects: HighlightRect[]
): boolean {
  if (rects.length === 0) return false;
  const mod = engine.getModule();
  if (typeof mod.FPDFPage_CountObjects !== 'function' || typeof mod.FPDFPage_GetObject !== 'function') {
    return false;
  }

  const objectCount = mod.FPDFPage_CountObjects(pageHandle);
  if (objectCount === 0) return false;

  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const { leftPtr, bottomPtr, rightPtr, topPtr } = engine.getBoundsScratchBuffer();
  const objectsToRemove: number[] = [];
  let modified = false;

  for (let i = objectCount - 1; i >= 0; i--) {
    const objHandle = mod.FPDFPage_GetObject(pageHandle, i);
    if (!objHandle) continue;

    const objType = typeof mod.FPDFPageObj_GetType === 'function' ? mod.FPDFPageObj_GetType(objHandle) : 0;
    if (objType !== 3 && objType !== 2) continue;

    const ok = typeof mod.FPDFPageObj_GetBounds === 'function'
      ? mod.FPDFPageObj_GetBounds(objHandle, leftPtr, bottomPtr, rightPtr, topPtr)
      : false;
    if (!ok) continue;

    const heapF32 = mod.pdfium.HEAPF32;
    const objLeft = heapF32[leftPtr >> 2];
    const objBottom = heapF32[bottomPtr >> 2];
    const objRight = heapF32[rightPtr >> 2];
    const objTop = heapF32[topPtr >> 2];

    const domBounds = pdfBoxToDomBounds(objLeft, objBottom, objRight, objTop, cropInfo);
    const objW = domBounds.right - domBounds.left;
    const objH = domBounds.bottom - domBounds.top;
    if (objW <= 0 || objH <= 0) continue;

    const isFullyEnclosed = rects.some((r) =>
      domBounds.left >= r.x - 1 &&
      domBounds.right <= r.x + r.width + 1 &&
      domBounds.top >= r.y - 1 &&
      domBounds.bottom <= r.y + r.height + 1
    );

    if (isFullyEnclosed) {
      objectsToRemove.push(i);
      modified = true;
      continue;
    }

    if (objType === 3) {
      const intersectingRects = rects.filter((r) => {
        const ox0 = Math.max(domBounds.left, r.x);
        const ox1 = Math.min(domBounds.right, r.x + r.width);
        const oy0 = Math.max(domBounds.top, r.y);
        const oy1 = Math.min(domBounds.bottom, r.y + r.height);
        return ox0 < ox1 && oy0 < oy1;
      });

      if (intersectingRects.length > 0 && typeof mod.FPDFImageObj_GetBitmap === 'function' && typeof mod.FPDFImageObj_SetBitmap === 'function') {
        const bitmap = mod.FPDFImageObj_GetBitmap(objHandle);
        if (bitmap) {
          try {
            const bmpWidth = typeof mod.FPDFBitmap_GetWidth === 'function' ? mod.FPDFBitmap_GetWidth(bitmap) : 0;
            const bmpHeight = typeof mod.FPDFBitmap_GetHeight === 'function' ? mod.FPDFBitmap_GetHeight(bitmap) : 0;
            const stride = typeof mod.FPDFBitmap_GetStride === 'function' ? mod.FPDFBitmap_GetStride(bitmap) : 0;
            const bufferPtr = typeof mod.FPDFBitmap_GetBuffer === 'function' ? mod.FPDFBitmap_GetBuffer(bitmap) : 0;

            if (bmpWidth > 0 && bmpHeight > 0) {
              let didWipePixels = false;
              for (const r of intersectingRects) {
                const ox0 = Math.max(domBounds.left, r.x);
                const ox1 = Math.min(domBounds.right, r.x + r.width);
                const oy0 = Math.max(domBounds.top, r.y);
                const oy1 = Math.min(domBounds.bottom, r.y + r.height);

                let u0 = (ox0 - domBounds.left) / objW;
                let u1 = (ox1 - domBounds.left) / objW;
                let v0 = (oy0 - domBounds.top) / objH;
                let v1 = (oy1 - domBounds.top) / objH;

                if (cropInfo.rotation === 1) {
                  // 90 degrees clockwise rotation
                  const nu0 = v0;
                  const nu1 = v1;
                  const nv0 = 1 - u1;
                  const nv1 = 1 - u0;
                  u0 = nu0; u1 = nu1; v0 = nv0; v1 = nv1;
                } else if (cropInfo.rotation === 2) {
                  // 180 degrees rotation
                  const nu0 = 1 - u1;
                  const nu1 = 1 - u0;
                  const nv0 = 1 - v1;
                  const nv1 = 1 - v0;
                  u0 = nu0; u1 = nu1; v0 = nv0; v1 = nv1;
                } else if (cropInfo.rotation === 3) {
                  // 270 degrees clockwise rotation
                  const nu0 = 1 - v1;
                  const nu1 = 1 - v0;
                  const nv0 = u0;
                  const nv1 = u1;
                  u0 = nu0; u1 = nu1; v0 = nv0; v1 = nv1;
                }

                const px = Math.max(0, Math.floor(Math.min(u0, u1) * bmpWidth));
                const py = Math.max(0, Math.floor(Math.min(v0, v1) * bmpHeight));
                const pw = Math.min(bmpWidth - px, Math.ceil(Math.abs(u1 - u0) * bmpWidth));
                const ph = Math.min(bmpHeight - py, Math.ceil(Math.abs(v1 - v0) * bmpHeight));

                if (pw > 0 && ph > 0) {
                  let filledWithApi = false;
                  if (typeof mod.FPDFBitmap_FillRect === 'function') {
                    const fillOk = mod.FPDFBitmap_FillRect(bitmap, px, py, pw, ph, 0xFF000000);
                    if (fillOk !== false) {
                      filledWithApi = true;
                      didWipePixels = true;
                    }
                  }
                  if (!filledWithApi && bufferPtr && stride > 0) {
                    const format = typeof mod.FPDFBitmap_GetFormat === 'function'
                      ? mod.FPDFBitmap_GetFormat(bitmap)
                      : 0;
                    const bpp = (format === 4 || format === 3)
                      ? 4
                      : (format === 2 ? 3 : (format === 1 ? 1 : Math.max(1, Math.round(stride / bmpWidth))));
                    const heapU8 = mod.pdfium.HEAPU8;
                    for (let row = py; row < py + ph; row++) {
                      const rowStart = bufferPtr + row * stride + px * bpp;
                      const rowEnd = rowStart + pw * bpp;
                      if (rowStart >= 0 && rowEnd <= heapU8.length) {
                        for (let byteIdx = rowStart; byteIdx < rowEnd; byteIdx++) {
                          const channel = (byteIdx - rowStart) % bpp;
                          heapU8[byteIdx] = (bpp === 4 && channel === 3) ? 255 : 0;
                        }
                        didWipePixels = true;
                      }
                    }
                  }
                }
              }

              if (didWipePixels) {
                const setOk = mod.FPDFImageObj_SetBitmap(0, 0, objHandle, bitmap);
                if (setOk) {
                  modified = true;
                }
              }
            }
          } finally {
            if (typeof mod.FPDFBitmap_Destroy === 'function') {
              mod.FPDFBitmap_Destroy(bitmap);
            }
          }
        }
      }
    }
  }

  if (objectsToRemove.length > 0) {
    removeTextObjectsByIndex(mod, pageHandle, objectsToRemove);
    modified = true;
  }

  if (modified) {
    mod.FPDFPage_GenerateContent(pageHandle);
  }

  return modified;
}

interface SurvivingSegment {
  text: string;
  originX: number;
  originY: number;
  fontSize: number;
  startCharIndex: number;
}

interface LineCharToken {
  charData: PageCharacter;
  hasPrecedingSpace: boolean;
}

function extractLineCharTokens(
  line: Partial<TextLine> & {
    left: number;
    baselineY: number;
    width: number;
    fontSize: number;
    text?: string;
    charStartIndex?: number;
    words?: TextWord[];
  },
  charMap: Map<number, PageCharacter>,
  allCharacters: PageCharacter[]
): LineCharToken[] {
  const tokens: LineCharToken[] = [];

  if (line.words && line.words.length > 0) {
    for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
      const word = line.words[wIdx];
      const prevWord = wIdx > 0 ? line.words[wIdx - 1] : null;
      const hasSpace = prevWord
        ? Boolean(word.hasPrecedingSpace) || (word.left - prevWord.right) >= Math.min(prevWord.fontSize, word.fontSize) * 0.18
        : false;

      for (let k = 0; k < word.charCount; k++) {
        const cIdx = word.charStartIndex + k;
        const charData = charMap.get(cIdx);
        if (charData) {
          tokens.push({
            charData,
            hasPrecedingSpace: k === 0 ? hasSpace : false,
          });
        }
      }
    }
  }

  if (tokens.length === 0) {
    const matched = allCharacters.filter(
      (c) =>
        Math.abs(c.originY - line.baselineY) < 1.5 &&
        c.left >= line.left - 2.5 &&
        c.right <= line.left + line.width + 2.5
    );
    matched.sort((a, b) => a.originX - b.originX);

    for (let i = 0; i < matched.length; i++) {
      const c = matched[i];
      const prev = i > 0 ? matched[i - 1] : null;
      const hasSpace = prev ? (c.left - prev.right) >= Math.min(prev.fontSize, c.fontSize) * 0.18 : false;
      tokens.push({
        charData: c,
        hasPrecedingSpace: hasSpace,
      });
    }
  }

  return tokens;
}

function partitionSurvivingSegments(
  tokens: LineCharToken[],
  isRedacted: (charIndex: number) => boolean,
  handledCharIndices: Set<number>
): { survivingSegments: SurvivingSegment[]; lineHasRedacted: boolean } {
  const survivingSegments: SurvivingSegment[] = [];
  let currentSeg: SurvivingSegment | null = null;
  let lineHasRedacted = false;

  for (const token of tokens) {
    const isCharRedacted = isRedacted(token.charData.charIndex);
    if (isCharRedacted) {
      lineHasRedacted = true;
      handledCharIndices.add(token.charData.charIndex);
      if (currentSeg) {
        currentSeg.text = currentSeg.text.trimEnd();
        if (currentSeg.text.length > 0) {
          survivingSegments.push(currentSeg);
        }
        currentSeg = null;
      }
    } else {
      if (!currentSeg) {
        if (token.charData.unicode.trim().length === 0) {
          continue;
        }
        currentSeg = {
          text: token.charData.unicode,
          originX: token.charData.originX,
          originY: token.charData.originY,
          fontSize: token.charData.fontSize,
          startCharIndex: token.charData.charIndex,
        };
      } else {
        if (token.hasPrecedingSpace) {
          currentSeg.text += ' ';
        }
        currentSeg.text += token.charData.unicode;
      }
    }
  }

  if (currentSeg) {
    currentSeg.text = currentSeg.text.trimEnd();
    if (currentSeg.text.length > 0) {
      survivingSegments.push(currentSeg);
    }
  }

  return { survivingSegments, lineHasRedacted };
}

function applySegmentPartitionToLine(
  engine: PdfiumEngine,
  mod: ReturnType<PdfiumEngine['getModule']>,
  docHandle: number,
  pageHandle: number,
  line: Partial<TextLine> & {
    left: number;
    baselineY: number;
    width: number;
    fontSize: number;
    fontFamily?: string;
    rawFontFamily?: string;
    fontWeight?: string;
    fontStyle?: string;
    color?: ColorRgba;
  },
  survivingSegments: SurvivingSegment[]
): boolean {
  const objectIndices = findTextObjectIndicesForSpan(
    engine,
    mod,
    pageHandle,
    line.left,
    line.baselineY,
    line.width,
    line.fontSize
  );

  if (survivingSegments.length === 0) {
    if (objectIndices.length > 0) {
      removeTextObjectsByIndex(mod, pageHandle, objectIndices);
    } else {
      removeTextObjectsInBounds(
        engine,
        mod,
        pageHandle,
        line.left,
        line.baselineY,
        line.width,
        line.fontSize
      );
    }
    return true;
  }

  const baseObjHandle = objectIndices.length > 0
    ? mod.FPDFPage_GetObject(pageHandle, objectIndices[0])
    : 0;
  const origMatrix = baseObjHandle
    ? getPageObjectMatrix(engine, mod, baseObjHandle)
    : null;

  const countToUpdate = Math.min(survivingSegments.length, objectIndices.length);
  for (let i = 0; i < countToUpdate; i++) {
    const seg = survivingSegments[i];
    const targetObjHandle = mod.FPDFPage_GetObject(pageHandle, objectIndices[i]);
    const targetMatrix = targetObjHandle
      ? getPageObjectMatrix(engine, mod, targetObjHandle)
      : origMatrix;
    const matrix: PdfMatrix = targetMatrix
      ? { a: targetMatrix.a, b: targetMatrix.b, c: targetMatrix.c, d: targetMatrix.d, e: seg.originX, f: seg.originY }
      : translationMatrix(seg.originX, seg.originY);

    setTextObjectByIndex(engine, mod, pageHandle, objectIndices[i], seg.text, matrix);
  }

  if (objectIndices.length > survivingSegments.length) {
    const surplusIndices = objectIndices.slice(survivingSegments.length);
    removeTextObjectsByIndex(mod, pageHandle, surplusIndices);
  }

  if (survivingSegments.length > objectIndices.length) {
    let fontHandle = 0;
    if (baseObjHandle && typeof mod.FPDFTextObj_GetFont === 'function') {
      fontHandle = mod.FPDFTextObj_GetFont(baseObjHandle);
    }
    if (!fontHandle) {
      fontHandle = findPageFontHandle(engine, mod, pageHandle, line.fontFamily, line.rawFontFamily);
    }
    if (!fontHandle && docHandle) {
      const stdName = mapStandardFontName(line.fontFamily || 'Helvetica', line.fontWeight, line.fontStyle);
      fontHandle = mod.FPDFText_LoadStandardFont(docHandle, stdName);
    }
    if (!fontHandle && docHandle) {
      fontHandle = mod.FPDFText_LoadStandardFont(docHandle, 'Helvetica');
    }

    const col = line.color || { r: 0, g: 0, b: 0, a: 255 };

    if (typeof mod.FPDFPageObj_CreateTextObj === 'function' && docHandle && fontHandle) {
      for (let i = objectIndices.length; i < survivingSegments.length; i++) {
        const seg = survivingSegments[i];
        const segFontSize = seg.fontSize || line.fontSize || 12;
        const textObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, fontHandle, segFontSize);
        if (textObjHandle) {
          const textBuf = encodeUtf16Le(engine, seg.text);
          try {
            mod.FPDFText_SetText(textObjHandle, textBuf.ptr);
            if (typeof mod.FPDFPageObj_SetFillColor === 'function') {
              mod.FPDFPageObj_SetFillColor(textObjHandle, col.r, col.g, col.b, col.a);
            }
            const matrix: PdfMatrix = origMatrix
              ? { a: origMatrix.a, b: origMatrix.b, c: origMatrix.c, d: origMatrix.d, e: seg.originX, f: seg.originY }
              : translationMatrix(seg.originX, seg.originY);
            setPageObjectMatrix(engine, mod, textObjHandle, matrix);
            mod.FPDFPage_InsertObject(pageHandle, textObjHandle);
          } finally {
            textBuf.dispose();
          }
        }
      }
    }
  }

  return true;
}

/**
 * Permanently redacts only the characters within the specified DOM bounding rectangles,
 * preserving surviving prefix and suffix text at stationary origin coordinates.
 *
 * @param engine The PDFium engine instance.
 * @param _docHandle The active document handle.
 * @param pageIndex Zero-based page index.
 * @param pageHandle The active page handle.
 * @param rects Array of bounding rectangles in DOM coordinates.
 * @returns True if page content was modified.
 */
export function redactInRects(
  engine: PdfiumEngine,
  _docHandle: number,
  pageIndex: number,
  pageHandle: number,
  rects: HighlightRect[]
): boolean {
  if (rects.length === 0 || !pageHandle) return false;
  const mod = engine.getModule();
  const docHandle = _docHandle || engine.getDocumentHandle() || 0;

  const normalizedRects = rects.map((r) => ({
    x: Math.min(r.x, r.x + r.width),
    y: Math.min(r.y, r.y + r.height),
    width: Math.abs(r.width),
    height: Math.abs(r.height),
  }));

  const allCharacters = extractPageCharacters(engine, pageIndex, pageHandle);
  const redactedCharIndices = new Set<number>();
  const charMap = new Map<number, PageCharacter>();

  for (const c of allCharacters) {
    charMap.set(c.charIndex, c);
    const midX = (c.domLeft + c.domRight) / 2;
    const midY = (c.domTop + c.domBottom) / 2;

    for (const r of normalizedRects) {
      if (midX >= r.x && midX <= r.x + r.width && midY >= r.y && midY <= r.y + r.height) {
        redactedCharIndices.add(c.charIndex);
        break;
      }
    }
  }

  if (redactedCharIndices.size === 0) {
    return false;
  }

  const spans = extractEditableSpans(engine, pageIndex, pageHandle);
  let modified = false;
  const handledCharIndices = new Set<number>();
  const isRedacted = (charIndex: number): boolean => redactedCharIndices.has(charIndex);

  for (const span of spans) {
    const targetLines: Array<Partial<TextLine> & {
      left: number;
      baselineY: number;
      width: number;
      fontSize: number;
      text?: string;
      charStartIndex?: number;
      words?: TextWord[];
      fontFamily?: string;
      rawFontFamily?: string;
      fontWeight?: string;
      fontStyle?: string;
      color?: ColorRgba;
    }> = span.lines && span.lines.length > 0 ? span.lines : [{
      left: span.left,
      baselineY: span.baselineY,
      width: span.width,
      fontSize: span.fontSize,
      text: span.text,
      charStartIndex: span.charStartIndex,
      color: span.color,
      fontFamily: span.fontFamily,
      rawFontFamily: span.rawFontFamily,
      fontWeight: span.fontWeight,
      fontStyle: span.fontStyle,
    }];

    for (const line of targetLines) {
      const tokens = extractLineCharTokens(line, charMap, allCharacters);
      const { survivingSegments, lineHasRedacted } = partitionSurvivingSegments(
        tokens,
        isRedacted,
        handledCharIndices
      );

      if (!lineHasRedacted) continue;

      const lineModified = applySegmentPartitionToLine(
        engine,
        mod,
        docHandle,
        pageHandle,
        line,
        survivingSegments
      );
      if (lineModified) modified = true;
    }
  }

  const remainingChars = allCharacters.filter(
    (c) => isRedacted(c.charIndex) && !handledCharIndices.has(c.charIndex)
  );

  for (const char of remainingChars) {
    const objectIndices = findTextObjectIndicesForSpan(
      engine,
      mod,
      pageHandle,
      char.left,
      char.originY,
      Math.max(1, char.right - char.left),
      char.fontSize
    );
    if (objectIndices.length > 0) {
      removeTextObjectsByIndex(mod, pageHandle, objectIndices);
      modified = true;
    }
  }

  return modified;
}

/**
 * Permanently removes all text and wipes images within the specified DOM bounding rectangles
 * from the PDF page content stream and regenerates page content.
 *
 * Supports both full signature with docHandle and pageIndex for character-level precision
 * and legacy signature for backwards compatibility.
 *
 * @param engine The PDFium engine instance.
 * @param pageHandle Active page handle.
 * @param rects Array of bounding rectangles in DOM coordinates.
 * @returns True if page content was modified.
 */
export function removeTextInRects(
  engine: PdfiumEngine,
  pageHandle: number,
  rects: HighlightRect[]
): boolean;
/**
 * Permanently removes all text and wipes images within the specified DOM bounding rectangles
 * from the PDF page content stream and regenerates page content.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle Active document handle for character-level precision.
 * @param pageIndex Zero-based page index.
 * @param pageHandle Active page handle.
 * @param rects Array of bounding rectangles in DOM coordinates.
 * @returns True if page content was modified.
 */
export function removeTextInRects(
  engine: PdfiumEngine,
  docHandle: number,
  pageIndex: number,
  pageHandle: number,
  rects: HighlightRect[]
): boolean;
export function removeTextInRects(
  engine: PdfiumEngine,
  docHandleOrPageHandle: number,
  pageIndexOrRects: number | HighlightRect[],
  pageHandleOrUndefined?: number,
  rectsOrUndefined?: HighlightRect[]
): boolean {
  let docHandle = 0;
  let pageIndex = 0;
  let pageHandle = 0;
  let rects: HighlightRect[] = [];

  if (
    typeof pageIndexOrRects === 'number' &&
    typeof pageHandleOrUndefined === 'number' &&
    Array.isArray(rectsOrUndefined)
  ) {
    docHandle = docHandleOrPageHandle;
    pageIndex = pageIndexOrRects;
    pageHandle = pageHandleOrUndefined;
    rects = rectsOrUndefined;
  } else if (Array.isArray(pageIndexOrRects)) {
    pageHandle = docHandleOrPageHandle;
    rects = pageIndexOrRects;
  }

  if (rects.length === 0 || !pageHandle) return false;

  const mod = engine.getModule();
  let modified = false;

  const didRedactText = redactInRects(engine, docHandle, pageIndex, pageHandle, rects);
  if (didRedactText) modified = true;

  const didWipeImages = wipeImagesInRects(engine, pageHandle, rects);
  if (didWipeImages) modified = true;

  const normalizedRects = rects.map((r) => ({
    x: Math.min(r.x, r.x + r.width),
    y: Math.min(r.y, r.y + r.height),
    width: Math.abs(r.width),
    height: Math.abs(r.height),
  }));
  const didRemoveEnclosed = removeTextObjectsInRects(engine, mod, pageHandle, normalizedRects);
  if (didRemoveEnclosed) modified = true;

  if (modified) {
    mod.FPDFPage_GenerateContent(pageHandle);
  }
  return didRemove;
}

/**
 * Permanently redacts only the characters in the specified character range [startCharIndex, endCharIndex]
 * from the PDF page content stream.
 *
 * Uses center-containment span matching and character-level replacement to ensure that
 * only the selected characters are removed, leaving neighboring text and surrounding
 * spans completely intact.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @param pageIndex Zero-based page index.
 * @param pageHandle The active page handle.
 * @param startCharIndex Starting character index (inclusive).
 * @param endCharIndex Ending character index (inclusive).
 * @return True if page content was modified.
 */
export function redactTextRange(
  engine: PdfiumEngine,
  _docHandle: number,
  pageIndex: number,
  pageHandle: number,
  startCharIndex: number,
  endCharIndex: number
): boolean {
  const mod = engine.getModule();
  const minIndex = Math.min(startCharIndex, endCharIndex);
  const maxIndex = Math.max(startCharIndex, endCharIndex);

  const spans = extractEditableSpans(engine, pageIndex, pageHandle);
  let modified = false;

  const handledCharIndices = new Set<number>();

  for (const span of spans) {
    const spanStart = span.charStartIndex;
    const spanEnd = span.charStartIndex + span.charCount - 1;

    // Check if span has any overlap with the selected redaction range
    if (spanEnd < minIndex || spanStart > maxIndex) {
      // No overlap: leave completely untouched to preserve neighbors
      continue;
    }

    if (spanStart >= minIndex && spanEnd <= maxIndex) {
      // Full overlap: entire span is redacted
      const objectIndices = findTextObjectIndicesForSpan(
        engine,
        mod,
        pageHandle,
        span.left,
        span.baselineY,
        span.width,
        span.fontSize
      );

      if (objectIndices.length > 0) {
        removeTextObjectsByIndex(mod, pageHandle, objectIndices);
      } else {
        removeTextObjectsInBounds(
          engine,
          mod,
          pageHandle,
          span.left,
          span.baselineY,
          span.width,
          span.fontSize
        );
      }
      modified = true;
      for (let c = spanStart; c <= spanEnd; c++) {
        handledCharIndices.add(c);
      }
    } else {
      // Partial overlap: only some characters in this span are redacted
      let pdfCharIdx = spanStart;
      const targetLines = span.lines && span.lines.length > 0 ? span.lines : [{
        left: span.left,
        baselineY: span.baselineY,
        width: span.width,
        fontSize: span.fontSize,
        text: span.text
      }];

      for (const line of targetLines) {
        if (!line.text) continue;
        
        const lineChars = Array.from(line.text);
        let hasRedactedChars = false;
        
        const updatedChars = lineChars.map((ch) => {
          if (ch === '\n' || ch === '\r') {
            return ch;
          }
          const cIdx = pdfCharIdx++;
          if (cIdx >= minIndex && cIdx <= maxIndex) {
            hasRedactedChars = true;
            handledCharIndices.add(cIdx);
            return ' ';
          }
          return ch;
        });

        if (hasRedactedChars) {
          const updatedText = updatedChars.join('');
          const objectIndices = findTextObjectIndicesForSpan(
            engine,
            mod,
            pageHandle,
            line.left,
            line.baselineY,
            line.width,
            line.fontSize
          );

          if (objectIndices.length > 0) {
            setTextObjectByIndex(engine, mod, pageHandle, objectIndices[0], updatedText);
            for (let k = 1; k < objectIndices.length; k++) {
              setTextObjectByIndex(engine, mod, pageHandle, objectIndices[k], ' ');
            }
            modified = true;
          } else {
            // Spatial fallback
            const didSet = setTextObjectInBounds(
              engine,
              mod,
              pageHandle,
              line.left,
              line.baselineY,
              line.width,
              line.fontSize,
              updatedText
            );
            if (didSet) {
              modified = true;
            }
          }
        } else {
          // Still increment pdfCharIdx for untouched lines
          for (const ch of lineChars) {
            if (ch !== '\n' && ch !== '\r') pdfCharIdx++;
          }
        }
      }
    }
  }

  if (modified) {
    mod.FPDFPage_GenerateContent(pageHandle);
  }

  // Handle any remaining standalone characters in the selection that were not in clustered spans
  const allCharacters = extractPageCharacters(engine, pageIndex, pageHandle);
  const remainingChars = allCharacters.filter(
    (c) => c.charIndex >= minIndex && c.charIndex <= maxIndex && !handledCharIndices.has(c.charIndex)
  );

  for (const char of remainingChars) {
    const objectIndices = findTextObjectIndicesForSpan(
      engine,
      mod,
      pageHandle,
      char.left,
      char.originY,
      Math.max(1, char.right - char.left),
      char.fontSize
    );
    if (objectIndices.length > 0) {
      setTextObjectByIndex(engine, mod, pageHandle, objectIndices[0], ' ');
      for (let k = 1; k < objectIndices.length; k++) {
        setTextObjectByIndex(engine, mod, pageHandle, objectIndices[k], ' ');
      }
      modified = true;
    }
  }

  if (modified) {
    mod.FPDFPage_GenerateContent(pageHandle);
  }

  return modified;
}


