/**
 * Text and area highlight annotation tool.
 */

import type { ToolDefinition } from '../core/tool-registry';

export const highlightTool: ToolDefinition = {
  id: 'highlight',
  label: 'Highlight',
  cursor: 'crosshair',
  shortcut: 'shift+h',
  onActivate(ctx): void {
    ctx.canvasStore.selectElement(null);
  },
};
