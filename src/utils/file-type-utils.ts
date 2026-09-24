/**
 * File type detection and MIME resolution utilities.
 *
 * Lightweight pure functions operating on filenames, buffers, and MIME strings
 * with zero external dependencies.
 */

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

const CONVERTIBLE_EXTENSIONS = new Set([
  'docx', 'doc', 'xlsx', 'xls', 'csv', 'tsv',
  'pptx', 'ppt', 'md', 'markdown', 'txt', 'text',
  'json', 'js', 'ts', 'html', 'xml', 'css',
]);

/**
 * Checks whether an input represents a convertible document by extension or MIME type.
 */
export function isConvertibleDocumentFile(
  input: File | Blob | ArrayBuffer | Uint8Array,
  fileName?: string
): boolean {
  const resolvedName = fileName || ('name' in input && typeof input.name === 'string' ? input.name : '');
  if (resolvedName) {
    const ext = resolvedName.split('.').pop()?.toLowerCase() ?? '';
    if (CONVERTIBLE_EXTENSIONS.has(ext)) {
      return true;
    }
  }
  if ('type' in input && typeof input.type === 'string') {
    const mime = input.type.toLowerCase();
    if (
      mime.includes('officedocument') ||
      mime.includes('word') ||
      mime.includes('excel') ||
      mime.includes('spreadsheet') ||
      mime.includes('powerpoint') ||
      mime.includes('presentation') ||
      mime.startsWith('text/') ||
      mime.includes('json')
    ) {
      return true;
    }
  }
  return false;
}

import type { DocumentFormat } from '../services/conversion/types';

/**
 * Detects the DocumentFormat from file name and optional MIME type without loading heavy converter modules.
 */
export function detectDocumentFormat(
  fileName: string,
  _mimeType?: string
): DocumentFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.tsv')) return 'tsv';
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'pptx';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.txt')) return 'text';
  if (lower.endsWith('.json')) return 'json';
  if (
    lower.endsWith('.xml') ||
    lower.endsWith('.html') ||
    lower.endsWith('.htm') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.log') ||
    lower.endsWith('.js') ||
    lower.endsWith('.ts')
  ) {
    return 'code';
  }
  return 'unknown';
}

