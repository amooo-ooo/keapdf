/**
 * Eraser tool for deleting annotations across canvas and PDF layers.
 */

import type { ToolDefinition } from '../core/tool-registry';

export const eraserTool: ToolDefinition = {
  id: 'eraser',
  label: 'Eraser',
  cursor: 'crosshair',
  shortcut: 'e',
  onActivate(ctx): void {
    ctx.canvasStore.selectElement(null);
  },
};
