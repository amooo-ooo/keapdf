/**
 * Freehand drawing and ink annotation tool.
 */

import type { ToolDefinition } from '../core/tool-registry';

export const penTool: ToolDefinition = {
  id: 'pen',
  label: 'Pen',
  cursor: 'crosshair',
  shortcut: 'p',
  onActivate(ctx): void {
    ctx.canvasStore.selectElement(null);
  },
};
