<script lang="ts">
  import type { FormFieldElement } from '../../stores/canvas-types';
  import type { ElementRenderProps } from '../../core/element-registry';
  import { useCanvasStore } from '../../stores/canvas.svelte';
  import { useCanvasActions } from '../../stores/canvas-actions';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { ChevronDown, Paperclip, Lock } from 'lucide-svelte';
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
  const editorStore = useEditorStore();

  let inputRef = $state<HTMLInputElement | null>(null);
  let textareaRef = $state<HTMLTextAreaElement | null>(null);
  let editValue = $state('');

  const isMultiline = $derived(
    element.variant === 'text-input' && (Boolean(element.multiline) || element.height >= 38 || Boolean(element.value?.includes('\n')))
  );

  $effect(() => {
    if (editing) {
      if (element.variant === 'text-input' || element.variant === 'dropdown') {
        editValue = element.value ?? '';
      } else if (element.variant === 'signature') {
        editValue = element.value || element.label || '';
      } else {
        editValue = element.label || '';
      }
      queueMicrotask(() => {
        if (textareaRef) {
          textareaRef.focus();
          textareaRef.select();
        } else if (inputRef) {
          inputRef.focus();
          inputRef.select();
        }
      });
    }
  });

  function commitInlineEdit(): void {
    if (!editing || editorStore.isReadOnly || !editorStore.canEditValues) return;
    const updates: Partial<FormFieldElement> = {};
    if (element.variant === 'text-input' || element.variant === 'dropdown') {
      updates.value = editValue;
    } else if (element.variant === 'signature') {
      if (element.value) {
        updates.value = editValue;
      } else {
        updates.label = editValue;
      }
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
      if (isMultiline) {
        if (e.ctrlKey || e.metaKey) {
          e.stopPropagation();
          e.preventDefault();
          commitInlineEdit();
        }
        return;
      }
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

  const isButtonField = $derived(element.variant === 'radio' || element.variant === 'checkbox');
  const isCompactButton = $derived(isButtonField && (element.width <= 28 || element.width <= element.height * 1.2));

  const isChecked = $derived.by(() => {
    const v = element.value;
    if ((v as unknown) === true || v === 'true' || v === 'checked' || v === '1' || v === 'yes') {
      return true;
    }
    if (element.variant === 'radio' && typeof v === 'string' && v !== '' && v !== 'false') {
      if (element.options && element.options.length > 0 && element.options.includes(v)) {
        return true;
      }
      if (element.label && v === element.label) {
        return true;
      }
    }
    return false;
  });

  const glyphBg = $derived(
    element.backgroundColor && element.backgroundColor !== 'transparent'
      ? element.backgroundColor
      : '#ffffff'
  );
  const glyphBorder = $derived(element.borderColor || '#d1d5db');
  const glyphBorderWidth = $derived(element.borderWidth !== undefined ? element.borderWidth : 1);
  const glyphBorderStyle = $derived(element.borderStyle || 'solid');

  const containerStyle = $derived.by(() => {
    const styles: string[] = [];
    if (isButtonField && !isCompactButton) {
      if (element.backgroundColor && element.backgroundColor !== 'transparent' && element.backgroundColor !== '#ffffff') {
        styles.push(`background-color: ${element.backgroundColor}`);
      }
      styles.push(`font-size: ${(element.fontSize || 13) * zoom}px`);
      if (element.fontFamily) {
        styles.push(`font-family: ${getCssFontFamily(element.fontFamily)}`);
      }
      if (element.color) {
        styles.push(`color: ${element.color}`);
      } else {
        styles.push('color: #111827');
      }
      return styles.join('; ');
    }

    if (element.variant === 'button') {
      styles.push(`background-color: ${element.backgroundColor || '#f1f5f9'}`);
      styles.push(`border-color: ${element.borderColor || '#94a3b8'}`);
      styles.push(`border-width: ${Math.max(1, Math.round((element.borderWidth !== undefined ? element.borderWidth : 1) * zoom))}px`);
      styles.push(`border-style: ${element.borderStyle || 'solid'}`);
      styles.push(`border-radius: ${Math.round((element.borderRadius !== undefined ? element.borderRadius : 3) * zoom)}px`);
      styles.push(`font-size: ${(element.fontSize || 13) * zoom}px`);
      if (element.fontFamily) {
        styles.push(`font-family: ${getCssFontFamily(element.fontFamily)}`);
      }
      styles.push(`color: ${element.color || '#0f172a'}`);
      styles.push('text-align: center');
      return styles.join('; ');
    }

    if (element.backgroundColor) {
      styles.push(`background-color: ${element.backgroundColor}`);
    } else {
      styles.push('background-color: #ffffff');
    }

    if (element.borderStyle === 'underline') {
      styles.push('border-top: none');
      styles.push('border-left: none');
      styles.push('border-right: none');
      styles.push('border-bottom-style: solid');
      styles.push(`border-bottom-color: ${element.borderColor || '#d1d5db'}`);
      styles.push(`border-bottom-width: ${Math.max(1, Math.round((element.borderWidth !== undefined ? element.borderWidth : 1) * zoom))}px`);
      styles.push('border-radius: 0');
    } else {
      if (element.borderColor) {
        styles.push(`border-color: ${element.borderColor}`);
      } else {
        styles.push('border-color: #d1d5db');
      }
      if (element.borderWidth !== undefined) {
        styles.push(`border-width: ${Math.max(1, Math.round(element.borderWidth * zoom))}px`);
      } else {
        styles.push(`border-width: ${Math.max(1, Math.round(1 * zoom))}px`);
      }
      if (element.borderStyle) {
        styles.push(`border-style: ${element.borderStyle}`);
      } else {
        styles.push('border-style: solid');
      }
      if (element.borderRadius !== undefined) {
        styles.push(`border-radius: ${Math.round(element.borderRadius * zoom)}px`);
      } else {
        styles.push(`border-radius: ${Math.round(4 * zoom)}px`);
      }
    }

    styles.push(`font-size: ${(element.fontSize || 13) * zoom}px`);
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

  const isFieldDisabled = $derived(
    Boolean(element.readOnly || editorStore.isReadOnly || !editorStore.canEditValues)
  );

  function handleGlyphClick(e: MouseEvent): void {
    e.stopPropagation();
    if (isFieldDisabled) return;
    if (element.variant === 'checkbox') {
      const nextVal = isChecked ? 'false' : 'true';
      canvasActions.updateElementProperties(element.id, { value: nextVal });
    } else if (element.variant === 'radio') {
      const activeOpt = element.options?.[0] || 'true';
      canvasActions.updateElementProperties(element.id, { value: activeOpt });
      const groupName = element.sourceFieldName || element.label;
      if (groupName) {
        for (const other of canvasStore.elements) {
          if (other.id !== element.id && other.kind === 'form-field' && (other as FormFieldElement).variant === 'radio') {
            const otherRadio = other as FormFieldElement;
            const otherGroup = otherRadio.sourceFieldName || otherRadio.label;
            if (otherGroup === groupName && otherRadio.pageIndex === element.pageIndex) {
              canvasActions.updateElementProperties(otherRadio.id, { value: 'false' });
            }
          }
        }
      }
    }
  }
</script>

<div
  class="w-full h-full flex items-center {isCompactButton ? 'justify-center p-0' : element.variant === 'dropdown' ? 'pl-1.5 pr-0' : isMultiline ? 'items-start p-1.5' : 'px-1.5'} overflow-hidden box-border select-none relative"
  style={containerStyle}
>
  {#if editing}
    {#if element.variant === 'radio'}
      <div class="flex items-center w-full h-full min-w-0">
        <div
          class="rounded-full shrink-0 flex items-center justify-center cursor-pointer transition-colors"
          style="
            width: {Math.max(12, Math.round(16 * zoom))}px;
            height: {Math.max(12, Math.round(16 * zoom))}px;
            background-color: {glyphBg};
            border: {Math.max(1, Math.round(glyphBorderWidth * zoom))}px {glyphBorderStyle} {glyphBorder};
          "
        >
          {#if isChecked}
            <div
              class="rounded-full shrink-0"
              style="
                width: {Math.max(6, Math.round(8 * zoom))}px;
                height: {Math.max(6, Math.round(8 * zoom))}px;
                background-color: {element.color || '#111827'};
              "
            ></div>
          {/if}
        </div>
        <input
          bind:this={inputRef}
          type="text"
          bind:value={editValue}
          placeholder="Option label..."
          disabled={isFieldDisabled}
          onblur={handleBlur}
          onkeydown={handleKeyDown}
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => e.stopPropagation()}
          ondblclick={(e) => e.stopPropagation()}
          class="flex-1 min-w-0 ml-2 bg-transparent outline-none border-b border-primary/50 p-0 m-0 select-text cursor-text leading-none disabled:cursor-not-allowed disabled:opacity-70"
          style="
            font-size: {(element.fontSize || 13) * zoom}px;
            font-family: {element.fontFamily ? getCssFontFamily(element.fontFamily) : 'inherit'};
            color: {element.color || '#111827'};
          "
        />
      </div>
    {:else if element.variant === 'checkbox'}
      <div class="flex items-center w-full h-full min-w-0">
        <div
          class="rounded-[2.5px] shrink-0 flex items-center justify-center transition-colors {isFieldDisabled ? 'cursor-default opacity-75' : 'cursor-pointer'}"
          style="
            width: {Math.max(12, Math.round(16 * zoom))}px;
            height: {Math.max(12, Math.round(16 * zoom))}px;
            background-color: {glyphBg};
            border: {Math.max(1, Math.round(glyphBorderWidth * zoom))}px {glyphBorderStyle} {glyphBorder};
          "
        >
          {#if isChecked}
            <svg
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              style="
                width: {Math.max(8, Math.round(11 * zoom))}px;
                height: {Math.max(8, Math.round(11 * zoom))}px;
                color: {element.color || 'var(--primary, #2563eb)'};
              "
            >
              <polyline points="2.5 7.5 5.5 10.5 11.5 3.5"></polyline>
            </svg>
          {/if}
        </div>
        <input
          bind:this={inputRef}
          type="text"
          bind:value={editValue}
          placeholder="Checkbox label..."
          disabled={isFieldDisabled}
          onblur={handleBlur}
          onkeydown={handleKeyDown}
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => e.stopPropagation()}
          ondblclick={(e) => e.stopPropagation()}
          class="flex-1 min-w-0 ml-2 bg-transparent outline-none border-b border-primary/50 p-0 m-0 select-text cursor-text leading-none disabled:cursor-not-allowed disabled:opacity-70"
          style="
            font-size: {(element.fontSize || 13) * zoom}px;
            font-family: {element.fontFamily ? getCssFontFamily(element.fontFamily) : 'inherit'};
            color: {element.color || '#111827'};
          "
        />
      </div>
    {:else if isMultiline}
      <textarea
        bind:this={textareaRef}
        bind:value={editValue}
        placeholder={element.placeholder || 'Enter text...'}
        disabled={isFieldDisabled}
        onblur={handleBlur}
        onkeydown={handleKeyDown}
        onpointerdown={(e) => e.stopPropagation()}
        onclick={(e) => e.stopPropagation()}
        ondblclick={(e) => e.stopPropagation()}
        class="w-full h-full bg-transparent outline-none border-none p-0 m-0 select-text cursor-text resize-none leading-normal disabled:cursor-not-allowed disabled:opacity-70"
        style="
          font-size: {(element.fontSize || 13) * zoom}px;
          font-family: {element.fontFamily ? getCssFontFamily(element.fontFamily) : 'inherit'};
          color: {element.color || '#111827'};
          text-align: {element.textAlign || 'left'};
        "
      ></textarea>
    {:else}
      <input
        bind:this={inputRef}
        type={element.password ? 'password' : 'text'}
        bind:value={editValue}
        placeholder={element.variant === 'signature' ? (element.placeholder || 'Sign here') : element.placeholder || 'Enter value...'}
        disabled={isFieldDisabled}
        onblur={handleBlur}
        onkeydown={handleKeyDown}
        onpointerdown={(e) => e.stopPropagation()}
        onclick={(e) => e.stopPropagation()}
        ondblclick={(e) => e.stopPropagation()}
        class="w-full h-full bg-transparent outline-none border-none p-0 m-0 select-text cursor-text leading-none disabled:cursor-not-allowed disabled:opacity-70 {element.variant === 'button' ? 'text-center' : ''}"
        style="
          font-size: {(element.fontSize || 13) * zoom}px;
          font-family: {element.fontFamily ? getCssFontFamily(element.fontFamily) : 'inherit'};
          color: {element.color || '#111827'};
          text-align: {element.variant === 'button' ? 'center' : (element.textAlign || 'left')};
        "
      />
    {/if}
  {:else if element.variant === 'radio'}
    {#if isCompactButton}
      <div
        class="rounded-full shrink-0 flex items-center justify-center transition-colors {isFieldDisabled ? 'cursor-default opacity-75' : 'cursor-pointer'}"
        style="
          width: {Math.max(10, Math.min(element.width, element.height) * zoom)}px;
          height: {Math.max(10, Math.min(element.width, element.height) * zoom)}px;
          background-color: {glyphBg};
          border: {Math.max(1, Math.round(glyphBorderWidth * zoom))}px {glyphBorderStyle} {glyphBorder};
        "
        onclick={handleGlyphClick}
        role="radio"
        aria-checked={isChecked}
        tabindex="0"
        onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleGlyphClick(e as unknown as MouseEvent); } }}
      >
        {#if isChecked}
          <div
            class="rounded-full shrink-0"
            style="
              width: {Math.max(5, Math.min(element.width, element.height) * 0.48 * zoom)}px;
              height: {Math.max(5, Math.min(element.width, element.height) * 0.48 * zoom)}px;
              background-color: {element.color || '#111827'};
            "
          ></div>
        {/if}
      </div>
    {:else}
      <div class="flex items-center w-full min-w-0">
        <div
          class="rounded-full shrink-0 flex items-center justify-center transition-colors {isFieldDisabled ? 'cursor-default opacity-75' : 'cursor-pointer'}"
          style="
            width: {Math.max(12, Math.round(16 * zoom))}px;
            height: {Math.max(12, Math.round(16 * zoom))}px;
            background-color: {glyphBg};
            border: {Math.max(1, Math.round(glyphBorderWidth * zoom))}px {glyphBorderStyle} {glyphBorder};
          "
          onclick={handleGlyphClick}
          role="radio"
          aria-checked={isChecked}
          tabindex="0"
          onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleGlyphClick(e as unknown as MouseEvent); } }}
        >
          {#if isChecked}
            <div
              class="rounded-full shrink-0"
              style="
                width: {Math.max(6, Math.round(8 * zoom))}px;
                height: {Math.max(6, Math.round(8 * zoom))}px;
                background-color: {element.color || '#111827'};
              "
            ></div>
          {/if}
        </div>
        <span class="truncate leading-none ml-2 select-none flex-1 min-w-0">{element.label || 'Radio'}</span>
        {#if element.required}
          <span class="text-red-500 font-bold ml-0.5 select-none">*</span>
        {/if}
      </div>
    {/if}
  {:else if element.variant === 'checkbox'}
    {#if isCompactButton}
      <div
        class="rounded-[2.5px] shrink-0 flex items-center justify-center transition-colors {isFieldDisabled ? 'cursor-default opacity-75' : 'cursor-pointer'}"
        style="
          width: {Math.max(10, Math.min(element.width, element.height) * zoom)}px;
          height: {Math.max(10, Math.min(element.width, element.height) * zoom)}px;
          background-color: {glyphBg};
          border: {Math.max(1, Math.round(glyphBorderWidth * zoom))}px {glyphBorderStyle} {glyphBorder};
        "
        onclick={handleGlyphClick}
        role="checkbox"
        aria-checked={isChecked}
        tabindex="0"
        onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleGlyphClick(e as unknown as MouseEvent); } }}
      >
        {#if isChecked}
          <svg
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="
              width: {Math.max(7, Math.min(element.width, element.height) * 0.65 * zoom)}px;
              height: {Math.max(7, Math.min(element.width, element.height) * 0.65 * zoom)}px;
              color: {element.color || 'var(--primary, #2563eb)'};
            "
          >
            <polyline points="2.5 7.5 5.5 10.5 11.5 3.5"></polyline>
          </svg>
        {/if}
      </div>
    {:else}
      <div class="flex items-center w-full min-w-0">
        <div
          class="rounded-[2.5px] shrink-0 flex items-center justify-center transition-colors {isFieldDisabled ? 'cursor-default opacity-75' : 'cursor-pointer'}"
          style="
            width: {Math.max(12, Math.round(16 * zoom))}px;
            height: {Math.max(12, Math.round(16 * zoom))}px;
            background-color: {glyphBg};
            border: {Math.max(1, Math.round(glyphBorderWidth * zoom))}px {glyphBorderStyle} {glyphBorder};
          "
          onclick={handleGlyphClick}
          role="checkbox"
          aria-checked={isChecked}
          tabindex="0"
          onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleGlyphClick(e as unknown as MouseEvent); } }}
        >
          {#if isChecked}
            <svg
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              style="
                width: {Math.max(8, Math.round(11 * zoom))}px;
                height: {Math.max(8, Math.round(11 * zoom))}px;
                color: {element.color || 'var(--primary, #2563eb)'};
              "
            >
              <polyline points="2.5 7.5 5.5 10.5 11.5 3.5"></polyline>
            </svg>
          {/if}
        </div>
        <span class="truncate leading-none ml-2 select-none flex-1 min-w-0">{element.label || 'Checkbox'}</span>
        {#if element.required}
          <span class="text-red-500 font-bold ml-0.5 select-none">*</span>
        {/if}
      </div>
    {/if}
  {:else if element.variant === 'text-input'}
    <div class="w-full {isMultiline ? 'h-full whitespace-pre-wrap leading-normal break-words overflow-hidden' : 'truncate leading-none'}">
      {#if element.value !== undefined && element.value !== ''}
        <span>{element.password ? '*'.repeat(element.value.length) : element.value}</span>
      {:else if element.placeholder}
        <span class="opacity-40 italic">{element.placeholder}</span>
      {/if}
      {#if element.required}
        <span class="text-red-500 font-bold ml-0.5 select-none">*</span>
      {/if}
    </div>
  {:else if element.variant === 'dropdown'}
    <div class="w-full h-full flex items-center justify-between min-w-0">
      <span class="truncate leading-none flex-1 min-w-0 pr-1">
        {#if element.value}
          {element.value}
        {:else if element.placeholder}
          <span class="opacity-50 italic">{element.placeholder}</span>
        {:else}
          <span class="opacity-70">{element.options && element.options[0] ? element.options[0] : (element.label || 'Select option...')}</span>
        {/if}
        {#if element.required}
          <span class="text-red-500 font-bold ml-0.5 select-none">*</span>
        {/if}
      </span>
      <div class="h-full flex items-center justify-center px-1.5 shrink-0 border-l border-slate-300 dark:border-slate-600 bg-slate-100/70 dark:bg-slate-800/70">
        <ChevronDown class="w-3.5 h-3.5 opacity-70" />
      </div>
    </div>
  {:else if element.variant === 'signature'}
    {#if element.value}
      <div class="w-full h-full flex items-center justify-center p-1 relative min-w-0">
        {#if element.value.startsWith('data:image/')}
          <img
            src={element.value}
            alt="Signature"
            class="max-w-full max-h-full object-contain pointer-events-none select-none"
          />
        {:else}
          <div class="flex items-center gap-1.5 truncate">
            <span class="font-serif italic text-base select-none truncate text-primary">{element.value}</span>
            <svg class="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M2 6l3 3 5-5"/>
            </svg>
            <span class="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium shrink-0">Signed</span>
          </div>
        {/if}
      </div>
    {:else}
      <div class="w-full h-full flex items-center justify-between relative min-w-0 px-1">
        <div class="flex items-center gap-1.5 min-w-0">
          <div class="bg-red-600 text-white text-[9px] font-semibold px-1 py-0.5 rounded-[2px] shrink-0 leading-none shadow-xs">
            Sign
          </div>
          <span class="text-red-600 font-bold text-xs select-none shrink-0 leading-none">X</span>
          <span class="truncate leading-none italic text-xs text-muted-foreground select-none">
            {element.placeholder || element.label || 'Sign here'}
          </span>
        </div>
        {#if element.required}
          <span class="text-red-500 font-bold ml-0.5 select-none shrink-0">*</span>
        {/if}
      </div>
    {/if}
  {:else if element.variant === 'button'}
    <div class="w-full h-full flex items-center justify-center font-medium select-none truncate px-1 text-center leading-none">
      <span>{element.label || 'Button'}</span>
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

  {#if (element.readOnly || editorStore.isReadOnly) && !editing}
    <div class="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none">
      <Lock class="w-3 h-3 opacity-40" />
    </div>
  {/if}
</div>
