/**
 * Concrete OCR engines: TesseractOcrEngine for in-browser execution
 * and MockOcrEngine for deterministic offline test environments.
 */

import type {
  OcrEngine,
  OcrOptions,
  OcrPageResult,
  OcrBlock,
  OcrLine,
  OcrWord,
} from './ocr-types';

/**
 * Mock OCR Engine for unit testing and offline test execution.
 * Returns deterministic text, lines, words, and bounding boxes in milliseconds
 * without requiring external network access or Web Workers.
 */
export class MockOcrEngine implements OcrEngine {
  readonly name = 'MockOcrEngine';

  private cannedResults: Map<number, OcrPageResult> = new Map();

  /**
   * Pre-registers a canned result for a specific page index.
   */
  public registerCannedResult(pageIndex: number, result: OcrPageResult): void {
    this.cannedResults.set(pageIndex, result);
  }

  /**
   * Clears any registered canned results.
   */
  public clearCannedResults(): void {
    this.cannedResults.clear();
  }

  public isAvailable(): boolean {
    return true;
  }

  public async recognize(
    canvasOrImageData: HTMLCanvasElement | ImageData,
    options?: OcrOptions
  ): Promise<OcrPageResult> {
    const width = canvasOrImageData.width || 612;
    const height = canvasOrImageData.height || 792;
    const pageIndex = 0;

    if (this.cannedResults.has(pageIndex)) {
      const canned = this.cannedResults.get(pageIndex)!;
      if (options?.onProgress) {
        options.onProgress({ pageIndex, progress: 1.0, status: 'complete' });
      }
      return canned;
    }

    if (options?.onProgress) {
      options.onProgress({ pageIndex, progress: 0.5, status: 'recognizing text' });
      options.onProgress({ pageIndex, progress: 1.0, status: 'complete' });
    }

    // Default mock recognition for test documents
    const mockWord1: OcrWord = {
      text: 'Scanned',
      confidence: 96,
      bbox: { left: 72, top: 100, width: 68, height: 16 },
      baselineY: height - 114,
      fontSize: 14,
    };
    const mockWord2: OcrWord = {
      text: 'Document',
      confidence: 95,
      bbox: { left: 145, top: 100, width: 84, height: 16 },
      baselineY: height - 114,
      fontSize: 14,
      hasPrecedingSpace: true,
    };
    const mockWord3: OcrWord = {
      text: 'Heading',
      confidence: 94,
      bbox: { left: 234, top: 100, width: 72, height: 16 },
      baselineY: height - 114,
      fontSize: 14,
      hasPrecedingSpace: true,
    };

    const line1: OcrLine = {
      text: 'Scanned Document Heading',
      confidence: 95,
      words: [mockWord1, mockWord2, mockWord3],
      bbox: { left: 72, top: 100, width: 234, height: 16 },
      baselineY: height - 114,
      fontSize: 14,
      lineHeight: 18,
    };

    const mockWord4: OcrWord = {
      text: 'Recognized',
      confidence: 92,
      bbox: { left: 72, top: 130, width: 85, height: 14 },
      baselineY: height - 142,
      fontSize: 12,
    };
    const mockWord5: OcrWord = {
      text: 'text',
      confidence: 93,
      bbox: { left: 162, top: 130, width: 28, height: 14 },
      baselineY: height - 142,
      fontSize: 12,
      hasPrecedingSpace: true,
    };
    const mockWord6: OcrWord = {
      text: 'content.',
      confidence: 91,
      bbox: { left: 195, top: 130, width: 60, height: 14 },
      baselineY: height - 142,
      fontSize: 12,
      hasPrecedingSpace: true,
    };

    const line2: OcrLine = {
      text: 'Recognized text content.',
      confidence: 92,
      words: [mockWord4, mockWord5, mockWord6],
      bbox: { left: 72, top: 130, width: 183, height: 14 },
      baselineY: height - 142,
      fontSize: 12,
      lineHeight: 16,
    };

    const block: OcrBlock = {
      lines: [line1, line2],
      bbox: { left: 72, top: 100, width: 234, height: 46 },
      confidence: 93.5,
    };

    return {
      pageIndex,
      text: 'Scanned Document Heading\nRecognized text content.',
      blocks: [block],
      lines: [line1, line2],
      words: [mockWord1, mockWord2, mockWord3, mockWord4, mockWord5, mockWord6],
      confidence: 93.5,
      widthPts: width,
      heightPts: height,
      language: options?.language || 'eng',
      durationMs: 5,
    };
  }
}

