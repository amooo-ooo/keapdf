import UPNGNamespace from '@pdf-lib/upng';
import type { ExtendedWrappedPdfiumModule, PdfiumEngine } from '../../../core/pdfium-engine';

const UPNG = ((UPNGNamespace as unknown as { default?: typeof UPNGNamespace }).default ??
  UPNGNamespace);
import type { EditableImageSpan, EditableShapeSpan, PageCropInfo, PdfMatrix, ShapeVariantType } from '../../../core/types';
import {
  getPageCropInfo,
  getPageObjectMatrix,
  pdfBoxToDomBounds,
  pdfToDomCoords,
} from '../../../core/pdfium-helpers';
import {
  extractRawPathProperties,
  type PathExtractionPointers,
} from './vector-shape-helpers';

const FPDF_ANNOT_TEXT = 1;
const FPDF_ANNOT_LINK = 2;
const FPDF_ANNOT_LINE = 4;
const FPDF_ANNOT_SQUARE = 5;
const FPDF_ANNOT_CIRCLE = 6;
const FPDF_ANNOT_POLYGON = 7;
const FPDF_ANNOT_POLYLINE = 8;
const FPDF_ANNOT_HIGHLIGHT = 9;
const FPDF_ANNOT_UNDERLINE = 10;
const FPDF_ANNOT_SQUIGGLY = 11;
const FPDF_ANNOT_STRIKEOUT = 12;
const FPDF_ANNOT_STAMP = 13;
const FPDF_ANNOT_INK = 15;
const FPDF_ANNOT_POPUP = 16;
const FPDF_ANNOT_WIDGET = 20;
const FPDF_ANNOT_REDACT = 26;

const ANNOT_SUBTYPE_NAMES: Record<number, string> = {
  [FPDF_ANNOT_LINE]: 'Line',
  [FPDF_ANNOT_SQUARE]: 'Square',
  [FPDF_ANNOT_CIRCLE]: 'Circle',
  [FPDF_ANNOT_POLYGON]: 'Polygon',
  [FPDF_ANNOT_POLYLINE]: 'PolyLine',
  [FPDF_ANNOT_HIGHLIGHT]: 'Highlight',
  [FPDF_ANNOT_UNDERLINE]: 'Underline',
  [FPDF_ANNOT_SQUIGGLY]: 'Squiggly',
  [FPDF_ANNOT_STRIKEOUT]: 'StrikeOut',
  [FPDF_ANNOT_STAMP]: 'Stamp',
  [FPDF_ANNOT_INK]: 'Ink',
  [FPDF_ANNOT_REDACT]: 'Redact',
};

let crcTable: Uint32Array | null = null;

/**
 * Builds or returns the precomputed CRC-32 lookup table for PNG chunk checksums.
 */
function getCrc32Table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/**
 * Computes the CRC-32 checksum over a byte slice.
 */
function computeCrc32(bytes: Uint8Array): number {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Computes the Adler-32 checksum over a byte slice for zlib stream integrity.
 */
function computeAdler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  const modAdler = 65521;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % modAdler;
    b = (b + a) % modAdler;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Writes a 32-bit big-endian unsigned integer into a target buffer at offset.
 */
function writeUint32BE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = (val >>> 24) & 0xff;
  buf[offset + 1] = (val >>> 16) & 0xff;
  buf[offset + 2] = (val >>> 8) & 0xff;
  buf[offset + 3] = val & 0xff;
}

/**
 * Creates a length-prefixed and CRC-suffixed PNG chunk.
 */
function createPngChunk(typeAscii: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32BE(chunk, 0, data.length);
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = typeAscii.charCodeAt(i);
  }
  chunk.set(data, 8);
  const crcInput = chunk.subarray(4, 8 + data.length);
  writeUint32BE(chunk, 8 + data.length, computeCrc32(crcInput));
  return chunk;
}

/**
 * Encodes raw RGBA pixels into a PNG data URL without requiring a browser 2D canvas context.
 */
