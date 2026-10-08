/**
 * Core type definitions for PDFium application state and options.
 */

export interface DocumentInfo {
  name: string;
  sizeBytes: number;
  pageCount: number;
  pdfVersion: string;
  isEncrypted: boolean;
  permissions: number;
}

/**
 * A single metadata key-value entry discovered dynamically in the PDF document.
 */
export interface MetadataEntry {
  /** The clean property key name (e.g. Title, Author, Company, CustomKey). */
  key: string;
  /** The raw dictionary key string as encoded in the PDF (e.g. /Title, /Company). */
  rawKey: string;
  /** The decoded text value. */
  value: string;
  /** Whether this is one of the standard PDF Info dictionary keys. */
  isStandard: boolean;
  /** Formatted human-readable representation for dates or enum states if applicable. */
  formattedValue?: string;
}

export interface DocumentMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  creationDate: string;
  modDate: string;
  trappedStatus: number;
  /** Trapped status string: 'True', 'False', or 'Unknown'. */
  trapped?: string;
  /** Parsed keywords array split by comma/semicolon/space. */
  keywordsArray?: string[];
  /** Parsed and formatted creation date string. */
  creationDateFormatted?: string;
  /** Parsed and formatted modification date string. */
  modDateFormatted?: string;
  /** Map of all custom (non-standard) metadata key-value pairs. */
  customMetadata?: Record<string, string>;
  /** Complete list of all metadata entries dynamically found in the document. */
  allEntries?: MetadataEntry[];
  /** Document PDF specification version string (e.g. '1.7'). */
  pdfVersion?: string;
  /** Total page count. */
  pageCount?: number;
  /** Physical file size in bytes. */
  sizeBytes?: number;
  /** Formatted file size string (e.g. '245.2 KB'). */
  sizeFormatted?: string;
  /** Whether the document is encrypted or password-protected. */
  isEncrypted?: boolean;
  /** Document permission bitflags. */
  permissions?: number;
  /** Total digital signatures count. */
  signaturesCount?: number;
  /** Cryptographic and standards compliance validation results for all signatures. */
  signatureValidationResults?: import('../services/pdf/operations/signature-ops').SignatureValidationResult[];
  /** Total embedded file attachments count. */
  attachmentsCount?: number;
  /** Whether an XMP metadata XML stream exists in the document catalog. */
  hasXmp?: boolean;
  /** Raw XMP metadata XML string if present. */
  xmpString?: string;
}

/**
 * Payload options for updating PDF document metadata tags and custom fields.
 */
export interface DocumentMetadataUpdate {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modDate?: string;
  customMetadata?: Record<string, string>;
  removeKeys?: string[];
}

export interface PageSizeInfo {
  pageIndex: number;
  widthPoints: number;
  heightPoints: number;
  rotationDegrees: number;
}

export interface RenderOptions {
  pageIndex: number;
  scale: number;
  dpi: number;
  rotation: 0 | 90 | 180 | 270;
  renderAnnotations: boolean;
  clearColorHex: string;
}

export interface RenderResult {
  widthPx: number;
  heightPx: number;
  canvas: HTMLCanvasElement;
  renderTimeMs: number;
}

