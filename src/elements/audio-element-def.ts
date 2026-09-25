import type { Component } from 'svelte';
import type { ElementDefinition, ElementRenderProps, ElementPanelProps, BurnContext } from '../core/element-registry';
import type { AudioElement } from '../stores/canvas-types';
import AudioElementRender from './components/AudioElementRender.svelte';
import AudioSection from '../components/panels/element-properties/AudioSection.svelte';
import {
  generateAudioElementSvg,
  rasterizeSvgToImageData,
} from '../utils/element-burn-rasteriser';

/**
 * Element definition for ISO 32000-1 Clause 13.3 / 13.7 RichMedia sound clip objects.
 */
export const audioElementDef: ElementDefinition<'audio', AudioElement> = {
  kind: 'audio',
  label: 'Embed Audio',
  defaults: { width: 240, height: 60 },

  create(id: string, pageIndex: number, x: number, y: number, overrides?: Partial<AudioElement>): AudioElement {
    return {
      id,
      kind: 'audio',
      pageIndex,
      x,
      y,
      width: 240,
      height: 60,
      rotation: 0,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
      src: '',
      fileName: 'audio.mp3',
      mimeType: 'audio/mpeg',
      title: 'Audio Clip',
      controls: true,
      ...overrides,
    };
  },

  component: AudioElementRender as unknown as Component<ElementRenderProps<AudioElement>>,
  propertiesPanel: AudioSection as unknown as Component<ElementPanelProps<AudioElement>>,

  normalize(element: AudioElement): AudioElement {
    return {
      ...element,
      width: Math.max(100, element.width),
      height: Math.max(30, element.height),
    };
  },

  hitTest(element: AudioElement, point: { x: number; y: number }): boolean {
    return point.x >= 0 && point.x <= element.width && point.y >= 0 && point.y <= element.height;
  },

  /**
   * Burns the audio element visual representation and interactive playback links onto the PDF page.
   */
  async burn(element: AudioElement, ctx: BurnContext): Promise<void> {
    if (element.visible === false) return;

    try {
      const svgMarkup = generateAudioElementSvg(element);
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
        // High-fidelity vector card fallback matching canvas AudioElementRender
        ctx.page.drawRectangle({
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          fill: '#171717',
          stroke: '#404040',
          strokeWidth: 1.2,
        });

        const btnSize = Math.min(24, Math.max(16, Math.round(element.height * 0.45)));
        const btnY = element.y + (element.height - btnSize) / 2;
        ctx.page.drawRectangle({
          x: element.x + 10,
          y: btnY,
          width: btnSize,
          height: btnSize,
          fill: '#1e3a8a',
          stroke: '#3b82f6',
          strokeWidth: 1,
        });

        const titleText = element.title || element.fileName || 'Audio Track';
        ctx.page.drawText({
          text: titleText,
          x: element.x + 16 + btnSize,
          y: element.y + element.height * 0.45,
          fontSize: 10,
          fontFamily: 'Helvetica',
          color: '#f4f4f5',
        });

        const sizeFormatted = element.fileSize ? ` | ${Math.round(element.fileSize / 1024)} KB` : '';
        ctx.page.drawText({
          text: `ISO 32000-1 Clause 13.3${sizeFormatted}`,
          x: element.x + 16 + btnSize,
          y: element.y + element.height * 0.75,
          fontSize: 8,
          fontFamily: 'Helvetica',
          color: '#a1a1aa',
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
          fileName: element.fileName || 'audio.mp3',
        });

        if (element.src.startsWith('blob:') && typeof fetch !== 'undefined') {
          try {
            const resp = await fetch(element.src);
            const arrayBuf = await resp.arrayBuffer();
            ctx.document.addPendingAttachment({
              fileName: element.fileName || 'audio.mp3',
              bytes: new Uint8Array(arrayBuf),
              mimeType: element.mimeType || 'audio/mpeg',
              description: element.title || 'Embedded Audio',
            });
          } catch (e) {
            console.warn('Failed to embed audio blob as attachment:', e);
          }
        }
      }
    } catch (err) {
      console.error('Failed to burn audio element:', err);
    }
  },
};
