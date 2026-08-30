import { init, PdfiumModule, PdfiumRuntimeMethods, WrappedPdfiumModule } from '@embedpdf/pdfium';

export interface EmscriptenHeaps {
  HEAP8: Int8Array;
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
}

export type ExtendedPdfiumRuntime = PdfiumModule & PdfiumRuntimeMethods & EmscriptenHeaps;

export type ExtendedWrappedPdfiumModule = Omit<WrappedPdfiumModule, 'pdfium'> & {
  pdfium: ExtendedPdfiumRuntime;
};

/**
 * Singleton wrapper around PDFium WebAssembly module.
 * Provides memory buffer allocation and low-level document handle management.
 */
export class PdfiumEngine {
  private static instance: PdfiumEngine | null = null;
  private module: ExtendedWrappedPdfiumModule | null = null;
  private isInitialized = false;
  private initPromise: Promise<ExtendedWrappedPdfiumModule> | null = null;

  private activeDocumentHandle: number = 0;
  private activeBufferPtr: number = 0;
  private activeBufferSize: number = 0;

  // Persistent scratch buffers to eliminate per-character malloc/free churn
  private fontNameBufPtr: number = 0;
  private fontFlagsPtr: number = 0;
  private colorScratchPtr: number = 0;
  private boundsScratchPtr: number = 0;

  private constructor() {}

  /**
   * Access singleton instance of engine.
   */
  public static getInstance(): PdfiumEngine {
    if (!PdfiumEngine.instance) {
      PdfiumEngine.instance = new PdfiumEngine();
    }
    return PdfiumEngine.instance;
  }

  /**
   * Indicates whether the underlying WebAssembly module has finished initialization.
   */
  public get isReady(): boolean {
    return this.isInitialized && this.module !== null;
  }

