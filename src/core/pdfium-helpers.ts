/**
 * Shared low-level PDFium WASM interop utilities.
 *
 * Extracts repeated boilerplate (UTF-16LE encoding, FS_MATRIX writes,
 * page handle lifecycle, font name normalisation, text width calculation)
 * into composable, fully-typed helper functions.
 */

import { PdfiumEngine, type ExtendedWrappedPdfiumModule } from './pdfium-engine';
import type { PdfMatrix, StandardFontName, PageCropInfo } from './types';
export type { StandardFontName };

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
const UTF16LE_DECODER = new TextDecoder('utf-16le');

export function readUtf16Le(
  heapU8: Uint8Array,
  ptr: number,
  byteLength: number,
): string {
  // Find the null terminator position to avoid reading garbage bytes.
  let len = 0;
  while (len + 1 < byteLength && (heapU8[ptr + len] !== 0 || heapU8[ptr + len + 1] !== 0)) {
    len += 2;
  }
  if (len === 0) return '';
  return UTF16LE_DECODER.decode(
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
  const hasScratch = typeof engine?.getMatrixScratchBuffer === 'function';
  const matrixPtr = hasScratch
    ? engine.getMatrixScratchBuffer().matrixPtr
    : safeAllocate(engine, 24);
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
    if (!hasScratch) {
      engine.freeMemory(matrixPtr);
    }
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

  const hasScratch = typeof engine?.getMatrixScratchBuffer === 'function';
  const matrixPtr = hasScratch
    ? engine.getMatrixScratchBuffer().matrixPtr
    : safeAllocate(engine, 24);
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
    if (!hasScratch) {
      engine.freeMemory(matrixPtr);
    }
  }
}

/**
 * Creates an identity transformation matrix with x and y translation values.
 *
 * @param tx Translation distance along the x-axis.
 * @param ty Translation distance along the y-axis.
 * @return The constructed matrix.
 */
/**
 * Extracts a bitmap handle for an image page object at its native pixel dimensions
 * while compositing any attached `/SMask` or `/Mask` transparency channel.
 *
 * `FPDFImageObj_GetBitmap` returns only the raw colour stream and discards soft masks,
 * turning transparent backgrounds into opaque black. `FPDFImageObj_GetRenderedBitmap`
 * composites the soft mask into a Format 4 (`FPDFBitmap_BGRA`) bitmap, and temporarily
 * setting the image object matrix to `(pixelW, 0, 0, pixelH, 0, 0)` ensures 1:1 native
 * pixel sampling without double-applying page rotation or display scaling.
 *
 * @param engine The PDFium engine instance.
 * @param mod The extended WASM module instance.
 * @param docHandle Handle to the parent PDF document.
 * @param pageHandle Handle to the page containing the image object.
 * @param objHandle Handle to the target image page object.
 * @return A PDFium bitmap handle that the caller must release via `FPDFBitmap_Destroy`, or 0.
 */
export function extractImageObjectBitmap(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  docHandle: number,
  pageHandle: number,
  objHandle: number,
): number {
  if (!objHandle) return 0;

  if (
    docHandle &&
    pageHandle &&
    typeof mod.FPDFImageObj_GetRenderedBitmap === 'function'
  ) {
    let pixelW = 0;
    let pixelH = 0;

    if (
      typeof mod.FPDFImageObj_GetImagePixelSize === 'function' &&
      typeof engine?.getColorScratchBuffer === 'function' &&
      mod.pdfium?.HEAPU32
    ) {
      try {
        const { rPtr, gPtr } = engine.getColorScratchBuffer();
        const ok = mod.FPDFImageObj_GetImagePixelSize(objHandle, rPtr, gPtr);
        if (ok) {
          pixelW = mod.pdfium.HEAPU32[rPtr >> 2];
          pixelH = mod.pdfium.HEAPU32[gPtr >> 2];
        }
      } catch {
        pixelW = 0;
        pixelH = 0;
      }
    }

    if (pixelW > 0 && pixelH > 0) {
      const origMatrix = getPageObjectMatrix(engine, mod, objHandle);
      if (origMatrix) {
        try {
          setPageObjectMatrix(engine, mod, objHandle, {
            a: pixelW,
            b: 0,
            c: 0,
            d: pixelH,
            e: 0,
            f: 0,
          });
          const rendered = mod.FPDFImageObj_GetRenderedBitmap(
            docHandle,
            pageHandle,
            objHandle,
          );
          if (rendered) return rendered;
        } catch {
          // Fall through to raw bitmap extraction
        } finally {
          setPageObjectMatrix(engine, mod, objHandle, origMatrix);
        }
      } else {
        try {
          const rendered = mod.FPDFImageObj_GetRenderedBitmap(
            docHandle,
            pageHandle,
            objHandle,
          );
          if (rendered) return rendered;
        } catch {
          // Fall through to raw bitmap extraction
        }
      }
    }
  }

  if (typeof mod.FPDFImageObj_GetBitmap === 'function') {
    return mod.FPDFImageObj_GetBitmap(objHandle);
  }

  return 0;
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

// Font name normalisation

/** Map of normalised (lowercase, stripped) font names to standard PDF fonts. */
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

  // URW Nimbus PostScript Type 1 clones
  nimbusromno9lregu: 'Times-Roman',
  nimbusromno9lreg: 'Times-Roman',
  nimbusromno9lmedi: 'Times-Bold',
  nimbusromno9lmedm: 'Times-Bold',
  nimbusromno9lreguital: 'Times-Italic',
  nimbusromno9lmediital: 'Times-BoldItalic',
  nimbusromno9lmedmital: 'Times-BoldItalic',
  nimbusromno9litai: 'Times-Italic',
  nimbusromno9lita: 'Times-Italic',
  nimbusromno9lbold: 'Times-Bold',
  nimbusromno9lboldital: 'Times-BoldItalic',
  nimbusrom: 'Times-Roman',
  nimbusroman: 'Times-Roman',
  nimbussanlregu: 'Helvetica',
  nimbussanlbold: 'Helvetica-Bold',
  nimbussanlreguital: 'Helvetica-Oblique',
  nimbussanlboldital: 'Helvetica-BoldOblique',
  nimbussan: 'Helvetica',
  nimbussans: 'Helvetica',
  nimbusmonlregu: 'Courier',
  nimbusmonlbold: 'Courier-Bold',
  nimbusmonlreguobli: 'Courier-Oblique',
  nimbusmonlboldobli: 'Courier-BoldOblique',
  nimbusmon: 'Courier',
  nimbusmono: 'Courier',
};

/** All 14 standard PDF Type 1 font names. */
const STANDARD_FONT_NAMES: ReadonlySet<string> = new Set<StandardFontName>([
  'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
  'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
  'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
  'Symbol', 'ZapfDingbats',
]);

