/**
 * Google Fonts matching service and fallback resolution algorithm.
 *
 * Resolves unknown or variant font family names from native PDF documents
 * to their closest matching Google Font family for live inline editing
 * and browser text rendering.
 */

import { resolveFontAlias } from './font-aliases';

export type FontCategory = 'sans-serif' | 'serif' | 'monospace' | 'display' | 'handwriting';

export type FontMatchType = 'exact' | 'suffix' | 'prefix' | 'fuzzy' | 'category' | 'alias';

export interface FontMatchResult {
  readonly font: string;
  readonly normalizedTarget: string;
  readonly confidence: number;
  readonly matchType: FontMatchType;
  readonly category: FontCategory;
}

export interface FontMatcherOptions {
  readonly catalog?: readonly string[];
  readonly minConfidence?: number;
  readonly allowCategoryFallback?: boolean;
}

/**
 * Built-in Google Fonts catalog.
 * Canonical Title Case family names.
 */
const DEFAULT_GOOGLE_FONTS: readonly string[] = [
  // User explicit requirement
  'Arev Sans',

  // Standard and popular Sans-Serif
  'Roboto',
  'Open Sans',
  'Noto Sans',
  'Montserrat',
  'Lato',
  'Poppins',
  'Source Sans Pro',
  'Oswald',
  'Raleway',
  'PT Sans',
  'Fira Sans',
  'Nunito',
  'Titillium Web',
  'Ubuntu',
  'Droid Sans',
  'Work Sans',
  'Karla',
  'Arimo',
  'Inter',
  'Rubik',
  'DM Sans',
  'Plus Jakarta Sans',
  'Manrope',
  'Outfit',
  'Quicksand',
  'Cabin',
  'Carlito',
  'Jost',
  'Libre Franklin',
  'Source Sans 3',
  'Hind',
  'Questrial',

  // Serif
  'Noto Serif',
  'Source Serif Pro',
  'PT Serif',
  'Merriweather',
  'Playfair Display',
  'Lora',
  'Droid Serif',
  'Cormorant Garamond',
  'Libre Baskerville',
  'Bitter',
  'Crimson Text',
  'Tinos',
  'Cinzel',
  'Caladea',
  'Gelasio',
  'STIX Two Text',
  'EB Garamond',
  'Bodoni Moda',
  'Source Serif 4',
  'Crimson Pro',
  'Besley',

  // Monospace
  'Source Code Pro',
  'Fira Code',
  'Inconsolata',
  'Cousine',
  'Space Mono',
  'IBM Plex Mono',

  // Handwriting
  'Caveat',
  'Dancing Script',
  'Pacifico',

  // Display
  'Abril Fatface',
  'Anton',
  'Comic Neue',
];

/**
 * Mutable catalog store to support dynamic font registration.
 */
const registeredFonts = new Map<string, string>();

// Initialize with built-in fonts
for (const font of DEFAULT_GOOGLE_FONTS) {
  registeredFonts.set(font.toLowerCase().trim(), font);
}

/**
 * Register a font family in the Google Fonts catalog.
 *
 * @param fontName The canonical font family name (e.g. "Arev Sans").
 */
export function registerGoogleFont(fontName: string): void {
  const clean = fontName.trim();
  if (!clean) return;
  registeredFonts.set(clean.toLowerCase(), clean);
}

/**
 * Register multiple font families in the Google Fonts catalog.
 *
 * @param fontNames Array of canonical font family names.
 */
export function registerGoogleFonts(fontNames: readonly string[]): void {
  for (const font of fontNames) {
    registerGoogleFont(font);
  }
}

/**
 * Check if a given font family name is in the Google Fonts catalog.
 *
 * @param fontName The font family name to test.
 * @return True if the font exists in the catalog.
 */
export function isGoogleFont(fontName: string): boolean {
  if (!fontName) return false;
  return registeredFonts.has(fontName.toLowerCase().trim());
}

/**
 * Return a list of all currently registered Google Fonts.
 */
export function getGoogleFontsCatalog(): readonly string[] {
  return Array.from(registeredFonts.values());
}

/**
 * Normalize a raw PDF font name:
 * - Strips PDF subset prefixes (e.g. "ABCDEF+")
 * - Expands PascalCase and camelCase into space-separated words
 * - Replaces delimiters (hyphens, underscores, commas, plus signs) with spaces
 * - Lowercases and collapses multiple spaces
 *
 * @param fontName Raw or partial font family name.
 * @return Normalized lowercase space-separated string.
 */
