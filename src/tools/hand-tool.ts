/**
 * Hand / Pan tool for navigating the document canvas viewport.
 */

import type { ToolDefinition } from '../core/tool-registry';

export const handTool: ToolDefinition = {
  id: 'hand',
  label: 'Hand',
  cursor: 'grab',
  shortcut: 'h',
  onActivate(ctx): void {
    ctx.canvasStore.selectElement(null);
    ctx.editorStore.clearSelection();
  },
};
