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

<div class="w-full h-full rounded-md bg-card border border-border flex items-center px-3 gap-2.5 select-none overflow-hidden text-foreground">
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
      class="w-8 h-8 rounded-full bg-secondary hover:bg-muted border border-border text-foreground flex items-center justify-center shrink-0 transition-transform active:scale-95 pointer-events-auto cursor-pointer"
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
        <Music class="w-3 h-3 shrink-0" />
        <span class="text-xs font-medium text-foreground truncate" title={element.title || element.fileName || 'Audio Track'}>
          {element.title || element.fileName || 'Audio Track'}
        </span>
      </div>
      <div class="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
        <span>ISO 32000-1 Clause 13.3</span>
        {#if element.fileSize}
          <span class="opacity-40">|</span>
          <span>{Math.round(element.fileSize / 1024)} KB</span>
        {/if}
      </div>
    </div>

    <!-- Animated audio bars indicator when playing -->
    <div class="flex items-end gap-0.5 h-4 shrink-0 px-1">
      <span class="w-0.5 bg-foreground rounded-full transition-[height,opacity] duration-150 {isPlaying ? 'h-3.5 animate-pulse' : 'h-1.5 opacity-40'}"></span>
      <span class="w-0.5 bg-foreground rounded-full transition-[height,opacity] duration-150 {isPlaying ? 'h-2 animate-bounce' : 'h-1 opacity-40'}"></span>
      <span class="w-0.5 bg-foreground rounded-full transition-[height,opacity] duration-150 {isPlaying ? 'h-4 animate-pulse' : 'h-2 opacity-40'}"></span>
    </div>
  {:else}
    <div class="w-full h-full flex items-center justify-center gap-2 text-muted-foreground border border-dashed border-border rounded p-1">
      <Volume2 class="w-4 h-4 text-muted-foreground shrink-0" />
      <div class="text-[11px] font-medium truncate">No audio source</div>
    </div>
  {/if}
</div>
