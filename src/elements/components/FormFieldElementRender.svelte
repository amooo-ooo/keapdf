<script lang="ts">
  import type { FormFieldElement } from '../../stores/canvas-types';
  import type { ElementRenderProps } from '../../core/element-registry';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import { CheckSquare, Square, Circle, CheckCircle2, ChevronDown, PenTool, Paperclip, Lock } from 'lucide-svelte';
  import { getCssFontFamily } from '../../services/font-loader';
  import { isInspectorControlTarget } from '../../utils/text-range-utils';

  let {
    element,
    zoom = 1,
    selected: _selected = false,
    editing = false,
  }: ElementRenderProps<FormFieldElement> = $props();

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  let inputRef = $state<HTMLInputElement | null>(null);
  let editValue = $state('');

  $effect(() => {
    if (editing) {
      editValue = element.placeholder || element.value || element.label || '';
      queueMicrotask(() => {
        if (inputRef) {
          inputRef.focus();
          inputRef.select();
        }
      });
    }
  });

  function commitInlineEdit(): void {
    if (!editing) return;
    const updates: Partial<FormFieldElement> = {};
    if (element.variant === 'text-input' || element.variant === 'dropdown') {
      updates.value = editValue;
    } else {
      updates.label = editValue;
    }
    canvasActions.updateElementProperties(element.id, updates);
    if (canvasStore.editingElementId === element.id) {
      canvasStore.editingElementId = null;
    }
  }

  function handleBlur(e: FocusEvent): void {
    if (isInspectorControlTarget(e.relatedTarget)) {
      return;
    }
    commitInlineEdit();
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.stopPropagation();
      e.preventDefault();
      commitInlineEdit();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      if (canvasStore.editingElementId === element.id) {
        canvasStore.editingElementId = null;
      }
    }
  }

  const containerStyle = $derived.by(() => {
    const styles: string[] = [];
    if (element.backgroundColor) {
      styles.push(`background-color: ${element.backgroundColor}`);
    } else {
      styles.push('background-color: #ffffff');
    }
    if (element.borderColor) {
      styles.push(`border-color: ${element.borderColor}`);
    } else {
      styles.push('border-color: #d1d5db');
    }
    if (element.borderWidth !== undefined) {
      styles.push(`border-width: ${element.borderWidth}px`);
    } else {
      styles.push('border-width: 1px');
    }
    if (element.borderStyle) {
      styles.push(`border-style: ${element.borderStyle}`);
    } else {
      styles.push('border-style: solid');
    }
    if (element.borderRadius !== undefined) {
      styles.push(`border-radius: ${element.borderRadius}px`);
    } else {
      styles.push('border-radius: 4px');
    }
    if (element.fontSize) {
      styles.push(`font-size: ${element.fontSize}px`);
    } else {
      styles.push('font-size: 13px');
    }
    if (element.fontFamily) {
      styles.push(`font-family: ${getCssFontFamily(element.fontFamily)}`);
    }
    if (element.color) {
      styles.push(`color: ${element.color}`);
    } else {
      styles.push('color: #111827');
    }
    if (element.textAlign) {
      styles.push(`text-align: ${element.textAlign}`);
    }
    return styles.join('; ');
  });

  const isChecked = $derived(element.value === 'true');
</script>

<div
  class="w-full h-full flex items-center px-1.5 overflow-hidden box-border select-none relative"
  style={containerStyle}
>
  {#if editing}
    <input
      bind:this={inputRef}
      type="text"
      bind:value={editValue}
      onblur={handleBlur}
      onkeydown={handleKeyDown}
      onpointerdown={(e) => e.stopPropagation()}
      onclick={(e) => e.stopPropagation()}
      ondblclick={(e) => e.stopPropagation()}
      class="w-full h-full bg-transparent outline-none border-none p-0 m-0 select-text cursor-text leading-none"
      style="
        font-size: {(element.fontSize || 13) * zoom}px;
        font-family: {element.fontFamily ? getCssFontFamily(element.fontFamily) : 'inherit'};
        color: {element.color || '#111827'};
        text-align: {element.textAlign || 'left'};
      "
    />
  {:else if element.variant === 'text-input'}
    <div class="w-full truncate leading-none">
      {#if element.value !== undefined && element.value !== ''}
        <span>{element.value}</span>
      {:else if element.placeholder}
        <span class="opacity-50 italic">{element.placeholder}</span>
      {:else}
        <span class="opacity-70">{element.label || 'Text Input'}</span>
      {/if}
      {#if element.required}
        <span class="text-red-500 font-bold ml-0.5 select-none">*</span>
      {/if}
    </div>
  {:else if element.variant === 'checkbox'}
    <div class="flex items-center w-full min-w-0">
      {#if isChecked}
        <CheckSquare class="w-4 h-4 mr-1.5 shrink-0 text-primary" />
      {:else}
        <Square class="w-4 h-4 mr-1.5 shrink-0 opacity-60" />
      {/if}
      <span class="truncate leading-none">{element.label || 'Checkbox'}</span>
      {#if element.required}
        <span class="text-red-500 font-bold ml-0.5 select-none">*</span>
      {/if}
    </div>
  {:else if element.variant === 'radio'}
    <div class="flex items-center w-full min-w-0">
      {#if isChecked}
        <CheckCircle2 class="w-4 h-4 mr-1.5 shrink-0 text-primary" />
      {:else}
        <Circle class="w-4 h-4 mr-1.5 shrink-0 opacity-60" />
      {/if}
      <span class="truncate leading-none">{element.label || 'Radio'}</span>
      {#if element.required}
        <span class="text-red-500 font-bold ml-0.5 select-none">*</span>
      {/if}
    </div>
  {:else if element.variant === 'dropdown'}
    <div class="w-full flex items-center justify-between min-w-0">
      <span class="truncate leading-none">
        {#if element.value}
          {element.value}
        {:else if element.placeholder}
          <span class="opacity-50 italic">{element.placeholder}</span>
        {:else}
          <span class="opacity-70">{element.label || 'Select option...'}</span>
        {/if}
        {#if element.required}
          <span class="text-red-500 font-bold ml-0.5 select-none">*</span>
        {/if}
      </span>
      <ChevronDown class="w-3.5 h-3.5 ml-1 shrink-0 opacity-70" />
    </div>
  {:else if element.variant === 'signature'}
    <div class="w-full h-full flex items-center justify-center relative min-w-0">
      <PenTool class="w-3.5 h-3.5 mr-1.5 shrink-0 opacity-60" />
      <span class="truncate leading-none italic font-serif opacity-80">{element.label || 'Signature'}</span>
      {#if element.required}
        <span class="text-red-500 font-bold ml-0.5 select-none">*</span>
      {/if}
    </div>
  {:else if element.variant === 'attachment'}
    <div class="flex items-center w-full min-w-0">
      <Paperclip class="w-3.5 h-3.5 mr-1.5 shrink-0 opacity-60" />
      <span class="truncate leading-none">{element.label || 'Attachment'}</span>
      {#if element.required}
        <span class="text-red-500 font-bold ml-0.5 select-none">*</span>
      {/if}
    </div>
  {:else}
    <div class="w-full truncate leading-none">
      <span>{element.label || 'Form Field'}</span>
      {#if element.required}
        <span class="text-red-500 font-bold ml-0.5 select-none">*</span>
      {/if}
    </div>
  {/if}

  {#if element.readOnly && !editing}
    <div class="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none">
      <Lock class="w-3 h-3 opacity-40" />
    </div>
  {/if}
</div>
