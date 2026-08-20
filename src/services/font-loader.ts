/**
 * Set of font families we have already attempted to load
 * during this session to avoid redundant network requests.
 */
const loadedFonts = new Set<string>();

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
 * Dynamically loads a font from Google Fonts by appending a <link> tag.
 * 
 * @param cleanFontFamily The cleaned, lowercase base font family name.
 */
export function loadGoogleFont(cleanFontFamily: string): void {
  if (!cleanFontFamily || typeof document === 'undefined') return;

  const cleanFont = cleanFontFamily.trim();
  const fontId = cleanFont.toLowerCase();
  
  if (SYSTEM_FONTS.has(fontId)) return;
  if (fontId.startsWith('cm') || fontId.startsWith('lm') || fontId.startsWith('pcr') || fontId.startsWith('ptm') || fontId.startsWith('phv')) return;
  if (loadedFonts.has(fontId)) return;

  loadedFonts.add(fontId);

  const words = fontId.split(/[\s-]+/).filter(w => w.length > 0);
  if (words.length === 0) return;

  const formattedName = words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('+');

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${formattedName}&display=swap`;
  
  document.head.appendChild(link);
}

/**
 * Returns a CSS-compatible font-family string, initiating a network request
 * to Google Fonts if necessary.
 */
export function getCssFontFamily(rawFontFamily: string, extractBaseFontFamily: (name: string) => string): string {
  if (!rawFontFamily) return '"Inter Variable", Inter, Helvetica, Arial, sans-serif';
  const cleanFont = extractBaseFontFamily(rawFontFamily);
  
  // Asynchronously kick off a load request for this font if not a standard system font
  loadGoogleFont(cleanFont);

  // Title-case the clean font for CSS rendering (e.g. "open sans" -> "Open Sans")
  const cssName = cleanFont
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  const lower = cleanFont.toLowerCase();
  if (
    lower.includes('wingding') ||
    lower.includes('zapfding') ||
    lower.includes('symbol') ||
    lower.includes('webding') ||
    lower.includes('dingbat')
  ) {
    return '"Inter Variable", Inter, Helvetica, Arial, sans-serif';
  }
  if (
    lower.includes('courier') ||
    lower.includes('mono') ||
    lower.includes('consol') ||
    lower.includes('typewriter') ||
    lower.startsWith('cmtt') ||
    lower.startsWith('pcr')
  ) {
    return `"${cssName}", "Courier New", Courier, "Liberation Mono", "Nimbus Mono L", Consolas, Menlo, Monaco, monospace`;
  }
  if (
    lower.includes('times') ||
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
    lower.startsWith('cmr') ||
    lower.startsWith('cmbx') ||
    lower.startsWith('cmti') ||
    lower.startsWith('cmsy') ||
    lower.startsWith('lmr') ||
    lower.startsWith('lmbx') ||
    lower.startsWith('lmti') ||
    lower.startsWith('ptm')
  ) {
    return `"${cssName}", "Times New Roman", Times, "Liberation Serif", "Nimbus Roman", Georgia, serif`;
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
    return `"${cssName}", "Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  }
  return `"${cssName}", "Inter Variable", Inter, Helvetica, Arial, sans-serif`;
}

/**
 * Returns a human-readable, Title Cased display name for a given font family.
 * E.g., "ABCDEF+OpenSans-BoldItalic" -> "Open Sans"
 */
export function getDisplayFontName(rawFontFamily: string, extractBaseFontFamily: (name: string) => string): string {
  if (!rawFontFamily) return 'Inter';
  const cleanFont = extractBaseFontFamily(rawFontFamily);
  return cleanFont
    .split(/[\s-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

