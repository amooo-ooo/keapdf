import type { Component } from 'svelte';
import type { ElementDefinition, ElementRenderProps, ElementPanelProps, BurnContext } from '../core/element-registry';
import type { ThreeDElement } from '../stores/canvas-types';
import ThreeDElementRender from './components/ThreeDElementRender.svelte';
import ThreeDSection from '../components/panels/element-properties/ThreeDSection.svelte';
import {
  generateThreeDElementSvg,
  rasterizeSvgToImageData,
} from '../utils/element-burn-rasteriser';

/**
 * Element definition for ISO 32000-1 Clause 13.6 interactive 3D annotations (U3D/PRC).
 */
export const threeDElementDef: ElementDefinition<'3d', ThreeDElement> = {
  kind: '3d',
  label: 'Embed 3D',
  defaults: { width: 220, height: 180 },

  create(id: string, pageIndex: number, x: number, y: number, overrides?: Partial<ThreeDElement>): ThreeDElement {
    return {
      id,
      kind: '3d',
      pageIndex,
      x,
      y,
      width: 220,
      height: 180,
      rotation: 0,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
      src: '',
      fileName: 'model.u3d',
      mimeType: 'model/u3d',
      modelFormat: 'u3d',
      title: '3D Model',
      viewName: 'Default View',
      ...overrides,
    };
  },

  component: ThreeDElementRender as unknown as Component<ElementRenderProps<ThreeDElement>>,
  propertiesPanel: ThreeDSection as unknown as Component<ElementPanelProps<ThreeDElement>>,

  normalize(element: ThreeDElement): ThreeDElement {
    return {
      ...element,
      width: Math.max(80, element.width),
      height: Math.max(60, element.height),
    };
  },

  hitTest(element: ThreeDElement, point: { x: number; y: number }): boolean {
    return point.x >= 0 && point.x <= element.width && point.y >= 0 && point.y <= element.height;
  },

  /**
   * Burns the 3D annotation visual boundary and interactive links onto the PDF page.
   */
  async burn(element: ThreeDElement, ctx: BurnContext): Promise<void> {
    if (element.visible === false) return;

    try {
      const svgMarkup = generateThreeDElementSvg(element);
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
        // High-fidelity vector card fallback matching canvas ThreeDElementRender
        ctx.page.drawRectangle({
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          fill: '#18181b',
          stroke: '#52525b',
          strokeWidth: 1.2,
        });

        // 3D wireframe cube placeholder box
        const cubeBoxSize = Math.min(50, Math.max(30, Math.round(element.height * 0.4)));
        const cx = element.x + element.width / 2;
        ctx.page.drawRectangle({
          x: cx - cubeBoxSize / 2,
          y: element.y + 12,
          width: cubeBoxSize,
          height: cubeBoxSize,
          fill: '#1e3a8a',
          stroke: '#3b82f6',
          strokeWidth: 1.2,
        });

        const tag = (element.modelFormat || 'U3D').toUpperCase();
        const title = element.title || element.fileName || '3D Model';

        // Tag badge
        ctx.page.drawRectangle({
          x: element.x + 12,
          y: element.y + element.height - 28,
          width: 30,
          height: 14,
          fill: '#1e3a8a',
          stroke: '#60a5fa',
          strokeWidth: 0.8,
        });

        ctx.page.drawText({
          text: tag,
          x: element.x + 16,
          y: element.y + element.height - 18,
          fontSize: 8,
          fontFamily: 'Helvetica',
          color: '#60a5fa',
        });

        // Title
        ctx.page.drawText({
          text: title,
          x: element.x + 48,
          y: element.y + element.height - 18,
          fontSize: 9,
          fontFamily: 'Helvetica',
          color: '#f4f4f5',
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
          fileName: element.fileName || 'model.u3d',
        });

        if (element.src.startsWith('blob:') && typeof fetch !== 'undefined') {
          try {
            const resp = await fetch(element.src);
            const arrayBuf = await resp.arrayBuffer();
            ctx.document.addPendingAttachment({
              fileName: element.fileName || 'model.u3d',
              bytes: new Uint8Array(arrayBuf),
              mimeType: element.mimeType || 'model/u3d',
              description: element.title || '3D Model',
            });
          } catch (e) {
            console.warn('Failed to embed 3D model blob as attachment:', e);
          }
        }
      }
    } catch (err) {
      console.error('Failed to burn 3D element:', err);
    }
  },
};
