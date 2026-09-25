import type { Component } from 'svelte';
import type { ElementDefinition, ElementRenderProps, ElementPanelProps, BurnContext } from '../core/element-registry';
import type { BarcodeElement } from '../stores/canvas-types';
import BarcodeElementRender from './components/BarcodeElementRender.svelte';
import BarcodeSection from '../components/panels/element-properties/BarcodeSection.svelte';
import {
  generateQrCodeSvg,
  generateBarcodeSvg,
} from '../utils/barcode-generator';
import { rasterizeSvgToImageData } from '../utils/element-burn-rasteriser';

/**
 * Element definition for ISO/IEC 18004 QR codes and ISO/IEC 15417 Code 128 barcodes.
 */
export const barcodeElementDef: ElementDefinition<'barcode', BarcodeElement> = {
  kind: 'barcode',
  label: 'QR Code / Barcode',
  defaults: { width: 120, height: 120 },

  create(id: string, pageIndex: number, x: number, y: number, overrides?: Partial<BarcodeElement>): BarcodeElement {
    const symbology = overrides?.symbology ?? 'qr-code';
    const isCode128 = symbology === 'code-128';
    const defaultWidth = isCode128 ? 180 : 120;
    const defaultHeight = isCode128 ? 60 : 120;
    const payload = overrides?.payload ?? 'https://keapdf.com';

    return {
      id,
      kind: 'barcode',
      pageIndex,
      x,
      y,
      width: defaultWidth,
      height: defaultHeight,
      rotation: 0,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
      payload,
      symbology,
      fgColor: '#000000',
      bgColor: '#ffffff',
      includeText: true,
      ...overrides,
    };
  },

  component: BarcodeElementRender as unknown as Component<ElementRenderProps<BarcodeElement>>,
  propertiesPanel: BarcodeSection as unknown as Component<ElementPanelProps<BarcodeElement>>,

  normalize(element: BarcodeElement): BarcodeElement {
    return {
      ...element,
      width: Math.max(30, element.width),
      height: Math.max(30, element.height),
    };
  },

  hitTest(element: BarcodeElement, point: { x: number; y: number }): boolean {
    return point.x >= 0 && point.x <= element.width && point.y >= 0 && point.y <= element.height;
  },

  /**
   * Burns the QR code or Barcode into the PDF page using rasterised image drawing.
   */
  async burn(element: BarcodeElement, ctx: BurnContext): Promise<void> {
    if (element.visible === false) return;
    if (!element.payload) return;

    try {
      const symbology = element.symbology || 'qr-code';
      const svgMarkup =
        symbology === 'code-128'
          ? generateBarcodeSvg(element.payload, {
              fgColor: element.fgColor || '#000000',
              bgColor: element.bgColor || '#ffffff',
              includeText: element.includeText !== false,
              width: element.width,
              height: element.height,
            })
          : generateQrCodeSvg(element.payload, {
              fgColor: element.fgColor || '#000000',
              bgColor: element.bgColor || '#ffffff',
              width: element.width,
              height: element.height,
            });

      const raster = await rasterizeSvgToImageData(svgMarkup, element.width, element.height);
      if (raster) {
        ctx.page.drawImage({
          id: element.id,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          imageData: raster,
          objectFit: 'contain',
          rotation: element.rotation,
          flipX: element.flipX,
          flipY: element.flipY,
        });
      } else {
        // Fallback for headless environments: draw container boundary with label
        ctx.page.drawRectangle({
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          fill: element.bgColor || '#ffffff',
          stroke: element.fgColor || '#000000',
          strokeWidth: 1,
        });
        const label = symbology === 'code-128' ? 'Code 128' : 'QR Code';
        ctx.page.drawText({
          text: `${label}: ${element.payload}`,
          x: element.x + 6,
          y: element.y + element.height / 2 + 3,
          fontSize: 8,
          fontFamily: 'Helvetica',
          color: element.fgColor || '#000000',
        });
      }

      // Add interactive Link annotation if payload is a URL or URI link
      const trimmed = element.payload.trim();
      const isUrl = /^https?:\/\//i.test(trimmed) || /^(mailto|tel):/i.test(trimmed);
      if (isUrl) {
        ctx.page.addLinkAnnotation({
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          uri: trimmed,
        });
      }
    } catch (err) {
      console.error('Failed to burn barcode element:', err);
    }
  },
};