/**
 * Determines whether a font name, weight, or PDF font descriptor flag bitmask represents bold weight.
 *
 * @param fontName Raw or canonical font name.
 * @param fontWeight Optional explicit weight ('bold', 'normal', or numeric weight).
 * @param fontFlags Optional PDF font descriptor flags (bit 19 / 0x40000 is ForceBold).
 * @return True if the font is bold.
 */
export function isBoldFontName(
  fontName?: string,
  fontWeight?: number | string,
  fontFlags?: number
): boolean {
  if (fontWeight === 'bold') return true;
  if (fontWeight === 'normal') return false;
  if (typeof fontWeight === 'number' && fontWeight >= 600) return true;
  if (fontFlags !== undefined && (fontFlags & 0x40000) !== 0) return true;
  if (!fontName) return false;

  const lower = cleanSubsetPrefix(fontName).toLowerCase();
  return (
    lower.includes('bold') ||
    lower.includes('black') ||
    lower.includes('heavy') ||
    lower.includes('semibold') ||
    lower.includes('demibold') ||
    lower.includes('medi') ||
    lower.includes('medm') ||
    lower.includes('bx') ||
    lower.startsWith('ptmb') ||
    lower.startsWith('phvb') ||
    lower.startsWith('pcrb') ||
    lower.startsWith('pplb') ||
    lower.startsWith('bchb') ||
    lower.startsWith('putb') ||
    lower.startsWith('pncb') ||
    lower.startsWith('pbkd') ||
    lower.startsWith('txb') ||
    lower.startsWith('pxb')
  );
}

/**
 * Determines whether a font name, style, or PDF font descriptor flag bitmask represents italic/oblique style.
 *
 * @param fontName Raw or canonical font name.
 * @param fontStyle Optional explicit style ('italic', 'oblique', or 'normal').
 * @param fontFlags Optional PDF font descriptor flags (bit 7 / 0x40 is Italic).
 * @return True if the font is italic or oblique.
 */
export function isItalicFontName(
  fontName?: string,
  fontStyle?: string,
  fontFlags?: number
): boolean {
  if (fontStyle === 'italic' || fontStyle === 'oblique') return true;
  if (fontStyle === 'normal') return false;
  if (fontFlags !== undefined && (fontFlags & 0x40) !== 0) return true;
  if (!fontName) return false;

  const lower = cleanSubsetPrefix(fontName).toLowerCase();
  return (
    lower.includes('italic') ||
    lower.includes('oblique') ||
    lower.includes('ital') ||
    lower.includes('obli') ||
    lower.includes('slant') ||
    /[-_,](it|ob|sl)$/i.test(lower) ||
    lower.startsWith('cmti') ||
    lower.startsWith('cmsl') ||
    lower.startsWith('cmmi') ||
    lower.startsWith('lmti') ||
    lower.startsWith('lmsl') ||
    lower.startsWith('lmmi') ||
    lower.startsWith('cmssi') ||
    lower.startsWith('lmsso') ||
    lower.startsWith('ptmri') ||
    lower.startsWith('ptmbi') ||
    lower.startsWith('phvro') ||
    lower.startsWith('phvbo') ||
    lower.startsWith('pcrro') ||
    lower.startsWith('pcrbo') ||
    lower.startsWith('pplri') ||
    lower.startsWith('pplbi') ||
    lower.startsWith('bchri') ||
    lower.startsWith('bchbi') ||
    lower.startsWith('putri') ||
    lower.startsWith('txi') ||
    lower.startsWith('pxi')
  );
}

/**
 * Maps a detected PDF font name to the closest standard PDF Type 1 font.
 *
 * @param detectedFontName Raw font name extracted from a PDF.
 * @param fontWeight Optional font weight ('bold' or 'normal').
 * @param fontStyle Optional font style ('italic' or 'normal').
 * @param fontFlags Optional PDF font descriptor flags.
 * @return The mapped standard PDF font name.
 */
