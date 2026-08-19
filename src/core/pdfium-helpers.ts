/**
 * Shared low-level PDFium WASM interop utilities.
 *
 * Extracts repeated boilerplate (UTF-16LE encoding, FS_MATRIX writes,
 * page handle lifecycle, font name normalization, text width calculation)
 * into composable, fully-typed helper functions.
 */

import { PdfiumEngine, type ExtendedWrappedPdfiumModule } from './pdfium-engine';
import type { PdfMatrix, StandardFontName } from './types';

/**
 * Allocate WASM memory with null-pointer safety check.
 *
 * @param engine The PDFium engine instance.
 * @param sizeBytes Number of bytes to allocate.
 * @return The non-zero memory pointer.
 */
function safeAllocate(engine: PdfiumEngine, sizeBytes: number): number {
  const ptr = engine.allocateMemory(sizeBytes);
  if (!ptr) {
    throw new Error(`Failed to allocate ${sizeBytes} bytes in WASM heap.`);
  }
  return ptr;
}

// WASM buffer management

/**
 * Allocated WASM buffer with a dispose callback for cleanup.
 */
export interface WasmBuffer {
  /** Pointer to allocated memory in WASM heap. */
  ptr: number;
  /** Length of allocated buffer in bytes. */
  byteLength: number;
  /** Releases allocated WASM memory. */
  dispose: () => void;
}

/**
 * Encodes a JavaScript string as UTF-16LE into WASM heap memory.
 *
 * Caller must invoke `dispose()` when the buffer is no longer needed.
 *
 * @param engine The PDFium engine instance.
 * @param text The string to encode.
 * @return The allocated WASM buffer wrapper.
 */
export function encodeUtf16Le(engine: PdfiumEngine, text: string): WasmBuffer {
  const byteLength = (text.length + 1) * 2;
  const ptr = safeAllocate(engine, byteLength);
  const mod = engine.getModule();
  const uint8 = new Uint8Array(mod.pdfium.HEAPU8.buffer, ptr, byteLength);

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    uint8[i * 2] = code & 0xff;
    uint8[i * 2 + 1] = (code >> 8) & 0xff;
  }
  // Null terminator
  uint8[text.length * 2] = 0;
  uint8[text.length * 2 + 1] = 0;

  return {
    ptr,
    byteLength,
    dispose: () => engine.freeMemory(ptr),
  };
}

/**
 * Encodes a JavaScript string as null-terminated UTF-8 into WASM heap memory.
 *
 * @param engine The PDFium engine instance.
 * @param text The string to encode.
 * @return The allocated WASM buffer wrapper.
 */
export function encodeUtf8(engine: PdfiumEngine, text: string): WasmBuffer {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text + '\0');
  const ptr = safeAllocate(engine, bytes.byteLength);
  const mod = engine.getModule();
  const uint8 = new Uint8Array(mod.pdfium.HEAPU8.buffer, ptr, bytes.byteLength);
  uint8.set(bytes);

  return {
    ptr,
    byteLength: bytes.byteLength,
    dispose: () => engine.freeMemory(ptr),
  };
}

/**
 * Decodes a UTF-16LE encoded buffer from WASM heap into a JavaScript string.
 *
 * Stops reading at a null terminator or the end of the buffer.
 *
 * @param heapU8 The WASM heap memory view.
 * @param ptr The starting memory address of the string.
 * @param byteLength The maximum byte length to read.
 * @return The decoded JavaScript string.
 */
export function readUtf16Le(
  heapU8: Uint8Array,
  ptr: number,
  byteLength: number,
): string {
  // Find the null terminator position to avoid reading garbage bytes.
  let len = 0;
  while (len < byteLength && (heapU8[ptr + len] !== 0 || heapU8[ptr + len + 1] !== 0)) {
    len += 2;
  }
  if (len === 0) return '';
  return new TextDecoder('utf-16le').decode(
    new Uint8Array(heapU8.buffer, heapU8.byteOffset + ptr, len)
  );
}

// FS_MATRIX helpers

