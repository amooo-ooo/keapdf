import type { Component } from 'svelte';
import type { ElementDefinition, ElementRenderProps, ElementPanelProps, BurnContext } from '../core/element-registry';
import type { TextElement } from '../stores/canvas-types';
import TextElementRender from './components/TextElementRender.svelte';
import TextSection from '../components/panels/element-properties/TextSection.svelte';

/**
 * Element definition for text elements.
 */
export const textElementDef: ElementDefinition<'text', TextElement> = {
  kind: 'text',
  label: 'Text',
  defaults: { width: 150, height: 30 },

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

  component: TextElementRender as unknown as Component<ElementRenderProps<TextElement>>,
  propertiesPanel: TextSection as unknown as Component<ElementPanelProps<TextElement>>,

  normalize(element: TextElement): TextElement {
    return {
      ...element,
      width: Math.max(20, element.width),
      height: Math.max(14, element.height),
      fontSize: Math.max(6, Math.min(144, element.fontSize)),
    };
  },

  hitTest(element: TextElement, point: { x: number; y: number }): boolean {
    return point.x >= 0 && point.x <= element.width && point.y >= 0 && point.y <= element.height;
  },

  /**
   * Serializes the text element into the PDF page.
   *
   * @param element The text element to burn.
   * @param ctx The burn context containing the page handle.
   */
  burn(element: TextElement, ctx: BurnContext): void {
    if (element.visible === false) return;

    const hasSegments = Boolean(
      (element.lines && element.lines.some((l) => l.segments && l.segments.length > 0)) ||
      (element.segments && element.segments.length > 0)
    );

    if (!hasSegments && element.backgroundColor && element.backgroundColor !== 'transparent') {
      ctx.page.drawRectangle({
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        fill: element.backgroundColor,
        stroke: 'transparent',
        strokeWidth: 0,
        rotation: element.rotation,
        flipX: element.flipX,
        flipY: element.flipY,
      });
    }

    if (element.originalSpan && typeof ctx.page.deleteTextSpan === 'function') {
      try {
        ctx.page.deleteTextSpan(element.originalSpan);
      } catch {
        // Best-effort cleanup of hidden original span text objects
      }
    }

    const charsetIndex = ctx.document ? ctx.document.fontCharsetIndex : undefined;

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
      textAlign: element.textAlign,
      lineHeight: element.lineHeight,
      backgroundColor: hasSegments ? undefined : undefined,
      lines: element.lines,
      segments: element.segments
    }, charsetIndex);

    if (element.underline) {
      let lineX = element.x;
      let lineY = element.y + Math.max(element.height - 2, element.fontSize);
      if (element.rotation !== 0) {
        const cx = element.x + element.width / 2;
        const cy = element.y + element.height / 2;
        const rad = (element.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = lineX - cx;
        const dy = lineY - cy;
        lineX = cx + dx * cos - dy * sin;
        lineY = cy + dx * sin + dy * cos;
      }
      ctx.page.drawLine({
        x: lineX,
        y: lineY,
        width: element.width,
        height: 1.5,
        stroke: element.color,
        strokeWidth: 1.5,
        rotation: element.rotation,
        flipX: element.flipX,
        flipY: element.flipY,
      });
    }

    if (element.strikethrough) {
      let lineX = element.x;
      let lineY = element.y + element.height / 2;
      if (element.rotation !== 0) {
        const cx = element.x + element.width / 2;
        const cy = element.y + element.height / 2;
        const rad = (element.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = lineX - cx;
        const dy = lineY - cy;
        lineX = cx + dx * cos - dy * sin;
        lineY = cy + dx * sin + dy * cos;
      }
      ctx.page.drawLine({
        x: lineX,
        y: lineY,
        width: element.width,
        height: 1.5,
        stroke: element.color,
        strokeWidth: 1.5,
        rotation: element.rotation,
        flipX: element.flipX,
        flipY: element.flipY,
      });
    }
  }
};
