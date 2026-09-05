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

/**
 * Checks whether an input represents a PDF by extension, MIME type, or magic bytes.
 */
export function isPdfFile(
  input: File | Blob | ArrayBuffer | Uint8Array,
  fileName?: string
): boolean {
  if (fileName && fileName.toLowerCase().endsWith('.pdf')) {
    return true;
  }

  if ('type' in input && typeof input.type === 'string') {
    if (input.type === 'application/pdf') {
      return true;
    }
  }

  const bytes = input instanceof Uint8Array
    ? input
    : input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : null;

  if (bytes && bytes.length >= 5) {
    const searchLimit = Math.min(bytes.length - 4, 1024);
    for (let i = 0; i < searchLimit; i++) {
      if (
        bytes[i] === 0x25 &&     // %
        bytes[i + 1] === 0x50 && // P
        bytes[i + 2] === 0x44 && // D
        bytes[i + 3] === 0x46 && // F
        bytes[i + 4] === 0x2d    // -
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks whether an input represents an image by MIME type, extension, or magic bytes.
 */
export function isImageFile(
  input: File | Blob | ArrayBuffer | Uint8Array,
  fileName?: string
): boolean {
  if (fileName) {
    const lower = fileName.toLowerCase();
    if (
      lower.endsWith('.png') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.webp') ||
      lower.endsWith('.gif') ||
      lower.endsWith('.bmp') ||
      lower.endsWith('.svg') ||
      lower.endsWith('.avif')
    ) {
      return true;
    }
  }

  if ('type' in input && typeof input.type === 'string') {
    if (input.type.startsWith('image/')) {
      return true;
    }
  }

  const bytes = input instanceof Uint8Array
    ? input
    : input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : null;

  if (bytes && bytes.length >= 4) {
    // PNG signature: 0x89 0x50 0x4E 0x47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return true;
    }
    // JPEG signature: 0xFF 0xD8 0xFF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return true;
    }
    // GIF signature: 'GIF8'
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return true;
    }
    // BMP signature: 'BM'
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return true;
    }
    // WebP signature: 'RIFF' .... 'WEBP'
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return true;
      }
    }
  }

  return false;
}

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
 * Resolves an image MIME type from a file name extension.
 */
export function inferImageMimeType(fileName?: string): string {
  if (!fileName) return 'application/octet-stream';
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.avif')) return 'image/avif';
  return 'application/octet-stream';
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
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: resolvedMime });
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

