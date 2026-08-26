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
    <Button onclick={onApply} class="btn-action" variant="outline">
      <Check class="h-3.5 w-3.5 mr-2" /> Apply Edit
    </Button>
    <Button variant="outline" onclick={onDelete} class="btn-action text-destructive hover:text-destructive hover:bg-destructive/10">
      <Trash2 class="h-3.5 w-3.5 mr-2" /> Delete Text
    </Button>
    <Button variant="outline" onclick={onDeselect} class="btn-action">
      <X class="h-3.5 w-3.5 mr-2" /> Deselect
    </Button>
  </div>
</SidebarSection>
