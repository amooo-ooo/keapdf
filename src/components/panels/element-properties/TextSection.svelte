<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import type { TextElement } from '../../../stores/canvas-types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { extractBaseFontFamily } from '../../../services/pdf/font-charset-index';
  import { getDisplayFontName } from '../../../services/font-loader';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
  import { AlignLeft, AlignCenter, AlignRight, Bold, Italic } from 'lucide-svelte';

  const canvasStore = useCanvasStore();

  function updateProp(propName: string, value: string | number | boolean): void {
    const selected = canvasStore.selectedElementId;
    if (selected && canvasStore.selectedElement?.kind === 'text') {
      const textEl = canvasStore.selectedElement as TextElement;
      const updates: Record<string, unknown> = { [propName]: value };

      if (propName === 'color') {
        const colStr = String(value);
        updates.color = colStr;
        if (textEl.segments) {
          updates.segments = textEl.segments.map((s) => ({ ...s, color: colStr }));
        }
        if (textEl.lines) {
          updates.lines = textEl.lines.map((l) => ({
            ...l,
            segments: (l.segments ?? []).map((s) => ({ ...s, color: colStr })),
          }));
        }
      } else if (propName === 'fontFamily') {
        const fontStr = String(value);
        updates.fontFamily = fontStr;
        updates.rawFontFamily = undefined;
        if (textEl.segments) {
          updates.segments = textEl.segments.map((s) => ({ ...s, fontFamily: fontStr, rawFontFamily: undefined }));
        }
        if (textEl.lines) {
          updates.lines = textEl.lines.map((l) => ({
            ...l,
            segments: (l.segments ?? []).map((s) => ({ ...s, fontFamily: fontStr, rawFontFamily: undefined })),
          }));
        }
      } else if (propName === 'fontWeight') {
        const weight = value as 'normal' | 'bold';
        updates.fontWeight = weight;
        if (textEl.segments) {
          updates.segments = textEl.segments.map((s) => ({ ...s, fontWeight: weight }));
        }
        if (textEl.lines) {
          updates.lines = textEl.lines.map((l) => ({
            ...l,
            segments: (l.segments ?? []).map((s) => ({ ...s, fontWeight: weight })),
          }));
        }
      } else if (propName === 'fontStyle') {
        const style = value as 'normal' | 'italic';
        updates.fontStyle = style;
        if (textEl.segments) {
          updates.segments = textEl.segments.map((s) => ({ ...s, fontStyle: style }));
        }
        if (textEl.lines) {
          updates.lines = textEl.lines.map((l) => ({
            ...l,
            segments: (l.segments ?? []).map((s) => ({ ...s, fontStyle: style })),
          }));
        }
      } else if (propName === 'fontSize') {
        const newSize = Math.max(1, Number(value));
        const oldSize = textEl.fontSize || newSize;
        const scale = oldSize > 0 ? newSize / oldSize : 1;

        updates.fontSize = newSize;
        if (textEl.lines && textEl.lines.length > 0) {
          updates.lines = textEl.lines.map((l) => ({
            ...l,
            fontSize: Math.max(1, Math.round((l.fontSize || oldSize) * scale * 10) / 10),
            lineHeight: l.lineHeight ? l.lineHeight * scale : undefined,
            segments: (l.segments ?? []).map((s) => ({
              ...s,
              fontSize: Math.max(1, Math.round((s.fontSize || l.fontSize || oldSize) * scale * 10) / 10),
            })),
          }));
        }
        if (textEl.segments && textEl.segments.length > 0) {
          updates.segments = textEl.segments.map((s) => ({
            ...s,
            fontSize: Math.max(1, Math.round((s.fontSize || oldSize) * scale * 10) / 10),
          }));
        }
      } else if (propName === 'text') {
        const newText = String(value);
        const textLines = newText.split(/\r?\n/);
        const updatedLines = textLines.map((lineStr, idx) => {
          const originalLine = textEl.lines && textEl.lines[idx] ? textEl.lines[idx] : undefined;
          const lineFontSize = originalLine?.fontSize || textEl.fontSize;
          let segments = originalLine?.segments && originalLine.segments.length > 0 ? originalLine.segments : undefined;

          if (segments && originalLine && originalLine.text !== lineStr) {
            if (segments.length === 1) {
              segments = [{ ...segments[0], text: lineStr, charCount: lineStr.length }];
            } else {
              segments = [
                {
                  text: lineStr,
                  fontSize: segments[0].fontSize || lineFontSize,
                  fontFamily: segments[0].fontFamily || textEl.fontFamily,
                  rawFontFamily: segments[0].rawFontFamily || textEl.rawFontFamily,
                  color: segments[0].color || textEl.color,
                  fontWeight: segments[0].fontWeight || textEl.fontWeight,
                  fontStyle: segments[0].fontStyle || textEl.fontStyle,
                  charCount: lineStr.length,
                },
              ];
            }
          } else if (!segments) {
            segments = [
              {
                text: lineStr,
                fontSize: lineFontSize,
                fontFamily: textEl.fontFamily,
                rawFontFamily: textEl.rawFontFamily,
                color: textEl.color,
                fontWeight: textEl.fontWeight,
                fontStyle: textEl.fontStyle,
                charCount: lineStr.length,
              },
            ];
          }

          return {
            text: lineStr,
            fontSize: lineFontSize,
            lineHeight: originalLine?.lineHeight,
            segments,
          };
        });
        updates.text = newText;
        updates.lines = updatedLines;
        updates.segments = updatedLines.flatMap((l) => l.segments);
      }

      canvasStore.updateElement(selected, updates as Partial<TextElement>);
    }
  }

  function handleNumberChange(e: Event, propName: string): void {
    const target = e.target as HTMLInputElement;
    updateProp(propName, parseFloat(target.value));
  }

  function handleStringChange(e: Event, propName: string): void {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    updateProp(propName, target.value);
  }

  function getDistinctFontSizes(textEl: TextElement): number[] {
    const sizes: number[] = [];
    if (textEl.fontSize) sizes.push(Math.round(textEl.fontSize * 10) / 10);
    if (textEl.lines) {
      for (const line of textEl.lines) {
        if (line.fontSize) sizes.push(Math.round(line.fontSize * 10) / 10);
        if (line.segments) {
          for (const seg of line.segments) {
            if (seg.fontSize) sizes.push(Math.round(seg.fontSize * 10) / 10);
          }
        }
      }
    }
    if (textEl.segments) {
      for (const seg of textEl.segments) {
        if (seg.fontSize) sizes.push(Math.round(seg.fontSize * 10) / 10);
      }
    }
    return Array.from(new Set(sizes));
  }
