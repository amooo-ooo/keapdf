/**
 * Page numbering, Bates numbering, and running header/footer operations.
 *
 * Provides pure formatting, page range and parity filtering, anchor coordinate
 * placement, and PDFium vector text burning across document pages.
 */

import type { PdfiumEngine, ExtendedWrappedPdfiumModule } from '../../../core/pdfium-engine';
import { withPageHandle } from '../../../core/pdfium-helpers';
import { calculateTrackedTextWidth } from '../../../core/typography-metrics';
import { parsePageRangeStrict } from '../../../utils/page-range';
import { parseColor, sanitizePdfText } from '../utils';
import { drawText, resolveStandardFont } from './draw-text';
import { getDimensions } from './page-ops';
import type { TextOptions } from './types';
import type { FontCharsetIndex } from '../font-charset-index';

/** Supported numbering and stamping modes. */
export type NumberingMode = 'page-numbers' | 'bates' | 'header-footer';

/** Six-point page margin anchor grid positions. */
export type NumberingPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/** Standard and custom page numbering format presets. */
export type PageNumberFormat =
  | 'number'
  | 'page-x'
  | 'page-x-of-y'
  | 'x-slash-y'
  | 'roman-lower'
  | 'roman-upper'
  | 'alpha-lower'
  | 'alpha-upper'
  | 'custom';

/** Target page selection scope. */
export type NumberingScope = 'all' | 'current' | 'selected' | 'custom';

/** Page parity filter based on 1-indexed human page numbers. */
export type PageParityFilter = 'all' | 'odd' | 'even';

/** Configuration parameters for page numbering, Bates numbering, and headers/footers. */
export interface PageNumberingOptions {
  /** Active numbering mode. */
  mode: NumberingMode;
  /** Target page scope. */
  scope: NumberingScope;
  /** Zero-based current page index when scope is 'current'. */
  currentPageIndex?: number;
  /** Zero-based selected page indices when scope is 'selected'. */
  pageIndices?: number[];
  /** Custom 1-based page range string when scope is 'custom'. */
  customRange?: string;
  /** Odd or even 1-based page parity filter. */
  parity: PageParityFilter;
  /** Whether to omit page 1 (cover page, index 0) from stamping. */
  skipFirstPage: boolean;
  /** Anchor position on the page. */
  position: NumberingPosition;
  /** Horizontal margin inset in points from left or right page edge. */
  marginX: number;
  /** Vertical margin inset in points from top or bottom page edge. */
  marginY: number;
  /** Font family name ('Helvetica', 'Times-Roman', 'Courier'). */
  fontFamily: string;
  /** Font size in points. */
  fontSize: number;
  /** Font weight ('normal' | 'bold'). */
  fontWeight: 'normal' | 'bold';
  /** Font style ('normal' | 'italic'). */
  fontStyle: 'normal' | 'italic';
  /** Text colour in hex format (e.g. '#000000'). */
  color: string;
  /** Text opacity percentage from 10 to 100. */
  opacity: number;
  /** Page numbering format preset when mode is 'page-numbers'. */
  format: PageNumberFormat;
  /** Starting logical page number (default 1). */
  startPageNumber: number;
  /** Whether logical page numbering tracks physical page index rather than stamped sequence index. */
  countSkippedPages: boolean;
  /** Custom token template when format is 'custom'. */
  customTemplate: string;
  /** Bates prefix string prepended to the padded sequence number. */
  batesPrefix: string;
  /** Bates suffix string appended to the padded sequence number. */
  batesSuffix: string;
  /** Starting Bates sequence number (default 1). */
  batesStartNumber: number;
  /** Zero-padding digit count for Bates numbers (1 to 12, default 6). */
  batesDigits: number;
  /** Numeric step increment between consecutive Bates numbers (default 1). */
  batesIncrement: number;
  /** Optional template combining {bates} with {page}, {total}, {date}, or {file}. */
  batesTemplate: string;
  /** Running header or footer template text when mode is 'header-footer'. */
  headerFooterText: string;
}

