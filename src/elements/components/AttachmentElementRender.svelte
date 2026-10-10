<script lang="ts">
  import type { AttachmentElement } from '../../stores/canvas-types';
  import type { ElementRenderProps } from '../../core/element-registry';
  import { Paperclip, Download } from 'lucide-svelte';
  import { formatByteSize } from '../../services/pdf/operations/metadata-ops';

  let {
    element,
  }: ElementRenderProps<AttachmentElement> = $props();

  function handleDownload(e: MouseEvent): void {
    e.stopPropagation();
    if (!element.src) return;
    const a = document.createElement('a');
    a.href = element.src;
    a.download = element.fileName || 'attachment';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
</script>

<div class="w-full h-full rounded-md bg-card border border-border flex items-center px-2.5 py-1.5 gap-2.5 select-none text-foreground overflow-hidden">
  <div class="w-7 h-7 rounded bg-secondary border border-border flex items-center justify-center text-muted-foreground shrink-0">
    <Paperclip class="w-3.5 h-3.5" />
  </div>

  <div class="flex-1 min-w-0 flex flex-col justify-center">
    <span class="text-xs font-medium text-foreground truncate leading-tight" title={element.fileName || 'Attached File'}>
      {element.fileName || 'Attached File'}
    </span>
    <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
      <span>ISO 32000-2 AF</span>
      {#if element.fileSize}
        <span class="opacity-40">|</span>
        <span>{formatByteSize(element.fileSize)}</span>
      {/if}
    </div>
  </div>

  {#if element.src}
    <button
      type="button"
      class="w-6 h-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center shrink-0 transition-colors pointer-events-auto cursor-pointer"
      onclick={handleDownload}
      title="Download Attachment"
      aria-label="Download Attachment"
    >
      <Download class="w-3.5 h-3.5" />
    </button>
  {/if}
</div>
