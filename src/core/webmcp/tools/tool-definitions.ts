/**
 * WebMCP Tool Definitions and Execution Handlers.
 *
 * Implements the complete tool catalogue defined in Section 6 of
 * webmcp-pdf-editor-spec.md with JSON schema validation, anchor verification,
 * concurrency locking, rate limiting, and destructive operation containment.
 */

import type { PdfDocument } from '../../../services/pdf/pdf-document';
import type { EditorStore } from '../../../stores/editor.svelte';
import type { CanvasStore } from '../../../stores/canvas.svelte';
import type { EditorActions } from '../../../stores/editor-actions';
import type { HistoryStore } from '../../../stores/history.svelte';
import type { ModelContextTool, WebMcpResponse } from '../webmcp-types';
import type { SdgBuilder } from '../sdg/sdg-builder';
import type { SdgLock } from '../safety/sdg-lock';
import type { RateLimiter } from '../safety/rate-limiter';
import type { ProposalStore } from '../safety/proposal-store';
import type { SdgNode, SdgConciseNode, SdgRun, SdgNodeType } from '../sdg/sdg-types';
import type { CanvasElement, ShapeVariant, FormFieldVariant, FormFieldElement, ShapeElement, TextElement } from '../../../stores/canvas-types';
import type { DocumentMetadataUpdate, SanitizeOptions, CompressOptions, CompressSummary, CompressionLevel, HighlightRect, EditableSpan } from '../../types';
import type { ImpositionConfig } from '../../../services/pdf/operations/types';
import { verifyAnchorMatch, normalizeText } from '../sdg/sdg-normalizer';
import { ReplaceTextCommand, PositionTextCommand } from '../../../commands';
import { getUnifiedPageCharacters, calculateUnifiedHighlightRects } from '../../../services/pdf/unified-text-provider';
import { applyStyleToCanvasElement } from '../../../utils/text-range-utils';
import { getSavedSignatures, saveSignature, getDefaultSignature, type SavedSignature } from '../../../services/signature-storage';
import { documentConverter, type DocumentConversionOptions } from '../../../services/conversion';
import { OcrService } from '../../../services/ocr';

const SPEC_VERSION = '1.0.0';

/**
 * Converts a base64 string to a Uint8Array.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  const binaryString = atob(clean);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Converts a Uint8Array to a base64 string.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Execution context providing access to document facades, stores, and safety locks.
 */
export interface WebMcpContext {
  pdfDoc: PdfDocument;
  editorStore: EditorStore;
  canvasStore?: CanvasStore | null;
  editorActions?: EditorActions | null;
  historyStore?: HistoryStore | null;
  sdgBuilder: SdgBuilder;
  sdgLock: SdgLock;
  rateLimiter: RateLimiter;
  proposalStore: ProposalStore;
  requestUserConfirmation: (title: string, description: string) => Promise<boolean>;
  onAgentMutation: (details: { page: number; nodeId?: string; description: string }) => void;
}

/**
 * Creates the complete array of WebMCP tool definitions bound to the active context.
 */