export function mapStandardFontName(
  detectedFontName: string,
  fontWeight?: string,
  fontStyle?: string,
  fontFlags?: number
): StandardFontName {
  if (!detectedFontName) detectedFontName = 'Helvetica';
  detectedFontName = cleanSubsetPrefix(detectedFontName);

  // Exact match (already a standard font) if no custom weight/style/flag override
  if (!fontWeight && !fontStyle && !fontFlags && STANDARD_FONT_NAMES.has(detectedFontName)) {
    return detectedFontName as StandardFontName;
  }

  const normalized = detectedFontName.toLowerCase().replace(/[\s_,\-]+/g, '');
  if (!fontWeight && !fontStyle && !fontFlags) {
    const mapped =
      FONT_NAME_MAP[detectedFontName.toLowerCase().trim().replace(/[\s_,]+/g, '-')] ??
      FONT_NAME_MAP[normalized];
    if (mapped) return mapped;
  }

  const lower = detectedFontName.toLowerCase();
  if (
    lower.includes('symbol') ||
    lower.startsWith('cmsy') ||
    lower.startsWith('cmex') ||
    lower.startsWith('msam') ||
    lower.startsWith('msbm') ||
    lower.startsWith('wasy')
  ) {
    return 'Symbol';
  }
  if (lower.includes('zapfdingbat') || lower.includes('dingbat')) return 'ZapfDingbats';

  let base: 'Helvetica' | 'Times' | 'Courier' = 'Helvetica';
  if (
    lower.includes('courier') ||
    lower.includes('mono') ||
    lower.includes('nimbusmon') ||
    lower.includes('consol') ||
    lower.includes('typewriter') ||
    lower.startsWith('cmtt') ||
    lower.startsWith('lmtt') ||
    lower.startsWith('pcr') ||
    lower.startsWith('qcr') ||
    lower.startsWith('ucr')
  ) {
    base = 'Courier';
  } else if (
    lower.includes('times') ||
    lower.includes('nimbusrom') ||
    lower.includes('nimbusroman') ||
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
    lower.includes('utopia') ||
    lower.includes('termes') ||
    lower.includes('pagella') ||
    lower.includes('bonum') ||
    lower.includes('schola') ||
    lower.includes('serif') ||
    lower.includes('roman') ||
    lower.startsWith('cmr') ||
    lower.startsWith('cmbx') ||
    lower.startsWith('cmti') ||
    lower.startsWith('cmsl') ||
    lower.startsWith('cmcsc') ||
    lower.startsWith('cmmi') ||
    lower.startsWith('lmr') ||
    lower.startsWith('lmbx') ||
    lower.startsWith('lmti') ||
    lower.startsWith('lmsl') ||
    lower.startsWith('lmcsc') ||
    lower.startsWith('lmmi') ||
    lower.startsWith('ptm') ||
    lower.startsWith('ppl') ||
    lower.startsWith('qtm') ||
    lower.startsWith('qpl') ||
    lower.startsWith('bch') ||
    lower.startsWith('put') ||
    lower.startsWith('pnc') ||
    lower.startsWith('pbk') ||
    lower.startsWith('newtx') ||
    lower.startsWith('newpx') ||
    lower.startsWith('mathptmx') ||
    lower.startsWith('mathpazo') ||
    lower.startsWith('stix')
  ) {
    base = 'Times';
  } else {
    base = 'Helvetica';
  }

  const isBold = isBoldFontName(detectedFontName, fontWeight, fontFlags);
  const isItalic = isItalicFontName(detectedFontName, fontStyle, fontFlags);

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
  const wideSerifScale =
    isTimes && /utopia|charter|bookman|century|palatino|pagella|bonum|schola/i.test(fontFamily)
      ? 1.08
      : 1.0;

  let units = 0;
  for (let i = 0; i < text.length; i++) {
    units += table[text[i]] ?? fallback;
  }
  return (units / 1000) * fontSize * wideSerifScale;
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

  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const pdfLeft = spanLeft + cropInfo.cropLeft;

  // Define the target region in PDF coordinate space (tolerance padding)
  const targetLeft = pdfLeft - 1.5;
  const targetRight = pdfLeft + spanWidth + 1.5;
  const targetBottom = spanBaselineY - spanFontSize * 0.45;
  const targetTop = spanBaselineY + spanFontSize * 1.05;

  const objectCount = mod.FPDFPage_CountObjects(pageHandle);
  const objectsToRemove: number[] = [];
  const hasBoundsApi = typeof mod.FPDFPageObj_GetBounds === 'function';

  if (hasBoundsApi) {
    // Reusable bounds pointers (float* = 4 bytes each) from engine scratch buffer
    const { leftPtr, bottomPtr, rightPtr, topPtr } = engine.getBoundsScratchBuffer();

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

      const overlapLeft = Math.max(objLeft, targetLeft);
      const overlapRight = Math.min(objRight, targetRight);
      const overlapBottom = Math.max(objBottom, targetBottom);
      const overlapTop = Math.min(objTop, targetTop);

      const overlapWidth = overlapRight - overlapLeft;
      const overlapHeight = overlapTop - overlapBottom;

      if (overlapWidth <= 0 || overlapHeight <= 0) continue;

      const objWidth = objRight - objLeft;
      const objHeight = objTop - objBottom;
      const objCenterX = (objLeft + objRight) / 2;
      const objCenterY = (objBottom + objTop) / 2;

      if (cropInfo.rotation === 0) {
        const mat = getPageObjectMatrix(engine, mod, objHandle);
        if (
          mat &&
          mat.f > 0 &&
          Math.abs(mat.b) < 0.01 &&
          Math.abs(mat.c) < 0.01 &&
          Math.abs(mat.f - spanBaselineY) > Math.max(3.5, spanFontSize * 0.4)
        ) {
          continue;
        }
      }

      const centerInTarget =
        objCenterX >= targetLeft && objCenterX <= targetRight &&
        objCenterY >= targetBottom && objCenterY <= targetTop;

      const substantialOverlap =
        centerInTarget &&
        objWidth > 0 &&
        objWidth <= spanWidth + 6.0 &&
        overlapWidth / objWidth >= 0.4 &&
        objHeight > 0 &&
        overlapHeight / objHeight >= 0.4;

      if (centerInTarget || substantialOverlap) {
        objectsToRemove.push(i);
      }
    }
  } else {
    // Without bounds API, bounds-based removal cannot proceed safely
    return false;
  }

  if (objectsToRemove.length === 0) {
    return true;
  }

  // Remove collected objects (indices are already in descending order)
  const hasDestroy = typeof mod.FPDFPageObj_Destroy === 'function';
  for (const idx of objectsToRemove) {
    const objHandle = mod.FPDFPage_GetObject(pageHandle, idx);
    if (!objHandle) continue;

    const ok = mod.FPDFPage_RemoveObject(pageHandle, objHandle);
    if (ok && hasDestroy) {
      mod.FPDFPageObj_Destroy(objHandle);
    }
  }

  return true;
}

/**
 * Removes all text objects that are fully enclosed within any of the provided bounding rectangles from the page.
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

  const objectCount = mod.FPDFPage_CountObjects(pageHandle);
  if (objectCount === 0) return false;

  const hasBoundsApi = typeof mod.FPDFPageObj_GetBounds === 'function';
  if (!hasBoundsApi) return false;

  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const targetBoxes = rects.map((r) => {
    const p1 = domToPdfCoords(r.x, r.y, cropInfo);
    const p2 = domToPdfCoords(r.x + r.width, r.y + r.height, cropInfo);
    return {
      targetLeft: Math.min(p1.x, p2.x),
      targetRight: Math.max(p1.x, p2.x),
      targetTop: Math.max(p1.y, p2.y),
      targetBottom: Math.min(p1.y, p2.y),
    };
  });

  const objectsToRemove: number[] = [];
  const { leftPtr, bottomPtr, rightPtr, topPtr } = engine.getBoundsScratchBuffer();

  for (let i = objectCount - 1; i >= 0; i--) {
    const objHandle = mod.FPDFPage_GetObject(pageHandle, i);
    if (!objHandle) continue;

    if (mod.FPDFPageObj_GetType(objHandle) !== FPDF_PAGEOBJ_TEXT) continue;

    const ok = mod.FPDFPageObj_GetBounds(objHandle, leftPtr, bottomPtr, rightPtr, topPtr);
    if (!ok) continue;

    const heapF32 = mod.pdfium.HEAPF32;
    const rawLeft = heapF32[leftPtr >> 2];
    const rawBottom = heapF32[bottomPtr >> 2];
    const rawRight = heapF32[rightPtr >> 2];
    const rawTop = heapF32[topPtr >> 2];

    const objMinX = Math.min(rawLeft, rawRight);
    const objMaxX = Math.max(rawLeft, rawRight);
    const objMinY = Math.min(rawBottom, rawTop);
    const objMaxY = Math.max(rawBottom, rawTop);

    const objWidth = objMaxX - objMinX;
    const objHeight = objMaxY - objMinY;
    if (objWidth <= 0 || objHeight <= 0) continue;

    // Strict full enclosure containment check
    const isFullyEnclosed = targetBoxes.some((b) =>
      objMinX >= b.targetLeft &&
      objMaxX <= b.targetRight &&
      objMinY >= b.targetBottom &&
      objMaxY <= b.targetTop
    );

    if (isFullyEnclosed) {
      objectsToRemove.push(i);
    }
  }

  if (objectsToRemove.length === 0) {
    return false;
  }

  const hasDestroy = typeof mod.FPDFPageObj_Destroy === 'function';
  for (const idx of objectsToRemove) {
    const objHandle = mod.FPDFPage_GetObject(pageHandle, idx);
    if (!objHandle) continue;

    const removedOk = mod.FPDFPage_RemoveObject(pageHandle, objHandle);
    if (removedOk && hasDestroy) {
      mod.FPDFPageObj_Destroy(objHandle);
    }
  }

  return true;
}

/**
 * Finds a text object within the given bounding box and updates its text string.
 * This is used for in-place text editing to preserve the original embedded font.
 * 
 * @param engine The PdfiumEngine instance.
 * @param mod The WASM module.
 * @param pageHandle The handle to the page.
 * @param targetLeft The left coordinate of the bounding box.
 * @param targetBottom The bottom coordinate of the bounding box.
 * @param targetWidth The width of the bounding box.
 * @param targetFontSize The font size (used as vertical tolerance).
 * @param newText The new text string to set.
 * @returns boolean true if an object was found and modified, false otherwise.
 */