/** Context supplied when evaluating dynamic numbering tokens for a specific page. */
export interface NumberingFormatContext {
  /** Zero-based physical page index in the document. */
  pageIndex: number;
  /** Zero-based sequential index among the filtered target pages. */
  sequenceIndex: number;
  /** Total count of filtered target pages being stamped. */
  totalTargetPages: number;
  /** Total count of pages in the entire document. */
  totalDocumentPages: number;
  /** Optional ISO or localised date string for {date} token substitution. */
  dateStr?: string;
  /** Optional document file name for {file} token substitution. */
  fileName?: string;
}

/** Metadata returned after burning numbering across document pages. */
export interface PageNumberingResult {
  /** Number of pages stamped. */
  stampedPageCount: number;
  /** Zero-based page indices that received stamps. */
  stampedPageIndices: number[];
  /** Resolved text labels burned onto each target page in order. */
  labels: string[];
}

/**
 * Return default options initialised for the requested numbering mode.
 *
 * @param mode Initial numbering mode ('page-numbers' | 'bates' | 'header-footer').
 * @return Default configuration object.
 */
export function getDefaultPageNumberingOptions(
  mode: NumberingMode = 'page-numbers'
): PageNumberingOptions {
  return {
    mode,
    scope: 'all',
    currentPageIndex: 0,
    pageIndices: [],
    customRange: '',
    parity: 'all',
    skipFirstPage: false,
    position:
      mode === 'bates'
        ? 'bottom-right'
        : mode === 'header-footer'
          ? 'top-center'
          : 'bottom-center',
    marginX: 36,
    marginY: 28,
    fontFamily: mode === 'bates' ? 'Courier' : 'Helvetica',
    fontSize: 10,
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#000000',
    opacity: 100,
    format: 'page-x-of-y',
    startPageNumber: 1,
    countSkippedPages: false,
    customTemplate: 'Page {page} of {total}',
    batesPrefix: 'DOC-',
    batesSuffix: '',
    batesStartNumber: 1,
    batesDigits: 6,
    batesIncrement: 1,
    batesTemplate: '{bates}',
    headerFooterText: '{file} - {date}',
  };
}

/**
 * Convert a positive integer into a Roman numeral string.
 *
 * @param num Positive integer value to convert.
 * @param uppercase Whether to return uppercase Roman numerals.
 * @return Formatted Roman numeral string.
 */
export function toRomanNumeral(num: number, uppercase: boolean = false): string {
  const clamped = Math.max(1, Math.min(3999, Math.floor(num)));
  const pairs: ReadonlyArray<readonly [number, string]> = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];

  let remaining = clamped;
  let result = '';
  for (const [value, numeral] of pairs) {
    while (remaining >= value) {
      result += numeral;
      remaining -= value;
    }
  }
  return uppercase ? result.toUpperCase() : result;
}

/**
 * Convert a positive 1-based integer into a base-26 alphabetic sequence ('a'..'z', 'aa'..'zz').
 *
 * @param num Positive 1-based integer value.
 * @param uppercase Whether to emit uppercase letters.
 * @return Alphabetic label string.
 */
