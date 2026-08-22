import type { PdfiumEngine } from '../../../core/pdfium-engine';
import { FontCharsetIndex, extractBaseFontFamily } from '../font-charset-index';
import { isColorEqual } from '../utils';
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

  // If targetSpan is a multi-line paragraph, newlines were added, or text wraps, use paragraph reflow engine
  if (isExplicitMultiLine || isWrappedMultiLine || options.reflowParagraph === true) {
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

      if (charsAvailable) {
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

    if (needsReflow) {
      for (const subSpan of lineSubsequentSpans) {
        const subIndices = findTextObjectIndicesForSpan(
          engine, mod, pageHandle,
          subSpan.left, subSpan.baselineY, subSpan.width, subSpan.fontSize
        );
        for (const idx of subIndices) {
          allIndicesToRemove.add(idx);
        }
      }
    }

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

    // Compute adjusted baseline for the replacement object
    let targetBaselineY = targetSpan.baselineY;
    if (options.top !== undefined) {
      targetBaselineY = heightPts - options.top - updatedFontSize * 0.15;
    } else if (updatedFontSize !== targetSpan.fontSize) {
      const sizeDiff = updatedFontSize - targetSpan.fontSize;
      targetBaselineY = Math.max(0, targetSpan.baselineY - sizeDiff * 0.1);
    }

    // Insert the replacement text object
    if (!isDeletion) {
      fontHandle = mod.FPDFText_LoadStandardFont(docHandle, standardFontName);
      if (!fontHandle) fontHandle = mod.FPDFText_LoadStandardFont(docHandle, 'Helvetica');

      const textBuf = encodeUtf16Le(engine, updatedText);

      try {
        const textObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, fontHandle, updatedFontSize);
        if (textObjHandle) {
          mod.FPDFText_SetText(textObjHandle, textBuf.ptr);
          mod.FPDFPageObj_SetFillColor(textObjHandle, updatedColor.r, updatedColor.g, updatedColor.b, updatedColor.a);
          
          setPageObjectMatrix(engine, mod, textObjHandle, translationMatrix(targetLeft, targetBaselineY));
          mod.FPDFPage_InsertObject(pageHandle, textObjHandle);
        }
      } finally {
        textBuf.dispose();
      }
    }

    // Re-insert shifted subsequent spans (objects already removed above)
    if (needsReflow) {
      insertShiftedSpans(engine, docHandle, pageHandle, lineSubsequentSpans, deltaX);
    }

    mod.FPDFPage_GenerateContent(pageHandle);
  } finally {
    // Standard fonts should not be closed
  }
}

/**
 * Insert new text objects for spans that need to be horizontally shifted.
 * The caller is responsible for removing the original objects beforehand.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @param pageHandle The active page handle.
 * @param spansToShift An array of trailing text spans on the line.
 * @param deltaX The horizontal shift amount in points.
 */
function insertShiftedSpans(
  engine: PdfiumEngine,
  docHandle: number,
  pageHandle: number,
  spansToShift: EditableTextSpan[],
  deltaX: number
): void {
  const mod = engine.getModule();

  for (const subSpan of spansToShift) {
    const subStandardFont: StandardFontName = mapStandardFontName(subSpan.fontFamily);
    const shiftedLeft = Math.max(0, subSpan.left + deltaX);
    let subFontHandle = 0;

    try {
      subFontHandle = mod.FPDFText_LoadStandardFont(docHandle, subStandardFont);
      if (!subFontHandle) subFontHandle = mod.FPDFText_LoadStandardFont(docHandle, 'Helvetica');

      const textBuf = encodeUtf16Le(engine, subSpan.text);
      try {
        const subObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, subFontHandle, subSpan.fontSize);
        if (subObjHandle) {
          mod.FPDFText_SetText(subObjHandle, textBuf.ptr);
          mod.FPDFPageObj_SetFillColor(subObjHandle, subSpan.color.r, subSpan.color.g, subSpan.color.b, subSpan.color.a);
          setPageObjectMatrix(engine, mod, subObjHandle, translationMatrix(shiftedLeft, subSpan.baselineY));
          mod.FPDFPage_InsertObject(pageHandle, subObjHandle);
        }
      } finally {
        textBuf.dispose();
      }
    } finally {
      // Standard fonts should not be closed
    }
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

