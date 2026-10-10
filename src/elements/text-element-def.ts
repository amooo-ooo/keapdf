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
    const minW = element.originalSpan ? 4 : 20;
    const minH = element.originalSpan ? 6 : 14;
    return {
      ...element,
      width: Math.max(minW, element.width),
      height: Math.max(minH, element.height),
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
        ctx.page.deleteTextSpan(element.originalSpan, { reflowDownstream: false });
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
      letterSpacing: element.letterSpacing,
      wordSpacing: element.wordSpacing,
      scaleX: element.scaleX,
      backgroundColor: hasSegments ? undefined : undefined,
      lines: element.lines,
      segments: element.segments
    }, charsetIndex);

    const rotateLineTopLeftAroundElementCenter = (
      lineLeft: number,
      lineTop: number,
      lineWidth: number,
      lineHeight: number,
    ): { x: number; y: number } => {
      if (!element.rotation) return { x: lineLeft, y: lineTop };
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      const ucx = lineLeft + lineWidth / 2;
      const ucy = lineTop + lineHeight / 2;
      const rad = (element.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = ucx - cx;
      const dy = ucy - cy;
      const rcx = cx + dx * cos - dy * sin;
      const rcy = cy + dx * sin + dy * cos;
      return {
        x: rcx - lineWidth / 2,
        y: rcy - lineHeight / 2,
      };
    };

    if (element.lines && element.lines.length > 0) {
      for (let lIdx = 0; lIdx < element.lines.length; lIdx++) {
        const line = element.lines[lIdx];
        const hasHandledDecorations = (line.segments && line.segments.some((s) => s.underline || s.strikethrough)) || line.underline || line.strikethrough;
        if (hasHandledDecorations) continue;

        const lH = line.lineHeight || element.lineHeight || (line.fontSize || element.fontSize) * 1.25;
        const lTop = line.top !== undefined ? element.y + line.top : element.y + lIdx * lH;
        const lLeft = line.left !== undefined ? element.x + line.left : element.x;
        const lWidth = line.width || element.width;
        const lFs = line.fontSize || element.fontSize;

        if (line.underline || element.underline) {
          const pos = rotateLineTopLeftAroundElementCenter(lLeft, lTop + lFs * 0.94, lWidth, 1.5);
          ctx.page.drawLine({
            x: pos.x,
            y: pos.y,
            width: lWidth,
            height: 1.5,
            stroke: element.color,
            strokeWidth: 1.5,
            rotation: element.rotation,
            flipX: element.flipX,
            flipY: element.flipY,
          });
        }

        if (line.strikethrough || element.strikethrough) {
          const pos = rotateLineTopLeftAroundElementCenter(lLeft, lTop + lFs * 0.52, lWidth, 1.5);
          ctx.page.drawLine({
            x: pos.x,
            y: pos.y,
            width: lWidth,
            height: 1.5,
            stroke: element.color,
            strokeWidth: 1.5,
            rotation: element.rotation,
            flipX: element.flipX,
            flipY: element.flipY,
          });
        }
      }
    } else {
      if (element.underline) {
        const rawY = element.y + Math.max(element.height - 2, element.fontSize);
        const pos = rotateLineTopLeftAroundElementCenter(element.x, rawY, element.width, 1.5);
        ctx.page.drawLine({
          x: pos.x,
          y: pos.y,
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
        const rawY = element.y + element.height / 2;
        const pos = rotateLineTopLeftAroundElementCenter(element.x, rawY, element.width, 1.5);
        ctx.page.drawLine({
          x: pos.x,
          y: pos.y,
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
  }
};
