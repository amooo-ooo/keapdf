import type { Component } from 'svelte';
import type { ElementDefinition, ElementRenderProps, ElementPanelProps, BurnContext } from '../core/element-registry';
import type { TextElement } from '../stores/canvas-types';

/**
 * Element definition for text elements.
 */
export const textElementDef: ElementDefinition<'text', TextElement> = {
  kind: 'text',
  label: 'Text',
  defaults: { width: 150, height: 30 },

  /**
   * Creates a new text element instance.
   *
   * @param id Unique element identifier.
   * @param pageIndex Target page zero-based index.
   * @param x Left edge position in PDF points.
   * @param y Top edge position in PDF points.
   * @param overrides Optional property overrides.
   * @return The fully initialized text element.
   */
  create(id: string, pageIndex: number, x: number, y: number, overrides?: Partial<TextElement>): TextElement {
    return {
      id,
      kind: 'text',
      pageIndex,
      x,
      y,
      width: 150,
      height: 30,
      rotation: 0,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
      text: '',
      fontSize: 14,
      fontFamily: 'Helvetica',
      color: '#000000',
      backgroundColor: undefined,
      fontWeight: 'normal',
      fontStyle: 'normal',
      textAlign: 'left',
      ...overrides
    };
  },

  component: null as unknown as Component<ElementRenderProps<TextElement>>,
  propertiesPanel: null as unknown as Component<ElementPanelProps<TextElement>>,

  /**
   * Serializes the text element into the PDF page.
   *
   * @param element The text element to burn.
   * @param ctx The burn context containing the page handle.
   */
  burn(element: TextElement, ctx: BurnContext): void {
    ctx.page.drawText({
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      flipX: element.flipX,
      flipY: element.flipY,
      text: element.text,
      fontSize: element.fontSize,
      fontFamily: element.fontFamily,
      rawFontFamily: element.rawFontFamily,
      color: element.color,
      fontWeight: element.fontWeight,
      fontStyle: element.fontStyle,
      lineHeight: element.lineHeight,
      lines: element.lines,
      segments: element.segments
    });
  }
};
