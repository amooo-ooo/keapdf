/**
 * Comprehensive Font Aliasing and Recognition Engine.
 *
 * Provides high-precision resolution of native PDF font names that are abbreviated,
 * encoded with TeX/LaTeX conventions, or non-Google commercial typefaces.
 *
 * Supported domains:
 * 1. LaTeX Computer Modern (Knuth optical sizes: cmr10, cmbx12, cmti10, cmtt10, cmss10, etc.)
 * 2. Latin Modern (GUST consortium: lmr10, lmbx10, lmti10, lmtt10, lmss10, etc.)
 * 3. Karl Berry dvips/pdflatex naming scheme (ptmr8t, phvr8t, pcrr8t, pplr8t, bchr8t, etc.)
 * 4. TeX Gyre and modern LaTeX packages (newtxtext, mathptmx, mathpazo, fourier, stix2, etc.)
 * 5. Commercial typefaces and metric-compatible Google Fonts (Calibri->Carlito, Cambria->Caladea, etc.)
 */

import type { FontCategory } from './font-matcher';

export interface FontAliasResolution {
  readonly canonicalName: string;
  readonly matchedGoogleFont: string | null;
  readonly category: FontCategory;
  readonly isMetricCompatible: boolean;
  readonly cssStack: string;
  readonly isSystemFont?: boolean;
  readonly weight?: 'normal' | 'bold';
  readonly style?: 'normal' | 'italic';
}

/**
 * Strips 6-character PDF subset prefix (e.g. "ABCDEF+").
 */
function cleanSubsetPrefix(name: string): string {
  if (!name) return '';
  const plusIdx = name.indexOf('+');
  if (plusIdx >= 0 && plusIdx <= 7) {
    return name.substring(plusIdx + 1).trim();
  }
  return name.trim();
}

/**
 * Normalizes an arbitrary font name for internal map indexing.
 * Strips non-alphanumeric characters and converts to lowercase.
 */