export function normalizeFontName(fontName: string): string {
  if (!fontName) return '';

  let name = fontName.trim();

  // Strip 6-uppercase-letter PDF subset prefix (e.g. "ABCDEF+")
  const plusIdx = name.indexOf('+');
  if (plusIdx >= 0 && plusIdx <= 7) {
    name = name.substring(plusIdx + 1);
  }

  // Insert space between lower-to-upper and upper-to-upper-then-lower transitions
  name = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  // Replace symbols and delimiters with space
  name = name.replace(/[_\-+,.]+/g, ' ');

  // Collapse multiple spaces and lowercase
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Set of common style, weight, and PostScript suffix tokens to strip.
 */
const SUFFIX_TOKENS = new Set([
  'roman',
  'regular',
  'book',
  'medium',
  'light',
  'ultralight',
  'extralight',
  'thin',
  'hairline',
  'semibold',
  'demibold',
  'bold',
  'extrabold',
  'ultrabold',
  'black',
  'heavy',
  'italic',
  'oblique',
  'slanted',
  'upright',
  'condensed',
  'narrow',
  'expanded',
  'wide',
  'display',
  'text',
  'caption',
  'subhead',
  'psmt',
  'ps',
  'mt',
  'ms',
  'pro',
  'std',
  'unicode',
  'cid',
  'identity-h',
  'identity-v',
  'retina',
  'extra',
  'ultra',
  'semi',
  'demi',
  'itc',
  'lt',
  'ef',
  'bt',
  'urw',
  'wgl4',
]);

/**
 * Strip known style and variant suffixes from a normalized font name.
 * Special-cases compound family names like "Times New Roman" so "Roman" is not stripped.
 *
 * @param normalizedName Normalized lowercase font name.
 * @return Base font family name with style suffixes removed.
 */
export function stripStyleSuffixes(normalizedName: string): string {
  if (!normalizedName) return '';

  // Preserve compound names where "roman" is part of the actual family
  if (normalizedName === 'times new roman') {
    return 'times new roman';
  }
  if (normalizedName.startsWith('times new roman ')) {
    const after = normalizedName.slice('times new roman '.length).trim();
    const afterWords = after.split(' ').filter((w) => w.length > 0);
    while (afterWords.length > 0 && SUFFIX_TOKENS.has(afterWords[afterWords.length - 1])) {
      afterWords.pop();
    }
    return afterWords.length > 0 ? `times new roman ${afterWords.join(' ')}` : 'times new roman';
  }

  return stripTrailingTokens(normalizedName);
}

/**
 * Helper to strip suffix tokens from the end of a space-separated string.
 */
function stripTrailingTokens(text: string): string {
  const words = text.split(' ').filter((w) => w.length > 0);
  while (words.length > 1) {
    const lastWord = words[words.length - 1];
    if (SUFFIX_TOKENS.has(lastWord)) {
      words.pop();
    } else {
      break;
    }
  }
  return words.join(' ');
}

/**
 * Classify a font name into a primary typographic category.
 *
 * @param fontName Cleaned font name.
 * @return The inferred font category.
 */
export function detectFontCategory(fontName: string): FontCategory {
  const lower = fontName.toLowerCase();

  // Handwriting check
  if (
    lower.includes('handwriting') ||
    lower.includes('script') ||
    lower.includes('cursive') ||
    lower.includes('calligraph') ||
    lower.includes('pen') ||
    lower.includes('brush')
  ) {
    return 'handwriting';
  }

  // Display check
  if (
    lower.includes('display') ||
    lower.includes('poster') ||
    lower.includes('titling') ||
    lower.includes('gothic') ||
    lower.includes('blackletter')
  ) {
    return 'display';
  }

  // Monospace check
  if (
    lower.includes('mono') ||
    lower.includes('code') ||
    lower.includes('courier') ||
    lower.includes('typewriter') ||
    lower.includes('console') ||
    lower.includes('terminal') ||
    lower.startsWith('cmtt') ||
    lower.startsWith('pcr')
  ) {
    return 'monospace';
  }

  // Serif check (only if not sans)
  if (
    !lower.includes('sans') &&
    (lower.includes('serif') ||
      lower.includes('times') ||
      lower.includes('roman') ||
      lower.includes('georgia') ||
      lower.includes('garamond') ||
      lower.includes('baskerville') ||
      lower.includes('minion') ||
      lower.includes('caslon') ||
      lower.includes('bookman') ||
      lower.includes('palatino') ||
      lower.includes('cambria') ||
      lower.includes('antiqua') ||
      lower.includes('didot') ||
      lower.includes('bodoni') ||
      lower.includes('charter') ||
      lower.includes('century') ||
      lower.startsWith('cmr') ||
      lower.startsWith('lmr') ||
      lower.startsWith('ptm'))
  ) {
    return 'serif';
  }

  return 'sans-serif';
}

/**
 * Generate character bigrams for string similarity comparison.
 */
function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>();
  const clean = str.replace(/\s+/g, '');
  for (let i = 0; i < clean.length - 1; i++) {
    bigrams.add(clean.substring(i, i + 2));
  }
  return bigrams;
}

