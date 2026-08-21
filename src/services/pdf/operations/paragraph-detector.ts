import type { PdfiumEngine } from '../../../core/pdfium-engine';
import type {
  ColorRgba,
  EditableTextSpan,
  TextLine,
  TextWord,
} from '../../../core/types';
import {
  readCharFontName,
  readCharFillColor,
  mapStandardFontName,
} from '../../../core/pdfium-helpers';

/**
 * Raw character metrics extracted directly from PDFium text stream.
 */
interface RawChar {
  charIndex: number;
  unicode: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  originX: number;
  originY: number;
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  rawFontFamily: string;
  color: ColorRgba;
  domLeft: number;
  domTop: number;
  domRight: number;
  domBottom: number;
  domBaseline: number;
  angle: number;
  rotation: 0 | 90 | 180 | 270;
  isVertical: boolean;
}

/**
 * Normalizes an angle in radians from PDFium to degrees in the range [0, 360).
 *
 * @param angleRad Character rotation angle in radians.
 * @return Angle in degrees.
 */
export function normalizeAngleDeg(angleRad: number): number {
  if (isNaN(angleRad)) return 0;
  let deg = (angleRad * (180 / Math.PI)) % 360;
  if (deg < 0) deg += 360;
  return Math.round(deg * 100) / 100;
}

/**
 * Snaps an angle in degrees to the closest standard 90-degree cardinal rotation (0, 90, 180, 270).
 *
 * @param deg Angle in degrees.
 * @return Rounded cardinal rotation.
 */
export function getCardinalRotation(deg: number): 0 | 90 | 180 | 270 {
  const norm = ((deg % 360) + 360) % 360;
  if (norm >= 45 && norm < 135) return 90;
  if (norm >= 135 && norm < 225) return 180;
  if (norm >= 225 && norm < 315) return 270;
  return 0;
}

/**
 * Determines whether a cardinal rotation represents vertical text orientation.
 *
 * @param rotation Cardinal rotation in degrees.
 * @return True if vertical.
 */
export function isVerticalRotation(rotation: number): boolean {
  return rotation === 90 || rotation === 270;
}

/**
 * Detects and clusters characters on a PDF page into semantic multi-line paragraphs.
 *
 * Uses deterministic multi-pass spatial analysis:
 * 1. Glyph extraction, orientation normalization, and coordinate mapping
 * 2. Orientation-isolated word tokenization
 * 3. Directional line assembly (horizontal vs vertical lines)
 * 4. Orientation-partitioned paragraph and block clustering
 *
 * @param engine The PDFium engine instance.
 * @param pageIndex Zero-based page index.
 * @param pageHandle Active page handle.
 * @return An array of EditableTextSpan objects representing paragraphs and text blocks.
 */
