<script lang="ts">
  /**
   * Form Field Rules & Inspection Section for the Right Properties Panel.
   *
   * Displays ISO 32000-1 / ISO 32000-2 AcroForm field specifications,
   * enforced input rules (maximum length, comb cell distribution, required status,
   * read-only constraints, password masking), appearance attributes, and live values.
   */

  import { useEditorStore } from '../../../stores/editor.svelte';
  import { useEditorActions } from '../../../stores/editor-actions';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Lock, Asterisk } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

  const activeField = $derived(store.activeFormField);

  function getVariantLabel(variant?: string, isComb?: boolean): string {
    if (isComb) return 'Comb Text Field';
    switch (variant) {
      case 'text-input':
        return 'Text Field';
      case 'checkbox':
        return 'Checkbox';
      case 'radio':
        return 'Radio Button';
      case 'dropdown':
        return 'Dropdown Selection';
      case 'signature':
        return 'Digital Signature';
      case 'button':
        return 'Pushbutton';
      case 'attachment':
        return 'File Attachment';
      default:
        return 'Form Control';
    }
  }

  function handleValueChange(val: string): void {
    if (!activeField) return;
    const name = activeField.fieldName || activeField.fieldId || activeField.name || activeField.id;
    actions.updateFormFieldValue(activeField.pageIndex, name, val);
  }
</script>

