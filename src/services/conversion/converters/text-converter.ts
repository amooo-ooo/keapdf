/**
 * Text, Markdown, and Code to PDF Converter.
 * Parses markdown, plain text, and code files into an IDR FlowDocument and renders through pdf-layout-engine.
 */

import { PDFDocument } from 'pdf-lib';
import type {
  ConversionInputItem,
  ConvertedDocumentResult,
  DocumentConversionOptions,
  FlowDocument,
  DocumentBlock,
  TableBlock,
  TableRow,
  TableCell,
  StyledRun,
  TextStyle,
  ListItem,
  BlockAlignment,
  FormatConverter,
} from '../types';
import { layoutFlowDocument } from '../pdf-layout-engine';
import { sanitizeTextForWinAnsi } from '../winansi-sanitizer';
import { extractMarkdownHeadingAttributes } from '../markdown-stripper';

/**
 * Pretty prints JSON text with 2-space indentation, falling back to raw text if invalid.
 */
export function formatJsonText(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

/**
 * Merges two TextStyle objects, combining boolean flags and overriding scalar properties.
 */
function mergeStyles(base?: TextStyle, override?: TextStyle): TextStyle | undefined {
  if (!base && !override) return undefined;
  return {
    ...(base ?? {}),
    ...(override ?? {}),
  };
}

/**
 * Parses inline Markdown formatting into styled runs.
 * Supports escaped characters, links, autolinks, inline math, nested bold/italic, code, and strikethrough.
 */
export function parseInlineMarkdown(
  text: string,
  inheritedStyle?: TextStyle,
  inheritedLink?: string
): StyledRun[] {
  if (text.length === 0) return [];

  const cleanedInput =
    !text.includes('`') && !text.includes('\\{')
      ? text.replace(
          /[ \t]*\{\s*(?::?\s*#[a-zA-Z0-9_\s.-]+|-|\.[a-zA-Z0-9_.-]+(?:\s+[^}]*)?)\s*\}\s*$/,
          ''
        )
      : text;
  if (cleanedInput.length === 0) return [];

  const rawRuns: StyledRun[] = [];
  const regex =
    /\\([\\`*_{}\[\]()#+\-.!~$])|<((?:https?:\/\/|mailto:)[^>\s]+)>|\[((?:[^\[\]]|\[[^\]]*\])+)\]\(([^)]+)\)|(`+)([\s\S]*?)\5|\$(?!\s|\d+\s)([^$\n]+?)(?<!\s)\$|(\*\*\*|___)(?=\S)([\s\S]*?\S)\8|(\*\*|__)(?=\S)([\s\S]*?\S)\10|\*(?!\*|\s)((?:[^*]|\*\*[^*]+?\*\*)+?)(?<!\s|\*)\*(?!\*)|_(?!_|\s)((?:[^_]|__[^_]+?__)+?)(?<!\s|_)_(?!_)|(~~)(?=\S)([\s\S]*?\S)\14|([^\\<\[`$*_~]+)|([\s\S])/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleanedInput)) !== null) {
    if (match[1] !== undefined) {
      // Escaped literal character
      rawRuns.push({
        text: match[1],
        ...(inheritedStyle ? { style: inheritedStyle } : {}),
        ...(inheritedLink ? { link: inheritedLink } : {}),
      });
    } else if (match[2] !== undefined) {
      // Autolink: <https://...>
      const url = match[2];
      rawRuns.push({
        text: url,
        link: url,
        style: mergeStyles(inheritedStyle, { fontColor: '#0969DA', underline: true }),
      });
    } else if (match[3] !== undefined && match[4] !== undefined) {
      // Link: [label](url) with recursive inline formatting inside label
      const label = match[3];
      const url = match[4].trim();
      const linkStyle = mergeStyles(inheritedStyle, { fontColor: '#0969DA', underline: true });
      const innerRuns = parseInlineMarkdown(label, linkStyle, url);
      rawRuns.push(...innerRuns);
    } else if (match[5] !== undefined && match[6] !== undefined) {
      // Inline code
      rawRuns.push({
        text: match[6],
        style: mergeStyles(inheritedStyle, { fontFamily: 'courier', fontColor: '#1F2328' }),
        ...(inheritedLink ? { link: inheritedLink } : {}),
      });
    } else if (match[7] !== undefined) {
      // Inline math: $...$
      rawRuns.push({
        text: match[7],
        style: mergeStyles(inheritedStyle, { math: true, italic: true }),
        ...(inheritedLink ? { link: inheritedLink } : {}),
      });
    } else if (match[8] !== undefined && match[9] !== undefined) {
      // Triple bold+italic emphasis (*** or ___)
      const nextStyle = mergeStyles(inheritedStyle, { bold: true, italic: true });
      rawRuns.push(...parseInlineMarkdown(match[9], nextStyle, inheritedLink));
    } else if (match[10] !== undefined && match[11] !== undefined) {
      // Bold emphasis (** or __)
      const nextStyle = mergeStyles(inheritedStyle, { bold: true });
      rawRuns.push(...parseInlineMarkdown(match[11], nextStyle, inheritedLink));
    } else if (match[12] !== undefined) {
      // Italic emphasis (*)
      const nextStyle = mergeStyles(inheritedStyle, { italic: true });
      rawRuns.push(...parseInlineMarkdown(match[12], nextStyle, inheritedLink));
    } else if (match[13] !== undefined) {
      // Italic emphasis (_)
      const nextStyle = mergeStyles(inheritedStyle, { italic: true });
      rawRuns.push(...parseInlineMarkdown(match[13], nextStyle, inheritedLink));
    } else if (match[14] !== undefined && match[15] !== undefined) {
      // Strikethrough (~~)
      const nextStyle = mergeStyles(inheritedStyle, { strike: true });
      rawRuns.push(...parseInlineMarkdown(match[15], nextStyle, inheritedLink));
    } else if (match[16] !== undefined) {
      // Plain text chunk
      rawRuns.push({
        text: match[16],
        ...(inheritedStyle ? { style: inheritedStyle } : {}),
        ...(inheritedLink ? { link: inheritedLink } : {}),
      });
    } else if (match[17] !== undefined) {
      // Fallback single character (e.g. arithmetic * or unmatched delimiter)
      rawRuns.push({
        text: match[17],
        ...(inheritedStyle ? { style: inheritedStyle } : {}),
        ...(inheritedLink ? { link: inheritedLink } : {}),
      });
    }
  }

  // Coalesce adjacent runs with identical style and link
  const coalesced: StyledRun[] = [];
  for (const run of rawRuns) {
    const prev = coalesced[coalesced.length - 1];
    if (
      prev &&
      prev.link === run.link &&
      JSON.stringify(prev.style ?? null) === JSON.stringify(run.style ?? null)
    ) {
      coalesced[coalesced.length - 1] = {
        ...prev,
        text: prev.text + run.text,
      };
    } else {
      coalesced.push(run);
    }
  }

  return coalesced.length > 0 ? coalesced : [{ text, ...(inheritedStyle ? { style: inheritedStyle } : {}), ...(inheritedLink ? { link: inheritedLink } : {}) }];
}

/**
 * Strips inline Markdown formatting tokens and returns plain text.
 */
export function stripMarkdownFormatting(text: string): string {
  return parseInlineMarkdown(text)
    .map((r) => r.text)
    .join('');
}

/**
 * Parses a Markdown table string into an IDR TableBlock with column alignments.
 */
function parseMarkdownTable(lines: string[]): TableBlock | null {
  if (lines.length < 2) return null;

  const parsedRows: string[][] = [];
  const colAlignments: BlockAlignment[] = [];

  for (const line of lines) {
    // Check delimiter row like |:---|:---:|---:| or |---|---|
    if (/^\s*\|?\s*[-:]+[-| :]*\|?\s*$/.test(line)) {
      const parts = line
        .split('|')
        .map((p) => p.trim())
        .filter((p, idx, arr) => (idx > 0 && idx < arr.length - 1) || p.length > 0);
      for (const part of parts) {
        if (part.startsWith(':') && part.endsWith(':')) {
          colAlignments.push('center');
        } else if (part.endsWith(':')) {
          colAlignments.push('right');
        } else {
          colAlignments.push('left');
        }
      }
      continue;
    }

    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c, idx, arr) => (idx > 0 && idx < arr.length - 1) || c.length > 0);

    if (cells.length > 0) {
      parsedRows.push(cells);
    }
  }

  if (parsedRows.length === 0) return null;

  return {
    type: 'table',
    rows: parsedRows.map((row, rIdx) => ({
      isHeader: rIdx === 0,
      cells: row.map((cellText, cIdx) => ({
        runs: parseInlineMarkdown(cellText, rIdx === 0 ? { bold: true } : undefined),
        align: colAlignments[cIdx] ?? 'left',
        isHeader: rIdx === 0,
      })),
    })),
    hasBorders: true,
    hasZebraStriping: true,
  };
}

/**
 * Checks whether a trimmed line represents a Markdown horizontal rule.
 */
function isHorizontalRule(line: string): boolean {
  return /^(\*{3,}|-{3,}|_{3,}|(-\s*){3,}|(\*\s*){3,}|(_\s*){3,})$/.test(line);
}

/**
 * Checks whether a line carries an explicit outline heading annotation such as {#heading 1} or {#h2}.
 */
function isExplicitOutlineHeadingLine(trimmedLine: string): boolean {
  return (
    /\{\s*:?\s*#\s*(?:heading[\s_-]*|h)[1-6]\b[^}]*\}\s*$/i.test(trimmedLine) ||
    /^\{\s*:?\s*#\s*(?:heading[\s_-]*|h)[1-6]\b[^}]*\}\s+\S+/i.test(trimmedLine) ||
    /^\{\s*:?\s*#\s*(?:heading[\s_-]*|h)[1-6]\s*:\s*[^}]+\}$/i.test(trimmedLine)
  );
}

/**
 * Parses Markdown source text into an IDR FlowDocument supporting GFM alerts, task lists,
 * diagrams, math, outline attribute syntax, and full table alignments.
 */
export function parseMarkdownText(markdown: string, baseTitle?: string): FlowDocument {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: DocumentBlock[] = [];
  let docTitle = baseTitle;

  let i = 0;
  while (i < lines.length) {
    const prevI = i;
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      i++;
      continue;
    }

    // Display Math Block: $$ ... $$
    if (trimmed.startsWith('$$')) {
      if (trimmed.endsWith('$$') && trimmed.length > 4) {
        const expr = trimmed.slice(2, -2).trim();
        blocks.push({
          type: 'math',
          expression: expr,
          displayMode: true,
        });
        i++;
        continue;
      }
      const mathLines: string[] = [];
      const firstLineRemainder = trimmed.slice(2).trim();
      if (firstLineRemainder.length > 0) {
        mathLines.push(firstLineRemainder);
      }
      i++;
      while (i < lines.length && !lines[i].trim().endsWith('$$')) {
        mathLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        const closingLine = lines[i].trim().slice(0, -2).trim();
        if (closingLine.length > 0) {
          mathLines.push(closingLine);
        }
        i++;
      }
      blocks.push({
        type: 'math',
        expression: mathLines.join('\n').trim(),
        displayMode: true,
      });
      continue;
    }

    // Fenced Code / Diagram / Math Block
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const langLower = language.toLowerCase();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```

      if (langLower === 'mermaid') {
        blocks.push({
          type: 'diagram',
          diagramType: 'mermaid',
          code: codeLines.join('\n'),
        });
      } else if (langLower === 'math' || langLower === 'latex' || langLower === 'tex') {
        blocks.push({
          type: 'math',
          expression: codeLines.join('\n').trim(),
          displayMode: true,
        });
      } else {
        blocks.push({
          type: 'code',
          code: codeLines.join('\n'),
          language: language || undefined,
          showLineNumbers: true,
        });
      }
      continue;
    }

    // ATX Headings: # H1 through ###### H6 (with optional {#heading 1} or {#custom-id} attributes)
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const rawLevel = headingMatch[1].length;
      const parsedAttr = extractMarkdownHeadingAttributes(headingMatch[2]);
      const level = (parsedAttr.explicitLevel ?? Math.min(Math.max(rawLevel, 1), 6)) as 1 | 2 | 3 | 4 | 5 | 6;
      const headingRuns = parseInlineMarkdown(parsedAttr.text, { bold: true });
      const cleanHeadingText = headingRuns.map((r) => r.text).join('').trim();
      if (rawLevel === 1) {
        docTitle = cleanHeadingText;
      }
      blocks.push({
        type: 'heading',
        level,
        text: cleanHeadingText,
        runs: headingRuns,
        ...(parsedAttr.id ? { id: parsedAttr.id } : {}),
        ...(parsedAttr.unlisted ? { unlisted: true } : {}),
      });
      i++;
      continue;
    }

    // Standalone Outline Heading Annotation: e.g. "Title {#heading 1}" or "{#heading 2} Title"
    if (isExplicitOutlineHeadingLine(trimmed)) {
      const parsedAttr = extractMarkdownHeadingAttributes(trimmed);
      if (parsedAttr.explicitLevel && parsedAttr.text.length > 0) {
        const level = parsedAttr.explicitLevel;
        const headingRuns = parseInlineMarkdown(parsedAttr.text, { bold: true });
        const cleanHeadingText = headingRuns.map((r) => r.text).join('').trim();
        if (level === 1 && (!docTitle || docTitle === baseTitle)) {
          docTitle = cleanHeadingText;
        }
        blocks.push({
          type: 'heading',
          level,
          text: cleanHeadingText,
          runs: headingRuns,
          ...(parsedAttr.id ? { id: parsedAttr.id } : {}),
          ...(parsedAttr.unlisted ? { unlisted: true } : {}),
        });
        i++;
        continue;
      }
    }

    // Horizontal Rule: ---, ***, ___, including spaced variations "- - -"
    if (isHorizontalRule(trimmed)) {
      blocks.push({ type: 'divider' });
      i++;
      continue;
    }

    // Blockquote or GFM Alert: > text
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s*/, ''));
        i++;
      }

      const firstLine = quoteLines[0] ?? '';
      const alertMatch = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+(.*))?$/i.exec(firstLine);

      if (alertMatch) {
        const rawType = alertMatch[1].toLowerCase() as 'note' | 'tip' | 'important' | 'warning' | 'caution';
        const customTitle = alertMatch[2]?.trim();
        const contentLines = quoteLines.slice(1);
        if (customTitle && contentLines.length === 0) {
          blocks.push({
            type: 'alert',
            alertType: rawType,
            runs: parseInlineMarkdown(customTitle),
          });
        } else {
          const bodyText = contentLines.join(' ');
          blocks.push({
            type: 'alert',
            alertType: rawType,
            title: customTitle || undefined,
            runs: parseInlineMarkdown(bodyText),
          });
        }
      } else {
        const rawQuote = quoteLines.join(' ');
        const quoteRuns = parseInlineMarkdown(rawQuote, { italic: true });
        const cleanQuote = quoteRuns.map((r) => r.text).join('');
        blocks.push({
          type: 'quote',
          text: cleanQuote,
          runs: quoteRuns,
        });
      }
      continue;
    }

    // Markdown Table: starts with |
    if (trimmed.startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const tableBlock = parseMarkdownTable(tableLines);
      if (tableBlock) {
        blocks.push(tableBlock);
        continue;
      }
    }

    // Unordered List: - item, * item, + item
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: ListItem[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        const rawItem = lines[i];
        const leadingSpaces = (rawItem.match(/^(\s*)/)?.[1] ?? '').length;
        const indentLevel = Math.min(3, Math.floor(leadingSpaces / 2));
        const itemText = lines[i].trim().replace(/^[-*+]\s+/, '');
        const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(itemText);

        if (taskMatch) {
          items.push({
            runs: parseInlineMarkdown(taskMatch[2]),
            isTask: true,
            isChecked: taskMatch[1].toLowerCase() === 'x',
            indentLevel,
          });
        } else {
          items.push({
            runs: parseInlineMarkdown(itemText),
            indentLevel,
          });
        }
        i++;
      }
      blocks.push({
        type: 'list',
        ordered: false,
        items,
      });
      continue;
    }

    // Ordered List: 1. item
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: ListItem[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const rawItem = lines[i];
        const leadingSpaces = (rawItem.match(/^(\s*)/)?.[1] ?? '').length;
        const indentLevel = Math.min(3, Math.floor(leadingSpaces / 2));
        const itemText = lines[i].trim().replace(/^\d+\.\s+/, '');
        const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(itemText);

        if (taskMatch) {
          items.push({
            runs: parseInlineMarkdown(taskMatch[2]),
            isTask: true,
            isChecked: taskMatch[1].toLowerCase() === 'x',
            indentLevel,
          });
        } else {
          items.push({
            runs: parseInlineMarkdown(itemText),
            indentLevel,
          });
        }
        i++;
      }
      blocks.push({
        type: 'list',
        ordered: true,
        items,
      });
      continue;
    }

    // Setext Heading: Heading line followed by underline of equals (H1) or hyphens (H2)
    if (i + 1 < lines.length && /^(?:={3,}|-{3,})\s*$/.test(lines[i + 1].trim())) {
      const setextLevel = lines[i + 1].trim().startsWith('=') ? 1 : 2;
      const parsedAttr = extractMarkdownHeadingAttributes(trimmed);
      const level = (parsedAttr.explicitLevel ?? setextLevel) as 1 | 2 | 3 | 4 | 5 | 6;
      const headingRuns = parseInlineMarkdown(parsedAttr.text, { bold: true });
      const cleanHeadingText = headingRuns.map((r) => r.text).join('').trim();
      if (level === 1 && (!docTitle || docTitle === baseTitle)) {
        docTitle = cleanHeadingText;
      }
      blocks.push({
        type: 'heading',
        level,
        text: cleanHeadingText,
        runs: headingRuns,
        ...(parsedAttr.id ? { id: parsedAttr.id } : {}),
        ...(parsedAttr.unlisted ? { unlisted: true } : {}),
      });
      i += 2;
      continue;
    }

    // Standard Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim().length > 0 &&
      !/^(#{1,6})\s+/.test(lines[i].trim()) &&
      !isExplicitOutlineHeadingLine(lines[i].trim()) &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('$$') &&
      !lines[i].trim().startsWith('>') &&
      !lines[i].trim().startsWith('|') &&
      !/^[-*+]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !isHorizontalRule(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }

    // Safeguard ensuring loop progress
    if (i === prevI) {
      paraLines.push(lines[i].trim());
      i++;
    }

    const runs = parseInlineMarkdown(paraLines.join(' '));
    blocks.push({
      type: 'paragraph',
      runs,
      spaceAfter: 6,
    });
  }

  return {
    title: docTitle,
    blocks,
  };
}

