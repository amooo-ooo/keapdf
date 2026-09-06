/**
 * Compressed PDF document exporter.
 *
 * Opens the compression dialog allowing users to choose between
 * lossless, recommended lossy, strong lossy, and flat-image compression.
 */

import type { ExportDefinition, ExportContext } from '../../core/export-registry';

export const compressPdfExport: ExportDefinition = {
  id: 'compress-pdf',
  label: 'Compress PDF...',
  description: 'Reduce file size with lossless, balanced lossy, or flat-image rasterization',
  extension: '.pdf',
  mimeType: 'application/pdf',
  async export(ctx: ExportContext): Promise<void> {
    if (!ctx.editorStore.isDocumentLoaded) return;
    ctx.editorStore.openCompressDialog('recommended');
  },
};
