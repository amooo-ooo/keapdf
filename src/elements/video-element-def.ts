import type { Component } from 'svelte';
import type { ElementDefinition, ElementRenderProps, ElementPanelProps, BurnContext } from '../core/element-registry';
import type { VideoElement } from '../stores/canvas-types';
import VideoElementRender from './components/VideoElementRender.svelte';
import VideoSection from '../components/panels/element-properties/VideoSection.svelte';
import {
  generateVideoElementSvg,
  rasterizeSvgToImageData,
} from '../utils/element-burn-rasteriser';

/**
 * Element definition for ISO 32000-1 Clause 13.2 / 13.7 RichMedia video rendition streams.
 */
export const videoElementDef: ElementDefinition<'video', VideoElement> = {
  kind: 'video',
  label: 'Embed Video',
  defaults: { width: 280, height: 180 },

  create(id: string, pageIndex: number, x: number, y: number, overrides?: Partial<VideoElement>): VideoElement {
    return {
      id,
      kind: 'video',
      pageIndex,
      x,
      y,
      width: 280,
      height: 180,
      rotation: 0,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
      src: '',
      fileName: 'video.mp4',
      mimeType: 'video/mp4',
      title: 'Video Stream',
      autoplay: false,
      controls: true,
      loop: false,
      muted: false,
      ...overrides,
    };
  },

  component: VideoElementRender as unknown as Component<ElementRenderProps<VideoElement>>,
  propertiesPanel: VideoSection as unknown as Component<ElementPanelProps<VideoElement>>,

  normalize(element: VideoElement): VideoElement {
    return {
      ...element,
      width: Math.max(80, element.width),
      height: Math.max(50, element.height),
    };
  },

  hitTest(element: VideoElement, point: { x: number; y: number }): boolean {
    return point.x >= 0 && point.x <= element.width && point.y >= 0 && point.y <= element.height;
  },

  /**
   * Burns the video element visual box and interactive playback link onto the PDF page.
   */
  async burn(element: VideoElement, ctx: BurnContext): Promise<void> {
    if (element.visible === false) return;

    try {
      const svgMarkup = generateVideoElementSvg(element);
      const raster = await rasterizeSvgToImageData(svgMarkup, element.width, element.height);

      if (raster) {
        ctx.page.drawImage({
          id: element.id,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          imageData: raster,
          objectFit: 'contain',
          rotation: element.rotation,
          flipX: element.flipX,
          flipY: element.flipY,
        });
      } else {
        // High-fidelity vector card fallback matching canvas VideoElementRender
        ctx.page.drawRectangle({
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          fill: '#000000',
          stroke: '#404040',
          strokeWidth: 1.5,
        });

        // Center play badge
        const playBtnRadius = Math.min(22, Math.max(14, Math.round(Math.min(element.width, element.height) * 0.16)));
        const cx = element.x + element.width / 2;
        const cy = element.y + element.height / 2;
        ctx.page.drawRectangle({
          x: cx - playBtnRadius,
          y: cy - playBtnRadius,
          width: playBtnRadius * 2,
          height: playBtnRadius * 2,
          fill: '#1f2937',
          stroke: '#6b7280',
          strokeWidth: 1.2,
        });

        // Play triangle indicator
        ctx.page.drawText({
          text: '>',
          x: cx - playBtnRadius * 0.25,
          y: cy + playBtnRadius * 0.35,
          fontSize: Math.round(playBtnRadius * 0.9),
          fontFamily: 'Helvetica',
          color: '#ffffff',
        });

        // Title header badge
        const titleText = element.title || element.fileName || 'ISO 32000 RichMedia Video';
        ctx.page.drawRectangle({
          x: element.x + 8,
          y: element.y + 8,
          width: Math.min(element.width - 16, 160),
          height: 18,
          fill: '#171717',
          stroke: '#3b82f6',
          strokeWidth: 0.8,
        });

        ctx.page.drawText({
          text: titleText,
          x: element.x + 14,
          y: element.y + 20,
          fontSize: 8,
          fontFamily: 'Helvetica',
          color: '#e4e4e7',
        });
      }

      if (element.src) {
        const isWebUrl = /^https?:\/\//i.test(element.src);
        ctx.page.addLinkAnnotation({
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          uri: isWebUrl ? element.src : undefined,
          fileName: element.fileName || 'video.mp4',
        });

        if (element.src.startsWith('blob:') && typeof fetch !== 'undefined') {
          try {
            const resp = await fetch(element.src);
            const arrayBuf = await resp.arrayBuffer();
            ctx.document.addPendingAttachment({
              fileName: element.fileName || 'video.mp4',
              bytes: new Uint8Array(arrayBuf),
              mimeType: element.mimeType || 'video/mp4',
              description: element.title || 'Embedded Video',
            });
          } catch (e) {
            console.warn('Failed to embed video blob as attachment:', e);
          }
        }
      }
    } catch (err) {
      console.error('Failed to burn video element:', err);
    }
  },
};
