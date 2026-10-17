/**
 * Modular File Merger Service.
 *
 * Provides capabilities to merge arbitrary collections of PDF documents
 * and image files into a single unified PDF document. Supports images
 * as standalone full-bleed pages and preserves the exact input sequence.
 */

import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../core/pdfium-engine';
import { mergeDocumentsAndImages } from './pdf/operations/document-ops';
import { documentConverter } from './conversion/document-converter';
import { linkCopiedPageAcroForms } from './pdf/operations/acroform-transfer-ops';
import { normalizePngBytesForEmbed } from './pdf/operations/annotation-extract-ops';

export interface MergeInputItem {
  readonly name: string;
  readonly buffer: ArrayBuffer | ArrayBufferView;
  readonly mimeType?: string;
}

export interface MergeFilesResult {
  readonly buffer: ArrayBuffer;
  readonly pageCount: number;
  readonly fileName: string;
}

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * Standard maximum point size for scaled image pages (A4 height).
 */
export const MAX_IMAGE_PAGE_DIMENSION = 842;

/**
 * Upper threshold before an image is scaled down to standard page bounds.
 */
export const OVERSIZED_IMAGE_THRESHOLD = 1200;

import { isPdfFile, isImageFile, inferImageMimeType } from '../utils/file-type-utils';
export { isPdfFile, isImageFile, inferImageMimeType };

/**
 * Checks whether an input represents a convertible document format (Office, Text, Spreadsheet, etc.).
 */
export function isConvertibleDocumentFile(
  input: File | Blob | ArrayBuffer | Uint8Array,
  fileName?: string
): boolean {
  if (fileName && documentConverter.isConvertible(fileName)) {
    return true;
  }
  if ('name' in input && typeof input.name === 'string' && documentConverter.isConvertible(input.name)) {
    return true;
  }
  return false;
}

/**
 * Calculates page dimensions in points for an image, scaling down oversized images
 * while preserving aspect ratio.
 */
export function calculateImagePageDimensions(
  naturalWidth: number,
  naturalHeight: number
): ImageDimensions {
  const width = naturalWidth > 0 ? naturalWidth : 595;
  const height = naturalHeight > 0 ? naturalHeight : 842;

  if (width > OVERSIZED_IMAGE_THRESHOLD || height > OVERSIZED_IMAGE_THRESHOLD) {
    const aspect = width / height;
    if (aspect >= 1) {
      return {
        width: MAX_IMAGE_PAGE_DIMENSION,
        height: Math.round(MAX_IMAGE_PAGE_DIMENSION / aspect),
      };
    } else {
      return {
        width: Math.round(MAX_IMAGE_PAGE_DIMENSION * aspect),
        height: MAX_IMAGE_PAGE_DIMENSION,
      };
    }
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * Attempts to parse width and height from PNG IHDR chunk (bytes 16 to 23).
 */
function extractPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }
  return null;
}

/**
 * Attempts to parse width and height from JPEG Start of Frame (SOF) segments.
 */
function extractJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset < bytes.length - 8) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    // Markers with no payload length
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    // Baseline SOF0 (0xC0), Extended SOF1 (0xC1), Progressive SOF2 (0xC2)
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = (bytes[offset + 5] << 8) + bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) + bytes[offset + 8];
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * Normalizes an image through browser canvas into clean 8-bit RGBA PNG bytes.
 * This guarantees compatibility with pdf-lib for exotic image variations.
 */
