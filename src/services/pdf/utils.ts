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