export function setTextObjectInBounds(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  pageHandle: number,
  spanLeft: number,
  spanBaselineY: number,
  spanWidth: number,
  spanFontSize: number,
  newText: string,
  matrix?: PdfMatrix
): boolean {
  const objectCount = mod.FPDFPage_CountObjects(pageHandle);
  if (objectCount === 0) return false;

  const hasBoundsApi = typeof mod.FPDFPageObj_GetBounds === 'function';
  if (!hasBoundsApi) return false;

  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const pdfLeft = spanLeft + cropInfo.cropLeft;

  // Match the exact bounding region used by removeTextObjectsInBounds
  const targetLeft = pdfLeft - 1.5;
  const targetRight = pdfLeft + spanWidth + 1.5;
  const targetBottom = spanBaselineY - spanFontSize * 0.45;
  const targetTop = spanBaselineY + spanFontSize * 1.05;

  const { leftPtr, bottomPtr, rightPtr, topPtr } = engine.getBoundsScratchBuffer();

  let modified = false;
  let isFirst = true;

  for (let i = 0; i < objectCount; i++) {
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

    const overlapLeft = Math.max(objLeft, targetLeft);
    const overlapRight = Math.min(objRight, targetRight);
    const overlapBottom = Math.max(objBottom, targetBottom);
    const overlapTop = Math.min(objTop, targetTop);

    const overlapWidth = overlapRight - overlapLeft;
    const overlapHeight = overlapTop - overlapBottom;

    if (overlapWidth <= 0 || overlapHeight <= 0) continue;

    const objWidth = objRight - objLeft;
    const objHeight = objTop - objBottom;
    const objCenterX = (objLeft + objRight) / 2;
    const objCenterY = (objBottom + objTop) / 2;

    if (cropInfo.rotation === 0) {
      const mat = getPageObjectMatrix(engine, mod, objHandle);
      if (
        mat &&
        mat.f > 0 &&
        Math.abs(mat.b) < 0.01 &&
        Math.abs(mat.c) < 0.01 &&
        Math.abs(mat.f - spanBaselineY) > Math.max(3.5, spanFontSize * 0.4)
      ) {
        continue;
      }
    }

    const centerInTarget =
      objCenterX >= targetLeft && objCenterX <= targetRight &&
      objCenterY >= targetBottom && objCenterY <= targetTop;

    const substantialOverlap =
      centerInTarget &&
      objWidth > 0 &&
      objWidth <= spanWidth + 6.0 &&
      overlapWidth / objWidth >= 0.4 &&
      objHeight > 0 &&
      overlapHeight / objHeight >= 0.4;

    if (centerInTarget || substantialOverlap) {
      // Set the first object to the actual new text,
      // set all subsequent objects to a space to hide them
      const textToSet = isFirst ? newText : ' ';
      const textBuf = encodeUtf16Le(engine, textToSet);
      try {
        mod.FPDFText_SetText(objHandle, textBuf.ptr);
        if (isFirst && matrix) {
          setPageObjectMatrix(engine, mod, objHandle, matrix);
        }
      } finally {
        textBuf.dispose();
      }
      modified = true;
      isFirst = false;
    }
  }

  return modified;
}

/**
 * Identify the exact page object indices that back a text span using
 * centre-containment matching. An object is considered part of the span
 * only if the object's geometric centre falls within the span's tight
 * bounding region. This avoids catching neighbouring text objects that
 * merely overlap at the edges.
 *
 * @param engine The PDFium engine instance.
 * @param mod The extended WASM module instance.
 * @param pageHandle Handle to the loaded page.
 * @param spanLeft Left coordinate of the text span.
 * @param spanBaselineY Baseline Y coordinate of the text span (PDF coords).
 * @param spanWidth Width of the text span.
 * @param spanFontSize Font size of the text span.
 * @return Array of page object indices whose centres fall inside the span region.
 */
export function findTextObjectIndicesForSpan(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  pageHandle: number,
  spanLeft: number,
  spanBaselineY: number,
  spanWidth: number,
  spanFontSize: number,
): number[] {
  const objectCount = mod.FPDFPage_CountObjects(pageHandle);
  if (objectCount === 0) return [];

  const hasBoundsApi = typeof mod.FPDFPageObj_GetBounds === 'function';
  if (!hasBoundsApi) return [];

  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const pdfLeft = spanLeft + cropInfo.cropLeft;

  // Tight bounding region with minimal tolerance (1pt horizontal)
  const targetLeft = pdfLeft - 1;
  const targetRight = pdfLeft + spanWidth + 1;
  const targetBottom = spanBaselineY - spanFontSize * 0.45;
  const targetTop = spanBaselineY + spanFontSize * 1.05;

  const matchedObjects: Array<{ index: number; left: number; top: number }> = [];
  const { leftPtr, bottomPtr, rightPtr, topPtr } = engine.getBoundsScratchBuffer();

  for (let i = 0; i < objectCount; i++) {
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

    const objWidth = objRight - objLeft;
    const objCenterX = (objLeft + objRight) / 2;
    const objCenterY = (objBottom + objTop) / 2;

    if (cropInfo.rotation === 0) {
      if (objWidth > spanWidth + 10.0) continue;
      const mat = getPageObjectMatrix(engine, mod, objHandle);
      if (
        mat &&
        mat.f > 0 &&
        Math.abs(mat.b) < 0.01 &&
        Math.abs(mat.c) < 0.01 &&
        Math.abs(mat.f - spanBaselineY) > Math.max(3.5, spanFontSize * 0.4)
      ) {
        continue;
      }
    }

    // Require the object's centre to be inside the span's tight region
    let centerInTarget = false;
    if (cropInfo.rotation === 0) {
      centerInTarget =
        objCenterX >= targetLeft && objCenterX <= targetRight &&
        objCenterY >= targetBottom && objCenterY <= targetTop;
    } else {
      const domCenter = pdfToDomCoords(objCenterX, objCenterY, cropInfo);
      const domBaselinePt = pdfToDomCoords(pdfLeft, spanBaselineY, cropInfo);
      const domTargetTop = domBaselinePt.y - spanFontSize * 1.2;
      const domTargetBottom = domBaselinePt.y + spanFontSize * 0.5;
      const minY = Math.min(domTargetTop, domTargetBottom) - 2;
      const maxY = Math.max(domTargetTop, domTargetBottom) + 2;

      centerInTarget =
        domCenter.x >= spanLeft - 2 && domCenter.x <= spanLeft + spanWidth + 2 &&
        domCenter.y >= minY && domCenter.y <= maxY;
    }

    if (centerInTarget) {
      matchedObjects.push({ index: i, left: objLeft, top: objTop });
    }
  }

  // Sort matched objects geometrically: PDF top-to-bottom, then left-to-right
  matchedObjects.sort((a, b) => {
    if (Math.abs(a.top - b.top) > 3.0) {
      return b.top - a.top;
    }
    return a.left - b.left;
  });

  return matchedObjects.map((m) => m.index);
}

