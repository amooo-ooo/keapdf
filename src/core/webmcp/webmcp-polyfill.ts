/**
 * W3C WebMCP (Web Model Context Protocol) compliant runtime polyfill.
 *
 * Exposes the standard ModelContext interface on document.modelContext
 * and navigator.modelContext with strict validation and tool lifecycle events.
 */

import type {
  ModelContext,
  ModelContextTool,
  ModelContextRegisterToolOptions,
  ModelContextGetToolOptions,
  ModelContextExecuteToolOptions,
  RegisteredTool,
  UserInteractionCallback,
  WebMcpResponse,
} from './webmcp-types';

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const MAX_TOOL_NAME_LENGTH = 128;

interface InternalToolRecord {
  tool: ModelContextTool<Record<string, unknown>, unknown>;
  options?: ModelContextRegisterToolOptions;
  cleanupSignal?: () => void;
}

export class WebMcpModelContext extends EventTarget implements ModelContext {
  private toolRecords = new Map<string, InternalToolRecord>();
  public ontoolchange: ((this: ModelContext, ev: Event) => void) | null = null;

  constructor() {
    super();
  }

  /**
   * Direct getter returning all currently registered tools.
   */
  get tools(): RegisteredTool[] {
    const currentOrigin = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';
    const currentWindow = typeof window !== 'undefined' ? window : undefined;
    const result: RegisteredTool[] = [];
    for (const [name, record] of this.toolRecords.entries()) {
      result.push({
        name,
        title: record.tool.title,
        description: record.tool.description,
        inputSchema: typeof record.tool.inputSchema === 'string'
          ? record.tool.inputSchema
          : JSON.stringify(record.tool.inputSchema),
        outputSchema: record.tool.outputSchema
          ? (typeof record.tool.outputSchema === 'string'
              ? record.tool.outputSchema
              : JSON.stringify(record.tool.outputSchema))
          : undefined,
        origin: currentOrigin,
        window: currentWindow,
        annotations: record.tool.annotations,
        execute: async (inputObject: Record<string, unknown> | string = {}, options?: ModelContextExecuteToolOptions) => {
          return this.executeTool({ name }, inputObject, options);
        },
      });
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  /**
   * Registers a tool into the model context.
   *
   * Rejects if tool name violates specification constraints or is already registered.
   */
  async registerTool<TInput = Record<string, unknown>, TOutput = unknown>(
    tool: ModelContextTool<TInput, TOutput>,
    options?: ModelContextRegisterToolOptions
  ): Promise<void> {
    if (!tool || typeof tool !== 'object') {
      throw new TypeError('Tool definition must be an object.');
    }

    const { name, description, inputSchema, execute } = tool;

    if (!name || typeof name !== 'string') {
      throw new TypeError('Tool name must be a non-empty string.');
    }

    if (name.length < 1 || name.length > MAX_TOOL_NAME_LENGTH) {
      throw new RangeError(
        `Tool name length must be between 1 and ${MAX_TOOL_NAME_LENGTH} characters.`
      );
    }

    if (!TOOL_NAME_PATTERN.test(name)) {
      throw new TypeError(
        `Tool name "${name}" violates pattern: only ASCII alphanumeric, hyphen, underscore, and dot are permitted.`
      );
    }

    if (this.toolRecords.has(name)) {
      throw new Error(`A tool with name "${name}" is already registered.`);
    }

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      throw new TypeError('Tool description must be a non-empty string.');
    }

    if (!inputSchema || typeof inputSchema !== 'object') {
      throw new TypeError('Tool inputSchema must be a valid JSON Schema object.');
    }

    if (typeof execute !== 'function') {
      throw new TypeError('Tool execute must be an asynchronous function.');
    }

    let cleanupSignal: (() => void) | undefined;
    if (options?.signal) {
      const signal = options.signal;
      if (signal.aborted) {
        return;
      }
      const onAbort = (): void => {
        this.unregisterTool(name);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      cleanupSignal = (): void => {
        signal.removeEventListener('abort', onAbort);
      };
    }

    this.toolRecords.set(name, {
      tool: tool as unknown as ModelContextTool<Record<string, unknown>, unknown>,
      options,
      cleanupSignal,
    });

    this.dispatchToolChange();
  }

  /**
   * Unregisters a tool by name.
   */
  unregisterTool(name: string): void {
    const existing = this.toolRecords.get(name);
    if (!existing) {
      return;
    }

    if (existing.cleanupSignal) {
      existing.cleanupSignal();
    }

    this.toolRecords.delete(name);
    this.dispatchToolChange();
  }

  /**
   * Bulk context provider method.
   */
  async provideContext(context: { tools?: ModelContextTool[] }): Promise<void> {
    if (context.tools && Array.isArray(context.tools)) {
      for (const tool of context.tools) {
        if (this.toolRecords.has(tool.name)) {
          this.unregisterTool(tool.name);
        }
        await this.registerTool(tool);
      }
    }
  }

  /**
   * Checks if a tool is registered by name.
   */
  hasTool(name: string): boolean {
    return this.toolRecords.has(name);
  }

  /**
   * Retrieves a single registered tool by name.
   */
  async getTool(name: string): Promise<RegisteredTool | undefined> {
    const tools = await this.getTools();
    return tools.find((t) => t.name === name);
  }

  /**
   * Retrieves all registered tools matching filtering options.
   */
  async getTools(options?: ModelContextGetToolOptions): Promise<RegisteredTool[]> {
    const currentOrigin = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';
    const currentWindow = typeof window !== 'undefined' ? window : undefined;
    const result: RegisteredTool[] = [];

    for (const [name, record] of this.toolRecords.entries()) {
      const exposedTo = record.options?.exposedTo;
      if (exposedTo && exposedTo.length > 0 && options?.fromOrigins) {
        const matchesOrigin = options.fromOrigins.some((orig) =>
          exposedTo.includes(orig)
        );
        if (!matchesOrigin) {
          continue;
        }
      }

      result.push({
        name,
        title: record.tool.title,
        description: record.tool.description,
        inputSchema: typeof record.tool.inputSchema === 'string'
          ? record.tool.inputSchema
          : JSON.stringify(record.tool.inputSchema),
        outputSchema: record.tool.outputSchema
          ? (typeof record.tool.outputSchema === 'string'
              ? record.tool.outputSchema
              : JSON.stringify(record.tool.outputSchema))
          : undefined,
        origin: currentOrigin,
        window: currentWindow,
        annotations: record.tool.annotations,
        execute: async (inputObject: Record<string, unknown> | string = {}, opts?: ModelContextExecuteToolOptions) => {
          return this.executeTool({ name }, inputObject, opts);
        },
      });
    }

    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  /**
   * Executes a registered tool by descriptor or name.
   */
  async executeTool<TOutput = unknown>(
    tool: RegisteredTool | { name: string } | string,
    inputObject: Record<string, unknown> | string = {},
    options?: ModelContextExecuteToolOptions
  ): Promise<WebMcpResponse<TOutput>> {
    const toolName = typeof tool === 'string' ? tool : (typeof tool === 'object' && tool !== null ? tool.name : '');
    const record = this.toolRecords.get(toolName);

    if (!record) {
      return {
        ok: false,
        error: {
          code: 'NODE_NOT_FOUND',
          message: `Tool "${toolName}" is not registered in ModelContext.`,
          details: { toolName },
        },
      };
    }

    if (options?.signal?.aborted) {
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Tool execution was aborted before invocation.',
        },
      };
    }

    const abortController = new AbortController();
    if (options?.signal) {
      options.signal.addEventListener(
        'abort',
        () => abortController.abort(options.signal?.reason),
        { once: true }
      );
    }

    let parsedInput: Record<string, unknown> = {};
    if (typeof inputObject === 'string') {
      try {
        parsedInput = JSON.parse(inputObject);
      } catch {
        return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON input: unable to parse input string' } };
      }
    } else if (inputObject && typeof inputObject === 'object') {
      parsedInput = inputObject;
    }

    try {
      const output = await record.tool.execute(parsedInput, { signal: abortController.signal });

      // If the tool implementation returned its own WebMcpResponse envelope, preserve it
      if (
        output &&
        typeof output === 'object' &&
        'ok' in output &&
        typeof (output as { ok: unknown }).ok === 'boolean'
      ) {
        return output as WebMcpResponse<TOutput>;
      }

      return {
        ok: true,
        result: output as TOutput,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const code: import('./webmcp-types').WebMcpErrorCode =
        err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
          ? ((err as { code: string }).code as import('./webmcp-types').WebMcpErrorCode)
          : 'INTERNAL_ERROR';
      const details =
        err && typeof err === 'object' && 'holderToolCallId' in err
          ? { holderToolCallId: (err as { holderToolCallId: unknown }).holderToolCallId }
          : undefined;

      return {
        ok: false,
        error: {
          code,
          message,
          ...(details ? { details } : {}),
        },
      };
    }
  }

  /**
   * Pauses to request explicit human interaction or confirmation.
   */
  async requestUserInteraction<T = unknown>(callback: UserInteractionCallback<T>): Promise<T> {
    if (typeof callback !== 'function') {
      throw new TypeError('requestUserInteraction callback must be a function.');
    }
    return callback();
  }

  private dispatchToolChange(): void {
    const event = new Event('toolchange');
    this.dispatchEvent(event);
    if (typeof this.ontoolchange === 'function') {
      try {
        this.ontoolchange.call(this, event);
      } catch (err: unknown) {
        console.error('Error in ontoolchange handler:', err);
      }
    }

    // Broadcast toolchange event on window and document for external extensions/agents
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('toolchange', { detail: { count: this.toolRecords.size } }));
      } catch {}
    }
    if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
      try {
        document.dispatchEvent(new CustomEvent('toolchange', { detail: { count: this.toolRecords.size } }));
      } catch {}
    }
  }
}