  /**
   * Initialize WebAssembly engine binary and PDFium extension runtime.
   */
  public async initialize(options?: { wasmBinary?: ArrayBuffer | Uint8Array }): Promise<ExtendedWrappedPdfiumModule> {
    if (this.isInitialized && this.module) {
      return this.module;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        let wasmBinary: ArrayBuffer | Uint8Array;
        if (options?.wasmBinary) {
          wasmBinary = options.wasmBinary;
        } else {
          const response = await fetch('/pdfium.wasm');
          if (!response.ok) {
            throw new Error(`Failed to load pdfium.wasm: ${response.statusText}`);
          }
          wasmBinary = await response.arrayBuffer();
        }

        const rawModule = await init({ wasmBinary });

        // Initialize extension runtime
        rawModule.PDFiumExt_Init();
        this.module = rawModule as unknown as ExtendedWrappedPdfiumModule;
        this.isInitialized = true;
        return this.module;
      } catch (err) {
        this.initPromise = null;
        throw err;
      }
    })();
    return this.initPromise;
  }

  /**
   * Retrieve underlying WebAssembly module bindings.
   */
  public getModule(): ExtendedWrappedPdfiumModule {
    if (!this.module || !this.isInitialized) {
      throw new Error('PDFium engine is not initialized. Call initialize() first.');
    }
    return this.module;
  }

  /**
   * Load document from ArrayBuffer or Uint8Array into WASM memory space.
   */
  public loadDocumentFromBuffer(buffer: ArrayBuffer | Uint8Array): number {
    const mod = this.getModule();
    this.closeCurrentDocument();

    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.activeBufferSize = bytes.byteLength;
    this.activeBufferPtr = mod.pdfium.wasmExports.malloc(this.activeBufferSize);

    if (!this.activeBufferPtr) {
      this.activeBufferSize = 0;
      throw new Error(
        `Failed to allocate ${bytes.byteLength} bytes in WASM heap for PDF document.`
      );
    }

    const heapBytes = new Uint8Array(
      mod.pdfium.HEAPU8.buffer,
      this.activeBufferPtr,
      this.activeBufferSize
    );
    heapBytes.set(bytes);

    // Call FPDF_LoadMemDocument(bufPtr, size, password)
    this.activeDocumentHandle = mod.FPDF_LoadMemDocument(
      this.activeBufferPtr,
      this.activeBufferSize,
      ''
    );

    if (!this.activeDocumentHandle) {
      this.freeActiveBuffer();
      const lastError = mod.FPDF_GetLastError();
      throw new Error(`Failed to load PDF document from buffer. PDFium error code: ${lastError}`);
    }

    return this.activeDocumentHandle;
  }

  /**
   * Return current document pointer handle.
   */
  public getDocumentHandle(): number {
    return this.activeDocumentHandle;
  }

  /**
   * Close active document and free memory buffers.
   */
  public closeCurrentDocument(): void {
    if (this.activeDocumentHandle && this.module) {
      this.module.FPDF_CloseDocument(this.activeDocumentHandle);
      this.activeDocumentHandle = 0;
    }
    this.freeActiveBuffer();
    this.freeScratchBuffers();
  }

  /**
   * Free active WebAssembly heap buffer.
   */
  private freeActiveBuffer(): void {
    if (this.activeBufferPtr && this.module) {
      this.module.pdfium.wasmExports.free(this.activeBufferPtr);
      this.activeBufferPtr = 0;
      this.activeBufferSize = 0;
    }
  }

  /**
   * Allocate WASM memory buffer.
   */
  public allocateMemory(sizeBytes: number): number {
    const mod = this.getModule();
    return mod.pdfium.wasmExports.malloc(sizeBytes);
  }

  /**
   * Free WASM memory buffer.
   */
  public freeMemory(ptr: number): void {
    if (ptr && this.module) {
      this.module.pdfium.wasmExports.free(ptr);
    }
  }

  /**
   * Retrieve persistent scratch buffer for font name queries (128-byte string + 4-byte flags).
   * Eliminates 2 WASM allocations per character.
   */
  public getFontNameScratchBuffer(): { fontBufPtr: number; flagsPtr: number } {
    if (!this.fontNameBufPtr) {
      this.fontNameBufPtr = this.allocateMemory(128);
    }
    if (!this.fontFlagsPtr) {
      this.fontFlagsPtr = this.allocateMemory(4);
    }
    return { fontBufPtr: this.fontNameBufPtr, flagsPtr: this.fontFlagsPtr };
  }

  /**
   * Retrieve persistent scratch buffer for character fill color queries (16 bytes for RGBA uint32s).
   * Eliminates 4 WASM allocations per character.
   */
  public getColorScratchBuffer(): {
    rPtr: number;
    gPtr: number;
    bPtr: number;
    aPtr: number;
    basePtr: number;
  } {
    if (!this.colorScratchPtr) {
      this.colorScratchPtr = this.allocateMemory(16);
    }
    return {
      basePtr: this.colorScratchPtr,
      rPtr: this.colorScratchPtr,
      gPtr: this.colorScratchPtr + 4,
      bPtr: this.colorScratchPtr + 8,
      aPtr: this.colorScratchPtr + 12,
    };
  }

  /**
   * Retrieve persistent scratch buffer for 4-float bounding box queries (16 bytes).
   * Eliminates 4 WASM allocations per object bounds query.
   */
  public getBoundsScratchBuffer(): {
    leftPtr: number;
    bottomPtr: number;
    rightPtr: number;
    topPtr: number;
    basePtr: number;
  } {
    if (!this.boundsScratchPtr) {
      this.boundsScratchPtr = this.allocateMemory(16);
    }
    return {
      basePtr: this.boundsScratchPtr,
      leftPtr: this.boundsScratchPtr,
      bottomPtr: this.boundsScratchPtr + 4,
      rightPtr: this.boundsScratchPtr + 8,
      topPtr: this.boundsScratchPtr + 12,
    };
  }

  /**
   * Releases all persistent scratch buffers.
   */
  public freeScratchBuffers(): void {
    if (this.fontNameBufPtr) {
      this.freeMemory(this.fontNameBufPtr);
      this.fontNameBufPtr = 0;
    }
    if (this.fontFlagsPtr) {
      this.freeMemory(this.fontFlagsPtr);
      this.fontFlagsPtr = 0;
    }
    if (this.colorScratchPtr) {
      this.freeMemory(this.colorScratchPtr);
      this.colorScratchPtr = 0;
    }
    if (this.boundsScratchPtr) {
      this.freeMemory(this.boundsScratchPtr);
      this.boundsScratchPtr = 0;
    }
  }
}
