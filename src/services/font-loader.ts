import {
  findClosestGoogleFont,
  isGoogleFont,
  type FontMatchResult,
} from './font-matcher';
import { resolveFontAlias } from './font-aliases';
import { extractBaseFontFamily as defaultExtractBaseFontFamily } from '../core/pdfium-helpers';

export * from './font-matcher';
export { resolveFontAlias } from './font-aliases';

/**
 * Set of font families we have already attempted to load
 * during this session to avoid redundant network requests.
 */
const loadedFonts = new Set<string>();

/**
 * Set of font families that failed to match any Google Font
 * to avoid re-running expensive fuzzy matching algorithms.
 */
const failedFonts = new Set<string>();

const CSS_FONT_CACHE_MAX_SIZE = 500;
const cssFontFamilyCache = new Map<string, string>();

/**
 * Clears in-memory font loader caches.
 */
export function clearFontLoaderCaches(): void {
  loadedFonts.clear();
  failedFonts.clear();
  cssFontFamilyCache.clear();
}

/**
 * Known system fonts that we shouldn't attempt to fetch from Google Fonts.
 */
const SYSTEM_FONTS = new Set([
  'helvetica',
  'arial',
  'times',
  'times new roman',
  'courier',
  'courier new',
  'sans-serif',
  'serif',
  'monospace',
  'inter',
  'intervariable',
  'inter variable',
  'inter var',
  'interdisplay',
  'inter display',
  'symbol',
  'zapfdingbats',
  'georgia',
  'garamond',
  'palatino',
  'cambria',
  'calibri',
  'consolas',
  'tahoma',
  'verdana',
  'trebuchet ms',
  'segoe ui',
]);

/**
 * In-memory cache of detected local system fonts for the session.
 */
const localFontCache = new Map<string, boolean>();

/**
 * Checks whether a system font is installed locally on the client machine
 * using the standard 3-baseline canvas differential measurement technique.
 *
 * Compares rendered string width across monospace, sans-serif, and serif baselines.
 * Results are cached in-memory so detection runs at most once per font family.
 *
 * @param fontFamily Font family name to test.
 * @returns True if the font is detected locally, false otherwise.
 */
export function isLocalFontAvailable(fontFamily: string): boolean {
  if (!fontFamily || typeof document === 'undefined') return false;

  const cleanName = fontFamily.replace(/["']/g, '').trim();
  if (!cleanName) return false;

  const cacheKey = cleanName.toLowerCase();
  const cached = localFontCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      localFontCache.set(cacheKey, false);
      return false;
    }

    const testString = 'mmmmmmmmmmlliBESbswy12345';
    const testSize = '72px';
    const baselines = ['monospace', 'sans-serif', 'serif'] as const;

    const baselineWidths: Record<string, number> = {
      monospace: 0,
      'sans-serif': 0,
      serif: 0,
    };

    for (const base of baselines) {
      ctx.font = `${testSize} ${base}`;
      baselineWidths[base] = ctx.measureText(testString).width;
    }

    let detected = false;
    for (const base of baselines) {
      ctx.font = `${testSize} "${cleanName}", ${base}`;
      const measuredWidth = ctx.measureText(testString).width;
      if (measuredWidth !== baselineWidths[base]) {
        detected = true;
        break;
      }
    }

    localFontCache.set(cacheKey, detected);
    return detected;
  } catch {
    localFontCache.set(cacheKey, false);
    return false;
  }
}

/**
 * Known Google Fonts catalog allowlist to avoid 400 Bad Request network storms
 * for arbitrary internal PDF subset and variant font names.
 */
