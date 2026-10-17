/**
 * Standard PDF document exporter.
 *
 * Bakes any active canvas elements and page transforms into the document
 * and triggers a client-side download of the modified PDF bytes.
 */

import type { ExportDefinition, ExportContext } from '../../core/export-registry';
import { downloadBytes } from '../../utils/download-utils';
import { resolveVerbatimPdfBytes } from '../pdf/verbatim-bytes';

export const pdfExport: ExportDefinition = {
  id: 'pdf',
  label: 'PDF Document',
  description: 'Download PDF with all canvas annotations and edits applied',
  extension: '.pdf',
  mimeType: 'application/pdf',
  category: 'pdf',
  async export(ctx: ExportContext): Promise<void> {
    if (!ctx.editorStore.isDocumentLoaded) return;

    const hasCanvasElements = ctx.canvasElements.length > 0;
    const savedFormValues = new Map(ctx.service.document.getModifiedFormFieldValues());
    const originalBytes = hasCanvasElements ? ctx.service.document.save() : null;
    const originalBuffer = originalBytes
      ? (originalBytes.buffer.slice(
          originalBytes.byteOffset,
          originalBytes.byteOffset + originalBytes.byteLength
        ) as ArrayBuffer)
      : null;

    try {
      if (hasCanvasElements) {
        await ctx.service.burnElementsToDocument(ctx.canvasElements);
      }

      // Unedited documents are emitted verbatim so existing digital signatures stay valid.
      const verbatimBytes = hasCanvasElements
        ? null
        : resolveVerbatimPdfBytes(ctx.service.document, ctx.pageTransforms);
      const bytes = verbatimBytes ?? (await ctx.service.document.saveAsync(ctx.pageTransforms));
      const fileName = ctx.editorStore.fileName || 'document.pdf';
      downloadBytes(bytes, fileName, 'application/pdf');
    } finally {
      if (originalBuffer) {
        ctx.service.reloadDocumentFromBuffer(originalBuffer);
        if (savedFormValues.size > 0) {
          ctx.service.document.setAllFormFieldValues(savedFormValues);
        }
        ctx.actions.refreshDocument();
      }
    }
  },
};
