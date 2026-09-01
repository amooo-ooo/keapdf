/**
 * Pure operations and ISO 32000-1 Clause 12.3.3 Document Outline serialization.
 * Handles automatic heading level inference, outline tree transformations,
 * and PDF bookmark reading and writing.
 */

import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFString,
  PDFHexString,
  PDFRef,
  PDFObject,
} from 'pdf-lib';
import type { EditableTextSpan, OutlineNode } from '../../../core/types';

/**
 * Options for automatically inferring the outline level of selected text.
 */
export interface InferOutlineLevelOptions {
  /** The text content of the heading. */
  text: string;
  /** Font size in points. */
  fontSize?: number;
  /** Whether the text is styled as bold. */
  isBold?: boolean;
  /** Optional collection of text spans on the same page for relative clustering. */
  pageSpans?: EditableTextSpan[];
}

/**
 * Flat representation of an outline item with an explicit 1-indexed hierarchy level.
 */
export interface OutlineItemFlat {
  /** Display title of the outline item. */
  title: string;
  /** Target zero-based page index, or null if unlinked. */
  pageIndex: number | null;
  /** Hierarchical level (1 = Level 1 / H1, 2 = Level 2 / H2, etc.). */
  level: number;
  /** Optional target vertical coordinate on page (in PDF points). */
  destY?: number;
}

/**
 * Automatically calculates the outline hierarchy level (1 to 6) for a given text selection.
 * Prioritizes explicit numbering patterns, then relative page font size clustering,
 * and finally typographic size/weight thresholds.
 *
 * @param options Text and typography metrics of the selected item.
 * @return Hierarchical heading level clamped between 1 and 6.
 */
export function inferOutlineLevel(options: InferOutlineLevelOptions): number {
  const text = (options.text || '').trim();

  // 1. Numbering pattern analysis (requires hierarchical numbering prefix followed by title text)
  if (/^\d+\.\d+\.\d+\.\d+(?:[.:\-\s]+[A-Z\u00C0-\u024F]|\s+[^\d\s])/.test(text)) {
    return 4;
  }
  if (
    /^\d+\.\d+\.\d+(?:[.:\-\s]+[A-Z\u00C0-\u024F]|\s+[^\d\s])/.test(text) ||
    /^section\s+\d+\.\d+\.\d+\b/i.test(text)
  ) {
    return 3;
  }
  if (
    /^\d+\.\d+(?:[.:\-\s]+[A-Z\u00C0-\u024F]|\s+[^\d\s])/.test(text) ||
    /^section\s+\d+\.\d+\b/i.test(text)
  ) {
    return 2;
  }
  if (
    /^(?:chapter|part|volume|appendix|preface|abstract|conclusion|references)\b/i.test(text) ||
    /^section\s+\d+\b/i.test(text) ||
    /^(?:[IVXLCDM]+\.|\d+(\.\d+)*\.?)\s+[A-Z\u00C0-\u024F]/.test(text) ||
    /^\d+\s+[A-Z\u00C0-\u024F]/.test(text)
  ) {
    return 1;
  }

  // 2. Relative font-size clustering (if surrounding page spans are available)
  const targetFontSize = options.fontSize;
  if (targetFontSize && options.pageSpans && options.pageSpans.length >= 2) {
    const distinctSizes: number[] = [];
    for (const span of options.pageSpans) {
      const fs = span.fontSize;
      if (fs > 0 && !distinctSizes.some((existing) => Math.abs(existing - fs) <= 1.5)) {
        distinctSizes.push(fs);
      }
    }
    distinctSizes.sort((a, b) => b - a);

    const rank = distinctSizes.findIndex((size) => Math.abs(size - targetFontSize) <= 1.5);
    if (rank !== -1) {
      return Math.min(6, Math.max(1, rank + 1));
    }
  }

  // 3. Absolute typographic thresholds fallback
  const baseSize = targetFontSize && targetFontSize > 0 ? targetFontSize : 12;
  const effectiveSize = baseSize + (options.isBold ? 2.5 : 0);

  if (effectiveSize >= 20) {
    return 1;
  }
  if (effectiveSize >= 15.5) {
    return 2;
  }
  if (effectiveSize >= 12.5) {
    return 3;
  }
  if (effectiveSize >= 10.5) {
    return 4;
  }
  return 5;
}

