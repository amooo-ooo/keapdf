/**
 * ISO 32000-1 Multi-Page Publication & Outlines Compliance Document Generator.
 *
 * Constructs a 4-page publication featuring mixed page orientations (portrait and landscape),
 * dynamic running headers, page numbering, multi-column tabular data grids, and figure captions.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { CanvasElement, TextElement, ShapeElement } from '../../stores/canvas-types';

export async function generateMultipagePdfBuffer(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const timesRoman = await doc.embedFont(StandardFonts.TimesRoman);
  const courier = await doc.embedFont(StandardFonts.Courier);

  // 16x16 base64 PNG icon for embedded media test
  const demoPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR42mP8z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==';
  const pngBytes = Uint8Array.from(atob(demoPngBase64), (c) => c.charCodeAt(0));
  const embeddedPng = await doc.embedPng(pngBytes);

  const portraitWidth = 612;
  const portraitHeight = 792;
  const landscapeWidth = 792;
  const landscapeHeight = 612;

  // Page 1: Cover Page (Portrait)
  const page1 = doc.addPage([portraitWidth, portraitHeight]);

  page1.drawRectangle({
    x: 0,
    y: 700,
    width: portraitWidth,
    height: 92,
    color: rgb(0.1, 0.15, 0.28),
  });

  page1.drawText('TECHNICAL ARCHITECTURE REPORT', {
    x: 48,
    y: 746,
    size: 20,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page1.drawText('Document Conformance Specification & Multi-Page Publication Benchmark', {
    x: 48,
    y: 724,
    size: 9.5,
    font: helvetica,
    color: rgb(0.75, 0.85, 1),
  });

  page1.drawText('ISO 32000-1 / PDF-UA Standards Verification', {
    x: 48,
    y: 640,
    size: 14,
    font: helveticaBold,
    color: rgb(0.18, 0.22, 0.35),
  });

  page1.drawText('Author: Engineering Standards Committee', {
    x: 48,
    y: 616,
    size: 10,
    font: helvetica,
    color: rgb(0.3, 0.35, 0.45),
  });

  page1.drawText('Date: 2026-09-04 | Classification: Public Open-Source Technical Report', {
    x: 48,
    y: 600,
    size: 9,
    font: courier,
    color: rgb(0.4, 0.45, 0.55),
  });

  page1.drawRectangle({
    x: 48,
    y: 450,
    width: 516,
    height: 120,
    color: rgb(0.96, 0.98, 1),
    borderColor: rgb(0.8, 0.88, 0.98),
    borderWidth: 1,
  });

  page1.drawText('Document Overview & Scope', {
    x: 64,
    y: 546,
    size: 11,
    font: helveticaBold,
    color: rgb(0.1, 0.2, 0.45),
  });

  page1.drawText('This multi-page technical report validates layout engine capabilities for handling', {
    x: 64,
    y: 526,
    size: 9.5,
    font: helvetica,
    color: rgb(0.2, 0.25, 0.35),
  });
  page1.drawText('mixed page orientations (portrait cover, landscape data sheet), tabular rendering,', {
    x: 64,
    y: 510,
    size: 9.5,
    font: helvetica,
    color: rgb(0.2, 0.25, 0.35),
  });
  page1.drawText('and running page counters across document navigation sessions.', {
    x: 64,
    y: 494,
    size: 9.5,
    font: helvetica,
    color: rgb(0.2, 0.25, 0.35),
  });

  page1.drawText('Page 1 of 4', {
    x: portraitWidth - 100,
    y: 36,
    size: 8.5,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Page 2: Executive Summary (Portrait)
  const page2 = doc.addPage([portraitWidth, portraitHeight]);

  page2.drawText('Executive Summary & Architectural Invariants', {
    x: 48,
    y: 740,
    size: 14,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.28),
  });

  page2.drawLine({
    start: { x: 48, y: 732 },
    end: { x: portraitWidth - 48, y: 732 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  // Dual column summary
  page2.drawText('1. Client-Side Parsing Reliability', { x: 48, y: 706, size: 10, font: helveticaBold, color: rgb(0.15, 0.2, 0.35) });
  page2.drawText('The document editor processes PDF binary', { x: 48, y: 688, size: 9, font: timesRoman, color: rgb(0.2, 0.2, 0.2) });
  page2.drawText('structures completely within the browser sandbox.', { x: 48, y: 674, size: 9, font: timesRoman, color: rgb(0.2, 0.2, 0.2) });
  page2.drawText('No server round-trips or remote upload calls', { x: 48, y: 660, size: 9, font: timesRoman, color: rgb(0.2, 0.2, 0.2) });
  page2.drawText('are executed, preserving data sovereignty.', { x: 48, y: 646, size: 9, font: timesRoman, color: rgb(0.2, 0.2, 0.2) });

  const col2X = 318;
  page2.drawText('2. Spatial Clustering Algorithms', { x: col2X, y: 706, size: 10, font: helveticaBold, color: rgb(0.15, 0.2, 0.35) });
  page2.drawText('Character boundaries are projected onto a', { x: col2X, y: 688, size: 9, font: timesRoman, color: rgb(0.2, 0.2, 0.2) });
  page2.drawText('2D spatial index to reconstruct coherent', { x: col2X, y: 674, size: 9, font: timesRoman, color: rgb(0.2, 0.2, 0.2) });
  page2.drawText('word groups and paragraphs without skewing', { x: col2X, y: 660, size: 9, font: timesRoman, color: rgb(0.2, 0.2, 0.2) });
  page2.drawText('under sub-pixel coordinate variations.', { x: col2X, y: 646, size: 9, font: timesRoman, color: rgb(0.2, 0.2, 0.2) });

  // Callout Quote Box
  page2.drawRectangle({
    x: 48,
    y: 530,
    width: 516,
    height: 70,
    color: rgb(0.97, 0.98, 0.99),
    borderColor: rgb(0.25, 0.45, 0.8),
    borderWidth: 1.5,
  });

  page2.drawText('"Full PDF compliance requires robust handling of multi-page documents where orientation,', {
    x: 64,
    y: 574,
    size: 9,
    font: helveticaOblique,
    color: rgb(0.2, 0.3, 0.5),
  });
  page2.drawText('dimension ratios, and bookmark outlines remain invariant during interactive manipulation."', {
    x: 64,
    y: 558,
    size: 9,
    font: helveticaOblique,
    color: rgb(0.2, 0.3, 0.5),
  });

  page2.drawText('Page 2 of 4', {
    x: portraitWidth - 100,
    y: 36,
    size: 8.5,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Page 3: Landscape Tabular Data Sheet
  const page3 = doc.addPage([landscapeWidth, landscapeHeight]);

  page3.drawText('Technical Specification Data Sheet (Landscape Orientation: 792 x 612 pt)', {
    x: 48,
    y: 560,
    size: 13,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.28),
  });

  page3.drawLine({
    start: { x: 48, y: 552 },
    end: { x: landscapeWidth - 48, y: 552 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  // Data Table with alternating row colors
  const tableX = 48;
  const tableY = 530;
  const tableWidth = landscapeWidth - 96;
  const rowHeight = 22;

  // Header row
  page3.drawRectangle({ x: tableX, y: tableY - rowHeight, width: tableWidth, height: rowHeight, color: rgb(0.15, 0.2, 0.35) });
  page3.drawText('Module Identifier', { x: tableX + 12, y: tableY - 15, size: 8.5, font: helveticaBold, color: rgb(1, 1, 1) });
  page3.drawText('Compliance Standard', { x: tableX + 220, y: tableY - 15, size: 8.5, font: helveticaBold, color: rgb(1, 1, 1) });
  page3.drawText('Execution Mode', { x: tableX + 440, y: tableY - 15, size: 8.5, font: helveticaBold, color: rgb(1, 1, 1) });
  page3.drawText('Benchmark Status', { x: tableX + 580, y: tableY - 15, size: 8.5, font: helveticaBold, color: rgb(1, 1, 1) });

  const rows = [
    { mod: 'pdfium-wasm-engine', std: 'ISO 32000-1 Core Engine', mode: 'Client-side WASM', status: 'Conforming' },
    { mod: 'acroform-interop', std: 'ISO 32000-1 Clause 12.7', mode: 'Hybrid DOM & Binary', status: 'Conforming' },
    { mod: 'typography-reflow', std: 'ISO 32000-1 Clause 9', mode: 'Spatial Cluster Index', status: 'Conforming' },
    { mod: 'vector-graphics', std: 'ISO 32000-1 Clause 8', mode: 'PDFium Stream Pipeline', status: 'Conforming' },
    { mod: 'pdfa-signatures', std: 'ISO 19005-1 (PDF/A-1b)', mode: 'Cryptographic Subsystem', status: 'Conforming' },
  ];

  let currentTableRowY = tableY - rowHeight;
  for (let i = 0; i < rows.length; i++) {
    currentTableRowY -= rowHeight;
    const isEven = i % 2 === 0;
    page3.drawRectangle({
      x: tableX,
      y: currentTableRowY,
      width: tableWidth,
      height: rowHeight,
      color: isEven ? rgb(0.97, 0.98, 1) : rgb(1, 1, 1),
      borderColor: rgb(0.85, 0.88, 0.92),
      borderWidth: 0.5,
    });
    page3.drawText(rows[i].mod, { x: tableX + 12, y: currentTableRowY + 6, size: 8, font: courier, color: rgb(0.2, 0.2, 0.2) });
    page3.drawText(rows[i].std, { x: tableX + 220, y: currentTableRowY + 6, size: 8, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
    page3.drawText(rows[i].mode, { x: tableX + 440, y: currentTableRowY + 6, size: 8, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
    page3.drawText(rows[i].status, { x: tableX + 580, y: currentTableRowY + 6, size: 8, font: helveticaBold, color: rgb(0.08, 0.55, 0.2) });
  }

  page3.drawText('Page 3 of 4 - Landscape Data Sheet', {
    x: landscapeWidth - 180,
    y: 36,
    size: 8.5,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Page 4: Appendix & Media (Portrait)
  const page4 = doc.addPage([portraitWidth, portraitHeight]);

  page4.drawText('Appendix & Embedded Media Assets', {
    x: 48,
    y: 740,
    size: 14,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.28),
  });

  page4.drawLine({
    start: { x: 48, y: 732 },
    end: { x: portraitWidth - 48, y: 732 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  page4.drawImage(embeddedPng, {
    x: 48,
    y: 650,
    width: 48,
    height: 48,
  });

  page4.drawText('Figure 1: Embedded Bitmapped Verification Badge', {
    x: 108,
    y: 680,
    size: 9.5,
    font: helveticaBold,
    color: rgb(0.15, 0.2, 0.35),
  });

  page4.drawText('Raster image embedded into the PDF stream testing image extraction, decoding, and scaling.', {
    x: 108,
    y: 662,
    size: 8.5,
    font: helvetica,
    color: rgb(0.4, 0.45, 0.55),
  });

  page4.drawText('Page 4 of 4', {
    x: portraitWidth - 100,
    y: 36,
    size: 8.5,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  return await doc.save();
}

export function getMultipageCanvasElements(): CanvasElement[] {
  const textElement1: TextElement = {
    id: 'compliance-canvas-multipage-1',
    kind: 'text',
    pageIndex: 0,
    x: 48,
    y: 360,
    width: 340,
    height: 32,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    text: 'Multi-Page Cover Note (Drag to Page 2 across boundary)',
    fontSize: 11,
    fontFamily: 'Helvetica',
    fontWeight: 'bold',
    fontStyle: 'normal',
    color: '#1e3a8a',
    backgroundColor: 'rgba(219, 234, 254, 0.8)',
    textAlign: 'left',
  };

  const shapeElement1: ShapeElement = {
    id: 'compliance-canvas-multipage-2',
    kind: 'shape',
    pageIndex: 1,
    x: 48,
    y: 430,
    width: 240,
    height: 34,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    variant: 'rectangle',
    fill: 'rgba(243, 244, 246, 0.8)',
    stroke: '#4b5563',
    strokeWidth: 1.5,
    opacity: 1,
    isHighlight: false,
  };

  const textElement2: TextElement = {
    id: 'compliance-canvas-multipage-3',
    kind: 'text',
    pageIndex: 2,
    x: 48,
    y: 240,
    width: 320,
    height: 30,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    text: 'Landscape Page Annotation Element',
    fontSize: 11,
    fontFamily: 'Helvetica',
    fontWeight: 'bold',
    fontStyle: 'normal',
    color: '#065f46',
    backgroundColor: 'rgba(209, 250, 229, 0.8)',
    textAlign: 'left',
  };

  return [textElement1, shapeElement1, textElement2];
}