/**
 * Remove specific page objects by their indices. Sorts indices in
 * descending order before removal so that earlier indices remain valid
 * as later objects are removed.
 *
 * @param mod The extended WASM module instance.
 * @param pageHandle Handle to the loaded page.
 * @param indices Array of zero-based page object indices to remove.
 * @return True if at least one object was removed.
 */
export function removeTextObjectsByIndex(
  mod: ExtendedWrappedPdfiumModule,
  pageHandle: number,
  indices: number[],
): boolean {
  if (indices.length === 0) return false;

  const hasRemoveApi =
    typeof mod.FPDFPage_GetObject === 'function' &&
    typeof mod.FPDFPage_RemoveObject === 'function';
  if (!hasRemoveApi) return false;

  // Deduplicate and sort descending so lower indices remain stable during removal
  const sorted = Array.from(new Set(indices)).sort((a, b) => b - a);
  const hasDestroy = typeof mod.FPDFPageObj_Destroy === 'function';
  let removed = false;

  for (const idx of sorted) {
    const objHandle = mod.FPDFPage_GetObject(pageHandle, idx);
    if (!objHandle) continue;

    const ok = mod.FPDFPage_RemoveObject(pageHandle, objHandle);
    if (ok && hasDestroy) {
      mod.FPDFPageObj_Destroy(objHandle);
    }
    if (ok) removed = true;
  }

  return removed;
}

/**
 * Set the text content of a specific page object identified by index.
 * Optionally applies a transformation matrix. Only operates on text-type
 * page objects.
 *
 * @param engine The PDFium engine instance.
 * @param mod The extended WASM module instance.
 * @param pageHandle Handle to the loaded page.
 * @param objectIndex Zero-based index of the target page object.
 * @param newText The replacement text string.
 * @param matrix Optional transformation matrix to apply.
 * @return True if the object was found and modified.
 */
export function setTextObjectByIndex(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  pageHandle: number,
  objectIndex: number,
  newText: string,
  matrix?: PdfMatrix,
): boolean {
  const objHandle = mod.FPDFPage_GetObject(pageHandle, objectIndex);
  if (!objHandle) return false;

  if (mod.FPDFPageObj_GetType(objHandle) !== FPDF_PAGEOBJ_TEXT) return false;

  const textBuf = encodeUtf16Le(engine, newText);
  try {
    mod.FPDFText_SetText(objHandle, textBuf.ptr);
    if (matrix) {
      setPageObjectMatrix(engine, mod, objHandle, matrix);
    }
  } finally {
    textBuf.dispose();
  }

  return true;
}

/**
 * Draws a white cover rectangle over a text span region.
 *
 * Used as a fallback when object removal API is unavailable.
 *
 * @param mod The extended WASM module instance.
 * @param pageHandle Handle to the loaded page.
 * @param spanLeft Left coordinate of text span.
 * @param spanBaselineY Baseline Y coordinate of text span.
 * @param spanWidth Width of text span.
 * @param spanFontSize Font size of text span.
 */
export function drawCoverRect(
  mod: ExtendedWrappedPdfiumModule,
  pageHandle: number,
  spanLeft: number,
  spanBaselineY: number,
  spanWidth: number,
  spanFontSize: number,
): void {
  const rectLeft = Math.max(0, spanLeft - 1.5);
  const rectBottom = Math.max(0, spanBaselineY - spanFontSize * 0.3);
  const rectWidth = spanWidth + 4.0;
  const rectHeight = spanFontSize * 1.45;

  const rectObj = mod.FPDFPageObj_CreateNewRect(rectLeft, rectBottom, rectWidth, rectHeight);
  if (!rectObj) return;

  // Fill mode = 1 (alternate), stroke = false
  mod.FPDFPageObj_SetFillColor(rectObj, 255, 255, 255, 255);
  mod.FPDFPath_SetDrawMode(rectObj, 1, false);
  mod.FPDFPage_InsertObject(pageHandle, rectObj);
}

// Font info extraction

/**
 * Reads the font name and PDF font descriptor flags of a specific character in a text page.
 *
 * @param engine The PDFium engine instance.
 * @param mod The extended WASM module instance.
 * @param textPageHandle Handle to the loaded text page.
 * @param charIndex Zero-based index of the target character.
 * @return Object containing the extracted fontName and fontFlags bitmask.
 */
export function readCharFontInfo(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  textPageHandle: number,
  charIndex: number
): { fontName: string; fontFlags: number } {
  if (typeof mod.FPDFText_GetFontInfo !== 'function') {
    return { fontName: 'Helvetica', fontFlags: 0 };
  }

  const { fontBufPtr, flagsPtr } = engine.getFontNameScratchBuffer();

  try {
    if (mod.pdfium?.HEAP32) {
      mod.pdfium.HEAP32[flagsPtr >> 2] = 0;
    }
    const len = mod.FPDFText_GetFontInfo(textPageHandle, charIndex, fontBufPtr, 128, flagsPtr);
    const fontFlags = mod.pdfium?.HEAP32 ? (mod.pdfium.HEAP32[flagsPtr >> 2] || 0) : 0;
    if (len <= 0) return { fontName: 'Helvetica', fontFlags };

    const heapU8 = mod.pdfium.HEAPU8;
    let fontStr = '';
    const maxLen = Math.min(len, 128);
    for (let k = 0; k < maxLen; k++) {
      const b = heapU8[fontBufPtr + k];
      if (b === 0) break;
      fontStr += String.fromCharCode(b);
    }
    return { fontName: fontStr.trim() || 'Helvetica', fontFlags };
  } catch {
    return { fontName: 'Helvetica', fontFlags: 0 };
  }
}

