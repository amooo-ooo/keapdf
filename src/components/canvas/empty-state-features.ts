/**
 * Feature slide definitions and navigation helpers for the empty state showcase carousel.
 */

import { resolveNextSlideIndex } from '$lib/components/ui/carousel/index.js';

/**
 * Specification for a single feature slide in the empty state showcase carousel.
 */
export interface EmptyStateFeatureSlide {
  /** Stable identifier for keying the slide in templates. */
  readonly id: string;
  /** One-based display order of the slide. */
  readonly stepNumber: number;
  /** Concise label displayed on the next-step action button and indicator tooltips. */
  readonly shortTitle: string;
  /** Primary feature headline shown below the preview image. */
  readonly title: string;
  /** Practical user instructions describing the workflow. */
  readonly description: string;
  /** Preview image source path. */
  readonly imageSrc: string;
  /** Accessible alt text for the preview image. */
  readonly imageAlt: string;
}

/**
 * Default top five PDF editing use cases displayed on initial application load.
 */
export const DEFAULT_EMPTY_STATE_FEATURES: readonly EmptyStateFeatureSlide[] = [
  {
    id: 'reorder-merge-split',
    stepNumber: 1,
    shortTitle: 'Reorder & Merge',
    title: 'Reorder, merge and split documents',
    description:
      'Rearrange page order, combine multiple PDFs into a single file, or split documents into custom page ranges as easy as dragging and dropping thumbnails.',
    imageSrc: '/cover.jpg',
    imageAlt: 'KeaPDF Cover - Reorder, merge and split documents',
  },
  {
    id: 'inline-text-editing',
    stepNumber: 2,
    shortTitle: 'Edit Text',
    title: 'Edit text directly on the page',
    description:
      'Click any paragraph to update existing PDF text in place with automatic font matching and multi-line reflow, or place new text blocks anywhere on the canvas.',
    imageSrc: '/cover.jpg',
    imageAlt: 'KeaPDF Cover - Edit text directly on the page',
  },
  {
    id: 'annotate-and-redact',
    stepNumber: 3,
    shortTitle: 'Annotate & Redact',
    title: 'Annotate, highlight and redact',
    description:
      'Mark up passages with highlights, freehand ink, geometric shapes, and comments, or permanently sanitise and redact sensitive content before sharing.',
    imageSrc: '/cover.jpg',
    imageAlt: 'KeaPDF Cover - Annotate, highlight and redact',
  },
  {
    id: 'forms-and-signatures',
    stepNumber: 4,
    shortTitle: 'Forms & Sign',
    title: 'Fill forms and sign with certificates',
    description:
      'Complete interactive AcroForm fields, draw or type electronic signatures, and seal documents with cryptographic digital certificates verified entirely offline.',
    imageSrc: '/cover.jpg',
    imageAlt: 'KeaPDF Cover - Fill forms and sign with certificates',
  },
  {
    id: 'convert-and-export',
    stepNumber: 5,
    shortTitle: 'Convert & Export',
    title: 'Convert between PDF, Office and Markdown',
    description:
      'Transform Word, PowerPoint, Excel, CSV, HTML, and Markdown files directly into polished PDFs, or export loaded documents back to structured editable formats.',
    imageSrc: '/cover.jpg',
    imageAlt: 'KeaPDF Cover - Convert between PDF, Office and Markdown',
  },
] as const;

/**
 * Resolves the next feature slide in sequence with wrap-around looping.
 *
 * @param slides Collection of configured feature slides.
 * @param currentIndex Current zero-based active slide index.
 * @return The next feature slide definition.
 */
export function resolveNextFeatureSlide(
  slides: readonly EmptyStateFeatureSlide[],
  currentIndex: number
): EmptyStateFeatureSlide {
  if (slides.length === 0) {
    return DEFAULT_EMPTY_STATE_FEATURES[0];
  }
  const nextIndex = resolveNextSlideIndex(currentIndex, slides.length, true);
  return slides[nextIndex] ?? slides[0];
}
