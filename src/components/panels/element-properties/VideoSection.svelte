<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import type { VideoElement } from '../../../stores/canvas-types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { Upload } from 'lucide-svelte';
  import { formatByteSize } from '../../../services/pdf/operations/metadata-ops';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  let fileInputRef: HTMLInputElement | null = $state(null);

  function updateProp<K extends keyof VideoElement>(propName: K, value: VideoElement[K]): void {
    const selected = canvasStore.selectedElementId;
    if (selected) {
      canvasActions.updateElementProperties(selected, { [propName]: value });
    }
  }

  function handleReplaceClick(): void {
    fileInputRef?.click();
  }

  function handleFileChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      const objectUrl = URL.createObjectURL(file);
      const selected = canvasStore.selectedElementId;
      if (selected) {
        canvasActions.updateElementProperties(selected, {
          src: objectUrl,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'video/mp4',
          title: file.name.replace(/\.[^/.]+$/, ''),
        });
      }
    }
    target.value = '';
  }
</script>

{#if canvasStore.selectedElement?.kind === 'video'}
  {@const videoEl = canvasStore.selectedElement as VideoElement}
  <SidebarSection title="Video Properties" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <input
      bind:this={fileInputRef}
      type="file"
      accept="video/*,.mp4,.webm,.mov,.mkv,.avi,.m4v"
      class="hidden"
      onchange={handleFileChange}
    />

    <div class="flex flex-col gap-2.5">
      <div class="field-group">
        <Button
          variant="panel"
          onclick={handleReplaceClick}
        >
          <Upload class="panel-icon-sm" />
          <span>Replace Video File...</span>
        </Button>
      </div>

      <div class="field-group">
        <Label class="field-label">Video Title</Label>
        <Input
          type="text"
          value={videoEl.title}
          oninput={(e) => updateProp('title', (e.target as HTMLInputElement).value)}
          placeholder="Video Stream"
          class="field-input"
          aria-label="Video Title"
        />
      </div>

      <div class="field-group">
        <Label class="field-label">Web Video URL</Label>
        <Input
          type="url"
          value={videoEl.src.startsWith('blob:') ? '' : videoEl.src}
          oninput={(e) => updateProp('src', (e.target as HTMLInputElement).value)}
          placeholder="https://example.com/video.mp4"
          class="field-input"
          aria-label="Video Source URL"
        />
      </div>

      {#if videoEl.fileName || videoEl.fileSize}
        <div class="p-2.5 rounded-md border border-border bg-card text-xs flex flex-col gap-1">
          <div class="flex items-center justify-between text-muted-foreground">
            <span class="truncate" title={videoEl.fileName || 'Embedded Video'}>{videoEl.fileName || 'Embedded Video'}</span>
            {#if videoEl.fileSize}
              <span>{formatByteSize(videoEl.fileSize)}</span>
            {/if}
          </div>
        </div>
      {/if}

      <div class="flex flex-col gap-2 pt-1 border-t border-border/50">
        <div class="field-header-row">
          <Label class="field-label">Loop Playback</Label>
          <Switch
            checked={videoEl.loop || false}
            onCheckedChange={(checked) => updateProp('loop', checked)}
            aria-label="Loop Playback"
          />
        </div>

        <div class="field-header-row">
          <Label class="field-label">Mute Audio</Label>
          <Switch
            checked={videoEl.muted || false}
            onCheckedChange={(checked) => updateProp('muted', checked)}
            aria-label="Mute Audio"
          />
        </div>
      </div>
    </div>
  </SidebarSection>
{/if}
