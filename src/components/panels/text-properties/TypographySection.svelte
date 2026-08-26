<script lang="ts">
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { extractBaseFontFamily } from '../../../services/pdf/font-charset-index';
  import { getDisplayFontName } from '../../../services/font-loader';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Select from '$lib/components/ui/select/index.js';

  interface Props {
    fontSize: number;
    colorHex: string;
    fontFamily: string;
  }
  let { fontSize = $bindable(), colorHex = $bindable(), fontFamily = $bindable() }: Props = $props();
</script>

<SidebarSection title="Typography" borderBottom={true} collapsible={true} defaultExpanded={true}>
  <div class="flex flex-col gap-2">
    <div class="grid grid-cols-2 gap-2">
      <div class="field-group">
        <Label for="edit-font-size" class="field-label">Size (pt)</Label>
        <Input
          id="edit-font-size"
          type="number"
          min={6}
          max={144}
          bind:value={fontSize}
          class="field-input"
        />
      </div>
      <div class="field-group">
        <Label for="edit-color" class="field-label">Color</Label>
        <div class="flex items-center gap-1.5">
          <Input
            id="edit-color"
            type="color"
            bind:value={colorHex}
            class="h-8 w-10 p-0.5 cursor-pointer shrink-0"
          />
          <span class="text-xs text-muted-foreground font-mono uppercase">{colorHex}</span>
        </div>
      </div>
    </div>
    <div class="field-group">
      <Label for="edit-font-family" class="field-label">Font Family</Label>
      <Select.Root type="single" value={fontFamily} onValueChange={(val) => { fontFamily = val; }}>
        <Select.Trigger class="h-8 text-xs w-full">
          {getDisplayFontName(fontFamily, extractBaseFontFamily)}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="Helvetica" label="Helvetica (Sans-Serif)">Helvetica (Sans-Serif)</Select.Item>
          <Select.Item value="Times-Roman" label="Times (Serif)">Times (Serif)</Select.Item>
          <Select.Item value="Courier" label="Courier (Monospace)">Courier (Monospace)</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
  </div>
</SidebarSection>
