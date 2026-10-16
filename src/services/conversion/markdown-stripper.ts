/**
 * Pure utility for stripping Markdown syntax delimiters and outline attributes from text strings.
 * Preserves readable text content while removing emphasis markers, link syntax,
 * heading prefixes, custom anchor attributes, and inline code delimiters for clean titles and metadata.
 */

export interface ParsedHeadingAttributes {
  readonly text: string;
  readonly id?: string;
  readonly explicitLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly unlisted?: boolean;
}

/**
 * Normalises a heading title or custom anchor identifier into a canonical kebab-case slug.
 *
 * @param input Raw heading text or attribute identifier.
 * @return Normalised lowercase kebab-case slug.
 */
export function slugifyHeadingId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[:#]+/, '')
    .replace(/[^a-z0-9\u00C0-\u024F]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parses and strips Markdown heading attribute and outline blocks such as {#heading 1},
 * {#custom-id}, {:#kramdown-id}, {#id .class key=val}, {-}, and trailing ATX closing hashes.
 *
 * @param rawText Raw heading text or standalone line.
 * @return Cleaned heading text along with extracted anchor ID, explicit level, and unlisted state.
 */
export function extractMarkdownHeadingAttributes(rawText: string): ParsedHeadingAttributes {
  if (!rawText) {
    return { text: '' };
  }

  let working = rawText.trim();
  let extractedId: string | undefined;
  let explicitLevel: 1 | 2 | 3 | 4 | 5 | 6 | undefined;
  let unlisted: boolean | undefined;

  function processAttrPayload(payload: string): void {
    const inner = payload.trim();
    if (inner === '-' || /(?:^|\s)\.(?:unnumbered|unlisted)(?:\s|$)/i.test(inner)) {
      unlisted = true;
    }

    // Check explicit outline heading level patterns: #heading 1, #heading-2, #h3
    const headingLevelMatch = /^:?\s*#\s*(?:heading[\s_-]*|h)([1-6])(?:\b|[\s:_-]*(.*))$/i.exec(inner);
    if (headingLevelMatch) {
      const lvl = parseInt(headingLevelMatch[1], 10) as 1 | 2 | 3 | 4 | 5 | 6;
      explicitLevel = lvl;
      extractedId = `heading-${lvl}`;
      return;
    }

    // Extract custom ID token (#custom-id or #custom id with spaces when no class/key tokens follow)
    const idTokenMatch = /^:?\s*#([^\s.}]+(?:\s+[^\s.=}]+)*)/.exec(inner);
    if (idTokenMatch) {
      const slug = slugifyHeadingId(idTokenMatch[1]);
      if (slug.length > 0) {
        extractedId = slug;
      }
      return;
    }

    // Also inspect multi-token Pandoc/Kramdown attribute lists where #id may appear after classes
    const embeddedIdMatch = /(?:^|\s):?#([a-zA-Z0-9_-]+)/.exec(inner);
    if (embeddedIdMatch) {
      const slug = slugifyHeadingId(embeddedIdMatch[1]);
      if (slug.length > 0) {
        extractedId = slug;
      }
    }
  }

  // Handle inline colon syntax {#heading 1: Actual Title} or {#h2: Actual Title}
  const inlineColonHeadingMatch = /^\{\s*:?\s*#\s*(?:heading[\s_-]*|h)([1-6])\s*:\s*([^}]+)\}$/i.exec(working);
  if (inlineColonHeadingMatch) {
    const lvl = parseInt(inlineColonHeadingMatch[1], 10) as 1 | 2 | 3 | 4 | 5 | 6;
    return {
      text: inlineColonHeadingMatch[2].trim(),
      id: `heading-${lvl}`,
      explicitLevel: lvl,
    };
  }

  // Strip leading outline attribute prefix e.g. {#heading 1} Title or {#h2} Title
  const leadingAttrMatch = /^\{(\s*:?\s*#\s*(?:heading[\s_-]*|h)[1-6]\b[^}]*)\}\s+(.+)$/i.exec(working);
  if (leadingAttrMatch) {
    processAttrPayload(leadingAttrMatch[1]);
    working = leadingAttrMatch[2].trim();
  }

  // Iteratively strip trailing Markdoc {% #id %} or Pandoc/Extra/Kramdown {#...} / {:#...} / {-} blocks
  let strippedTrailing = true;
  while (strippedTrailing) {
    strippedTrailing = false;

    const markdocMatch = /\s*\{%\s*(#[^%]+?)\s*%\}\s*$/.exec(working);
    if (markdocMatch) {
      processAttrPayload(markdocMatch[1]);
      working = working.slice(0, markdocMatch.index).trim();
      strippedTrailing = true;
      continue;
    }

    const curlyMatch = /\s*\{\s*(:?\s*#[^}]*|-|\.[a-zA-Z0-9_.-]+(?:\s+[^}]*)?)\s*\}\s*$/.exec(working);
    if (curlyMatch) {
      processAttrPayload(curlyMatch[1]);
      working = working.slice(0, curlyMatch.index).trim();
      strippedTrailing = true;
    }
  }

  // Strip optional closing ATX hashes (e.g. "## Heading ##")
  working = working.replace(/\s+#+\s*$/, '').trim();

  return {
    text: working,
    ...(extractedId ? { id: extractedId } : {}),
    ...(explicitLevel ? { explicitLevel } : {}),
    ...(unlisted ? { unlisted: true } : {}),
  };
}

/**
 * Strips Markdown formatting delimiters from a text string while preserving literal content.
 *
 * @param input Raw Markdown text string.
 * @return Clean text string with Markdown delimiters removed.
 */
export function stripMarkdownFormatting(input: string): string {
  if (!input) return '';

  // Mask escaped characters using ASCII control sentinels
  let text = input.replace(/\\([*_`~[\]$\\<>{}#])/g, (_, ch: string) => `\x00ESC_${ch.charCodeAt(0)}\x00`);

  // Strip leading heading hashes and blockquote markers
  text = text.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*>\s*/, '');

  // Strip heading outline and attribute blocks such as {#heading 1}, {#custom-id}, {:#id}, {-}
  text = extractMarkdownHeadingAttributes(text).text;
  text = text.replace(/\s*\{\s*(?::?\s*#[^}]*|-)\s*\}/g, '');

  // Strip images: ![alt](url) -> alt
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // Strip links iteratively to handle formatting inside link text: [label](url) -> label
  text = text.replace(/\[((?:\\\]|[^\]])+)\]\([^)\s]+(?:\s+"[^"]*")?\)/g, '$1');

  // Strip autolinks: <https://...> or <user@domain.com> -> url
  text = text.replace(/<([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s>]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/g, '$1');

  // Strip inline code and inline math delimiters
  text = text.replace(/`([^`\n]+)`/g, '$1');
  text = text.replace(/\$([^$\n]+)\$/g, '$1');

  // Iteratively strip nested emphasis delimiters (triple, mixed, double, single, strikethrough)
  let previous = '';
  let iterations = 0;
  while (text !== previous && iterations < 6) {
    previous = text;
    iterations++;

    // Triple emphasis: ***text*** or ___text___
    text = text.replace(/(?:\*\*\*|___)(?!\s)(.+?)(?<!\s)(?:\*\*\*|___)/g, '$1');

    // Mixed bold and italic combinations
    text = text.replace(/\*\*_(?!\s)(.+?)(?<!\s)_\*\*/g, '$1');
    text = text.replace(/\*__(?!\s)(.+?)(?<!\s)__\*/g, '$1');
    text = text.replace(/__\*(?!\s)(.+?)(?<!\s)\*__/g, '$1');
    text = text.replace(/_\*\*(?!\s)(.+?)(?<!\s)\*\*_/g, '$1');

    // Bold: **text** or __text__
    text = text.replace(/(?:\*\*|__)(?!\s)(.+?)(?<!\s)(?:\*\*|__)/g, '$1');

    // Strikethrough: ~~text~~
    text = text.replace(/~~(?!\s)(.+?)(?<!\s)~~/g, '$1');

    // Italic: *text* or _text_
    text = text.replace(/(?:\*|_)(?!\s)(.+?)(?<!\s)(?:\*|_)/g, '$1');
  }

  // Unmask escaped characters back to literal characters
  return text.replace(/\x00ESC_(\d+)\x00/g, (_, code: string) => String.fromCharCode(Number(code))).trim();
}

