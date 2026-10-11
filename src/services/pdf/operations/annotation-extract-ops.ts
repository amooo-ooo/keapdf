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

      if (format === 4 || format === 3) {
        rgba[dstIdx] = rawBytes[srcIdx + 2];
        rgba[dstIdx + 1] = rawBytes[srcIdx + 1];
        rgba[dstIdx + 2] = rawBytes[srcIdx];
        rgba[dstIdx + 3] = format === 4 ? rawBytes[srcIdx + 3] : 255;
      } else if (format === 2) {
        rgba[dstIdx] = rawBytes[srcIdx + 2];
        rgba[dstIdx + 1] = rawBytes[srcIdx + 1];
        rgba[dstIdx + 2] = rawBytes[srcIdx];
        rgba[dstIdx + 3] = 255;
      } else {
        rgba[dstIdx] = rawBytes[srcIdx];
        rgba[dstIdx + 1] = rawBytes[srcIdx];
        rgba[dstIdx + 2] = rawBytes[srcIdx];
        rgba[dstIdx + 3] = 255;
      }
    }
  }

  return rgbaToPngDataUrl(rgba, bmpWidth, bmpHeight);
}

/**
 * Renders an annotation appearance stream into a transparent PNG data URL,
 * preserving soft masks (/SMask) and alpha channels.
 */
function renderAnnotationAppearanceToDataUrl(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  annotHandle: number,
  domWidth: number,
  domHeight: number
): string {
  let nativeImgW = 0;
  let nativeImgH = 0;
  let firstImageObj = 0;

  if (
    typeof mod.FPDFAnnot_GetObjectCount === 'function' &&
    typeof mod.FPDFAnnot_GetObject === 'function'
  ) {
    const objCount = mod.FPDFAnnot_GetObjectCount(annotHandle);
    for (let i = 0; i < objCount; i++) {
      const obj = mod.FPDFAnnot_GetObject(annotHandle, i);
      if (obj && mod.FPDFPageObj_GetType(obj) === 3) {
        firstImageObj = obj;
        if (typeof mod.FPDFImageObj_GetBitmap === 'function') {
          const bmp = mod.FPDFImageObj_GetBitmap(obj);
          if (bmp) {
            try {
              nativeImgW = mod.FPDFBitmap_GetWidth?.(bmp) ?? 0;
              nativeImgH = mod.FPDFBitmap_GetHeight?.(bmp) ?? 0;
            } finally {
              mod.FPDFBitmap_Destroy?.(bmp);
            }
          }
        }
        break;
      }
    }
  }

  if (typeof mod.EPDFAnnot_ExportAppearanceAsDocument === 'function') {
    const appDoc = mod.EPDFAnnot_ExportAppearanceAsDocument(annotHandle);
    if (appDoc) {
      let appPage = 0;
      let bmp = 0;
      let bufPtr = 0;
      try {
        appPage = mod.FPDF_LoadPage(appDoc, 0);
        if (appPage) {
          const renderW = Math.max(
            1,
            Math.min(1024, nativeImgW > 0 ? nativeImgW : Math.ceil(domWidth * 2))
          );
          const renderH = Math.max(
            1,
            Math.min(1024, nativeImgH > 0 ? nativeImgH : Math.ceil(domHeight * 2))
          );
          const stride = renderW * 4;
          bufPtr = engine.allocateMemory(stride * renderH);
          if (bufPtr) {
            bmp = mod.FPDFBitmap_CreateEx(renderW, renderH, 4, bufPtr, stride);
            if (bmp) {
              mod.FPDFBitmap_FillRect?.(bmp, 0, 0, renderW, renderH, 0x00000000);
              mod.FPDF_RenderPageBitmap(bmp, appPage, 0, 0, renderW, renderH, 0, 0);
              const url = extractBitmapToDataUrl(mod, bmp);
              if (url) {
                return url;
              }
            }
          }
        }
      } catch {
        // Fall through to direct bitmap extraction
      } finally {
        try {
          if (bmp) {
            mod.FPDFBitmap_Destroy?.(bmp);
          }
        } finally {
          try {
            if (bufPtr) {
              engine.freeMemory(bufPtr);
            }
          } finally {
            try {
              if (appPage) {
                mod.FPDF_ClosePage(appPage);
              }
            } finally {
              mod.FPDF_CloseDocument(appDoc);
            }
          }
        }
      }
    }
  }

  if (firstImageObj && typeof mod.FPDFImageObj_GetBitmap === 'function') {
    const bmp = mod.FPDFImageObj_GetBitmap(firstImageObj);
    if (bmp) {
      try {
        return extractBitmapToDataUrl(mod, bmp);
      } finally {
        mod.FPDFBitmap_Destroy?.(bmp);
      }
    }
  }

  return '';
}

