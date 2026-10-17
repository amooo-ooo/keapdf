/**
 * GitHub Flavored Markdown (.md) Document Exporter.
 *
 * Reconstructs headings, bold/italic/strikethrough/code runs, lists,
 * fenced code blocks, and GFM pipe tables from PDF pages.
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
 * Serialises an array of StyledRun items into inline Markdown syntax.
 */
function renderRunsToMarkdown(runs: readonly StyledRun[]): string {
  return runs
    .map((run) => {
      const raw = run.text;
      if (!raw || raw.trim().length === 0) return raw;

      const leadMatch = raw.match(/^\s*/);
      const trailMatch = raw.match(/\s*$/);
      const lead = leadMatch ? leadMatch[0] : '';
      const trail = trailMatch ? trailMatch[0] : '';
      let core = raw.slice(lead.length, raw.length - trail.length);
      if (!core) return raw;

      const style = run.style;
      if (style?.code) {
        core = `\`${core}\``;
      } else {
        if (style?.bold && style?.italic) {
          core = `***${core}***`;
        } else if (style?.bold) {
          core = `**${core}**`;
        } else if (style?.italic) {
          core = `*${core}*`;
        }
        if (style?.strike) {
          core = `~~${core}~~`;
        }
      }

      if (run.link) {
        core = `[${core}](${run.link})`;
      }

      return `${lead}${core}${trail}`;
    })
    .join('')
    .trim();
}

/**
 * Escapes pipe characters inside a GFM table cell.
 */
function escapeGfmTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/**
 * Serialises an ExtractedTableBlock into a GitHub Flavored Markdown pipe table.
 */
function renderTableToMarkdown(table: ExtractedTableBlock): string {
  if (table.rows.length === 0) return '';
  const colCount = Math.max(1, ...table.rows.map((r) => r.cells.length));

  const headerRow = table.rows[0];
  const headerCells: string[] = [];
  const alignRow: string[] = [];

  for (let c = 0; c < colCount; c++) {
    const cell = headerRow.cells[c];
    const cellText = cell ? escapeGfmTableCell(cell.text) : '';
    headerCells.push(cellText || `Column ${c + 1}`);

    const bodyCellAlign = table.rows[1]?.cells[c]?.align ?? cell?.align ?? 'left';
    if (bodyCellAlign === 'center') {
      alignRow.push(':---:');
    } else if (bodyCellAlign === 'right') {
      alignRow.push('---:');
    } else {
      alignRow.push('---');
    }
  }

  const lines: string[] = [
    `| ${headerCells.join(' | ')} |`,
    `| ${alignRow.join(' | ')} |`,
  ];

  for (let r = 1; r < table.rows.length; r++) {
    const row = table.rows[r];
    const cells: string[] = [];
    for (let c = 0; c < colCount; c++) {
      const cell = row.cells[c];
      const formatted = cell
        ? escapeGfmTableCell(renderRunsToMarkdown(cell.runs) || cell.text)
        : '';
      cells.push(formatted);
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }

  return lines.join('\n');
}

/**
 * Serialises an ExtractedDocumentStructure into a GitHub Flavored Markdown string.
 */
export function buildMarkdownStringFromStructure(
  structure: ExtractedDocumentStructure
): string {
  const sections: string[] = [];

  for (let pIdx = 0; pIdx < structure.pages.length; pIdx++) {
    const page = structure.pages[pIdx];
    const pageBlocks: string[] = [];

    for (const block of page.blocks) {
      if (block.kind === 'heading') {
        const hashes = '#'.repeat(block.level);
        pageBlocks.push(`${hashes} ${block.text.trim()}`);
      } else if (block.kind === 'paragraph') {
        const mdText = renderRunsToMarkdown(block.runs) || block.text.trim();
        if (mdText) {
          pageBlocks.push(mdText);
        }
      } else if (block.kind === 'list') {
        const listLines = block.items.map((item, idx) => {
          const indent = '  '.repeat(Math.max(0, item.indentLevel));
          const marker = block.ordered ? `${idx + 1}.` : '-';
          const itemText = renderRunsToMarkdown(item.runs) || item.text.trim();
          return `${indent}${marker} ${itemText}`;
        });
        pageBlocks.push(listLines.join('\n'));
      } else if (block.kind === 'code') {
        pageBlocks.push(`\`\`\`\n${block.code}\n\`\`\``);
      } else if (block.kind === 'table') {
        const mdTable = renderTableToMarkdown(block);
        if (mdTable) {
          pageBlocks.push(mdTable);
        }
      }
    }

    if (pageBlocks.length > 0) {
      sections.push(pageBlocks.join('\n\n'));
    }
  }

  return sections.join('\n\n---\n\n');
}

export const markdownExport: ExportDefinition = {
  id: 'markdown',
  label: 'Markdown',
  description: 'Export PDF as structured GitHub Flavored Markdown',
  extension: '.md',
  mimeType: 'text/markdown',
  category: 'web',
  async export(ctx: ExportContext): Promise<void> {
    if (!ctx.editorStore.isDocumentLoaded) return;
    const structure = extractStructuredDocumentFromContext(ctx);
    const md = buildMarkdownStringFromStructure(structure);
    const bytes = new TextEncoder().encode(md);
    const baseName = ctx.editorStore.fileName.replace(/\.pdf$/i, '') || 'document';
    downloadBytes(bytes, `${baseName}.md`, 'text/markdown;charset=utf-8');
  },
};
