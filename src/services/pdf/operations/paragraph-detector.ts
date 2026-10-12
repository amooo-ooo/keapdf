import type { PdfiumEngine } from '../../../core/pdfium-engine';
import type {
  ColorRgba,
  EditableTextSpan,
  PageCropInfo,
  TextLine,
  TextWord,
} from '../../../core/types';
import {
  readCharFontInfo,
  readCharFillColor,
  readCharMatrixScaleY,
  mapStandardFontName,
  cleanSubsetPrefix,
  extractBaseFontFamily,
  isBoldFontName,
  isItalicFontName,
  getPageCropInfo,
  pdfBoxToDomBounds,
  pdfToDomCoords,
} from '../../../core/pdfium-helpers';
import {
  isUnicodeWhitespace,
  isZeroWidthOrInvisible,
  isControlOrUnidentified,
  sanitizePdfText,
} from '../utils';
import {
  estimateWordTrackingPoints,
  formatLetterSpacingPoints,
  computeLineTypographicMetrics,
  computeClusterBaseLineHeight,
  calibrateClusterLineHeights,
  resolveMatrixScaledFontSize,
  UNIT_FONT_SIZE_THRESHOLD,
} from '../../../core/typography-metrics';

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
  fontFlags: number;
  isBold: boolean;
  isItalic: boolean;
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
 * Normalises an angle in radians from PDFium to degrees in the range [0, 360).
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
 * Calibrates character font sizes when PDFium reports a unit or near-zero Tf size (<= 1.5)
 * because the visual point size is encoded in the text transformation matrix Tm.
 *
 * Acts as a glyph box fallback only; characters whose text matrix was readable already
 * carry a matrix-scaled size from `resolveMatrixScaledFontSize` and are skipped.
 *
 * @param chars Extracted raw characters on the page.
 */
