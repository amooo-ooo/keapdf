import type { Component } from 'svelte';
import type { ElementDefinition, ElementRenderProps, ElementPanelProps, BurnContext } from '../core/element-registry';
import type { ImageElement } from '../stores/canvas-types';
import ImageElementRender from './components/ImageElementRender.svelte';
import ImageSection from '../components/panels/element-properties/ImageSection.svelte';

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
    if (!element.src) return Promise.resolve();

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const cCtx = canvas.getContext('2d');
          if (!cCtx) {
            return;
          }

          cCtx.drawImage(img, 0, 0);
          const imageData = cCtx.getImageData(0, 0, img.width, img.height);

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
          resolve();
        }
      };
      
      img.onerror = () => {
        // Silently resolve on error to avoid blocking export
        resolve();
      };
      
      img.src = element.src;
    });
  }
};