/**
 * Multiplies two 2D PDF affine transformation matrices (outer * inner).
 */
function multiplyPdfMatrices(outer: PdfMatrix, inner: PdfMatrix): PdfMatrix {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

/**
 * Recursively collects vector path objects (FPDF_PAGEOBJ_PATH = 2) inside an annotation
 * or nested Form XObject (FPDF_PAGEOBJ_FORM = 5), accumulating parent Form matrices.
 */
function collectAnnotationPathObjects(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  annotHandle: number
): Array<{ objHandle: number; insideForm: boolean; parentMatrix: PdfMatrix | null }> {
  const results: Array<{ objHandle: number; insideForm: boolean; parentMatrix: PdfMatrix | null }> = [];
  if (
    typeof mod.FPDFAnnot_GetObjectCount !== 'function' ||
    typeof mod.FPDFAnnot_GetObject !== 'function'
  ) {
    return results;
  }

  const visitFormObject = (formObj: number, accumulatedMatrix: PdfMatrix | null, depth: number): void => {
    if (
      depth > 6 ||
      typeof mod.FPDFFormObj_CountObjects !== 'function' ||
      typeof mod.FPDFFormObj_GetObject !== 'function'
    ) {
      return;
    }
    const formMat = getPageObjectMatrix(engine, mod, formObj);
    const nextMatrix =
      accumulatedMatrix && formMat
        ? multiplyPdfMatrices(accumulatedMatrix, formMat)
        : formMat || accumulatedMatrix;

    const subCount = mod.FPDFFormObj_CountObjects(formObj);
    for (let k = 0; k < subCount; k++) {
      const subObj = mod.FPDFFormObj_GetObject(formObj, k);
      if (!subObj) continue;
      const subType = mod.FPDFPageObj_GetType(subObj);
      if (subType === 2) {
        results.push({ objHandle: subObj, insideForm: true, parentMatrix: nextMatrix });
      } else if (subType === 5) {
        visitFormObject(subObj, nextMatrix, depth + 1);
      }
    }
  };

  const topCount = mod.FPDFAnnot_GetObjectCount(annotHandle);
  for (let j = 0; j < topCount; j++) {
    const obj = mod.FPDFAnnot_GetObject(annotHandle, j);
    if (!obj) continue;
    const objType = mod.FPDFPageObj_GetType(obj);
    if (objType === 2) {
      results.push({ objHandle: obj, insideForm: false, parentMatrix: null });
    } else if (objType === 5) {
      visitFormObject(obj, null, 1);
    }
  }

  return results;
}

/**
 * Resolves the effective page-space matrix for an annotation path object.
 * Nested Form XObject paths may have coordinates in [0..W, 0..H] or in an arbitrary Form /BBox;
 * this normalises their translation into the annotation's page-space /Rect [pdfLeft, pdfBottom].
 */
function resolveAnnotationPathMatrix(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  pathObj: number,
  insideForm: boolean,
  parentMatrix: PdfMatrix | null,
  pdfLeft: number,
  pdfBottom: number,
  width: number,
  height: number,
  boundsPtrs: { leftPtr: number; bottomPtr: number; rightPtr: number; topPtr: number }
): PdfMatrix | null {
  const ownMat = getPageObjectMatrix(engine, mod, pathObj) ?? {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 0,
    f: 0,
  };
  const mat = parentMatrix ? multiplyPdfMatrices(parentMatrix, ownMat) : ownMat;
  if (!insideForm) return mat;

  const ok = mod.FPDFPageObj_GetBounds(
    pathObj,
    boundsPtrs.leftPtr,
    boundsPtrs.bottomPtr,
    boundsPtrs.rightPtr,
    boundsPtrs.topPtr
  );
  if (!ok) return mat;

  const heapF32 = mod.pdfium.HEAPF32;
  const bLeft = heapF32[boundsPtrs.leftPtr >> 2];
  const bBottom = heapF32[boundsPtrs.bottomPtr >> 2];

  const tLeft = parentMatrix
    ? parentMatrix.a * bLeft + parentMatrix.c * bBottom + parentMatrix.e
    : bLeft;
  const tBottom = parentMatrix
    ? parentMatrix.b * bLeft + parentMatrix.d * bBottom + parentMatrix.f
    : bBottom;

  const distToPageRect = Math.hypot(tLeft - pdfLeft, tBottom - pdfBottom);
  if (distToPageRect <= Math.max(width, height, 5)) {
    return mat;
  }

  if (tLeft >= -2 && tBottom >= -2 && tLeft <= width + 2 && tBottom <= height + 2) {
    return {
      ...mat,
      e: mat.e + pdfLeft,
      f: mat.f + pdfBottom,
    };
  }

  return {
    ...mat,
    e: mat.e + (pdfLeft - tLeft),
    f: mat.f + (pdfBottom - tBottom),
  };
}

/**
 * Formats an RGB triplet and alpha byte into a CSS hex or rgba colour string.
 */
function formatColorAndOpacity(
  r: number,
  g: number,
  b: number,
  a: number
): { color: string; opacity: number } {
  const toHex = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  const opacity = a < 255 ? Math.round((a / 255) * 1000) / 1000 : 1;
  return { color: hex, opacity };
}

/**
 * Extracts QuadPoints from a markup annotation into a local SVG path string.
 */
function extractQuadPointsSvgPath(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  annotHandle: number,
  cropInfo: PageCropInfo,
  domLeft: number,
  domTop: number,
  heightPts: number
): string | undefined {
  if (
    typeof mod.FPDFAnnot_CountAttachmentPoints !== 'function' ||
    typeof mod.FPDFAnnot_GetAttachmentPoints !== 'function'
  ) {
    return undefined;
  }

  const quadCount = mod.FPDFAnnot_CountAttachmentPoints(annotHandle);
  if (quadCount <= 1) return undefined;

  const quadPtr = engine.allocateMemory(32);
  if (!quadPtr) return undefined;

  try {
    const heapF32 = mod.pdfium.HEAPF32;
    const cmds: string[] = [];
    const fmt = (n: number): number => Math.round(n * 100) / 100;

    const toLocalDom = (pdfX: number, pdfY: number): { x: number; y: number } => {
      if (cropInfo.rotation !== 0) {
        const pt = pdfToDomCoords(pdfX, pdfY, cropInfo);
        return { x: fmt(pt.x - domLeft), y: fmt(pt.y - domTop) };
      }
      return {
        x: fmt(pdfX - cropInfo.cropLeft - domLeft),
        y: fmt(heightPts - (pdfY - cropInfo.cropBottom) - domTop),
      };
    };

    for (let q = 0; q < quadCount; q++) {
      const ok = mod.FPDFAnnot_GetAttachmentPoints(annotHandle, q, quadPtr);
      if (!ok) continue;
      const base = quadPtr >> 2;
      const p1 = toLocalDom(heapF32[base], heapF32[base + 1]);
      const p2 = toLocalDom(heapF32[base + 2], heapF32[base + 3]);
      const p3 = toLocalDom(heapF32[base + 4], heapF32[base + 5]);
      const p4 = toLocalDom(heapF32[base + 6], heapF32[base + 7]);
      cmds.push(
        `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p4.x} ${p4.y} L ${p3.x} ${p3.y} Z`
      );
    }

    return cmds.length > 0 ? cmds.join(' ') : undefined;
  } finally {
    engine.freeMemory(quadPtr);
  }
}

/**
 * Extracts InkList strokes from an Ink annotation into a local SVG path string.
 */
function extractInkListSvgPath(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  annotHandle: number,
  cropInfo: PageCropInfo,
  domLeft: number,
  domTop: number,
  heightPts: number
): string | undefined {
  if (
    typeof mod.FPDFAnnot_GetInkListCount !== 'function' ||
    typeof mod.FPDFAnnot_GetInkListPath !== 'function'
  ) {
    return undefined;
  }

  const inkCount = mod.FPDFAnnot_GetInkListCount(annotHandle);
  if (inkCount <= 0) return undefined;

  const fmt = (n: number): number => Math.round(n * 100) / 100;
  const toLocalDom = (pdfX: number, pdfY: number): { x: number; y: number } => {
    if (cropInfo.rotation !== 0) {
      const pt = pdfToDomCoords(pdfX, pdfY, cropInfo);
      return { x: fmt(pt.x - domLeft), y: fmt(pt.y - domTop) };
    }
    return {
      x: fmt(pdfX - cropInfo.cropLeft - domLeft),
      y: fmt(heightPts - (pdfY - cropInfo.cropBottom) - domTop),
    };
  };

  const cmds: string[] = [];
  for (let s = 0; s < inkCount; s++) {
    const ptCount = mod.FPDFAnnot_GetInkListPath(annotHandle, s, 0, 0);
    if (ptCount <= 0) continue;
    const bufPtr = engine.allocateMemory(ptCount * 8);
    if (!bufPtr) continue;
    try {
      mod.FPDFAnnot_GetInkListPath(annotHandle, s, bufPtr, ptCount);
      const heapF32 = mod.pdfium.HEAPF32;
      const base = bufPtr >> 2;
      for (let k = 0; k < ptCount; k++) {
        const pt = toLocalDom(heapF32[base + k * 2], heapF32[base + k * 2 + 1]);
        cmds.push(k === 0 ? `M ${pt.x} ${pt.y}` : `L ${pt.x} ${pt.y}`);
      }
    } finally {
      engine.freeMemory(bufPtr);
    }
  }

  return cmds.length > 0 ? cmds.join(' ') : undefined;
}

/**
 * Extracts native PDF annotations (stamps, highlights, markups, ink drawings, geometric shapes,
 * and redactions) on a page into EditableImageSpan and EditableShapeSpan overlays.
 */
export function extractPageAnnotations(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  pageIndex: number,
  pageHandle: number,
  cropInfo: PageCropInfo,
  heightPts: number,
  boundsPtrs: { leftPtr: number; bottomPtr: number; rightPtr: number; topPtr: number },
  pathPtrs: PathExtractionPointers
): { images: EditableImageSpan[]; shapes: EditableShapeSpan[] } {
  const images: EditableImageSpan[] = [];
  const shapes: EditableShapeSpan[] = [];

  if (
    typeof mod.FPDFPage_GetAnnotCount !== 'function' ||
    typeof mod.FPDFPage_GetAnnot !== 'function' ||
    typeof mod.FPDFAnnot_GetRect !== 'function'
  ) {
    return { images, shapes };
  }

  const annotCount = mod.FPDFPage_GetAnnotCount(pageHandle);
  if (annotCount <= 0) {
    return { images, shapes };
  }

  const rectPtr = engine.allocateMemory(16);
  if (!rectPtr) {
    return { images, shapes };
  }

  try {
    const heapF32 = mod.pdfium.HEAPF32;
    const heapU32 = mod.pdfium.HEAPU32;

    for (let i = 0; i < annotCount; i++) {
      const annotHandle = mod.FPDFPage_GetAnnot(pageHandle, i);
      if (!annotHandle) continue;

      try {
        const subtype = mod.FPDFAnnot_GetSubtype(annotHandle);
        if (
          subtype === FPDF_ANNOT_TEXT ||
          subtype === FPDF_ANNOT_LINK ||
          subtype === FPDF_ANNOT_POPUP ||
          subtype === FPDF_ANNOT_WIDGET
        ) {
          continue;
        }

        const okRect = mod.FPDFAnnot_GetRect(annotHandle, rectPtr);
        if (!okRect) continue;