function calibrateMatrixScaledCharFontSizes(chars: RawChar[]): void {
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
      chars[j].isVertical === chars[i].isVertical &&
      Math.abs(chars[j].domBaseline - chars[i].domBaseline) <= 4.0 &&
      chars[j].rawFontFamily === chars[i].rawFontFamily
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
 * Detects and clusters characters on a PDF page into semantic multi-line paragraphs.
 *
 * Uses deterministic multi-pass spatial analysis covering glyph extraction and
 * orientation normalisation, word tokenisation, directional line assembly, and
 * orientation-partitioned paragraph and table block clustering.
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
    const cropInfo = getPageCropInfo(engine, mod, pageHandle);

    const leftPtr = engine.allocateMemory(8);
    const topPtr = engine.allocateMemory(8);
    const rightPtr = engine.allocateMemory(8);
    const bottomPtr = engine.allocateMemory(8);
    const xPtr = engine.allocateMemory(8);
    const yPtr = engine.allocateMemory(8);
    const matrixPtr = engine.allocateMemory(24);

    const rawChars: RawChar[] = [];

    try {
      for (let i = 0; i < totalChars; i++) {
        const charCode = mod.FPDFText_GetUnicode(textPageHandle, i);
        if (charCode === 0 || isControlOrUnidentified(charCode)) continue;

        const { fontName: rawFontName, fontFlags } = readCharFontInfo(engine, mod, textPageHandle, i);
        let charStr = String.fromCodePoint(charCode);
        if (charCode === 0xf0b7) {
          charStr = '\u2022';
        } else if (charCode === 0xf0a7) {
          charStr = '\u25AA';
        } else if (charCode === 0xf0d8) {
          charStr = '\u25B8';
        }
        const reportedFontSize = mod.FPDFText_GetFontSize(textPageHandle, i) || 12;
        const fontSize =
          resolveMatrixScaledFontSize(
            reportedFontSize,
            reportedFontSize <= UNIT_FONT_SIZE_THRESHOLD
              ? readCharMatrixScaleY(mod, textPageHandle, i, matrixPtr)
              : null
          ) ?? reportedFontSize;
        const rawWeight = mod.FPDFText_GetFontWeight(textPageHandle, i);
        const isBold = isBoldFontName(rawFontName, rawWeight > 0 ? rawWeight : undefined, fontFlags);
        const isItalic = isItalicFontName(rawFontName, undefined, fontFlags);
        const fontWeight = rawWeight > 0 ? rawWeight : isBold ? 700 : 400;

        const detectedFont = mapStandardFontName(
          rawFontName,
          isBold ? 'bold' : undefined,
          isItalic ? 'italic' : undefined,
          fontFlags
        );
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
          fontFlags,
          isBold,
          isItalic,
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
      engine.freeMemory(matrixPtr);
    }

    if (rawChars.length === 0) return [];

    calibrateMatrixScaledCharFontSizes(rawChars);

    // Pass 2: Word Formation
    const words = formWords(rawChars);
    if (words.length === 0) return [];

    // Pass 3: Line Assembly
    const lines = assembleLines(words);
    if (lines.length === 0) return [];

    // Pass 4: Paragraph & Block Clustering
    const barriers = extractHorizontalBarriers(engine, pageHandle, cropInfo);
    return clusterParagraphs(lines, pageIndex, barriers);
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

function isAlphaNumeric(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function hasAlphaNumericChar(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (isAlphaNumeric(code)) return true;
  }
  return false;
}

/**
 * Computes the dominant font, weight, style, and colour from a set of characters or words,
 * prioritising alphanumeric body characters over bullet symbols or icons.
 */
function getDominantTypography(items: Array<{
  unicode?: string;
  text?: string;
  fontFamily?: string;
  rawFontFamily?: string;
  color?: ColorRgba;
  fontWeight?: number | string;
  fontStyle?: string;
  fontFlags?: number;
  isBold?: boolean;
  isItalic?: boolean;
}>): {
  fontFamily: string;
  rawFontFamily: string;
  color: ColorRgba;
  fontWeight: 'bold' | 'normal';
  fontStyle: 'italic' | 'normal';
} {
  const len = items.length;
  if (len === 0) {
    return {
      fontFamily: 'Helvetica',
      rawFontFamily: 'Helvetica',
      color: { r: 0, g: 0, b: 0, a: 255 },
      fontWeight: 'normal',
      fontStyle: 'normal',
    };
  }

  // Fast path for single item: avoids all Map allocations
  if (len === 1) {
    const it = items[0];
    const raw = it.rawFontFamily || 'Helvetica';
    const detected = it.fontFamily || 'Helvetica';
    const isBold =
      it.isBold !== undefined
        ? it.isBold
        : isBoldFontName(`${raw} ${detected}`, it.fontWeight, it.fontFlags);
    const isItalic =
      it.isItalic !== undefined
        ? it.isItalic
        : isItalicFontName(`${raw} ${detected}`, it.fontStyle, it.fontFlags);
    return {
      fontFamily: detected,
      rawFontFamily: raw,
      color: it.color ?? { r: 0, g: 0, b: 0, a: 255 },
      fontWeight: isBold ? 'bold' : 'normal',
      fontStyle: isItalic ? 'italic' : 'normal',
    };
  }

  // Determine if any alphanumeric body items exist without allocating filtered arrays
  let hasBody = false;
  let hasNonSymbol = false;
  for (let i = 0; i < len; i++) {
    const it = items[i];
    const raw = it.rawFontFamily || '';
    const isSym = isSymbolFont(raw);
    if (!isSym) {
      hasNonSymbol = true;
      const str = it.unicode || it.text || '';
      if (hasAlphaNumericChar(str)) {
        hasBody = true;
        break;
      }
    }
  }

  const fontCounts = new Map<
    string,
    { count: number; raw: string; detected: string; isBold: boolean; isItalic: boolean }
  >();
  // 32-bit integer key for RGBA colours: (r << 24) | (g << 16) | (b << 8) | a
  const colorCounts = new Map<number, { count: number; color: ColorRgba }>();

  for (let i = 0; i < len; i++) {
    const item = items[i];
    const rawFont = item.rawFontFamily || 'Helvetica';
    const cleanFont = cleanSubsetPrefix(rawFont);
    const isSym = isSymbolFont(cleanFont);
    const str = item.unicode || item.text || '';
    const isAlpha = hasAlphaNumericChar(str);

    if (hasBody && (isSym || !isAlpha)) {
      continue;
    }
    if (!hasBody && hasNonSymbol && isSym) {
      continue;
    }

    const detectedFont = item.fontFamily || 'Helvetica';
    const isBold =
      item.isBold !== undefined
        ? item.isBold
        : isBoldFontName(`${cleanFont} ${detectedFont}`, item.fontWeight, item.fontFlags);
    const isItalic =
      item.isItalic !== undefined
        ? item.isItalic
        : isItalicFontName(`${cleanFont} ${detectedFont}`, item.fontStyle, item.fontFlags);
    const fontKey = `${cleanFont}|${isBold ? 'b' : 'n'}|${isItalic ? 'i' : 'n'}`;
    const weightCount = Math.max(1, str.length);

    const entry = fontCounts.get(fontKey);
    if (entry) {
      entry.count += weightCount;
    } else {
      fontCounts.set(fontKey, {
        count: weightCount,
        raw: rawFont,
        detected: detectedFont,
        isBold,
        isItalic,
      });
    }

    if (item.color) {
      const c = item.color;
      const colorKey = ((c.r & 0xff) << 24) | ((c.g & 0xff) << 16) | ((c.b & 0xff) << 8) | (c.a & 0xff);
      const colorEntry = colorCounts.get(colorKey);
      if (colorEntry) {
        colorEntry.count += weightCount;
      } else {
        colorCounts.set(colorKey, { count: weightCount, color: c });
      }
    }
  }

  let maxFontCount = -1;
  let bestFont = { raw: 'Helvetica', detected: 'Helvetica', isBold: false, isItalic: false };
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

  return {
    fontFamily: bestFont.detected,
    rawFontFamily: bestFont.raw,
    color: bestColor,
    fontWeight: bestFont.isBold ? 'bold' : 'normal',
    fontStyle: bestFont.isItalic ? 'italic' : 'normal',
  };
}

/**
 * Calculates the dominant (modal or character-weighted) font size from a list of words or characters.
 * Prioritises alphanumeric body characters over bullet markers, symbols, or small-caps capital letters
 * to prevent outliers from distorting the line or span font size.
 *
 * @param items Array of text words or characters with fontSize property.
 * @return The dominant font size in points.
 */
function getDominantFontSize(
  items: Array<{ text?: string; unicode?: string; fontSize: number; rawFontFamily?: string }>
): number {
  const len = items.length;
  if (len === 0) return 12;
  if (len === 1) return items[0].fontSize;

  // Check if body items exist without allocating filtered arrays
  let hasBody = false;
  for (let i = 0; i < len; i++) {
    const it = items[i];
    const raw = it.rawFontFamily || '';
    if (!isSymbolFont(raw)) {
      const str = it.text || it.unicode || '';
      if (hasAlphaNumericChar(str)) {
        hasBody = true;
        break;
      }
    }
  }

  // Compute character-count weighted frequency of each font size (binned to 0.1pt)
  const sizeWeights = new Map<number, number>();
  let totalChars = 0;
  let weightedSum = 0;

  for (let i = 0; i < len; i++) {
    const item = items[i];
    const raw = item.rawFontFamily || '';
    if (hasBody) {
      if (isSymbolFont(raw)) continue;
      const str = item.text || item.unicode || '';
      if (!hasAlphaNumericChar(str)) continue;
    }

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
 * Measures the signed separation between two intervals on one axis regardless of
 * their order, so vertical glyph runs reading top-to-bottom (90 degrees) and
 * bottom-to-top (270 degrees) share one gap metric.
 *
 * @param aStart Start of the first interval.
 * @param aEnd End of the first interval.
 * @param bStart Start of the second interval.
 * @param bEnd End of the second interval.
 * @return Positive gap between disjoint intervals, or negative overlap depth.
 */
function measureAxisSeparation(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(bStart - aEnd, aStart - bEnd);
}

/**
 * Groups adjacent characters into words based on baseline alignment, orientation, and spacing.
 * Separates bullet/symbol tokens if they have different colours or symbol fonts.
 * Guarantees that characters with different rotations or orientations are never merged.
 *
 * @param chars Raw characters from PDF page.
 * @return Array of TextWord objects.
 */
function formWords(chars: RawChar[]): TextWord[] {
  const words: TextWord[] = [];
  let currentWordChars: RawChar[] = [];
  let pendingPrecedingSpace = false;

  const flushWord = (): void => {
    if (currentWordChars.length === 0) return;

    let wordText = '';
    let minLeft = Infinity;
    let maxRight = -Infinity;
    let minTop = Infinity;
    let maxBottom = -Infinity;
    let sumFontSize = 0;
    let sumOriginY = 0;
    let sumDomBaseline = 0;

    for (const c of currentWordChars) {
      wordText += c.unicode;
      if (c.domLeft < minLeft) minLeft = c.domLeft;
      if (c.domRight > maxRight) maxRight = c.domRight;
      if (c.domTop < minTop) minTop = c.domTop;
      if (c.domBottom > maxBottom) maxBottom = c.domBottom;
      sumFontSize += c.fontSize;
      sumOriginY += c.originY;
      sumDomBaseline += c.domBaseline;
    }

    const sanitized = sanitizePdfText(wordText).trim();
    const firstChar = currentWordChars[0];
    if (sanitized.length > 0 && firstChar && (minLeft < maxRight || minTop < maxBottom || firstChar.isVertical)) {
      const typo = getDominantTypography(currentWordChars);
      const exactFontSize = Math.round((sumFontSize / currentWordChars.length) * 10) / 10;
      const wordWidth = Math.max(1, maxRight - minLeft);
      const wordTrackingPts = firstChar.isVertical
        ? 0
          : estimateWordTrackingPoints(
              sanitized,
              currentWordChars.map((c) => (Number.isFinite(c.originX) ? c.originX : c.domLeft)),
              wordWidth,
              exactFontSize,
              typo.rawFontFamily || typo.fontFamily || 'Helvetica',
              typo.fontWeight === 'bold'
            );
      const wordLetterSpacing = formatLetterSpacingPoints(wordTrackingPts);

      words.push({
        text: sanitized,
        left: minLeft,
        top: minTop,
        right: maxRight,
        bottom: maxBottom,
        width: wordWidth,
        height: Math.max(1, maxBottom - minTop),
        fontSize: exactFontSize,
        baselineY: firstChar.isVertical ? firstChar.originX : sumOriginY / currentWordChars.length,
        domBaseline: firstChar.isVertical ? firstChar.domBaseline : sumDomBaseline / currentWordChars.length,
        charStartIndex: firstChar.charIndex,
        charCount: sanitized.length,
        charIndices: currentWordChars.map((c) => c.charIndex),
        fontFamily: typo.fontFamily,
        rawFontFamily: typo.rawFontFamily,
        color: typo.color,
        fontWeight: typo.fontWeight,
        fontStyle: typo.fontStyle,
        ...(wordLetterSpacing !== 'normal'
          ? { letterSpacing: wordLetterSpacing, letterSpacingPts: wordTrackingPts }
          : {}),
        angle: firstChar.angle,
        rotation: firstChar.rotation,
        isVertical: firstChar.isVertical,
        orientation: firstChar.isVertical ? 'vertical' : 'horizontal',
        hasPrecedingSpace: words.length > 0 ? pendingPrecedingSpace : false,
      });
      pendingPrecedingSpace = false;
    }

    currentWordChars = [];
  };

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (isUnicodeWhitespace(c.unicode)) {
      flushWord();
      pendingPrecedingSpace = true;
      continue;
    }

    if (isZeroWidthOrInvisible(c.unicode)) {
      continue;
    }

    const isCurrentBullet =
      (isBulletChar(c.unicode) && c.unicode !== '-') || isSymbolFont(c.rawFontFamily);

    if (currentWordChars.length > 0) {
      const prev = currentWordChars[currentWordChars.length - 1];
      const isPrevBullet =
        (isBulletChar(prev.unicode) && prev.unicode !== '-') || isSymbolFont(prev.rawFontFamily);

      // Never merge characters with differing rotations or orientations
      if (c.rotation !== prev.rotation || c.isVertical !== prev.isVertical) {
        flushWord();
        currentWordChars.push(c);
        continue;
      }

      const fontDiff = Math.abs(c.fontSize - prev.fontSize);
      const colorDiff = Math.abs(c.color.r - prev.color.r) + Math.abs(c.color.g - prev.color.g) + Math.abs(c.color.b - prev.color.b);
      const isFontChanged = cleanSubsetPrefix(c.rawFontFamily || '') !== cleanSubsetPrefix(prev.rawFontFamily || '');
      const isWeightChanged = Math.abs(c.fontWeight - prev.fontWeight) >= 150 || c.isBold !== prev.isBold;
      const isStyleChanged = c.isItalic !== prev.isItalic;

      if (c.isVertical) {
        // Vertical word flow: spacing along vertical axis, alignment along horizontal axis
        const xDiff = Math.abs(c.domLeft - prev.domLeft);
        const verticalGap = measureAxisSeparation(prev.domTop, prev.domBottom, c.domTop, c.domBottom);

        if (
          isCurrentBullet !== isPrevBullet ||
          colorDiff > 40 ||
          xDiff > 3.0 ||
          verticalGap > prev.fontSize * 0.35 ||
          verticalGap < -2.0 ||
          fontDiff > 0.5 ||
          isFontChanged ||
          isWeightChanged ||
          isStyleChanged
        ) {
          if (verticalGap >= Math.min(prev.fontSize, c.fontSize) * 0.18) {
            pendingPrecedingSpace = true;
          }
          flushWord();
        }
      } else {
        // Horizontal word flow: spacing along horizontal axis, alignment along vertical baseline
        const baselineDiff = Math.abs(c.domBaseline - prev.domBaseline);
        const gap = c.domLeft - prev.domRight;
        const originAdvance =
          Number.isFinite(c.originX) && Number.isFinite(prev.originX)
            ? Math.abs(c.originX - prev.originX)
            : Infinity;
        const maxWordCharGap =
          originAdvance <= prev.fontSize * 0.68
            ? prev.fontSize * 0.55
            : prev.fontSize * 0.35;

        if (
          isCurrentBullet !== isPrevBullet ||
          colorDiff > 40 ||
          baselineDiff > 2.5 ||
          gap > maxWordCharGap ||
          gap < -2.0 ||
          fontDiff > 0.5 ||
          isFontChanged ||
          isWeightChanged ||
          isStyleChanged
        ) {
          if (gap >= Math.min(prev.fontSize, c.fontSize) * 0.18) {
            pendingPrecedingSpace = true;
          }
          flushWord();
        }
      }
    }

    currentWordChars.push(c);
  }

  flushWord();
  return words;
}

interface LayoutBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface GutterInterval {
  start: number;
  end: number;
  width: number;
}

/**
 * Detects vertical whitespace gutters between text columns using a 1D projection histogram.
 *
 * @param boxes Bounding boxes of text elements within the region.
 * @param region Bounding rectangle of the analysis region.
 * @param minGutterWidth Minimum width in points to qualify as a column gutter.
 * @return Array of detected vertical gutter intervals.
 */
function detectVerticalGutters(
  boxes: LayoutBox[],
  region: LayoutBox,
  minGutterWidth: number
): GutterInterval[] {
  if (boxes.length === 0) return [];

  const minX = Math.floor(region.left);
  const maxX = Math.ceil(region.right);
  const width = Math.max(1, maxX - minX);

  const profile = new Uint16Array(width);

  for (const box of boxes) {
    const x0 = Math.max(0, Math.floor(box.left - minX));
    const x1 = Math.min(width, Math.ceil(box.right - minX));
    for (let x = x0; x < x1; x++) {
      profile[x]++;
    }
  }

  const gutters: GutterInterval[] = [];
  const maxNoise = Math.min(2, Math.max(0, Math.floor(boxes.length * 0.015)));
  let inValley = false;
  let valleyStart = 0;

  for (let x = 0; x < width; x++) {
    if (profile[x] <= maxNoise) {
      if (!inValley) {
        inValley = true;
        valleyStart = x;
      }
    } else {
      if (inValley) {
        inValley = false;
        const valleyWidth = x - valleyStart;
        if (valleyWidth >= minGutterWidth && valleyStart > 10 && x < width - 10) {
          gutters.push({
            start: minX + valleyStart,
            end: minX + x,
            width: valleyWidth,
          });
        }
      }
    }
  }

  if (inValley) {
    const valleyWidth = width - valleyStart;
    if (valleyWidth >= minGutterWidth && valleyStart > 10) {
      gutters.push({
        start: minX + valleyStart,
        end: maxX,
        width: valleyWidth,
      });
    }
  }

  return gutters;
}

/**
 * Checks whether a text fragment is a standalone tabular value such as a number,
 * currency figure, percentage, date, or short alphanumeric table code.
 *
 * @param text Text string to inspect.
 * @return True if the fragment matches a tabular data value pattern.
 */
function isTabularDataCellText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 28) return false;
  if (/^[$+\-\u00A3\u00A5\u20AC\u20B9]?\s*\d[\d,.\s/%-]*[$%\u00A3\u00A5\u20AC\u20B9]?$/.test(trimmed)) return true;
  if (/^[A-Z]{1,4}[-/]?\d{2,6}[A-Z0-9-]*$/i.test(trimmed)) return true;
  if (/^\(\s*[$\u00A3\u00A5\u20AC\u20B9]?\d[\d,.]*\s*\)$/.test(trimmed)) return true;
  return false;
}

/**
 * Evaluates whether two adjacent words on the same baseline are typographically compatible
 * to belong to the same text line, preventing merging of code blocks, captions, and body text.
 *
 * @param w1 Left word.
 * @param w2 Right word.
 * @param gap Horizontal gap in points between w1 and w2.
 * @return True if typographically compatible for intra-line assembly.
 */
function isTypographicallyCompatible(w1: TextWord, w2: TextWord, gap: number): boolean {
  if (Math.abs(w1.fontSize - w2.fontSize) > 1.8) {
    return false;
  }

  const minFontSize = Math.min(w1.fontSize, w2.fontSize);
  const isMono1 = /mono|courier|cmtt|consolas|menlo/i.test(w1.fontFamily || w1.rawFontFamily || '');
  const isMono2 = /mono|courier|cmtt|consolas|menlo/i.test(w2.fontFamily || w2.rawFontFamily || '');

  if (isMono1 !== isMono2) {
    const monoGapTolerance = Math.min(20, Math.max(8, minFontSize * 0.95));
    if (gap > monoGapTolerance) {
      return false;
    }
  }

  const base1 = extractBaseFontFamily(w1.rawFontFamily || w1.fontFamily || 'Helvetica');
  const base2 = extractBaseFontFamily(w2.rawFontFamily || w2.fontFamily || 'Helvetica');
  if (base1 !== base2 && gap >= Math.max(8.0, minFontSize * 0.85)) {
    return false;
  }

  const isBold1 = isBoldFontName(`${w1.rawFontFamily || ''} ${w1.fontFamily || ''}`, w1.fontWeight);
  const isBold2 = isBoldFontName(`${w2.rawFontFamily || ''} ${w2.fontFamily || ''}`, w2.fontWeight);
  if (isBold1 !== isBold2 && gap > 24.0) {
    return false;
  }

  if (w1.color && w2.color) {
    const colorDist =
      Math.abs(w1.color.r - w2.color.r) +
      Math.abs(w1.color.g - w2.color.g) +
      Math.abs(w1.color.b - w2.color.b);
    if (colorDist > 55 && gap >= Math.max(8.0, minFontSize * 0.85)) {
      return false;
    }
  }

  return true;
}

/**
 * Segments assembled horizontal text lines into layout bands and columns,
 * enforcing natural column-first reading order within multi-column sections.
 *
 * @param lines Array of assembled horizontal text lines.
 * @return Array of TextLine objects ordered column-first.
 */
function segmentLayoutColumns(lines: TextLine[]): TextLine[] {
  if (lines.length <= 1) return lines;

  const sortedLines = [...lines].sort((a, b) => a.top - b.top);

  const minLeft = Math.min(...sortedLines.map((l) => l.left));
  const maxRight = Math.max(...sortedLines.map((l) => l.right));
  const contentWidth = maxRight - minLeft;

  const spanningLines = new Set<TextLine>();
  for (const line of sortedLines) {
    if (line.width >= contentWidth * 0.72) {
      spanningLines.add(line);
    }
  }

  const bands: TextLine[][] = [];
  let currentBand: TextLine[] = [sortedLines[0]];

  for (let i = 1; i < sortedLines.length; i++) {
    const prev = currentBand[currentBand.length - 1];
    const curr = sortedLines[i];
    const vGap = curr.top - prev.bottom;
    const isSpanningChange = spanningLines.has(prev) !== spanningLines.has(curr);

    if (vGap >= 14 || isSpanningChange) {
      bands.push(currentBand);
      currentBand = [curr];
    } else {
      currentBand.push(curr);
    }
  }
  if (currentBand.length > 0) bands.push(currentBand);

  const resultLines: TextLine[] = [];

  for (const band of bands) {
    const isSpanning = band.some((l) => spanningLines.has(l));
    if (isSpanning || band.length < 3) {
      band.sort((a, b) => a.top - b.top);
      resultLines.push(...band);
      continue;
    }

    const bandLeft = Math.min(...band.map((l) => l.left));
    const bandRight = Math.max(...band.map((l) => l.right));
    const bandTop = Math.min(...band.map((l) => l.top));
    const bandBottom = Math.max(...band.map((l) => l.bottom));

    const gutters = detectVerticalGutters(
      band,
      { left: bandLeft, right: bandRight, top: bandTop, bottom: bandBottom },
      12
    );

    if (gutters.length === 0) {
      band.sort((a, b) => a.top - b.top);
      resultLines.push(...band);
      continue;
    }

    gutters.sort((a, b) => a.start - b.start);
    const colIntervals: Array<{ left: number; right: number }> = [];
    let prevX = bandLeft;
    for (const g of gutters) {
      colIntervals.push({ left: prevX, right: g.start });
      prevX = g.end;
    }
    colIntervals.push({ left: prevX, right: bandRight });

    const columns: TextLine[][] = colIntervals.map(() => []);

    for (const l of band) {
      const lineCenter = (l.left + l.right) / 2;
      let placed = false;
      for (let c = 0; c < colIntervals.length; c++) {
        if (lineCenter >= colIntervals[c].left && lineCenter <= colIntervals[c].right) {
          columns[c].push(l);
          placed = true;
          break;
        }
      }
      if (!placed) {
        let bestCol = 0;
        let bestDist = Infinity;
        for (let c = 0; c < colIntervals.length; c++) {
          const dist = Math.abs(l.left - colIntervals[c].left);
          if (dist < bestDist) {
            bestDist = dist;
            bestCol = c;
          }
        }
        columns[bestCol].push(l);
      }
    }

    for (const col of columns) {
      col.sort((a, b) => a.top - b.top);
      resultLines.push(...col);
    }
  }

  return resultLines;
}

/**
 * Assembles horizontal words into ordered lines.
 *
 * @param words Array of extracted horizontal words.
 * @param rotation Cardinal rotation angle (0 or 180).
 * @return Array of TextLine objects sorted in column-first reading order.
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
    const hasFontSizeStep = Math.abs(word.fontSize - firstWord.fontSize) > 1.5;

    if (baselineDiff <= 3.5 || (hasFontSizeStep && topDiff <= 4.5)) {
      currentGroup.push(word);
    } else {
      lineGroups.push(currentGroup);
      currentGroup = [word];
    }
  }

  if (currentGroup.length > 0) {
    lineGroups.push(currentGroup);
  }

  for (const group of lineGroups) {
    group.sort((a, b) => a.left - b.left);
  }

  const lines: TextLine[] = [];

  for (let gIdx = 0; gIdx < lineGroups.length; gIdx++) {
    const group = lineGroups[gIdx];
    const groupBaseline = group[0]?.baselineY ?? 0;

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
      const minFontSize = Math.min(prevWord.fontSize, word.fontSize);
      const maxIntraLineGap = Math.min(32, Math.max(16, prevWord.fontSize * 1.8));
      const minNegativeGap = -Math.max(6, prevWord.fontSize * 0.65);

      const isTypoMatch = isTypographicallyCompatible(prevWord, word, horizontalGap);

      let isColumnTabSplit = false;
      if (horizontalGap >= Math.max(7.0, minFontSize * 0.72)) {
        const isTabularTokenTransition =
          horizontalGap >= Math.max(9.0, minFontSize * 0.9) &&
          (isTabularDataCellText(word.text) || isTabularDataCellText(prevWord.text));

        if (isTabularTokenTransition) {
          isColumnTabSplit = true;
        } else {
          for (let otherIdx = 0; otherIdx < lineGroups.length; otherIdx++) {
            if (otherIdx === gIdx) continue;
            const otherGroup = lineGroups[otherIdx];
            if (otherGroup.length < 2) continue;
            const otherBaseline = otherGroup[0].baselineY;
            if (Math.abs(otherBaseline - groupBaseline) > 55.0) continue;

            for (let ow = 1; ow < otherGroup.length; ow++) {
              const otherWord = otherGroup[ow];
              const otherPrev = otherGroup[ow - 1];
              const otherGap = otherWord.left - otherPrev.right;
              if (otherGap < Math.max(6.5, Math.min(otherPrev.fontSize, otherWord.fontSize) * 0.68)) {
                continue;
              }
              const leftAligned = Math.abs(otherWord.left - word.left) <= 2.5;
              const rightAligned =
                Math.abs(otherWord.right - word.right) <= 2.5 &&
                (isTabularDataCellText(word.text) || isTabularDataCellText(otherWord.text));
              if (leftAligned || rightAligned) {
                isColumnTabSplit = true;
                break;
              }
            }
            if (isColumnTabSplit) break;
          }
        }
      }

      if (
        horizontalGap > maxIntraLineGap ||
        horizontalGap < minNegativeGap ||
        !isTypoMatch ||
        isColumnTabSplit
      ) {
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
      let sumDomBaseline = 0;
      let fullLineText = '';

      for (let wIdx = 0; wIdx < textWords.length; wIdx++) {
        const w = textWords[wIdx];
        if (wIdx > 0) {
          const prev = textWords[wIdx - 1];
          const gap = w.left - prev.right;
          const hasSpace =
            w.hasPrecedingSpace !== undefined
              ? Boolean(w.hasPrecedingSpace)
              : gap >= Math.min(prev.fontSize, w.fontSize) * 0.18;
          if (hasSpace) {
            fullLineText += ' ';
          }
        }
        fullLineText += w.text;

        if (w.left < minLeft) minLeft = w.left;
        if (w.right > maxRight) maxRight = w.right;
        if (w.top < minTop) minTop = w.top;
        if (w.bottom > maxBottom) maxBottom = w.bottom;
        sumBaselineY += w.baselineY;
        if (w.domBaseline !== undefined) sumDomBaseline += w.domBaseline;
      }

      if (fullLineText.trim().length === 0) continue;

      const typo = getDominantTypography(textWords);
      const dominantLineFontSize = getDominantFontSize(textWords);
      const avgBaselineY = sumBaselineY / textWords.length;
      const avgDomBaseline = sumDomBaseline > 0 ? sumDomBaseline / textWords.length : undefined;
      const lineHeight = dominantLineFontSize * 1.25;
      const lineMetrics = computeLineTypographicMetrics(
        textWords,
        dominantLineFontSize,
        typo.fontFamily || typo.rawFontFamily || 'Helvetica'
      );

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
        domBaseline: avgDomBaseline,
        lineHeight,
        charStartIndex: textWords[0].charStartIndex,
        charCount: textWords.reduce((sum, w) => sum + w.charCount, 0),
        words: textWords,
        fontFamily: typo.fontFamily,
        rawFontFamily: typo.rawFontFamily,
        color: typo.color,
        fontWeight: typo.fontWeight,
        fontStyle: typo.fontStyle,
        ...(lineMetrics.letterSpacing !== 'normal'
          ? { letterSpacing: lineMetrics.letterSpacing }
          : {}),
        ...(lineMetrics.wordSpacing !== undefined && Math.abs(lineMetrics.wordSpacing) >= 0.05
          ? { wordSpacing: lineMetrics.wordSpacing }
          : {}),
        ...(Math.abs(lineMetrics.scaleX - 1.0) >= 0.02
          ? { scaleX: lineMetrics.scaleX }
          : {}),
        hasBulletPrefix: hasBullet,
        bulletWord,
        rotation,
        isVertical: false,
        orientation: 'horizontal',
      });
    }
  }

  return segmentLayoutColumns(lines);
}

/**
 * Sorts the words of one vertical line into reading order in place.
 *
 * Words are first ordered top-to-bottom; when the content stream order of the
 * sorted words predominantly decreases, the run reads bottom-to-top (text rotated
 * anticlockwise) and the order is reversed so the line text matches visual reading.
 *
 * @param words Words sharing one vertical line axis.
 */
function sortVerticalWordsInReadingOrder(words: TextWord[]): void {
  words.sort((a, b) => a.top - b.top);
  let ascending = 0;
  let descending = 0;
  for (let k = 1; k < words.length; k++) {
    const delta = words[k].charStartIndex - words[k - 1].charStartIndex;
    if (delta > 0) ascending++;
    else if (delta < 0) descending++;
  }
  if (descending > ascending) {
    words.reverse();
  }
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
    sortVerticalWordsInReadingOrder(group);

    const subGroups: TextWord[][] = [];
    let currentSubGroup: TextWord[] = [];

    for (let w = 0; w < group.length; w++) {
      const word = group[w];
      if (currentSubGroup.length === 0) {
        currentSubGroup.push(word);
        continue;
      }

      const prevWord = currentSubGroup[currentSubGroup.length - 1];
      const verticalGap = measureAxisSeparation(prevWord.top, prevWord.bottom, word.top, word.bottom);
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
      let sumBaseline = 0;
      let sumDomBaseline = 0;
      let fullLineText = '';

      for (let wIdx = 0; wIdx < textWords.length; wIdx++) {
        const w = textWords[wIdx];
        if (wIdx > 0) {
          const prev = textWords[wIdx - 1];
          const gap = measureAxisSeparation(prev.top, prev.bottom, w.top, w.bottom);
          if (w.hasPrecedingSpace || gap >= Math.min(prev.fontSize, w.fontSize) * 0.18) {
            fullLineText += ' ';
          }
        }
        fullLineText += w.text;

        if (w.left < minLeft) minLeft = w.left;
        if (w.right > maxRight) maxRight = w.right;
        if (w.top < minTop) minTop = w.top;
        if (w.bottom > maxBottom) maxBottom = w.bottom;
        sumBaseline += w.baselineY;
        if (w.domBaseline !== undefined) sumDomBaseline += w.domBaseline;
      }

      if (fullLineText.trim().length === 0) continue;

      const typo = getDominantTypography(textWords);
      const dominantLineFontSize = getDominantFontSize(textWords);
      const avgBaseline = sumBaseline / textWords.length;
      const avgDomBaseline = sumDomBaseline > 0 ? sumDomBaseline / textWords.length : undefined;
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
        baselineY: avgBaseline,
        domBaseline: avgDomBaseline,
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
        isVertical: true,
        orientation: 'vertical',
      });
    }
  }

  return lines;
}