const GOOGLE_FONTS_ALLOWLIST = new Set([
  'roboto',
  'open sans',
  'noto sans',
  'noto serif',
  'montserrat',
  'lato',
  'poppins',
  'source sans pro',
  'source serif pro',
  'source code pro',
  'oswald',
  'raleway',
  'pt sans',
  'pt serif',
  'merriweather',
  'playfair display',
  'lora',
  'fira sans',
  'fira code',
  'nunito',
  'titillium web',
  'ubuntu',
  'droid sans',
  'droid serif',
  'cormorant garamond',
  'libre baskerville',
  'bitter',
  'inconsolata',
  'karla',
  'crimson text',
  'work sans',
  'arimo',
  'cousine',
  'tinos',
  'carlito',
  'caladea',
  'gelasio',
  'jost',
  'libre franklin',
  'stix two text',
  'eb garamond',
  'bodoni moda',
  'source serif 4',
  'source sans 3',
  'anton',
  'comic neue',
  'crimson pro',
  'hind',
  'marcellus',
  'besley',
  'questrial',
]);

/**
 * Dynamically load a font from Google Fonts by appending a <link> tag.
 * If the exact font is not available, uses the closest matching Google font.
 * 
 * @param cleanFontFamily The cleaned, lowercase base font family name.
 */
