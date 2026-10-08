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
  FPDFImageObj_GetRenderedBitmap?(docHandle: number, pageHandle: number, imageObject: number): number;
  FPDFImageObj_GetImagePixelSize?(imageObject: number, widthPtr: number, heightPtr: number): boolean | number;
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

export interface PdfiumFormFillMethods {
  FPDF_GetFormType?(docHandle: number): number;
  PDFiumExt_OpenFormFillInfo?(): number;
  PDFiumExt_CloseFormFillInfo?(formFillInfoPtr: number): void;
  PDFiumExt_InitFormFillEnvironment?(docHandle: number, formFillInfoPtr: number): number;
  PDFiumExt_ExitFormFillEnvironment?(formHandle: number): void;
  FORM_OnAfterLoadPage?(pageHandle: number, formHandle: number): void;
  FORM_OnBeforeClosePage?(pageHandle: number, formHandle: number): void;
  FPDF_FFLDraw?(
    formHandle: number,
    bitmapHandle: number,
    pageHandle: number,
    startX: number,
    startY: number,
    sizeX: number,
    sizeY: number,
    rotate: number,
    flags: number
  ): void;
}

export interface PdfiumVectorPathMethods {
  FPDFPageObj_GetFillColor?(
    pageObject: number,
    rPtr: number,
    gPtr: number,
    bPtr: number,
    aPtr: number
  ): boolean;
  FPDFPageObj_GetStrokeColor?(
    pageObject: number,
    rPtr: number,
    gPtr: number,
    bPtr: number,
    aPtr: number
  ): boolean;
  FPDFPageObj_GetStrokeWidth?(
    pageObject: number,
    strokeWidthPtr: number
  ): boolean;
  FPDFPageObj_GetLineCap?(pageObject: number): number;
  FPDFPageObj_GetLineJoin?(pageObject: number): number;
  FPDFPageObj_HasTransparency?(pageObject: number): boolean | number;
  FPDFPath_GetDrawMode?(
    pathObject: number,
    fillModePtr: number,
    strokePtr: number
  ): boolean;
  FPDFPath_CountSegments?(pathObject: number): number;
  FPDFPath_GetPathSegment?(pathObject: number, index: number): number;
  FPDFPathSegment_GetPoint?(
    segmentHandle: number,
    xPtr: number,
    yPtr: number
  ): boolean;
  FPDFPathSegment_GetType?(segmentHandle: number): number;
  FPDFPathSegment_GetClose?(segmentHandle: number): boolean | number;
}

export interface PdfiumAnnotationMethods {
  FPDFAnnot_GetObjectCount?(annotHandle: number): number;
  FPDFAnnot_GetObject?(annotHandle: number, index: number): number;
  FPDFAnnot_GetColor?(
    annotHandle: number,
    type: number,
    rPtr: number,
    gPtr: number,
    bPtr: number,
    aPtr: number
  ): boolean | number;
  FPDFAnnot_CountAttachmentPoints?(annotHandle: number): number;
  FPDFAnnot_GetAttachmentPoints?(
    annotHandle: number,
    quadIndex: number,
    quadPointsPtr: number
  ): boolean | number;
  FPDFAnnot_GetInkListCount?(annotHandle: number): number;
  FPDFAnnot_GetInkListPath?(
    annotHandle: number,
    pathIndex: number,
    bufferPtr: number,
    length: number
  ): number;
  FPDFAnnot_GetBorder?(
    annotHandle: number,
    horizontalRadiusPtr: number,
    verticalRadiusPtr: number,
    borderWidthPtr: number
  ): boolean | number;
  FPDFAnnot_GetLinkedAnnot?(annotHandle: number, key: string): number;
  EPDFAnnot_ExportAppearanceAsDocument?(annotHandle: number): number;
  FPDFFormObj_CountObjects?(formObject: number): number;
  FPDFFormObj_GetObject?(formObject: number, index: number): number;
}

export type ExtendedPdfiumRuntime = PdfiumModule & PdfiumRuntimeMethods & EmscriptenHeaps;