/**
 * Groups words into ordered lines based on horizontal/vertical baseline alignment.
 * Separates words by orientation so vertical text is never mixed with horizontal lines.
 *
 * @param words Array of extracted words.
 * @return Array of TextLine objects.
 */
function assembleLines(words: TextWord[]): TextLine[] {
  if (words.length === 0) return [];

  const wordsByRotation = new Map<number, TextWord[]>();
  for (const word of words) {
    const rot = word.rotation || 0;
    const bucket = wordsByRotation.get(rot) || [];
    bucket.push(word);
    wordsByRotation.set(rot, bucket);
  }

  const allLines: TextLine[] = [];

  for (const [rot, bucketWords] of wordsByRotation.entries()) {
    if (rot === 90 || rot === 270) {
      allLines.push(...assembleVerticalLines(bucketWords, rot));
    } else {
      allLines.push(...assembleHorizontalLines(bucketWords, rot));
    }
  }

  return allLines;
}

/**
 * Horizontal vector barrier segment in DOM coordinates (y increasing downward).
 */
interface HorizontalBarrierSegment {
  left: number;
  right: number;
  domY: number;
}

/**
 * Extracts horizontal vector path barriers (table grid borders, cell box top/bottom
 * edges, and horizontal divider rules) from a PDF page in DOM coordinates.
 *
 * @param engine Initialised PdfiumEngine instance.
 * @param pageHandle Native handle to the open PDF page.
 * @param cropInfo Active page crop and rotation geometry.
 * @return Array of horizontal barrier segments in DOM coordinates.
 */
