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
    let defaultLabel = variant
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    let defaultWidth = 160;
    let defaultHeight = 26;
    let defaultPlaceholder = 'Enter text...';
    let defaultBg = '#ffffff';
    let defaultBorderColor = '#d1d5db';
    let defaultBorderWidth = 1;
    let defaultBorderRadius = 4;
    let defaultSourceFieldName: string | undefined = undefined;
    let defaultOptions: string[] | undefined = undefined;
    let defaultValue: string | undefined = undefined;

    if (variant === 'radio') {
      defaultWidth = 140;
      defaultHeight = 24;
      defaultPlaceholder = '';
      defaultBg = 'transparent';
      defaultBorderColor = '#d1d5db';
      defaultBorderWidth = 1;
      defaultBorderRadius = 4;
      defaultSourceFieldName = 'radio_group_1';
      defaultOptions = ['option_1'];
      defaultValue = 'false';
    } else if (variant === 'checkbox') {
      defaultWidth = 140;
      defaultHeight = 24;
      defaultPlaceholder = '';
      defaultBg = 'transparent';
      defaultBorderColor = '#d1d5db';
      defaultBorderWidth = 1;
      defaultBorderRadius = 4;
      defaultValue = 'false';
    } else if (variant === 'dropdown') {
      defaultWidth = 160;
      defaultHeight = 26;
      defaultPlaceholder = 'Select option...';
      defaultOptions = ['Option 1', 'Option 2', 'Option 3'];
      defaultValue = 'Option 1';
    } else if (variant === 'signature') {
      defaultWidth = 180;
      defaultHeight = 48;
      defaultPlaceholder = 'Sign here';
      defaultBg = '#f8fafc';
      defaultBorderColor = '#94a3b8';
      defaultBorderWidth = 1;
      defaultBorderRadius = 4;
    } else if (variant === 'button') {
      defaultWidth = 120;
      defaultHeight = 30;
      defaultLabel = 'Button';
      defaultPlaceholder = '';
      defaultBg = '#f1f5f9';
      defaultBorderColor = '#cbd5e1';
      defaultBorderWidth = 1;
      defaultBorderRadius = 4;
    } else if (variant === 'attachment') {
      defaultWidth = 160;
      defaultHeight = 32;
      defaultPlaceholder = '';
    }

    return {
      id,
      kind: 'form-field',
      pageIndex,
      x,
      y,
      width: defaultWidth,
      height: defaultHeight,
      rotation: 0,
      locked: false,
      visible: true,
      flipX: false,
      flipY: false,
      variant,
      label: defaultLabel,
      placeholder: defaultPlaceholder,
      fontSize: 13,
      fontFamily: 'Helvetica',
      color: '#111827',
      backgroundColor: defaultBg,
      borderColor: defaultBorderColor,
      borderWidth: defaultBorderWidth,
      borderStyle: variant === 'signature' ? 'dashed' : 'solid',
      borderRadius: defaultBorderRadius,
      textAlign: variant === 'button' ? 'center' : 'left',
      required: false,
      readOnly: false,
      sourceFieldName: defaultSourceFieldName,
      options: defaultOptions,
      value: defaultValue,
      ...overrides,
    };
  },

  component: FormFieldElementRender as unknown as Component<ElementRenderProps<FormFieldElement>>,
  propertiesPanel: FormFieldSection as unknown as Component<ElementPanelProps<FormFieldElement>>,

  normalize(element: FormFieldElement): FormFieldElement {
    if (element.variant === 'signature') {
      return {
        ...element,
        width: Math.max(80, element.width),
        height: Math.max(28, element.height),
      };
    }
    if (element.variant === 'button') {
      return {
        ...element,
        width: Math.max(40, element.width),
        height: Math.max(20, element.height),
      };
    }
    const isButton = element.variant === 'radio' || element.variant === 'checkbox';
    const isCompact = isButton && (element.width <= 28 || element.width <= element.height * 1.2);
    if (isCompact) {
      const minDimension = Math.max(10, Math.min(element.width, element.height));
      return {
        ...element,
        width: Math.max(10, minDimension),
        height: Math.max(10, minDimension),
      };
    }
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
