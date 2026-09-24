/**
 * Utility for smart dynamic file extension and MIME type detection.
 *
 * Automatically categorises files imported through the file explorer or dropped
 * onto the canvas, mapping them to appropriate ISO 32000 element types.
 */

import { formatByteSize } from '../services/pdf/operations/metadata-ops';

/**
 * High-level media category detected from file metadata.
 */
export type DetectedMediaCategory =
  | 'image'
  | 'video'
  | 'audio'
  | '3d'
  | 'attachment';

/**
 * Detailed 3D model formats supported by the editor.
 */
export type Model3DFormat = 'u3d' | 'prc' | 'obj' | 'stl' | 'gltf' | 'glb' | '3ds' | 'dae' | 'other';

/**
 * Rich metadata extracted from a detected file.
 */
export interface DetectedFileInfo {
  /** Primary media category. */
  readonly category: DetectedMediaCategory;
  /** Clean lowercase file extension without dot. */
  readonly extension: string;
  /** Standard MIME type string. */
  readonly mimeType: string;
  /** Original file name. */
  readonly fileName: string;
  /** File size in bytes. */
  readonly fileSize: number;
  /** Human-readable formatted file size. */
  readonly formattedSize: string;
  /** Clean title derived from the file name. */
  readonly title: string;
  /** Specific 3D format if category is 3d. */
  readonly modelFormat?: Model3DFormat;
  /** Relevant ISO standard specification reference. */
  readonly isoStandard: string;
  /** Descriptive summary for UI and accessibility. */
  readonly description: string;
}

/** Set of image extensions. */
const IMAGE_EXTENSIONS = new Set<string>([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'svg',
  'ico',
  'tiff',
  'tif',
  'avif',
]);

/** Set of video extensions. */
const VIDEO_EXTENSIONS = new Set<string>([
  'mp4',
  'webm',
  'mov',
  'mkv',
  'avi',
  'm4v',
  'wmv',
  'flv',
  '3gp',
  'ogv',
]);

/** Set of audio extensions. */
const AUDIO_EXTENSIONS = new Set<string>([
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'aac',
  'flac',
  'wma',
  'opus',
  'aiff',
  'mid',
  'midi',
]);

/** Set of 3D model extensions. */
const THREE_D_EXTENSIONS = new Set<string>([
  'u3d',
  'prc',
  'obj',
  'stl',
  'gltf',
  'glb',
  '3ds',
  'dae',
  'fbx',
]);

/**
 * Extracts lowercase file extension from a file name or path.
 *
 * @param fileName The file name or path to inspect.
 * @return Lowercase file extension without leading dot, or empty string.
 */
export function extractFileExtension(fileName: string): string {
  if (!fileName) return '';
  const cleanPath = fileName.split(/[?#]/)[0] ?? '';
  const lastDotIndex = cleanPath.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === cleanPath.length - 1) {
    return '';
  }
  return cleanPath.slice(lastDotIndex + 1).toLowerCase();
}

/**
 * Formats a raw file name into a clean, displayable title.
 *
 * @param fileName The raw file name.
 * @return Formatted title with extension stripped and underscores replaced.
 */
export function formatFileTitle(fileName: string): string {
  if (!fileName) return 'Untitled';
  const clean = fileName.split(/[\\/]/).pop() ?? fileName;
  const lastDot = clean.lastIndexOf('.');
  const baseName = lastDot > 0 ? clean.slice(0, lastDot) : clean;
  return baseName.replace(/[_-]+/g, ' ').trim() || 'Untitled';
}

/**
 * Detects the media category from a file name and optional MIME type.
 *
 * Uses smart cascading heuristics: first checking MIME type, then file extension.
 *
 * @param fileName The file name to evaluate.
 * @param mimeType Optional MIME type provided by the browser or file system.
 * @return Detected media category.
 */
export function detectFileCategory(fileName: string, mimeType?: string): DetectedMediaCategory {
  const ext = extractFileExtension(fileName);
  const normalisedMime = (mimeType || '').toLowerCase().trim();

  // Image detection
  if (normalisedMime.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) {
    return 'image';
  }

  // Video detection
  if (normalisedMime.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) {
    return 'video';
  }

  // Audio detection
  if (normalisedMime.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext)) {
    return 'audio';
  }

  // 3D model detection
  if (
    normalisedMime.startsWith('model/') ||
    normalisedMime.includes('gltf') ||
    THREE_D_EXTENSIONS.has(ext)
  ) {
    return '3d';
  }

  // Attachment fallback for document and data formats
  return 'attachment';
}

