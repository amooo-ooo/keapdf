import type { PdfiumEngine } from '../../core/pdfium-engine';
import { readCharFontName, extractBaseFontFamily } from '../../core/pdfium-helpers';

import {
  WIN_ANSI_HIGH_CODEPOINTS,
  isWinAnsiCodePoint,
  isWinAnsiText,
} from './utils';

export {
  WIN_ANSI_HIGH_CODEPOINTS,
  isWinAnsiCodePoint,
  isWinAnsiText,
};

function safeCodePointToString(code: number): string {
  try {
    if (code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) {
      return String.fromCodePoint(code);
    }
    return '';
  } catch {
    return '';
  }
}

const STANDARD_14_FONTS = new Set([
  'helvetica',
  'helveticabold',
  'helveticaoblique',
  'helveticaboldoblique',
  'times',
  'timesroman',
  'timesbold',
  'timesitalic',
  'timesbolditalic',
  'courier',
  'courierbold',
  'courieroblique',
  'courierboldoblique',
  'symbol',
  'zapfdingbats',
]);

/**
 * Checks whether a font name corresponds to one of the 14 standard PDF Type 1 fonts.
 * Embedded subsets (indicated by a '+' prefix) are never considered standard fonts.
 *
 * @param fontFamily Font family or raw PDF font name.
 * @return True if the font is one of the standard 14 fonts.
 */
export function isStandard14Font(fontFamily?: string): boolean {
  if (!fontFamily) return false;
  if (fontFamily.includes('+')) return false;
  const normalized = fontFamily.toLowerCase().replace(/[\s_-]+/g, '');
  return STANDARD_14_FONTS.has(normalized);
}

/**
 * Lazily-built, document-wide index of characters available per font.
 * Scans all pages once on first access and caches the result.
 * Used by the in-place text editing heuristic to determine whether
 * a font's embedded subset supports the characters the user typed.
 *
 * Characters are indexed by their raw font name (e.g. "ABCDEF+ArialMT")
 * to accurately distinguish between font variants (regular, bold, italic).
 * Lookups check both the raw name and all raw names that share the same
 * base font family, so "Arial-Bold" characters are still found when
 * searching by "Arial".
 */
export class FontCharsetIndex {
  /** Mapping from raw font name to the set of characters found. */
  private rawCharsets: Map<string, Set<string>> | null = null;

  /** Mapping from base font family to the merged set of all variant characters. */
  private familyCharsets: Map<string, Set<string>> | null = null;

  /** Set of all unique characters across the entire document. */
  private allDocumentChars: Set<string> | null = null;

  /** Next page index to scan when progressively scanning large documents. */
  private nextScanPageIndex: number = 0;

  /**
   * @param engine The PDFium engine instance.
   * @param getDocHandle A callback that returns the active document handle.
   */
  constructor(
    private engine: PdfiumEngine,
    private getDocHandle?: () => number
  ) {}

  /**
   * Resolves total page count from engine without throwing errors.
   */
  private getPageCountSafe(): number {
    if (!this.getDocHandle) return 0;
    try {
      const docHandle = this.getDocHandle();
      if (!docHandle) return 0;
      const mod = this.engine.getModule();
      return mod.FPDF_GetPageCount(docHandle);
    } catch {
      return 0;
    }
  }

  /**
   * Evaluates whether currently indexed characters satisfy the requirement.
   */
  private checkCharset(fontFamily: string, charsToCheck: string[]): boolean {
    if (this.rawCharsets) {
      const rawSet = this.rawCharsets.get(fontFamily);
      if (rawSet && rawSet.size > 0) {
        const allInRaw = charsToCheck.every((c) => rawSet.has(c));
        if (allInRaw) return true;
      }
    }

    if (!fontFamily.includes('+')) {
      const familySet = this.getFamilyCharset(fontFamily);
      if (familySet.size > 0) {
        const allInFamily = charsToCheck.every((c) => familySet.has(c));
        if (allInFamily) return true;
      }
    }

    return false;
  }

