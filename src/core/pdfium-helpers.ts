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

  let base: 'Helvetica' | 'Times' | 'Courier' = 'Helvetica';
  if (
    lower.includes('courier') ||
    lower.includes('mono') ||
    lower.includes('consol') ||
    lower.includes('typewriter') ||
    lower.startsWith('cmtt') ||
    lower.startsWith('pcr')
  ) {
    base = 'Courier';
  } else if (
    lower.includes('times') ||
    lower.includes('georgia') ||
    lower.includes('palatino') ||
    lower.includes('garamond') ||
    lower.includes('cambria') ||
    lower.includes('minion') ||
    lower.includes('baskerville') ||
    lower.includes('charter') ||
    lower.includes('century') ||
    lower.includes('bodoni') ||
    lower.includes('didot') ||
    lower.includes('caslon') ||
    lower.includes('bookman') ||
    lower.includes('serif') ||
    lower.includes('roman') ||
    lower.startsWith('cmr') ||
    lower.startsWith('cmbx') ||
    lower.startsWith('cmti') ||
    lower.startsWith('cmsy') ||
    lower.startsWith('lmr') ||
    lower.startsWith('lmbx') ||
    lower.startsWith('lmti') ||
    lower.startsWith('ptm')
  ) {
    base = 'Times';
  } else {
    base = 'Helvetica';
  }

  const isBold =
    fontWeight === 'bold' ||
    lower.includes('bold') ||
    lower.includes('black') ||
    lower.includes('heavy') ||
    lower.includes('semibold') ||
    lower.includes('demibold');

  const isItalic =
    fontStyle === 'italic' ||
    fontStyle === 'oblique' ||
    lower.includes('italic') ||
    lower.includes('oblique');

  if (base === 'Courier') {
    if (isBold && isItalic) return 'Courier-BoldOblique';
    if (isBold) return 'Courier-Bold';
    if (isItalic) return 'Courier-Oblique';
    return 'Courier';
  }

  if (base === 'Times') {
    if (isBold && isItalic) return 'Times-BoldItalic';
    if (isBold) return 'Times-Bold';
    if (isItalic) return 'Times-Italic';
    return 'Times-Roman';
  }

  if (isBold && isItalic) return 'Helvetica-BoldOblique';
  if (isBold) return 'Helvetica-Bold';
  if (isItalic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

// Text width calculation

/** Helvetica glyph widths in 1/1000ths of a unit. */
const HELVETICA_WIDTHS: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 222,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015,
  'A': 667, 'B': 667, 'C': 722, 'D': 722, 'E': 667, 'F': 611, 'G': 778, 'H': 722,
  'I': 278, 'J': 500, 'K': 667, 'L': 556, 'M': 833, 'N': 722, 'O': 778, 'P': 667,
  'Q': 778, 'R': 722, 'S': 667, 'T': 611, 'U': 722, 'V': 667, 'W': 944, 'X': 667,
  'Y': 667, 'Z': 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556, '`': 333,
  'a': 556, 'b': 556, 'c': 500, 'd': 556, 'e': 556, 'f': 278, 'g': 556, 'h': 556,
  'i': 222, 'j': 222, 'k': 500, 'l': 222, 'm': 833, 'n': 556, 'o': 556, 'p': 556,
  'q': 556, 'r': 333, 's': 500, 't': 278, 'u': 556, 'v': 500, 'w': 722, 'x': 500,
  'y': 500, 'z': 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
  '\u2022': 350, '\u25AA': 350, '\u25E6': 350, '\u25CF': 350, '\u2023': 350,
  '\u2043': 333, '\u2219': 350, '\u00B7': 278, '\u2013': 500, '\u2014': 1000,
  '\u2026': 1000, '\u2018': 222, '\u2019': 222, '\u201C': 355, '\u201D': 355,
};

/** Times-Roman glyph widths in 1/1000ths of a unit. */
const TIMES_WIDTHS: Record<string, number> = {
  ' ': 250, '!': 333, '"': 408, '#': 500, '$': 500, '%': 833, '&': 778, "'": 333,
  '(': 333, ')': 333, '*': 500, '+': 564, ',': 250, '-': 333, '.': 250, '/': 278,
  '0': 500, '1': 500, '2': 500, '3': 500, '4': 500, '5': 500, '6': 500, '7': 500,
  '8': 500, '9': 500, ':': 278, ';': 278, '<': 564, '=': 564, '>': 564, '?': 444,
  '@': 921,
  'A': 722, 'B': 667, 'C': 667, 'D': 722, 'E': 611, 'F': 556, 'G': 722, 'H': 722,
  'I': 333, 'J': 444, 'K': 722, 'L': 611, 'M': 889, 'N': 722, 'O': 722, 'P': 667,
  'Q': 722, 'R': 667, 'S': 556, 'T': 611, 'U': 722, 'V': 722, 'W': 889, 'X': 722,
  'Y': 722, 'Z': 667,
  'a': 444, 'b': 500, 'c': 444, 'd': 500, 'e': 444, 'f': 333, 'g': 500, 'h': 500,
  'i': 278, 'j': 278, 'k': 500, 'l': 278, 'm': 778, 'n': 500, 'o': 500, 'p': 500,
  'q': 500, 'r': 333, 's': 389, 't': 278, 'u': 500, 'v': 500, 'w': 722, 'x': 500,
  'y': 500, 'z': 444,
  '{': 334, '|': 260, '}': 334, '~': 584,
  '\u2022': 350, '\u25AA': 350, '\u25E6': 350, '\u25CF': 350, '\u2023': 350,
  '\u2043': 333, '\u2219': 350, '\u00B7': 278, '\u2013': 500, '\u2014': 1000,
  '\u2026': 1000, '\u2018': 333, '\u2019': 333, '\u201C': 408, '\u201D': 408,
};