/**
 * Maps a file extension or filename to a specific 3D model format.
 *
 * @param extOrFileName Lowercase file extension or filename.
 * @return Identified 3D model format.
 */
export function resolve3DModelFormat(extOrFileName: string): Model3DFormat {
  const ext = extractFileExtension(extOrFileName) || extOrFileName.toLowerCase().trim();
  switch (ext) {
    case 'u3d':
      return 'u3d';
    case 'prc':
      return 'prc';
    case 'obj':
      return 'obj';
    case 'stl':
      return 'stl';
    case 'gltf':
      return 'gltf';
    case 'glb':
      return 'glb';
    case '3ds':
      return '3ds';
    case 'dae':
      return 'dae';
    default:
      return 'other';
  }
}

/**
 * Resolves the relevant ISO standard specification reference for a media category.
 *
 * @param category Detected media category.
 * @return Standard specification clause reference.
 */
export function resolveIsoStandardClause(category: DetectedMediaCategory): string {
  switch (category) {
    case 'image':
      return 'ISO 32000-1 Clause 8.9 (XObject Image Objects)';
    case 'video':
      return 'ISO 32000-1 Clause 13.2 and 13.7 (RichMedia Video Rendition Stream)';
    case 'audio':
      return 'ISO 32000-1 Clause 13.3 and 13.7 (RichMedia Sound Clip Object)';
    case '3d':
      return 'ISO 32000-1 Clause 13.6 (Interactive 3D Stream and Annotation View)';
    case 'attachment':
      return 'ISO 32000-2 Clause 14.13 (Associated Files AF and EmbeddedFiles Stream)';
  }
}

/**
 * Analytically inspects a browser File object and constructs complete detected metadata.
 *
 * @param file The browser File instance to inspect.
 * @return Comprehensive detected file information.
 */
export function inspectFileInfo(file: File): DetectedFileInfo {
  const fileName = file.name || 'unnamed-file';
  const extension = extractFileExtension(fileName);
  const mimeType = file.type || '';
  const category = detectFileCategory(fileName, mimeType);
  const fileSize = file.size || 0;
  const formattedSize = formatByteSize(fileSize);
  const title = formatFileTitle(fileName);
  const isoStandard = resolveIsoStandardClause(category);

  let modelFormat: Model3DFormat | undefined = undefined;
  if (category === '3d') {
    modelFormat = resolve3DModelFormat(extension);
  }

  let description = `${title} (${formattedSize})`;
  if (category === 'video') {
    description = `Embedded Video: ${fileName} (${formattedSize})`;
  } else if (category === 'audio') {
    description = `Embedded Audio: ${fileName} (${formattedSize})`;
  } else if (category === '3d') {
    description = `3D Artwork (${(modelFormat || 'model').toUpperCase()}): ${fileName} (${formattedSize})`;
  } else if (category === 'attachment') {
    description = `Attached File: ${fileName} (${formattedSize})`;
  }

  return {
    category,
    extension,
    mimeType,
    fileName,
    fileSize,
    formattedSize,
    title,
    modelFormat,
    isoStandard,
    description,
  };
}

/**
 * Returns standard file explorer accept attribute strings for each media category.
 *
 * @param category The media category.
 * @return Comma-separated list of MIME types and extensions for HTML input accept.
 */
export function getAcceptFilterForCategory(category: DetectedMediaCategory): string {
  switch (category) {
    case 'image':
      return 'image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.ico,.tiff';
    case 'video':
      return 'video/*,.mp4,.webm,.mov,.mkv,.avi,.m4v';
    case 'audio':
      return 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.wma';
    case '3d':
      return '.u3d,.prc,.obj,.stl,.gltf,.glb,.3ds,.dae,model/*';
    case 'attachment':
      return '*/*';
  }
}
