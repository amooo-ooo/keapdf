<script lang="ts">
  /**
   * Interactive AcroForm rendering layer for PDF pages.
   *
   * Provides browser-native interactive form filling for text fields,
   * checkboxes, radio buttons, dropdowns, and buttons, conforming to
   * Google Chromium PDFium viewer architecture with comb character spacing
   * and input rule enforcement.
   */

  import type { EditableFormFieldSpan } from '../../core/types';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { getCssFontFamily } from '../../services/font-loader';
  import { ChevronDown, Check, PenTool, Paperclip } from 'lucide-svelte';

  interface Props {
    pageIndex: number;
    scale?: number;
    visualScale?: number;
    fields: EditableFormFieldSpan[];
    canEditValues?: boolean;
    disabled?: boolean;
  }

  let {
    pageIndex,
    scale: propScale,
    visualScale,
    fields,
    canEditValues = true,
    disabled = false,
  }: Props = $props();

  const scale = $derived(propScale ?? visualScale ?? 1.0);

  const actions = useEditorActions();
  const store = useEditorStore();

  const activeFields = $derived(
    fields.filter((f) => !store.hiddenSpanIds.has(f.id))
  );

  function isFieldChecked(field: EditableFormFieldSpan): boolean {
    const v = field.value;
    if (field.variant === 'radio') {
      if (typeof v === 'string' && v !== '' && v !== 'false' && v !== 'Off') {
        if (field.exportValue !== undefined) {
          return v === field.exportValue;
        }
        if (field.options && field.options.includes(v)) {
          return true;
        }
        if (field.label && v === field.label) {
          return true;
        }
      }
      return v === true || v === 'true' || v === 'checked';
    }
    if (v === true || v === 'true' || v === 'checked' || v === '1' || v === 'yes') {
      return true;
    }
    return false;
  }

  function handleTextInput(field: EditableFormFieldSpan, val: string): void {
    if (!canEditValues || field.readOnly || disabled) return;
    const name = field.fieldName || field.fieldId || field.name || field.id;
    actions.updateFormFieldValue(pageIndex, name, val);
  }

  function handleCheckboxToggle(field: EditableFormFieldSpan): void {
    if (!canEditValues || field.readOnly || disabled) return;
    const current = isFieldChecked(field);
    const name = field.fieldName || field.fieldId || field.name || field.id;
    actions.updateFormFieldValue(pageIndex, name, !current);
  }

  function handleRadioSelect(field: EditableFormFieldSpan): void {
    if (!canEditValues || field.readOnly || disabled) return;
    const name = field.fieldName || field.fieldId || field.name || field.id;
    const optVal = field.exportValue || field.options?.[0] || field.label || 'true';
    actions.updateFormFieldValue(pageIndex, name, optVal, true);
  }

  function handleDropdownChange(field: EditableFormFieldSpan, val: string): void {
    if (!canEditValues || field.readOnly || disabled) return;
    const name = field.fieldName || field.fieldId || field.name || field.id;
    actions.updateFormFieldValue(pageIndex, name, val);
  }

  function formatTranslucentColor(rgbStr?: string): string | undefined {
    if (!rgbStr) return undefined;
    if (rgbStr.startsWith('rgb(') && rgbStr.endsWith(')')) {
      return rgbStr.replace('rgb(', 'rgba(').replace(')', ', 0.35)');
    }
    return rgbStr;
  }
</script>

<div
  class="pdf-form-layer absolute inset-0 pointer-events-none z-[15]"
  data-pdf-form-layer="true"
  data-page-index={pageIndex}