/**
 * Determines whether a text string represents a pure numeric value, measurement,
 * status badge, comparison, standalone currency, or tabular data cell rather than
 * a document heading.
 *
 * @param text The string to evaluate.
 * @return True if the text represents tabular cell data or a metric value.
 */
export function isTableValueOrDataCell(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length <= 1) return true;

  // Pure integer, decimal, or comma-separated number
  if (/^[-+]?\d+(?:[.,]\d+)*$/.test(trimmed)) return true;

  // Number with percentage or measurement unit (e.g. 100%, 24.2 ms, 60 fps, 12.5 kg)
  if (
    /^[-+]?\d+(?:[.,]\d+)*\s*(?:%|(?:ms|s|sec|min|h|hr|px|pt|in|mm|cm|m|km|kg|g|mg|fps|hz|khz|mhz|ghz|kb|mb|gb|tb|usd|eur|gbp|cad|aud|chf|cny|jpy)\b)/i.test(
      trimmed
    )
  ) {
    return true;
  }

  // Diagnostic or test status expressions (e.g. "24.2 ms (Passed)", "(Failed)", "(Passed)")
  if (/\((?:passed|failed|skipped|ok|error)\)$/i.test(trimmed)) {
    return true;
  }

  // Mathematical comparison or bounding expressions (e.g. "< 50.0 ms", ">= 99%")
  if (/^[<>=~±≤≥]\s*\d+/.test(trimmed)) {
    return true;
  }

  // Standalone currency amounts (e.g. "$1,250.00", "EUR 95.50", "USD 100")
  if (/^(?:[\$€£¥₹]|USD|EUR|GBP|CAD|AUD|CHF|CNY|JPY)\s*\d+/i.test(trimmed)) {
    return true;
  }

  // Standard tabular benchmark metric column headers
  if (/^(?:benchmark metric|target budget|engine measured baseline|unit price|total amount)$/i.test(trimmed)) {
    return true;
  }

  // Date formats without accompanying heading text (e.g. 2024-01-15, 12/31/2023)
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(trimmed) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Determines whether a text span is positioned inside a multi-column table row.
 * In document typography, headings command a full column or page width, whereas
 * table cells share an identical vertical baseline with horizontally separated sibling cells.
 *
 * @param span Target text span.
 * @param pageSpans All text spans on the page.
 * @return True if the span shares its baseline with other table columns.
 */
export function isSpanInTableRow(
  span: EditableTextSpan,
  pageSpans: EditableTextSpan[]
): boolean {
  const trimmed = (span.text || '').trim();
  // Preserve explicit hierarchical headings from false positive table classification
  if (/^(?:[IVXLCDM]+\.|\d+(\.\d+)*\.?)\s+[A-Z\u00C0-\u024F]/.test(trimmed)) {
    return false;
  }

  const spanY = span.baselineY || span.top;
  const sameRowSpans = pageSpans.filter((s) => {
    if (s.id === span.id) return false;
    const otherY = s.baselineY || s.top;
    if (Math.abs(spanY - otherY) > 3) return false;
    // Spans are horizontally distinct columns (separated by at least 8pt)
    return s.left > span.left + span.width + 8 || span.left > s.left + s.width + 8;
  });

  // Multiple columns in the same row indicates tabular grid layout
  return (
    sameRowSpans.length >= 2 ||
    (sameRowSpans.length >= 1 && span.width < 140 && sameRowSpans[0].width < 140)
  );
}