/**
 * Compute the Dice coefficient between two strings based on bigrams.
 * Return a score between 0.0 (no similarity) and 1.0 (identical).
 */
function diceCoefficient(strA: string, strB: string): number {
  if (strA === strB) return 1.0;
  if (strA.length < 2 || strB.length < 2) return 0.0;

  const bigramsA = getBigrams(strA);
  const bigramsB = getBigrams(strB);

  let intersectionSize = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) {
      intersectionSize++;
    }
  }

  return (2 * intersectionSize) / (bigramsA.size + bigramsB.size);
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find the closest matching Google Font for a given PDF font name
 * using a multi-tiered matching algorithm:
 *
 * 1. Exact match in catalog
 * 2. Suffix-stripped base match (e.g. "Arev Sans Roman" -> "Arev Sans")
 * 3. Prefix and token subset match
 * 4. Fuzzy string similarity metric (Levenshtein + Dice coefficient)
 * 5. Typographic category fallback
 */
const MATCH_CACHE_MAX_SIZE = 500;
const fontMatchCache = new Map<string, FontMatchResult | null>();

/**
 * Clears the font match cache.
 */
export function clearFontMatchCache(): void {
  fontMatchCache.clear();
}

/**
 * Core Google Fonts matching algorithm with multi-stage heuristic resolution:
 * 0. Direct font alias (LaTeX, TeX Berry scheme, commercial metric clones)
 * 1. Exact case-insensitive match
 * 2. Suffix-stripped variant match
 * 3. Prefix and token subset match
 * 4. Fuzzy string similarity metric (Levenshtein + Dice coefficient)
 * 5. Typographic category fallback
 *
 * @param fontName The raw or normalized font family name.
 * @param options Optional configuration for catalog, threshold, and fallback.
 * @return The match result, or null if no match meets criteria.
 */
export function findClosestGoogleFont(
  fontName: string,
  options?: FontMatcherOptions
): FontMatchResult | null {
  if (!fontName) return null;

  const isDefaultOptions =
    !options ||
    (!options.catalog &&
      options.minConfidence === undefined &&
      options.allowCategoryFallback === undefined);

  if (isDefaultOptions && fontMatchCache.has(fontName)) {
    return fontMatchCache.get(fontName)!;
  }

  const result = computeClosestGoogleFont(fontName, options);

  if (isDefaultOptions) {
    if (fontMatchCache.size >= MATCH_CACHE_MAX_SIZE) {
      const firstKey = fontMatchCache.keys().next().value;
      if (firstKey !== undefined) fontMatchCache.delete(firstKey);
    }
    fontMatchCache.set(fontName, result);
  }

  return result;
}