export type ExtendedWrappedPdfiumModule = Omit<WrappedPdfiumModule, 'pdfium'> &
  PdfiumSecurityMethods &
  PdfiumImageMethods &
  PdfiumTextFontMethods &
  PdfiumFormFillMethods &
  PdfiumVectorPathMethods &
  PdfiumAnnotationMethods & {
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

  /**
   * Retrieves the form type of the document (0: none, 1: AcroForm, 2: XFA full, 3: XFA foreground).
   *
   * @param docHandle Target document handle.
   * @return Form type code integer.
   */
  public getFormType(docHandle: number): number {
    if (!docHandle) return 0;
    const mod = this.getModule();
    if (typeof mod.FPDF_GetFormType === 'function') {
      try {
        return mod.FPDF_GetFormType(docHandle);
      } catch {
        return 0;
      }
    }
    return 0;
  }

  /**
   * Initialises the PDFium form fill environment for interactive AcroForm rendering.
   * Conforms to Google Chromium PDFium form fill architecture.
   *
   * @param docHandle Target document handle.
   * @return Handles for form environment and form fill info, or null on failure.
   */
  public initFormFillEnvironment(docHandle: number): { formHandle: number; formFillInfoPtr: number } | null {
    if (!docHandle) return null;
    const mod = this.getModule();
    if (
      typeof mod.PDFiumExt_OpenFormFillInfo !== 'function' ||
      typeof mod.PDFiumExt_InitFormFillEnvironment !== 'function'
    ) {
      return null;
    }

    try {
      const formFillInfoPtr = mod.PDFiumExt_OpenFormFillInfo();
      if (!formFillInfoPtr) return null;
      const formHandle = mod.PDFiumExt_InitFormFillEnvironment(docHandle, formFillInfoPtr);
      if (!formHandle) {
        if (typeof mod.PDFiumExt_CloseFormFillInfo === 'function') {
          mod.PDFiumExt_CloseFormFillInfo(formFillInfoPtr);
        }
        return null;
      }
      return { formHandle, formFillInfoPtr };
    } catch (err) {
      console.warn('Failed to initialise PDFium form fill environment:', err);
      return null;
    }
  }

  /**
   * Exits and disposes the PDFium form fill environment.
   *
   * @param formHandle Form fill environment handle.
   * @param formFillInfoPtr Form fill information structure pointer.
   */
  public exitFormFillEnvironment(formHandle: number, formFillInfoPtr: number): void {
    const mod = this.getModule();
    if (formHandle && typeof mod.PDFiumExt_ExitFormFillEnvironment === 'function') {
      try {
        mod.PDFiumExt_ExitFormFillEnvironment(formHandle);
      } catch {
        // Safe disposal
      }
    }
    if (formFillInfoPtr && typeof mod.PDFiumExt_CloseFormFillInfo === 'function') {
      try {
        mod.PDFiumExt_CloseFormFillInfo(formFillInfoPtr);
      } catch {
        // Safe disposal
      }
    }
  }

  /**
   * Notifies the PDFium form fill environment that a page has finished loading.
   *
   * @param pageHandle Target page handle.
   * @param formHandle Form fill environment handle.
   */
  public pageFormAfterLoad(pageHandle: number, formHandle: number): void {
    if (!pageHandle || !formHandle) return;
    const mod = this.getModule();
    if (typeof mod.FORM_OnAfterLoadPage === 'function') {
      try {
        mod.FORM_OnAfterLoadPage(pageHandle, formHandle);
      } catch {
        // Safe invocation
      }
    }
  }

  /**
   * Notifies the PDFium form fill environment that a page is about to close.
   *
   * @param pageHandle Target page handle.
   * @param formHandle Form fill environment handle.
   */
  public pageFormBeforeClose(pageHandle: number, formHandle: number): void {
    if (!pageHandle || !formHandle) return;
    const mod = this.getModule();
    if (typeof mod.FORM_OnBeforeClosePage === 'function') {
      try {
        mod.FORM_OnBeforeClosePage(pageHandle, formHandle);
      } catch {
        // Safe invocation
      }
    }
  }

  /**
   * Renders interactive form fill controls onto a target bitmap.
   * Matches FPDF_FFLDraw in Google Chrome's native PDFium engine.
   *
   * @param formHandle Form fill environment handle.
   * @param bitmapHandle Target bitmap handle.
   * @param pageHandle Active page handle.
   * @param startX Horizontal bitmap offset.
   * @param startY Vertical bitmap offset.
   * @param sizeX Target horizontal dimension in pixels.
   * @param sizeY Target vertical dimension in pixels.
   * @param rotate Page rotation angle.
   * @param flags Form fill rendering flags.
   */
  public drawFormFill(
    formHandle: number,
    bitmapHandle: number,
    pageHandle: number,
    startX: number = 0,
    startY: number = 0,
    sizeX: number,
    sizeY: number,
    rotate: number = 0,
    flags: number = 0x01
  ): void {
    if (!formHandle || !bitmapHandle || !pageHandle) return;
    const mod = this.getModule();
    if (typeof mod.FPDF_FFLDraw === 'function') {
      try {
        mod.FPDF_FFLDraw(formHandle, bitmapHandle, pageHandle, startX, startY, sizeX, sizeY, rotate, flags);
      } catch {
        // Safe invocation
      }
    }
  }
}