export interface TextCharacterInfo {
  charIndex: number;
  unicodeChar: string;
  fontName: string;
  fontSize: number;
  fontWeight: number;
  originX: number;
  originY: number;
  bbox: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

/**
 * Individual character bounds and layout metrics on a PDF page.
 */
export interface PageCharacter {
  /** Zero-based character index in the text page stream. */
  charIndex: number;
  /** Character string representation. */
  unicode: string;
  /** Font size in points. */
  fontSize: number;
  /** Left coordinate in PDF space. */
  left: number;
  /** Top coordinate in PDF space. */
  top: number;
  /** Right coordinate in PDF space. */
  right: number;
  /** Bottom coordinate in PDF space. */
  bottom: number;
  /** Character origin X in PDF space. */
  originX: number;
  /** Character origin Y in PDF space. */
  originY: number;
  /** Left coordinate in DOM points. */
  domLeft: number;
  /** Top coordinate in DOM points. */
  domTop: number;
  /** Right coordinate in DOM points. */
  domRight: number;
  /** Bottom coordinate in DOM points. */
  domBottom: number;
  /** Baseline Y coordinate in DOM points. */
  domBaseline: number;
  /** Rotation angle in degrees [0, 360). */
  angle?: number;
  /** Normalized rotation in 90-degree steps (0, 90, 180, 270). */
  rotation?: number;
  /** Whether character orientation is vertical. */
  isVertical?: boolean;
  /** High-level text flow orientation. */
  orientation?: 'horizontal' | 'vertical';
  /** Whether character was recognized via OCR. */
  isOcr?: boolean;
}

/**
 * Bounding rectangle for text highlight shapes in DOM coordinates.
 */
export interface HighlightRect {
  /** Horizontal position coordinate. */
  x: number;
  /** Vertical position coordinate. */
  y: number;
  /** Box width in points. */
  width: number;
  /** Box height in points. */
  height: number;
  /** Vertical baseline position in DOM coordinates for underline calibration. */
  baselineY?: number;
}

export interface PageTextResult {
  pageIndex: number;
  totalChars: number;
  extractedText: string;
  characters: TextCharacterInfo[];
}

export interface SearchMatch {
  matchIndex: number;
  pageIndex: number;
  charIndex: number;
  length: number;
  matchedText: string;
}

export interface AnnotationItem {
  index: number;
  subtype: string;
  rect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  contents: string;
}

export interface OutlineNode {
  title: string;
  pageIndex: number | null;
  children: OutlineNode[];
}

export interface ColorRgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * PDF transformation matrix with 6 components.
 * Maps to FS_MATRIX struct: [a, b, c, d, e, f] where
 * a/d = scale, b/c = skew/rotation, e/f = translation.
 */
export interface PdfMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * The 14 standard PDF Type 1 font names supported by FPDFText_LoadStandardFont.
 */
export type StandardFontName =
  | 'Courier'
  | 'Courier-Bold'
  | 'Courier-Oblique'
  | 'Courier-BoldOblique'
  | 'Helvetica'
  | 'Helvetica-Bold'
  | 'Helvetica-Oblique'
  | 'Helvetica-BoldOblique'
  | 'Times-Roman'
  | 'Times-Bold'
  | 'Times-Italic'
  | 'Times-BoldItalic'
  | 'Symbol'
  | 'ZapfDingbats';

export interface TextWord {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  fontSize: number;
  baselineY: number;
  charStartIndex: number;
  charCount: number;
  charIndices?: number[];
  fontFamily?: string;
  rawFontFamily?: string;
  matchedFontFamily?: string;
  color?: ColorRgba;
  fontWeight?: string;
  fontStyle?: string;
  underline?: boolean;
  strikethrough?: boolean;
  backgroundColor?: string;
  angle?: number;
  rotation?: number;
  isVertical?: boolean;
  orientation?: 'horizontal' | 'vertical';
  hasPrecedingSpace?: boolean;
  domBaseline?: number;
  letterSpacing?: string;
  letterSpacingPts?: number;
  scaleX?: number;
}

export interface TextLine {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  fontSize: number;
  baselineY: number;
  domBaseline?: number;
  lineHeight: number;
  charStartIndex: number;
  charCount: number;
  words: TextWord[];
  fontFamily?: string;
  rawFontFamily?: string;
  matchedFontFamily?: string;
  color?: ColorRgba;
  fontWeight?: string;
  fontStyle?: string;
  hasBulletPrefix?: boolean;
  bulletWord?: TextWord;
  angle?: number;
  rotation?: number;
  isVertical?: boolean;
  orientation?: 'horizontal' | 'vertical';
  backgroundColor?: string;
  underline?: boolean;
  strikethrough?: boolean;
  letterSpacing?: string;
  letterSpacingPts?: number;
  wordSpacing?: number;
  scaleX?: number;
}

export interface EditableTextSpan {
  type: 'text';
  id: string;
  pageIndex: number;

  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  rawFontFamily: string;
  matchedFontFamily?: string;
  color: ColorRgba;
  baselineY: number;
  domBaseline?: number;
  charStartIndex: number;
  charCount: number;