/**
 * Writes an FS_MATRIX struct to WASM heap and applies it to a page object.
 *
 * @param engine The PDFium engine instance.
 * @param mod The extended WASM module instance.
 * @param objHandle Handle to the target page object.
 * @param matrix The transformation matrix to set.
 */
export function setPageObjectMatrix(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  objHandle: number,
  matrix: PdfMatrix,
): void {
  const matrixPtr = safeAllocate(engine, 24);
  try {
    const heapF32 = mod.pdfium.HEAPF32;
    const idx = matrixPtr >> 2;
    heapF32[idx + 0] = matrix.a;
    heapF32[idx + 1] = matrix.b;
    heapF32[idx + 2] = matrix.c;
    heapF32[idx + 3] = matrix.d;
    heapF32[idx + 4] = matrix.e;
    heapF32[idx + 5] = matrix.f;
    mod.FPDFPageObj_SetMatrix(objHandle, matrixPtr);
  } finally {
    engine.freeMemory(matrixPtr);
  }
}

/**
 * Reads the transformation matrix of a page object via FPDFPageObj_GetMatrix.
 *
 * @param engine The PDFium engine instance.
 * @param mod The extended WASM module instance.
 * @param objHandle Handle to the target page object.
 * @returns The object's transformation matrix, or null if the API is unavailable or the call fails.
 */
export function getPageObjectMatrix(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  objHandle: number,
): PdfMatrix | null {
  if (typeof mod.FPDFPageObj_GetMatrix !== 'function') return null;

  const matrixPtr = safeAllocate(engine, 24);
  try {
    const ok = mod.FPDFPageObj_GetMatrix(objHandle, matrixPtr);
    if (!ok) return null;

    const heapF32 = mod.pdfium.HEAPF32;
    const idx = matrixPtr >> 2;
    return {
      a: heapF32[idx + 0],
      b: heapF32[idx + 1],
      c: heapF32[idx + 2],
      d: heapF32[idx + 3],
      e: heapF32[idx + 4],
      f: heapF32[idx + 5],
    };
  } finally {
    engine.freeMemory(matrixPtr);
  }
}

/**
 * Creates an identity transformation matrix with x and y translation values.
 *
 * @param tx Translation distance along the x-axis.
 * @param ty Translation distance along the y-axis.
 * @return The constructed matrix.
 */
export function translationMatrix(tx: number, ty: number): PdfMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

// Page handle lifecycle

/**
 * Loads a page handle, executes a callback, and guarantees page handle cleanup.
 *
 * @template T The return type of the callback.
 * @param engine The PDFium engine instance.
 * @param pageIndex Zero-based page index.
 * @param callback Function to execute with the opened page context.
 * @return The result returned by the callback.
 * @throws {Error} If no document handle is active or page loading fails.
 */
export function withPageHandle<T>(
  engine: PdfiumEngine,
  pageIndex: number,
  callback: (ctx: {
    pageHandle: number;
    docHandle: number;
    mod: ExtendedWrappedPdfiumModule;
  }) => T,
): T {
  const mod = engine.getModule();
  const docHandle = engine.getDocumentHandle();
  if (!docHandle) {
    throw new Error('No active document handle.');
  }

  const pageHandle = mod.FPDF_LoadPage(docHandle, pageIndex);
  if (!pageHandle) {
    throw new Error(`Failed to load page at index ${pageIndex}.`);
  }

  try {
    return callback({ pageHandle, docHandle, mod });
  } finally {
    mod.FPDF_ClosePage(pageHandle);
  }
}

/**
 * Loads page and text-page handles, executes a callback, and guarantees cleanup.
 *
 * @template T The return type of the callback.
 * @param engine The PDFium engine instance.
 * @param pageIndex Zero-based page index.
 * @param callback Function to execute with the opened text page context.
 * @return The result returned by the callback.
 * @throws {Error} If text page loading fails.
 */
