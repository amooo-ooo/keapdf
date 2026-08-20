import type { Component } from 'svelte';
import type { ElementDefinition, BurnContext, ElementRenderProps, ElementPanelProps } from '../core/element-registry';
import type { PathElement } from '../stores/canvas-types';

/**
 * Definition for the path element type.
 */
export const pathElementDef: ElementDefinition<'path', PathElement> = {
  kind: 'path',
  label: 'Path',
  defaults: { width: 0, height: 0 },

  /**
   * Creates a new PathElement instance.
   *
   * @param id The unique identifier.
   * @param pageIndex The zero-based page index.
   * @param x The X coordinate in PDF points.
   * @param y The Y coordinate in PDF points.
   * @param overrides Optional partial overrides.
   * @return The initialized path element.
   */
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

  component: null as unknown as Component<ElementRenderProps<PathElement>>,
  propertiesPanel: null as unknown as Component<ElementPanelProps<PathElement>>,

  /**
   * Burns the path element onto the PDF page.
   *
   * @param element The path element to serialize.
   * @param ctx The burn context containing the page facade.
   */
  burn(element: PathElement, ctx: BurnContext): void {
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
