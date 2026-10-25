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
  <Dialog.Content class="sm:max-w-[440px]">
    <Dialog.Header class="pr-12">
      <Dialog.Title>
        <ShieldAlert class="h-4 w-4 text-warning" />
        {webMcpStore.pendingConfirmation?.title ?? 'AI Agent Confirmation Required'}
      </Dialog.Title>
      <Dialog.Description>
        An AI agent is requesting permission to execute a destructive operation.
      </Dialog.Description>
    </Dialog.Header>

    <div class="dialog-body">
      <div class="rounded-[var(--radius-card-inner)] border border-warning/20 bg-warning/5 p-3 text-xs text-foreground">
        <div class="flex items-start gap-2.5">
          <Bot class="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p class="text-xs leading-relaxed text-muted-foreground">
            {webMcpStore.pendingConfirmation?.description ?? ''}
          </p>
        </div>
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" size="sm" class="h-8 text-xs" onclick={handleCancel}>
        Reject Action
      </Button>
      <Button variant="secondary" size="sm" class="h-8 text-xs" onclick={handleApprove}>
        Authorize Action
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
