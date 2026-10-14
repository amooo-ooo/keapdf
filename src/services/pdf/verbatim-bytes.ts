import type { PageTransform } from '../../stores/types';

/**
 * Verbatim source byte resolution for PDF output paths.
 *
 * Re-saving through PDFium rewrites every object and renumbers byte offsets, which breaks the
 * /ByteRange digest of every digital signature in the file. Whenever the in-memory document is
 * identical to the bytes it was loaded from, callers should emit those bytes unchanged instead.
 */

/** Minimal document surface needed to decide whether the source bytes are still authoritative. */
export interface VerbatimBytesSource {
  /** Reports pending PDFium edits, form values, annotations, or non-identity page transforms. */
  hasUnbakedModifications?: (pageTransforms?: Record<number, PageTransform>) => boolean;
  /** Returns the bytes the document was last loaded from. */
  getRawBuffer?: () => ArrayBuffer | Uint8Array | null;
}

/**
 * Returns the loaded source bytes when no unbaked edits exist, so they can be written verbatim.
 *
 * @param source Document exposing its modification state and source buffer.
 * @param pageTransforms Optional active visual page transforms.
 * @return The untouched source bytes, or null when the document must be re-serialised.
 */
export function resolveVerbatimPdfBytes(
  source: VerbatimBytesSource,
  pageTransforms?: Record<number, PageTransform>
): Uint8Array | null {
  if (typeof source.hasUnbakedModifications !== 'function' || typeof source.getRawBuffer !== 'function') {
    return null;
  }
  if (source.hasUnbakedModifications(pageTransforms)) return null;

  const raw = source.getRawBuffer();
  if (!raw || raw.byteLength === 0) return null;
  return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
}
