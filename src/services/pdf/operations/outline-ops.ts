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
import type { OutlineNode } from '../../../core/types';

export * from './outline-tree';
import {
  type OutlineItemFlat,
  buildOutlineTree,
  flattenOutlineTree,
} from './outline-tree';


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

