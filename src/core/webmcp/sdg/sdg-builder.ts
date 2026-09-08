/**
 * Semantic Document Graph (SDG) Builder.
 *
 * Implements the SDG generation and incremental synchronization engine
 * defined in Section 4 of webmcp-pdf-editor-spec.md.
 */

import type { PdfDocument } from '../../../services/pdf/pdf-document';
import type { CanvasStore } from '../../../stores/canvas.svelte';
import type { EditableTextSpan, TextLine, ColorRgba } from '../../types';
import type {
  SdgNode,
  SdgNodeType,
  SdgRun,
  SdgBoundingBox,
  SemanticDocumentGraph,
} from './sdg-types';
import { normalizeText } from './sdg-normalizer';

/**
 * Hex color formatter from ColorRgba.
 */
function rgbaToHex(color?: ColorRgba): string {
  if (!color) return '#000000';
  const r = Math.round(Math.max(0, Math.min(255, color.r))).toString(16).padStart(2, '0');
  const g = Math.round(Math.max(0, Math.min(255, color.g))).toString(16).padStart(2, '0');
  const b = Math.round(Math.max(0, Math.min(255, color.b))).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

export class SdgBuilder {
  /** Map of key (pageIndex:internalId) to assigned stable node ID. */
  private keyToNodeId = new Map<string, string>();
  /** Set of assigned IDs to guarantee uniqueness and prevent ID reuse. */
  private assignedIds = new Set<string>();
  /** Counter for sequential block ID generation. */
  private nextBlockSeq = 1;
  private nextTableSeq = 1;
  private nextFigureSeq = 1;
  private nextFormFieldSeq = 1;

  /** Cached active graph. */
  private activeGraph: SemanticDocumentGraph | null = null;

  /**
   * Resets ID trackers when switching to a completely new workspace document.
   */
  public reset(): void {
    this.keyToNodeId.clear();
    this.assignedIds.clear();
    this.nextBlockSeq = 1;
    this.nextTableSeq = 1;
    this.nextFigureSeq = 1;
    this.nextFormFieldSeq = 1;
    this.activeGraph = null;
  }

  /**
   * Allocates a stable, unique ID for a given node type and internal key.
   */
  public allocateNodeId(type: SdgNodeType, internalKey: string): string {
    const existing = this.keyToNodeId.get(internalKey);
    if (existing) {
      return existing;
    }

    let prefix = 'blk_';
    let seq = this.nextBlockSeq++;

    if (type === 'table') {
      prefix = 'tbl_';
      seq = this.nextTableSeq++;
    } else if (type === 'figure') {
      prefix = 'fig_';
      seq = this.nextFigureSeq++;
    } else if (type === 'form_field') {
      prefix = 'form_';
      seq = this.nextFormFieldSeq++;
    }

    let candidate = `${prefix}${seq.toString().padStart(4, '0')}`;
    while (this.assignedIds.has(candidate)) {
      seq = prefix === 'tbl_' ? this.nextTableSeq++ : prefix === 'fig_' ? this.nextFigureSeq++ : this.nextBlockSeq++;
      candidate = `${prefix}${seq.toString().padStart(4, '0')}`;
    }

    this.assignedIds.add(candidate);
    this.keyToNodeId.set(internalKey, candidate);
    return candidate;
  }

  /**
   * Builds the complete Semantic Document Graph from the active PDF document and canvas store.
   */
  public buildGraph(
    pdfDoc: PdfDocument,
    canvasStore?: CanvasStore | null,
    isTagged = false
  ): SemanticDocumentGraph {
    const nodes = new Map<string, SdgNode>();
    const rootIds: string[] = [];
    const pageCount = pdfDoc.getPageCount();

    // 1. Gather all text spans across all pages to determine median font size
    const allSpansByPage: Array<{ pageIndex: number; spans: EditableTextSpan[] }> = [];
    const fontSizes: number[] = [];

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      try {
        const spans = pdfDoc.extractTextSpans(pageIndex);
        allSpansByPage.push({ pageIndex, spans });
        for (const span of spans) {
          if (span.fontSize > 0) {
            fontSizes.push(span.fontSize);
          }
        }
      } catch (err: unknown) {
        console.warn(`Failed extracting text spans for page ${pageIndex}:`, err);
        allSpansByPage.push({ pageIndex, spans: [] });
      }
    }

    fontSizes.sort((a, b) => a - b);
    const medianFontSize = fontSizes.length > 0 ? fontSizes[Math.floor(fontSizes.length / 2)] : 12;

    // 2. Process each page
    for (const { pageIndex, spans } of allSpansByPage) {
      // Check column distribution for reading order confidence
      const leftPositions = spans.map((s) => s.left);
      const minLeft = leftPositions.length > 0 ? Math.min(...leftPositions) : 0;
      const maxLeft = leftPositions.length > 0 ? Math.max(...leftPositions) : 0;
      const spanRange = maxLeft - minLeft;
      const isMultiColumn = spanRange > 250;
      const readingOrderConfidence = isMultiColumn ? 0.88 : 0.98;

      // Group into semantic blocks
      for (const span of spans) {
        const rawText = span.text || '';
        const trimmed = rawText.trim();
        if (trimmed.length === 0) {
          continue;
        }

        const internalKey = `p${pageIndex}:span:${span.id || `${span.left.toFixed(1)}_${span.top.toFixed(1)}`}`;
        
        // Classify type
        let type: SdgNodeType = 'paragraph';
        let level: number | undefined;

        if (span.fontSize >= medianFontSize * 1.25) {
          type = 'heading';
          if (span.fontSize >= medianFontSize * 2.0) {
            level = 1;
          } else if (span.fontSize >= medianFontSize * 1.6) {
            level = 2;
          } else if (span.fontSize >= medianFontSize * 1.35) {
            level = 3;
          } else {
            level = 4;
          }
        } else if (
          span.hasBulletPrefix ||
          trimmed.startsWith('•') ||
          trimmed.startsWith('- ') ||
          trimmed.startsWith('* ') ||
          /^\d+\.\s/.test(trimmed)
        ) {
          type = 'list_item';
        }

        const nodeId = this.allocateNodeId(type, internalKey);
        const bbox: SdgBoundingBox = [
          span.left,
          span.top,
          span.left + span.width,
          span.top + span.height,
        ];

        // Build runs
        const runs: SdgRun[] = [];
        if (span.lines && span.lines.length > 0) {
          span.lines.forEach((line: TextLine, lineIdx: number) => {
            runs.push({
              id: `run_${nodeId.replace(/^blk_/, '')}_${lineIdx}`,
              text: line.text,
              font: line.fontFamily || span.fontFamily || 'Helvetica',
              size: line.fontSize || span.fontSize,
              bold: line.fontWeight === 'bold' || span.fontWeight === 'bold',
              italic: line.fontStyle === 'italic' || span.fontStyle === 'italic',
              color: rgbaToHex(line.color || span.color),
            });
          });
        } else {
          runs.push({
            id: `run_${nodeId.replace(/^blk_/, '')}_0`,
            text: span.text,
            font: span.fontFamily || 'Helvetica',
            size: span.fontSize,
            bold: span.fontWeight === 'bold',
            italic: span.fontStyle === 'italic',
            color: rgbaToHex(span.color),
          });
        }

        const node: SdgNode = {
          id: nodeId,
          type,
          level,
          page: pageIndex,
          bbox,
          text: normalizeText(rawText),
          runs,
          parentId: null,
          childIds: [],
          provenance: isTagged ? 'tagged' : 'synthesised',
          confidence: isTagged ? 1.0 : type === 'heading' ? 0.92 : 0.88,
          readingOrderConfidence,
        };

        nodes.set(nodeId, node);
        rootIds.push(nodeId);
      }

      // Process pending and embedded form fields on this page
      const formFields = pdfDoc.getPendingAcroFormFieldsForPage(pageIndex);
      for (const field of formFields) {
        const fieldKey = `p${pageIndex}:field:${field.id}`;
        const fieldId = this.allocateNodeId('form_field', fieldKey);
        const fieldBbox: SdgBoundingBox = [
          field.x,
          field.y,
          field.x + field.width,
          field.y + field.height,
        ];

        const fieldKind: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'signature' =
          field.variant === 'checkbox' ||
          field.variant === 'radio' ||
          field.variant === 'dropdown' ||
          field.variant === 'signature'
            ? field.variant
            : 'text';

        const fieldNode: SdgNode = {
          id: fieldId,
          type: 'form_field',
          page: pageIndex,
          bbox: fieldBbox,
          text: normalizeText(field.label || field.placeholder || field.id),
          parentId: null,
          childIds: [],
          provenance: isTagged ? 'tagged' : 'synthesised',
          confidence: 0.95,
          fieldKind,
        };

        nodes.set(fieldId, fieldNode);
        rootIds.push(fieldId);
      }

      // Process canvas overlay elements (figures, user notes, canvas text)
      if (canvasStore) {
        const canvasElements = canvasStore.getElementsByPage(pageIndex);
        for (const el of canvasElements) {
          if (el.kind === 'image') {
            const imgKey = `p${pageIndex}:canvas:img:${el.id}`;
            const figId = this.allocateNodeId('figure', imgKey);
            const figNode: SdgNode = {
              id: figId,
              type: 'figure',
              page: pageIndex,
              bbox: [el.x, el.y, el.x + el.width, el.y + el.height],
              text: '',
              parentId: null,
              childIds: [],
              provenance: 'synthesised',
              confidence: 0.95,
            };
            nodes.set(figId, figNode);
            rootIds.push(figId);
          }
        }
      }
    }

    const graph: SemanticDocumentGraph = {
      nodes,
      rootIds,
      structureSource: isTagged ? 'tagged' : 'synthesised',
      pageCount,
      generatedAt: Date.now(),
    };

    this.activeGraph = graph;
    return graph;
  }

  /**
   * Retrieves the current graph or null if not yet built.
   */
  public getGraph(): SemanticDocumentGraph | null {
    return this.activeGraph;
  }

  /**
   * Finds a node by ID in the active graph.
   */
  public getNode(nodeId: string): SdgNode | undefined {
    return this.activeGraph?.nodes.get(nodeId);
  }

  /**
   * Updates a node's text in place, preserving ID stability.
   */
  public updateNodeText(nodeId: string, newText: string): boolean {
    const node = this.activeGraph?.nodes.get(nodeId);
    if (!node) {
      return false;
    }

    node.text = normalizeText(newText);
    if (node.runs && node.runs.length > 0) {
      node.runs[0].text = newText;
      for (let i = 1; i < node.runs.length; i++) {
        node.runs[i].text = '';
      }
    }
    return true;
  }

  /**
   * Removes a node from the active graph.
   */
  public removeNode(nodeId: string): boolean {
    if (!this.activeGraph) return false;
    const removed = this.activeGraph.nodes.delete(nodeId);
    if (removed) {
      const idx = this.activeGraph.rootIds.indexOf(nodeId);
      if (idx !== -1) {
        this.activeGraph.rootIds.splice(idx, 1);
      }
    }
    return removed;
  }
}
