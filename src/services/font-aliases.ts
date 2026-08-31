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
        };
      case 'csc':
        return {
          canonicalName: 'Computer Modern Small Caps',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'normal',
          style: 'normal',
        };
      case 'tt':
      case 'tcsc':
        return {
          canonicalName: 'Computer Modern Typewriter',
          matchedGoogleFont: 'Source Code Pro',
          category: 'monospace',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_MONO,
          weight: 'normal',
          style: 'normal',
        };
      case 'itt':
      case 'sltt':
        return {
          canonicalName: 'Computer Modern Typewriter',
          matchedGoogleFont: 'Source Code Pro',
          category: 'monospace',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_MONO,
          weight: 'normal',
          style: 'italic',
        };
      case 'ss':
        return {
          canonicalName: 'Computer Modern Sans',
          matchedGoogleFont: 'Source Sans 3',
          category: 'sans-serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SANS,
          weight: 'normal',
          style: 'normal',
        };
      case 'ssbx':
        return {
          canonicalName: 'Computer Modern Sans Bold Extended',
          matchedGoogleFont: 'Source Sans 3',
          category: 'sans-serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SANS,
          weight: 'bold',
          style: 'normal',
        };
      case 'ssi':
        return {
          canonicalName: 'Computer Modern Sans Slanted',
          matchedGoogleFont: 'Source Sans 3',
          category: 'sans-serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SANS,
          weight: 'normal',
          style: 'italic',
        };
      case 'mi':
        return {
          canonicalName: 'Computer Modern Math Italic',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'normal',
          style: 'italic',
        };
      case 'mib':
        return {
          canonicalName: 'Computer Modern Math Italic Bold',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'bold',
          style: 'italic',
        };
      case 'sy':
        return {
          canonicalName: 'Computer Modern Math Symbol',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'normal',
          style: 'normal',
        };
      case 'bsy':
        return {
          canonicalName: 'Computer Modern Bold Math Symbol',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'bold',
          style: 'normal',
        };
      case 'ex':
        return {
          canonicalName: 'Computer Modern Math Extension',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'normal',
          style: 'normal',
        };
    }
  }

  // 2. Latin Modern family (GUST consortium)
  const lmMatch = key.match(/^lm([a-z]+?)(\d*)$/);
  if (lmMatch) {
    const code = lmMatch[1];
    switch (code) {
      case 'r':
        return {
          canonicalName: 'Latin Modern Roman',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'normal',
          style: 'normal',
        };
      case 'bx':
        return {
          canonicalName: 'Latin Modern Bold Extended',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'bold',
          style: 'normal',
        };
      case 'b':
        return {
          canonicalName: 'Latin Modern Demi',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'bold',
          style: 'normal',
        };
      case 'ti':
        return {
          canonicalName: 'Latin Modern Text Italic',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'normal',
          style: 'italic',
        };
      case 'sl':
      case 'ro':
        return {
          canonicalName: 'Latin Modern Slanted',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'normal',
          style: 'italic',
        };
      case 'csc':
      case 'cso':
        return {
          canonicalName: 'Latin Modern Small Caps',
          matchedGoogleFont: 'STIX Two Text',
          category: 'serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SERIF,
          weight: 'normal',
          style: 'normal',
        };
      case 'ss':
      case 'sans':
        return {
          canonicalName: 'Latin Modern Sans',
          matchedGoogleFont: 'Source Sans 3',
          category: 'sans-serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SANS,
          weight: 'normal',
          style: 'normal',
        };
      case 'ssbx':
        return {
          canonicalName: 'Latin Modern Sans Bold Extended',
          matchedGoogleFont: 'Source Sans 3',
          category: 'sans-serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SANS,
          weight: 'bold',
          style: 'normal',
        };
      case 'sso':
        return {
          canonicalName: 'Latin Modern Sans Oblique',
          matchedGoogleFont: 'Source Sans 3',
          category: 'sans-serif',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_SANS,
          weight: 'normal',
          style: 'italic',
        };
      case 'tt':
      case 'mono':
      case 'tc':
      case 'tk':
        return {
          canonicalName: 'Latin Modern Typewriter',
          matchedGoogleFont: 'Source Code Pro',
          category: 'monospace',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_MONO,
          weight: 'normal',
          style: 'normal',
        };
      case 'to':
      case 'tti':
      case 'tlo':
        return {
          canonicalName: 'Latin Modern Typewriter Oblique',
          matchedGoogleFont: 'Source Code Pro',
          category: 'monospace',
          isMetricCompatible: false,
          cssStack: CSS_STACK_LATEX_MONO,
          weight: 'normal',
          style: 'italic',
        };
    }
  }

  // 3. TeX Gyre family codes
  if (key.startsWith('qtm')) {
    return {
      canonicalName: 'TeX Gyre Termes',
      matchedGoogleFont: 'Tinos',
      category: 'serif',
      isMetricCompatible: true,
      cssStack: '"TeX Gyre Termes", "Tinos", "Times New Roman", Times, serif',
    };
  }
  if (key.startsWith('qhv')) {
    return {
      canonicalName: 'TeX Gyre Heros',
      matchedGoogleFont: 'Arimo',
      category: 'sans-serif',
      isMetricCompatible: true,
      cssStack: '"TeX Gyre Heros", "Arimo", Helvetica, Arial, sans-serif',
    };
  }
  if (key.startsWith('qcr')) {
    return {
      canonicalName: 'TeX Gyre Cursor',
      matchedGoogleFont: 'Cousine',
      category: 'monospace',
      isMetricCompatible: true,
      cssStack: '"TeX Gyre Cursor", "Cousine", "Courier New", Courier, monospace',
    };
  }
  if (key.startsWith('qpl')) {
    return {
      canonicalName: 'TeX Gyre Pagella',
      matchedGoogleFont: 'Cinzel',
      category: 'serif',
      isMetricCompatible: false,
      cssStack: '"TeX Gyre Pagella", "Palatino Linotype", Palatino, serif',
    };
  }
  if (key.startsWith('qbk')) {
    return {
      canonicalName: 'TeX Gyre Bonum',
      matchedGoogleFont: 'Besley',
      category: 'serif',
      isMetricCompatible: false,
      cssStack: '"TeX Gyre Bonum", "ITC Bookman", Bookman, serif',
    };
  }
  if (key.startsWith('qcs')) {
    return {
      canonicalName: 'TeX Gyre Schola',
      matchedGoogleFont: 'Tinos',
      category: 'serif',
      isMetricCompatible: false,
      cssStack: '"TeX Gyre Schola", "New Century Schoolbook", Century, serif',
    };
  }
  if (key.startsWith('qag')) {
    return {
      canonicalName: 'TeX Gyre Adventor',
      matchedGoogleFont: 'Questrial',
      category: 'sans-serif',
      isMetricCompatible: false,
      cssStack: '"TeX Gyre Adventor", "ITC Avant Garde", "Century Gothic", sans-serif',
    };
  }
  if (key.startsWith('qzc')) {
    return {
      canonicalName: 'TeX Gyre Chorus',
      matchedGoogleFont: 'Dancing Script',
      category: 'handwriting',
      isMetricCompatible: false,
      cssStack: '"TeX Gyre Chorus", "Zapf Chancery", cursive',
    };
  }

  // 4. Common LaTeX package font names
  if (
    key.startsWith('newtx') ||
    key.startsWith('ntxtmr') ||
    key.startsWith('txr') ||
    key.startsWith('txb') ||
    key.startsWith('txi') ||
    key.startsWith('mathptmx') ||
    key.startsWith('ztmr')
  ) {
    return {
      canonicalName: 'Times New Roman',
      matchedGoogleFont: 'Tinos',
      category: 'serif',
      isMetricCompatible: true,
      cssStack: '"Tinos", "Times New Roman", Times, serif',
    };
  }

  if (
    key.startsWith('newpx') ||
    key.startsWith('npxr') ||
    key.startsWith('pxr') ||
    key.startsWith('pxb') ||
    key.startsWith('mathpazo') ||
    key.startsWith('fplmr')
  ) {
    return {
      canonicalName: 'Palatino',
      matchedGoogleFont: 'Cinzel',
      category: 'serif',
      isMetricCompatible: false,
      cssStack: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
    };
  }

  if (key.startsWith('fourier') || key.startsWith('futr')) {
    return {
      canonicalName: 'Utopia',
      matchedGoogleFont: 'STIX Two Text',
      category: 'serif',
      isMetricCompatible: false,
      cssStack: 'Utopia, "STIX Two Text", Georgia, serif',
    };
  }

  if (key.startsWith('charter') || key.startsWith('xcharter') || key.startsWith('bchr')) {
    return {
      canonicalName: 'Charter',
      matchedGoogleFont: 'STIX Two Text',
      category: 'serif',
      isMetricCompatible: false,
      cssStack: '"Bitstream Charter", Charter, "STIX Two Text", Georgia, serif',
    };
  }

  if (key.startsWith('stix')) {
    return {
      canonicalName: 'STIX Two Text',
      matchedGoogleFont: 'STIX Two Text',
      category: 'serif',
      isMetricCompatible: true,
      cssStack: '"STIX Two Text", "Times New Roman", Times, serif',
    };
  }

  if (key.startsWith('msam') || key.startsWith('msbm')) {
    return {
      canonicalName: 'AMS Math Symbols',
      matchedGoogleFont: 'STIX Two Text',
      category: 'serif',
      isMetricCompatible: false,
      cssStack: '"STIX Two Text", serif',
    };
  }

  if (key.startsWith('eurm') || key.startsWith('eurb')) {
    return {
      canonicalName: 'AMS Euler',
      matchedGoogleFont: 'STIX Two Text',
      category: 'serif',
      isMetricCompatible: false,
      cssStack: '"STIX Two Text", serif',
    };
  }

  if (key.startsWith('ccr')) {
    return {
      canonicalName: 'Concrete Roman',
      matchedGoogleFont: 'STIX Two Text',
      category: 'serif',
      isMetricCompatible: false,
      cssStack: CSS_STACK_LATEX_SERIF,
    };
  }

  return null;
}

