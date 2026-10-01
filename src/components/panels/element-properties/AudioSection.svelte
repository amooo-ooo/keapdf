<script lang="ts">
  import { useCanvasStore } from '../../../stores/canvas.svelte';
  import { useCanvasActions } from '../../../stores/canvas-actions';
  import type { AudioElement } from '../../../stores/canvas-types';
  import SidebarSection from '../../common/SidebarSection.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { Upload, Globe } from 'lucide-svelte';
  import { formatByteSize } from '../../../services/pdf/operations/metadata-ops';

  const canvasStore = useCanvasStore();
  const canvasActions = useCanvasActions();

  let fileInputRef: HTMLInputElement | null = $state(null);

  function updateProp<K extends keyof AudioElement>(propName: K, value: AudioElement[K]): void {
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
          mimeType: file.type || 'audio/mpeg',
          title: file.name.replace(/\.[^/.]+$/, ''),
        });
      }
    }
    target.value = '';
  }
</script>

{#if canvasStore.selectedElement?.kind === 'audio'}
  {@const audioEl = canvasStore.selectedElement as AudioElement}
  <SidebarSection title="Audio Properties" borderBottom={true} collapsible={true} defaultExpanded={true}>
    <input
      bind:this={fileInputRef}
      type="file"
      accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.wma"
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
          <span>Replace Audio File...</span>
        </Button>
      </div>

      <div class="field-group">
        <Label class="field-label">Track Title</Label>
        <Input
          type="text"
          value={audioEl.title}
          oninput={(e) => updateProp('title', (e.target as HTMLInputElement).value)}
          placeholder="Audio Track"
          class="field-input"
        />
      </div>

      <div class="field-group">
        <div class="field-header-row">
          <Label class="field-label">Web Stream URL</Label>
          <Globe class="w-3 h-3 text-muted-foreground" />
        </div>
        <Input
          type="url"
          value={audioEl.src.startsWith('blob:') ? '' : audioEl.src}
          oninput={(e) => updateProp('src', (e.target as HTMLInputElement).value)}
          placeholder="https://example.com/audio.mp3"
          class="field-input text-[11px]"
        />
        <span class="text-[10px] text-muted-foreground">
          Enter online audio URL for direct Chrome PDF viewer playback.
        </span>
      </div>

      {#if audioEl.fileName || audioEl.fileSize}
        <div class="p-2 rounded bg-muted/40 border border-border text-[11px] flex flex-col gap-1">
          <div class="flex items-center justify-between text-muted-foreground">
            <span class="truncate">{audioEl.fileName || 'Embedded Audio'}</span>
            {#if audioEl.fileSize}
              <span class="text-[10px] tabular-nums">{formatByteSize(audioEl.fileSize)}</span>
            {/if}
          </div>
          <span class="text-[9px] text-muted-foreground/80">ISO 32000-1 Clause 13.3 Sound Clip</span>
        </div>
      {/if}

      <div class="field-header-row pt-1">
        <Label class="field-label">Show Playback Controls</Label>
        <Switch
          checked={audioEl.controls !== false}
          onCheckedChange={(checked) => updateProp('controls', checked)}
        />
      </div>
    </div>
  </SidebarSection>
{/if}