  /**
   * Checks whether all characters in the given text are available
   * for the specified font family in the document-wide index.
   * Checks the raw font variant, base font family, and original span text.
   *
   * @param text The text to check.
   * @param fontFamily Optional font family name (raw or normalized).
   * @param origSpanText Optional original text of the span being edited.
   * @return True if every character in the text is present in the font's charset.
   */
  public hasAllChars(text: string, fontFamily?: string, origSpanText?: string): boolean {
    if (!text || text.length === 0) return true;

    const hasWhitespace = text.includes(' ') || text.includes('\t') || text.includes('\n') || text.includes('\r');
    const isStandard = isStandard14Font(fontFamily);

    // If text contains whitespace and the font is not a verified Standard 14 PDF font
    // (e.g. it is an embedded TrueType/Type 1 subset like Nimbus, CMR, or has a '+' subset tag),
    // PDF text objects cannot render spaces with positive advance because embedded subsets
    // omit glyph 32 (space) and rely on TJ coordinate displacement arrays.
    // In-place edit or embedded font drawing must NOT be used for multi-word text.
    if (hasWhitespace && !isStandard) {
      return false;
    }

    // Filter out whitespace characters which don't require specific glyph indices
    const charsToCheck = Array.from(text).filter(
      (c) => c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r'
    );
    if (charsToCheck.length === 0) {
      return true;
    }

    // Fast path: If all characters exist in the original span text
    if (origSpanText) {
      const allInOrig = charsToCheck.every((c) => origSpanText.includes(c));
      if (allInOrig) {
        return true;
      }
    }

    if (!fontFamily) return false;

    if (isStandard) {
      const allWinAnsi = charsToCheck.every((c) => {
        const code = c.codePointAt(0);
        return code !== undefined && isWinAnsiCodePoint(code);
      });
      if (allWinAnsi) return true;
    }

    if (this.checkCharset(fontFamily, charsToCheck)) {
      return true;
    }

    const pageCount = this.getPageCountSafe();
    while (this.nextScanPageIndex < pageCount) {
      const nextBatch = Math.min(pageCount, this.nextScanPageIndex + 20);
      this.scanPages(this.nextScanPageIndex, nextBatch);
      if (this.checkCharset(fontFamily, charsToCheck)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Invalidates the cached index so it will be rebuilt on next access.
   * Call this after document reload, merge, or structural mutations.
   */
  public invalidate(): void {
    this.rawCharsets = null;
    this.familyCharsets = null;
    this.allDocumentChars = null;
    this.nextScanPageIndex = 0;
  }

  /**
   * Incrementally registers new characters into the charset index
   * without requiring an expensive full-document rescan.
   */
  public registerText(text: string, rawFontName: string): void {
    if (!this.rawCharsets) this.rawCharsets = new Map<string, Set<string>>();
    if (!this.familyCharsets) this.familyCharsets = new Map<string, Set<string>>();
    if (!this.allDocumentChars) this.allDocumentChars = new Set<string>();

    let rawSet = this.rawCharsets.get(rawFontName);
    if (!rawSet) {
      rawSet = new Set<string>();
      this.rawCharsets.set(rawFontName, rawSet);
    }
    const baseName = extractBaseFontFamily(rawFontName);
    let familySet = this.familyCharsets.get(baseName);
    if (!familySet) {
      familySet = new Set<string>();
      this.familyCharsets.set(baseName, familySet);
    }
    for (const char of text) {
      if (char === '\n' || char === '\r') continue;
      this.allDocumentChars.add(char);
      rawSet.add(char);
      familySet.add(char);
    }
  }

  /**
   * Returns the merged character set for a base font family.
   * Strips subset prefixes (e.g. "ABCDEF+") and style suffixes
   * (e.g. "-Bold", "-Italic") to merge all variants together.
   *
   * @param fontFamily The font family name.
   * @return A readonly set of characters.
   */
  private getFamilyCharset(fontFamily: string): ReadonlySet<string> {
    if (!this.familyCharsets) return new Set<string>();
    const baseName = extractBaseFontFamily(fontFamily);
    return this.familyCharsets.get(baseName) ?? new Set<string>();
  }

  /** Builds the index across all pages if not yet built. */
  public ensureBuilt(): void {
    const pageCount = this.getPageCountSafe();
    if (this.rawCharsets && this.nextScanPageIndex >= pageCount) return;
    this.scanPages(this.nextScanPageIndex, pageCount);
  }

  /**
   * Scans a specific range of pages in the document to index fonts and characters.
   *
   * @param fromIndex Zero-based start page index.
   * @param toIndex Zero-based end page index (exclusive).
   */
  public scanPages(fromIndex: number, toIndex: number): void {
    const rawMap = new Map<string, Set<string>>();
    const familyMap = new Map<string, Set<string>>();
    const docCharSet = new Set<string>();

    this.rawCharsets = rawMap;
    this.familyCharsets = familyMap;
    this.allDocumentChars = docCharSet;

    if (!this.getDocHandle) return;
    const docHandle = this.getDocHandle();
    if (!docHandle) return;
    const mod = this.engine.getModule();

    const pageCount = mod.FPDF_GetPageCount(docHandle);
    const start = Math.max(0, fromIndex);
    const end = Math.min(pageCount, toIndex);

    for (let pageIdx = start; pageIdx < end; pageIdx++) {
      const pageHandle = mod.FPDF_LoadPage(docHandle, pageIdx);
      if (!pageHandle) continue;

      let textPageHandle = 0;
      try {
        textPageHandle = mod.FPDFText_LoadPage(pageHandle);
        if (!textPageHandle) continue;

        const totalChars = mod.FPDFText_CountChars(textPageHandle);

        for (let i = 0; i < totalChars; i++) {
          const charCode = mod.FPDFText_GetUnicode(textPageHandle, i);
          if (charCode === 0 || charCode === 10 || charCode === 13) continue;

          const charStr = safeCodePointToString(charCode);
          if (!charStr) continue;
          const rawFontName = readCharFontName(this.engine, mod, textPageHandle, i);

          docCharSet.add(charStr);

          // Index by raw font name
          let rawSet = rawMap.get(rawFontName);
          if (!rawSet) {
            rawSet = new Set<string>();
            rawMap.set(rawFontName, rawSet);
          }
          rawSet.add(charStr);

          // Index by base family name (strips subset prefix and style suffix)
          const baseName = extractBaseFontFamily(rawFontName);
          let familySet = familyMap.get(baseName);
          if (!familySet) {
            familySet = new Set<string>();
            familyMap.set(baseName, familySet);
          }
          familySet.add(charStr);
        }
      } finally {
        if (textPageHandle) {
          mod.FPDFText_ClosePage(textPageHandle);
        }
        mod.FPDF_ClosePage(pageHandle);
      }
    }

    if (end > this.nextScanPageIndex) {
      this.nextScanPageIndex = end;
    }
  }

  /**
   * Scans every page in the document to build font-to-charset mappings.
   * Populates both raw (per-variant) and family (merged) charsets.
   */
  public buildIndex(): void {
    this.scanPages(0, this.getPageCountSafe());
  }
}

export { extractBaseFontFamily } from '../../core/pdfium-helpers';

