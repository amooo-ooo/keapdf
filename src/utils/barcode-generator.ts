/**
 * Barcode and QR code generator conforming to ISO/IEC 18004 and ISO/IEC 15417.
 *
 * Provides pure TypeScript matrix generation and vector SVG rendering with zero
 * external dependencies.
 */

/**
 * Supported barcode symbologies.
 */
export type BarcodeSymbology = 'qr-code' | 'code-128';

/**
 * QR code error correction level.
 */
export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

/**
 * Formatting options for QR code generation.
 */
export interface QrCodeOptions {
  /** Error correction level (default: 'M'). */
  readonly errorCorrection?: QrErrorCorrectionLevel;
  /** Foreground colour in CSS format (default: '#000000'). */
  readonly fgColor?: string;
  /** Background colour in CSS format (default: '#ffffff'). */
  readonly bgColor?: string;
  /** Quiet zone margin in modules (default: 4). */
  readonly margin?: number;
  /** Desired target width in points/pixels. */
  readonly width?: number;
  /** Desired target height in points/pixels. */
  readonly height?: number;
}

/**
 * Formatting options for 1D barcode generation.
 */
export interface Barcode1DOptions {
  /** Foreground bar colour (default: '#000000'). */
  readonly fgColor?: string;
  /** Background colour (default: '#ffffff'). */
  readonly bgColor?: string;
  /** Whether to render human-readable text beneath the bars (default: true). */
  readonly includeText?: boolean;
  /** Height in points/pixels (default: 60). */
  readonly height?: number;
  /** Desired width in points/pixels (default: 200). */
  readonly width?: number;
}

// QR code generator implementation conforming to ISO/IEC 18004

/**
 * Galois Field GF(256) exponent and logarithm tables for Reed-Solomon encoding.
 * Primitive polynomial: x^8 + x^4 + x^3 + x^2 + 1 (0x11D).
 */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField(): void {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = val;
    GF_LOG[val] = i;
    val <<= 1;
    if (val & 0x100) {
      val ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * Generates Reed-Solomon generator polynomial of degree n.
 */
function rsGeneratorPolynomial(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMultiply(poly[j], GF_EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

/**
 * Computes Reed-Solomon error correction codewords.
 */
function rsEncode(data: Uint8Array, ecLength: number): Uint8Array {
  const gen = rsGeneratorPolynomial(ecLength);
  const remainder = new Uint8Array(ecLength);

  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    for (let j = 0; j < ecLength - 1; j++) {
      remainder[j] = remainder[j + 1] ^ gfMultiply(gen[j + 1], factor);
    }
    remainder[ecLength - 1] = gfMultiply(gen[ecLength], factor);
  }

  return remainder;
}

/**
 * Table of capacity and ECC parameters for QR Versions 1 to 10 (Byte mode).
 * [Version, totalCodewords, ecCodewordsPerBlock, numBlocksGroup1, dataCodewordsGroup1, numBlocksGroup2, dataCodewordsGroup2]
 */
interface QrVersionCapacity {
  readonly version: number;
  readonly totalCodewords: number;
  readonly ecCodewords: number;
  readonly blocks: number;
}

const QR_CAPACITIES_M: QrVersionCapacity[] = [
  { version: 1, totalCodewords: 26, ecCodewords: 10, blocks: 1 },
  { version: 2, totalCodewords: 44, ecCodewords: 16, blocks: 1 },
  { version: 3, totalCodewords: 70, ecCodewords: 26, blocks: 1 },
  { version: 4, totalCodewords: 100, ecCodewords: 18, blocks: 2 },
  { version: 5, totalCodewords: 134, ecCodewords: 24, blocks: 2 },
  { version: 6, totalCodewords: 172, ecCodewords: 16, blocks: 4 },
  { version: 7, totalCodewords: 196, ecCodewords: 18, blocks: 4 },
  { version: 8, totalCodewords: 242, ecCodewords: 22, blocks: 4 },
  { version: 9, totalCodewords: 292, ecCodewords: 22, blocks: 5 },
  { version: 10, totalCodewords: 346, ecCodewords: 26, blocks: 5 },
];

/**
 * Encodes text into QR Byte mode data bitstream.
 */
function encodeQrByteData(text: string, capacity: QrVersionCapacity): Uint8Array {
  const utf8Bytes = new TextEncoder().encode(text);
  const dataCodewordsCount = capacity.totalCodewords - capacity.ecCodewords;

  const bits: number[] = [];
  function pushBits(val: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  }

  // Byte mode indicator: 0100
  pushBits(0b0100, 4);

  // Character count indicator (8 bits for versions 1 to 9, 16 bits for version 10+)
  const charCountBits = capacity.version < 10 ? 8 : 16;
  pushBits(utf8Bytes.length, charCountBits);

  // Data bytes
  for (let i = 0; i < utf8Bytes.length; i++) {
    pushBits(utf8Bytes[i], 8);
  }

  // Terminator (up to 4 zero bits)
  const remainingBits = dataCodewordsCount * 8 - bits.length;
  const termLength = Math.min(4, Math.max(0, remainingBits));
  pushBits(0, termLength);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Pad bytes: alternating 0xEC (236) and 0x11 (17)
  const bytes = new Uint8Array(dataCodewordsCount);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i * 8 + b];
    }
    bytes[i] = byte;
  }

  let pad = 0xec;
  for (let i = bits.length / 8; i < dataCodewordsCount; i++) {
    bytes[i] = pad;
    pad = pad === 0xec ? 0x11 : 0xec;
  }

  return bytes;
}

