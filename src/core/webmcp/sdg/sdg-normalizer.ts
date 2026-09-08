/**
 * Text normalisation utilities for WebMCP anchor verification.
 *
 * Implements Section 5.2 of webmcp-pdf-editor-spec.md:
 * 1. Unicode normalisation form NFC applied to all strings.
 * 2. Runs of whitespace (including non-breaking space, tab, soft-hyphen breaks)
 *    collapsed to a single ASCII space.
 * 3. Leading and trailing whitespace trimmed.
 * 4. Applied identically to read tool responses and anchor validation.
 */

/**
 * Regular expression matching soft hyphens and zero-width spaces.
 */
const ZERO_WIDTH_OR_SOFT_HYPHEN = /[\u00AD\u200B\u200C\u200D\uFEFF]/g;

/**
 * Regular expression matching runs of whitespace characters including
 * non-breaking space (U+00A0), ideographic space (U+3000), tabs, and line breaks.
 */
const WHITESPACE_RUN_REGEX = /[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g;

/**
 * Normalises a text string according to WebMCP Section 5.2.
 *
 * @param text The input string to normalise.
 * @returns The NFC-normalised, whitespace-collapsed, trimmed string.
 */
export function normalizeText(text: string | null | undefined): string {
  if (!text) {
    return '';
  }

  // 1. Unicode NFC normalisation
  const nfc = text.normalize('NFC');

  // 2. Strip soft hyphens and invisible zero-width separators
  const stripped = nfc.replace(ZERO_WIDTH_OR_SOFT_HYPHEN, '');

  // 3. Collapse whitespace runs to single ASCII space and trim
  return stripped.replace(WHITESPACE_RUN_REGEX, ' ').trim();
}

/**
 * Compares an anchor text against a live SDG node text for exact equality after normalisation.
 *
 * @param liveText The authoritative text currently in the SDG node.
 * @param anchorText The anchor text supplied by the caller.
 * @returns True if normalised strings match byte-for-byte; false otherwise.
 */
export function verifyAnchorMatch(
  liveText: string | null | undefined,
  anchorText: string | null | undefined
): boolean {
  const normLive = normalizeText(liveText);
  const normAnchor = normalizeText(anchorText);
  return normLive === normAnchor;
}
