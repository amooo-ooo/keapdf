/**
 * Default selection and element manipulation tool.
 */

import type { ToolDefinition } from '../core/tool-registry';

export const selectTool: ToolDefinition = {
  id: 'select',
  label: 'Select',
  cursor: 'default',
  shortcut: 'v',
  onActivate(_ctx): void {
    // Normal selection mode active
  },
  onKeyDown(e, ctx): boolean {
    if (e.key === 'Escape') {
      if (ctx.canvasStore.selectedElementId) {
        ctx.canvasStore.selectElement(null);
        return true;
      }
    }
    return false;
  },
};
