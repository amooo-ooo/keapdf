/**
 * Registry and alias resolution engine for industry compliance test documents.
 *
 * Provides on-demand dynamic chunk loading for all compliance presets to eliminate
 * initial bundle overhead while delivering instant client-side PDF generation.
 */

export type {
  DemoPresetId,
  DemoDocumentPreset,
  DemoDocumentMetadata,
} from './types';
import type {
  DemoPresetId,
  DemoDocumentPreset,
  DemoDocumentMetadata,
} from './types';

export const demoPresetRegistry: Record<DemoPresetId, DemoDocumentPreset> = {
  'iso-32000-forms': {
    id: 'iso-32000-forms',
    aliases: ['forms', '160f', '160f-2019', 'acroform', 'acroforms', 'form', 'dod', 'interactive-forms'],
    title: 'State of Arizona Form 160-F',
    subtitle: 'Mozilla PDF.js AcroForm test suite with 30+ interactive fields & comb boxes',
    category: 'forms',
    standard: 'ISO 32000-1 Clause 12.7',
    origin: 'Mozilla PDF.js Test Suite / State of Arizona',
    description: 'Benchmark document used by Mozilla PDF.js and Acrobat to test AcroForm discovery, comb fields, calculation grids, checkmarks, and appearance streams.',
    fileName: '160F-2019.pdf',
    badge: 'AcroForms',
    pageCount: 1,
    expectedCapabilities: [
      'AcroForm field editing',
      'Comb text boxes',
      'Checkbox toggling',
      'Calculation grids',
      'PDF export & flattening',
    ],
    primaryUrl: 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/160F-2019.pdf',
    remoteFallbackUrls: [
      'https://raw.githubusercontent.com/Hopding/pdf-lib/master/assets/pdfs/dod_character.pdf',
      'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/forms.pdf',
    ],
    generateBuffer: async () => {
      const { generateFormsPdfBuffer } = await import('./generator-forms');
      return generateFormsPdfBuffer();
    },
    getCanvasElements: async () => {
      const { getFormsCanvasElements } = await import('./generator-forms');
      return getFormsCanvasElements();
    },
  },

  'typography-stress': {
    id: 'typography-stress',
    aliases: ['typography', 'tracemonkey', 'pldi', 'fonts', 'font-stress', 'reflow', 'academic'],
    title: 'TraceMonkey PLDI 2009 Paper',
    subtitle: 'Canonical Mozilla PDF.js benchmark: 14 pages of dense 2-column text, subset fonts & math',
    category: 'typography',
    standard: 'ISO 32000-1 Clause 9',
    origin: 'Mozilla PDF.js Core Benchmark (Andreas Gal et al.)',
    description: 'Dense two-column academic paper with embedded Type 1 and TrueType subset fonts, mathematical formulae, sub/superscripts, vector figures, and multi-column footnotes.',
    fileName: 'compressed.tracemonkey-pldi-09.pdf',
    badge: '14 Pages',
    pageCount: 14,
    expectedCapabilities: [
      'Text selection & highlight',
      'Inline text editing',
      'Paragraph reflow & word wrap',
      'Font metrics & kerning',
      'Sub/superscript alignment',
    ],
    primaryUrl: 'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf',
    remoteFallbackUrls: [
      'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/tracemonkey.pdf',
    ],
    generateBuffer: async () => {
      const { generateTypographyPdfBuffer } = await import('./generator-typography');
      return generateTypographyPdfBuffer();
    },
    getCanvasElements: async () => {
      const { getTypographyCanvasElements } = await import('./generator-typography');
      return getTypographyCanvasElements();
    },
  },

  'vector-graphics': {
    id: 'vector-graphics',
    aliases: ['vector', 'alphatrans', 'graphics', 'shapes', 'transparency', 'drawing'],
    title: 'Alpha Transparency & Blend Modes',
    subtitle: 'Mozilla PDF.js vector engine test suite with soft masks & composite graphics',
    category: 'vector',
    standard: 'ISO 32000-1 Clause 8',
    origin: 'Mozilla PDF.js Vector Test Suite',
    description: 'Validates PDF graphics state rendering, alpha transparency channels, soft masks, composite vector paths, and blend modes across overlapping geometric shapes.',
    fileName: 'alphatrans.pdf',
    badge: 'Vector',
    pageCount: 1,
    expectedCapabilities: [
      'Shape creation & mutation',
      'Stroke width & dashing',
      'Alpha opacity blending',
      'Vector transform matrix',
      'Color gamut rendering',
    ],
    primaryUrl: 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/alphatrans.pdf',
    remoteFallbackUrls: [
      'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/basic_shapes.pdf',
    ],
    generateBuffer: async () => {
      const { generateVectorPdfBuffer } = await import('./generator-vector');
      return generateVectorPdfBuffer();
    },
    getCanvasElements: async () => {
      const { getVectorCanvasElements } = await import('./generator-vector');
      return getVectorCanvasElements();
    },
  },

  'linearized-multipage': {
    id: 'linearized-multipage',
    aliases: ['multipage', 'freeculture', 'publication', 'report', 'linearized', 'book'],
    title: 'Free Culture (Full Book, 270+ Pages)',
    subtitle: 'Lawrence Lessig published book used by PDF.js to benchmark LRU caching & virtualization',
    category: 'multipage',
    standard: 'ISO 32000-1 / Scale Benchmark',
    origin: 'Lawrence Lessig / Mozilla PDF.js Scale Suite',
    description: 'Full-length published book used to stress-test large publication navigation, page virtualization, LRU memory cache eviction, outline hierarchies, and multi-page layout caching.',
    fileName: 'freeculture.pdf',
    badge: '270+ Pages',
    pageCount: 270,
    expectedCapabilities: [
      'Virtual scroll performance',
      'LRU page cache disposal',
      'Cross-page dragging',
      'Page reordering & rotation',
      'Document text search',
    ],
    primaryUrl: 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/freeculture.pdf',
    remoteFallbackUrls: [
      'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf',
    ],
    generateBuffer: async () => {
      const { generateMultipagePdfBuffer } = await import('./generator-multipage');
      return generateMultipagePdfBuffer();
    },
    getCanvasElements: async () => {
      const { getMultipageCanvasElements } = await import('./generator-multipage');
      return getMultipageCanvasElements();
    },
  },

  'pdfa-signatures': {
    id: 'pdfa-signatures',
    aliases: ['signatures', 'with_signature', 'signed', 'pdfa', 'crypto', 'digital-sign'],
    title: 'Cryptographic Digital Signatures',
    subtitle: 'Official Hopding pdf-lib benchmark with /Sig dictionary & signed visual appearance',
    category: 'security',
    standard: 'ISO 19005-1 / Clause 12.8',
    origin: 'Hopding pdf-lib Benchmark / Adobe Acrobat Signed',
    description: 'Cryptographically signed document containing digital signature dictionary (/Sig), visual signature appearance, byte range hashes, and PKCS#7 / XMP metadata.',
    fileName: 'with_signature.pdf',
    badge: 'Signed',
    pageCount: 1,
    expectedCapabilities: [
      'Signature appearance detection',
      'Electronic signature stamp',
      'Metadata dictionary inspection',
      'Sanitization audit',
      'Visual cert placement',
    ],
    primaryUrl: 'https://raw.githubusercontent.com/Hopding/pdf-lib/master/assets/pdfs/with_signature.pdf',
    remoteFallbackUrls: [
      'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/signed.pdf',
    ],
    generateBuffer: async () => {
      const { generateSignaturesPdfBuffer } = await import('./generator-signatures');
      return generateSignaturesPdfBuffer();
    },
    getCanvasElements: async () => {
      const { getSignaturesCanvasElements } = await import('./generator-signatures');
      return getSignaturesCanvasElements();
    },
  },

  'annotations-redaction': {
    id: 'annotations-redaction',
    aliases: ['annotations', 'comments', 'notes', 'redact', 'markup', 'review'],
    title: 'Native Annotations & Comment Threads',
    subtitle: 'Mozilla PDF.js test suite with real popup notes, highlights & freehand ink lines',
    category: 'annotations',
    standard: 'ISO 32000-1 Clause 12.5',
    origin: 'Mozilla PDF.js Annotation Test Suite',
    description: 'Document loaded with real-world PDF annotations: popup comments, sticky notes, freehand ink lines, text highlights, strikeout markups, and author review threads.',
    fileName: 'comments.pdf',
    badge: 'Annotations',
    pageCount: 2,
    expectedCapabilities: [
      'Highlight range selection',
      'Sticky note placement & edit',
      'Freehand ink drawing',
      'Legal redaction blackout',
      'Permanent PII scrubbing',
    ],
    primaryUrl: 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/comments.pdf',
    remoteFallbackUrls: [
      'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/annotation-line.pdf',
    ],
    generateBuffer: async () => {
      const { generateAnnotationsPdfBuffer } = await import('./generator-annotations');
      return generateAnnotationsPdfBuffer();
    },
    getCanvasElements: async () => {
      const { getAnnotationsCanvasElements } = await import('./generator-annotations');
      return getAnnotationsCanvasElements();
    },
  },
};

