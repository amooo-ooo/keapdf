import type { EditableTextSpan, TextLine, TextWord } from '../core/types';

/**
 * Creates an isolated single-word EditableTextSpan from a parent span and word token.
 *
 * @param parentSpan The parent clustered paragraph span.
 * @param parentLine The line containing the word.
 * @param word The specific word token to isolate.
 * @param wordIndex The index of the word within the line words array.
 * @return An isolated EditableTextSpan constrained to the word bounds.
 */
function createWordSpan(
  parentSpan: EditableTextSpan,
  parentLine: TextLine,
  word: TextWord,
  wordIndex: number
): EditableTextSpan {
  const wordId = `${parentSpan.id}_w_${word.charStartIndex ?? wordIndex}`;
  const effectiveFontSize = word.fontSize || parentLine.fontSize || parentSpan.fontSize;
  const effectiveFontFamily = word.fontFamily || parentLine.fontFamily || parentSpan.fontFamily;
  const effectiveRawFont = word.rawFontFamily || parentLine.rawFontFamily || parentSpan.rawFontFamily;
  const effectiveMatchedFont = word.matchedFontFamily || parentLine.matchedFontFamily || parentSpan.matchedFontFamily;
  const effectiveColor = word.color || parentLine.color || parentSpan.color;
  const effectiveBaselineY = word.baselineY || parentLine.baselineY || parentSpan.baselineY;
  const effectiveDomBaseline = word.domBaseline || parentLine.domBaseline || parentSpan.domBaseline;
  const effectiveFontWeight = word.fontWeight || parentLine.fontWeight || parentSpan.fontWeight;
  const effectiveFontStyle = word.fontStyle || parentLine.fontStyle || parentSpan.fontStyle;
  const effectiveUnderline = word.underline ?? parentLine.underline ?? parentSpan.underline;
  const effectiveStrikethrough = word.strikethrough ?? parentLine.strikethrough ?? parentSpan.strikethrough;
  const effectiveBgColor = word.backgroundColor || parentLine.backgroundColor || parentSpan.backgroundColor;
  const effectiveRotation = word.rotation ?? parentLine.rotation ?? parentSpan.rotation;
  const effectiveIsVertical = word.isVertical ?? parentLine.isVertical ?? parentSpan.isVertical;
  const effectiveOrientation = word.orientation || parentLine.orientation || parentSpan.orientation;

  const singleWordLine: TextLine = {
    text: word.text,
    left: word.left,
    top: word.top,
    right: word.right,
    bottom: word.bottom,
    width: word.width,
    height: word.height,
    fontSize: effectiveFontSize,
    baselineY: effectiveBaselineY,
    domBaseline: effectiveDomBaseline,
    lineHeight: parentSpan.lineHeight || word.height,
    charStartIndex: word.charStartIndex,
    charCount: word.charCount,
    words: [word],
    fontFamily: effectiveFontFamily,
    rawFontFamily: effectiveRawFont,
    matchedFontFamily: effectiveMatchedFont,
    color: effectiveColor,
    fontWeight: effectiveFontWeight,
    fontStyle: effectiveFontStyle,
    rotation: effectiveRotation,
    isVertical: effectiveIsVertical,
    orientation: effectiveOrientation,
    backgroundColor: effectiveBgColor,
    underline: effectiveUnderline,
    strikethrough: effectiveStrikethrough,
  };

  return {
    type: 'text',
    id: wordId,
    pageIndex: parentSpan.pageIndex,
    text: word.text,
    left: word.left,
    top: word.top,
    width: word.width,
    height: word.height,
    fontSize: effectiveFontSize,
    fontFamily: effectiveFontFamily,
    rawFontFamily: effectiveRawFont,
    matchedFontFamily: effectiveMatchedFont,
    color: effectiveColor,
    baselineY: effectiveBaselineY,
    domBaseline: effectiveDomBaseline,
    charStartIndex: word.charStartIndex,
    charCount: word.charCount,
    lines: [singleWordLine],
    lineHeight: parentSpan.lineHeight,
    letterSpacing: parentSpan.letterSpacing,
    isParagraph: false,
    fontWeight: effectiveFontWeight,
    fontStyle: effectiveFontStyle,
    underline: effectiveUnderline,
    strikethrough: effectiveStrikethrough,
    backgroundColor: effectiveBgColor,
    textAlign: 'left',
    rotation: effectiveRotation,
    isVertical: effectiveIsVertical,
    orientation: effectiveOrientation,
    isOcr: parentSpan.isOcr,
    ocrConfidence: parentSpan.ocrConfidence,
    zIndex: parentSpan.zIndex,
    isWordSpan: true,
  };
}

/**
 * Tokenises text from a simple text span that lacks structured word metrics.
 *
 * @param span The text span to tokenise.
 * @return Array of single-word EditableTextSpan objects.
 */