export function loadGoogleFont(cleanFontFamily: string): void {
  if (!cleanFontFamily || typeof document === 'undefined') return;

  const cleanFont = cleanFontFamily.trim();
  const fontId = cleanFont.toLowerCase();
  
  if (SYSTEM_FONTS.has(fontId) || failedFonts.has(fontId)) return;

  let targetId = fontId;

  if (!isGoogleFont(fontId) && !GOOGLE_FONTS_ALLOWLIST.has(fontId)) {
    const match = findClosestGoogleFont(cleanFont);
    if (match && match.confidence >= 0.65) {
      targetId = match.font.toLowerCase().trim();
    } else {
      failedFonts.add(fontId);
      return;
    }
  }

  if (loadedFonts.has(targetId)) return;
  loadedFonts.add(targetId);

  const words = targetId.split(/[\s-]+/).filter(w => w.length > 0);
  if (words.length === 0) return;

  const formattedName = words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('+');

  queueMicrotask(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${formattedName}&display=swap`;
    document.head.appendChild(link);
  });
}

/**
 * Return a CSS-compatible font-family string, initiating a network request
 * to Google Fonts if necessary. If the raw font name does not exist on Google Fonts,
 * finds and prepends the closest matching Google font into the CSS font stack.
 */
export function getCssFontFamily(
  rawFontFamily: string | undefined | null,
  extractBaseFontFamily: (name: string) => string = defaultExtractBaseFontFamily
): string {
  if (!rawFontFamily) return '"Inter Variable", "Inter", Helvetica, Arial, sans-serif';

  const cacheKey =
    extractBaseFontFamily === defaultExtractBaseFontFamily
      ? rawFontFamily
      : `${rawFontFamily}\0${extractBaseFontFamily(rawFontFamily)}`;

  const cached = cssFontFamilyCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const result = computeCssFontFamily(rawFontFamily, extractBaseFontFamily);

  if (cssFontFamilyCache.size >= CSS_FONT_CACHE_MAX_SIZE) {
    const firstKey = cssFontFamilyCache.keys().next().value;
    if (firstKey !== undefined) cssFontFamilyCache.delete(firstKey);
  }
  cssFontFamilyCache.set(cacheKey, result);

  return result;
}

function computeCssFontFamily(
  rawFontFamily: string,
  extractBaseFontFamily: (name: string) => string
): string {
  // Check direct font alias (LaTeX, Berry, or commercial metric clone)
  const alias = resolveFontAlias(rawFontFamily);
  if (alias) {
    if (alias.matchedGoogleFont) {
      // Only download remote Google Font fallback if canonical font is not locally available
      if (!isLocalFontAvailable(alias.canonicalName)) {
        loadGoogleFont(alias.matchedGoogleFont);
      }
    }
    return alias.cssStack;
  }

  const cleanFont = extractBaseFontFamily(rawFontFamily);
  
  // Resolve closest Google Font if applicable
  const matchedResult: FontMatchResult | null = findClosestGoogleFont(rawFontFamily) || findClosestGoogleFont(cleanFont);
  const matchedFontName = matchedResult && matchedResult.confidence >= 0.65 ? matchedResult.font : null;

  // Title-case the clean font for CSS rendering (e.g. "open sans" -> "Open Sans")
  const cssName = cleanFont
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  const isInstalledLocally = isLocalFontAvailable(cleanFont) || isLocalFontAvailable(cssName);

  // Asynchronously kick off a load request for this font or its closest Google match if not local
  if (!isInstalledLocally) {
    if (matchedFontName) {
      loadGoogleFont(matchedFontName);
    } else {
      loadGoogleFont(cleanFont);
    }
  }

  const fontPrefix = matchedFontName && matchedFontName.toLowerCase() !== cssName.toLowerCase() && !isInstalledLocally
    ? `"${matchedFontName}", `
    : '';

  const lower = cleanFont.toLowerCase();
  if (
    lower.includes('wingding') ||
    lower.includes('zapfding') ||
    lower.includes('symbol') ||
    lower.includes('webding') ||
    lower.includes('dingbat')
  ) {
    return `${fontPrefix}"Inter Variable", "Inter", Helvetica, Arial, sans-serif`;
  }
  if (
    lower.includes('courier') ||
    lower.includes('mono') ||
    lower.includes('consol') ||
    lower.includes('typewriter') ||
    lower.startsWith('cmtt') ||
    lower.startsWith('pcr')
  ) {
    return `${fontPrefix}"${cssName}", "Courier New", Courier, "Liberation Mono", "Nimbus Mono L", Consolas, Menlo, Monaco, monospace`;
  }
  if (
    !lower.includes('sans') &&
    (lower.includes('times') ||
      lower.includes('serif') ||
      lower.includes('roman') ||
      lower.includes('georgia') ||
      lower.includes('palatino') ||
      lower.includes('garamond') ||
      lower.includes('cambria') ||
      lower.includes('minion') ||
      lower.includes('baskerville') ||
      lower.includes('charter') ||
      lower.includes('century') ||
      lower.includes('bodoni') ||
      lower.includes('didot') ||
      lower.includes('caslon') ||
      lower.includes('bookman') ||
      lower.includes('utopia') ||
      lower.includes('termes') ||
      lower.includes('pagella') ||
      lower.includes('bonum') ||
      lower.includes('schola') ||
      lower.startsWith('cmr') ||
      lower.startsWith('cmbx') ||
      lower.startsWith('cmti') ||
      lower.startsWith('cmsy') ||
      lower.startsWith('lmr') ||
      lower.startsWith('lmbx') ||
      lower.startsWith('lmti') ||
      lower.startsWith('ptm'))
  ) {
    return `${fontPrefix}"${cssName}", "Times New Roman", Times, "Liberation Serif", "Nimbus Roman", Georgia, serif`;
  }
  if (
    lower.includes('helvetica') ||
    lower.includes('arial') ||
    lower.includes('sans') ||
    lower.includes('inter') ||
    lower.includes('roboto') ||
    lower.includes('calibri') ||
    lower.includes('segoe') ||
    lower.includes('tahoma') ||
    lower.includes('verdana')
  ) {
    return `${fontPrefix}"${cssName}", "Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  }
  return `${fontPrefix}"${cssName}", "Inter Variable", "Inter", Helvetica, Arial, sans-serif`;
}

/**
 * Return a human-readable, Title Cased display name for a given font family.
 * E.g., "ABCDEF+OpenSans-BoldItalic" -> "Open Sans"
 */
export function getDisplayFontName(
  rawFontFamily: string,
  extractBaseFontFamily: (name: string) => string = defaultExtractBaseFontFamily
): string {
  if (!rawFontFamily) return 'Inter';
  const alias = resolveFontAlias(rawFontFamily);
  if (alias) {
    return alias.canonicalName;
  }
  const cleanFont = extractBaseFontFamily(rawFontFamily);
  return cleanFont
    .split(/[\s-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