/**
 * Typeface abbreviations in the Karl Berry scheme.
 */
const BERRY_TYPEFACES: Record<string, { name: string; category: FontCategory; googleFont: string }> = {
  tm: { name: 'Times New Roman', category: 'serif', googleFont: 'Tinos' },
  hv: { name: 'Helvetica', category: 'sans-serif', googleFont: 'Arimo' },
  cr: { name: 'Courier New', category: 'monospace', googleFont: 'Cousine' },
  pl: { name: 'Palatino', category: 'serif', googleFont: 'Cinzel' },
  ch: { name: 'Charter', category: 'serif', googleFont: 'STIX Two Text' },
  nc: { name: 'New Century Schoolbook', category: 'serif', googleFont: 'Tinos' },
  bk: { name: 'ITC Bookman', category: 'serif', googleFont: 'Besley' },
  ag: { name: 'ITC Avant Garde', category: 'sans-serif', googleFont: 'Questrial' },
  zc: { name: 'ITC Zapf Chancery', category: 'handwriting', googleFont: 'Dancing Script' },
  zd: { name: 'ITC Zapf Dingbats', category: 'display', googleFont: 'Arial' },
  sy: { name: 'Symbol', category: 'serif', googleFont: 'STIX Two Text' },
  ut: { name: 'Utopia', category: 'serif', googleFont: 'STIX Two Text' },
  fr: { name: 'Frutiger', category: 'sans-serif', googleFont: 'Hind' },
  op: { name: 'Optima', category: 'sans-serif', googleFont: 'Marcellus' },
  un: { name: 'Univers', category: 'sans-serif', googleFont: 'Roboto' },
  gs: { name: 'Gill Sans', category: 'sans-serif', googleFont: 'Cabin' },
  bd: { name: 'Bodoni', category: 'serif', googleFont: 'Bodoni Moda' },
  ga: { name: 'Garamond', category: 'serif', googleFont: 'EB Garamond' },
};