/**
 * Reads the font name of a specific character in a text page.
 *
 * @param engine The PDFium engine instance.
 * @param mod The extended WASM module instance.
 * @param textPageHandle Handle to the loaded text page.
 * @param charIndex Zero-based index of the target character.
 * @return The extracted font name string, or 'Helvetica' as fallback.
 */
export function readCharFontName(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  textPageHandle: number,
  charIndex: number,
): string {
  return readCharFontInfo(engine, mod, textPageHandle, charIndex).fontName;
}

/**
 * Reads the fill colour of a specific character in a text page.
 *
 * @param engine The PDFium engine instance.
 * @param mod The extended WASM module instance.
 * @param textPageHandle Handle to the loaded text page.
 * @param charIndex Zero-based index of the target character.
 * @return Object containing red, green, blue, and alpha colour components (0-255).
 */
export function readCharFillColor(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  textPageHandle: number,
  charIndex: number,
): { r: number; g: number; b: number; a: number } {
  const defaultColor = { r: 0, g: 0, b: 0, a: 255 };

  if (typeof mod.FPDFText_GetFillColor !== 'function') {
    return defaultColor;
  }

  const { rPtr, gPtr, bPtr, aPtr } = engine.getColorScratchBuffer();

  try {
    const ok = mod.FPDFText_GetFillColor(textPageHandle, charIndex, rPtr, gPtr, bPtr, aPtr);
    if (!ok) return defaultColor;

    const heap32 = mod.pdfium.HEAP32;
    return {
      r: heap32[rPtr >> 2] & 0xff,
      g: heap32[gPtr >> 2] & 0xff,
      b: heap32[bPtr >> 2] & 0xff,
      a: heap32[aPtr >> 2] & 0xff,
    };
  } catch {
    return defaultColor;
  }
}

/**
 * Reads the vertical scale `hypot(c, d)` of a character text matrix.
 *
 * The caller owns `matrixPtr`, which must reference at least 24 bytes of WASM
 * heap memory (an `FS_MATRIX` of six 32-bit floats) and may be reused across
 * characters to avoid per-glyph allocations.
 *
 * @param mod The extended WASM module instance.
 * @param textPageHandle Handle to the loaded text page.
 * @param charIndex Zero-based index of the target character.
 * @param matrixPtr Caller-owned scratch pointer for the `FS_MATRIX` output.
 * @return The vertical matrix scale, or null when unavailable.
 */
export function readCharMatrixScaleY(
  mod: ExtendedWrappedPdfiumModule,
  textPageHandle: number,
  charIndex: number,
  matrixPtr: number,
): number | null {
  if (typeof mod.FPDFText_GetMatrix !== 'function' || !matrixPtr) return null;
  try {
    if (!mod.FPDFText_GetMatrix(textPageHandle, charIndex, matrixPtr)) return null;
    const heapF32 = mod.pdfium.HEAPF32;
    const base = matrixPtr >> 2;
    const scaleY = Math.hypot(heapF32[base + 2], heapF32[base + 3]);
    return Number.isFinite(scaleY) && scaleY > 0 ? scaleY : null;
  } catch {
    return null;
  }
}

/**
 * Strips 6-character PDF subset prefix (e.g. "ABCDEF+") from a font name.
 *
 * @param fontName Raw PDF font name.
 * @return Clean font name without subset prefix.
 */
export function cleanSubsetPrefix(fontName: string): string {
  if (!fontName) return '';
  const plusIdx = fontName.indexOf('+');
  if (plusIdx >= 0 && plusIdx <= 7) {
    const prefix = fontName.substring(0, plusIdx);
    if (/^[A-Za-z0-9]{6,7}$/.test(prefix)) {
      return fontName.substring(plusIdx + 1).trim();
    }
  }
  return fontName.trim();
}

/**
 * Extracts a normalised base font family from a raw PDF font name.
 * Strips subset prefixes (e.g. "ABCDEF+"), PostScript style suffixes,
 * and normalises casing for grouping and fallback matching.
 *
 * Examples:
 *   "ABCDEF+Arial-BoldMT"     -> "arial"
 *   "XYZABC+TimesNewRomanPSMT"-> "times new roman"
 *   "GHIJKL+Calibri-BoldItalic" -> "calibri"
 *
 * @param fontName The raw font name from PDFium.
 * @return A lowercase base family name suitable for grouping.
 */
export function extractBaseFontFamily(fontName: string): string {
  if (!fontName) return 'helvetica';

  let name = cleanSubsetPrefix(fontName);

  // Convert comma style separators to hyphens
  name = name.replace(/,([A-Za-z]+)$/, '-$1');

  // Add spaces to PascalCase/camelCase names before lowercasing
  name = name.replace(/([a-z])([A-Z])/g, '$1 $2');

  // Lowercase for consistent grouping
  name = name.toLowerCase().trim();

  // Iteratively strip style and PostScript variant suffixes
  const suffixPattern = /[-,_\s]+(bolditalic|boldoblique|boldital|boldobli|reguital|mediital|medmital|reguobli|bold|italic|oblique|ital|obli|slanted|slant(?:[_-]?\d+)?|regular|regu|medium|medi|medm|light|semibold|demibold|extrabold|condensed|expanded|narrow|black|thin|heavy|book|reg|bd|it|bi|ro|psmt|ps|mt|ms|identity-h|cid)$/;
  let prev = '';
  while (prev !== name) {
    prev = name;
    name = name.replace(suffixPattern, '').trim();
  }

  // Strip trailing -roman style suffix only if not part of a compound family name like "new roman"
  if (!name.endsWith('new roman')) {
    name = name.replace(/[-,_\s]roman$/, '').trim();
  }

  // Strip trailing unpunctuated PostScript identifiers
  name = name.replace(/(psmt|ps|mt|ms)$/, '').trim();

  return name || 'helvetica';
}

/**
 * Locates an existing FPDF_FONT handle on the page matching the requested font family or raw name.
 * Extracts font handles from native text page objects via FPDFTextObj_GetFont.
 *
 * @param engine The PDFium engine instance.
 * @param mod The extended WASM module instance.
 * @param pageHandle Handle to the loaded page.
 * @param targetFontFamily Normalised font family name.
 * @param rawFontFamily Raw font family name (potentially with subset prefix).
 * @return FPDF_FONT handle if found, or 0 if not present on the page.
 */
