/**
 * Document page raster image exporter.
 */

import type { ExportDefinition, ExportContext } from '../../core/export-registry';

export const imagesExport: ExportDefinition = {
  id: 'images',
  label: 'Export Images',
  description: 'Export all pages or individual pages as high-resolution PNG images',
  extension: '.png',
  mimeType: 'image/png',
  async export(ctx: ExportContext): Promise<void> {
    if (!ctx.editorStore.isDocumentLoaded) return;
    ctx.editorStore.showExportImagesDialog = true;
  },
};
