import type { PdfiumEngine } from '../../../core/pdfium-engine';
import { FontCharsetIndex, extractBaseFontFamily } from '../font-charset-index';
import { isColorEqual, parseColor, isControlOrUnidentified, isZeroWidthOrInvisible } from '../utils';
import type { ColorRgba, EditableTextSpan, TextMutationOptions, StandardFontName, PageCharacter, HighlightRect, TextWord } from '../../../core/types';
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
 * Analyzes the text stream of a page to group characters into semantic multi-line paragraphs and blocks.
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
 * Uses center-containment matching to identify only the span's own
 * objects, preserving neighboring text in crowded layouts.
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
 * Uses center-containment matching to identify the exact page objects
 * backing the target span, preventing collateral damage to neighboring
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

    // -- In-place edit path (preserves original embedded font subset) --
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
          // Blank remaining owning objects only (not neighbors)
          for (let k = 1; k < targetObjectIndices.length; k++) {
            setTextObjectByIndex(engine, mod, pageHandle, targetObjectIndices[k], ' ');
          }
          mod.FPDFPage_GenerateContent(pageHandle);
          return;
        }
      }
    }

    // -- Fallback: remove owning objects and recreate with standard font --

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
 * Uses center-containment matching to identify only the span's own objects,
 * preventing collateral removal of neighboring text in crowded regions.
 *
 * @param engine The PDFium engine instance.
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
  matrix: import('../../../core/types').PdfMatrix
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