export function findPageFontHandle(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  pageHandle: number,
  targetFontFamily?: string,
  rawFontFamily?: string,
): number {
  if (!pageHandle || (!targetFontFamily && !rawFontFamily)) return 0;
  if (typeof mod.FPDFTextObj_GetFont !== 'function' || typeof mod.FPDFFont_GetBaseFontName !== 'function') {
    return 0;
  }

  const cleanTarget = targetFontFamily ? targetFontFamily.toLowerCase().trim() : '';
  const cleanRaw = rawFontFamily ? rawFontFamily.toLowerCase().trim() : '';
  const baseTarget = cleanTarget ? extractBaseFontFamily(cleanTarget) : '';
  const baseRaw = cleanRaw ? extractBaseFontFamily(cleanRaw) : '';

  const objCount = mod.FPDFPage_CountObjects(pageHandle);
  if (objCount <= 0) return 0;

  const { fontBufPtr } = engine.getFontNameScratchBuffer();

  for (let i = 0; i < objCount; i++) {
    const objHandle = mod.FPDFPage_GetObject(pageHandle, i);
    if (!objHandle || mod.FPDFPageObj_GetType(objHandle) !== FPDF_PAGEOBJ_TEXT) continue;

    const fontHandle = mod.FPDFTextObj_GetFont(objHandle);
    if (!fontHandle) continue;

    const len = mod.FPDFFont_GetBaseFontName(fontHandle, fontBufPtr, 128);
    if (len <= 0) continue;

    const heapU8 = mod.pdfium.HEAPU8;
    let name = '';
    const maxLen = Math.min(len, 128);
    for (let k = 0; k < maxLen; k++) {
      const b = heapU8[fontBufPtr + k];
      if (b === 0) break;
      name += String.fromCharCode(b);
    }
    const lowerName = name.toLowerCase().trim();
    if (!lowerName) continue;

    if (cleanRaw && lowerName === cleanRaw) {
      return fontHandle;
    }

    const baseCandidate = extractBaseFontFamily(lowerName);
    const simplifiedCandidate = baseCandidate.replace(/-(bold|italic|oblique)/g, '').trim();
    if (baseRaw && (baseCandidate === baseRaw || simplifiedCandidate === baseRaw)) {
      return fontHandle;
    }
    if (baseTarget && (baseCandidate === baseTarget || simplifiedCandidate === baseTarget)) {
      return fontHandle;
    }
  }

  return 0;
}

/**
 * Queries CropBox and rotation information for a page handle.
 * Falls back to MediaBox if an explicit CropBox is not defined.
 *
 * @param engine PDFium engine instance.
 * @param mod Extended PDFium WebAssembly module.
 * @param pageHandle Active page handle pointer.
 * @return PageCropInfo with CropBox offsets, dimensions, and rotation.
 */
export function getPageCropInfo(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  pageHandle: number
): PageCropInfo {
  const rotation = (typeof mod?.FPDFPage_GetRotation === 'function'
    ? mod.FPDFPage_GetRotation(pageHandle)
    : 0) as 0 | 1 | 2 | 3;
  const width = typeof mod?.FPDF_GetPageWidthF === 'function'
    ? mod.FPDF_GetPageWidthF(pageHandle)
    : (typeof mod?.FPDF_GetPageWidth === 'function' ? mod.FPDF_GetPageWidth(pageHandle) : 612);
  const height = typeof mod?.FPDF_GetPageHeightF === 'function'
    ? mod.FPDF_GetPageHeightF(pageHandle)
    : (typeof mod?.FPDF_GetPageHeight === 'function' ? mod.FPDF_GetPageHeight(pageHandle) : 792);

  const scratch = engine && typeof engine.getBoundsScratchBuffer === 'function'
    ? engine.getBoundsScratchBuffer()
    : null;
  let mediaLeft = 0;
  let mediaBottom = 0;
  let mediaRight = width;
  let mediaTop = height;
  let cropLeft = 0;
  let cropBottom = 0;
  let cropRight = width;
  let cropTop = height;
  let hasCrop = false;

  if (scratch && mod) {
    const { leftPtr, bottomPtr, rightPtr, topPtr } = scratch;

    if (typeof mod.FPDFPage_GetMediaBox === 'function') {
      const hasMedia = Boolean(mod.FPDFPage_GetMediaBox(pageHandle, leftPtr, bottomPtr, rightPtr, topPtr));
      if (hasMedia && mod.pdfium?.HEAPF32) {
        const heapF32 = mod.pdfium.HEAPF32;
        mediaLeft = heapF32[leftPtr >> 2];
        mediaBottom = heapF32[bottomPtr >> 2];
        mediaRight = heapF32[rightPtr >> 2];
        mediaTop = heapF32[topPtr >> 2];
      }
    }

    if (typeof mod.FPDFPage_GetCropBox === 'function') {
      hasCrop = Boolean(mod.FPDFPage_GetCropBox(pageHandle, leftPtr, bottomPtr, rightPtr, topPtr));
      if (hasCrop && mod.pdfium?.HEAPF32) {
        const heapF32 = mod.pdfium.HEAPF32;
        cropLeft = heapF32[leftPtr >> 2];
        cropBottom = heapF32[bottomPtr >> 2];
        cropRight = heapF32[rightPtr >> 2];
        cropTop = heapF32[topPtr >> 2];
      }
    }

    if (!hasCrop) {
      cropLeft = mediaLeft;
      cropBottom = mediaBottom;
      cropRight = mediaRight;
      cropTop = mediaTop;
    }
  }

  const marginLeft = hasCrop ? Math.max(0, cropLeft - mediaLeft) : 0;
  const marginBottom = hasCrop ? Math.max(0, cropBottom - mediaBottom) : 0;
  const marginRight = hasCrop ? Math.max(0, mediaRight - cropRight) : 0;
  const marginTop = hasCrop ? Math.max(0, mediaTop - cropTop) : 0;

  let domCropLeft = marginLeft;
  let domCropTop = marginTop;
  if (rotation === 1) {
    domCropLeft = marginBottom;
    domCropTop = marginLeft;
  } else if (rotation === 2) {
    domCropLeft = marginRight;
    domCropTop = marginBottom;
  } else if (rotation === 3) {
    domCropLeft = marginTop;
    domCropTop = marginRight;
  }

  return {
    cropLeft,
    cropBottom,
    cropRight,
    cropTop,
    cropWidth: width,
    cropHeight: height,
    rotation,
    hasCrop,
    hasCropBox: hasCrop,
    domCropLeft,
    domCropTop,
    marginLeft,
    marginBottom,
    marginRight,
    marginTop,
  };
}