/**
 * Normalizes outline items hierarchy levels according to ISO 32000-1 Clause 12.3.3.
 * - The root item is clamped to Level 1.
 * - Any subsequent item level cannot jump by more than 1 deeper than its preceding item (level <= prev.level + 1).
 * - All levels are clamped between 1 and 6.
 *
 * @param items Flat outline items with levels.
 * @return Normalized outline items list.
 */
export function normalizeOutlineLevels(items: OutlineItemFlat[]): OutlineItemFlat[] {
  if (items.length === 0) return [];
  const result: OutlineItemFlat[] = [];
  let prevLevel = 1;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let level = Math.max(1, Math.min(6, item.level));
    if (i === 0) {
      level = 1;
    } else {
      level = Math.min(level, prevLevel + 1);
    }
    result.push({
      ...item,
      level,
    });
    prevLevel = level;
  }
  return result;
}

/**
 * Formats and sorts outline items in natural document reading order (top to bottom).
 * - Primary sort: pageIndex ascending (unlinked null page indices placed at the end).
 * - Secondary sort: vertical coordinate destY descending (larger Y is higher on page in PDF user space).
 * - Normalizes levels to form a valid ISO 32000-1 tree.
 *
 * @param items Flat outline items.
 * @return Sorted and normalized items.
 */
export function sortOutlineTopToBottom(items: OutlineItemFlat[]): OutlineItemFlat[] {
  if (items.length <= 1) {
    return items.map((it) => ({
      ...it,
      level: Math.max(1, Math.min(6, it.level)),
    }));
  }

  const sorted = [...items].sort((a, b) => {
    const pageA = a.pageIndex ?? Number.MAX_SAFE_INTEGER;
    const pageB = b.pageIndex ?? Number.MAX_SAFE_INTEGER;
    if (pageA !== pageB) {
      return pageA - pageB;
    }

    if (a.destY !== undefined && b.destY !== undefined) {
      return b.destY - a.destY;
    }
    if (a.destY !== undefined && b.destY === undefined) {
      return -1;
    }
    if (a.destY === undefined && b.destY !== undefined) {
      return 1;
    }

    return 0;
  });

  return sorted.map((it) => ({
    ...it,
    level: Math.max(1, Math.min(6, it.level)),
  }));
}

/**
 * Reorders outline items by moving elements from specified indices to a target index.
 * Adjusts target index for previous removals, clamps, and normalizes hierarchy levels.
 *
 * @param items Flat outline items.
 * @param fromIndices Source indices to move.
 * @param toIndex Destination insertion index.
 * @return Reordered and normalized outline items list.
 */
export function reorderOutlineItems(
  items: OutlineItemFlat[],
  fromIndices: number[],
  toIndex: number
): OutlineItemFlat[] {
  if (items.length === 0 || fromIndices.length === 0) return [...items];

  const uniqueFrom = Array.from(new Set(fromIndices))
    .filter((i) => i >= 0 && i < items.length)
    .sort((a, b) => a - b);
  if (uniqueFrom.length === 0) return [...items];

  const clampedTarget = Math.max(0, Math.min(items.length, toIndex));
  const movedItems = uniqueFrom.map((i) => items[i]);

  const shift = uniqueFrom.filter((i) => i < clampedTarget).length;
  const adjustedTarget = clampedTarget - shift;

  const copy = [...items];
  for (let i = uniqueFrom.length - 1; i >= 0; i--) {
    copy.splice(uniqueFrom[i], 1);
  }

  copy.splice(adjustedTarget, 0, ...movedItems);
  return normalizeOutlineLevels(copy);
}

/**
 * Automatically extracts candidate outline headings across document pages.
 * Filters body paragraphs, detects heading levels (H1 to maxLevel, default 3),
 * sorts in top-to-bottom reading order, and normalizes hierarchy.
 *
 * @param allPageSpans Array of editable text spans per document page.
 * @param pageHeights Array of page heights in points.
 * @param options Optional extraction configuration (e.g. maxLevel).
 * @return Flat list of extracted outline items.
 */
