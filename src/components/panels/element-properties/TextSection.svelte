<script lang="ts">
  import type { TextElement } from '../../../stores/canvas-types';
  import UnifiedTextProperties from '../text-properties/UnifiedTextProperties.svelte';

  interface Props {
    element?: TextElement | null;
  }

  let { element = null }: Props = $props();
</script>

<UnifiedTextProperties {element} />
