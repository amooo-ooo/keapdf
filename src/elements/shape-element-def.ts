import type { Component } from 'svelte';
import type { ElementDefinition, ElementRenderProps, ElementPanelProps, BurnContext } from '../core/element-registry';
import type { ShapeElement } from '../stores/canvas-types';
import ShapeElementRender from './components/ShapeElementRender.svelte';
import ShapeSection from '../components/panels/element-properties/ShapeSection.svelte';
import { parseColor } from '../services/pdf/utils';

/**
 * Element definition for shape elements.
 */
export const shapeElementDef: ElementDefinition<'shape', ShapeElement> = {
  kind: 'shape',
  label: 'Shape',
  defaults: { width: 100, height: 100 },

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
      fill: 'rgba(59, 130, 246, 0.15)',
      stroke: '#3b82f6',
      strokeWidth: 2,
      opacity: 1,
      isHighlight: false,
      ...overrides
    };
  },

  component: ShapeElementRender as unknown as Component<ElementRenderProps<ShapeElement>>,
  propertiesPanel: ShapeSection as unknown as Component<ElementPanelProps<ShapeElement>>,

  normalize(element: ShapeElement): ShapeElement {
    return {
      ...element,
      width: Math.max(5, element.width),
      height: Math.max(5, element.height),
      opacity: Math.max(0, Math.min(1, element.opacity ?? 1)),
      strokeWidth: Math.max(0, element.strokeWidth ?? 0),
    };
  },

  hitTest(element: ShapeElement, point: { x: number; y: number }): boolean {
    if (point.x < 0 || point.x > element.width || point.y < 0 || point.y > element.height) {
      return false;
    }
    if (element.variant === 'circle') {
      const rx = element.width / 2;
      const ry = element.height / 2;
      const dx = point.x - rx;
      const dy = point.y - ry;
      return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
    }
    return true;
  },

  /**
   * Serializes the shape element into the PDF page.
   *
   * @param element The shape element to burn.
   * @param ctx The burn context containing the page handle.
   */
  burn(element: ShapeElement, ctx: BurnContext): void {
    if (element.visible === false) return;
    
    const applyOpacity = (color: string, opacity: number): string => {
      if (!color || color === 'transparent') return color;
      const parsed = parseColor(color);
      const finalAlpha = Math.round(parsed.a * opacity);
      const toHex = (n: number) => n.toString(16).padStart(2, '0');
      return `#${toHex(parsed.r)}${toHex(parsed.g)}${toHex(parsed.b)}${toHex(finalAlpha)}`;
    };

    const options = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      flipX: element.flipX,
      flipY: element.flipY,
      fill: applyOpacity(element.fill, element.opacity ?? 1),
      stroke: applyOpacity(element.stroke, element.opacity ?? 1),
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
