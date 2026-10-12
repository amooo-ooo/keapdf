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
  calculateTextWidth,
  findTextObjectIndicesForSpan,
  removeTextObjectsByIndex,
  setTextObjectByIndex,
  removeTextObjectsInBounds,
  getPageObjectMatrix,
  getPageCropInfo,
  registerSpanDecorationObject,
  removeSpanDecorationObjectsInBounds,
  cleanSubsetPrefix,
} from '../../../core/pdfium-helpers';
import { FontCharsetIndex, extractBaseFontFamily, isStandard14Font } from '../font-charset-index';
import { isColorEqual, sanitizePdfText, safeEncodeForStandardFont, parseColor } from '../utils';
import { detectParagraphs } from './paragraph-detector';
import { resolveStandardFont } from './draw-text';
import { isolateSharedLineTextObjects } from './text-edit-ops';
import { UNICODE_TRAILING_WS_REGEX, UNICODE_LEADING_WS_REGEX, findBestMatchingOrigLine } from '../../../utils/text-range-utils';
import { calculateTrackedTextWidth } from '../../../core/typography-metrics';

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
 * Checks whether a word should be preceded by a whitespace separator relative to its predecessor.
 *
 * @param prev The preceding word on the line.
 * @param curr The current word on the line.
 * @return True if a space separates the two words.
 */
export function isWordPrecededBySpace(prev: TextWord, curr: TextWord): boolean {
  if (curr.hasPrecedingSpace !== undefined) {
    return Boolean(curr.hasPrecedingSpace);
  }
  if (
    curr.charStartIndex > 0 &&
    prev.charCount > 0 &&
    curr.charStartIndex > prev.charStartIndex + prev.charCount
  ) {
    return true;
  }
  if (
    curr.left <= prev.left + 0.5 &&
    /[a-zA-Z0-9]$/.test(prev.text.trim()) &&
    /^[a-zA-Z0-9]/.test(curr.text.trim())
  ) {
    return true;
  }
  const minFs = Math.min(prev.fontSize, curr.fontSize);
  return curr.left - prev.right >= minFs * 0.18;
}

/**
 * Reconstructs the normalised line string from an array of words, respecting unspaced sub-word boundaries.
 *
 * @param words Array of words on the line.
 * @return Reconstructed line string.
 */
export function reconstructLineTextFromWords(words: TextWord[]): string {
  let out = '';
  let prevRendered: TextWord | null = null;
  for (const w of words) {
    const clean = sanitizePdfText(w.text);
    if (!clean) continue;
    if (prevRendered && isWordPrecededBySpace(prevRendered, w)) {
      out += ' ';
    }
    out += clean;
    prevRendered = w;
  }
  return out;
}

/**
 * Collects a contiguous group of unspaced sub-word tokens starting at startIdx.
 *
 * @param words Array of words on the original line.
 * @param startIdx Starting index in words.
 * @return Compound word group, concatenated text, and exclusive end index.
 */
function collectCompoundWordGroup(
  words: TextWord[],
  startIdx: number
): { group: TextWord[]; combinedText: string; endIdx: number } {
  if (startIdx >= words.length) {
    return { group: [], combinedText: '', endIdx: startIdx };
  }
  const group: TextWord[] = [words[startIdx]];
  let combinedText = sanitizePdfText(words[startIdx].text);
  let idx = startIdx + 1;
  while (idx < words.length && !isWordPrecededBySpace(words[idx - 1], words[idx])) {
    const clean = sanitizePdfText(words[idx].text);
    if (clean) {
      group.push(words[idx]);
      combinedText += clean;
    }
    idx++;
  }
  return { group, combinedText, endIdx: idx };
}

/**
 * Maps a line text string to styled TextWord tokens using an original TextLine template,
 * preserving sub-word style boundaries (such as normal brackets around italic words).
 *
 * @param lineText The target line text to render.
 * @param origLine The original line containing styled word templates.
 * @param lineLeft Starting horizontal coordinate in points.
 * @param lineBaselineY Baseline vertical coordinate in points.
 * @param fallbackFontSize Fallback font size in points.
 * @param startWordCursor Starting word index cursor in origLine.words.
 * @return Mapped words and updated word cursor.
 */