export function extractAutomaticOutlineItems(
  allPageSpans: EditableTextSpan[][],
  pageHeights: number[],
  options?: { maxLevel?: number }
): OutlineItemFlat[] {
  const maxLevel = options?.maxLevel ?? 3;
  const candidates: OutlineItemFlat[] = [];

  for (let pageIdx = 0; pageIdx < allPageSpans.length; pageIdx++) {
    const pageSpans = allPageSpans[pageIdx] || [];
    const pageH = pageHeights[pageIdx] ?? 792;

    for (const span of pageSpans) {
      let text = (span.text || '').trim();
      if (!text) continue;

      // Multi-line clustered span: if first line is a heading, split and extract it
      if (text.includes('\n')) {
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        if (
          lines.length > 0 &&
          (/^(?:[IVXLCDM]+\.|\d+(\.\d+)*\.?)\s+[A-Z\u00C0-\u024F]/.test(lines[0]) ||
            /^(?:chapter|part|section|appendix|overview|summary|introduction|conclusion|references)\b/i.test(lines[0]))
        ) {
          text = lines[0];
        }
      }

      if (text.length > 180 || text.length <= 1) continue;

      // Filter out faint background watermarks and low-opacity decorative text (alpha < 100)
      if (span.color && span.color.a !== undefined && span.color.a < 100) continue;

      // Filter out isolated page numbers (e.g. single digit or plain page footer)
      if (/^\d{1,4}$/.test(text)) continue;

      // Filter out table values, metrics, unit values, test statuses, and standalone currencies
      if (isTableValueOrDataCell(text)) continue;

      // Filter out tabular grid data sharing baseline rows with other columns
      if (isSpanInTableRow(span, pageSpans)) continue;

      const rawLower = (span.rawFontFamily || span.fontFamily || '').toLowerCase();
      const isBold =
        span.fontWeight === 'bold' ||
        rawLower.includes('bold') ||
        rawLower.includes('black') ||
        rawLower.includes('heavy') ||
        rawLower.includes('semibold') ||
        rawLower.includes('demibold') ||
        rawLower.includes('extrabold');

      const fontSize = span.fontSize ? Math.round(span.fontSize * 10) / 10 : 12;

      const level = inferOutlineLevel({
        text,
        fontSize,
        isBold,
      });

      // Heading criteria:
      // 1. Matches numeric or section prefix pattern (e.g. 1. Intro, Chapter 1), or
      // 2. Has heading level <= maxLevel and (effectiveSize >= 12.5 or level <= 2)
      const hasHeadingPattern =
        /^(?:[IVXLCDM]+\.|\d+(\.\d+)*\.?)\s+[A-Z\u00C0-\u024F]/.test(text) ||
        /^(?:chapter|part|section|appendix|overview|summary|introduction|conclusion|references|background|methodology|evaluation|results|discussion|abstract|preface)\b/i.test(
          text
        );

      const effectiveSize = fontSize + (isBold ? 2.5 : 0);

      if (
        level <= maxLevel &&
        (hasHeadingPattern || effectiveSize >= 12.5 || level <= 2)
      ) {
        // PDF destY: from bottom to top
        const destY = Math.max(0, pageH - span.top);
        candidates.push({
          title: text,
          pageIndex: pageIdx,
          level,
          destY,
        });
      }
    }
  }

  // Sort candidates top-to-bottom across pages and vertical coordinates
  const sorted = sortOutlineTopToBottom(candidates);

  // Deduplicate identical consecutive titles on the same page
  const deduplicated: OutlineItemFlat[] = [];
  for (const item of sorted) {
    const last = deduplicated[deduplicated.length - 1];
    if (last && last.title === item.title && last.pageIndex === item.pageIndex) {
      continue;
    }
    deduplicated.push(item);
  }

  return deduplicated.map((it) => ({
    ...it,
    level: Math.max(1, Math.min(6, it.level)),
  }));
}