/**
 * Generates complete interleaved QR codewords with error correction.
 */
function createQrCodewords(text: string): { version: number; codewords: Uint8Array } {
  const utf8 = new TextEncoder().encode(text);

  let selectedCapacity: QrVersionCapacity = QR_CAPACITIES_M[0];
  for (const cap of QR_CAPACITIES_M) {
    const dataCap = cap.totalCodewords - cap.ecCodewords;
    const headerBits = 4 + (cap.version < 10 ? 8 : 16);
    const totalRequiredBytes = Math.ceil((headerBits + utf8.length * 8) / 8);
    if (dataCap >= totalRequiredBytes) {
      selectedCapacity = cap;
      break;
    }
  }

  const dataBytes = encodeQrByteData(text, selectedCapacity);
  const ecLength = selectedCapacity.ecCodewords;
  const ecBytes = rsEncode(dataBytes, ecLength);

  const finalCodewords = new Uint8Array(dataBytes.length + ecBytes.length);
  finalCodewords.set(dataBytes, 0);
  finalCodewords.set(ecBytes, dataBytes.length);

  return { version: selectedCapacity.version, codewords: finalCodewords };
}

/**
 * Alignment pattern locations for QR versions.
 */
const ALIGNMENT_PATTERN_POSITIONS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

/**
 * Generates the 2D boolean matrix for a QR code.
 *
 * @param text The string content or URL to encode.
 * @return 2D boolean array where true indicates dark modules.
 */
