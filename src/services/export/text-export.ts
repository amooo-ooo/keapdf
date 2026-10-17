/**
 * Plain text document exporter.
 *
 * Extracts all selectable text across all document pages and downloads
 * a formatted .txt document.
 */

import type { ExportDefinition, ExportContext } from '../../core/export-registry';
import type { TextElement } from '../../stores/canvas-types';
import { downloadBytes } from '../../utils/download-utils';

export const textExport: ExportDefinition = {
  id: 'text',
  label: 'Plain Text',
  description: 'Extract all selectable text into a plain text file',
  extension: '.txt',
  mimeType: 'text/plain',
  category: 'web',
  async export(ctx: ExportContext): Promise<void> {
    if (!ctx.editorStore.isDocumentLoaded) return;

    const pageCount = ctx.service.document.getPageCount();
    const textParts: string[] = [];

    for (let i = 0; i < pageCount; i++) {
      const spans = ctx.service.document.getPage(i).extractTextSpans();
      let pageText = spans.map((s) => s.text).join('\n');

      const textElements = ctx.canvasElements.filter(
        (el): el is TextElement =>
          el.pageIndex === i && el.kind === 'text' && el.visible !== false
      );
      for (const el of textElements) {
        if (typeof el.text === 'string' && el.text.length > 0) {
          pageText += (pageText ? '\n' : '') + el.text;
        } else if (Array.isArray(el.lines)) {
          pageText += (pageText ? '\n' : '') + el.lines.map((l) => l.text || '').join('\n');
        } else if (Array.isArray(el.segments)) {
          pageText += (pageText ? '\n' : '') + el.segments.map((s) => s.text || '').join(' ');
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
