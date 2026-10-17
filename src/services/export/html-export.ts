/**
 * Semantic HTML5 (.html) Document Exporter.
 *
 * Generates a self-contained, responsive HTML5 document preserving
 * headings, inline typography, reconstructed tables, lists, code blocks,
 * and embedded images.
 */

import type { ExportDefinition, ExportContext } from '../../core/export-registry';
import { downloadBytes } from '../../utils/download-utils';
import {
  extractStructuredDocumentFromContext,
  type ExtractedDocumentStructure,
  type ExtractedTableBlock,
} from './pdf-structure-extractor';
import type { StyledRun } from '../conversion/types';

/**
 * Escapes HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Converts a Uint8Array binary payload into a base64 string.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Renders an array of StyledRun items into semantic inline HTML tags.
 */
function renderStyledRunsHtml(runs: readonly StyledRun[]): string {
  return runs
    .map((run) => {
      let inner = escapeHtml(run.text).replace(/\n/g, '<br />');
      if (!inner) return '';

      const style = run.style;
      if (style?.code) {
        inner = `<code>${inner}</code>`;
      }
      if (style?.bold) {
        inner = `<strong>${inner}</strong>`;
      }
      if (style?.italic) {
        inner = `<em>${inner}</em>`;
      }
      if (style?.underline && !run.link) {
        inner = `<u>${inner}</u>`;
      }
      if (style?.strike) {
        inner = `<del>${inner}</del>`;
      }
      if (style?.fontColor) {
        inner = `<span style="color: ${escapeHtml(style.fontColor)};">${inner}</span>`;
      }
      if (run.link) {
        inner = `<a href="${escapeHtml(run.link)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
      }
      return inner;
    })
    .join('');
}

/**
 * Renders an ExtractedTableBlock into a semantic HTML <table> element.
 */
function renderTableHtml(table: ExtractedTableBlock): string {
  const headerRows = table.rows.filter((r) => r.isHeader);
  const bodyRows = table.rows.filter((r) => !r.isHeader);

  const theadHtml =
    headerRows.length > 0
      ? `<thead>${headerRows
          .map(
            (r) =>
              `<tr>${r.cells
                .map(
                  (c) =>
                    `<th style="text-align: ${c.align};">${renderStyledRunsHtml(c.runs) || escapeHtml(c.text)}</th>`
                )
                .join('')}</tr>`
          )
          .join('')}</thead>`
      : '';

  const tbodyHtml =
    bodyRows.length > 0
      ? `<tbody>${bodyRows
          .map(
            (r) =>
              `<tr>${r.cells
                .map(
                  (c) =>
                    `<td style="text-align: ${c.align};">${renderStyledRunsHtml(c.runs) || escapeHtml(c.text)}</td>`
                )
                .join('')}</tr>`
          )
          .join('')}</tbody>`
      : '';

  return `<table>${theadHtml}${tbodyHtml}</table>`;
}

/**
 * Serialises an ExtractedDocumentStructure into a standalone HTML5 document string.
 */
export function buildHtmlStringFromStructure(
  structure: ExtractedDocumentStructure
): string {
  const pageArticles: string[] = [];

  for (const page of structure.pages) {
    const blockHtmlParts: string[] = [];

    for (const block of page.blocks) {
      if (block.kind === 'heading') {
        const tag = `h${block.level}`;
        const alignStyle =
          block.align !== 'left' ? ` style="text-align: ${block.align};"` : '';
        blockHtmlParts.push(
          `<${tag}${alignStyle}>${renderStyledRunsHtml(block.runs) || escapeHtml(block.text)}</${tag}>`
        );
      } else if (block.kind === 'paragraph') {
        const alignStyle =
          block.align !== 'left' ? ` style="text-align: ${block.align};"` : '';
        blockHtmlParts.push(
          `<p${alignStyle}>${renderStyledRunsHtml(block.runs) || escapeHtml(block.text)}</p>`
        );
      } else if (block.kind === 'list') {
        const tag = block.ordered ? 'ol' : 'ul';
        const itemsHtml = block.items
          .map(
            (item) =>
              `<li>${renderStyledRunsHtml(item.runs) || escapeHtml(item.text)}</li>`
          )
          .join('');
        blockHtmlParts.push(`<${tag}>${itemsHtml}</${tag}>`);
      } else if (block.kind === 'code') {
        blockHtmlParts.push(
          `<pre><code>${escapeHtml(block.code)}</code></pre>`
        );
      } else if (block.kind === 'table') {
        blockHtmlParts.push(renderTableHtml(block));
      } else if (block.kind === 'image') {
        const b64 = bytesToBase64(block.image.data);
        const dataUri = `data:${block.image.mimeType};base64,${b64}`;
        blockHtmlParts.push(
          `<figure><img src="${dataUri}" width="${Math.round(block.width)}" height="${Math.round(block.height)}" alt="Embedded figure" /></figure>`
        );
      }
    }

    pageArticles.push(
      `<article class="pdf-page" data-page-index="${page.pageIndex + 1}">\n      ${blockHtmlParts.join('\n      ')}\n    </article>`
    );
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(structure.title)}</title>
  <style>
    :root {
      color-scheme: light;
    }
    body {
      margin: 0;
      padding: 2rem 1rem;
      background-color: #f6f8fa;
      color: #1f2328;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
    }
    .pdf-page {
      max-width: 820px;
      margin: 0 auto 2rem auto;
      padding: 3rem 3.5rem;
      background: #ffffff;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      box-shadow: 0 1px 3px rgba(31, 35, 40, 0.06);
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.4em;
      margin-bottom: 0.6em;
      font-weight: 600;
      line-height: 1.25;
    }
    h1 { font-size: 1.85rem; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
    h2 { font-size: 1.45rem; border-bottom: 1px solid #d0d7de; padding-bottom: 0.25em; }
    h3 { font-size: 1.2rem; }
    p { margin: 0 0 0.85rem 0; }
    ul, ol { margin: 0 0 1rem 0; padding-left: 1.75rem; }
    li { margin-bottom: 0.25rem; }
    pre {
      background: #f6f8fa;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      padding: 0.85rem 1rem;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.875rem;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: rgba(175, 184, 193, 0.2);
      padding: 0.15em 0.35em;
      border-radius: 4px;
    }
    pre code { background: transparent; padding: 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0 1.25rem 0;
      font-size: 0.925rem;
    }
    th, td {
      border: 1px solid #d0d7de;
      padding: 0.5rem 0.75rem;
    }
    th {
      background-color: #f6f8fa;
      font-weight: 600;
    }
    tr:nth-child(even) td {
      background-color: #fcfcfd;
    }
    figure {
      margin: 1rem 0;
      text-align: center;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    a {
      color: #0969da;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <main>
    ${pageArticles.join('\n    ')}
  </main>
</body>
</html>`;
}

export const htmlExport: ExportDefinition = {
  id: 'html',
  label: 'HTML Web Page',
  description: 'Export PDF as a semantic, responsive HTML5 web document',
  extension: '.html',
  mimeType: 'text/html',
  category: 'web',
  async export(ctx: ExportContext): Promise<void> {
    if (!ctx.editorStore.isDocumentLoaded) return;
    const structure = extractStructuredDocumentFromContext(ctx);
    const html = buildHtmlStringFromStructure(structure);
    const bytes = new TextEncoder().encode(html);
    const baseName = ctx.editorStore.fileName.replace(/\.pdf$/i, '') || 'document';
    downloadBytes(bytes, `${baseName}.html`, 'text/html;charset=utf-8');
  },
};
