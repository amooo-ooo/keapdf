import { textElementDef } from './text-element-def';
import { imageElementDef } from './image-element-def';
import { shapeElementDef } from './shape-element-def';
import { formFieldElementDef } from './form-field-element-def';
import { pathElementDef } from './path-element-def';
import { noteElementDef } from './note-element-def';
import type { ElementRegistry } from '../core/element-registry';

/**
 * Registers all built-in elements with the provided registry.
 *
 * @param registry The element registry instance.
 */
export function registerBuiltinElements(registry: ElementRegistry): void {
  registry.register(textElementDef);
  registry.register(imageElementDef);
  registry.register(shapeElementDef);
  registry.register(formFieldElementDef);
  registry.register(pathElementDef);
  registry.register(noteElementDef);
}

export { textElementDef, imageElementDef, shapeElementDef, formFieldElementDef, pathElementDef, noteElementDef };
