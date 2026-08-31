/**
 * Element definition for interactive form fields.
 */

import type { Component } from 'svelte';
import type { ElementDefinition, ElementRenderProps, ElementPanelProps, BurnContext } from '../core/element-registry';
import type { FormFieldElement } from '../stores/canvas-types';
import FormFieldElementRender from './components/FormFieldElementRender.svelte';
import FormFieldSection from '../components/panels/element-properties/FormFieldSection.svelte';

export const formFieldElementDef: ElementDefinition<'form-field', FormFieldElement> = {
  kind: 'form-field',
  label: 'Form Field',
  defaults: { width: 160, height: 28 },

  create(id: string, pageIndex: number, x: number, y: number, overrides?: Partial<FormFieldElement>): FormFieldElement {
    const variant = overrides?.variant ?? 'text-input';
    const defaultLabel = variant
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

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
      variant,
      label: defaultLabel,
      placeholder: 'Enter text',
      fontSize: 13,
      fontFamily: 'Helvetica',
      color: '#111827',
      backgroundColor: '#ffffff',
      borderColor: '#d1d5db',
      borderWidth: 1,
      borderStyle: 'solid',
      borderRadius: 4,
      textAlign: 'left',
      required: false,
      readOnly: false,
      ...overrides,
    };
  },

  component: FormFieldElementRender as unknown as Component<ElementRenderProps<FormFieldElement>>,
  propertiesPanel: FormFieldSection as unknown as Component<ElementPanelProps<FormFieldElement>>,

  normalize(element: FormFieldElement): FormFieldElement {
    return {
      ...element,
      width: Math.max(20, element.width),
      height: Math.max(15, element.height),
    };
  },

  hitTest(element: FormFieldElement, point: { x: number; y: number }): boolean {
    return point.x >= 0 && point.x <= element.width && point.y >= 0 && point.y <= element.height;
  },

  /**
   * Serialize the form field into PDFium page objects.
   *
   * @param element The element to serialize.
   * @param ctx The burn context.
   */
  burn(element: FormFieldElement, ctx: BurnContext): void {
    if (element.visible === false) return;
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
      value: element.value,
      options: element.options,
      fontSize: element.fontSize,
      fontFamily: element.fontFamily,
      color: element.color,
      backgroundColor: element.backgroundColor,
      borderColor: element.borderColor,
      borderWidth: element.borderWidth,
      borderStyle: element.borderStyle,
      borderRadius: element.borderRadius,
      textAlign: element.textAlign,
      required: element.required,
      readOnly: element.readOnly,
      sourceFieldName: element.sourceFieldName,
    });
  }
};
