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

