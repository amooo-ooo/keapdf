/**
 * ISO 19005 (PDF/A) and ISO 32000-1 Clause 12.8 Digital Signatures Compliance Document Generator.
 *
 * Constructs a PDF document containing official Document Information Dictionary metadata,
 * cryptographic signature placeholder blocks, SHA-256 fingerprint stamps, and PDF/A audit checklists.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { CanvasElement, TextElement, ShapeElement } from '../../stores/canvas-types';

export async function generateSignaturesPdfBuffer(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  // Set Document Information Dictionary metadata
  doc.setTitle('ISO 19005 PDF/A Digital Signature Compliance Specification');
  doc.setAuthor('Digital Signature Security Directorate');
  doc.setSubject('Cryptographic Signature Verification and PDF/A-1b Archive Conformance');
  doc.setKeywords(['PDF/A', 'Digital Signatures', 'ISO 19005', 'X.509', 'SHA-256', 'PKCS#7']);
  doc.setProducer('PDF Editor WebAssembly Engine (Conforming Writer)');
  doc.setCreator('PDF Editor Compliance Generator');
  doc.setCreationDate(new Date('2026-09-04T00:00:00Z'));

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const courier = await doc.embedFont(StandardFonts.Courier);
  const courierBold = await doc.embedFont(StandardFonts.CourierBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const form = doc.getForm();

  // Page 1: Cryptographic Digital Signature Block and Attestation
  const page1 = doc.addPage([pageWidth, pageHeight]);

  // Header Banner
  page1.drawRectangle({
    x: 36,
    y: 720,
    width: 540,
    height: 48,
    color: rgb(0.08, 0.22, 0.22),
  });

  page1.drawText('ISO 19005 (PDF/A) & Digital Signatures Compliance Suite', {
    x: 48,
    y: 746,
    size: 13,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page1.drawText('Electronic Signature Stamping, X.509 Certificate Validation, and Metadata Integrity', {
    x: 48,
    y: 732,
    size: 8.5,
    font: helvetica,
    color: rgb(0.75, 0.95, 0.92),
  });

  // Section 1: Visual Signature Block
  page1.drawText('1. Visual Digital Signature Certificate Representation', {
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

  // Outer Certificate Stamp Frame
  page1.drawRectangle({
    x: 44,
    y: 530,
    width: 520,
    height: 146,
    color: rgb(0.97, 0.99, 0.99),
    borderColor: rgb(0.1, 0.45, 0.42),
    borderWidth: 1.5,
  });

  // Security Seal Indicator (Left side badge)
  page1.drawRectangle({
    x: 56,
    y: 546,
    width: 100,
    height: 114,
    color: rgb(0.9, 0.96, 0.95),
    borderColor: rgb(0.15, 0.5, 0.45),
    borderWidth: 1,
  });

  page1.drawText('CERTIFIED', { x: 74, y: 636, size: 10, font: helveticaBold, color: rgb(0.08, 0.4, 0.35) });
  page1.drawText('DIGITAL ID', { x: 72, y: 622, size: 9, font: helveticaBold, color: rgb(0.08, 0.4, 0.35) });
  page1.drawText('SHA-256', { x: 80, y: 588, size: 8, font: courierBold, color: rgb(0.2, 0.45, 0.4) });
  page1.drawText('VALIDATED', { x: 75, y: 560, size: 7.5, font: helveticaBold, color: rgb(0.1, 0.55, 0.3) });

  // Signature Details (Right side content)
  page1.drawText('Signer: Dr. Elizabeth Vance, Chief Cryptographic Officer', {
    x: 172,
    y: 642,
    size: 9.5,
    font: helveticaBold,
    color: rgb(0.1, 0.2, 0.2),
  });
  page1.drawText('Organization: Global Document Security Authority (GDSA)', {
    x: 172,
    y: 626,
    size: 9,
    font: helvetica,
    color: rgb(0.2, 0.3, 0.3),
  });
  page1.drawText('Signing Reason: Formal Software Compliance Verification under ISO 19005', {
    x: 172,
    y: 610,
    size: 9,
    font: helvetica,
    color: rgb(0.2, 0.3, 0.3),
  });
  page1.drawText('Signing Location: Geneva, Switzerland (W3C / ISO Delegate)', {
    x: 172,
    y: 594,
    size: 9,
    font: helvetica,
    color: rgb(0.2, 0.3, 0.3),
  });
  page1.drawText('Timestamp: 2026-09-04T00:00:00Z (RFC 3161 Qualified Timestamp Token)', {
    x: 172,
    y: 578,
    size: 8.5,
    font: courier,
    color: rgb(0.3, 0.4, 0.4),
  });
  page1.drawText('Digest: 8f9b23a1c8405e3d7a810f6b4d32a9e87123456789abcdef0123456789abcdef', {
    x: 172,
    y: 558,
    size: 7,
    font: courier,
    color: rgb(0.35, 0.45, 0.45),
  });

  // Section 2: Form Signature Field Placeholder
  page1.drawText('2. AcroForm Signature Field Widget (/Subtype /Widget /FT /Sig)', {
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

  // AcroForm text placeholder for interactive testing
  const sigField = form.createTextField('signatures.signer_approval');
  sigField.setText('APPROVED: Cryptographic signature requirements satisfied.');
  sigField.enableReadOnly();
  sigField.addToPage(page1, { x: 44, y: 440, width: 520, height: 32 });

  // Section 3: PDF/A Audit Checklist
  page1.drawText('3. PDF/A Conformance Audit Checklist', {
    x: 40,
    y: 400,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page1.drawLine({
    start: { x: 40, y: 394 },
    end: { x: 572, y: 394 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  const checklist = [
    '[PASS] Embedded Font Programs: All glyph definitions fully embedded',
    '[PASS] Device-Independent Color: Document specifies default sRGB color profiles',
    '[PASS] XMP Metadata Stream: Official pdfaid namespace embedded in catalog',
    '[PASS] No Disallowed Features: JavaScript, audio/video, and external streams excluded',
    '[PASS] Encryption Constraint: Unencrypted document permits archival access',
  ];

  let checkY = 368;
  for (const item of checklist) {
    page1.drawText(item, { x: 48, y: checkY, size: 8.5, font: courier, color: rgb(0.1, 0.45, 0.25) });
    checkY -= 20;
  }

  page1.drawText('Page 1 of 2 - Digital Signatures & Attestation', {
    x: 370,
    y: 40,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Page 2: Document Information Dictionary & Metadata
  const page2 = doc.addPage([pageWidth, pageHeight]);

  page2.drawRectangle({
    x: 36,
    y: 720,
    width: 540,
    height: 48,
    color: rgb(0.08, 0.22, 0.22),
  });

  page2.drawText('Document Information Dictionary & Metadata Inspection', {
    x: 48,
    y: 746,
    size: 13,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page2.drawText('Validates low-level metadata dictionary extraction (/Title, /Author, /Subject, /Producer)', {
    x: 48,
    y: 732,
    size: 8.5,
    font: helvetica,
    color: rgb(0.75, 0.95, 0.92),
  });

  // Metadata Display Table
  page2.drawText('4. Embedded Metadata Key-Value Pairs', {
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

  const metaEntries = [
    { key: '/Title', val: 'ISO 19005 PDF/A Digital Signature Compliance Specification' },
    { key: '/Author', val: 'Digital Signature Security Directorate' },
    { key: '/Subject', val: 'Cryptographic Signature Verification and PDF/A-1b Archive Conformance' },
    { key: '/Producer', val: 'PDF Editor WebAssembly Engine (Conforming Writer)' },
    { key: '/Creator', val: 'PDF Editor Compliance Generator' },
    { key: '/Keywords', val: 'PDF/A, Digital Signatures, ISO 19005, X.509, SHA-256' },
  ];

  let metaY = 658;
  for (const entry of metaEntries) {
    page2.drawText(entry.key, { x: 48, y: metaY, size: 9, font: courierBold, color: rgb(0.1, 0.35, 0.35) });
    page2.drawText(entry.val, { x: 140, y: metaY, size: 8.5, font: helvetica, color: rgb(0.2, 0.25, 0.25) });
    metaY -= 26;
  }

  page2.drawText('Page 2 of 2 - Metadata Inspection', {
    x: 400,
    y: 40,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  return await doc.save();
}

export function getSignaturesCanvasElements(): CanvasElement[] {
  const shapeElement1: ShapeElement = {
    id: 'compliance-canvas-sig-1',
    kind: 'shape',
    pageIndex: 0,
    x: 44,
    y: 200,
    width: 240,
    height: 70,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    variant: 'rectangle',
    fill: 'rgba(20, 184, 166, 0.12)',
    stroke: '#0d9488',
    strokeWidth: 2,
    opacity: 1,
    isHighlight: false,
  };

  const textElement1: TextElement = {
    id: 'compliance-canvas-sig-2',
    kind: 'text',
    pageIndex: 0,
    x: 54,
    y: 220,
    width: 220,
    height: 32,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    text: 'Click E-Sign tool to place signature',
    fontSize: 10,
    fontFamily: 'Helvetica',
    fontWeight: 'bold',
    fontStyle: 'normal',
    color: '#115e59',
    textAlign: 'center',
  };

  return [shapeElement1, textElement1];
}
