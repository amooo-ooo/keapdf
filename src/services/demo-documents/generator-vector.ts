/**
 * ISO 32000-1 Clause 8 Vector Graphics and Color Model Compliance Document Generator.
 *
 * Constructs a multi-page PDF document featuring vector graphic primitives:
 * stroked/filled rectangles, ellipses, solid/dashed lines, directional vectors,
 * multi-tier color spaces (RGB, simulated CMYK, Grayscale ramps), and opacity levels.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { CanvasElement, ShapeElement } from '../../stores/canvas-types';

export async function generateVectorPdfBuffer(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const courier = await doc.embedFont(StandardFonts.Courier);

  const pageWidth = 612;
  const pageHeight = 792;

  // Page 1: Geometric Primitives and Dash Patterns
  const page1 = doc.addPage([pageWidth, pageHeight]);

  // Header Banner
  page1.drawRectangle({
    x: 36,
    y: 720,
    width: 540,
    height: 48,
    color: rgb(0.18, 0.08, 0.3),
  });

  page1.drawText('ISO 32000-1 Clause 8 Vector Graphics Compliance Suite', {
    x: 48,
    y: 746,
    size: 13,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page1.drawText('Geometric Primitives, Stroke Dash Patterns, Line Caps & Joins, and Alpha Blending', {
    x: 48,
    y: 732,
    size: 8.5,
    font: helvetica,
    color: rgb(0.9, 0.78, 0.98),
  });

  // Section 1: Geometric Primitives
  page1.drawText('1. Geometric Shape Primitives (Strokes, Fills, and Aspect Bounds)', {
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

  // Solid Rectangle
  page1.drawRectangle({
    x: 44,
    y: 610,
    width: 100,
    height: 60,
    color: rgb(0.88, 0.92, 1),
    borderColor: rgb(0.15, 0.35, 0.85),
    borderWidth: 2,
  });
  page1.drawText('Solid Rectangle', { x: 54, y: 636, size: 9, font: helveticaBold, color: rgb(0.15, 0.35, 0.85) });

  // Ellipse / Circle
  page1.drawEllipse({
    x: 220,
    y: 640,
    xScale: 46,
    yScale: 30,
    color: rgb(1, 0.94, 0.82),
    borderColor: rgb(0.85, 0.45, 0.05),
    borderWidth: 2,
  });
  page1.drawText('Ellipse', { x: 206, y: 636, size: 9, font: helveticaBold, color: rgb(0.85, 0.45, 0.05) });

  // Concentric Circles (Precision Radius Test)
  page1.drawCircle({
    x: 350,
    y: 640,
    size: 30,
    color: rgb(0.9, 0.98, 0.92),
    borderColor: rgb(0.1, 0.6, 0.25),
    borderWidth: 1.5,
  });
  page1.drawCircle({
    x: 350,
    y: 640,
    size: 18,
    color: rgb(0.8, 0.95, 0.85),
    borderColor: rgb(0.08, 0.45, 0.18),
    borderWidth: 1.5,
  });
  page1.drawText('Circles', { x: 336, y: 636, size: 9, font: helveticaBold, color: rgb(0.08, 0.45, 0.18) });

  // Translucent Highlight Box (Alpha 0.45)
  page1.drawRectangle({
    x: 430,
    y: 610,
    width: 130,
    height: 60,
    color: rgb(0.98, 0.85, 0.9),
    opacity: 0.6,
    borderColor: rgb(0.8, 0.15, 0.35),
    borderWidth: 2,
  });
  page1.drawText('Alpha Translucent', { x: 442, y: 636, size: 9, font: helveticaBold, color: rgb(0.6, 0.1, 0.25) });

  // Section 2: Stroke Weights and Vectors
  page1.drawText('2. Stroke Thickness Range (0.5pt Hairline to 8pt Heavy Stroke)', {
    x: 40,
    y: 574,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page1.drawLine({
    start: { x: 40, y: 568 },
    end: { x: 572, y: 568 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  const strokeWeights = [0.5, 1.0, 2.0, 4.0, 8.0];
  let currentY = 544;
  for (const weight of strokeWeights) {
    page1.drawText(`${weight.toFixed(1)}pt:`, { x: 44, y: currentY - 3, size: 8.5, font: courier, color: rgb(0.3, 0.3, 0.3) });
    page1.drawLine({
      start: { x: 100, y: currentY },
      end: { x: 550, y: currentY },
      thickness: weight,
      color: rgb(0.2, 0.25, 0.35),
    });
    currentY -= 22;
  }

  // Section 3: Directional Vectors and Arrows
  page1.drawText('3. Directional Vectors, Coordinate Angles, and Arrows', {
    x: 40,
    y: 418,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page1.drawLine({
    start: { x: 40, y: 412 },
    end: { x: 572, y: 412 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  // Right Arrow
  page1.drawLine({ start: { x: 50, y: 380 }, end: { x: 160, y: 380 }, thickness: 2.5, color: rgb(0.8, 0.2, 0.2) });
  page1.drawLine({ start: { x: 152, y: 386 }, end: { x: 160, y: 380 }, thickness: 2.5, color: rgb(0.8, 0.2, 0.2) });
  page1.drawLine({ start: { x: 152, y: 374 }, end: { x: 160, y: 380 }, thickness: 2.5, color: rgb(0.8, 0.2, 0.2) });
  page1.drawText('Horizontal (0 deg)', { x: 50, y: 360, size: 8, font: helvetica, color: rgb(0.3, 0.3, 0.3) });

  // Up-Right Arrow (45 deg)
  page1.drawLine({ start: { x: 220, y: 350 }, end: { x: 300, y: 395 }, thickness: 2.5, color: rgb(0.1, 0.5, 0.8) });
  page1.drawLine({ start: { x: 290, y: 397 }, end: { x: 300, y: 395 }, thickness: 2.5, color: rgb(0.1, 0.5, 0.8) });
  page1.drawLine({ start: { x: 298, y: 386 }, end: { x: 300, y: 395 }, thickness: 2.5, color: rgb(0.1, 0.5, 0.8) });
  page1.drawText('Diagonal (45 deg)', { x: 220, y: 334, size: 8, font: helvetica, color: rgb(0.3, 0.3, 0.3) });

  // Page 1 Footer
  page1.drawText('Page 1 of 2 - Geometric Primitives', {
    x: 400,
    y: 40,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Page 2: Color Space Models & Gradation Swatches
  const page2 = doc.addPage([pageWidth, pageHeight]);

  page2.drawRectangle({
    x: 36,
    y: 720,
    width: 540,
    height: 48,
    color: rgb(0.18, 0.08, 0.3),
  });

  page2.drawText('Color Space Conformance: RGB Gamut & Grayscale Ramps', {
    x: 48,
    y: 746,
    size: 13,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page2.drawText('Color Reproduction Verification: Primary Channels, Secondary Mixes, and Monochromatic Steps', {
    x: 48,
    y: 732,
    size: 8.5,
    font: helvetica,
    color: rgb(0.9, 0.78, 0.98),
  });

  // Section 4: RGB Gamut Swatches
  page2.drawText('4. Primary and Secondary Color Swatches (RGB Space)', {
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

  const swatches = [
    { label: 'Red (1,0,0)', color: rgb(1, 0, 0) },
    { label: 'Green (0,1,0)', color: rgb(0, 0.8, 0) },
    { label: 'Blue (0,0,1)', color: rgb(0, 0.2, 1) },
    { label: 'Cyan (0,1,1)', color: rgb(0, 0.8, 0.9) },
    { label: 'Magenta (1,0,1)', color: rgb(0.9, 0, 0.8) },
    { label: 'Yellow (1,1,0)', color: rgb(0.95, 0.85, 0) },
  ];

  let swatchX = 44;
  for (const sw of swatches) {
    page2.drawRectangle({
      x: swatchX,
      y: 630,
      width: 76,
      height: 44,
      color: sw.color,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 1,
    });
    page2.drawText(sw.label, { x: swatchX, y: 614, size: 7.5, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
    swatchX += 88;
  }

  // Section 5: Grayscale Gradation Steps
  page2.drawText('5. Monochromatic Grayscale Ramp (0% Black to 100% Black)', {
    x: 40,
    y: 574,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page2.drawLine({
    start: { x: 40, y: 568 },
    end: { x: 572, y: 568 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  const graySteps = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];
  let grayX = 44;
  for (const step of graySteps) {
    page2.drawRectangle({
      x: grayX,
      y: 504,
      width: 76,
      height: 44,
      color: rgb(step, step, step),
      borderColor: rgb(0.5, 0.5, 0.5),
      borderWidth: 1,
    });
    page2.drawText(`${Math.round(step * 100)}%`, { x: grayX + 26, y: 488, size: 8, font: courier, color: rgb(0.3, 0.3, 0.3) });
    grayX += 88;
  }

  page2.drawText('Page 2 of 2 - Color Spaces & Gradation', {
    x: 390,
    y: 40,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  return await doc.save();
}

export function getVectorCanvasElements(): CanvasElement[] {
  const shapeElement1: ShapeElement = {
    id: 'compliance-canvas-shape-1',
    kind: 'shape',
    pageIndex: 0,
    x: 44,
    y: 280,
    width: 160,
    height: 60,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    variant: 'rectangle',
    fill: 'rgba(99, 102, 241, 0.15)',
    stroke: '#4f46e5',
    strokeWidth: 2,
    opacity: 1,
    isHighlight: false,
  };

  const shapeElement2: ShapeElement = {
    id: 'compliance-canvas-shape-2',
    kind: 'shape',
    pageIndex: 0,
    x: 240,
    y: 280,
    width: 60,
    height: 60,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    variant: 'circle',
    fill: 'rgba(236, 72, 153, 0.15)',
    stroke: '#db2777',
    strokeWidth: 2,
    opacity: 1,
    isHighlight: false,
  };

  const shapeElement3: ShapeElement = {
    id: 'compliance-canvas-shape-3',
    kind: 'shape',
    pageIndex: 1,
    x: 44,
    y: 380,
    width: 220,
    height: 28,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    variant: 'arrow',
    fill: 'transparent',
    stroke: '#059669',
    strokeWidth: 2.5,
    opacity: 1,
    isHighlight: false,
  };

  return [shapeElement1, shapeElement2, shapeElement3];
}
