/**
 * High-level Optical Character Recognition (OCR) Service for Kea PDF.
 * Detects scanned documents, orchestrates text recognition, converts OCR results into
 * selectable and editable overlay spans, and embeds searchable PDF sandwich text layers.
 */

import type { PdfDocument } from '../pdf/pdf-document';
import type { PdfPage } from '../pdf/pdf-page';
import type {
  OcrEngine,
  OcrOptions,
  OcrPageResult,
  OcrSpanConversion,
  ScannedPageDetection,
} from './ocr-types';
import { ocrResultToSpans } from './ocr-span-converter';
import { TesseractOcrEngine, MockOcrEngine } from './ocr-engine';

/**
 * Service managing OCR operations, page scan detection, and text layer synthesis.
 */
export class OcrService {
  private static instance: OcrService | null = null;

  private defaultEngine: OcrEngine;
  private pageResults: Map<string, OcrPageResult> = new Map();

  constructor(customEngine?: OcrEngine) {
    if (customEngine) {
      this.defaultEngine = customEngine;
    } else if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      this.defaultEngine = new TesseractOcrEngine();
    } else {
      this.defaultEngine = new MockOcrEngine();
    }
  }

  /**
   * Retrieves the singleton OcrService instance.
   */
  public static getInstance(): OcrService {
    if (!OcrService.instance) {
      OcrService.instance = new OcrService();
    }
    return OcrService.instance;
  }

  /**
   * Sets or overrides the active OCR engine (e.g. inject MockOcrEngine for unit tests).
   */
  public setEngine(engine: OcrEngine): void {
    this.defaultEngine = engine;
  }

  /**
   * Gets the active OCR engine.
   */
  public getEngine(): OcrEngine {
    return this.defaultEngine;
  }

  /**
   * Evaluates whether a given page is an image-only scanned page.
   *
   * @param page The PdfPage instance to inspect.
   * @return ScannedPageDetection metrics.
   */
  public isPageScanned(page: PdfPage): ScannedPageDetection {
    const pageIndex = page.getIndex();
    let textCharCount = 0;
    let imageObjectCount = 0;

    try {
      const chars = page.extractCharacters();
      textCharCount = chars.filter((c) => c.unicode.trim().length > 0).length;
    } catch {
      textCharCount = 0;
    }

    try {
      const objects = page.extractObjects();
      imageObjectCount = objects.images.length;
    } catch {
      imageObjectCount = 0;
    }

    // A page is classified as scanned if it has very low/no native text and has image content
    const hasNoNativeText = textCharCount < 10;
    const hasImageContent = imageObjectCount > 0;

    const isScanned = hasNoNativeText && (hasImageContent || page.getContentBounds() !== null);
    const confidence = isScanned
      ? (textCharCount === 0 && imageObjectCount >= 1 ? 95 : 80)
      : 0;

    const reason = isScanned
      ? `Found ${imageObjectCount} image object(s) with only ${textCharCount} text character(s)`
      : `Page contains ${textCharCount} native text character(s)`;

    return {
      pageIndex,
      isScanned,
      textCharCount,
      imageObjectCount,
      confidence,
      reason,
    };
  }

  /**
   * Evaluates all pages in a document and detects which pages are scanned image documents.
   *
   * @param doc The PdfDocument instance.
   * @return Map of zero-based page indices to their detection status.
   */
  public detectDocumentScannedPages(doc: PdfDocument): Map<number, ScannedPageDetection> {
    const results = new Map<number, ScannedPageDetection>();
    const pageCount = doc.getPageCount();

    for (let i = 0; i < pageCount; i++) {
      try {
        const page = doc.getPage(i);
        const detection = this.isPageScanned(page);
        if (detection.isScanned) {
          results.set(i, detection);
        }
      } catch {
        // Safe fallback for unreadable pages
      }
    }

    return results;
  }

  /**
   * Performs OCR recognition on a rendered page.
   *
   * @param page The PdfPage instance.
   * @param options Optional OCR options.
   * @param engine Optional engine override.
   * @return Promise resolving to OcrPageResult.
   */
  public async recognizePage(
    page: PdfPage,
    options?: OcrOptions,
    engine?: OcrEngine
  ): Promise<OcrPageResult> {
    const activeEngine = engine || this.defaultEngine;
    const pageIndex = page.getIndex();
    const dims = page.getDimensions();

    // Render page canvas at 1.5 scale (or requested scale) for sharp OCR glyph recognition
    const renderScale = options?.scale || 1.5;
    const renderResult = page.render(renderScale);

    const ocrResult = await activeEngine.recognize(renderResult.canvas, {
      ...options,
      onProgress: (payload) => {
        if (options?.onProgress) {
          options.onProgress({
            ...payload,
            pageIndex,
          });
        }
      },
    });

    // Scale pixel bounding boxes back to PDF point dimensions
    const scaleFactor = dims.widthPts > 0 && ocrResult.widthPts > 0
      ? dims.widthPts / ocrResult.widthPts
      : 1 / renderScale;

    if (Math.abs(scaleFactor - 1.0) > 0.01) {
      this.rescaleOcrResult(ocrResult, scaleFactor, dims.widthPts, dims.heightPts);
    }

    ocrResult.pageIndex = pageIndex;
    this.pageResults.set(`${pageIndex}`, ocrResult);

    return ocrResult;
  }

  /**
   * Rescales an OCR result's bounding boxes to match PDF point coordinates.
   */
  private rescaleOcrResult(
    result: OcrPageResult,
    factor: number,
    pageWidthPts: number,
    pageHeightPts: number
  ): void {
    result.widthPts = pageWidthPts;
    result.heightPts = pageHeightPts;

    for (const block of result.blocks) {
      block.bbox.left = Math.round(block.bbox.left * factor * 10) / 10;
      block.bbox.top = Math.round(block.bbox.top * factor * 10) / 10;
      block.bbox.width = Math.round(block.bbox.width * factor * 10) / 10;
      block.bbox.height = Math.round(block.bbox.height * factor * 10) / 10;

      for (const line of block.lines) {
        line.bbox.left = Math.round(line.bbox.left * factor * 10) / 10;
        line.bbox.top = Math.round(line.bbox.top * factor * 10) / 10;
        line.bbox.width = Math.round(line.bbox.width * factor * 10) / 10;
        line.bbox.height = Math.round(line.bbox.height * factor * 10) / 10;
        line.fontSize = Math.max(8, Math.round(line.fontSize * factor));
        line.baselineY = pageHeightPts - (line.bbox.top + line.fontSize * 0.85);

        for (const word of line.words) {
          word.bbox.left = Math.round(word.bbox.left * factor * 10) / 10;
          word.bbox.top = Math.round(word.bbox.top * factor * 10) / 10;
          word.bbox.width = Math.round(word.bbox.width * factor * 10) / 10;
          word.bbox.height = Math.round(word.bbox.height * factor * 10) / 10;
          word.fontSize = Math.max(8, Math.round(word.fontSize * factor));
          word.baselineY = pageHeightPts - (word.bbox.top + word.fontSize * 0.85);
        }
      }
    }
  }

  /**
   * Converts structured OCR recognition results into native EditableTextSpan and PageCharacter models.
   *
   * @param ocrResult The recognized page OCR result.
   * @return OcrSpanConversion containing textSpans and characters with isOcr = true.
   */
  public ocrResultToSpans(ocrResult: OcrPageResult): OcrSpanConversion {
    return ocrResultToSpans(ocrResult);
  }

  /**
   * Embeds invisible text objects into the PDFium page content stream,
   * transforming the scanned page into an ISO 32000-compliant searchable sandwich PDF.
   *
   * @param page The target PdfPage.
   * @param ocrResult The recognized OCR page result.
   */
  public embedSearchableTextLayer(page: PdfPage, ocrResult: OcrPageResult): void {
    for (const line of ocrResult.lines) {
      if (!line.text.trim()) continue;

      // Draw invisible text (alpha = 0) at the exact baseline coordinates
      page.drawText({
        text: line.text,
        fontSize: line.fontSize || 12,
        fontFamily: 'Helvetica',
        x: line.bbox.left,
        y: line.bbox.top,
        color: 'rgba(0, 0, 0, 0)', // 0 alpha makes it invisible in rendered view
      });
    }

    page.generateContent();
  }

  /**
   * Retrieves any cached OCR result for a given page index.
   */
  public getCachedResult(pageIndex: number): OcrPageResult | undefined {
    return this.pageResults.get(`${pageIndex}`);
  }

  /**
   * Clears cached OCR results for a given page or across the entire document.
   */
  public clearCache(pageIndex?: number): void {
    if (pageIndex !== undefined) {
      this.pageResults.delete(`${pageIndex}`);
    } else {
      this.pageResults.clear();
    }
  }
}
