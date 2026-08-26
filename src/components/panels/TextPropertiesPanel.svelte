<script lang="ts">
  import type { ColorRgba, EditableTextSpan } from '../../core/types';
  import { useEditorStore } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
  import SidebarSection from '../common/SidebarSection.svelte';
  import { extractBaseFontFamily } from '../../services/pdf/font-charset-index';
  import { getDisplayFontName } from '../../services/font-loader';
  import { 
    LayoutGrid, 
    AlignLeft,
    AlignCenter,
    AlignRight,
    AlignVerticalSpaceAround,
    AlignVerticalJustifyCenter,
    AlignVerticalSpaceBetween
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();

  let editText = $state('');
  let editFontSize = $state(12);
  let editFontFamily = $state('Helvetica');
  let editFontWeight = $state('normal');
  let editColorHex = $state('#000000');
  let editLineHeight = $state('');
  let hasMixedFontSize = $state(false);

  $effect(() => {
    const span = store.selectedSpan;
    if (span && span.type === 'text') {
      editText = span.text;
      // Detect mixed font sizes across lines
      const lines = span.lines;
      if (lines && lines.length > 1) {
        const sizes = new Set(lines.map(l => Math.round((l.fontSize || span.fontSize) * 10) / 10));
        hasMixedFontSize = sizes.size > 1;
        editFontSize = hasMixedFontSize ? NaN : Math.round(span.fontSize * 10) / 10;
      } else {
        hasMixedFontSize = false;
        editFontSize = Math.round(span.fontSize * 10) / 10;
      }
      editFontFamily = span.rawFontFamily || span.fontFamily || 'Helvetica';
      editLineHeight = span.lineHeight ? `${Math.round(span.lineHeight * 10) / 10}` : '';
      
      const rawLower = (span.rawFontFamily || span.fontFamily || '').toLowerCase();
      editFontWeight = rawLower.includes('bold') ? 'bold' : 'normal';
      
      const r = span.color.r.toString(16).padStart(2, '0');
      const g = span.color.g.toString(16).padStart(2, '0');
      const b = span.color.b.toString(16).padStart(2, '0');
      editColorHex = `#${r}${g}${b}`;
    }
  });

  function hexToRgba(hex: string): ColorRgba {
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
    const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
    const b = parseInt(cleanHex.substring(4, 6), 16) || 0;
    return { r, g, b, a: 255 };
  }

  function handleApplyChanges(): void {
    if (!store.selectedSpan || store.selectedSpan.type !== 'text') return;
    const span = store.selectedSpan as EditableTextSpan;
    const parsedLineHeight = parseFloat(editLineHeight);
    const validFontSize = !isNaN(editFontSize) && editFontSize > 0 ? editFontSize : undefined;
    actions.applyTextMutation(
      {
        text: editText,
        fontSize: validFontSize,
        fontFamily: editFontFamily,
        fontWeight: editFontWeight,
        color: hexToRgba(editColorHex),
        lineHeight: !isNaN(parsedLineHeight) && parsedLineHeight > 0 ? parsedLineHeight : undefined,
        reflowParagraph: true,
      },
      span
    );
  }
</script>

{#if store.selectedSpan && store.selectedSpan.type === 'text'}
  <div class="flex flex-col w-full shrink-0">
    <SidebarSection title="Typography" borderBottom={true} collapsible={true} defaultExpanded={true}>
      {#snippet headerActions()}
        <Button variant="ghost" size="icon" class="h-6 w-6 text-muted-foreground hover:text-foreground">
          <LayoutGrid class="h-3.5 w-3.5" />
        </Button>
      {/snippet}

      <div class="flex flex-col gap-2">
        <div class="flex flex-col gap-1">
          <Label class="text-xs text-muted-foreground">Text Content</Label>
          <textarea
            bind:value={editText}
            class="flex min-h-[64px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
            onkeydown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                handleApplyChanges();
              }
            }}
            onblur={handleApplyChanges}
            placeholder="Paragraph text..."
            rows="3"
          ></textarea>
        </div>

        <div class="flex flex-col gap-1 mt-1">
          <Label class="text-xs text-muted-foreground">Font Family</Label>
          <Select.Root type="single" value={editFontFamily} onValueChange={(val) => { editFontFamily = val; handleApplyChanges(); }}>
            <Select.Trigger class="h-8 text-xs w-full">
              {getDisplayFontName(editFontFamily, extractBaseFontFamily)}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="Helvetica" label="Inter">Inter</Select.Item>
              <Select.Item value="Times-Roman" label="Roboto">Roboto</Select.Item>
              <Select.Item value="Courier" label="Courier">Courier</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>

        <div class="flex items-end gap-2 mt-1 w-full">
           <div class="flex flex-col gap-1 flex-1">
             <Label class="text-xs text-muted-foreground">Weight</Label>
              <Select.Root type="single" value={editFontWeight} onValueChange={(val) => { editFontWeight = val; handleApplyChanges(); }}>
                 <Select.Trigger class="h-8 text-xs w-full">
                   {editFontWeight === 'bold' ? 'Bold' : 'Regular'}
                 </Select.Trigger>
                 <Select.Content>
                   <Select.Item value="normal" label="Regular">Regular</Select.Item>
                   <Select.Item value="bold" label="Bold">Bold</Select.Item>
                 </Select.Content>
              </Select.Root>
           </div>
           
           <div class="flex flex-col gap-1 w-[110px]">
             <Label class="text-xs text-muted-foreground">Size (pt)</Label>
             <Input 
                type="number" 
                bind:value={editFontSize} 
                onchange={handleApplyChanges}
                onkeydown={(e) => e.key === 'Enter' && handleApplyChanges()}
                placeholder={hasMixedFontSize ? 'Mixed' : ''}
                class="h-8 text-xs w-full" 
              />
           </div>
        </div>

        <div class="flex items-end gap-2 mt-1 w-full">
          <div class="flex flex-col gap-1 w-[70px]">
            <Label class="text-xs text-muted-foreground">Color</Label>
            <Input 
              type="color" 
              bind:value={editColorHex} 
              onchange={handleApplyChanges}
              class="h-8 w-full p-0.5 cursor-pointer shrink-0" 
            />
          </div>
          <div class="flex flex-col gap-1 flex-1">
             <Label class="text-xs text-muted-foreground">Line Height (pt)</Label>
             <Input 
                type="text" 
                bind:value={editLineHeight}
                placeholder="Auto"
                onchange={handleApplyChanges}
                onkeydown={(e) => e.key === 'Enter' && handleApplyChanges()}
                class="h-8 text-xs w-full" 
              />
          </div>
        </div>

        <div class="flex flex-col gap-1 mt-1 w-[calc(100%-78px)]">
          <Label class="text-xs text-muted-foreground">Letter Spacing</Label>
          <Input 
            type="text" 
            placeholder="0%"
            class="h-8 text-xs w-full" 
          />
        </div>

        <div class="flex flex-col gap-1 mt-1 mb-1">
           <Label class="text-xs text-muted-foreground">Alignment</Label>
           <div class="flex items-center gap-4">
             <ToggleGroup.Root type="single" value="left" variant="outline" size="sm" class="h-8">
                <ToggleGroup.Item value="left" class="h-8 px-2.5"><AlignLeft class="h-4 w-4"/></ToggleGroup.Item>
                <ToggleGroup.Item value="center" class="h-8 px-2.5"><AlignCenter class="h-4 w-4"/></ToggleGroup.Item>
                <ToggleGroup.Item value="right" class="h-8 px-2.5"><AlignRight class="h-4 w-4"/></ToggleGroup.Item>
             </ToggleGroup.Root>

             <ToggleGroup.Root type="single" value="top" variant="outline" size="sm" class="h-8">
                <ToggleGroup.Item value="top" class="h-8 px-2.5"><AlignVerticalSpaceAround class="h-4 w-4"/></ToggleGroup.Item>
                <ToggleGroup.Item value="middle" class="h-8 px-2.5"><AlignVerticalJustifyCenter class="h-4 w-4"/></ToggleGroup.Item>
                <ToggleGroup.Item value="bottom" class="h-8 px-2.5"><AlignVerticalSpaceBetween class="h-4 w-4"/></ToggleGroup.Item>
             </ToggleGroup.Root>
           </div>
        </div>
      </div>
    </SidebarSection>
  </div>
{/if}
