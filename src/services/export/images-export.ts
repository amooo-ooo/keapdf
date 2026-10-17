/**
 * Document page raster image exporter.
 */

import type { ExportDefinition, ExportContext } from '../../core/export-registry';

export const imagesExport: ExportDefinition = {
  id: 'images',
  label: 'Images...',
  description: 'Export all pages or individual pages as high-resolution PNG or JPEG images',
  extension: '.png',
  mimeType: 'image/png',
  category: 'image',
  async export(ctx: ExportContext): Promise<void> {
    if (!ctx.editorStore.isDocumentLoaded) return;
    ctx.editorStore.showExportImagesDialog = true;
  },
};