/**
 * Builds a hierarchical tree of OutlineNode objects from a flat list of items with levels.
 * Uses a stack-based algorithm to correctly nest children under preceding parents.
 *
 * @param items Flat list of outline items with level annotations.
 * @return Hierarchical OutlineNode array.
 */
export function buildOutlineTree(items: OutlineItemFlat[]): OutlineNode[] {
  const root: OutlineNode[] = [];
  const stack: Array<{ node: OutlineNode; level: number }> = [];

  for (const item of items) {
    const level = Math.max(1, Math.min(6, item.level));
    const node: OutlineNode = {
      title: item.title,
      pageIndex: item.pageIndex,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }

    stack.push({ node, level });
  }

  return root;
}

/**
 * Flattens a nested OutlineNode tree into a flat array of items with levels.
 *
 * @param nodes Hierarchical OutlineNode array.
 * @param currentLevel Initial hierarchy level (defaults to 1).
 * @return Flat list of items annotated with hierarchy level.
 */
export function flattenOutlineTree(
  nodes: OutlineNode[],
  currentLevel: number = 1
): OutlineItemFlat[] {
  const result: OutlineItemFlat[] = [];

  for (const node of nodes) {
    result.push({
      title: node.title,
      pageIndex: node.pageIndex,
      level: currentLevel,
    });

    if (node.children && node.children.length > 0) {
      result.push(...flattenOutlineTree(node.children, currentLevel + 1));
    }
  }

  return result;
}

/**
 * Reads existing outline bookmarks directly from a loaded PDFDocument catalog.
 *
 * @param pdfDoc The active PDFDocument instance.
 * @return Array of top-level OutlineNode items.
 */
export function readOutlinesFromPdf(pdfDoc: PDFDocument): OutlineNode[] {
  const outlinesRef = pdfDoc.catalog.get(PDFName.of('Outlines'));
  if (!outlinesRef) return [];

  const outlinesDict = pdfDoc.context.lookupMaybe(outlinesRef, PDFDict);
  if (!outlinesDict) return [];

  const pages = pdfDoc.getPages();
  const pageMap = new Map<unknown, number>();
  pages.forEach((p, idx) => pageMap.set(p.ref, idx));

  const firstRef = outlinesDict.get(PDFName.of('First'));
  if (!firstRef) return [];

  const processLevel = (bookmarkRef: PDFObject | PDFRef | undefined): OutlineNode[] => {
    const nodes: OutlineNode[] = [];
    let currentRef: PDFObject | PDFRef | undefined = bookmarkRef;

    while (currentRef) {
      const itemDict = pdfDoc.context.lookupMaybe(currentRef, PDFDict);
      if (!itemDict) break;

      // Extract title
      let title = '';
      const rawTitle = itemDict.get(PDFName.of('Title'));
      if (rawTitle instanceof PDFHexString) {
        title = rawTitle.decodeText();
      } else if (rawTitle instanceof PDFString) {
        title = rawTitle.asString();
      }

      // Extract destination page index
      let pageIndex: number | null = null;
      let destObj = itemDict.get(PDFName.of('Dest'));
      if (!destObj) {
        const actionObj = itemDict.get(PDFName.of('A'));
        if (actionObj) {
          const actionDict = pdfDoc.context.lookupMaybe(actionObj, PDFDict);
          if (actionDict && actionDict.has(PDFName.of('D'))) {
            destObj = actionDict.get(PDFName.of('D'));
          }
        }
      }

      if (destObj) {
        const resolvedDest = pdfDoc.context.lookupMaybe(destObj, PDFArray);
        if (resolvedDest && resolvedDest.size() > 0) {
          const targetPageRef = resolvedDest.get(0);
          if (pageMap.has(targetPageRef)) {
            pageIndex = pageMap.get(targetPageRef) ?? null;
          }
        }
      }

      // Process children
      const childRef = itemDict.get(PDFName.of('First'));
      const children = childRef ? processLevel(childRef) : [];

      nodes.push({
        title: title || 'Untitled Outline Item',
        pageIndex,
        children,
      });

      // Move to next sibling
      currentRef = itemDict.get(PDFName.of('Next'));
    }

    return nodes;
  };

  return processLevel(firstRef);
}

