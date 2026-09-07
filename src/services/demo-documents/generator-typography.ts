/**
 * ISO 32000-1 Clause 9 Typography and Complex Reflow Compliance Document Generator.
 *
 * Constructs a multi-page PDF document testing font metrics across standard font families,
 * typographic scale ranges (6.5pt to 36pt), paragraph reflow margins, character tracking,
 * and multi-script character sets (Latin extended, Greek symbols, mathematics).
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { CanvasElement, TextElement } from '../../stores/canvas-types';

export async function generateTypographyPdfBuffer(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const helveticaBoldOblique = await doc.embedFont(StandardFonts.HelveticaBoldOblique);

  const timesRoman = await doc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const timesItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const timesBoldItalic = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);

  const courier = await doc.embedFont(StandardFonts.Courier);
  const courierBold = await doc.embedFont(StandardFonts.CourierBold);

  const pageWidth = 612;
  const pageHeight = 792;

  // Page 1: Standard Font Families and Typographic Hierarchy
  const page1 = doc.addPage([pageWidth, pageHeight]);

  // Header Banner
  page1.drawRectangle({
    x: 36,
    y: 720,
    width: 540,
    height: 48,
    color: rgb(0.15, 0.12, 0.28),
  });

  page1.drawText('ISO 32000-1 Clause 9 Typography & Reflow Compliance Suite', {
    x: 48,
    y: 746,
    size: 13,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page1.drawText('Font Metrics, Standard Font Sets, Kerning, and Multi-Scale Text Hierarchy', {
    x: 48,
    y: 732,
    size: 8.5,
    font: helvetica,
    color: rgb(0.85, 0.8, 0.98),
  });

  // Section 1: Standard Font Families
  page1.drawText('1. Standard Font Families (Helvetica, Times-Roman, Courier)', {
    x: 40,
    y: 694,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page1.drawLine({
    start: { x: 40, y: 688 },
    end: { x: 572, y: 688 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  // Helvetica Group
  page1.drawText('Helvetica Regular (10pt): The quick brown fox jumps over the lazy dog.', {
    x: 44,
    y: 668,
    size: 9.5,
    font: helvetica,
    color: rgb(0.15, 0.15, 0.15),
  });
  page1.drawText('Helvetica Bold (10pt): The quick brown fox jumps over the lazy dog.', {
    x: 44,
    y: 654,
    size: 9.5,
    font: helveticaBold,
    color: rgb(0.15, 0.15, 0.15),
  });
  page1.drawText('Helvetica Oblique (10pt): The quick brown fox jumps over the lazy dog.', {
    x: 44,
    y: 640,
    size: 9.5,
    font: helveticaOblique,
    color: rgb(0.15, 0.15, 0.15),
  });
  page1.drawText('Helvetica Bold-Oblique (10pt): The quick brown fox jumps over the lazy dog.', {
    x: 44,
    y: 626,
    size: 9.5,
    font: helveticaBoldOblique,
    color: rgb(0.15, 0.15, 0.15),
  });

  // Times Roman Group
  page1.drawText('Times-Roman Regular (10pt): Pack my box with five dozen liquor jugs.', {
    x: 44,
    y: 604,
    size: 9.5,
    font: timesRoman,
    color: rgb(0.15, 0.15, 0.15),
  });
  page1.drawText('Times-Bold (10pt): Pack my box with five dozen liquor jugs.', {
    x: 44,
    y: 590,
    size: 9.5,
    font: timesBold,
    color: rgb(0.15, 0.15, 0.15),
  });
  page1.drawText('Times-Italic (10pt): Pack my box with five dozen liquor jugs.', {
    x: 44,
    y: 576,
    size: 9.5,
    font: timesItalic,
    color: rgb(0.15, 0.15, 0.15),
  });
  page1.drawText('Times-BoldItalic (10pt): Pack my box with five dozen liquor jugs.', {
    x: 44,
    y: 562,
    size: 9.5,
    font: timesBoldItalic,
    color: rgb(0.15, 0.15, 0.15),
  });

  // Courier Monospace Group
  page1.drawText('Courier Regular (9pt): export class DocumentEngine extends WASMModule {}', {
    x: 44,
    y: 540,
    size: 9,
    font: courier,
    color: rgb(0.2, 0.2, 0.2),
  });
  page1.drawText('Courier Bold (9pt): export class DocumentEngine extends WASMModule {}', {
    x: 44,
    y: 526,
    size: 9,
    font: courierBold,
    color: rgb(0.2, 0.2, 0.2),
  });

  // Section 2: Typographic Scale Gamut
  page1.drawText('2. Typographic Scale Gamut (6.5pt Footnote to 28pt Display Heading)', {
    x: 40,
    y: 494,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page1.drawLine({
    start: { x: 40, y: 488 },
    end: { x: 572, y: 488 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  page1.drawText('Display Title Heading (28pt)', {
    x: 44,
    y: 450,
    size: 28,
    font: helveticaBold,
    color: rgb(0.15, 0.2, 0.4),
  });

  page1.drawText('Section Title (18pt)', {
    x: 44,
    y: 426,
    size: 18,
    font: helveticaBold,
    color: rgb(0.2, 0.25, 0.45),
  });

  page1.drawText('Sub-heading Level 2 (13pt): Sub-pixel Coordinate Alignment and Baselining', {
    x: 44,
    y: 406,
    size: 13,
    font: helveticaBold,
    color: rgb(0.25, 0.3, 0.5),
  });

  page1.drawText('Standard Editorial Body Copy (10pt): Paragraph text designed to test spatial clustering algorithms and line height invariants across rendering engines.', {
    x: 44,
    y: 388,
    size: 10,
    font: helvetica,
    color: rgb(0.2, 0.2, 0.2),
  });

  page1.drawText('Fine Print Annotation (7.5pt): Complies with PDF/A-1b and ISO 32000-1 specifications for embedded font metrics.', {
    x: 44,
    y: 372,
    size: 7.5,
    font: helvetica,
    color: rgb(0.4, 0.4, 0.4),
  });

  page1.drawText('Micro Footnote (6.5pt): Confidential and proprietary software test suite execution log ID 0x8F9021', {
    x: 44,
    y: 358,
    size: 6.5,
    font: courier,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Page 1 Footer
  page1.drawText('Page 1 of 2 - Font Metric Standards', {
    x: 400,
    y: 40,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Page 2: Multi-Column Paragraph Reflow and Multi-Script Stress Tests
  const page2 = doc.addPage([pageWidth, pageHeight]);

  page2.drawRectangle({
    x: 36,
    y: 720,
    width: 540,
    height: 48,
    color: rgb(0.15, 0.12, 0.28),
  });

  page2.drawText('Multi-Column Flow, Line Wrapping & Unicode Characters', {
    x: 48,
    y: 746,
    size: 13,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page2.drawText('Paragraph reflow margin tolerance: 0.35 * fontSize word wrapping safety buffer', {
    x: 48,
    y: 732,
    size: 8.5,
    font: helvetica,
    color: rgb(0.85, 0.8, 0.98),
  });

  // Section 3: Dual Column Reflow Test
  page2.drawText('3. Dual Column Layout Reflow Test', {
    x: 40,
    y: 694,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page2.drawLine({
    start: { x: 40, y: 688 },
    end: { x: 572, y: 688 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  // Column 1
  page2.drawRectangle({
    x: 44,
    y: 530,
    width: 250,
    height: 146,
    color: rgb(0.97, 0.97, 0.99),
    borderColor: rgb(0.85, 0.85, 0.9),
    borderWidth: 1,
  });
  page2.drawText('Column A (Width: 240pt)', { x: 52, y: 660, size: 9, font: helveticaBold, color: rgb(0.2, 0.3, 0.5) });
  page2.drawText('Document editors must calculate precise', { x: 52, y: 642, size: 9, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
  page2.drawText('glyph advance widths before wrapping lines.', { x: 52, y: 628, size: 9, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
  page2.drawText('Premature word wraps create ragged edges', { x: 52, y: 614, size: 9, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
  page2.drawText('and compromise typographic aesthetics.', { x: 52, y: 600, size: 9, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
  page2.drawText('The advance tolerance buffer prevents this.', { x: 52, y: 586, size: 9, font: helvetica, color: rgb(0.2, 0.2, 0.2) });

  // Column 2
  page2.drawRectangle({
    x: 310,
    y: 530,
    width: 250,
    height: 146,
    color: rgb(0.97, 0.97, 0.99),
    borderColor: rgb(0.85, 0.85, 0.9),
    borderWidth: 1,
  });
  page2.drawText('Column B (Width: 240pt)', { x: 318, y: 660, size: 9, font: helveticaBold, color: rgb(0.2, 0.3, 0.5) });
  page2.drawText('When text spans are split or merged during', { x: 318, y: 642, size: 9, font: timesRoman, color: rgb(0.2, 0.2, 0.2) });
  page2.drawText('inline editing sessions, font attributes must', { x: 318, y: 628, size: 9, font: timesRoman, color: rgb(0.2, 0.2, 0.2) });
  page2.drawText('remain consistent across adjacent fragments.', { x: 318, y: 614, size: 9, font: timesRoman, color: rgb(0.2, 0.2, 0.2) });
  page2.drawText('Space offsets and inter-word kernings are', { x: 318, y: 600, size: 9, font: timesRoman, color: rgb(0.2, 0.2, 0.2) });
  page2.drawText('validated against character advance tables.', { x: 318, y: 586, size: 9, font: timesRoman, color: rgb(0.2, 0.2, 0.2) });

  // Section 4: Special Characters and Math Symbols
  page2.drawText('4. Character Encodings & Math Notations', {
    x: 40,
    y: 494,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page2.drawLine({
    start: { x: 40, y: 488 },
    end: { x: 572, y: 488 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  page2.drawText('Latin-1 Supplement: Copyright (C) 2026, Registered (R), Trade Mark TM, Section S, Paragraph P', {
    x: 44,
    y: 466,
    size: 9,
    font: helvetica,
    color: rgb(0.2, 0.2, 0.2),
  });

  page2.drawText('Mathematical Expressions: f(x) = ax^2 + bx + c, where delta = b^2 - 4ac >= 0', {
    x: 44,
    y: 448,
    size: 9,
    font: courier,
    color: rgb(0.2, 0.3, 0.5),
  });

  page2.drawText('Punctuation: Left "quote", right "quote", apostrophe \'s\', and parentheses (x + y)[z]{w}', {
    x: 44,
    y: 430,
    size: 9,
    font: timesRoman,
    color: rgb(0.2, 0.2, 0.2),
  });

  page2.drawText('Page 2 of 2 - Reflow & Special Characters', {
    x: 380,
    y: 40,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  return await doc.save();
}

export function getTypographyCanvasElements(): CanvasElement[] {
  const textElement1: TextElement = {
    id: 'compliance-canvas-text-1',
    kind: 'text',
    pageIndex: 0,
    x: 44,
    y: 310,
    width: 380,
    height: 36,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    text: 'Interactive Typography Overlay (Double-Click to Edit Text)',
    fontSize: 13,
    fontFamily: 'Helvetica',
    fontWeight: 'bold',
    fontStyle: 'normal',
    color: '#312e81',
    backgroundColor: 'rgba(238, 242, 255, 0.75)',
    textAlign: 'left',
  };

  const textElement2: TextElement = {
    id: 'compliance-canvas-text-2',
    kind: 'text',
    pageIndex: 1,
    x: 44,
    y: 360,
    width: 420,
    height: 48,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    text: 'Editable Multi-Line Callout testing paragraph reflow and word wrapping across bounding boxes.',
    fontSize: 11,
    fontFamily: 'Times-Roman',
    fontWeight: 'normal',
    fontStyle: 'italic',
    color: '#065f46',
    backgroundColor: 'rgba(236, 253, 245, 0.75)',
    textAlign: 'left',
  };

  return [textElement1, textElement2];
}
