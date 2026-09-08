/**
 * WebMCP Lifecycle Manager.
 *
 * Coordinates tool registration, SDG lifecycle, concurrency write locks,
 * rate limiting, proposal staging, and UI notification events.
 */

import type { PdfEditorService } from '../../services/pdf-editor';
import type { EditorStore } from '../../stores/editor.svelte';
import type { CanvasStore } from '../../stores/canvas.svelte';
import type { EditorActions } from '../../stores/editor-actions';
import type { HistoryStore } from '../../stores/history.svelte';
import type { WebMcpStore } from '../../stores/webmcp.svelte';
import { ensureWebMcpInstalled, WebMcpModelContext } from './webmcp-polyfill';
import { SdgBuilder } from './sdg/sdg-builder';
import { SdgLock } from './safety/sdg-lock';
import { RateLimiter } from './safety/rate-limiter';
import { ProposalStore } from './safety/proposal-store';
import { createWebMcpTools, type WebMcpContext } from './tools/tool-definitions';

export class WebMcpManager {
  private modelContext: WebMcpModelContext;
  private sdgBuilder: SdgBuilder;
  private sdgLock: SdgLock;
  private rateLimiter: RateLimiter;
  private proposalStore: ProposalStore;
  private registeredToolNames: string[] = [];

  constructor(
    private service: PdfEditorService,
    private editorStore: EditorStore,
    private canvasStore?: CanvasStore | null,
    private editorActions?: EditorActions | null,
    private historyStore?: HistoryStore | null,
    private webMcpStore?: WebMcpStore | null
  ) {
    this.modelContext = ensureWebMcpInstalled();
    this.sdgBuilder = new SdgBuilder();
    this.sdgLock = new SdgLock();
    this.rateLimiter = new RateLimiter(30, 60_000);
    this.proposalStore = new ProposalStore();
  }

  /**
   * Returns the underlying ModelContext instance.
   */
  public get context(): WebMcpModelContext {
    return this.modelContext;
  }

  /**
   * Returns the Semantic Document Graph builder.
   */
  public get builder(): SdgBuilder {
    return this.sdgBuilder;
  }

  /**
   * Initializes WebMCP registration and builds the initial SDG.
   */
  public async initialize(): Promise<void> {
    await this.registerAllTools();
  }

  /**
   * Registers or re-registers the complete WebMCP tool catalogue against the active document.
   */
  public async registerAllTools(): Promise<void> {
    this.unregisterAllTools();

    const mcpContext: WebMcpContext = {
      pdfDoc: this.service.document,
      editorStore: this.editorStore,
      canvasStore: this.canvasStore,
      editorActions: this.editorActions,
      historyStore: this.historyStore,
      sdgBuilder: this.sdgBuilder,
      sdgLock: this.sdgLock,
      rateLimiter: this.rateLimiter,
      proposalStore: this.proposalStore,
      requestUserConfirmation: async (title: string, description: string): Promise<boolean> => {
        if (this.webMcpStore) {
          return this.webMcpStore.requestConfirmation(title, description);
        }
        return true;
      },
      onAgentMutation: (details): void => {
        if (this.webMcpStore) {
          this.webMcpStore.addTransientHighlight({
            pageIndex: details.page,
            nodeId: details.nodeId,
            description: details.description,
            timestamp: Date.now(),
          });
        }
      },
    };

    const tools = createWebMcpTools(mcpContext);

    for (const tool of tools) {
      try {
        await this.modelContext.registerTool(tool);
        this.registeredToolNames.push(tool.name);
      } catch {
        // Tool already registered or ignored
      }
    }

    // Also register on host native document.modelContext if host provided one (e.g. Chrome WebMCP Testing flag)
    if (typeof document !== 'undefined') {
      const docModelContext = (document as unknown as { modelContext?: import('./webmcp-types').ModelContext }).modelContext;
      if (docModelContext && docModelContext !== this.modelContext && typeof docModelContext.registerTool === 'function') {
        for (const tool of tools) {
          try {
            await docModelContext.registerTool(tool);
          } catch {
            // Already registered or host specific check
          }
        }
        if (typeof docModelContext.ontoolchange === 'function') {
          try {
            docModelContext.ontoolchange(new Event('toolchange'));
          } catch {}
        }
      }
    }

    // Also register on host native navigator.modelContext if host provided one
    if (typeof navigator !== 'undefined') {
      const hostModelContext = (navigator as unknown as { modelContext?: import('./webmcp-types').ModelContext }).modelContext;
      if (hostModelContext && hostModelContext !== this.modelContext && typeof hostModelContext.registerTool === 'function') {
        for (const tool of tools) {
          try {
            await hostModelContext.registerTool(tool);
          } catch {
            // Already registered or host specific check
          }
        }
      }
    }

    // Trigger ontoolchange callback if registered on active modelContext
    if (typeof this.modelContext.ontoolchange === 'function') {
      try {
        this.modelContext.ontoolchange.call(this.modelContext, new Event('toolchange'));
      } catch {}
    }

    if (this.webMcpStore) {
      this.webMcpStore.setActiveToolCount(this.registeredToolNames.length);
      this.webMcpStore.setToolList(this.registeredToolNames);
    }

    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__webmcp = {
        modelContext: this.modelContext,
        manager: this,
        toolCount: this.registeredToolNames.length,
        tools: this.registeredToolNames,
      };
    }
  }

  /**
   * Unregisters all previously registered tools from ModelContext.
   */
  public unregisterAllTools(): void {
    for (const name of this.registeredToolNames) {
      try {
        this.modelContext.unregisterTool(name);
      } catch {
        // Best-effort cleanup
      }
    }
    this.registeredToolNames = [];
    this.proposalStore.reset();
  }

  /**
   * Invalidates and rebuilds the active Semantic Document Graph.
   */
  public rebuildSdg(): void {
    try {
      this.sdgBuilder.buildGraph(this.service.document, this.canvasStore);
    } catch (err: unknown) {
      console.warn('Failed rebuilding Semantic Document Graph:', err);
    }
  }

  /**
   * Cleans up all WebMCP registrations and resources on document disposal.
   */
  public dispose(): void {
    this.unregisterAllTools();
    this.sdgBuilder.reset();
    this.proposalStore.reset();
    this.rateLimiter.reset();
  }
}
