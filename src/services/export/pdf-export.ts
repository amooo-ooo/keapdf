/**
 * Standard PDF document exporter.
 *
 * Bakes any active canvas elements and page transforms into the document
 * and triggers a client-side download of the modified PDF bytes.
 */

import type { ExportDefinition, ExportContext } from '../../core/export-registry';
import { downloadBytes } from '../../utils/download-utils';

export const pdfExport: ExportDefinition = {
  id: 'pdf',
  label: 'Save PDF',
  description: 'Download PDF with all canvas annotations and edits applied',
  extension: '.pdf',
  mimeType: 'application/pdf',
  async export(ctx: ExportContext): Promise<void> {
    if (!ctx.editorStore.isDocumentLoaded) return;

    const originalBytes = ctx.service.document.save();
    const originalBuffer = originalBytes.buffer.slice(
      originalBytes.byteOffset,
      originalBytes.byteOffset + originalBytes.byteLength
    ) as ArrayBuffer;

    try {
      if (ctx.canvasElements.length > 0) {
        await ctx.service.burnElementsToDocument(ctx.canvasElements);
      }

      const bytes = await ctx.service.document.saveAsync(ctx.pageTransforms);
      const fileName = ctx.editorStore.fileName || 'document.pdf';
      downloadBytes(bytes, fileName, 'application/pdf');
    } finally {
      ctx.service.loadDocumentFromBuffer(originalBuffer);
      ctx.actions.refreshDocument();
    }
  },
};
