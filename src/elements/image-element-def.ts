import type { Component } from 'svelte';
import type { ElementDefinition, BurnContext, ElementRenderProps, ElementPanelProps } from '../core/element-registry';
import type { ImageElement } from '../stores/canvas-types';

/**
 * Definition for the image element type.
 */
export const imageElementDef: ElementDefinition<'image', ImageElement> = {
  kind: 'image',
  label: 'Image',
  defaults: { width: 200, height: 150 },

  /**
   * Creates a new ImageElement instance.
   *
   * @param id The unique identifier.
   * @param pageIndex The zero-based page index.
   * @param x The X coordinate in PDF points.
   * @param y The Y coordinate in PDF points.
   * @param overrides Optional partial overrides.
   * @return The initialized image element.
   */
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

  component: null as unknown as Component<ElementRenderProps<ImageElement>>,
  propertiesPanel: null as unknown as Component<ElementPanelProps<ImageElement>>,

  /**
   * Burns the image element onto the PDF page.
   *
   * @param element The image element to serialize.
   * @param ctx The burn context containing the page facade.
   * @return A promise that resolves when the image is drawn.
   */
  burn(element: ImageElement, ctx: BurnContext): Promise<void> {
    if (!element.src) return Promise.resolve();

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const cCtx = canvas.getContext('2d');
        if (!cCtx) {
          resolve();
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

        resolve();
      };
      
      img.onerror = () => {
        // Silently resolve on error to avoid blocking export
        resolve();
      };
      
      img.src = element.src;
    });
  }
};