/**
 * Decodes Karl Berry dvips/pdflatex font names (e.g. ptmr8t, phvb8t, pcrr8t).
 * Pattern: S TT W [V] [E]
 * Length: typically 6 to 8 characters.
 */
export function resolveBerryCode(rawFontName: string): FontAliasResolution | null {
  if (!rawFontName) return null;
  const key = normalizeKey(rawFontName);

  // Must be between 5 and 9 characters and start with a known foundry code
  if (key.length < 5 || key.length > 9) return null;
  const supplier = key.charAt(0);
  if (!/[pbmuqfghijlt]/.test(supplier)) return null;

  const typefaceCode = key.substring(1, 3);
  const tf = BERRY_TYPEFACES[typefaceCode];
  if (!tf) return null;

  const remainder = key.substring(3);
  const isBold = remainder.includes('b') || remainder.includes('d') || remainder.includes('k');
  const isItalic = remainder.includes('i') || remainder.includes('o');

  let cssStack = `"${tf.name}", sans-serif`;
  if (tf.category === 'serif') {
    cssStack = `"${tf.name}", "${tf.googleFont}", Georgia, "Times New Roman", serif`;
  } else if (tf.category === 'monospace') {
    cssStack = `"${tf.name}", "${tf.googleFont}", "Courier New", monospace`;
  } else if (tf.category === 'sans-serif') {
    cssStack = `"${tf.name}", "${tf.googleFont}", Arial, Helvetica, sans-serif`;
  }

  return {
    canonicalName: tf.name,
    matchedGoogleFont: tf.googleFont,
    category: tf.category,
    isMetricCompatible: ['tm', 'hv', 'cr'].includes(typefaceCode),
    cssStack,
    isSystemFont: ['tm', 'hv', 'cr'].includes(typefaceCode),
    weight: isBold ? 'bold' : 'normal',
    style: isItalic ? 'italic' : 'normal',
  };
}

/**
 * Master font alias resolver:
 * Runs input through commercial aliases, LaTeX/TeX parsers, and Berry decoders.
 */
export function resolveFontAlias(rawFontName: string): FontAliasResolution | null {
  if (!rawFontName) return null;

  // 1. Direct commercial match (Calibri, Cambria, Arial, etc.)
  const comm = resolveCommercialFontAlias(rawFontName);
  if (comm) return comm;

  // 2. LaTeX Computer Modern / Latin Modern / Package match
  const latex = resolveLatexFont(rawFontName);
  if (latex) return latex;

  // 3. Karl Berry dvips scheme decoder
  const berry = resolveBerryCode(rawFontName);
  if (berry) return berry;

  return null;
}
