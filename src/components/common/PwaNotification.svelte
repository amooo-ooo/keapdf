<script lang="ts">
  import { RefreshCw, CheckCircle2, WifiOff, X, Download } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import { usePwaStore } from '../../stores/pwa.svelte';

  const pwaStore = usePwaStore();

  let autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (pwaStore.isOfflineReady) {
      if (autoDismissTimer) clearTimeout(autoDismissTimer);
      autoDismissTimer = setTimeout(() => {
        pwaStore.dismissNotification();
      }, 5000);
    }
    return () => {
      if (autoDismissTimer) clearTimeout(autoDismissTimer);
    };
  });

  async function handleReload(): Promise<void> {
    await pwaStore.updateApp();
  }

  function handleDismiss(): void {
    if (autoDismissTimer) clearTimeout(autoDismissTimer);
    pwaStore.dismissNotification();
  }

  async function handleInstall(): Promise<void> {
    await pwaStore.promptInstall();
  }
</script>

<!-- note: offline connectivity warning banner -->
{#if !pwaStore.isOnline}
  <aside
    aria-label="Offline status"
    class="fixed bottom-4 left-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs bg-muted/95 border border-border/80 text-foreground shadow-sm backdrop-blur-sm select-none pointer-events-auto transition-all"
  >
    <WifiOff class="w-3.5 h-3.5 text-warning shrink-0" />
    <span>Offline mode: Local PDFium engine active</span>
  </aside>
{/if}

<!-- note: update available or offline cache ready prompt -->
{#if pwaStore.needRefresh || pwaStore.isOfflineReady}
  <aside
    aria-label="Application update"
    class="fixed bottom-4 right-4 z-50 max-w-sm w-full p-3.5 bg-card/95 border border-border text-card-foreground rounded-xl shadow-lg backdrop-blur-md select-none transition-all animate-in fade-in slide-in-from-bottom-2 duration-200"
  >
    <div class="flex items-start gap-3">
      {#if pwaStore.needRefresh}
        <div class="p-1.5 rounded-lg bg-primary/10 text-primary shrink-0 mt-0.5">
          <RefreshCw class="w-4 h-4 animate-spin-slow" />
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="text-xs font-semibold leading-tight text-foreground">Update Available</h4>
          <p class="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            A new version of Kea PDF is ready. Reload to apply enhancements.
          </p>
          <div class="flex items-center gap-2 mt-2.5">
            <Button size="sm" class="h-7 text-xs px-3" onclick={handleReload}>
              Reload to Update
            </Button>
            <Button variant="ghost" size="sm" class="h-7 text-xs px-2.5 text-muted-foreground" onclick={handleDismiss}>
              Later
            </Button>
          </div>
        </div>
      {:else if pwaStore.isOfflineReady}
        <div class="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
          <CheckCircle2 class="w-4 h-4" />
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="text-xs font-semibold leading-tight text-foreground">Ready for Offline Use</h4>
          <p class="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            All PDFium WebAssembly tools and editor assets are cached locally.
          </p>
          {#if pwaStore.canInstall}
            <div class="flex items-center gap-2 mt-2.5">
              <Button size="sm" variant="outline" class="h-7 text-xs px-3" onclick={handleInstall}>
                <Download class="w-3.5 h-3.5 mr-1.5" />
                Install App
              </Button>
              <Button variant="ghost" size="sm" class="h-7 text-xs px-2 text-muted-foreground" onclick={handleDismiss}>
                Dismiss
              </Button>
            </div>
          {/if}
        </div>
      {/if}

      <Button
        variant="ghost"
        size="icon"
        aria-label="Dismiss notification"
        class="w-6 h-6 -mr-1 -mt-1 text-muted-foreground hover:text-foreground shrink-0"
        onclick={handleDismiss}
      >
        <X class="w-3.5 h-3.5" />
      </Button>
    </div>
  </aside>
{/if}