/**
 * Decodes common HTML character entities into Unicode characters.
 */
function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&copy;/gi, '(c)')
    .replace(/&reg;/gi, '(R)')
    .replace(/&mdash;/gi, '--')
    .replace(/&ndash;/gi, '-')
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Parses inline HTML tags (strong, b, em, i, u, s, del, code, a) into StyledRun items.
 */
export function parseInlineHtml(
  htmlFragment: string,
  inheritedStyle?: TextStyle,
  inheritedLink?: string
): StyledRun[] {
  const runs: StyledRun[] = [];
  const tagRegex = /<(strong|b|em|i|u|ins|s|strike|del|code|a)\b([^>]*)>([\s\S]*?)<\/\1>|<br\s*\/?>|([^<]+)|(<[^>]+>)/gi;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(htmlFragment)) !== null) {
    if (match[1] !== undefined) {
      const tag = match[1].toLowerCase();
      const attrs = match[2] ?? '';
      const inner = match[3] ?? '';
      let nextStyle = inheritedStyle;
      let nextLink = inheritedLink;

      if (tag === 'strong' || tag === 'b') {
        nextStyle = mergeStyles(inheritedStyle, { bold: true });
      } else if (tag === 'em' || tag === 'i') {
        nextStyle = mergeStyles(inheritedStyle, { italic: true });
      } else if (tag === 'u' || tag === 'ins') {
        nextStyle = mergeStyles(inheritedStyle, { underline: true });
      } else if (tag === 's' || tag === 'strike' || tag === 'del') {
        nextStyle = mergeStyles(inheritedStyle, { strike: true });
      } else if (tag === 'code') {
        nextStyle = mergeStyles(inheritedStyle, { fontFamily: 'courier', fontColor: '#1F2328' });
      } else if (tag === 'a') {
        const hrefMatch = /href\s*=\s*["']([^"']+)["']/i.exec(attrs);
        if (hrefMatch) {
          nextLink = hrefMatch[1].trim();
        }
        nextStyle = mergeStyles(inheritedStyle, { fontColor: '#0969DA', underline: true });
      }

      runs.push(...parseInlineHtml(inner, nextStyle, nextLink));
    } else if (/^<br/i.test(match[0])) {
      runs.push({ text: '\n', ...(inheritedStyle ? { style: inheritedStyle } : {}) });
    } else if (match[4] !== undefined) {
      const text = sanitizeTextForWinAnsi(decodeHtmlEntities(match[4].replace(/\s+/g, ' ')));
      if (text.length > 0) {
        runs.push({
          text,
          ...(inheritedStyle ? { style: inheritedStyle } : {}),
          ...(inheritedLink ? { link: inheritedLink } : {}),
        });
      }
    }
  }

  return runs.length > 0 ? runs : [{ text: sanitizeTextForWinAnsi(decodeHtmlEntities(htmlFragment.replace(/<[^>]+>/g, '').trim())) }];
}

