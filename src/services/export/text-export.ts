/**
 * Plain text document exporter.
 *
 * Extracts all selectable text across all document pages and downloads
 * a formatted .txt document.
 */

import type { ExportDefinition, ExportContext } from '../../core/export-registry';
import { downloadBytes } from '../../utils/download-utils';

export const textExport: ExportDefinition = {
  id: 'text',
  label: 'Export Plain Text',
  description: 'Extract all selectable text into a plain text file',
  extension: '.txt',
  mimeType: 'text/plain',
  async export(ctx: ExportContext): Promise<void> {
    if (!ctx.editorStore.isDocumentLoaded) return;

    const pageCount = ctx.service.document.getPageCount();
    const textParts: string[] = [];

    for (let i = 0; i < pageCount; i++) {
      const spans = ctx.service.document.getPage(i).extractTextSpans();
      let pageText = spans.map((s) => s.text).join('\n');

      const textElements = ctx.canvasElements.filter((el: any) => el.pageIndex === i && el.kind === 'text' && el.visible !== false);
      for (const el of textElements) {
        if ('text' in el && typeof el.text === 'string') {
          pageText += (pageText ? '\n' : '') + el.text;
        } else if ('lines' in el && Array.isArray(el.lines)) {
          pageText += (pageText ? '\n' : '') + el.lines.map((l: any) => l.text || '').join('\n');
        } else if ('segments' in el && Array.isArray(el.segments)) {
          pageText += (pageText ? '\n' : '') + el.segments.map((s: any) => s.text || '').join(' ');
        }
      }

      textParts.push(`--- Page ${i + 1} ---\n\n${pageText}`);
    }

    const fullText = textParts.join('\n\n');
    const encoder = new TextEncoder();
    const bytes = encoder.encode(fullText);
    const baseName = ctx.editorStore.fileName.replace(/\.pdf$/i, '') || 'document';
    downloadBytes(bytes, `${baseName}.txt`, 'text/plain');
  },
};