function tokenizeSimpleSpanText(span: EditableTextSpan): EditableTextSpan[] {
  const parts = span.text.split(/(\s+)/);
  const result: EditableTextSpan[] = [];
  let currentCharOffset = span.charStartIndex || 0;
  let currentLeft = span.left;
  const totalLength = span.text.length || 1;
  const charWidth = span.width / totalLength;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const partWidth = Math.max(1, part.length * charWidth);
    if (part.trim().length > 0) {
      const word: TextWord = {
        text: part,
        left: currentLeft,
        top: span.top,
        right: currentLeft + partWidth,
        bottom: span.top + span.height,
        width: partWidth,
        height: span.height,
        fontSize: span.fontSize,
        baselineY: span.baselineY,
        domBaseline: span.domBaseline,
        charStartIndex: currentCharOffset,
        charCount: part.length,
        fontFamily: span.fontFamily,
        rawFontFamily: span.rawFontFamily,
        matchedFontFamily: span.matchedFontFamily,
        color: span.color,
        fontWeight: span.fontWeight,
        fontStyle: span.fontStyle,
        underline: span.underline,
        strikethrough: span.strikethrough,
        backgroundColor: span.backgroundColor,
        rotation: span.rotation,
        isVertical: span.isVertical,
        orientation: span.orientation,
      };

      const line: TextLine = {
        text: part,
        left: currentLeft,
        top: span.top,
        right: currentLeft + partWidth,
        bottom: span.top + span.height,
        width: partWidth,
        height: span.height,
        fontSize: span.fontSize,
        baselineY: span.baselineY,
        domBaseline: span.domBaseline,
        lineHeight: span.lineHeight || span.height,
        charStartIndex: currentCharOffset,
        charCount: part.length,
        words: [word],
        fontFamily: span.fontFamily,
        rawFontFamily: span.rawFontFamily,
        matchedFontFamily: span.matchedFontFamily,
        color: span.color,
        fontWeight: span.fontWeight,
        fontStyle: span.fontStyle,
        rotation: span.rotation,
        isVertical: span.isVertical,
        orientation: span.orientation,
        backgroundColor: span.backgroundColor,
        underline: span.underline,
        strikethrough: span.strikethrough,
      };

      result.push({
        type: 'text',
        id: `${span.id}_w_${currentCharOffset}`,
        pageIndex: span.pageIndex,
        text: part,
        left: currentLeft,
        top: span.top,
        width: partWidth,
        height: span.height,
        fontSize: span.fontSize,
        fontFamily: span.fontFamily,
        rawFontFamily: span.rawFontFamily,
        matchedFontFamily: span.matchedFontFamily,
        color: span.color,
        baselineY: span.baselineY,
        domBaseline: span.domBaseline,
        charStartIndex: currentCharOffset,
        charCount: part.length,
        lines: [line],
        lineHeight: span.lineHeight,
        letterSpacing: span.letterSpacing,
        isParagraph: false,
        fontWeight: span.fontWeight,
        fontStyle: span.fontStyle,
        underline: span.underline,
        strikethrough: span.strikethrough,
        backgroundColor: span.backgroundColor,
        textAlign: 'left',
        rotation: span.rotation,
        isVertical: span.isVertical,
        orientation: span.orientation,
        isOcr: span.isOcr,
        ocrConfidence: span.ocrConfidence,
        zIndex: span.zIndex,
        isWordSpan: true,
      });
    }
    currentLeft += partWidth;
    currentCharOffset += part.length;
  }

  return result;
}

/**
 * Tokenises text from a line that lacks parsed word tokens.
 *
 * @param line The text line to tokenise.
 * @param span The parent text span.
 * @return Array of single-word EditableTextSpan objects.
 */
