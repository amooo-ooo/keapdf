/**
 * Svelte 5 reactive state store for WebMCP agent interactions and UI feedback.
 *
 * Tracks registered tools, active transient visual highlights on pages,
 * and human confirmation requests for destructive operations.
 */

import { getContext, setContext } from 'svelte';

const WEBMCP_STORE_KEY = Symbol('webmcp-store');

export interface TransientHighlight {
  id: string;
  pageIndex: number;
  nodeId?: string;
  description: string;
  timestamp: number;
}

export interface PendingConfirmation {
  id: string;
  title: string;
  description: string;
  resolve: (confirmed: boolean) => void;
}

export class WebMcpStore {
  /** Count of currently registered WebMCP tools. */
  activeToolCount = $state<number>(0);
  /** List of registered tool names. */
  toolList = $state<string[]>([]);
  /** Active transient visual highlights. */
  transientHighlights = $state<TransientHighlight[]>([]);
  /** Pending human confirmation request for destructive operations. */
  pendingConfirmation = $state<PendingConfirmation | null>(null);

  private confirmationQueue: PendingConfirmation[] = [];

  /**
   * Sets the total registered tool count.
   */
  public setActiveToolCount(count: number): void {
    this.activeToolCount = count;
  }

  /**
   * Sets the list of registered tool names.
   */
  public setToolList(tools: string[]): void {
    this.toolList = [...tools];
  }

  /**
   * Emits a transient highlight on a page or node to visually signal agent edits.
   */
  public addTransientHighlight(highlight: Omit<TransientHighlight, 'id'>): void {
    const id = `hl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const record: TransientHighlight = {
      ...highlight,
      id,
    };

    this.transientHighlights = [...this.transientHighlights, record];

    // Automatically expire after 3.5 seconds
    setTimeout(() => {
      this.transientHighlights = this.transientHighlights.filter((h) => h.id !== id);
    }, 3500);
  }

  /**
   * Requests explicit human confirmation for a destructive operation.
   */
  public requestConfirmation(title: string, description: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const conf: PendingConfirmation = {
        id: `conf_${Date.now()}`,
        title,
        description,
        resolve: (confirmed: boolean): void => {
          resolve(confirmed);
          if (this.confirmationQueue.length > 0) {
            this.pendingConfirmation = this.confirmationQueue.shift() || null;
          } else {
            this.pendingConfirmation = null;
          }
        },
      };

      if (!this.pendingConfirmation) {
        this.pendingConfirmation = conf;
      } else {
        this.confirmationQueue.push(conf);
      }
    });
  }

  /**
   * Resolves the current pending confirmation.
   */
  public resolveConfirmation(confirmed: boolean): void {
    if (this.pendingConfirmation) {
      this.pendingConfirmation.resolve(confirmed);
    }
  }
}

/**
 * Context provider helper for root component.
 */
export function provideWebMcpStore(store: WebMcpStore): WebMcpStore {
  setContext(WEBMCP_STORE_KEY, store);
  return store;
}

/**
 * Context consumer hook for child components.
 */
export function useWebMcpStore(): WebMcpStore {
  const store = getContext<WebMcpStore>(WEBMCP_STORE_KEY);
  if (!store) {
    throw new Error('WebMcpStore not found in Svelte context. provideWebMcpStore must be called at root.');
  }
  return store;
}
