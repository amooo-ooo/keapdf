<script lang="ts">
  import type { AudioElement } from '../../stores/canvas-types';
  import type { ElementRenderProps } from '../../core/element-registry';
  import { Volume2, Play, Pause, Music } from 'lucide-svelte';

  let {
    element,
  }: ElementRenderProps<AudioElement> = $props();

  let isPlaying = $state(false);
  let audioEl = $state<HTMLAudioElement | null>(null);

  function togglePlay(e: MouseEvent): void {
    e.stopPropagation();
    if (!audioEl) return;
    if (audioEl.paused) {
      void audioEl.play().catch(() => {
        isPlaying = false;
      });
      isPlaying = true;
    } else {
      audioEl.pause();
      isPlaying = false;
    }
  }
</script>

<div class="w-full h-full rounded-md bg-neutral-900 border border-neutral-700/80 shadow-xs flex items-center px-3 gap-2.5 select-none overflow-hidden text-neutral-200">
  {#if element.src}
    <audio
      bind:this={audioEl}
      src={element.src}
      onplay={() => { isPlaying = true; }}
      onpause={() => { isPlaying = false; }}
      onended={() => { isPlaying = false; }}
      class="hidden"
    ></audio>

    <button
      type="button"
      class="w-8 h-8 rounded-full bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary flex items-center justify-center shrink-0 transition-transform active:scale-95 pointer-events-auto cursor-pointer"
      onclick={togglePlay}
      aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
    >
      {#if isPlaying}
        <Pause class="w-4 h-4 fill-current" />
      {:else}
        <Play class="w-4 h-4 ml-0.5 fill-current" />
      {/if}
    </button>

    <div class="flex-1 min-w-0 flex flex-col justify-center">
      <div class="flex items-center gap-1.5">
        <Music class="w-3 h-3 text-primary shrink-0" />
        <span class="text-xs font-medium text-neutral-100 truncate">
          {element.title || element.fileName || 'Audio Track'}
        </span>
      </div>
      <div class="flex items-center gap-2 text-[10px] text-neutral-400 mt-0.5">
        <span>ISO 32000-1 Clause 13.3</span>
        {#if element.fileSize}
          <span class="opacity-40">|</span>
          <span>{Math.round(element.fileSize / 1024)} KB</span>
        {/if}
      </div>
    </div>

    <!-- Animated audio bars indicator when playing -->
    <div class="flex items-end gap-0.5 h-4 shrink-0 px-1">
      <span class="w-0.5 bg-primary rounded-full transition-all {isPlaying ? 'h-3.5 animate-pulse' : 'h-1.5 opacity-40'}"></span>
      <span class="w-0.5 bg-primary rounded-full transition-all {isPlaying ? 'h-2 animate-bounce' : 'h-1 opacity-40'}"></span>
      <span class="w-0.5 bg-primary rounded-full transition-all {isPlaying ? 'h-4 animate-pulse' : 'h-2 opacity-40'}"></span>
    </div>
  {:else}
    <div class="w-full h-full flex items-center justify-center gap-2 text-neutral-400 border border-dashed border-neutral-700 rounded p-1">
      <Volume2 class="w-4 h-4 text-neutral-500 shrink-0" />
      <div class="text-[11px] font-medium truncate">No audio source</div>
    </div>
  {/if}
</div>
