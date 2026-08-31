/**
 * Built-in tool registrations and barrel export.
 */

import type { ToolRegistry } from '../core/tool-registry';
import { selectTool } from './select-tool';
import { handTool } from './hand-tool';
import { textTool } from './text-tool';
import { highlightTool } from './highlight-tool';
import { penTool } from './pen-tool';
import { redactTool } from './redact-tool';
import { noteTool } from './note-tool';
import { eraserTool } from './eraser-tool';

/**
 * Registers all standard built-in tools into the tool registry.
 *
 * @param registry The target tool registry instance.
 */
export function registerBuiltinTools(registry: ToolRegistry): void {
  registry.registerBuiltin(selectTool);
  registry.registerBuiltin(handTool);
  registry.registerBuiltin(textTool);
  registry.registerBuiltin(highlightTool);
  registry.registerBuiltin(penTool);
  registry.registerBuiltin(redactTool);
  registry.registerBuiltin(noteTool);
  registry.registerBuiltin(eraserTool);
}

export {
  selectTool,
  handTool,
  textTool,
  highlightTool,
  penTool,
  redactTool,
  noteTool,
  eraserTool,
};
