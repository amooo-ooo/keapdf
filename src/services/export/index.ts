/**
 * Built-in export definitions barrel and registry setup.
 */

import type { ExportRegistry } from '../../core/export-registry';
import { pdfExport } from './pdf-export';
import { flattenedPdfExport } from './flattened-pdf-export';
import { compressPdfExport } from './compress-export';
import { imagesExport } from './images-export';
import { textExport } from './text-export';

/**
 * Registers all built-in export format definitions into the export registry.
 *
 * @param registry The target export registry instance.
 */
export function registerBuiltinExporters(registry: ExportRegistry): void {
  registry.registerBuiltin(pdfExport);
  registry.registerBuiltin(flattenedPdfExport);
  registry.registerBuiltin(compressPdfExport);
  registry.registerBuiltin(imagesExport);
  registry.registerBuiltin(textExport);
}

export {
  pdfExport,
  flattenedPdfExport,
  compressPdfExport,
  imagesExport,
  textExport,
};
