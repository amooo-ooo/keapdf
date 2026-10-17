/**
 * Built-in export definitions barrel and registry setup.
 */

import type { ExportRegistry } from '../../core/export-registry';
import { pdfExport } from './pdf-export';
import { flattenedPdfExport } from './flattened-pdf-export';
import { compressPdfExport } from './compress-export';
import { docxExport } from './docx-export';
import { pptxExport } from './pptx-export';
import { xlsxExport } from './xlsx-export';
import { csvExport } from './csv-export';
import { htmlExport } from './html-export';
import { markdownExport } from './markdown-export';
import { textExport } from './text-export';
import { imagesExport } from './images-export';

/**
 * Registers all built-in export format definitions into the export registry
 * in industry-standard category order (PDF, Office, Data, Web/Text, Images).
 *
 * @param registry The target export registry instance.
 */
export function registerBuiltinExporters(registry: ExportRegistry): void {
  registry.registerBuiltin(pdfExport);
  registry.registerBuiltin(flattenedPdfExport);
  registry.registerBuiltin(compressPdfExport);
  registry.registerBuiltin(docxExport);
  registry.registerBuiltin(pptxExport);
  registry.registerBuiltin(xlsxExport);
  registry.registerBuiltin(csvExport);
  registry.registerBuiltin(htmlExport);
  registry.registerBuiltin(markdownExport);
  registry.registerBuiltin(textExport);
  registry.registerBuiltin(imagesExport);
}

export {
  pdfExport,
  flattenedPdfExport,
  compressPdfExport,
  docxExport,
  pptxExport,
  xlsxExport,
  csvExport,
  htmlExport,
  markdownExport,
  textExport,
  imagesExport,
};
