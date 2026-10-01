<script lang="ts">
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Check, Trash2, X } from 'lucide-svelte';

  interface Props {
    onApply: () => void;
    onDelete: () => void;
    onDeselect: () => void;
  }
  let { onApply, onDelete, onDeselect }: Props = $props();
</script>

<SidebarSection title="Actions" borderBottom={true} collapsible={true} defaultExpanded={true}>
  <div class="field-group">
    <Button onclick={onApply} variant="panel">
      <Check class="panel-icon-sm" /> Apply Edit
    </Button>
    <Button variant="panel-destructive" onclick={onDelete}>
      <Trash2 class="panel-icon-sm" /> Delete Text
    </Button>
    <Button variant="panel" onclick={onDeselect}>
      <X class="panel-icon-sm" /> Deselect
    </Button>
  </div>
</SidebarSection>