export function withTextPageHandle<T>(
  engine: PdfiumEngine,
  pageIndex: number,
  callback: (ctx: {
    pageHandle: number;
    textPageHandle: number;
    docHandle: number;
    mod: ExtendedWrappedPdfiumModule;
  }) => T,
): T {
  return withPageHandle(engine, pageIndex, ({ pageHandle, docHandle, mod }) => {
    const textPageHandle = mod.FPDFText_LoadPage(pageHandle);
    if (!textPageHandle) {
      throw new Error(`Failed to load text page at index ${pageIndex}.`);
    }

    try {
      return callback({ pageHandle, textPageHandle, docHandle, mod });
    } finally {
      mod.FPDFText_ClosePage(textPageHandle);
    }
  });
}

// Font name normalization

/** Map of normalized (lowercase, stripped) font names to standard PDF fonts. */
const FONT_NAME_MAP: Record<string, StandardFontName> = {
  // Helvetica family
  arial: 'Helvetica',
  arialmt: 'Helvetica',
  'arial-bold': 'Helvetica-Bold',
  'arial-boldmt': 'Helvetica-Bold',
  'arial-italic': 'Helvetica-Oblique',
  'arial-italicmt': 'Helvetica-Oblique',
  'arial-bolditalic': 'Helvetica-BoldOblique',
  'arial-bolditalicmt': 'Helvetica-BoldOblique',
  helvetica: 'Helvetica',
  'helvetica-bold': 'Helvetica-Bold',
  'helvetica-oblique': 'Helvetica-Oblique',
  'helvetica-boldoblique': 'Helvetica-BoldOblique',

  // Times family
  times: 'Times-Roman',
  'times-roman': 'Times-Roman',
  timesnewroman: 'Times-Roman',
  timesnewromanpsmt: 'Times-Roman',
  'timesnewromanps-boldmt': 'Times-Bold',
  'timesnewromanps-italicmt': 'Times-Italic',
  'timesnewromanps-bolditalicmt': 'Times-BoldItalic',
  'times-bold': 'Times-Bold',
  'times-italic': 'Times-Italic',
  'times-bolditalic': 'Times-BoldItalic',

  // Courier family
  courier: 'Courier',
  couriernew: 'Courier',
  couriernewpsmt: 'Courier',
  'courier-bold': 'Courier-Bold',
  'courier-oblique': 'Courier-Oblique',
  'courier-boldoblique': 'Courier-BoldOblique',

  // Special fonts
  symbol: 'Symbol',
  zapfdingbats: 'ZapfDingbats',

  // Common substitutes
  calibri: 'Helvetica',
  cambria: 'Times-Roman',
  consolas: 'Courier',
  georgia: 'Times-Roman',
  verdana: 'Helvetica',
  trebuchetms: 'Helvetica',
  tahoma: 'Helvetica',
  palatino: 'Times-Roman',
  garamond: 'Times-Roman',
  segoeui: 'Helvetica',
};

/** All 14 standard PDF Type 1 font names. */
const STANDARD_FONT_NAMES: ReadonlySet<string> = new Set<StandardFontName>([
  'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
  'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
  'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
  'Symbol', 'ZapfDingbats',
]);

/**
 * Maps a detected PDF font name to the closest standard PDF Type 1 font.
 *
 * @param detectedFontName Raw font name extracted from a PDF.
 * @param fontWeight Optional font weight ('bold' or 'normal').
 * @param fontStyle Optional font style ('italic' or 'normal').
 * @return The mapped standard PDF font name.
 */
export function mapStandardFontName(
  detectedFontName: string,
  fontWeight?: string,
  fontStyle?: string
): StandardFontName {
  if (!detectedFontName) detectedFontName = 'Helvetica';

  // Exact match (already a standard font) if no custom weight/style override
  if (!fontWeight && !fontStyle && STANDARD_FONT_NAMES.has(detectedFontName)) {
    return detectedFontName as StandardFontName;
  }

  const normalized = detectedFontName.toLowerCase().replace(/[\s_,]+/g, '');
  if (!fontWeight && !fontStyle) {
    const mapped = FONT_NAME_MAP[normalized];
    if (mapped) return mapped;
  }

  const lower = detectedFontName.toLowerCase();
  if (lower.includes('symbol')) return 'Symbol';
  if (lower.includes('zapfdingbat') || lower.includes('dingbat')) return 'ZapfDingbats';