interface TesseractBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TesseractWord {
  text?: string;
  confidence?: number;
  bbox?: TesseractBbox;
}

interface TesseractLine {
  bbox?: TesseractBbox;
  words?: TesseractWord[];
}

interface TesseractParagraph {
  bbox?: TesseractBbox;
  lines?: TesseractLine[];
}

interface TesseractBlock {
  bbox?: TesseractBbox;
  confidence?: number;
  paragraphs?: TesseractParagraph[];
}

interface TesseractRecognizeResult {
  data: {
    text?: string;
    confidence?: number;
    blocks?: TesseractBlock[] | null;
  };
}

interface TesseractWorker {
  recognize(
    image: HTMLCanvasElement | ImageData,
    options?: Record<string, unknown>,
    output?: Record<string, unknown>
  ): Promise<TesseractRecognizeResult>;
  terminate(): Promise<unknown>;
}

type CreateWorkerFn = (
  langs?: string | string[],
  oem?: number,
  options?: { logger?: (m: { status?: string; progress?: number }) => void }
) => Promise<TesseractWorker>;

/**
 * Production Browser OCR Engine powered by Tesseract.js (WASM + Web Worker).
 * Loaded dynamically on demand to preserve low bundle footprint.
 */
export class TesseractOcrEngine implements OcrEngine {
  readonly name = 'TesseractOcrEngine';

  private activeWorker: TesseractWorker | null = null;
  private currentLanguage: string = 'eng';

  public isAvailable(): boolean {
    return typeof window !== 'undefined' && (typeof Worker !== 'undefined' || typeof OffscreenCanvas !== 'undefined');
  }

  /**
   * Lazily initializes or reuses the Tesseract.js worker.
   */
  private async getWorker(
    language: string,
    onProgress?: (payload: { progress: number; status: string }) => void
  ): Promise<TesseractWorker> {
    if (this.activeWorker && this.currentLanguage === language) {
      return this.activeWorker;
    }

    if (this.activeWorker) {
      await this.terminate();
    }

    const tesseract = (await import('tesseract.js')) as unknown as {
      createWorker?: CreateWorkerFn;
      default?: { createWorker?: CreateWorkerFn };
    };
    const createWorkerFn = tesseract.createWorker ?? tesseract.default?.createWorker;

    if (typeof createWorkerFn !== 'function') {
      throw new Error('Tesseract.js createWorker function is not available.');
    }

    const worker = await createWorkerFn(language, 1, {
      logger: (m: { status?: string; progress?: number }) => {
        if (onProgress && typeof m.progress === 'number') {
          onProgress({
            progress: m.progress,
            status: m.status || 'processing',
          });
        }
      },
    });

    this.activeWorker = worker;
    this.currentLanguage = language;
    return worker;
  }