export function toAlphabeticLabel(num: number, uppercase: boolean = false): string {
  let n = Math.max(1, Math.floor(num));
  let result = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(97 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return uppercase ? result.toUpperCase() : result;
}

/**
 * Format a single Bates identifier for a given 0-based sequence index.
 *
 * @param sequenceIndex Zero-based index in the stamped page sequence.
 * @param options Bates configuration properties.
 * @return Formatted Bates string with prefix, zero-padded number, and suffix.
 */
export function formatBatesValue(
  sequenceIndex: number,
  options: Pick<
    PageNumberingOptions,
    'batesPrefix' | 'batesSuffix' | 'batesStartNumber' | 'batesDigits' | 'batesIncrement'
  >
): string {
  const start = Math.max(0, Math.floor(options.batesStartNumber));
  const step = Math.max(1, Math.floor(options.batesIncrement));
  const digits = Math.max(1, Math.min(12, Math.floor(options.batesDigits)));
  const numericValue = start + Math.max(0, sequenceIndex) * step;
  const padded = String(numericValue).padStart(digits, '0');
  return `${options.batesPrefix || ''}${padded}${options.batesSuffix || ''}`;
}

/**
 * Substitute dynamic template tokens ({page}, {total}, {bates}, {roman}, {ROMAN}, {alpha}, {ALPHA}, {date}, {file}).
 *
 * @param template Raw template string containing brace tokens.
 * @param tokens Token key-value lookup table.
 * @return Resolved text string.
 */
function substituteTemplateTokens(
  template: string,
  tokens: {
    page: string;
    total: string;
    bates: string;
    roman: string;
    ROMAN: string;
    alpha: string;
    ALPHA: string;
    date: string;
    file: string;
  }
): string {
  return template
    .replace(/\{page\}/g, tokens.page)
    .replace(/\{total\}/g, tokens.total)
    .replace(/\{bates\}/g, tokens.bates)
    .replace(/\{roman\}/g, tokens.roman)
    .replace(/\{ROMAN\}/g, tokens.ROMAN)
    .replace(/\{alpha\}/g, tokens.alpha)
    .replace(/\{ALPHA\}/g, tokens.ALPHA)
    .replace(/\{date\}/g, tokens.date)
    .replace(/\{file\}/g, tokens.file);
}

/**
 * Format the final numbering or header/footer label for a specific page.
 *
 * @param options Page numbering and Bates configuration.
 * @param context Page and document sequence context.
 * @return Formatted label string to draw on the page.
 */
export function formatNumberingText(
  options: PageNumberingOptions,
  context: NumberingFormatContext
): string {
  const startNum = Math.max(1, Math.floor(options.startPageNumber || 1));
  const offset = options.countSkippedPages ? context.pageIndex : context.sequenceIndex;
  const logicalPage = startNum + Math.max(0, offset);
  const logicalTotal = options.countSkippedPages
    ? Math.max(1, context.totalDocumentPages + startNum - 1)
    : Math.max(1, context.totalTargetPages + startNum - 1);

  const batesStr = formatBatesValue(context.sequenceIndex, options);
  const dateStr = context.dateStr || new Date().toISOString().slice(0, 10);
  const fileStr = (context.fileName || 'Document').replace(/\.pdf$/i, '');

  const tokens = {
    page: String(logicalPage),
    total: String(logicalTotal),
    bates: batesStr,
    roman: toRomanNumeral(logicalPage, false),
    ROMAN: toRomanNumeral(logicalPage, true),
    alpha: toAlphabeticLabel(logicalPage, false),
    ALPHA: toAlphabeticLabel(logicalPage, true),
    date: dateStr,
    file: context.fileName || fileStr,
  };

  if (options.mode === 'bates') {
    const tpl = (options.batesTemplate || '{bates}').trim() || '{bates}';
    return substituteTemplateTokens(tpl, tokens);
  }

  if (options.mode === 'header-footer') {
    const tpl = options.headerFooterText ?? '';
    return substituteTemplateTokens(tpl, tokens);
  }

  switch (options.format) {
    case 'number':
      return tokens.page;
    case 'page-x':
      return `Page ${tokens.page}`;
    case 'page-x-of-y':
      return `Page ${tokens.page} of ${tokens.total}`;
    case 'x-slash-y':
      return `${tokens.page} / ${tokens.total}`;
    case 'roman-lower':
      return tokens.roman;
    case 'roman-upper':
      return tokens.ROMAN;
    case 'alpha-lower':
      return tokens.alpha;
    case 'alpha-upper':
      return tokens.ALPHA;
    case 'custom':
    default: {
      const customTpl = (options.customTemplate || 'Page {page} of {total}').trim();
      return substituteTemplateTokens(customTpl || '{page}', tokens);
    }
  }
}

/**
 * Resolve the sorted, deduplicated list of 0-based page indices to stamp.
 *
 * @param options Page numbering configuration containing scope, parity, and skipFirstPage.
 * @param totalDocumentPages Total number of pages in the active document.
 * @return Sorted array of 0-based page indices.
 */
export function resolveTargetPageIndices(
  options: PageNumberingOptions,
  totalDocumentPages: number
): number[] {
  if (totalDocumentPages <= 0) {
    return [];
  }

  let baseIndices: number[] = [];

  if (options.scope === 'all') {
    baseIndices = Array.from({ length: totalDocumentPages }, (_, i) => i);
  } else if (options.scope === 'current') {
    const current = options.currentPageIndex ?? 0;
    if (current >= 0 && current < totalDocumentPages) {
      baseIndices = [current];
    }
  } else if (options.scope === 'selected') {
    const raw = options.pageIndices ?? [];
    baseIndices = Array.from(
      new Set(raw.filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < totalDocumentPages))
    ).sort((a, b) => a - b);
  } else if (options.scope === 'custom') {
    const rangeInput = (options.customRange ?? '').trim();
    if (!rangeInput) {
      throw new Error('Please enter a valid page range (e.g. 1-5, 8).');
    }
    baseIndices = parsePageRangeStrict(rangeInput, totalDocumentPages);
  }

  return baseIndices.filter((pageIndex) => {
    if (options.skipFirstPage && pageIndex === 0) {
      return false;
    }
    const humanPageNumber = pageIndex + 1;
    if (options.parity === 'odd' && humanPageNumber % 2 === 0) {
      return false;
    }
    if (options.parity === 'even' && humanPageNumber % 2 !== 0) {
      return false;
    }
    return true;
  });
}