/**
 * Converts a point from PDF user space to DOM coordinates relative to the top-left of the page viewport.
 *
 * @param pdfX Horizontal coordinate in PDF user space.
 * @param pdfY Vertical coordinate in PDF user space.
 * @param cropInfo Page CropBox and rotation information.
 * @return DOM coordinates { x, y }.
 */
export function pdfToDomCoords(
  pdfX: number,
  pdfY: number,
  cropInfo: PageCropInfo
): { x: number; y: number } {
  const { cropLeft, cropBottom, cropWidth: w, cropHeight: h, rotation: rot } = cropInfo;
  switch (rot) {
    case 1:
      return {
        x: pdfY - cropBottom,
        y: pdfX - cropLeft,
      };
    case 2:
      return {
        x: w - (pdfX - cropLeft),
        y: pdfY - cropBottom,
      };
    case 3:
      return {
        x: w - (pdfY - cropBottom),
        y: h - (pdfX - cropLeft),
      };
    case 0:
    default:
      return {
        x: pdfX - cropLeft,
        y: h - (pdfY - cropBottom),
      };
  }
}

/**
 * Converts a point from DOM viewport space to native PDF user space.
 *
 * @param domX Horizontal coordinate in DOM space.
 * @param domY Vertical coordinate in DOM space.
 * @param cropInfo Page CropBox and rotation information.
 * @return PDF user space coordinates { x, y }.
 */
export function domToPdfCoords(
  domX: number,
  domY: number,
  cropInfo: PageCropInfo
): { x: number; y: number } {
  const { cropLeft, cropBottom, cropWidth: w, cropHeight: h, rotation: rot } = cropInfo;
  switch (rot) {
    case 1:
      return {
        x: domY + cropLeft,
        y: domX + cropBottom,
      };
    case 2:
      return {
        x: w - domX + cropLeft,
        y: domY + cropBottom,
      };
    case 3:
      return {
        x: h - domY + cropLeft,
        y: w - domX + cropBottom,
      };
    case 0:
    default:
      return {
        x: domX + cropLeft,
        y: h - domY + cropBottom,
      };
  }
}

/**
 * Converts a bounding box from PDF user space to DOM axis-aligned bounds.
 *
 * @param left Left bound in PDF user space.
 * @param bottom Bottom bound in PDF user space.
 * @param right Right bound in PDF user space.
 * @param top Top bound in PDF user space.
 * @param cropInfo Page CropBox and rotation information.
 * @return Bounding rectangle in DOM coordinates { left, top, right, bottom }.
 */
export function pdfBoxToDomBounds(
  left: number,
  bottom: number,
  right: number,
  top: number,
  cropInfo: PageCropInfo
): { left: number; top: number; right: number; bottom: number } {
  const p1 = pdfToDomCoords(left, top, cropInfo);
  const p2 = pdfToDomCoords(right, top, cropInfo);
  const p3 = pdfToDomCoords(left, bottom, cropInfo);
  const p4 = pdfToDomCoords(right, bottom, cropInfo);

  return {
    left: Math.min(p1.x, p2.x, p3.x, p4.x),
    top: Math.min(p1.y, p2.y, p3.y, p4.y),
    right: Math.max(p1.x, p2.x, p3.x, p4.x),
    bottom: Math.max(p1.y, p2.y, p3.y, p4.y),
  };
}

/**
 * Registry of PDFium path object handles created as text span decorations
 * (highlight background rectangles, underlines, and strikethroughs).
 */
const trackedSpanDecorationObjects = new Map<
  number,
  { left: number; bottom: number; width: number; height: number }
>();

/**
 * Registers a newly created PDFium rectangle object handle as a text span decoration
 * so it can be reliably purged when the owning text span is updated or deleted.
 *
 * @param objHandle Native PDFium page object handle.
 * @param left Horizontal left coordinate in PDF user space.
 * @param bottom Vertical bottom coordinate in PDF user space.
 * @param width Width of the decoration rectangle in points.
 * @param height Height of the decoration rectangle in points.
 */
export function registerSpanDecorationObject(
  objHandle: number,
  left: number,
  bottom: number,
  width: number,
  height: number
): void {
  if (!objHandle) return;
  trackedSpanDecorationObjects.set(objHandle, { left, bottom, width, height });
}

/**
 * Removes any previously inserted text span decoration path objects (background highlights,
 * underlines, or strikethroughs) located within the spatial bounds of a text span line.
 *
 * @param engine The PDFium engine instance.
 * @param mod The raw PDFium WASM module.
 * @param pageHandle Native handle to the target page.
 * @param spanLeft Left coordinate of the text span in DOM space.
 * @param spanBaselineY Baseline Y coordinate of the text span in PDF user space.
 * @param spanWidth Width of the text span in points.
 * @param spanFontSize Font size of the text span in points.
 * @return True if at least one decoration path object was removed.
 */
export function removeSpanDecorationObjectsInBounds(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  pageHandle: number,
  spanLeft: number,
  spanBaselineY: number,
  spanWidth: number,
  spanFontSize: number
): boolean {
  const numObjs = mod.FPDFPage_CountObjects(pageHandle);
  if (numObjs <= 0) return false;

  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const pdfLeft = spanLeft + cropInfo.cropLeft;
  const minX = pdfLeft - 6;
  const maxX = pdfLeft + Math.max(spanWidth, 4) + 12;
  const minY = spanBaselineY - spanFontSize * 0.45 - 3;
  const maxY = spanBaselineY + spanFontSize * 1.25 + 3;

  const indicesToRemove: number[] = [];

  for (let i = 0; i < numObjs; i++) {
    const obj = mod.FPDFPage_GetObject(pageHandle, i);
    if (!obj) continue;

    const tracked = trackedSpanDecorationObjects.get(obj);
    if (tracked) {
      const tRight = tracked.left + tracked.width;
      const tTop = tracked.bottom + tracked.height;
      const overlapsX = tracked.left <= maxX && tRight >= minX;
      const overlapsY = tracked.bottom >= minY && tTop <= maxY;
      if (overlapsX && overlapsY) {
        indicesToRemove.push(i);
        trackedSpanDecorationObjects.delete(obj);
      }
    }
  }

  if (indicesToRemove.length === 0) return false;

  const sortedDesc = [...indicesToRemove].sort((a, b) => b - a);
  for (const idx of sortedDesc) {
    const obj = mod.FPDFPage_GetObject(pageHandle, idx);
    if (obj) {
      mod.FPDFPage_RemoveObject(pageHandle, obj);
      mod.FPDFPageObj_Destroy(obj);
    }
  }
  return true;
}