function extractHorizontalBarriers(
  engine: PdfiumEngine,
  pageHandle: number,
  cropInfo: PageCropInfo
): HorizontalBarrierSegment[] {
  const mod = engine.getModule();
  if (
    typeof mod.FPDFPage_CountObjects !== 'function' ||
    typeof mod.FPDFPage_GetObject !== 'function' ||
    typeof mod.FPDFPageObj_GetType !== 'function' ||
    typeof mod.FPDFPageObj_GetBounds !== 'function'
  ) {
    return [];
  }

  const objCount = mod.FPDFPage_CountObjects(pageHandle);
  if (objCount <= 0) return [];

  const lPtr = engine.allocateMemory(4);
  const bPtr = engine.allocateMemory(4);
  const rPtr = engine.allocateMemory(4);
  const tPtr = engine.allocateMemory(4);
  const barriers: HorizontalBarrierSegment[] = [];

  try {
    const heightPts = cropInfo.cropHeight || mod.FPDF_GetPageHeightF(pageHandle);
    for (let i = 0; i < objCount; i++) {
      const objHandle = mod.FPDFPage_GetObject(pageHandle, i);
      if (!objHandle) continue;

      const objType = mod.FPDFPageObj_GetType(objHandle);
      // FPDF_PAGEOBJ_PATH = 2 (FPDF_PAGEOBJ_TEXT = 1)
      if (objType !== 2) continue;

      const ok = mod.FPDFPageObj_GetBounds(objHandle, lPtr, bPtr, rPtr, tPtr);
      if (!ok) continue;

      const pdfLeft = mod.pdfium.HEAPF32[lPtr >> 2];
      const pdfBottom = mod.pdfium.HEAPF32[bPtr >> 2];
      const pdfRight = mod.pdfium.HEAPF32[rPtr >> 2];
      const pdfTop = mod.pdfium.HEAPF32[tPtr >> 2];

      let domLeft: number;
      let domRight: number;
      let domTop: number;
      let domBottom: number;

      if (cropInfo.rotation !== 0) {
        const bounds = pdfBoxToDomBounds(pdfLeft, pdfBottom, pdfRight, pdfTop, cropInfo);
        domLeft = bounds.left;
        domRight = bounds.right;
        domTop = bounds.top;
        domBottom = bounds.bottom;
      } else {
        domLeft = Math.min(pdfLeft, pdfRight) - cropInfo.cropLeft;
        domRight = Math.max(pdfLeft, pdfRight) - cropInfo.cropLeft;
        domTop = heightPts - (Math.max(pdfTop, pdfBottom) - cropInfo.cropBottom);
        domBottom = heightPts - (Math.min(pdfTop, pdfBottom) - cropInfo.cropBottom);
      }

      const width = domRight - domLeft;
      const height = domBottom - domTop;
      if (width < 18.0) continue;

      if (height <= 3.5) {
        barriers.push({
          left: domLeft,
          right: domRight,
          domY: (domTop + domBottom) / 2,
        });
      } else if (height >= 8.0 && height <= 450.0 && width >= 24.0) {
        barriers.push({ left: domLeft, right: domRight, domY: domTop });
        barriers.push({ left: domLeft, right: domRight, domY: domBottom });
      }
    }
  } finally {
    engine.freeMemory(lPtr);
    engine.freeMemory(bPtr);
    engine.freeMemory(rPtr);
    engine.freeMemory(tPtr);
  }

  return barriers;
}

