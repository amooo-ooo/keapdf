/**
 * Redaction markup tool for blacking out sensitive text and page regions.
 */

import type { ToolDefinition } from '../core/tool-registry';

export const redactTool: ToolDefinition = {
  id: 'redact',
  label: 'Redact',
  cursor: 'crosshair',
  shortcut: 'r',
  onActivate(ctx): void {
    ctx.canvasStore.selectElement(null);
  },
};