/**
 * Serializes a hierarchical OutlineNode array into the PDFDocument catalog /Outlines dictionary
 * according to ISO 32000-1 Clause 12.3.3.
 *
 * @param pdfDoc The PDFDocument instance to mutate.
 * @param roots Hierarchical outline nodes to write.
 */
export function writeOutlinesToPdf(pdfDoc: PDFDocument, roots: OutlineNode[]): void {
  if (roots.length === 0) {
    if (pdfDoc.catalog.has(PDFName.of('Outlines'))) {
      pdfDoc.catalog.delete(PDFName.of('Outlines'));
    }
    return;
  }

  const context = pdfDoc.context;
  const outlinesDict = context.obj({ Type: 'Outlines' });
  const outlinesRef = context.register(outlinesDict);
  pdfDoc.catalog.set(PDFName.of('Outlines'), outlinesRef);

  const processLevel = (
    nodes: OutlineNode[],
    parentRef: PDFRef
  ): { firstRef: PDFRef; lastRef: PDFRef; count: number } => {
    const refs: PDFRef[] = nodes.map(() => context.nextRef());
    let totalDescendants = 0;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const ref = refs[i];

      const dict = context.obj({
        Title: PDFHexString.fromText(node.title),
        Parent: parentRef,
      });

      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < nodes.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);

      if (
        node.pageIndex !== null &&
        node.pageIndex >= 0 &&
        node.pageIndex < pdfDoc.getPageCount()
      ) {
        const page = pdfDoc.getPage(node.pageIndex);
        dict.set(PDFName.of('Dest'), context.obj([page.ref, PDFName.of('Fit')]));
      }

      if (node.children && node.children.length > 0) {
        const childResult = processLevel(node.children, ref);
        dict.set(PDFName.of('First'), childResult.firstRef);
        dict.set(PDFName.of('Last'), childResult.lastRef);
        dict.set(PDFName.of('Count'), context.obj(childResult.count));
        totalDescendants += childResult.count;
      }

      context.assign(ref, dict);
    }

    return {
      firstRef: refs[0],
      lastRef: refs[refs.length - 1],
      count: nodes.length + totalDescendants,
    };
  };

  const { firstRef, lastRef, count } = processLevel(roots, outlinesRef);
  outlinesDict.set(PDFName.of('First'), firstRef);
  outlinesDict.set(PDFName.of('Last'), lastRef);
  outlinesDict.set(PDFName.of('Count'), context.obj(count));
}

/**
 * Options for adding or updating an outline entry in a PDF byte buffer.
 */
export interface AddOrUpdateOutlineOptions {
  title: string;
  pageIndex: number;
  level: number;
  destY?: number;
  oldTitle?: string;
}

/**
 * Adds or updates an outline bookmark item in a PDF document buffer, preserving existing outlines.
 *
 * @param pdfBytes Binary PDF buffer.
 * @param options Target outline item parameters.
 * @return Promise resolving to updated PDF byte array.
 */