export function createWebMcpTools(ctx: WebMcpContext): Array<ModelContextTool<Record<string, unknown>, unknown>> {
  const tools: Array<ModelContextTool<Record<string, unknown>, unknown>> = [];

  // Helper to ensure SDG is ready
  const getSdg = (): ReturnType<typeof ctx.sdgBuilder.getGraph> => {
    let graph = ctx.sdgBuilder.getGraph();
    if (!graph) {
      graph = ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);
    }
    return graph;
  };

  // Helper for mutation safety check (Rate Limiter)
  const checkMutationPreconditions = (_toolCallId: string): WebMcpResponse<never> | null => {
    const rateCheck = ctx.rateLimiter.checkLimit();
    if (!rateCheck.allowed) {
      return {
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Mutation rate limit exceeded. Please wait before issuing further writes.',
          details: { retryAfterMs: rateCheck.retryAfterMs ?? 2000 },
        },
      };
    }
    return null;
  };

  // ---------------------------------------------------------------------------
  // 1. Discovery and Read Tools (Section 6.4)
  // ---------------------------------------------------------------------------

  // pdf.getOutline
  tools.push({
    name: 'pdf.getOutline',
    title: 'Get Document Outline',
    description: 'Retrieves the document heading hierarchy and outline bookmarks without body text.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async (): Promise<WebMcpResponse<{ nodes: Array<{ id: string; type: string; level?: number; page: number; text: string }> }>> => {
      const graph = getSdg();
      const headingNodes: Array<{ id: string; type: string; level?: number; page: number; text: string }> = [];

      if (graph) {
        for (const node of graph.nodes.values()) {
          if (node.type === 'heading') {
            headingNodes.push({
              id: node.id,
              type: node.type,
              level: node.level,
              page: node.page,
              text: node.text,
            });
          }
        }
      }

      return {
        ok: true,
        result: { nodes: headingNodes },
      };
    },
  });

  // pdf.addOutlineItem
  tools.push({
    name: 'pdf.addOutlineItem',
    title: 'Add Outline Item',
    description: 'Adds a bookmark heading to the document outline hierarchy, with optional automatic level inference.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the outline bookmark.' },
        pageIndex: { type: 'number', description: 'Zero-based page index to navigate to.' },
        level: { type: 'number', description: 'Heading level from 1 to 6. If omitted, level is automatically inferred.' },
      },
      required: ['title', 'pageIndex'],
    },
    execute: async (args: Record<string, unknown>): Promise<WebMcpResponse<{ title: string; pageIndex: number; level?: number }>> => {
      const title = String(args.title || '').trim();
      const pageIndex = Number(args.pageIndex ?? 0);
      const level = typeof args.level === 'number' ? args.level : undefined;

      if (!title) {
        return {
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'Bookmark title cannot be empty.' },
        };
      }

      if (!ctx.editorActions) {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'Editor actions not initialized.' },
        };
      }

      await ctx.editorActions.addTextToOutline({
        title,
        pageIndex,
        level,
      });

      return {
        ok: true,
        result: { title, pageIndex, level },
      };
    },
  });

  // pdf.reorderOutline
  tools.push({
    name: 'pdf.reorderOutline',
    title: 'Reorder Outline Items',
    description: 'Reorders outline bookmarks by moving items from specified indices to a target index.',
    inputSchema: {
      type: 'object',
      properties: {
        fromIndices: {
          type: 'array',
          items: { type: 'number' },
          description: 'Indices of the outline items to move.',
        },
        toIndex: {
          type: 'number',
          description: 'Target index to move the outline items to.',
        },
      },
      required: ['fromIndices', 'toIndex'],
    },
    execute: async (args: Record<string, unknown>): Promise<WebMcpResponse<{ success: boolean }>> => {
      const fromIndices = Array.isArray(args.fromIndices) ? (args.fromIndices as number[]) : [];
      const toIndex = Number(args.toIndex ?? 0);

      if (fromIndices.length === 0) {
        return {
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'fromIndices must not be empty.' },
        };
      }

      if (!ctx.editorActions) {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'Editor actions not initialized.' },
        };
      }

      await ctx.editorActions.reorderOutline(fromIndices, toIndex);

      return {
        ok: true,
        result: { success: true },
      };
    },
  });

  // pdf.sortOutlineTopToBottom
  tools.push({
    name: 'pdf.sortOutlineTopToBottom',
    title: 'Sort Outline Top to Bottom',
    description: 'Sorts document outline bookmarks top to bottom in document reading order by page and vertical position.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async (): Promise<WebMcpResponse<{ success: boolean }>> => {
      if (!ctx.editorActions) {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'Editor actions not initialized.' },
        };
      }

      await ctx.editorActions.sortOutlineTopToBottom();

      return {
        ok: true,
        result: { success: true },
      };
    },
  });

  // pdf.generateOutline
  tools.push({
    name: 'pdf.generateOutline',
    title: 'Generate Outline',
    description: 'Scans document pages for headings (H1 to H3) and automatically generates an outline.',
    inputSchema: {
      type: 'object',
      properties: {
        maxLevel: {
          type: 'number',
          description: 'Maximum heading level to extract (1 to 6, default 3).',
        },
      },
    },
    execute: async (args: Record<string, unknown>): Promise<WebMcpResponse<{ success: boolean }>> => {
      const maxLevel = typeof args.maxLevel === 'number' ? args.maxLevel : undefined;

      if (!ctx.editorActions) {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'Editor actions not initialized.' },
        };
      }

      await ctx.editorActions.generateAutomaticOutline({ maxLevel });

      return {
        ok: true,
        result: { success: true },
      };
    },
  });

  // pdf.listBlocks
  tools.push({
    name: 'pdf.listBlocks',
    title: 'List Document Blocks',
    description: 'Returns a filtered, paginated list of semantic document blocks in reading order.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Zero-indexed page number filter.' },
        types: { type: 'array', items: { type: 'string' }, description: 'Array of block types to filter.' },
        query: { type: 'string', description: 'Case-insensitive text substring filter.' },
        cursor: { type: 'string', description: 'Pagination cursor identifier.' },
        maxResults: { type: 'integer', default: 50, maximum: 200, description: 'Max blocks to return (default 50).' },
        detail: { type: 'string', enum: ['concise', 'full'], default: 'concise', description: 'Level of detail.' },
      },
    },
    execute: async (input): Promise<WebMcpResponse<{ nodes: Array<SdgNode | SdgConciseNode>; nextCursor: string | null }>> => {
      const graph = getSdg();
      if (!graph) {
        return { ok: true, result: { nodes: [], nextCursor: null } };
      }

      const pageFilter = typeof input.page === 'number' ? input.page : undefined;
      const typesFilter = Array.isArray(input.types) ? (input.types as string[]) : undefined;
      const queryFilter = typeof input.query === 'string' ? input.query.toLowerCase() : undefined;
      const cursor = typeof input.cursor === 'string' ? input.cursor : undefined;
      const maxResults = Math.min(200, Math.max(1, typeof input.maxResults === 'number' ? input.maxResults : 50));
      const detail = input.detail === 'full' ? 'full' : 'concise';

      let allNodes: SdgNode[] = [];
      for (const id of graph.rootIds) {
        const node = graph.nodes.get(id);
        if (node) allNodes.push(node);
      }

      if (pageFilter !== undefined) {
        allNodes = allNodes.filter((n) => n.page === pageFilter);
      }
      if (typesFilter && typesFilter.length > 0) {
        allNodes = allNodes.filter((n) => typesFilter.includes(n.type));
      }
      if (queryFilter) {
        allNodes = allNodes.filter((n) => n.text.toLowerCase().includes(queryFilter));
      }

      let startIndex = 0;
      if (cursor) {
        const foundIndex = allNodes.findIndex((n) => n.id === cursor);
        if (foundIndex !== -1) {
          startIndex = foundIndex + 1;
        }
      }

      const slice = allNodes.slice(startIndex, startIndex + maxResults);
      const nextCursor = startIndex + maxResults < allNodes.length ? slice[slice.length - 1]?.id ?? null : null;

      const formattedNodes: Array<SdgNode | SdgConciseNode> = slice.map((n) => {
        if (detail === 'full') {
          return n;
        }
        return {
          id: n.id,
          type: n.type,
          level: n.level,
          page: n.page,
          text: n.text,
        };
      });

      return {
        ok: true,
        result: {
          nodes: formattedNodes,
          nextCursor,
        },
      };
    },
  });

  // pdf.getBlock
  tools.push({
    name: 'pdf.getBlock',
    title: 'Get Block by ID',
    description: 'Retrieves full details and layout metrics for a specific SDG node by identifier.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Stable node identifier.' },
      },
      required: ['id'],
    },
    execute: async (input): Promise<WebMcpResponse<SdgNode>> => {
      const id = typeof input.id === 'string' ? input.id : '';
      const graph = getSdg();
      const node = graph?.nodes.get(id);

      if (!node) {
        return {
          ok: false,
          error: {
            code: 'NODE_NOT_FOUND',
            message: `Node with identifier "${id}" does not exist in the active document.`,
            details: { id },
          },
        };
      }

      return {
        ok: true,
        result: node,
      };
    },
  });

  // pdf.getPageText
  tools.push({
    name: 'pdf.getPageText',
    title: 'Get Page Text in Reading Order',
    description: 'Extracts full plain text of a page ordered by column geometry with reading confidence.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Zero-indexed page number.' },
      },
      required: ['page'],
    },
    execute: async (input): Promise<WebMcpResponse<{ page: number; text: string; readingOrderConfidence: number }>> => {
      const pageIndex = typeof input.page === 'number' ? input.page : -1;
      const pageCount = ctx.pdfDoc.getPageCount();

      if (pageIndex < 0 || pageIndex >= pageCount) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Page index ${pageIndex} is out of bounds (0 to ${pageCount - 1}).`,
            details: { pageIndex, pageCount },
          },
        };
      }

      const graph = getSdg();
      const pageNodes: SdgNode[] = [];
      let minConfidence = 1.0;

      if (graph) {
        for (const id of graph.rootIds) {
          const node = graph.nodes.get(id);
          if (node && node.page === pageIndex) {
            pageNodes.push(node);
            if (node.readingOrderConfidence !== undefined) {
              minConfidence = Math.min(minConfidence, node.readingOrderConfidence);
            }
          }
        }
      }

      const fullText = pageNodes
        .map((n) => n.text)
        .filter((t) => t.length > 0)
        .join('\n\n');

      return {
        ok: true,
        result: {
          page: pageIndex,
          text: fullText,
          readingOrderConfidence: minConfidence,
        },
      };
    },
  });

  // pdf.searchText
  tools.push({
    name: 'pdf.searchText',
    title: 'Search Text Across Document',
    description: 'Searches for text query occurrences across all document blocks with contextual snippets.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term or phrase.' },
        maxResults: { type: 'integer', default: 20, description: 'Maximum search results to return.' },
      },
      required: ['query'],
    },
    execute: async (input): Promise<WebMcpResponse<{ matches: Array<{ id: string; page: number; snippet: string }> }>> => {
      const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
      if (!query) {
        return { ok: true, result: { matches: [] } };
      }

      const maxResults = Math.max(1, typeof input.maxResults === 'number' ? input.maxResults : 20);
      const graph = getSdg();
      const matches: Array<{ id: string; page: number; snippet: string }> = [];

      if (graph) {
        for (const id of graph.rootIds) {
          const node = graph.nodes.get(id);
          if (node && node.text) {
            const lower = node.text.toLowerCase();
            const matchPos = lower.indexOf(query);
            if (matchPos !== -1) {
              const start = Math.max(0, matchPos - 30);
              const end = Math.min(node.text.length, matchPos + query.length + 30);
              const snippet = (start > 0 ? '...' : '') + node.text.substring(start, end).trim() + (end < node.text.length ? '...' : '');
              matches.push({
                id: node.id,
                page: node.page,
                snippet,
              });
              if (matches.length >= maxResults) {
                break;
              }
            }
          }
        }
      }

      return {
        ok: true,
        result: { matches },
      };
    },
  });

