<script lang="ts">
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Label } from '$lib/components/ui/label/index.js';

  interface Props {
    text: string;
    onApply: () => void;
  }
  let { text = $bindable(), onApply }: Props = $props();
</script>

<SidebarSection title="Content" borderBottom={true} collapsible={true} defaultExpanded={true}>
  <div class="field-group">
    <Label for="edit-text-input" class="field-label">Text Content</Label>
    <textarea
      id="edit-text-input"
      bind:value={text}
      class="flex min-h-[64px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
      onkeydown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          onApply();
        }
      }}
      onblur={onApply}
      rows="3"
    ></textarea>
  </div>
</SidebarSection>
