<script lang="ts">
  import type { ShapeElement } from '../../stores/canvas-types';
  import type { ElementRenderProps } from '../../core/element-registry';

  let {
    element,
    zoom,
  }: ElementRenderProps<ShapeElement> = $props();
</script>

{#if element.variant === 'path' || (Boolean(element.svgPath) && !['rectangle', 'circle', 'arrow'].includes(element.variant))}
  <svg
    class="w-full h-full overflow-visible"
    style="opacity: {element.opacity ?? 1};"
    viewBox={element.viewBox || `0 0 ${Math.max(1, Math.round(element.baseWidth ?? element.width))} ${Math.max(1, Math.round(element.baseHeight ?? element.height))}`}
    preserveAspectRatio="none"
  >
    {#if element.svgPath}
      <path
        d={element.svgPath}
        fill={element.fill}
        stroke={element.stroke}
        stroke-width={element.strokeWidth}
        stroke-linecap={element.strokeLineCap || 'butt'}
        stroke-linejoin={element.strokeLineJoin || 'miter'}
        fill-rule={element.fillRule || (element.fillMode === 2 ? 'evenodd' : 'nonzero')}
        style={element.isHighlight ? 'mix-blend-mode: multiply;' : ''}
      />
    {/if}
  </svg>
{:else if element.variant === 'rectangle'}
  <div
    class="w-full h-full"
    style="background-color: {element.fill}; border: {element.strokeWidth * zoom}px solid {element.stroke}; opacity: {element.opacity ?? 1}; {element.isHighlight ? 'mix-blend-mode: multiply;' : ''}"
  ></div>
{:else if element.variant === 'circle'}
  <div
    class="w-full h-full rounded-full"
    style="background-color: {element.fill}; border: {element.strokeWidth * zoom}px solid {element.stroke}; opacity: {element.opacity ?? 1};"
  ></div>
{:else if element.variant === 'line'}
  <svg class="w-full h-full overflow-visible" style="opacity: {element.opacity ?? 1};" preserveAspectRatio="none">
    <line
      x1="0"
      y1="50%"
      x2="100%"
      y2="50%"
      stroke={element.stroke}
      stroke-width={element.strokeWidth * zoom}
      stroke-linecap={element.strokeLineCap || 'butt'}
    />
  </svg>
{:else if element.variant === 'arrow'}
  <svg class="w-full h-full overflow-visible" style="opacity: {element.opacity ?? 1};" preserveAspectRatio="none">
    <defs>
      <marker id="arrowhead-{element.id}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill={element.stroke} />
      </marker>
    </defs>
    <line
      x1="0"
      y1="50%"
      x2="100%"
      y2="50%"
      stroke={element.stroke}
      stroke-width={element.strokeWidth * zoom}
      stroke-linecap={element.strokeLineCap || 'butt'}
      marker-end="url(#arrowhead-{element.id})"
    />
  </svg>
{/if}
