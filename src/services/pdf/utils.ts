export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(colorStr: string): Color {
  let r = 0, g = 0, b = 0, a = 255;
  if (!colorStr || colorStr === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (colorStr.startsWith('#')) {
    const hex = colorStr.substring(1);
    if (hex.length === 6) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    } else if (hex.length === 8) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
      a = parseInt(hex.substring(6, 8), 16);
    } else if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 4) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
      a = parseInt(hex[3] + hex[3], 16);
    }
  } else if (colorStr.startsWith('rgb')) {
    const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]+)?\)/);
    if (match) {
      r = parseInt(match[1], 10);
      g = parseInt(match[2], 10);
      b = parseInt(match[3], 10);
      if (match[4]) {
        a = Math.round(parseFloat(match[4]) * 255);
      }
    }
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
  flipY: boolean
) {
  const cx = x + w / 2;
  const cy = pageHeight - (y + h / 2);
  
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
 * Sanitizes and normalizes unicode characters into standard clean text.
 * Replaces non-breaking spaces, zero-width spaces, ligatures, and normalizes
 * Private Use Area (PUA) symbol glyphs to standard unicode bullets.
 *
 * @param text The input string to sanitize.
 * @return Cleaned string with preserved bullets and typography.
 */
export function sanitizePdfText(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF\u2060\u00AD]/g, '')
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

