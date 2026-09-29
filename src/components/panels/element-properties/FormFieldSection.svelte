<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import { useEditorStore } from '../../../stores/editor.svelte';
  import type { FormFieldElement, FormFieldVariant } from '../../../stores/canvas-types';
  import type { ElementPanelProps } from '../../../core/element-registry';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button, ButtonGroup } from '$lib/components/ui/button/index.js';
  import { ColorPicker } from '$lib/components/ui/color-picker/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { ControlRow } from '$lib/components/ui/control-row/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { AlignLeft, AlignCenter, AlignRight, Lock } from 'lucide-svelte';
  import { extractBaseFontFamily } from '../../../services/pdf/font-charset-index';
  import { getDisplayFontName } from '../../../services/font-loader';
  import { setInspectorInteracting } from '../../../utils/text-range-utils';

  let { element }: ElementPanelProps<FormFieldElement> = $props();

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();
  const editorStore = useEditorStore();

  const isReadOnlyMode = $derived(editorStore.isReadOnly);

  const formEl = $derived(
    element ?? (canvasStore.selectedElement?.kind === 'form-field' ? (canvasStore.selectedElement as FormFieldElement) : null)
  );

  const STANDARD_FONTS = [
    { value: 'Helvetica', label: 'Inter (Sans-Serif)' },
    { value: 'Times-Roman', label: 'Times Roman (Serif)' },
    { value: 'Courier', label: 'Courier (Monospace)' },
    { value: 'Arial', label: 'Arial' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Roboto', label: 'Roboto' },
  ];

  const BORDER_STYLES = [
    { value: 'solid', label: 'Solid' },
    { value: 'dashed', label: 'Dashed' },
    { value: 'dotted', label: 'Dotted' },
    { value: 'inset', label: 'Inset' },
    { value: 'underline', label: 'Underline' },
    { value: 'none', label: 'None' },
  ];

  const FIELD_VARIANTS: { value: FormFieldVariant; label: string }[] = [
    { value: 'text-input', label: 'Text Input' },
    { value: 'checkbox', label: 'Checkbox' },
    { value: 'radio', label: 'Radio Button' },
    { value: 'dropdown', label: 'Dropdown' },
    { value: 'signature', label: 'Signature Field' },
    { value: 'button', label: 'Pushbutton' },
    { value: 'attachment', label: 'Attachment Field' },
  ];

  const TEXT_COLOR_SWATCHES = [
    { label: 'Dark', color: '#111827', bg: 'bg-slate-900', border: 'border-slate-950' },
    { label: 'Slate', color: '#4b5563', bg: 'bg-slate-600', border: 'border-slate-700' },
    { label: 'Blue', color: '#2563eb', bg: 'bg-blue-600', border: 'border-blue-700' },
    { label: 'Red', color: '#dc2626', bg: 'bg-red-600', border: 'border-red-700' },
  ];

  const BG_COLOR_SWATCHES = [
    { label: 'White', color: '#ffffff', bg: 'bg-white', border: 'border-slate-300' },
    { label: 'Grey', color: '#f3f4f6', bg: 'bg-slate-100', border: 'border-slate-300' },
    { label: 'Light Blue', color: '#eff6ff', bg: 'bg-blue-50', border: 'border-blue-200' },
    { label: 'Yellow', color: '#fefce8', bg: 'bg-yellow-50', border: 'border-yellow-200' },
  ];

  const BORDER_COLOR_SWATCHES = [
    { label: 'Light Grey', color: '#d1d5db', bg: 'bg-slate-300', border: 'border-slate-400' },
    { label: 'Dark Grey', color: '#4b5563', bg: 'bg-slate-600', border: 'border-slate-700' },
    { label: 'Blue', color: '#3b82f6', bg: 'bg-blue-500', border: 'border-blue-600' },
    { label: 'Red', color: '#ef4444', bg: 'bg-red-500', border: 'border-red-600' },
  ];

  function updateProp(propName: keyof FormFieldElement, value: unknown): void {
    if (isReadOnlyMode || !editorStore.canEditValues) return;
    const targetId = formEl?.id ?? canvasStore.selectedElementId;
    if (targetId) {
      canvasActions.updateElementProperties(targetId, { [propName]: value });
    }
  }

  function handleStringChange(e: Event, propName: keyof FormFieldElement): void {
    const target = e.target as HTMLInputElement;
    updateProp(propName, target.value);
  }

  function handleNumberChange(e: Event, propName: keyof FormFieldElement): void {
    const target = e.target as HTMLInputElement;
    const val = parseFloat(target.value);
    updateProp(propName, Number.isNaN(val) ? 0 : val);
  }

  let optionsText = $state('');
  let currentOptionsFormId = $state<string | null>(null);

  $effect(() => {
    if (formEl) {
      if (currentOptionsFormId !== formEl.id) {
         currentOptionsFormId = formEl.id;
         optionsText = formEl.options ? formEl.options.join(', ') : '';
      }
    }
  });

  function commitOptions(): void {
    const opts = optionsText.split(',').map(s => s.trim()).filter(Boolean);
    updateProp('options', opts);
  }
</script>

{#if formEl}
  <SidebarSection title="Field Properties" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-2">
      <!-- Variant -->
      <div class="flex flex-col gap-1">
        <Label class="field-label">Field Type</Label>
        <Select.Root
          type="single"
          value={formEl.variant}
          onValueChange={(val) => {
            if (val) updateProp('variant', val as FormFieldVariant);
          }}
        >
          <Select.Trigger class="h-8 text-xs w-full font-normal" disabled={isReadOnlyMode}>
            {FIELD_VARIANTS.find((v) => v.value === formEl.variant)?.label || formEl.variant}
          </Select.Trigger>
          <Select.Content>
            {#each FIELD_VARIANTS as item (item.value)}
              <Select.Item value={item.value} label={item.label}>
                {item.label}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      {#if formEl.variant === 'radio'}
        <!-- Radio Group Name -->
        <div class="flex flex-col gap-1">
          <Label class="field-label">Group Name</Label>
          <Input 
            type="text" 
            value={formEl.sourceFieldName ?? ''} 
            oninput={(e) => handleStringChange(e, 'sourceFieldName')}
            placeholder="e.g. radio_group_1"
            class="h-8 text-xs w-full" 
            disabled={isReadOnlyMode}
          />
          <span class="text-[10px] text-muted-foreground">Radio buttons sharing this group name are mutually exclusive.</span>
        </div>

        <!-- Option Label -->
        <div class="field-group-sm">
          <Label class="field-label">Option Label</Label>
          <Input 
            type="text" 
            value={formEl.label} 
            oninput={(e) => handleStringChange(e, 'label')}
            placeholder="e.g. Option 1"
            class="field-input w-full" 
            disabled={isReadOnlyMode}
          />
        </div>

        <!-- Export Value -->
        <div class="field-group-sm">
          <Label class="field-label">Export Value</Label>
          <Input 
            type="text" 
            value={formEl.options?.[0] ?? ''} 
            oninput={(e) => {
              const val = (e.target as HTMLInputElement).value;
              updateProp('options', val ? [val] : []);
            }}
            placeholder="e.g. option_1"
            class="field-input w-full" 
            disabled={isReadOnlyMode}
          />
        </div>

        <!-- Selected by Default -->
        <div class="pt-0.5">
          <ControlRow label="Selected by Default" size="sm">
            <Switch
              checked={formEl.value === 'true' || (Boolean(formEl.options?.[0]) && formEl.value === formEl.options?.[0])}
              disabled={formEl.readOnly || isReadOnlyMode || !editorStore.canEditValues}
              onCheckedChange={(checked) => {
                const activeVal = formEl.options?.[0] || 'true';
                updateProp('value', checked ? activeVal : 'false');
                if (checked && (formEl.sourceFieldName || formEl.label)) {
                  const groupName = formEl.sourceFieldName || formEl.label;
                  for (const other of canvasStore.elements) {
                    if (other.id !== formEl.id && other.kind === 'form-field' && (other as FormFieldElement).variant === 'radio') {
                      const otherRadio = other as FormFieldElement;
                      if ((otherRadio.sourceFieldName || otherRadio.label) === groupName && otherRadio.pageIndex === formEl.pageIndex) {
                        canvasActions.updateElementProperties(otherRadio.id, { value: 'false' });
                      }
                    }
                  }
                }
              }}
              aria-label="Selected by Default"
            />
          </ControlRow>
        </div>

      {:else if formEl.variant === 'checkbox'}
        <!-- Checkbox Label -->
        <div class="field-group-sm">
          <Label class="field-label">Field Name / Label</Label>
          <Input 
            type="text" 
            value={formEl.label} 
            oninput={(e) => handleStringChange(e, 'label')}
            class="field-input w-full" 
            disabled={isReadOnlyMode}
          />
        </div>

        <!-- Checked by Default -->
        <div class="pt-0.5">
          <ControlRow label="Checked by Default" size="sm">
            <Switch
              checked={formEl.value === 'true' || (formEl.value as unknown) === true || formEl.value === 'checked' || formEl.value === '1' || formEl.value === 'yes'}
              disabled={formEl.readOnly || isReadOnlyMode || !editorStore.canEditValues}
              onCheckedChange={(checked) => updateProp('value', checked ? 'true' : 'false')}
              aria-label="Checked by Default"
            />
          </ControlRow>
        </div>

      {:else if formEl.variant === 'dropdown'}
        <!-- Dropdown Label -->
        <div class="field-group-sm">
          <Label class="field-label">Field Name / Label</Label>
          <Input 
            type="text" 
            value={formEl.label} 
            oninput={(e) => handleStringChange(e, 'label')}
            class="field-input w-full" 
            disabled={isReadOnlyMode}
          />
        </div>

        <!-- Dropdown Options -->
        <div class="field-group-sm">
          <Label class="field-label">Options (comma separated)</Label>
          <Input 
            type="text" 
            value={optionsText} 
            oninput={(e) => { optionsText = (e.target as HTMLInputElement).value; }}
            onblur={commitOptions}
            onkeydown={(e) => { if (e.key === 'Enter') commitOptions(); }}
            placeholder="Option 1, Option 2, Option 3..."
            class="field-input w-full" 
            disabled={isReadOnlyMode}
          />
        </div>

        <!-- Default Selected Value -->
        <div class="field-group-sm">
          <Label class="field-label">Default Selected Value</Label>
          <Input 
            type="text" 
            value={formEl.value ?? ''} 
            oninput={(e) => handleStringChange(e, 'value')}
            placeholder="Initial selected value..."
            class="field-input w-full" 
            disabled={formEl.readOnly || isReadOnlyMode || !editorStore.canEditValues}
          />
        </div>

        <!-- Placeholder -->
        <div class="field-group-sm">
          <Label class="field-label">Placeholder</Label>
          <Input 
            type="text" 
            value={formEl.placeholder ?? ''} 
            oninput={(e) => handleStringChange(e, 'placeholder')}
            class="field-input w-full" 
            disabled={isReadOnlyMode}
          />
        </div>

      {:else if formEl.variant === 'text-input'}
        <!-- Text Input Label -->
        <div class="field-group-sm">
          <Label class="field-label">Field Name / Label</Label>
          <Input 
            type="text" 
            value={formEl.label} 
            oninput={(e) => handleStringChange(e, 'label')}
            class="field-input w-full" 
            disabled={isReadOnlyMode}
          />
        </div>

        <!-- Initial Value -->
        <div class="field-group-sm">
          <Label class="field-label">Field Value</Label>
          <Input 
            type="text" 
            value={formEl.value ?? ''} 
            oninput={(e) => handleStringChange(e, 'value')}
            placeholder="Initial or current value..."
            class="field-input w-full" 
            disabled={formEl.readOnly || isReadOnlyMode || !editorStore.canEditValues}
          />
        </div>

        <!-- Placeholder -->
        <div class="field-group-sm">
          <Label class="field-label">Placeholder</Label>
          <Input 
            type="text" 
            value={formEl.placeholder ?? ''} 
            oninput={(e) => handleStringChange(e, 'placeholder')}
            class="field-input w-full" 
            disabled={isReadOnlyMode}
          />
        </div>

        <!-- Multiline Text -->
        <div class="pt-0.5">
          <ControlRow label="Multiline Text" size="sm">
            <Switch
              checked={Boolean(formEl.multiline)}
              disabled={isReadOnlyMode}
              onCheckedChange={(checked) => updateProp('multiline', checked)}
              aria-label="Multiline Text"
            />
          </ControlRow>
        </div>

        <!-- Password Field -->
        <div class="pt-0.5">
          <ControlRow label="Password Field" size="sm">
            <Switch
              checked={Boolean(formEl.password)}
              disabled={isReadOnlyMode}
              onCheckedChange={(checked) => updateProp('password', checked)}
              aria-label="Password Field"
            />
          </ControlRow>
        </div>

      {:else if formEl.variant === 'signature'}
        <!-- Signature Field Name -->
        <div class="field-group-sm">
          <Label class="field-label">Field Name</Label>
          <Input 
            type="text" 
            value={formEl.sourceFieldName || formEl.label} 
            oninput={(e) => handleStringChange(e, 'sourceFieldName')}
            placeholder="e.g. Signature1"
            class="field-input w-full" 
            disabled={isReadOnlyMode}
          />
        </div>

        <!-- Signer Prompt -->
        <div class="field-group-sm">
          <Label class="field-label">Signer Prompt</Label>
          <Input 
            type="text" 
            value={formEl.placeholder || formEl.label || ''} 
            oninput={(e) => {
              handleStringChange(e, 'placeholder');
              handleStringChange(e, 'label');
            }}
            placeholder="e.g. Sign here"
            class="field-input w-full" 
            disabled={isReadOnlyMode}
          />
        </div>

      {:else if formEl.variant === 'button'}
        <!-- Button Label -->
        <div class="field-group-sm">
          <Label class="field-label">Button Label</Label>
          <Input 
            type="text" 
            value={formEl.label} 
            oninput={(e) => handleStringChange(e, 'label')}
            placeholder="e.g. Submit"
            class="field-input w-full" 
            disabled={isReadOnlyMode}
          />
        </div>

        <!-- Button Field Name -->
        <div class="field-group-sm">
          <Label class="field-label">Field Name</Label>
          <Input 
            type="text" 
            value={formEl.sourceFieldName ?? ''} 
            oninput={(e) => handleStringChange(e, 'sourceFieldName')}
            placeholder="e.g. btn_submit"
            class="field-input w-full" 
            disabled={isReadOnlyMode}
          />
        </div>

      {:else}
        <!-- Attachment Field -->
        <div class="field-group-sm">
          <Label class="field-label">Field Name / Label</Label>
          <Input 
            type="text" 
            value={formEl.label} 
            oninput={(e) => handleStringChange(e, 'label')}
            class="field-input w-full" 
            disabled={isReadOnlyMode}
          />
        </div>
      {/if}
    </div>
  </SidebarSection>

  <!-- Typography Styling -->
  <SidebarSection title="Typography" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-2">
      <!-- Font Family -->
      <div class="flex flex-col gap-1">
        <Label class="field-label">Font Family</Label>
        <Select.Root
          type="single"
          value={formEl.fontFamily || 'Helvetica'}
          onValueChange={(val) => {
            if (val) updateProp('fontFamily', val);
          }}
        >
          <Select.Trigger class="h-8 text-xs w-full font-normal" disabled={isReadOnlyMode}>
            {getDisplayFontName(formEl.fontFamily || 'Helvetica', extractBaseFontFamily)}
          </Select.Trigger>
          <Select.Content>
            {#each STANDARD_FONTS as item (item.value)}
              <Select.Item value={item.value} label={item.label}>
                {item.label}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <!-- Font Size & Text Colour -->
      <div class="flex items-end gap-2 mt-0.5 w-full">
        <div class="flex flex-col gap-1 w-[80px] shrink-0">
          <Label class="field-label">Size (pt)</Label>
          <Input 
            type="number" 
            value={formEl.fontSize ?? 13} 
            oninput={(e) => handleNumberChange(e, 'fontSize')}
            class="field-input w-full" 
            min="6"
            max="72"
            disabled={isReadOnlyMode}
          />
        </div>

        <div class="flex flex-col gap-1 flex-1 min-w-0">
          <Label class="field-label">Colour</Label>
          <ColorPicker
            value={formEl.color || '#111827'}
            presets={TEXT_COLOR_SWATCHES}
            disabled={isReadOnlyMode}
            onValueChange={(c) => updateProp('color', c)}
            onInteractingChange={setInspectorInteracting}
          />
        </div>
      </div>

      <!-- Alignment -->
      <div class="flex flex-col gap-1 mt-0.5">
        <Label class="field-label">Alignment</Label>
        <ButtonGroup variant="outline" size="sm" class="h-8 w-full">
          <Button
            variant={(formEl.textAlign || 'left') === 'left' ? 'default' : 'outline'}
            size="sm"
            class="flex-1 h-8 p-0"
            disabled={isReadOnlyMode}
            onclick={() => updateProp('textAlign', 'left')}
            title="Align Left"
            aria-label="Align Left"
            aria-pressed={(formEl.textAlign || 'left') === 'left'}
          >
            <AlignLeft class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={formEl.textAlign === 'center' ? 'default' : 'outline'}
            size="sm"
            class="flex-1 h-8 p-0"
            disabled={isReadOnlyMode}
            onclick={() => updateProp('textAlign', 'center')}
            title="Align Center"
            aria-label="Align Center"
            aria-pressed={formEl.textAlign === 'center'}
          >
            <AlignCenter class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={formEl.textAlign === 'right' ? 'default' : 'outline'}
            size="sm"
            class="flex-1 h-8 p-0"
            disabled={isReadOnlyMode}
            onclick={() => updateProp('textAlign', 'right')}
            title="Align Right"
            aria-label="Align Right"
            aria-pressed={formEl.textAlign === 'right'}
          >
            <AlignRight class="h-3.5 w-3.5" />
          </Button>
        </ButtonGroup>
      </div>
    </div>
  </SidebarSection>

  <!-- Appearance Styling -->
  <SidebarSection title="Appearance" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-2">
      <!-- Background Colour & Presets -->
      <div class="flex flex-col gap-1 mt-0.5 w-full">
        <Label class="field-label">Background</Label>
        <ColorPicker
          value={formEl.backgroundColor || '#ffffff'}
          presets={BG_COLOR_SWATCHES}
          allowNone={true}
          noneValue="transparent"
          disabled={isReadOnlyMode}
          onValueChange={(c) => updateProp('backgroundColor', c)}
          onInteractingChange={setInspectorInteracting}
        />
      </div>

      <!-- Border Colour & Presets -->
      <div class="flex flex-col gap-1 mt-0.5 w-full">
        <Label class="field-label">Border Colour</Label>
        <ColorPicker
          value={formEl.borderColor || '#d1d5db'}
          presets={BORDER_COLOR_SWATCHES}
          allowNone={true}
          noneValue="transparent"
          disabled={isReadOnlyMode}
          onValueChange={(c) => updateProp('borderColor', c)}
          onInteractingChange={setInspectorInteracting}
        />
      </div>

      <!-- Border Width & Border Radius -->
      <div class="field-grid-2 mt-0.5">
        <div class="field-group-sm">
          <Label class="field-label">Border Width (pt)</Label>
          <Input 
            type="number" 
            value={formEl.borderWidth ?? 1} 
            oninput={(e) => handleNumberChange(e, 'borderWidth')}
            class="field-input w-full" 
            min="0"
            max="12"
            disabled={isReadOnlyMode}
          />
        </div>
        <div class="field-group-sm">
          <Label class="field-label">Corner Radius (px)</Label>
          <Input 
            type="number" 
            value={formEl.borderRadius ?? 4} 
            oninput={(e) => handleNumberChange(e, 'borderRadius')}
            class="field-input w-full" 
            min="0"
            max="24"
            disabled={isReadOnlyMode}
          />
        </div>
      </div>

      <!-- Border Style -->
      <div class="flex flex-col gap-1 mt-0.5">
        <Label class="field-label">Border Style</Label>
        <Select.Root
          type="single"
          value={formEl.borderStyle || 'solid'}
          onValueChange={(val) => {
            if (val) updateProp('borderStyle', val as FormFieldElement['borderStyle']);
          }}
        >
          <Select.Trigger class="h-8 text-xs w-full font-normal" disabled={isReadOnlyMode}>
            {BORDER_STYLES.find((s) => s.value === (formEl.borderStyle || 'solid'))?.label || 'Solid'}
          </Select.Trigger>
          <Select.Content>
            {#each BORDER_STYLES as item (item.value)}
              <Select.Item value={item.value} label={item.label}>
                {item.label}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </div>
  </SidebarSection>

  <!-- Validation & Flags -->
  <SidebarSection title="Validation & State" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-1.5 pt-0.5">
      <ControlRow label="Required Field" size="sm">
        <Switch
          checked={Boolean(formEl.required)}
          disabled={isReadOnlyMode}
          onCheckedChange={(checked) => updateProp('required', checked)}
          aria-label="Required Field"
        />
      </ControlRow>
      <ControlRow label="Read Only" size="sm">
        {#snippet labelSnippet()}
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="text-xs font-medium text-foreground/90 truncate">Read Only</span>
            <Lock class="w-3 h-3 {formEl.readOnly ? 'text-primary' : 'text-muted-foreground opacity-50'}" />
          </div>
        {/snippet}
        <Switch
          checked={Boolean(formEl.readOnly)}
          disabled={isReadOnlyMode}
          onCheckedChange={(checked) => updateProp('readOnly', checked)}
          aria-label="Read Only"
        />
      </ControlRow>
    </div>
  </SidebarSection>
{/if}
