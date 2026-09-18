/**
 * Sanitisation and transliteration utilities for PDF standard font WinAnsiEncoding.
 * Standard PDF fonts (Helvetica, Times, Courier) only support Windows-1252.
 * This module safely transliterates or sanitises unsupported characters to prevent fatal crashes.
 */

import type { PDFFont } from 'pdf-lib';

/**
 * Set of supported WinAnsi unicode code points outside standard ASCII and Latin-1 supplement.
 */
const WIN_ANSI_EXTRA_POINTS: ReadonlySet<number> = new Set([
  0x20ac, // Euro sign
  0x201a, // Single low-9 quotation mark
  0x0192, // Latin small letter f with hook
  0x201e, // Double low-9 quotation mark
  0x2026, // Horizontal ellipsis
  0x2020, // Dagger
  0x2021, // Double dagger
  0x02c6, // Modifier letter circumflex accent
  0x2030, // Per mille sign
  0x0160, // Latin capital letter S with caron
  0x2039, // Single left-pointing angle quotation mark
  0x0152, // Latin capital ligature OE
  0x017d, // Latin capital letter Z with caron
  0x2018, // Left single quotation mark
  0x2019, // Right single quotation mark
  0x201c, // Left double quotation mark
  0x201d, // Right double quotation mark
  0x2022, // Bullet
  0x2013, // En dash
  0x2014, // Em dash
  0x02dc, // Small tilde
  0x2122, // Trade mark sign
  0x0161, // Latin small letter s with caron
  0x203a, // Single right-pointing angle quotation mark
  0x0153, // Latin small ligature oe
  0x017e, // Latin small letter z with caron
  0x0178, // Latin capital letter Y with diaeresis
]);

/**
 * Explicit mapping of unsupported Latin characters that do not decompose via NFKD.
 */
const LATIN_CHAR_MAP: Readonly<Record<string, string>> = {
  '\u0141': 'L', // Latin capital letter L with stroke
  '\u0142': 'l', // Latin small letter l with stroke
  '\u0110': 'D', // Latin capital letter D with stroke
  '\u0111': 'd', // Latin small letter d with stroke
  '\u0126': 'H', // Latin capital letter H with stroke
  '\u0127': 'h', // Latin small letter h with stroke
  '\u0166': 'T', // Latin capital letter T with stroke
  '\u0167': 't', // Latin small letter t with stroke
};

/**
 * Explicit mapping for common typographic ligatures and symbols.
 */
const SYMBOL_MAP: Readonly<Record<string, string>> = {
  '\ufb00': 'ff',
  '\ufb01': 'fi',
  '\ufb02': 'fl',
  '\ufb03': 'ffi',
  '\ufb04': 'ffl',
  '\u2011': '-', // Non-breaking hyphen
  '\u2212': '-', // Minus sign
  '\u2012': '-', // Figure dash
  '\u2015': '\u2014', // Horizontal bar mapped to em dash
  '\u2032': "'", // Prime
  '\u2033': '"', // Double prime
  '\u201b': "'", // Single high-reversed-9 quotation mark
  '\u201f': '"', // Double high-reversed-9 quotation mark
  '\u25e6': '\u2022', // White bullet mapped to bullet
  '\u25aa': '\u2022', // Black small square
  '\u25ab': '\u2022', // White small square
  '\u2023': '\u2022', // Triangular bullet
  '\u2043': '\u2022', // Hyphen bullet
  '\u2260': '!=', // Not equal
  '\u2264': '<=', // Less than or equal
  '\u2265': '>=', // Greater than or equal
  '\u2248': '~', // Almost equal
  '\u2192': '->', // Right arrow
  '\u2190': '<-', // Left arrow
  '\u21d2': '=>', // Right double arrow
  '\u21d0': '<=', // Left double arrow
  '\u2713': '[x]', // Check mark
  '\u2714': '[x]', // Heavy check mark
  '\u2717': '[ ]', // Ballot x
  '\u2718': '[ ]', // Heavy ballot x
  '\u2605': '*', // Black star
  '\u2606': '*', // White star
};

/**
 * Checks whether a single unicode code point can be encoded directly in WinAnsi.
 */
export function isWinAnsiCodePoint(code: number): boolean {
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  if (code === 0x0a) return true;
  return WIN_ANSI_EXTRA_POINTS.has(code);
}

/**
 * Sanitises and transliterates a string to ensure every character is encodable in WinAnsi.
 * Preserves native Windows-1252 accented characters whilst decomposing or mapping unsupported glyphs.
 */
export function sanitizeTextForWinAnsi(input: string): string {
  if (!input) return '';

  // Remove zero-width spaces and byte order marks
  let text = input
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n|\r/g, '\n')
    .replace(/\t/g, '    ');

  // Normalise Unicode space variants to standard space
  text = text.replace(/[\u2000-\u200A\u202F\u205F\u3000]/g, ' ');

  // Fast path: check if all characters are already WinAnsi encodable
  let isClean = true;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (!isWinAnsiCodePoint(code)) {
      isClean = false;
      break;
    }
  }
  if (isClean) {
    return text;
  }

  // Process characters, transliterating or decomposing where appropriate
  let output = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;

    if (isWinAnsiCodePoint(code)) {
      output += char;
      continue;
    }

    if (LATIN_CHAR_MAP[char] !== undefined) {
      output += LATIN_CHAR_MAP[char];
      continue;
    }

    if (SYMBOL_MAP[char] !== undefined) {
      output += SYMBOL_MAP[char];
      continue;
    }

    // Try NFKD decomposition to strip diacritics for Latin characters (such as macron in Maori 'o')
    const decomposed = char.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    let decomposedClean = true;
    for (const dChar of decomposed) {
      if (!isWinAnsiCodePoint(dChar.codePointAt(0)!)) {
        decomposedClean = false;
        break;
      }
    }

    if (decomposedClean && decomposed.length > 0) {
      output += decomposed;
    } else {
      // Fallback for unencodable symbols, Asian characters, or emojis
      output += '?';
    }
  }

  return output;
}

/**
 * Defensively measures text width, sanitising if font measurement rejects input.
 */
export function safeWidthOfText(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    const sanitized = sanitizeTextForWinAnsi(text);
    return font.widthOfTextAtSize(sanitized, size);
  }
}
