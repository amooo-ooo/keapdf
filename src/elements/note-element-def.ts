/**
 * Element definition for sticky note comments.
 */

import type { Component } from 'svelte';
import type { ElementDefinition, ElementRenderProps, ElementPanelProps, BurnContext } from '../core/element-registry';
import type { NoteElement } from '../stores/canvas-types';
import NoteElementRender from './components/NoteElementRender.svelte';
import NoteSection from '../components/panels/element-properties/NoteSection.svelte';

export const noteElementDef: ElementDefinition<'note', NoteElement> = {
  kind: 'note',
  label: 'Sticky Note',
  defaults: { width: 140, height: 100 },

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

  component: NoteElementRender as unknown as Component<ElementRenderProps<NoteElement>>,
  propertiesPanel: NoteSection as unknown as Component<ElementPanelProps<NoteElement>>,

  normalize(element: NoteElement): NoteElement {
    return {
      ...element,
      width: Math.max(80, element.width),
      height: Math.max(50, element.height),
    };
  },

  hitTest(element: NoteElement, point: { x: number; y: number }): boolean {
    return point.x >= 0 && point.x <= element.width && point.y >= 0 && point.y <= element.height;
  },

  /**
   * Serialize the note into a PDF text annotation.
   *
   * @param element The element to serialize.
   * @param ctx The burn context.
   */
  burn(element: NoteElement, ctx: BurnContext): void {
    if (element.visible === false) return;
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