/**
 * Parses semantic HTML source into an IDR FlowDocument with headings, paragraphs, tables, lists, quotes, and code blocks.
 */
export function parseHtmlText(html: string, baseTitle?: string): FlowDocument {
  // Remove script, style, and head metadata except title
  let docTitle = baseTitle;
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (titleMatch) {
    const extractedTitle = sanitizeTextForWinAnsi(decodeHtmlEntities(titleMatch[1].trim()));
    if (extractedTitle.length > 0) {
      docTitle = extractedTitle;
    }
  }

  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  const blocks: DocumentBlock[] = [];
  const blockRegex = /<(h[1-6]|p|pre|blockquote|ul|ol|table|hr)\b([^>]*)>([\s\S]*?)<\/\1>|<hr\b[^>]*\/?>/gi;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(cleaned)) !== null) {
    const rawMatch = match[0];
    if (/^<hr/i.test(rawMatch)) {
      blocks.push({ type: 'divider' });
      continue;
    }

    const tag = (match[1] ?? '').toLowerCase();
    const inner = match[3] ?? '';

    if (tag.startsWith('h') && tag.length === 2) {
      const level = Math.min(Math.max(parseInt(tag[1], 10), 1), 6) as 1 | 2 | 3 | 4 | 5 | 6;
      const runs = parseInlineHtml(inner, { bold: true });
      const text = runs.map((r) => r.text).join('').trim();
      if (text.length > 0) {
        if (level === 1 && (!docTitle || docTitle === baseTitle)) {
          docTitle = text;
        }
        blocks.push({ type: 'heading', level, text, runs });
      }
    } else if (tag === 'p') {
      const runs = parseInlineHtml(inner);
      const text = runs.map((r) => r.text).join('').trim();
      if (text.length > 0) {
        blocks.push({ type: 'paragraph', runs, spaceAfter: 6 });
      }
    } else if (tag === 'pre') {
      const codeInner = inner.replace(/^<code[^>]*>/i, '').replace(/<\/code>$/i, '');
      const code = sanitizeTextForWinAnsi(decodeHtmlEntities(codeInner.replace(/<[^>]+>/g, '')));
      blocks.push({ type: 'code', code: code.trim(), showLineNumbers: true });
    } else if (tag === 'blockquote') {
      const runs = parseInlineHtml(inner, { italic: true });
      const text = runs.map((r) => r.text).join('').trim();
      if (text.length > 0) {
        blocks.push({ type: 'quote', text, runs });
      }
    } else if (tag === 'ul' || tag === 'ol') {
      const items: ListItem[] = [];
      const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch: RegExpExecArray | null;
      while ((liMatch = liRegex.exec(inner)) !== null) {
        const itemRuns = parseInlineHtml(liMatch[1]);
        if (itemRuns.some((r) => r.text.trim().length > 0)) {
          items.push({ runs: itemRuns });
        }
      }
      if (items.length > 0) {
        blocks.push({ type: 'list', ordered: tag === 'ol', items });
      }
    } else if (tag === 'table') {
      const rows: TableRow[] = [];
      const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch: RegExpExecArray | null;
      let rIdx = 0;
      while ((trMatch = trRegex.exec(inner)) !== null) {
        const rowHtml = trMatch[1];
        const cells: TableCell[] = [];
        const cellRegex = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
        let cellMatch: RegExpExecArray | null;
        let hasTh = false;
        while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
          const isTh = cellMatch[1].toLowerCase() === 'th' || rIdx === 0;
          if (cellMatch[1].toLowerCase() === 'th') hasTh = true;
          const cellRuns = parseInlineHtml(cellMatch[3], isTh ? { bold: true } : undefined);
          cells.push({
            runs: cellRuns,
            isHeader: isTh,
            align: 'left',
          });
        }
        if (cells.length > 0) {
          rows.push({ cells, isHeader: hasTh || rIdx === 0 });
          rIdx++;
        }
      }
      if (rows.length > 0) {
        blocks.push({
          type: 'table',
          rows,
          hasBorders: true,
          hasZebraStriping: true,
        });
      }
    }
  }

  if (blocks.length === 0) {
    const stripped = sanitizeTextForWinAnsi(decodeHtmlEntities(cleaned.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()));
    if (stripped.length > 0) {
      blocks.push({
        type: 'paragraph',
        runs: [{ text: stripped }],
        spaceAfter: 6,
      });
    }
  }

  return {
    title: docTitle,
    blocks,
  };
}

