/**
 * Windows-1252 (WinAnsiEncoding) defined high character code points (0x80 - 0x9F).
 */
export const WIN_ANSI_HIGH_CODEPOINTS = new Set<number>([
  0x20ac, // 0x80: Euro sign
  0x201a, // 0x82: Single low-9 quotation mark
  0x0192, // 0x83: Latin small letter f with hook
  0x201e, // 0x84: Double low-9 quotation mark
  0x2026, // 0x85: Horizontal ellipsis
  0x2020, // 0x86: Dagger
  0x2021, // 0x87: Double dagger
  0x02c6, // 0x88: Modifier letter circumflex accent
  0x2030, // 0x89: Per mille sign
  0x0160, // 0x8a: Latin capital letter S with caron
  0x2039, // 0x8b: Single left-pointing angle quotation mark
  0x0152, // 0x8c: Latin capital ligature OE
  0x017d, // 0x8e: Latin capital letter Z with caron
  0x2018, // 0x91: Left single quotation mark
  0x2019, // 0x92: Right single quotation mark
  0x201c, // 0x93: Left double quotation mark
  0x201d, // 0x94: Right double quotation mark
  0x2022, // 0x95: Bullet
  0x2013, // 0x96: En dash
  0x2014, // 0x97: Em dash
  0x02dc, // 0x98: Small tilde
  0x2122, // 0x99: Trade mark sign
  0x0161, // 0x9a: Latin small letter s with caron
  0x203a, // 0x9b: Single right-pointing angle quotation mark
  0x0153, // 0x9c: Latin small ligature oe
  0x017e, // 0x9e: Latin small letter z with caron
  0x0178, // 0x9f: Latin capital letter Y with diaeresis
]);

/**
 * Validates whether a Unicode code point can be represented in standard PDF WinAnsiEncoding.
 */
export function isWinAnsiCodePoint(code: number): boolean {
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WIN_ANSI_HIGH_CODEPOINTS.has(code);
}

/**
 * Checks whether an entire string contains only characters representable in WinAnsiEncoding.
 */
export function isWinAnsiText(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if (!isWinAnsiCodePoint(code)) return false;
  }
  return true;
}

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

let _colorCtx: CanvasRenderingContext2D | null = null;
function getColorContext(): CanvasRenderingContext2D {
  if (!_colorCtx) {
    const canvas = new OffscreenCanvas(1, 1);
    _colorCtx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  }
  return _colorCtx;
}

export function parseColor(colorStr: string): Color {
  if (!colorStr || colorStr === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  let parsed = false;
  let r = 0, g = 0, b = 0, a = 255;
  if (colorStr.startsWith('#')) {
    const hex = colorStr.substring(1);
    if (hex.length === 6) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
      parsed = true;
    } else if (hex.length === 8) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
      a = parseInt(hex.substring(6, 8), 16);
      parsed = true;
    } else if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
      parsed = true;
    } else if (hex.length === 4) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
      a = parseInt(hex[3] + hex[3], 16);
      parsed = true;
    }
  } else if (colorStr.startsWith('rgb')) {
    const match = colorStr.match(/rgba?\(\s*(\d+)(?:\s*,\s*|\s+)(\d+)(?:\s*,\s*|\s+)(\d+)(?:(?:\s*,\s*|\s*\/\s*)([\d.]+))?\s*\)/);
    if (match) {
      r = parseInt(match[1], 10);
      g = parseInt(match[2], 10);
      b = parseInt(match[3], 10);
      if (match[4]) {
        a = Math.round(parseFloat(match[4]) * 255);
      }
      parsed = true;
    }
  }

  if (parsed) {
    return { r, g, b, a };
  }

  // Fallback: use canvas to resolve any valid CSS color
  try {
    const ctx = getColorContext();
    ctx.fillStyle = '#000000'; // reset
    ctx.fillStyle = colorStr;
    // If fillStyle changed, parse the result (always returns #rrggbb or rgba())
    const resolved = ctx.fillStyle;
    if (resolved !== '#000000' || colorStr.toLowerCase() === 'black') {
      // Recursively parse the resolved color (which will be hex or rgb)
      return parseColor(resolved);
    }
  } catch {
    // OffscreenCanvas not available, fall through to default
  }

  return { r, g, b, a };
}

