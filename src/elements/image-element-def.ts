import type { Component } from 'svelte';
import type { ElementDefinition, ElementRenderProps, ElementPanelProps, BurnContext } from '../core/element-registry';
import type { ImageElement } from '../stores/canvas-types';
import ImageElementRender from './components/ImageElementRender.svelte';
import ImageSection from '../components/panels/element-properties/ImageSection.svelte';
import { decodePngDataUrlFallback } from '../services/pdf/operations/annotation-extract-ops';

/**
 * Definition for the image element type.
 */
export const imageElementDef: ElementDefinition<'image', ImageElement> = {
  kind: 'image',
  label: 'Image',
  defaults: { width: 200, height: 150 },

  create(id: string, pageIndex: number, x: number, y: number, overrides?: Partial<ImageElement>): ImageElement {
    return {
      id,
      kind: 'image',
      pageIndex,
      x,
      y,
      width: 200,
      height: 150,
      rotation: 0,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
      src: '',
      objectFit: 'contain',
      opacity: 1,
      ...overrides,
    };
  },

  component: ImageElementRender as unknown as Component<ElementRenderProps<ImageElement>>,
  propertiesPanel: ImageSection as unknown as Component<ElementPanelProps<ImageElement>>,

  normalize(element: ImageElement): ImageElement {
    return {
      ...element,
      width: Math.max(10, element.width),
      height: Math.max(10, element.height),
      opacity: Math.max(0, Math.min(1, element.opacity ?? 1)),
    };
  },

  hitTest(element: ImageElement, point: { x: number; y: number }): boolean {
    return point.x >= 0 && point.x <= element.width && point.y >= 0 && point.y <= element.height;
  },

  /**
   * Burns the image element onto the PDF page.
   *
   * @param element The image element to serialize.
   * @param ctx The burn context containing the page facade.
   * @return A promise that resolves when the image is drawn.
   */
  burn(element: ImageElement, ctx: BurnContext): Promise<void> {
    if (element.visible === false) return Promise.resolve();

    if (!element.src) {
      ctx.page.drawRectangle({
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        fill: '#f4f4f5',
        stroke: '#d4d4d8',
        strokeWidth: 1,
      });
      ctx.page.drawText({
        text: 'No image',
        x: element.x + Math.max(4, (element.width - 50) / 2),
        y: element.y + element.height / 2 + 4,
        fontSize: 10,
        fontFamily: 'Helvetica',
        color: '#71717a',
      });
      return Promise.resolve();
    }

    if (typeof Image === 'undefined') {
      const decoded = decodePngDataUrlFallback(element.src);
      if (decoded) {
        if (element.opacity !== undefined && element.opacity < 1) {
          for (let i = 3; i < decoded.data.length; i += 4) {
            decoded.data[i] = Math.round(decoded.data[i] * element.opacity);
          }
        }
        ctx.page.drawImage({
          id: element.id,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          imageData: {
            width: decoded.width,
            height: decoded.height,
            imgData: {
              data: decoded.data,
              width: decoded.width,
              height: decoded.height,
              colorSpace: 'srgb',
            } as unknown as ImageData,
          },
          objectFit: element.objectFit,
          rotation: element.rotation,
          flipX: element.flipX,
          flipY: element.flipY,
        });
      }
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let resolved = false;
      const safeResolve = (): void => {
        if (resolved) return;
        resolved = true;
        resolve();
      };

      const timer = setTimeout(safeResolve, 4000);

      const img = new Image();
      if (!element.src.startsWith('data:') && !element.src.startsWith('blob:')) {
        img.crossOrigin = 'anonymous';
      }

      const drawImageToPage = (): void => {
        clearTimeout(timer);
        try {
          const targetW =
            img.naturalWidth || img.width || Math.max(1, Math.round(element.width * 2));
          const targetH =
            img.naturalHeight || img.height || Math.max(1, Math.round(element.height * 2));
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const cCtx = canvas.getContext('2d');
          if (!cCtx) {
            safeResolve();
            return;
          }

          cCtx.drawImage(img, 0, 0, targetW, targetH);
          const imageData = cCtx.getImageData(0, 0, targetW, targetH);

          // Handle opacity by modifying the alpha channel
          if (element.opacity !== undefined && element.opacity < 1) {
            const data = imageData.data;
            for (let i = 3; i < data.length; i += 4) {
              data[i] = Math.round(data[i] * element.opacity);
            }
          }

          ctx.page.drawImage({
            id: element.id,
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
            imageData: {
              width: imageData.width,
              height: imageData.height,
              imgData: imageData,
            },
            objectFit: element.objectFit,
            rotation: element.rotation,
            flipX: element.flipX,
            flipY: element.flipY,
          });
        } catch (err) {
          console.error('Failed to burn image element:', err);
        } finally {
          safeResolve();
        }
      };

      img.onload = drawImageToPage;
      img.onerror = () => {
        clearTimeout(timer);
        safeResolve();
      };

      img.src = element.src;
      if (img.complete && img.naturalWidth > 0) {
        drawImageToPage();
      }
    });
  }
};
