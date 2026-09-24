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

export interface PdfiumSecurityMethods {
  EPDF_IsEncrypted(docHandle: number): boolean;
  EPDF_IsOwnerUnlocked(docHandle: number): boolean;
  EPDF_UnlockOwnerPermissions(docHandle: number, password: string): boolean;
  EPDF_RemoveEncryption(docHandle: number): boolean;
  EPDF_SetEncryption(
    docHandle: number,
    userPassword: string,
    ownerPassword: string,
    permissions: number
  ): boolean;
  FPDF_GetDocPermissions(docHandle: number): number;
  FPDF_GetDocUserPermissions?(docHandle: number): number;
}

export interface PdfiumImageMethods {
  FPDFImageObj_GetBitmap?(imageObject: number): number;
  FPDFImageObj_SetBitmap?(pagesPtr: number, count: number, imageObject: number, bitmap: number): boolean;
  FPDFBitmap_FillRect?(bitmap: number, left: number, top: number, width: number, height: number, color: number): boolean;
  FPDFBitmap_Destroy?(bitmap: number): void | null;
  FPDFBitmap_GetWidth?(bitmap: number): number;
  FPDFBitmap_GetHeight?(bitmap: number): number;
  FPDFBitmap_GetStride?(bitmap: number): number;
  FPDFBitmap_GetFormat?(bitmap: number): number;
  FPDFBitmap_GetBuffer?(bitmap: number): number;
}

export interface PdfiumTextFontMethods {
  FPDFText_LoadFont?(
    document: number,
    dataPtr: number,
    size: number,
    fontType: number,
    cid: boolean | number
  ): number;
  FPDFText_LoadStandardFont?(
    document: number,
    fontName: string
  ): number;
  FPDFFont_Close?(fontHandle: number): void;
}

export type ExtendedPdfiumRuntime = PdfiumModule & PdfiumRuntimeMethods & EmscriptenHeaps;

export type ExtendedWrappedPdfiumModule = Omit<WrappedPdfiumModule, 'pdfium'> &
  PdfiumSecurityMethods &
  PdfiumImageMethods &
  PdfiumTextFontMethods & {
    pdfium: ExtendedPdfiumRuntime;
  };

/**
 * Error raised when opening an encrypted PDF document that requires a password or received an invalid password.
 */
export class PasswordRequiredError extends Error {
  constructor(message: string = 'Password required or incorrect password to open PDF.') {
    super(message);
    this.name = 'PasswordRequiredError';
  }
}

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
  private matrixScratchPtr: number = 0;

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
   * Indicates whether the underlying WebAssembly module has finished initialisation.
   */
  public get isReady(): boolean {
    return this.isInitialized && this.module !== null;
  }

  /**
   * Initialise WebAssembly engine binary and PDFium extension runtime.
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

        // Initialise extension runtime
        rawModule.PDFiumExt_Init();
        this.module = rawModule as unknown as ExtendedWrappedPdfiumModule;
        this.isInitialized = true;
        return this.module;
      } catch (err) {
        this.initPromise = null;
        this.isInitialized = false;
        this.module = null;
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
   * Accepts an optional decryption password for encrypted documents.
   */
  public loadDocumentFromBuffer(buffer: ArrayBuffer | Uint8Array, password: string = ''): number {
    const mod = this.getModule();
    this.closeCurrentDocument();

    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.byteLength === 0) {
      throw new Error('Cannot load empty or zero-byte buffer as PDF document.');
    }

    this.activeBufferSize = bytes.byteLength;
    this.activeBufferPtr = mod.pdfium.wasmExports.malloc(this.activeBufferSize);

    if (!this.activeBufferPtr) {
      this.activeBufferSize = 0;
      throw new Error(
        `Failed to allocate ${bytes.byteLength} bytes in WASM heap for PDF document.`
      );
    }

    try {
      mod.pdfium.HEAPU8.set(bytes, this.activeBufferPtr);

      // Call FPDF_LoadMemDocument(bufPtr, size, password)
      this.activeDocumentHandle = mod.FPDF_LoadMemDocument(
        this.activeBufferPtr,
        this.activeBufferSize,
        password
      );
    } catch (err) {
      this.freeActiveBuffer();
      throw err;
    }

    if (!this.activeDocumentHandle) {
      this.freeActiveBuffer();
      const lastError = mod.FPDF_GetLastError();
      if (lastError === 4) {
        throw new PasswordRequiredError('Password required or incorrect password to open PDF.');
      }
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
    if (this.activeDocumentHandle) {
      const handle = this.activeDocumentHandle;
      this.activeDocumentHandle = 0;
      if (this.module) {
        try {
          this.module.FPDF_CloseDocument(handle);
        } catch {
          // Handle might have already been freed or closed
        }
      }
    }
    this.freeActiveBuffer();
    this.freeScratchBuffers();
  }

  /**
   * Free active WebAssembly heap buffer.
   */
  private freeActiveBuffer(): void {
    const ptr = this.activeBufferPtr;
    this.activeBufferPtr = 0;
    this.activeBufferSize = 0;
    if (ptr && this.module) {
      try {
        this.module.pdfium.wasmExports.free(ptr);
      } catch {
        // Handle might have already been freed
      }
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
   * Retrieve persistent scratch buffer for character fill colour queries (16 bytes for RGBA uint32s).
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
   * Retrieve persistent scratch buffer for 6-float FS_MATRIX transformation queries (24 bytes).
   * Eliminates malloc and free churn during paragraph reflow and text matrix manipulation.
   */
  public getMatrixScratchBuffer(): { matrixPtr: number } {
    if (!this.matrixScratchPtr) {
      this.matrixScratchPtr = this.allocateMemory(24);
    }
    return {
      matrixPtr: this.matrixScratchPtr,
    };
  }

  /**
   * Releases all persistent scratch buffers.
   */
  public freeScratchBuffers(): void {
    const fontBuf = this.fontNameBufPtr;
    this.fontNameBufPtr = 0;
    if (fontBuf) this.freeMemory(fontBuf);

    const flagsBuf = this.fontFlagsPtr;
    this.fontFlagsPtr = 0;
    if (flagsBuf) this.freeMemory(flagsBuf);

    const colorBuf = this.colorScratchPtr;
    this.colorScratchPtr = 0;
    if (colorBuf) this.freeMemory(colorBuf);

    const boundsBuf = this.boundsScratchPtr;
    this.boundsScratchPtr = 0;
    if (boundsBuf) this.freeMemory(boundsBuf);

    const matrixBuf = this.matrixScratchPtr;
    this.matrixScratchPtr = 0;
    if (matrixBuf) this.freeMemory(matrixBuf);
  }
}