export function isColorEqual(c1?: { r: number; g: number; b: number; a?: number }, c2?: { r: number; g: number; b: number; a?: number }): boolean {
  if (!c1 && !c2) return true;
  if (!c1 || !c2) return false;
  return c1.r === c2.r && c1.g === c2.g && c1.b === c2.b && (c1.a ?? 255) === (c2.a ?? 255);
}

export function buildTransformMatrix(
  x: number,
  y: number,
  w: number,
  h: number,
  pageHeight: number,
  rotation: number,
  flipX: boolean,
  flipY: boolean,
  cropOffset?: { cropX: number; cropY: number }
) {
  const cx = x + (cropOffset?.cropX ?? 0) + w / 2;
  const cy = (cropOffset?.cropY ?? 0) + (pageHeight - (y + h / 2));
  
  const sx = flipX ? -1 : 1;
  const sy = flipY ? -1 : 1;

  const theta = -rotation * Math.PI / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  
  const e = cx - a * (w / 2) - c * (h / 2);
  const f = cy - b * (w / 2) - d * (h / 2);
  
  return { a, b, c, d, e, f };
}

/**
 * Determines whether a character or code point is a Unicode whitespace or spacing character.
 * Includes ASCII whitespace, non-breaking spaces, en/em quads, figure/thin/hair spaces,
 * mathematical spaces, and ideographic spaces.
 *
 * @param charOrCode Single-character string or numeric code point.
 * @return True if the character represents whitespace or spacing.
 */
export function isUnicodeWhitespace(charOrCode: string | number): boolean {
  const code = typeof charOrCode === 'number' ? charOrCode : charOrCode.codePointAt(0) ?? 0;
  if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c || code === 0x0b) {
    return true;
  }
  if (code === 0x00a0 || code === 0x1680) {
    return true;
  }
  if (code >= 0x2000 && code <= 0x200b) {
    return true;
  }
  if (code === 0x202f || code === 0x205f || code === 0x3000) {
    return true;
  }
  return false;
}

/**
 * Determines whether a character or code point is an invisible zero-width character
 * or bidirectional formatting control.
 *
 * @param charOrCode Single-character string or numeric code point.
 * @return True if the character is invisible or a zero-width format control.
 */
export function isZeroWidthOrInvisible(charOrCode: string | number): boolean {
  const code = typeof charOrCode === 'number' ? charOrCode : charOrCode.codePointAt(0) ?? 0;
  if (code >= 0x200b && code <= 0x200f) {
    return true;
  }
  if (code === 0xfeff || code === 0x00ad || code === 0x180e || code === 0x061c) {
    return true;
  }
  if (code >= 0x202a && code <= 0x202e) {
    return true;
  }
  if (code >= 0x2060 && code <= 0x2064) {
    return true;
  }
  if (code >= 0x2066 && code <= 0x2069) {
    return true;
  }
  if (code >= 0xfff9 && code <= 0xfffb) {
    return true;
  }
  return false;
}

/**
 * Determines whether a code point is an unprintable ASCII control character,
 * C1 control, or Unicode noncharacter that should not appear in plain text streams.
 *
 * @param charOrCode Single-character string or numeric code point.
 * @return True if the character is a control or noncharacter.
 */
export function isControlOrUnidentified(charOrCode: string | number): boolean {
  const code = typeof charOrCode === 'number' ? charOrCode : charOrCode.codePointAt(0) ?? 0;
  if (code === 0) return true;
  if (code >= 0x0001 && code <= 0x0008) return true;
  if (code === 0x000b || code === 0x000c) return true;
  if (code >= 0x000e && code <= 0x001f) return true;
  if (code >= 0x007f && code <= 0x009f) return true;
  if (code === 0xfffe || code === 0xffff) return true;
  return false;
}

/**
 * Sanitizes and normalizes unicode characters into standard clean text.
 * Purges control characters, replaces non-breaking spaces and typography spaces with standard space,
 * strips zero-width and invisible format controls, normalizes ligatures, and translates
 * Private Use Area (PUA) symbol glyphs to standard unicode bullets.
 *
 * @param text The input string to sanitize.
 * @return Cleaned string with preserved bullets and typography.
 */