/**
 * Resolves a given query identifier or alias to a matching DemoDocumentPreset.
 * Matches case-insensitively and returns null if no match is found.
 */
export function resolveDemoPreset(identifier: string): DemoDocumentPreset | null {
  if (!identifier || typeof identifier !== 'string') return null;
  const normalized = identifier.trim().toLowerCase();
  if (normalized.length === 0) return null;

  // Direct ID check
  if (normalized in demoPresetRegistry) {
    return demoPresetRegistry[normalized as DemoPresetId];
  }

  // Check aliases
  for (const preset of Object.values(demoPresetRegistry)) {
    if (preset.id === normalized) return preset;
    if (preset.aliases.some((alias) => alias.toLowerCase() === normalized)) {
      return preset;
    }
  }

  return null;
}

/**
 * Returns an array of all registered DemoDocumentPreset instances.
 */
export function getAllDemoPresets(): DemoDocumentPreset[] {
  return Object.values(demoPresetRegistry);
}

/**
 * Returns a lightweight metadata list suitable for UI presentation.
 */
export function getDemoPresetMetadataList(): DemoDocumentMetadata[] {
  return Object.values(demoPresetRegistry).map((preset) => ({
    id: preset.id,
    aliases: preset.aliases,
    title: preset.title,
    subtitle: preset.subtitle,
    category: preset.category,
    standard: preset.standard,
    origin: preset.origin,
    description: preset.description,
    fileName: preset.fileName,
    badge: preset.badge,
    pageCount: preset.pageCount,
    expectedCapabilities: preset.expectedCapabilities,
    primaryUrl: preset.primaryUrl,
    remoteFallbackUrls: preset.remoteFallbackUrls,
  }));
}