/**
 * Parses plain text or code files into an IDR FlowDocument.
 */
export function parsePlainText(
  text: string,
  baseTitle?: string,
  isCodeFormat?: boolean
): FlowDocument {
  if (isCodeFormat) {
    return {
      title: baseTitle,
      blocks: [
        {
          type: 'code',
          code: text,
          showLineNumbers: true,
        },
      ],
    };
  }

  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const blocks: DocumentBlock[] = [];

  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (trimmed.length === 0) continue;

    blocks.push({
      type: 'paragraph',
      runs: [{ text: trimmed }],
      spaceAfter: 6,
    });
  }

  return {
    title: baseTitle,
    blocks,
  };
}

export class TextConverter implements FormatConverter {
  readonly id = 'text';
  readonly displayName = 'Markdown, HTML, Text & Code (.md, .html, .txt, .json)';
  readonly formats = ['markdown', 'html', 'text', 'code', 'json'] as const;
  readonly extensions = [
    '.md',
    '.markdown',
    '.txt',
    '.json',
    '.xml',
    '.html',
    '.htm',
    '.rtf',
    '.yaml',
    '.yml',
    '.log',
    '.js',
    '.ts',
  ] as const;
  readonly mimeTypes = [
    'text/markdown',
    'text/plain',
    'application/json',
    'text/html',
    'application/xml',
    'text/yaml',
  ] as const;

