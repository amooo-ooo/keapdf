/**
 * OCR Span Converter Utility.
 *
 * Converts structured OCR recognition results into native EditableTextSpan
 * and PageCharacter models with zero engine dependencies.
 */

import type { EditableTextSpan, PageCharacter, TextLine, TextWord } from '../../core/types';
import type { OcrPageResult, OcrSpanConversion } from './ocr-types';

/**
 * Converts structured OCR recognition results into native EditableTextSpan and PageCharacter models.
 *
 * @param ocrResult The recognized page OCR result.
 * @return OcrSpanConversion containing textSpans and characters with isOcr = true.
 */
export function ocrResultToSpans(ocrResult: OcrPageResult): OcrSpanConversion {
  const textSpans: EditableTextSpan[] = [];
  const characters: PageCharacter[] = [];
  const pageIndex = ocrResult.pageIndex;
  let globalCharIndex = 100000 + pageIndex * 50000;

  for (let bIdx = 0; bIdx < ocrResult.blocks.length; bIdx++) {
    const block = ocrResult.blocks[bIdx];

    for (let lIdx = 0; lIdx < block.lines.length; lIdx++) {
      const line = block.lines[lIdx];
      if (line.words.length === 0 || !line.text.trim()) continue;

      const spanId = `ocr_span_${pageIndex}_${bIdx}_${lIdx}`;
      const spanLeft = line.bbox.left;
      const spanTop = line.bbox.top;
      const spanWidth = line.bbox.width;
      const spanHeight = line.bbox.height;
      const spanFontSize = line.fontSize || 12;
      const spanBaselineY = line.baselineY;
      const spanDomBaseline = spanTop + spanFontSize * 0.85;

      // Convert OCR words to structured TextWord records
      let lineCharOffset = 0;
      const lineWords: TextWord[] = line.words.map((w, wIdx) => {
        const wLeft = w.bbox.left;
        const wTop = w.bbox.top;
        const wWidth = w.bbox.width;
        const wHeight = w.bbox.height;
        const wFontSize = w.fontSize || spanFontSize;
        const wBaselineY = w.baselineY;
        const wDomBaseline = wTop + wFontSize * 0.85;
        const charStart = lineCharOffset;
        const charCount = w.text.length;
        lineCharOffset += charCount + (wIdx < line.words.length - 1 ? 1 : 0);

        return {
          text: w.text,
          left: wLeft,
          top: wTop,
          width: wWidth,
          height: wHeight,
          right: wLeft + wWidth,
          bottom: wTop + wHeight,
          fontSize: wFontSize,
          fontFamily: 'Helvetica',
          rawFontFamily: 'Helvetica',
          color: { r: 0, g: 0, b: 0, a: 255 },
          baselineY: wBaselineY,
          domBaseline: wDomBaseline,
          hasPrecedingSpace: wIdx > 0 && Boolean(w.hasPrecedingSpace),
          charStartIndex: charStart,
          charCount,
        };
      });

      const structuredLine: TextLine = {
        text: line.text,
        left: spanLeft,
        top: spanTop,
        right: spanLeft + spanWidth,
        bottom: spanTop + spanHeight,
        width: spanWidth,
        height: spanHeight,
        fontSize: spanFontSize,
        fontFamily: 'Helvetica',
        rawFontFamily: 'Helvetica',
        color: { r: 0, g: 0, b: 0, a: 255 },
        baselineY: spanBaselineY,
        domBaseline: spanDomBaseline,
        words: lineWords,
        lineHeight: line.lineHeight || spanFontSize * 1.25,
        charStartIndex: 0,
        charCount: line.text.length,
      };

      const textSpan: EditableTextSpan = {
        id: spanId,
        type: 'text',
        pageIndex,
        text: line.text,
        left: spanLeft,
        top: spanTop,
        width: spanWidth,
        height: spanHeight,
        fontSize: spanFontSize,
        fontFamily: 'Helvetica',
        rawFontFamily: 'Helvetica',
        color: { r: 0, g: 0, b: 0, a: 255 },
        rotation: 0,
        baselineY: spanBaselineY,
        domBaseline: spanDomBaseline,
        lines: [structuredLine],
        charStartIndex: 0,
        charCount: line.text.length,
        isOcr: true,
        ocrConfidence: line.confidence,
      };

      textSpans.push(textSpan);

      // Synthesize PageCharacter records for character-level drag selection and highlighting
      for (const w of lineWords) {
        const wordText = w.text;
        const charWidth = wordText.length > 0 ? w.width / wordText.length : spanFontSize * 0.55;
        let cursorX = w.left;

        for (let c = 0; c < wordText.length; c++) {
          const char = wordText[c];
          const cLeft = cursorX;
          const cRight = cursorX + charWidth;
          const cTop = w.top;
          const cBottom = w.bottom;

          characters.push({
            charIndex: globalCharIndex++,
            unicode: char,
            fontSize: w.fontSize,
            left: cLeft,
            top: cTop,
            right: cRight,
            bottom: cBottom,
            originX: cLeft,
            originY: w.baselineY,
            domLeft: cLeft,
            domTop: cTop,
            domRight: cRight,
            domBottom: cBottom,
            domBaseline: w.domBaseline ?? (w.top + w.fontSize * 0.85),
            rotation: 0,
            isOcr: true,
          });

          cursorX += charWidth;
        }
      }
    }
  }

  return { textSpans, characters };
}