export function detectParagraphs(
  engine: PdfiumEngine,
  pageIndex: number,
  pageHandle: number
): EditableTextSpan[] {
  const mod = engine.getModule();
  let textPageHandle = 0;

  try {
    textPageHandle = mod.FPDFText_LoadPage(pageHandle);
    if (!textPageHandle) return [];

    const totalChars = mod.FPDFText_CountChars(textPageHandle);
    if (totalChars <= 0) return [];

    const heightPts = mod.FPDF_GetPageHeightF(pageHandle);

    const leftPtr = engine.allocateMemory(8);
    const topPtr = engine.allocateMemory(8);
    const rightPtr = engine.allocateMemory(8);
    const bottomPtr = engine.allocateMemory(8);
    const xPtr = engine.allocateMemory(8);
    const yPtr = engine.allocateMemory(8);

    const rawChars: RawChar[] = [];

    try {
      for (let i = 0; i < totalChars; i++) {
        const charCode = mod.FPDFText_GetUnicode(textPageHandle, i);
        if (charCode === 0) continue;

        const rawFontName = readCharFontName(engine, mod, textPageHandle, i);
        let charStr = String.fromCharCode(charCode);
        if (charCode === 0xf0b7) {
          charStr = '\u2022';
        } else if (charCode === 0xf0a7) {
          charStr = '\u25AA';
        } else if (charCode === 0xf0d8) {
          charStr = '\u25B8';
        }
        const fontSize = mod.FPDFText_GetFontSize(textPageHandle, i) || 12;
        const fontWeight = mod.FPDFText_GetFontWeight(textPageHandle, i) || 400;

        const detectedFont = mapStandardFontName(rawFontName);
        const charColor = readCharFillColor(engine, mod, textPageHandle, i);

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

        if (right <= left) {
          right = left + fontSize * 0.28;
        }

        let domTop: number;
        let domBottom: number;
        let domLeft: number;
        let domRight: number;
        let domBaseline: number;

        if (isVertical) {
          domTop = Math.max(0, heightPts - Math.max(top, bottom));
          domBottom = Math.max(0, heightPts - Math.min(top, bottom));
          domLeft = Math.min(left, right);
          domRight = Math.max(left, right);
          domBaseline = originX;
        } else {
          domBaseline = heightPts - originY;
          domLeft = Math.min(left, right);
          domRight = Math.max(left, right);
          domTop = Math.max(0, heightPts - Math.max(top, bottom));
          domBottom = Math.max(0, heightPts - Math.min(top, bottom));

          if (domBottom <= domTop) {
            domTop = Math.max(0, domBaseline - fontSize * 0.85);
            domBottom = domBaseline + fontSize * 0.25;
          }
        }

        rawChars.push({
          charIndex: i,
          unicode: charStr,
          left,
          top,
          right,
          bottom,
          originX,
          originY,
          fontSize,
          fontWeight,
          fontFamily: detectedFont,
          rawFontFamily: rawFontName,
          color: charColor,
          domLeft,
          domTop,
          domRight,
          domBottom,
          domBaseline,
          angle: angleDeg,
          rotation,
          isVertical,
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

    if (rawChars.length === 0) return [];

    // Pass 2: Word Formation
    const words = formWords(rawChars);
    if (words.length === 0) return [];

    // Pass 3: Line Assembly
    const lines = assembleLines(words);
    if (lines.length === 0) return [];

    // Pass 4: Paragraph & Block Clustering
    return clusterParagraphs(lines, pageIndex);
  } finally {
    if (textPageHandle) {
      mod.FPDFText_ClosePage(textPageHandle);
    }
  }
}

/**
 * Returns true if the font name corresponds to a symbol or decorative icon font.
 */
function isSymbolFont(rawFontName: string): boolean {
  if (!rawFontName) return false;
  const lower = rawFontName.toLowerCase();
  return (
    lower.includes('wingding') ||
    lower.includes('zapfding') ||
    lower.includes('symbol') ||
    lower.includes('webding') ||
    lower.includes('dingbat')
  );
}

/**
 * Returns true if the character is a bullet symbol or decorative marker glyph.
 */
function isBulletChar(charStr: string): boolean {
  if (!charStr) return false;
  const code = charStr.charCodeAt(0);
  return (
    charStr === '*' ||
    charStr === '-' ||
    charStr === '\u2022' ||
    charStr === '\u25AA' ||
    charStr === '\u25AB' ||
    charStr === '\u25E6' ||
    charStr === '\u25CF' ||
    charStr === '\u2023' ||
    charStr === '\u2043' ||
    charStr === '\u2219' ||
    charStr === '\u25B8' ||
    charStr === '\u25C6' ||
    charStr === '\u25C7' ||
    charStr === '\u00B7' ||
    code === 0x2022 ||
    code === 0x2023 ||
    code === 0x2043 ||
    code === 0x2219 ||
    code === 0x25e6 ||
    code === 0x25cf ||
    code === 0x25aa ||
    code === 0x25ab ||
    code === 0x25b8 ||
    code === 0x25c6 ||
    code === 0x25c7 ||
    code === 0x00b7 ||
    code === 0xf0a7 ||
    code === 0xf0b7 ||
    code === 0xf0d8 ||
    (code >= 0xf000 && code <= 0xf0ff)
  );
}

/**
 * Checks if a word is a bullet marker or decorative list bullet symbol.
 */
function isBulletWord(word: TextWord): boolean {
  if (!word || !word.text) return false;
  const trimmed = word.text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length === 1) {
    if (isBulletChar(trimmed)) return true;
    if (word.rawFontFamily && isSymbolFont(word.rawFontFamily)) return true;
  }
  return /^[\*\-\u2022\u25E6\u25CF\uF0A7\uF0B7\u25AA\u25AB\u2023\u2043\u2219\u25B8\u25C6\u25C7\u00B7]$/.test(trimmed);
}

/**
 * Checks if a text line starts with a bullet point marker or list numbering.
 */
function isBulletOrListItem(line: TextLine): boolean {
  if (!line) return false;
  if (line.hasBulletPrefix) return true;
  if (!line.text) return false;
  const trimmed = line.text.trim();
  if (trimmed.length === 0) return false;

  // Check leading bullet regex or numbering: e.g. "* ", "1. ", "a) "
  if (/^([\*\u2022\u25E6\u25CF\uF0A7\uF0B7\u25AA\u25AB\u2023\u2043\u2219\u25B8\u25C6\u25C7]|(\d+|[a-zA-Z])[\.\)])(\s|$)/.test(trimmed)) {
    return true;
  }

  // Check if the first word is a standalone bullet character or symbol font
  if (line.words && line.words.length > 0) {
    const firstWord = line.words[0];
    if (isBulletWord(firstWord)) {
      return true;
    }
  }

  return false;
}

/**
 * Computes the dominant font, weight, style, and color from a set of characters or words,
 * prioritizing alphanumeric body characters over bullet symbols or icons.
 */
function getDominantTypography(items: Array<{
  unicode?: string;
  text?: string;
  fontFamily?: string;
  rawFontFamily?: string;
  color?: ColorRgba;
  fontWeight?: number | string;
}>): {
  fontFamily: string;
  rawFontFamily: string;
  color: ColorRgba;
  fontWeight: 'bold' | 'normal';
  fontStyle: 'italic' | 'normal';
} {
  // Filter for alphanumeric body characters first
  const bodyItems = items.filter((item) => {
    const str = item.unicode || item.text || '';
    const raw = item.rawFontFamily || '';
    return /[a-zA-Z0-9]/.test(str) && !isSymbolFont(raw);
  });

  const nonSymbolItems = items.filter((item) => !isSymbolFont(item.rawFontFamily || ''));
  const candidateItems = bodyItems.length > 0 ? bodyItems : (nonSymbolItems.length > 0 ? nonSymbolItems : items);

  if (candidateItems.length === 0) {
    return {
      fontFamily: 'Helvetica',
      rawFontFamily: 'Helvetica',
      color: { r: 0, g: 0, b: 0, a: 255 },
      fontWeight: 'normal',
      fontStyle: 'normal',
    };
  }

  const fontCounts = new Map<string, { count: number; raw: string; detected: string; isBold: boolean }>();
  const colorCounts = new Map<string, { count: number; color: ColorRgba }>();

  for (const item of candidateItems) {
    const rawFont = item.rawFontFamily || 'Helvetica';
    const detectedFont = item.fontFamily || 'Helvetica';
    const rawLower = rawFont.toLowerCase();
    const isBold =
      typeof item.fontWeight === 'number'
        ? item.fontWeight >= 600 || rawLower.includes('bold')
        : item.fontWeight === 'bold' || rawLower.includes('bold');

    const entry = fontCounts.get(rawFont) || { count: 0, raw: rawFont, detected: detectedFont, isBold };
    entry.count++;
    fontCounts.set(rawFont, entry);

    if (item.color) {
      const colorKey = `${item.color.r},${item.color.g},${item.color.b},${item.color.a}`;
      const colorEntry = colorCounts.get(colorKey) || { count: 0, color: item.color };
      colorEntry.count++;
      colorCounts.set(colorKey, colorEntry);
    }
  }

  let maxFontCount = -1;
  let bestFont = { raw: 'Helvetica', detected: 'Helvetica', isBold: false };
  for (const entry of fontCounts.values()) {
    if (entry.count > maxFontCount) {
      maxFontCount = entry.count;
      bestFont = entry;
    }
  }

  let maxColorCount = -1;
  let bestColor: ColorRgba = { r: 0, g: 0, b: 0, a: 255 };
  for (const entry of colorCounts.values()) {
    if (entry.count > maxColorCount) {
      maxColorCount = entry.count;
      bestColor = entry.color;
    }
  }

  const rawLower = bestFont.raw.toLowerCase();
  const isItalic = rawLower.includes('italic') || rawLower.includes('oblique');

  return {
    fontFamily: bestFont.detected,
    rawFontFamily: bestFont.raw,
    color: bestColor,
    fontWeight: bestFont.isBold ? 'bold' : 'normal',
    fontStyle: isItalic ? 'italic' : 'normal',
  };
}

/**
 * Calculates the dominant (modal or character-weighted) font size from a list of words or characters.
 * Prioritizes alphanumeric body characters over bullet markers, symbols, or small-caps capital letters
 * to prevent outliers from distorting the line or span font size.
 *
 * @param items Array of text words or characters with fontSize property.
 * @return The dominant font size in points.
 */
function getDominantFontSize(
  items: Array<{ text?: string; unicode?: string; fontSize: number; rawFontFamily?: string }>
): number {
  if (items.length === 0) return 12;

  // Filter for alphanumeric body characters
  const bodyItems = items.filter((item) => {
    const str = item.text || item.unicode || '';
    const raw = item.rawFontFamily || '';
    return /[a-zA-Z0-9]/.test(str) && !isSymbolFont(raw);
  });

  const candidateItems = bodyItems.length > 0 ? bodyItems : items;

  // Compute character-count weighted frequency of each font size (binned to 0.1pt)
  const sizeWeights = new Map<number, number>();
  let totalChars = 0;
  let weightedSum = 0;

  for (const item of candidateItems) {
    const charCount = (item.text || item.unicode || 'x').length;
    const roundedSize = Math.round(item.fontSize * 10) / 10;
    const currentWeight = sizeWeights.get(roundedSize) || 0;
    sizeWeights.set(roundedSize, currentWeight + charCount);
    weightedSum += item.fontSize * charCount;
    totalChars += charCount;
  }

  // Find the modal font size (most frequent by character count)
  let maxWeight = -1;
  let modalSize = 12;
  for (const [size, weight] of sizeWeights.entries()) {
    if (weight > maxWeight) {
      maxWeight = weight;
      modalSize = size;
    }
  }

  // If the modal font size represents >= 35% of characters, use it
  if (maxWeight >= totalChars * 0.35) {
    return modalSize;
  }

  return totalChars > 0 ? Math.round((weightedSum / totalChars) * 10) / 10 : modalSize;
}

/**
 * Groups adjacent characters into words based on baseline alignment, orientation, and spacing.
 * Separates bullet/symbol tokens if they have different colors or symbol fonts.
 * Guarantees that characters with different rotations or orientations are never merged.
 *
 * @param chars Raw characters from PDF page.
 * @return Array of TextWord objects.
 */
function formWords(chars: RawChar[]): TextWord[] {
  const words: TextWord[] = [];
  let currentWordChars: RawChar[] = [];

  const flushWord = (): void => {
    if (currentWordChars.length === 0) return;

    let wordText = '';
    let minLeft = Infinity;
    let maxRight = -Infinity;
    let minTop = Infinity;
    let maxBottom = -Infinity;
    let sumFontSize = 0;
    let sumOriginY = 0;

    for (const c of currentWordChars) {
      wordText += c.unicode;
      if (c.domLeft < minLeft) minLeft = c.domLeft;
      if (c.domRight > maxRight) maxRight = c.domRight;
      if (c.domTop < minTop) minTop = c.domTop;
      if (c.domBottom > maxBottom) maxBottom = c.domBottom;
      sumFontSize += c.fontSize;
      sumOriginY += c.originY;
    }

    const trimmed = wordText.trim();
    if (trimmed.length > 0 && (minLeft < maxRight || minTop < maxBottom)) {
      const typo = getDominantTypography(currentWordChars);
      const exactFontSize = Math.round((sumFontSize / currentWordChars.length) * 10) / 10;
      const firstChar = currentWordChars[0];

      words.push({
        text: trimmed,
        left: minLeft,
        top: minTop,
        right: maxRight,
        bottom: maxBottom,
        width: Math.max(1, maxRight - minLeft),
        height: Math.max(1, maxBottom - minTop),
        fontSize: exactFontSize,
        baselineY: firstChar.isVertical ? firstChar.originX : sumOriginY / currentWordChars.length,
        charStartIndex: firstChar.charIndex,
        charCount: currentWordChars.length,
        fontFamily: typo.fontFamily,
        rawFontFamily: typo.rawFontFamily,
        color: typo.color,
        fontWeight: typo.fontWeight,
        fontStyle: typo.fontStyle,
        angle: firstChar.angle,
        rotation: firstChar.rotation,
        isVertical: firstChar.isVertical,
        orientation: firstChar.isVertical ? 'vertical' : 'horizontal',
      });
    }

    currentWordChars = [];
  };

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const isWhitespace = c.unicode === ' ' || c.unicode === '\t' || c.unicode === '\n' || c.unicode === '\r';

    if (isWhitespace) {
      flushWord();
      continue;
    }

    const isCurrentBullet = isBulletChar(c.unicode) || isSymbolFont(c.rawFontFamily);

    if (currentWordChars.length > 0) {
      const prev = currentWordChars[currentWordChars.length - 1];
      const isPrevBullet = isBulletChar(prev.unicode) || isSymbolFont(prev.rawFontFamily);

      // Never merge characters with differing rotations or orientations
      if (c.rotation !== prev.rotation || c.isVertical !== prev.isVertical) {
        flushWord();
        currentWordChars.push(c);
        continue;
      }

      const fontDiff = Math.abs(c.fontSize - prev.fontSize);
      const colorDiff = Math.abs(c.color.r - prev.color.r) + Math.abs(c.color.g - prev.color.g) + Math.abs(c.color.b - prev.color.b);
      const isFontChanged = c.rawFontFamily !== prev.rawFontFamily;
      const isWeightChanged = Math.abs(c.fontWeight - prev.fontWeight) >= 150;

      if (c.isVertical) {
        // Vertical word flow: spacing along vertical axis, alignment along horizontal axis
        const xDiff = Math.abs(c.domLeft - prev.domLeft);
        const verticalGap = Math.abs(c.domTop - prev.domBottom);

        if (
          isCurrentBullet !== isPrevBullet ||
          colorDiff > 40 ||
          xDiff > 3.0 ||
          verticalGap > prev.fontSize * 0.35 ||
          fontDiff > 0.5 ||
          isFontChanged ||
          isWeightChanged
        ) {
          flushWord();
        }
      } else {
        // Horizontal word flow: spacing along horizontal axis, alignment along vertical baseline
        const baselineDiff = Math.abs(c.domBaseline - prev.domBaseline);
        const gap = c.domLeft - prev.domRight;

        if (
          isCurrentBullet !== isPrevBullet ||
          colorDiff > 40 ||
          baselineDiff > 2.5 ||
          gap > prev.fontSize * 0.35 ||
          gap < -2.0 ||
          fontDiff > 0.5 ||
          isFontChanged ||
          isWeightChanged
        ) {
          flushWord();
        }
      }
    }

    currentWordChars.push(c);
  }

  flushWord();
  return words;
}

/**
 * Assembles horizontal words into ordered lines.
 *
 * @param words Array of extracted horizontal words.
 * @param rotation Cardinal rotation angle (0 or 180).
 * @return Array of TextLine objects sorted top-to-bottom.
 */
function assembleHorizontalLines(words: TextWord[], rotation: number): TextLine[] {
  if (words.length === 0) return [];

  const sortedWords = [...words].sort((a, b) => {
    const baselineDiff = a.top - b.top;
    if (Math.abs(baselineDiff) > 3.0) {
      return baselineDiff;
    }
    return a.left - b.left;
  });

  const lineGroups: TextWord[][] = [];
  let currentGroup: TextWord[] = [];

  for (const word of sortedWords) {
    if (currentGroup.length === 0) {
      currentGroup.push(word);
      continue;
    }

    const firstWord = currentGroup[0];
    const baselineDiff = Math.abs(word.baselineY - firstWord.baselineY);
    const topDiff = Math.abs(word.top - firstWord.top);

    if (baselineDiff <= 3.5 || topDiff <= 4.5) {
      currentGroup.push(word);
    } else {
      lineGroups.push(currentGroup);
      currentGroup = [word];
    }
  }

  if (currentGroup.length > 0) {
    lineGroups.push(currentGroup);
  }

  const lines: TextLine[] = [];

  for (const group of lineGroups) {
    group.sort((a, b) => a.left - b.left);

    const subGroups: TextWord[][] = [];
    let currentSubGroup: TextWord[] = [];

    for (let w = 0; w < group.length; w++) {
      const word = group[w];
      if (currentSubGroup.length === 0) {
        currentSubGroup.push(word);
        continue;
      }

      const prevWord = currentSubGroup[currentSubGroup.length - 1];
      const horizontalGap = word.left - prevWord.right;
      const columnGutterThreshold = Math.max(32, prevWord.fontSize * 2.5);

      if (horizontalGap > columnGutterThreshold) {
        subGroups.push(currentSubGroup);
        currentSubGroup = [word];
      } else {
        currentSubGroup.push(word);
      }
    }

    if (currentSubGroup.length > 0) {
      subGroups.push(currentSubGroup);
    }

    for (const subGroup of subGroups) {
      let hasBullet = false;
      let bulletWord: TextWord | undefined;
      let textWords = subGroup;

      if (subGroup.length > 0 && isBulletWord(subGroup[0])) {
        hasBullet = true;
        bulletWord = subGroup[0];
        if (subGroup.length > 1) {
          textWords = subGroup.slice(1);
        } else {
          continue;
        }
      }

      let minLeft = Infinity;
      let maxRight = -Infinity;
      let minTop = Infinity;
      let maxBottom = -Infinity;
      let sumBaselineY = 0;
      let fullLineText = '';

      for (let wIdx = 0; wIdx < textWords.length; wIdx++) {
        const w = textWords[wIdx];
        if (wIdx > 0) {
          const prev = textWords[wIdx - 1];
          const gap = w.left - prev.right;
          if (gap >= Math.min(prev.fontSize, w.fontSize) * 0.18) {
            fullLineText += ' ';
          }
        }
        fullLineText += w.text;

        if (w.left < minLeft) minLeft = w.left;
        if (w.right > maxRight) maxRight = w.right;
        if (w.top < minTop) minTop = w.top;
        if (w.bottom > maxBottom) maxBottom = w.bottom;
        sumBaselineY += w.baselineY;
      }

      if (fullLineText.trim().length === 0) continue;

      const typo = getDominantTypography(textWords);
      const dominantLineFontSize = getDominantFontSize(textWords);
      const avgBaselineY = sumBaselineY / textWords.length;
      const lineHeight = dominantLineFontSize * 1.25;

      lines.push({
        text: fullLineText,
        left: minLeft,
        top: minTop,
        right: maxRight,
        bottom: maxBottom,
        width: Math.max(1, maxRight - minLeft),
        height: Math.max(1, maxBottom - minTop),
        fontSize: dominantLineFontSize,
        baselineY: avgBaselineY,
        lineHeight,
        charStartIndex: textWords[0].charStartIndex,
        charCount: textWords.reduce((sum, w) => sum + w.charCount, 0),
        words: textWords,
        fontFamily: typo.fontFamily,
        rawFontFamily: typo.rawFontFamily,
        color: typo.color,
        fontWeight: typo.fontWeight,
        fontStyle: typo.fontStyle,
        hasBulletPrefix: hasBullet,
        bulletWord,
        rotation,
        isVertical: false,
        orientation: 'horizontal',
      });
    }
  }

  return lines.sort((a, b) => a.top - b.top);
}

/**
 * Assembles vertical words into ordered lines.
 *
 * @param words Array of extracted vertical words.
 * @param rotation Cardinal rotation angle (90 or 270).
 * @return Array of TextLine objects sorted left-to-right.
 */
function assembleVerticalLines(words: TextWord[], rotation: number): TextLine[] {
  if (words.length === 0) return [];

  const sortedWords = [...words].sort((a, b) => {
    const xDiff = a.left - b.left;
    if (Math.abs(xDiff) > 3.0) {
      return xDiff;
    }
    return a.top - b.top;
  });

  const lineGroups: TextWord[][] = [];
  let currentGroup: TextWord[] = [];

  for (const word of sortedWords) {
    if (currentGroup.length === 0) {
      currentGroup.push(word);
      continue;
    }

    const firstWord = currentGroup[0];
    const xDiff = Math.abs(word.left - firstWord.left);

    if (xDiff <= 4.0) {
      currentGroup.push(word);
    } else {
      lineGroups.push(currentGroup);
      currentGroup = [word];
    }
  }

  if (currentGroup.length > 0) {
    lineGroups.push(currentGroup);
  }

  const lines: TextLine[] = [];

  for (const group of lineGroups) {
    group.sort((a, b) => a.top - b.top);

    const subGroups: TextWord[][] = [];
    let currentSubGroup: TextWord[] = [];

    for (let w = 0; w < group.length; w++) {
      const word = group[w];
      if (currentSubGroup.length === 0) {
        currentSubGroup.push(word);
        continue;
      }

      const prevWord = currentSubGroup[currentSubGroup.length - 1];
      const verticalGap = word.top - prevWord.bottom;
      const columnGutterThreshold = Math.max(24, prevWord.fontSize * 2.0);

      if (verticalGap > columnGutterThreshold) {
        subGroups.push(currentSubGroup);
        currentSubGroup = [word];
      } else {
        currentSubGroup.push(word);
      }
    }

    if (currentSubGroup.length > 0) {
      subGroups.push(currentSubGroup);
    }

    for (const subGroup of subGroups) {
      let hasBullet = false;
      let bulletWord: TextWord | undefined;
      let textWords = subGroup;

