/**
 * Flattened PDF document exporter.
 *
 * Flattens all interactive annotations and form fields into the native
 * page background before downloading.
 */

import type { ExportDefinition, ExportContext } from '../../core/export-registry';
import { downloadBytes } from '../../utils/download-utils';

export const flattenedPdfExport: ExportDefinition = {
  id: 'flattened-pdf',
  label: 'Flatten & Save PDF',
  description: 'Flattens all annotations and form fields into static page content',
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

      const intermediateBytes = await ctx.service.document.saveAsync(ctx.pageTransforms);
      const intermediateBuffer = intermediateBytes.buffer.slice(
        intermediateBytes.byteOffset,
        intermediateBytes.byteOffset + intermediateBytes.byteLength
      ) as ArrayBuffer;
      ctx.service.loadDocumentFromBuffer(intermediateBuffer);

      const pageCount = ctx.service.document.getPageCount();
      for (let i = 0; i < pageCount; i++) {
        ctx.service.document.getPage(i).flatten();
      }

      const bytes = ctx.service.document.save();
      const baseName = ctx.editorStore.fileName.replace(/\.pdf$/i, '') || 'document';
      downloadBytes(bytes, `${baseName}-flattened.pdf`, 'application/pdf');
    } finally {
      ctx.service.loadDocumentFromBuffer(originalBuffer);
      ctx.actions.refreshDocument();
    }
  },
};