/** Courier fixed-width factor (all glyphs are 600/1000). */
const COURIER_CHAR_WIDTH = 600;

/**
 * Calculates approximate text width in PDF points using Type 1 font metrics.
 *
 * @param text The text string to measure.
 * @param fontSize Font size in points.
 * @param fontFamily Name of the font family.
 * @return Calculated width in PDF points.
 */
export function calculateTextWidth(
  text: string,
  fontSize: number,
  fontFamily: string,
): number {
  if (!text) return 0;

  const standardName = mapStandardFontName(fontFamily);

  // Courier family: all glyphs are fixed-width
  if (standardName.startsWith('Courier')) {
    return (text.length * COURIER_CHAR_WIDTH * fontSize) / 1000;
  }

  const isTimes = standardName.startsWith('Times');
  const table = isTimes ? TIMES_WIDTHS : HELVETICA_WIDTHS;
  const fallback = isTimes ? 500 : 556;

  let units = 0;
  for (let i = 0; i < text.length; i++) {
    units += table[text[i]] ?? fallback;
  }
  return (units / 1000) * fontSize;
}

// Page object removal

/** PDFium page object type constant for text objects. */
const FPDF_PAGEOBJ_TEXT = 1;

/**
 * Removes text page objects overlapping a bounding box region on a page.
 *
 * Falls back to rendering a white rectangle over the region if the object removal
 * API is unavailable in the WASM binding.
 *
 * @param engine The PDFium engine instance.
 * @param mod The extended WASM module instance.
 * @param pageHandle Handle to the loaded page.
 * @param spanLeft Left coordinate of text span bounding region.
 * @param spanBaselineY Baseline Y coordinate of text span bounding region.
 * @param spanWidth Width of text span bounding region.
 * @param spanFontSize Font size of text span bounding region.
 * @return True if objects were removed using PDFium API; false if fallback was used.
 */
export function removeTextObjectsInBounds(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  pageHandle: number,
  spanLeft: number,
  spanBaselineY: number,
  spanWidth: number,
  spanFontSize: number,
): boolean {
  // Check if the object removal API is available
  const hasRemoveApi =
    typeof mod.FPDFPage_CountObjects === 'function' &&
    typeof mod.FPDFPage_GetObject === 'function' &&
    typeof mod.FPDFPageObj_GetType === 'function' &&
    typeof mod.FPDFPage_RemoveObject === 'function';

  if (!hasRemoveApi) {
    drawCoverRect(mod, pageHandle, spanLeft, spanBaselineY, spanWidth, spanFontSize);
    return false;
  }

  const hasBoundsApi = typeof mod.FPDFPageObj_GetBounds === 'function';

  // Define the target region in PDF coordinate space (tolerance padding)
  const targetLeft = spanLeft - 2;
  const targetRight = spanLeft + spanWidth + 2;
  const targetBottom = spanBaselineY - spanFontSize * 0.4;
  const targetTop = spanBaselineY + spanFontSize * 1.1;

  const objectCount = mod.FPDFPage_CountObjects(pageHandle);
  const objectsToRemove: number[] = [];

  if (hasBoundsApi) {
    // Allocate bounds pointers (float* = 4 bytes each)
    const leftPtr = safeAllocate(engine, 4);
    const bottomPtr = safeAllocate(engine, 4);
    const rightPtr = safeAllocate(engine, 4);
    const topPtr = safeAllocate(engine, 4);

    try {
      // Collect text objects that overlap the target region (reverse order for safe removal)
      for (let i = objectCount - 1; i >= 0; i--) {
        const objHandle = mod.FPDFPage_GetObject(pageHandle, i);
        if (!objHandle) continue;

        if (mod.FPDFPageObj_GetType(objHandle) !== FPDF_PAGEOBJ_TEXT) continue;

        const ok = mod.FPDFPageObj_GetBounds(objHandle, leftPtr, bottomPtr, rightPtr, topPtr);
        if (!ok) continue;

        const heapF32 = mod.pdfium.HEAPF32;
        const objLeft = heapF32[leftPtr >> 2];
        const objBottom = heapF32[bottomPtr >> 2];
        const objRight = heapF32[rightPtr >> 2];
        const objTop = heapF32[topPtr >> 2];

        // Check bounding box overlap
        const overlaps =
          objLeft < targetRight && objRight > targetLeft &&
          objBottom < targetTop && objTop > targetBottom;

        if (overlaps) {
          objectsToRemove.push(i);
        }
      }
    } finally {
      engine.freeMemory(leftPtr);
      engine.freeMemory(bottomPtr);
      engine.freeMemory(rightPtr);
      engine.freeMemory(topPtr);
    }
  } else {
    // Without bounds API, remove all text objects (less precise fallback)
    for (let i = objectCount - 1; i >= 0; i--) {
      const objHandle = mod.FPDFPage_GetObject(pageHandle, i);
      if (!objHandle) continue;
      if (mod.FPDFPageObj_GetType(objHandle) !== FPDF_PAGEOBJ_TEXT) continue;
      objectsToRemove.push(i);
    }
  }

  if (objectsToRemove.length === 0) {
    return true;
  }

  // Remove collected objects (indices are already in descending order)
  const hasDestroy = typeof mod.FPDFPageObj_Destroy === 'function';
  for (const idx of objectsToRemove) {
    const objHandle = mod.FPDFPage_GetObject(pageHandle, idx);
    if (!objHandle) continue;

    mod.FPDFPage_RemoveObject(pageHandle, objHandle);
    if (hasDestroy) {
      mod.FPDFPageObj_Destroy(objHandle);
    }
  }

  return true;
}