function computeClosestGoogleFont(
  fontName: string,
  options?: FontMatcherOptions
): FontMatchResult | null {
  const normalized = normalizeFontName(fontName);
  if (!normalized) return null;

  const category = detectFontCategory(normalized);
  const minConfidence = options?.minConfidence ?? 0.6;
  const allowFallback = options?.allowCategoryFallback ?? true;

  // Build candidate catalog list (defaults to registered fonts)
  const catalog = options?.catalog
    ? options.catalog.map((f) => ({ raw: f, lower: f.toLowerCase().trim() }))
    : Array.from(registeredFonts.entries()).map(([lower, raw]) => ({ lower, raw }));

  // Stage 0: Direct Font Alias and LaTeX / Berry resolution
  const aliasRes = resolveFontAlias(fontName) || resolveFontAlias(normalized);
  if (aliasRes && aliasRes.matchedGoogleFont) {
    return {
      font: aliasRes.matchedGoogleFont,
      normalizedTarget: normalized,
      confidence: aliasRes.isMetricCompatible ? 1.0 : 0.95,
      matchType: 'alias',
      category: aliasRes.category,
    };
  }

  // Stage 1: Exact match
  for (const item of catalog) {
    if (item.lower === normalized) {
      return {
        font: item.raw,
        normalizedTarget: normalized,
        confidence: 1.0,
        matchType: 'exact',
        category,
      };
    }
  }

  // Stage 2: Suffix-stripped match (e.g. "Arev Sans Roman" -> "Arev Sans")
  const stripped = stripStyleSuffixes(normalized);
  if (stripped && stripped !== normalized) {
    for (const item of catalog) {
      if (item.lower === stripped) {
        return {
          font: item.raw,
          normalizedTarget: normalized,
          confidence: 0.95,
          matchType: 'suffix',
          category,
        };
      }
    }
  }

  // Stage 3: Prefix & token-subset match
  let bestPrefixMatch: { font: string; length: number } | null = null;
  const targetTokens = new Set((stripped || normalized).split(' '));

  for (const item of catalog) {
    // Check if catalog font is an exact prefix of the target
    if (normalized.startsWith(item.lower + ' ') || (stripped && stripped.startsWith(item.lower + ' '))) {
      if (!bestPrefixMatch || item.lower.length > bestPrefixMatch.length) {
        bestPrefixMatch = { font: item.raw, length: item.lower.length };
      }
    }

    // Check if target is a prefix of the catalog font
    if (item.lower.startsWith(normalized + ' ') || (stripped && item.lower.startsWith(stripped + ' '))) {
      if (!bestPrefixMatch || item.lower.length > bestPrefixMatch.length) {
        bestPrefixMatch = { font: item.raw, length: item.lower.length };
      }
    }

    // Token subset match: all tokens of catalog font exist in target
    const catTokens = item.lower.split(' ');
    if (catTokens.length > 1 && catTokens.every((t) => targetTokens.has(t))) {
      if (!bestPrefixMatch || item.lower.length > bestPrefixMatch.length) {
        bestPrefixMatch = { font: item.raw, length: item.lower.length };
      }
    }
  }

  if (bestPrefixMatch) {
    return {
      font: bestPrefixMatch.font,
      normalizedTarget: normalized,
      confidence: 0.85,
      matchType: 'prefix',
      category,
    };
  }

  // Stage 4: Fuzzy string similarity metric
  let bestFuzzy: { font: string; score: number } | null = null;
  const targetForFuzzy = stripped || normalized;
  const targetFirstWord = targetForFuzzy.split(' ')[0];

  for (const item of catalog) {
    const dice = diceCoefficient(targetForFuzzy, item.lower);
    const maxLen = Math.max(targetForFuzzy.length, item.lower.length);
    const lev = maxLen > 0 ? 1 - levenshteinDistance(targetForFuzzy, item.lower) / maxLen : 0;
    let combinedScore = dice * 0.6 + lev * 0.4;

    // If catalog font is single-word, also compare against the primary first word of target
    if (!item.lower.includes(' ') && targetFirstWord && targetFirstWord !== targetForFuzzy) {
      const wordDice = diceCoefficient(targetFirstWord, item.lower);
      const wordMaxLen = Math.max(targetFirstWord.length, item.lower.length);
      const wordLev = wordMaxLen > 0 ? 1 - levenshteinDistance(targetFirstWord, item.lower) / wordMaxLen : 0;
      const wordScore = wordDice * 0.6 + wordLev * 0.4;
      if (wordScore > combinedScore) {
        combinedScore = wordScore;
      }
    }

    if (combinedScore >= minConfidence) {
      if (!bestFuzzy || combinedScore > bestFuzzy.score) {
        bestFuzzy = { font: item.raw, score: combinedScore };
      }
    }
  }

  if (bestFuzzy) {
    return {
      font: bestFuzzy.font,
      normalizedTarget: normalized,
      confidence: Math.round(bestFuzzy.score * 100) / 100,
      matchType: 'fuzzy',
      category,
    };
  }

  // Stage 5: Typographic category fallback
  if (allowFallback) {
    let fallbackFont = 'Roboto';
    if (category === 'serif') {
      fallbackFont = 'Lora';
    } else if (category === 'monospace') {
      fallbackFont = 'Fira Code';
    } else if (category === 'handwriting') {
      fallbackFont = 'Caveat';
    } else if (category === 'display') {
      fallbackFont = 'Playfair Display';
    }

    return {
      font: fallbackFont,
      normalizedTarget: normalized,
      confidence: 0.5,
      matchType: 'category',
      category,
    };
  }

  return null;
}

/**
 * Resolve the closest Google Font name string, or null if no candidate matches.
 *
 * @param fontName Raw or normalized font name.
 * @return Matched Google Font family name.
 */
export function matchGoogleFont(fontName: string): string | null {
  const result = findClosestGoogleFont(fontName);
  return result ? result.font : null;
}
