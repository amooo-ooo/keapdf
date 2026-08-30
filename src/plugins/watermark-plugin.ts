/**
 * Built-in Watermark & Stamp plugin demonstrating the Layer 5 Plugin API.
 *
 * Demonstrates registering custom canvas element types, interactive tools,
 * lifecycle event listeners, custom document exporters, and command execution
 * with zero core codebase modifications.
 */

import type { PluginDefinition, PluginAPI } from '../core/plugin-api';
import type { CanvasElementBase, BurnContext } from '../core/element-registry';
import { AddElementCommand } from '../commands';

/** Custom stamp canvas element registered by the plugin. */
export interface StampElement extends CanvasElementBase {
  kind: 'stamp';
  text: string;
  color: string;
  borderColor: string;
  [key: string]: unknown;
}

export const watermarkPlugin: PluginDefinition = {
  id: 'org.embedpdf.watermark',
  name: 'Watermark & Stamp',
  version: '1.0.0',
  description: 'Watermarking, stamps, and document metadata extension',
  author: 'EmbedPDF Core Team',
  trusted: true,

  activate(api: PluginAPI): void {
    // 1. Register custom 'stamp' canvas element
    api.elements.register<'stamp', StampElement>({
      kind: 'stamp',
      label: 'Document Stamp',
      defaults: { width: 180, height: 50 },

      create(id: string, pageIndex: number, x: number, y: number, overrides?: Partial<StampElement>): StampElement {
        return {
          id,
          kind: 'stamp',
          pageIndex,
          x,
          y,
          width: 180,
          height: 50,
          rotation: -15,
          locked: false,
          visible: true,
          flipX: false,
          flipY: false,
          text: 'CONFIDENTIAL',
          color: '#DC2626',
          borderColor: '#DC2626',
          ...overrides,
        };
      },

      component: null,
      propertiesPanel: null,

      normalize(element: StampElement): StampElement {
        return {
          ...element,
          width: Math.max(60, element.width),
          height: Math.max(30, element.height),
        };
      },

      hitTest(element: StampElement, point: { x: number; y: number }): boolean {
        return point.x >= 0 && point.x <= element.width && point.y >= 0 && point.y <= element.height;
      },

      burn(element: StampElement, ctx: BurnContext): void {
        ctx.page.drawText({
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          rotation: element.rotation,
          flipX: element.flipX,
          flipY: element.flipY,
          text: element.text,
          fontSize: 18,
          fontFamily: 'Helvetica-Bold',
          color: element.color,
          fontWeight: 'bold',
          fontStyle: 'normal',
        });
      },
    });

    // 2. Register custom 'stamp' canvas tool
    api.tools.register({
      id: 'stamp',
      label: 'Stamp',
      cursor: 'cursor-copy',
      shortcut: 's',
      onPointerDown(e, ctx) {
        if (e.button !== 0) return;
        const pageIndex = ctx.editorStore.currentPageIndex;
        const stampElement: StampElement = {
          id: `stamp-${Date.now()}`,
          kind: 'stamp',
          pageIndex,
          x: e.clientX,
          y: e.clientY,
          width: 180,
          height: 50,
          rotation: -15,
          locked: false,
          visible: true,
          flipX: false,
          flipY: false,
          text: 'CONFIDENTIAL',
          color: '#DC2626',
          borderColor: '#DC2626',
        };
        void api.commands.execute(new AddElementCommand('Place Confidential Stamp', stampElement));
        api.tools.setActive('select');
      },
    });

    // 3. Listen for document lifecycle events
    api.events.on('document:loaded', (payload) => {
      // Document loaded event hook
      void payload;
    });

    // 4. Register custom export format
    api.exporters.register({
      id: 'watermarked-summary',
      label: 'Export Document Info',
      description: 'Exports document metadata and watermark summary',
      extension: '.json',
      mimeType: 'application/json',
      async export(ctx): Promise<void> {
        const metadata = {
          fileName: ctx.editorStore.fileName,
          pageCount: ctx.service.document.getPageCount(),
          exportedAt: new Date().toISOString(),
          watermarkStatus: 'ready',
        };
        const blob = new Blob([JSON.stringify(metadata, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${ctx.editorStore.fileName || 'document'}-info.json`;
        a.click();
        URL.revokeObjectURL(url);
      },
    });
  },

  deactivate(): void {
    // Teardown is automatically handled by PluginManager scoped registrations
  },
};
