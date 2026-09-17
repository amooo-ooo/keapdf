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
  StyledRun,
  FormatConverter,
} from '../types';
import { layoutFlowDocument } from '../pdf-layout-engine';
import { sanitizeTextForWinAnsi } from '../winansi-sanitizer';

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
 * Parses inline Markdown formatting into styled runs.
 * Supports links, bold, italic, code, strikethrough, and literal characters.
 */
export function parseInlineMarkdown(text: string): StyledRun[] {
  const runs: StyledRun[] = [];
  const regex =
    /\[([^\]]+)\]\(([^)]+)\)|(\*\*|__)(.*?)\3|(\*|_)(.*?)\5|(`)(.*?)\7|(~~)(.*?)\9|([^*_`~\[\]]+)|([*_`~\[\]])/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1] !== undefined) {
      // Link: [text](url)
      runs.push({
        text: match[1],
        style: { fontColor: '#1D4ED8', underline: true },
      });
    } else if (match[4] !== undefined) {
      // Bold
      runs.push({
        text: match[4],
        style: { bold: true },
      });
    } else if (match[6] !== undefined) {
      // Italic
      runs.push({
        text: match[6],
        style: { italic: true },
      });
    } else if (match[8] !== undefined) {
      // Inline code
      runs.push({
        text: match[8],
        style: { fontFamily: 'courier', fontColor: '#1E293B' },
      });
    } else if (match[10] !== undefined) {
      // Strikethrough
      runs.push({
        text: match[10],
        style: { strike: true },
      });
    } else if (match[11] !== undefined) {
      // Plain text chunk
      runs.push({
        text: match[11],
      });
    } else if (match[12] !== undefined) {
      // Literal delimiter character to prevent character dropping
      runs.push({
        text: match[12],
      });
    }
  }

  return runs.length > 0 ? runs : [{ text }];
}

/**
 * Parses a Markdown table string into an IDR TableBlock.
 */
function parseMarkdownTable(lines: string[]): TableBlock | null {
  if (lines.length < 2) return null;

  const parsedRows: string[][] = [];
  for (const line of lines) {
    // Skip separator lines like |---|---|
    if (/^\s*\|?\s*[-:]+[-| :]*\|?\s*$/.test(line)) {
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
      cells: row.map((cellText) => ({
        runs: parseInlineMarkdown(cellText),
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
 * Parses Markdown source text into an IDR FlowDocument.
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

    // Fenced Code Block
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```
      blocks.push({
        type: 'code',
        code: codeLines.join('\n'),
        language: language || undefined,
        showLineNumbers: true,
      });
      continue;
    }

    // Headings: # H1 through ###### H6
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const rawLevel = headingMatch[1].length;
      const level = Math.min(rawLevel, 4) as 1 | 2 | 3 | 4;
      const text = headingMatch[2].trim();
      if (rawLevel === 1) {
        docTitle = text;
      }
      blocks.push({
        type: 'heading',
        level,
        text,
      });
      i++;
      continue;
    }

    // Horizontal Rule: ---, ***, ___, including spaced variations "- - -"
    if (isHorizontalRule(trimmed)) {
      blocks.push({ type: 'divider' });
      i++;
      continue;
    }

    // Blockquote: > text
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s*/, ''));
        i++;
      }
      blocks.push({
        type: 'quote',
        text: quoteLines.join(' '),
      });
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
      const items: (readonly StyledRun[])[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^[-*+]\s+/, '');
        items.push(parseInlineMarkdown(itemText));
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
      const items: (readonly StyledRun[])[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^\d+\.\s+/, '');
        items.push(parseInlineMarkdown(itemText));
        i++;
      }
      blocks.push({
        type: 'list',
        ordered: true,
        items,
      });
      continue;
    }

    // Standard Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim().length > 0 &&
      !/^(#{1,6})\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('```') &&
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
  readonly displayName = 'Markdown, Text & Code (.md, .txt, .json, etc.)';
  readonly formats = ['markdown', 'text', 'code', 'json'] as const;
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
    const isCode =
      isJson ||
      lower.endsWith('.xml') ||
      lower.endsWith('.html') ||
      lower.endsWith('.htm') ||
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
