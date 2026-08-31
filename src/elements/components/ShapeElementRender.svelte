<script lang="ts">
  import type { ShapeElement } from '../../stores/canvas-types';
  import type { ElementRenderProps } from '../../core/element-registry';

  let {
    element,
    zoom,
  }: ElementRenderProps<ShapeElement> = $props();
</script>

{#if element.variant === 'rectangle'}
  <div
    class="w-full h-full"
    style="background-color: {element.fill}; border: {element.strokeWidth * zoom}px solid {element.stroke}; {element.isHighlight ? 'mix-blend-mode: multiply;' : ''}"
  ></div>
{:else if element.variant === 'circle'}
  <div
    class="w-full h-full rounded-full"
    style="background-color: {element.fill}; border: {element.strokeWidth * zoom}px solid {element.stroke};"
  ></div>
{:else if element.variant === 'line'}
  <svg class="w-full h-full overflow-visible" preserveAspectRatio="none">
    <line x1="0" y1="50%" x2="100%" y2="50%" stroke={element.stroke} stroke-width={element.strokeWidth * zoom} />
  </svg>
{:else if element.variant === 'arrow'}
  <svg class="w-full h-full overflow-visible" preserveAspectRatio="none">
    <defs>
      <marker id="arrowhead-{element.id}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill={element.stroke} />
      </marker>
    </defs>
    <line x1="0" y1="50%" x2="100%" y2="50%" stroke={element.stroke} stroke-width={element.strokeWidth * zoom} marker-end="url(#arrowhead-{element.id})" />
  </svg>
{/if}
