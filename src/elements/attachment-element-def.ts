import type { Component } from 'svelte';
import type { ElementDefinition, ElementRenderProps, ElementPanelProps, BurnContext } from '../core/element-registry';
import type { AttachmentElement } from '../stores/canvas-types';
import AttachmentElementRender from './components/AttachmentElementRender.svelte';
import AttachmentSection from '../components/panels/element-properties/AttachmentSection.svelte';
import { formatByteSize } from '../services/pdf/operations/metadata-ops';
import {
  generateAttachmentElementSvg,
  rasterizeSvgToImageData,
} from '../utils/element-burn-rasteriser';

/**
 * Element definition for ISO 32000-2 Clause 14.13 Associated Files (AF) and EmbeddedFiles.
 */
export const attachmentElementDef: ElementDefinition<'attachment', AttachmentElement> = {
  kind: 'attachment',
  label: 'Attach File',
  defaults: { width: 180, height: 48 },

  create(id: string, pageIndex: number, x: number, y: number, overrides?: Partial<AttachmentElement>): AttachmentElement {
    return {
      id,
      kind: 'attachment',
      pageIndex,
      x,
      y,
      width: 180,
      height: 48,
      rotation: 0,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
      src: '',
      fileName: 'attachment.dat',
      mimeType: 'application/octet-stream',
      description: 'Attached document',
      ...overrides,
    };
  },

  component: AttachmentElementRender as unknown as Component<ElementRenderProps<AttachmentElement>>,
  propertiesPanel: AttachmentSection as unknown as Component<ElementPanelProps<AttachmentElement>>,

  normalize(element: AttachmentElement): AttachmentElement {
    return {
      ...element,
      width: Math.max(100, element.width),
      height: Math.max(28, element.height),
    };
  },

  hitTest(element: AttachmentElement, point: { x: number; y: number }): boolean {
    return point.x >= 0 && point.x <= element.width && point.y >= 0 && point.y <= element.height;
  },

  /**
   * Burns the file attachment badge representation and embedded file payload into the PDF page.
   */
  async burn(element: AttachmentElement, ctx: BurnContext): Promise<void> {
    if (element.visible === false) return;

    try {
      const svgMarkup = generateAttachmentElementSvg(element);
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
        // High-fidelity vector card fallback matching canvas AttachmentElementRender
        ctx.page.drawRectangle({
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          fill: '#171717',
          stroke: '#404040',
          strokeWidth: 1.2,
        });

        const iconBoxSize = Math.min(24, Math.max(16, Math.round(element.height * 0.55)));
        const iconY = element.y + (element.height - iconBoxSize) / 2;
        ctx.page.drawRectangle({
          x: element.x + 8,
          y: iconY,
          width: iconBoxSize,
          height: iconBoxSize,
          fill: '#1e3a8a',
          stroke: '#3b82f6',
          strokeWidth: 1,
        });

        const textX = element.x + 14 + iconBoxSize;
        ctx.page.drawText({
          text: element.fileName || 'Attached File',
          x: textX,
          y: element.y + element.height * 0.45,
          fontSize: 9.5,
          fontFamily: 'Helvetica',
          color: '#f4f4f5',
        });

        const sizeStr = element.fileSize ? ` | ${formatByteSize(element.fileSize)}` : '';
        ctx.page.drawText({
          text: `ISO 32000-2 AF${sizeStr}`,
          x: textX,
          y: element.y + element.height * 0.75,
          fontSize: 8,
          fontFamily: 'Helvetica',
          color: '#a1a1aa',
        });
      }

      if (element.src) {
        const isWebUrl = /^https?:\/\//i.test(element.src);
        ctx.page.addLinkAnnotation({
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          uri: isWebUrl ? element.src : undefined,
          fileName: element.fileName || 'attachment.dat',
        });

        if (element.src.startsWith('blob:') && typeof fetch !== 'undefined') {
          try {
            const resp = await fetch(element.src);
            const arrayBuf = await resp.arrayBuffer();
            ctx.document.addPendingAttachment({
              fileName: element.fileName || 'attachment.dat',
              bytes: new Uint8Array(arrayBuf),
              mimeType: element.mimeType || 'application/octet-stream',
              description: element.description || 'Associated File',
            });
          } catch (e) {
            console.warn('Failed to embed attachment blob into PDF:', e);
          }
        }
      }
    } catch (err) {
      console.error('Failed to burn attachment element:', err);
    }
  },
};
