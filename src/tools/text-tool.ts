/**
 * Text editing and placement tool.
 */

import type { ToolDefinition } from '../core/tool-registry';

export const textTool: ToolDefinition = {
  id: 'text',
  label: 'Text',
  cursor: 'text',
  shortcut: 't',
  onActivate(_ctx): void {
    // Text tool ready for editing or placing new text spans
  },
};