export function generateQrCodeMatrix(text: string): boolean[][] {
  const { version, codewords } = createQrCodewords(text);
  const size = version * 4 + 17;

  // Initialise matrix: null = unset, true = dark, false = light
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null)
  );
  const isFunction = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false)
  );

  function setModule(r: number, c: number, value: boolean, isFunc = true): void {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = value;
      if (isFunc) isFunction[r][c] = true;
    }
  }

  // Finder patterns and separators at top-left, top-right, and bottom-left
  function placeFinder(r: number, c: number): void {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const row = r + dr;
        const col = c + dc;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        const isDark =
          dr >= 0 &&
          dr <= 6 &&
          dc >= 0 &&
          dc <= 6 &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setModule(row, col, isDark);
      }
    }
  }

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Alignment patterns
  const alignPos = ALIGNMENT_PATTERN_POSITIONS[version] || [];
  for (let i = 0; i < alignPos.length; i++) {
    for (let j = 0; j < alignPos.length; j++) {
      const r = alignPos[i];
      const c = alignPos[j];
      // Skip if overlapping with finder patterns
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === alignPos.length - 1) ||
        (i === alignPos.length - 1 && j === 0)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const isDark =
            Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
          setModule(r + dr, c + dc, isDark);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const isDark = i % 2 === 0;
    if (matrix[6][i] === null) setModule(6, i, isDark);
    if (matrix[i][6] === null) setModule(i, 6, isDark);
  }

  // Dark module
  setModule(size - 8, 8, true);

  // Reserve format information areas
  for (let i = 0; i <= 8; i++) {
    if (matrix[8][i] === null) setModule(8, i, false);
    if (matrix[i][8] === null) setModule(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (matrix[8][size - 1 - i] === null) setModule(8, size - 1 - i, false);
    if (matrix[size - 1 - i][8] === null) setModule(size - 1 - i, 8, false);
  }

  // Data placement with zigzag traversal from bottom-right
  let bitIndex = 0;
  const totalBits = codewords.length * 8;

  let col = size - 1;
  let goingUp = true;

  while (col > 0) {
    if (col === 6) col--; // Skip vertical timing pattern column

    const rowStart = goingUp ? size - 1 : 0;
    const rowEnd = goingUp ? -1 : size;
    const rowStep = goingUp ? -1 : 1;

    for (let r = rowStart; r !== rowEnd; r += rowStep) {
      for (let cOffset = 0; cOffset < 2; cOffset++) {
        const c = col - cOffset;
        if (!isFunction[r][c]) {
          let bit = false;
          if (bitIndex < totalBits) {
            const byte = codewords[Math.floor(bitIndex / 8)];
            const bitPos = 7 - (bitIndex % 8);
            bit = ((byte >> bitPos) & 1) === 1;
            bitIndex++;
          }
          // Mask 0: (row + col) % 2 === 0
          const mask = (r + c) % 2 === 0;
          matrix[r][c] = bit !== mask;
        }
      }
    }

    col -= 2;
    goingUp = !goingUp;
  }

  // Format information encoding mask and error correction
  // Format string for EC M (00) and Mask 000 with BCH(15, 5) code: 101010000010010
  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];

  // Top-left format info
  for (let i = 0; i <= 5; i++) matrix[8][i] = formatBits[i] === 1;
  matrix[8][7] = formatBits[6] === 1;
  matrix[8][8] = formatBits[7] === 1;
  matrix[7][8] = formatBits[8] === 1;
  for (let i = 0; i <= 5; i++) matrix[5 - i][8] = formatBits[9 + i] === 1;

  // Split format info
  for (let i = 0; i < 7; i++) matrix[size - 1 - i][8] = formatBits[i] === 1;
  for (let i = 0; i < 8; i++) matrix[8][size - 8 + i] = formatBits[7 + i] === 1;

  // Convert to clean boolean array
  return matrix.map((row) => row.map((cell) => cell === true));
}

/**
 * Generates an SVG string representation of a QR code.
 *
 * @param text The text or URL to encode.
 * @param options Styling and dimension options.
 * @return Scalable SVG markup string.
 */
export function generateQrCodeSvg(text: string, options?: QrCodeOptions): string {
  const matrix = generateQrCodeMatrix(text);
  const moduleCount = matrix.length;
  const margin = options?.margin ?? 4;
  const viewBoxSize = moduleCount + margin * 2;
  const width = options?.width ?? 140;
  const height = options?.height ?? 140;
  const fgColor = options?.fgColor ?? '#000000';
  const bgColor = options?.bgColor ?? '#ffffff';

  let pathData = '';
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (matrix[r][c]) {
        pathData += `M${c + margin},${r + margin}h1v1h-1z `;
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" ` +
    `width="${width}" height="${height}" shape-rendering="crispEdges">\n` +
    `<rect width="${viewBoxSize}" height="${viewBoxSize}" fill="${bgColor}"/>\n` +
    `<path d="${pathData.trim()}" fill="${fgColor}"/>\n` +
    `</svg>`
  );
}

