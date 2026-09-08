/**
 * Core type definitions for WebMCP (Web Model Context Protocol) integration.
 *
 * Implements W3C Web Machine Learning Community Group draft specification types
 * and error envelopes defined in webmcp-pdf-editor-spec.md.
 */

/**
 * Tool annotations providing metadata hints to AI agents.
 */
export interface ToolAnnotations {
  /** Indicates the tool does not modify state and only reads data. */
  readOnlyHint?: boolean;
  /** Indicates the tool output contains untrusted data. */
  untrustedContentHint?: boolean;
}

/**
 * Options passed to a tool's execute callback.
 */
export interface ToolExecuteCallbackOptions {
  /** Signal that fires if the caller cancels tool execution. */
  signal: AbortSignal;
}

/**
 * Callback signature for executing a registered tool.
 */
export type ToolExecuteCallback<TInput = Record<string, unknown>, TOutput = unknown> = (
  inputObject: TInput,
  options: ToolExecuteCallbackOptions
) => Promise<TOutput>;

/**
 * Standard JSON Schema property definition.
 */
export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: Array<string | number>;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchemaProperty | Record<string, unknown>;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * JSON Schema object describing tool inputs and outputs.
 */
export interface JsonSchema {
  type: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  description?: string;
  additionalProperties?: boolean;
}

/**
 * Definition of a tool registered through WebMCP.
 */
export interface ModelContextTool<TInput = Record<string, unknown>, TOutput = unknown> {
  /** Unique identifier. ASCII alphanumeric, hyphen, underscore, dot. Length 1 to 128. */
  name: string;
  /** Human-readable title for UI display. */
  title?: string;
  /** Natural-language description for AI agent tool selection. Length under 400 chars. */
  description: string;
  /** JSON Schema describing the input parameters. */
  inputSchema: JsonSchema;
  /** Optional JSON Schema describing output format. */
  outputSchema?: JsonSchema;
  /** Execution callback implementing tool logic. */
  execute: ToolExecuteCallback<TInput, TOutput>;
  /** Optional capability annotations. */
  annotations?: ToolAnnotations;
}

/**
 * Options when registering a tool in ModelContext.
 */
export interface ModelContextRegisterToolOptions {
  /** Allowed origins permitted to access this tool. */
  exposedTo?: string[];
  /** Abort signal that unregisters the tool when triggered. */
  signal?: AbortSignal;
}

/**
 * Options when filtering tools via getTools.
 */
export interface ModelContextGetToolOptions {
  /** Origins from which to query tools. */
  fromOrigins?: string[];
}

/**
 * Options when executing a tool via executeTool.
 */
export interface ModelContextExecuteToolOptions {
  /** Abort signal to cancel in-flight execution. */
  signal?: AbortSignal;
}

/**
 * A tool that has been registered and is discoverable by agents.
 */
export interface RegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema | string;
  outputSchema?: JsonSchema | string;
  origin: string;
  window?: unknown;
  annotations?: ToolAnnotations;
  execute?: <TOutput = unknown>(
    inputObject?: Record<string, unknown> | string,
    options?: ModelContextExecuteToolOptions
  ) => Promise<WebMcpResponse<TOutput>>;
}

/**
 * Standard error codes defined in the WebMCP PDF Editor Specification (Section 5.4).
 */
export type WebMcpErrorCode =
  | 'NODE_NOT_FOUND'
  | 'ANCHOR_MISMATCH'
  | 'INVALID_TARGET_TYPE'
  | 'VALIDATION_ERROR'
  | 'CONFIRMATION_REQUIRED'
  | 'RATE_LIMITED'
  | 'LOCKED'
  | 'INTERNAL_ERROR';

/**
 * Detailed error payload in the WebMCP response envelope.
 */
export interface WebMcpError {
  code: WebMcpErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Successful WebMCP response envelope.
 */
export interface WebMcpSuccessResponse<T = unknown> {
  ok: true;
  result: T;
}

/**
 * Failed WebMCP response envelope.
 */
export interface WebMcpErrorResponse {
  ok: false;
  error: WebMcpError;
}

/**
 * Standard tool response envelope (Section 5.4).
 */
export type WebMcpResponse<T = unknown> = WebMcpSuccessResponse<T> | WebMcpErrorResponse;

/**
 * User interaction callback for confirmation flows (Section 2.5).
 */
export type UserInteractionCallback<T = unknown> = () => Promise<T>;

/**
 * Interface definition for ModelContext according to W3C WebMCP draft.
 */
export interface ModelContext extends EventTarget {
  /**
   * Direct access to all currently registered tools.
   */
  readonly tools?: RegisteredTool[];

  /**
   * Registers a tool for discovery and invocation by AI agents.
   * Rejects if tool name is invalid or already registered.
   */
  registerTool<TInput = Record<string, unknown>, TOutput = unknown>(
    tool: ModelContextTool<TInput, TOutput>,
    options?: ModelContextRegisterToolOptions
  ): Promise<void>;

  /**
   * Unregisters a previously registered tool by name.
   */
  unregisterTool(name: string): void;

  /**
   * Returns a list of all registered tools matching filter criteria.
   */
  getTools(options?: ModelContextGetToolOptions): Promise<RegisteredTool[]>;

  /**
   * Executes a registered tool with input arguments. Accepts tool descriptor or tool name string, and object or JSON string parameters.
   */
  executeTool<TOutput = unknown>(
    tool: RegisteredTool | { name: string } | string,
    inputObject?: Record<string, unknown> | string,
    options?: ModelContextExecuteToolOptions
  ): Promise<WebMcpResponse<TOutput>>;

  /**
   * Bulk context provider method.
   */
  provideContext?(context: { tools?: ModelContextTool[] }): Promise<void>;

  /**
   * Pauses execution to request explicit user interaction/confirmation.
   */
  requestUserInteraction<T = unknown>(callback: UserInteractionCallback<T>): Promise<T>;

  /**
   * Event handler for tool registration or removal events.
   */
  ontoolchange: ((this: ModelContext, ev: Event) => void) | null;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    modelContext?: ModelContext;
  }
  interface Window {
    modelContext?: ModelContext;
    __webmcp?: unknown;
    webmcp?: unknown;
  }
}


