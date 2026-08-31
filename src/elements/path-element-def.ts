import type { Component } from 'svelte';
import type { ElementDefinition, ElementRenderProps, BurnContext } from '../core/element-registry';
import type { PathElement } from '../stores/canvas-types';
import PathElementRender from './components/PathElementRender.svelte';

/**
 * Definition for the path element type.
 */
export const pathElementDef: ElementDefinition<'path', PathElement> = {
  kind: 'path',
  label: 'Path',
  defaults: { width: 0, height: 0 },

  create(id: string, pageIndex: number, x: number, y: number, overrides?: Partial<PathElement>): PathElement {
    return {
      id,
      kind: 'path',
      pageIndex,
      x,
      y,
      width: 0,
      height: 0,
      rotation: 0,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
      points: [],
      stroke: '#000000',
      strokeWidth: 2,
      opacity: 1,
      isHighlight: false,
      ...overrides,
    };
  },

  component: PathElementRender as unknown as Component<ElementRenderProps<PathElement>>,
  propertiesPanel: null,

  normalize(element: PathElement): PathElement {
    return {
      ...element,
      opacity: Math.max(0, Math.min(1, element.opacity ?? 1)),
      strokeWidth: Math.max(1, element.strokeWidth ?? 1),
    };
  },

  hitTest(element: PathElement, point: { x: number; y: number }): boolean {
    if (!element.points || element.points.length === 0) return false;
    const tol = Math.max(8, (element.strokeWidth ?? 2) * 2);
    return element.points.some(p => {
      const dx = (p.x - element.x) - point.x;
      const dy = (p.y - element.y) - point.y;
      return Math.sqrt(dx * dx + dy * dy) <= tol;
    });
  },

  /**
   * Burns the path element onto the PDF page.
   *
   * @param element The path element to serialize.
   * @param ctx The burn context containing the page facade.
   */
  burn(element: PathElement, ctx: BurnContext): void {
    if (element.visible === false) return;
    let strokeStr = element.stroke;
    
    // Handle opacity by converting to hex alpha channel
    if (element.opacity !== undefined && element.opacity < 1.0) {
      const op = Math.round(element.opacity * 255).toString(16).padStart(2, '0');
      if (strokeStr && strokeStr.startsWith('#') && strokeStr.length === 7) {
        strokeStr += op;
      }
    }

    // If the path is a highlight and has dimensions but no points (or just 1 starting point),
    // it acts like a rectangular area highlight rather than an ink stroke.
    const isRectangleLike = element.points.length <= 1 && element.width > 0 && element.height > 0;

    if (element.isHighlight && isRectangleLike) {
      ctx.page.addHighlightAnnotation({
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        fill: strokeStr,
      });
    } else {
      // Coordinates are converted from canvas (top-left origin) to PDF (bottom-left origin)
      // internally within the addInkAnnotation operation.
      ctx.page.addInkAnnotation({
        x: element.x,
        y: element.y,
        points: element.points,
        stroke: strokeStr,
        strokeWidth: element.strokeWidth,
        opacity: element.opacity,
      });
    }
  }
};
