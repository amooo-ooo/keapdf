<script lang="ts">
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { resolveInlineKeyAction } from '../../../utils/text-range-utils';

  interface Props {
    text: string;
    onApply: () => void;
  }
  let { text = $bindable(), onApply }: Props = $props();
</script>

<SidebarSection title="Content" borderBottom={true} collapsible={true} defaultExpanded={true}>
  <div class="field-group">
    <Label for="edit-text-input" class="field-label">Text Content</Label>
    <Textarea
      id="edit-text-input"
      bind:value={text}
      class="text-xs resize-y"
      onkeydown={(e) => {
        if (resolveInlineKeyAction(e) === 'submit') {
          e.preventDefault();
          onApply();
        }
      }}
      onblur={onApply}
      rows={3}
    />
  </div>
</SidebarSection>
