import type { PdfiumEngine, ExtendedWrappedPdfiumModule } from '../../../core/pdfium-engine';
import {
  encodeUtf16Le,
  setPageObjectMatrix,
  mapStandardFontName,
  calculateTextWidth,
  findPageFontHandle,
  extractBaseFontFamily,
  getPageCropInfo,
} from '../../../core/pdfium-helpers';
import type { PageCropInfo } from '../../../core/types';
import { parseColor, sanitizePdfText, safeEncodeForStandardFont, buildTransformMatrix } from '../utils';
import type { StandardFontName } from '../../../core/types';
import type { TextOptions } from './types';
import type { TextSegment } from '../../../stores/canvas-types';
import type { FontCharsetIndex } from '../font-charset-index';
import { loadGoogleFont } from '../../font-loader';

/**
 * Resolves a font family, raw font name, and optional weight/style to a standard PDF font.
 *
 * @param fontFamily Base font family name.
 * @param rawFontFamily Raw PDF font name if available.
 * @param fontWeight Optional font weight ('bold' | 'normal').
 * @param fontStyle Optional font style ('italic' | 'normal').
 * @return The mapped standard PDF font name.
 */
export function resolveStandardFont(
  fontFamily?: string,
  rawFontFamily?: string,
  fontWeight?: 'normal' | 'bold',
  fontStyle?: 'normal' | 'italic'
): StandardFontName {
  if (rawFontFamily && !fontWeight && !fontStyle) {
    const directMap = mapStandardFontName(rawFontFamily);
    if (directMap !== 'Helvetica' || rawFontFamily.toLowerCase().includes('helvetica')) {
      return directMap;
    }
  }

  const baseFont = mapStandardFontName(fontFamily || rawFontFamily || 'Helvetica');
  const isBold =
    fontWeight !== undefined
      ? fontWeight === 'bold'
      : (fontFamily || rawFontFamily || '').toLowerCase().includes('bold');
  const isItalic =
    fontStyle !== undefined
      ? fontStyle === 'italic'
      : (fontFamily || rawFontFamily || '').toLowerCase().includes('italic') ||
        (fontFamily || rawFontFamily || '').toLowerCase().includes('oblique');

  if (baseFont === 'Symbol') return 'Symbol';

  if (baseFont.startsWith('Times')) {
    if (isBold && isItalic) return 'Times-BoldItalic';
    if (isBold) return 'Times-Bold';
    if (isItalic) return 'Times-Italic';
    return 'Times-Roman';
  }

  if (baseFont.startsWith('Courier')) {
    if (isBold && isItalic) return 'Courier-BoldOblique';
    if (isBold) return 'Courier-Bold';
    if (isItalic) return 'Courier-Oblique';
    return 'Courier';
  }

  if (isBold && isItalic) return 'Helvetica-BoldOblique';
  if (isBold) return 'Helvetica-Bold';
  if (isItalic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

/**
 * Draws text onto a specified PDF page object.
 * Supports both uniform single-style text and multi-segment rich styled text.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle The handle to the loaded PDF document.
 * @param pageHandle The handle to the active PDF page.
 * @param options Configuration parameters for text content, styling, and positioning.
 * @param charsetIndex Optional document font character availability index.
 */
export function drawText(
  engine: PdfiumEngine,
  docHandle: number,
  pageHandle: number,
  options: TextOptions,
  charsetIndex?: FontCharsetIndex
): void {
  const mod = engine.getModule();
  const pageHeight = typeof mod?.FPDF_GetPageHeightF === 'function'
    ? mod.FPDF_GetPageHeightF(pageHandle)
    : (typeof mod?.FPDF_GetPageHeight === 'function' ? mod.FPDF_GetPageHeight(pageHandle) : 792);
  const cropInfo = getPageCropInfo(engine, mod, pageHandle);

  const hasLines = options.lines && options.lines.length > 0;
  const hasSegments = options.segments && options.segments.length > 0;
  const hasMultiLineText = Boolean(options.text && options.text.includes('\n'));

  if (hasLines || hasSegments || hasMultiLineText) {
    drawMultiSegmentText(engine, mod, docHandle, pageHandle, pageHeight, options, charsetIndex, cropInfo);
    return;
  }

  const cleanText = sanitizePdfText(options.text);
  if (!cleanText || cleanText.length === 0) return;

  // Attempt to preserve embedded font subset if all characters are available
  let fontHandle = 0;
  if (charsetIndex) {
    const rawName = options.rawFontFamily || options.fontFamily || '';
    const charsAvailable = charsetIndex.hasAllChars(cleanText, rawName);
    if (charsAvailable) {
      fontHandle = findPageFontHandle(
        engine,
        mod,
        pageHandle,
        options.fontFamily,
        options.rawFontFamily
      );
    }
  }

  const standardFont = resolveStandardFont(
    options.fontFamily,
    options.rawFontFamily,
    options.fontWeight,
    options.fontStyle
  );

  // Fallback to standard PDF font if font subset is not available or characters missing
  const isUsingStandardFont = !fontHandle;
  if (!fontHandle) {
    fontHandle = mod.FPDFText_LoadStandardFont(docHandle, standardFont);
    if (!fontHandle) fontHandle = mod.FPDFText_LoadStandardFont(docHandle, 'Helvetica');
    if (options.fontFamily) {
      loadGoogleFont(extractBaseFontFamily(options.fontFamily));
    }
  }

  if (fontHandle) {
    const textToWrite = isUsingStandardFont ? safeEncodeForStandardFont(cleanText) : cleanText;
    const textBuf = encodeUtf16Le(engine, textToWrite);
    try {
      const textObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, fontHandle, options.fontSize);
      if (textObjHandle) {
        mod.FPDFText_SetText(textObjHandle, textBuf.ptr);

        const textColor = parseColor(options.color || '#000000');
        mod.FPDFPageObj_SetFillColor(textObjHandle, textColor.r, textColor.g, textColor.b, textColor.a);

        const cropX = cropInfo.hasCropBox ? cropInfo.cropLeft : 0;
        const cropY = cropInfo.hasCropBox ? cropInfo.cropBottom : 0;
        const elemW = options.width || calculateTextWidth(cleanText, options.fontSize, standardFont);
        const elemH = options.height || options.fontSize * 1.25;
        const elemCx = options.x + cropX + elemW / 2;
        const elemCy = options.y + elemH / 2;

        const theta = -(options.rotation || 0) * (Math.PI / 180);
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        const sx = options.flipX ? -1 : 1;
        const sy = options.flipY ? -1 : 1;

        const a = cos * sx;
        const b = sin * sx;
        const c = -sin * sy;
        const d = cos * sy;

        // Baseline in unrotated DOM page coordinate frame
        const domBaselineY = options.y + options.fontSize * 0.82;
        const domBaselineX = options.x + cropX;

        const dx = domBaselineX - elemCx;
        const dy = domBaselineY - elemCy;

        const rotDx = dx * cos - dy * sin;
        const rotDy = dx * sin + dy * cos;

        const pdfX = elemCx + rotDx * sx;
        const pdfY = (pageHeight - elemCy) + cropY - rotDy * sy;

        if (options.backgroundColor) {
          const bgCol = parseColor(options.backgroundColor);
          if (bgCol.a > 0) {
            const bgRect = mod.FPDFPageObj_CreateNewRect(0, 0, elemW, elemH);
            if (bgRect) {
              mod.FPDFPageObj_SetFillColor(bgRect, bgCol.r, bgCol.g, bgCol.b, bgCol.a);
              mod.FPDFPath_SetDrawMode(bgRect, 1, false);
              const bgMatrix = buildTransformMatrix(
                options.x,
                options.y,
                elemW,
                elemH,
                pageHeight,
                options.rotation || 0,
                options.flipX || false,
                options.flipY || false,
                cropInfo.hasCropBox ? { cropX: cropInfo.cropLeft, cropY: cropInfo.cropBottom } : undefined
              );
              setPageObjectMatrix(engine, mod, bgRect, bgMatrix);
              mod.FPDFPage_InsertObject(pageHandle, bgRect);
            }
          }
        }

        const matrix = { a, b, c, d, e: pdfX, f: pdfY };
        setPageObjectMatrix(engine, mod, textObjHandle, matrix);
        mod.FPDFPage_InsertObject(pageHandle, textObjHandle);
      }
    } finally {
      textBuf.dispose();
    }
  }
}

/**
 * Draws multi-segment and multi-line styled text onto the page with precise segment positions.
 *
 * @param engine The PDFium engine instance.
 * @param mod The PDFium WebAssembly module wrapper.
 * @param docHandle The active PDF document handle.
 * @param pageHandle The active PDF page handle.
 * @param pageHeight The height of the target PDF page in points.
 * @param options Configuration parameters for text content, styling, and positioning.
 * @param charsetIndex Optional document font character availability index.
 */
function drawMultiSegmentText(
  engine: PdfiumEngine,
  mod: ExtendedWrappedPdfiumModule,
  docHandle: number,
  pageHandle: number,
  pageHeight: number,
  options: TextOptions,
  charsetIndex?: FontCharsetIndex,
  cropInfo?: PageCropInfo
): void {
  const elemW = options.width || 0;
  const elemH = options.height || 0;
  const cropX = cropInfo?.hasCropBox ? cropInfo.cropLeft : 0;
  const cropY = cropInfo?.hasCropBox ? cropInfo.cropBottom : 0;
  const elemCx = options.x + cropX + elemW / 2;
  const elemCy = options.y + elemH / 2;

  const theta = -(options.rotation || 0) * (Math.PI / 180);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const sx = options.flipX ? -1 : 1;
  const sy = options.flipY ? -1 : 1;
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;

  // Flatten lines into a structured list of styled lines with relative positions
  const linesToDraw: Array<{
    top: number;
    left: number;
    height: number;
    fontSize: number;
    segments: TextSegment[];
  }> = [];

  if (options.lines && options.lines.length > 0) {
    let runningY = 0;
    for (let i = 0; i < options.lines.length; i++) {
      const line = options.lines[i];
      const lineFontSize = line.fontSize || options.fontSize;
      const lH = line.lineHeight || options.lineHeight || (lineFontSize * 1.25);
      const lineTop = line.top !== undefined ? line.top : runningY;
      const lineLeft = line.left !== undefined ? line.left : 0;

      const segs: TextSegment[] =
        line.segments && line.segments.length > 0
          ? line.segments
          : [
              {
                text: line.text || '',
                fontSize: lineFontSize,
                fontFamily: options.fontFamily,
                rawFontFamily: options.rawFontFamily,
                color: options.color,
                fontWeight: options.fontWeight,
                fontStyle: options.fontStyle,
              },
            ];

      linesToDraw.push({
        top: lineTop,
        left: lineLeft,
        height: line.height || lH,
        fontSize: lineFontSize,
        segments: segs,
      });

      runningY = lineTop + lH;
    }
  } else if (options.segments && options.segments.length > 0) {
    linesToDraw.push({
      top: 0,
      left: 0,
      height: options.height || options.fontSize * 1.25,
      fontSize: options.fontSize,
      segments: options.segments,
    });
  } else if (options.text && options.text.includes('\n')) {
    const splitLines = options.text.split(/\r?\n/);
    const lH = options.lineHeight || options.fontSize * 1.25;
    for (let i = 0; i < splitLines.length; i++) {
      linesToDraw.push({
        top: i * lH,
        left: 0,
        height: lH,
        fontSize: options.fontSize,
        segments: [
          {
            text: splitLines[i],
            fontSize: options.fontSize,
            fontFamily: options.fontFamily,
            rawFontFamily: options.rawFontFamily,
            color: options.color,
            fontWeight: options.fontWeight,
            fontStyle: options.fontStyle,
          },
        ],
      });
    }
  }

  const standardFontCache = new Map<string, number>();
  const getStandardFontHandle = (name: string): number => {
    let h = standardFontCache.get(name);
    if (!h) {
      h = mod.FPDFText_LoadStandardFont(docHandle, name);
      if (!h) h = mod.FPDFText_LoadStandardFont(docHandle, 'Helvetica');
      if (h) standardFontCache.set(name, h);
    }
    return h || 0;
  };

  for (const line of linesToDraw) {
    let currentLineX = line.left;

    for (const segment of line.segments) {
      if (!segment.text || segment.text.length === 0) continue;

      const cleanText = sanitizePdfText(segment.text);
      if (!cleanText || cleanText.length === 0) continue;

      const segFontSize = segment.fontSize || line.fontSize || options.fontSize;
      const segStandardFont = resolveStandardFont(
        segment.fontFamily || options.fontFamily,
        segment.rawFontFamily || options.rawFontFamily,
        segment.fontWeight || options.fontWeight,
        segment.fontStyle || options.fontStyle
      );

      const segWidth = (segment.width !== undefined && segment.width > 0) ? segment.width : calculateTextWidth(cleanText, segFontSize, segStandardFont);
      const segRelX =
        segment.left !== undefined && line.segments.length > 1 && segment.left > 0
          ? segment.left
          : currentLineX;
      const segRelY = segment.top !== undefined ? segment.top : line.top;

      // Baseline in unrotated DOM page coordinates
      const domBaselineY = options.y + segRelY + segFontSize * 0.82;
      const domBaselineX = options.x + cropX + segRelX;

      const dx = domBaselineX - elemCx;
      const dy = domBaselineY - elemCy;

      const rotDx = dx * cos - dy * sin;
      const rotDy = dx * sin + dy * cos;

      const pdfX = elemCx + rotDx * sx;
      const pdfY = (pageHeight - elemCy) + cropY - rotDy * sy;

      const segMatrix = { a, b, c, d, e: pdfX, f: pdfY };

      let segFontHandle = 0;
      if (charsetIndex) {
        const segRawName = segment.rawFontFamily || options.rawFontFamily || segment.fontFamily || options.fontFamily || '';
        const charsAvailable = charsetIndex.hasAllChars(cleanText, segRawName);
        if (charsAvailable) {
          segFontHandle = findPageFontHandle(
            engine,
            mod,
            pageHandle,
            segment.fontFamily || options.fontFamily,
            segment.rawFontFamily || options.rawFontFamily
          );
        }
      }

      let isUsingStandardFont = false;
      if (!segFontHandle) {
        isUsingStandardFont = true;
        segFontHandle = getStandardFontHandle(segStandardFont);
        const fam = segment.fontFamily || options.fontFamily;
        if (fam) {
          loadGoogleFont(extractBaseFontFamily(fam));
        }
      }

      if (segFontHandle) {
        const textToWrite = isUsingStandardFont ? safeEncodeForStandardFont(cleanText) : cleanText;
        const textBuf = encodeUtf16Le(engine, textToWrite);
        try {
          const textObjHandle = mod.FPDFPageObj_CreateTextObj(docHandle, segFontHandle, segFontSize);
          if (textObjHandle) {
            mod.FPDFText_SetText(textObjHandle, textBuf.ptr);

            const segColor = parseColor(segment.color || options.color || '#000000');
            mod.FPDFPageObj_SetFillColor(textObjHandle, segColor.r, segColor.g, segColor.b, segColor.a);

            const segBgColorStr = segment.backgroundColor || (options.lines && options.lines.length > 0 ? undefined : options.backgroundColor);
            if (segBgColorStr) {
              const segBg = parseColor(segBgColorStr);
              if (segBg.a > 0) {
                const segH = line.height || segFontSize * 1.25;
                const bgRect = mod.FPDFPageObj_CreateNewRect(0, 0, segWidth, segH);
                if (bgRect) {
                  mod.FPDFPageObj_SetFillColor(bgRect, segBg.r, segBg.g, segBg.b, segBg.a);
                  mod.FPDFPath_SetDrawMode(bgRect, 1, false);
                  const bgMatrix = buildTransformMatrix(
                    options.x + segRelX,
                    options.y + segRelY,
                    segWidth,
                    segH,
                    pageHeight,
                    options.rotation || 0,
                    options.flipX || false,
                    options.flipY || false,
                    cropInfo?.hasCropBox ? { cropX: cropInfo.cropLeft, cropY: cropInfo.cropBottom } : undefined
                  );
                  setPageObjectMatrix(engine, mod, bgRect, bgMatrix);
                  mod.FPDFPage_InsertObject(pageHandle, bgRect);
                }
              }
            }

            if (segment.underline || segment.strikethrough) {
              const lineCol = parseColor(segment.color || options.color || '#000000');
              const lineThick = Math.max(0.75, segFontSize * 0.065);

              if (segment.underline) {
                const uDomBaselineY = options.y + segRelY + segFontSize * 0.94;
                const uDomBaselineX = options.x + cropX + segRelX;
                const uDx = uDomBaselineX - elemCx;
                const uDy = uDomBaselineY - elemCy;
                const uRotDx = uDx * cos - uDy * sin;
                const uRotDy = uDx * sin + uDy * cos;
                const uPdfX = elemCx + uRotDx * sx;
                const uPdfY = (pageHeight - elemCy) + cropY - uRotDy * sy;
                const uRect = mod.FPDFPageObj_CreateNewRect(0, 0, segWidth, lineThick);
                if (uRect) {
                  mod.FPDFPageObj_SetFillColor(uRect, lineCol.r, lineCol.g, lineCol.b, lineCol.a);
                  mod.FPDFPath_SetDrawMode(uRect, 1, false);
                  const uMatrix = { a, b, c, d, e: uPdfX, f: uPdfY };
                  setPageObjectMatrix(engine, mod, uRect, uMatrix);
                  mod.FPDFPage_InsertObject(pageHandle, uRect);
                }
              }

              if (segment.strikethrough) {
                const sDomBaselineY = options.y + segRelY + segFontSize * 0.52;
                const sDomBaselineX = options.x + cropX + segRelX;
                const sDx = sDomBaselineX - elemCx;
                const sDy = sDomBaselineY - elemCy;
                const sRotDx = sDx * cos - sDy * sin;
                const sRotDy = sDx * sin + sDy * cos;
                const sPdfX = elemCx + sRotDx * sx;
                const sPdfY = (pageHeight - elemCy) + cropY - sRotDy * sy;
                const sRect = mod.FPDFPageObj_CreateNewRect(0, 0, segWidth, lineThick);
                if (sRect) {
                  mod.FPDFPageObj_SetFillColor(sRect, lineCol.r, lineCol.g, lineCol.b, lineCol.a);
                  mod.FPDFPath_SetDrawMode(sRect, 1, false);
                  const sMatrix = { a, b, c, d, e: sPdfX, f: sPdfY };
                  setPageObjectMatrix(engine, mod, sRect, sMatrix);
                  mod.FPDFPage_InsertObject(pageHandle, sRect);
                }
              }
            }

            setPageObjectMatrix(engine, mod, textObjHandle, segMatrix);
            mod.FPDFPage_InsertObject(pageHandle, textObjHandle);
          }
        } finally {
          textBuf.dispose();
        }
      }

      currentLineX = segRelX + segWidth;
    }
  }
}