export function mapLineTextToStyledWords(
  lineText: string,
  origLine: TextLine,
  lineLeft: number,
  lineBaselineY: number,
  fallbackFontSize: number,
  startWordCursor = 0
): { words: TextWord[]; nextCursor: number } {
  const origWords = origLine.words || [];
  if (origWords.length === 0) {
    return { words: [], nextCursor: startWordCursor };
  }

  const tokens = lineText.split(/([\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+)/);
  const freshWords: TextWord[] = [];
  let currentTokenLeft = lineLeft;
  let pendingSpace = false;
  let origWordIdx = startWordCursor;

  const pushStyledSubWord = (
    subText: string,
    templateWord: TextWord | undefined,
    hasSpaceBefore: boolean
  ): void => {
    if (!subText) return;
    const wordFs = templateWord?.fontSize || origLine.fontSize || fallbackFontSize;
    const approxCharW = wordFs * 0.52;
    const wordW =
      templateWord?.width &&
      templateWord.width > 0 &&
      sanitizePdfText(templateWord.text) === subText
        ? templateWord.width
        : subText.length * approxCharW;

    if (hasSpaceBefore) {
      currentTokenLeft += wordFs * 0.25;
    }

    freshWords.push({
      text: subText,
      left: currentTokenLeft,
      top: templateWord?.top || origLine.top || 0,
      right: currentTokenLeft + wordW,
      bottom: (templateWord?.top || origLine.top || 0) + wordFs,
      width: wordW,
      height: templateWord?.height || origLine.height || wordFs,
      fontSize: wordFs,
      baselineY: lineBaselineY,
      charStartIndex: 0,
      charCount: subText.length,
      fontFamily: templateWord?.fontFamily || origLine.fontFamily,
      rawFontFamily: templateWord?.rawFontFamily || origLine.rawFontFamily,
      matchedFontFamily: templateWord?.matchedFontFamily || origLine.matchedFontFamily,
      color: templateWord?.color || origLine.color,
      fontWeight: templateWord?.fontWeight || origLine.fontWeight,
      fontStyle: templateWord?.fontStyle || origLine.fontStyle,
      letterSpacing: templateWord?.letterSpacing || origLine.letterSpacing,
      letterSpacingPts: templateWord?.letterSpacingPts ?? origLine.letterSpacingPts,
      underline: templateWord?.underline ?? origLine.underline,
      strikethrough: templateWord?.strikethrough ?? origLine.strikethrough,
      backgroundColor: templateWord?.backgroundColor ?? origLine.backgroundColor,
      hasPrecedingSpace: hasSpaceBefore,
    });

    currentTokenLeft += wordW;
  };

  for (const token of tokens) {
    if (!token) continue;
    if (/^[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+$/.test(token)) {
      pendingSpace = true;
      continue;
    }
    const clean = sanitizePdfText(token);
    if (!clean) continue;

    const tokenHasPrecedingSpace = pendingSpace || freshWords.length > 0;
    let matchedCompound: { group: TextWord[]; endIdx: number } | null = null;

    for (let k = origWordIdx; k < Math.min(origWords.length, origWordIdx + 6); k++) {
      const candidate = collectCompoundWordGroup(origWords, k);
      if (candidate.combinedText === clean) {
        matchedCompound = { group: candidate.group, endIdx: candidate.endIdx };
        break;
      }
      if (sanitizePdfText(origWords[k].text) === clean) {
        matchedCompound = { group: [origWords[k]], endIdx: k + 1 };
        break;
      }
    }

    if (matchedCompound) {
      for (let gIdx = 0; gIdx < matchedCompound.group.length; gIdx++) {
        const subWord = matchedCompound.group[gIdx];
        const subText =
          matchedCompound.group.length === 1 ? clean : sanitizePdfText(subWord.text);
        pushStyledSubWord(subText, subWord, gIdx === 0 ? tokenHasPrecedingSpace : false);
      }
      origWordIdx = matchedCompound.endIdx;
      pendingSpace = false;
      continue;
    }

    const currentGroup = collectCompoundWordGroup(
      origWords,
      Math.min(origWordIdx, origWords.length - 1)
    );
    if (currentGroup.group.length > 1) {
      const firstSub = currentGroup.group[0];
      const lastSub = currentGroup.group[currentGroup.group.length - 1];
      const firstText = sanitizePdfText(firstSub.text);
      const lastText = sanitizePdfText(lastSub.text);
      const bodyTemplate =
        currentGroup.group.find((w) => /[a-zA-Z0-9]/.test(w.text)) ??
        currentGroup.group[Math.min(1, currentGroup.group.length - 1)];

      if (
        currentGroup.group.length >= 3 &&
        firstText &&
        lastText &&
        clean.startsWith(firstText) &&
        clean.endsWith(lastText) &&
        clean.length > firstText.length + lastText.length
      ) {
        const midText = clean.slice(firstText.length, clean.length - lastText.length);
        pushStyledSubWord(firstText, firstSub, tokenHasPrecedingSpace);
        pushStyledSubWord(midText, bodyTemplate, false);
        pushStyledSubWord(lastText, lastSub, false);
      } else if (firstText && clean.startsWith(firstText) && clean.length > firstText.length) {
        pushStyledSubWord(firstText, firstSub, tokenHasPrecedingSpace);
        pushStyledSubWord(clean.slice(firstText.length), bodyTemplate, false);
      } else if (lastText && clean.endsWith(lastText) && clean.length > lastText.length) {
        pushStyledSubWord(
          clean.slice(0, clean.length - lastText.length),
          bodyTemplate,
          tokenHasPrecedingSpace
        );
        pushStyledSubWord(lastText, lastSub, false);
      } else {
        pushStyledSubWord(clean, bodyTemplate, tokenHasPrecedingSpace);
      }
      origWordIdx = Math.max(origWordIdx + 1, currentGroup.endIdx);
      pendingSpace = false;
      continue;
    }

    const fallbackOrig = origWords[Math.min(origWordIdx, origWords.length - 1)];
    pushStyledSubWord(clean, fallbackOrig, tokenHasPrecedingSpace);
    origWordIdx++;
    pendingSpace = false;
  }

  return { words: freshWords, nextCursor: origWordIdx };
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
 * @param options Mutation options with updated text, font, and colour.
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
  const effectiveParagraphFont =
    targetParagraph.fontFamily && targetParagraph.fontFamily !== 'Helvetica'
      ? targetParagraph.fontFamily
      : targetParagraph.rawFontFamily || targetParagraph.fontFamily;
  const rawFontName = options.fontFamily || effectiveParagraphFont || 'Helvetica';
  const standardFontName: StandardFontName = resolveStandardFont(
    rawFontName,
    targetParagraph.rawFontFamily,
    (options.fontWeight || targetParagraph.fontWeight) as 'bold' | 'normal' | undefined,
    (options.fontStyle || targetParagraph.fontStyle) as 'italic' | 'normal' | undefined
  );
  const updatedColor: ColorRgba = options.color || targetParagraph.color;
  const targetLeft = options.left !== undefined ? options.left : targetParagraph.left;
  const lineHeight = options.lineHeight || targetParagraph.lineHeight || updatedFontSize * 1.25;

  const isDeletion = updatedText.trim().length === 0;
  const isUnchangedTextAndSize =
    updatedText === targetParagraph.text && Math.abs(updatedFontSize - targetParagraph.fontSize) < 0.1;

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

  const pageWidth = typeof mod.FPDF_GetPageWidthF === 'function'
    ? mod.FPDF_GetPageWidthF(pageHandle)
    : (typeof mod.FPDF_GetPageWidth === 'function' ? mod.FPDF_GetPageWidth(pageHandle) : 612);

  let wrapWidth: number;
  if (isTargetBullet) {
    wrapWidth = Math.max(20, targetParagraph.width - Math.max(0, firstLineTextLeft - targetParagraph.left));
  } else if (isSingleLineText) {
    const maxAvailableWidth = Math.max(
      targetParagraph.width + updatedFontSize * 0.6,
      Math.min(pageWidth - targetParagraph.left - 36, 500)
    );
    wrapWidth = maxAvailableWidth;
  } else {
    const wrapBuffer = Math.max(6, updatedFontSize * 0.5);
    wrapWidth = targetParagraph.width + wrapBuffer;
  }

  // Wrap text into lines fitting column width
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
      const origTargetLine = targetParagraph.lines?.[idx];
      const origTargetText = origTargetLine?.text
        ? origTargetLine.text.replace(/[\r\n]+/g, ' ').trim()
        : '';
      const isLineUnchanged = Boolean(
        origTargetLine &&
          lineText === origTargetText &&
          Math.abs((l.fontSize || updatedFontSize) - origTargetLine.fontSize) < 0.2
      );
      if (isUnchangedTextAndSize || isLineUnchanged) {
        reflowedItems.push({
          text: lineText,
          sourceLine: l,
          isContinuation: false,
        });
        continue;
      }
      const baseWrapW = idx === 0 ? firstLineWidth : wrapWidth;
      const lineWrapW = Math.max(
        baseWrapW,
        (l.width || 0) + (l.fontSize || updatedFontSize) * 0.5,
        (origTargetLine?.width || 0) + (l.fontSize || updatedFontSize) * 0.5
      );
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
      const srcLine = findBestMatchingOrigLine(trimmedSegment, targetParagraph.lines, idx) || targetParagraph.lines?.[Math.min(idx, (targetParagraph.lines?.length || 1) - 1)];
      if (isUnchangedTextAndSize && targetParagraph.lines && targetParagraph.lines.length > 0) {
        reflowedItems.push({
          text: trimmedSegment,
          sourceLine: srcLine,
          isContinuation: false,
        });
        continue;
      }
      const lineWrapW = idx === 0 ? firstLineWidth : wrapWidth;
      const wrapped = wrapTextToWidth(trimmedSegment, lineWrapW, updatedFontSize, standardFontName).filter((s) => s.trim().length > 0);
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
    if (isUnchangedTextAndSize && targetParagraph.lines && targetParagraph.lines.length === 1) {
      reflowedItems.push({
        text: updatedText.trim(),
        sourceLine: targetParagraph.lines[0],
        isContinuation: false,
      });
    } else {
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
  }
  const reflowedLines: string[] = reflowedItems.map((item) => item.text);

  // Compute height and line change
  const targetLines: Array<{
    left: number;
    baselineY: number;
    width: number;
    fontSize: number;
    text?: string;
    charStartIndex?: number;
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
        text: targetParagraph.text,
        charStartIndex: targetParagraph.charStartIndex,
        hasBulletPrefix: targetParagraph.hasBulletPrefix,
        bulletWord: targetParagraph.bulletWord,
        color: targetParagraph.color,
        fontFamily: targetParagraph.fontFamily,
        rawFontFamily: targetParagraph.rawFontFamily,
        fontWeight: targetParagraph.fontWeight,
        fontStyle: targetParagraph.fontStyle,
      }];

  const effectiveAlign = options.textAlign || targetParagraph.textAlign;
  const paraLeft = options.left !== undefined ? options.left : (targetParagraph.originalLeft ?? targetParagraph.left);
  let maxTargetLineWidth = targetParagraph.width;
  for (const l of targetLines) {
    if (l.width > maxTargetLineWidth) maxTargetLineWidth = l.width;
  }
  const paraWidth =
    targetLines.length === 1 && reflowedLines.length === 1 && maxTargetLineWidth <= targetLines[0].width + 4 && effectiveAlign
      ? Math.max(maxTargetLineWidth, pageWidth - 2 * Math.min(paraLeft, 72))
      : maxTargetLineWidth;

  const computeAlignedLineDomLeft = (
    lineIdx: number,
    lineWidth: number,
    fallbackLeft: number
  ): number => {
    if (!effectiveAlign) return fallbackLeft;
    if (effectiveAlign === 'center') {
      return paraLeft + Math.max(0, (paraWidth - lineWidth) / 2);
    }
    if (effectiveAlign === 'right') {
      return paraLeft + Math.max(0, paraWidth - lineWidth);
    }
    return isTargetBullet && lineIdx === 0 ? firstLineTextLeft : paraLeft;
  };

  for (const line of targetLines) {
    isolateSharedLineTextObjects(engine, mod, docHandle, pageIndex, pageHandle, {
      left: line.left,
      baselineY: line.baselineY,
      width: line.width,
      fontSize: line.fontSize,
      text: line.text,
      charStartIndex: line.charStartIndex,
      color: line.color || targetParagraph.color,
      fontFamily: line.fontFamily || targetParagraph.fontFamily,
      rawFontFamily: line.rawFontFamily || targetParagraph.rawFontFamily,
      fontWeight: line.fontWeight || targetParagraph.fontWeight,
      fontStyle: line.fontStyle || targetParagraph.fontStyle,
      words: line.words,
      hasBulletPrefix: line.hasBulletPrefix,
      bulletWord: line.bulletWord,
    });
  }

  const findLineObjectIndices = (line: { left: number; baselineY: number; width: number; fontSize: number }): number[] => {
    let indices = findTextObjectIndicesForSpan(
      engine, mod, pageHandle,
      line.left, line.baselineY, line.width, line.fontSize
    );
    if (indices.length === 0) {
      const searchLeft = Math.min(paraLeft, targetParagraph.left, line.left);
      const searchRight = Math.max(
        paraLeft + paraWidth,
        targetParagraph.left + targetParagraph.width,
        line.left + line.width
      );
      indices = findTextObjectIndicesForSpan(
        engine, mod, pageHandle,
        searchLeft, line.baselineY, Math.max(line.width, searchRight - searchLeft), line.fontSize
      );
    }
    if (indices.length === 0) {
      for (const delta of [-2, 2, -4, 4]) {
        indices = findTextObjectIndicesForSpan(
          engine, mod, pageHandle,
          Math.min(paraLeft, line.left), line.baselineY + delta, Math.max(line.width, paraWidth), line.fontSize
        );
        if (indices.length > 0) break;
      }
    }
    return indices;
  };

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

  // Check if options or target paragraph lines contain words with distinct styles (fonts, weights, styles, colours, decorations)
  const styleCheckLines =
    options.lines && options.lines.length > 0 ? options.lines : targetParagraph.lines;
  const hasMixedStyleWords = Boolean(
    styleCheckLines &&
    styleCheckLines.some(
      (l) =>
        l.words &&
        l.words.some(
          (w) =>
            (w.fontFamily && w.fontFamily !== targetParagraph.fontFamily) ||
            (w.rawFontFamily &&
              cleanSubsetPrefix(w.rawFontFamily) !==
                cleanSubsetPrefix(targetParagraph.rawFontFamily || '')) ||
            (w.fontWeight && w.fontWeight !== (targetParagraph.fontWeight || 'normal')) ||
            (w.fontStyle && w.fontStyle !== (targetParagraph.fontStyle || 'normal')) ||
            (w.color && !isColorEqual(w.color, targetParagraph.color)) ||
            Boolean(w.backgroundColor) ||
            Boolean(w.underline) !== Boolean(targetParagraph.underline) ||
            Boolean(w.strikethrough) !== Boolean(targetParagraph.strikethrough) ||
            Math.abs(
              (w.letterSpacingPts || 0) -
                (targetParagraph.lines?.[0]?.words?.[0]?.letterSpacingPts || 0)
            ) > 1.0
        )
    )
  );

  // In-place subset preservation path
  // If font properties are unchanged, no mixed font sizes or styles, and line count matches, try in-place edit using embedded font
  const isOnlyTextChanged =
    !hasMixedFontSize &&
    !hasMixedStyleWords &&
    (options.fontSize === undefined || Math.abs(options.fontSize - targetParagraph.fontSize) < 0.1) &&
    (options.letterSpacing === undefined || options.letterSpacing === targetParagraph.letterSpacing) &&
    (options.lineHeight === undefined || Math.abs(options.lineHeight - (targetParagraph.lineHeight || updatedFontSize * 1.25)) < 0.1) &&
    (options.fontFamily === undefined ||
      options.fontFamily === targetParagraph.fontFamily ||
      extractBaseFontFamily(options.fontFamily) === extractBaseFontFamily(targetParagraph.rawFontFamily || targetParagraph.fontFamily) ||
      resolveStandardFont(options.fontFamily, targetParagraph.rawFontFamily) ===
        resolveStandardFont(targetParagraph.fontFamily, targetParagraph.rawFontFamily)) &&
    (options.color === undefined || isColorEqual(options.color, targetParagraph.color)) &&
    (!options.fontWeight || options.fontWeight === (targetParagraph.fontWeight || 'normal')) &&
    (!options.fontStyle || options.fontStyle === (targetParagraph.fontStyle || 'normal')) &&
    options.underline === undefined &&
    options.strikethrough === undefined &&
    !targetParagraph.underline &&
    !targetParagraph.strikethrough;

  if (!isDeletion && isOnlyTextChanged && reflowedLines.length === targetLines.length && !options.backgroundColor) {
    const cropInfo = getPageCropInfo(engine, mod, pageHandle);
    const hasHorizontalShift = options.left !== undefined || Boolean(effectiveAlign);

    if (updatedText === targetParagraph.text && !options.forceTextRestore) {
      let allFound = true;
      const lineObjectGroups: number[][] = [];
      for (let i = 0; i < targetLines.length; i++) {
        const indices = findLineObjectIndices(targetLines[i]);
        if (indices.length === 0) {
          allFound = false;
          break;
        }
        lineObjectGroups.push(indices);
      }

      if (allFound) {
        if (hasHorizontalShift) {
          for (let i = 0; i < targetLines.length; i++) {
            const line = targetLines[i];
            const indices = lineObjectGroups[i];
            const lineW = line.width > 0
              ? line.width
              : calculateTextWidth(reflowedLines[i], line.fontSize || updatedFontSize, standardFontName);
            const fallbackDomLeft = options.lines?.[i]?.left ?? line.left;
            const desiredDomLeft = computeAlignedLineDomLeft(i, lineW, fallbackDomLeft);
            const desiredPdfLeft = desiredDomLeft + cropInfo.cropLeft;

            const firstObj = mod.FPDFPage_GetObject(pageHandle, indices[0]);
            const firstMat = firstObj ? getPageObjectMatrix(engine, mod, firstObj) : null;
            const currentBasePdfX = firstMat
              ? (Math.abs(firstMat.e - (line.left + cropInfo.cropLeft)) <= 3.0
                  ? line.left + cropInfo.cropLeft
                  : firstMat.e)
              : line.left + cropInfo.cropLeft;
            const deltaLineX = desiredPdfLeft - currentBasePdfX;

            if (Math.abs(deltaLineX) > 0.01) {
              for (const objIdx of indices) {
                const objHandle = mod.FPDFPage_GetObject(pageHandle, objIdx);
                if (!objHandle) continue;
                const mat = getPageObjectMatrix(engine, mod, objHandle);
                if (mat) {
                  setPageObjectMatrix(engine, mod, objHandle, {
                    ...mat,
                    e: mat.e + deltaLineX,
                  });
                }
              }
            }
          }
          mod.FPDFPage_GenerateContent(pageHandle);
        }
        return {
          reflowedLines,
          newHeight,
          deltaY: 0,
          affectedSpansCount: 0,
        };
      }
    }

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
      const singleLineIndices: number[] = [];
      let allSingleObject = true;
      for (let i = 0; i < reflowedLines.length; i++) {
        const lineIndices = findLineObjectIndices(targetLines[i]);
        if (lineIndices.length !== 1) {
          allSingleObject = false;
          break;
        }
        singleLineIndices.push(lineIndices[0]);
      }

      if (allSingleObject) {
        let allUpdated = true;
        for (let i = 0; i < reflowedLines.length; i++) {
          const line = targetLines[i];
          const objIdx = singleLineIndices[i];
          const lineW = reflowedLines[i] === targetParagraph.lines?.[i]?.text && line.width > 0
            ? line.width
            : calculateTextWidth(reflowedLines[i], line.fontSize || updatedFontSize, standardFontName);
          const fallbackDomLeft = options.lines?.[i]?.left ?? line.left;
          const desiredDomLeft = computeAlignedLineDomLeft(i, lineW, fallbackDomLeft);
          const desiredPdfLeft = desiredDomLeft + cropInfo.cropLeft;
          const firstObj = mod.FPDFPage_GetObject(pageHandle, objIdx);
          const firstMat = firstObj ? getPageObjectMatrix(engine, mod, firstObj) : null;
          const currentBasePdfX = firstMat
            ? (Math.abs(firstMat.e - (line.left + cropInfo.cropLeft)) <= 3.0
                ? line.left + cropInfo.cropLeft
                : firstMat.e)
            : line.left + cropInfo.cropLeft;
          const deltaLineX = hasHorizontalShift ? desiredPdfLeft - currentBasePdfX : 0;
          const updatedMatrix = firstMat && Math.abs(deltaLineX) > 0.01
            ? { ...firstMat, e: firstMat.e + deltaLineX }
            : undefined;

          const ok = setTextObjectByIndex(engine, mod, pageHandle, objIdx, reflowedLines[i], updatedMatrix);
          if (!ok) {
            allUpdated = false;
            break;
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
  }

  // Find all spans on the page to identify downstream paragraphs that need shifting
  const allPageSpans = detectParagraphs(engine, pageIndex, pageHandle);

  const hasTableRowPeers = (span: EditableTextSpan): boolean => {
    const rowPeers = allPageSpans.filter(
      (other) =>
        other.id !== span.id &&
        Math.abs(other.baselineY - span.baselineY) <= 4.0 &&
        (other.left > span.left + span.width + 4.0 || other.left + other.width < span.left - 4.0)
    );
    if (rowPeers.length >= 2 && span.width < 180.0) return true;
    if (rowPeers.length >= 1 && span.width < 135.0 && rowPeers.some((p) => p.width < 135.0)) {
      return true;
    }
    return false;
  };
  const isTargetTableCell = hasTableRowPeers(targetParagraph);

  // Identify downstream paragraphs sharing the column
  const downstreamSpans = isTargetTableCell
    ? []
    : allPageSpans
        .filter((s) => {
          if (s.id === targetParagraph.id) return false;
          const isBelow =
            s.top >= targetParagraph.top + targetParagraph.height - 4.0 ||
            s.baselineY < targetParagraph.baselineY - (oldLineCount - 1) * lineHeight - 4.0;
          if (!isBelow) return false;

          // Column overlap check: require positive overlap and substantial width coverage
          const minColWidth = Math.min(s.width, targetParagraph.width);
          const overlap =
            Math.min(s.left + s.width, targetParagraph.left + targetParagraph.width) -
            Math.max(s.left, targetParagraph.left);
          return overlap > 15.0 && overlap > minColWidth * 0.25 && !hasTableRowPeers(s);
        })
        .sort((a, b) => a.top - b.top);

  const needsDownstreamShift = Math.abs(deltaY) > 0.5 && downstreamSpans.length > 0;

  // Collect ALL backing PDF text objects to remove in one batch
  const allIndicesToRemove = new Set<number>();
  let origMatrix: PdfMatrix | null = null;

  for (const line of targetLines) {
    const indices = findLineObjectIndices(line);
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

  // Purge any existing background highlight, underline, or strikethrough rectangles in target lines
  for (const line of targetLines) {
    removeSpanDecorationObjectsInBounds(
      engine,
      mod,
      pageHandle,
      line.left,
      line.baselineY,
      Math.max(line.width, paraWidth),
      line.fontSize || updatedFontSize
    );
  }

  // Remove all targeted objects in one atomic batch
  if (allIndicesToRemove.size > 0) {
    removeTextObjectsByIndex(mod, pageHandle, Array.from(allIndicesToRemove));
  } else {
    // note: spatial bounds removal fallback ensuring original objects are purged before inserting replacements
    for (const line of targetLines) {
      removeTextObjectsInBounds(
        engine, mod, pageHandle,
        line.left, line.baselineY, Math.max(line.width, paraWidth), line.fontSize || updatedFontSize
      );
    }
  }

  // Insert reflowed replacement lines for target paragraph
  let fontHandle = 0;
  const newObjectHandles = new Set<number>();
  const fallbackCropInfo = getPageCropInfo(engine, mod, pageHandle);
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

      const isLineHeightUnchanged =
        options.top === undefined &&
        (options.lineHeight === undefined ||
          (targetParagraph.lineHeight !== undefined &&
            Math.abs(options.lineHeight - targetParagraph.lineHeight) < 0.1));
      const nonEmptyReflowedCount = reflowedItems.filter((it) => it.text.trim().length > 0).length;
      const canPreserveExactLineBaselines =
        isLineHeightUnchanged && nonEmptyReflowedCount === targetLines.length;

      const sourceLineWordCursor = new WeakMap<TextLine, number>();
      let currentBaselineY = targetParagraph.baselineY;
      let prevRenderedSourceLine: TextLine | undefined = undefined;
      let renderedLineIdx = 0;
      for (let i = 0; i < reflowedItems.length; i++) {
        const item = reflowedItems[i];
        const lineText = item.text;
        if (lineText.trim().length === 0) continue;

        const origLine = item.sourceLine || findBestMatchingOrigLine(lineText, options.lines || targetParagraph.lines, renderedLineIdx) || options.lines?.[renderedLineIdx] || (targetParagraph.lines && targetParagraph.lines[renderedLineIdx] ? targetParagraph.lines[renderedLineIdx] : undefined);

        // Preserve exact per-line PDF baseline coordinates and non-uniform inter-paragraph steps
        let lineBaselineY: number;
        if (canPreserveExactLineBaselines && targetLines[renderedLineIdx]?.baselineY !== undefined) {
          lineBaselineY = targetLines[renderedLineIdx].baselineY;
        } else if (renderedLineIdx === 0) {
          lineBaselineY = targetParagraph.baselineY;
        } else if (
          isLineHeightUnchanged &&
          !item.isContinuation &&
          prevRenderedSourceLine &&
          origLine &&
          prevRenderedSourceLine !== origLine &&
          prevRenderedSourceLine.baselineY !== undefined &&
          origLine.baselineY !== undefined &&
          prevRenderedSourceLine.baselineY > origLine.baselineY
        ) {
          lineBaselineY = currentBaselineY - (prevRenderedSourceLine.baselineY - origLine.baselineY);
        } else {
          const stepLh = isLineHeightUnchanged && origLine?.lineHeight ? origLine.lineHeight : lineHeight;
          lineBaselineY = currentBaselineY - stepLh;
        }
        currentBaselineY = lineBaselineY;
        prevRenderedSourceLine = origLine;
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

        const normalizedLineWordsText = origLine?.words
          ? reconstructLineTextFromWords(origLine.words)
          : '';
        const normalizedTargetLineText = sanitizePdfText(lineText).trim().replace(/\s+/g, ' ');
        const isExactLineWords = Boolean(
          origLine?.words &&
          origLine.words.length > 0 &&
          !item.isContinuation &&
          (origLine.text === lineText || normalizedLineWordsText === normalizedTargetLineText)
        );
        let wordsToRender: TextWord[] | undefined;
        if (isExactLineWords && origLine?.words) {
          wordsToRender = origLine.words;
        } else if (origLine?.words && origLine.words.length > 0) {
          const origWordIdx = sourceLineWordCursor.get(origLine) ?? 0;
          const mapped = mapLineTextToStyledWords(
            lineText,
            origLine,
            lineLeft,
            lineBaselineY,
            updatedFontSize,
            origWordIdx
          );
          sourceLineWordCursor.set(origLine, mapped.nextCursor);
          wordsToRender = mapped.words;
        }

        const hasMultiStyleWords =
          Boolean(wordsToRender &&
          wordsToRender.length > 1 &&
          wordsToRender.some(
            (w: TextWord) =>
              Math.abs(w.fontSize - wordsToRender[0].fontSize) > 0.2 ||
              (w.fontFamily && w.fontFamily !== wordsToRender[0].fontFamily) ||
              (w.rawFontFamily && cleanSubsetPrefix(w.rawFontFamily) !== cleanSubsetPrefix(wordsToRender[0].rawFontFamily || '')) ||
              (w.fontWeight && w.fontWeight !== wordsToRender[0].fontWeight) ||
              (w.fontStyle && w.fontStyle !== wordsToRender[0].fontStyle) ||
              !isColorEqual(
                w.color || targetParagraph.color,
                wordsToRender[0].color || targetParagraph.color
              ) ||
              Boolean(w.underline) !== Boolean(wordsToRender[0].underline) ||
              Boolean(w.strikethrough) !== Boolean(wordsToRender[0].strikethrough) ||
              (w.backgroundColor !== wordsToRender[0].backgroundColor) ||
              Math.abs((w.letterSpacingPts || 0) - (wordsToRender[0].letterSpacingPts || 0)) > 1.0
          ));

        const effectiveLetterSpacing = options.letterSpacing ?? targetParagraph.letterSpacing;
        const effectiveWordSpacing = options.wordSpacing ?? targetParagraph.wordSpacing;

        if (hasMultiStyleWords && wordsToRender) {
          // Compute total width of multi-style words on the line for horizontal alignment
          let totalMultiWordWidth = 0;
          let previewLastWord: TextWord | null = null;
          for (let wIdx = 0; wIdx < wordsToRender.length; wIdx++) {
            const word = wordsToRender[wIdx];
            const cleanWord = sanitizePdfText(word.text);
            if (!cleanWord || cleanWord.length === 0) continue;
            let needsSpace = false;
            if (previewLastWord) {
              const endsWithWs = UNICODE_TRAILING_WS_REGEX.test(previewLastWord.text);
              const startsWithWs = UNICODE_LEADING_WS_REGEX.test(cleanWord);
              needsSpace =
                !endsWithWs &&
                !startsWithWs &&
                isWordPrecededBySpace(previewLastWord, word);
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
            const wordLs = word.letterSpacing ?? origLine?.letterSpacing ?? effectiveLetterSpacing;
            const wordWs = origLine?.wordSpacing ?? effectiveWordSpacing;
            const textToRender = needsSpace ? ` ${cleanWord}` : cleanWord;
            totalMultiWordWidth += calculateTrackedTextWidth(textToRender, wordFontSize, wordFontName, wordLs, wordWs);
            previewLastWord = word;
          }

          // Draw individual styled words to preserve multiple distinct font sizes and colours on the line
          let currentWordX =
            computeAlignedLineDomLeft(renderedLineIdx - 1, totalMultiWordWidth, lineLeft) +
            fallbackCropInfo.cropLeft;
          let lastRenderedWord: TextWord | null = null;
          for (let wIdx = 0; wIdx < wordsToRender.length; wIdx++) {
            const word = wordsToRender[wIdx];
            const cleanWord = sanitizePdfText(word.text);
            if (!cleanWord || cleanWord.length === 0) continue;

            let needsSpace = false;
            if (lastRenderedWord) {
              const endsWithWs = UNICODE_TRAILING_WS_REGEX.test(lastRenderedWord.text);
              const startsWithWs = UNICODE_LEADING_WS_REGEX.test(cleanWord);
              needsSpace =
                !endsWithWs &&
                !startsWithWs &&
                isWordPrecededBySpace(lastRenderedWord, word);
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
            const wordLs = word.letterSpacing ?? origLine?.letterSpacing ?? effectiveLetterSpacing;
            const wordWs = origLine?.wordSpacing ?? effectiveWordSpacing;

            // Prepend space glyph to encoded string when space is needed so PDFium creates explicit space character in stream
            const spaceW = needsSpace ? calculateTextWidth(' ', wordFontSize, wordFontName) + (wordWs ?? 0) : 0;
            const textToRender = needsSpace ? ` ${cleanWord}` : cleanWord;
            const fullRenderedWidth = calculateTrackedTextWidth(textToRender, wordFontSize, wordFontName, wordLs, wordWs);
            const wordWidthOnly = calculateTrackedTextWidth(cleanWord, wordFontSize, wordFontName, wordLs);

            const wordBgColorStr = word.backgroundColor !== undefined
              ? (word.backgroundColor === 'transparent' ? undefined : word.backgroundColor)
              : (options.backgroundColor === 'transparent' ? undefined : options.backgroundColor);
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
                  registerSpanDecorationObject(bgRect, currentWordX + spaceW, rectBottom, wordWidthOnly, rectH);
                }
              }
            }

            const isWordUnderline = word.underline !== undefined
              ? Boolean(word.underline)
              : Boolean(origLine?.underline ?? options.underline ?? targetParagraph.underline);
            const isWordStrike = word.strikethrough !== undefined
              ? Boolean(word.strikethrough)
              : Boolean(origLine?.strikethrough ?? options.strikethrough ?? targetParagraph.strikethrough);

            if (isWordUnderline || isWordStrike) {
              const lineThick = Math.max(0.75, wordFontSize * 0.065);
              const wCol = word.color || origLine?.color || updatedColor;
              const prevUnderline = lastRenderedWord
                ? (lastRenderedWord.underline !== undefined
                    ? Boolean(lastRenderedWord.underline)
                    : Boolean(origLine?.underline ?? options.underline ?? targetParagraph.underline))
                : false;
              const prevStrike = lastRenderedWord
                ? (lastRenderedWord.strikethrough !== undefined
                    ? Boolean(lastRenderedWord.strikethrough)
                    : Boolean(origLine?.strikethrough ?? options.strikethrough ?? targetParagraph.strikethrough))
                : false;

              if (isWordUnderline) {
                const uStartX = needsSpace && prevUnderline ? currentWordX : currentWordX + spaceW;
                const uWidth = needsSpace && prevUnderline ? fullRenderedWidth : wordWidthOnly;
                const uBottom = Math.max(0, lineBaselineY - lineThick * 1.5);
                const uRect = mod.FPDFPageObj_CreateNewRect(uStartX, uBottom, uWidth, lineThick);
                if (uRect) {
                  mod.FPDFPageObj_SetFillColor(uRect, wCol.r, wCol.g, wCol.b, wCol.a);
                  mod.FPDFPath_SetDrawMode(uRect, 1, false);
                  mod.FPDFPage_InsertObject(pageHandle, uRect);
                  newObjectHandles.add(uRect);
                  registerSpanDecorationObject(uRect, uStartX, uBottom, uWidth, lineThick);
                }
              }

              if (isWordStrike) {
                const sStartX = needsSpace && prevStrike ? currentWordX : currentWordX + spaceW;
                const sWidth = needsSpace && prevStrike ? fullRenderedWidth : wordWidthOnly;
                const sBottom = lineBaselineY + wordFontSize * 0.28;
                const sRect = mod.FPDFPageObj_CreateNewRect(sStartX, sBottom, sWidth, lineThick);
                if (sRect) {
                  mod.FPDFPageObj_SetFillColor(sRect, wCol.r, wCol.g, wCol.b, wCol.a);
                  mod.FPDFPath_SetDrawMode(sRect, 1, false);
                  mod.FPDFPage_InsertObject(pageHandle, sRect);
                  newObjectHandles.add(sRect);
                  registerSpanDecorationObject(sRect, sStartX, sBottom, sWidth, lineThick);
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
                const scaleX = origMatrix ? Math.hypot(origMatrix.a, origMatrix.b) : 1;
                const scaleY = origMatrix ? Math.hypot(origMatrix.c, origMatrix.d) : 1;
                const shouldNorm = Boolean(origMatrix && wordFontSize > 2.0 && scaleX > 1.8 && scaleY > 1.8);
                const matrix = {
                  a: origMatrix ? (shouldNorm ? origMatrix.a / scaleX : origMatrix.a) : 1,
                  b: origMatrix ? (shouldNorm ? origMatrix.b / scaleX : origMatrix.b) : 0,
                  c: origMatrix ? (shouldNorm ? origMatrix.c / scaleY : origMatrix.c) : 0,
                  d: origMatrix ? (shouldNorm ? origMatrix.d / scaleY : origMatrix.d) : 1,
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
            const naturalRenderedWidth = calculateTextWidth(textToRender, wordFontSize, wordFontName);
            currentWordX += Math.max(fullRenderedWidth, naturalRenderedWidth);
            lastRenderedWord = word;
          }
        } else {
          // Draw uniform single-style line
          const singleWord = wordsToRender && wordsToRender.length > 0 ? wordsToRender[0] : undefined;
          const lineFontSize = options.fontSize !== undefined && Math.abs(options.fontSize - targetParagraph.fontSize) > 0.1
            ? (origLine?.fontSize ? Math.max(1, origLine.fontSize * (options.fontSize / targetParagraph.fontSize)) : options.fontSize)
            : (singleWord?.fontSize || origLine?.fontSize || updatedFontSize);

          const lineFontName = resolveStandardFont(
            singleWord?.fontFamily || origLine?.fontFamily || rawFontName,
            singleWord?.rawFontFamily || origLine?.rawFontFamily || targetParagraph.rawFontFamily,
            (singleWord?.fontWeight as 'bold' | 'normal') || (origLine?.fontWeight as 'bold' | 'normal') || options.fontWeight || (targetParagraph.fontWeight as 'bold' | 'normal'),
            (singleWord?.fontStyle as 'italic' | 'normal') || (origLine?.fontStyle as 'italic' | 'normal') || options.fontStyle || (targetParagraph.fontStyle as 'italic' | 'normal')
          );
          const lineFontHandle = getStandardFontHandle(lineFontName);
          const lineLs = singleWord?.letterSpacing ?? origLine?.letterSpacing ?? effectiveLetterSpacing;
          const lineWs = origLine?.wordSpacing ?? effectiveWordSpacing;
          const lineWidth = calculateTrackedTextWidth(lineText, lineFontSize, lineFontName, lineLs, lineWs);
          const alignedLineLeft =
            computeAlignedLineDomLeft(renderedLineIdx - 1, lineWidth, lineLeft) +
            fallbackCropInfo.cropLeft;

          const rawLineBg = origLine?.backgroundColor ?? singleWord?.backgroundColor ?? options.backgroundColor;
          const lineBgColorStr = rawLineBg === 'transparent' ? undefined : rawLineBg;
          if (lineBgColorStr) {
            const bgCol = parseColor(lineBgColorStr);
            if (bgCol.a > 0) {
              const rectBottom = Math.max(0, lineBaselineY - lineFontSize * 0.25);
              const rectH = lineFontSize * 1.25;
              const bgRect = mod.FPDFPageObj_CreateNewRect(alignedLineLeft, rectBottom, lineWidth, rectH);
              if (bgRect) {
                mod.FPDFPageObj_SetFillColor(bgRect, bgCol.r, bgCol.g, bgCol.b, bgCol.a);
                mod.FPDFPath_SetDrawMode(bgRect, 1, false);
                mod.FPDFPage_InsertObject(pageHandle, bgRect);
                newObjectHandles.add(bgRect);
                registerSpanDecorationObject(bgRect, alignedLineLeft, rectBottom, lineWidth, rectH);
              }
            }
          }

          const isLineUnderline = Boolean(singleWord?.underline ?? origLine?.underline ?? options.underline ?? targetParagraph.underline);
          const isLineStrike = Boolean(singleWord?.strikethrough ?? origLine?.strikethrough ?? options.strikethrough ?? targetParagraph.strikethrough);
          if (isLineUnderline || isLineStrike) {
            const lineThick = Math.max(0.75, lineFontSize * 0.065);
            const lineCol = singleWord?.color || origLine?.color || updatedColor;

            if (isLineUnderline) {
              const uBottom = Math.max(0, lineBaselineY - lineThick * 1.5);
              const uRect = mod.FPDFPageObj_CreateNewRect(alignedLineLeft, uBottom, lineWidth, lineThick);
              if (uRect) {
                mod.FPDFPageObj_SetFillColor(uRect, lineCol.r, lineCol.g, lineCol.b, lineCol.a);
                mod.FPDFPath_SetDrawMode(uRect, 1, false);
                mod.FPDFPage_InsertObject(pageHandle, uRect);
                newObjectHandles.add(uRect);
                registerSpanDecorationObject(uRect, alignedLineLeft, uBottom, lineWidth, lineThick);
              }
            }

            if (isLineStrike) {
              const sBottom = lineBaselineY + lineFontSize * 0.28;
              const sRect = mod.FPDFPageObj_CreateNewRect(alignedLineLeft, sBottom, lineWidth, lineThick);
              if (sRect) {
                mod.FPDFPageObj_SetFillColor(sRect, lineCol.r, lineCol.g, lineCol.b, lineCol.a);
                mod.FPDFPath_SetDrawMode(sRect, 1, false);
                mod.FPDFPage_InsertObject(pageHandle, sRect);
                newObjectHandles.add(sRect);
                registerSpanDecorationObject(sRect, alignedLineLeft, sBottom, lineWidth, lineThick);
              }
            }
          }

          const textBuf = encodeUtf16Le(engine, safeEncodeForStandardFont(lineText));
          try {
            const textObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, lineFontHandle, lineFontSize);
            if (textObjHandle) {
              mod.FPDFText_SetText(textObjHandle, textBuf.ptr);
              const lineCol = singleWord?.color || origLine?.color || updatedColor;
              mod.FPDFPageObj_SetFillColor(textObjHandle, lineCol.r, lineCol.g, lineCol.b, lineCol.a);
              const scaleX = origMatrix ? Math.hypot(origMatrix.a, origMatrix.b) : 1;
              const scaleY = origMatrix ? Math.hypot(origMatrix.c, origMatrix.d) : 1;
              const shouldNorm = Boolean(origMatrix && lineFontSize > 2.0 && scaleX > 1.8 && scaleY > 1.8);
              const matrix = {
                a: origMatrix ? (shouldNorm ? origMatrix.a / scaleX : origMatrix.a) : 1,
                b: origMatrix ? (shouldNorm ? origMatrix.b / scaleX : origMatrix.b) : 0,
                c: origMatrix ? (shouldNorm ? origMatrix.c / scaleY : origMatrix.c) : 0,
                d: origMatrix ? (shouldNorm ? origMatrix.d / scaleY : origMatrix.d) : 1,
                e: alignedLineLeft,
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

    // Shift downstream spans in-place by adjusting transform matrix
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

    // Commit page stream modifications
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