/**
 * Global singleton model context instance.
 */
let globalModelContextInstance: WebMcpModelContext | null = null;

/**
 * Gets or creates the global WebMcpModelContext instance.
 */
export function getOrCreateGlobalModelContext(): WebMcpModelContext {
  if (!globalModelContextInstance) {
    globalModelContextInstance = new WebMcpModelContext();
  }
  return globalModelContextInstance;
}

/**
 * Ensures document.modelContext and navigator.modelContext are installed in the global scope.
 * If native document.modelContext exists (e.g. Chrome with WebMCPTesting feature enabled),
 * preserves native context and aliases navigator.modelContext to it.
 * Otherwise, polyfills document, navigator, and window with prototype-level definitions.
 */
export function ensureWebMcpInstalled(): WebMcpModelContext {
  // 0. Detect existing native document.modelContext (e.g. Chrome WebMCP flag enabled)
  const docObj = typeof document !== 'undefined' ? (document as unknown as { modelContext?: ModelContext }) : null;
  if (
    docObj &&
    docObj.modelContext &&
    typeof docObj.modelContext.registerTool === 'function' &&
    !(docObj.modelContext instanceof WebMcpModelContext)
  ) {
    const nativeContext = docObj.modelContext as unknown as WebMcpModelContext;

    if (typeof navigator !== 'undefined') {
      try {
        if (!('modelContext' in navigator) || navigator.modelContext !== nativeContext) {
          Object.defineProperty(Navigator.prototype, 'modelContext', {
            get: () => nativeContext,
            configurable: true,
            enumerable: true,
          });
        }
      } catch {}
    }

    if (typeof window !== 'undefined') {
      try {
        (window as unknown as Record<string, unknown>).modelContext = nativeContext;
        (window as unknown as Record<string, unknown>).__webmcp = nativeContext;
        (window as unknown as Record<string, unknown>).webmcp = nativeContext;
      } catch {}
    }

    return nativeContext;
  }

  const context = getOrCreateGlobalModelContext();

  // 1. Navigator / Navigator.prototype
  if (typeof navigator !== 'undefined') {
    if (typeof Navigator !== 'undefined' && Navigator.prototype) {
      try {
        const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'modelContext');
        if (!desc || desc.configurable) {
          Object.defineProperty(Navigator.prototype, 'modelContext', {
            get: () => context,
            set: () => {},
            configurable: true,
            enumerable: true,
          });
        }
      } catch {
        // Fallback handled on instance below
      }
    }

    try {
      const desc = Object.getOwnPropertyDescriptor(navigator, 'modelContext');
      if (!desc || desc.configurable) {
        Object.defineProperty(navigator, 'modelContext', {
          get: () => context,
          set: () => {},
          configurable: true,
          enumerable: true,
        });
      }
    } catch {
      try {
        (navigator as unknown as Record<string, unknown>).modelContext = context;
      } catch {}
    }
  }

  // 2. Document / Document.prototype
  if (typeof document !== 'undefined') {
    if (typeof Document !== 'undefined' && Document.prototype) {
      try {
        const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'modelContext');
        if (!desc || desc.configurable) {
          Object.defineProperty(Document.prototype, 'modelContext', {
            get: () => context,
            set: () => {},
            configurable: true,
            enumerable: true,
          });
        }
      } catch {}
    }

    try {
      const desc = Object.getOwnPropertyDescriptor(document, 'modelContext');
      if (!desc || desc.configurable) {
        Object.defineProperty(document, 'modelContext', {
          get: () => context,
          set: () => {},
          configurable: true,
          enumerable: true,
        });
      }
    } catch {
      try {
        (document as unknown as Record<string, unknown>).modelContext = context;
      } catch {}
    }
  }

  // 3. Window / Window.prototype
  if (typeof window !== 'undefined') {
    if (typeof Window !== 'undefined' && Window.prototype) {
      try {
        const desc = Object.getOwnPropertyDescriptor(Window.prototype, 'modelContext');
        if (!desc || desc.configurable) {
          Object.defineProperty(Window.prototype, 'modelContext', {
            get: () => context,
            set: () => {},
            configurable: true,
            enumerable: true,
          });
        }
      } catch {}
    }

    try {
      const desc = Object.getOwnPropertyDescriptor(window, 'modelContext');
      if (!desc || desc.configurable) {
        Object.defineProperty(window, 'modelContext', {
          get: () => context,
          set: () => {},
          configurable: true,
          enumerable: true,
        });
      }
    } catch {
      try {
        (window as unknown as Record<string, unknown>).modelContext = context;
      } catch {}
    }

    // Attach developer & agent convenience global aliases
    try {
      (window as unknown as Record<string, unknown>).__webmcp = context;
      (window as unknown as Record<string, unknown>).webmcp = context;
    } catch {}
  }

  return context;
}
