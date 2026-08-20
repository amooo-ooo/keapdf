import type { PdfiumEngine } from '../../core/pdfium-engine';
import { readCharFontName } from '../../core/pdfium-helpers';

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

  /**
   * @param engine The PDFium engine instance.
   * @param getDocHandle A callback that returns the active document handle.
   */
  constructor(
    private engine: PdfiumEngine,
    private getDocHandle: () => number
  ) {}

  /**
   * Checks whether all characters in the given text are available
   * for the specified font family in the document-wide index.
   * Checks the raw font variant, base font family, and original span text.
   *
   * @param text The text to check.
   * @param fontFamily The font family name (raw or normalized).
   * @param origSpanText Optional original text of the span being edited.
   * @return True if every character in the text is present in the font's charset.
   */
  public hasAllChars(text: string, fontFamily: string, origSpanText?: string): boolean {
    if (!text || text.length === 0) return true;

    // Filter out whitespace characters which don't require specific glyph indices
    const charsToCheck = Array.from(text).filter(
      (c) => c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r'
    );
    if (charsToCheck.length === 0) return true;

    // Fast path: If all characters exist in the original span text
    if (origSpanText) {
      const allInOrig = charsToCheck.every((c) => origSpanText.includes(c));
      if (allInOrig) return true;
    }

    // Check if the font is a standard PDF font with full standard Latin-1 charset support
    const normalizedFont = fontFamily.toLowerCase().trim();
    const isStandard =
      normalizedFont.includes('helvetica') ||
      normalizedFont.includes('times') ||
      normalizedFont.includes('courier') ||
      normalizedFont === 'arial';
    if (isStandard) {
      const allLatin1 = charsToCheck.every((c) => {
        const code = c.charCodeAt(0);
        return code >= 32 && code <= 255;
      });
      if (allLatin1) return true;
    }

    this.ensureBuilt();

    // Check exact raw font charset first
    if (this.rawCharsets) {
      const rawSet = this.rawCharsets.get(fontFamily);
      if (rawSet && rawSet.size > 0) {
        const allInRaw = charsToCheck.every((c) => rawSet.has(c));
        if (allInRaw) return true;
      }
    }

    // Check base family charset (merged across variants)
    const familySet = this.getFamilyCharset(fontFamily);
    if (familySet.size > 0) {
      const allInFamily = charsToCheck.every((c) => familySet.has(c));
      if (allInFamily) return true;
    }

    // Check document-wide character pool
    if (this.allDocumentChars && this.allDocumentChars.size > 0) {
      const allInDoc = charsToCheck.every((c) => this.allDocumentChars!.has(c));
      if (allInDoc) return true;
    }

    return false;
  }

  /**
   * Invalidates the cached index so it will be rebuilt on next access.
   * Call this after a fallback edit that may have introduced new font data.
   */
  public invalidate(): void {
    this.rawCharsets = null;
    this.familyCharsets = null;
    this.allDocumentChars = null;
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

  /** Builds the index if it hasn't been built yet. */
  public ensureBuilt(): void {
    if (this.rawCharsets) return;
    this.buildIndex();
  }

  /**
   * Scans every page in the document to build font-to-charset mappings.
   * Populates both raw (per-variant) and family (merged) charsets.
   */
  private buildIndex(): void {
    const mod = this.engine.getModule();
    const docHandle = this.getDocHandle();

    const rawMap = new Map<string, Set<string>>();
    const familyMap = new Map<string, Set<string>>();
    const docCharSet = new Set<string>();

    const pageCount = mod.FPDF_GetPageCount(docHandle);

    for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
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

          const charStr = String.fromCodePoint(charCode);
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

    this.rawCharsets = rawMap;
    this.familyCharsets = familyMap;
    this.allDocumentChars = docCharSet;
  }
}

/**
 * Extracts a base font family name by stripping PDF subset prefixes,
 * PostScript markers, and common style suffixes.
 *
 * Examples:
 *   "ABCDEF+ArialMT" -> "arial"
 *   "Helvetica-Bold" -> "helvetica"
 *   "TimesNewRomanPSMT" -> "times new roman"
 *   "GHIJKL+Calibri-BoldItalic" -> "calibri"
 *
 * @param fontName The raw font name from PDFium.
 * @return A lowercase base family name suitable for grouping.
 */
export function extractBaseFontFamily(fontName: string): string {
  if (!fontName) return 'helvetica';

  let name = fontName;

  // Strip PDF subset prefix (6 uppercase letters followed by '+')
  const plusIdx = name.indexOf('+');
  if (plusIdx >= 0 && plusIdx <= 7) {
    name = name.substring(plusIdx + 1);
  }

  // Add spaces to PascalCase/camelCase names before lowercasing (e.g. "OpenSans" -> "Open Sans")
  name = name.replace(/([a-z])([A-Z])/g, '$1 $2');

  // Lowercase for consistent grouping
  name = name.toLowerCase();

  // Strip common style and PostScript suffixes
  name = name
    .replace(/[-,_](bold|italic|oblique|bolditalic|boldoblique|regular|medium|light|semibold|demibold|extrabold|condensed|expanded|narrow|black|thin|heavy|book|psmt|ps|mt|ms|identity-h|cid)$/g, '')
    .replace(/\s+(bold|italic|oblique|regular|medium|light|psmt|ps|mt|ms)$/g, '')
    .replace(/(psmt|ps|mt|ms)$/g, '')
    .trim();

  return name || 'helvetica';
}
