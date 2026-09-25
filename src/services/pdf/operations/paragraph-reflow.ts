import type { PdfiumEngine } from '../../../core/pdfium-engine';
import type {
  ColorRgba,
  EditableTextSpan,
  PdfMatrix,
  StandardFontName,
  TextMutationOptions,
  TextLine,
  TextWord,
} from '../../../core/types';
import {
  encodeUtf16Le,
  setPageObjectMatrix,
  mapStandardFontName,
  calculateTextWidth,
  findTextObjectIndicesForSpan,
  removeTextObjectsByIndex,
  setTextObjectByIndex,
  getPageObjectMatrix,
  getPageCropInfo,
} from '../../../core/pdfium-helpers';
import { FontCharsetIndex, extractBaseFontFamily, isStandard14Font } from '../font-charset-index';
import { isColorEqual, sanitizePdfText, safeEncodeForStandardFont, parseColor } from '../utils';
import { detectParagraphs } from './paragraph-detector';
import { resolveStandardFont } from './draw-text';
import { UNICODE_TRAILING_WS_REGEX, UNICODE_LEADING_WS_REGEX, findBestMatchingOrigLine } from '../../../utils/text-range-utils';

/**
 * Result metrics returned after reflowing a paragraph.
 */
export interface ReflowResult {
  reflowedLines: string[];
  newHeight: number;
  deltaY: number;
  affectedSpansCount: number;
}

/**
 * Breaks a single word that exceeds the maximum available width into character chunks.
 *
 * @param word The long word string to break.
 * @param maxWidth Maximum available column width in points.
 * @param fontSize Font size in points.
 * @param fontName Standard PDF font name for glyph measurement.
 * @return An array of broken word chunks.
 */