</script>

{#if canvasStore.selectedElement?.kind === 'text'}
  {@const textEl = canvasStore.selectedElement as TextElement}
  {@const distinctSizes = getDistinctFontSizes(textEl)}
  {@const hasMixedSizes = distinctSizes.length > 1}
  <SidebarSection title="Text Properties" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <div class="flex flex-col gap-2">
      <div class="field-group">
        <Label class="field-label">Content</Label>
        <textarea
          value={textEl.text}
          oninput={(e) => handleStringChange(e, 'text')}
          class="flex min-h-[56px] w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-xs shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
          rows="2"
        ></textarea>
      </div>

      <div class="field-group">
        <Label class="field-label">Font Family</Label>
        <Input 
          type="text" 
          value={getDisplayFontName(textEl.fontFamily, extractBaseFontFamily)} 
          oninput={(e) => handleStringChange(e, 'fontFamily')}
          class="field-input" 
        />
      </div>
      
      <div class="grid grid-cols-2 gap-2">
        <div class="field-group">
          <div class="flex items-center justify-between">
            <Label class="field-label">Font Size</Label>
            {#if hasMixedSizes}
              <span class="text-[10px] text-muted-foreground">Mixed</span>
            {/if}
          </div>
          <Input 
            type="number" 
            value={textEl.fontSize} 
            oninput={(e) => handleNumberChange(e, 'fontSize')}
            class="field-input" 
            min="1"
            step="0.5"
          />
        </div>
        <div class="field-group">
          <Label class="field-label">Color</Label>
          <div class="flex items-center gap-1.5">
            <Input 
              type="color" 
              value={textEl.color} 
              oninput={(e) => handleStringChange(e, 'color')}
              class="h-8 w-10 p-0.5 cursor-pointer shrink-0" 
            />
            <span class="text-xs text-muted-foreground font-mono uppercase">{textEl.color}</span>
          </div>
        </div>
      </div>

      <div class="field-group mt-0.5">
        <div class="flex items-center justify-between">
          <Label class="field-label">Highlight / Background</Label>
          {#if textEl.backgroundColor}
            <button
              type="button"
              class="text-[10px] text-destructive hover:underline cursor-pointer"
              onclick={() => updateProp('backgroundColor', '')}
            >Clear</button>
          {/if}
        </div>
        <div class="flex items-center gap-1.5 pt-0.5">
          <button
            type="button"
            class="w-5 h-5 rounded border border-yellow-400 bg-yellow-200/80 hover:scale-105 {textEl.backgroundColor === 'rgba(254, 240, 138, 0.6)' ? 'ring-2 ring-primary' : ''}"
            onclick={() => updateProp('backgroundColor', 'rgba(254, 240, 138, 0.6)')}
            title="Yellow Highlight"
          ></button>
          <button
            type="button"
            class="w-5 h-5 rounded border border-green-400 bg-green-200/80 hover:scale-105 {textEl.backgroundColor === 'rgba(187, 247, 208, 0.6)' ? 'ring-2 ring-primary' : ''}"
            onclick={() => updateProp('backgroundColor', 'rgba(187, 247, 208, 0.6)')}
            title="Green Highlight"
          ></button>
          <button
            type="button"
            class="w-5 h-5 rounded border border-sky-400 bg-sky-200/80 hover:scale-105 {textEl.backgroundColor === 'rgba(186, 230, 253, 0.6)' ? 'ring-2 ring-primary' : ''}"
            onclick={() => updateProp('backgroundColor', 'rgba(186, 230, 253, 0.6)')}
            title="Blue Highlight"
          ></button>
          <button
            type="button"
            class="w-5 h-5 rounded border border-pink-400 bg-pink-200/80 hover:scale-105 {textEl.backgroundColor === 'rgba(251, 207, 232, 0.6)' ? 'ring-2 ring-primary' : ''}"
            onclick={() => updateProp('backgroundColor', 'rgba(251, 207, 232, 0.6)')}
            title="Pink Highlight"
          ></button>
          <Input 
            type="color" 
            value={textEl.backgroundColor || '#ffffff'} 
            oninput={(e) => handleStringChange(e, 'backgroundColor')}
            class="h-5 w-6 p-0 border border-border rounded cursor-pointer shrink-0 ml-1" 
            title="Custom background color"
          />
        </div>
      </div>

      <div class="flex items-center justify-between mt-1">
        <ToggleGroup.Root 
          type="single" 
          value={textEl.textAlign} 
          onValueChange={(val) => { if (val) updateProp('textAlign', val); }}
        >
          <ToggleGroup.Item value="left" aria-label="Align Left" class="h-8 w-8 p-0">
            <AlignLeft class="h-4 w-4" />
          </ToggleGroup.Item>
          <ToggleGroup.Item value="center" aria-label="Align Center" class="h-8 w-8 p-0">
            <AlignCenter class="h-4 w-4" />
          </ToggleGroup.Item>
          <ToggleGroup.Item value="right" aria-label="Align Right" class="h-8 w-8 p-0">
            <AlignRight class="h-4 w-4" />
          </ToggleGroup.Item>
        </ToggleGroup.Root>

        <ToggleGroup.Root 
          type="multiple"
          value={[
            ...(textEl.fontWeight === 'bold' ? ['bold'] : []),
            ...(textEl.fontStyle === 'italic' ? ['italic'] : [])
          ]}
          onValueChange={(vals) => {
            updateProp('fontWeight', vals.includes('bold') ? 'bold' : 'normal');
            updateProp('fontStyle', vals.includes('italic') ? 'italic' : 'normal');
          }}
        >
          <ToggleGroup.Item value="bold" aria-label="Toggle Bold" class="h-8 w-8 p-0">
            <Bold class="h-4 w-4" />
          </ToggleGroup.Item>
          <ToggleGroup.Item value="italic" aria-label="Toggle Italic" class="h-8 w-8 p-0">
            <Italic class="h-4 w-4" />
          </ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>
    </div>
  </SidebarSection>
{/if}
