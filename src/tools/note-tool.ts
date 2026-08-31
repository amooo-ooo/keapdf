/**
 * Sticky note annotation placement tool.
 */

import type { ToolDefinition } from '../core/tool-registry';

export const noteTool: ToolDefinition = {
  id: 'note',
  label: 'Sticky Note',
  cursor: 'cell',
  shortcut: 'n',
  onActivate(ctx): void {
    ctx.canvasStore.selectElement(null);
  },
};
