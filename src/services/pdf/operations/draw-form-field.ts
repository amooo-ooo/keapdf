import type { PdfiumEngine } from '../../../core/pdfium-engine';
import { encodeUtf16Le, setPageObjectMatrix, mapStandardFontName, getPageCropInfo } from '../../../core/pdfium-helpers';
import { buildTransformMatrix, parseColor } from '../utils';
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
  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const cropOffset = cropInfo.hasCropBox ? { cropX: cropInfo.cropLeft, cropY: cropInfo.cropBottom } : undefined;
  const matrix = buildTransformMatrix(
    options.x,
    options.y,
    options.width,
    options.height,
    pageHeight,
    options.rotation || 0,
    options.flipX || false,
    options.flipY || false,
    cropOffset
  );

  const parseColorFallback = (colStr?: string, defaultCol = { r: 239, g: 246, b: 255, a: 200 }) => {
    if (!colStr) return defaultCol;
    try {
      const parsed = parseColor(colStr);
      return {
        r: parsed.r,
        g: parsed.g,
        b: parsed.b,
        a: parsed.a !== undefined ? (parsed.a <= 1 ? Math.round(parsed.a * 255) : parsed.a) : 255,
      };
    } catch {
      return defaultCol;
    }
  };

  const bgCol = parseColorFallback(options.backgroundColor, { r: 241, g: 245, b: 249, a: 180 });
  const borderCol = parseColorFallback(options.borderColor, { r: 100, g: 116, b: 139, a: 255 });
  const borderWidth = options.borderWidth !== undefined ? options.borderWidth : 1;
  const textCol = parseColorFallback(options.color, { r: 15, g: 23, b: 42, a: 255 });
  const fontSize = options.fontSize && options.fontSize > 0 ? options.fontSize : 10;

  const rectObj = mod.FPDFPageObj_CreateNewRect(0, 0, options.width, options.height);
  if (rectObj) {
    mod.FPDFPageObj_SetFillColor(rectObj, bgCol.r, bgCol.g, bgCol.b, bgCol.a);
    mod.FPDFPageObj_SetStrokeColor(rectObj, borderCol.r, borderCol.g, borderCol.b, borderCol.a);
    mod.FPDFPageObj_SetStrokeWidth(rectObj, borderWidth);
    mod.FPDFPath_SetDrawMode(rectObj, 1, true);
    setPageObjectMatrix(engine, mod, rectObj, matrix);
    mod.FPDFPage_InsertObject(pageHandle, rectObj);
  }

  const standardFont = mapStandardFontName(options.fontFamily || 'Helvetica');
  let fontHandle = mod.FPDFText_LoadStandardFont(docHandle, standardFont);
  if (fontHandle) {
    let labelText: string = String(options.value || options.label || options.placeholder || options.variant || 'Form Field');
    if (options.variant === 'text-input') labelText = String(options.value || options.placeholder || options.label || 'Text Input');
    else if (options.variant === 'checkbox') labelText = (options.value === 'true' ? '[x] ' : '[ ] ') + (options.label || 'Checkbox');
    else if (options.variant === 'radio') labelText = '(o) ' + (options.label || 'Radio');
    else if (options.variant === 'dropdown') labelText = String(options.value || options.label || 'Dropdown') + ' v';
    else if (options.variant === 'signature') labelText = options.label || 'Signature';
    else if (options.variant === 'attachment') labelText = options.label || 'Attachment';

    const textBuf = encodeUtf16Le(engine, labelText);
    try {
      const textObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, fontHandle, fontSize);
      if (textObjHandle) {
        mod.FPDFText_SetText(textObjHandle, textBuf.ptr);
        mod.FPDFPageObj_SetFillColor(textObjHandle, textCol.r, textCol.g, textCol.b, textCol.a);
        
        const textMatrix = { ...matrix };
        const lx = options.textAlign === 'center' ? Math.max(5, options.width / 4) : 5;
        const ly = options.height / 2 - (fontSize / 3);
        textMatrix.e += lx * matrix.a + ly * matrix.c;
        textMatrix.f += lx * matrix.b + ly * matrix.d;
        
        setPageObjectMatrix(engine, mod, textObjHandle, textMatrix);
        mod.FPDFPage_InsertObject(pageHandle, textObjHandle);
      }
    } finally {
      textBuf.dispose();
      // Standard fonts should not be closed
    }
  }
}
