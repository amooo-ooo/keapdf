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

  private activeDocumentHandle: number = 0;
  private activeBufferPtr: number = 0;
  private activeBufferSize: number = 0;

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
   * Initialize WebAssembly engine binary and PDFium extension runtime.
   */
  public async initialize(): Promise<ExtendedWrappedPdfiumModule> {
    if (this.isInitialized && this.module) {
      return this.module;
    }

    const response = await fetch('/pdfium.wasm');
    if (!response.ok) {
      throw new Error(`Failed to load pdfium.wasm: ${response.statusText}`);
    }

    const wasmBinary = await response.arrayBuffer();
    const rawModule = await init({ wasmBinary });

    // Initialize extension runtime
    rawModule.PDFiumExt_Init();
    this.module = rawModule as unknown as ExtendedWrappedPdfiumModule;
    this.isInitialized = true;
    return this.module;
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
   * Load document from ArrayBuffer into WASM memory space.
   */
  public loadDocumentFromBuffer(buffer: ArrayBuffer): number {
    const mod = this.getModule();
    this.closeCurrentDocument();

    const bytes = new Uint8Array(buffer);
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
}