/**
 * Removes all text objects that overlap any of the provided bounding rectangles from the page.
 * Coordinates in `rects` are in DOM coordinate space (top-left origin).
 *
 * @param engine The PDFium engine instance.
 * @param mod The extended WASM module instance.
 * @param pageHandle Handle to the loaded page.
 * @param rects Array of rectangles in DOM coordinates to remove text from.
 * @return True if operation was executed and objects were removed; false otherwise.
 */
export function removeTextObjectsInRects(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  pageHandle: number,
  rects: Array<{ x: number; y: number; width: number; height: number }>,
): boolean {
  if (rects.length === 0) return false;

  const hasRemoveApi =
    typeof mod.FPDFPage_CountObjects === 'function' &&
    typeof mod.FPDFPage_GetObject === 'function' &&
    typeof mod.FPDFPageObj_GetType === 'function' &&
    typeof mod.FPDFPage_RemoveObject === 'function';

  if (!hasRemoveApi) return false;

  const heightPts = mod.FPDF_GetPageHeightF(pageHandle);
  const objectCount = mod.FPDFPage_CountObjects(pageHandle);
  if (objectCount === 0) return false;

  const hasBoundsApi = typeof mod.FPDFPageObj_GetBounds === 'function';
  if (!hasBoundsApi) return false;

  const targetBoxes = rects.map((r) => ({
    targetLeft: r.x - 2,
    targetRight: r.x + r.width + 2,
    targetTop: heightPts - r.y + 2,
    targetBottom: heightPts - (r.y + r.height) - 2,
  }));

  const objectsToRemove: number[] = [];
  const leftPtr = safeAllocate(engine, 4);
  const bottomPtr = safeAllocate(engine, 4);
  const rightPtr = safeAllocate(engine, 4);
  const topPtr = safeAllocate(engine, 4);

  try {
    for (let i = objectCount - 1; i >= 0; i--) {
      const objHandle = mod.FPDFPage_GetObject(pageHandle, i);
      if (!objHandle) continue;

      if (mod.FPDFPageObj_GetType(objHandle) !== FPDF_PAGEOBJ_TEXT) continue;

      const ok = mod.FPDFPageObj_GetBounds(objHandle, leftPtr, bottomPtr, rightPtr, topPtr);
      if (!ok) continue;

      const heapF32 = mod.pdfium.HEAPF32;
      const objLeft = heapF32[leftPtr >> 2];
      const objBottom = heapF32[bottomPtr >> 2];
      const objRight = heapF32[rightPtr >> 2];
      const objTop = heapF32[topPtr >> 2];

      const overlapsAny = targetBoxes.some(
        (b) =>
          objLeft < b.targetRight &&
          objRight > b.targetLeft &&
          objBottom < b.targetTop &&
          objTop > b.targetBottom
      );

      if (overlapsAny) {
        objectsToRemove.push(i);
      }
    }
  } finally {
    engine.freeMemory(leftPtr);
    engine.freeMemory(bottomPtr);
    engine.freeMemory(rightPtr);
    engine.freeMemory(topPtr);
  }

  if (objectsToRemove.length === 0) {
    return false;
  }

  const hasDestroy = typeof mod.FPDFPageObj_Destroy === 'function';
  for (const idx of objectsToRemove) {
    const objHandle = mod.FPDFPage_GetObject(pageHandle, idx);
    if (!objHandle) continue;

    mod.FPDFPage_RemoveObject(pageHandle, objHandle);
    if (hasDestroy) {
      mod.FPDFPageObj_Destroy(objHandle);
    }
  }

  return true;
}

