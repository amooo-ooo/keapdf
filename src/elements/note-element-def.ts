/**
 * Element definition for sticky note comments.
 */

import type { Component } from 'svelte';
import type { ElementDefinition, BurnContext, ElementRenderProps, ElementPanelProps } from '../core/element-registry';
import type { NoteElement } from '../stores/canvas-types';

export const noteElementDef: ElementDefinition<'note', NoteElement> = {
  kind: 'note',
  label: 'Sticky Note',
  defaults: { width: 140, height: 100 },

  /**
   * Create a new note element instance.
   *
   * @param id Unique element identifier.
   * @param pageIndex Target page zero-based index.
   * @param x Left edge position in PDF points.
   * @param y Top edge position in PDF points.
   * @param overrides Optional property overrides.
   * @return The initialized note element.
   */
  create(id: string, pageIndex: number, x: number, y: number, overrides?: Partial<NoteElement>): NoteElement {
    return {
      id,
      kind: 'note',
      pageIndex,
      x,
      y,
      width: 140,
      height: 100,
      rotation: 0,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
      author: '',
      text: '',
      color: '#FFEB3B',
      isOpen: false,
      ...overrides,
    };
  },

  component: null as unknown as Component<ElementRenderProps<NoteElement>>,
  propertiesPanel: null as unknown as Component<ElementPanelProps<NoteElement>>,

  /**
   * Serialize the note into a PDF text annotation.
   *
   * @param element The element to serialize.
   * @param ctx The burn context.
   */
  burn(element: NoteElement, ctx: BurnContext): void {
    ctx.page.addTextAnnotation({
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      author: element.author,
      contents: element.text,
      color: element.color,
    });
  }
};
