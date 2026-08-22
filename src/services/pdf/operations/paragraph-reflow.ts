import type { PdfiumEngine } from '../../../core/pdfium-engine';
import type {
  ColorRgba,
  EditableTextSpan,
  StandardFontName,
  TextMutationOptions,
  TextWord,
} from '../../../core/types';
import {
  encodeUtf16Le,
  setPageObjectMatrix,
  translationMatrix,
  mapStandardFontName,
  calculateTextWidth,
  findTextObjectIndicesForSpan,
  removeTextObjectsByIndex,
  setTextObjectByIndex,
} from '../../../core/pdfium-helpers';
import { FontCharsetIndex, extractBaseFontFamily } from '../font-charset-index';
import { isColorEqual, sanitizePdfText } from '../utils';
import { detectParagraphs } from './paragraph-detector';
import { resolveStandardFont } from './draw-text';

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
  const rawParagraphs = text.split(/\r?\n/);
  const resultLines: string[] = [];

  for (const rawPara of rawParagraphs) {
    const trimmedPara = rawPara.trim();
    if (trimmedPara.length === 0) {
      resultLines.push('');
      continue;
    }

    const fullLineWidth = calculateTextWidth(trimmedPara, fontSize, fontName);
    if (fullLineWidth <= effectiveWidth) {
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
      if (wWidth > effectiveWidth) {
        words.push(...breakLongWord(w, effectiveWidth, fontSize, fontName));
      } else {
        words.push(w);
      }
    }

    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
      const nextWord = words[i];
      const testLine = `${currentLine} ${nextWord}`;
      const testWidth = calculateTextWidth(testLine, fontSize, fontName);

      if (testWidth <= effectiveWidth) {
        currentLine = testLine;
      } else {
        resultLines.push(currentLine);
        currentLine = nextWord;
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

  const wrapWidth = isTargetBullet
    ? Math.max(20, targetParagraph.width - Math.max(0, firstLineTextLeft - targetParagraph.left))
    : targetParagraph.width;

  // 1. Wrap text into lines fitting column width
  const reflowedLines = isDeletion
    ? []
    : wrapTextToWidth(updatedText, wrapWidth, updatedFontSize, standardFontName);

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

  // -- IN-PLACE SUBSET PRESERVATION PATH --
  // If font properties are unchanged, no mixed font sizes, and line count matches, try in-place edit using embedded font
  const isOnlyTextChanged =
    !hasMixedFontSize &&
    (options.fontSize === undefined || Math.abs(options.fontSize - targetParagraph.fontSize) < 0.1) &&
    (options.fontFamily === undefined ||
      options.fontFamily === targetParagraph.fontFamily ||
      extractBaseFontFamily(options.fontFamily) === extractBaseFontFamily(targetParagraph.rawFontFamily)) &&
    (options.color === undefined || isColorEqual(options.color, targetParagraph.color));

  if (!isDeletion && isOnlyTextChanged && reflowedLines.length === targetLines.length) {
    let charsAvailable = false;
    if (charsetIndex) {
      charsAvailable = charsetIndex.hasAllChars(updatedText, targetParagraph.rawFontFamily, targetParagraph.text);
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
        if (lineIndices.length === 0) {
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

      // Column overlap check
      const overlap = Math.min(s.left + s.width, targetParagraph.left + targetParagraph.width) - Math.max(s.left, targetParagraph.left);
      return overlap > -25.0;
    })
    .sort((a, b) => a.top - b.top);

  const needsDownstreamShift = Math.abs(deltaY) > 0.5 && downstreamSpans.length > 0;

  // 4. Collect ALL backing PDF text objects to remove in one batch
  const allIndicesToRemove = new Set<number>();

  for (const line of targetLines) {
    const indices = findTextObjectIndicesForSpan(
      engine, mod, pageHandle,
      line.left, line.baselineY, line.width, line.fontSize
    );
    for (const idx of indices) {
      allIndicesToRemove.add(idx);
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
  try {
    if (!isDeletion && reflowedLines.length > 0) {
      fontHandle = mod.FPDFText_LoadStandardFont(docHandle, standardFontName);
      if (!fontHandle) fontHandle = mod.FPDFText_LoadStandardFont(docHandle, 'Helvetica');

      for (let i = 0; i < reflowedLines.length; i++) {
        const lineText = reflowedLines[i];
        if (lineText.trim().length === 0) continue;

        // Use direct PDF baseline coordinates
        const lineBaselineY = targetParagraph.baselineY - i * lineHeight;

        const origLine = options.lines?.[i] || (targetParagraph.lines && targetParagraph.lines[i] ? targetParagraph.lines[i] : undefined);

        let lineLeft = targetLeft;
        if (isTargetBullet) {
          lineLeft = firstLineTextLeft;
        } else if (options.left !== undefined) {
          lineLeft = options.left;
        } else {
          lineLeft = targetLeft;
        }

        const hasMultiStyleWords =
          origLine &&
          origLine.words &&
          origLine.words.length > 1 &&
          origLine.words.some(
            (w) =>
              Math.abs(w.fontSize - origLine.words[0].fontSize) > 0.2 ||
              (w.fontWeight && w.fontWeight !== origLine.words[0].fontWeight) ||
              (w.color && origLine.words[0].color && !isColorEqual(w.color, origLine.words[0].color))
          );

        if (hasMultiStyleWords && origLine.words) {
          // Draw individual styled words to preserve multiple distinct font sizes and colors on the line
          let currentWordX = lineLeft;
          for (let wIdx = 0; wIdx < origLine.words.length; wIdx++) {
            const word = origLine.words[wIdx];
            if (wIdx > 0) {
              const prevWord = origLine.words[wIdx - 1];
              const gap = word.left - prevWord.right;
              const minFs = Math.min(prevWord.fontSize, word.fontSize);
              if (gap >= minFs * 0.18) {
                const spaceW = calculateTextWidth(' ', word.fontSize, standardFontName);
                currentWordX += spaceW;
              }
            }
            const cleanWord = sanitizePdfText(word.text);
            if (!cleanWord || cleanWord.length === 0) continue;

            const wordFontSize = options.fontSize !== undefined && Math.abs(options.fontSize - targetParagraph.fontSize) > 0.1
              ? Math.max(1, word.fontSize * (options.fontSize / targetParagraph.fontSize))
              : word.fontSize;

            const wordFontName = resolveStandardFont(
              word.fontFamily || origLine.fontFamily || rawFontName,
              word.rawFontFamily || origLine.rawFontFamily || targetParagraph.rawFontFamily,
              (word.fontWeight as 'bold' | 'normal') || (origLine.fontWeight as 'bold' | 'normal') || options.fontWeight || (targetParagraph.fontWeight as 'bold' | 'normal'),
              (word.fontStyle as 'italic' | 'normal') || (origLine.fontStyle as 'italic' | 'normal') || options.fontStyle || (targetParagraph.fontStyle as 'italic' | 'normal')
            );
            let wordFontHandle = mod.FPDFText_LoadStandardFont(docHandle, wordFontName);
            if (!wordFontHandle) wordFontHandle = fontHandle;

            const wordBuf = encodeUtf16Le(engine, cleanWord);
            try {
              const wordObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, wordFontHandle, wordFontSize);
              if (wordObjHandle) {
                mod.FPDFText_SetText(wordObjHandle, wordBuf.ptr);
                const wCol = word.color || origLine.color || updatedColor;
                mod.FPDFPageObj_SetFillColor(wordObjHandle, wCol.r, wCol.g, wCol.b, wCol.a);
                setPageObjectMatrix(engine, mod, wordObjHandle, translationMatrix(currentWordX, lineBaselineY));
                mod.FPDFPage_InsertObject(pageHandle, wordObjHandle);
              }
            } finally {
              wordBuf.dispose();
            }
            currentWordX += calculateTextWidth(cleanWord, wordFontSize, wordFontName);
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
          let lineFontHandle = mod.FPDFText_LoadStandardFont(docHandle, lineFontName);
          if (!lineFontHandle) lineFontHandle = fontHandle;

          const textBuf = encodeUtf16Le(engine, lineText);
          try {
            const textObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, lineFontHandle, lineFontSize);
            if (textObjHandle) {
              mod.FPDFText_SetText(textObjHandle, textBuf.ptr);
              const lineCol = origLine?.color || updatedColor;
              mod.FPDFPageObj_SetFillColor(textObjHandle, lineCol.r, lineCol.g, lineCol.b, lineCol.a);
              setPageObjectMatrix(engine, mod, textObjHandle, translationMatrix(lineLeft, lineBaselineY));
              mod.FPDFPage_InsertObject(pageHandle, textObjHandle);
            }
          } finally {
            textBuf.dispose();
          }
        }
      }
    }

    // 6. Shift downstream spans in-place by adjusting transform matrix
    if (needsDownstreamShift) {
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
          const shiftedBaselineY = Math.max(10, line.baselineY - deltaY);

          // Shift downstream text objects in-place
          const indices = findTextObjectIndicesForSpan(
            engine, mod, pageHandle,
            line.left, line.baselineY, line.width, line.fontSize
          );
          for (const idx of indices) {
            const objHandle = mod.FPDFPage_GetObject(pageHandle, idx);
            if (objHandle) {
              setPageObjectMatrix(engine, mod, objHandle, translationMatrix(line.left, shiftedBaselineY));
            }
          }

          // Shift downstream bullet object in-place
          if (line.hasBulletPrefix && line.bulletWord) {
            const shiftedBulletBaselineY = Math.max(10, (line.bulletWord.baselineY || line.baselineY) - deltaY);
            const bIndices = findTextObjectIndicesForSpan(
              engine, mod, pageHandle,
              line.bulletWord.left, line.bulletWord.baselineY || line.baselineY, line.bulletWord.width + 4, line.bulletWord.fontSize
            );
            for (const bIdx of bIndices) {
              const bObjHandle = mod.FPDFPage_GetObject(pageHandle, bIdx);
              if (bObjHandle) {
                setPageObjectMatrix(engine, mod, bObjHandle, translationMatrix(line.bulletWord.left, shiftedBulletBaselineY));
              }
            }
          }
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