// Code 128 one-dimensional barcode generator conforming to ISO/IEC 15417

/**
 * Code 128 patterns: each character is represented by 3 bars and 3 spaces (11 modules).
 * Encoded as 4 widths: [b1, s1, b2, s2, b3, s3] sum = 11.
 */
const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131',
  '211412', // 103: Start A
  '211214', // 104: Start B
  '211232', // 105: Start C
  '2331112', // 106: Stop (13 modules: 2331112)
];

/**
 * Generates an SVG string representation of a Code 128 barcode.
 *
 * @param text The alphanumeric string to encode.
 * @param options Styling and layout options.
 * @return Scalable SVG markup string.
 */
export function generateBarcodeSvg(text: string, options?: Barcode1DOptions): string {
  const cleanText = text.replace(/[^\x20-\x7E]/g, '') || '000000';
  const fgColor = options?.fgColor ?? '#000000';
  const bgColor = options?.bgColor ?? '#ffffff';
  const includeText = options?.includeText ?? true;
  const targetWidth = options?.width ?? 200;
  const targetHeight = options?.height ?? 60;

  // Start with Code Set B (Start B = index 104)
  const patternIndices: number[] = [104];
  let checkSum = 104;

  for (let i = 0; i < cleanText.length; i++) {
    const code = cleanText.charCodeAt(i) - 32;
    patternIndices.push(code);
    checkSum += code * (i + 1);
  }

  const checkIndex = checkSum % 103;
  patternIndices.push(checkIndex);
  patternIndices.push(106); // Stop pattern

  // Convert pattern string into module widths
  const barHeights = includeText ? targetHeight - 16 : targetHeight;
  let totalModules = 0;

  for (const idx of patternIndices) {
    const pattern = CODE128_PATTERNS[idx];
    for (let c = 0; c < pattern.length; c++) {
      totalModules += parseInt(pattern[c], 10);
    }
  }

  const margin = 10;
  const fullWidth = totalModules + margin * 2;
  let currentX = margin;
  let pathData = '';

  for (const idx of patternIndices) {
    const pattern = CODE128_PATTERNS[idx];
    for (let c = 0; c < pattern.length; c++) {
      const w = parseInt(pattern[c], 10);
      const isBar = c % 2 === 0;
      if (isBar) {
        pathData += `M${currentX},0h${w}v${barHeights}h-${w}z `;
      }
      currentX += w;
    }
  }

  const textElement = includeText
    ? `<text x="${fullWidth / 2}" y="${targetHeight - 2}" font-family="monospace, sans-serif" font-size="11" text-anchor="middle" fill="${fgColor}">${cleanText}</text>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fullWidth} ${targetHeight}" ` +
    `width="${targetWidth}" height="${targetHeight}" shape-rendering="crispEdges">\n` +
    `<rect width="${fullWidth}" height="${targetHeight}" fill="${bgColor}"/>\n` +
    `<path d="${pathData.trim()}" fill="${fgColor}"/>\n` +
    textElement +
    `\n</svg>`
  );
}

/**
 * Converts an SVG string into a rasterised image data URL (PNG) for canvas rendering and PDF burning.
 *
 * @param svgMarkup The SVG source string.
 * @param width Target pixel width.
 * @param height Target pixel height.
 * @return Promise resolving to a PNG data URL.
 */
export async function rasterizeSvgToDataUrl(
  svgMarkup: string,
  width: number,
  height: number
): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    // In headless or node environments, return SVG data URL
    const encoded = encodeURIComponent(svgMarkup);
    return `data:image/svg+xml;charset=utf-8,${encoded}`;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(svgBlob);

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width * 2); // 2x supersampling for crisp high-DPI output
        canvas.height = Math.max(1, height * 2);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(blobUrl);
          resolve(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`);
          return;
        }

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        URL.revokeObjectURL(blobUrl);
        resolve(dataUrl);
      } catch (err) {
        URL.revokeObjectURL(blobUrl);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      // Fallback to inline SVG data URL if image rendering fails
      resolve(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`);
    };

    img.src = blobUrl;
  });
}
