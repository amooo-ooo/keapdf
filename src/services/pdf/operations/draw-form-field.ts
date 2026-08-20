import type { PdfiumEngine } from '../../../core/pdfium-engine';
import { encodeUtf16Le, setPageObjectMatrix, mapStandardFontName } from '../../../core/pdfium-helpers';
import { buildTransformMatrix } from '../utils';
import type { FormFieldPlaceholderOptions } from './types';

/**
 * Draws a visual placeholder rectangle and label for a form field on a PDF page.
 *
 * @param engine PDFium engine instance used for WebAssembly module interaction.
 * @param docHandle Handle to the PDF document.
 * @param pageHandle Handle to the target PDF page.
 * @param options Configuration options for position, size, orientation, and field label.
 */
export function drawFormFieldPlaceholder(
  engine: PdfiumEngine,
  docHandle: number,
  pageHandle: number,
  options: FormFieldPlaceholderOptions
): void {
  const mod = engine.getModule();
  const pageHeight = mod.FPDF_GetPageHeightF(pageHandle);
  const matrix = buildTransformMatrix(
    options.x,
    options.y,
    options.width,
    options.height,
    pageHeight,
    options.rotation || 0,
    options.flipX || false,
    options.flipY || false
  );

  const rectObj = mod.FPDFPageObj_CreateNewRect(0, 0, options.width, options.height);
  if (rectObj) {
    mod.FPDFPageObj_SetFillColor(rectObj, 239, 246, 255, 200);
    mod.FPDFPageObj_SetStrokeColor(rectObj, 191, 219, 254, 255);
    mod.FPDFPageObj_SetStrokeWidth(rectObj, 1);
    mod.FPDFPath_SetDrawMode(rectObj, 1, true);
    setPageObjectMatrix(engine, mod, rectObj, matrix);
    mod.FPDFPage_InsertObject(pageHandle, rectObj);
  }

  const standardFont = mapStandardFontName('Helvetica');
  let fontHandle = mod.FPDFText_LoadStandardFont(docHandle, standardFont);
  if (fontHandle) {
    let labelText = options.label || options.variant || 'Form Field';
    if (options.variant === 'text-input') labelText = options.label || 'Text Input';
    else if (options.variant === 'checkbox') labelText = options.label || 'Checkbox';
    else if (options.variant === 'radio') labelText = options.label || 'Radio';
    else if (options.variant === 'dropdown') labelText = options.label || 'Dropdown';
    else if (options.variant === 'signature') labelText = options.label || 'Signature';
    else if (options.variant === 'attachment') labelText = options.label || 'Attachment';

    const textBuf = encodeUtf16Le(engine, labelText);
    try {
      const textObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, fontHandle, 10);
      if (textObjHandle) {
        mod.FPDFText_SetText(textObjHandle, textBuf.ptr);
        mod.FPDFPageObj_SetFillColor(textObjHandle, 29, 78, 216, 255);
        
        const textMatrix = { ...matrix };
        const lx = 5;
        const ly = options.height / 2 - 3;
        textMatrix.e += lx * matrix.a + ly * matrix.c;
        textMatrix.f += lx * matrix.b + ly * matrix.d;
        
        setPageObjectMatrix(engine, mod, textObjHandle, textMatrix);
        mod.FPDFPage_InsertObject(pageHandle, textObjHandle);
      }
    } finally {
      textBuf.dispose();
      // mod.FPDFFont_Close(fontHandle); // Standard fonts should not be closed
    }
  }
}