  public async recognize(
    canvasOrImageData: HTMLCanvasElement | ImageData,
    options?: OcrOptions
  ): Promise<OcrPageResult> {
    const startTime = Date.now();
    const lang = options?.language || 'eng';
    const pageIndex = 0;

    const width = canvasOrImageData.width || 612;
    const height = canvasOrImageData.height || 792;

    const worker = await this.getWorker(lang, (payload) => {
      if (options?.onProgress) {
        options.onProgress({
          pageIndex,
          progress: payload.progress,
          status: payload.status,
        });
      }
    });

    const ret = await worker.recognize(canvasOrImageData);
    const data = ret.data;

    const blocks: OcrBlock[] = [];
    const lines: OcrLine[] = [];
    const words: OcrWord[] = [];

    // Parse Tesseract hierarchical data structure
    if (Array.isArray(data.blocks)) {
      for (const tBlock of data.blocks) {
        const blockLines: OcrLine[] = [];

        if (Array.isArray(tBlock.paragraphs)) {
          for (const para of tBlock.paragraphs) {
            if (Array.isArray(para.lines)) {
              for (const tLine of para.lines) {
                const lineWords: OcrWord[] = [];
                const lineBbox = tLine.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
                const lineW = Math.max(0, lineBbox.x1 - lineBbox.x0);
                const lineH = Math.max(0, lineBbox.y1 - lineBbox.y0);

                if (Array.isArray(tLine.words)) {
                  for (let wIdx = 0; wIdx < tLine.words.length; wIdx++) {
                    const tWord = tLine.words[wIdx];
                    const wBbox = tWord.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
                    const wW = Math.max(0, wBbox.x1 - wBbox.x0);
                    const wH = Math.max(0, wBbox.y1 - wBbox.y0);

                    // Skip empty or micro-glitch tokens
                    if (!tWord.text || tWord.text.trim().length === 0 || wW <= 1 || wH <= 1) {
                      continue;
                    }

                    const wordObj: OcrWord = {
                      text: tWord.text.trim(),
                      confidence: typeof tWord.confidence === 'number' ? tWord.confidence : 80,
                      bbox: {
                        left: wBbox.x0,
                        top: wBbox.y0,
                        width: wW,
                        height: wH,
                      },
                      baselineY: height - (wBbox.y1 - (wH * 0.15)),
                      fontSize: Math.max(8, Math.round(wH * 0.8)),
                      hasPrecedingSpace: wIdx > 0,
                    };

                    lineWords.push(wordObj);
                    words.push(wordObj);
                  }
                }

                if (lineWords.length > 0) {
                  const lineText = lineWords.map((w, idx) => (idx > 0 && w.hasPrecedingSpace ? ` ${w.text}` : w.text)).join('');
                  const lineConfidence = Math.round(lineWords.reduce((acc, w) => acc + w.confidence, 0) / lineWords.length);
                  const effectiveFontSize = lineWords[0].fontSize;

                  const lineObj: OcrLine = {
                    text: lineText,
                    confidence: lineConfidence,
                    words: lineWords,
                    bbox: {
                      left: lineBbox.x0,
                      top: lineBbox.y0,
                      width: lineW,
                      height: lineH,
                    },
                    baselineY: height - (lineBbox.y1 - (lineH * 0.15)),
                    fontSize: effectiveFontSize,
                    lineHeight: Math.max(effectiveFontSize * 1.2, lineH),
                  };

                  blockLines.push(lineObj);
                  lines.push(lineObj);
                }
              }
            }
          }
        }

        if (blockLines.length > 0) {
          const blockBbox = tBlock.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
          blocks.push({
            lines: blockLines,
            bbox: {
              left: blockBbox.x0,
              top: blockBbox.y0,
              width: Math.max(0, blockBbox.x1 - blockBbox.x0),
              height: Math.max(0, blockBbox.y1 - blockBbox.y0),
            },
            confidence: Math.round(blockLines.reduce((acc, l) => acc + l.confidence, 0) / blockLines.length),
          });
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const overallConfidence = typeof data.confidence === 'number' ? data.confidence : 85;

    return {
      pageIndex,
      text: data.text || lines.map((l) => l.text).join('\n'),
      blocks,
      lines,
      words,
      confidence: overallConfidence,
      widthPts: width,
      heightPts: height,
      language: lang,
      durationMs,
    };
  }

  public async terminate(): Promise<void> {
    if (this.activeWorker) {
      try {
        await this.activeWorker.terminate();
      } catch {
        // Safe disposal
      }
      this.activeWorker = null;
    }
  }
}