export function encodeRgbaToPngFallback(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): string {
  const rowStride = width * 4 + 1;
  const rawScanlines = new Uint8Array(rowStride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowStride;
    rawScanlines[rowStart] = 0;
    const srcStart = y * width * 4;
    rawScanlines.set(rgba.subarray(srcStart, srcStart + width * 4), rowStart + 1);
  }

  const maxBlockSize = 65535;
  const numBlocks = Math.max(1, Math.ceil(rawScanlines.length / maxBlockSize));
  const zlibData = new Uint8Array(2 + rawScanlines.length + numBlocks * 5 + 4);
  zlibData[0] = 0x78;
  zlibData[1] = 0x01;

  let zOffset = 2;
  let srcOffset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const remaining = rawScanlines.length - srcOffset;
    const blockLen = Math.min(maxBlockSize, remaining);
    const isFinal = b === numBlocks - 1 ? 1 : 0;
    zlibData[zOffset++] = isFinal;
    zlibData[zOffset++] = blockLen & 0xff;
    zlibData[zOffset++] = (blockLen >>> 8) & 0xff;
    const nlen = (~blockLen) & 0xffff;
    zlibData[zOffset++] = nlen & 0xff;
    zlibData[zOffset++] = (nlen >>> 8) & 0xff;
    zlibData.set(rawScanlines.subarray(srcOffset, srcOffset + blockLen), zOffset);
    zOffset += blockLen;
    srcOffset += blockLen;
  }

  writeUint32BE(zlibData, zOffset, computeAdler32(rawScanlines));

  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = createPngChunk('IHDR', ihdr);
  const idatChunk = createPngChunk('IDAT', zlibData);
  const iendChunk = createPngChunk('IEND', new Uint8Array(0));

  const pngBytes = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let pos = 0;
  pngBytes.set(signature, pos);
  pos += signature.length;
  pngBytes.set(ihdrChunk, pos);
  pos += ihdrChunk.length;
  pngBytes.set(idatChunk, pos);
  pos += idatChunk.length;
  pngBytes.set(iendChunk, pos);

  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < pngBytes.length; i += chunkSize) {
    const slice = pngBytes.subarray(i, Math.min(i + chunkSize, pngBytes.length));
    binary += String.fromCharCode(...slice);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * Decodes raw PNG binary bytes into 8-bit RGBA pixel data.
 *
 * Supports uncompressed fallback PNGs as well as deflate-compressed, indexed
 * palette + `tRNS`, greyscale + alpha, multi-frame APNG, and 16-bit greyscale +
 * `tRNS` PNGs (bypassing the odd-column `x << i` shift defect in `@pdf-lib/upng`).
 *
 * @param bytes Raw PNG file bytes.
 * @return Decoded width, height, and RGBA pixel array, or null on invalid input.
 */
export function decodePngBytesToRgba(
  bytes: Uint8Array
): { width: number; height: number; data: Uint8ClampedArray } | null {
  if (bytes.length < 33) return null;

  const readUint32BE = (buf: Uint8Array, off: number): number =>
    ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let hasAncillaryAlpha = false;
  const idatParts: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;

    if (type === 'IHDR' && length >= 10) {
      width = readUint32BE(bytes, dataStart);
      height = readUint32BE(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
    } else if (type === 'PLTE' || type === 'tRNS' || type === 'acTL') {
      hasAncillaryAlpha = true;
    } else if (type === 'IDAT') {
      idatParts.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width <= 0 || height <= 0 || idatParts.length === 0) return null;

  // Fast path for uncompressed 8-bit RGBA PNGs emitted by encodeRgbaToPngFallback
  if (bitDepth === 8 && colorType === 6 && !hasAncillaryAlpha) {
    const totalIdat = idatParts.reduce((acc, p) => acc + p.length, 0);
    const zlibStream = new Uint8Array(totalIdat);
    let pos = 0;
    for (const part of idatParts) {
      zlibStream.set(part, pos);
      pos += part.length;
    }

    const rowStride = width * 4 + 1;
    const rawScanlines = new Uint8Array(rowStride * height);
    let zPos = 2;
    let outPos = 0;
    let uncompressedOk = true;
    while (zPos + 5 <= zlibStream.length - 4 && outPos < rawScanlines.length) {
      const header = zlibStream[zPos];
      const btype = (header >>> 1) & 0x03;
      if (btype !== 0) {
        uncompressedOk = false;
        break;
      }
      const blockLen = zlibStream[zPos + 1] | (zlibStream[zPos + 2] << 8);
      zPos += 5;
      const copyLen = Math.min(blockLen, rawScanlines.length - outPos, zlibStream.length - 4 - zPos);
      rawScanlines.set(zlibStream.subarray(zPos, zPos + copyLen), outPos);
      outPos += copyLen;
      zPos += blockLen;
      if (header & 1) break;
    }

    if (uncompressedOk && outPos >= rawScanlines.length) {
      let allZeroFilter = true;
      for (let y = 0; y < height; y++) {
        if (rawScanlines[y * rowStride] !== 0) {
          allZeroFilter = false;
          break;
        }
      }
      if (allZeroFilter) {
        const rgba = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
          const rowStart = y * rowStride + 1;
          rgba.set(rawScanlines.subarray(rowStart, rowStart + width * 4), y * width * 4);
        }
        return { width, height, data: rgba };
      }
    }
  }

  try {
    const safeBuffer =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? (bytes.buffer as ArrayBuffer)
        : (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const upng = UPNG.decode(safeBuffer);
    if (!upng || upng.width <= 0 || upng.height <= 0) return null;

    // Bypass @pdf-lib/upng's `x << i` bug on 16-bit greyscale images with tRNS
    if (upng.ctype === 0 && upng.depth === 16) {
      const raw =
        upng.data instanceof Uint8Array
          ? upng.data
          : new Uint8Array(upng.data);
      const w = upng.width;
      const h = upng.height;
      const bpl = w * 2;
      const tr = typeof upng.tabs?.tRNS === 'number' ? upng.tabs.tRNS : -1;
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        const rowOff = y * bpl;
        for (let x = 0; x < w; x++) {
          const pxOff = rowOff + (x << 1);
          const sample16 = (raw[pxOff] << 8) | raw[pxOff + 1];
          const gray8 = raw[pxOff];
          const dst = (y * w + x) * 4;
          rgba[dst] = gray8;
          rgba[dst + 1] = gray8;
          rgba[dst + 2] = gray8;
          rgba[dst + 3] = sample16 === tr ? 0 : 255;
        }
      }
      return { width: w, height: h, data: rgba };
    }

    const frames = UPNG.toRGBA8(upng);
    if (!frames || frames.length === 0) return null;
    return {
      width: upng.width,
      height: upng.height,
      data: new Uint8ClampedArray(frames[0]),
    };
  } catch {
    return null;
  }
}

/**
 * Normalises a PNG byte buffer into a standard single-frame 8-bit RGBA PNG
 * suitable for `pdf-lib` `embedPng()` when the input uses APNG animation chunks
 * (`acTL`) or 16-bit greyscale + `tRNS` transparency.
 *
 * @param pngBytes Raw PNG file bytes.
 * @return Re-encoded 8-bit RGBA PNG bytes, or null if decoding fails.
 */
export function normalizePngBytesForEmbed(pngBytes: Uint8Array): Uint8Array | null {
  const decoded = decodePngBytesToRgba(pngBytes);
  if (!decoded) return null;
  try {
    const rgbaBuf =
      decoded.data.byteOffset === 0 && decoded.data.byteLength === decoded.data.buffer.byteLength
        ? (decoded.data.buffer as ArrayBuffer)
        : (decoded.data.buffer.slice(
            decoded.data.byteOffset,
            decoded.data.byteOffset + decoded.data.byteLength
          ) as ArrayBuffer);
    const encoded = UPNG.encode([rgbaBuf], decoded.width, decoded.height, 0);
    return new Uint8Array(encoded);
  } catch {
    return null;
  }
}

/**
 * Decodes a PNG data URL back into RGBA pixel data.
 * Used as a headless fallback when browser Image decoding is unavailable.
 */
export function decodePngDataUrlFallback(
  dataUrl: string
): { width: number; height: number; data: Uint8ClampedArray } | null {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) return null;

  try {
    const binary = atob(dataUrl.slice(prefix.length));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return decodePngBytesToRgba(bytes);
  } catch {
    return null;
  }
}