export function sanitizePdfText(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u200B-\u200F\uFEFF\u2060-\u2064\u2066-\u2069\u00AD\u180E\u061C\u202A-\u202E\uFFF9-\uFFFB]/g, '')
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\uFB05/g, 'ft')
    .replace(/\uFB06/g, 'st')
    .replace(/\uF0B7/g, '\u2022')
    .replace(/\uF0A7/g, '\u25AA')
    .replace(/\uF0D8/g, '\u25B8');
}

/**
 * Normalizes text specifically for rendering with standard 14 PDF fonts (Helvetica, Times, Courier),
 * which are restricted to Windows-1252 (WinAnsiEncoding).
 * Maps non-WinAnsi bullet characters, typography spaces, and unsupported diacritics to clean,
 * readable WinAnsi equivalents, preventing PDFium CPDF_Font fallback corruption to \u00ff (ÿ).
 *
 * @param text The input text to prepare for standard font rendering.
 * @return Safe WinAnsi-compatible text string.
 */
export function safeEncodeForStandardFont(text: string): string {
  if (!text) return '';
  let cleaned = sanitizePdfText(text);

  // Map non-WinAnsi bullet symbols to WinAnsi bullet (0x95 / \u2022)
  cleaned = cleaned.replace(/[\u25AA\u25AB\u25E6\u25CF\u25B8\u25BA\u25C6\u25C7\u25CB\u25FC\u25FE\u2023\u2043\u2219]/g, '\u2022');

  // Map non-WinAnsi dashes to ASCII hyphen-minus
  cleaned = cleaned.replace(/[\u2010\u2011\u2012\u2015\u2212]/g, '-');

  // Map non-WinAnsi angle quotes to standard quotes
  cleaned = cleaned.replace(/[\u00AB\u00BB]/g, '"');

  // Map mathematical symbols, relations, operators, Greek letters to readable ASCII/WinAnsi equivalents
  const mathTransliterations: Record<string, string> = {
    '\u2212': '-', '\u00D7': 'x', '\u00F7': '/', '\u2217': '*', '\u2248': '~',
    '\u2260': '!=', '\u2264': '<=', '\u2265': '>=', '\u221E': 'oo',
    '\u03C0': 'pi', '\u03B1': 'alpha', '\u03B2': 'beta', '\u03B3': 'gamma',
    '\u03B4': 'delta', '\u03B5': 'epsilon', '\u03B6': 'zeta', '\u03B7': 'eta',
    '\u03B8': 'theta', '\u03B9': 'iota', '\u03BA': 'kappa', '\u03BB': 'lambda',
    '\u03BC': 'mu', '\u03BD': 'nu', '\u03BE': 'xi', '\u03BF': 'o',
    '\u03C1': 'rho', '\u03C2': 'sigma', '\u03C3': 'sigma', '\u03C4': 'tau',
    '\u03C5': 'upsilon', '\u03C6': 'phi', '\u03C7': 'chi', '\u03C8': 'psi',
    '\u03C9': 'omega',
    '\u0393': 'Gamma', '\u0394': 'Delta', '\u0398': 'Theta', '\u039B': 'Lambda',
    '\u039E': 'Xi', '\u03A0': 'Pi', '\u03A3': 'Sigma', '\u03A6': 'Phi',
    '\u03A8': 'Psi', '\u03A9': 'Omega',
    '\u2192': '->', '\u2190': '<-', '\u2194': '<->',
    '\u21D2': '=>', '\u21D0': '<=', '\u21D4': '<=>',
    '\u222B': 'int', '\u2202': 'd', '\u221A': 'sqrt',
    '\u2211': 'sum', '\u220F': 'prod', '\u2207': 'grad',
    '\u2200': 'for all', '\u2203': 'exists', '\u2204': 'not exists',
    '\u2261': '==', '\u2245': '~=', '\u221D': 'prop', '\u2220': 'angle',
    '\u2227': '&', '\u2228': '|', '\u2213': '-+',
    '\u2229': 'cap', '\u222A': 'cup', '\u2208': 'in', '\u2209': 'notin',
    '\u2282': 'sub', '\u2283': 'sup', '\u2286': 'sube', '\u2287': 'supe',
    '\u2295': '(+)', '\u2297': '(x)', '\u22A5': 'perp', '\u22C5': '.',
    '\u2135': 'aleph', '\u2111': 'Im', '\u211C': 'Re', '\u2118': 'wp',
    '\u00B9': '1', '\u00B2': '2', '\u00B3': '3',
    '\u2070': '0', '\u2074': '4', '\u2075': '5', '\u2076': '6',
    '\u2077': '7', '\u2078': '8', '\u2079': '9',
    '\u2080': '0', '\u2081': '1', '\u2082': '2', '\u2083': '3',
    '\u2084': '4', '\u2085': '5', '\u2086': '6', '\u2087': '7',
    '\u2088': '8', '\u2089': '9',
    '\u00BC': '1/4', '\u00BD': '1/2', '\u00BE': '3/4',
  };
  const mathPattern = new RegExp(
    '[' + Object.keys(mathTransliterations).map((k) => k.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')).join('') + ']',
    'g'
  );
  cleaned = cleaned.replace(mathPattern, (match) => mathTransliterations[match] || match);

  // Extended Latin characters that do not decompose into base letters under NFKD
  const extendedLatinMap: Record<string, string> = {
    '\u0141': 'L', '\u0142': 'l', // Polish L with stroke
    '\u0110': 'D', '\u0111': 'd', // D with stroke (Croatian, Vietnamese)
    '\u0126': 'H', '\u0127': 'h', // Maltese H with stroke
    '\u0166': 'T', '\u0167': 't', // Northern Sami T with stroke
    '\u0131': 'i',                // Turkish dotless i
    '\u0130': 'I',                // Turkish capital I with dot
    '\u014A': 'N', '\u014B': 'n', // Eng
    '\u0138': 'k',                // Greenlandic kra
    '\u018F': 'E', '\u0259': 'e', // Schwa
  };

  // Uppercase Greek letters whose visual forms mirror Latin capitals
  const greekCapitals: Record<string, string> = {
    '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u0396': 'Z',
    '\u0397': 'H', '\u0399': 'I', '\u039A': 'K', '\u039C': 'M',
    '\u039D': 'N', '\u039F': 'O', '\u03A1': 'P', '\u03A4': 'T',
    '\u03A5': 'Y', '\u03A7': 'X',
  };

  // Cyrillic romanization fallback for standard font rendering
  const cyrillicMap: Record<string, string> = {
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo', 'Ж': 'Zh',
    'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O',
    'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts',
    'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch', 'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    'Є': 'Ye', 'є': 'ye', 'І': 'I', 'і': 'i', 'Ї': 'Yi', 'ї': 'yi', 'Ґ': 'G', 'ґ': 'g',
  };

  // For any remaining characters outside WinAnsi:
  // Check extended Latin, Greek capitals, Cyrillic fallback, and NFKD decomposition
  // to prevent PDFium CPDF_Font::CharCodeFromUnicode fallback corruption to \u00ff (ÿ)
  let result = '';
  for (const char of cleaned) {
    const code = char.codePointAt(0);
    if (code !== undefined && isWinAnsiCodePoint(code)) {
      result += char;
    } else if (extendedLatinMap[char] !== undefined) {
      result += extendedLatinMap[char];
    } else if (greekCapitals[char] !== undefined) {
      result += greekCapitals[char];
    } else if (cyrillicMap[char] !== undefined) {
      result += cyrillicMap[char];
    } else {
      const decomposed = char.normalize('NFKD').replace(/[\u0300-\u036F]/g, '');
      if (decomposed && decomposed.length > 0 && isWinAnsiCodePoint(decomposed.charCodeAt(0))) {
        result += decomposed;
      } else {
        // Drop characters that cannot be represented in WinAnsiEncoding
        // rather than passing them through raw, which causes PDFium
        // CPDF_Font::CharCodeFromUnicode to return 0xFF (y-diaeresis)
        result += '?';
      }
    }
  }

  return result;
}