/**
 * Combine a hex colour string and an opacity percentage (10..100) into a hex colour string.
 *
 * @param color Hex colour string (e.g. '#000000').
 * @param opacity Opacity percentage between 10 and 100.
 * @return 6-digit hex string when fully opaque, or 8-digit '#RRGGBBAA' string when translucent.
 */
export function resolveColorWithOpacity(color: string, opacity: number): string {
  const parsed = parseColor(color || '#000000');
  const clampedOpacity = Math.max(0, Math.min(100, opacity ?? 100));
  const rHex = parsed.r.toString(16).padStart(2, '0');
  const gHex = parsed.g.toString(16).padStart(2, '0');
  const bHex = parsed.b.toString(16).padStart(2, '0');

  if (clampedOpacity >= 100 && parsed.a >= 255) {
    return `#${rHex}${gHex}${bHex}`;
  }

  const effectiveAlpha = Math.round((parsed.a * clampedOpacity) / 100);
  const aHex = Math.max(0, Math.min(255, effectiveAlpha))
    .toString(16)
    .padStart(2, '0');
  return `#${rHex}${gHex}${bHex}${aHex}`;
}

/**
 * Compute the DOM-coordinate `TextOptions` placement for a given page dimension and anchor position.
 *
 * @param text Formatted label string to place.
 * @param pageWidthPts Page width in PDF points.
 * @param pageHeightPts Page height in PDF points.
 * @param options Page numbering configuration.
 * @return Complete `TextOptions` ready for `drawText`.
 */
