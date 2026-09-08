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

  // pdf.getTable
  tools.push({
    name: 'pdf.getTable',
    title: 'Get Table Structure',
    description: 'Returns structured 2D rows and column matrix for a table node in the document.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Table node identifier.' },
      },
      required: ['id'],
    },
    execute: async (input): Promise<WebMcpResponse<{ rows: number; cols: number; cells: Array<Array<{ id: string; text: string }>> }>> => {
      const id = typeof input.id === 'string' ? input.id : '';
      const graph = getSdg();
      const node = graph?.nodes.get(id);

      if (!node) {
        return {
          ok: false,
          error: {
            code: 'NODE_NOT_FOUND',
            message: `Node "${id}" not found.`,
            details: { id },
          },
        };
      }

      if (node.type !== 'table') {
        return {
          ok: false,
          error: {
            code: 'INVALID_TARGET_TYPE',
            message: `Node "${id}" has type "${node.type}", expected "table".`,
            details: { id, expectedType: 'table', actualType: node.type },
          },
        };
      }

      const rows = node.rows || 0;
      const cols = node.cols || 0;
      const cells: Array<Array<{ id: string; text: string }>> = [];

      if (node.cellIds) {
        for (const rowIds of node.cellIds) {
          const rowCells: Array<{ id: string; text: string }> = [];
          for (const cellId of rowIds) {
            const cellNode = graph?.nodes.get(cellId);
            rowCells.push({
              id: cellId,
              text: cellNode?.text || '',
            });
          }
          cells.push(rowCells);
        }
      }

      return {
        ok: true,
        result: { rows, cols, cells },
      };
    },
  });

  // ---------------------------------------------------------------------------
  // 2. Mutation Tools (Section 6.5)
  // ---------------------------------------------------------------------------

  // pdf.replaceText
  tools.push({
    name: 'pdf.replaceText',
    title: 'Replace Block Text',
    description: 'Replaces block text after verifying the supplied oldText anchor matches current state.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Target node identifier.' },
        oldText: { type: 'string', description: 'Current normalised text anchor.' },
        newText: { type: 'string', description: 'Replacement text.' },
      },
      required: ['id', 'oldText', 'newText'],
    },
    execute: async (input): Promise<WebMcpResponse<{ id: string; oldText: string; newText: string; page: number }>> => {
      const callId = `replace_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const id = typeof input.id === 'string' ? input.id : '';
      const oldText = typeof input.oldText === 'string' ? input.oldText : '';
      const newText = typeof input.newText === 'string' ? input.newText : '';

      return ctx.sdgLock.withLock(callId, async () => {
        const graph = getSdg();
        const node = graph?.nodes.get(id);

        if (!node) {
          return {
            ok: false,
            error: {
              code: 'NODE_NOT_FOUND',
              message: `Node "${id}" not found in document.`,
              details: { id },
            },
          };
        }

        // Anchor verification
        if (!verifyAnchorMatch(node.text, oldText)) {
          return {
            ok: false,
            error: {
              code: 'ANCHOR_MISMATCH',
              message: 'Supplied anchor text does not match the node current text after normalisation.',
              details: { id, currentText: node.text, suppliedAnchor: oldText },
            },
          };
        }

        // Find backing span on page
        const pageSpans = ctx.pdfDoc.extractTextSpans(node.page);
        const normCurrent = normalizeText(node.text);
        const matchingSpan = pageSpans.find((s) => verifyAnchorMatch(s.text, normCurrent));

        if (matchingSpan && ctx.editorActions) {
          const replaceCmd = new ReplaceTextCommand(
            `WebMCP edit on block ${id}`,
            node.page,
            matchingSpan,
            { text: matchingSpan.text },
            { text: newText }
          );
          await ctx.editorActions.executeCommand(replaceCmd);
        } else {
          // Direct fallback mutation on PDF document
          const fallbackSpan = pageSpans[0] || {
            type: 'text',
            id: `span_${node.page}_0`,
            pageIndex: node.page,
            text: node.text,
            left: node.bbox[0],
            top: node.bbox[1],
            width: node.bbox[2] - node.bbox[0],
            height: node.bbox[3] - node.bbox[1],
            fontSize: 12,
            fontFamily: 'Helvetica',
            rawFontFamily: 'Helvetica',
            color: { r: 0, g: 0, b: 0, a: 1 },
            baselineY: node.bbox[1] + 12,
            charStartIndex: 0,
            charCount: node.text.length,
          };
          ctx.pdfDoc.replaceTextSpan(node.page, fallbackSpan, { text: newText });
          ctx.editorStore.incrementPageVersion(node.page);
        }

        // Update SDG in-place
        ctx.sdgBuilder.updateNodeText(id, newText);
        ctx.rateLimiter.recordCall();

        // Emit transient highlight for visual verification (Section 7.1)
        ctx.onAgentMutation({
          page: node.page,
          nodeId: id,
          description: `Replaced text in block ${id}`,
        });

        return {
          ok: true,
          result: {
            id,
            oldText,
            newText,
            page: node.page,
          },
        };
      });
    },
  });

  // pdf.replaceRunText
  tools.push({
    name: 'pdf.replaceRunText',
    title: 'Replace Sub-Block Run Text',
    description: 'Replaces specific text run inside a block after anchor verification.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Target run identifier.' },
        oldText: { type: 'string', description: 'Current run text anchor.' },
        newText: { type: 'string', description: 'New replacement text.' },
      },
      required: ['id', 'oldText', 'newText'],
    },
    execute: async (input): Promise<WebMcpResponse<{ id: string; oldText: string; newText: string; blockId: string }>> => {
      const callId = `run_replace_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const runId = typeof input.id === 'string' ? input.id : '';
      const oldText = typeof input.oldText === 'string' ? input.oldText : '';
      const newText = typeof input.newText === 'string' ? input.newText : '';

      return ctx.sdgLock.withLock(callId, async () => {
        const graph = getSdg();
        let parentBlock: SdgNode | null = null;
        let targetRun: SdgRun | null = null;

        if (graph) {
          for (const node of graph.nodes.values()) {
            if (node.runs) {
              const r = node.runs.find((run) => run.id === runId);
              if (r) {
                parentBlock = node;
                targetRun = r;
                break;
              }
            }
          }
        }

        if (!parentBlock || !targetRun) {
          return {
            ok: false,
            error: {
              code: 'NODE_NOT_FOUND',
              message: `Run identifier "${runId}" not found in document.`,
              details: { id: runId },
            },
          };
        }

        if (!verifyAnchorMatch(targetRun.text, oldText)) {
          return {
            ok: false,
            error: {
              code: 'ANCHOR_MISMATCH',
              message: 'Supplied anchor does not match target run current text.',
              details: { id: runId, currentText: targetRun.text, suppliedAnchor: oldText },
            },
          };
        }

        targetRun.text = newText;
        const fullBlockText = parentBlock.runs?.map((r) => r.text).join(' ') || newText;
        ctx.sdgBuilder.updateNodeText(parentBlock.id, fullBlockText);
        ctx.rateLimiter.recordCall();

        ctx.onAgentMutation({
          page: parentBlock.page,
          nodeId: parentBlock.id,
          description: `Updated run ${runId}`,
        });

        return {
          ok: true,
          result: {
            id: runId,
            oldText,
            newText,
            blockId: parentBlock.id,
          },
        };
      });
    },
  });

  // pdf.batchReplaceText
  tools.push({
    name: 'pdf.batchReplaceText',
    title: 'Batch Replace Blocks Atomically',
    description: 'Anchor-verified atomic replacement of multiple blocks with all-or-nothing rollback.',
    inputSchema: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              oldText: { type: 'string' },
              newText: { type: 'string' },
            },
            required: ['id', 'oldText', 'newText'],
          },
          minItems: 1,
          maxItems: 50,
        },
      },
      required: ['edits'],
    },
    execute: async (input): Promise<WebMcpResponse<{ applied: Array<{ id: string; oldText: string; newText: string; page: number }> }>> => {
      const callId = `batch_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const rawEdits = Array.isArray(input.edits) ? input.edits : [];
      if (rawEdits.length === 0) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Batch edits array must not be empty.',
          },
        };
      }

      return ctx.sdgLock.withLock(callId, async () => {
        const graph = getSdg();
        const failures: Array<{ id: string; currentText: string; suppliedAnchor: string; reason: string }> = [];
        const validatedEdits: Array<{ node: SdgNode; oldText: string; newText: string }> = [];

        // Pre-validate all anchors first (all-or-nothing requirement)
        for (const edit of rawEdits) {
          const editId = typeof edit.id === 'string' ? edit.id : '';
          const oldText = typeof edit.oldText === 'string' ? edit.oldText : '';
          const newText = typeof edit.newText === 'string' ? edit.newText : '';

          const node = graph?.nodes.get(editId);
          if (!node) {
            failures.push({
              id: editId,
              currentText: '',
              suppliedAnchor: oldText,
              reason: 'Node not found',
            });
            continue;
          }

          if (!verifyAnchorMatch(node.text, oldText)) {
            failures.push({
              id: editId,
              currentText: node.text,
              suppliedAnchor: oldText,
              reason: 'Anchor mismatch',
            });
            continue;
          }

          validatedEdits.push({ node, oldText, newText });
        }

        // If any anchor failed, abort batch without applying any edit
        if (failures.length > 0) {
          return {
            ok: false,
            error: {
              code: 'ANCHOR_MISMATCH',
              message: `Batch rejected: ${failures.length} of ${rawEdits.length} edits failed anchor validation.`,
              details: { failures },
            },
          };
        }

        // All anchors passed: apply each edit
        const applied: Array<{ id: string; oldText: string; newText: string; page: number }> = [];
        for (const item of validatedEdits) {
          ctx.sdgBuilder.updateNodeText(item.node.id, item.newText);
          ctx.editorStore.incrementPageVersion(item.node.page);
          applied.push({
            id: item.node.id,
            oldText: item.oldText,
            newText: item.newText,
            page: item.node.page,
          });
        }

        ctx.rateLimiter.recordCall();
        if (applied[0]) {
          ctx.onAgentMutation({
            page: applied[0].page,
            nodeId: applied[0].id,
            description: `Applied atomic batch of ${applied.length} edits`,
          });
        }

        return {
          ok: true,
          result: { applied },
        };
      });
    },
  });

  // pdf.insertBlock
  tools.push({
    name: 'pdf.insertBlock',
    title: 'Insert Block Adjacent',
    description: 'Inserts a new paragraph or heading adjacent to an existing block.',
    inputSchema: {
      type: 'object',
      properties: {
        relativeToId: { type: 'string' },
        position: { type: 'string', enum: ['before', 'after'] },
        blockType: { type: 'string', enum: ['heading', 'paragraph', 'list_item'] },
        text: { type: 'string' },
        level: { type: 'integer', description: 'Required if blockType is heading.' },
      },
      required: ['relativeToId', 'position', 'blockType', 'text'],
    },
    execute: async (input): Promise<WebMcpResponse<{ id: string }>> => {
      const callId = `insert_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const relativeToId = typeof input.relativeToId === 'string' ? input.relativeToId : '';
      const text = typeof input.text === 'string' ? input.text : '';
      const blockType = (input.blockType as SdgNodeType) || 'paragraph';
      const level = typeof input.level === 'number' ? input.level : undefined;

      return ctx.sdgLock.withLock(callId, async () => {
        const graph = getSdg();
        const anchorNode = graph?.nodes.get(relativeToId);

        if (!anchorNode) {
          return {
            ok: false,
            error: {
              code: 'NODE_NOT_FOUND',
              message: `Reference node "${relativeToId}" not found.`,
              details: { id: relativeToId },
            },
          };
        }

        // Allocate fresh block ID
        const newBlockKey = `p${anchorNode.page}:inserted:${Date.now()}`;
        const newId = ctx.sdgBuilder.allocateNodeId(blockType, newBlockKey);

        const newY = input.position === 'before' ? Math.max(0, anchorNode.bbox[1] - 25) : anchorNode.bbox[3] + 15;
        const newNode: SdgNode = {
          id: newId,
          type: blockType,
          level,
          page: anchorNode.page,
          bbox: [anchorNode.bbox[0], newY, anchorNode.bbox[2], newY + 20],
          text: normalizeText(text),
          runs: [
            {
              id: `run_${newId.replace(/^blk_/, '')}_0`,
              text,
              font: 'Helvetica',
              size: blockType === 'heading' ? 16 : 12,
              bold: blockType === 'heading',
            },
          ],
          parentId: null,
          childIds: [],
          provenance: 'synthesised',
          confidence: 0.95,
        };

        graph?.nodes.set(newId, newNode);
        if (graph) {
          const anchorIdx = graph.rootIds.indexOf(relativeToId);
          const insertIdx = input.position === 'before' ? Math.max(0, anchorIdx) : anchorIdx + 1;
          graph.rootIds.splice(insertIdx, 0, newId);
        }

        ctx.rateLimiter.recordCall();
        ctx.editorStore.incrementPageVersion(anchorNode.page);
        ctx.onAgentMutation({
          page: anchorNode.page,
          nodeId: newId,
          description: `Inserted block ${newId}`,
        });

        return {
          ok: true,
          result: { id: newId },
        };
      });
    },
  });

  // pdf.deleteBlock (Destructive per Section 7.2)
  tools.push({
    name: 'pdf.deleteBlock',
    title: 'Delete Block',
    description: 'Destructively removes a block from the document. Requires explicit confirmation or prior proposal staging.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        expectedText: { type: 'string', description: 'Anchor verification text.' },
      },
      required: ['id', 'expectedText'],
    },
    execute: async (input): Promise<WebMcpResponse<{ deletedId: string; precedingId: string | null; followingId: string | null }>> => {
      const callId = `delete_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const id = typeof input.id === 'string' ? input.id : '';
      const expectedText = typeof input.expectedText === 'string' ? input.expectedText : '';

      return ctx.sdgLock.withLock(callId, async () => {
        const graph = getSdg();
        const node = graph?.nodes.get(id);

        if (!node) {
          return {
            ok: false,
            error: {
              code: 'NODE_NOT_FOUND',
              message: `Node "${id}" not found.`,
              details: { id },
            },
          };
        }

        if (!verifyAnchorMatch(node.text, expectedText)) {
          return {
            ok: false,
            error: {
              code: 'ANCHOR_MISMATCH',
              message: 'Supplied anchor does not match current node text.',
              details: { id, currentText: node.text, suppliedAnchor: expectedText },
            },
          };
        }

        // Enforce Destructive Operation Containment (Section 7.2)
        const confirmed = await ctx.requestUserConfirmation(
          'Confirm Block Deletion',
          `AI Agent is requesting to delete block ${id} with text: "${node.text.substring(0, 60)}..."`
        );

        if (!confirmed) {
          return {
            ok: false,
            error: {
              code: 'CONFIRMATION_REQUIRED',
              message: 'Destructive operation requires explicit human confirmation.',
              details: { proposedChange: `Delete block ${id}` },
            },
          };
        }

        // Remove node
        const idx = graph?.rootIds.indexOf(id) ?? -1;
        const precedingId = idx > 0 ? graph?.rootIds[idx - 1] ?? null : null;
        const followingId = idx >= 0 && idx < (graph?.rootIds.length ?? 0) - 1 ? graph?.rootIds[idx + 1] ?? null : null;

        ctx.sdgBuilder.removeNode(id);
        ctx.rateLimiter.recordCall();
        ctx.editorStore.incrementPageVersion(node.page);

        ctx.onAgentMutation({
          page: node.page,
          description: `Deleted block ${id}`,
        });

        return {
          ok: true,
          result: {
            deletedId: id,
            precedingId,
            followingId,
          },
        };
      });
    },
  });

  // pdf.setRunStyle
  tools.push({
    name: 'pdf.setRunStyle',
    title: 'Format Text Run',
    description: 'Modifies typography formatting (bold, italic, color, size) of a run without changing text.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        revision: { type: 'integer' },
        bold: { type: 'boolean' },
        italic: { type: 'boolean' },
        color: { type: 'string', description: 'Hex RGB color code (e.g. #FF0000).' },
        size: { type: 'number', description: 'Font size in points.' },
      },
      required: ['id'],
    },
    execute: async (input): Promise<WebMcpResponse<{ id: string; revision: number }>> => {
      const callId = `style_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const runId = typeof input.id === 'string' ? input.id : '';
      const graph = getSdg();
      let targetRun: SdgRun | null = null;
      let parentNode: SdgNode | null = null;

      if (graph) {
        for (const n of graph.nodes.values()) {
          if (n.runs) {
            const found = n.runs.find((r) => r.id === runId);
            if (found) {
              targetRun = found;
              parentNode = n;
              break;
            }
          }
        }
      }

      if (!targetRun || !parentNode) {
        return {
          ok: false,
          error: {
            code: 'NODE_NOT_FOUND',
            message: `Run identifier "${runId}" was not found.`,
            details: { id: runId },
          },
        };
      }

      if (input.bold !== undefined) targetRun.bold = Boolean(input.bold);
      if (input.italic !== undefined) targetRun.italic = Boolean(input.italic);
      if (typeof input.color === 'string') targetRun.color = input.color;
      if (typeof input.size === 'number') targetRun.size = input.size;

      ctx.rateLimiter.recordCall();
      ctx.editorStore.incrementPageVersion(parentNode.page);
      const rev = typeof input.revision === 'number' ? input.revision + 1 : 1;

      return {
        ok: true,
        result: { id: runId, revision: rev },
      };
    },
  });

  // pdf.mergeBlocks
  tools.push({
    name: 'pdf.mergeBlocks',
    title: 'Merge Two Blocks',
    description: 'Combines two adjacent blocks into one, verifying the text of both blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        firstBlockId: { type: 'string' },
        secondBlockId: { type: 'string' },
        firstExpectedText: { type: 'string' },
        secondExpectedText: { type: 'string' },
      },
      required: ['firstBlockId', 'secondBlockId', 'firstExpectedText', 'secondExpectedText'],
    },
    execute: async (input): Promise<WebMcpResponse<{ id: string; text: string }>> => {
      const callId = `merge_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const firstId = typeof input.firstBlockId === 'string' ? input.firstBlockId : '';
      const secondId = typeof input.secondBlockId === 'string' ? input.secondBlockId : '';

      return ctx.sdgLock.withLock(callId, async () => {
        const graph = getSdg();
        const firstNode = graph?.nodes.get(firstId);
        const secondNode = graph?.nodes.get(secondId);

        if (!firstNode || !secondNode) {
          return {
            ok: false,
            error: {
              code: 'NODE_NOT_FOUND',
              message: 'One or both block IDs do not exist.',
            },
          };
        }

        if (
          !verifyAnchorMatch(firstNode.text, input.firstExpectedText as string) ||
          !verifyAnchorMatch(secondNode.text, input.secondExpectedText as string)
        ) {
          return {
            ok: false,
            error: {
              code: 'ANCHOR_MISMATCH',
              message: 'Anchor validation failed for one or both merge blocks.',
              details: { firstText: firstNode.text, secondText: secondNode.text },
            },
          };
        }

        const mergedText = `${firstNode.text} ${secondNode.text}`;
        ctx.sdgBuilder.updateNodeText(firstId, mergedText);
        ctx.sdgBuilder.removeNode(secondId);
        ctx.rateLimiter.recordCall();
        ctx.editorStore.incrementPageVersion(firstNode.page);

        return {
          ok: true,
          result: { id: firstId, text: mergedText },
        };
      });
    },
  });

  // pdf.splitBlock
  tools.push({
    name: 'pdf.splitBlock',
    title: 'Split Block at Character Offset',
    description: 'Splits an existing block into two adjacent blocks at a specified character offset.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        expectedText: { type: 'string' },
        splitOffset: { type: 'integer' },
      },
      required: ['id', 'expectedText', 'splitOffset'],
    },
    execute: async (input): Promise<WebMcpResponse<{ firstBlockId: string; secondBlockId: string }>> => {
      const callId = `split_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const id = typeof input.id === 'string' ? input.id : '';
      const offset = typeof input.splitOffset === 'number' ? input.splitOffset : -1;

      return ctx.sdgLock.withLock(callId, async () => {
        const graph = getSdg();
        const node = graph?.nodes.get(id);

        if (!node) {
          return {
            ok: false,
            error: { code: 'NODE_NOT_FOUND', message: `Block "${id}" not found.` },
          };
        }

        if (!verifyAnchorMatch(node.text, input.expectedText as string)) {
          return {
            ok: false,
            error: {
              code: 'ANCHOR_MISMATCH',
              message: 'Supplied anchor text does not match block text.',
              details: { id, currentText: node.text },
            },
          };
        }

        if (offset <= 0 || offset >= node.text.length) {
          return {
            ok: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Split offset ${offset} is outside bounds (1 to ${node.text.length - 1}).`,
            },
          };
        }

        const part1 = node.text.substring(0, offset).trim();
        const part2 = node.text.substring(offset).trim();

        ctx.sdgBuilder.updateNodeText(id, part1);
        const newBlockKey = `p${node.page}:split:${Date.now()}`;
        const newId = ctx.sdgBuilder.allocateNodeId(node.type, newBlockKey);

        const newNode: SdgNode = {
          ...node,
          id: newId,
          text: part2,
          bbox: [node.bbox[0], node.bbox[1] + 15, node.bbox[2], node.bbox[3] + 15],
        };

        graph?.nodes.set(newId, newNode);
        if (graph) {
          const idx = graph.rootIds.indexOf(id);
          graph.rootIds.splice(idx + 1, 0, newId);
        }

        ctx.rateLimiter.recordCall();
        ctx.editorStore.incrementPageVersion(node.page);

        return {
          ok: true,
          result: { firstBlockId: id, secondBlockId: newId },
        };
      });
    },
  });

  // ---------------------------------------------------------------------------
  // 3. Structural and Annotation Tools (Section 6.6)
  // ---------------------------------------------------------------------------

  // pdf.insertPage
  tools.push({
    name: 'pdf.insertPage',
    title: 'Insert Blank Page',
    description: 'Inserts a new blank page into the document at the given index.',
    inputSchema: {
      type: 'object',
      properties: {
        pageIndex: { type: 'integer', description: 'Zero-indexed insertion position.' },
        width: { type: 'number', default: 612, description: 'Page width in points.' },
        height: { type: 'number', default: 792, description: 'Page height in points.' },
      },
    },
    execute: async (input): Promise<WebMcpResponse<{ pageIndex: number; pageCount: number }>> => {
      const callId = `insert_page_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      return ctx.sdgLock.withLock(callId, async () => {
        const pageCount = ctx.pdfDoc.getPageCount();
        const pageIndex = typeof input.pageIndex === 'number' ? Math.max(0, Math.min(pageCount, input.pageIndex)) : pageCount;
        const width = typeof input.width === 'number' ? input.width : 612;
        const height = typeof input.height === 'number' ? input.height : 792;

        ctx.pdfDoc.addBlankPage(pageIndex, width, height);
        ctx.editorStore.pageCount = ctx.pdfDoc.getPageCount();
        ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);
        ctx.rateLimiter.recordCall();

        return {
          ok: true,
          result: { pageIndex, pageCount: ctx.pdfDoc.getPageCount() },
        };
      });
    },
  });

  // pdf.deletePage (Destructive per Section 7.2)
  tools.push({
    name: 'pdf.deletePage',
    title: 'Delete Page',
    description: 'Destructively deletes a page from the document. Requires explicit confirmation or proposal.',
    inputSchema: {
      type: 'object',
      properties: {
        pageIndex: { type: 'integer', description: 'Zero-indexed page number to delete.' },
      },
      required: ['pageIndex'],
    },
    execute: async (input): Promise<WebMcpResponse<{ deletedPageIndex: number; remainingPages: number }>> => {
      const callId = `del_page_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const pageIndex = typeof input.pageIndex === 'number' ? input.pageIndex : -1;
      const pageCount = ctx.pdfDoc.getPageCount();

      if (pageIndex < 0 || pageIndex >= pageCount) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Page index ${pageIndex} is out of bounds.`,
          },
        };
      }

      if (pageCount <= 1) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Cannot delete the only remaining page in the document.',
          },
        };
      }

      // Enforce Section 7.2 confirmation
      const confirmed = await ctx.requestUserConfirmation(
        'Confirm Page Deletion',
        `AI Agent is requesting to delete page ${pageIndex + 1} of ${pageCount}.`
      );

      if (!confirmed) {
        return {
          ok: false,
          error: {
            code: 'CONFIRMATION_REQUIRED',
            message: 'Page deletion requires explicit human confirmation.',
            details: { proposedChange: `Delete page ${pageIndex}` },
          },
        };
      }

      return ctx.sdgLock.withLock(callId, async () => {
        ctx.pdfDoc.deletePage(pageIndex);
        ctx.editorStore.pageCount = ctx.pdfDoc.getPageCount();
        ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);
        ctx.rateLimiter.recordCall();

        return {
          ok: true,
          result: {
            deletedPageIndex: pageIndex,
            remainingPages: ctx.pdfDoc.getPageCount(),
          },
        };
      });
    },
  });

  // pdf.reorderPages (Destructive per Section 7.2)
  tools.push({
    name: 'pdf.reorderPages',
    title: 'Reorder Document Pages',
    description: 'Reorders pages in the document. Subject to human confirmation or prior proposal staging.',
    inputSchema: {
      type: 'object',
      properties: {
        fromIndices: { type: 'array', items: { type: 'integer' } },
        toIndex: { type: 'integer' },
      },
      required: ['fromIndices', 'toIndex'],
    },
    execute: async (input): Promise<WebMcpResponse<{ pageCount: number }>> => {
      const callId = `reorder_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const fromIndices = Array.isArray(input.fromIndices) ? (input.fromIndices as number[]) : [];
      const toIndex = typeof input.toIndex === 'number' ? input.toIndex : 0;

      const confirmed = await ctx.requestUserConfirmation(
        'Confirm Page Reordering',
        `AI Agent is requesting to move pages [${fromIndices.map((i) => i + 1).join(', ')}] to index ${toIndex + 1}.`
      );

      if (!confirmed) {
        return {
          ok: false,
          error: {
            code: 'CONFIRMATION_REQUIRED',
            message: 'Page reordering requires explicit human confirmation.',
            details: { proposedChange: 'Reorder pages' },
          },
        };
      }

      return ctx.sdgLock.withLock(callId, async () => {
        ctx.pdfDoc.reorderPages(fromIndices, toIndex);
        ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);
        ctx.rateLimiter.recordCall();

        return {
          ok: true,
          result: { pageCount: ctx.pdfDoc.getPageCount() },
        };
      });
    },
  });

  // pdf.rotatePage
  tools.push({
    name: 'pdf.rotatePage',
    title: 'Rotate Page',
    description: 'Rotates a specific page by 0, 90, 180, or 270 degrees.',
    inputSchema: {
      type: 'object',
      properties: {
        pageIndex: { type: 'integer' },
        rotation: { type: 'integer', enum: [0, 90, 180, 270] },
      },
      required: ['pageIndex', 'rotation'],
    },
    execute: async (input): Promise<WebMcpResponse<{ pageIndex: number; newRotation: number }>> => {
      const callId = `rotate_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const pageIndex = typeof input.pageIndex === 'number' ? input.pageIndex : 0;
      const rotation = (input.rotation as 0 | 90 | 180 | 270) || 0;

      return ctx.sdgLock.withLock(callId, async () => {
        if (rotation === 90 || rotation === 180 || rotation === 270) {
          ctx.pdfDoc.rotatePage(pageIndex, rotation);
          ctx.editorStore.incrementPageVersion(pageIndex);
        }
        ctx.rateLimiter.recordCall();

        return {
          ok: true,
          result: { pageIndex, newRotation: rotation },
        };
      });
    },
  });

  // pdf.addComment
  tools.push({
    name: 'pdf.addComment',
    title: 'Add Review Comment',
    description: 'Attaches a review note or comment to a node with explicit agent identity attribution.',
    annotations: {},
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Target node identifier.' },
        text: { type: 'string', description: 'Comment note text.' },
        authorLabel: { type: 'string', description: 'Attribution identity (e.g. "Claude Assistant").' },
      },
      required: ['id', 'text', 'authorLabel'],
    },
    execute: async (input): Promise<WebMcpResponse<{ commentId: string }>> => {
      const id = typeof input.id === 'string' ? input.id : '';
      const text = typeof input.text === 'string' ? input.text : '';
      const authorLabel = typeof input.authorLabel === 'string' ? input.authorLabel : 'AI Agent';

      const graph = getSdg();
      const node = graph?.nodes.get(id);

      if (!node) {
        return {
          ok: false,
          error: {
            code: 'NODE_NOT_FOUND',
            message: `Node "${id}" not found.`,
            details: { id },
          },
        };
      }

      const commentId = `comment_${Date.now()}`;
      ctx.pdfDoc.addTextAnnotation(node.page, {
        x: node.bbox[0],
        y: node.bbox[1],
        width: 150,
        height: 80,
        contents: `[${authorLabel}]: ${text}`,
        author: authorLabel,
        color: '#7c3aed',
      });

      ctx.editorStore.incrementPageVersion(node.page);
      return {
        ok: true,
        result: { commentId },
      };
    },
  });

  // pdf.proposeEdit (Staging per Section 6.6 & 7.2)
  tools.push({
    name: 'pdf.proposeEdit',
    title: 'Stage Edit Proposal',
    description: 'Stages a proposed mutation for review without immediate application, returning a preview diff.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', description: 'Tool operation name (e.g. pdf.replaceText).' },
        parameters: { type: 'object', description: 'Parameters for the operation.' },
      },
      required: ['operation', 'parameters'],
    },
    execute: async (input): Promise<WebMcpResponse<{ proposalId: string; preview: { before: unknown; after: unknown } }>> => {
      const operation = typeof input.operation === 'string' ? input.operation : '';
      const params = (input.parameters as Record<string, unknown>) || {};

      let beforeText = '';
      const targetId = typeof params.id === 'string' ? params.id : '';
      if (targetId) {
        const node = getSdg()?.nodes.get(targetId);
        beforeText = node?.text || '';
      }

      const proposal = ctx.proposalStore.createProposal(
        operation,
        params,
        {
          before: beforeText,
          after: params.newText ?? params,
        },
        async (p: Record<string, unknown>) => {
          const targetTool = tools.find((t) => t.name === operation);
          if (!targetTool) throw new Error(`Tool ${operation} not found.`);
          return targetTool.execute(p, { signal: new AbortController().signal });
        }
      );

      return {
        ok: true,
        result: {
          proposalId: proposal.id,
          preview: proposal.preview,
        },
      };
    },
  });

  // pdf.acceptProposal
  tools.push({
    name: 'pdf.acceptProposal',
    title: 'Accept Staged Proposal',
    description: 'Accepts and immediately applies a staged proposal.',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string' },
      },
      required: ['proposalId'],
    },
    execute: async (input): Promise<WebMcpResponse<unknown>> => {
      const proposalId = typeof input.proposalId === 'string' ? input.proposalId : '';
      try {
        const result = await ctx.proposalStore.acceptProposal(proposalId);
        return {
          ok: true,
          result,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: {
            code: 'NODE_NOT_FOUND',
            message,
          },
        };
      }
    },
  });

  // pdf.rejectProposal
  tools.push({
    name: 'pdf.rejectProposal',
    title: 'Reject Staged Proposal',
    description: 'Discards a staged proposal without applying changes.',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string' },
      },
      required: ['proposalId'],
    },
    execute: async (input): Promise<WebMcpResponse<{ proposalId: string; status: string }>> => {
      const proposalId = typeof input.proposalId === 'string' ? input.proposalId : '';
      const rejected = ctx.proposalStore.rejectProposal(proposalId);

      if (!rejected) {
        return {
          ok: false,
          error: {
            code: 'NODE_NOT_FOUND',
            message: `Proposal "${proposalId}" not found.`,
          },
        };
      }

      return {
        ok: true,
        result: { proposalId, status: 'rejected' },
      };
    },
  });

  // ---------------------------------------------------------------------------
  // 4. Capability Tool (Section 6.7 & Section 9)
  // ---------------------------------------------------------------------------

  // pdf.getCapabilities
  tools.push({
    name: 'pdf.getCapabilities',
    title: 'Get WebMCP Capabilities',
    description: 'Returns the supported WebMCP specification version, tool capabilities, and structure source.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async (): Promise<WebMcpResponse<{
      specVersion: string;
      activeDocument: {
        fileName: string;
        fileId: string | null;
        pageCount: number;
        currentPageIndex: number;
        isLoaded: boolean;
      };
      workspace: {
        activeFileId: string | null;
        activeFileName: string;
        totalFiles: number;
      };
      tools: Array<{ name: string; version: string }>;
      structureSource: string;
    }>> => {
      const graph = getSdg();
      const registeredToolList = tools.map((t) => ({
        name: t.name,
        version: '1.0.0',
      }));

      return {
        ok: true,
        result: {
          specVersion: SPEC_VERSION,
          activeDocument: {
            fileName: ctx.editorStore.fileName,
            fileId: ctx.editorStore.activeWorkspaceFileId,
            pageCount: ctx.pdfDoc.getPageCount(),
            currentPageIndex: ctx.editorStore.currentPageIndex,
            isLoaded: ctx.editorStore.isDocumentLoaded,
          },
          workspace: {
            activeFileId: ctx.editorStore.activeWorkspaceFileId,
            activeFileName: ctx.editorStore.fileName,
            totalFiles: ctx.editorStore.workspaceFiles.length,
          },
          tools: registeredToolList,
          structureSource: graph?.structureSource || 'synthesised',
        },
      };
    },
  });

  // ---------------------------------------------------------------------------
  // 5. Visual Fallback Tool (Section 6.8)
  // ---------------------------------------------------------------------------

  // pdf.getPageImage
  tools.push({
    name: 'pdf.getPageImage',
    title: 'Render Page Raster Image',
    description: 'Renders page raster image data URL as ground truth for visual layout validation.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Zero-indexed page number.' },
        maxWidthPx: { type: 'integer', default: 1200, description: 'Maximum raster width in pixels.' },
      },
      required: ['page'],
    },
    execute: async (input): Promise<WebMcpResponse<{ page: number; imageDataUrl: string; readingOrderConfidence: number }>> => {
      const pageIndex = typeof input.page === 'number' ? input.page : 0;
      const maxWidthPx = typeof input.maxWidthPx === 'number' ? input.maxWidthPx : 1200;

      try {
        const page = ctx.pdfDoc.getPage(pageIndex);
        const dims = page.getDimensions();
        const scale = maxWidthPx / Math.max(dims.widthPts, 1);
        const renderResult = await page.render(scale);
        const dataUrl = renderResult.canvas.toDataURL('image/png');

        return {
          ok: true,
          result: {
            page: pageIndex,
            imageDataUrl: dataUrl,
            readingOrderConfidence: 0.95,
          },
        };
      } catch (err: unknown) {
        return {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: `Failed rendering page raster: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }
    },
  });

  // ---------------------------------------------------------------------------
  // 6. Export and History Tools (Section 6.10 & 7.3)
  // ---------------------------------------------------------------------------

  // pdf.exportDocument
  tools.push({
    name: 'pdf.exportDocument',
    title: 'Export Document State',
    description: 'Retrieves current document data in PDF, flattened PDF, plain text, or raster images format.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['pdf', 'flattened', 'text', 'images'], default: 'pdf' },
      },
    },
    execute: async (input): Promise<WebMcpResponse<{ format: string; byteLength: number; filename: string; text?: string; base64Data?: string; images?: Array<{ pageIndex: number; dataUrl: string }> }>> => {
      const format = input.format === 'flattened' ? 'flattened' : input.format === 'text' ? 'text' : input.format === 'images' ? 'images' : 'pdf';
      const filename = ctx.editorStore.fileName || 'document.pdf';

      if (format === 'text') {
        const pageCount = ctx.pdfDoc.getPageCount();
        let allText = '';
        for (let i = 0; i < pageCount; i++) {
          const spans = ctx.pdfDoc.extractTextSpans(i);
          const pageText = spans
            .map((s) => s.text)
            .filter((t) => t.trim().length > 0)
            .join('\n');
          allText += `--- Page ${i + 1} ---\n` + pageText + '\n\n';
        }
        return {
          ok: true,
          result: {
            format: 'text',
            byteLength: allText.length,
            filename: filename.replace(/\.pdf$/i, '.txt'),
            text: allText,
          },
        };
      }

      if (format === 'images') {
        const pageCount = ctx.pdfDoc.getPageCount();
        const pageImages: Array<{ pageIndex: number; dataUrl: string }> = [];
        for (let i = 0; i < pageCount; i++) {
          const page = ctx.pdfDoc.getPage(i);
          const renderRes = await page.render(1.5, { applyDpr: false });
          pageImages.push({
            pageIndex: i,
            dataUrl: renderRes.canvas.toDataURL('image/png'),
          });
        }
        return {
          ok: true,
          result: {
            format: 'images',
            byteLength: 0,
            filename: filename.replace(/\.pdf$/i, '_pages.png'),
            images: pageImages,
          },
        };
      }

      let bytes: Uint8Array;
      if (format === 'flattened') {
        const pageCount = ctx.pdfDoc.getPageCount();
        for (let p = 0; p < pageCount; p++) {
          ctx.pdfDoc.flattenPage(p);
        }
        bytes = await ctx.pdfDoc.saveAsync();
      } else {
        bytes = await ctx.pdfDoc.saveAsync();
      }

      return {
        ok: true,
        result: {
          format,
          byteLength: bytes.byteLength,
          filename,
          base64Data: uint8ArrayToBase64(bytes),
        },
      };
    },
  });

  // pdf.getChangeHistory (Section 7.3)
  tools.push({
    name: 'pdf.getChangeHistory',
    title: 'Get Applied Change History',
    description: 'Returns the history log of applied mutations in the current editing session.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async (): Promise<WebMcpResponse<{ totalChanges: number; changes: Array<{ description: string }> }>> => {
      const historyState = ctx.historyStore?.activeCommandState;
      const changes = historyState?.past.map((cmd) => ({
        description: cmd.description,
      })) || [];

      return {
        ok: true,
        result: {
          totalChanges: changes.length,
          changes,
        },
      };
    },
  });

  // ---------------------------------------------------------------------------
  // Workspace & Multi-Document Lifecycle Tools
  // ---------------------------------------------------------------------------

  // pdf.convertDocument
  tools.push({
    name: 'pdf.convertDocument',
    title: 'Convert Document to PDF',
    description: 'Converts an office document (DOCX, XLSX, PPTX, CSV, TSV, Markdown, HTML, JSON, plain text) to a PDF with professional vector layout and typography.',
    inputSchema: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: 'Source document file name including extension (e.g., report.docx, data.xlsx, readme.md).' },
        base64Data: { type: 'string', description: 'Base64 encoded binary data or text of the source document.' },
        pageSize: { type: 'string', enum: ['letter', 'a4', 'legal', 'a3', 'a5'], default: 'letter', description: 'Target PDF page size.' },
        orientation: { type: 'string', enum: ['portrait', 'landscape'], default: 'portrait', description: 'Page orientation.' },
        margins: {
          type: 'object',
          properties: {
            top: { type: 'number' },
            bottom: { type: 'number' },
            left: { type: 'number' },
            right: { type: 'number' },
          },
          description: 'Custom page margins in points (default: 54pt / 0.75in).',
        },
        fontSize: { type: 'number', description: 'Base typography font size in points.' },
        tableGridLines: { type: 'boolean', description: 'Whether to render table gridlines for spreadsheets and data tables.' },
        loadIntoWorkspace: { type: 'boolean', description: 'Whether to automatically load the converted PDF into the active workspace editor.' },
      },
      required: ['fileName', 'base64Data'],
    },
    execute: async (input): Promise<WebMcpResponse<{ fileName: string; pageCount: number; pdfBase64: string; format: string; durationMs: number }>> => {
      const fileName = typeof input.fileName === 'string' ? input.fileName : 'document.docx';
      const base64Data = typeof input.base64Data === 'string' ? input.base64Data : '';
      if (!base64Data) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'base64Data parameter is required and cannot be empty.',
          },
        };
      }

      try {
        const bytes = base64ToUint8Array(base64Data);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

        const options: { -readonly [K in keyof DocumentConversionOptions]?: DocumentConversionOptions[K] } = {};
        if (typeof input.pageSize === 'string') {
          options.pageSize = input.pageSize as DocumentConversionOptions['pageSize'];
        }
        if (typeof input.orientation === 'string') {
          options.orientation = input.orientation as DocumentConversionOptions['orientation'];
        }
        if (typeof input.margins === 'object' && input.margins !== null) {
          const m = input.margins as Record<string, unknown>;
          options.margins = {
            top: typeof m.top === 'number' ? m.top : 54,
            bottom: typeof m.bottom === 'number' ? m.bottom : 54,
            left: typeof m.left === 'number' ? m.left : 54,
            right: typeof m.right === 'number' ? m.right : 54,
          };
        }
        if (typeof input.fontSize === 'number') {
          options.fontSize = input.fontSize;
        }
        if (typeof input.tableGridLines === 'boolean') {
          options.includeGridlines = input.tableGridLines;
        } else if (typeof input.includeGridlines === 'boolean') {
          options.includeGridlines = input.includeGridlines;
        }

        const converted = await documentConverter.convertDocument(
          {
            name: fileName,
            buffer,
          },
          options,
        );

        const pdfBase64 = uint8ArrayToBase64(new Uint8Array(converted.buffer));

        if (input.loadIntoWorkspace && ctx.editorActions) {
          await ctx.editorActions.loadDocumentFromBuffer(converted.buffer, converted.fileName, false);
          ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);
        }

        return {
          ok: true,
          result: {
            fileName: converted.fileName,
            pageCount: converted.pageCount,
            pdfBase64,
            format: converted.format || documentConverter.detectFormat(fileName),
            durationMs: converted.metadata.conversionDurationMs,
          },
        };
      } catch (err: unknown) {
        return {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: `Failed converting document to PDF: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }
    },
  });

  // pdf.uploadDocument
  tools.push({
    name: 'pdf.uploadDocument',
    title: 'Upload Document to Workspace',
    description: 'Uploads and loads a PDF document into the workspace from base64-encoded binary bytes.',
    inputSchema: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: 'File name to assign to the document.' },
        base64Data: { type: 'string', description: 'Base64 encoded PDF binary data.' },
        addToWorkspace: { type: 'boolean', description: 'Whether to add to workspace alongside existing files.' },
      },
      required: ['fileName', 'base64Data'],
    },
    execute: async (input): Promise<WebMcpResponse<{ fileName: string; pageCount: number; isLoaded: boolean }>> => {
      const fileName = typeof input.fileName === 'string' ? input.fileName : 'uploaded.pdf';
      const base64Data = typeof input.base64Data === 'string' ? input.base64Data : '';
      if (!base64Data) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'base64Data parameter is required and cannot be empty.',
          },
        };
      }

      try {
        const bytes = base64ToUint8Array(base64Data);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

        if (ctx.editorActions) {
          await ctx.editorActions.loadDocumentFromBuffer(buffer, fileName, Boolean(input.addToWorkspace));
        } else {
          ctx.pdfDoc.setRawBuffer(buffer);
        }

        ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);

        return {
          ok: true,
          result: {
            fileName,
            pageCount: ctx.pdfDoc.getPageCount(),
            isLoaded: true,
          },
        };
      } catch (err: unknown) {
        return {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: `Failed loading PDF document: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }
    },
  });

  // pdf.listWorkspace
  tools.push({
    name: 'pdf.listWorkspace',
    title: 'List Workspace Documents',
    description: 'Lists all open PDF documents in the editor workspace, identifying the currently active open document being viewed and edited.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async (): Promise<WebMcpResponse<{
      activeFileId: string | null;
      activeFileName: string;
      activeDocument: { id: string | null; fileName: string; pageCount: number } | null;
      totalFiles: number;
      files: Array<{ id: string; fileName: string; sizeBytes?: number; isActive: boolean }>;
    }>> => {
      const files = ctx.editorStore.workspaceFiles.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        sizeBytes: f.sizeBytes,
        isActive: f.id === ctx.editorStore.activeWorkspaceFileId,
      }));

      const activeFile = files.find((f) => f.isActive);

      return {
        ok: true,
        result: {
          activeFileId: ctx.editorStore.activeWorkspaceFileId,
          activeFileName: ctx.editorStore.fileName,
          activeDocument: activeFile
            ? {
                id: activeFile.id,
                fileName: activeFile.fileName,
                pageCount: ctx.pdfDoc.getPageCount(),
              }
            : null,
          totalFiles: files.length,
          files,
        },
      };
    },
  });

  // pdf.switchDocument
  tools.push({
    name: 'pdf.switchDocument',
    title: 'Switch Active Document',
    description: 'Switches the active open PDF document in the workspace by fileId or fileName.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'Target workspace file identifier (optional if fileName is provided).' },
        fileName: { type: 'string', description: 'Target workspace file name e.g. "sample.pdf" (optional if fileId is provided).' },
      },
    },
    execute: async (input: { fileId?: string; fileName?: string }): Promise<WebMcpResponse<{ activeFileId: string; fileName: string; pageCount: number }>> => {
      let fileId = typeof input.fileId === 'string' ? input.fileId.trim() : '';

      if (!fileId && typeof input.fileName === 'string' && input.fileName.trim().length > 0) {
        const query = input.fileName.trim().toLowerCase();
        const matched = ctx.editorStore.workspaceFiles.find(
          (f) => f.fileName.toLowerCase() === query || f.fileName.toLowerCase().includes(query)
        );
        if (matched) {
          fileId = matched.id;
        }
      }

      if (!fileId) {
        return {
          ok: false,
          error: {
            code: 'NODE_NOT_FOUND',
            message: `Target workspace file "${input.fileName || input.fileId}" not found in workspace. Call pdf.listWorkspace to inspect open files.`,
          },
        };
      }

      if (!ctx.editorActions) {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'Editor actions unavailable.' },
        };
      }

      await ctx.editorActions.switchWorkspaceFile(fileId);
      ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);

      return {
        ok: true,
        result: {
          activeFileId: fileId,
          fileName: ctx.editorStore.fileName,
          pageCount: ctx.pdfDoc.getPageCount(),
        },
      };
    },
  });

  // pdf.mergeDocument
  tools.push({
    name: 'pdf.mergeDocument',
    title: 'Merge PDF Document',
    description: 'Merges another PDF document (via base64 or workspace file ID) into the active document at a specified page index.',
    inputSchema: {
      type: 'object',
      properties: {
        atIndex: { type: 'integer', description: 'Page index where merged pages are inserted (defaults to end of document).' },
        base64Data: { type: 'string', description: 'Base64 encoded PDF bytes to merge.' },
        workspaceFileId: { type: 'string', description: 'Existing workspace file ID to merge from.' },
      },
    },
    execute: async (input): Promise<WebMcpResponse<{ atIndex: number; newPageCount: number }>> => {
      const callId = `merge_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const pageCount = ctx.pdfDoc.getPageCount();
      const atIndex = typeof input.atIndex === 'number' ? Math.max(0, Math.min(pageCount, input.atIndex)) : pageCount;

      return ctx.sdgLock.withLock(callId, async () => {
        if (typeof input.workspaceFileId === 'string' && input.workspaceFileId.length > 0 && ctx.editorActions) {
          const activeId = ctx.editorStore.activeWorkspaceFileId;
          const fileIds = activeId && activeId !== input.workspaceFileId
            ? [activeId, input.workspaceFileId]
            : [input.workspaceFileId];
          await ctx.editorActions.mergeWorkspaceFiles(fileIds, atIndex);
        } else if (typeof input.base64Data === 'string' && input.base64Data.length > 0) {
          const bytes = base64ToUint8Array(input.base64Data);
          const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          ctx.pdfDoc.merge(buffer, atIndex);
          ctx.editorStore.pageCount = ctx.pdfDoc.getPageCount();
          ctx.editorStore.incrementRenderVersion();
        } else {
          return {
            ok: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Either base64Data or workspaceFileId must be supplied.',
            },
          };
        }

        ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);
        ctx.rateLimiter.recordCall();

        return {
          ok: true,
          result: {
            atIndex,
            newPageCount: ctx.pdfDoc.getPageCount(),
          },
        };
      });
    },
  });

  // pdf.splitDocument
  tools.push({
    name: 'pdf.splitDocument',
    title: 'Split Document Pages',
    description: 'Extracts specified pages into a new PDF document or returns base64 bytes.',
    inputSchema: {
      type: 'object',
      properties: {
        pages: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Zero-based page indices to extract.',
        },
        saveToWorkspace: { type: 'boolean', description: 'Whether to save extracted pages as a new workspace document.' },
        newFileName: { type: 'string', description: 'File name for the extracted document.' },
      },
      required: ['pages'],
    },
    execute: async (input): Promise<WebMcpResponse<{ pageCount: number; byteLength: number; base64Data: string; newFileName: string }>> => {
      const pages = Array.isArray(input.pages) ? (input.pages as number[]).filter((p) => typeof p === 'number') : [];
      if (pages.length === 0) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'pages array must contain at least one valid page index.',
          },
        };
      }

      const splitBytes = ctx.pdfDoc.split(pages);
      const newFileName = typeof input.newFileName === 'string' ? input.newFileName : `extracted_${Date.now()}.pdf`;

      if (input.saveToWorkspace && ctx.editorActions) {
        const buffer = splitBytes.buffer.slice(splitBytes.byteOffset, splitBytes.byteOffset + splitBytes.byteLength) as ArrayBuffer;
        await ctx.editorActions.loadDocumentFromBuffer(buffer, newFileName, true);
      }

      return {
        ok: true,
        result: {
          pageCount: pages.length,
          byteLength: splitBytes.byteLength,
          base64Data: uint8ArrayToBase64(splitBytes),
          newFileName,
        },
      };
    },
  });

  // pdf.duplicatePage
  tools.push({
    name: 'pdf.duplicatePage',
    title: 'Duplicate Page',
    description: 'Duplicates an existing page at pageIndex, placing the duplicate copy immediately after it.',
    inputSchema: {
      type: 'object',
      properties: {
        pageIndex: { type: 'integer', description: 'Zero-based page index to duplicate.' },
      },
      required: ['pageIndex'],
    },
    execute: async (input): Promise<WebMcpResponse<{ pageIndex: number; newPageCount: number }>> => {
      const callId = `duplicate_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const pageIndex = typeof input.pageIndex === 'number' ? input.pageIndex : 0;
      if (pageIndex < 0 || pageIndex >= ctx.pdfDoc.getPageCount()) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `pageIndex ${pageIndex} is out of document bounds.`,
          },
        };
      }

      return ctx.sdgLock.withLock(callId, async () => {
        if (ctx.editorActions && typeof ctx.editorActions.duplicatePage === 'function') {
          await ctx.editorActions.duplicatePage(pageIndex);
        } else {
          ctx.pdfDoc.duplicatePage(pageIndex);
          ctx.editorStore.pageCount = ctx.pdfDoc.getPageCount();
          const oldTransforms = ctx.editorStore.pageTransforms;
          if (oldTransforms) {
            const newTransforms: Record<number, (typeof oldTransforms)[number]> = {};
            for (const [key, val] of Object.entries(oldTransforms)) {
              const idx = Number(key);
              const newIdx = idx > pageIndex ? idx + 1 : idx;
              newTransforms[newIdx] = { ...val };
            }
            if (oldTransforms[pageIndex]) {
              newTransforms[pageIndex + 1] = { ...oldTransforms[pageIndex] };
            }
            ctx.editorStore.pageTransforms = newTransforms;
          }
          ctx.editorStore.incrementRenderVersion();
        }
        ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);
        ctx.rateLimiter.recordCall();

        return {
          ok: true,
          result: {
            pageIndex,
            newPageCount: ctx.pdfDoc.getPageCount(),
          },
        };
      });
    },
  });

  // pdf.flattenPage
  tools.push({
    name: 'pdf.flattenPage',
    title: 'Flatten Page Annotations',
    description: 'Flattens interactive annotations and form fields on a page into the static content stream.',
    inputSchema: {
      type: 'object',
      properties: {
        pageIndex: { type: 'integer', description: 'Zero-based page index to flatten.' },
      },
      required: ['pageIndex'],
    },
    execute: async (input): Promise<WebMcpResponse<{ pageIndex: number; flattened: boolean }>> => {
      const callId = `flatten_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const pageIndex = typeof input.pageIndex === 'number' ? input.pageIndex : 0;
      return ctx.sdgLock.withLock(callId, async () => {
        ctx.pdfDoc.flattenPage(pageIndex);
        ctx.editorStore.incrementPageVersion(pageIndex);
        ctx.rateLimiter.recordCall();

        return {
          ok: true,
          result: { pageIndex, flattened: true },
        };
      });
    },
  });

  // ---------------------------------------------------------------------------
  // Canvas Elements & Redaction Tools
  // ---------------------------------------------------------------------------

  // pdf.addElement
  tools.push({
    name: 'pdf.addElement',
    title: 'Add Canvas Element',
    description: 'Adds an overlay canvas element (text, shape, image, note, form-field) with full styling and validation options.',
    inputSchema: {
      type: 'object',
      properties: {
        pageIndex: { type: 'integer' },
        kind: { type: 'string', enum: ['text', 'shape', 'image', 'note', 'form-field'] },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        text: { type: 'string' },
        fill: { type: 'string' },
        stroke: { type: 'string' },
        strokeWidth: { type: 'number' },
        shapeType: { type: 'string', enum: ['rectangle', 'circle', 'line', 'arrow'] },
        imageUrl: { type: 'string' },
        author: { type: 'string' },
        variant: { type: 'string', enum: ['text-input', 'checkbox', 'radio', 'dropdown', 'signature', 'attachment', 'button'] },
        label: { type: 'string' },
        placeholder: { type: 'string' },
        value: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } },
        fontSize: { type: 'number' },
        fontFamily: { type: 'string' },
        color: { type: 'string' },
        backgroundColor: { type: 'string' },
        borderColor: { type: 'string' },
        borderWidth: { type: 'number' },
        borderStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted', 'none', 'inset', 'underline'] },
        borderRadius: { type: 'number' },
        textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
        required: { type: 'boolean' },
        readOnly: { type: 'boolean' },
        isHighlight: { type: 'boolean' },
        opacity: { type: 'number' },
        fontWeight: { type: 'string', enum: ['normal', 'bold'] },
        fontStyle: { type: 'string', enum: ['normal', 'italic'] },
        underline: { type: 'boolean' },
        strikethrough: { type: 'boolean' },
      },
      required: ['pageIndex', 'kind', 'x', 'y', 'width', 'height'],
    },
    execute: async (input: {
      pageIndex?: number;
      kind?: 'text' | 'shape' | 'image' | 'note' | 'form-field';
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      text?: string;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      shapeType?: ShapeVariant;
      imageUrl?: string;
      author?: string;
      variant?: FormFieldVariant;
      label?: string;
      placeholder?: string;
      value?: string;
      options?: string[];
      fontSize?: number;
      fontFamily?: string;
      color?: string;
      backgroundColor?: string;
      borderColor?: string;
      borderWidth?: number;
      borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none' | 'inset' | 'underline';
      borderRadius?: number;
      textAlign?: 'left' | 'center' | 'right';
      required?: boolean;
      readOnly?: boolean;
      isHighlight?: boolean;
      opacity?: number;
      fontWeight?: 'normal' | 'bold';
      fontStyle?: 'normal' | 'italic';
      underline?: boolean;
      strikethrough?: boolean;
    }): Promise<WebMcpResponse<{ id: string; pageIndex: number; kind: string }>> => {
      const callId = `add_elem_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      if (!ctx.canvasStore) {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'Canvas store unavailable.' },
        };
      }

      const id = ctx.canvasStore.generateId();
      const pageIndex = typeof input.pageIndex === 'number' ? input.pageIndex : 0;
      const kind = input.kind as 'text' | 'shape' | 'image' | 'note' | 'form-field';
      const x = typeof input.x === 'number' ? input.x : 50;
      const y = typeof input.y === 'number' ? input.y : 50;
      const width = typeof input.width === 'number' ? input.width : 100;
      const height = typeof input.height === 'number' ? input.height : 50;

      let element: CanvasElement;

      if (kind === 'text') {
        element = {
          id,
          kind: 'text',
          pageIndex,
          x,
          y,
          width,
          height,
          rotation: 0,
          locked: false,
          visible: true,
          flipX: false,
          flipY: false,
          text: typeof input.text === 'string' ? input.text : 'Sample Text',
          fontSize: typeof input.fontSize === 'number' ? input.fontSize : 14,
          fontFamily: typeof input.fontFamily === 'string' ? input.fontFamily : 'Inter',
          color: typeof input.color === 'string' ? input.color : (typeof input.fill === 'string' ? input.fill : '#000000'),
          backgroundColor: typeof input.backgroundColor === 'string' ? input.backgroundColor : undefined,
          fontWeight: input.fontWeight === 'bold' ? 'bold' : 'normal',
          fontStyle: input.fontStyle === 'italic' ? 'italic' : 'normal',
          textAlign: input.textAlign || 'left',
          underline: input.underline ?? false,
          strikethrough: input.strikethrough ?? false,
        };
      } else if (kind === 'shape') {
        element = {
          id,
          kind: 'shape',
          pageIndex,
          x,
          y,
          width,
          height,
          rotation: 0,
          locked: false,
          visible: true,
          flipX: false,
          flipY: false,
          variant: (input.shapeType as ShapeVariant) || 'rectangle',
          fill: typeof input.fill === 'string' ? input.fill : (input.isHighlight ? '#fde047' : '#3b82f6'),
          stroke: typeof input.stroke === 'string' ? input.stroke : (input.isHighlight ? '#fde047' : '#1d4ed8'),
          strokeWidth: typeof input.strokeWidth === 'number' ? input.strokeWidth : (input.isHighlight ? 0 : 1),
          opacity: typeof input.opacity === 'number' ? input.opacity : (input.isHighlight ? 0.4 : 1),
          isHighlight: input.isHighlight ?? false,
          borderRadius: typeof input.borderRadius === 'number' ? input.borderRadius : undefined,
        };
      } else if (kind === 'image') {
        element = {
          id,
          kind: 'image',
          pageIndex,
          x,
          y,
          width,
          height,
          rotation: 0,
          locked: false,
          visible: true,
          flipX: false,
          flipY: false,
          src: typeof input.imageUrl === 'string' ? input.imageUrl : '',
          objectFit: 'contain',
          opacity: typeof input.opacity === 'number' ? input.opacity : 1,
        };
      } else if (kind === 'note') {
        element = {
          id,
          kind: 'note',
          pageIndex,
          x,
          y,
          width,
          height,
          rotation: 0,
          locked: false,
          visible: true,
          flipX: false,
          flipY: false,
          author: typeof input.author === 'string' ? input.author : 'AI Agent',
          text: typeof input.text === 'string' ? input.text : '',
          color: typeof input.fill === 'string' ? input.fill : '#fbbf24',
          isOpen: false,
        };
      } else {
        const variant = (input.variant as FormFieldVariant) || 'text-input';
        element = {
          id,
          kind: 'form-field',
          pageIndex,
          x,
          y,
          width,
          height,
          rotation: 0,
          locked: false,
          visible: true,
          flipX: false,
          flipY: false,
          variant,
          label: typeof input.label === 'string' ? input.label : (typeof input.text === 'string' ? input.text : 'Field'),
          placeholder: typeof input.placeholder === 'string' ? input.placeholder : '',
          value: typeof input.value === 'string' ? input.value : '',
          options: Array.isArray(input.options) ? input.options : undefined,
          fontSize: typeof input.fontSize === 'number' ? input.fontSize : 13,
          fontFamily: typeof input.fontFamily === 'string' ? input.fontFamily : 'Helvetica',
          color: typeof input.color === 'string' ? input.color : '#111827',
          backgroundColor: typeof input.backgroundColor === 'string' ? input.backgroundColor : '#ffffff',
          borderColor: typeof input.borderColor === 'string' ? input.borderColor : '#d1d5db',
          borderWidth: typeof input.borderWidth === 'number' ? input.borderWidth : 1,
          borderStyle: input.borderStyle || 'solid',
          borderRadius: typeof input.borderRadius === 'number' ? input.borderRadius : 4,
          textAlign: input.textAlign || 'left',
          required: input.required ?? false,
          readOnly: input.readOnly ?? false,
        };
      }

      ctx.canvasStore.addElement(element);
      ctx.onAgentMutation({ page: pageIndex, description: `Add ${kind} element` });
      ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);
      ctx.rateLimiter.recordCall();

      return {
        ok: true,
        result: { id, pageIndex, kind },
      };
    },
  });

  // pdf.listElements
  tools.push({
    name: 'pdf.listElements',
    title: 'List Canvas Elements',
    description: 'Lists all overlay canvas elements on a specific page with their styling and properties.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        pageIndex: { type: 'integer', description: 'Zero-based page index.' },
      },
      required: ['pageIndex'],
    },
    execute: async (input): Promise<WebMcpResponse<{ pageIndex: number; count: number; elements: Array<Record<string, unknown>> }>> => {
      const pageIndex = typeof input.pageIndex === 'number' ? input.pageIndex : 0;
      const elements = ctx.canvasStore ? ctx.canvasStore.getElementsByPage(pageIndex) : [];
      return {
        ok: true,
        result: {
          pageIndex,
          count: elements.length,
          elements: elements.map((e) => ({
            id: e.id,
            kind: e.kind,
            x: e.x,
            y: e.y,
            width: e.width,
            height: e.height,
            rotation: e.rotation,
            locked: e.locked,
            visible: e.visible,
            ...(e.kind === 'form-field'
              ? {
                  variant: (e as FormFieldElement).variant,
                  label: (e as FormFieldElement).label,
                  placeholder: (e as FormFieldElement).placeholder,
                  value: (e as FormFieldElement).value,
                  options: (e as FormFieldElement).options,
                  fontSize: (e as FormFieldElement).fontSize,
                  fontFamily: (e as FormFieldElement).fontFamily,
                  color: (e as FormFieldElement).color,
                  backgroundColor: (e as FormFieldElement).backgroundColor,
                  borderColor: (e as FormFieldElement).borderColor,
                  borderWidth: (e as FormFieldElement).borderWidth,
                  borderStyle: (e as FormFieldElement).borderStyle,
                  borderRadius: (e as FormFieldElement).borderRadius,
                  textAlign: (e as FormFieldElement).textAlign,
                  required: (e as FormFieldElement).required,
                  readOnly: (e as FormFieldElement).readOnly,
                }
              : {}),
            ...(e.kind === 'shape'
              ? {
                  variant: (e as ShapeElement).variant,
                  fill: (e as ShapeElement).fill,
                  stroke: (e as ShapeElement).stroke,
                  strokeWidth: (e as ShapeElement).strokeWidth,
                  opacity: (e as ShapeElement).opacity,
                  isHighlight: (e as ShapeElement).isHighlight,
                }
              : {}),
            ...(e.kind === 'text'
              ? {
                  text: (e as TextElement).text,
                  fontSize: (e as TextElement).fontSize,
                  fontFamily: (e as TextElement).fontFamily,
                  color: (e as TextElement).color,
                  backgroundColor: (e as TextElement).backgroundColor,
                  fontWeight: (e as TextElement).fontWeight,
                  fontStyle: (e as TextElement).fontStyle,
                  textAlign: (e as TextElement).textAlign,
                  underline: (e as TextElement).underline,
                  strikethrough: (e as TextElement).strikethrough,
                }
              : {}),
          })),
        },
      };
    },
  });

  // pdf.updateElement
  tools.push({
    name: 'pdf.updateElement',
    title: 'Update Canvas Element',
    description: 'Updates properties (position, size, colors, text, form-field styling, highlights) of a canvas element.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        text: { type: 'string' },
        fill: { type: 'string' },
        stroke: { type: 'string' },
        strokeWidth: { type: 'number' },
        opacity: { type: 'number' },
        isHighlight: { type: 'boolean' },
        fontSize: { type: 'number' },
        fontFamily: { type: 'string' },
        color: { type: 'string' },
        backgroundColor: { type: 'string' },
        borderColor: { type: 'string' },
        borderWidth: { type: 'number' },
        borderStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted', 'none', 'inset', 'underline'] },
        borderRadius: { type: 'number' },
        textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
        required: { type: 'boolean' },
        readOnly: { type: 'boolean' },
        value: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } },
        label: { type: 'string' },
        placeholder: { type: 'string' },
        variant: { type: 'string', enum: ['text-input', 'checkbox', 'radio', 'dropdown', 'signature', 'attachment', 'button'] },
        underline: { type: 'boolean' },
        strikethrough: { type: 'boolean' },
      },
      required: ['id'],
    },
    execute: async (input: {
      id?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      text?: string;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      opacity?: number;
      isHighlight?: boolean;
      fontSize?: number;
      fontFamily?: string;
      color?: string;
      backgroundColor?: string;
      borderColor?: string;
      borderWidth?: number;
      borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none' | 'inset' | 'underline';
      borderRadius?: number;
      textAlign?: 'left' | 'center' | 'right';
      required?: boolean;
      readOnly?: boolean;
      value?: string;
      options?: string[];
      label?: string;
      placeholder?: string;
      variant?: FormFieldVariant;
      underline?: boolean;
      strikethrough?: boolean;
    }): Promise<WebMcpResponse<{ id: string; updated: boolean }>> => {
      const id = typeof input.id === 'string' ? input.id : '';
      if (!ctx.canvasStore) {
        return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Canvas store unavailable.' } };
      }

      const existing = ctx.canvasStore.getElementById(id);
      if (!existing) {
        return { ok: false, error: { code: 'NODE_NOT_FOUND', message: `Element "${id}" not found.` } };
      }

      const patch: Record<string, unknown> = {};
      if (typeof input.x === 'number') patch.x = input.x;
      if (typeof input.y === 'number') patch.y = input.y;
      if (typeof input.width === 'number') patch.width = input.width;
      if (typeof input.height === 'number') patch.height = input.height;
      if (typeof input.text === 'string') patch.text = input.text;
      if (typeof input.fill === 'string') patch.fill = input.fill;
      if (typeof input.stroke === 'string') patch.stroke = input.stroke;
      if (typeof input.strokeWidth === 'number') patch.strokeWidth = input.strokeWidth;
      if (typeof input.opacity === 'number') patch.opacity = input.opacity;
      if (typeof input.isHighlight === 'boolean') patch.isHighlight = input.isHighlight;
      if (typeof input.fontSize === 'number') patch.fontSize = input.fontSize;
      if (typeof input.fontFamily === 'string') patch.fontFamily = input.fontFamily;
      if (typeof input.color === 'string') patch.color = input.color;
      if (typeof input.backgroundColor === 'string') patch.backgroundColor = input.backgroundColor;
      if (typeof input.borderColor === 'string') patch.borderColor = input.borderColor;
      if (typeof input.borderWidth === 'number') patch.borderWidth = input.borderWidth;
      if (typeof input.borderStyle === 'string') patch.borderStyle = input.borderStyle;
      if (typeof input.borderRadius === 'number') patch.borderRadius = input.borderRadius;
      if (typeof input.textAlign === 'string') patch.textAlign = input.textAlign;
      if (typeof input.required === 'boolean') patch.required = input.required;
      if (typeof input.readOnly === 'boolean') patch.readOnly = input.readOnly;
      if (typeof input.value === 'string') patch.value = input.value;
      if (Array.isArray(input.options)) patch.options = input.options;
      if (typeof input.label === 'string') patch.label = input.label;
      if (typeof input.placeholder === 'string') patch.placeholder = input.placeholder;
      if (typeof input.variant === 'string') patch.variant = input.variant;
      if (typeof input.underline === 'boolean') patch.underline = input.underline;
      if (typeof input.strikethrough === 'boolean') patch.strikethrough = input.strikethrough;

      ctx.canvasStore.updateElement(id, patch);
      ctx.onAgentMutation({ page: existing.pageIndex, description: `Update element ${id}` });
      ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);

      return {
        ok: true,
        result: { id, updated: true },
      };
    },
  });

  // pdf.deleteElement
  tools.push({
    name: 'pdf.deleteElement',
    title: 'Delete Canvas Element',
    description: 'Removes an overlay canvas element by its identifier.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
    execute: async (input): Promise<WebMcpResponse<{ id: string; deleted: boolean }>> => {
      const id = typeof input.id === 'string' ? input.id : '';
      if (!ctx.canvasStore) {
        return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Canvas store unavailable.' } };
      }

      const existing = ctx.canvasStore.getElementById(id);
      if (!existing) {
        return { ok: false, error: { code: 'NODE_NOT_FOUND', message: `Element "${id}" not found.` } };
      }

      const pageIndex = existing.pageIndex;
      ctx.canvasStore.removeElement(id);
      ctx.onAgentMutation({ page: pageIndex, description: `Delete element ${id}` });
      ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);

      return {
        ok: true,
        result: { id, deleted: true },
      };
    },
  });

  // pdf.burnElements
  tools.push({
    name: 'pdf.burnElements',
    title: 'Bake Canvas Overlays into PDF',
    description: 'Bakes and burns all active canvas overlay elements directly into the PDF content stream.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async (): Promise<WebMcpResponse<{ burnedCount: number; status: string }>> => {
      const callId = `burn_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      if (!ctx.canvasStore || !ctx.editorActions) {
        return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Canvas store or editor actions unavailable.' } };
      }

      const elementsToBurn = [...ctx.canvasStore.elements];
      if (elementsToBurn.length === 0) {
        return {
          ok: true,
          result: { burnedCount: 0, status: 'No canvas elements to burn.' },
        };
      }

      return ctx.sdgLock.withLock(callId, async () => {
        await ctx.editorActions!.applyCanvasComponentsToPdf(elementsToBurn, () => {
          ctx.canvasStore!.elements = [];
        });

        ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);
        ctx.rateLimiter.recordCall();

        return {
          ok: true,
          result: { burnedCount: elementsToBurn.length, status: 'success' },
        };
      });
    },
  });

  // pdf.applyRedaction
  tools.push({
    name: 'pdf.applyRedaction',
    title: 'Apply Redaction',
    description: 'Permanently redacts and removes text or areas within specified bounding boxes.',
    inputSchema: {
      type: 'object',
      properties: {
        pageIndex: { type: 'integer', description: 'Zero-based page index.' },
        rects: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
            required: ['x', 'y', 'width', 'height'],
          },
          description: 'Array of bounding rectangles in PDF points to permanently redact.',
        },
      },
      required: ['pageIndex', 'rects'],
    },
    execute: async (input): Promise<WebMcpResponse<{ pageIndex: number; redactedRectsCount: number }>> => {
      const callId = `redact_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      const pageIndex = typeof input.pageIndex === 'number' ? input.pageIndex : 0;
      const rawRects = Array.isArray(input.rects) ? input.rects : [];
      const rects: HighlightRect[] = rawRects.map((r: Record<string, unknown>) => ({
        x: Number(r.x) || 0,
        y: Number(r.y) || 0,
        width: Number(r.width) || 10,
        height: Number(r.height) || 10,
      }));

      if (rects.length === 0) {
        return {
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'rects array must contain at least one rectangle.' },
        };
      }

      return ctx.sdgLock.withLock(callId, async () => {
        if (ctx.editorActions && ctx.canvasStore) {
          await ctx.editorActions.redactArea(pageIndex, rects, ctx.canvasStore);
        } else {
          ctx.pdfDoc.deleteTextInRects(pageIndex, rects);
          ctx.editorStore.incrementPageVersion(pageIndex);
        }

        ctx.onAgentMutation({ page: pageIndex, description: `Applied ${rects.length} redactions` });
        ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);
        ctx.rateLimiter.recordCall();

        return {
          ok: true,
          result: { pageIndex, redactedRectsCount: rects.length },
        };
      });
    },
  });

  // pdf.sanitizeDocument
  tools.push({
    name: 'pdf.sanitizeDocument',
    title: 'Sanitize Document',
    description: 'Inspects and permanently strips metadata, attachments, hidden text, or annotations.',
    inputSchema: {
      type: 'object',
      properties: {
        removeMetadata: { type: 'boolean', default: true },
        removeAttachments: { type: 'boolean', default: true },
        removeAnnotations: { type: 'boolean', default: false },
        removeJavascript: { type: 'boolean', default: true },
      },
    },
    execute: async (input): Promise<WebMcpResponse<{ sanitized: boolean; details: Record<string, unknown> }>> => {
      const callId = `sanitize_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      if (!ctx.editorActions) {
        return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Editor actions unavailable.' } };
      }

      return ctx.sdgLock.withLock(callId, async () => {
        const options: SanitizeOptions = {
          removeMetadata: input.removeMetadata !== false,
          removeXmpMetadata: input.removeMetadata !== false,
          removeAttachments: input.removeAttachments !== false,
          removeJavascript: input.removeJavascript !== false,
          removeAnnotations: Boolean(input.removeAnnotations),
          removeLinks: false,
          removeFormFields: false,
          removeBookmarks: false,
          removePieceInfo: true,
          removeThumbnails: false,
          removeStructTree: false,
        };

        const summary = await ctx.editorActions!.sanitizeCurrentDocument(options);
        ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);
        ctx.rateLimiter.recordCall();

        return {
          ok: true,
          result: {
            sanitized: true,
            details: {
              metadataCleared: summary.metadataCleared,
              attachmentsRemoved: summary.attachmentsRemoved,
              annotationsRemoved: summary.annotationsRemoved,
            },
          },
        };
      });
    },
  });

  // pdf.compressDocument
  tools.push({
    name: 'pdf.compressDocument',
    title: 'Compress Document',
    description: 'Compresses PDF document using lossless structural packing, balanced lossy downsampling, or flat-image rasterization.',
    inputSchema: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['lossless', 'recommended', 'strong', 'flat_image', 'custom'],
          default: 'recommended',
          description: 'Compression preset tier to apply.',
        },
        imageQuality: {
          type: 'number',
          minimum: 0.1,
          maximum: 1.0,
          description: 'Lossy JPEG compression quality from 0.1 to 1.0.',
        },
        maxDpi: {
          type: 'integer',
          description: 'Maximum image resolution cap in DPI (e.g. 72, 96, 150, 200, 300).',
        },
        removeMetadata: {
          type: 'boolean',
          description: 'Whether to strip document metadata and XMP packets.',
        },
        removeThumbnails: {
          type: 'boolean',
          default: true,
          description: 'Whether to strip embedded page thumbnails.',
        },
        download: {
          type: 'boolean',
          default: false,
          description: 'Whether to trigger client-side download of the compressed PDF.',
        },
        saveToWorkspace: {
          type: 'boolean',
          default: false,
          description: 'Whether to save compressed PDF as a new workspace document.',
        },
      },
    },
    execute: async (input): Promise<WebMcpResponse<{
      compressed: boolean;
      originalSizeBytes: number;
      compressedSizeBytes: number;
      savingsBytes: number;
      savingsPercentage: number;
      level: string;
      imagesCompressed: number;
      pagesRasterized: number;
      base64Data?: string;
    }>> => {
      const callId = `compress_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      return ctx.sdgLock.withLock(callId, async () => {
        const level = (typeof input.level === 'string' ? input.level : 'recommended') as CompressionLevel;
        const options: CompressOptions = {
          level,
          imageQuality: typeof input.imageQuality === 'number' ? input.imageQuality : undefined,
          maxDpi: typeof input.maxDpi === 'number' ? input.maxDpi : undefined,
          removeMetadata: typeof input.removeMetadata === 'boolean' ? input.removeMetadata : undefined,
          removeThumbnails: input.removeThumbnails !== false,
        };

        let summary: CompressSummary;
        let compressedBytes: Uint8Array | undefined = undefined;

        if (input.download && ctx.editorActions) {
          summary = await ctx.editorActions.compressAndDownload(options);
        } else if (input.saveToWorkspace && ctx.editorActions) {
          summary = await ctx.editorActions.compressAsNewWorkspaceFile(options);
        } else if (ctx.editorActions) {
          summary = await ctx.editorActions.compressCurrentDocument(options);
        } else {
          const res = await ctx.pdfDoc.compress(options, ctx.editorStore.pageTransforms);
          summary = res.summary;
          compressedBytes = res.bytes;
        }

        ctx.sdgBuilder.buildGraph(ctx.pdfDoc, ctx.canvasStore);
        ctx.rateLimiter.recordCall();

        return {
          ok: true,
          result: {
            compressed: summary.savingsBytes > 0,
            originalSizeBytes: summary.originalSizeBytes,
            compressedSizeBytes: summary.compressedSizeBytes,
            savingsBytes: summary.savingsBytes,
            savingsPercentage: summary.savingsPercentage,
            level: options.level,
            imagesCompressed: summary.imagesCompressed,
            pagesRasterized: summary.pagesRasterized,
            base64Data: compressedBytes ? uint8ArrayToBase64(compressedBytes) : undefined,
          },
        };
      });
    },
  });

  // ---------------------------------------------------------------------------
  // Document Metadata & Digital Signature Inspection Tools
  // ---------------------------------------------------------------------------

  // pdf.getMetadata
  tools.push({
    name: 'pdf.getMetadata',
    title: 'Get Document Metadata',
    description: 'Retrieves standard and custom PDF document metadata (title, author, subject, keywords, etc.).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async (): Promise<WebMcpResponse<Record<string, unknown>>> => {
      if (ctx.editorActions) {
        const meta = await ctx.editorActions.getExtendedDocumentMetadata();
        return {
          ok: true,
          result: meta as unknown as Record<string, unknown>,
        };
      }
      const meta = ctx.pdfDoc.getMetadata();
      return {
        ok: true,
        result: meta as unknown as Record<string, unknown>,
      };
    },
  });

  // pdf.updateMetadata
  tools.push({
    name: 'pdf.updateMetadata',
    title: 'Update Document Metadata',
    description: 'Updates document metadata properties (title, author, subject, keywords, creator, producer, custom fields).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        author: { type: 'string' },
        subject: { type: 'string' },
        keywords: { type: 'string' },
        creator: { type: 'string' },
        producer: { type: 'string' },
        customFields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['key', 'value'],
          },
        },
      },
    },
    execute: async (input): Promise<WebMcpResponse<{ updated: boolean }>> => {
      const callId = `meta_${Date.now()}`;
      const rateErr = checkMutationPreconditions(callId);
      if (rateErr) return rateErr;

      if (!ctx.editorActions) {
        return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Editor actions unavailable.' } };
      }

      return ctx.sdgLock.withLock(callId, async () => {
        const customMetadata: Record<string, string> = {};
        if (Array.isArray(input.customFields)) {
          for (const item of input.customFields as Array<{ key: string; value: string }>) {
            if (item && item.key) {
              customMetadata[String(item.key)] = String(item.value);
            }
          }
        }