{#if activeField}
  <SidebarSection title="Form Field & Rules" collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-3 text-xs">
      <!-- Field Identifier & Variant Badge -->
      <div class="flex flex-col gap-1.5 p-2.5 rounded-xl bg-card border border-border">
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium text-foreground truncate select-all" title={activeField.fieldName || activeField.fieldId || activeField.name || activeField.id}>
            {activeField.fieldName || activeField.fieldId || activeField.name || activeField.id}
          </span>
          <Badge variant="outline" class="text-xs px-1.5 py-0 shrink-0 font-normal">
            {getVariantLabel(activeField.variant, activeField.isComb)}
          </Badge>
        </div>

        <div class="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
          <span>Page {activeField.pageIndex + 1}</span>
          <span>
            {Math.round(activeField.width)} &times; {Math.round(activeField.height)} pt
          </span>
        </div>
      </div>

      <!-- Enforced Input Rules -->
      <div class="flex flex-col gap-2 p-2.5 rounded-xl bg-card border border-border">
        <span class="text-xs font-semibold text-foreground">
          Enforced Input Rules
        </span>

        <div class="grid grid-cols-2 gap-2 text-xs">
          <!-- Max Length Rule -->
          <div class="flex flex-col gap-0.5 p-1.5 rounded-md bg-secondary/40 border border-border/40">
            <span class="text-muted-foreground">Max Length</span>
            <span class="font-medium text-foreground">
              {activeField.maxLength !== undefined ? `${activeField.maxLength} chars` : 'Unlimited'}
            </span>
          </div>

          <!-- Comb Cell Rule -->
          <div class="flex flex-col gap-0.5 p-1.5 rounded-md bg-secondary/40 border border-border/40">
            <span class="text-muted-foreground">Comb Spacing</span>
            <span class="font-medium text-foreground">
              {activeField.isComb ? `Enabled (${activeField.combCellCount || activeField.maxLength || 0} cells)` : 'Disabled'}
            </span>
          </div>

          <!-- Required Constraint -->
          <div class="flex flex-col gap-0.5 p-1.5 rounded-md bg-secondary/40 border border-border/40">
            <span class="text-muted-foreground">Requirement</span>
            <span class="font-medium text-foreground flex items-center gap-1">
              {#if activeField.required}
                <Asterisk class="w-3 h-3 text-destructive shrink-0" />
                <span>Required</span>
              {:else}
                <span>Optional</span>
              {/if}
            </span>
          </div>

          <!-- Read-Only Constraint -->
          <div class="flex flex-col gap-0.5 p-1.5 rounded-md bg-secondary/40 border border-border/40">
            <span class="text-muted-foreground">Access Mode</span>
            <span class="font-medium text-foreground flex items-center gap-1">
              {#if activeField.readOnly}
                <Lock class="w-3 h-3 text-muted-foreground shrink-0" />
                <span>Read-only</span>
              {:else}
                <span>Interactive</span>
              {/if}
            </span>
          </div>

          {#if activeField.variant === 'text-input'}
            <!-- Multiline Status -->
            <div class="flex flex-col gap-0.5 p-1.5 rounded-md bg-secondary/40 border border-border/40">
              <span class="text-muted-foreground">Line Mode</span>
              <span class="font-medium text-foreground">
                {activeField.multiline ? 'Multi-line' : 'Single line'}
              </span>
            </div>

            <!-- Password Status -->
            <div class="flex flex-col gap-0.5 p-1.5 rounded-md bg-secondary/40 border border-border/40">
              <span class="text-muted-foreground">Input Type</span>
              <span class="font-medium text-foreground">
                {activeField.password ? 'Masked' : 'Plain text'}
              </span>
            </div>
          {/if}
        </div>
      </div>

      <!-- Live Value Editing -->
      {#if activeField.variant === 'text-input'}
        <div class="flex flex-col gap-1.5 p-2.5 rounded-xl bg-card border border-border">
          <Label class="text-xs font-semibold text-foreground">
            Live Field Value
          </Label>
          <Input
            type={activeField.password ? 'password' : 'text'}
            aria-label="Live Field Value"
            value={typeof activeField.value === 'string' ? activeField.value : (activeField.value !== undefined ? String(activeField.value) : '')}
            maxlength={activeField.maxLength}
            disabled={Boolean(activeField.readOnly || !store.canEditValues)}
            oninput={(e) => handleValueChange(e.currentTarget.value)}
            class="h-8 text-xs font-sans"
            placeholder={activeField.placeholder || 'Enter value...'}
          />
        </div>
      {:else if activeField.options && activeField.options.length > 0}
        <div class="flex flex-col gap-1.5 p-2.5 rounded-xl bg-card border border-border">
          <span class="text-xs font-semibold text-foreground">
            Available Options
          </span>
          <div class="flex flex-col gap-1 max-h-36 overflow-y-auto pr-1">
            {#each activeField.options as opt}
              <div class="flex items-center justify-between p-1.5 rounded-md bg-secondary/30 text-xs">
                <span class="truncate" title={opt}>{opt}</span>
                {#if activeField.value === opt}
                  <Badge variant="secondary" class="text-xs px-1 py-0">Selected</Badge>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Appearance Characteristics -->
      <div class="flex flex-col gap-2 p-2.5 rounded-xl bg-card border border-border">
        <span class="text-xs font-semibold text-foreground">
          Appearance & Geometry
        </span>

        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="flex flex-col gap-0.5">
            <span class="text-muted-foreground">Font</span>
            <span class="font-medium text-foreground truncate" title={activeField.fontFamily || 'Helvetica'}>{activeField.fontFamily || 'Helvetica'}</span>
          </div>

          <div class="flex flex-col gap-0.5">
            <span class="text-muted-foreground">Font Size</span>
            <span class="font-medium text-foreground">
              {activeField.fontSize ? `${activeField.fontSize} pt` : 'Auto'}
            </span>
          </div>

          <div class="flex flex-col gap-0.5">
            <span class="text-muted-foreground">Text Align</span>
            <span class="font-medium text-foreground">{activeField.textAlign || 'Left'}</span>
          </div>

          <div class="flex flex-col gap-0.5">
            <span class="text-muted-foreground">Position</span>
            <span class="font-medium text-foreground">
              {Math.round(activeField.left)}, {Math.round(activeField.top)}
            </span>
          </div>
        </div>
      </div>
    </div>
  </SidebarSection>
{/if}