export function computeNumberingPlacement(
  text: string,
  pageWidthPts: number,
  pageHeightPts: number,
  options: PageNumberingOptions
): TextOptions {
  const cleanText = sanitizePdfText(text);
  const fontSize = Math.max(6, Math.min(72, options.fontSize || 10));
  const standardFont = resolveStandardFont(
    options.fontFamily,
    undefined,
    options.fontWeight,
    options.fontStyle
  );

  const textWidth = Math.max(
    fontSize * 0.5,
    calculateTrackedTextWidth(cleanText, fontSize, standardFont)
  );
  const textHeight = fontSize * 1.25;

  const marginX = Math.max(0, options.marginX ?? 36);
  const marginY = Math.max(0, options.marginY ?? 28);

  const isTop = options.position.startsWith('top-');
  const y = isTop
    ? Math.max(0, Math.min(Math.max(0, pageHeightPts - textHeight), marginY))
    : Math.max(0, pageHeightPts - marginY - textHeight);

  let x = marginX;
  let textAlign: 'left' | 'center' | 'right' = 'left';

  if (options.position.endsWith('-center')) {
    x = Math.max(0, (pageWidthPts - textWidth) / 2);
    textAlign = 'center';
  } else if (options.position.endsWith('-right')) {
    x = Math.max(0, pageWidthPts - marginX - textWidth);
    textAlign = 'right';
  } else {
    x = Math.max(0, Math.min(Math.max(0, pageWidthPts - textWidth), marginX));
    textAlign = 'left';
  }

  return {
    text: cleanText,
    x,
    y,
    width: textWidth,
    height: textHeight,
    fontSize,
    fontFamily: options.fontFamily || 'Helvetica',
    fontWeight: options.fontWeight || 'normal',
    fontStyle: options.fontStyle || 'normal',
    textAlign,
    color: resolveColorWithOpacity(options.color || '#000000', options.opacity ?? 100),
  };
}

/**
 * Execute a callback with a guaranteed RAII page handle closure for the given document handle.
 *
 * @template T Callback return type.
 * @param engine The PDFium engine instance.
 * @param docHandle Active document handle.
 * @param pageIndex Zero-based page index.
 * @param callback Function receiving the opened page handle and module.
 * @return Result of the callback.
 */
function withDocumentPageHandle<T>(
  engine: PdfiumEngine,
  docHandle: number,
  pageIndex: number,
  callback: (ctx: {
    pageHandle: number;
    docHandle: number;
    mod: ExtendedWrappedPdfiumModule;
  }) => T
): T {
  if (
    typeof engine.getDocumentHandle === 'function' &&
    engine.getDocumentHandle() === docHandle
  ) {
    return withPageHandle(engine, pageIndex, callback);
  }

  const mod = engine.getModule();
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
 * Apply page numbering, Bates numbering, or running header/footer text across target pages.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle The handle to the loaded PDF document.
 * @param options Configuration for formatting, scope, and typography.
 * @param metadata Optional metadata context (document fileName, dateStr, charsetIndex).
 * @return Summary of stamped pages and generated labels.
 */
export function applyPageNumbering(
  engine: PdfiumEngine,
  docHandle: number,
  options: PageNumberingOptions,
  metadata?: {
    fileName?: string;
    dateStr?: string;
    charsetIndex?: FontCharsetIndex;
  }
): PageNumberingResult {
  const mod = engine.getModule();
  const totalDocumentPages = mod.FPDF_GetPageCount(docHandle);
  const targetIndices = resolveTargetPageIndices(options, totalDocumentPages);

  if (targetIndices.length === 0) {
    return {
      stampedPageCount: 0,
      stampedPageIndices: [],
      labels: [],
    };
  }

  const labels: string[] = [];
  const stampedPageIndices: number[] = [];

  for (let seqIdx = 0; seqIdx < targetIndices.length; seqIdx++) {
    const pageIndex = targetIndices[seqIdx];
    const label = formatNumberingText(options, {
      pageIndex,
      sequenceIndex: seqIdx,
      totalTargetPages: targetIndices.length,
      totalDocumentPages,
      dateStr: metadata?.dateStr,
      fileName: metadata?.fileName,
    });

    const trimmed = sanitizePdfText(label).trim();
    if (!trimmed) {
      continue;
    }

    withDocumentPageHandle(engine, docHandle, pageIndex, ({ pageHandle }) => {
      const { widthPts, heightPts } = getDimensions(engine, pageHandle);
      const placement = computeNumberingPlacement(label, widthPts, heightPts, options);
      drawText(engine, docHandle, pageHandle, placement, metadata?.charsetIndex);
      mod.FPDFPage_GenerateContent(pageHandle);
    });

    stampedPageIndices.push(pageIndex);
    labels.push(label);
  }

  return {
    stampedPageCount: stampedPageIndices.length,
    stampedPageIndices,
    labels,
  };
}
