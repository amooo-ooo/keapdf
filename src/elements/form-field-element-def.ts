/**
 * Element definition for interactive form fields.
 */

import type { Component } from 'svelte';
import type { ElementDefinition, BurnContext, ElementRenderProps, ElementPanelProps } from '../core/element-registry';
import type { FormFieldElement } from '../stores/canvas-types';

export const formFieldElementDef: ElementDefinition<'form-field', FormFieldElement> = {
  kind: 'form-field',
  label: 'Form Field',
  defaults: { width: 160, height: 28 },

  /**
   * Create a new form field element instance.
   *
   * @param id Unique element identifier.
   * @param pageIndex Target page zero-based index.
   * @param x Left edge position in PDF points.
   * @param y Top edge position in PDF points.
   * @param overrides Optional property overrides.
   * @return The initialized form field element.
   */
  create(id: string, pageIndex: number, x: number, y: number, overrides?: Partial<FormFieldElement>): FormFieldElement {
    return {
      id,
      kind: 'form-field',
      pageIndex,
      x,
      y,
      width: 160,
      height: 28,
      rotation: 0,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
      variant: 'text-input',
      label: 'Text Input',
      placeholder: 'Enter text',
      ...overrides,
    };
  },

  component: null as unknown as Component<ElementRenderProps<FormFieldElement>>,
  propertiesPanel: null as unknown as Component<ElementPanelProps<FormFieldElement>>,

  /**
   * Serialize the form field into PDFium page objects.
   *
   * @param element The element to serialize.
   * @param ctx The burn context.
   */
  burn(element: FormFieldElement, ctx: BurnContext): void {
    ctx.page.addAcroFormField({
      id: element.id,
      variant: element.variant,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      flipX: element.flipX,
      flipY: element.flipY,
      label: element.label,
      placeholder: element.placeholder,
    });
  }
};