function breakLongWord(
  word: string,
  maxWidth: number,
  fontSize: number,
  fontName: StandardFontName
): string[] {
  const chunks: string[] = [];
  let currentChunk = '';
  for (const char of word) {
    const test = currentChunk + char;
    if (currentChunk.length === 0 || calculateTextWidth(test, fontSize, fontName) <= maxWidth) {
      currentChunk = test;
    } else {
      chunks.push(currentChunk);
      currentChunk = char;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
}

/**
 * Wraps text into lines fitted to a target maximum column width.
 * Respects explicit newlines while greedily wrapping words.
 *
 * @param text The input multi-line string.
 * @param maxWidth Maximum available column width in points.
 * @param fontSize Font size in points.
 * @param fontName Standard PDF font name for glyph measurement.
 * @return An array of wrapped line strings.
 */
export function wrapTextToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontName: StandardFontName
): string[] {
  const effectiveWidth = Math.max(30, maxWidth);
  // Typographic advance tolerance: character ink bounding boxes are narrower than
  // font advance metrics by glyph sidebearings. Add tolerance so that normal
  // advance width discrepancies never prematurely word-wrap the last word of a line.
  const advanceTolerance = Math.max(4, fontSize * 0.35);
  const rawParagraphs = text.split(/\r?\n/);
  const resultLines: string[] = [];

  for (const rawPara of rawParagraphs) {
    const trimmedPara = rawPara.trim();
    if (trimmedPara.length === 0) {
      resultLines.push('');
      continue;
    }

    const fullLineWidth = calculateTextWidth(trimmedPara, fontSize, fontName);
    if (fullLineWidth <= effectiveWidth + advanceTolerance) {
      resultLines.push(trimmedPara);
      continue;
    }

    const rawWords = trimmedPara.split(/\s+/).filter((w) => w.length > 0);
    if (rawWords.length === 0) {
      resultLines.push('');
      continue;
    }

    // Expand words that individually exceed effectiveWidth into broken chunks
    const words: string[] = [];
    for (const w of rawWords) {
      const wWidth = calculateTextWidth(w, fontSize, fontName);
      if (wWidth > effectiveWidth + advanceTolerance) {
        words.push(...breakLongWord(w, effectiveWidth, fontSize, fontName));
      } else {
        words.push(w);
      }
    }

    const spaceWidth = calculateTextWidth(' ', fontSize, fontName);
    let currentLine = words[0];
    let currentLineWidth = calculateTextWidth(words[0], fontSize, fontName);

    for (let i = 1; i < words.length; i++) {
      const nextWord = words[i];
      const nextWordWidth = calculateTextWidth(nextWord, fontSize, fontName);

      if (currentLineWidth + spaceWidth + nextWordWidth <= effectiveWidth + advanceTolerance) {
        currentLine = `${currentLine} ${nextWord}`;
        currentLineWidth += spaceWidth + nextWordWidth;
      } else {
        resultLines.push(currentLine);
        currentLine = nextWord;
        currentLineWidth = nextWordWidth;
      }
    }

    if (currentLine.length > 0) {
      resultLines.push(currentLine);
    }
  }

  return resultLines.filter((l, idx, arr) => !(l === '' && idx === arr.length - 1 && arr.length > 1));
}

/**
 * Replaces a paragraph block with newly edited/reflowed text and automatically
 * shifts all downstream content up or down to preserve natural vertical page whitespace.
 * Preserves embedded font subset in-place when characters and line structure permit.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle Active document handle.
 * @param pageIndex Zero-based page index.
 * @param pageHandle Active page handle.
 * @param targetParagraph The paragraph span being edited.
 * @param options Mutation options with updated text, font, and color.
 * @param charsetIndex Optional document font character availability index.
 * @return ReflowResult summary with line count and vertical delta.
 */
export function reflowAndReplaceParagraph(
  engine: PdfiumEngine,
  docHandle: number,
  pageIndex: number,
  pageHandle: number,
  targetParagraph: EditableTextSpan,
  options: TextMutationOptions,
  charsetIndex?: FontCharsetIndex
): ReflowResult {
  const mod = engine.getModule();

  const updatedText = options.text !== undefined ? options.text : targetParagraph.text;
  const updatedFontSize = options.fontSize !== undefined ? options.fontSize : targetParagraph.fontSize;
  const rawFontName = options.fontFamily || targetParagraph.fontFamily || 'Helvetica';
  const standardFontName: StandardFontName = mapStandardFontName(
    rawFontName,
    options.fontWeight || targetParagraph.fontWeight,
    options.fontStyle || targetParagraph.fontStyle
  );
  const updatedColor: ColorRgba = options.color || targetParagraph.color;
  const targetLeft = options.left !== undefined ? options.left : targetParagraph.left;
  const lineHeight = options.lineHeight || targetParagraph.lineHeight || updatedFontSize * 1.25;

  const isDeletion = updatedText.trim().length === 0;

  // Determine wrapping width
  const isTargetBullet = targetParagraph.hasBulletPrefix && targetParagraph.bulletWord;
  const firstLineTextLeft = targetParagraph.lines && targetParagraph.lines.length > 0
    ? targetParagraph.lines[0].left
    : (isTargetBullet ? targetParagraph.bulletWord!.right + 6 : targetLeft);
  const firstLineIndent = Math.max(0, firstLineTextLeft - targetLeft);

  const isSingleLineText =
    !targetParagraph.isParagraph &&
    (!targetParagraph.lines || targetParagraph.lines.length <= 1) &&
    !updatedText.includes('\n');

  let wrapWidth: number;
  if (isTargetBullet) {
    wrapWidth = Math.max(20, targetParagraph.width - Math.max(0, firstLineTextLeft - targetParagraph.left));
  } else if (isSingleLineText) {
    const pageWidth = mod.FPDF_GetPageWidthF(pageHandle);
    const maxAvailableWidth = Math.max(targetParagraph.width, Math.min(pageWidth - targetParagraph.left - 36, 500));
    wrapWidth = maxAvailableWidth;
  } else {
    const wrapBuffer = Math.max(6, updatedFontSize * 0.5);
    wrapWidth = targetParagraph.width + wrapBuffer;
  }

  // 1. Wrap text into lines fitting column width
  interface ReflowedLineItem {
    text: string;
    sourceLine?: TextLine;
    isContinuation: boolean;
  }
  let reflowedItems: ReflowedLineItem[];
  const firstLineWidth = Math.max(20, wrapWidth - firstLineIndent);
  if (isDeletion) {
    reflowedItems = [];
  } else if (options.lines && options.lines.length > 0) {
    reflowedItems = [];
    for (let idx = 0; idx < options.lines.length; idx++) {
      const l = options.lines[idx];
      const lineText = l.text ? l.text.replace(/[\r\n]+/g, ' ').trim() : '';
      if (!lineText) continue;
      const lineWrapW = idx === 0 ? firstLineWidth : wrapWidth;
      const wrapped = wrapTextToWidth(lineText, lineWrapW, updatedFontSize, standardFontName).filter((s) => s.trim().length > 0);
      for (let wIdx = 0; wIdx < wrapped.length; wIdx++) {
        reflowedItems.push({
          text: wrapped[wIdx],
          sourceLine: l,
          isContinuation: wIdx > 0,
        });
      }
    }
  } else if (updatedText.includes('\n')) {
    reflowedItems = [];
    const rawSegments = updatedText.split(/\r?\n/);
    for (let idx = 0; idx < rawSegments.length; idx++) {
      const trimmedSegment = rawSegments[idx].trim();
      if (!trimmedSegment) continue;
      const lineWrapW = idx === 0 ? firstLineWidth : wrapWidth;
      const wrapped = wrapTextToWidth(trimmedSegment, lineWrapW, updatedFontSize, standardFontName).filter((s) => s.trim().length > 0);
      const srcLine = findBestMatchingOrigLine(trimmedSegment, targetParagraph.lines, idx) || targetParagraph.lines?.[Math.min(idx, (targetParagraph.lines?.length || 1) - 1)];
      for (let wIdx = 0; wIdx < wrapped.length; wIdx++) {
        reflowedItems.push({
          text: wrapped[wIdx],
          sourceLine: srcLine,
          isContinuation: wIdx > 0,
        });
      }
    }
  } else {
    reflowedItems = [];
    const initialWrapped = wrapTextToWidth(updatedText.trim(), firstLineWidth, updatedFontSize, standardFontName).filter((s) => s.trim().length > 0);
    const srcLine = targetParagraph.lines?.[0];
    if (initialWrapped.length > 1) {
      reflowedItems.push({ text: initialWrapped[0], sourceLine: srcLine, isContinuation: false });
      const restText = initialWrapped.slice(1).join(' ');
      const restWrapped = wrapTextToWidth(restText, wrapWidth, updatedFontSize, standardFontName).filter((s) => s.trim().length > 0);
      for (const w of restWrapped) {
        reflowedItems.push({ text: w, sourceLine: srcLine, isContinuation: true });
      }
    } else if (initialWrapped.length === 1) {
      reflowedItems.push({ text: initialWrapped[0], sourceLine: srcLine, isContinuation: false });
    }
  }
  const reflowedLines: string[] = reflowedItems.map((item) => item.text);

  // 2. Compute height and line change
  const targetLines: Array<{
    left: number;
    baselineY: number;
    width: number;
    fontSize: number;
    hasBulletPrefix?: boolean;
    bulletWord?: TextWord;
    color?: ColorRgba;
    words?: TextWord[];
    fontFamily?: string;
    rawFontFamily?: string;
    fontWeight?: string;
    fontStyle?: string;
  }> = targetParagraph.lines && targetParagraph.lines.length > 0
    ? targetParagraph.lines
    : [{
        left: targetParagraph.left,
        baselineY: targetParagraph.baselineY,
        width: targetParagraph.width,
        fontSize: targetParagraph.fontSize,
        hasBulletPrefix: targetParagraph.hasBulletPrefix,
        bulletWord: targetParagraph.bulletWord,
        color: targetParagraph.color,
        fontFamily: targetParagraph.fontFamily,
        rawFontFamily: targetParagraph.rawFontFamily,
        fontWeight: targetParagraph.fontWeight,
        fontStyle: targetParagraph.fontStyle,
      }];

  const oldLineCount = targetLines.length;
  const newLineCount = isDeletion ? 0 : reflowedLines.length;
  const deltaLines = newLineCount - oldLineCount;
  const deltaY = deltaLines * lineHeight;
  const newHeight = isDeletion
    ? 0
    : Math.max(updatedFontSize * 1.2, (reflowedLines.length - 1) * lineHeight + updatedFontSize * 1.2);

  // Detect if the target paragraph or mutation options have mixed font sizes across lines or words
  const hasMixedFontSize =
    (targetParagraph.lines && targetParagraph.lines.some((l) => Math.abs(l.fontSize - targetParagraph.lines![0].fontSize) > 0.2)) ||
    (targetParagraph.lines && targetParagraph.lines.some((l) => l.words && l.words.some((w) => Math.abs(w.fontSize - l.words[0].fontSize) > 0.2))) ||
    (options.lines && options.lines.some((l) => Math.abs(l.fontSize - options.lines![0].fontSize) > 0.2)) ||
    (options.lines && options.lines.some((l) => l.words && l.words.some((w) => Math.abs(w.fontSize - l.words[0].fontSize) > 0.2)));

  // Check if options lines contain words with distinct styles (weights, styles, colors)
  const hasMixedStyleWords = Boolean(
    options.lines &&
    options.lines.some(
      (l) =>
        l.words &&
        l.words.some(
          (w) =>
            (w.fontWeight && w.fontWeight !== (targetParagraph.fontWeight || 'normal')) ||
            (w.fontStyle && w.fontStyle !== (targetParagraph.fontStyle || 'normal')) ||
            (w.color && !isColorEqual(w.color, targetParagraph.color)) ||
            Boolean(w.backgroundColor)
        )
    )
  );

  // In-place subset preservation path
  // If font properties are unchanged, no mixed font sizes or styles, and line count matches, try in-place edit using embedded font
  const isOnlyTextChanged =
    !hasMixedFontSize &&
    !hasMixedStyleWords &&
    (options.fontSize === undefined || Math.abs(options.fontSize - targetParagraph.fontSize) < 0.1) &&
    (options.fontFamily === undefined ||
      options.fontFamily === targetParagraph.fontFamily ||
      extractBaseFontFamily(options.fontFamily) === extractBaseFontFamily(targetParagraph.rawFontFamily)) &&
    (options.color === undefined || isColorEqual(options.color, targetParagraph.color));

  if (!isDeletion && isOnlyTextChanged && reflowedLines.length === targetLines.length) {
    let charsAvailable = false;
    const font = targetParagraph.rawFontFamily || targetParagraph.fontFamily;
    const hasWhitespace = updatedText.includes(' ') || updatedText.includes('\t') || updatedText.includes('\n') || updatedText.includes('\r');

    if (hasWhitespace && !isStandard14Font(font)) {
      charsAvailable = false;
    } else if (charsetIndex) {
      charsAvailable = charsetIndex.hasAllChars(updatedText, font, targetParagraph.text);
    } else {
      const origText = targetParagraph.text;
      const nonWs = Array.from(updatedText).filter((c) => c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r');
      charsAvailable = nonWs.every((char) => origText.includes(char));
    }

    if (charsAvailable) {
      let allUpdated = true;
      for (let i = 0; i < reflowedLines.length; i++) {
        const line = targetLines[i];
        const lineIndices = findTextObjectIndicesForSpan(
          engine, mod, pageHandle,
          line.left, line.baselineY, line.width, line.fontSize
        );
        if (lineIndices.length !== 1) {
          allUpdated = false;
          break;
        }
        // lineIndices are already sorted geometrically (left-to-right)
        const ok = setTextObjectByIndex(engine, mod, pageHandle, lineIndices[0], reflowedLines[i]);
        if (!ok) {
          allUpdated = false;
          break;
        }
        for (let k = 1; k < lineIndices.length; k++) {
          setTextObjectByIndex(engine, mod, pageHandle, lineIndices[k], ' ');
        }
      }

      if (allUpdated) {
        mod.FPDFPage_GenerateContent(pageHandle);
        return {
          reflowedLines,
          newHeight,
          deltaY: 0,
          affectedSpansCount: 0,
        };
      }
    }
  }

  // 3. Find all spans on the page to identify downstream paragraphs that need shifting
  const allPageSpans = detectParagraphs(engine, pageIndex, pageHandle);

  // Identify downstream paragraphs sharing the column
  const downstreamSpans = allPageSpans
    .filter((s) => {
      if (s.id === targetParagraph.id) return false;
      const isBelow = s.top >= targetParagraph.top + targetParagraph.height - 4.0 || s.baselineY < targetParagraph.baselineY - (oldLineCount - 1) * lineHeight - 4.0;
      if (!isBelow) return false;

      // Column overlap check: require positive overlap and substantial width coverage
      const minColWidth = Math.min(s.width, targetParagraph.width);
      const overlap = Math.min(s.left + s.width, targetParagraph.left + targetParagraph.width) - Math.max(s.left, targetParagraph.left);
      return overlap > 15.0 && overlap > minColWidth * 0.25;
    })
    .sort((a, b) => a.top - b.top);

  const needsDownstreamShift = Math.abs(deltaY) > 0.5 && downstreamSpans.length > 0;

  // 4. Collect ALL backing PDF text objects to remove in one batch
  const allIndicesToRemove = new Set<number>();
  let origMatrix: PdfMatrix | null = null;

  for (const line of targetLines) {
    const indices = findTextObjectIndicesForSpan(
      engine, mod, pageHandle,
      line.left, line.baselineY, line.width, line.fontSize
    );
    for (const idx of indices) {
      allIndicesToRemove.add(idx);
      if (!origMatrix) {
        const objHandle = mod.FPDFPage_GetObject(pageHandle, idx);
        if (objHandle) {
          origMatrix = getPageObjectMatrix(engine, mod, objHandle);
        }
      }
    }
    // Only remove bullet object if the entire paragraph is being deleted
    if (isDeletion && line.hasBulletPrefix && line.bulletWord) {
      const bIndices = findTextObjectIndicesForSpan(
        engine, mod, pageHandle,
        line.bulletWord.left, line.bulletWord.baselineY || line.baselineY, line.bulletWord.width + 4, line.bulletWord.fontSize
      );
      for (const idx of bIndices) {
        allIndicesToRemove.add(idx);
      }
    }
  }

  // If deleting paragraph completely, also remove any remaining target bullet objects
  if (isDeletion && targetParagraph.hasBulletPrefix && targetParagraph.bulletWord) {
    const bulletIndices = findTextObjectIndicesForSpan(
      engine, mod, pageHandle,
      targetParagraph.bulletWord.left, targetParagraph.bulletWord.baselineY || targetParagraph.baselineY, targetParagraph.bulletWord.width + 4, targetParagraph.bulletWord.fontSize
    );
    for (const idx of bulletIndices) {
      allIndicesToRemove.add(idx);
    }
  }

  // Remove all targeted objects in one atomic batch
  if (allIndicesToRemove.size > 0) {
    removeTextObjectsByIndex(mod, pageHandle, Array.from(allIndicesToRemove));
  }

  // 5. Insert reflowed replacement lines for target paragraph
  let fontHandle = 0;
  const newObjectHandles = new Set<number>();
  try {
    if (!isDeletion && reflowedLines.length > 0) {
      fontHandle = mod.FPDFText_LoadStandardFont(docHandle, standardFontName);
      if (!fontHandle) fontHandle = mod.FPDFText_LoadStandardFont(docHandle, 'Helvetica');

      const standardFontCache = new Map<string, number>();
      if (standardFontName && fontHandle) {
        standardFontCache.set(standardFontName, fontHandle);
      }
      const getStandardFontHandle = (name: string): number => {
        let h = standardFontCache.get(name);
        if (!h) {
          h = mod.FPDFText_LoadStandardFont(docHandle, name) || fontHandle;
          standardFontCache.set(name, h);
        }
        return h;
      };

      let renderedLineIdx = 0;
      for (let i = 0; i < reflowedItems.length; i++) {
        const item = reflowedItems[i];
        const lineText = item.text;
        if (lineText.trim().length === 0) continue;

        // Use direct PDF baseline coordinates
        const lineBaselineY = targetParagraph.baselineY - renderedLineIdx * lineHeight;

        const origLine = item.sourceLine || findBestMatchingOrigLine(lineText, options.lines || targetParagraph.lines, renderedLineIdx) || options.lines?.[renderedLineIdx] || (targetParagraph.lines && targetParagraph.lines[renderedLineIdx] ? targetParagraph.lines[renderedLineIdx] : undefined);
        renderedLineIdx++;

        let lineLeft = targetLeft;
        if (isTargetBullet && renderedLineIdx === 1) {
          lineLeft = firstLineTextLeft;
        } else if (options.left !== undefined) {
          lineLeft = options.left;
        } else if (origLine && origLine.left !== undefined) {
          lineLeft = origLine.left;
        } else {
          lineLeft = targetLeft;
        }

        const isExactLineWords = Boolean(origLine?.words && !item.isContinuation && origLine.text === lineText);
        let wordsToRender: TextWord[] | undefined;
        if (isExactLineWords && origLine?.words) {
          wordsToRender = origLine.words;
        } else if (item.sourceLine?.words && item.sourceLine.words.length > 0) {
          wordsToRender = item.sourceLine.words;
        } else if (origLine?.words && origLine.words.length > 0) {
          const tokens = lineText.split(/([\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+)/);
          const freshWords: TextWord[] = [];
          let currentTokenLeft = lineLeft;
          let pendingSpace = false;
          let origWordIdx = 0;

          for (const token of tokens) {
            if (!token) continue;
            if (/^[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+$/.test(token)) {
              pendingSpace = true;
              continue;
            }
            const clean = sanitizePdfText(token);
            if (!clean) continue;

            const matchedOrig = origLine.words.find((w) => w.text === clean) || origLine.words[Math.min(origWordIdx, origLine.words.length - 1)];
            origWordIdx++;

            const wordFs = matchedOrig?.fontSize || origLine.fontSize || updatedFontSize;
            const approxCharW = wordFs * 0.52;
            const wordW = matchedOrig?.width && matchedOrig.width > 0 ? matchedOrig.width : clean.length * approxCharW;

            if (pendingSpace) {
              currentTokenLeft += wordFs * 0.25;
            }

            freshWords.push({
              text: clean,
              left: currentTokenLeft,
              top: matchedOrig?.top || origLine.top || 0,
              right: currentTokenLeft + wordW,
              bottom: (matchedOrig?.top || origLine.top || 0) + wordFs,
              width: wordW,
              height: matchedOrig?.height || origLine.height || wordFs,
              fontSize: wordFs,
              baselineY: matchedOrig?.baselineY || lineBaselineY,
              charStartIndex: 0,
              charCount: clean.length,
              fontFamily: matchedOrig?.fontFamily || origLine.fontFamily,
              rawFontFamily: matchedOrig?.rawFontFamily || origLine.rawFontFamily,
              color: matchedOrig?.color || origLine.color,
              fontWeight: matchedOrig?.fontWeight || origLine.fontWeight,
              fontStyle: matchedOrig?.fontStyle || origLine.fontStyle,
              hasPrecedingSpace: pendingSpace || freshWords.length > 0,
            });

            currentTokenLeft += wordW;
            pendingSpace = false;
          }
          wordsToRender = freshWords;
        }

        const hasMultiStyleWords =
          Boolean(wordsToRender &&
          wordsToRender.length > 1 &&
          wordsToRender.some(
            (w: TextWord) =>
              Math.abs(w.fontSize - wordsToRender[0].fontSize) > 0.2 ||
              (w.fontWeight && w.fontWeight !== wordsToRender[0].fontWeight) ||
              (w.fontStyle && w.fontStyle !== wordsToRender[0].fontStyle) ||
              (w.color && wordsToRender[0].color && !isColorEqual(w.color, wordsToRender[0].color))
          ));

        if (hasMultiStyleWords && wordsToRender) {
          // Draw individual styled words to preserve multiple distinct font sizes and colors on the line
          let currentWordX = lineLeft;
          let lastRenderedWord: TextWord | null = null;
          for (let wIdx = 0; wIdx < wordsToRender.length; wIdx++) {
            const word = wordsToRender[wIdx];
            const cleanWord = sanitizePdfText(word.text);
            if (!cleanWord || cleanWord.length === 0) continue;

            let needsSpace = false;
            if (lastRenderedWord) {
              const gap = word.left - lastRenderedWord.right;
              const minFs = Math.min(lastRenderedWord.fontSize, word.fontSize);
              const endsWithWs = UNICODE_TRAILING_WS_REGEX.test(lastRenderedWord.text);
              const startsWithWs = UNICODE_LEADING_WS_REGEX.test(cleanWord);
              needsSpace =
                !endsWithWs &&
                !startsWithWs &&
                (Boolean(word.hasPrecedingSpace) || gap >= minFs * 0.12 || gap >= 0.5);
            }

            const wordFontSize = options.fontSize !== undefined && Math.abs(options.fontSize - targetParagraph.fontSize) > 0.1
              ? Math.max(1, word.fontSize * (options.fontSize / targetParagraph.fontSize))
              : word.fontSize;

            const wordFontName = resolveStandardFont(
              word.fontFamily || origLine?.fontFamily || rawFontName,
              word.rawFontFamily || origLine?.rawFontFamily || targetParagraph.rawFontFamily,
              (word.fontWeight as 'bold' | 'normal') || (origLine?.fontWeight as 'bold' | 'normal') || options.fontWeight || (targetParagraph.fontWeight as 'bold' | 'normal'),
              (word.fontStyle as 'italic' | 'normal') || (origLine?.fontStyle as 'italic' | 'normal') || options.fontStyle || (targetParagraph.fontStyle as 'italic' | 'normal')
            );
            const wordFontHandle = getStandardFontHandle(wordFontName);

            // Prepend space glyph to encoded string when space is needed so PDFium creates explicit space character in stream
            const spaceW = needsSpace ? calculateTextWidth(' ', wordFontSize, wordFontName) : 0;
            const textToRender = needsSpace ? ` ${cleanWord}` : cleanWord;
            const fullRenderedWidth = calculateTextWidth(textToRender, wordFontSize, wordFontName);
            const wordWidthOnly = calculateTextWidth(cleanWord, wordFontSize, wordFontName);

            const wordBgColorStr = word.backgroundColor || options.backgroundColor;
            if (wordBgColorStr) {
              const bgCol = parseColor(wordBgColorStr);
              if (bgCol.a > 0) {
                const rectBottom = Math.max(0, lineBaselineY - wordFontSize * 0.25);
                const rectH = wordFontSize * 1.25;
                const bgRect = mod.FPDFPageObj_CreateNewRect(currentWordX + spaceW, rectBottom, wordWidthOnly, rectH);
                if (bgRect) {
                  mod.FPDFPageObj_SetFillColor(bgRect, bgCol.r, bgCol.g, bgCol.b, bgCol.a);
                  mod.FPDFPath_SetDrawMode(bgRect, 1, false);
                  mod.FPDFPage_InsertObject(pageHandle, bgRect);
                  newObjectHandles.add(bgRect);
                }
              }
            }

            const wordBuf = encodeUtf16Le(engine, safeEncodeForStandardFont(textToRender));
            try {
              const wordObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, wordFontHandle, wordFontSize);
              if (wordObjHandle) {
                mod.FPDFText_SetText(wordObjHandle, wordBuf.ptr);
                const wCol = word.color || origLine?.color || updatedColor;
                mod.FPDFPageObj_SetFillColor(wordObjHandle, wCol.r, wCol.g, wCol.b, wCol.a);
                const matrix = {
                  a: origMatrix ? origMatrix.a : 1,
                  b: origMatrix ? origMatrix.b : 0,
                  c: origMatrix ? origMatrix.c : 0,
                  d: origMatrix ? origMatrix.d : 1,
                  e: currentWordX,
                  f: lineBaselineY
                };
                setPageObjectMatrix(engine, mod, wordObjHandle, matrix);
                mod.FPDFPage_InsertObject(pageHandle, wordObjHandle);
                newObjectHandles.add(wordObjHandle);
              }
            } finally {
              wordBuf.dispose();
            }
            currentWordX += fullRenderedWidth;
            lastRenderedWord = word;
          }
        } else {
          // Draw uniform single-style line
          const lineFontSize = options.fontSize !== undefined && Math.abs(options.fontSize - targetParagraph.fontSize) > 0.1
            ? (origLine?.fontSize ? Math.max(1, origLine.fontSize * (options.fontSize / targetParagraph.fontSize)) : options.fontSize)
            : (origLine?.fontSize || updatedFontSize);

          const lineFontName = resolveStandardFont(
            origLine?.fontFamily || rawFontName,
            origLine?.rawFontFamily || targetParagraph.rawFontFamily,
            (origLine?.fontWeight as 'bold' | 'normal') || options.fontWeight || (targetParagraph.fontWeight as 'bold' | 'normal'),
            (origLine?.fontStyle as 'italic' | 'normal') || options.fontStyle || (targetParagraph.fontStyle as 'italic' | 'normal')
          );
          const lineFontHandle = getStandardFontHandle(lineFontName);

          const lineBgColorStr = origLine?.backgroundColor || options.backgroundColor;
          if (lineBgColorStr) {
            const bgCol = parseColor(lineBgColorStr);
            if (bgCol.a > 0) {
              const lineWidth = calculateTextWidth(lineText, lineFontSize, lineFontName);
              const rectBottom = Math.max(0, lineBaselineY - lineFontSize * 0.25);
              const rectH = lineFontSize * 1.25;
              const bgRect = mod.FPDFPageObj_CreateNewRect(lineLeft, rectBottom, lineWidth, rectH);
              if (bgRect) {
                mod.FPDFPageObj_SetFillColor(bgRect, bgCol.r, bgCol.g, bgCol.b, bgCol.a);
                mod.FPDFPath_SetDrawMode(bgRect, 1, false);
                mod.FPDFPage_InsertObject(pageHandle, bgRect);
                newObjectHandles.add(bgRect);
              }
            }
          }

          const textBuf = encodeUtf16Le(engine, safeEncodeForStandardFont(lineText));
          try {
            const textObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, lineFontHandle, lineFontSize);
            if (textObjHandle) {
              mod.FPDFText_SetText(textObjHandle, textBuf.ptr);
              const lineCol = origLine?.color || updatedColor;
              mod.FPDFPageObj_SetFillColor(textObjHandle, lineCol.r, lineCol.g, lineCol.b, lineCol.a);
              const matrix = {
                a: origMatrix ? origMatrix.a : 1,
                b: origMatrix ? origMatrix.b : 0,
                c: origMatrix ? origMatrix.c : 0,
                d: origMatrix ? origMatrix.d : 1,
                e: lineLeft,
                f: lineBaselineY
              };
              setPageObjectMatrix(engine, mod, textObjHandle, matrix);
              mod.FPDFPage_InsertObject(pageHandle, textObjHandle);
              newObjectHandles.add(textObjHandle);
            }
          } finally {
            textBuf.dispose();
          }
        }
      }
    }

    // 6. Shift downstream spans in-place by adjusting transform matrix
    if (needsDownstreamShift) {
      const handlesToShift = new Set<number>();

      for (const dSpan of downstreamSpans) {
        const dLines = dSpan.lines && dSpan.lines.length > 0
          ? dSpan.lines
          : [{
              left: dSpan.left,
              baselineY: dSpan.baselineY,
              width: dSpan.width,
              fontSize: dSpan.fontSize,
              hasBulletPrefix: dSpan.hasBulletPrefix,
              bulletWord: dSpan.bulletWord,
            }];

        for (const line of dLines) {
          // Find text objects for downstream line
          const indices = findTextObjectIndicesForSpan(
            engine, mod, pageHandle,
            line.left, line.baselineY, line.width, line.fontSize
          );
          for (const idx of indices) {
            const objHandle = mod.FPDFPage_GetObject(pageHandle, idx);
            if (objHandle && !newObjectHandles.has(objHandle)) {
              handlesToShift.add(objHandle);
            }
          }

          // Shift downstream bullet object in-place
          if (line.hasBulletPrefix && line.bulletWord) {
            const bIndices = findTextObjectIndicesForSpan(
              engine, mod, pageHandle,
              line.bulletWord.left, line.bulletWord.baselineY || line.baselineY, line.bulletWord.width + 4, line.bulletWord.fontSize
            );
            for (const bIdx of bIndices) {
              const bObjHandle = mod.FPDFPage_GetObject(pageHandle, bIdx);
              if (bObjHandle && !newObjectHandles.has(bObjHandle)) {
                handlesToShift.add(bObjHandle);
              }
            }
          }
        }
      }

      const cropInfo = getPageCropInfo(engine, mod, pageHandle);
      for (const objHandle of handlesToShift) {
        const currentMatrix = getPageObjectMatrix(engine, mod, objHandle);
        if (currentMatrix) {
          const shiftMatrix = { ...currentMatrix };
          switch (cropInfo.rotation) {
            case 1:
              shiftMatrix.e += deltaY;
              break;
            case 2:
              shiftMatrix.f += deltaY;
              break;
            case 3:
              shiftMatrix.e -= deltaY;
              break;
            case 0:
            default:
              shiftMatrix.f -= deltaY;
              break;
          }
          setPageObjectMatrix(engine, mod, objHandle, shiftMatrix);
        }
      }
    }

    // 7. Commit page stream modifications
    mod.FPDFPage_GenerateContent(pageHandle);
  } finally {
    // Standard fonts do not need manual release
  }

  return {
    reflowedLines,
    newHeight,
    deltaY,
    affectedSpansCount: needsDownstreamShift ? downstreamSpans.length : 0,
  };
}
