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
