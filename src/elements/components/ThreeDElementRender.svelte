<script lang="ts">
  import type { ThreeDElement } from '../../stores/canvas-types';
  import type { ElementRenderProps } from '../../core/element-registry';
  import { Eye } from 'lucide-svelte';

  let {
    element,
  }: ElementRenderProps<ThreeDElement> = $props();

  const formatTag = $derived((element.modelFormat || 'U3D').toUpperCase());
</script>

<div class="w-full h-full rounded-md bg-neutral-900 border border-neutral-700/80 shadow-xs flex flex-col select-none overflow-hidden text-neutral-200">
  <div class="relative w-full h-full flex-1 bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950 flex flex-col items-center justify-center p-3 overflow-hidden">
    <!-- Stylised isometric 3D wireframe graphic -->
    <div class="relative w-16 h-16 flex items-center justify-center mb-2">
      <svg viewBox="0 0 100 100" class="w-full h-full text-primary drop-shadow-md overflow-visible">
        <!-- Isometric Cube wireframe -->
        <polygon points="50,15 85,35 50,55 15,35" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
        <polygon points="15,35 50,55 50,90 15,70" fill="currentColor" fill-opacity="0.15" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
        <polygon points="50,55 85,35 85,70 50,90" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
        <!-- Axis indicators -->
        <line x1="50" y1="55" x2="50" y2="25" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="2 2" />
        <line x1="50" y1="55" x2="75" y2="40" stroke="#f43f5e" stroke-width="1.5" stroke-dasharray="2 2" />
        <line x1="50" y1="55" x2="25" y2="40" stroke="#22c55e" stroke-width="1.5" stroke-dasharray="2 2" />
      </svg>
    </div>

    <!-- Title and Format Badge -->
    <div class="text-center z-10 px-2 max-w-full">
      <div class="flex items-center justify-center gap-1.5 mb-1">
        <span class="px-1.5 py-0.5 rounded bg-primary/20 text-primary font-sans text-[9px] font-semibold border border-primary/30">
          {formatTag}
        </span>
        <span class="text-xs font-semibold text-neutral-100 truncate max-w-[130px]">
          {element.title || element.fileName || '3D Artwork'}
        </span>
      </div>
      <div class="text-[10px] text-neutral-400">
        ISO 32000-1 Clause 13.6
      </div>
    </div>

    <!-- Orbit interaction prompt badge -->
    <div class="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[9px] text-neutral-400 flex items-center gap-1 border border-white/5 pointer-events-none">
      <Eye class="w-2.5 h-2.5 text-primary" />
      <span>Interactive 3D View</span>
    </div>
  </div>
</div>