function normalizeKey(name: string): string {
  return cleanSubsetPrefix(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Standard CSS font stack templates tailored for screen rendering.
 */
const CSS_STACK_LATEX_SERIF =
  '"Latin Modern Roman", "CMU Serif", "Computer Modern Roman", "STIX Two Text", "Nimbus Roman No9 L", "Times New Roman", Times, serif';

const CSS_STACK_LATEX_SANS =
  '"Latin Modern Sans", "CMU Sans Serif", "Computer Modern Sans", "Source Sans 3", "Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const CSS_STACK_LATEX_MONO =
  '"Latin Modern Mono", "CMU Typewriter Text", "Computer Modern Typewriter", "Source Code Pro", "Courier New", Courier, monospace';

/**
 * Commercial font definitions mapped to official metric clones and Google Fonts equivalents.
 */
interface CommercialFontDef {
  readonly canonicalName: string;
  readonly matchedGoogleFont: string;
  readonly category: FontCategory;
  readonly isMetricCompatible: boolean;
  readonly cssStack: string;
  readonly isSystemFont?: boolean;
}

const COMMERCIAL_FONT_MAP: Record<string, CommercialFontDef> = {
  // Microsoft core fonts with metric-compatible clones
  calibri: {
    canonicalName: 'Calibri',
    matchedGoogleFont: 'Carlito',
    category: 'sans-serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: 'Calibri, "Carlito", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif',
  },
  cambria: {
    canonicalName: 'Cambria',
    matchedGoogleFont: 'Caladea',
    category: 'serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: 'Cambria, "Caladea", Georgia, "Times New Roman", serif',
  },
  arial: {
    canonicalName: 'Arial',
    matchedGoogleFont: 'Arimo',
    category: 'sans-serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: 'Arial, "Arimo", "Liberation Sans", Helvetica, sans-serif',
  },
  arialmt: {
    canonicalName: 'Arial',
    matchedGoogleFont: 'Arimo',
    category: 'sans-serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: 'Arial, "Arimo", "Liberation Sans", Helvetica, sans-serif',
  },
  timesnewroman: {
    canonicalName: 'Times New Roman',
    matchedGoogleFont: 'Tinos',
    category: 'serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Times New Roman", "Tinos", Times, "Liberation Serif", serif',
  },
  timesnewromanpsmt: {
    canonicalName: 'Times New Roman',
    matchedGoogleFont: 'Tinos',
    category: 'serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Times New Roman", "Tinos", Times, "Liberation Serif", serif',
  },
  times: {
    canonicalName: 'Times New Roman',
    matchedGoogleFont: 'Tinos',
    category: 'serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Times New Roman", "Tinos", Times, "Liberation Serif", serif',
  },
  couriernew: {
    canonicalName: 'Courier New',
    matchedGoogleFont: 'Cousine',
    category: 'monospace',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Courier New", "Cousine", Courier, "Liberation Mono", monospace',
  },
  couriernewpsmt: {
    canonicalName: 'Courier New',
    matchedGoogleFont: 'Cousine',
    category: 'monospace',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Courier New", "Cousine", Courier, "Liberation Mono", monospace',
  },
  courier: {
    canonicalName: 'Courier New',
    matchedGoogleFont: 'Cousine',
    category: 'monospace',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Courier New", "Cousine", Courier, "Liberation Mono", monospace',
  },
  georgia: {
    canonicalName: 'Georgia',
    matchedGoogleFont: 'Gelasio',
    category: 'serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: 'Georgia, "Gelasio", "Times New Roman", serif',
  },
  // Popular commercial fonts
  futura: {
    canonicalName: 'Futura',
    matchedGoogleFont: 'Jost',
    category: 'sans-serif',
    isMetricCompatible: false,
    cssStack: 'Futura, "Jost", "Century Gothic", sans-serif',
  },
  franklingothic: {
    canonicalName: 'Franklin Gothic',
    matchedGoogleFont: 'Libre Franklin',
    category: 'sans-serif',
    isMetricCompatible: false,
    cssStack: '"Franklin Gothic Medium", "Franklin Gothic", "Libre Franklin", "Arial Black", sans-serif',
  },
  franklingothicmedium: {
    canonicalName: 'Franklin Gothic',
    matchedGoogleFont: 'Libre Franklin',
    category: 'sans-serif',
    isMetricCompatible: false,
    cssStack: '"Franklin Gothic Medium", "Franklin Gothic", "Libre Franklin", "Arial Black", sans-serif',
  },
  baskerville: {
    canonicalName: 'Baskerville',
    matchedGoogleFont: 'Libre Baskerville',
    category: 'serif',
    isMetricCompatible: false,
    cssStack: 'Baskerville, "Libre Baskerville", "Baskerville Old Face", serif',
  },
  bodoni: {
    canonicalName: 'Bodoni',
    matchedGoogleFont: 'Bodoni Moda',
    category: 'serif',
    isMetricCompatible: false,
    cssStack: '"Bodoni MT", Bodoni, "Bodoni Moda", Didot, serif',
  },
  didot: {
    canonicalName: 'Didot',
    matchedGoogleFont: 'Bodoni Moda',
    category: 'serif',
    isMetricCompatible: false,
    cssStack: 'Didot, "Bodoni Moda", "Bodoni MT", serif',
  },
  garamond: {
    canonicalName: 'Garamond',
    matchedGoogleFont: 'EB Garamond',
    category: 'serif',
    isMetricCompatible: false,
    cssStack: 'Garamond, "EB Garamond", "Cormorant Garamond", "ITC Garamond", serif',
  },
  palatino: {
    canonicalName: 'Palatino',
    matchedGoogleFont: 'Cinzel',
    category: 'serif',
    isMetricCompatible: false,
    isSystemFont: true,
    cssStack: '"Palatino Linotype", "Book Antiqua", Palatino, "URW Palladio L", serif',
  },
  bookantiqua: {
    canonicalName: 'Palatino',
    matchedGoogleFont: 'Cinzel',
    category: 'serif',
    isMetricCompatible: false,
    isSystemFont: true,
    cssStack: '"Book Antiqua", "Palatino Linotype", Palatino, serif',
  },
  minionpro: {
    canonicalName: 'Minion Pro',
    matchedGoogleFont: 'Crimson Pro',
    category: 'serif',
    isMetricCompatible: false,
    cssStack: '"Minion Pro", "Crimson Pro", Minion, Georgia, serif',
  },
  minion: {
    canonicalName: 'Minion Pro',
    matchedGoogleFont: 'Crimson Pro',
    category: 'serif',
    isMetricCompatible: false,
    cssStack: '"Minion Pro", "Crimson Pro", Minion, Georgia, serif',
  },
  myriadpro: {
    canonicalName: 'Myriad Pro',
    matchedGoogleFont: 'PT Sans',
    category: 'sans-serif',
    isMetricCompatible: false,
    cssStack: '"Myriad Pro", "PT Sans", "Source Sans 3", sans-serif',
  },
  myriad: {
    canonicalName: 'Myriad Pro',
    matchedGoogleFont: 'PT Sans',
    category: 'sans-serif',
    isMetricCompatible: false,
    cssStack: '"Myriad Pro", "PT Sans", "Source Sans 3", sans-serif',
  },
  frutiger: {
    canonicalName: 'Frutiger',
    matchedGoogleFont: 'Hind',
    category: 'sans-serif',
    isMetricCompatible: false,
    cssStack: 'Frutiger, "Hind", "Segoe UI", sans-serif',
  },
  gillsans: {
    canonicalName: 'Gill Sans',
    matchedGoogleFont: 'Cabin',
    category: 'sans-serif',
    isMetricCompatible: false,
    cssStack: '"Gill Sans", "Gill Sans MT", "Cabin", Lato, sans-serif',
  },
  optima: {
    canonicalName: 'Optima',
    matchedGoogleFont: 'Marcellus',
    category: 'sans-serif',
    isMetricCompatible: false,
    cssStack: 'Optima, "Marcellus", "URW Classico", sans-serif',
  },
  consolas: {
    canonicalName: 'Consolas',
    matchedGoogleFont: 'Inconsolata',
    category: 'monospace',
    isMetricCompatible: false,
    isSystemFont: true,
    cssStack: 'Consolas, "Inconsolata", "Cascadia Code", monospace',
  },
  comicsansms: {
    canonicalName: 'Comic Sans MS',
    matchedGoogleFont: 'Comic Neue',
    category: 'display',
    isMetricCompatible: false,
    isSystemFont: true,
    cssStack: '"Comic Sans MS", "Comic Neue", cursive, sans-serif',
  },
  impact: {
    canonicalName: 'Impact',
    matchedGoogleFont: 'Anton',
    category: 'display',
    isMetricCompatible: false,
    isSystemFont: true,
    cssStack: 'Impact, "Anton", "Arial Black", sans-serif',
  },

  // URW Nimbus PostScript core 35 font clones
  nimbusromno9l: {
    canonicalName: 'Nimbus Roman No9 L',
    matchedGoogleFont: 'Tinos',
    category: 'serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Nimbus Roman No9 L", "Nimbus Roman", "Times New Roman", Times, serif',
  },
  nimbusromno9lregu: {
    canonicalName: 'Nimbus Roman No9 L',
    matchedGoogleFont: 'Tinos',
    category: 'serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Nimbus Roman No9 L", "Nimbus Roman", "Times New Roman", Times, serif',
  },
  nimbusromno9lreg: {
    canonicalName: 'Nimbus Roman No9 L',
    matchedGoogleFont: 'Tinos',
    category: 'serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Nimbus Roman No9 L", "Nimbus Roman", "Times New Roman", Times, serif',
  },
  nimbusromno9lmedi: {
    canonicalName: 'Nimbus Roman No9 L',
    matchedGoogleFont: 'Tinos',
    category: 'serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Nimbus Roman No9 L", "Nimbus Roman", "Times New Roman", Times, serif',
  },
  nimbusromno9lmedm: {
    canonicalName: 'Nimbus Roman No9 L',
    matchedGoogleFont: 'Tinos',
    category: 'serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Nimbus Roman No9 L", "Nimbus Roman", "Times New Roman", Times, serif',
  },
  nimbusrom: {
    canonicalName: 'Nimbus Roman No9 L',
    matchedGoogleFont: 'Tinos',
    category: 'serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Nimbus Roman No9 L", "Nimbus Roman", "Times New Roman", Times, serif',
  },
  nimbusroman: {
    canonicalName: 'Nimbus Roman No9 L',
    matchedGoogleFont: 'Tinos',
    category: 'serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Nimbus Roman No9 L", "Nimbus Roman", "Times New Roman", Times, serif',
  },
  nimbussanl: {
    canonicalName: 'Nimbus Sans L',
    matchedGoogleFont: 'Arimo',
    category: 'sans-serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Nimbus Sans L", "Nimbus Sans", Arial, Helvetica, sans-serif',
  },
  nimbussanlregu: {
    canonicalName: 'Nimbus Sans L',
    matchedGoogleFont: 'Arimo',
    category: 'sans-serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Nimbus Sans L", "Nimbus Sans", Arial, Helvetica, sans-serif',
  },
  nimbussan: {
    canonicalName: 'Nimbus Sans L',
    matchedGoogleFont: 'Arimo',
    category: 'sans-serif',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Nimbus Sans L", "Nimbus Sans", Arial, Helvetica, sans-serif',
  },
  nimbusmonl: {
    canonicalName: 'Nimbus Mono L',
    matchedGoogleFont: 'Cousine',
    category: 'monospace',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Nimbus Mono L", "Nimbus Mono", "Courier New", Courier, monospace',
  },
  nimbusmonlregu: {
    canonicalName: 'Nimbus Mono L',
    matchedGoogleFont: 'Cousine',
    category: 'monospace',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Nimbus Mono L", "Nimbus Mono", "Courier New", Courier, monospace',
  },
  nimbusmon: {
    canonicalName: 'Nimbus Mono L',
    matchedGoogleFont: 'Cousine',
    category: 'monospace',
    isMetricCompatible: true,
    isSystemFont: true,
    cssStack: '"Nimbus Mono L", "Nimbus Mono", "Courier New", Courier, monospace',
  },
};

/**
 * Resolves commercial and system font aliases to their canonical definitions.
 */
export function resolveCommercialFontAlias(rawFontName: string): FontAliasResolution | null {
  if (!rawFontName) return null;
  const key = normalizeKey(rawFontName);

  let def = COMMERCIAL_FONT_MAP[key];
  if (!def) {
    if (key.startsWith('nimbusrom')) {
      def = COMMERCIAL_FONT_MAP['nimbusromno9l'];
    } else if (key.startsWith('nimbussan')) {
      def = COMMERCIAL_FONT_MAP['nimbussanl'];
    } else if (key.startsWith('nimbusmon')) {
      def = COMMERCIAL_FONT_MAP['nimbusmonl'];
    }
  }
  if (!def) return null;

  const lower = rawFontName.toLowerCase();
  const weight = lower.includes('bold') ? 'bold' : 'normal';
  const style = lower.includes('italic') || lower.includes('oblique') ? 'italic' : 'normal';

  return {
    canonicalName: def.canonicalName,
    matchedGoogleFont: def.matchedGoogleFont,
    category: def.category,
    isMetricCompatible: def.isMetricCompatible,
    cssStack: def.cssStack,
    isSystemFont: def.isSystemFont ?? false,
    weight,
    style,
  };
}

/**
 * Resolves TeX / LaTeX font naming conventions (Computer Modern, Latin Modern, TeX Gyre, packages).
 */
export function resolveLatexFont(rawFontName: string): FontAliasResolution | null {
  if (!rawFontName) return null;
  const key = normalizeKey(rawFontName);

  // 1. Computer Modern family (Knuth short names with optional optical sizes)
  const cmMatch = key.match(/^cm([a-z]+?)(\d*)$/);
  if (cmMatch) {
    const code = cmMatch[1];
    switch (code) {
      case 'r':
        return {
          canonicalName: 'Computer Modern Roman',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'normal',
          style: 'normal',
        };
      case 'bx':
        return {
          canonicalName: 'Computer Modern Bold Extended',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'bold',
          style: 'normal',
        };
      case 'b':
        return {
          canonicalName: 'Computer Modern Bold',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'bold',
          style: 'normal',
        };
      case 'ti':
        return {
          canonicalName: 'Computer Modern Text Italic',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'normal',
          style: 'italic',
        };
      case 'sl':
        return {
          canonicalName: 'Computer Modern Slanted',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'normal',
          style: 'italic',
