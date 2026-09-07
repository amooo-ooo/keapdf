/**
 * ISO 32000-1 Clause 12.5 Annotations and Redactions Compliance Document Generator.
 *
 * Constructs a multi-page PDF document featuring text markup annotations,
 * freehand ink annotation paths, sticky notes, redactions, and stamp overlays.
 */

import { PDFDocument, StandardFonts, rgb, PDFHexString } from 'pdf-lib';
import type { CanvasElement, NoteElement, PathElement, ShapeElement } from '../../stores/canvas-types';

export async function generateAnnotationsPdfBuffer(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  const pageWidth = 612;
  const pageHeight = 792;

  // Page 1: Text Highlights, Ink Drawings, and Sticky Notes
  const page1 = doc.addPage([pageWidth, pageHeight]);

  // Header Banner
  page1.drawRectangle({
    x: 36,
    y: 720,
    width: 540,
    height: 48,
    color: rgb(0.25, 0.12, 0.05),
  });

  page1.drawText('ISO 32000-1 Clause 12.5 Annotations & Redactions Compliance Suite', {
    x: 48,
    y: 746,
    size: 13,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page1.drawText('Highlight Markups, Freehand Ink Drawings, Sticky Notes, and Permanent Redactions', {
    x: 48,
    y: 732,
    size: 8.5,
    font: helvetica,
    color: rgb(1, 0.88, 0.78),
  });

  // Section 1: Text Highlight Markups
  page1.drawText('1. Text Highlight & Markup Annotations (/Highlight, /Underline)', {
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

  // Yellow Highlight background block
  page1.drawRectangle({
    x: 44,
    y: 654,
    width: 270,
    height: 18,
    color: rgb(1, 0.95, 0.4),
    opacity: 0.65,
  });
  page1.drawText('This entire text span is highlighted in yellow.', {
    x: 48,
    y: 658,
    size: 9.5,
    font: helveticaBold,
    color: rgb(0.2, 0.15, 0.05),
  });

  // Green Highlight background block
  page1.drawRectangle({
    x: 44,
    y: 628,
    width: 310,
    height: 18,
    color: rgb(0.65, 0.95, 0.75),
    opacity: 0.65,
  });
  page1.drawText('Secondary highlight markup with emerald green tint.', {
    x: 48,
    y: 632,
    size: 9.5,
    font: helveticaBold,
    color: rgb(0.05, 0.3, 0.15),
  });

  // Underlined Text
  page1.drawText('Text with simulated underline markup annotation.', {
    x: 48,
    y: 604,
    size: 9.5,
    font: helvetica,
    color: rgb(0.15, 0.15, 0.15),
  });
  page1.drawLine({
    start: { x: 48, y: 600 },
    end: { x: 265, y: 600 },
    thickness: 1.25,
    color: rgb(0.1, 0.4, 0.8),
  });

  // Section 2: Freehand Ink Drawings
  page1.drawText('2. Freehand Ink Annotation Paths (/Subtype /Ink)', {
    x: 40,
    y: 564,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page1.drawLine({
    start: { x: 40, y: 558 },
    end: { x: 572, y: 558 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  // Simulate ink checkmark stroke
  page1.drawLine({ start: { x: 48, y: 520 }, end: { x: 64, y: 504 }, thickness: 3, color: rgb(0.1, 0.65, 0.3) });
  page1.drawLine({ start: { x: 64, y: 504 }, end: { x: 92, y: 536 }, thickness: 3, color: rgb(0.1, 0.65, 0.3) });
  page1.drawText('Audited and Approved (Freehand Ink Stroke Representation)', {
    x: 104,
    y: 516,
    size: 9,
    font: helveticaOblique,
    color: rgb(0.1, 0.5, 0.25),
  });

  // Native PDF /Text Sticky Note annotation dictionary entry
  const noteAnnot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [450, 480, 480, 510],
    Contents: PDFHexString.fromText('Compliance Sticky Note: Review completed according to ISO 32000-1 specifications.'),
    Name: 'Comment',
    C: [1, 0.85, 0],
    T: PDFHexString.fromText('Lead Compliance Auditor'),
  });
  const noteRef = doc.context.register(noteAnnot);
  page1.node.addAnnot(noteRef);

  page1.drawRectangle({
    x: 450,
    y: 480,
    width: 30,
    height: 30,
    color: rgb(1, 0.9, 0.3),
    borderColor: rgb(0.8, 0.6, 0.1),
    borderWidth: 1,
  });
  page1.drawText('Note', { x: 454, y: 490, size: 8, font: helveticaBold, color: rgb(0.4, 0.3, 0.05) });

  // Section 3: Legal Redaction Markups
  page1.drawText('3. Legal Redactions & PII Obscuration (/Subtype /Redact)', {
    x: 40,
    y: 440,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page1.drawLine({
    start: { x: 40, y: 434 },
    end: { x: 572, y: 434 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  page1.drawText('Social Security Number: ', { x: 48, y: 400, size: 9.5, font: helvetica, color: rgb(0.2, 0.2, 0.2) });

  // Solid Blackout Box representing burned redaction
  page1.drawRectangle({
    x: 180,
    y: 396,
    width: 140,
    height: 18,
    color: rgb(0, 0, 0),
  });
  page1.drawText('REDACTED (PII)', { x: 195, y: 401, size: 8, font: helveticaBold, color: rgb(1, 1, 1) });

  page1.drawText('Account Routing Number: ', { x: 48, y: 370, size: 9.5, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
  page1.drawRectangle({
    x: 180,
    y: 366,
    width: 160,
    height: 18,
    color: rgb(0, 0, 0),
  });
  page1.drawText('FOIA EXEMPTION (b)(4)', { x: 190, y: 371, size: 8, font: helveticaBold, color: rgb(1, 1, 1) });

  // Section 4: Document Review Stamp
  page1.drawText('4. Rubber Stamp Annotations (/Subtype /Stamp)', {
    x: 40,
    y: 320,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page1.drawLine({
    start: { x: 40, y: 314 },
    end: { x: 572, y: 314 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  // Stamp Badge
  page1.drawRectangle({
    x: 48,
    y: 220,
    width: 140,
    height: 50,
    color: rgb(0.99, 0.95, 0.95),
    borderColor: rgb(0.8, 0.2, 0.2),
    borderWidth: 2,
  });
  page1.drawText('CONFIDENTIAL', { x: 62, y: 246, size: 11, font: helveticaBold, color: rgb(0.8, 0.2, 0.2) });
  page1.drawText('DO NOT DISTRIBUTE', { x: 64, y: 232, size: 7.5, font: helvetica, color: rgb(0.7, 0.3, 0.3) });

  page1.drawRectangle({
    x: 210,
    y: 220,
    width: 140,
    height: 50,
    color: rgb(0.95, 0.99, 0.96),
    borderColor: rgb(0.1, 0.6, 0.3),
    borderWidth: 2,
  });
  page1.drawText('APPROVED', { x: 238, y: 246, size: 11, font: helveticaBold, color: rgb(0.1, 0.6, 0.3) });
  page1.drawText('ISO VERIFIED 2026', { x: 235, y: 232, size: 7.5, font: helvetica, color: rgb(0.2, 0.5, 0.3) });

  page1.drawText('Page 1 of 2 - Annotations & Markups', {
    x: 390,
    y: 40,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Page 2: Redaction Protocol Verification
  const page2 = doc.addPage([pageWidth, pageHeight]);

  page2.drawRectangle({
    x: 36,
    y: 720,
    width: 540,
    height: 48,
    color: rgb(0.25, 0.12, 0.05),
  });

  page2.drawText('Permanent Sanitization & Redaction Standard Requirements', {
    x: 48,
    y: 746,
    size: 13,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page2.drawText('Ensures underlying text character codes are completely removed from content streams', {
    x: 48,
    y: 732,
    size: 8.5,
    font: helvetica,
    color: rgb(1, 0.88, 0.78),
  });

  page2.drawText('5. Sanitization Verification Protocol', {
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

  const sanitizationSteps = [
    '1. Visual Redaction Layer: Overlay opaque black rectangle covering bounding box.',
    '2. Stream Sanitization: Underneath characters must be purged from the WASM text page.',
    '3. Metadata Scrubbing: Author comments, revision histories, and XML attachments removed.',
    '4. Stream Compression: Content streams re-encoded with FlateDecode to prevent forensic recovery.',
  ];

  let stepY = 660;
  for (const step of sanitizationSteps) {
    page2.drawText(step, { x: 48, y: stepY, size: 9, font: helvetica, color: rgb(0.25, 0.25, 0.3) });
    stepY -= 24;
  }

  page2.drawText('Page 2 of 2 - Sanitization Protocol', {
    x: 390,
    y: 40,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  return await doc.save();
}

export function getAnnotationsCanvasElements(): CanvasElement[] {
  const noteElement1: NoteElement = {
    id: 'compliance-canvas-note-1',
    kind: 'note',
    pageIndex: 0,
    x: 340,
    y: 460,
    width: 180,
    height: 80,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    author: 'Compliance Reviewer',
    text: 'Sticky note overlay testing note creation, repositioning, and property inspection.',
    color: '#fef08a',
    isOpen: true,
  };

  const pathElement1: PathElement = {
    id: 'compliance-canvas-path-1',
    kind: 'path',
    pageIndex: 0,
    x: 340,
    y: 570,
    width: 140,
    height: 40,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    points: [
      { x: 345, y: 590 },
      { x: 375, y: 605 },
      { x: 420, y: 575 },
      { x: 470, y: 585 },
    ],
    stroke: '#16a34a',
    strokeWidth: 3,
    opacity: 1,
    isHighlight: false,
  };

  const shapeElement1: ShapeElement = {
    id: 'compliance-canvas-redact-1',
    kind: 'shape',
    pageIndex: 0,
    x: 48,
    y: 140,
    width: 220,
    height: 32,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    variant: 'rectangle',
    fill: '#000000',
    stroke: '#dc2626',
    strokeWidth: 1.5,
    opacity: 0.95,
    isHighlight: false,
  };

  return [noteElement1, pathElement1, shapeElement1];
}