export async function addOrUpdateOutlineItem(
  pdfBytes: Uint8Array | ArrayBuffer,
  options: AddOrUpdateOutlineOptions
): Promise<Uint8Array> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const existingTree = readOutlinesFromPdf(pdfDoc);
  const flat = flattenOutlineTree(existingTree);

  if (options.oldTitle) {
    const targetIdx = flat.findIndex((item) => item.title === options.oldTitle);
    if (targetIdx !== -1) {
      flat[targetIdx] = {
        title: options.title,
        pageIndex: options.pageIndex,
        level: options.level,
        destY: options.destY,
      };
    } else {
      flat.push({
        title: options.title,
        pageIndex: options.pageIndex,
        level: options.level,
        destY: options.destY,
      });
    }
  } else {
    const existingIdx = flat.findIndex(
      (item) => item.title === options.title && item.pageIndex === options.pageIndex
    );
    if (existingIdx !== -1) {
      flat[existingIdx].level = options.level;
      if (options.destY !== undefined) flat[existingIdx].destY = options.destY;
    } else {
      // Find insertion point by page index and vertical position
      let insertIdx = flat.length;
      for (let i = 0; i < flat.length; i++) {
        const item = flat[i];
        if (!item) continue;
        const itemPage = item.pageIndex;
        if (itemPage !== null && itemPage > options.pageIndex) {
          insertIdx = i;
          break;
        }
        if (itemPage === options.pageIndex && options.destY !== undefined && item.destY !== undefined) {
          if (options.destY > item.destY) {
            insertIdx = i;
            break;
          }
        }
      }
      flat.splice(insertIdx, 0, {
        title: options.title,
        pageIndex: options.pageIndex,
        level: options.level,
        destY: options.destY,
      });
    }
  }

  const updatedTree = buildOutlineTree(flat);
  writeOutlinesToPdf(pdfDoc, updatedTree);

  return pdfDoc.save();
}

/**
 * Sets the document outline explicitly from a list of flat outline items.
 *
 * @param pdfBytes Binary PDF buffer.
 * @param items Flat outline items to write.
 * @return Promise resolving to updated PDF byte array.
 */
export async function setOutlineItems(
  pdfBytes: Uint8Array | ArrayBuffer,
  items: OutlineItemFlat[]
): Promise<Uint8Array> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const updatedTree = buildOutlineTree(items);
  writeOutlinesToPdf(pdfDoc, updatedTree);

  return pdfDoc.save();
}

/**
 * Updates the heading level of an outline item at a given index.
 *
 * @param pdfBytes Binary PDF buffer.
 * @param index Zero-based index in the flattened outline.
 * @param newLevel Desired heading level (1 to 6).
 * @return Promise resolving to updated PDF byte array.
 */
export async function updateOutlineItemLevel(
  pdfBytes: Uint8Array | ArrayBuffer,
  index: number,
  newLevel: number
): Promise<Uint8Array> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const existingTree = readOutlinesFromPdf(pdfDoc);
  const flat = flattenOutlineTree(existingTree);

  if (index >= 0 && index < flat.length) {
    flat[index] = {
      ...flat[index],
      level: Math.max(1, Math.min(6, newLevel)),
    };
  }

  const updatedTree = buildOutlineTree(flat);
  writeOutlinesToPdf(pdfDoc, updatedTree);

  return pdfDoc.save();
}

/**
 * Removes an outline bookmark item by title from a PDF document buffer.
 *
 * @param pdfBytes Binary PDF buffer.
 * @param title Title of the bookmark to remove.
 * @param pageIndex Optional page index constraint.
 * @return Promise resolving to updated PDF byte array.
 */
export async function removeOutlineItemFromPdf(
  pdfBytes: Uint8Array | ArrayBuffer,
  title: string,
  pageIndex?: number
): Promise<Uint8Array> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const existingTree = readOutlinesFromPdf(pdfDoc);
  const flat = flattenOutlineTree(existingTree);

  const filtered = flat.filter((item) => {
    if (item.title !== title) return true;
    if (pageIndex !== undefined && item.pageIndex !== pageIndex) return true;
    return false;
  });

  const updatedTree = buildOutlineTree(filtered);
  writeOutlinesToPdf(pdfDoc, updatedTree);

  return pdfDoc.save();
}

