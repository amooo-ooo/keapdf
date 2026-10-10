<script lang="ts">
  import type { VideoElement } from '../../stores/canvas-types';
  import type { ElementRenderProps } from '../../core/element-registry';
  import { Video, Play, Film } from 'lucide-svelte';

  let {
    element,
    selected = false,
  }: ElementRenderProps<VideoElement> = $props();

  let isPlaying = $state(false);
  let videoEl = $state<HTMLVideoElement | null>(null);

  function togglePlay(e: MouseEvent): void {
    e.stopPropagation();
    if (!videoEl) return;
    if (videoEl.paused) {
      void videoEl.play().catch(() => {
        isPlaying = false;
      });
      isPlaying = true;
    } else {
      videoEl.pause();
      isPlaying = false;
    }
  }
</script>

<div class="w-full h-full relative overflow-hidden rounded-md bg-card border border-border flex flex-col select-none">
  {#if element.src}
    <div class="relative w-full h-full flex-1 bg-black flex items-center justify-center overflow-hidden">
      <video
        bind:this={videoEl}
        src={element.src}
        poster={element.poster || undefined}
        autoplay={element.autoplay || false}
        loop={element.loop || false}
        muted={element.muted || false}
        controls={selected}
        playsinline
        class="w-full h-full object-contain pointer-events-auto"
        onplay={() => { isPlaying = true; }}
        onpause={() => { isPlaying = false; }}
      >
        <track kind="captions" />
      </video>

      {#if !isPlaying && !selected}
        <button
          type="button"
          class="absolute inset-0 m-auto w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-transform hover:scale-105 pointer-events-auto cursor-pointer border border-white/20"
          onclick={togglePlay}
          aria-label="Play video"
        >
          <Play class="w-5 h-5 ml-0.5 fill-current" />
        </button>
      {/if}

      <!-- Top header badge indicating ISO 32000 RichMedia stream -->
      <div class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-secondary/90 backdrop-blur-xs text-[9px] font-sans text-foreground flex items-center gap-1 border border-border pointer-events-none">
        <Film class="w-2.5 h-2.5" />
        <span class="truncate max-w-[120px]" title={element.title || element.fileName || 'ISO 32000 RichMedia Video'}>{element.title || element.fileName || 'ISO 32000 RichMedia Video'}</span>
      </div>
    </div>
  {:else}
    <div class="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-card text-muted-foreground border border-dashed border-border">
      <Video class="w-8 h-8 text-muted-foreground mb-1" />
      <span class="text-xs font-medium text-foreground">Video Media Stream</span>
      <span class="text-[10px] text-muted-foreground mt-0.5">ISO 32000-1 Clause 13.2</span>
    </div>
  {/if}
</div>