/**
 * Checks whether a horizontal vector barrier (table row border or cell boundary)
 * lies vertically between two candidate lines and overlaps their horizontal span.
 *
 * @param prevLine Preceding line in reading order.
 * @param nextLine Candidate line below prevLine.
 * @param barriers Extracted horizontal barrier segments in DOM space.
 * @return True if a horizontal border separates prevLine and nextLine.
 */
function hasHorizontalBarrierBetween(
  prevLine: TextLine,
  nextLine: TextLine,
  barriers: HorizontalBarrierSegment[]
): boolean {
  if (barriers.length === 0) return false;

  const prevDomBaseline = prevLine.domBaseline ?? prevLine.bottom - prevLine.fontSize * 0.2;
  const nextDomBaseline = nextLine.domBaseline ?? nextLine.bottom - nextLine.fontSize * 0.2;
  const minY = Math.min(prevDomBaseline, prevLine.bottom) - prevLine.fontSize * 0.1;
  const maxY = Math.max(nextLine.top + nextLine.fontSize * 0.25, nextDomBaseline - nextLine.fontSize * 0.35);
  if (maxY <= minY) return false;

  const spanLeft = Math.min(prevLine.left, nextLine.left);
  const spanRight = Math.max(prevLine.right, nextLine.right);
  const minRequiredOverlap = Math.min(16.0, Math.min(prevLine.width, nextLine.width) * 0.45);

  for (const b of barriers) {
    if (b.domY <= minY || b.domY >= maxY) continue;

    const overlap = Math.min(spanRight, b.right) - Math.max(spanLeft, b.left);
    if (overlap < minRequiredOverlap) continue;

    const barrierWidth = b.right - b.left;
    const isInlineUnderline =
      b.domY - prevDomBaseline <= prevLine.fontSize * 0.26 &&
      barrierWidth <= prevLine.width + 6.0;
    if (isInlineUnderline) continue;

    return true;
  }

  return false;
}