/**
 * Converts RGBA pixel data into a PNG data URL using a browser canvas when available,
 * or the pure TypeScript PNG encoder fallback in headless environments.
 */
export function rgbaToPngDataUrl(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): string {
  if (typeof document !== 'undefined' && typeof ImageData !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imgData = new ImageData(new Uint8ClampedArray(rgba), width, height);
        ctx.putImageData(imgData, 0, 0);
        const url = canvas.toDataURL('image/png');
        if (url && url.startsWith('data:image/png')) {
          return url;
        }
      }
    } catch {
      // Fall through to pure TypeScript PNG encoder
    }
  }
  return encodeRgbaToPngFallback(rgba, width, height);
}

/**
 * Extracts a PDFium bitmap handle into a PNG data URL.
 */
export function extractBitmapToDataUrl(
  mod: ExtendedWrappedPdfiumModule,
  bitmap: number
): string {
  if (
    !bitmap ||
    typeof mod.FPDFBitmap_GetWidth !== 'function' ||
    typeof mod.FPDFBitmap_GetHeight !== 'function' ||
    typeof mod.FPDFBitmap_GetStride !== 'function' ||
    typeof mod.FPDFBitmap_GetFormat !== 'function' ||
    typeof mod.FPDFBitmap_GetBuffer !== 'function'
  ) {
    return '';
  }

  const bmpWidth = mod.FPDFBitmap_GetWidth(bitmap);
  const bmpHeight = mod.FPDFBitmap_GetHeight(bitmap);
  const stride = mod.FPDFBitmap_GetStride(bitmap);
  const format = mod.FPDFBitmap_GetFormat(bitmap);
  const bufferPtr = mod.FPDFBitmap_GetBuffer(bitmap);

  if (bmpWidth <= 0 || bmpHeight <= 0 || !bufferPtr) {
    return '';
  }

  const heapU8 = mod.pdfium.HEAPU8;
  const size = stride * bmpHeight;
  const rawBytes = new Uint8ClampedArray(heapU8.buffer, bufferPtr, size);
  const rgba = new Uint8ClampedArray(bmpWidth * bmpHeight * 4);
  const bytesPerPixel = format === 4 || format === 3 ? 4 : format === 2 ? 3 : 1;

  for (let y = 0; y < bmpHeight; y++) {
    for (let x = 0; x < bmpWidth; x++) {
      const srcIdx = y * stride + x * bytesPerPixel;
      const dstIdx = (y * bmpWidth + x) * 4;