function tokenizeLineText(line: TextLine, span: EditableTextSpan): EditableTextSpan[] {
  const parts = line.text.split(/(\s+)/);
  const result: EditableTextSpan[] = [];
  let currentCharOffset = line.charStartIndex || 0;
  let currentLeft = line.left;
  const totalLength = line.text.length || 1;
  const charWidth = line.width / totalLength;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const partWidth = Math.max(1, part.length * charWidth);
    if (part.trim().length > 0) {
      const word: TextWord = {
        text: part,
        left: currentLeft,
        top: line.top,
        right: currentLeft + partWidth,
        bottom: line.bottom,
        width: partWidth,
        height: line.height,
        fontSize: line.fontSize || span.fontSize,
        baselineY: line.baselineY || span.baselineY,
        domBaseline: line.domBaseline || span.domBaseline,
        charStartIndex: currentCharOffset,
        charCount: part.length,
        fontFamily: line.fontFamily || span.fontFamily,
        rawFontFamily: line.rawFontFamily || span.rawFontFamily,
        matchedFontFamily: line.matchedFontFamily || span.matchedFontFamily,
        color: line.color || span.color,
        fontWeight: line.fontWeight || span.fontWeight,
        fontStyle: line.fontStyle || span.fontStyle,
        underline: line.underline ?? span.underline,
        strikethrough: line.strikethrough ?? span.strikethrough,
        backgroundColor: line.backgroundColor || span.backgroundColor,
        rotation: line.rotation ?? span.rotation,
        isVertical: line.isVertical ?? span.isVertical,
        orientation: line.orientation || span.orientation,
      };

      const singleLine: TextLine = {
        text: part,
        left: currentLeft,
        top: line.top,
        right: currentLeft + partWidth,
        bottom: line.bottom,
        width: partWidth,
        height: line.height,
        fontSize: line.fontSize || span.fontSize,
        baselineY: line.baselineY || span.baselineY,
        domBaseline: line.domBaseline || span.domBaseline,
        lineHeight: line.lineHeight || span.lineHeight || line.height,
        charStartIndex: currentCharOffset,
        charCount: part.length,
        words: [word],
        fontFamily: line.fontFamily || span.fontFamily,
        rawFontFamily: line.rawFontFamily || span.rawFontFamily,
        matchedFontFamily: line.matchedFontFamily || span.matchedFontFamily,
        color: line.color || span.color,
        fontWeight: line.fontWeight || span.fontWeight,
        fontStyle: line.fontStyle || span.fontStyle,
        rotation: line.rotation ?? span.rotation,
        isVertical: line.isVertical ?? span.isVertical,
        orientation: line.orientation || span.orientation,
        backgroundColor: line.backgroundColor || span.backgroundColor,
        underline: line.underline ?? span.underline,
        strikethrough: line.strikethrough ?? span.strikethrough,
      };

      result.push({
        type: 'text',
        id: `${span.id}_w_${currentCharOffset}`,
        pageIndex: span.pageIndex,
        text: part,
        left: currentLeft,
        top: line.top,
        width: partWidth,
        height: line.height,
        fontSize: line.fontSize || span.fontSize,
        fontFamily: line.fontFamily || span.fontFamily,
        rawFontFamily: line.rawFontFamily || span.rawFontFamily,
        matchedFontFamily: line.matchedFontFamily || span.matchedFontFamily,
        color: line.color || span.color,
        baselineY: line.baselineY || span.baselineY,
        domBaseline: line.domBaseline || span.domBaseline,
        charStartIndex: currentCharOffset,
        charCount: part.length,
        lines: [singleLine],
        lineHeight: span.lineHeight,
        letterSpacing: span.letterSpacing,
        isParagraph: false,
        fontWeight: line.fontWeight || span.fontWeight,
        fontStyle: line.fontStyle || span.fontStyle,
        underline: line.underline ?? span.underline,
        strikethrough: line.strikethrough ?? span.strikethrough,
        backgroundColor: line.backgroundColor || span.backgroundColor,
        textAlign: 'left',
        rotation: line.rotation ?? span.rotation,
        isVertical: line.isVertical ?? span.isVertical,
        orientation: line.orientation || span.orientation,
        isOcr: span.isOcr,
        ocrConfidence: span.ocrConfidence,
        zIndex: span.zIndex,
        isWordSpan: true,
      });
    }
    currentLeft += partWidth;
    currentCharOffset += part.length;
  }

  return result;
}

/**
 * Decomposes clustered paragraph text spans into individual word-level spans.
 *
 * Each generated span inherits layout, typography, baseline metrics, and
 * styling from the originating parent line and word token, while constraining
 * spatial bounds to the specific word.
 *
 * @param spans Array of clustered EditableTextSpan objects.
 * @return Array of single-word EditableTextSpan objects.
 */
export function decomposeSpansIntoWordSpans(spans: EditableTextSpan[]): EditableTextSpan[] {
  const result: EditableTextSpan[] = [];

  for (const span of spans) {
    if (span.lines && span.lines.length > 0) {
      let wordCount = 0;
      for (const line of span.lines) {
        if (line.words && line.words.length > 0) {
          for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
            const word = line.words[wIdx];
            if (!word.text || word.text.trim().length === 0) {
              continue;
            }
            wordCount++;
            result.push(createWordSpan(span, line, word, wIdx));
          }
        } else if (line.text && line.text.trim().length > 0) {
          const words = tokenizeLineText(line, span);
          for (const w of words) {
            result.push(w);
            wordCount++;
          }
        }
      }
      if (wordCount === 0) {
        result.push(span);
      }
    } else {
      if (span.text && span.text.includes(' ')) {
        const words = tokenizeSimpleSpanText(span);
        if (words.length > 0) {
          result.push(...words);
        } else {
          result.push(span);
        }
      } else {
        result.push(span);
      }
    }
  }

  return result;
}