/**
 * Merges horizontally adjacent co-linear line fragments on the same baseline into single lines.
 *
 * @param lines Array of TextLine objects sorted in reading order.
 * @return Array of TextLine objects with co-linear fragments unified.
 */
export function mergeColinearLines(lines: TextLine[]): TextLine[] {
  if (lines.length <= 1) return lines;

  const merged: TextLine[] = [];
  let current = { ...lines[0] };

  for (let i = 1; i < lines.length; i++) {
    const next = lines[i];
    const baselineDiff = Math.abs(current.baselineY - next.baselineY);
    const avgFontSize = (current.fontSize + next.fontSize) / 2;
    const colinearGap = next.left - current.right;
    const maxColinearGap = Math.min(10.0, avgFontSize * 0.95);
    const lastCurrentWord =
      current.words && current.words.length > 0
        ? current.words[current.words.length - 1]
        : null;
    const firstNextWord =
      next.words && next.words.length > 0 ? next.words[0] : null;
    const wordsCompatible =
      !lastCurrentWord ||
      !firstNextWord ||
      isTypographicallyCompatible(lastCurrentWord, firstNextWord, colinearGap);

    const isColinear =
      baselineDiff <= 3.0 &&
      next.left >= current.left - 2.0 &&
      next.left <= current.right + maxColinearGap &&
      Math.abs(current.fontSize - next.fontSize) <= 1.8 &&
      wordsCompatible &&
      !hasIncompatibleLineStyle(current, next);

    if (isColinear) {
      const minLeft = Math.min(current.left, next.left);
      const maxRight = Math.max(current.right, next.right);
      const minTop = Math.min(current.top, next.top);
      const maxBottom = Math.max(current.bottom, next.bottom);
      const nextWord = next.words && next.words.length > 0 ? next.words[0] : null;
      const colinearGap = next.left - current.right;
      const needsSpace = Boolean(nextWord?.hasPrecedingSpace) || colinearGap >= Math.min(current.fontSize, next.fontSize) * 0.18;
      const combinedText = current.text + (needsSpace ? ' ' : '') + next.text;
      const nextWordsCloned = (next.words || []).map((w, idx) => {
        if (idx === 0 && needsSpace && !w.hasPrecedingSpace) {
          return { ...w, hasPrecedingSpace: true };
        }
        return { ...w };
      });
      const combinedWords = [...(current.words || []).map((w) => ({ ...w })), ...nextWordsCloned];

      const mergedFontSize = getDominantFontSize(combinedWords);
      const mergedTypo = getDominantTypography(combinedWords);
      const mergedMetrics = computeLineTypographicMetrics(
        combinedWords,
        mergedFontSize,
        mergedTypo.fontFamily || mergedTypo.rawFontFamily || 'Helvetica'
      );
      const mergedLetterSpacing =
        mergedMetrics.letterSpacing !== 'normal'
          ? mergedMetrics.letterSpacing
          : current.letterSpacing || next.letterSpacing;
      const mergedWordSpacing =
        mergedMetrics.wordSpacing !== undefined && Math.abs(mergedMetrics.wordSpacing) >= 0.05
          ? mergedMetrics.wordSpacing
          : current.wordSpacing ?? next.wordSpacing;

      current = {
        ...current,
        text: combinedText,
        words: combinedWords,
        left: minLeft,
        right: maxRight,
        top: minTop,
        bottom: maxBottom,
        width: maxRight - minLeft,
        height: maxBottom - minTop,
        charCount: combinedText.length,
        charStartIndex: Math.min(current.charStartIndex, next.charStartIndex),
        fontSize: mergedFontSize,
        fontFamily: mergedTypo.fontFamily,
        rawFontFamily: mergedTypo.rawFontFamily,
        color: mergedTypo.color,
        fontWeight: mergedTypo.fontWeight,
        fontStyle: mergedTypo.fontStyle,
        ...(mergedLetterSpacing ? { letterSpacing: mergedLetterSpacing } : {}),
        ...(mergedWordSpacing !== undefined ? { wordSpacing: mergedWordSpacing } : {}),
      };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

/** Maximum leftward drift (pt) a list item continuation may have relative to its marker. */
const LIST_CONTINUATION_OUTDENT_TOLERANCE_PT = 2.0;

/**
 * Detects a candidate line that starts left of the marker of the list item opening
 * the current cluster, which can never be a hanging-indent continuation.
 *
 * @param clusterAnchor The first line of the current cluster.
 * @param nextLine The candidate line.
 * @return True when the cluster is a list item and the candidate outdents past it.
 */
function isOutdentedFromListItem(clusterAnchor: TextLine, nextLine: TextLine): boolean {
  return (
    isBulletOrListItem(clusterAnchor) &&
    nextLine.left < clusterAnchor.left - LIST_CONTINUATION_OUTDENT_TOLERANCE_PT
  );
}

/**
 * Checks whether a line has a uniform base font family across all of its words.
 *
 * @param line Target text line.
 * @return Normalised base font family when uniform, or null when mixed.
 */
function getUniformLineBaseFont(line: TextLine): string | null {
  const base = extractBaseFontFamily(line.rawFontFamily || line.fontFamily || 'Helvetica');
  if (!line.words || line.words.length <= 1) return base;
  for (const w of line.words) {
    if (extractBaseFontFamily(w.rawFontFamily || w.fontFamily || line.fontFamily || 'Helvetica') !== base) {
      return null;
    }
  }
  return base;
}

/**
 * Checks whether a line has a uniform fill colour across all of its words.
 *
 * @param line Target text line.
 * @return Line colour when uniform, or null when mixed.
 */
function getUniformLineColor(line: TextLine): ColorRgba | null {
  const base = line.color;
  if (!base) return null;
  if (!line.words || line.words.length <= 1) return base;
  for (const w of line.words) {
    if (!w.color) continue;
    const dist =
      Math.abs(w.color.r - base.r) +
      Math.abs(w.color.g - base.g) +
      Math.abs(w.color.b - base.b);
    if (dist > 30) return null;
  }
  return base;
}

/**
 * Determines whether two candidate lines have incompatible line-level typography
 * (distinct uniform base font families, distinct uniform colours, or a weight
 * transition accompanied by a font size step) that would cause paragraph
 * clustering to normalise unrelated lines to the wrong font or colour.
 *
 * @param prevLine Preceding line in the cluster.
 * @param nextLine Candidate line to merge.
 * @return True when the two lines should not be merged into one paragraph.
 */
function hasIncompatibleLineStyle(prevLine: TextLine, nextLine: TextLine): boolean {
  const prevFont = getUniformLineBaseFont(prevLine);
  const nextFont = getUniformLineBaseFont(nextLine);
  if (prevFont && nextFont && prevFont !== nextFont) {
    return true;
  }

  const prevColor = getUniformLineColor(prevLine);
  const nextColor = getUniformLineColor(nextLine);
  if (prevColor && nextColor) {
    const colorDist =
      Math.abs(prevColor.r - nextColor.r) +
      Math.abs(prevColor.g - nextColor.g) +
      Math.abs(prevColor.b - nextColor.b);
    if (colorDist > 60) {
      return true;
    }
  }

  const prevWeight = prevLine.fontWeight || 'normal';
  const nextWeight = nextLine.fontWeight || 'normal';
  if (prevWeight !== nextWeight && Math.abs(prevLine.fontSize - nextLine.fontSize) >= 0.75) {
    return true;
  }

  return false;
}

/**
 * Checks whether all words in a line share the same font weight.
 *
 * @param line Target text line.
 * @return Uniform weight ('bold' or 'normal') or null when mixed.
 */
function getUniformLineWeight(line: TextLine): 'bold' | 'normal' | null {
  const base = line.fontWeight === 'bold' ? 'bold' : 'normal';
  if (!line.words || line.words.length <= 1) return base;
  for (const w of line.words) {
    const wWeight = w.fontWeight === 'bold' ? 'bold' : 'normal';
    if (wWeight !== base) return null;
  }
  return base;
}

/**
 * Finds horizontal row peers sharing the same baseline as a target line.
 *
 * @param target Line to inspect.
 * @param allLines All assembled horizontal lines on the page.
 * @return Array of peer lines on the same row baseline.
 */
function findRowPeerLines(target: TextLine, allLines: TextLine[]): TextLine[] {
  const peers: TextLine[] = [];
  for (const candidate of allLines) {
    if (candidate === target) continue;
    const tol = Math.max(3.5, Math.min(candidate.fontSize, target.fontSize) * 0.35);
    if (Math.abs(candidate.baselineY - target.baselineY) > tol) continue;
    if (candidate.left > target.right + 4.0 || candidate.right < target.left - 4.0) {
      peers.push(candidate);
    }
  }
  return peers;
}

/**
 * Determines whether two vertically consecutive lines within a column belong to
 * distinct table or key-value rows and therefore must not be merged into a single
 * multi-line paragraph span.
 *
 * @param prevLine Preceding line in the current cluster.
 * @param nextLine Candidate line below prevLine.
 * @param allLines All unified horizontal lines on the page.
 * @return True when prevLine and nextLine belong to separate table rows.
 */
function isTableRowSeparationBetween(
  prevLine: TextLine,
  nextLine: TextLine,
  allLines: TextLine[]
): boolean {
  if (isTabularDataCellText(prevLine.text) && isTabularDataCellText(nextLine.text)) {
    return true;
  }

  const prevPeers = findRowPeerLines(prevLine, allLines);
  const nextPeers = findRowPeerLines(nextLine, allLines);

  const prevUniformWeight = getUniformLineWeight(prevLine);
  const nextUniformWeight = getUniformLineWeight(nextLine);
  if (
    prevUniformWeight &&
    nextUniformWeight &&
    prevUniformWeight !== nextUniformWeight &&
    (prevPeers.length > 0 || nextPeers.length > 0 || prevLine.width < 150.0)
  ) {
    return true;
  }

  if (nextPeers.length === 0) {
    return false;
  }

  const hasTabularOrShortPeer = (peers: TextLine[]): boolean =>
    peers.some(
      (p) =>
        isTabularDataCellText(p.text) ||
        ((p.words?.length ?? 1) <= 2 && p.width < 110.0)
    );

  // Transition from a wrapped continuation line (fewer peers) to a new table row
  if (nextPeers.length > prevPeers.length && hasTabularOrShortPeer(nextPeers)) {
    return true;
  }

  if (prevPeers.length >= 1 && nextPeers.length >= 1) {
    if (
      (prevPeers.length >= 2 || nextPeers.length >= 2) &&
      prevLine.width < 180.0 &&
      nextLine.width < 180.0
    ) {
      return true;
    }

    if (
      isTabularDataCellText(prevLine.text) ||
      isTabularDataCellText(nextLine.text) ||
      hasTabularOrShortPeer(prevPeers) ||
      hasTabularOrShortPeer(nextPeers)
    ) {
      return true;
    }

    const prevWordCount = prevLine.words?.length ?? 1;
    const nextWordCount = nextLine.words?.length ?? 1;
    if (
      prevWordCount <= 3 &&
      nextWordCount <= 3 &&
      prevLine.width < 135.0 &&
      nextLine.width < 135.0
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Clusters horizontal lines into semantic paragraph blocks.
 *
 * @param lines Sorted array of horizontal text lines.
 * @param pageIndex Zero-based page index.
 * @param rotation Cardinal rotation angle (0 or 180).
 * @return Array of EditableTextSpan objects representing paragraphs.
 */
function clusterHorizontalParagraphs(
  lines: TextLine[],
  pageIndex: number,
  rotation: number
): EditableTextSpan[] {
  if (lines.length === 0) return [];

  const unifiedLines = mergeColinearLines(lines);
  const paragraphClusters: TextLine[][] = [];
  let currentCluster: TextLine[] = [unifiedLines[0]];

  for (let i = 1; i < unifiedLines.length; i++) {
    const prevLine = currentCluster[currentCluster.length - 1];
    const nextLine = unifiedLines[i];

    const isNextBullet = isBulletOrListItem(nextLine);
    const isPrevBullet = isBulletOrListItem(prevLine);

    // RULE 1: Each bullet point is its OWN separate block
    if (isNextBullet) {
      paragraphClusters.push(currentCluster);
      currentCluster = [nextLine];
      continue;
    }

    // RULE 2: If previous line was a bullet point, next line can ONLY merge if indented
    if (isPrevBullet) {
      const isIndentedWrap = nextLine.left >= prevLine.left - 4.0 && nextLine.left <= prevLine.left + 35.0;
      const verticalGap = nextLine.top - prevLine.bottom;
      const avgFontSize = (prevLine.fontSize + nextLine.fontSize) / 2;
      const isTightLeading = verticalGap >= -avgFontSize * 0.3 && verticalGap <= avgFontSize * 1.25;

      if (isIndentedWrap && isTightLeading && Math.abs(nextLine.fontSize - prevLine.fontSize) <= 1.5) {
        currentCluster.push(nextLine);
      } else {
        paragraphClusters.push(currentCluster);
        currentCluster = [nextLine];
      }
      continue;
    }

    // RULE 3: Regular body paragraph lines merge based on reading geometry
    const verticalGap = nextLine.top - prevLine.bottom;
    const avgFontSize = (prevLine.fontSize + nextLine.fontSize) / 2;
    const baselineDiff = Math.abs(nextLine.baselineY - prevLine.baselineY);

    const isLeadingValid = verticalGap >= -avgFontSize * 0.35 && verticalGap <= avgFontSize * 1.35;
    const isBaselineValid = baselineDiff >= avgFontSize * 0.75 && baselineDiff <= avgFontSize * 2.2;

    const leftMarginDiff = Math.abs(nextLine.left - prevLine.left);
    const isLeftAligned = leftMarginDiff <= 24.0;
    const isIndentedFirstLine =
      currentCluster.length === 1 &&
      nextLine.left < prevLine.left &&
      prevLine.left - nextLine.left <= 36.0;

    const horizontalOverlap = Math.min(prevLine.right, nextLine.right) - Math.max(prevLine.left, nextLine.left);
    const minLineWidth = Math.min(prevLine.width, nextLine.width);
    const hasColumnOverlap = horizontalOverlap > Math.min(20.0, minLineWidth * 0.25);

    const isSeparateColumn = nextLine.left > prevLine.right + 12.0 || nextLine.right < prevLine.left - 12.0;
    const isFontParity = Math.abs(nextLine.fontSize - prevLine.fontSize) <= 1.8;

    const prevEndsWithPunctuation = /[.?!:][\s\u200B-\u200F\uFEFF\u2060]*$/.test(prevLine.text);
    const isIndentedNewParagraph = prevEndsWithPunctuation && nextLine.left >= prevLine.left + Math.max(10.0, avgFontSize * 0.8);
    const isShortTerminalLine = prevEndsWithPunctuation && prevLine.right < nextLine.right - Math.max(25.0, avgFontSize * 2.5) && verticalGap > avgFontSize * 0.45;
    const isParagraphBreak = isShortTerminalLine || isIndentedNewParagraph;
    const isLargeBreak = verticalGap > Math.max(8.0, avgFontSize * 0.85);

    const isPrevHeading = prevLine.text.length < 35 && prevLine.fontSize > nextLine.fontSize + 1.5;
    const isLargeBreakAfterHeading = isPrevHeading && verticalGap > avgFontSize * 0.5;

    const shouldMerge =
      !isSeparateColumn &&
      !isParagraphBreak &&
      !isLargeBreak &&
      !isLargeBreakAfterHeading &&
      isFontParity &&
      isLeadingValid &&
      isBaselineValid &&
      (isLeftAligned || isIndentedFirstLine || hasColumnOverlap);

    if (shouldMerge) {
      currentCluster.push(nextLine);
    } else {
      paragraphClusters.push(currentCluster);
      currentCluster = [nextLine];
    }
  }

  if (currentCluster.length > 0) {
    paragraphClusters.push(currentCluster);
  }

  const spans: EditableTextSpan[] = [];

  for (const cluster of paragraphClusters) {
    if (cluster.length === 0) continue;

    let minLeft = Infinity;
    let maxRight = -Infinity;
    let minTop = Infinity;
    let maxBottom = -Infinity;
    let sumBaselineY = 0;
    const allClusterWords: TextWord[] = [];

    for (const l of cluster) {
      const lineMinLeft = l.hasBulletPrefix && l.bulletWord ? Math.min(l.left, l.bulletWord.left) : l.left;
      const lineMinTop = l.hasBulletPrefix && l.bulletWord ? Math.min(l.top, l.bulletWord.top) : l.top;
      if (lineMinLeft < minLeft) minLeft = lineMinLeft;
      if (l.right > maxRight) maxRight = l.right;
      if (lineMinTop < minTop) minTop = lineMinTop;
      if (l.bottom > maxBottom) maxBottom = l.bottom;
      sumBaselineY += l.baselineY;
      if (l.words) {
        for (const w of l.words) allClusterWords.push(w);
      }
    }

    const firstLine = cluster[0];
    const lastLine = cluster[cluster.length - 1];
    const totalChars = cluster.reduce((sum, l) => sum + l.charCount, 0);

    const spanId = `span_p_${pageIndex}_${firstLine.charStartIndex}_${totalChars}`;
    const combinedText = cluster.map((l) => l.text).join('\n');

    const typo = getDominantTypography(allClusterWords.length > 0 ? allClusterWords : cluster);
    const dominantSpanFontSize = getDominantFontSize(allClusterWords.length > 0 ? allClusterWords : cluster);

    const calculatedLineHeight =
      cluster.length > 1
        ? Math.abs(firstLine.baselineY - lastLine.baselineY) / (cluster.length - 1)
        : dominantSpanFontSize * 1.25;

    spans.push({
      type: 'text',
      id: spanId,
      pageIndex,
      text: combinedText,
      left: minLeft,
      top: minTop,
      width: Math.max(10, maxRight - minLeft),
      height: Math.max(dominantSpanFontSize * 1.2, maxBottom - minTop),
      fontSize: dominantSpanFontSize,
      fontFamily: typo.fontFamily,
      rawFontFamily: typo.rawFontFamily,
      color: typo.color,
      baselineY: firstLine.baselineY,
      domBaseline: firstLine.domBaseline,
      charStartIndex: firstLine.charStartIndex,
      charCount: totalChars,
      lines: cluster,
      lineHeight: calculatedLineHeight > 0 ? calculatedLineHeight : dominantSpanFontSize * 1.25,
      isParagraph: cluster.length > 1,
      fontWeight: typo.fontWeight,
      fontStyle: typo.fontStyle,
      hasBulletPrefix: firstLine.hasBulletPrefix,
      bulletWord: firstLine.bulletWord,
      rotation,
      isVertical: false,
      orientation: 'horizontal',
    });
  }

  return spans;
}

/**
 * Clusters vertical lines into semantic vertical text blocks.
 *
 * @param lines Sorted array of vertical text lines.
 * @param pageIndex Zero-based page index.
 * @param rotation Cardinal rotation (90 or 270).
 * @return Array of EditableTextSpan objects.
 */
function clusterVerticalParagraphs(
  lines: TextLine[],
  pageIndex: number,
  rotation: number
): EditableTextSpan[] {
  if (lines.length === 0) return [];

  const paragraphClusters: TextLine[][] = [];
  let currentCluster: TextLine[] = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const prevLine = currentCluster[currentCluster.length - 1];
    const nextLine = lines[i];

    const isNextBullet = isBulletOrListItem(nextLine);
    const isPrevBullet = isBulletOrListItem(prevLine);

    if (isNextBullet || isPrevBullet) {
      paragraphClusters.push(currentCluster);
      currentCluster = [nextLine];
      continue;
    }

    const horizontalGap = Math.abs(nextLine.left - prevLine.right);
    const avgFontSize = (prevLine.fontSize + nextLine.fontSize) / 2;
    const isLeadingValid = horizontalGap >= -avgFontSize * 0.4 && horizontalGap <= avgFontSize * 1.5;

    const verticalOverlap = Math.min(prevLine.bottom, nextLine.bottom) - Math.max(prevLine.top, nextLine.top);
    const hasRowOverlap = verticalOverlap > -10.0;
    const isFontParity = Math.abs(nextLine.fontSize - prevLine.fontSize) <= 1.8;

    if (isLeadingValid && hasRowOverlap && isFontParity) {
      currentCluster.push(nextLine);
    } else {
      paragraphClusters.push(currentCluster);
      currentCluster = [nextLine];
    }
  }

  if (currentCluster.length > 0) {
    paragraphClusters.push(currentCluster);
  }

  const spans: EditableTextSpan[] = [];

  for (const cluster of paragraphClusters) {
    if (cluster.length === 0) continue;

    let minLeft = Infinity;
    let maxRight = -Infinity;
    let minTop = Infinity;
    let maxBottom = -Infinity;
    let sumBaseline = 0;
    const allClusterWords: TextWord[] = [];

    for (const l of cluster) {
      const lineMinLeft = l.hasBulletPrefix && l.bulletWord ? Math.min(l.left, l.bulletWord.left) : l.left;
      const lineMinTop = l.hasBulletPrefix && l.bulletWord ? Math.min(l.top, l.bulletWord.top) : l.top;
      if (lineMinLeft < minLeft) minLeft = lineMinLeft;
      if (l.right > maxRight) maxRight = l.right;
      if (lineMinTop < minTop) minTop = lineMinTop;
      if (l.bottom > maxBottom) maxBottom = l.bottom;
      sumBaseline += l.baselineY;
      if (l.words) {
        for (const w of l.words) allClusterWords.push(w);
      }
    }

    const firstLine = cluster[0];
    const totalChars = cluster.reduce((sum, l) => sum + l.charCount, 0);

    const spanId = `span_p_${pageIndex}_${firstLine.charStartIndex}_${totalChars}`;
    const combinedText = cluster.map((l) => l.text).join('\n');

    const typo = getDominantTypography(allClusterWords.length > 0 ? allClusterWords : cluster);
    const dominantSpanFontSize = getDominantFontSize(allClusterWords.length > 0 ? allClusterWords : cluster);

    spans.push({
      type: 'text',
      id: spanId,
      pageIndex,
      text: combinedText,
      left: minLeft,
      top: minTop,
      width: Math.max(10, maxRight - minLeft),
      height: Math.max(dominantSpanFontSize * 1.2, maxBottom - minTop),
      fontSize: dominantSpanFontSize,
      fontFamily: typo.fontFamily,
      rawFontFamily: typo.rawFontFamily,
      color: typo.color,
      baselineY: sumBaseline / cluster.length,
      domBaseline: firstLine.domBaseline,
      charStartIndex: firstLine.charStartIndex,
      charCount: totalChars,
      lines: cluster,
      lineHeight: dominantSpanFontSize * 1.25,
      isParagraph: cluster.length > 1,
      fontWeight: typo.fontWeight,
      fontStyle: typo.fontStyle,
      hasBulletPrefix: firstLine.hasBulletPrefix,
      bulletWord: firstLine.bulletWord,
      rotation,
      isVertical: true,
      orientation: 'vertical',
    });
  }

  return spans;
}

/**
 * Clusters lines into semantic paragraph blocks.
 * Partitions lines by orientation to guarantee horizontal and vertical text are never merged.
 *
 * @param lines Sorted array of text lines.
 * @param pageIndex Zero-based page index.
 * @return Array of EditableTextSpan objects.
 */
function clusterParagraphs(lines: TextLine[], pageIndex: number): EditableTextSpan[] {
  if (lines.length === 0) return [];

  const linesByRotation = new Map<number, TextLine[]>();
  for (const line of lines) {
    const rot = line.rotation || 0;
    const bucket = linesByRotation.get(rot) || [];
    bucket.push(line);
    linesByRotation.set(rot, bucket);
  }

  const allSpans: EditableTextSpan[] = [];

  for (const [rot, bucketLines] of linesByRotation.entries()) {
    if (rot === 90 || rot === 270) {
      allSpans.push(...clusterVerticalParagraphs(bucketLines, pageIndex, rot));
    } else {
      allSpans.push(...clusterHorizontalParagraphs(bucketLines, pageIndex, rot));
    }
  }

  return allSpans;
}