  lines?: TextLine[];
  lineHeight?: number;
  letterSpacing?: string;
  letterSpacingPts?: number;
  wordSpacing?: number;
  scaleX?: number;
  isParagraph?: boolean;
  fontWeight?: string;
  fontStyle?: string;
  underline?: boolean;
  strikethrough?: boolean;
  backgroundColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  originalLeft?: number;
  hasBulletPrefix?: boolean;
  bulletWord?: TextWord;
  rotation?: number;
  isVertical?: boolean;
  orientation?: 'horizontal' | 'vertical';
  /** Whether span was recognized via OCR from a scanned document. */
  isOcr?: boolean;
  /** OCR recognition confidence score (0-100). */
  ocrConfidence?: number;
  zIndex?: number;
  /** Whether this span represents an isolated single word in precise selection mode. */
  isWordSpan?: boolean;
}

export interface EditableImageSpan {
  type: 'image';
  id: string;
  pageIndex: number;

  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  src: string; // Base64 data URL
  pdfObjectIndex: number;
  pdfAnnotIndex?: number;
  annotSubtype?: string;
  zIndex?: number;
}

export type ShapeVariantType = 'rectangle' | 'circle' | 'line' | 'arrow' | 'path';

export interface EditableShapeSpan {
  type: 'shape';
  id: string;
  pageIndex: number;

  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  fill: string; // CSS colour string or 'transparent'
  stroke?: string; // CSS colour string or 'transparent'
  strokeWidth?: number;
  variant?: ShapeVariantType;
  opacity?: number;
  isHighlight?: boolean;
  svgPath?: string;
  hasFill?: boolean;
  hasStroke?: boolean;
  fillMode?: number;
  strokeLineCap?: 'butt' | 'round' | 'square';
  strokeLineJoin?: 'miter' | 'round' | 'bevel';
  viewBox?: string;
  baseWidth?: number;
  baseHeight?: number;
  fillRule?: 'nonzero' | 'evenodd';
  pdfObjectIndex: number;
  pdfAnnotIndex?: number;
  annotSubtype?: string;
  zIndex?: number;
}

export type FormFieldVariantType = 'text-input' | 'checkbox' | 'radio' | 'dropdown' | 'signature' | 'attachment' | 'button';

export interface EditableFormFieldSpan {
  type: 'form-field';
  id: string;
  pageIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
  rotation?: number;
  name?: string;
  fieldId?: string;
  fieldName?: string;
  variant: FormFieldVariantType;
  value?: string | boolean;
  label?: string;
  placeholder?: string;
  readOnly?: boolean;
  required?: boolean;
  options?: string[];
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none' | 'inset' | 'underline';
  borderRadius?: number;
  textAlign?: 'left' | 'center' | 'right';
  password?: boolean;
  multiline?: boolean;
  exportValue?: string;
  tooltip?: string;
  maxLength?: number;
  isComb?: boolean;
  combCellCount?: number;
  doNotSpellCheck?: boolean;
  doNotScroll?: boolean;
  formatType?: string;
  zIndex?: number;
}

export type EditableSpan = EditableTextSpan | EditableImageSpan | EditableShapeSpan | EditableFormFieldSpan;

export interface TextMutationOptions {
  text: string;
  fontSize?: number;
  fontFamily?: string;
  rawFontFamily?: string;
  color?: ColorRgba;
  left?: number;
  top?: number;
  lineHeight?: number;
  letterSpacing?: string;
  wordSpacing?: number;
  scaleX?: number;
  reflowParagraph?: boolean;
  fontWeight?: string;
  fontStyle?: string;
  underline?: boolean;
  strikethrough?: boolean;
  backgroundColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  lines?: TextLine[];
  forceTextRestore?: boolean;
}

export type AppInteractionMode = 'canvas' | 'organize' | 'select' | 'text-edit';

/** Options controlling which sensitive and non-essential items to purge. */
export interface SanitizeOptions {
  /** Remove standard document Info dictionary entries (Author, Title, Creator, Producer, etc.). */
  removeMetadata: boolean;
  /** Remove embedded XMP metadata packets. */
  removeXmpMetadata: boolean;
  /** Remove embedded file attachments and associated file streams. */
  removeAttachments: boolean;
  /** Remove document-level, page-level, and object-level JavaScript and launch actions. */
  removeJavascript: boolean;
  /** Remove annotations (comments, highlights, freehand inks, stamps, popups, etc.). */
  removeAnnotations: boolean;
  /** Remove web hyperlinks, GoTo actions, and remote URLs. */
  removeLinks: boolean;
  /** Remove interactive form fields and AcroForm widget structures. */
  removeFormFields: boolean;
  /** Remove document outline / bookmarks table of contents. */
  removeBookmarks: boolean;
  /** Remove private application data dictionaries (Photoshop/Illustrator PieceInfo). */
  removePieceInfo: boolean;
  /** Remove embedded page thumbnail images. */
  removeThumbnails: boolean;
  /** Remove structural accessibility tags and markup info (StructTreeRoot / MarkInfo). */
  removeStructTree: boolean;
}

/** Summary of purged items returned after sanitization. */
export interface SanitizeSummary {
  metadataCleared: boolean;
  xmpCleared: boolean;
  attachmentsRemoved: number;
  javascriptActionsRemoved: number;
  annotationsRemoved: number;
  linksRemoved: number;
  formFieldsRemoved: number;
  bookmarksRemoved: boolean;
  pieceInfoRemoved: number;
  thumbnailsRemoved: number;
  structTreeRemoved: boolean;
}

/** Detailed inspection results of sensitive/hidden items present in the document. */
export interface SanitizationInspection {
  metadataCount: number;
  metadataKeys: string[];
  hasXmpMetadata: boolean;
  attachmentCount: number;
  hasJavascript: boolean;
  annotationCount: number;
  linkCount: number;
  formFieldCount: number;
  bookmarkCount: number;
  hasPieceInfo: boolean;
  thumbnailCount: number;
  hasStructTree: boolean;
}

/** Preset configurations for document sanitization. */
export type SanitizePreset = 'maximum' | 'metadata_only' | 'clean_presentation' | 'custom';

/** Compression preset levels. */
export type CompressionLevel = 'lossless' | 'recommended' | 'strong' | 'flat_image' | 'custom';

/** Custom image re-encoder processor for tests and custom pipelines. */
export interface CompressImageProcessor {
  recompressJpeg(
    imageBytes: Uint8Array,
    width: number,
    height: number,
    targetWidth: number,
    targetHeight: number,
    quality: number
  ): Promise<Uint8Array | null>;
}

/** Page rasterizer delegate for flat-image compression. */
export type PageRasterizer = (
  pageIndex: number,
  scale: number,
  quality: number
) => Promise<{ bytes: Uint8Array; widthPts: number; heightPts: number }>;

/** Options controlling document compression. */
export interface CompressOptions {
  level: CompressionLevel;
  imageQuality?: number;
  maxDpi?: number;
  useObjectStreams?: boolean;
  removeThumbnails?: boolean;
  removeMetadata?: boolean;
  removePieceInfo?: boolean;
  removeAnnotations?: boolean;
  imageProcessor?: CompressImageProcessor;
}

/** Summary of compression operations and savings. */
export interface CompressSummary {
  originalSizeBytes: number;
  compressedSizeBytes: number;
  savingsBytes: number;
  savingsPercentage: number;
  imageCount: number;
  imagesCompressed: number;
  pagesRasterized: number;
  thumbnailsRemoved: number;
  pieceInfoRemoved: number;
  metadataStripped: boolean;
  objectStreamsUsed: boolean;
}

/**
 * Image metadata gathered during document compression inspection.
 */
export interface ImageInspectionRecord {
  width: number;
  height: number;
  byteLength: number;
  filter: string;
  colorSpace?: string;
  hasMask?: boolean;
}

/**
 * Page boundary dimensions in PDF user points.
 */
export interface PageDimensionRecord {
  width: number;
  height: number;
}

/**
 * Breakdown of estimated savings across individual compression facets.
 */
export interface CompressionSavingsBreakdown {
  thumbnails: number;
  pieceInfo: number;
  metadata: number;
  objectStreams: number;
  images: number;
  rasterisation?: number;
}

/**
 * Structured compression estimate output.
 */
export interface CompressionEstimate {
  originalSizeBytes: number;
  estimatedSizeBytes: number;
  estimatedSavingsBytes: number;
  estimatedSavingsPercentage: number;
  breakdown: CompressionSavingsBreakdown;
  isMonotonicallyClamped: boolean;
}

/** Detailed inspection results of compressibility in the document. */
export interface CompressionInspection {
  originalSizeBytes: number;
  pageCount: number;
  imageCount: number;
  totalImageBytes: number;
  hasThumbnails: boolean;
  thumbnailCount: number;
  hasPieceInfo: boolean;
  hasXmpMetadata: boolean;
  jpegImageCount?: number;
  jpegImageBytes?: number;
  totalStreamBytes?: number;
  structuralBytes?: number;
  hasObjectStreams?: boolean;
  thumbnailBytes?: number;
  metadataBytes?: number;
  pieceInfoBytes?: number;
  images?: ImageInspectionRecord[];
  pageDimensions?: PageDimensionRecord[];
}

/**
 * Metrics and boundaries for a page CropBox and rotation in PDF and DOM coordinates.
 */
export interface PageCropInfo {
  cropLeft: number;
  cropBottom: number;
  cropRight: number;
  cropTop: number;
  cropWidth: number;
  cropHeight: number;
  rotation: 0 | 1 | 2 | 3;
  hasCrop: boolean;
  hasCropBox?: boolean;
  domCropLeft?: number;
  domCropTop?: number;
  marginLeft?: number;
  marginBottom?: number;
  marginRight?: number;
  marginTop?: number;
}

export type {
  SignatureValidationResult,
  ComplianceCheckStatus,
  SignatureComplianceCheck,
  EsigaComplianceReport,
} from '../services/pdf/operations/signature-ops';

export type {
  ColorAdjustmentOptions,
  ColorAdjustmentPreset,
  ColorAdjustmentScope,
  ColorAdjustmentResult,
} from '../services/pdf/operations/color-adjustment-ops';

