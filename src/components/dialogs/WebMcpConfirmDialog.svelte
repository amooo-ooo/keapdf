<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { ShieldAlert, Bot } from 'lucide-svelte';
  import { useWebMcpStore } from '../../stores/webmcp.svelte';

  const webMcpStore = useWebMcpStore();

  const isOpen = $derived(webMcpStore.pendingConfirmation !== null);

  function handleApprove(): void {
    webMcpStore.resolveConfirmation(true);
  }

  function handleCancel(): void {
    webMcpStore.resolveConfirmation(false);
  }
</script>

<Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) handleCancel(); }}>
  <Dialog.Content class="sm:max-w-[480px]">
    <Dialog.Header>
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
          <ShieldAlert class="h-5 w-5" />
        </div>
        <div>
          <Dialog.Title class="text-base font-semibold">
            {webMcpStore.pendingConfirmation?.title ?? 'AI Agent Confirmation Required'}
          </Dialog.Title>
          <Dialog.Description class="text-xs text-muted-foreground">
            An AI agent is requesting permission to execute a destructive operation.
          </Dialog.Description>
        </div>
      </div>
    </Dialog.Header>

    <div class="my-4 rounded-md border border-warning/20 bg-warning/5 p-3.5 text-sm text-foreground">
      <div class="flex items-start gap-2.5">
        <Bot class="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p class="text-xs leading-relaxed text-muted-foreground">
          {webMcpStore.pendingConfirmation?.description ?? ''}
        </p>
      </div>
    </div>

    <Dialog.Footer class="gap-2 sm:gap-0">
      <Button variant="outline" size="sm" onclick={handleCancel}>
        Reject Action
      </Button>
      <Button variant="destructive" size="sm" onclick={handleApprove}>
        Authorize Action
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
