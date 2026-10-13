import type { PdfiumEngine } from '../../../core/pdfium-engine';
import { FontCharsetIndex, extractBaseFontFamily, isStandard14Font } from '../font-charset-index';
import { isColorEqual, parseColor, isControlOrUnidentified, isZeroWidthOrInvisible, sanitizePdfText, safeEncodeForStandardFont } from '../utils';
import type { ColorRgba, EditableTextSpan, TextMutationOptions, StandardFontName, PageCharacter, HighlightRect, TextWord, TextLine, PdfMatrix } from '../../../core/types';
import {
  encodeUtf16Le,
  setPageObjectMatrix,
  translationMatrix,
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
  domToPdfCoords,
  registerSpanDecorationObject,
  removeSpanDecorationObjectsInBounds,
  cleanSubsetPrefix,
  readCharMatrixScaleY,
  extractImageObjectBitmap,
} from '../../../core/pdfium-helpers';
import {
  calculateTrackedTextWidth,
  resolveMatrixScaledFontSize,
  UNIT_FONT_SIZE_THRESHOLD,
} from '../../../core/typography-metrics';

import { detectParagraphs, normalizeAngleDeg, getCardinalRotation, isVerticalRotation } from './paragraph-detector';
import {
  reflowAndReplaceParagraph,
  wrapTextToWidth,
  isWordPrecededBySpace,
  reconstructLineTextFromWords,
  mapLineTextToStyledWords,
} from './paragraph-reflow';
import { resolveStandardFont } from './draw-text';
import { resolveUnifiedCharacterRange } from '../unified-text-provider';

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
  const docHandle = engine.getDocumentHandle() || 0;
  const targetLines: Array<{
    left: number;
    baselineY: number;
    width: number;
    fontSize: number;
    text?: string;
    charStartIndex?: number;
    color?: ColorRgba;
    fontFamily?: string;
    rawFontFamily?: string;
    fontWeight?: string;
    fontStyle?: string;
    words?: TextWord[];
    hasBulletPrefix?: boolean;
    bulletWord?: TextWord;
  }> = targetSpan.lines && targetSpan.lines.length > 0
    ? targetSpan.lines
    : [{
        left: targetSpan.left,
        baselineY: targetSpan.baselineY,
        width: targetSpan.width,
        fontSize: targetSpan.fontSize,
        text: targetSpan.text,
        charStartIndex: targetSpan.charStartIndex,
        color: targetSpan.color,
        fontFamily: targetSpan.fontFamily,
        rawFontFamily: targetSpan.rawFontFamily,
        fontWeight: targetSpan.fontWeight,
        fontStyle: targetSpan.fontStyle,
        hasBulletPrefix: targetSpan.hasBulletPrefix,
        bulletWord: targetSpan.bulletWord,
      }];

  let modified = false;
  for (const line of targetLines) {
    if (isolateSharedLineTextObjects(engine, mod, docHandle, targetSpan.pageIndex, pageHandle, line)) {
      modified = true;
    }

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
  const effectiveSpanFont =
    targetSpan.fontFamily && targetSpan.fontFamily !== 'Helvetica'
      ? targetSpan.fontFamily
      : targetSpan.rawFontFamily || targetSpan.fontFamily;
  const rawFontName = options.fontFamily || effectiveSpanFont || 'Helvetica';
  const updatedFontSize = options.fontSize !== undefined ? options.fontSize : targetSpan.fontSize;
  const standardFontName: StandardFontName = resolveStandardFont(
    rawFontName,
    targetSpan.rawFontFamily,
    (options.fontWeight || targetSpan.fontWeight) as 'bold' | 'normal' | undefined,
    (options.fontStyle || targetSpan.fontStyle) as 'italic' | 'normal' | undefined
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
    const pageWidth = typeof mod.FPDF_GetPageWidthF === 'function' ? mod.FPDF_GetPageWidthF(pageHandle) : typeof mod.FPDF_GetPageWidth === 'function' ? mod.FPDF_GetPageWidth(pageHandle) : 612;
    const maxAvailableWidth = Math.max(
      targetSpan.width + updatedFontSize * 0.6,
      Math.min(pageWidth - targetSpan.left - 36, 500)
    );
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
  const baseLeft = targetSpan.originalLeft ?? targetSpan.left;
  const targetLeft = options.left !== undefined ? options.left : targetSpan.left;
  const effectiveLetterSpacing = options.letterSpacing ?? targetSpan.letterSpacing;
  const effectiveWordSpacing = options.wordSpacing ?? targetSpan.wordSpacing;

  const calculatedNewWidth = isDeletion
    ? 0
    : calculateTrackedTextWidth(
        updatedText,
        updatedFontSize,
        standardFontName,
        effectiveLetterSpacing,
        effectiveWordSpacing
      );

  // Isolate the target cell if it shares a wide multi-column PDF text object on the row
  isolateSharedLineTextObjects(engine, mod, docHandle, pageIndex, pageHandle, {
    left: targetSpan.left,
    baselineY: targetSpan.baselineY,
    width: targetSpan.width,
    fontSize: targetSpan.fontSize,
    text: targetSpan.text,
    charStartIndex: targetSpan.charStartIndex,
    color: targetSpan.color,
    fontFamily: targetSpan.fontFamily,
    rawFontFamily: targetSpan.rawFontFamily,
    fontWeight: targetSpan.fontWeight,
    fontStyle: targetSpan.fontStyle,
    words: targetSpan.lines?.[0]?.words,
    hasBulletPrefix: targetSpan.hasBulletPrefix,
    bulletWord: targetSpan.bulletWord,
  });

  // Identify the exact page objects that back this span
  let targetObjectIndices = findTextObjectIndicesForSpan(
    engine, mod, pageHandle,
    targetSpan.left, targetSpan.baselineY, targetSpan.width, targetSpan.fontSize
  );

  let fontHandle = 0;

  try {
    // Find subsequent inline spans on the same baseline (excluding separate table columns)
    const pageSpans = extractEditableSpans(engine, pageIndex, pageHandle);
    const sameLineOtherSpans = pageSpans.filter(
      (s) => s.id !== targetSpan.id && Math.abs(s.baselineY - targetSpan.baselineY) < 6.0
    );
    const sortedRightSpans = sameLineOtherSpans
      .filter((s) => s.left > targetSpan.left + 5.0)
      .sort((a, b) => a.left - b.left);
    const lineSubsequentSpans: EditableTextSpan[] = [];
    let prevInlineRight = targetSpan.left + targetSpan.width;
    const maxInlineContinuationGap = Math.max(8.0, targetSpan.fontSize * 0.85);
    for (const candidateSpan of sortedRightSpans) {
      if (candidateSpan.left - prevInlineRight <= maxInlineContinuationGap) {
        lineSubsequentSpans.push(candidateSpan);
        prevInlineRight = candidateSpan.left + candidateSpan.width;
      } else {
        break;
      }
    }

    const pageWidth = typeof mod.FPDF_GetPageWidthF === 'function'
      ? mod.FPDF_GetPageWidthF(pageHandle)
      : (typeof mod.FPDF_GetPageWidth === 'function' ? mod.FPDF_GetPageWidth(pageHandle) : 612);

    if (targetObjectIndices.length === 0 && sameLineOtherSpans.length === 0) {
      targetObjectIndices = findTextObjectIndicesForSpan(
        engine, mod, pageHandle,
        0, targetSpan.baselineY, pageWidth, targetSpan.fontSize
      );
    }

    const effectiveAlign = options.textAlign || targetSpan.textAlign;
    const isUnchangedTextMetrics =
      updatedText === targetSpan.text &&
      Math.abs(updatedFontSize - targetSpan.fontSize) < 0.1 &&
      (options.letterSpacing === undefined || options.letterSpacing === targetSpan.letterSpacing);
    const actualTextWidth = isDeletion
      ? 0
      : (isUnchangedTextMetrics && targetSpan.width > 0 ? targetSpan.width : calculatedNewWidth);

    let alignedDomLeft = targetLeft;
    if (options.left !== undefined) {
      alignedDomLeft = options.left;
    } else if (!isDeletion && effectiveAlign && (effectiveAlign === 'left' || effectiveAlign === 'center' || effectiveAlign === 'right')) {
      if (sameLineOtherSpans.length > 0 || (targetSpan.width > actualTextWidth + 4 && updatedText !== targetSpan.text)) {
        const preceding = sameLineOtherSpans.filter((s) => s.left < baseLeft).sort((a, b) => (b.left + b.width) - (a.left + a.width))[0];
        const succeeding = sameLineOtherSpans.filter((s) => s.left > baseLeft + actualTextWidth).sort((a, b) => a.left - b.left)[0];
        const colLeft = preceding ? preceding.left + preceding.width + 12 : baseLeft;
        const colRight = succeeding ? succeeding.left - 12 : Math.max(baseLeft + actualTextWidth, pageWidth - baseLeft);
        const colWidth = Math.max(targetSpan.width, actualTextWidth, colRight - colLeft);
        const boxLeft = Math.min(baseLeft, colLeft);
        if (effectiveAlign === 'center') {
          alignedDomLeft = boxLeft + Math.max(0, (colWidth - actualTextWidth) / 2);
        } else if (effectiveAlign === 'right') {
          alignedDomLeft = boxLeft + Math.max(0, colWidth - actualTextWidth);
        } else {
          alignedDomLeft = boxLeft;
        }
      } else {
        let leftMargin = baseLeft;
        if (leftMargin >= pageWidth * 0.25) {
          const marginCandidates = pageSpans
            .filter((s) => s.id !== targetSpan.id && (s.originalLeft ?? s.left) >= 18 && (s.originalLeft ?? s.left) < pageWidth * 0.25)
            .map((s) => s.originalLeft ?? s.left);
          leftMargin = marginCandidates.length > 0 ? Math.min(...marginCandidates) : Math.min(baseLeft, 72);
        }
        const rightMargin = Math.max(leftMargin + actualTextWidth, pageWidth - leftMargin);
        const availWidth = Math.max(actualTextWidth, rightMargin - leftMargin);
        if (effectiveAlign === 'center') {
          alignedDomLeft = leftMargin + Math.max(0, (availWidth - actualTextWidth) / 2);
        } else if (effectiveAlign === 'right') {
          alignedDomLeft = Math.max(leftMargin, rightMargin - actualTextWidth);
        } else {
          alignedDomLeft = leftMargin;
        }
      }
    }

    const deltaX = calculatedNewWidth - targetSpan.width;
    const needsReflow = Math.abs(deltaX) > 0.5 && lineSubsequentSpans.length > 0;

    const firstLineCandidate =
      options.lines && options.lines.length > 0
        ? options.lines[0]
        : targetSpan.lines && targetSpan.lines.length > 0
          ? targetSpan.lines[0]
          : undefined;
    const isLineMatchingText =
      firstLineCandidate &&
      (options.text === undefined ||
        firstLineCandidate.text === updatedText ||
        (firstLineCandidate.words &&
          reconstructLineTextFromWords(firstLineCandidate.words) ===
            sanitizePdfText(updatedText).trim().replace(/\s+/g, ' ')) ||
        (firstLineCandidate.words &&
          firstLineCandidate.words.map((w) => w.text).join('') ===
            updatedText.replace(/\s+/g, '')));
    const firstLine = firstLineCandidate;
    const firstLineWords = firstLineCandidate?.words
      ? isLineMatchingText
        ? firstLineCandidate.words
        : mapLineTextToStyledWords(
            updatedText,
            firstLineCandidate,
            alignedDomLeft,
            targetSpan.baselineY,
            updatedFontSize
          ).words
      : undefined;
    const hasMultiStyleWords = Boolean(
      firstLineWords &&
      firstLineWords.length > 1 &&
      firstLineWords.some(
        (w) =>
          Math.abs(w.fontSize - firstLineWords[0].fontSize) > 0.2 ||
          (w.fontFamily && w.fontFamily !== firstLineWords[0].fontFamily) ||
          (w.rawFontFamily && cleanSubsetPrefix(w.rawFontFamily) !== cleanSubsetPrefix(firstLineWords[0].rawFontFamily || '')) ||
          (w.fontWeight && w.fontWeight !== firstLineWords[0].fontWeight) ||
          (w.fontStyle && w.fontStyle !== firstLineWords[0].fontStyle) ||
          (w.color && firstLineWords[0].color && !isColorEqual(w.color, firstLineWords[0].color)) ||
          Boolean(w.underline) !== Boolean(firstLineWords[0].underline) ||
          Boolean(w.strikethrough) !== Boolean(firstLineWords[0].strikethrough) ||
          (w.backgroundColor !== firstLineWords[0].backgroundColor) ||
          Math.abs((w.letterSpacingPts || 0) - (firstLineWords[0].letterSpacingPts || 0)) > 1.0
      )
    );

    const singleWord =
      !hasMultiStyleWords && firstLineWords && firstLineWords.length > 0
        ? firstLineWords[0]
        : undefined;
    const effectiveBgColor = options.backgroundColor === 'transparent' || ('backgroundColor' in options && options.backgroundColor === undefined && !firstLine?.backgroundColor && !singleWord?.backgroundColor)
      ? undefined
      : (options.backgroundColor || firstLine?.backgroundColor || singleWord?.backgroundColor || targetSpan.backgroundColor);
    const effectiveUnderline = Boolean(
      firstLine?.underline ?? singleWord?.underline ?? options.underline ?? targetSpan.underline
    );
    const effectiveStrike = Boolean(
      firstLine?.strikethrough ?? singleWord?.strikethrough ?? options.strikethrough ?? targetSpan.strikethrough
    );
    const hasWordStyleOverride = Boolean(
      singleWord && (
        Math.abs((singleWord.fontSize || updatedFontSize) - targetSpan.fontSize) > 0.1 ||
        (singleWord.fontFamily && singleWord.fontFamily !== targetSpan.fontFamily) ||
        (singleWord.fontWeight && singleWord.fontWeight !== (targetSpan.fontWeight || 'normal')) ||
        (singleWord.fontStyle && singleWord.fontStyle !== (targetSpan.fontStyle || 'normal')) ||
        (singleWord.color && !isColorEqual(singleWord.color, targetSpan.color)) ||
        Boolean(singleWord.underline) !== Boolean(targetSpan.underline) ||
        Boolean(singleWord.strikethrough) !== Boolean(targetSpan.strikethrough) ||
        singleWord.backgroundColor !== targetSpan.backgroundColor ||
        (singleWord.letterSpacing !== undefined && singleWord.letterSpacing !== targetSpan.letterSpacing)
      )
    );
    const hasDecorationChange =
      effectiveUnderline !== Boolean(targetSpan.underline) ||
      effectiveStrike !== Boolean(targetSpan.strikethrough) ||
      effectiveBgColor !== targetSpan.backgroundColor;

    // Purge any existing background highlight, underline, or strikethrough rectangles in the span bounds
    removeSpanDecorationObjectsInBounds(
      engine,
      mod,
      pageHandle,
      targetSpan.left,
      targetSpan.baselineY,
      Math.max(targetSpan.width, calculatedNewWidth),
      Math.max(targetSpan.fontSize, updatedFontSize)
    );

    // In-place edit path (preserves original embedded font subset)
    // Only safe if font is unchanged and no trailing spans on the line need shifting
    const isOnlyTextChanged = 
      !hasMultiStyleWords &&
      !hasWordStyleOverride &&
      !hasDecorationChange &&
      !effectiveBgColor &&
      !effectiveUnderline &&
      !effectiveStrike &&
      (options.fontSize === undefined || Math.abs(options.fontSize - targetSpan.fontSize) < 0.1) &&
      (options.letterSpacing === undefined || options.letterSpacing === targetSpan.letterSpacing) &&
      (options.fontFamily === undefined ||
        options.fontFamily === targetSpan.fontFamily ||
        extractBaseFontFamily(options.fontFamily) === extractBaseFontFamily(targetSpan.rawFontFamily || targetSpan.fontFamily) ||
        resolveStandardFont(options.fontFamily, targetSpan.rawFontFamily) ===
          resolveStandardFont(targetSpan.fontFamily, targetSpan.rawFontFamily)) &&
      (options.color === undefined || isColorEqual(options.color, targetSpan.color)) &&
      (!options.fontWeight || options.fontWeight === (targetSpan.fontWeight || 'normal')) &&
      (!options.fontStyle || options.fontStyle === (targetSpan.fontStyle || 'normal'));

    const initialFirstObj = targetObjectIndices.length > 0 ? mod.FPDFPage_GetObject(pageHandle, targetObjectIndices[0]) : 0;
    const preservedFirstMat = initialFirstObj ? getPageObjectMatrix(engine, mod, initialFirstObj) : null;

    if (!isDeletion && isOnlyTextChanged && !needsReflow && targetObjectIndices.length > 0) {
      const cropInfo = getPageCropInfo(engine, mod, pageHandle);
      const pdfTargetLeft = alignedDomLeft + cropInfo.cropLeft;
      const firstMat = preservedFirstMat;
      const hasHorizontalShift = options.left !== undefined || Boolean(effectiveAlign);
      const currentBasePdfX = firstMat
        ? (Math.abs(firstMat.e - (targetSpan.left + cropInfo.cropLeft)) <= 3.0
            ? targetSpan.left + cropInfo.cropLeft
            : firstMat.e)
        : targetSpan.left + cropInfo.cropLeft;
      const deltaAlignX = hasHorizontalShift ? pdfTargetLeft - currentBasePdfX : 0;

      if (updatedText === targetSpan.text && !options.forceTextRestore) {
        if (Math.abs(deltaAlignX) > 0.01) {
          for (const idx of targetObjectIndices) {
            const objHandle = mod.FPDFPage_GetObject(pageHandle, idx);
            if (!objHandle) continue;
            const mat = getPageObjectMatrix(engine, mod, objHandle);
            if (mat) {
              setPageObjectMatrix(engine, mod, objHandle, {
                ...mat,
                e: mat.e + deltaAlignX,
              });
            }
          }
          mod.FPDFPage_GenerateContent(pageHandle);
        }
        return;
      }

      let charsAvailable = false;
      const font = targetSpan.rawFontFamily || targetSpan.fontFamily;
      const hasWhitespace = updatedText.includes(' ') || updatedText.includes('\t') || updatedText.includes('\n') || updatedText.includes('\r');

      if (hasWhitespace && !isStandard14Font(font)) {
        charsAvailable = false;
      } else if (charsetIndex) {
        charsAvailable = charsetIndex.hasAllChars(updatedText, font, targetSpan.text);
      } else {
        const nonWs = Array.from(updatedText).filter((c) => c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r');
        charsAvailable = nonWs.every((char) => targetSpan.text.includes(char));
      }

      if (charsAvailable) {
        const updatedMatrix = firstMat && Math.abs(deltaAlignX) > 0.01
          ? { ...firstMat, e: firstMat.e + deltaAlignX }
          : undefined;
        // targetObjectIndices are already sorted geometrically (left-to-right)
        const canEditInPlace = setTextObjectByIndex(
          engine, mod, pageHandle, targetObjectIndices[0], updatedText, updatedMatrix
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
    let pdfTargetLeft = alignedDomLeft + cropInfo.cropLeft;

    // Compute adjusted baseline for the replacement object
    let targetBaselineY = targetSpan.baselineY;
    if (options.top !== undefined) {
      const pdfPt = domToPdfCoords(alignedDomLeft, options.top, cropInfo);
      pdfTargetLeft = pdfPt.x;
      targetBaselineY = pdfPt.y - updatedFontSize * 0.15;
    } else if (updatedFontSize !== targetSpan.fontSize) {
      const sizeDiff = updatedFontSize - targetSpan.fontSize;
      targetBaselineY = Math.max(0, targetSpan.baselineY - sizeDiff * 0.1);
    }


    // Insert the replacement text object
    let insertedObjHandle: number | null = null;
    if (!isDeletion) {
      if (!hasMultiStyleWords && effectiveBgColor) {
        const bgCol = parseColor(effectiveBgColor);
        if (bgCol.a > 0) {
          const rectW = calculatedNewWidth || targetSpan.width;
          const rectH = updatedFontSize * 1.25;
          const rectBottom = Math.max(0, targetBaselineY - updatedFontSize * 0.25);
          const bgRect = mod.FPDFPageObj_CreateNewRect(pdfTargetLeft, rectBottom, rectW, rectH);
          if (bgRect) {
            mod.FPDFPageObj_SetFillColor(bgRect, bgCol.r, bgCol.g, bgCol.b, bgCol.a);
            mod.FPDFPath_SetDrawMode(bgRect, 1, false);
            mod.FPDFPage_InsertObject(pageHandle, bgRect);
            registerSpanDecorationObject(bgRect, pdfTargetLeft, rectBottom, rectW, rectH);
          }
        }
      }

      fontHandle = mod.FPDFText_LoadStandardFont(docHandle, standardFontName);
      if (!fontHandle) fontHandle = mod.FPDFText_LoadStandardFont(docHandle, 'Helvetica');

      if (hasMultiStyleWords && firstLineWords) {
        let currentWordX = pdfTargetLeft;
        for (let wIdx = 0; wIdx < firstLineWords.length; wIdx++) {
          const word = firstLineWords[wIdx];
          const cleanWord = sanitizePdfText(word.text);
          if (!cleanWord) continue;

          const wordFontName = resolveStandardFont(
            word.fontFamily || rawFontName,
            word.rawFontFamily || targetSpan.rawFontFamily,
            (word.fontWeight as 'bold' | 'normal') || options.fontWeight || (targetSpan.fontWeight as 'bold' | 'normal'),
            (word.fontStyle as 'italic' | 'normal') || options.fontStyle || (targetSpan.fontStyle as 'italic' | 'normal')
          );
          let wordFontHandle = mod.FPDFText_LoadStandardFont(docHandle, wordFontName);
          if (!wordFontHandle) wordFontHandle = fontHandle;

          let spaceWidth = 0;
          if (wIdx > 0 && isWordPrecededBySpace(firstLineWords[wIdx - 1], word)) {
            spaceWidth = calculateTextWidth(' ', word.fontSize || updatedFontSize, wordFontName) + (firstLine?.wordSpacing ?? effectiveWordSpacing ?? 0);
            currentWordX += spaceWidth;
          }

          const wordLetterSpacing = word.letterSpacing ?? firstLine?.letterSpacing ?? effectiveLetterSpacing;
          const wordWidth = calculateTrackedTextWidth(cleanWord, word.fontSize || updatedFontSize, wordFontName, wordLetterSpacing);
          const wFs = word.fontSize || updatedFontSize;

          const wordBgColorStr = word.backgroundColor !== undefined
            ? (word.backgroundColor === 'transparent' ? undefined : word.backgroundColor)
            : effectiveBgColor;
          if (wordBgColorStr) {
            const bgCol = parseColor(wordBgColorStr);
            if (bgCol.a > 0) {
              const prevWord = wIdx > 0 ? firstLineWords[wIdx - 1] : null;
              const prevBg = prevWord
                ? (prevWord.backgroundColor !== undefined ? prevWord.backgroundColor : effectiveBgColor)
                : undefined;
              const bgStartX = spaceWidth > 0 && prevBg === wordBgColorStr ? currentWordX - spaceWidth : currentWordX;
              const bgWidth = spaceWidth > 0 && prevBg === wordBgColorStr ? wordWidth + spaceWidth : wordWidth;
              const rectBottom = Math.max(0, targetBaselineY - wFs * 0.25);
              const rectH = wFs * 1.25;
              const bgRect = mod.FPDFPageObj_CreateNewRect(bgStartX, rectBottom, bgWidth, rectH);
              if (bgRect) {
                mod.FPDFPageObj_SetFillColor(bgRect, bgCol.r, bgCol.g, bgCol.b, bgCol.a);
                mod.FPDFPath_SetDrawMode(bgRect, 1, false);
                mod.FPDFPage_InsertObject(pageHandle, bgRect);
                registerSpanDecorationObject(bgRect, bgStartX, rectBottom, bgWidth, rectH);
              }
            }
          }

          const isWordUnderline = word.underline !== undefined
            ? Boolean(word.underline)
            : effectiveUnderline;
          const isWordStrike = word.strikethrough !== undefined
            ? Boolean(word.strikethrough)
            : effectiveStrike;

          if (isWordUnderline || isWordStrike) {
            const lineThick = Math.max(0.75, wFs * 0.065);
            const wCol = word.color || updatedColor;
            const prevWord = wIdx > 0 ? firstLineWords[wIdx - 1] : null;
            const prevUnderline = prevWord
              ? (prevWord.underline !== undefined
                  ? Boolean(prevWord.underline)
                  : effectiveUnderline)
              : false;
            const prevStrike = prevWord
              ? (prevWord.strikethrough !== undefined
                  ? Boolean(prevWord.strikethrough)
                  : effectiveStrike)
              : false;

            if (isWordUnderline) {
              const uStartX = spaceWidth > 0 && prevUnderline ? currentWordX - spaceWidth : currentWordX;
              const uWidth = spaceWidth > 0 && prevUnderline ? wordWidth + spaceWidth : wordWidth;
              const uBottom = Math.max(0, targetBaselineY - lineThick * 1.5);
              const uRect = mod.FPDFPageObj_CreateNewRect(uStartX, uBottom, uWidth, lineThick);
              if (uRect) {
                mod.FPDFPageObj_SetFillColor(uRect, wCol.r, wCol.g, wCol.b, wCol.a);
                mod.FPDFPath_SetDrawMode(uRect, 1, false);
                mod.FPDFPage_InsertObject(pageHandle, uRect);
                registerSpanDecorationObject(uRect, uStartX, uBottom, uWidth, lineThick);
              }
            }

            if (isWordStrike) {
              const sStartX = spaceWidth > 0 && prevStrike ? currentWordX - spaceWidth : currentWordX;
              const sWidth = spaceWidth > 0 && prevStrike ? wordWidth + spaceWidth : wordWidth;
              const sBottom = targetBaselineY + wFs * 0.28;
              const sRect = mod.FPDFPageObj_CreateNewRect(sStartX, sBottom, sWidth, lineThick);
              if (sRect) {
                mod.FPDFPageObj_SetFillColor(sRect, wCol.r, wCol.g, wCol.b, wCol.a);
                mod.FPDFPath_SetDrawMode(sRect, 1, false);
                mod.FPDFPage_InsertObject(pageHandle, sRect);
                registerSpanDecorationObject(sRect, sStartX, sBottom, sWidth, lineThick);
              }
            }
          }

          const textToWrite = safeEncodeForStandardFont(cleanWord);
          const textBuf = encodeUtf16Le(engine, textToWrite);
          try {
            const textObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, wordFontHandle, wFs);
            if (textObjHandle) {
              mod.FPDFText_SetText(textObjHandle, textBuf.ptr);
              const wCol = word.color || updatedColor;
              mod.FPDFPageObj_SetFillColor(textObjHandle, wCol.r, wCol.g, wCol.b, wCol.a);
              const normMat = normalizeCreatedTextMatrix(preservedFirstMat, wFs);
              const wordMat: PdfMatrix = normMat
                ? { ...normMat, e: currentWordX, f: targetBaselineY }
                : translationMatrix(currentWordX, targetBaselineY);
              setPageObjectMatrix(engine, mod, textObjHandle, wordMat);
              mod.FPDFPage_InsertObject(pageHandle, textObjHandle);
              if (wIdx === 0) insertedObjHandle = textObjHandle;
            }
          } finally {
            textBuf.dispose();
          }

          const naturalWordWidth = calculateTextWidth(cleanWord, wFs, wordFontName);
          currentWordX += Math.max(wordWidth, naturalWordWidth);
        }
      } else {
        const isUnderline = effectiveUnderline;
        const isStrikethrough = effectiveStrike;
        const singleCol = singleWord?.color || updatedColor;
        const singleFs = singleWord?.fontSize || updatedFontSize;
        const singleFontName = singleWord
          ? resolveStandardFont(
              singleWord.fontFamily || rawFontName,
              singleWord.rawFontFamily || targetSpan.rawFontFamily,
              (singleWord.fontWeight as 'bold' | 'normal') || options.fontWeight || (targetSpan.fontWeight as 'bold' | 'normal'),
              (singleWord.fontStyle as 'italic' | 'normal') || options.fontStyle || (targetSpan.fontStyle as 'italic' | 'normal')
            )
          : standardFontName;
        const singleFontHandle = singleFontName !== standardFontName
          ? (mod.FPDFText_LoadStandardFont(docHandle, singleFontName) || fontHandle)
          : fontHandle;

        if (isUnderline || isStrikethrough) {
          const lineThick = Math.max(0.75, singleFs * 0.065);
          const rectW = calculatedNewWidth || targetSpan.width;

          if (isUnderline) {
            const uBottom = Math.max(0, targetBaselineY - lineThick * 1.5);
            const uRect = mod.FPDFPageObj_CreateNewRect(pdfTargetLeft, uBottom, rectW, lineThick);
            if (uRect) {
              mod.FPDFPageObj_SetFillColor(uRect, singleCol.r, singleCol.g, singleCol.b, singleCol.a);
              mod.FPDFPath_SetDrawMode(uRect, 1, false);
              mod.FPDFPage_InsertObject(pageHandle, uRect);
              registerSpanDecorationObject(uRect, pdfTargetLeft, uBottom, rectW, lineThick);
            }
          }

          if (isStrikethrough) {
            const sBottom = targetBaselineY + singleFs * 0.28;
            const sRect = mod.FPDFPageObj_CreateNewRect(pdfTargetLeft, sBottom, rectW, lineThick);
            if (sRect) {
              mod.FPDFPageObj_SetFillColor(sRect, singleCol.r, singleCol.g, singleCol.b, singleCol.a);
              mod.FPDFPath_SetDrawMode(sRect, 1, false);
              mod.FPDFPage_InsertObject(pageHandle, sRect);
              registerSpanDecorationObject(sRect, pdfTargetLeft, sBottom, rectW, lineThick);
            }
          }
        }

        const textToWrite = safeEncodeForStandardFont(updatedText);
        const textBuf = encodeUtf16Le(engine, textToWrite);

        try {
          const textObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, singleFontHandle, singleFs);
          if (textObjHandle) {
            mod.FPDFText_SetText(textObjHandle, textBuf.ptr);
            mod.FPDFPageObj_SetFillColor(textObjHandle, singleCol.r, singleCol.g, singleCol.b, singleCol.a);
            const normMat = normalizeCreatedTextMatrix(preservedFirstMat, singleFs);
            const targetMat: PdfMatrix = normMat
              ? { ...normMat, e: pdfTargetLeft, f: targetBaselineY }
              : translationMatrix(pdfTargetLeft, targetBaselineY);
            setPageObjectMatrix(engine, mod, textObjHandle, targetMat);
            mod.FPDFPage_InsertObject(pageHandle, textObjHandle);
            insertedObjHandle = textObjHandle;
          }
        } finally {
          textBuf.dispose();
        }
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
  targetSpan: EditableTextSpan,
  options: { reflowDownstream?: boolean } = {}
): void {
  const { reflowDownstream = true } = options;
  // When deleting a paragraph, reflow with empty string to automatically shift downstream lines up
  if (reflowDownstream && (targetSpan.isParagraph || (targetSpan.lines && targetSpan.lines.length > 0))) {
    reflowAndReplaceParagraph(engine, docHandle, pageIndex, pageHandle, targetSpan, { text: '' });
    return;
  }

  const mod = engine.getModule();
  const targetLines = targetSpan.lines && targetSpan.lines.length > 0
    ? targetSpan.lines
    : [{
        left: targetSpan.left,
        baselineY: targetSpan.baselineY,
        width: targetSpan.width,
        fontSize: targetSpan.fontSize,
        text: targetSpan.text,
        charStartIndex: targetSpan.charStartIndex,
        color: targetSpan.color,
        fontFamily: targetSpan.fontFamily,
        rawFontFamily: targetSpan.rawFontFamily,
        fontWeight: targetSpan.fontWeight,
        fontStyle: targetSpan.fontStyle,
        hasBulletPrefix: targetSpan.hasBulletPrefix,
        bulletWord: targetSpan.bulletWord,
      }];

  for (const line of targetLines) {
    isolateSharedLineTextObjects(engine, mod, docHandle, pageIndex, pageHandle, line);

    removeSpanDecorationObjectsInBounds(
      engine,
      mod,
      pageHandle,
      line.left,
      line.baselineY,
      line.width,
      line.fontSize
    );

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
    const matrixPtr = engine.allocateMemory(24);

    try {
      for (let i = 0; i < totalChars; i++) {
        const charCode = mod.FPDFText_GetUnicode(textPageHandle, i);
        if (charCode === 0 || isControlOrUnidentified(charCode)) continue;

        let charStr = '';
        try {
          if (charCode > 0 && charCode <= 0x10ffff && (charCode < 0xd800 || charCode > 0xdfff)) {
            charStr = String.fromCodePoint(charCode);
          } else if (charCode >= 0xd800 && charCode <= 0xdfff) {
            charStr = String.fromCharCode(charCode);
          }
        } catch {
          continue;
        }
        if (!charStr) continue;
        const reportedFontSize = mod.FPDFText_GetFontSize(textPageHandle, i) || 12;
        const fontSize =
          resolveMatrixScaledFontSize(
            reportedFontSize,
            reportedFontSize <= UNIT_FONT_SIZE_THRESHOLD
              ? readCharMatrixScaleY(mod, textPageHandle, i, matrixPtr)
              : null
          ) ?? reportedFontSize;

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
      engine.freeMemory(matrixPtr);
    }
  } finally {
    if (textPageHandle) {
      mod.FPDFText_ClosePage(textPageHandle);
    }
  }

  calibrateMatrixScaledPageCharacters(characters);

  return characters;
}

/**
 * Calibrates extracted page character font sizes when PDFium reports a unit or near-zero Tf size (<= 1.5)
 * because the visual point size is encoded in the text transformation matrix Tm.
 *
 * @param chars Extracted page characters.
 */
function calibrateMatrixScaledPageCharacters(chars: PageCharacter[]): void {
  let i = 0;
  while (i < chars.length) {
    if (chars[i].fontSize > 1.5) {
      i++;
      continue;
    }
    let j = i + 1;
    while (
      j < chars.length &&
      chars[j].fontSize <= 1.5 &&
      Math.abs(chars[j].domBaseline - chars[i].domBaseline) <= 4.0
    ) {
      j++;
    }

    let maxAscent = 0;
    for (let k = i; k < j; k++) {
      const ch = chars[k];
      const boxSpan = ch.isVertical
        ? Math.abs(ch.right - ch.left)
        : Math.max(Math.abs(ch.top - ch.originY), Math.abs(ch.top - ch.bottom) * 0.85);
      if (boxSpan > maxAscent) {
        maxAscent = boxSpan;
      }
    }

    if (maxAscent > 1.5) {
      const calibratedFs = Math.max(4, Math.round((maxAscent / 0.72) * 2) / 2);
      for (let k = i; k < j; k++) {
        const ch = chars[k];
        ch.fontSize = calibratedFs;
        const cp = ch.unicode.codePointAt(0) || 0;
        if (!ch.isVertical) {
          if (ch.domBottom - ch.domTop < calibratedFs * 0.2) {
            ch.domTop = Math.max(0, ch.domBaseline - calibratedFs * 0.85);
            ch.domBottom = ch.domBaseline + calibratedFs * 0.25;
          }
          if (ch.domRight - ch.domLeft < calibratedFs * 0.1 && !isZeroWidthOrInvisible(cp)) {
            ch.domRight = ch.domLeft + calibratedFs * 0.28;
            ch.right = ch.left + calibratedFs * 0.28;
          }
        }
      }
    }

    i = j;
  }
}

/**
 * Normalises a preserved text object transformation matrix when creating a new standard-font
 * text object whose point size is already passed to FPDFPageObj_CreateTextObj.
 *
 * @param mat Original text object matrix.
 * @param fontSize Target font size in points passed to FPDFPageObj_CreateTextObj.
 * @return Normalised matrix preserving rotation/shear without duplicating font size scale.
 */
function normalizeCreatedTextMatrix(mat: PdfMatrix | null, fontSize: number): PdfMatrix | null {
  if (!mat) return null;
  const scaleX = Math.hypot(mat.a, mat.b);
  const scaleY = Math.hypot(mat.c, mat.d);
  if (fontSize > 2.0 && scaleX > 1.8 && scaleY > 1.8) {
    return {
      a: mat.a / scaleX,
      b: mat.b / scaleX,
      c: mat.c / scaleY,
      d: mat.d / scaleY,
      e: mat.e,
      f: mat.f,
    };
  }
  return mat;
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
        const docHandle =
          typeof engine.getDocumentHandle === 'function'
            ? engine.getDocumentHandle()
            : 0;
        const bitmap = extractImageObjectBitmap(
          engine,
          mod,
          docHandle,
          pageHandle,
          objHandle,
        );
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

const FPDF_PAGEOBJ_TEXT = 1;

interface SurvivingSegment {
  text: string;
  originX: number;
  originY: number;
  fontSize: number;
  startCharIndex: number;
  fontFamily?: string;
  rawFontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  color?: ColorRgba;
}

interface LineCharToken {
  charData: PageCharacter;
  hasPrecedingSpace: boolean;
  fontFamily?: string;
  rawFontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  color?: ColorRgba;
}

interface LineTextObjectInfo {
  index: number;
  handle: number;
  left: number;
  bottom: number;
  right: number;
  top: number;
  matrix: PdfMatrix | null;
}

type RedactTargetLine = Partial<TextLine> & {
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
  hasBulletPrefix?: boolean;
  bulletWord?: TextWord;
};

function extractLineCharTokens(
  line: RedactTargetLine,
  charMap: Map<number, PageCharacter>,
  allCharacters: PageCharacter[]
): LineCharToken[] {
  const tokens: LineCharToken[] = [];

  const lineWords: TextWord[] = [];
  if (line.hasBulletPrefix && line.bulletWord) {
    lineWords.push(line.bulletWord);
  }
  if (line.words && line.words.length > 0) {
    for (const w of line.words) {
      if (w !== line.bulletWord) {
        lineWords.push(w);
      }
    }
  }

  if (lineWords.length > 0) {
    for (let wIdx = 0; wIdx < lineWords.length; wIdx++) {
      const word = lineWords[wIdx];
      const prevWord = wIdx > 0 ? lineWords[wIdx - 1] : null;
      const hasSpace = prevWord
        ? Boolean(word.hasPrecedingSpace) || (word.left - prevWord.right) >= Math.min(prevWord.fontSize, word.fontSize) * 0.18
        : false;

      if (word.charIndices && word.charIndices.length > 0) {
        let addedInWord = 0;
        for (let k = 0; k < word.charIndices.length; k++) {
          const cIdx = word.charIndices[k];
          const charData = charMap.get(cIdx);
          if (charData && charData.unicode.trim().length > 0) {
            tokens.push({
              charData,
              hasPrecedingSpace: addedInWord === 0 ? hasSpace : false,
              fontFamily: word.fontFamily || line.fontFamily,
              rawFontFamily: word.rawFontFamily || line.rawFontFamily,
              fontWeight: word.fontWeight || line.fontWeight,
              fontStyle: word.fontStyle || line.fontStyle,
              color: word.color || line.color,
            });
            addedInWord++;
          }
        }
      } else {
        let addedInWord = 0;
        for (let k = 0; k < word.charCount; k++) {
          const cIdx = word.charStartIndex + k;
          const charData = charMap.get(cIdx);
          if (charData && charData.unicode.trim().length > 0) {
            tokens.push({
              charData,
              hasPrecedingSpace: addedInWord === 0 ? hasSpace : false,
              fontFamily: word.fontFamily || line.fontFamily,
              rawFontFamily: word.rawFontFamily || line.rawFontFamily,
              fontWeight: word.fontWeight || line.fontWeight,
              fontStyle: word.fontStyle || line.fontStyle,
              color: word.color || line.color,
            });
            addedInWord++;
          }
        }
      }
    }
  }

  if (tokens.length === 0) {
    const baselineTol = Math.max(2.5, line.fontSize * 0.25);
    const effectiveLeft = line.hasBulletPrefix && line.bulletWord
      ? Math.min(line.left, line.bulletWord.left)
      : line.left;
    const effectiveRight = line.left + line.width;

    const matched = allCharacters.filter((c) => {
      if (c.unicode.trim().length === 0) return false;
      const cLeft = c.domLeft !== undefined ? c.domLeft : c.left;
      const cRight = c.domRight !== undefined ? c.domRight : c.right;
      return (
        Math.abs(c.originY - line.baselineY) <= baselineTol &&
        cLeft >= effectiveLeft - 2.5 &&
        cRight <= effectiveRight + 2.5
      );
    });
    matched.sort((a, b) => a.originX - b.originX);

    for (let i = 0; i < matched.length; i++) {
      const c = matched[i];
      const prev = i > 0 ? matched[i - 1] : null;
      const hasSpace = prev ? (c.left - prev.right) >= Math.min(prev.fontSize, c.fontSize) * 0.18 : false;
      tokens.push({
        charData: c,
        hasPrecedingSpace: hasSpace,
        fontFamily: line.fontFamily,
        rawFontFamily: line.rawFontFamily,
        fontWeight: line.fontWeight,
        fontStyle: line.fontStyle,
        color: line.color,
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
  let lastUnredactedChar: PageCharacter | null = null;
  let lineHasRedacted = false;

  const flushCurrentSegment = (): void => {
    if (currentSeg) {
      currentSeg.text = currentSeg.text.trimEnd();
      if (currentSeg.text.length > 0) {
        survivingSegments.push(currentSeg);
      }
      currentSeg = null;
    }
  };

  for (const token of tokens) {
    const isCharRedacted = isRedacted(token.charData.charIndex);
    if (isCharRedacted) {
      lineHasRedacted = true;
      handledCharIndices.add(token.charData.charIndex);
      flushCurrentSegment();
      lastUnredactedChar = null;
    } else {
      if (token.charData.unicode.trim().length === 0) {
        continue;
      }

      if (currentSeg && lastUnredactedChar) {
        const horizontalGap = token.charData.left - lastUnredactedChar.right;
        const maxIntraSegmentGap = Math.min(
          32,
          Math.max(16, Math.max(lastUnredactedChar.fontSize, token.charData.fontSize) * 1.8)
        );
        if (horizontalGap > maxIntraSegmentGap) {
          flushCurrentSegment();
        }
      }

      if (!currentSeg) {
        currentSeg = {
          text: token.charData.unicode,
          originX: token.charData.originX,
          originY: token.charData.originY,
          fontSize: token.charData.fontSize,
          startCharIndex: token.charData.charIndex,
          fontFamily: token.fontFamily,
          rawFontFamily: token.rawFontFamily,
          fontWeight: token.fontWeight,
          fontStyle: token.fontStyle,
          color: token.color,
        };
      } else {
        const needsSpace =
          token.hasPrecedingSpace ||
          (lastUnredactedChar !== null &&
            (token.charData.left - lastUnredactedChar.right) >=
              Math.min(lastUnredactedChar.fontSize, token.charData.fontSize) * 0.18);
        if (needsSpace && !currentSeg.text.endsWith(' ')) {
          currentSeg.text += ' ';
        }
        currentSeg.text += token.charData.unicode;
      }

      lastUnredactedChar = token.charData;
    }
  }

  flushCurrentSegment();

  return { survivingSegments, lineHasRedacted };
}

function findLineTextObjects(
  engine: PdfiumEngine,
  mod: ReturnType<PdfiumEngine['getModule']>,
  pageHandle: number,
  line: RedactTargetLine
): LineTextObjectInfo[] {
  const effectiveLeft = line.hasBulletPrefix && line.bulletWord
    ? Math.min(line.left, line.bulletWord.left)
    : line.left;
  const effectiveRight = line.left + line.width;
  const effectiveWidth = Math.max(1, effectiveRight - effectiveLeft);

  const centerMatched = findTextObjectIndicesForSpan(
    engine,
    mod,
    pageHandle,
    effectiveLeft,
    line.baselineY,
    effectiveWidth,
    line.fontSize
  );

  const hasBoundsApi =
    typeof mod.FPDFPageObj_GetBounds === 'function' &&
    typeof mod.FPDFPage_CountObjects === 'function' &&
    typeof mod.FPDFPage_GetObject === 'function';

  if (!hasBoundsApi) {
    return centerMatched.map((idx) => {
      const handle = typeof mod.FPDFPage_GetObject === 'function'
        ? mod.FPDFPage_GetObject(pageHandle, idx)
        : 0;
      return {
        index: idx,
        handle,
        left: 0,
        bottom: 0,
        right: 0,
        top: 0,
        matrix: handle ? getPageObjectMatrix(engine, mod, handle) : null,
      };
    });
  }

  const matchedIndexSet = new Set<number>(centerMatched);
  const objectCount = mod.FPDFPage_CountObjects(pageHandle);
  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const pdfLeft = effectiveLeft + cropInfo.cropLeft;
  const targetLeft = pdfLeft - 1;
  const targetRight = pdfLeft + effectiveWidth + 1;
  const targetBottom = line.baselineY - line.fontSize * 0.5;
  const targetTop = line.baselineY + line.fontSize * 1.2;
  const { leftPtr, bottomPtr, rightPtr, topPtr } = engine.getBoundsScratchBuffer();

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

  return modified;
}

/**
 * Permanently redacts only the characters in the specified character range [startCharIndex, endCharIndex]
 * from the PDF page content stream.
 *
 * Uses centre-containment span matching and character-level replacement to ensure that
 * only the selected characters are removed, leaving neighbouring text and surrounding
 * spans completely intact.
 *
 * @param engine The PDFium engine instance.
 * @param _docHandle The active document handle.
 * @param pageIndex Zero-based page index.
 * @param pageHandle The active page handle.
 * @param startCharIndex Starting character index (inclusive).
 * @param endCharIndex Ending character index (inclusive).
 * @returns True if page content was modified.
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
  const docHandle = _docHandle || engine.getDocumentHandle() || 0;
  const minIndex = Math.min(startCharIndex, endCharIndex);
  const maxIndex = Math.max(startCharIndex, endCharIndex);

  const allCharacters = extractPageCharacters(engine, pageIndex, pageHandle);
  const charMap = new Map<number, PageCharacter>();
  for (const c of allCharacters) {
    charMap.set(c.charIndex, c);
  }

  const spans = extractEditableSpans(engine, pageIndex, pageHandle);
  let modified = false;

  const handledCharIndices = new Set<number>();
  const isRedacted = (charIndex: number): boolean => charIndex >= minIndex && charIndex <= maxIndex;

  for (const span of spans) {
    const spanStart = span.charStartIndex;
    const spanEnd = span.charStartIndex + span.charCount - 1;

    // Check if span has any overlap with the selected redaction range
    if (spanEnd < minIndex || spanStart > maxIndex) {
      // No overlap: leave completely untouched to preserve neighbours
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
      // Partial overlap: partition lines into origin-anchored surviving segments
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
  }

  // Handle any remaining standalone characters in the selection that were not in clustered spans
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

  if (modified) {
    mod.FPDFPage_GenerateContent(pageHandle);
  }

  return modified;
}


