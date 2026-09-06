/**
 * Core type definitions for Optical Character Recognition (OCR) operations.
 */

import type { EditableTextSpan, PageCharacter } from '../../core/types';

/** Bounding box in PDF points (origin at top-left for DOM coordinates). */
export interface OcrBoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Recognized word token within an OCR line. */
export interface OcrWord {
  text: string;
  confidence: number;
  bbox: OcrBoundingBox;
  baselineY: number;
  fontSize: number;
  hasPrecedingSpace?: boolean;
}

/** Recognized line within an OCR block/paragraph. */
export interface OcrLine {
  text: string;
  confidence: number;
  words: OcrWord[];
  bbox: OcrBoundingBox;
  baselineY: number;
  fontSize: number;
  lineHeight?: number;
}

/** Semantic block or paragraph composed of OCR lines. */
export interface OcrBlock {
  lines: OcrLine[];
  bbox: OcrBoundingBox;
  confidence: number;
}

/** Full OCR recognition result for a single PDF page. */
export interface OcrPageResult {
  pageIndex: number;
  text: string;
  blocks: OcrBlock[];
  lines: OcrLine[];
  words: OcrWord[];
  confidence: number;
  widthPts: number;
  heightPts: number;
  language?: string;
  durationMs?: number;
}

/** Progress telemetry callback payload during OCR execution. */
export interface OcrProgressPayload {
  pageIndex: number;
  progress: number;
  status: string;
}

/** Options configuring an OCR recognition task. */
export interface OcrOptions {
  language?: string;
  confidenceThreshold?: number;
  onProgress?: (payload: OcrProgressPayload) => void;
  scale?: number;
}

/** Pluggable OCR engine contract. */
export interface OcrEngine {
  readonly name: string;
  isAvailable(): boolean | Promise<boolean>;
  recognize(
    canvasOrImageData: HTMLCanvasElement | ImageData,
    options?: OcrOptions
  ): Promise<OcrPageResult>;
  terminate?(): Promise<void>;
}

/** Detection metadata indicating whether a page is an image-only scanned page. */
export interface ScannedPageDetection {
  pageIndex: number;
  isScanned: boolean;
  textCharCount: number;
  imageObjectCount: number;
  confidence: number;
  reason: string;
}

/** Converted OCR text spans and character metrics ready for overlay rendering. */
export interface OcrSpanConversion {
  textSpans: EditableTextSpan[];
  characters: PageCharacter[];
}

/** Result of sampling background paper color for text whiteout/replacement. */
export interface SampledBackgroundColor {
  r: number;
  g: number;
  b: number;
  a: number;
  hex: string;
  isLight?: boolean;
}
