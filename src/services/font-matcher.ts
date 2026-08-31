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