  canConvert(fileName: string, _buffer: ArrayBuffer | Uint8Array, mimeType?: string): boolean {
    const lower = fileName.toLowerCase();
    for (const ext of this.extensions) {
      if (lower.endsWith(ext)) return true;
    }
    if (mimeType && (mimeType.startsWith('text/') || this.mimeTypes.includes(mimeType as typeof this.mimeTypes[number]))) {
      return true;
    }
    return false;
  }

  async convert(
    input: ConversionInputItem,
    options?: DocumentConversionOptions
  ): Promise<ConvertedDocumentResult> {
    const startTime = Date.now();
    const baseName = input.name.replace(/\.[^/.]+$/, '') || 'document';
    const lower = input.name.toLowerCase();

    const rawText = typeof input.buffer === 'string'
      ? input.buffer
      : new TextDecoder('utf-8').decode(input.buffer);

    const isJson = lower.endsWith('.json') || input.mimeType === 'application/json';
    const isMarkdown = lower.endsWith('.md') || lower.endsWith('.markdown') || input.mimeType === 'text/markdown';
    const isHtml = lower.endsWith('.html') || lower.endsWith('.htm') || input.mimeType === 'text/html';
    const isCode =
      isJson ||
      lower.endsWith('.xml') ||
      isHtml ||
      lower.endsWith('.yaml') ||
      lower.endsWith('.yml') ||
      lower.endsWith('.log') ||
      lower.endsWith('.js') ||
      lower.endsWith('.ts') ||
      lower.endsWith('.rtf') ||
      (input.mimeType !== undefined && (input.mimeType.includes('xml') || input.mimeType.includes('yaml')));

    // Normalise encoding and strip BOM
    const sanitisedText = sanitizeTextForWinAnsi(rawText);

    let flowDoc: FlowDocument;
    if (isMarkdown) {
      flowDoc = parseMarkdownText(sanitisedText, baseName);
    } else if (isHtml && /<(h[1-6]|p|table|ul|ol|div|article|section|body)\b/i.test(rawText)) {
      flowDoc = parseHtmlText(rawText, baseName);
    } else if (isJson) {
      flowDoc = parsePlainText(formatJsonText(sanitisedText), baseName, true);
    } else {
      flowDoc = parsePlainText(sanitisedText, baseName, isCode);
    }

    const doc = await PDFDocument.create();
    const { pageCount } = await layoutFlowDocument(doc, flowDoc, options);

    const pdfBytes = await doc.save();
    const buffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer;

    const wordCount = rawText.match(/\S+/g)?.length ?? 0;

    return {
      buffer,
      pageCount,
      fileName: `${baseName}.pdf`,
      format: isJson ? 'json' : isMarkdown ? 'markdown' : isCode ? 'code' : 'text',
      metadata: {
        title: flowDoc.title ?? baseName,
        wordCount,
        conversionDurationMs: Date.now() - startTime,
      },
    };
  }
}
