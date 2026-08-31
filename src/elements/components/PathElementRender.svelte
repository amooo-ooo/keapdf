<script lang="ts">
  import type { PathElement } from '../../stores/canvas-types';
  import type { ElementRenderProps } from '../../core/element-registry';

  let {
    element,
    zoom,
  }: ElementRenderProps<PathElement> = $props();
</script>

<svg
  class="w-full h-full overflow-visible"
  style={element.isHighlight ? 'mix-blend-mode: multiply;' : ''}
>
  <path
    d={element.points && element.points.length > 0 ? `M ${element.points.map(p => `${(p.x - element.x) * zoom},${(p.y - element.y) * zoom}`).join(' L ')}` : ''}
    fill="none"
    stroke={element.stroke}
    stroke-width={element.strokeWidth * zoom}
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>
