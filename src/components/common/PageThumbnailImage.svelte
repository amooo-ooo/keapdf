<script lang="ts" module>
  type ObserverCallback = (isIntersecting: boolean) => void;
  const thumbnailObserverCallbacks = new Map<Element, ObserverCallback>();
  let sharedThumbnailObserver: IntersectionObserver | null = null;

  function getSharedThumbnailObserver(): IntersectionObserver {
    if (!sharedThumbnailObserver) {
      sharedThumbnailObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const cb = thumbnailObserverCallbacks.get(entry.target);
            if (cb) cb(entry.isIntersecting);
          }
        },
        { rootMargin: '200px 0px' }
      );
    }
    return sharedThumbnailObserver;
  }
</script>

<script lang="ts">
  import { useEditorActions } from '../../stores/editor-actions';
  import { useEditorStore } from '../../stores/editor.svelte';

  interface Props {
    pageIndex: number;
    scale?: number;
    class?: string;
  }
  
  let { pageIndex, scale = 0.25, class: className = '' }: Props = $props();
  
  const actions = useEditorActions();
  const store = useEditorStore();
  
  let thumbnailSrc = $state<string>('');
  let containerEl: HTMLDivElement | null = $state(null);
  let isInView = $state(false);
  const isPageValid = $derived(store.isDocumentLoaded && pageIndex >= 0 && pageIndex < store.pageCount);

  $effect(() => {
    if (!containerEl) return;

    const observer = getSharedThumbnailObserver();
    thumbnailObserverCallbacks.set(containerEl, (intersecting) => {
      isInView = intersecting;
    });
    observer.observe(containerEl);

    return () => {
      if (containerEl) {
        observer.unobserve(containerEl);
        thumbnailObserverCallbacks.delete(containerEl);
      }
    };
  });
  
  $effect(() => {
    // Track page-specific version, render version, file name and derived page validity
    void store.fileName;
    void store.renderVersion;
    void store.pageVersions[pageIndex];
    
    if (!isInView || !isPageValid) {
      if (thumbnailSrc) {
        if (thumbnailSrc.startsWith('blob:')) {
          URL.revokeObjectURL(thumbnailSrc);
        }
        thumbnailSrc = '';
      }
      return;
    }

    const controller = new AbortController();

    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      try {
        const { canvas } = actions.service.document.getPage(pageIndex).render(scale, { applyDpr: false });
        if (thumbnailSrc && typeof canvas.toDataURL === 'function') {
          const previousSrc = thumbnailSrc;
          thumbnailSrc = canvas.toDataURL('image/jpeg', 0.6);
          canvas.width = 0;
          canvas.height = 0;
          if (previousSrc.startsWith('blob:')) {
            URL.revokeObjectURL(previousSrc);
          }
          return;
        }
        canvas.toBlob(
          (blob) => {
            canvas.width = 0;
            canvas.height = 0;
            if (controller.signal.aborted || !blob) return;
            const previousSrc = thumbnailSrc;
            thumbnailSrc = URL.createObjectURL(blob);
            if (previousSrc) {
              URL.revokeObjectURL(previousSrc);
            }
          },
          'image/jpeg',
          0.6
        );
      } catch (e) {
        console.error(`Failed to generate thumbnail for page ${pageIndex}`, e);
      }
    });

    return () => {
      controller.abort();
    };
  });

  $effect(() => {
    return () => {
      if (thumbnailSrc) {
        URL.revokeObjectURL(thumbnailSrc);
        thumbnailSrc = '';
      }
    };
  });
</script>

<div bind:this={containerEl} class="w-full h-full flex items-center justify-center">
  {#if thumbnailSrc}
    <img
      src={thumbnailSrc}
      alt={`Page ${pageIndex + 1}`}
      class="img-subtle-outline {className}"
    />
  {:else}
    <div class="animate-pulse bg-muted/40 border border-border/40 w-full h-full {className}"></div>
  {/if}
</div>
