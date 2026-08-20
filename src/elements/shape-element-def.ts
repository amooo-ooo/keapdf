import type { Component } from 'svelte';
import type { ElementDefinition, ElementRenderProps, ElementPanelProps, BurnContext } from '../core/element-registry';
import type { ShapeElement } from '../stores/canvas-types';

/**
 * Element definition for shape elements.
 */
export const shapeElementDef: ElementDefinition<'shape', ShapeElement> = {
  kind: 'shape',
  label: 'Shape',
  defaults: { width: 100, height: 100 },

  /**
   * Creates a new shape element instance.
   *
   * @param id Unique element identifier.
   * @param pageIndex Target page zero-based index.
   * @param x Left edge position in PDF points.
   * @param y Top edge position in PDF points.
   * @param overrides Optional property overrides.
   * @return The fully initialized shape element.
   */
  create(id: string, pageIndex: number, x: number, y: number, overrides?: Partial<ShapeElement>): ShapeElement {
    return {
      id,
      kind: 'shape',
      pageIndex,
      x,
      y,
      width: 100,
      height: 100,
      rotation: 0,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
      variant: 'rectangle',
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 2,
      opacity: 1,
      isHighlight: false,
      ...overrides
    };
  },

  component: null as unknown as Component<ElementRenderProps<ShapeElement>>,
  propertiesPanel: null as unknown as Component<ElementPanelProps<ShapeElement>>,

  /**
   * Serializes the shape element into the PDF page.
   *
   * @param element The shape element to burn.
   * @param ctx The burn context containing the page handle.
   */
  burn(element: ShapeElement, ctx: BurnContext): void {
    const alphaHex = Math.round((element.opacity ?? 1) * 255).toString(16).padStart(2, '0');
    
    const applyOpacity = (color: string) => {
      if (!color || color === 'transparent') return color;
      if (color.startsWith('#') && color.length === 7) {
        return color + alphaHex;
      }
      return color;
    };

    const options = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      flipX: element.flipX,
      flipY: element.flipY,
      fill: applyOpacity(element.fill),
      stroke: applyOpacity(element.stroke),
      strokeWidth: element.strokeWidth
    };

    if (element.variant === 'rectangle' && element.isHighlight) {
      ctx.page.addHighlightAnnotation(options);
    } else {
      switch (element.variant) {
        case 'rectangle':
          ctx.page.drawRectangle(options);
          break;
        case 'circle':
          ctx.page.drawCircle(options);
          break;
        case 'line':
          ctx.page.drawLine(options);
          break;
        case 'arrow':
          ctx.page.drawArrow(options);
          break;
      }
    }
  }
};