export async function reencodeImageViaCanvas(
  input: ArrayBuffer | Uint8Array,
  fileName?: string,
  mimeType?: string
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const resolvedMime = mimeType || inferImageMimeType(fileName);
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const safeArrayBuffer =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? (bytes.buffer as ArrayBuffer)
      : (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const blob = new Blob([safeArrayBuffer], { type: resolvedMime });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Failed to decode image data for "${fileName ?? 'image'}".`));
      el.src = objectUrl;
    });

    const width = img.naturalWidth || img.width || 595;
    const height = img.naturalHeight || img.height || 842;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable.');
    }
    ctx.drawImage(img, 0, 0, width, height);

    const pngBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png');
    });

    if (!pngBlob) {
      throw new Error('Failed to serialize image to PNG format.');
    }

    const pngBuffer = await pngBlob.arrayBuffer();
    return {
      data: new Uint8Array(pngBuffer),
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Converts an arbitrary image file or byte array into embeddable JPEG or PNG bytes.
 * Uses browser canvas rendering when available for broad format compatibility (WebP, GIF, BMP, SVG).
 */
export async function convertImageToEmbeddable(
  input: File | Blob | ArrayBuffer | Uint8Array,
  fileName?: string,
  mimeType?: string
): Promise<{
  data: Uint8Array;
  format: 'png' | 'jpeg';
  width: number;
  height: number;
}> {
  const resolvedMimeType = mimeType || inferImageMimeType(fileName);
  let bytes: Uint8Array;

  if (input instanceof Uint8Array) {
    bytes = input.byteOffset === 0 && input.byteLength === input.buffer.byteLength
      ? input
      : new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else {
    const arrayBuf = await input.arrayBuffer();
    bytes = new Uint8Array(arrayBuf);
  }

  // Fast path 1: PNG direct binary parsing
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (isPng) {
    const dims = extractPngDimensions(bytes);
    if (dims) {
      // Normalise 16-bit greyscale PNGs (where @pdf-lib/upng corrupts odd-column tRNS alpha)
      // and multi-frame APNGs (where pdf-lib throws on acTL chunks) into standard 8-bit RGBA PNGs.
      const bitDepth = bytes.length >= 26 ? bytes[24] : 8;
      const colorType = bytes.length >= 26 ? bytes[25] : 6;
      let needsPngNormalisation = bitDepth === 16 && colorType === 0;
      if (!needsPngNormalisation) {
        for (let i = 33; i + 8 <= bytes.length; i++) {
          if (
            bytes[i + 4] === 0x61 &&
            bytes[i + 5] === 0x63 &&
            bytes[i + 6] === 0x54 &&
            bytes[i + 7] === 0x4c
          ) {
            needsPngNormalisation = true;
            break;
          }
        }
      }
      const normalizedData = needsPngNormalisation
        ? (normalizePngBytesForEmbed(bytes) ?? bytes)
        : bytes;
      return {
        data: normalizedData,
        format: 'png',
        width: dims.width,
        height: dims.height,
      };
    }
  }

  // Fast path 2: JPEG direct binary parsing
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (isJpeg) {
    const dims = extractJpegDimensions(bytes);
    if (dims) {
      return {
        data: bytes,
        format: 'jpeg',
        width: dims.width,
        height: dims.height,
      };
    }
  }

  // Path 3: Browser DOM Canvas conversion for WebP, GIF, BMP, SVG, and other image formats
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const reencoded = await reencodeImageViaCanvas(bytes, fileName, resolvedMimeType);
    return {
      data: reencoded.data,
      format: 'png',
      width: reencoded.width,
      height: reencoded.height,
    };
  }

  // Fallback for headless environments if dimensions could not be read
  if (isPng) {
    return { data: bytes, format: 'png', width: 595, height: 842 };
  }
  if (isJpeg) {
    return { data: bytes, format: 'jpeg', width: 595, height: 842 };
  }

  throw new Error(`Unsupported image format for file "${fileName ?? 'image'}".`);
}

/**
 * Normalizes input list into standard MergeInputItem array with pure ArrayBuffer buffers.
 */
async function normalizeMergeInputs(
  inputs: Array<File | MergeInputItem>
): Promise<Array<{ name: string; buffer: ArrayBuffer; mimeType?: string }>> {
  const normalized: Array<{ name: string; buffer: ArrayBuffer; mimeType?: string }> = [];

  for (const item of inputs) {
    if ('buffer' in item) {
      let arrayBuf: ArrayBuffer;
      if (item.buffer instanceof ArrayBuffer) {
        arrayBuf = item.buffer;
      } else if (ArrayBuffer.isView(item.buffer)) {
        const view = item.buffer;
        arrayBuf = view.buffer.slice(
          view.byteOffset,
          view.byteOffset + view.byteLength
        ) as ArrayBuffer;
      } else {
        arrayBuf = new ArrayBuffer(0);
      }
      normalized.push({
        name: item.name,
        buffer: arrayBuf,
        mimeType: item.mimeType,
      });
    } else {
      const file = item as File;
      const buf = await file.arrayBuffer();
      normalized.push({
        name: file.name,
        buffer: buf,
        mimeType: file.type,
      });
    }
  }

  return normalized;
}

/**
 * Suggests an appropriate merged file name based on input names.
 */
function deriveMergedFileName(items: Array<{ name: string; buffer: ArrayBuffer; mimeType?: string }>): string {
  if (items.length === 0) return 'merged.pdf';
  if (items.length === 1) {
    const base = items[0].name.replace(/\.[^/.]+$/, '');
    return `${base}.pdf`;
  }

  const firstBase = items[0].name.replace(/\.[^/.]+$/, '');
  const allImages = items.every((i) => isImageFile(i.buffer, i.name));
  if (allImages) {
    return `${firstBase}_merged_images.pdf`;
  }
  return `${firstBase}_merged.pdf`;
}

/**
 * Merges PDF documents and images using pdf-lib.
 * Includes defensive updateFieldAppearances suppression and page-by-page copy fallback
 * to prevent UnexpectedObjectTypeError when AcroForms contain dangling or missing dictionary entries.
 */
export async function mergeFilesViaPdfLib(
  items: Array<{ name: string; buffer: ArrayBuffer; mimeType?: string }>
): Promise<MergeFilesResult> {
  const targetDoc = await PDFDocument.create();
  const registeredNames = new Set<string>();

  for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
    const item = items[itemIdx];
    const isPdf = isPdfFile(item.buffer, item.name);
    const isImg = isImageFile(item.buffer, item.name);
    const filePrefix = `file${itemIdx + 1}`;

    if (isPdf) {
      const srcDoc = await PDFDocument.load(item.buffer, { ignoreEncryption: true });
      const pageIndices = srcDoc.getPageIndices();
      if (pageIndices.length > 0) {
        try {
          const copiedPages = await targetDoc.copyPages(srcDoc, pageIndices);
          for (const page of copiedPages) {
            targetDoc.addPage(page);
          }
          linkCopiedPageAcroForms(targetDoc, copiedPages, filePrefix, registeredNames);
        } catch {
          // Bulk copy failure recovery: copy page by page to salvage all valid pages
          for (const idx of pageIndices) {
            try {
              const [singlePage] = await targetDoc.copyPages(srcDoc, [idx]);
              if (singlePage) {
                targetDoc.addPage(singlePage);
                linkCopiedPageAcroForms(targetDoc, [singlePage], filePrefix, registeredNames);
              }
            } catch {
              // Ignore individual corrupted page
            }
          }
        }
      }
    } else if (isImg) {
      let embeddable = await convertImageToEmbeddable(item.buffer, item.name, item.mimeType);
      let embeddedImage;

      try {
        const safeData = embeddable.data.byteOffset === 0 && embeddable.data.byteLength === embeddable.data.buffer.byteLength
          ? embeddable.data
          : new Uint8Array(embeddable.data.buffer.slice(embeddable.data.byteOffset, embeddable.data.byteOffset + embeddable.data.byteLength));
        embeddedImage = embeddable.format === 'jpeg'
          ? await targetDoc.embedJpg(safeData)
          : await targetDoc.embedPng(safeData);
      } catch {
        const normalizedPng =
          embeddable.format === 'png'
            ? normalizePngBytesForEmbed(embeddable.data)
            : null;
        if (normalizedPng) {
          embeddedImage = await targetDoc.embedPng(normalizedPng);
          embeddable = {
            ...embeddable,
            data: normalizedPng,
          };
        } else if (
          typeof window !== 'undefined' &&
          typeof document !== 'undefined' &&
          typeof Image !== 'undefined'
        ) {
          const reencoded = await reencodeImageViaCanvas(item.buffer, item.name, item.mimeType);
          embeddedImage = await targetDoc.embedPng(reencoded.data);
          embeddable = {
            data: reencoded.data,
            format: 'png',
            width: reencoded.width,
            height: reencoded.height,
          };
        } else {
          throw new Error(`Failed to embed image "${item.name}" into document.`);
        }
      }

      const dims = calculateImagePageDimensions(embeddable.width, embeddable.height);
      const page = targetDoc.addPage([dims.width, dims.height]);
      page.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: dims.width,
        height: dims.height,
      });
    } else if (documentConverter.isConvertible(item.name, item.buffer, item.mimeType)) {
      const converted = await documentConverter.convertDocument({
        name: item.name,
        buffer: item.buffer,
        mimeType: item.mimeType,
      });
      const convertedDoc = await PDFDocument.load(converted.buffer, { ignoreEncryption: true });
      const indices = convertedDoc.getPageIndices();
      const pages = await targetDoc.copyPages(convertedDoc, indices);
      for (const p of pages) {
        targetDoc.addPage(p);
      }
    } else {
      // Attempt PDF parsing as graceful fallback for unknown extensions with PDF content
      try {
        const fallbackDoc = await PDFDocument.load(item.buffer, { ignoreEncryption: true });
        const indices = fallbackDoc.getPageIndices();
        const pages = await targetDoc.copyPages(fallbackDoc, indices);
        for (const p of pages) {
          targetDoc.addPage(p);
        }
      } catch {
        throw new Error(`File "${item.name}" is not a recognized PDF or image format.`);
      }
    }
  }

  const pageCount = targetDoc.getPageCount();
  if (pageCount === 0) {
    throw new Error('Merged document contains no readable pages.');
  }

  // Passing updateFieldAppearances: false is critical to prevent pdf-lib from throwing
  // "Expected instance of PDFDict, but got instance of undefined" when AcroForm
  // fields contain dangling, invalid, or undefined dictionary references.
  const mergedBytes = await targetDoc.save({ updateFieldAppearances: false });
  const buffer = mergedBytes.buffer.slice(
    mergedBytes.byteOffset,
    mergedBytes.byteOffset + mergedBytes.byteLength
  ) as ArrayBuffer;

  return {
    buffer,
    pageCount,
    fileName: deriveMergedFileName(items),
  };
}

/**
 * Merges any combination of PDF files and image files into a single unified PDF buffer.
 * Preserves the exact sequence of input files. Multi-page PDFs have all pages imported
 * in sequence; images are converted into individual full-bleed pages.
 *
 * Uses PDFium WASM as the primary engine when available for native speed and fault tolerance,
 * falling back to resilient pdf-lib processing with disabled field appearance generation.
 *
 * @param rawInputs Array of File objects or MergeInputItem objects.
 * @param engine Optional PDFium engine instance.
 * @returns Object containing the merged ArrayBuffer, total page count, and suggested file name.
 */
export async function mergeFilesToPdfBuffer(
  rawInputs: Array<File | MergeInputItem>,
  engine?: PdfiumEngine
): Promise<MergeFilesResult> {
  if (!rawInputs || rawInputs.length === 0) {
    throw new Error('No files provided for merging.');
  }

  const rawItems = await normalizeMergeInputs(rawInputs);

  // Pre-convert any non-PDF, non-image documents to PDF buffers
  const items = await Promise.all(
    rawItems.map(async (item) => {
      if (
        !isPdfFile(item.buffer, item.name) &&
        !isImageFile(item.buffer, item.name) &&
        documentConverter.isConvertible(item.name, item.buffer, item.mimeType)
      ) {
        const converted = await documentConverter.convertDocument({
          name: item.name,
          buffer: item.buffer,
          mimeType: item.mimeType,
        });
        return {
          name: converted.fileName,
          buffer: converted.buffer,
          mimeType: 'application/pdf',
        };
      }
      return item;
    })
  );

  // Determine active PDFium engine
  const activeEngine = engine ?? (typeof window !== 'undefined' ? PdfiumEngine.getInstance() : undefined);

  // Single PDF optimization: pass through without re-encoding
  if (items.length === 1) {
    const single = items[0];
    if (isPdfFile(single.buffer, single.name)) {
      let pageCount = 1;
      if (activeEngine && activeEngine.isReady) {
        const mod = activeEngine.getModule();
        const sourceBytes = new Uint8Array(single.buffer);
        const sourceSize = sourceBytes.byteLength;
        const sourcePtr = activeEngine.allocateMemory(sourceSize);
        try {
          const heapBytes = new Uint8Array(mod.pdfium.HEAPU8.buffer, sourcePtr, sourceSize);
          heapBytes.set(sourceBytes);
          const docHandle = mod.FPDF_LoadMemDocument(sourcePtr, sourceSize, '');
          if (!docHandle) {
            throw new Error(`Failed to parse PDF document "${single.name}".`);
          }
          try {
            pageCount = mod.FPDF_GetPageCount(docHandle);
          } finally {
            mod.FPDF_CloseDocument(docHandle);
          }
        } finally {
          activeEngine.freeMemory(sourcePtr);
        }
      } else {
        const doc = await PDFDocument.load(single.buffer, { ignoreEncryption: true });
        pageCount = doc.getPageCount();
      }
      return {
        buffer: single.buffer,
        pageCount,
        fileName: deriveMergedFileName(items),
      };
    }
  }

  const hasAcroForms = items.some((item) => {
    if (!isPdfFile(item.buffer, item.name)) return false;
    const bytes = item.buffer instanceof Uint8Array ? item.buffer : new Uint8Array(item.buffer);
    const len = Math.min(bytes.byteLength, 1_000_000);
    const text = new TextDecoder('latin1').decode(bytes.subarray(0, len));
    return text.includes('/AcroForm') || text.includes('/Widget');
  });

  // Primary layer: PDFium WASM engine when initialised and no AcroForms present
  if (!hasAcroForms && activeEngine && activeEngine.isReady) {
    try {
      const { data, pageCount } = await mergeDocumentsAndImages(activeEngine, items);
      const buffer = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
      ) as ArrayBuffer;

      return {
        buffer,
        pageCount,
        fileName: deriveMergedFileName(items),
      };
    } catch (engineErr) {
      console.warn('PDFium engine merge encountered an issue, falling back to pdf-lib:', engineErr);
    }
  }

  // Fallback and form preservation layer: Fortified pdf-lib with full AcroForm linking
  return await mergeFilesViaPdfLib(items);
}
