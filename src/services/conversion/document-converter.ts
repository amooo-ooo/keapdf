/**
 * Document Converter Coordinator and Registry.
 * Dispatches files to format-specific converters and handles conversion pipelines.
 */

import { PDFDocument } from 'pdf-lib';
import type {
  ConversionInputItem,
  ConvertedDocumentResult,
  DocumentConversionOptions,
  DocumentFormat,
  FormatConverter,
} from './types';
import { DocxConverter } from './converters/docx-converter';
import { SpreadsheetConverter } from './converters/spreadsheet-converter';
import { PptxConverter } from './converters/pptx-converter';
import { TextConverter } from './converters/text-converter';

export class DocumentConverter {
  private readonly converters: FormatConverter[] = [];

  constructor() {
    this.registerConverter(new DocxConverter());
    this.registerConverter(new SpreadsheetConverter());
    this.registerConverter(new PptxConverter());
    this.registerConverter(new TextConverter());
  }

  /**
   * Registers a format converter.
   */
  registerConverter(converter: FormatConverter): void {
    this.converters.push(converter);
  }

  /**
   * Retrieves all registered converters.
   */
  getConverters(): readonly FormatConverter[] {
    return this.converters;
  }

  /**
   * Returns an array of all file extensions supported by registered converters.
   */
  getSupportedExtensions(): readonly string[] {
    const extSet = new Set<string>();
    for (const c of this.converters) {
      for (const ext of c.extensions) {
        extSet.add(ext.toLowerCase());
      }
    }
    return Array.from(extSet);
  }

  /**
   * Checks whether a file can be converted to PDF.
   */
  isConvertible(
    fileName: string,
    buffer?: ArrayBuffer | Uint8Array,
    mimeType?: string
  ): boolean {
    const dummyBuffer = buffer ?? new Uint8Array(0);
    for (const converter of this.converters) {
      if (converter.canConvert(fileName, dummyBuffer, mimeType)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Detects the DocumentFormat of a file.
   */
  detectFormat(
    fileName: string,
    _buffer?: ArrayBuffer | Uint8Array,
    _mimeType?: string
  ): DocumentFormat {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.docx')) return 'docx';
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
    if (lower.endsWith('.csv')) return 'csv';
    if (lower.endsWith('.tsv')) return 'tsv';
    if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'pptx';
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
    if (lower.endsWith('.txt')) return 'text';
    if (lower.endsWith('.json')) return 'json';
    if (
      lower.endsWith('.xml') ||
      lower.endsWith('.html') ||
      lower.endsWith('.htm') ||
      lower.endsWith('.yaml') ||
      lower.endsWith('.yml') ||
      lower.endsWith('.log') ||
      lower.endsWith('.js') ||
      lower.endsWith('.ts')
    ) {
      return 'code';
    }
    if (lower.endsWith('.rtf')) return 'rtf';
    if (
      lower.endsWith('.png') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.webp') ||
      lower.endsWith('.gif') ||
      lower.endsWith('.bmp') ||
      lower.endsWith('.svg') ||
      lower.endsWith('.avif')
    ) {
      return 'image';
    }
    return 'unknown';
  }

  /**
   * Finds the appropriate converter for a given file.
   */
  findConverter(
    fileName: string,
    buffer: ArrayBuffer | Uint8Array,
    mimeType?: string
  ): FormatConverter | undefined {
    return this.converters.find((c) => c.canConvert(fileName, buffer, mimeType));
  }

  /**
   * Converts a single input item into a vector PDF document.
   */
  async convertDocument(
    input: ConversionInputItem,
    options?: DocumentConversionOptions
  ): Promise<ConvertedDocumentResult> {
    const converter = this.findConverter(input.name, input.buffer, input.mimeType);
    if (!converter) {
      throw new Error(`Unsupported document format for conversion: "${input.name}".`);
    }

    try {
      return await converter.convert(input, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to convert "${input.name}": ${message}`);
    }
  }

  /**
   * Converts multiple documents into separate PDF results.
   */
  async convertMultipleDocuments(
    inputs: ConversionInputItem[],
    options?: DocumentConversionOptions
  ): Promise<ConvertedDocumentResult[]> {
    const results: ConvertedDocumentResult[] = [];
    for (const input of inputs) {
      const res = await this.convertDocument(input, options);
      results.push(res);
    }
    return results;
  }

  /**
   * Converts multiple documents and merges them into a single unified PDF document.
   */
  async convertDocumentsAndMerge(
    inputs: ConversionInputItem[],
    options?: DocumentConversionOptions
  ): Promise<ConvertedDocumentResult> {
    if (inputs.length === 0) {
      throw new Error('No documents provided for conversion and merging.');
    }

    const converted = await this.convertMultipleDocuments(inputs, options);
    if (converted.length === 1) {
      return converted[0];
    }

    const mergedDoc = await PDFDocument.create();
    for (const item of converted) {
      const srcDoc = await PDFDocument.load(item.buffer, { ignoreEncryption: true });
      const indices = srcDoc.getPageIndices();
      const pages = await mergedDoc.copyPages(srcDoc, indices);
      for (const page of pages) {
        mergedDoc.addPage(page);
      }
    }

    const mergedBytes = await mergedDoc.save({ updateFieldAppearances: false });
    const buffer = mergedBytes.buffer.slice(
      mergedBytes.byteOffset,
      mergedBytes.byteOffset + mergedBytes.byteLength
    ) as ArrayBuffer;

    const baseName = inputs[0].name.replace(/\.[^/.]+$/, '');
    const pageCount = mergedDoc.getPageCount();

    return {
      buffer,
      pageCount,
      fileName: `${baseName}_converted_merged.pdf`,
      format: 'unknown',
      metadata: {
        title: `${baseName} (Merged)`,
        conversionDurationMs: converted.reduce((acc, c) => acc + c.metadata.conversionDurationMs, 0),
      },
    };
  }
}

export const documentConverter = new DocumentConverter();