>
  {#each activeFields as field (field.id)}
    {@const isMultiline = field.variant === 'text-input' && (field.multiline !== undefined ? field.multiline : (field.height >= 38 || Boolean(typeof field.value === 'string' && field.value.includes('\n'))))}
    {@const isReadOnly = Boolean(field.readOnly || !canEditValues || disabled)}
    {@const isChecked = isFieldChecked(field)}
    {@const isComb = Boolean(field.isComb && field.maxLength && field.maxLength > 1 && !isMultiline)}
    {@const combCellWidth = isComb && field.maxLength ? (field.width * scale) / field.maxLength : 0}
    {@const autoFontSize = isMultiline
      ? Math.min(12, Math.max(8, field.height * 0.55))
      : Math.min(12, Math.max(7, Math.round(field.height * 0.72)))}
    {@const resolvedFontSize = (field.fontSize && field.fontSize > 0 ? field.fontSize : autoFontSize) * scale}
    {@const padX = Math.max(1, Math.round(2 * scale))}

    <div
      class="pdf-form-field-wrapper absolute pointer-events-auto box-border transition-colors group {isReadOnly ? 'cursor-default' : 'cursor-pointer'}"
      role="presentation"
      onclick={(e) => { e.stopPropagation(); store.setActiveFormField(field); }}
      onkeydown={(e) => e.stopPropagation()}
      onpointerdown={(e) => e.stopPropagation()}
      onmousedown={(e) => e.stopPropagation()}
      style="
        left: {(field.left * scale).toFixed(2)}px;
        top: {(field.top * scale).toFixed(2)}px;
        width: {(field.width * scale).toFixed(2)}px;
        height: {(field.height * scale).toFixed(2)}px;
        {field.rotation ? `transform: rotate(${field.rotation}deg); transform-origin: center;` : ''}
      "
    >
      {#if field.variant === 'text-input'}
        {#if isMultiline}
          <textarea
            value={typeof field.value === 'string' ? field.value : ''}
            placeholder={field.placeholder || ''}
            disabled={isReadOnly}
            readonly={isReadOnly}
            maxlength={field.maxLength}
            spellcheck={!field.doNotSpellCheck}
            aria-label={field.tooltip || field.label || field.fieldName || field.fieldId || 'Text field'}
            aria-required={field.required}
            tabindex={isReadOnly ? -1 : 0}
            onclick={(e) => { e.stopPropagation(); store.setActiveFormField(field); }}
            onpointerdown={(e) => e.stopPropagation()}
            onmousedown={(e) => e.stopPropagation()}
            onfocus={() => { store.setActiveFormField(field); }}
            oninput={(e) => handleTextInput(field, e.currentTarget.value)}
            class="w-full h-full resize-none outline-none border border-selection/35 bg-selection/[0.07] hover:bg-selection/[0.12] focus:bg-card focus:border-selection focus:ring-1 focus:ring-selection rounded-[2px] text-foreground selection:bg-selection/20 disabled:opacity-90 disabled:cursor-default box-border leading-tight transition-colors"
            style="
              font-size: {resolvedFontSize.toFixed(2)}px;
              padding: {padX}px;
              font-family: {getCssFontFamily(field.fontFamily || 'Helvetica')};
              text-align: {field.textAlign || 'left'};
              {field.backgroundColor ? `background-color: ${formatTranslucentColor(field.backgroundColor)};` : ''}
              {field.borderColor ? `border-color: ${field.borderColor};` : ''}
              {field.color ? `color: ${field.color};` : ''}
            "
          ></textarea>
        {:else}
          <input
            type={field.password ? 'password' : 'text'}
            value={typeof field.value === 'string' ? field.value : (field.value !== undefined ? String(field.value) : '')}
            placeholder={field.placeholder || ''}
            disabled={isReadOnly}
            readonly={isReadOnly}
            maxlength={field.maxLength}
            spellcheck={!field.doNotSpellCheck}
            aria-label={field.tooltip || field.label || field.fieldName || field.fieldId || 'Text field'}
            aria-required={field.required}
            tabindex={isReadOnly ? -1 : 0}
            onclick={(e) => { e.stopPropagation(); store.setActiveFormField(field); }}
            onpointerdown={(e) => e.stopPropagation()}
            onmousedown={(e) => e.stopPropagation()}
            onfocus={() => { store.setActiveFormField(field); }}
            class="w-full h-full outline-none border border-selection/35 bg-selection/[0.07] hover:bg-selection/[0.12] focus:bg-card focus:border-selection focus:ring-1 focus:ring-selection rounded-[2px] text-foreground selection:bg-selection/20 disabled:opacity-90 disabled:cursor-default box-border leading-none transition-colors"
            style="
              font-size: {resolvedFontSize.toFixed(2)}px;
              font-family: {isComb ? 'monospace' : getCssFontFamily(field.fontFamily || 'Helvetica')};
              text-align: {isComb ? 'left' : (field.textAlign || 'left')};
              padding-left: {isComb ? `calc(${combCellWidth.toFixed(2)}px / 2 - 0.45ch)` : `${padX}px`};
              padding-right: {isComb ? '0px' : `${padX}px`};
              {isComb ? `letter-spacing: calc(${combCellWidth.toFixed(2)}px - 1ch);` : ''}
              {field.backgroundColor ? `background-color: ${formatTranslucentColor(field.backgroundColor)};` : ''}
              {field.borderColor ? `border-color: ${field.borderColor};` : ''}
              {field.color ? `color: ${field.color};` : ''}
            "
          />
        {/if}
      {:else if field.variant === 'checkbox'}
        <button
          type="button"
          role="checkbox"
          aria-label={field.tooltip || field.label || field.fieldName || field.fieldId || 'Checkbox'}
          aria-checked={isChecked}
          aria-required={field.required}
          disabled={isReadOnly}
          tabindex={isReadOnly ? -1 : 0}
          onfocus={() => { store.setActiveFormField(field); }}
          onclick={(e) => { e.stopPropagation(); store.setActiveFormField(field); handleCheckboxToggle(field); }}
          onpointerdown={(e) => e.stopPropagation()}
          onmousedown={(e) => e.stopPropagation()}
          onkeydown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              handleCheckboxToggle(field);
            }
          }}
          class="w-full h-full flex items-center justify-center border border-selection/60 bg-selection/[0.07] hover:bg-selection/[0.14] focus:bg-card focus:outline-none focus:ring-2 focus:ring-selection rounded-[2px] p-0 transition-colors disabled:opacity-90 disabled:cursor-default"
          style="
            {field.backgroundColor ? `background-color: ${formatTranslucentColor(field.backgroundColor)};` : ''}
            {field.borderColor ? `border-color: ${field.borderColor};` : ''}
          "
        >
          {#if isChecked}
            <Check
              class="text-selection stroke-[3]"
              style="
                width: {Math.max(4, Math.round(Math.min(field.width, field.height) * scale * 0.72))}px;
                height: {Math.max(4, Math.round(Math.min(field.width, field.height) * scale * 0.72))}px;
                {field.color ? `color: ${field.color};` : ''}
              "
            />
          {/if}
        </button>
      {:else if field.variant === 'radio'}
        <button
          type="button"
          role="radio"
          aria-label={field.tooltip || field.label || field.fieldName || field.fieldId || 'Radio option'}
          aria-checked={isChecked}
          disabled={isReadOnly}
          tabindex={isReadOnly ? -1 : 0}
          onfocus={() => { store.setActiveFormField(field); }}
          onclick={(e) => { e.stopPropagation(); store.setActiveFormField(field); handleRadioSelect(field); }}
          onpointerdown={(e) => e.stopPropagation()}
          onmousedown={(e) => e.stopPropagation()}
          onkeydown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              handleRadioSelect(field);
            }
          }}
          class="w-full h-full flex items-center justify-center border border-selection/60 bg-selection/[0.07] hover:bg-selection/[0.14] focus:bg-card focus:outline-none focus:ring-2 focus:ring-selection rounded-full p-0 transition-colors disabled:opacity-90 disabled:cursor-default"
          style="
            {field.backgroundColor ? `background-color: ${formatTranslucentColor(field.backgroundColor)};` : ''}
            {field.borderColor ? `border-color: ${field.borderColor};` : ''}
          "
        >
          {#if isChecked}
            <div
              class="rounded-full bg-selection"
              style="
                width: {Math.max(3, Math.round(Math.min(field.width, field.height) * scale * 0.45))}px;
                height: {Math.max(3, Math.round(Math.min(field.width, field.height) * scale * 0.45))}px;
                {field.color ? `background-color: ${field.color};` : ''}
              "
            ></div>
          {/if}
        </button>
      {:else if field.variant === 'dropdown'}
        <div class="relative w-full h-full">
          <select
            value={typeof field.value === 'string' ? field.value : ''}
            disabled={isReadOnly}
            aria-label={field.tooltip || field.label || field.fieldName || field.fieldId || 'Dropdown'}
            tabindex={isReadOnly ? -1 : 0}
            onfocus={() => { store.setActiveFormField(field); }}
            onclick={(e) => { e.stopPropagation(); store.setActiveFormField(field); }}
            onpointerdown={(e) => e.stopPropagation()}
            onmousedown={(e) => e.stopPropagation()}
            onchange={(e) => handleDropdownChange(field, e.currentTarget.value)}
            class="w-full h-full appearance-none outline-none border border-selection/35 bg-selection/[0.07] hover:bg-selection/[0.12] focus:bg-card focus:border-selection focus:ring-1 focus:ring-selection rounded-[2px] text-foreground disabled:opacity-90 disabled:cursor-default box-border leading-none transition-colors"
            style="
              font-size: {resolvedFontSize.toFixed(2)}px;
              padding-left: {padX}px;
              padding-right: {Math.max(10, Math.round(14 * scale))}px;
              font-family: {getCssFontFamily(field.fontFamily || 'Helvetica')};
              {field.backgroundColor ? `background-color: ${formatTranslucentColor(field.backgroundColor)};` : ''}
              {field.borderColor ? `border-color: ${field.borderColor};` : ''}
              {field.color ? `color: ${field.color};` : ''}
            "
          >
            {#if field.placeholder}
              <option value="" disabled selected={!field.value}>{field.placeholder}</option>
            {/if}
            {#if field.options && field.options.length > 0}
              {#each field.options as opt}
                <option value={opt} selected={field.value === opt}>{opt}</option>
              {/each}
            {:else if field.value}
              <option value={String(field.value)} selected>{String(field.value)}</option>
            {/if}
          </select>
          <div
            class="absolute pointer-events-none text-selection/70 flex items-center justify-center"
            style="
              right: {Math.max(2, Math.round(3 * scale))}px;
              top: 50%;
              transform: translateY(-50%);
            "
          >
            <ChevronDown
              style="
                width: {Math.max(8, Math.min(14, Math.round(10 * scale)))}px;
                height: {Math.max(8, Math.min(14, Math.round(10 * scale)))}px;
              "
            />
          </div>
        </div>
      {:else if field.variant === 'signature'}
        <button
          type="button"
          aria-label={field.tooltip || field.label || field.fieldName || field.fieldId || 'Signature field'}
          class="w-full h-full border border-dashed border-selection/80 bg-selection/10 flex items-center justify-center px-1 rounded-[2px] cursor-pointer"
          onclick={(e) => { e.stopPropagation(); store.setActiveFormField(field); }}
          onpointerdown={(e) => e.stopPropagation()}
          onmousedown={(e) => e.stopPropagation()}
          onfocus={() => { store.setActiveFormField(field); }}
          style="
            {field.backgroundColor ? `background-color: ${formatTranslucentColor(field.backgroundColor)};` : ''}
            {field.borderColor ? `border-color: ${field.borderColor};` : ''}
          "
        >
          {#if field.value && typeof field.value === 'string' && field.value.startsWith('data:image/')}
            <img src={field.value} alt="Signature" class="max-w-full max-h-full object-contain pointer-events-none" />
          {:else if field.value}
            <span class="font-serif italic text-sm text-foreground truncate" title={String(field.value)}>{String(field.value)}</span>
          {:else}
            <div class="flex items-center gap-1 text-[11px] text-selection opacity-80">
              <PenTool class="w-3 h-3" />
              <span>{field.placeholder || 'Signature'}</span>
            </div>
          {/if}
        </button>
      {:else if field.variant === 'attachment'}
        <button
          type="button"
          aria-label={field.tooltip || field.label || field.fieldName || field.fieldId || 'Attachment field'}
          class="w-full h-full border border-selection/40 bg-selection/10 flex items-center px-1 text-[11px] text-foreground truncate cursor-pointer"
          onclick={(e) => { e.stopPropagation(); store.setActiveFormField(field); }}
          onpointerdown={(e) => e.stopPropagation()}
          onmousedown={(e) => e.stopPropagation()}
          onfocus={() => { store.setActiveFormField(field); }}
        >
          <Paperclip class="w-3 h-3 mr-1 shrink-0 opacity-70" />
          <span class="truncate" title={field.label || 'Attachment'}>{field.label || 'Attachment'}</span>
        </button>
      {:else}
        {#if field.label || (typeof field.value === 'string' && field.value)}
          <button
            type="button"
            disabled={isReadOnly}
            onfocus={() => { store.setActiveFormField(field); }}
            onclick={(e) => { e.stopPropagation(); store.setActiveFormField(field); }}
            onpointerdown={(e) => e.stopPropagation()}
            onmousedown={(e) => e.stopPropagation()}
            class="w-full h-full flex items-center justify-center border border-border bg-secondary hover:bg-muted rounded-[2px] font-medium text-foreground shadow-none"
            style="font-size: {Math.max(8, Math.round(11 * scale))}px;"
          >
            {field.label || (typeof field.value === 'string' ? field.value : '')}
          </button>
        {:else}
          <button
            type="button"
            disabled={isReadOnly}
            aria-label={field.tooltip || field.fieldName || field.fieldId || 'Action Button'}
            onfocus={() => { store.setActiveFormField(field); }}
            onclick={(e) => { e.stopPropagation(); store.setActiveFormField(field); }}
            onpointerdown={(e) => e.stopPropagation()}
            onmousedown={(e) => e.stopPropagation()}
            class="w-full h-full rounded-[2px] border-none bg-transparent hover:bg-selection/10 focus:outline-none focus:ring-1 focus:ring-selection shadow-none"
          ></button>
        {/if}
      {/if}
    </div>
  {/each}
</div>
